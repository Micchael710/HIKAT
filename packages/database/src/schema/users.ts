import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ALLOWED_ROLES } from "@hikat/shared"

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ALLOWED_ROLES }).notNull().default("PLAYER"),
  displayName: text("display_name"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
