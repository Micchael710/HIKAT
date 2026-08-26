/**
 * HiKAT Media HTTP Transport
 * Dedicated binary transport endpoints for uploading and serving media assets via Cloudflare R2.
 */

import { Database } from "@hikat/database"
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_SKIN_SIZE_BYTES,
  validateMinecraftSkinTexture,
  MediaMimeType,
} from "@hikat/shared"
import type { Env, BackendGraphQLContext } from "../types"
import { getCorsHeaders } from "../cors"
import {
  getAndValidateUploadToken,
  consumeUploadTokenAtomically,
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
 * Reads binary body using a stream reader with a hard limit.
 * Aborts/cancels the stream immediately if total bytes read exceeds maxBytes.
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<
  | { success: true; buffer: ArrayBuffer; bytesRead: number }
  | { success: false; reason: "TOO_LARGE" | "EMPTY" }
> {
  if (!request.body) {
    return { success: false, reason: "EMPTY" }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (value && value.byteLength > 0) {
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel("Payload exceeds maximum permitted limit")
          } catch {
            // Ignore cancel error
          }
          return { success: false, reason: "TOO_LARGE" }
        }
        chunks.push(value)
      }
    }
  } catch (err: any) {
    if (totalBytes > maxBytes) {
      return { success: false, reason: "TOO_LARGE" }
    }
    throw err
  }

  if (totalBytes === 0) {
    return { success: false, reason: "EMPTY" }
  }

  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { success: true, buffer: combined.buffer, bytesRead: totalBytes }
}

/**
 * Handles binary media upload: PUT /media/content/upload
 * Requires:
 *  1. Bearer JWT authentication for an active ADMIN session
 *  2. X-Upload-Token header containing a valid single-use upload token issued to the same admin
 *  3. Binary body with allowed MIME type and size <= min(token.maxSizeBytes, MAX_IMAGE_SIZE_BYTES / MAX_VIDEO_SIZE_BYTES)
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

    // 2. Validate X-Upload-Token header presence
    const uploadToken =
      request.headers.get("x-upload-token") ||
      request.headers.get("X-Upload-Token")
    if (!uploadToken || uploadToken.trim() === "") {
      return jsonResponse(
        { error: "Missing required X-Upload-Token header" },
        400,
        request,
        env,
      )
    }

    const adminUserId = context.auth.identity.userId

    // 3. Initial non-consuming token validation & ownership check
    let tokenRecord
    try {
      tokenRecord = await getAndValidateUploadToken(
        db,
        uploadToken,
        adminUserId,
      )
    } catch (tokenErr: any) {
      const code = tokenErr.extensions?.code
      if (code === "FORBIDDEN") {
        return jsonResponse({ error: tokenErr.message }, 403, request, env)
      }
      if (code === "CONFLICT") {
        return jsonResponse({ error: tokenErr.message }, 409, request, env)
      }
      return jsonResponse(
        { error: tokenErr.message || "Invalid or expired upload token" },
        401,
        request,
        env,
      )
    }

    // 4. Validate Content-Type against allowed MIME types and expected token MIME
    const rawContentType =
      request.headers.get("content-type") || "application/octet-stream"
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

    if (
      tokenRecord.expectedMimeType &&
      tokenRecord.expectedMimeType.toLowerCase() !== mimeType
    ) {
      return jsonResponse(
        {
          error: `Content-Type '${mimeType}' does not match expected token MIME type '${tokenRecord.expectedMimeType}'`,
        },
        400,
        request,
        env,
      )
    }

    // 5. Compute ticket-bound max size limit
    const globalTypeMax =
      tokenRecord.mediaType === "VIDEO"
        ? MAX_VIDEO_SIZE_BYTES
        : MAX_IMAGE_SIZE_BYTES

    const effectiveMaxSizeBytes = Math.min(
      tokenRecord.maxSizeBytes,
      globalTypeMax,
    )

    // 6. Early Content-Length check if present
    const contentLengthHeader = request.headers.get("content-length")
    if (contentLengthHeader) {
      const declaredLength = parseInt(contentLengthHeader, 10)
      if (!isNaN(declaredLength) && declaredLength > effectiveMaxSizeBytes) {
        return jsonResponse(
          {
            error: `Payload exceeds ticket maximum permitted size of ${effectiveMaxSizeBytes} bytes`,
          },
          413,
          request,
          env,
        )
      }
    }

    // 7. Read binary body with hard stream limit
    const bodyResult = await readBodyWithLimit(request, effectiveMaxSizeBytes)
    if (!bodyResult.success) {
      if (bodyResult.reason === "TOO_LARGE") {
        return jsonResponse(
          {
            error: `Payload size exceeds maximum permitted limit (${effectiveMaxSizeBytes} bytes)`,
          },
          413,
          request,
          env,
        )
      }
      return jsonResponse(
        { error: "Cannot upload empty file" },
        400,
        request,
        env,
      )
    }

    // 8. Atomic single-use consumption right before saving
    const consumed = await consumeUploadTokenAtomically(
      db,
      tokenRecord.tokenHash,
      adminUserId,
    )
    if (!consumed) {
      return jsonResponse(
        { error: "Upload token has already been consumed or is invalid" },
        409,
        request,
        env,
      )
    }

    // 9. Save to R2 with D1 metadata & explicit compensation rollback
    const savedMedia = await saveMediaObjectWithCompensation(db, env, {
      mimeType,
      mediaType: tokenRecord.mediaType,
      body: bodyResult.buffer,
      createdBy: adminUserId,
    })

    const formatted = formatMediaGql(savedMedia, env, request)
    return jsonResponse(
      {
        id: formatted.id,
        mediaType: formatted.mediaType,
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
      return jsonResponse(
        { error: "Invalid media ID format" },
        400,
        request,
        env,
      )
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
      return jsonResponse(
        { error: "Media object not found" },
        404,
        request,
        env,
      )
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

/**
 * Dedicated upload handler for player custom skins: PUT /media/player-skin/upload
 * Validates single-use token, authenticated PLAYER, PNG content-type, size <= 1MB,
 * strict Minecraft skin texture dimensions (64x64 or 64x32), and consumes the token.
 */
export async function handlePlayerSkinUpload(
  request: Request,
  env: Env,
  db: Database | undefined,
  context: BackendGraphQLContext,
): Promise<Response> {
  const isDev = env.ENVIRONMENT === "development"

  try {
    // 1. Authenticate user
    if (context.auth.status !== "authenticated") {
      return jsonResponse({ error: "Authentication required" }, 401, request, env)
    }

    const userId = context.auth.identity.userId

    if (!db) {
      return jsonResponse({ error: "Database unavailable" }, 500, request, env)
    }

    // 2. Validate token header
    const rawToken = request.headers.get("X-Upload-Token") || request.headers.get("x-upload-token")
    if (!rawToken) {
      return jsonResponse({ error: "Missing X-Upload-Token header" }, 400, request, env)
    }

    let tokenRecord
    try {
      tokenRecord = await getAndValidateUploadToken(db, rawToken, userId)
    } catch (tokenErr: any) {
      const code = tokenErr.extensions?.code
      if (code === "FORBIDDEN") {
        return jsonResponse({ error: tokenErr.message }, 403, request, env)
      }
      if (code === "CONFLICT") {
        return jsonResponse({ error: tokenErr.message }, 409, request, env)
      }
      return jsonResponse({ error: tokenErr.message || "Invalid or expired upload token" }, 401, request, env)
    }

    // 3. Validate Content-Type
    const contentType = request.headers.get("Content-Type")?.toLowerCase().split(";")[0]?.trim()
    if (contentType !== "image/png") {
      return jsonResponse({ error: "Solo se admiten archivos PNG para texturas de Skin" }, 415, request, env)
    }

    // 4. Read body stream with limit (1MB max)
    const readResult = await readBodyWithLimit(request, MAX_SKIN_SIZE_BYTES)
    if (!readResult.success) {
      if (readResult.reason === "TOO_LARGE") {
        return jsonResponse({ error: `El archivo supera el tamaño máximo permitido de 1 MB` }, 413, request, env)
      }

      return jsonResponse({ error: "El cuerpo de la petición está vacío" }, 400, request, env)
    }

    const buffer = readResult.buffer
    const sizeBytes = readResult.bytesRead

    // 5. Validate Minecraft skin dimensions (strict 64x64 or 64x32)
    const textureValidation = validateMinecraftSkinTexture(buffer)
    if (!textureValidation.valid) {
      return jsonResponse(
        {
          error: `Dimensiones de skin inválidas (${textureValidation.width}x${textureValidation.height}). Se requiere PNG de 64x64 o 64x32.`,
        },
        400,
        request,
        env,
      )
    }

    // 6. Consume upload token atomically
    const consumed = await consumeUploadTokenAtomically(
      db,
      tokenRecord.tokenHash,
      userId,
    )
    if (!consumed) {
      return jsonResponse({ error: "Upload token was already consumed concurrently" }, 409, request, env)
    }

    // 7. Store in R2 + metadata in D1 with compensation
    const mediaRecord = await saveMediaObjectWithCompensation(db, env, {
      mimeType: "image/png",
      mediaType: "IMAGE",
      body: buffer,
      createdBy: userId,
    })

    const formatted = formatMediaGql(mediaRecord, env, request)
    return jsonResponse(
      {
        id: formatted.id,
        mediaType: formatted.mediaType,
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
      return jsonResponse({ error: err.message, stack: err.stack }, 500, request, env)
    }
    return jsonResponse({ error: "Internal server error" }, 500, request, env)
  }
}

