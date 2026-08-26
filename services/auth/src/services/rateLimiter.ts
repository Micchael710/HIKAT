/**
 * HiKAT Rate Limiting Service
 * Supports persistent D1-backed rate limiting for production across Cloudflare Worker instances,
 * with an in-memory fallback for local development and testing.
 */

import { Database } from "@hikat/database"

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // epoch ms
}

const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>()

export async function checkRateLimit(
  db: Database | undefined,
  rawKey: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now()
  const key = `ratelimit:${rawKey}`

  // 1. If D1 database is available, use persistent D1 storage
  if (db && "_db" in db) {
    const windowMs = windowSeconds * 1000
    const nowIso = new Date(now).toISOString()
    const resetAtIso = new Date(now + windowMs).toISOString()

    try {
      // Clean up old expired entries occasionally or rely on resetAt comparison
      // Read current rate limit record
      const selectQuery = "SELECT count, reset_at FROM rate_limits WHERE key = ?"
      // Access D1 directly through raw query or db session
      const d1 = (db as unknown as { session: { client: D1Database } }).session?.client

      if (d1) {
        const existing = (await d1.prepare(selectQuery).bind(key).first()) as
          | { count: number; reset_at: string }
          | null

        if (!existing || new Date(existing.reset_at).getTime() <= now) {
          // Window expired or new entry: insert or update with count = 1 and new reset_at
          await d1
            .prepare(
              `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
               ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = ?`,
            )
            .bind(key, resetAtIso, resetAtIso)
            .run()

          return {
            allowed: true,
            remaining: maxRequests - 1,
            resetAt: now + windowMs,
          }
        }

        const currentCount = existing.count + 1
        const resetAtEpoch = new Date(existing.reset_at).getTime()

        if (currentCount > maxRequests) {
          return {
            allowed: false,
            remaining: 0,
            resetAt: resetAtEpoch,
          }
        }

        await d1
          .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
          .bind(key)
          .run()

        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - currentCount),
          resetAt: resetAtEpoch,
        }
      }
    } catch {
      // Fallback to in-memory if D1 table query fails
    }
  }

  // 2. In-memory fallback
  const existing = inMemoryRateLimits.get(key)
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000
    inMemoryRateLimits.set(key, { count: 1, resetAt })
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt,
    }
  }

  existing.count += 1
  if (existing.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - existing.count),
    resetAt: existing.resetAt,
  }
}

export function clearInMemoryRateLimits(): void {
  inMemoryRateLimits.clear()
}
