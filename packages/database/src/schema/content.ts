import { sqliteTable, text, integer, check, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import {
  ALLOWED_CONTENT_KINDS,
  ALLOWED_CONTENT_STATUSES,
  ALLOWED_MEDIA_MIME_TYPES,
} from "@hikat/shared"
import { users } from "./users"

export const contentMedia = sqliteTable(
  "content_media",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    mimeType: text("mime_type", { enum: ALLOWED_MEDIA_MIME_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    check(
      "content_media_mime_type_check",
      sql`${table.mimeType} IN ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    index("content_media_created_by_idx").on(table.createdBy),
  ],
)

export const contentMediaUploadTokens = sqliteTable(
  "content_media_upload_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expectedMimeType: text("expected_mime_type").notNull(),
    maxSizeBytes: integer("max_size_bytes").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("content_media_upload_tokens_token_hash_idx").on(table.tokenHash),
    index("content_media_upload_tokens_created_by_idx").on(table.createdBy),
  ],
)

export const contentPosts = sqliteTable(
  "content_posts",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ALLOWED_CONTENT_KINDS }).notNull(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    coverMediaId: text("cover_media_id").references(() => contentMedia.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ALLOWED_CONTENT_STATUSES })
      .notNull()
      .default("DRAFT"),
    publishedAt: text("published_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    check("content_posts_kind_check", sql`${table.kind} IN ('NEWS', 'ANNOUNCEMENT')`),
    check("content_posts_status_check", sql`${table.status} IN ('DRAFT', 'PUBLISHED')`),
    uniqueIndex("content_posts_slug_idx").on(table.slug),
    index("content_posts_status_published_at_idx").on(table.status, table.publishedAt),
    index("content_posts_kind_status_idx").on(table.kind, table.status),
    index("content_posts_created_by_idx").on(table.createdBy),
    index("content_posts_cover_media_id_idx").on(table.coverMediaId),
  ],
)

export type ContentMedia = typeof contentMedia.$inferSelect
export type NewContentMedia = typeof contentMedia.$inferInsert

export type ContentMediaUploadToken = typeof contentMediaUploadTokens.$inferSelect
export type NewContentMediaUploadToken = typeof contentMediaUploadTokens.$inferInsert

export type ContentPost = typeof contentPosts.$inferSelect
export type NewContentPost = typeof contentPosts.$inferInsert
