/**
 * HiKAT Session Management & Refresh Token Engine
 * Implements race-condition-safe atomic refresh token rotation and replay attack detection
 */

import { eq, and, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { AppRole, AuthErrorCode } from "@hikat/shared"
import { generateSecureToken, hashToken } from "../crypto/tokens"
import { signAccessToken, JwtKeyManager } from "../crypto/jwt"

export const DEFAULT_SESSION_EXPIRY_DAYS = 30
export const DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60 // 15 minutes

export interface AuthSessionResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  sessionId: string
  user: {
    id: string
    email: string
    role: AppRole
    displayName: string | null
  }
}

/**
 * Resolves canonical email for a user from passwordCredentials or externalAccounts.
 * Strictly guarantees a non-empty string or throws UNAUTHORIZED fail-closed error.
 */
export async function getUserEmail(db: Database, userId: string): Promise<string> {
  const passCred = await db
    .select({ email: schema.passwordCredentials.email })
    .from(schema.passwordCredentials)
    .where(eq(schema.passwordCredentials.userId, userId))
    .get()

  if (passCred?.email && typeof passCred.email === "string" && passCred.email.trim() !== "") {
    return passCred.email.trim().toLowerCase()
  }

  const extAcc = await db
    .select({ email: schema.externalAccounts.email })
    .from(schema.externalAccounts)
    .where(eq(schema.externalAccounts.userId, userId))
    .get()

  if (extAcc?.email && typeof extAcc.email === "string" && extAcc.email.trim() !== "") {
    return extAcc.email.trim().toLowerCase()
  }

  throw new Error(AuthErrorCode.UNAUTHORIZED)
}

/**
 * Create a new HiKAT Session and issue initial Access Token + Refresh Token
 */
export async function createSession(
  db: Database,
  user: { id: string; email?: string; role: AppRole; displayName: string | null },
  keyManager: JwtKeyManager,
  options?: { sessionExpiryDays?: number },
): Promise<AuthSessionResult> {
  const sessionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const expiryDays = options?.sessionExpiryDays || DEFAULT_SESSION_EXPIRY_DAYS
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()

  const email =
    user.email && typeof user.email === "string" && user.email.trim() !== ""
      ? user.email.trim().toLowerCase()
      : await getUserEmail(db, user.id)

  // 1. Insert session record
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    createdAt: now,
    expiresAt,
  })

  // 2. Generate opaque refresh token and store SHA-256 hash in session_refresh_tokens
  const rawRefreshToken = generateSecureToken(32)
  const tokenHash = await hashToken(rawRefreshToken)
  const tokenId = crypto.randomUUID()

  await db.insert(schema.sessionRefreshTokens).values({
    id: tokenId,
    sessionId,
    tokenHash,
    createdAt: now,
    expiresAt,
  })

  // 3. Issue Access JWT containing sid (sessionId)
  const { token: accessToken, expiresIn } = await signAccessToken(
    {
      userId: user.id,
      sessionId,
      role: user.role,
      displayName: user.displayName,
    },
    keyManager,
    { expiresInSeconds: DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS },
  )

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn,
    sessionId,
    user: {
      id: user.id,
      email,
      role: user.role,
      displayName: user.displayName,
    },
  }
}

/**
 * Rotate Refresh Token with atomic race-condition safety and replay attack detection
 */
export async function rotateRefreshToken(
  db: Database,
  rawRefreshToken: string,
  keyManager: JwtKeyManager,
): Promise<AuthSessionResult> {
  if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  const tokenHash = await hashToken(rawRefreshToken)
  const now = new Date()
  const nowIso = now.toISOString()

  // 1. Look up token in session_refresh_tokens
  const tokenRecord = await db
    .select()
    .from(schema.sessionRefreshTokens)
    .where(eq(schema.sessionRefreshTokens.tokenHash, tokenHash))
    .get()

  if (!tokenRecord) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  // 2. Replay attack check: If token was already consumed, revoke the entire session!
  if (tokenRecord.consumedAt) {
    await revokeSession(db, tokenRecord.sessionId)
    throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
  }

  // 3. Check if token itself is revoked or expired
  if (tokenRecord.revokedAt || new Date(tokenRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  // 4. Look up associated session
  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, tokenRecord.sessionId))
    .get()

  if (!session || session.revokedAt || new Date(session.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  // 5. Look up user
  const userRecord = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get()

  if (!userRecord) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  const userEmail = await getUserEmail(db, userRecord.id)

  // 6. Atomic conditional update to mark token as consumed
  // Ensures that two concurrent requests with the exact same token cannot both succeed.
  const d1 = (db as unknown as { session: { client: D1Database } }).session?.client

  if (d1) {
    const updateResult = await d1
      .prepare(
        `UPDATE session_refresh_tokens
         SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(nowIso, tokenRecord.id, nowIso)
      .run()

    if (updateResult.meta.changes === 0) {
      // Race condition detected: another request consumed the token first.
      await revokeSession(db, tokenRecord.sessionId)
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }
  } else {
    // Drizzle fallback
    const res = await db
      .update(schema.sessionRefreshTokens)
      .set({ consumedAt: nowIso })
      .where(
        and(
          eq(schema.sessionRefreshTokens.id, tokenRecord.id),
          sql`${schema.sessionRefreshTokens.consumedAt} IS NULL`,
          sql`${schema.sessionRefreshTokens.revokedAt} IS NULL`,
          sql`${schema.sessionRefreshTokens.expiresAt} > ${nowIso}`,
        ),
      )
      .run()

    if (res.meta.changes === 0) {
      await revokeSession(db, tokenRecord.sessionId)
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }
  }

  // 7. Generate new opaque refresh token for the same session
  const newRawRefreshToken = generateSecureToken(32)
  const newTokenHash = await hashToken(newRawRefreshToken)
  const newTokenId = crypto.randomUUID()

  await db.insert(schema.sessionRefreshTokens).values({
    id: newTokenId,
    sessionId: tokenRecord.sessionId,
    tokenHash: newTokenHash,
    createdAt: nowIso,
    expiresAt: session.expiresAt,
  })

  // 8. Sign new Access JWT
  const user = {
    id: userRecord.id,
    email: userEmail,
    role: userRecord.role as AppRole,
    displayName: userRecord.displayName,
  }

  const { token: accessToken, expiresIn } = await signAccessToken(
    {
      userId: user.id,
      sessionId: tokenRecord.sessionId,
      role: user.role,
      displayName: user.displayName,
    },
    keyManager,
    { expiresInSeconds: DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS },
  )

  return {
    accessToken,
    refreshToken: newRawRefreshToken,
    expiresIn,
    sessionId: tokenRecord.sessionId,
    user,
  }
}

/**
 * Revoke a specific session and all its refresh tokens (Logout)
 */
export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(eq(schema.sessions.id, sessionId))
    .run()

  await db
    .update(schema.sessionRefreshTokens)
    .set({ revokedAt: now })
    .where(eq(schema.sessionRefreshTokens.sessionId, sessionId))
    .run()
}

/**
 * Revoke all active sessions for a given user
 */
export async function revokeAllUserSessions(db: Database, userId: string): Promise<void> {
  const now = new Date().toISOString()
  const userSessions = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), sql`${schema.sessions.revokedAt} IS NULL`))
    .all()

  for (const s of userSessions) {
    await revokeSession(db, s.id)
  }
}

/**
 * Validate that a session (identified by sid) is currently active, unrevoked, and not expired in D1
 */
export async function validateActiveSession(
  db: Database,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const now = new Date()
  const session = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
    .get()

  if (!session) {
    return false
  }

  if (session.revokedAt || new Date(session.expiresAt) <= now) {
    return false
  }

  return true
}
