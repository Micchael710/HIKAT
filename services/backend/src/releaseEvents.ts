import type { Env } from "./types"

export class ReleaseEventsDurableObject {
  constructor(private ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const message = await request.text()

      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(message)
        } catch {}
      }

      return new Response(null, { status: 204 })
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    this.ctx.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }
}

export interface ReleaseActivatedBroadcastData {
  version: string
  minecraftVersion?: string | null
  neoForgeVersion?: string | null
  mandatory?: boolean
}

export async function broadcastReleaseActivated(
  env: Env,
  release: ReleaseActivatedBroadcastData,
): Promise<void> {
  if (!env.RELEASE_EVENTS) return

  const payload = JSON.stringify({
    type: "RELEASE_ACTIVATED",
    version: release.version,
    minecraftVersion: release.minecraftVersion || "1.21.1",
    neoForgeVersion: release.neoForgeVersion || "21.1.65",
    mandatory: true,
  })

  const id = env.RELEASE_EVENTS.idFromName("global")
  const stub = env.RELEASE_EVENTS.get(id)
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: payload,
  })
}
