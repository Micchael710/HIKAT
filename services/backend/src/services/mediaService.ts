/**
 * HiKAT Media Service
 * Handles media upload tickets, token validation, atomic consumption,
 * Cloudflare R2 binary storage with explicit compensation rollback, and metadata records.
 */

import { eq, sql } from "drizzle-orm"
import {
  Database,
  contentMedia,
  contentMediaUploadTokens,
  contentPosts,
  ContentMedia,
} from "@hikat/database"
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_MEDIA_SIZE_BYTES,
  MEDIA_UPLOAD_TOKEN_EXPIRATION_SECONDS,
  MediaMimeType,
} from "@hikat/shared"
import {
  createGraphQLError,
  ContentMediaGql,
  ContentMediaUploadPayloadGql,
  CreateContentMediaUploadInputGql,
} from "@hikat/graphql"
import type { Env } from "../types"

export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

function getExtensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png"
    case "image/jpeg":
      return "jpg"
    case "image/webp":
      return "webp"
    default:
      return "bin"
  }
}

export function formatMediaGql(
  media: ContentMedia,
  env: Env,
  request?: Request,
): ContentMediaGql {
  let url = `/media/content/${media.id}`
  if (env.PUBLIC_MEDIA_URL_BASE && env.PUBLIC_MEDIA_URL_BASE.trim() !== "") {
    url = `${env.PUBLIC_MEDIA_URL_BASE.replace(/\/$/, "")}/media/content/${media.id}`
  } else if (request) {
    try {
      url = `${new URL(request.url).origin}/media/content/${media.id}`
    } catch {
      url = `/media/content/${media.id}`
    }
  }

  return {
    id: media.id,
    objectKey: media.objectKey,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    url,
    createdAt: media.createdAt,
  }
}

/**
 * Creates a single-use, time-limited media upload ticket for an authenticated administrator.
 */
export async function createContentMediaUpload(
  db: Database,
  env: Env,
  adminUserId: string,
  input: CreateContentMediaUploadInputGql,
  request?: Request,
): Promise<ContentMediaUploadPayloadGql> {
  if (!ALLOWED_MEDIA_MIME_TYPES.includes(input.mimeType as MediaMimeType)) {
    throw createGraphQLError(
      `Invalid MIME type '${input.mimeType}'. Allowed MIME types: ${ALLOWED_MEDIA_MIME_TYPES.join(", ")}`,
      "VALIDATION_ERROR",
    )
  }

  if (
    typeof input.sizeBytes !== "number" ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_MEDIA_SIZE_BYTES
  ) {
    throw createGraphQLError(
      `Invalid file size. Size must be between 1 and ${MAX_MEDIA_SIZE_BYTES} bytes (${MAX_MEDIA_SIZE_BYTES / (1024 * 1024)}MB)`,
      "VALIDATION_ERROR",
    )
  }

  const rawToken = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`
  const tokenHash = await sha256Hex(rawToken)
  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + MEDIA_UPLOAD_TOKEN_EXPIRATION_SECONDS * 1000,
  ).toISOString()

  await db.insert(contentMediaUploadTokens).values({
    id: crypto.randomUUID(),
    tokenHash,
    createdBy: adminUserId,
    expectedMimeType: input.mimeType,
    maxSizeBytes: input.sizeBytes,
    expiresAt,
    createdAt: now.toISOString(),
  })

  let uploadUrl = "/media/content/upload"
  if (env.PUBLIC_MEDIA_URL_BASE && env.PUBLIC_MEDIA_URL_BASE.trim() !== "") {
    uploadUrl = `${env.PUBLIC_MEDIA_URL_BASE.replace(/\/$/, "")}/media/content/upload`
  } else if (request) {
    try {
      uploadUrl = `${new URL(request.url).origin}/media/content/upload`
    } catch {
      uploadUrl = "/media/content/upload"
    }
  }

  return {
    uploadUrl,
    uploadToken: rawToken,
    expiresAt,
    maxSizeBytes: input.sizeBytes,
    expectedMimeType: input.mimeType,
    allowedMimeTypes: [...ALLOWED_MEDIA_MIME_TYPES],
  }
}

export interface ValidatedUploadToken {
  id: string
  tokenHash: string
  createdBy: string
  expectedMimeType: string
  maxSizeBytes: number
}

/**
 * Non-destructively reads and validates an upload ticket.
 * Verifies validity, non-expiration, and that the ticket belongs to the authenticated ADMIN.
 * Does NOT burn or consume the token.
 */
export async function getAndValidateUploadToken(
  db: Database,
  rawToken: string,
  authenticatedAdminId: string,
): Promise<ValidatedUploadToken> {
  const tokenHash = await sha256Hex(rawToken)
  const nowIso = new Date().toISOString()

  const tokenRecord = await db
    .select()
    .from(contentMediaUploadTokens)
    .where(eq(contentMediaUploadTokens.tokenHash, tokenHash))
    .get()

  if (!tokenRecord) {
    throw createGraphQLError("Invalid upload token", "UNAUTHENTICATED")
  }

  if (tokenRecord.usedAt) {
    throw createGraphQLError(
      "Upload token has already been consumed",
      "CONFLICT",
    )
  }

  if (tokenRecord.expiresAt <= nowIso) {
    throw createGraphQLError("Upload token has expired", "UNAUTHENTICATED")
  }

  // Non-destructive owner check: returns 403 without burning the ticket
  if (tokenRecord.createdBy !== authenticatedAdminId) {
    throw createGraphQLError(
      "Upload token does not belong to the authenticated administrator",
      "FORBIDDEN",
    )
  }

  return {
    id: tokenRecord.id,
    tokenHash: tokenRecord.tokenHash,
    createdBy: tokenRecord.createdBy,
    expectedMimeType: tokenRecord.expectedMimeType,
    maxSizeBytes: tokenRecord.maxSizeBytes,
  }
}

/**
 * Atomically consumes an upload token specifically for the authenticated ADMIN owner.
 * Condition: token_hash, created_by, used_at IS NULL, expires_at > now.
 */
export async function consumeUploadTokenAtomically(
  db: Database,
  tokenHash: string,
  authenticatedAdminId: string,
): Promise<boolean> {
  const nowIso = new Date().toISOString()

  const updateResult = await db.run(
    sql`UPDATE content_media_upload_tokens SET used_at = ${nowIso} WHERE token_hash = ${tokenHash} AND created_by = ${authenticatedAdminId} AND used_at IS NULL AND expires_at > ${nowIso}`,
  )

  const rowsChanged =
    (updateResult as any).meta?.changes ?? (updateResult as any).changes ?? 0
  return rowsChanged > 0
}

/**
 * Saves binary media to R2 and writes metadata to D1.
 * Implements explicit compensation rollback: if D1 fails after R2 write, the R2 object is deleted.
 */
export async function saveMediaObjectWithCompensation(
  db: Database,
  env: Env,
  params: {
    mimeType: string
    body: ArrayBuffer
    createdBy: string
  },
): Promise<ContentMedia> {
  if (!env.ASSETS) {
    throw createGraphQLError("Cloudflare R2 ASSETS binding is unavailable", "INTERNAL_ERROR")
  }

  const mediaId = crypto.randomUUID()
  const ext = getExtensionForMime(params.mimeType)
  const objectKey = `content/media/${mediaId}.${ext}`
  const now = new Date().toISOString()

  // 1. Put object to R2
  await env.ASSETS.put(objectKey, params.body, {
    httpMetadata: {
      contentType: params.mimeType,
    },
  })

  // 2. Insert metadata to D1 with compensation rollback
  try {
    const insertResult = await db
      .insert(contentMedia)
      .values({
        id: mediaId,
        objectKey,
        mimeType: params.mimeType as MediaMimeType,
        sizeBytes: params.body.byteLength,
        createdBy: params.createdBy,
        createdAt: now,
      })
      .returning()
      .get()

    return insertResult
  } catch (err) {
    // Explicit Compensation Rollback: delete orphaned R2 object
    try {
      await env.ASSETS.delete(objectKey)
    } catch {
      // Ignore cleanup error
    }
    throw err
  }
}

/**
 * Retrieves ContentMedia metadata from D1 by ID.
 */
export async function getContentMediaById(
  db: Database,
  id: string,
): Promise<ContentMedia | null> {
  const record = await db
    .select()
    .from(contentMedia)
    .where(eq(contentMedia.id, id))
    .get()

  return record || null
}

/**
 * Deletes a ContentMedia entity and its backing R2 object.
 * Refuses deletion if media is referenced by any content post as a cover image.
 */
export async function deleteContentMedia(
  db: Database,
  env: Env,
  id: string,
): Promise<boolean> {
  const media = await getContentMediaById(db, id)
  if (!media) {
    throw createGraphQLError("Media not found", "NOT_FOUND")
  }

  // Check if referenced by any content post
  const referencingPost = await db
    .select({ id: contentPosts.id })
    .from(contentPosts)
    .where(eq(contentPosts.coverMediaId, id))
    .limit(1)
    .get()

  if (referencingPost) {
    throw createGraphQLError(
      "Cannot delete media that is currently referenced by a content post as cover image",
      "CONFLICT",
    )
  }

  // Delete from D1
  await db.delete(contentMedia).where(eq(contentMedia.id, id))

  // Delete from R2
  if (env.ASSETS) {
    try {
      await env.ASSETS.delete(media.objectKey)
    } catch {
      // Best-effort R2 deletion
    }
  }

  return true
}
