import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { users } from "./users"

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
  ],
)

export const sessionRefreshTokens = sqliteTable(
  "session_refresh_tokens",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("session_refresh_tokens_session_id_idx").on(table.sessionId),
    uniqueIndex("session_refresh_tokens_token_hash_idx").on(table.tokenHash),
  ],
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export type SessionRefreshToken = typeof sessionRefreshTokens.$inferSelect
export type NewSessionRefreshToken = typeof sessionRefreshTokens.$inferInsert
