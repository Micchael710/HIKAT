import { eq, desc, and, sql } from "drizzle-orm"

import { Database, schema } from "@hikat/database"

import { createGraphQLError } from "@hikat/graphql"

import type {
  SkinGql,
  SkinConnectionGql,
  SkinStatusGql,
  CreateSkinInputGql,
  UpdateSkinInputGql,
  PlayerSkinGql,
  AdminPlayerSkinGql,
  AdminPlayerSkinConnectionGql,
  SetPlayerSkinInputGql,
  UpdateAdminPlayerSkinInputGql,
  ContentMediaUploadPayloadGql,
} from "@hikat/graphql"

import {
  encodeCursor,
  decodeCursor,
  normalizeIsoDateTime,
  MAX_SKIN_SIZE_BYTES,
} from "@hikat/shared"

import type { Env } from "../types"

import {
  createContentMediaUpload,
  deleteMedia,
  sha256Hex,
} from "./mediaService"

export function formatSkinGql(
  skin: schema.Skin,

  mediaUrl: string,
): SkinGql {
  return {
    id: skin.id,

    name: skin.name,

    model: skin.model as any,

    imageUrl: mediaUrl,

    status: skin.status as any,

    createdAt: normalizeIsoDateTime(skin.createdAt),

    updatedAt: normalizeIsoDateTime(skin.updatedAt),
  }
}

export function formatPlayerSkinGql(
  playerSkin: schema.PlayerSkin,
  mediaUrl: string,
): PlayerSkinGql {
  return {
    id: playerSkin.id,
    userId: playerSkin.userId,
    model: playerSkin.model as any,
    imageUrl: mediaUrl,
    createdAt: normalizeIsoDateTime(playerSkin.createdAt),
    updatedAt: normalizeIsoDateTime(playerSkin.updatedAt),
  }
}


export function formatAdminPlayerSkinGql(
  playerSkin: schema.PlayerSkin,

  userDisplayName: string,

  mediaUrl: string,
): AdminPlayerSkinGql {
  return {
    id: playerSkin.id,

    userId: playerSkin.userId,

    userDisplayName: userDisplayName || "Jugador",

    model: playerSkin.model as any,

    imageUrl: mediaUrl,

    createdAt: normalizeIsoDateTime(playerSkin.createdAt),
    updatedAt: normalizeIsoDateTime(playerSkin.updatedAt),
  }
}

/**
 * Strict Minecraft skin texture dimension validator.
 * Accepts ArrayBuffer or Uint8Array of a PNG image.
 * Reads PNG IHDR chunk (offset 16-24) to extract width and height in Big Endian format.
 * Validates dimensions: either 64x64 (modern standard) or 64x32 (legacy standard).
 */
export function validateMinecraftSkinTexture(buffer: ArrayBuffer | Uint8Array): {
  valid: boolean
  width?: number
  height?: number
  reason?: string
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 24) {
    return { valid: false, reason: "Archivo PNG incompleto o dañado." }
  }

  // PNG magic: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a

  if (!isPng) {
    return { valid: false, reason: "El archivo no es una imagen PNG válida." }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)

  const isClassicOrModern =
    (width === 64 && height === 64) || (width === 64 && height === 32)

  if (!isClassicOrModern) {
    return {
      valid: false,
      width,
      height,
      reason: `Dimensiones de skin inválidas (${width}x${height}). Se requiere PNG de 64x64 o 64x32.`,
    }
  }

  return { valid: true, width, height }
}

// --- Global Skins Management ---


export async function getAdminSkins(
  db: Database,

  env: Env,

  args: {
    first?: number | null

    after?: string | null

    status?: SkinStatusGql | null
  },
): Promise<SkinConnectionGql> {
  const limit = Math.min(Math.max(Number(args.first) || 20, 1), 100)

  const conditions = []

  if (args.status) {
    conditions.push(eq(schema.skins.status, args.status))
  }

  if (args.after) {
    const decoded = decodeCursor(args.after)

    if (decoded?.createdAt && decoded?.id) {
      conditions.push(
        sql`(${schema.skins.createdAt} < ${decoded.createdAt} OR (${schema.skins.createdAt} = ${decoded.createdAt} AND ${schema.skins.id} < ${decoded.id}))`,
      )
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db

    .select()

    .from(schema.skins)

    .where(whereClause)

    .orderBy(desc(schema.skins.createdAt), desc(schema.skins.id))

    .limit(limit + 1)

    .all()

  const hasNextPage = rows.length > limit

  const sliced = hasNextPage ? rows.slice(0, limit) : rows

  const edges = sliced.map((skin) => {
    const mediaUrl = `/media/content/${skin.mediaId}`

    const node = formatSkinGql(skin, mediaUrl)

    return {
      node,

      cursor: encodeCursor({ createdAt: skin.createdAt, id: skin.id }),
    }
  })

  const totalCountResult = await db

    .select({ count: sql<number>`count(*)` })

    .from(schema.skins)

    .where(args.status ? eq(schema.skins.status, args.status) : undefined)

    .get()

  const totalCount = Number(totalCountResult?.count) || 0

  return {
    edges,

    items: edges.map((e) => e.node),

    pageInfo: {
      hasNextPage,

      hasPreviousPage: !!args.after,

      startCursor: edges.length > 0 ? (edges[0]?.cursor ?? null) : null,

      endCursor:
        edges.length > 0 ? (edges[edges.length - 1]?.cursor ?? null) : null,
    },

    totalCount,
  }
}

export async function getPublicSkins(
  db: Database,

  env: Env,

  args: {
    first?: number | null

    after?: string | null
  },
): Promise<SkinConnectionGql> {
  return getAdminSkins(db, env, {
    first: args.first,

    after: args.after,

    status: "AVAILABLE",
  })
}

export async function getSkinById(
  db: Database,

  id: string,
): Promise<SkinGql | null> {
  const skin = await db

    .select()

    .from(schema.skins)

    .where(eq(schema.skins.id, id))

    .get()

  if (!skin) return null

  return formatSkinGql(skin, `/media/content/${skin.mediaId}`)
}

export async function createSkin(
  db: Database,

  input: CreateSkinInputGql,

  userId: string,
): Promise<SkinGql> {
  const name = String(input.name || "").trim()

  if (!name) {
    throw createGraphQLError(
      "El nombre de la skin es obligatorio.",
      "VALIDATION_ERROR",
    )
  }

  const media = await db

    .select()

    .from(schema.contentMedia)

    .where(eq(schema.contentMedia.id, input.mediaId))

    .get()

  if (!media) {
    throw createGraphQLError(
      "La textura de skin seleccionada no existe.",
      "NOT_FOUND",
    )
  }

  if (media.mimeType !== "image/png") {
    throw createGraphQLError(
      "La textura de skin debe ser un archivo PNG.",

      "VALIDATION_ERROR",
    )
  }

  const skinId = crypto.randomUUID()

  const now = new Date().toISOString()

  const model = input.model === "SLIM" ? "SLIM" : "CLASSIC"

  const status = input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"

  await db.insert(schema.skins).values({
    id: skinId,

    name,

    model,

    mediaId: media.id,

    status,

    createdBy: userId,

    createdAt: now,

    updatedAt: now,
  })

  return {
    id: skinId,

    name,

    model,

    imageUrl: `/media/content/${media.id}`,

    status,

    createdAt: now,

    updatedAt: now,
  }
}

export async function updateSkin(
  db: Database,

  id: string,

  input: UpdateSkinInputGql,
): Promise<SkinGql> {
  const existing = await db

    .select()

    .from(schema.skins)

    .where(eq(schema.skins.id, id))

    .get()

  if (!existing) {
    throw createGraphQLError("Skin no encontrada.", "NOT_FOUND")
  }

  const updates: Partial<schema.Skin> = {
    updatedAt: new Date().toISOString(),
  }

  if (input.name !== undefined) {
    const trimmed = String(input.name || "").trim()

    if (!trimmed) {
      throw createGraphQLError(
        "El nombre no puede estar vacío.",
        "VALIDATION_ERROR",
      )
    }

    updates.name = trimmed
  }

  if (input.model !== undefined && input.model !== null) {
    updates.model = input.model === "SLIM" ? "SLIM" : "CLASSIC"
  }

  if (input.status !== undefined && input.status !== null) {
    updates.status =
      input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"
  }

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const media = await db

      .select()

      .from(schema.contentMedia)

      .where(eq(schema.contentMedia.id, input.mediaId))

      .get()

    if (!media) {
      throw createGraphQLError(
        "La textura seleccionada no existe.",
        "NOT_FOUND",
      )
    }

    updates.mediaId = media.id
  }

  await db.update(schema.skins).set(updates).where(eq(schema.skins.id, id))

  const updated = await getSkinById(db, id)

  if (!updated) {
    throw createGraphQLError("Error al actualizar la skin.", "INTERNAL_ERROR")
  }

  return updated
}

export async function deleteSkin(
  db: Database,

  id: string,

  env: Env,
): Promise<boolean> {
  const existing = await db

    .select()

    .from(schema.skins)

    .where(eq(schema.skins.id, id))

    .get()

  if (!existing) {
    throw createGraphQLError("Skin no encontrada.", "NOT_FOUND")
  }

  const mediaId = existing.mediaId

  // 1. Delete skin record first

  await db.delete(schema.skins).where(eq(schema.skins.id, id))

  // 2. Safely check if media is still referenced by any other skin, player skin, or news

  const otherSkin = await db

    .select({ id: schema.skins.id })

    .from(schema.skins)

    .where(eq(schema.skins.mediaId, mediaId))

    .get()

  const playerSkinRef = await db

    .select({ id: schema.playerSkins.id })

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.mediaId, mediaId))

    .get()

  const newsImg = await db

    .select({ id: schema.news.id })

    .from(schema.news)

    .where(eq(schema.news.imageMediaId, mediaId))

    .get()

  if (!otherSkin && !playerSkinRef && !newsImg && env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {
      // Non-blocking cleanup
    }
  }

  return true
}

// --- Player Custom Skins (Shard 06.6) ---

/**
 * Creates a single-use upload ticket for an authenticated player to upload their custom skin PNG.
 */

export async function createPlayerSkinUpload(
  db: Database,

  env: Env,

  userId: string,

  request?: Request,
): Promise<ContentMediaUploadPayloadGql> {
  const rawTokenBytes = new Uint8Array(32)

  crypto.getRandomValues(rawTokenBytes)

  const rawToken = Array.from(rawTokenBytes)

    .map((b) => b.toString(16).padStart(2, "0"))

    .join("")

  const tokenHash = await sha256Hex(rawToken)

  const tokenId = crypto.randomUUID()

  const now = new Date()

  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString()

  await db.insert(schema.contentMediaUploadTokens).values({
    id: tokenId,

    tokenHash,

    mediaType: "IMAGE",

    createdBy: userId,

    expectedMimeType: "image/png",

    maxSizeBytes: MAX_SKIN_SIZE_BYTES,

    expiresAt,

    createdAt: now.toISOString(),
  })

  let uploadUrl = "/media/player-skin/upload"

  if (env.PUBLIC_MEDIA_URL_BASE && env.PUBLIC_MEDIA_URL_BASE.trim() !== "") {
    uploadUrl = `${env.PUBLIC_MEDIA_URL_BASE.replace(/\/$/, "")}/media/player-skin/upload`
  } else if (request) {
    try {
      uploadUrl = `${new URL(request.url).origin}/media/player-skin/upload`
    } catch {
      uploadUrl = "/media/player-skin/upload"
    }
  }

  return {
    uploadUrl,

    uploadToken: rawToken,

    expiresAt,

    maxSizeBytes: MAX_SKIN_SIZE_BYTES,

    expectedMimeType: "image/png",

    allowedMimeTypes: ["image/png"],
  }
}

/**
 * Fetches the currently authenticated player's personal custom skin (or null if none exists).
 */

export async function getMyPlayerSkin(
  db: Database,

  userId: string,
): Promise<PlayerSkinGql | null> {
  const pskin = await db

    .select()

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.userId, userId))

    .get()

  if (!pskin) return null

  return formatPlayerSkinGql(pskin, `/media/content/${pskin.mediaId}`)
}

/**
 * Sets or replaces the currently authenticated player's personal custom skin.
 * If replacing, cleans up the old texture object only after the update succeeds.
 */

export async function setMyPlayerSkin(
  db: Database,

  env: Env,

  input: SetPlayerSkinInputGql,

  userId: string,
): Promise<PlayerSkinGql> {
  const media = await db

    .select()

    .from(schema.contentMedia)

    .where(eq(schema.contentMedia.id, input.mediaId))

    .get()

  if (!media) {
    throw createGraphQLError(
      "La textura de skin seleccionada no existe.",
      "NOT_FOUND",
    )
  }

  if (media.mimeType !== "image/png") {
    throw createGraphQLError(
      "La textura de skin debe ser un archivo PNG.",
      "VALIDATION_ERROR",
    )
  }

  // Security: only allow using texture uploaded by the same user

  if (media.createdBy !== userId) {
    throw createGraphQLError(
      "No tienes permiso para usar esta textura.",
      "FORBIDDEN",
    )
  }

  const model = input.model === "SLIM" ? "SLIM" : "CLASSIC"

  const now = new Date().toISOString()

  const existing = await db

    .select()

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.userId, userId))

    .get()

  if (existing) {
    const oldMediaId = existing.mediaId

    await db

      .update(schema.playerSkins)

      .set({
        mediaId: media.id,

        model,

        updatedAt: now,
      })

      .where(eq(schema.playerSkins.id, existing.id))

    // Clean up old media object if not referenced elsewhere

    if (oldMediaId !== media.id && env.ASSETS) {
      const otherRef = await db

        .select({ id: schema.skins.id })

        .from(schema.skins)

        .where(eq(schema.skins.mediaId, oldMediaId))

        .get()

      const otherPlayerRef = await db

        .select({ id: schema.playerSkins.id })

        .from(schema.playerSkins)

        .where(
          and(
            eq(schema.playerSkins.mediaId, oldMediaId),
            sql`${schema.playerSkins.id} != ${existing.id}`,
          ),
        )

        .get()

      const newsRef = await db

        .select({ id: schema.news.id })

        .from(schema.news)

        .where(eq(schema.news.imageMediaId, oldMediaId))

        .get()

      if (!otherRef && !otherPlayerRef && !newsRef) {
        try {
          await deleteMedia(db, env, oldMediaId)
        } catch {
          // Non-blocking cleanup
        }
      }
    }
  } else {
    const newId = crypto.randomUUID()

    await db.insert(schema.playerSkins).values({
      id: newId,

      userId,

      model,

      mediaId: media.id,

      createdAt: now,

      updatedAt: now,
    })
  }

  const updated = await db

    .select()

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.userId, userId))

    .get()

  return formatPlayerSkinGql(updated!, `/media/content/${media.id}`)
}

/**
 * Deletes the currently authenticated player's personal custom skin.
 */

export async function deleteMyPlayerSkin(
  db: Database,

  env: Env,

  userId: string,
): Promise<boolean> {
  const existing = await db

    .select()

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.userId, userId))

    .get()

  if (!existing) {
    return true
  }

  const mediaId = existing.mediaId

  await db
    .delete(schema.playerSkins)
    .where(eq(schema.playerSkins.id, existing.id))

  // Clean up media if orphaned

  if (env.ASSETS) {
    const skinRef = await db

      .select({ id: schema.skins.id })

      .from(schema.skins)

      .where(eq(schema.skins.mediaId, mediaId))

      .get()

    const otherPlayerRef = await db

      .select({ id: schema.playerSkins.id })

      .from(schema.playerSkins)

      .where(eq(schema.playerSkins.mediaId, mediaId))

      .get()

    const newsRef = await db

      .select({ id: schema.news.id })

      .from(schema.news)

      .where(eq(schema.news.imageMediaId, mediaId))

      .get()

    if (!skinRef && !otherPlayerRef && !newsRef) {
      try {
        await deleteMedia(db, env, mediaId)
      } catch {
        // Non-blocking cleanup
      }
    }
  }

  return true
}

/**
 * Administrative list of all player custom skins with optional search by user displayName.
 */

export async function getAdminPlayerSkins(
  db: Database,

  env: Env,

  args: {
    first?: number | null

    after?: string | null

    search?: string | null
  },
): Promise<AdminPlayerSkinConnectionGql> {
  const limit = Math.min(Math.max(Number(args.first) || 20, 1), 100)

  const conditions = []

  if (args.search && args.search.trim()) {
    const searchPattern = `%${args.search.trim().toLowerCase()}%`

    conditions.push(
      sql`lower(${schema.users.displayName}) LIKE ${searchPattern}`,
    )
  }

  if (args.after) {
    const decoded = decodeCursor(args.after)

    if (decoded?.createdAt && decoded?.id) {
      conditions.push(
        sql`(${schema.playerSkins.createdAt} < ${decoded.createdAt} OR (${schema.playerSkins.createdAt} = ${decoded.createdAt} AND ${schema.playerSkins.id} < ${decoded.id}))`,
      )
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db

    .select({
      id: schema.playerSkins.id,

      userId: schema.playerSkins.userId,

      model: schema.playerSkins.model,

      mediaId: schema.playerSkins.mediaId,

      createdAt: schema.playerSkins.createdAt,

      updatedAt: schema.playerSkins.updatedAt,

      userDisplayName: schema.users.displayName,
    })

    .from(schema.playerSkins)

    .innerJoin(schema.users, eq(schema.playerSkins.userId, schema.users.id))

    .where(whereClause)

    .orderBy(desc(schema.playerSkins.createdAt), desc(schema.playerSkins.id))

    .limit(limit + 1)

    .all()

  const hasNextPage = rows.length > limit

  const sliced = hasNextPage ? rows.slice(0, limit) : rows

  const edges = sliced.map((row) => {
    const mediaUrl = `/media/content/${row.mediaId}`

    const node: AdminPlayerSkinGql = {
      id: row.id,

      userId: row.userId,

      userDisplayName: row.userDisplayName || "Jugador",

      model: row.model as any,

      imageUrl: mediaUrl,

      createdAt: normalizeIsoDateTime(row.createdAt),

      updatedAt: normalizeIsoDateTime(row.updatedAt),
    }

    return {
      node,

      cursor: encodeCursor({
        createdAt: row.createdAt,

        id: row.id,
      }),
    }
  })

  const totalCountResult = await db

    .select({ count: sql<number>`count(*)` })

    .from(schema.playerSkins)

    .innerJoin(schema.users, eq(schema.playerSkins.userId, schema.users.id))

    .where(
      args.search && args.search.trim()
        ? sql`lower(${schema.users.displayName}) LIKE ${`%${args.search.trim().toLowerCase()}%`}`
        : undefined,
    )

    .get()

  const totalCount = Number(totalCountResult?.count) || 0

  return {
    edges,

    items: edges.map((e) => e.node),

    pageInfo: {
      hasNextPage,

      hasPreviousPage: !!args.after,

      startCursor: edges.length > 0 ? (edges[0]?.cursor ?? null) : null,

      endCursor:
        edges.length > 0 ? (edges[edges.length - 1]?.cursor ?? null) : null,
    },

    totalCount,
  }
}

/**
 * Administrative lookup of a player skin by ID.
 */

export async function getAdminPlayerSkinById(
  db: Database,

  id: string,
): Promise<AdminPlayerSkinGql | null> {
  const row = await db

    .select({
      id: schema.playerSkins.id,

      userId: schema.playerSkins.userId,

      model: schema.playerSkins.model,

      mediaId: schema.playerSkins.mediaId,

      createdAt: schema.playerSkins.createdAt,

      updatedAt: schema.playerSkins.updatedAt,

      userDisplayName: schema.users.displayName,
    })

    .from(schema.playerSkins)

    .innerJoin(schema.users, eq(schema.playerSkins.userId, schema.users.id))

    .where(eq(schema.playerSkins.id, id))

    .get()

  if (!row) return null

  return {
    id: row.id,

    userId: row.userId,

    userDisplayName: row.userDisplayName || "Jugador",

    model: row.model as any,

    imageUrl: `/media/content/${row.mediaId}`,

    createdAt: normalizeIsoDateTime(row.createdAt),

    updatedAt: normalizeIsoDateTime(row.updatedAt),
  }
}

/**
 * Updates a player custom skin model or texture from Back Office (ADMIN).
 */

export async function updateAdminPlayerSkin(
  db: Database,

  env: Env,

  id: string,

  input: UpdateAdminPlayerSkinInputGql,
): Promise<AdminPlayerSkinGql> {
  const existing = await db

    .select()

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.id, id))

    .get()

  if (!existing) {
    throw createGraphQLError("Skin de jugador no encontrada.", "NOT_FOUND")
  }

  const updates: Partial<schema.PlayerSkin> = {
    updatedAt: new Date().toISOString(),
  }

  if (input.model !== undefined && input.model !== null) {
    updates.model = input.model === "SLIM" ? "SLIM" : "CLASSIC"
  }

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const media = await db

      .select()

      .from(schema.contentMedia)

      .where(eq(schema.contentMedia.id, input.mediaId))

      .get()

    if (!media) {
      throw createGraphQLError(
        "La textura seleccionada no existe.",
        "NOT_FOUND",
      )
    }

    if (media.mimeType !== "image/png") {
      throw createGraphQLError(
        "La textura debe ser un archivo PNG.",
        "VALIDATION_ERROR",
      )
    }

    const oldMediaId = existing.mediaId

    updates.mediaId = media.id

    // Clean up old media if orphaned

    if (oldMediaId !== media.id && env.ASSETS) {
      const skinRef = await db

        .select({ id: schema.skins.id })

        .from(schema.skins)

        .where(eq(schema.skins.mediaId, oldMediaId))

        .get()

      const otherPlayerRef = await db

        .select({ id: schema.playerSkins.id })

        .from(schema.playerSkins)

        .where(
          and(
            eq(schema.playerSkins.mediaId, oldMediaId),
            sql`${schema.playerSkins.id} != ${id}`,
          ),
        )

        .get()

      const newsRef = await db

        .select({ id: schema.news.id })

        .from(schema.news)

        .where(eq(schema.news.imageMediaId, oldMediaId))

        .get()

      if (!skinRef && !otherPlayerRef && !newsRef) {
        try {
          await deleteMedia(db, env, oldMediaId)
        } catch {
          // Non-blocking cleanup
        }
      }
    }
  }

  await db
    .update(schema.playerSkins)
    .set(updates)
    .where(eq(schema.playerSkins.id, id))

  const updated = await getAdminPlayerSkinById(db, id)

  if (!updated) {
    throw createGraphQLError(
      "Error al actualizar la skin del jugador.",
      "INTERNAL_ERROR",
    )
  }

  return updated
}

/**
 * Deletes a player custom skin from Back Office (ADMIN).
 */

export async function deleteAdminPlayerSkin(
  db: Database,

  env: Env,

  id: string,
): Promise<boolean> {
  const existing = await db

    .select()

    .from(schema.playerSkins)

    .where(eq(schema.playerSkins.id, id))

    .get()

  if (!existing) {
    throw createGraphQLError("Skin de jugador no encontrada.", "NOT_FOUND")
  }

  const mediaId = existing.mediaId

  await db.delete(schema.playerSkins).where(eq(schema.playerSkins.id, id))

  if (env.ASSETS) {
    const skinRef = await db

      .select({ id: schema.skins.id })

      .from(schema.skins)

      .where(eq(schema.skins.mediaId, mediaId))

      .get()

    const otherPlayerRef = await db

      .select({ id: schema.playerSkins.id })

      .from(schema.playerSkins)

      .where(eq(schema.playerSkins.mediaId, mediaId))

      .get()

    const newsRef = await db

      .select({ id: schema.news.id })

      .from(schema.news)

      .where(eq(schema.news.imageMediaId, mediaId))

      .get()

    if (!skinRef && !otherPlayerRef && !newsRef) {
      try {
        await deleteMedia(db, env, mediaId)
      } catch {
        // Non-blocking cleanup
      }
    }
  }

  return true
}
