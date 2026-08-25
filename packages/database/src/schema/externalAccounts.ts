import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ALLOWED_AUTH_PROVIDERS } from "@hikat/shared"
import { users } from "./users"

export const externalAccounts = sqliteTable(
  "external_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ALLOWED_AUTH_PROVIDERS }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("external_accounts_provider_subject_idx").on(
      table.provider,
      table.providerSubject,
    ),
    index("external_accounts_user_id_idx").on(table.userId),
  ],
)

export type ExternalAccount = typeof externalAccounts.$inferSelect
export type NewExternalAccount = typeof externalAccounts.$inferInsert
