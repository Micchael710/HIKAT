/**
 * HiKAT Backend Service
 * Cloudflare Worker entrypoint with GraphQL Yoga, authenticated context, and health endpoints.
 */

import { createYoga, createSchema } from "graphql-yoga"
import { typeDefs } from "@hikat/graphql"
import { HIKAT_VERSION } from "@hikat/shared"
import { createDatabase, Database } from "@hikat/database"
import type { Env, BackendGraphQLContext, AuthenticatedIdentity, AuthState } from "./types"
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

export const yoga = createYoga<BackendGraphQLContext>({
  graphqlEndpoint: "/graphql",
  schema: createSchema({
    typeDefs,
    resolvers,
  }),
  maskedErrors: process.env.NODE_ENV === "production",
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

    // Append CORS headers to response
    const corsHeaders = getCorsHeaders(request, env)
    const newHeaders = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  },
}
