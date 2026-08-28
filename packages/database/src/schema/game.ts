import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { users } from "./users"

export const gameReleases = sqliteTable(
  "game_releases",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull().unique(),
    minecraftVersion: text("minecraft_version").notNull().default("1.21.1"),
    neoForgeVersion: text("neoforge_version").notNull().default("21.1.65"),
    status: text("status").notNull().default("DRAFT"),
    notes: text("notes"),
    publishedAt: text("published_at"),
    createdBy: text("created_by")
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
    index("game_releases_status_idx").on(table.status),
    index("game_releases_published_at_idx").on(table.publishedAt),
    uniqueIndex("game_releases_single_published_idx")
      .on(table.status)
      .where(sql`"status" = 'PUBLISHED'`),
  ],
)

export const gameReleaseFiles = sqliteTable(
  "game_release_files",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id")
      .notNull()
      .references(() => gameReleases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    logicalPath: text("logical_path").notNull(),
    category: text("category").notNull().default("GENERAL"),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    policy: text("policy"),
    isDirectory: integer("is_directory").notNull().default(0),
    objectKey: text("object_key").notNull().default(""),
    sourceProvider: text("source_provider"),
    sourceProjectId: text("source_project_id"),
    sourceVersionId: text("source_version_id"),
    sourceFileId: text("source_file_id"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("game_release_files_release_id_idx").on(table.releaseId),
    index("game_release_files_category_idx").on(table.category),
    index("game_release_files_sha256_idx").on(table.sha256),
    index("game_release_files_source_idx").on(
      table.sourceProvider,
      table.sourceProjectId,
    ),
    uniqueIndex("game_release_files_release_path_idx").on(
      table.releaseId,
      table.logicalPath,
    ),
  ],
)

export const gameFileUploadTokens = sqliteTable(
  "game_file_upload_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    category: text("category").notNull().default("MOD"),
    originalFilename: text("original_filename").notNull(),
    expectedSizeBytes: integer("expected_size_bytes").notNull(),
    sha256: text("sha256"),
    objectKey: text("object_key"),
    uploadedSizeBytes: integer("uploaded_size_bytes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("game_file_upload_tokens_token_hash_idx").on(table.tokenHash),
    index("game_file_upload_tokens_created_by_idx").on(table.createdBy),
  ],
)


export type GameRelease = typeof gameReleases.$inferSelect
export type NewGameRelease = typeof gameReleases.$inferInsert

export type GameReleaseFile = typeof gameReleaseFiles.$inferSelect
export type NewGameReleaseFile = typeof gameReleaseFiles.$inferInsert

export type GameFileUploadToken = typeof gameFileUploadTokens.$inferSelect
export type NewGameFileUploadToken = typeof gameFileUploadTokens.$inferInsert
