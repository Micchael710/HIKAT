/**
 * HiKAT Backend Service
 * Cloudflare Worker entrypoint with GraphQL Yoga, authenticated context, and health endpoints.
 */

import { createYoga, createSchema } from "graphql-yoga"
import { typeDefs } from "@hikat/graphql"
import { HIKAT_VERSION } from "@hikat/shared"
import { createDatabase } from "@hikat/database"
import type { Env, BackendGraphQLContext } from "./types"
import { createGraphQLContext } from "./context"
import { resolvers } from "./resolvers"
import { getCorsHeaders, handleOptionsRequest } from "./cors"

export * from "./types"
export * from "./auth/verifier"
export * from "./auth/session"
export * from "./auth/guards"
export * from "./context"
export * from "./services/userService"
export * from "./resolvers"

const KNOWN_SAFE_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
]

export const yoga = createYoga<BackendGraphQLContext>({
  graphqlEndpoint: "/graphql",
  cors: false, // Strict CORS handled exclusively by custom handler
  schema: createSchema({
    typeDefs,
    resolvers,
  }),
  maskedErrors: false, // Error masking is handled by secure-by-default Worker fetch wrapper
})

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return handleOptionsRequest(request, env)
    }

    // Minimal REST health check fallback for low-level infrastructure probes
    if (url.pathname === "/health") {
      const corsHeaders = getCorsHeaders(request, env)
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "hikat-backend",
          version: HIKAT_VERSION,
          timestamp: new Date().toISOString(),
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      )
    }

    const db = env.DB ? createDatabase(env.DB) : undefined
    const context = await createGraphQLContext(request, env, db)

    const response = await yoga.fetch(request, context)

    // Secure-by-default error sanitization:
    // Only ENVIRONMENT === 'development' explicitly preserves unexpected internal error messages.
    // In all other cases (undefined, 'production', 'staging', etc.), unexpected errors are masked.
    const isExplicitDev = env.ENVIRONMENT === "development"
    let finalBody: BodyInit | null = response.body

    if (response.headers.get("Content-Type")?.includes("application/json")) {
      try {
        const bodyText = await response.text()
        const json = JSON.parse(bodyText)
        if (Array.isArray(json.errors) && json.errors.length > 0) {
          json.errors = json.errors.map((err: any) => {
            const code = err.extensions?.code
            if (code && KNOWN_SAFE_CODES.includes(code)) {
              return err
            }
            if (isExplicitDev) {
              return {
                ...err,
                extensions: { ...err.extensions, code: code || "INTERNAL_ERROR" },
              }
            }
            return {
              message: "Internal server error",
              extensions: { code: "INTERNAL_ERROR" },
            }
          })
          finalBody = JSON.stringify(json)
        } else {
          finalBody = bodyText
        }
      } catch {
        finalBody = response.body
      }
    }

    // Append CORS headers to response
    const corsHeaders = getCorsHeaders(request, env)
    const newHeaders = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value)
    }

    return new Response(finalBody, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  },
}
