import { sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core"
import { users } from "./users"

export const passwordCredentials = sqliteTable(
  "password_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: text("email_verified_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("password_credentials_email_idx").on(table.email),
    uniqueIndex("password_credentials_user_id_idx").on(table.userId),
    index("password_credentials_user_id_lookup_idx").on(table.userId),
  ],
)

export type PasswordCredential = typeof passwordCredentials.$inferSelect
export type NewPasswordCredential = typeof passwordCredentials.$inferInsert
