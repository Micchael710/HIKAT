import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { contentMedia } from "./news"
import type { ServerProvisioningStatus } from "@hikat/shared"

export const servers = sqliteTable(
  "servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    minecraftVersion: text("minecraft_version").notNull().default("1.21.1"),
    modLoader: text("mod_loader")
      .$type<"VANILLA" | "NEOFORGE" | "FORGE" | "FABRIC" | "QUILT">()
      .notNull()
      .default("NEOFORGE"),
    modLoaderVersion: text("mod_loader_version"),
    mainLogoMediaId: text("main_logo_media_id").references(() => contentMedia.id, {
      onDelete: "set null",
    }),
    sidebarLogoMediaId: text("sidebar_logo_media_id").references(() => contentMedia.id, {
      onDelete: "set null",
    }),
    accentColor: text("accent_color"),
    cpu: integer("cpu").notNull().default(200),
    memoryMb: integer("memory_mb").notNull().default(4096),
    diskMb: integer("disk_mb").notNull().default(10240),
    provisioningStatus: text("provisioning_status")
      .$type<ServerProvisioningStatus>()
      .notNull()
      .default("PROVISIONING"),
    pterodactylServerId: text("pterodactyl_server_id"),
    pterodactylIdentifier: text("pterodactyl_identifier"),
    launcherActiveReleaseId: text("launcher_active_release_id"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("servers_name_nocase_idx").on(sql`lower(${table.name})`),
    index("servers_provisioning_status_idx").on(table.provisioningStatus),
    index("servers_launcher_active_release_id_idx").on(table.launcherActiveReleaseId),
  ],
)

export type Server = typeof servers.$inferSelect
export type NewServer = typeof servers.$inferInsert
