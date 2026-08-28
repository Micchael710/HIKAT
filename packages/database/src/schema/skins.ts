import { sqliteTable, text, index, uniqueIndex, check } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { users } from "./users"
import { contentMedia } from "./content"

export const skins = sqliteTable(
  "skins",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mediaId: text("media_id")
      .notNull()
      .references(() => contentMedia.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("AVAILABLE"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    check("skins_status_check", sql`${table.status} IN ('AVAILABLE', 'UNAVAILABLE')`),
    index("skins_status_idx").on(table.status),
    index("skins_created_by_idx").on(table.createdBy),
    index("skins_media_id_idx").on(table.mediaId),
  ],
)

export const playerSkins = sqliteTable(
  "player_skins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => contentMedia.id, { onDelete: "restrict" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("player_skins_user_id_idx").on(table.userId),
    index("player_skins_media_id_idx").on(table.mediaId),
  ],
)

export const playerSkinSelections = sqliteTable(
  "player_skin_selections",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "CUSTOM" | "GLOBAL"
    skinId: text("skin_id").references(() => skins.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("player_skin_selections_skin_id_idx").on(table.skinId)],
)

export const capes = sqliteTable(
  "capes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mediaId: text("media_id")
      .notNull()
      .references(() => contentMedia.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("AVAILABLE"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    check("capes_status_check", sql`${table.status} IN ('AVAILABLE', 'UNAVAILABLE')`),
    index("capes_status_idx").on(table.status),
    index("capes_created_by_idx").on(table.createdBy),
    index("capes_media_id_idx").on(table.mediaId),
  ],
)

export const playerCapes = sqliteTable(
  "player_capes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mediaId: text("media_id")
      .notNull()
      .references(() => contentMedia.id, { onDelete: "restrict" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("player_capes_user_id_idx").on(table.userId),
    index("player_capes_media_id_idx").on(table.mediaId),
  ],
)

export const playerCapeSelections = sqliteTable(
  "player_cape_selections",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("NONE"), // "NONE" | "CUSTOM" | "GLOBAL"
    capeId: text("cape_id").references(() => capes.id, {
      onDelete: "cascade",
    }),
    playerCapeId: text("player_cape_id").references(() => playerCapes.id, {
      onDelete: "cascade",
    }),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    check(
      "player_cape_selections_type_check",
      sql`(${table.type} = 'NONE' AND ${table.capeId} IS NULL AND ${table.playerCapeId} IS NULL) OR (${table.type} = 'GLOBAL' AND ${table.capeId} IS NOT NULL AND ${table.playerCapeId} IS NULL) OR (${table.type} = 'CUSTOM' AND ${table.capeId} IS NULL AND ${table.playerCapeId} IS NOT NULL)`,
    ),
    index("player_cape_selections_cape_id_idx").on(table.capeId),
    index("player_cape_selections_player_cape_id_idx").on(table.playerCapeId),
  ],
)

export type Skin = typeof skins.$inferSelect
export type NewSkin = typeof skins.$inferInsert
export type PlayerSkin = typeof playerSkins.$inferSelect
export type NewPlayerSkin = typeof playerSkins.$inferInsert
export type PlayerSkinSelection = typeof playerSkinSelections.$inferSelect
export type NewPlayerSkinSelection = typeof playerSkinSelections.$inferInsert

export type Cape = typeof capes.$inferSelect
export type NewCape = typeof capes.$inferInsert
export type PlayerCape = typeof playerCapes.$inferSelect
export type NewPlayerCape = typeof playerCapes.$inferInsert
export type PlayerCapeSelection = typeof playerCapeSelections.$inferSelect
export type NewPlayerCapeSelection = typeof playerCapeSelections.$inferInsert
