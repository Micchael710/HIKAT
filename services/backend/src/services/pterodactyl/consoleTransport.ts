/**
 * HiKAT Server Console WebSocket Proxy Transport (Shard 06)
 * Secure Cloudflare Worker WebSocket proxy bridging Back Office to Pterodactyl Wings
 * without exposing Wings URLs or Pterodactyl tokens to the browser.
 */

import { verifyAccessToken } from "../../auth/verifier"
import { validateSessionInDb } from "../../auth/session"
import { getUserById } from "../userService"
import { createDatabase } from "@hikat/database"
import { mapPterodactylStateToHiKAT } from "@hikat/shared"
import type { Env } from "../../types"
import {
  getPterodactylClient,
  getServerConsoleWebsocketCredentials,
} from "./serverAdministrationService"

export async function handleConsoleWebSocket(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url)

  // Extract access token from query parameter or authorization header
  const token =
    url.searchParams.get("token") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Missing authorization token" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 1. Verify token & session & role
  const db = env.DB ? createDatabase(env.DB) : undefined
  if (!db) {
    return new Response(JSON.stringify({ error: "Database unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    const payload = await verifyAccessToken(token, env)
    const sessionResult = await validateSessionInDb(db, payload.sub, payload.sid)
    if (!sessionResult.valid) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    const user = await getUserById(db, payload.sub)
    if (!user || user.role !== "ADMIN") {
      return new Response(JSON.stringify({ error: "Forbidden. ADMIN role required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed"
    return new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  // 2. If environment does not support WebSocketPair (e.g. standard Node test environment)
  if (typeof WebSocketPair === "undefined") {
    return new Response(
      JSON.stringify({
        error: "WebSocketPair is not supported in this runtime environment",
      }),
      {
        status: 501,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 3. Obtain Pterodactyl Wings WebSocket credentials
  let wsCreds: { token: string; socket: string }
  try {
    wsCreds = await getServerConsoleWebsocketCredentials(env)
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to obtain server console credentials" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 4. Connect upstream to Wings WebSocket
  let upstreamWs: WebSocket
  try {
    const upstreamRes = await fetch(wsCreds.socket, {
      headers: { Upgrade: "websocket" },
    })

    if (!upstreamRes.webSocket) {
      return new Response(
        JSON.stringify({ error: "Failed to connect to upstream server console" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    upstreamWs = upstreamRes.webSocket
    upstreamWs.accept()
  } catch {
    return new Response(
      JSON.stringify({ error: "Unable to establish connection with server console" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // 5. Establish downstream connection to Back Office client
  const webSocketPair = new WebSocketPair()
  const [clientWs, serverWs] = Object.values(webSocketPair) as [WebSocket, WebSocket]
  serverWs.accept()


  // Authenticate upstream with Wings
  try {
    upstreamWs.send(
      JSON.stringify({
        event: "auth",
        args: [wsCreds.token],
      }),
    )
  } catch {
    serverWs.close(1011, "Authentication failed with upstream console")
    upstreamWs.close()
    return new Response(null, { status: 101, webSocket: clientWs })
  }

  // Upstream (Wings) -> Downstream (Back Office)
  upstreamWs.addEventListener("message", (event) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : null
      if (!data || !data.event) return

      if (data.event === "console output" && Array.isArray(data.args)) {
        serverWs.send(
          JSON.stringify({
            type: "log",
            line: data.args[0] || "",
            timestamp: new Date().toISOString(),
          }),
        )
      } else if (data.event === "status" && Array.isArray(data.args)) {
        const rawState = data.args[0]
        const mappedStatus = mapPterodactylStateToHiKAT(rawState)
        serverWs.send(
          JSON.stringify({
            type: "status",
            status: mappedStatus,
          }),
        )
      } else if (data.event === "stats" && Array.isArray(data.args)) {
        serverWs.send(
          JSON.stringify({
            type: "stats",
            data: data.args[0],
          }),
        )
      }
    } catch {
      // Ignore unparseable raw frame
    }
  })

  // Downstream (Back Office) -> Upstream (Wings)
  serverWs.addEventListener("message", (event) => {
    try {
      const msg = typeof event.data === "string" ? JSON.parse(event.data) : null
      if (!msg) return

      if (msg.type === "command" && typeof msg.command === "string") {
        const trimmed = msg.command.trim()
        if (trimmed.length > 0 && trimmed.length <= 500) {
          upstreamWs.send(
            JSON.stringify({
              event: "send command",
              args: [trimmed],
            }),
          )
        }
      }
    } catch {
      // Ignore malformed client frame
    }
  })

  // Synchronized close handling
  upstreamWs.addEventListener("close", () => {
    try {
      serverWs.close(1000, "Upstream console closed")
    } catch {}
  })

  serverWs.addEventListener("close", () => {
    try {
      upstreamWs.close(1000, "Client disconnected")
    } catch {}
  })

  upstreamWs.addEventListener("error", () => {
    try {
      serverWs.close(1011, "Upstream console error")
    } catch {}
  })

  return new Response(null, {
    status: 101,
    webSocket: clientWs,
  })
}
