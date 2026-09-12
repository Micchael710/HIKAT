/**
 * HiKAT Backend GraphQL Context Factory
 * Creates structured request context with verified identity, D1 session checks, and D1 account roles.
 */

import { Database, createDatabase } from "@hikat/database"
import type { BackendGraphQLContext, Env } from "./types"
import { verifyAccessToken, VerifyJwtOptions } from "./auth/verifier"
import { validateSessionInDb } from "./auth/session"
import { getUserById } from "./services/userService"

export interface CreateContextOptions {
  jwtOptions?: VerifyJwtOptions
}

/**
 * Creates the GraphQL context for an incoming request.
 * Fails closed if database is unavailable when credentials are provided.
 */
export async function createGraphQLContext(
  request: Request,
  env: Env,
  db?: Database,
  options?: CreateContextOptions,
  ctx?: ExecutionContext,
): Promise<BackendGraphQLContext> {
  const activeDb = db ?? (env.DB ? createDatabase(env.DB) : undefined)
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization")

  const baseContext: Pick<BackendGraphQLContext, "env" | "db" | "request" | "waitUntil" | "executionCtx"> = {
    env,
    db: activeDb,
    request,
    waitUntil: ctx?.waitUntil ? (p) => ctx.waitUntil(p) : undefined,
    executionCtx: ctx,
  }

  if (!authHeader || authHeader.trim() === "") {
    return {
      ...baseContext,
      auth: { status: "anonymous" },
    }
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(\S+)$/i)
  if (!bearerMatch) {
    return {
      ...baseContext,
      auth: {
        status: "invalid",
        reason: "Invalid authorization header format. Expected Bearer <token>",
      },
    }
  }

  const token = bearerMatch[1]
  if (!token) {
    return {
      ...baseContext,
      auth: {
        status: "invalid",
        reason: "Invalid authorization header format. Expected Bearer <token>",
      },
    }
  }

  try {
    const payload = await verifyAccessToken(token, env, options?.jwtOptions)

    // Fail closed if database is unavailable for session verification
    if (!activeDb) {
      return {
        ...baseContext,
        db: undefined,
        auth: {
          status: "invalid",
          reason: "Database unavailable for session verification",
        },
      }
    }

    try {
      // Verify session state in D1
      const sessionResult = await validateSessionInDb(activeDb, payload.sub, payload.sid)
      if (!sessionResult.valid) {
        return {
          ...baseContext,
          auth: {
            status: "invalid",
            reason: sessionResult.reason || "Invalid session",
          },
        }
      }

      // Retrieve active user from D1 to enforce current account role and profile
      const user = await getUserById(activeDb, payload.sub)
      if (!user) {
        return {
          ...baseContext,
          auth: {
            status: "invalid",
            reason: "User account not found",
          },
        }
      }

      return {
        ...baseContext,
        auth: {
          status: "authenticated",
          identity: {
            userId: user.id,
            sessionId: payload.sid,
            role: user.role, // Authorized from fresh D1 state
            displayName: user.displayName ?? null,
            tokenPayload: payload,
          },
        },
      }
    } catch {
      // Internal database failure during session or user retrieval
      return {
        ...baseContext,
        auth: {
          status: "invalid",
          reason: "Internal error during session verification",
        },
      }
    }
  } catch (err: unknown) {
    const error = err as Error
    return {
      ...baseContext,
      auth: {
        status: "invalid",
        reason: error.message || "Failed to authenticate token",
      },
    }
  }
}
