import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"

import { users } from "./users"

import { contentMedia } from "./content"

export const skins = sqliteTable(
  "skins",

  {
    id: text("id").primaryKey(),

    name: text("name").notNull(),

    model: text("model").notNull().default("CLASSIC"),

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

    model: text("model").notNull().default("CLASSIC"),

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

export type Skin = typeof skins.$inferSelect
export type NewSkin = typeof skins.$inferInsert
export type PlayerSkin = typeof playerSkins.$inferSelect
export type NewPlayerSkin = typeof playerSkins.$inferInsert
export type PlayerSkinSelection = typeof playerSkinSelections.$inferSelect
export type NewPlayerSkinSelection = typeof playerSkinSelections.$inferInsert
