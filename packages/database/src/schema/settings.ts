import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { users } from "./users"
import { gameReleases } from "./game"

export const projectSettings = sqliteTable(
  "project_settings",
  {
    id: text("id").primaryKey(), // always 'main'
    projectName: text("project_name").notNull().default("HiKAT"),
    maintenanceEnabled: integer("maintenance_enabled").notNull().default(0),
    maintenanceMessage: text("maintenance_message")
      .notNull()
      .default("Servidor en mantenimiento programado. Volvemos pronto."),
    serverIp: text("server_ip").notNull().default("mc.hikat.org"),
    serverPort: integer("server_port").notNull().default(25565),
    discordUrl: text("discord_url"),
    websiteUrl: text("website_url"),
    minRamGb: integer("min_ram_gb").notNull().default(4),
    recommendedRamGb: integer("recommended_ram_gb").notNull().default(8),
    updateDeploymentOrder: text("update_deployment_order")
      .notNull()
      .default("SERVER_FIRST"), // 'SERVER_FIRST' | 'PLAYERS_FIRST'
    launcherActiveReleaseId: text("launcher_active_release_id").references(
      () => gameReleases.id,
      { onDelete: "set null" },
    ),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("project_settings_launcher_active_release_id_idx").on(
      table.launcherActiveReleaseId,
    ),
  ],
)

export type ProjectSetting = typeof projectSettings.$inferSelect
export type NewProjectSetting = typeof projectSettings.$inferInsert

