import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { users } from "./users"
import { sessions } from "./sessions"

export const serverConsoleTickets = sqliteTable(
  "server_console_tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("server_console_tickets_user_id_idx").on(table.userId),
    index("server_console_tickets_session_id_idx").on(table.sessionId),
    index("server_console_tickets_expires_at_idx").on(table.expiresAt),
  ],
)

export const serverPowerLocks = sqliteTable(
  "server_power_locks",
  {
    lockKey: text("lock_key").primaryKey(),
    action: text("action").notNull(),
    acquiredByUserId: text("acquired_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acquiredAt: text("acquired_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").notNull(),
  },
)

export const serverCommandRateLimits = sqliteTable(
  "server_command_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    windowStart: text("window_start").notNull(),
    resetAt: text("reset_at").notNull(),
  },
)

export const serverOperationLocks = sqliteTable(
  "server_operation_locks",
  {
    lockKey: text("lock_key").primaryKey(),
    operation: text("operation").notNull(),
    acquiredByUserId: text("acquired_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acquiredAt: text("acquired_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").notNull(),
  },
)

export type ServerConsoleTicket = typeof serverConsoleTickets.$inferSelect
export type NewServerConsoleTicket = typeof serverConsoleTickets.$inferInsert

export type ServerPowerLock = typeof serverPowerLocks.$inferSelect
export type NewServerPowerLock = typeof serverPowerLocks.$inferInsert

export type ServerCommandRateLimit = typeof serverCommandRateLimits.$inferSelect
export type NewServerCommandRateLimit = typeof serverCommandRateLimits.$inferInsert

export type ServerOperationLock = typeof serverOperationLocks.$inferSelect
export type NewServerOperationLock = typeof serverOperationLocks.$inferInsert

