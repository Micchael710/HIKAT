/**
 * HiKAT Backend GraphQL Context Factory
 * Creates structured request context with verified identity and active session checks.
 */

import { Database, createDatabase } from "@hikat/database"
import type { BackendGraphQLContext, Env, AuthState } from "./types"
import { verifyAccessToken, VerifyJwtOptions } from "./auth/verifier"
import { validateSessionInDb } from "./auth/session"

export interface CreateContextOptions {
  jwtOptions?: VerifyJwtOptions
}

/**
 * Creates the GraphQL context for an incoming request
 */
export async function createGraphQLContext(
  request: Request,
  env: Env,
  db?: Database,
  options?: CreateContextOptions,
): Promise<BackendGraphQLContext> {
  const activeDb = db ?? (env.DB ? createDatabase(env.DB) : undefined)
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization")

  if (!authHeader || authHeader.trim() === "") {
    return {
      env,
      db: activeDb,
      auth: { status: "anonymous" },
      request,
    }
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(\S+)$/i)
  if (!bearerMatch) {
    return {
      env,
      db: activeDb,
      auth: {
        status: "invalid",
        reason: "Invalid authorization header format. Expected Bearer <token>",
      },
      request,
    }
  }

  const token = bearerMatch[1]
  if (!token) {
    return {
      env,
      db: activeDb,
      auth: {
        status: "invalid",
        reason: "Invalid authorization header format. Expected Bearer <token>",
      },
      request,
    }
  }

  try {
    const payload = await verifyAccessToken(token, env, options?.jwtOptions)

    // Verify session state in D1 if database is available
    if (activeDb) {
      const sessionResult = await validateSessionInDb(activeDb, payload.sub, payload.sid)
      if (!sessionResult.valid) {
        return {
          env,
          db: activeDb,
          auth: {
            status: "invalid",
            reason: sessionResult.reason || "Invalid session",
          },
          request,
        }
      }
    }

    return {
      env,
      db: activeDb,
      auth: {
        status: "authenticated",
        identity: {
          userId: payload.sub,
          sessionId: payload.sid,
          role: payload.role,
          displayName: payload.displayName ?? null,
          tokenPayload: payload,
        },
      },
      request,
    }
  } catch (err: unknown) {
    const error = err as Error
    return {
      env,
      db: activeDb,
      auth: {
        status: "invalid",
        reason: error.message || "Failed to authenticate token",
      },
      request,
    }
  }
}
