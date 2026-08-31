/**
 * HiKAT Backend Service
 * Cloudflare Worker entrypoint with GraphQL Yoga, authenticated context,
 * health endpoints, and Cloudflare R2 media transport endpoints.
 */

import { createYoga, createSchema } from "graphql-yoga"

import { typeDefs } from "@hikat/graphql"

import { HIKAT_VERSION, SERVER_ERROR_CODES } from "@hikat/shared"

import { createDatabase } from "@hikat/database"

import type { Env, BackendGraphQLContext } from "./types"

import { createGraphQLContext } from "./context"

import { resolvers } from "./resolvers"

import { getCorsHeaders, handleOptionsRequest } from "./cors"

import {
  handleMediaUpload,
  handlePlayerSkinUpload,
  handlePlayerCapeUpload,
  handleMediaServe,
} from "./media/transport"

import { handleConsoleWebSocket } from "./services/pterodactyl/consoleTransport"

import {
  handleGameFileDownload,
} from "./services/game/gameStorageService"

export * from "./types"

export * from "./auth/verifier"

export * from "./auth/session"

export * from "./auth/guards"

export * from "./context"

export * from "./services/userService"

export * from "./services/newsService"

export * from "./services/mediaService"

export * from "./services/dashboardService"

export * from "./services/skinService"

export * from "./services/capeService"

export * from "./services/game"

export * from "./services/settingsService"

export * from "./services/pterodactyl/types"

export * from "./services/pterodactyl/pterodactylClient"

export * from "./services/pterodactyl/serverAdministrationService"

export * from "./services/pterodactyl/consoleTransport"

export * from "./media/transport"

export * from "./resolvers"

export * from "./releaseEvents"

const KNOWN_SAFE_CODES = [
  "UNAUTHENTICATED",

  "FORBIDDEN",

  "NOT_FOUND",

  "VALIDATION_ERROR",

  "CONFLICT",

  SERVER_ERROR_CODES.SERVER_UNAVAILABLE,

  SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,

  SERVER_ERROR_CODES.SERVER_BUSY,

  SERVER_ERROR_CODES.SERVER_RATE_LIMITED,
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

    // Binary Media Upload Route: PUT /media/content/upload

    if (url.pathname === "/media/content/upload") {
      if (request.method === "PUT") {
        return handleMediaUpload(request, env, db, context)
      }

      const corsHeaders = getCorsHeaders(request, env)

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,

        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // Dedicated Binary Player Skin Upload Route: PUT /media/player-skin/upload (Shard 06.6)

    if (url.pathname === "/media/player-skin/upload") {
      if (request.method === "PUT") {
        return handlePlayerSkinUpload(request, env, db, context)
      }

      const corsHeaders = getCorsHeaders(request, env)

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,

        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // Dedicated Binary Player Cape Upload Route: PUT /media/player-cape/upload (Shard 07 Hardening)

    if (url.pathname === "/media/player-cape/upload") {
      if (request.method === "PUT") {
        return handlePlayerCapeUpload(request, env, db, context)
      }

      const corsHeaders = getCorsHeaders(request, env)

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,

        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // Public Media Serving Route: GET /media/content/:id

    if (url.pathname.startsWith("/media/content/")) {
      const mediaId = url.pathname.slice("/media/content/".length)

      if (request.method === "GET") {
        return handleMediaServe(request, env, db, mediaId)
      }

      const corsHeaders = getCorsHeaders(request, env)

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,

        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // Realtime Server Console WebSocket Proxy Route: /api/server/console/ws (Shard 06)

    if (url.pathname === "/api/server/console/ws") {
      const wsResponse = await handleConsoleWebSocket(request, env)

      const corsHeaders = getCorsHeaders(request, env)

      const headers = new Headers(wsResponse.headers)

      for (const [k, v] of Object.entries(corsHeaders)) {
        headers.set(k, v)
      }

      return new Response(wsResponse.body, {
        status: wsResponse.status,

        statusText: wsResponse.statusText,

        headers,

        webSocket: wsResponse.webSocket,
      })
    }

    // Public Game File Download Route: GET /game/download/:fileId (Shard 06.5)

    if (url.pathname.startsWith("/game/download/")) {
      const fileId = url.pathname.slice("/game/download/".length)

      if (request.method === "GET") {
        return handleGameFileDownload(request, env, db, fileId)
      }

      const corsHeaders = getCorsHeaders(request, env)

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,

        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // Launcher Realtime Release Activation Events WebSocket Route
    if (url.pathname === "/launcher/release-events") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 })
      }

      const id = env.RELEASE_EVENTS!.idFromName("global")
      return env.RELEASE_EVENTS!.get(id).fetch(request)
    }

    // GraphQL Endpoint

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

                extensions: {
                  ...err.extensions,

                  code: code || "INTERNAL_ERROR",
                },
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
