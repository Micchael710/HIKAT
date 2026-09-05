/**
 * HiKAT Core Authentication Service
 */

import { eq, and, ne, sql, isNull } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import {
  AppRole,
  AuthErrorCode,
  AuthMethodSummary,
  ExternalAuthProvider,
} from "@hikat/shared"
import { hashPassword, verifyPassword } from "../crypto/password"
import { generateSecureToken, hashToken } from "../crypto/tokens"
import { JwtKeyManager, signGameToken } from "../crypto/jwt"
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  validateActiveSession,
  AuthSessionResult,
} from "./session"
import { EmailService, sanitizeEmailLocale } from "./email"
import { OAuthProviderProfile } from "./oauth"

export const EMAIL_VERIFICATION_EXPIRY_HOURS = 24
export const PASSWORD_RESET_EXPIRY_MINUTES = 30

/**
 * Register a new user using Email + Password
 */
export async function registerWithPassword(
  db: Database,
  params: {
    email: string
    password: string
    displayName?: string | null
    locale?: string
  },
  emailService: EmailService,
  authServiceUrl: string = "https://auth.hikat.org",
): Promise<{ user: schema.User; emailVerificationRequired: boolean }> {
  const normalizedEmail = params.email.trim().toLowerCase()
  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  if (!params.password || params.password.length < 8 || params.password.length > 128) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  if (params.displayName && params.displayName.length > 16) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // Check if user already exists in password_credentials or external_accounts
  const existingCred = await db
    .select({ id: schema.passwordCredentials.id })
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.email, normalizedEmail))
    .get()

  const existingExternal = await db
    .select({ id: schema.externalAccounts.id })
    .from(schema.externalAccounts)
    .where(eq(schema.externalAccounts.email, normalizedEmail))
    .get()

  if (existingCred || existingExternal) {
    throw new Error(AuthErrorCode.USER_ALREADY_EXISTS)
  }

  const userId = crypto.randomUUID()
  const credentialId = crypto.randomUUID()
  const passwordHash = await hashPassword(params.password)
  const now = new Date().toISOString()
  const displayName = params.displayName || normalizedEmail.split("@")[0] || "Player"

  // Prepare Email Verification Token before atomic batch
  const rawVerificationToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawVerificationToken)
  const expiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString()
  const newTokenId = crypto.randomUUID()

  // 1. Atomic creation of user, password credentials, and email verification token in D1
  const d1 = (db as unknown as { session: { client: D1Database } }).session?.client

  if (d1) {
    const insertUserStmt = d1
      .prepare(
        `INSERT INTO users (id, role, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(userId, "PLAYER", displayName, now, now)

    const insertCredStmt = d1
      .prepare(
        `INSERT INTO password_credentials (id, user_id, email, password_hash, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(credentialId, userId, normalizedEmail, passwordHash, now, now)

    const insertTokenStmt = d1
      .prepare(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .bind(newTokenId, userId, tokenHash, expiresAt, now)

    await d1.batch([insertUserStmt, insertCredStmt, insertTokenStmt])
  } else {
    // Fallback without raw D1
    await db.insert(schema.users).values({
      id: userId,
      role: "PLAYER",
      displayName,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.passwordCredentials).values({
      id: credentialId,
      userId,
      email: normalizedEmail,
      passwordHash,
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.emailVerificationTokens).values({
      id: newTokenId,
      userId,
      tokenHash,
      expiresAt,
      createdAt: now,
    })
  }

  const normalizedLocale = sanitizeEmailLocale(params.locale)
  const verificationUrl = `${authServiceUrl.replace(/\/+$/, "")}/auth/email-action?type=verify-email&token=${rawVerificationToken}&lang=${normalizedLocale}`
  try {
    await emailService.sendVerificationEmail(
      normalizedEmail,
      rawVerificationToken,
      verificationUrl,
      normalizedLocale,
    )
  } catch (emailErr) {
    console.error("[Auth] Failed to send verification email during registration:", emailErr)
    try {
      // CASCADE in database foreign keys cleans up password_credentials and email_verification_tokens
      await db.delete(schema.users).where(eq(schema.users.id, userId)).run()
    } catch (cleanupErr) {
      console.error("[Auth] Failed to rollback user after email send failure:", cleanupErr)
    }
    throw new Error("EMAIL_SERVICE_ERROR")
  }

  const createdUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()

  return {
    user: createdUser!,
    emailVerificationRequired: true,
  }
}

/**
 * Resend Email Verification Token & Email
 */
export async function resendVerificationEmail(
  db: Database,
  email: string,
  emailService: EmailService,
  authServiceUrl: string = "https://auth.hikat.org",
  locale?: string,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) {
    return
  }

  const cred = await db
    .select()
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.email, normalizedEmail))
    .get()

  // Prevent user enumeration: silently return if user doesn't exist or is already verified
  if (!cred || cred.emailVerifiedAt !== null) {
    return
  }

  const rawVerificationToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawVerificationToken)
  const expiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString()
  const newTokenId = crypto.randomUUID()
  const tokenCreatedAt = new Date().toISOString()

  await db.insert(schema.emailVerificationTokens).values({
    id: newTokenId,
    userId: cred.userId,
    tokenHash,
    expiresAt,
    createdAt: tokenCreatedAt,
  })

  const normalizedLocale = sanitizeEmailLocale(locale)
  const verificationUrl = `${authServiceUrl.replace(/\/+$/, "")}/auth/email-action?type=verify-email&token=${rawVerificationToken}&lang=${normalizedLocale}`
  try {
    await emailService.sendVerificationEmail(
      normalizedEmail,
      rawVerificationToken,
      verificationUrl,
      normalizedLocale,
    )
  } catch (emailErr) {
    console.error("[Auth] Failed to send verification email during resend:", emailErr)
    // Delete ONLY the newly created token, preserving any prior valid tokens
    try {
      await db
        .delete(schema.emailVerificationTokens)
        .where(eq(schema.emailVerificationTokens.id, newTokenId))
        .run()
    } catch (cleanupErr) {
      console.error("[Auth] Failed to delete failed verification token:", cleanupErr)
    }
    return
  }
}

/**
 * Login with Email + Password
 */
export async function loginWithPassword(
  db: Database,
  params: {
    email: string
    password: string
  },
  keyManager: JwtKeyManager,
): Promise<AuthSessionResult> {
  const normalizedEmail = params.email.trim().toLowerCase()
  if (
    !normalizedEmail ||
    normalizedEmail.length > 254 ||
    !params.password ||
    params.password.length < 8 ||
    params.password.length > 128
  ) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 1. Fetch user + password credentials in a single indexed query
  const credRecord = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      displayName: schema.users.displayName,
      createdAt: schema.users.createdAt,
      passwordHash: schema.passwordCredentials.passwordHash,
      emailVerifiedAt: schema.passwordCredentials.emailVerifiedAt,
      credEmail: schema.passwordCredentials.email,
    })
    .from(schema.users)
    .innerJoin(
      schema.passwordCredentials,
      eq(schema.users.id, schema.passwordCredentials.userId),
    )
    .where(eq(schema.passwordCredentials.email, normalizedEmail))
    .get()

  if (!credRecord) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 2. Constant-time password verification
  const isMatch = await verifyPassword(params.password, credRecord.passwordHash)
  if (!isMatch) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 3. Email verification check
  if (credRecord.emailVerifiedAt === null) {
    throw new Error(AuthErrorCode.EMAIL_NOT_VERIFIED)
  }

  // 4. Create session and issue tokens
  return createSession(
    db,
    {
      id: credRecord.id,
      email: credRecord.credEmail,
      role: credRecord.role as AppRole,
      displayName: credRecord.displayName,
      createdAt: credRecord.createdAt,
    },
    keyManager,
  )
}

/**
 * Verify Email with Token
 */
export async function verifyEmailToken(
  db: Database,
  rawToken: string,
): Promise<{ success: boolean }> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(rawToken)) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  const tokenHash = await hashToken(rawToken)
  const now = new Date()
  const nowIso = now.toISOString()

  const tokenRecord = await db
    .select()
    .from(schema.emailVerificationTokens)
    .where(eq(schema.emailVerificationTokens.tokenHash, tokenHash))
    .get()

  if (!tokenRecord) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  // 1. Latest-token-wins check: token must be the newest token for this user
  const latestTokenRecord = await db
    .select()
    .from(schema.emailVerificationTokens)
    .where(eq(schema.emailVerificationTokens.userId, tokenRecord.userId))
    .orderBy(sql`rowid DESC`)
    .limit(1)
    .get()

  if (!latestTokenRecord || latestTokenRecord.id !== tokenRecord.id) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  if (tokenRecord.usedAt) {
    throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
  }

  if (new Date(tokenRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  // 2. Atomic consumption and credential update in D1
  const d1 = (db as unknown as { session: { client: D1Database } }).session?.client

  if (d1) {
    const updateTokenStmt = d1
      .prepare(
        `UPDATE email_verification_tokens
         SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(nowIso, tokenRecord.id, nowIso)

    const updateCredStmt = d1
      .prepare(
        `UPDATE password_credentials
         SET email_verified_at = ?, updated_at = ?
         WHERE user_id = ? AND (SELECT changes() = 1)`,
      )
      .bind(nowIso, nowIso, tokenRecord.userId)

    const batchResults = await d1.batch([updateTokenStmt, updateCredStmt])
    const tokenChanges = batchResults[0]?.meta?.changes ?? 0

    if (tokenChanges === 0) {
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }
  } else {
    const updateRes = await db
      .update(schema.emailVerificationTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(schema.emailVerificationTokens.id, tokenRecord.id),
          isNull(schema.emailVerificationTokens.usedAt),
        ),
      )
      .run()

    const changes = (updateRes as any)?.meta?.changes ?? (updateRes as any)?.changes ?? 0
    if (changes === 0) {
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }

    await db
      .update(schema.passwordCredentials)
      .set({
        emailVerifiedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
      .run()
  }

  return { success: true }
}

/**
 * Request Password Reset Email
 */
export async function requestPasswordReset(
  db: Database,
  email: string,
  emailService: EmailService,
  authServiceUrl: string = "https://auth.hikat.org",
  locale?: string,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) {
    return
  }

  const cred = await db
    .select()
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.email, normalizedEmail))
    .get()

  // To prevent user enumeration, silently return if email does not exist
  if (!cred) {
    return
  }

  const rawResetToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawResetToken)
  const expiresAt = new Date(
    Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString()
  const newTokenId = crypto.randomUUID()
  const tokenCreatedAt = new Date().toISOString()

  await db.insert(schema.passwordResetTokens).values({
    id: newTokenId,
    userId: cred.userId,
    tokenHash,
    expiresAt,
    createdAt: tokenCreatedAt,
  })

  const normalizedLocale = sanitizeEmailLocale(locale)
  const resetUrl = `${authServiceUrl.replace(/\/+$/, "")}/auth/email-action?type=reset-password&token=${rawResetToken}&lang=${normalizedLocale}`
  try {
    await emailService.sendPasswordResetEmail(normalizedEmail, rawResetToken, resetUrl, normalizedLocale)
  } catch (err) {
    // Log failure server-side only to prevent user enumeration and avoid leaking Resend errors to client
    console.error("[Auth] Failed to send password reset email:", err)
    // Delete ONLY the newly created token, preserving any prior valid tokens
    try {
      await db
        .delete(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.id, newTokenId))
        .run()
    } catch (cleanupErr) {
      console.error("[Auth] Failed to cleanup failed reset token:", cleanupErr)
    }
    return
  }
}

/**
 * Reset Password using token
 */
export async function resetPasswordWithToken(
  db: Database,
  rawToken: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  if (
    !rawToken ||
    typeof rawToken !== "string" ||
    rawToken.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(rawToken) ||
    !newPassword ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  const tokenHash = await hashToken(rawToken)
  const now = new Date()
  const nowIso = now.toISOString()

  const tokenRecord = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
    .get()

  if (!tokenRecord) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  // 1. Latest-token-wins check: token must be the newest token for this user
  const latestTokenRecord = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.userId, tokenRecord.userId))
    .orderBy(sql`rowid DESC`)
    .limit(1)
    .get()

  if (!latestTokenRecord || latestTokenRecord.id !== tokenRecord.id) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  if (tokenRecord.usedAt) {
    throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
  }

  if (new Date(tokenRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  // 2. Hash new password
  const newPasswordHash = await hashPassword(newPassword)

  // 3. Atomic consumption, password update, and session revocations in D1
  const d1 = (db as unknown as { session: { client: D1Database } }).session?.client

  if (d1) {
    const consumeTokenStmt = d1
      .prepare(
        `UPDATE password_reset_tokens
         SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(nowIso, tokenRecord.id, nowIso)

    const updateCredStmt = d1
      .prepare(
        `UPDATE password_credentials
         SET password_hash = ?, updated_at = ?
         WHERE user_id = ? AND (SELECT changes() = 1)`,
      )
      .bind(newPasswordHash, nowIso, tokenRecord.userId)

    const revokeSessionsStmt = d1
      .prepare(
        `UPDATE sessions
         SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL AND (SELECT changes() = 1)`,
      )
      .bind(nowIso, tokenRecord.userId)

    const revokeRefreshTokensStmt = d1
      .prepare(
        `UPDATE session_refresh_tokens
         SET revoked_at = ?
         WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)
           AND revoked_at IS NULL
           AND (SELECT changes() = 1)`,
      )
      .bind(nowIso, tokenRecord.userId)

    const batchResults = await d1.batch([
      consumeTokenStmt,
      updateCredStmt,
      revokeSessionsStmt,
      revokeRefreshTokensStmt,
    ])

    const tokenChanges = batchResults[0]?.meta?.changes ?? 0
    if (tokenChanges === 0) {
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }
  } else {
    const updateRes = await db
      .update(schema.passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(schema.passwordResetTokens.id, tokenRecord.id),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      )
      .run()

    const changes = (updateRes as any)?.meta?.changes ?? (updateRes as any)?.changes ?? 0
    if (changes === 0) {
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }

    await db
      .update(schema.passwordCredentials)
      .set({
        passwordHash: newPasswordHash,
        updatedAt: nowIso,
      })
      .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
      .run()

    await revokeAllUserSessions(db, tokenRecord.userId)
  }

  return { success: true }
}

export type EmailActionStatus = "pending" | "completed" | "invalid" | "expired"

/**
 * Query status of an email verification or password reset action without modifying/consuming tokens.
 */
export async function getEmailActionStatus(
  db: Database,
  type: string,
  rawToken: string,
): Promise<EmailActionStatus> {
  if (
    !rawToken ||
    typeof rawToken !== "string" ||
    rawToken.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(rawToken)
  ) {
    return "invalid"
  }

  const tokenHash = await hashToken(rawToken)
  const now = new Date()

  if (type === "verify-email") {
    const tokenRecord = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, tokenHash))
      .get()

    if (!tokenRecord) {
      return "invalid"
    }

    const latestTokenRecord = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, tokenRecord.userId))
      .orderBy(sql`rowid DESC`)
      .limit(1)
      .get()

    if (!latestTokenRecord || latestTokenRecord.id !== tokenRecord.id) {
      return "invalid"
    }

    if (tokenRecord.usedAt !== null) {
      const cred = await db
        .select()
        .from(schema.passwordCredentials)
        .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
        .get()

      if (cred && cred.emailVerifiedAt && cred.emailVerifiedAt === tokenRecord.usedAt) {
        return "completed"
      }
      return "invalid"
    }

    if (new Date(tokenRecord.expiresAt) <= now) {
      return "expired"
    }

    return "pending"
  }

  if (type === "reset-password") {
    const tokenRecord = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
      .get()

    if (!tokenRecord) {
      return "invalid"
    }

    const latestTokenRecord = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.userId, tokenRecord.userId))
      .orderBy(sql`rowid DESC`)
      .limit(1)
      .get()

    if (!latestTokenRecord || latestTokenRecord.id !== tokenRecord.id) {
      return "invalid"
    }

    if (tokenRecord.usedAt !== null) {
      const cred = await db
        .select()
        .from(schema.passwordCredentials)
        .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
        .get()

      if (cred && cred.updatedAt === tokenRecord.usedAt) {
        return "completed"
      }
      return "invalid"
    }

    if (new Date(tokenRecord.expiresAt) <= now) {
      return "expired"
    }

    return "pending"
  }

  return "invalid"
}

/**
 * Change Password (for authenticated user with active session)
 */
export async function changePassword(
  db: Database,
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  if (
    !currentPassword ||
    currentPassword.length > 128 ||
    !newPassword ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 1. Verify active session in D1
  const isSessionActive = await validateActiveSession(db, sessionId, userId)
  if (!isSessionActive) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  // 2. Get password credentials
  const cred = await db
    .select()
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.userId, userId))
    .get()

  if (!cred) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 3. Verify current password
  const isValid = await verifyPassword(currentPassword, cred.passwordHash)
  if (!isValid) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 4. Update password
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(newPassword)
  await db
    .update(schema.passwordCredentials)
    .set({ passwordHash, updatedAt: now })
    .where(eq(schema.passwordCredentials.id, cred.id))
    .run()

  // 5. Revoke all other active sessions of the same user (preserving current session)
  const otherSessions = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        ne(schema.sessions.id, sessionId),
        sql`${schema.sessions.revokedAt} IS NULL`,
      ),
    )
    .all()

  for (const s of otherSessions) {
    await revokeSession(db, s.id)
  }

  return { success: true }
}

/**
 * Get or create HiKAT User identity from OAuth profile without creating a session
 */
export async function getOrCreateOAuthUser(
  db: Database,
  profile: OAuthProviderProfile,
): Promise<{ id: string; email: string; role: AppRole; displayName: string | null; createdAt?: string }> {
  // 1. Check if external identity already exists for this provider
  const linkedAccount = await db
    .select({
      extId: schema.externalAccounts.id,
      userId: schema.externalAccounts.userId,
      email: schema.externalAccounts.email,
      role: schema.users.role,
      displayName: schema.users.displayName,
      createdAt: schema.users.createdAt,
    })
    .from(schema.externalAccounts)
    .innerJoin(schema.users, eq(schema.externalAccounts.userId, schema.users.id))
    .where(
      and(
        eq(schema.externalAccounts.provider, profile.provider),
        eq(schema.externalAccounts.providerSubject, profile.providerSubject),
      ),
    )
    .get()

  if (linkedAccount) {
    return {
      id: linkedAccount.userId,
      email: linkedAccount.email || profile.email || "",
      role: linkedAccount.role as AppRole,
      displayName: linkedAccount.displayName,
      createdAt: linkedAccount.createdAt,
    }
  }

  // 2. If not existing identity, check if email already belongs to a HiKAT account
  const normalizedEmail = profile.email ? profile.email.trim().toLowerCase() : null
  if (normalizedEmail) {
    const existingPasswordUser = await db
      .select({ userId: schema.passwordCredentials.userId })
      .from(schema.passwordCredentials)
      .where(eq(schema.passwordCredentials.email, normalizedEmail))
      .get()

    const existingExternalUser = await db
      .select({ userId: schema.externalAccounts.userId })
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.email, normalizedEmail))
      .get()

    if (existingPasswordUser || existingExternalUser) {
      // 1 user = 1 identity = 1 auth method. Reject conflicting registrations across different methods.
      throw new Error(AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED)
    }
  }

  // 3. Create fresh HiKAT user with role PLAYER and store external identity atomically in D1
  const userId = crypto.randomUUID()
  const externalAccountId = crypto.randomUUID()
  const now = new Date().toISOString()
  const displayName = profile.displayName || normalizedEmail?.split("@")[0] || "Player"

  const d1 = (db as unknown as { session: { client: D1Database } }).session?.client

  if (d1) {
    const insertUserStmt = d1
      .prepare(
        `INSERT INTO users (id, role, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(userId, "PLAYER", displayName, now, now)

    const insertExternalStmt = d1
      .prepare(
        `INSERT INTO external_accounts (id, user_id, provider, provider_subject, email, display_name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        externalAccountId,
        userId,
        profile.provider,
        profile.providerSubject,
        normalizedEmail,
        profile.displayName ?? null,
        profile.avatarUrl ?? null,
        now,
        now,
      )

    await d1.batch([insertUserStmt, insertExternalStmt])
  } else {
    await db.insert(schema.users).values({
      id: userId,
      role: "PLAYER",
      displayName,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.externalAccounts).values({
      id: externalAccountId,
      userId,
      provider: profile.provider,
      providerSubject: profile.providerSubject,
      email: normalizedEmail,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      createdAt: now,
      updatedAt: now,
    })
  }

  return {
    id: userId,
    email: normalizedEmail || "",
    role: "PLAYER" as AppRole,
    displayName,
    createdAt: now,
  }
}

/**
 * Resolve OAuth user: authenticate existing or create new PLAYER and issue a session
 */
export async function resolveOAuthUser(
  db: Database,
  profile: OAuthProviderProfile,
  keyManager: JwtKeyManager,
): Promise<AuthSessionResult> {
  const user = await getOrCreateOAuthUser(db, profile)
  return createSession(db, user, keyManager)
}

/**
 * Get active authentication method(s) for a user (Read-only)
 */
export async function getAuthMethods(
  db: Database,
  userId: string,
): Promise<AuthMethodSummary[]> {
  const methods: AuthMethodSummary[] = []

  // Check password credential
  const passwordCred = await db
    .select()
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.userId, userId))
    .get()

  if (passwordCred) {
    methods.push({
      type: "PASSWORD",
      email: passwordCred.email,
      verified: passwordCred.emailVerifiedAt !== null,
      createdAt: passwordCred.createdAt,
      linkedAt: passwordCred.createdAt,
    })
  }

  // Check external accounts
  const externals = await db
    .select()
    .from(schema.externalAccounts)
    .where(eq(schema.externalAccounts.userId, userId))
    .all()

  for (const ext of externals) {
    methods.push({
      type: ext.provider as "GOOGLE" | "DISCORD",
      email: ext.email,
      displayName: ext.displayName,
      providerSubject: ext.providerSubject,
      createdAt: ext.createdAt,
      linkedAt: ext.createdAt,
    })
  }

  return methods
}

/**
 * Issue a Game JWT for Minecraft (aud: hikat-minecraft)
 * Requires valid active session AND verified email (if registered via password)
 */
export async function issueGameToken(
  db: Database,
  userId: string,
  sessionId: string,
  keyManager: JwtKeyManager,
): Promise<{ token: string; expiresIn: number }> {
  // 1. Verify active session in D1
  const isSessionActive = await validateActiveSession(db, sessionId, userId)
  if (!isSessionActive) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  // 2. Fetch user
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()

  if (!user) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  // 3. Email verification gate for password credentials
  const passwordCred = await db
    .select()
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.userId, userId))
    .get()

  if (passwordCred && passwordCred.emailVerifiedAt === null) {
    throw new Error(AuthErrorCode.EMAIL_NOT_VERIFIED)
  }

  // 4. Sign and return Game JWT
  return signGameToken(
    {
      userId: user.id,
      sessionId,
      role: user.role as AppRole,
      displayName: user.displayName,
    },
    keyManager,
  )
}
