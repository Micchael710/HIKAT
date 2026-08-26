/**
 * HiKAT Backend Session Validator
 * Validates active D1 sessions referenced by JWT sid claim.
 */

import { eq, and } from "drizzle-orm"
import { Database, sessions } from "@hikat/database"

export interface SessionValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Validates that a session exists, belongs to the expected user,
 * is not revoked, and has not expired.
 */
export async function validateSessionInDb(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<SessionValidationResult> {
  if (!sessionId || !userId) {
    return { valid: false, reason: "Session ID and User ID are required" }
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!session) {
    return { valid: false, reason: "Session not found" }
  }

  if (session.userId !== userId) {
    return { valid: false, reason: "Session does not belong to the authenticated user" }
  }

  if (session.revokedAt) {
    return { valid: false, reason: "Session has been revoked" }
  }

  const expiresAtMs = new Date(session.expiresAt).getTime()
  if (isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { valid: false, reason: "Session has expired" }
  }

  return { valid: true }
}
