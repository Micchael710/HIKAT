import { eq, desc, and, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  SkinGql,
  SkinConnectionGql,
  SkinStatusGql,
  CreateSkinInputGql,
  UpdateSkinInputGql,
} from "@hikat/graphql"
import { encodeCursor, decodeCursor } from "@hikat/shared"
import type { Env } from "../types"
import { deleteMedia } from "./mediaService"

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
    createdAt: skin.createdAt,
    updatedAt: skin.updatedAt,
  }
}

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
      endCursor: edges.length > 0 ? (edges[edges.length - 1]?.cursor ?? null) : null,
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
    throw createGraphQLError("El nombre de la skin es obligatorio.", "VALIDATION_ERROR")
  }

  // Validate media existence
  const media = await db
    .select()
    .from(schema.contentMedia)
    .where(eq(schema.contentMedia.id, input.mediaId))
    .get()

  if (!media) {
    throw createGraphQLError("La textura de skin seleccionada no existe.", "NOT_FOUND")
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
      throw createGraphQLError("El nombre no puede estar vacío.", "VALIDATION_ERROR")
    }
    updates.name = trimmed
  }

  if (input.model !== undefined && input.model !== null) {
    updates.model = input.model === "SLIM" ? "SLIM" : "CLASSIC"
  }

  if (input.status !== undefined && input.status !== null) {
    updates.status = input.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"
  }

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const media = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, input.mediaId))
      .get()
    if (!media) {
      throw createGraphQLError("La textura seleccionada no existe.", "NOT_FOUND")
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

  // 2. Safely check if media is still referenced by any other skin or news
  const otherSkin = await db
    .select({ id: schema.skins.id })
    .from(schema.skins)
    .where(eq(schema.skins.mediaId, mediaId))
    .get()

  const newsImg = await db
    .select({ id: schema.news.id })
    .from(schema.news)
    .where(eq(schema.news.imageMediaId, mediaId))
    .get()

  if (!otherSkin && !newsImg && env.ASSETS) {
    try {
      await deleteMedia(db, env, mediaId)
    } catch {
      // Non-blocking cleanup
    }
  }


  return true
}
