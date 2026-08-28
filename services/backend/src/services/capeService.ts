import { eq, desc, and, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  CapeGql,
  CapeConnectionGql,
  CapeStatusGql,
  CreateCapeInputGql,
  UpdateCapeInputGql,
  PlayerCapeGql,
  PlayerCapeConnectionGql,
  AdminPlayerCapeGql,
  AdminPlayerCapeConnectionGql,
  AddPlayerCapeInputGql,
  UpdateAdminPlayerCapeInputGql,
  ContentMediaUploadPayloadGql,
  ActiveCapeSelectionGql,
  SetActiveCapeInputGql,
} from "@hikat/graphql"
import {
  encodeCursor,
  decodeCursor,
  normalizeIsoDateTime,
  MAX_PLAYER_CAPES,
  MAX_CAPE_SIZE_BYTES,
  validateCapeTextureBuffer,
} from "@hikat/shared"
import type { Env } from "../types"
import {
  deleteMedia,
  sha256Hex,
} from "./mediaService"

export function formatCapeGql(
  cape: schema.Cape,
  mediaUrl: string,
): CapeGql {
  return {
    id: cape.id,
    name: cape.name,
    imageUrl: mediaUrl,
    status: cape.status as any,
    createdAt: normalizeIsoDateTime(cape.createdAt),
    updatedAt: normalizeIsoDateTime(cape.updatedAt),
  }
}

export function formatPlayerCapeGql(
  playerCape: schema.PlayerCape,
  mediaUrl: string,
): PlayerCapeGql {
  return {
    id: playerCape.id,
    userId: playerCape.userId,
    name: playerCape.name,
    imageUrl: mediaUrl,
    createdAt: normalizeIsoDateTime(playerCape.createdAt),
    updatedAt: normalizeIsoDateTime(playerCape.updatedAt),
  }
}

export function formatAdminPlayerCapeGql(
  playerCape: schema.PlayerCape,
  userDisplayName: string,
  mediaUrl: string,
): AdminPlayerCapeGql {
  return {
    id: playerCape.id,
    userId: playerCape.userId,
    userDisplayName: userDisplayName || "Jugador",
    name: playerCape.name,
    imageUrl: mediaUrl,
    createdAt: normalizeIsoDateTime(playerCape.createdAt),
    updatedAt: normalizeIsoDateTime(playerCape.updatedAt),
  }
}

/**
 * Loads a media record, fetches its PNG buffer from R2, and validates decodability.
 * Accepts standard and HD dimensions (e.g. 64x32, 128x64, 256x128, 512x256, 46x22, 92x44, etc.).
 * Does NOT enforce 64x32.
 */
export async function inspectCapeMedia(
  db: Database,
  env: Env,
  mediaId: string,
): Promise<{ media: schema.ContentMedia; width: number; height: number }> {
  const media = await db
    .select()
    .from(schema.contentMedia)
    .where(eq(schema.contentMedia.id, mediaId))
    .get()

  if (!media) {
    throw createGraphQLError(
      "La textura de capa seleccionada no existe.",
      "NOT_FOUND",
    )
  }

  if (media.mimeType !== "image/png") {
    throw createGraphQLError(
      "La textura de capa debe ser un archivo PNG.",
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
  const validation = validateCapeTextureBuffer(buffer)
  if (!validation.valid || !validation.width || !validation.height) {
    throw createGraphQLError(
      validation.error || "El archivo no contiene una textura de capa PNG válida.",
      "VALIDATION_ERROR",
    )
  }

  return {
    media,
    width: validation.width,
    height: validation.height,
  }
}

// --- Global Capes (Admin Catalog) ---

export async function getAdminCapes(
  db: Database,
  env: Env,
  args: {
    first?: number | null
    after?: string | null
    status?: CapeStatusGql | null
  },
): Promise<CapeConnectionGql> {
  const limit = Math.min(Math.max(Number(args.first) || 20, 1), 100)
  const conditions = []

  if (args.status) {
    conditions.push(eq(schema.capes.status, args.status))
  }

  if (args.after) {
    const decoded = decodeCursor(args.after)
    if (decoded?.createdAt && decoded?.id) {
      conditions.push(
        sql`(${schema.capes.createdAt} < ${decoded.createdAt} OR (${schema.capes.createdAt} = ${decoded.createdAt} AND ${schema.capes.id} < ${decoded.id}))`,
      )
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(schema.capes)
    .where(whereClause)
    .orderBy(desc(schema.capes.createdAt), desc(schema.capes.id))
    .limit(limit + 1)
    .all()

  const hasNextPage = rows.length > limit
  const sliced = hasNextPage ? rows.slice(0, limit) : rows

  const edges = sliced.map((cape) => {
    const mediaUrl = `/media/content/${cape.mediaId}`
    return {
      node: formatCapeGql(cape, mediaUrl),
      cursor: encodeCursor({
        createdAt: cape.createdAt,
        id: cape.id,
      }),
    }
  })

  const totalCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.capes)
    .where(args.status ? eq(schema.capes.status, args.status) : undefined)
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

export async function getPublicCapes(
  db: Database,
  env: Env,
  args: {
    first?: number | null
    after?: string | null
  },
): Promise<CapeConnectionGql> {
  return getAdminCapes(db, env, {
    first: args.first,
    after: args.after,
    status: "AVAILABLE",
  })
}

export async function getCapeById(
  db: Database,
  id: string,
): Promise<CapeGql | null> {
  const cape = await db
    .select()
    .from(schema.capes)
    .where(eq(schema.capes.id, id))
    .get()

  if (!cape) return null

  return formatCapeGql(cape, `/media/content/${cape.mediaId}`)
}

export async function createCape(
  db: Database,
  env: Env,
  input: CreateCapeInputGql,
  userId: string,
): Promise<CapeGql> {
  const name = String(input.name || "").trim()
  if (!name) {
    throw createGraphQLError(
      "El nombre de la capa es obligatorio.",
      "VALIDATION_ERROR",
    )
  }

  const { media } = await inspectCapeMedia(db, env, input.mediaId)
  const capeId = crypto.randomUUID()
  const now = new Date().toISOString()
  const status = input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"

  await db.insert(schema.capes).values({
    id: capeId,
    name,
    mediaId: media.id,
    status,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id: capeId,
    name,
    imageUrl: `/media/content/${media.id}`,
    status,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Immediately reconciles player cape selections when a global cape is deleted or marked UNAVAILABLE.
 * Resets affected selections to canonical NONE.
 */
export async function reconcileSelectionsForGlobalCape(
  db: Database,
  capeId: string,
): Promise<void> {
  await db
    .update(schema.playerCapeSelections)
    .set({
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.playerCapeSelections.capeId, capeId))
}

export async function updateCape(
  db: Database,
  env: Env,
  id: string,
  input: UpdateCapeInputGql,
): Promise<CapeGql> {
  const existing = await db
    .select()
    .from(schema.capes)
    .where(eq(schema.capes.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Capa no encontrada.", "NOT_FOUND")
  }

  const updates: Partial<schema.Cape> = {
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

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const { media } = await inspectCapeMedia(db, env, input.mediaId)
    updates.mediaId = media.id
  }

  let shouldReconcileStatus = false
  if (input.status !== undefined && input.status !== null) {
    const nextStatus =
      input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"
    if (nextStatus === "UNAVAILABLE" && existing.status !== "UNAVAILABLE") {
      shouldReconcileStatus = true
    }
    updates.status = nextStatus
  }

  if (shouldReconcileStatus) {
    await reconcileSelectionsForGlobalCape(db, id)
  }

  await db.update(schema.capes).set(updates).where(eq(schema.capes.id, id))

  const updated = await getCapeById(db, id)
  if (!updated) {
    throw createGraphQLError("Error al actualizar la capa.", "INTERNAL_ERROR")
  }

  return updated
}

export async function deleteCape(
  db: Database,
  id: string,
  env: Env,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.capes)
    .where(eq(schema.capes.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Capa no encontrada.", "NOT_FOUND")
  }

  const mediaId = existing.mediaId

  // 1. Reconcile affected selections BEFORE deleting
  await reconcileSelectionsForGlobalCape(db, id)

  // 2. Delete cape record
  await db.delete(schema.capes).where(eq(schema.capes.id, id))

  // 3. Clean up orphaned media
  if (env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {}
  }

  return true
}

// --- Player Custom Capes (Multiple Allowed per Player) ---

export async function createPlayerCapeUpload(
  db: Database,
  env: Env,
  userId: string,
  request?: Request,
): Promise<ContentMediaUploadPayloadGql> {
  // Check rate limit / max player capes limit
  const currentCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.playerCapes)
    .where(eq(schema.playerCapes.userId, userId))
    .get()

  const currentCount = Number(currentCountResult?.count) || 0
  if (currentCount >= MAX_PLAYER_CAPES) {
    throw createGraphQLError(
      `Has alcanzado el límite máximo de ${MAX_PLAYER_CAPES} capas personalizadas. Elimina una para subir otra.`,
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
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString()

  await db.insert(schema.contentMediaUploadTokens).values({
    id: tokenId,
    tokenHash,
    mediaType: "IMAGE",
    createdBy: userId,
    expectedMimeType: "image/png",
    maxSizeBytes: MAX_CAPE_SIZE_BYTES,
    expiresAt,
    createdAt: now.toISOString(),
  })

  let uploadUrl = "/media/player-cape/upload"
  if (env.PUBLIC_MEDIA_URL_BASE && env.PUBLIC_MEDIA_URL_BASE.trim() !== "") {
    uploadUrl = `${env.PUBLIC_MEDIA_URL_BASE.replace(/\/$/, "")}/media/player-cape/upload`
  } else if (request) {
    try {
      uploadUrl = `${new URL(request.url).origin}/media/player-cape/upload`
    } catch {
      uploadUrl = "/media/player-cape/upload"
    }
  }

  return {
    uploadUrl,
    uploadToken: rawToken,
    expiresAt,
    maxSizeBytes: MAX_CAPE_SIZE_BYTES,
    expectedMimeType: "image/png",
    allowedMimeTypes: ["image/png"],
  }
}

export async function getMyPlayerCapes(
  db: Database,
  userId: string,
): Promise<PlayerCapeGql[]> {
  const rows = await db
    .select()
    .from(schema.playerCapes)
    .where(eq(schema.playerCapes.userId, userId))
    .orderBy(desc(schema.playerCapes.createdAt))
    .all()

  return rows.map((cape) => formatPlayerCapeGql(cape, `/media/content/${cape.mediaId}`))
}

export async function addMyPlayerCape(
  db: Database,
  env: Env,
  input: AddPlayerCapeInputGql,
  userId: string,
): Promise<PlayerCapeGql> {
  const currentCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.playerCapes)
    .where(eq(schema.playerCapes.userId, userId))
    .get()

  const currentCount = Number(currentCountResult?.count) || 0
  if (currentCount >= MAX_PLAYER_CAPES) {
    throw createGraphQLError(
      `Has alcanzado el límite máximo de ${MAX_PLAYER_CAPES} capas personalizadas.`,
      "VALIDATION_ERROR",
    )
  }

  const name = String(input.name || "").trim() || "Mi Capa"
  const { media } = await inspectCapeMedia(db, env, input.mediaId)

  if (media.createdBy !== userId) {
    throw createGraphQLError(
      "No tienes permiso para usar esta textura.",
      "FORBIDDEN",
    )
  }

  const capeId = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.insert(schema.playerCapes).values({
    id: capeId,
    userId,
    name,
    mediaId: media.id,
    createdAt: now,
    updatedAt: now,
  })

  // Automatically activate the newly added custom cape
  await db
    .insert(schema.playerCapeSelections)
    .values({
      userId,
      type: "CUSTOM",
      capeId: null,
      playerCapeId: capeId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.playerCapeSelections.userId,
      set: {
        type: "CUSTOM",
        capeId: null,
        playerCapeId: capeId,
        updatedAt: now,
      },
    })

  const inserted = await db
    .select()
    .from(schema.playerCapes)
    .where(eq(schema.playerCapes.id, capeId))
    .get()

  return formatPlayerCapeGql(inserted!, `/media/content/${media.id}`)
}

export async function deleteMyPlayerCape(
  db: Database,
  env: Env,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.playerCapes)
    .where(and(eq(schema.playerCapes.id, id), eq(schema.playerCapes.userId, userId)))
    .get()

  if (!existing) {
    return true
  }

  const mediaId = existing.mediaId

  // 1. If currently active selection was this custom cape, reset to canonical NONE
  const currentSelection = await db
    .select()
    .from(schema.playerCapeSelections)
    .where(eq(schema.playerCapeSelections.userId, userId))
    .get()

  if (currentSelection?.type === "CUSTOM" && currentSelection.playerCapeId === id) {
    await db
      .update(schema.playerCapeSelections)
      .set({
        type: "NONE",
        capeId: null,
        playerCapeId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.playerCapeSelections.userId, userId))
  }

  // 2. Delete player cape record
  await db.delete(schema.playerCapes).where(eq(schema.playerCapes.id, id))

  // 3. Clean up media if orphaned
  if (env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {}
  }

  return true
}

// --- Active Cape Domain Queries & Mutations ---

/**
 * Retrieves the currently active cape for the authenticated player.
 * Resolves with canonical type = "NONE" when unselected or when referenced cape was removed.
 */
export async function getMyActiveCape(
  db: Database,
  env: Env,
  userId: string,
): Promise<ActiveCapeSelectionGql> {
  const now = new Date().toISOString()
  const selection = await db
    .select()
    .from(schema.playerCapeSelections)
    .where(eq(schema.playerCapeSelections.userId, userId))
    .get()

  if (!selection || selection.type === "NONE") {
    return {
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      cape: null,
      playerCape: null,
      imageUrl: null,
      name: "Sin capa",
      updatedAt: selection ? normalizeIsoDateTime(selection.updatedAt) : normalizeIsoDateTime(now),
    }
  }

  if (selection.type === "CUSTOM") {
    if (selection.playerCapeId) {
      const pcape = await db
        .select()
        .from(schema.playerCapes)
        .where(
          and(
            eq(schema.playerCapes.id, selection.playerCapeId),
            eq(schema.playerCapes.userId, userId),
          ),
        )
        .get()

      if (pcape) {
        const formatted = formatPlayerCapeGql(
          pcape,
          `/media/content/${pcape.mediaId}`,
        )
        return {
          type: "CUSTOM",
          capeId: null,
          playerCapeId: pcape.id,
          cape: null,
          playerCape: formatted,
          imageUrl: formatted.imageUrl,
          name: pcape.name,
          updatedAt: normalizeIsoDateTime(selection.updatedAt),
        }
      }
    }

    // Player cape was deleted -> reconcile to NONE
    await db
      .update(schema.playerCapeSelections)
      .set({
        type: "NONE",
        capeId: null,
        playerCapeId: null,
        updatedAt: now,
      })
      .where(eq(schema.playerCapeSelections.userId, userId))

    return {
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      cape: null,
      playerCape: null,
      imageUrl: null,
      name: "Sin capa",
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  if (selection.type === "GLOBAL") {
    if (selection.capeId) {
      const globalCape = await db
        .select()
        .from(schema.capes)
        .where(eq(schema.capes.id, selection.capeId))
        .get()

      if (globalCape && globalCape.status === "AVAILABLE") {
        const formatted = formatCapeGql(
          globalCape,
          `/media/content/${globalCape.mediaId}`,
        )
        return {
          type: "GLOBAL",
          capeId: globalCape.id,
          playerCapeId: null,
          cape: formatted,
          playerCape: null,
          imageUrl: formatted.imageUrl,
          name: globalCape.name,
          updatedAt: normalizeIsoDateTime(selection.updatedAt),
        }
      }
    }

    // Global cape was deleted or unavailable -> reconcile to NONE
    await db
      .update(schema.playerCapeSelections)
      .set({
        type: "NONE",
        capeId: null,
        playerCapeId: null,
        updatedAt: now,
      })
      .where(eq(schema.playerCapeSelections.userId, userId))

    return {
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      cape: null,
      playerCape: null,
      imageUrl: null,
      name: "Sin capa",
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  return {
    type: "NONE",
    capeId: null,
    playerCapeId: null,
    cape: null,
    playerCape: null,
    imageUrl: null,
    name: "Sin capa",
    updatedAt: normalizeIsoDateTime(now),
  }
}

/**
 * Sets the active cape for the authenticated player.
 * Strictly maintains valid combinations between type, capeId, and playerCapeId:
 * - type=NONE: capeId=null, playerCapeId=null
 * - type=GLOBAL: capeId!=null, playerCapeId=null
 * - type=CUSTOM: capeId=null, playerCapeId!=null
 */
export async function setMyActiveCape(
  db: Database,
  env: Env,
  userId: string,
  input: SetActiveCapeInputGql,
): Promise<ActiveCapeSelectionGql> {
  const now = new Date().toISOString()

  if (input.type === "NONE") {
    await db
      .insert(schema.playerCapeSelections)
      .values({
        userId,
        type: "NONE",
        capeId: null,
        playerCapeId: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.playerCapeSelections.userId,
        set: {
          type: "NONE",
          capeId: null,
          playerCapeId: null,
          updatedAt: now,
        },
      })

    return {
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      cape: null,
      playerCape: null,
      imageUrl: null,
      name: "Sin capa",
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  if (input.type === "CUSTOM") {
    if (!input.playerCapeId || !input.playerCapeId.trim()) {
      throw createGraphQLError(
        "Debes especificar la capa personalizada que deseas seleccionar.",
        "VALIDATION_ERROR",
      )
    }

    const pcape = await db
      .select()
      .from(schema.playerCapes)
      .where(
        and(
          eq(schema.playerCapes.id, input.playerCapeId.trim()),
          eq(schema.playerCapes.userId, userId),
        ),
      )
      .get()

    if (!pcape) {
      throw createGraphQLError(
        "La capa personalizada seleccionada no existe o no te pertenece.",
        "NOT_FOUND",
      )
    }

    await db
      .insert(schema.playerCapeSelections)
      .values({
        userId,
        type: "CUSTOM",
        capeId: null,
        playerCapeId: pcape.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.playerCapeSelections.userId,
        set: {
          type: "CUSTOM",
          capeId: null,
          playerCapeId: pcape.id,
          updatedAt: now,
        },
      })

    const formatted = formatPlayerCapeGql(
      pcape,
      `/media/content/${pcape.mediaId}`,
    )
    return {
      type: "CUSTOM",
      capeId: null,
      playerCapeId: pcape.id,
      cape: null,
      playerCape: formatted,
      imageUrl: formatted.imageUrl,
      name: pcape.name,
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  if (input.type === "GLOBAL") {
    if (!input.capeId || !input.capeId.trim()) {
      throw createGraphQLError(
        "Debes especificar la capa global que deseas seleccionar.",
        "VALIDATION_ERROR",
      )
    }

    const globalCape = await db
      .select()
      .from(schema.capes)
      .where(eq(schema.capes.id, input.capeId.trim()))
      .get()

    if (!globalCape) {
      throw createGraphQLError(
        "La capa global seleccionada no existe.",
        "NOT_FOUND",
      )
    }

    if (globalCape.status !== "AVAILABLE") {
      throw createGraphQLError(
        "La capa global seleccionada no está disponible.",
        "VALIDATION_ERROR",
      )
    }

    await db
      .insert(schema.playerCapeSelections)
      .values({
        userId,
        type: "GLOBAL",
        capeId: globalCape.id,
        playerCapeId: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.playerCapeSelections.userId,
        set: {
          type: "GLOBAL",
          capeId: globalCape.id,
          playerCapeId: null,
          updatedAt: now,
        },
      })

    const formatted = formatCapeGql(
      globalCape,
      `/media/content/${globalCape.mediaId}`,
    )
    return {
      type: "GLOBAL",
      capeId: globalCape.id,
      playerCapeId: null,
      cape: formatted,
      playerCape: null,
      imageUrl: formatted.imageUrl,
      name: globalCape.name,
      updatedAt: normalizeIsoDateTime(now),
    }
  }

  throw createGraphQLError("Tipo de capa activa no válido.", "VALIDATION_ERROR")
}

// --- Admin Player Capes ---

export async function getAdminPlayerCapes(
  db: Database,
  env: Env,
  args: {
    first?: number | null
    after?: string | null
    search?: string | null
  },
): Promise<AdminPlayerCapeConnectionGql> {
  const limit = Math.min(Math.max(Number(args.first) || 20, 1), 100)
  const conditions = []

  if (args.search && args.search.trim()) {
    const searchPattern = `%${args.search.trim().toLowerCase()}%`
    conditions.push(
      sql`lower(${schema.users.displayName}) LIKE ${searchPattern} OR lower(${schema.playerCapes.name}) LIKE ${searchPattern}`,
    )
  }

  if (args.after) {
    const decoded = decodeCursor(args.after)
    if (decoded?.createdAt && decoded?.id) {
      conditions.push(
        sql`(${schema.playerCapes.createdAt} < ${decoded.createdAt} OR (${schema.playerCapes.createdAt} = ${decoded.createdAt} AND ${schema.playerCapes.id} < ${decoded.id}))`,
      )
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: schema.playerCapes.id,
      userId: schema.playerCapes.userId,
      name: schema.playerCapes.name,
      mediaId: schema.playerCapes.mediaId,
      createdAt: schema.playerCapes.createdAt,
      updatedAt: schema.playerCapes.updatedAt,
      userDisplayName: schema.users.displayName,
    })
    .from(schema.playerCapes)
    .innerJoin(schema.users, eq(schema.playerCapes.userId, schema.users.id))
    .where(whereClause)
    .orderBy(desc(schema.playerCapes.createdAt), desc(schema.playerCapes.id))
    .limit(limit + 1)
    .all()

  const hasNextPage = rows.length > limit
  const sliced = hasNextPage ? rows.slice(0, limit) : rows

  const edges = sliced.map((row) => {
    const mediaUrl = `/media/content/${row.mediaId}`
    const node: AdminPlayerCapeGql = {
      id: row.id,
      userId: row.userId,
      userDisplayName: row.userDisplayName || "Jugador",
      name: row.name,
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
    .from(schema.playerCapes)
    .innerJoin(schema.users, eq(schema.playerCapes.userId, schema.users.id))
    .where(
      args.search && args.search.trim()
        ? sql`lower(${schema.users.displayName}) LIKE ${`%${args.search.trim().toLowerCase()}%`} OR lower(${schema.playerCapes.name}) LIKE ${`%${args.search.trim().toLowerCase()}%`}`
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

export async function getAdminPlayerCapeById(
  db: Database,
  id: string,
): Promise<AdminPlayerCapeGql | null> {
  const row = await db
    .select({
      id: schema.playerCapes.id,
      userId: schema.playerCapes.userId,
      name: schema.playerCapes.name,
      mediaId: schema.playerCapes.mediaId,
      createdAt: schema.playerCapes.createdAt,
      updatedAt: schema.playerCapes.updatedAt,
      userDisplayName: schema.users.displayName,
    })
    .from(schema.playerCapes)
    .innerJoin(schema.users, eq(schema.playerCapes.userId, schema.users.id))
    .where(eq(schema.playerCapes.id, id))
    .get()

  if (!row) return null

  return {
    id: row.id,
    userId: row.userId,
    userDisplayName: row.userDisplayName || "Jugador",
    name: row.name,
    imageUrl: `/media/content/${row.mediaId}`,
    createdAt: normalizeIsoDateTime(row.createdAt),
    updatedAt: normalizeIsoDateTime(row.updatedAt),
  }
}

export async function updateAdminPlayerCape(
  db: Database,
  env: Env,
  id: string,
  input: UpdateAdminPlayerCapeInputGql,
): Promise<AdminPlayerCapeGql> {
  const existing = await db
    .select()
    .from(schema.playerCapes)
    .where(eq(schema.playerCapes.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Capa de jugador no encontrada.", "NOT_FOUND")
  }

  const updates: Partial<schema.PlayerCape> = {
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

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const { media } = await inspectCapeMedia(db, env, input.mediaId)
    const oldMediaId = existing.mediaId
    updates.mediaId = media.id

    await db
      .update(schema.playerCapes)
      .set(updates)
      .where(eq(schema.playerCapes.id, id))

    if (oldMediaId !== media.id && env.ASSETS) {
      try {
        await deleteMedia(db, env, oldMediaId)
      } catch {}
    }
  } else {
    await db
      .update(schema.playerCapes)
      .set(updates)
      .where(eq(schema.playerCapes.id, id))
  }

  const updated = await getAdminPlayerCapeById(db, id)
  if (!updated) {
    throw createGraphQLError(
      "Error al actualizar la capa del jugador.",
      "INTERNAL_ERROR",
    )
  }

  return updated
}

export async function deleteAdminPlayerCape(
  db: Database,
  env: Env,
  id: string,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.playerCapes)
    .where(eq(schema.playerCapes.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Capa de jugador no encontrada.", "NOT_FOUND")
  }

  const mediaId = existing.mediaId

  // 1. If currently active selection was this custom cape, reset to canonical NONE
  const currentSelection = await db
    .select()
    .from(schema.playerCapeSelections)
    .where(eq(schema.playerCapeSelections.userId, existing.userId))
    .get()

  if (currentSelection?.type === "CUSTOM" && currentSelection.playerCapeId === id) {
    await db
      .update(schema.playerCapeSelections)
      .set({
        type: "NONE",
        capeId: null,
        playerCapeId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.playerCapeSelections.userId, existing.userId))
  }

  // 2. Delete player cape record
  await db.delete(schema.playerCapes).where(eq(schema.playerCapes.id, id))

  // 3. Clean up orphaned media
  if (env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {}
  }

  return true
}
