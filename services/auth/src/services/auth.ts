/**
 * HiKAT Core Authentication Service
 */

import { eq, and, sql } from "drizzle-orm"
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

  const verificationUrl = `${authServiceUrl}/auth/verify-email?token=${rawVerificationToken}`
  await emailService.sendVerificationEmail(
    normalizedEmail,
    rawVerificationToken,
    verificationUrl,
  )

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

  // 1. Fetch credentials joined with user
  const credRecord = await db
    .select({
      credId: schema.passwordCredentials.id,
      userId: schema.passwordCredentials.userId,
      passwordHash: schema.passwordCredentials.passwordHash,
      emailVerifiedAt: schema.passwordCredentials.emailVerifiedAt,
      userRole: schema.users.role,
      userDisplayName: schema.users.displayName,
    })
    .from(schema.passwordCredentials)
    .innerJoin(schema.users, eq(schema.passwordCredentials.userId, schema.users.id))
    .where(eq(schema.passwordCredentials.email, normalizedEmail))
    .get()

  if (!credRecord) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  // 2. Verify password in constant time
  const isValid = await verifyPassword(params.password, credRecord.passwordHash)
  if (!isValid) {
    throw new Error(AuthErrorCode.INVALID_CREDENTIALS)
  }

  const user = {
    id: credRecord.userId,
    role: credRecord.userRole as AppRole,
    displayName: credRecord.userDisplayName,
  }

  // 3. Create Session and return tokens
  return createSession(db, user, keyManager)
}

/**
 * Verify Email using token
 */
export async function verifyEmailToken(
  db: Database,
  rawToken: string,
): Promise<{ success: boolean; userId: string }> {
  if (!rawToken) {
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

  // 1. Mark token as used
  await db
    .update(schema.emailVerificationTokens)
    .set({ usedAt: nowIso })
    .where(eq(schema.emailVerificationTokens.id, tokenRecord.id))
    .run()

  // 2. Mark password credentials as verified
  await db
    .update(schema.passwordCredentials)
    .set({ emailVerifiedAt: nowIso, updatedAt: nowIso })
    .where(eq(schema.passwordCredentials.userId, tokenRecord.userId))
    .run()

  return { success: true, userId: tokenRecord.userId }
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

  const rawResetToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawResetToken)
  const now = new Date().toISOString()
  const expiresAt = new Date(
    Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString()

  await db.insert(schema.passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId: cred.userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  })

  const resetUrl = `${authServiceUrl}/auth/reset-password?token=${rawResetToken}`
  await emailService.sendPasswordResetEmail(normalizedEmail, rawResetToken, resetUrl)
}

/**
 * Reset Password using token
 */
export async function resetPasswordWithToken(
  db: Database,
  rawToken: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  if (!rawToken || !newPassword || newPassword.length < 8) {
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

  // 1. Mark reset token as used
  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: nowIso })
    .where(eq(schema.passwordResetTokens.id, tokenRecord.id))
    .run()

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
): Promise<{ id: string; role: AppRole; displayName: string | null }> {
  // 1. Check if external account is already linked
  const linkedAccount = await db
    .select({
      extId: schema.externalAccounts.id,
      userId: schema.externalAccounts.userId,
      role: schema.users.role,
      displayName: schema.users.displayName,
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
      role: linkedAccount.role as AppRole,
      displayName: linkedAccount.displayName,
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
    role: "PLAYER" as AppRole,
    displayName: newUser.displayName ?? null,
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
