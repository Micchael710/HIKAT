/**
 * HiKAT Media Storage & Asset Management Service (Shard 04B)
 * Dedicated media ticket generation, MIME & size limit enforcement (IMAGE vs VIDEO),
 * Cloudflare R2 binary storage with explicit compensation rollback, and metadata records.
 */

import { eq, sql, inArray } from "drizzle-orm"
import {
  Database,
  contentMedia,
  contentMediaUploadTokens,
  news,
  skins,
  playerSkins,
  capes,
  playerCapes,
  ContentMedia,
} from "@hikat/database"

import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_MEDIA_SIZE_BYTES,
  MEDIA_UPLOAD_TOKEN_EXPIRATION_SECONDS,
  MediaType,
  MediaMimeType,
  getMediaTypeFromMime,
} from "@hikat/shared"
import { createGraphQLError } from "@hikat/graphql"
import type {
  ContentMediaGql,
  ContentMediaUploadPayloadGql,
  CreateContentMediaUploadInputGql,
} from "@hikat/graphql"
import type { Env } from "../types"

export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

function getExtensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
  }
  return map[mimeType.toLowerCase()] || "bin"
}

export function formatMediaGql(
  media: ContentMedia,
  env: Env,
  request?: Request,
): ContentMediaGql {
  let baseUrl = ""
  if (env.PUBLIC_MEDIA_URL_BASE && env.PUBLIC_MEDIA_URL_BASE.trim() !== "") {
    baseUrl = env.PUBLIC_MEDIA_URL_BASE.replace(/\/$/, "")
  } else if (request) {
    try {
      baseUrl = new URL(request.url).origin
    } catch {
      baseUrl = ""
    }
  }

  const url = `${baseUrl}/media/content/${media.id}`

  return {
    id: media.id,
    mediaType: media.mediaType as MediaType,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    url,
    createdAt: media.createdAt,
  }
}

export async function getContentMediaById(
  db: Database,
  id: string,
): Promise<ContentMedia | undefined> {
  return await db
    .select()
    .from(contentMedia)
    .where(eq(contentMedia.id, id))
    .get()
}

export async function getContentMediaByIds(
  db: Database,
  ids: string[],
): Promise<Map<string, ContentMedia>> {
  const map = new Map<string, ContentMedia>()
  if (ids.length === 0) return map

  const rows = await db
    .select()
    .from(contentMedia)
    .where(inArray(contentMedia.id, ids))
    .all()

  for (const row of rows) {
    map.set(row.id, row)
  }
  return map
}

/**
 * Creates a single-use upload ticket for binary media (images or videos).
 */
export async function createContentMediaUpload(
  db: Database,
  env: Env,
  adminUserId: string,
  input: CreateContentMediaUploadInputGql,
  request?: Request,
): Promise<ContentMediaUploadPayloadGql> {
  const normalizedMime = input.mimeType.toLowerCase().trim()
  if (!ALLOWED_MEDIA_MIME_TYPES.includes(normalizedMime as MediaMimeType)) {
    throw createGraphQLError(
      `Unsupported MIME type '${input.mimeType}'. Allowed: ${ALLOWED_MEDIA_MIME_TYPES.join(", ")}`,
      "VALIDATION_ERROR",
    )
  }

  const mediaType = getMediaTypeFromMime(normalizedMime)
  if (!mediaType) {
    throw createGraphQLError(
      `Invalid MIME type '${input.mimeType}'`,
      "VALIDATION_ERROR",
    )
  }

  const maxTypeLimit =
    mediaType === "VIDEO" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES

  if (input.sizeBytes <= 0) {
    throw createGraphQLError(
      "Media size must be greater than 0",
      "VALIDATION_ERROR",
    )
  }

  if (input.sizeBytes > maxTypeLimit) {
    throw createGraphQLError(
      `Requested size (${input.sizeBytes} bytes) exceeds maximum limit for ${mediaType} (${maxTypeLimit} bytes)`,
      "VALIDATION_ERROR",
    )
  }

  const rawTokenBytes = new Uint8Array(32)
  crypto.getRandomValues(rawTokenBytes)
  const rawToken = Array.from(rawTokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const tokenHash = await sha256Hex(rawToken)
  const tokenId = crypto.randomUUID()
  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + MEDIA_UPLOAD_TOKEN_EXPIRATION_SECONDS * 1000,
  ).toISOString()

  await db.insert(contentMediaUploadTokens).values({
    id: tokenId,
    tokenHash,
    mediaType,
    createdBy: adminUserId,
    expectedMimeType: normalizedMime,
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
    expectedMimeType: normalizedMime,
    allowedMimeTypes: [...ALLOWED_MEDIA_MIME_TYPES],
  }
}

export interface ValidatedUploadToken {
  id: string
  tokenHash: string
  mediaType: MediaType
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
    mediaType: tokenRecord.mediaType as MediaType,
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
    mediaType: MediaType
    body: ArrayBuffer
    createdBy: string
  },
): Promise<ContentMedia> {
  if (!env.ASSETS) {
    throw createGraphQLError(
      "Cloudflare R2 ASSETS binding is unavailable",
      "INTERNAL_ERROR",
    )
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
        mediaType: params.mediaType,
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
      // Ignore secondary deletion failure in rollback handler
    }
    throw err
  }
}

/**
 * Deletes a media asset from D1 and R2.
 * Rejects deletion with CONFLICT if the media is referenced by any news article as image OR video.
 */
export async function deleteMedia(
  db: Database,
  env: Env,
  mediaId: string,
): Promise<boolean> {
  const existing = await getContentMediaById(db, mediaId)
  if (!existing) {
    throw createGraphQLError("Media asset not found", "NOT_FOUND")
  }

  // Check if referenced by any news article as image or video
  const referencingArticle = await db
    .select({ id: news.id, title: news.title })
    .from(news)
    .where(
      sql`${news.imageMediaId} = ${mediaId} OR ${news.videoMediaId} = ${mediaId}`,
    )
    .get()

  if (referencingArticle) {
    throw createGraphQLError(
      `Cannot delete media asset because it is currently in use by news article '${referencingArticle.title}' (${referencingArticle.id})`,
      "CONFLICT",
    )
  }

  // Check if referenced by any global skin
  const referencingSkin = await db
    .select({ id: skins.id, name: skins.name })
    .from(skins)
    .where(eq(skins.mediaId, mediaId))
    .get()

  if (referencingSkin) {
    throw createGraphQLError(
      `Cannot delete media asset because it is currently in use by skin '${referencingSkin.name}' (${referencingSkin.id})`,
      "CONFLICT",
    )
  }

  // Check if referenced by any player custom skin
  const referencingPlayerSkin = await db
    .select({ id: playerSkins.id })
    .from(playerSkins)
    .where(eq(playerSkins.mediaId, mediaId))
    .get()

  if (referencingPlayerSkin) {
    throw createGraphQLError(
      "Cannot delete media asset because it is currently in use by a player custom skin",
      "CONFLICT",
    )
  }

  // Check if referenced by any global cape
  const referencingCape = await db
    .select({ id: capes.id, name: capes.name })
    .from(capes)
    .where(eq(capes.mediaId, mediaId))
    .get()

  if (referencingCape) {
    throw createGraphQLError(
      `Cannot delete media asset because it is currently in use by cape '${referencingCape.name}' (${referencingCape.id})`,
      "CONFLICT",
    )
  }

  // Check if referenced by any player custom cape
  const referencingPlayerCape = await db
    .select({ id: playerCapes.id, name: playerCapes.name })
    .from(playerCapes)
    .where(eq(playerCapes.mediaId, mediaId))
    .get()

  if (referencingPlayerCape) {
    throw createGraphQLError(
      `Cannot delete media asset because it is currently in use by player cape '${referencingPlayerCape.name}' (${referencingPlayerCape.id})`,
      "CONFLICT",
    )
  }

  // Delete from D1
  await db.delete(contentMedia).where(eq(contentMedia.id, mediaId))

  // Delete from R2
  if (env.ASSETS) {
    try {
      await env.ASSETS.delete(existing.objectKey)
    } catch {
      // Continue even if R2 delete fails
    }
  }

  return true
}
