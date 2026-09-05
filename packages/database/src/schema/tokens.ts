import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { users } from "./users"
import { sessions } from "./sessions"

export const emailVerificationTokens = sqliteTable(
  "email_verification_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_token_hash_idx").on(table.tokenHash),
    index("email_verification_tokens_user_id_idx").on(table.userId),
  ],
)

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
  ],
)

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: text("id").primaryKey(), // Internal State token sent to Google/Discord
    clientState: text("client_state"), // Original client state sent by Launcher/Web
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    flowType: text("flow_type").notNull(), // 'LOGIN' | 'LAUNCHER'
    provider: text("provider"), // 'GOOGLE' | 'DISCORD'
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri"),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("oauth_states_user_id_idx").on(table.userId),
    index("oauth_states_session_id_idx").on(table.sessionId),
  ],
)

export const authorizationCodes = sqliteTable(
  "authorization_codes",
  {
    id: text("id").primaryKey(), // HiKAT authorization code
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("authorization_codes_user_id_idx").on(table.userId),
  ],
)

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    resetAt: text("reset_at").notNull(),
  },
)

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert

export type OAuthState = typeof oauthStates.$inferSelect
export type NewOAuthState = typeof oauthStates.$inferInsert

export type AuthorizationCode = typeof authorizationCodes.$inferSelect
export type NewAuthorizationCode = typeof authorizationCodes.$inferInsert

export type RateLimit = typeof rateLimits.$inferSelect
export type NewRateLimit = typeof rateLimits.$inferInsert
