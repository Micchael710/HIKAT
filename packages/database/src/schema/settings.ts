import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { users } from "./users"

export const projectSettings = sqliteTable("project_settings", {
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
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export type ProjectSetting = typeof projectSettings.$inferSelect
export type NewProjectSetting = typeof projectSettings.$inferInsert
