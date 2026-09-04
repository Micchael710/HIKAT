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
  validateActiveSession,
  AuthSessionResult,
} from "./session"
import { EmailService } from "./email"
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
  },
  emailService: EmailService,
  authServiceUrl: string = "https://auth.hikat.org",
): Promise<{ user: schema.User; emailVerificationRequired: boolean }> {
  const normalizedEmail = params.email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  if (!params.password || params.password.length < 8) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 1. Check if email already registered
  const existingCred = await db
    .select()
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.email, normalizedEmail))
    .get()

  if (existingCred) {
    throw new Error(AuthErrorCode.USER_ALREADY_EXISTS)
  }

  const userId = crypto.randomUUID()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(params.password)

  // 2. Create User entity (default role PLAYER)
  const newUser: schema.NewUser = {
    id: userId,
    role: "PLAYER",
    displayName: params.displayName?.trim() || normalizedEmail.split("@")[0],
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.users).values(newUser)

  // 3. Create Password Credentials
  await db.insert(schema.passwordCredentials).values({
    id: crypto.randomUUID(),
    userId,
    email: normalizedEmail,
    passwordHash,
    emailVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  // 4. Create Email Verification Token & send email
  const rawVerificationToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawVerificationToken)
  const expiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString()

  await db.insert(schema.emailVerificationTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  })

  const verificationUrl = `${authServiceUrl.replace(/\/+$/, "")}/auth/email-action?type=verify-email&token=${rawVerificationToken}`
  try {
    await emailService.sendVerificationEmail(
      normalizedEmail,
      rawVerificationToken,
      verificationUrl,
    )
  } catch (emailErr) {
    console.error("[Auth] Failed to send verification email during registration:", emailErr)
    try {
      await db.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, userId)).run()
      await db.delete(schema.passwordCredentials).where(eq(schema.passwordCredentials.userId, userId)).run()
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
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
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
  const now = new Date().toISOString()

  await db.insert(schema.emailVerificationTokens).values({
    id: newTokenId,
    userId: cred.userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  })

  const verificationUrl = `${authServiceUrl.replace(/\/+$/, "")}/auth/email-action?type=verify-email&token=${rawVerificationToken}`
  try {
    await emailService.sendVerificationEmail(
      normalizedEmail,
      rawVerificationToken,
      verificationUrl,
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

  // On successful send, invalidate previous unconsumed verification tokens for this user
  try {
    await db
      .update(schema.emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.emailVerificationTokens.userId, cred.userId),
          isNull(schema.emailVerificationTokens.usedAt),
          ne(schema.emailVerificationTokens.id, newTokenId),
        ),
      )
      .run()
  } catch (cleanupErr) {
    console.error("[Auth] Failed to clean up prior verification tokens:", cleanupErr)
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
  if (!normalizedEmail || !params.password) {
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

  // 2. Verify password with timing-safe comparison
  const isValid = await verifyPassword(params.password, credRecord.passwordHash)
  if (!isValid) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 3. Block login if email is not verified
  if (!credRecord.emailVerifiedAt) {
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
 * Verify Email using Token
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

  if (tokenRecord.usedAt) {
    throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
  }

  if (new Date(tokenRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  // 1. Mark token as used atomically (CAS)
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

  // 2. Mark password credentials as verified
  await db
    .update(schema.passwordCredentials)
    .set({
      emailVerifiedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
    .run()

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
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
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

  const now = new Date().toISOString()
  const rawResetToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawResetToken)
  const expiresAt = new Date(
    Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString()
  const newTokenId = crypto.randomUUID()

  await db.insert(schema.passwordResetTokens).values({
    id: newTokenId,
    userId: cred.userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  })

  const resetUrl = `${authServiceUrl.replace(/\/+$/, "")}/auth/email-action?type=reset-password&token=${rawResetToken}`
  try {
    await emailService.sendPasswordResetEmail(normalizedEmail, rawResetToken, resetUrl)
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

  // On successful send, invalidate previous unused reset tokens for this user
  try {
    await db
      .update(schema.passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.passwordResetTokens.userId, cred.userId),
          isNull(schema.passwordResetTokens.usedAt),
          ne(schema.passwordResetTokens.id, newTokenId),
        ),
      )
      .run()
  } catch (cleanupErr) {
    console.error("[Auth] Failed to invalidate prior password reset tokens:", cleanupErr)
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
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(rawToken) || !newPassword || newPassword.length < 8) {
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

  if (tokenRecord.usedAt) {
    throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
  }

  if (new Date(tokenRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  // 1. Mark reset token as used atomically (CAS)
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

  // 2. Hash new password and update credentials
  const passwordHash = await hashPassword(newPassword)
  await db
    .update(schema.passwordCredentials)
    .set({ passwordHash, updatedAt: nowIso })
    .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
    .run()

  // 3. Revoke all active sessions for security
  await revokeAllUserSessions(db, tokenRecord.userId)

  return { success: true }
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
  if (!currentPassword || !newPassword || newPassword.length < 8) {
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

  return { success: true }
}

/**
 * Get or create HiKAT User identity from OAuth profile without creating a session
 */
export async function getOrCreateOAuthUser(
  db: Database,
  profile: OAuthProviderProfile,
): Promise<{ id: string; email: string; role: AppRole; displayName: string | null; createdAt?: string }> {
  // 1. Check if external account is already linked
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

  // 2. If not linked, check if the email belongs to an existing HiKAT account
  if (profile.email) {
    const existingPasswordUser = await db
      .select({ userId: schema.passwordCredentials.userId })
      .from(schema.passwordCredentials)
      .where(eq(schema.passwordCredentials.email, profile.email))
      .get()

    const existingExternalUser = await db
      .select({ userId: schema.externalAccounts.userId })
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.email, profile.email))
      .get()

    if (existingPasswordUser || existingExternalUser) {
      // DO NOT AUTO-LINK! Require explicit authentication + linking to prevent account takeover.
      throw new Error(AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED)
    }
  }

  // 3. Create fresh HiKAT user with role PLAYER and link provider
  const userId = crypto.randomUUID()
  const now = new Date().toISOString()

  const newUser: schema.NewUser = {
    id: userId,
    role: "PLAYER",
    displayName: profile.displayName || profile.email?.split("@")[0] || "Player",
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.users).values(newUser)

  await db.insert(schema.externalAccounts).values({
    id: crypto.randomUUID(),
    userId,
    provider: profile.provider,
    providerSubject: profile.providerSubject,
    email: profile.email,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id: userId,
    email: profile.email || "",
    role: "PLAYER" as AppRole,
    displayName: newUser.displayName ?? null,
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
 * Get all linked authentication methods for a user
 */
export async function getLinkedAuthMethods(
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
      linkedAt: ext.createdAt,
    })
  }

  return methods
}

/**
 * Explicitly link an OAuth provider to an existing authenticated user
 */
export async function linkOAuthAccount(
  db: Database,
  userId: string,
  sessionId: string,
  profile: OAuthProviderProfile,
): Promise<void> {
  // 1. Verify active session in D1
  const isSessionActive = await validateActiveSession(db, sessionId, userId)
  if (!isSessionActive) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  // 2. Check if provider account is already linked to anyone
  const existing = await db
    .select()
    .from(schema.externalAccounts)
    .where(
      and(
        eq(schema.externalAccounts.provider, profile.provider),
        eq(schema.externalAccounts.providerSubject, profile.providerSubject),
      ),
    )
    .get()

  if (existing) {
    throw new Error(AuthErrorCode.PROVIDER_ALREADY_LINKED)
  }

  // 3. Link account
  const now = new Date().toISOString()
  await db.insert(schema.externalAccounts).values({
    id: crypto.randomUUID(),
    userId,
    provider: profile.provider,
    providerSubject: profile.providerSubject,
    email: profile.email,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Unlink an authentication provider (prevent removing last auth method)
 */
export async function unlinkAuthMethod(
  db: Database,
  userId: string,
  sessionId: string,
  provider: ExternalAuthProvider,
): Promise<void> {
  // 1. Verify active session in D1
  const isSessionActive = await validateActiveSession(db, sessionId, userId)
  if (!isSessionActive) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  // 2. Count total available auth methods
  const methods = await getLinkedAuthMethods(db, userId)
  if (methods.length <= 1) {
    throw new Error(AuthErrorCode.LAST_AUTH_METHOD)
  }

  // 3. Delete the external account
  const res = await db
    .delete(schema.externalAccounts)
    .where(
      and(
        eq(schema.externalAccounts.userId, userId),
        eq(schema.externalAccounts.provider, provider),
      ),
    )
    .run()

  if (res.meta.changes === 0) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }
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
