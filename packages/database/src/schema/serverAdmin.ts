import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { users } from "./users"
import { sessions } from "./sessions"
import { gameReleases, gameReleaseFiles } from "./game"

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

export const serverTasks = sqliteTable(
  "server_tasks",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    template: text("template").notNull(),
    action: text("action"),
    name: text("name").notNull(),
    frequency: text("frequency").notNull(),
    cronMinute: text("cron_minute").notNull().default("0"),
    cronHour: text("cron_hour").notNull().default("4"),
    cronDayOfWeek: text("cron_day_of_week").notNull().default("*"),
    time: text("time"),
    intervalHours: integer("interval_hours"),
    weekday: integer("weekday"),
    weekdays: text("weekdays"), // JSON string
    command: text("command"),
    delaySeconds: integer("delay_seconds"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    templateVersion: integer("template_version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("server_tasks_schedule_id_idx").on(table.scheduleId)],
)

export const serverManagedContent = sqliteTable(
  "server_managed_content",
  {
    id: text("id").primaryKey(),
    managementSource: text("management_source").notNull(), // 'SERVER_DIRECT' | 'GAME_RELEASE'
    provider: text("provider"), // 'MODRINTH' | 'CURSEFORGE' | null
    projectId: text("project_id"),
    versionId: text("version_id"),
    fileId: text("file_id"),
    contentType: text("content_type").notNull().default("MOD"), // 'MOD' | 'DATA_PACK'
    environment: text("environment"), // 'SERVER' | 'BOTH'
    targetPath: text("target_path").notNull(), // 'mods/filename.jar' | '<world>/datapacks/filename.zip'
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    gameReleaseId: text("game_release_id").references(() => gameReleases.id, {
      onDelete: "set null",
    }),
    gameReleaseFileId: text("game_release_file_id").references(() => gameReleaseFiles.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("server_managed_content_source_idx").on(table.managementSource),
    index("server_managed_content_provider_project_idx").on(table.provider, table.projectId),
    index("server_managed_content_target_path_idx").on(table.targetPath),
    index("server_managed_content_game_release_idx").on(table.gameReleaseId, table.gameReleaseFileId),
  ],
)

export const serverReleaseSyncs = sqliteTable(
  "server_release_syncs",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id")
      .notNull()
      .references(() => gameReleases.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("PENDING"), // 'PENDING' | 'APPLYING' | 'APPLIED' | 'FAILED'
    appliedAt: text("applied_at"),
    details: text("details"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("server_release_syncs_release_id_idx").on(table.releaseId),
    index("server_release_syncs_status_idx").on(table.status),
  ],
)

export type ServerConsoleTicket = typeof serverConsoleTickets.$inferSelect
export type NewServerConsoleTicket = typeof serverConsoleTickets.$inferInsert

export type ServerPowerLock = typeof serverPowerLocks.$inferSelect
export type NewServerPowerLock = typeof serverPowerLocks.$inferInsert

export type ServerCommandRateLimit = typeof serverCommandRateLimits.$inferSelect
export type NewServerCommandRateLimit = typeof serverCommandRateLimits.$inferInsert

export type ServerOperationLock = typeof serverOperationLocks.$inferSelect
export type NewServerOperationLock = typeof serverOperationLocks.$inferInsert

export type ServerTaskRecord = typeof serverTasks.$inferSelect
export type NewServerTaskRecord = typeof serverTasks.$inferInsert

export type ServerManagedContent = typeof serverManagedContent.$inferSelect
export type NewServerManagedContent = typeof serverManagedContent.$inferInsert

export type ServerReleaseSync = typeof serverReleaseSyncs.$inferSelect
export type NewServerReleaseSync = typeof serverReleaseSyncs.$inferInsert

