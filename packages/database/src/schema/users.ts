import { sqliteTable, text, check } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { ALLOWED_ROLES } from "@hikat/shared"

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    role: text("role", { enum: ALLOWED_ROLES }).notNull().default("PLAYER"),
    displayName: text("display_name"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    check("users_role_check", sql`${table.role} IN ('PLAYER', 'ADMIN')`),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
