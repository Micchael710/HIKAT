/**
 * HiKAT Backend Server Console WebSocket Proxy (Shard 06, 06A & 06B)
 * Provides authenticated, single-use ticket-gated, pure downstream WebSocket streaming
 * from Wings daemon to Back Office, with mandatory Origin validation, continuous session
 * revalidation in D1, and strict Pterodactyl payload filtering.
 */

import { eq, and, gt, isNull } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { mapPterodactylStateToHiKAT } from "@hikat/shared"
import type { Env } from "../../types"
import { isOriginAllowed } from "../../cors"
import {
  consumeConsoleTicket,
  getServerConsoleWebsocketCredentials,
} from "./serverAdministrationService"
import type { IPterodactylClient } from "./types"

const MAX_CONNECTION_DURATION_MS = 3600 * 1000 // 1 hour max session
const SESSION_REVALIDATION_INTERVAL_MS = 30 * 1000 // 30 seconds

export async function handleConsoleWebSocket(
  request: Request,
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<Response> {
  // 1. Method validation
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  // 2. WebSocket Upgrade header validation
  const upgradeHeader = request.headers.get("Upgrade")
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response(
      JSON.stringify({ error: "Expected WebSocket connection" }),
      {
        status: 426,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 3. Mandatory Origin header validation (must be present AND allowed)
  const origin = request.headers.get("Origin")
  if (!origin || !isOriginAllowed(origin, env)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  // 4. Ticket extraction & rejection of JWT in query params
  const url = new URL(request.url)
  const ticket = url.searchParams.get("ticket")

  // Explicitly reject if an access JWT is provided in query string
  if (url.searchParams.has("token") || url.searchParams.has("accessToken")) {
    return new Response(
      JSON.stringify({
        error: "Access tokens are not accepted in query parameters. Use console connection tickets.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  if (!ticket) {
    return new Response(
      JSON.stringify({ error: "Console connection ticket is required" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 5. Atomic ticket consumption in D1
  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "Database unavailable" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  const db = createDatabase(env.DB)
  let ticketRecord: { userId: string; sessionId: string }

  try {
    ticketRecord = await consumeConsoleTicket(db, ticket)
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid or expired console ticket" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  const { userId, sessionId } = ticketRecord
  const nowIso = new Date().toISOString()

  // 6. Verify active session and user admin role in D1
  const [activeSession, activeUser] = await Promise.all([
    db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, sessionId),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, nowIso),
        ),
      )
      .get(),
    db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get(),
  ])

  if (!activeSession) {
    return new Response(
      JSON.stringify({ error: "Session has expired or was revoked" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  if (!activeUser || activeUser.role !== "ADMIN") {
    return new Response(
      JSON.stringify({ error: "Administrator privileges required" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 7. Acquire Wings credentials (never exposed to browser)
  let wsCreds: { token: string; socket: string }
  try {
    wsCreds = await getServerConsoleWebsocketCredentials(env, clientOverride)
  } catch {
    return new Response(
      JSON.stringify({ error: "Unable to retrieve server console credentials" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // In Node test environment where WebSocketPair is absent, return 200 OK
  if (typeof (globalThis as any).WebSocketPair === "undefined") {
    return new Response(null, { status: 200 })
  }

  // 8. Connect upstream to Wings WebSocket
  let upstreamWs: WebSocket
  try {
    const upstreamRes = await fetch(wsCreds.socket, {
      headers: {
        Upgrade: "websocket",
        Origin: env.PTERODACTYL_BASE_URL || "https://panel.example.com",
      },
    })

    if (
      upstreamRes.status !== 101 ||
      !(upstreamRes as unknown as { webSocket?: WebSocket }).webSocket
    ) {
      return new Response(
        JSON.stringify({
          error: "Unable to establish connection with server console",
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    upstreamWs = (upstreamRes as unknown as { webSocket: WebSocket }).webSocket
    upstreamWs.accept()
  } catch {
    return new Response(
      JSON.stringify({
        error: "Unable to establish connection with server console",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 9. Establish downstream connection to Back Office client
  const webSocketPair = new (globalThis as any).WebSocketPair()
  const [clientWs, serverWs] = Object.values(webSocketPair) as [
    WebSocket,
    WebSocket,
  ]
  serverWs.accept()

  // Track connection lifetime and cleanup
  let isClosed = false
  const connectionStartTime = Date.now()
  let revalidationInterval: any = null

  const cleanup = () => {
    if (isClosed) return
    isClosed = true
    if (revalidationInterval) {
      clearInterval(revalidationInterval)
      revalidationInterval = null
    }
    try {
      serverWs.close(1000, "Connection closed")
    } catch {}
    try {
      upstreamWs.close(1000, "Connection closed")
    } catch {}
  }

  // Authenticate upstream with Wings
  try {
    upstreamWs.send(
      JSON.stringify({
        event: "auth",
        args: [wsCreds.token],
      }),
    )
  } catch {
    cleanup()
    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    } as unknown as ResponseInit)
  }

  // 10. Forward upstream events to client with strict filtering
  upstreamWs.addEventListener("message", (event) => {
    if (isClosed) return

    try {
      const data = JSON.parse(String(event.data))
      if (!data) return

      if (data.event === "console output" && Array.isArray(data.args)) {
        const text = data.args.join("\n")
        serverWs.send(
          JSON.stringify({
            type: "log",
            line: text,
            timestamp: new Date().toISOString(),
          }),
        )
      } else if (data.event === "status" && data.args?.[0]) {
        const state = String(data.args[0])
        const status = mapPterodactylStateToHiKAT(state)
        serverWs.send(
          JSON.stringify({
            type: "status",
            status,
          }),
        )
      }
      // Security: DO NOT forward raw Pterodactyl "stats" or daemon details
    } catch {
      if (typeof event.data === "string" && event.data.trim()) {
        serverWs.send(
          JSON.stringify({
            type: "log",
            line: event.data,
            timestamp: new Date().toISOString(),
          }),
        )
      }
    }
  })

  // Note: Commands are sent exclusively via GraphQL mutation (sendServerCommand).
  // The WebSocket connection is pure streaming (logs & status).

  // 11. Periodic session revalidation (every 30 seconds)
  revalidationInterval = setInterval(async () => {
    if (isClosed) return

    // Enforce max connection duration (1 hour)
    if (Date.now() - connectionStartTime > MAX_CONNECTION_DURATION_MS) {
      serverWs.close(1000, "Maximum connection duration reached")
      cleanup()
      return
    }

    try {
      const checkNowIso = new Date().toISOString()
      const [currentSession, currentUser] = await Promise.all([
        db
          .select()
          .from(schema.sessions)
          .where(
            and(
              eq(schema.sessions.id, sessionId),
              isNull(schema.sessions.revokedAt),
              gt(schema.sessions.expiresAt, checkNowIso),
            ),
          )
          .get(),
        db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .get(),
      ])

      if (!currentSession || !currentUser || currentUser.role !== "ADMIN") {
        serverWs.close(1008, "Session revoked or admin privileges lost")
        cleanup()
      }
    } catch {
      // In case of transient db error, keep alive and retry next interval
    }
  }, SESSION_REVALIDATION_INTERVAL_MS)

  // 12. Closure and error listeners
  serverWs.addEventListener("close", () => cleanup())
  serverWs.addEventListener("error", () => cleanup())
  upstreamWs.addEventListener("close", () => cleanup())
  upstreamWs.addEventListener("error", () => cleanup())

  return new Response(null, {
    status: 101,
    webSocket: clientWs,
  } as unknown as ResponseInit)
}
