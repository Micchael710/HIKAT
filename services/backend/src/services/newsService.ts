/**
 * HiKAT News Service (Shard 04B)
 * Core business logic for official HiKAT news articles, deterministic compound cursor pagination,
 * publication/unpublication lifecycle, image/video type enforcement, and YouTube normalization.
 */

import { eq, and, or, sql } from "drizzle-orm"
import { Database, news, News } from "@hikat/database"
import {
  ALLOWED_NEWS_TYPES,
  ALLOWED_NEWS_STATUSES,
  NEWS_LIMITS,
  NewsType,
  NewsStatus,
  parseAndNormalizeYouTubeUrl,
  encodeCursor,
  decodeCursor,
} from "@hikat/shared"
import { createGraphQLError } from "@hikat/graphql"
import type {
  NewsGql,
  NewsConnectionGql,
  CreateNewsInputGql,
  UpdateNewsInputGql,
} from "@hikat/graphql"
import type { Env } from "../types"
import {
  formatMediaGql,
  getContentMediaById,
  getContentMediaByIds,
} from "./mediaService"

type PublicFeedCursor = {
  publishedAt: string
  id: string
  [key: string]: unknown
}

type AdminFeedCursor = {
  createdAt: string
  id: string
  [key: string]: unknown
}

async function attachMediaToNews(
  db: Database,
  env: Env,
  newsItems: News[],
  request?: Request,
): Promise<NewsGql[]> {
  if (newsItems.length === 0) return []

  const mediaIdsToFetch: string[] = []
  for (const item of newsItems) {
    if (item.imageMediaId) mediaIdsToFetch.push(item.imageMediaId)
    if (item.videoMediaId) mediaIdsToFetch.push(item.videoMediaId)
  }

  const mediaMap = await getContentMediaByIds(db, mediaIdsToFetch)

  return newsItems.map((item) => {
    const imageMedia = item.imageMediaId
      ? mediaMap.get(item.imageMediaId)
      : undefined
    const videoMedia = item.videoMediaId
      ? mediaMap.get(item.videoMediaId)
      : undefined

    return {
      id: item.id,
      title: item.title,
      content: item.content,
      type: item.type as NewsType,
      image: imageMedia ? formatMediaGql(imageMedia, env, request) : null,
      youtubeVideoId: item.youtubeVideoId,
      youtubeUrl: item.youtubeUrl,
      video: videoMedia ? formatMediaGql(videoMedia, env, request) : null,
      status: item.status as NewsStatus,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  })
}

/**
 * Public Feed Query: Retrieves published news articles.
 * Strictly filters out DRAFT articles.
 * Uses deterministic compound cursor pagination (publishedAt DESC, id DESC).
 */
export async function getPublicNewsFeed(
  db: Database,
  env: Env,
  params: {
    first?: number | null
    after?: string | null
    type?: NewsType | null
  },
  request?: Request,
): Promise<NewsConnectionGql> {
  const limit = Math.min(
    Math.max(params.first ?? NEWS_LIMITS.DEFAULT_FEED_LIMIT, 1),
    NEWS_LIMITS.MAX_FEED_LIMIT,
  )

  const conditions = [
    eq(news.status, "PUBLISHED"),
    sql`${news.publishedAt} IS NOT NULL`,
  ]

  if (params.type) {
    conditions.push(eq(news.type, params.type))
  }

  // Handle cursor pagination
  if (params.after) {
    const cursor = decodeCursor<PublicFeedCursor>(params.after)
    if (cursor && cursor.publishedAt && cursor.id) {
      conditions.push(
        or(
          sql`${news.publishedAt} < ${cursor.publishedAt}`,
          and(
            eq(news.publishedAt, cursor.publishedAt),
            sql`${news.id} < ${cursor.id}`,
          ),
        )!,
      )
    }
  }

  const queryConditions = and(...conditions)

  // Fetch limit + 1 to check for hasNextPage
  const rows = await db
    .select()
    .from(news)
    .where(queryConditions)
    .orderBy(sql`${news.publishedAt} DESC`, sql`${news.id} DESC`)
    .limit(limit + 1)
    .all()

  const hasNextPage = rows.length > limit
  const resultRows = hasNextPage ? rows.slice(0, limit) : rows

  // Calculate total count
  const countConditions = [
    eq(news.status, "PUBLISHED"),
    sql`${news.publishedAt} IS NOT NULL`,
  ]
  if (params.type) {
    countConditions.push(eq(news.type, params.type))
  }

  const totalCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(news)
    .where(and(...countConditions))
    .get()

  const totalCount = Number(totalCountResult?.count ?? 0)
  const formattedItems = await attachMediaToNews(db, env, resultRows, request)

  const edges = formattedItems.map((item) => ({
    node: item,
    cursor: encodeCursor<PublicFeedCursor>({
      publishedAt: item.publishedAt || item.createdAt,
      id: item.id,
    }),
  }))

  const endCursor =
    edges.length > 0 ? (edges[edges.length - 1]?.cursor ?? null) : null

  return {
    edges,
    items: formattedItems,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: !!params.after,
      startCursor: edges.length > 0 ? (edges[0]?.cursor ?? null) : null,
      endCursor,
    },
    totalCount,
  }
}

/**
 * Public News Lookup: Retrieves a single published news article by ID.
 * Returns null if not found or if the article is in DRAFT status.
 */
export async function getPublicNewsById(
  db: Database,
  env: Env,
  id: string,
  request?: Request,
): Promise<NewsGql | null> {
  const row = await db
    .select()
    .from(news)
    .where(and(eq(news.id, id), eq(news.status, "PUBLISHED")))
    .get()

  if (!row) {
    return null
  }

  const [formatted] = await attachMediaToNews(db, env, [row], request)
  return formatted || null
}

/**
 * Admin News List: Retrieves news articles with optional type/status filters.
 * Returns both DRAFT and PUBLISHED articles.
 * Uses deterministic cursor pagination (createdAt DESC, id DESC).
 */
export async function getAdminNews(
  db: Database,
  env: Env,
  params: {
    first?: number | null
    after?: string | null
    type?: NewsType | null
    status?: NewsStatus | null
  },
  request?: Request,
): Promise<NewsConnectionGql> {
  const limit = Math.min(
    Math.max(params.first ?? NEWS_LIMITS.DEFAULT_FEED_LIMIT, 1),
    NEWS_LIMITS.MAX_FEED_LIMIT,
  )

  const conditions: any[] = []

  if (params.type) {
    conditions.push(eq(news.type, params.type))
  }

  if (params.status) {
    conditions.push(eq(news.status, params.status))
  }

  if (params.after) {
    const cursor = decodeCursor<AdminFeedCursor>(params.after)
    if (cursor && cursor.createdAt && cursor.id) {
      conditions.push(
        or(
          sql`${news.createdAt} < ${cursor.createdAt}`,
          and(
            eq(news.createdAt, cursor.createdAt),
            sql`${news.id} < ${cursor.id}`,
          ),
        )!,
      )
    }
  }

  const queryConditions = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(news)
    .where(queryConditions)
    .orderBy(sql`${news.createdAt} DESC`, sql`${news.id} DESC`)
    .limit(limit + 1)
    .all()

  const hasNextPage = rows.length > limit
  const resultRows = hasNextPage ? rows.slice(0, limit) : rows

  // Count total items
  const countConditions: any[] = []
  if (params.type) countConditions.push(eq(news.type, params.type))
  if (params.status) countConditions.push(eq(news.status, params.status))

  const countWhere =
    countConditions.length > 0 ? and(...countConditions) : undefined
  const totalCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(news)
    .where(countWhere)
    .get()

  const totalCount = Number(totalCountResult?.count ?? 0)
  const formattedItems = await attachMediaToNews(db, env, resultRows, request)

  const edges = formattedItems.map((item) => ({
    node: item,
    cursor: encodeCursor<AdminFeedCursor>({
      createdAt: item.createdAt,
      id: item.id,
    }),
  }))

  const endCursor =
    edges.length > 0 ? (edges[edges.length - 1]?.cursor ?? null) : null

  return {
    edges,
    items: formattedItems,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: !!params.after,
      startCursor: edges.length > 0 ? (edges[0]?.cursor ?? null) : null,
      endCursor,
    },
    totalCount,
  }
}

/**
 * Admin News Lookup: Retrieves a single news article by ID (drafts included).
 */
export async function getAdminNewsById(
  db: Database,
  env: Env,
  id: string,
  request?: Request,
): Promise<NewsGql | null> {
  const row = await db.select().from(news).where(eq(news.id, id)).get()

  if (!row) {
    return null
  }

  const [formatted] = await attachMediaToNews(db, env, [row], request)
  return formatted || null
}

/**
 * Creates a new news article.
 * Validates inputs, verifies media relationships (image vs video), and normalizes YouTube URL.
 */
export async function createNews(
  db: Database,
  env: Env,
  adminUserId: string,
  input: CreateNewsInputGql,
  request?: Request,
): Promise<NewsGql> {
  const title = input.title?.trim() || ""
  if (
    title.length < NEWS_LIMITS.TITLE_MIN_LENGTH ||
    title.length > NEWS_LIMITS.TITLE_MAX_LENGTH
  ) {
    throw createGraphQLError(
      `Title must be between ${NEWS_LIMITS.TITLE_MIN_LENGTH} and ${NEWS_LIMITS.TITLE_MAX_LENGTH} characters`,
      "VALIDATION_ERROR",
    )
  }

  const content = input.content !== undefined ? input.content.trim() : ""
  if (
    content.length < NEWS_LIMITS.CONTENT_MIN_LENGTH ||
    content.length > NEWS_LIMITS.CONTENT_MAX_LENGTH
  ) {
    throw createGraphQLError(
      `Content must be between ${NEWS_LIMITS.CONTENT_MIN_LENGTH} and ${NEWS_LIMITS.CONTENT_MAX_LENGTH} characters`,
      "VALIDATION_ERROR",
    )
  }

  if (!ALLOWED_NEWS_TYPES.includes(input.type)) {
    throw createGraphQLError(
      `Invalid news type '${input.type}'. Allowed: ${ALLOWED_NEWS_TYPES.join(", ")}`,
      "VALIDATION_ERROR",
    )
  }

  // Validate image media (must exist and be of type IMAGE)
  let imageMediaId: string | null = null
  if (input.imageMediaId && input.imageMediaId.trim() !== "") {
    const imgMedia = await getContentMediaById(db, input.imageMediaId.trim())
    if (!imgMedia) {
      throw createGraphQLError(
        `Image media asset '${input.imageMediaId}' not found`,
        "NOT_FOUND",
      )
    }
    if (imgMedia.mediaType !== "IMAGE") {
      throw createGraphQLError(
        `Media asset '${input.imageMediaId}' is a ${imgMedia.mediaType} and cannot be assigned as an image`,
        "VALIDATION_ERROR",
      )
    }
    imageMediaId = imgMedia.id
  }

  // Validate video media (must exist and be of type VIDEO)
  let videoMediaId: string | null = null
  if (input.videoMediaId && input.videoMediaId.trim() !== "") {
    const vidMedia = await getContentMediaById(db, input.videoMediaId.trim())
    if (!vidMedia) {
      throw createGraphQLError(
        `Video media asset '${input.videoMediaId}' not found`,
        "NOT_FOUND",
      )
    }
    if (vidMedia.mediaType !== "VIDEO") {
      throw createGraphQLError(
        `Media asset '${input.videoMediaId}' is a ${vidMedia.mediaType} and cannot be assigned as a video`,
        "VALIDATION_ERROR",
      )
    }
    videoMediaId = vidMedia.id
  }

  // Validate and normalize YouTube URL
  let youtubeVideoId: string | null = null
  let youtubeUrl: string | null = null
  if (input.youtubeUrl && input.youtubeUrl.trim() !== "") {
    const parsedYt = parseAndNormalizeYouTubeUrl(input.youtubeUrl)
    if (!parsedYt) {
      throw createGraphQLError(
        `Invalid YouTube URL '${input.youtubeUrl}'. Must be a valid youtube.com, youtu.be, or youtube.com/shorts URL`,
        "VALIDATION_ERROR",
      )
    }
    youtubeVideoId = parsedYt.videoId
    youtubeUrl = parsedYt.canonicalUrl
  }

  const status: NewsStatus = input.status || "DRAFT"
  const now = new Date().toISOString()
  const publishedAt = status === "PUBLISHED" ? now : null
  const newId = crypto.randomUUID()

  const newRow = await db
    .insert(news)
    .values({
      id: newId,
      title,
      content,
      type: input.type,
      imageMediaId,
      youtubeVideoId,
      youtubeUrl,
      videoMediaId,
      status,
      publishedAt,
      createdBy: adminUserId,
      updatedBy: adminUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  const [formatted] = await attachMediaToNews(db, env, [newRow], request)
  if (!formatted) {
    throw createGraphQLError("Failed to format news article", "INTERNAL_ERROR")
  }
  return formatted
}

/**
 * Updates an existing news article.
 */
export async function updateNews(
  db: Database,
  env: Env,
  adminUserId: string,
  id: string,
  input: UpdateNewsInputGql,
  request?: Request,
): Promise<NewsGql> {
  const existing = await db.select().from(news).where(eq(news.id, id)).get()
  if (!existing) {
    throw createGraphQLError("News article not found", "NOT_FOUND")
  }

  const updates: Partial<News> = {
    updatedBy: adminUserId,
    updatedAt: new Date().toISOString(),
  }

  if (input.title !== undefined && input.title !== null) {
    const title = input.title.trim()
    if (
      title.length < NEWS_LIMITS.TITLE_MIN_LENGTH ||
      title.length > NEWS_LIMITS.TITLE_MAX_LENGTH
    ) {
      throw createGraphQLError(
        `Title must be between ${NEWS_LIMITS.TITLE_MIN_LENGTH} and ${NEWS_LIMITS.TITLE_MAX_LENGTH} characters`,
        "VALIDATION_ERROR",
      )
    }
    updates.title = title
  }

  if (input.content !== undefined && input.content !== null) {
    const content = input.content.trim()
    if (
      content.length < NEWS_LIMITS.CONTENT_MIN_LENGTH ||
      content.length > NEWS_LIMITS.CONTENT_MAX_LENGTH
    ) {
      throw createGraphQLError(
        `Content must be between ${NEWS_LIMITS.CONTENT_MIN_LENGTH} and ${NEWS_LIMITS.CONTENT_MAX_LENGTH} characters`,
        "VALIDATION_ERROR",
      )
    }
    updates.content = content
  }

  if (input.type !== undefined && input.type !== null) {
    if (!ALLOWED_NEWS_TYPES.includes(input.type)) {
      throw createGraphQLError(
        `Invalid news type '${input.type}'. Allowed: ${ALLOWED_NEWS_TYPES.join(", ")}`,
        "VALIDATION_ERROR",
      )
    }
    updates.type = input.type
  }

  // Handle image update/clearing
  if (input.imageMediaId !== undefined) {
    if (input.imageMediaId === null || input.imageMediaId.trim() === "") {
      updates.imageMediaId = null
    } else {
      const imgMedia = await getContentMediaById(db, input.imageMediaId.trim())
      if (!imgMedia) {
        throw createGraphQLError(
          `Image media asset '${input.imageMediaId}' not found`,
          "NOT_FOUND",
        )
      }
      if (imgMedia.mediaType !== "IMAGE") {
        throw createGraphQLError(
          `Media asset '${input.imageMediaId}' is a ${imgMedia.mediaType} and cannot be assigned as an image`,
          "VALIDATION_ERROR",
        )
      }
      updates.imageMediaId = imgMedia.id
    }
  }

  // Handle video update/clearing
  if (input.videoMediaId !== undefined) {
    if (input.videoMediaId === null || input.videoMediaId.trim() === "") {
      updates.videoMediaId = null
    } else {
      const vidMedia = await getContentMediaById(db, input.videoMediaId.trim())
      if (!vidMedia) {
        throw createGraphQLError(
          `Video media asset '${input.videoMediaId}' not found`,
          "NOT_FOUND",
        )
      }
      if (vidMedia.mediaType !== "VIDEO") {
        throw createGraphQLError(
          `Media asset '${input.videoMediaId}' is a ${vidMedia.mediaType} and cannot be assigned as a video`,
          "VALIDATION_ERROR",
        )
      }
      updates.videoMediaId = vidMedia.id
    }
  }

  // Handle YouTube URL update/clearing
  if (input.youtubeUrl !== undefined) {
    if (input.youtubeUrl === null || input.youtubeUrl.trim() === "") {
      updates.youtubeVideoId = null
      updates.youtubeUrl = null
    } else {
      const parsedYt = parseAndNormalizeYouTubeUrl(input.youtubeUrl)
      if (!parsedYt) {
        throw createGraphQLError(
          `Invalid YouTube URL '${input.youtubeUrl}'. Must be a valid youtube.com, youtu.be, or youtube.com/shorts URL`,
          "VALIDATION_ERROR",
        )
      }
      updates.youtubeVideoId = parsedYt.videoId
      updates.youtubeUrl = parsedYt.canonicalUrl
    }
  }

  // Handle status transition
  if (input.status !== undefined && input.status !== null) {
    updates.status = input.status
    if (input.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
      updates.publishedAt = new Date().toISOString()
    } else if (input.status === "DRAFT") {
      updates.publishedAt = null
    }
  }

  const updatedRow = await db
    .update(news)
    .set(updates)
    .where(eq(news.id, id))
    .returning()
    .get()

  const [formatted] = await attachMediaToNews(db, env, [updatedRow], request)
  if (!formatted) {
    throw createGraphQLError("Failed to format news article", "INTERNAL_ERROR")
  }
  return formatted
}

/**
 * Publishes a news article: sets status to PUBLISHED and publishedAt to current timestamp.
 */
export async function publishNews(
  db: Database,
  env: Env,
  adminUserId: string,
  id: string,
  request?: Request,
): Promise<NewsGql> {
  const existing = await db.select().from(news).where(eq(news.id, id)).get()
  if (!existing) {
    throw createGraphQLError("News article not found", "NOT_FOUND")
  }

  const now = new Date().toISOString()
  const updatedRow = await db
    .update(news)
    .set({
      status: "PUBLISHED",
      publishedAt: now,
      updatedBy: adminUserId,
      updatedAt: now,
    })
    .where(eq(news.id, id))
    .returning()
    .get()

  const [formatted] = await attachMediaToNews(db, env, [updatedRow], request)
  if (!formatted) {
    throw createGraphQLError("Failed to format news article", "INTERNAL_ERROR")
  }
  return formatted
}

/**
 * Unpublishes a news article: sets status to DRAFT and resets publishedAt to null.
 */
export async function unpublishNews(
  db: Database,
  env: Env,
  adminUserId: string,
  id: string,
  request?: Request,
): Promise<NewsGql> {
  const existing = await db.select().from(news).where(eq(news.id, id)).get()
  if (!existing) {
    throw createGraphQLError("News article not found", "NOT_FOUND")
  }

  const now = new Date().toISOString()
  const updatedRow = await db
    .update(news)
    .set({
      status: "DRAFT",
      publishedAt: null,
      updatedBy: adminUserId,
      updatedAt: now,
    })
    .where(eq(news.id, id))
    .returning()
    .get()

  const [formatted] = await attachMediaToNews(db, env, [updatedRow], request)
  if (!formatted) {
    throw createGraphQLError("Failed to format news article", "INTERNAL_ERROR")
  }
  return formatted
}

/**
 * Deletes a news article.
 */
export async function deleteNews(db: Database, id: string): Promise<boolean> {
  const existing = await db.select().from(news).where(eq(news.id, id)).get()
  if (!existing) {
    throw createGraphQLError("News article not found", "NOT_FOUND")
  }

  await db.delete(news).where(eq(news.id, id))
  return true
}
