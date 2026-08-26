/**
 * HiKAT Media HTTP Transport
 * Dedicated binary transport endpoints for uploading and serving media assets via Cloudflare R2.
 */

import { Database } from "@hikat/database"
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_MEDIA_SIZE_BYTES,
  MediaMimeType,
} from "@hikat/shared"
import type { Env, BackendGraphQLContext } from "../types"
import { getCorsHeaders } from "../cors"
import {
  consumeAndValidateUploadToken,
  saveMediaObjectWithCompensation,
  getContentMediaById,
  formatMediaGql,
} from "../services/mediaService"

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  request: Request,
  env: Env,
): Response {
  const cors = getCorsHeaders(request, env)
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...cors,
    },
  })
}

/**
 * Handles binary media upload: PUT /media/content/upload
 * Requires:
 *  1. Bearer JWT authentication for an active ADMIN session
 *  2. X-Upload-Token header containing a valid single-use upload token issued to the same admin
 *  3. Binary body with allowed MIME type and size <= MAX_MEDIA_SIZE_BYTES
 */
export async function handleMediaUpload(
  request: Request,
  env: Env,
  db: Database | undefined,
  context: BackendGraphQLContext,
): Promise<Response> {
  const isDev = env.ENVIRONMENT === "development"

  try {
    // 1. Dual Authorization: Validate Bearer Admin Auth
    if (context.auth.status !== "authenticated") {
      return jsonResponse(
        { error: "Authentication required to upload media" },
        401,
        request,
        env,
      )
    }

    if (context.auth.identity.role !== "ADMIN") {
      return jsonResponse(
        { error: "Forbidden: administrative privilege required" },
        403,
        request,
        env,
      )
    }

    if (!db) {
      return jsonResponse({ error: "Database unavailable" }, 500, request, env)
    }

    // 2. Validate X-Upload-Token header
    const uploadToken = request.headers.get("x-upload-token") || request.headers.get("X-Upload-Token")
    if (!uploadToken || uploadToken.trim() === "") {
      return jsonResponse(
        { error: "Missing required X-Upload-Token header" },
        400,
        request,
        env,
      )
    }

    // 3. Early Content-Length check if present
    const contentLengthHeader = request.headers.get("content-length")
    if (contentLengthHeader) {
      const declaredLength = parseInt(contentLengthHeader, 10)
      if (!isNaN(declaredLength) && declaredLength > MAX_MEDIA_SIZE_BYTES) {
        return jsonResponse(
          {
            error: `Payload exceeds maximum permitted size of ${MAX_MEDIA_SIZE_BYTES} bytes`,
          },
          413,
          request,
          env,
        )
      }
    }

    // 4. Validate Content-Type
    const rawContentType = request.headers.get("content-type") || "application/octet-stream"
    const mimeType = rawContentType.split(";")[0]?.trim().toLowerCase() || ""

    if (!ALLOWED_MEDIA_MIME_TYPES.includes(mimeType as MediaMimeType)) {
      return jsonResponse(
        {
          error: `Unsupported Media Type '${mimeType}'. Allowed: ${ALLOWED_MEDIA_MIME_TYPES.join(", ")}`,
        },
        415,
        request,
        env,
      )
    }

    // 5. Read binary body and validate real size
    const bodyBuffer = await request.arrayBuffer()
    const actualBytes = bodyBuffer.byteLength

    if (actualBytes === 0) {
      return jsonResponse({ error: "Cannot upload empty file" }, 400, request, env)
    }

    if (actualBytes > MAX_MEDIA_SIZE_BYTES) {
      return jsonResponse(
        {
          error: `Payload size (${actualBytes} bytes) exceeds maximum permitted limit (${MAX_MEDIA_SIZE_BYTES} bytes)`,
        },
        413,
        request,
        env,
      )
    }

    // 6. Atomically consume token and verify admin identity
    const adminUserId = context.auth.identity.userId
    let validatedToken
    try {
      validatedToken = await consumeAndValidateUploadToken(db, uploadToken, adminUserId)
    } catch (tokenErr: any) {
      const code = tokenErr.extensions?.code
      if (code === "CONFLICT") {
        return jsonResponse({ error: tokenErr.message }, 409, request, env)
      }
      if (code === "FORBIDDEN") {
        return jsonResponse({ error: tokenErr.message }, 403, request, env)
      }
      return jsonResponse(
        { error: tokenErr.message || "Invalid or expired upload token" },
        401,
        request,
        env,
      )
    }

    // 7. Verify expected MIME type matches
    if (
      validatedToken.expectedMimeType &&
      validatedToken.expectedMimeType.toLowerCase() !== mimeType
    ) {
      return jsonResponse(
        {
          error: `Content-Type '${mimeType}' does not match expected token MIME type '${validatedToken.expectedMimeType}'`,
        },
        400,
        request,
        env,
      )
    }

    // 8. Save to R2 with D1 metadata & explicit compensation rollback
    const savedMedia = await saveMediaObjectWithCompensation(db, env, {
      mimeType,
      body: bodyBuffer,
      createdBy: adminUserId,
    })

    const formatted = formatMediaGql(savedMedia, env, request)
    return jsonResponse(
      {
        id: formatted.id,
        objectKey: formatted.objectKey,
        mimeType: formatted.mimeType,
        sizeBytes: formatted.sizeBytes,
        url: formatted.url,
        createdAt: formatted.createdAt,
      },
      201,
      request,
      env,
    )
  } catch (err: any) {
    if (isDev) {
      return jsonResponse(
        { error: err.message, stack: err.stack },
        500,
        request,
        env,
      )
    }
    return jsonResponse({ error: "Internal server error" }, 500, request, env)
  }
}

/**
 * Handles public media delivery: GET /media/content/:id
 * Streams binary media from Cloudflare R2 with cache headers and correct Content-Type.
 */
export async function handleMediaServe(
  request: Request,
  env: Env,
  db: Database | undefined,
  mediaId: string,
): Promise<Response> {
  const isDev = env.ENVIRONMENT === "development"
  const cors = getCorsHeaders(request, env)

  try {
    // 1. Validate ID format to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(mediaId)) {
      return jsonResponse({ error: "Invalid media ID format" }, 400, request, env)
    }

    if (!db) {
      return jsonResponse({ error: "Database unavailable" }, 500, request, env)
    }

    // 2. Fetch metadata from D1
    const media = await getContentMediaById(db, mediaId)
    if (!media) {
      return jsonResponse({ error: "Media not found" }, 404, request, env)
    }

    // 3. Fetch binary object from R2
    if (!env.ASSETS) {
      return jsonResponse(
        { error: "Storage bucket unavailable" },
        500,
        request,
        env,
      )
    }

    const object = await env.ASSETS.get(media.objectKey)
    if (!object) {
      return jsonResponse({ error: "Media object not found" }, 404, request, env)
    }

    // 4. Return binary stream with headers
    const headers = new Headers()
    headers.set("Content-Type", media.mimeType || "application/octet-stream")
    headers.set("Content-Length", String(media.sizeBytes))
    headers.set("Cache-Control", "public, max-age=31536000, immutable")
    if (object.httpEtag) {
      headers.set("ETag", object.httpEtag)
    }

    for (const [k, v] of Object.entries(cors)) {
      headers.set(k, v)
    }

    return new Response(object.body, {
      status: 200,
      headers,
    })
  } catch (err: any) {
    if (isDev) {
      return jsonResponse(
        { error: err.message, stack: err.stack },
        500,
        request,
        env,
      )
    }
    return jsonResponse({ error: "Internal server error" }, 500, request, env)
  }
}
