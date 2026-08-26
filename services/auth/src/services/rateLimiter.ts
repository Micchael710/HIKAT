/**
 * HiKAT Rate Limiting Service
 * Supports atomic, concurrent-safe persistent D1-backed rate limiting for production across Cloudflare Worker instances,
 * with an in-memory fallback for local unit tests without database.
 */

import { Database } from "@hikat/database"
import { AuthErrorCode } from "@hikat/shared"

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // epoch ms
}

export interface RateLimitOptions {
  isProduction?: boolean
}

const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>()

export async function checkRateLimit(
  db: Database | undefined,
  rawKey: string,
  maxRequests: number,
  windowSeconds: number,
  options?: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now()
  const key = `ratelimit:${rawKey}`
  const windowMs = windowSeconds * 1000

  // 1. If D1 database is available, execute atomic upsert in D1
  const d1 = db ? (db as unknown as { session?: { client?: D1Database } }).session?.client : undefined

  if (d1) {
    const nowIso = new Date(now).toISOString()
    const newResetAtIso = new Date(now + windowMs).toISOString()

    try {
      const query = `
        INSERT INTO rate_limits (key, count, reset_at)
        VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE
            WHEN rate_limits.reset_at <= ? THEN 1
            ELSE rate_limits.count + 1
          END,
          reset_at = CASE
            WHEN rate_limits.reset_at <= ? THEN ?
            ELSE rate_limits.reset_at
          END
        RETURNING count, reset_at;
      `

      const row = (await d1
        .prepare(query)
        .bind(key, newResetAtIso, nowIso, nowIso, newResetAtIso)
        .first()) as { count: number; reset_at: string } | null

      if (!row) {
        throw new Error("D1 rate limit query did not return a row")
      }

      const currentCount = Number(row.count)
      const resetAtEpoch = new Date(row.reset_at).getTime()

      if (currentCount > maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: resetAtEpoch,
        }
      }

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - currentCount),
        resetAt: resetAtEpoch,
      }
    } catch (err) {
      // In production or when D1 is explicitly configured, never fall back silently to in-memory!
      if (options?.isProduction) {
        console.error("D1 Rate limiting failed in production:", err)
        throw new Error("INTERNAL_ERROR")
      }
      throw err
    }
  }

  // 2. In-memory fallback ONLY when no D1 client is configured (e.g., pure unit tests)
  if (options?.isProduction) {
    throw new Error("Database required for production rate limiting")
  }

  const existing = inMemoryRateLimits.get(key)
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs
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
