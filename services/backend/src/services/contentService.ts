/**
 * HiKAT Content Service
 * Implements business logic, validation, pagination, and storage operations for ContentPosts.
 */

import { eq, and, or, lt, desc, sql, inArray } from "drizzle-orm"
import {
  Database,
  contentPosts,
  contentMedia,
  ContentPost,
  ContentMedia,
} from "@hikat/database"
import {
  ALLOWED_CONTENT_KINDS,
  ALLOWED_CONTENT_STATUSES,
  CONTENT_LIMITS,
  ContentPostKind,
  ContentPostStatus,
  normalizeSlug,
  isValidSlug,
  encodeCursor,
  decodeCursor,
} from "@hikat/shared"
import {
  createGraphQLError,
  ContentPostGql,
  ContentFeedConnectionGql,
  ContentPostEdgeGql,
  CreateContentPostInputGql,
  UpdateContentPostInputGql,
} from "@hikat/graphql"
import type { Env } from "../types"
import { formatMediaGql, getContentMediaById } from "./mediaService"

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

async function attachMediaToPosts(
  db: Database,
  env: Env,
  posts: ContentPost[],
  request?: Request,
): Promise<ContentPostGql[]> {
  const mediaIds = Array.from(
    new Set(posts.map((p) => p.coverMediaId).filter((id): id is string => Boolean(id))),
  )

  const mediaMap = new Map<string, ContentMedia>()
  if (mediaIds.length > 0) {
    const mediaRecords = await db
      .select()
      .from(contentMedia)
      .where(inArray(contentMedia.id, mediaIds))
      .all()

    for (const m of mediaRecords) {
      mediaMap.set(m.id, m)
    }
  }

  return posts.map((post) => {
    const media = post.coverMediaId ? mediaMap.get(post.coverMediaId) : undefined
    return {
      id: post.id,
      kind: post.kind as ContentPostKind,
      slug: post.slug,
      title: post.title,
      summary: post.summary,
      bodyMarkdown: post.bodyMarkdown,
      coverMediaId: post.coverMediaId,
      coverMedia: media ? formatMediaGql(media, env, request) : null,
      status: post.status as ContentPostStatus,
      publishedAt: post.publishedAt,
      createdBy: post.createdBy,
      updatedBy: post.updatedBy,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    }
  })
}

/**
 * Public feed of published content posts, ordered deterministically by (publishedAt DESC, id DESC).
 */
export async function getContentFeed(
  db: Database,
  env: Env,
  args: {
    first?: number
    after?: string
    kind?: ContentPostKind
  },
  request?: Request,
): Promise<ContentFeedConnectionGql> {
  const limit = Math.min(
    Math.max(args.first ?? CONTENT_LIMITS.DEFAULT_FEED_LIMIT, 1),
    CONTENT_LIMITS.MAX_FEED_LIMIT,
  )

  let cursorData: PublicFeedCursor | null = null
  if (args.after) {
    cursorData = decodeCursor<PublicFeedCursor>(args.after)
  }

  // Base filters: strictly published
  const conditions = [eq(contentPosts.status, "PUBLISHED")]
  if (args.kind) {
    conditions.push(eq(contentPosts.kind, args.kind))
  }

  if (cursorData && cursorData.publishedAt && cursorData.id) {
    conditions.push(
      or(
        lt(contentPosts.publishedAt, cursorData.publishedAt),
        and(
          eq(contentPosts.publishedAt, cursorData.publishedAt),
          lt(contentPosts.id, cursorData.id),
        ),
      )!,
    )
  }

  const rows = await db
    .select()
    .from(contentPosts)
    .where(and(...conditions))
    .orderBy(desc(contentPosts.publishedAt), desc(contentPosts.id))
    .limit(limit + 1)
    .all()

  const hasNextPage = rows.length > limit
  const pagedRows = rows.slice(0, limit)

  // Total count for current filter
  const countConditions = [eq(contentPosts.status, "PUBLISHED")]
  if (args.kind) {
    countConditions.push(eq(contentPosts.kind, args.kind))
  }
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(contentPosts)
    .where(and(...countConditions))
    .get()

  const totalCount = countResult?.count ?? 0
  const postGqlList = await attachMediaToPosts(db, env, pagedRows, request)

  const edges: ContentPostEdgeGql[] = postGqlList.map((post) => ({
    node: post,
    cursor: encodeCursor<PublicFeedCursor>({
      publishedAt: post.publishedAt || post.createdAt,
      id: post.id,
    }),
  }))

  return {
    edges,
    items: postGqlList,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: Boolean(args.after),
      startCursor: edges[0]?.cursor || null,
      endCursor: edges[edges.length - 1]?.cursor || null,
    },
    totalCount,
  }
}

/**
 * Public lookup for a single published post by unique slug.
 * Returns null if post does not exist or is in DRAFT status.
 */
export async function getContentPostBySlug(
  db: Database,
  env: Env,
  slug: string,
  request?: Request,
): Promise<ContentPostGql | null> {
  const normalized = normalizeSlug(slug)
  const post = await db
    .select()
    .from(contentPosts)
    .where(
      and(
        eq(contentPosts.slug, normalized),
        eq(contentPosts.status, "PUBLISHED"),
      ),
    )
    .get()

  if (!post) {
    return null
  }

  const [formatted] = await attachMediaToPosts(db, env, [post], request)
  return formatted || null
}

/**
 * Administrative feed of content posts (both DRAFT and PUBLISHED),
 * ordered deterministically by (createdAt DESC, id DESC).
 */
export async function getAdminContentPosts(
  db: Database,
  env: Env,
  args: {
    first?: number
    after?: string
    kind?: ContentPostKind
    status?: ContentPostStatus
  },
  request?: Request,
): Promise<ContentFeedConnectionGql> {
  const limit = Math.min(
    Math.max(args.first ?? CONTENT_LIMITS.DEFAULT_FEED_LIMIT, 1),
    CONTENT_LIMITS.MAX_FEED_LIMIT,
  )

  let cursorData: AdminFeedCursor | null = null
  if (args.after) {
    cursorData = decodeCursor<AdminFeedCursor>(args.after)
  }

  const conditions = []
  if (args.kind) {
    conditions.push(eq(contentPosts.kind, args.kind))
  }
  if (args.status) {
    conditions.push(eq(contentPosts.status, args.status))
  }

  if (cursorData && cursorData.createdAt && cursorData.id) {
    conditions.push(
      or(
        lt(contentPosts.createdAt, cursorData.createdAt),
        and(
          eq(contentPosts.createdAt, cursorData.createdAt),
          lt(contentPosts.id, cursorData.id),
        ),
      )!,
    )
  }

  const rows = await db
    .select()
    .from(contentPosts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(contentPosts.createdAt), desc(contentPosts.id))
    .limit(limit + 1)
    .all()

  const hasNextPage = rows.length > limit
  const pagedRows = rows.slice(0, limit)

  // Total count for current filters
  const countConditions = []
  if (args.kind) {
    countConditions.push(eq(contentPosts.kind, args.kind))
  }
  if (args.status) {
    countConditions.push(eq(contentPosts.status, args.status))
  }
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(contentPosts)
    .where(countConditions.length > 0 ? and(...countConditions) : undefined)
    .get()

  const totalCount = countResult?.count ?? 0
  const postGqlList = await attachMediaToPosts(db, env, pagedRows, request)

  const edges: ContentPostEdgeGql[] = postGqlList.map((post) => ({
    node: post,
    cursor: encodeCursor<AdminFeedCursor>({
      createdAt: post.createdAt,
      id: post.id,
    }),
  }))

  return {
    edges,
    items: postGqlList,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: Boolean(args.after),
      startCursor: edges[0]?.cursor || null,
      endCursor: edges[edges.length - 1]?.cursor || null,
    },
    totalCount,
  }
}

/**
 * Administrative lookup of a post by ID or slug (includes drafts).
 */
export async function getAdminContentPost(
  db: Database,
  env: Env,
  args: {
    id?: string
    slug?: string
  },
  request?: Request,
): Promise<ContentPostGql | null> {
  let post: ContentPost | undefined

  if (args.id) {
    post = await db
      .select()
      .from(contentPosts)
      .where(eq(contentPosts.id, args.id))
      .get()
  } else if (args.slug) {
    const normalized = normalizeSlug(args.slug)
    post = await db
      .select()
      .from(contentPosts)
      .where(eq(contentPosts.slug, normalized))
      .get()
  } else {
    throw createGraphQLError(
      "Either id or slug must be provided for post lookup",
      "VALIDATION_ERROR",
    )
  }

  if (!post) {
    return null
  }

  const [formatted] = await attachMediaToPosts(db, env, [post], request)
  return formatted || null
}

/**
 * Creates a new ContentPost.
 */
export async function createContentPost(
  db: Database,
  env: Env,
  adminUserId: string,
  input: CreateContentPostInputGql,
  request?: Request,
): Promise<ContentPostGql> {
  // 1. Validate kind
  if (!ALLOWED_CONTENT_KINDS.includes(input.kind)) {
    throw createGraphQLError(
      `Invalid post kind '${input.kind}'. Allowed kinds: ${ALLOWED_CONTENT_KINDS.join(", ")}`,
      "VALIDATION_ERROR",
    )
  }

  // 2. Validate title
  const title = input.title?.trim()
  if (
    !title ||
    title.length < CONTENT_LIMITS.TITLE_MIN_LENGTH ||
    title.length > CONTENT_LIMITS.TITLE_MAX_LENGTH
  ) {
    throw createGraphQLError(
      `Title must be between ${CONTENT_LIMITS.TITLE_MIN_LENGTH} and ${CONTENT_LIMITS.TITLE_MAX_LENGTH} characters`,
      "VALIDATION_ERROR",
    )
  }

  // 3. Validate summary
  const summary = input.summary?.trim()
  if (
    !summary ||
    summary.length < CONTENT_LIMITS.SUMMARY_MIN_LENGTH ||
    summary.length > CONTENT_LIMITS.SUMMARY_MAX_LENGTH
  ) {
    throw createGraphQLError(
      `Summary must be between ${CONTENT_LIMITS.SUMMARY_MIN_LENGTH} and ${CONTENT_LIMITS.SUMMARY_MAX_LENGTH} characters`,
      "VALIDATION_ERROR",
    )
  }

  // 4. Validate bodyMarkdown
  const bodyMarkdown = input.bodyMarkdown?.trim()
  if (
    !bodyMarkdown ||
    bodyMarkdown.length < CONTENT_LIMITS.BODY_MIN_LENGTH ||
    bodyMarkdown.length > CONTENT_LIMITS.BODY_MAX_LENGTH
  ) {
    throw createGraphQLError(
      `Body markdown must be between ${CONTENT_LIMITS.BODY_MIN_LENGTH} and ${CONTENT_LIMITS.BODY_MAX_LENGTH} characters`,
      "VALIDATION_ERROR",
    )
  }

  // 5. Validate & normalize slug
  const normalizedSlug = normalizeSlug(input.slug || "")
  if (!isValidSlug(normalizedSlug)) {
    throw createGraphQLError(
      `Slug must be a URL-safe lowercase string with hyphens, between ${CONTENT_LIMITS.SLUG_MIN_LENGTH} and ${CONTENT_LIMITS.SLUG_MAX_LENGTH} characters`,
      "VALIDATION_ERROR",
    )
  }

  // 6. Validate status
  const status: ContentPostStatus = input.status || "DRAFT"
  if (!ALLOWED_CONTENT_STATUSES.includes(status)) {
    throw createGraphQLError(
      `Invalid post status '${input.status}'. Allowed statuses: ${ALLOWED_CONTENT_STATUSES.join(", ")}`,
      "VALIDATION_ERROR",
    )
  }

  // 7. Validate coverMediaId if present
  if (input.coverMediaId) {
    const media = await getContentMediaById(db, input.coverMediaId)
    if (!media) {
      throw createGraphQLError("Cover media not found", "VALIDATION_ERROR")
    }
  }

  const postId = crypto.randomUUID()
  const now = new Date().toISOString()
  const publishedAt = status === "PUBLISHED" ? now : null

  try {
    const newPost = await db
      .insert(contentPosts)
      .values({
        id: postId,
        kind: input.kind,
        slug: normalizedSlug,
        title,
        summary,
        bodyMarkdown,
        coverMediaId: input.coverMediaId || null,
        status,
        publishedAt,
        createdBy: adminUserId,
        updatedBy: adminUserId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    const [formatted] = await attachMediaToPosts(db, env, [newPost], request)
    if (!formatted) {
      throw createGraphQLError("Failed to format post", "INTERNAL_ERROR")
    }
    return formatted
  } catch (err: any) {
    if (
      String(err).includes("UNIQUE") ||
      String(err).includes("content_posts.slug") ||
      String(err).includes("slug")
    ) {
      throw createGraphQLError(
        `A post with the slug '${normalizedSlug}' already exists`,
        "CONFLICT",
      )
    }
    throw err
  }
}

/**
 * Updates an existing ContentPost.
 */
export async function updateContentPost(
  db: Database,
  env: Env,
  adminUserId: string,
  id: string,
  input: UpdateContentPostInputGql,
  request?: Request,
): Promise<ContentPostGql> {
  const existing = await db
    .select()
    .from(contentPosts)
    .where(eq(contentPosts.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Post not found", "NOT_FOUND")
  }

  const updates: Partial<typeof contentPosts.$inferInsert> = {
    updatedBy: adminUserId,
    updatedAt: new Date().toISOString(),
  }

  if (input.kind !== undefined && input.kind !== null) {
    if (!ALLOWED_CONTENT_KINDS.includes(input.kind)) {
      throw createGraphQLError(`Invalid post kind '${input.kind}'`, "VALIDATION_ERROR")
    }
    updates.kind = input.kind
  }

  if (input.title !== undefined && input.title !== null) {
    const title = input.title.trim()
    if (
      title.length < CONTENT_LIMITS.TITLE_MIN_LENGTH ||
      title.length > CONTENT_LIMITS.TITLE_MAX_LENGTH
    ) {
      throw createGraphQLError(
        `Title must be between ${CONTENT_LIMITS.TITLE_MIN_LENGTH} and ${CONTENT_LIMITS.TITLE_MAX_LENGTH} characters`,
        "VALIDATION_ERROR",
      )
    }
    updates.title = title
  }

  if (input.summary !== undefined && input.summary !== null) {
    const summary = input.summary.trim()
    if (
      summary.length < CONTENT_LIMITS.SUMMARY_MIN_LENGTH ||
      summary.length > CONTENT_LIMITS.SUMMARY_MAX_LENGTH
    ) {
      throw createGraphQLError(
        `Summary must be between ${CONTENT_LIMITS.SUMMARY_MIN_LENGTH} and ${CONTENT_LIMITS.SUMMARY_MAX_LENGTH} characters`,
        "VALIDATION_ERROR",
      )
    }
    updates.summary = summary
  }

  if (input.bodyMarkdown !== undefined && input.bodyMarkdown !== null) {
    const bodyMarkdown = input.bodyMarkdown.trim()
    if (
      bodyMarkdown.length < CONTENT_LIMITS.BODY_MIN_LENGTH ||
      bodyMarkdown.length > CONTENT_LIMITS.BODY_MAX_LENGTH
    ) {
      throw createGraphQLError(
        `Body markdown must be between ${CONTENT_LIMITS.BODY_MIN_LENGTH} and ${CONTENT_LIMITS.BODY_MAX_LENGTH} characters`,
        "VALIDATION_ERROR",
      )
    }
    updates.bodyMarkdown = bodyMarkdown
  }

  if (input.slug !== undefined && input.slug !== null) {
    const normalizedSlug = normalizeSlug(input.slug)
    if (!isValidSlug(normalizedSlug)) {
      throw createGraphQLError(
        `Slug must be a URL-safe lowercase string with hyphens, between ${CONTENT_LIMITS.SLUG_MIN_LENGTH} and ${CONTENT_LIMITS.SLUG_MAX_LENGTH} characters`,
        "VALIDATION_ERROR",
      )
    }
    updates.slug = normalizedSlug
  }

  if (input.coverMediaId !== undefined) {
    if (input.coverMediaId !== null && input.coverMediaId.trim() !== "") {
      const media = await getContentMediaById(db, input.coverMediaId)
      if (!media) {
        throw createGraphQLError("Cover media not found", "VALIDATION_ERROR")
      }
      updates.coverMediaId = input.coverMediaId
    } else {
      updates.coverMediaId = null
    }
  }

  if (input.status !== undefined && input.status !== null) {
    if (!ALLOWED_CONTENT_STATUSES.includes(input.status)) {
      throw createGraphQLError(`Invalid status '${input.status}'`, "VALIDATION_ERROR")
    }
    updates.status = input.status
    if (input.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
      updates.publishedAt = new Date().toISOString()
    } else if (input.status === "DRAFT") {
      updates.publishedAt = null
    }
  }

  try {
    const updated = await db
      .update(contentPosts)
      .set(updates)
      .where(eq(contentPosts.id, id))
      .returning()
      .get()

    const [formatted] = await attachMediaToPosts(db, env, [updated], request)
    if (!formatted) {
      throw createGraphQLError("Failed to format post", "INTERNAL_ERROR")
    }
    return formatted
  } catch (err: any) {
    if (
      String(err).includes("UNIQUE") ||
      String(err).includes("content_posts.slug") ||
      String(err).includes("slug")
    ) {
      throw createGraphQLError(
        `A post with the slug '${updates.slug || input.slug}' already exists`,
        "CONFLICT",
      )
    }
    throw err
  }
}

/**
 * Publishes a content post: sets status to PUBLISHED and publishedAt to current timestamp.
 */
export async function publishContentPost(
  db: Database,
  env: Env,
  adminUserId: string,
  id: string,
  request?: Request,
): Promise<ContentPostGql> {
  const existing = await db
    .select()
    .from(contentPosts)
    .where(eq(contentPosts.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Post not found", "NOT_FOUND")
  }

  const now = new Date().toISOString()
  const updated = await db
    .update(contentPosts)
    .set({
      status: "PUBLISHED",
      publishedAt: now,
      updatedBy: adminUserId,
      updatedAt: now,
    })
    .where(eq(contentPosts.id, id))
    .returning()
    .get()

  const [formatted] = await attachMediaToPosts(db, env, [updated], request)
  if (!formatted) {
    throw createGraphQLError("Failed to format post", "INTERNAL_ERROR")
  }
  return formatted
}

/**
 * Unpublishes a content post: sets status to DRAFT and resets publishedAt to null.
 */
export async function unpublishContentPost(
  db: Database,
  env: Env,
  adminUserId: string,
  id: string,
  request?: Request,
): Promise<ContentPostGql> {
  const existing = await db
    .select()
    .from(contentPosts)
    .where(eq(contentPosts.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Post not found", "NOT_FOUND")
  }

  const now = new Date().toISOString()
  const updated = await db
    .update(contentPosts)
    .set({
      status: "DRAFT",
      publishedAt: null,
      updatedBy: adminUserId,
      updatedAt: now,
    })
    .where(eq(contentPosts.id, id))
    .returning()
    .get()

  const [formatted] = await attachMediaToPosts(db, env, [updated], request)
  if (!formatted) {
    throw createGraphQLError("Failed to format post", "INTERNAL_ERROR")
  }
  return formatted
}

/**
 * Deletes a content post.
 */
export async function deleteContentPost(
  db: Database,
  id: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: contentPosts.id })
    .from(contentPosts)
    .where(eq(contentPosts.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Post not found", "NOT_FOUND")
  }

  await db.delete(contentPosts).where(eq(contentPosts.id, id))
  return true
}
