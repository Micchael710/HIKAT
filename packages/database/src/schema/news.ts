import {
  sqliteTable,
  text,
  integer,
  check,
  index,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import {
  ALLOWED_NEWS_TYPES,
  ALLOWED_NEWS_STATUSES,
  ALLOWED_MEDIA_MIME_TYPES,
  MEDIA_TYPES,
} from "@hikat/shared"
import { users } from "./users"

export const contentMedia = sqliteTable(
  "content_media",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    mediaType: text("media_type", { enum: MEDIA_TYPES })
      .notNull()
      .default("IMAGE"),
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
      "content_media_media_type_check",
      sql`${table.mediaType} IN ('IMAGE', 'VIDEO')`,
    ),
    check(
      "content_media_mime_type_check",
      sql`${table.mimeType} IN ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm')`,
    ),
    index("content_media_created_by_idx").on(table.createdBy),
  ],
)

export const contentMediaUploadTokens = sqliteTable(
  "content_media_upload_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    mediaType: text("media_type", { enum: MEDIA_TYPES })
      .notNull()
      .default("IMAGE"),
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
    check(
      "content_media_upload_tokens_media_type_check",
      sql`${table.mediaType} IN ('IMAGE', 'VIDEO')`,
    ),
    index("content_media_upload_tokens_token_hash_idx").on(table.tokenHash),
    index("content_media_upload_tokens_created_by_idx").on(table.createdBy),
  ],
)

export const news = sqliteTable(
  "news",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    type: text("type", { enum: ALLOWED_NEWS_TYPES }).notNull(),
    imageMediaId: text("image_media_id").references(() => contentMedia.id, {
      onDelete: "set null",
    }),
    youtubeVideoId: text("youtube_video_id"),
    youtubeUrl: text("youtube_url"),
    videoMediaId: text("video_media_id").references(() => contentMedia.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ALLOWED_NEWS_STATUSES })
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
    check(
      "news_type_check",
      sql`${table.type} IN ('NEWS', 'UPDATE', 'ANNOUNCEMENT', 'MAINTENANCE')`,
    ),
    check("news_status_check", sql`${table.status} IN ('DRAFT', 'PUBLISHED')`),
    index("news_status_published_at_idx").on(table.status, table.publishedAt),
    index("news_type_status_idx").on(table.type, table.status),
    index("news_created_by_idx").on(table.createdBy),
    index("news_updated_by_idx").on(table.updatedBy),
    index("news_image_media_id_idx").on(table.imageMediaId),
    index("news_video_media_id_idx").on(table.videoMediaId),
  ],
)

export type ContentMedia = typeof contentMedia.$inferSelect
export type NewContentMedia = typeof contentMedia.$inferInsert

export type ContentMediaUploadToken = typeof contentMediaUploadTokens.$inferSelect
export type NewContentMediaUploadToken = typeof contentMediaUploadTokens.$inferInsert

export type News = typeof news.$inferSelect
export type NewNews = typeof news.$inferInsert
