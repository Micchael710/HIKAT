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
  ActiveSkinSelectionGql,
  SetActiveSkinInputGql,
} from "@hikat/graphql"
import {
  encodeCursor,
  decodeCursor,
  normalizeIsoDateTime,
  MAX_SKIN_SIZE_BYTES,
  validateMinecraftSkinTexture,
} from "@hikat/shared"
import type { Env } from "../types"
import {
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
    imageUrl: mediaUrl,
    createdAt: normalizeIsoDateTime(playerSkin.createdAt),
    updatedAt: normalizeIsoDateTime(playerSkin.updatedAt),
  }
}

/**
 * Loads a media record, fetches its PNG buffer from R2, and validates standard skin dimensions (64x64 or 64x32) & decodability.
 * HiKAT does NOT infer or store CLASSIC vs SLIM model type.
 */
export async function inspectSkinMedia(
  db: Database,
  env: Env,
  mediaId: string,
): Promise<{ media: schema.ContentMedia }> {
  const media = await db
    .select()
    .from(schema.contentMedia)
    .where(eq(schema.contentMedia.id, mediaId))
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

  if (!env.ASSETS) {
    throw createGraphQLError(
      "El almacenamiento de texturas (ASSETS) no está configurado o disponible.",
      "INTERNAL_ERROR",
    )
  }

  const object = await env.ASSETS.get(media.objectKey)
  if (!object) {
    throw createGraphQLError(
      "El archivo de la textura no fue encontrado en el almacenamiento.",
      "NOT_FOUND",
    )
  }

  const buffer = await object.arrayBuffer()
  const validation = validateMinecraftSkinTexture(buffer)
  if (!validation.valid) {
    throw createGraphQLError(
      validation.error ||
        "Dimensiones de skin inválidas. Se requiere PNG de 64x64 o 64x32.",
      "VALIDATION_ERROR",
    )
  }

  return {
    media,
  }
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
    return {
      node: formatSkinGql(skin, mediaUrl),
      cursor: encodeCursor({
        createdAt: skin.createdAt,
        id: skin.id,
      }),
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
  env: Env,
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

  const { media } = await inspectSkinMedia(db, env, input.mediaId)
  const skinId = crypto.randomUUID()
  const now = new Date().toISOString()
  const status = input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"

  await db.insert(schema.skins).values({
    id: skinId,
    name,
    mediaId: media.id,
    status,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id: skinId,
    name,
    imageUrl: `/media/content/${media.id}`,
    status,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Immediately reconciles player skin selections when a global skin is about to be deleted or marked UNAVAILABLE.
 * MUST be executed BEFORE updating/deleting the global skin in D1.
 */
export async function reconcileSelectionsForGlobalSkin(
  db: Database,
  skinId: string,
): Promise<void> {
  const affectedSelections = await db
    .select()
    .from(schema.playerSkinSelections)
    .where(eq(schema.playerSkinSelections.skinId, skinId))
    .all()

  for (const sel of affectedSelections) {
    const pskin = await db
      .select()
      .from(schema.playerSkins)
      .where(eq(schema.playerSkins.userId, sel.userId))
      .get()

    if (pskin) {
      await db
        .update(schema.playerSkinSelections)
        .set({
          type: "CUSTOM",
          skinId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.playerSkinSelections.userId, sel.userId))
    } else {
      await db
        .delete(schema.playerSkinSelections)
        .where(eq(schema.playerSkinSelections.userId, sel.userId))
    }
  }
}

export async function updateSkin(
  db: Database,
  env: Env,
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

  // 1. Validate name
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

  // 2. Validate media if provided (validates D1, R2, PNG dimensions)
  if (input.mediaId !== undefined && input.mediaId !== null) {
    const { media } = await inspectSkinMedia(db, env, input.mediaId)
    updates.mediaId = media.id
  }

  // 3. Validate status
  let shouldReconcileStatus = false
  if (input.status !== undefined && input.status !== null) {
    const nextStatus =
      input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"
    if (nextStatus === "UNAVAILABLE" && existing.status !== "UNAVAILABLE") {
      shouldReconcileStatus = true
    }
    updates.status = nextStatus
  }

  // 4. All validations passed: reconcile player selections if transitioning to UNAVAILABLE
  if (shouldReconcileStatus) {
    await reconcileSelectionsForGlobalSkin(db, id)
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

  // 1. Safely reconcile affected player_skin_selections BEFORE deleting the skin record
  await reconcileSelectionsForGlobalSkin(db, id)

  // 2. Delete skin record
  await db.delete(schema.skins).where(eq(schema.skins.id, id))

  // 3. Check if media is orphaned
  if (env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {
      // Ignored if media is still in use by other domains
    }
  }

  return true
}

// --- Player Custom Skins ---

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

export async function setMyPlayerSkin(
  db: Database,
  env: Env,
  input: SetPlayerSkinInputGql,
  userId: string,
): Promise<PlayerSkinGql> {
  const { media } = await inspectSkinMedia(db, env, input.mediaId)

  // Security: only allow using texture uploaded by the same user
  if (media.createdBy !== userId) {
    throw createGraphQLError(
      "No tienes permiso para usar esta textura.",
      "FORBIDDEN",
    )
  }

  const now = new Date().toISOString()

  // 1. Inspect existing record before upsert
  const existing = await db
    .select()
    .from(schema.playerSkins)
    .where(eq(schema.playerSkins.userId, userId))
    .get()

  const oldMediaId = existing ? existing.mediaId : null
  const recordId = existing ? existing.id : crypto.randomUUID()

  // 2. Concurrency-safe UPSERT
  await db
    .insert(schema.playerSkins)
    .values({
      id: recordId,
      userId,
      mediaId: media.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.playerSkins.userId,
      set: {
        mediaId: media.id,
        updatedAt: now,
      },
    })

  // 3. Automatically persist this skin as the active CUSTOM skin
  await db
    .insert(schema.playerSkinSelections)
    .values({
      userId,
      type: "CUSTOM",
      skinId: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.playerSkinSelections.userId,
      set: {
        type: "CUSTOM",
        skinId: null,
        updatedAt: now,
      },
    })

  // 4. Safe post-success media cleanup: only clean oldMediaId if differs
  if (oldMediaId && oldMediaId !== media.id && env.ASSETS) {
    try {
      await deleteMedia(db, env, oldMediaId)
    } catch {}
  }

  const updated = await db
    .select()
    .from(schema.playerSkins)
    .where(eq(schema.playerSkins.userId, userId))
    .get()

  return formatPlayerSkinGql(updated!, `/media/content/${media.id}`)
}

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

  // 1. Delete player custom skin record
  await db
    .delete(schema.playerSkins)
    .where(eq(schema.playerSkins.id, existing.id))

  // 2. If active selection was CUSTOM, remove the selection row (fallback to unselected state)
  const currentSelection = await db
    .select()
    .from(schema.playerSkinSelections)
    .where(eq(schema.playerSkinSelections.userId, userId))
    .get()

  if (currentSelection?.type === "CUSTOM") {
    await db
      .delete(schema.playerSkinSelections)
      .where(eq(schema.playerSkinSelections.userId, userId))
  }

  // 3. Clean up media if orphaned
  if (env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {}
  }

  return true
}

// --- Active Skin Domain Queries & Mutations ---

/**
 * Retrieves the currently active skin for the authenticated player.
 */
export async function getMyActiveSkin(
  db: Database,
  env: Env,
  userId: string,
): Promise<ActiveSkinSelectionGql | null> {
  const selection = await db
    .select()
    .from(schema.playerSkinSelections)
    .where(eq(schema.playerSkinSelections.userId, userId))
    .get()

  const pskin = await db
    .select()
    .from(schema.playerSkins)
    .where(eq(schema.playerSkins.userId, userId))
    .get()

  if (selection) {
    if (selection.type === "CUSTOM") {
      if (pskin) {
        const formatted = formatPlayerSkinGql(
          pskin,
          `/media/content/${pskin.mediaId}`,
        )
        return {
          type: "CUSTOM",
          skinId: null,
          skin: null,
          playerSkin: formatted,
          imageUrl: formatted.imageUrl,
          name: "Personalizada",
          updatedAt: normalizeIsoDateTime(selection.updatedAt),
        }
      } else {
        // Player deleted custom skin -> clean up selection and return null
        await db
          .delete(schema.playerSkinSelections)
          .where(eq(schema.playerSkinSelections.userId, userId))
        return null
      }
    } else if (selection.type === "GLOBAL") {
      if (selection.skinId) {
        const globalSkin = await db
          .select()
          .from(schema.skins)
          .where(eq(schema.skins.id, selection.skinId))
          .get()

        if (globalSkin && globalSkin.status === "AVAILABLE") {
          const formatted = formatSkinGql(
            globalSkin,
            `/media/content/${globalSkin.mediaId}`,
          )
          return {
            type: "GLOBAL",
            skinId: globalSkin.id,
            skin: formatted,
            playerSkin: null,
            imageUrl: formatted.imageUrl,
            name: globalSkin.name,
            updatedAt: normalizeIsoDateTime(selection.updatedAt),
          }
        }
      }

      // Global skin was deleted, or skinId is null, or status !== AVAILABLE -> fallback to CUSTOM if exists
      if (pskin) {
        const now = new Date().toISOString()
        await db
          .update(schema.playerSkinSelections)
          .set({
            type: "CUSTOM",
            skinId: null,
            updatedAt: now,
          })
          .where(eq(schema.playerSkinSelections.userId, userId))

        const formatted = formatPlayerSkinGql(
          pskin,
          `/media/content/${pskin.mediaId}`,
        )
        return {
          type: "CUSTOM",
          skinId: null,
          skin: null,
          playerSkin: formatted,
          imageUrl: formatted.imageUrl,
          name: "Personalizada",
          updatedAt: normalizeIsoDateTime(now),
        }
      } else {
        await db
          .delete(schema.playerSkinSelections)
          .where(eq(schema.playerSkinSelections.userId, userId))
        return null
      }
    }
  }

  // No selection row exists
  if (pskin) {
    const formatted = formatPlayerSkinGql(
      pskin,
      `/media/content/${pskin.mediaId}`,
    )
    return {
      type: "CUSTOM",
      skinId: null,
      skin: null,
      playerSkin: formatted,
      imageUrl: formatted.imageUrl,
      name: "Personalizada",
      updatedAt: normalizeIsoDateTime(pskin.updatedAt),
    }
  }

  return null
}

/**
 * Sets the active skin for the authenticated player.
 */
export async function setMyActiveSkin(
  db: Database,
  env: Env,
  userId: string,
  input: SetActiveSkinInputGql,
): Promise<ActiveSkinSelectionGql> {
  const now = new Date().toISOString()

  if (input.type === "CUSTOM") {
    const pskin = await db
      .select()
      .from(schema.playerSkins)
      .where(eq(schema.playerSkins.userId, userId))
      .get()

    if (!pskin) {
      throw createGraphQLError(
        "No tienes una skin personalizada guardada.",
        "VALIDATION_ERROR",
      )
    }

    await db
      .insert(schema.playerSkinSelections)
      .values({
        userId,
        type: "CUSTOM",
        skinId: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.playerSkinSelections.userId,
        set: {
          type: "CUSTOM",
          skinId: null,
          updatedAt: now,
        },
      })

    const formatted = formatPlayerSkinGql(
      pskin,
      `/media/content/${pskin.mediaId}`,
    )
    return {
      type: "CUSTOM",
      skinId: null,
      skin: null,
      playerSkin: formatted,
      imageUrl: formatted.imageUrl,
      name: "Personalizada",
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  if (input.type === "GLOBAL") {
    if (!input.skinId || !input.skinId.trim()) {
      throw createGraphQLError(
        "Debes especificar la skin global que deseas seleccionar.",
        "VALIDATION_ERROR",
      )
    }

    const globalSkin = await db
      .select()
      .from(schema.skins)
      .where(eq(schema.skins.id, input.skinId.trim()))
      .get()

    if (!globalSkin) {
      throw createGraphQLError(
        "La skin global seleccionada no existe.",
        "NOT_FOUND",
      )
    }

    if (globalSkin.status !== "AVAILABLE") {
      throw createGraphQLError(
        "La skin global seleccionada no está disponible.",
        "VALIDATION_ERROR",
      )
    }

    await db
      .insert(schema.playerSkinSelections)
      .values({
        userId,
        type: "GLOBAL",
        skinId: globalSkin.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.playerSkinSelections.userId,
        set: {
          type: "GLOBAL",
          skinId: globalSkin.id,
          updatedAt: now,
        },
      })

    const formatted = formatSkinGql(
      globalSkin,
      `/media/content/${globalSkin.mediaId}`,
    )
    return {
      type: "GLOBAL",
      skinId: globalSkin.id,
      skin: formatted,
      playerSkin: null,
      imageUrl: formatted.imageUrl,
      name: globalSkin.name,
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  throw createGraphQLError("Tipo de skin activa no válido.", "VALIDATION_ERROR")
}

// --- Admin Player Skins ---

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

export async function getAdminPlayerSkinById(
  db: Database,
  id: string,
): Promise<AdminPlayerSkinGql | null> {
  const row = await db
    .select({
      id: schema.playerSkins.id,
      userId: schema.playerSkins.userId,
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
    imageUrl: `/media/content/${row.mediaId}`,
    createdAt: normalizeIsoDateTime(row.createdAt),
    updatedAt: normalizeIsoDateTime(row.updatedAt),
  }
}

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

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const { media } = await inspectSkinMedia(db, env, input.mediaId)
    const oldMediaId = existing.mediaId
    updates.mediaId = media.id

    await db
      .update(schema.playerSkins)
      .set(updates)
      .where(eq(schema.playerSkins.id, id))

    if (oldMediaId !== media.id && env.ASSETS) {
      try {
        await deleteMedia(db, env, oldMediaId)
      } catch {}
    }
  } else {
    await db
      .update(schema.playerSkins)
      .set(updates)
      .where(eq(schema.playerSkins.id, id))
  }

  const updated = await getAdminPlayerSkinById(db, id)
  if (!updated) {
    throw createGraphQLError(
      "Error al actualizar la skin del jugador.",
      "INTERNAL_ERROR",
    )
  }

  return updated
}

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

  // 1. Delete player skin record
  await db.delete(schema.playerSkins).where(eq(schema.playerSkins.id, id))

  // 2. Clean up active selection if it was CUSTOM
  const currentSelection = await db
    .select()
    .from(schema.playerSkinSelections)
    .where(eq(schema.playerSkinSelections.userId, existing.userId))
    .get()

  if (currentSelection?.type === "CUSTOM") {
    await db
      .delete(schema.playerSkinSelections)
      .where(eq(schema.playerSkinSelections.userId, existing.userId))
  }

  // 3. Clean up orphaned media
  if (env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {}
  }

  return true
}
