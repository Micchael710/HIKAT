import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { users } from "./users"

export const LAUNCHER_RELEASE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const
export type LauncherReleaseStatus = (typeof LAUNCHER_RELEASE_STATUSES)[number]

export const launcherReleases = sqliteTable(
  "launcher_releases",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull().unique(),
    status: text("status", { enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] })
      .$type<LauncherReleaseStatus>()
      .notNull()
      .default("DRAFT"),
    filename: text("filename").notNull(),
    objectKey: text("object_key").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha512: text("sha512").notNull(),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    publishedAt: text("published_at"),
  },
  (table) => [
    index("launcher_releases_status_idx").on(table.status),
    index("launcher_releases_filename_idx").on(table.filename),
    index("launcher_releases_created_by_idx").on(table.createdBy),
  ],
)

export const launcherUploadTickets = sqliteTable(
  "launcher_upload_tickets",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    version: text("version").notNull(),
    filename: text("filename").notNull(),
    declaredSizeBytes: integer("declared_size_bytes").notNull(),
    sha512: text("sha512").notNull(),
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
    index("launcher_upload_tickets_created_by_idx").on(table.createdBy),
    index("launcher_upload_tickets_token_hash_idx").on(table.tokenHash),
  ],
)
