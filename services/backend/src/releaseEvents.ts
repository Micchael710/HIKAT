import type { ContentMediaGql } from "@hikat/graphql"
import { mapPterodactylStateToHiKAT, type ServerStatus } from "@hikat/shared"
import { createDatabase, Database } from "@hikat/database"
import type { Env } from "./types"
import {
  getServerStatus,
  getServerConsoleWebsocketCredentials,
} from "./services/pterodactyl/serverAdministrationService"
import type { IPterodactylClient } from "./services/pterodactyl/types"

export interface ServerWatcherState {
  serverId: string
  currentStatus: ServerStatus
  isClosed: boolean
  ws: WebSocket | null
  reconnectTimer: any
  backoffMs: number
  reconnectAttempts: number
}

export class ReleaseEventsDurableObject {
  private activeWatchers = new Map<string, ServerWatcherState>()
  private startingWatchers = new Set<string>()
  private watchedStorageLock: Promise<void> = Promise.resolve()
  private clientOverride?: IPterodactylClient
  private dbOverride?: Database
  private db?: Database

  constructor(
    private ctx: DurableObjectState,
    private env?: Env,
  ) {
    if (this.env?.DB) {
      try {
        this.db = createDatabase(this.env.DB)
      } catch {}
    }

    if (this.ctx.blockConcurrencyWhile) {
      this.ctx.blockConcurrencyWhile(async () => {
        await this.restoreWatchedServers()
      })
    }
  }

  setEnvForTesting(env?: Env): void {
    this.env = env
    if (env?.DB) {
      try {
        this.db = createDatabase(env.DB)
      } catch {}
    }
  }

  setClientOverrideForTesting(client?: IPterodactylClient): void {
    this.clientOverride = client
  }

  setDbOverrideForTesting(db?: Database): void {
    this.dbOverride = db
  }

  getWatcherStatus(serverId: string): ServerStatus | undefined {
    return this.activeWatchers.get(serverId)?.currentStatus
  }

  getActiveWatchersCount(): number {
    return this.activeWatchers.size
  }

  private async persistWatchedServerIds(serverIds: string[]): Promise<void> {
    const nextLock = this.watchedStorageLock.then(async () => {
      try {
        const watched = (await this.ctx.storage.get<string[]>("watchedServerIds")) || []
        const watchedSet = new Set(watched)
        const hasNew = serverIds.some((id) => !watchedSet.has(id))
        if (hasNew || watched.length !== watchedSet.size) {
          const merged = Array.from(new Set([...watched, ...serverIds]))
          await this.ctx.storage.put("watchedServerIds", merged)
        }
      } catch (err) {
        console.warn("[ReleaseEventsDO] Failed persisting watchedServerIds:", err)
      }
    })
    this.watchedStorageLock = nextLock.catch(() => {})
    await nextLock
  }

  private async unpersistWatchedServerId(serverId: string): Promise<void> {
    const nextLock = this.watchedStorageLock.then(async () => {
      try {
        await this.ctx.storage.delete(`serverStatus_${serverId}`)
        const watched = (await this.ctx.storage.get<string[]>("watchedServerIds")) || []
        const next = watched.filter((id) => id !== serverId)
        if (next.length !== watched.length) {
          await this.ctx.storage.put("watchedServerIds", next)
        }
      } catch (err) {
        console.warn(`[ReleaseEventsDO] Failed unpersisting watchedServerId for ${serverId}:`, err)
      }
    })
    this.watchedStorageLock = nextLock.catch(() => {})
    await nextLock
  }

  private async restoreWatchedServers(): Promise<void> {
    try {
      const watched = await this.ctx.storage.get<string[]>("watchedServerIds")
      if (Array.isArray(watched) && watched.length > 0) {
        await Promise.all(
          watched.map(async (serverId) => {
            try {
              await this.ensureWatcher(serverId, { skipPersist: true })
            } catch (err) {
              console.warn(`[ReleaseEventsDO] Failed restoring watcher for ${serverId}:`, err)
            }
          }),
        )
      }
    } catch (err) {
      console.warn("[ReleaseEventsDO] Failed reading watchedServerIds from storage:", err)
    }
  }

  async ensureWatcher(
    serverId: string,
    options?: { skipPersist?: boolean },
  ): Promise<ServerStatus> {
    const existing = this.activeWatchers.get(serverId)
    if (existing) {
      return existing.currentStatus
    }
    if (this.startingWatchers.has(serverId)) {
      return "UNKNOWN"
    }

    this.startingWatchers.add(serverId)

    const watcher: ServerWatcherState = {
      serverId,
      currentStatus: "UNKNOWN",
      isClosed: false,
      ws: null,
      reconnectTimer: null,
      backoffMs: 5000,
      reconnectAttempts: 0,
    }
    this.activeWatchers.set(serverId, watcher)

    // Persist in watchedServerIds list unless skipPersist is requested
    if (!options?.skipPersist) {
      await this.persistWatchedServerIds([serverId])
    }

    const db = this.dbOverride ?? this.db ?? (this.env?.DB ? createDatabase(this.env.DB) : undefined)

    try {
      // 1. Initial status fetch via Pterodactyl REST
      if (this.env) {
        try {
          const statusMetrics = await getServerStatus(this.env, this.clientOverride, serverId, db)
          if (statusMetrics?.status) {
            watcher.currentStatus = statusMetrics.status
          }
        } catch (err) {
          console.warn(`[ReleaseEventsDO] Initial status fetch failed for ${serverId}:`, err)
        }
      }

      // 2. Broadcast and persist initial status
      await this.broadcastStatus(serverId, watcher.currentStatus)

      // 3. Connect to Wings WebSocket for live status transitions
      if (this.env && !watcher.isClosed) {
        const connectPromise = this.connectWingsWatcher(watcher, db).catch((err) => {
          console.warn(`[ReleaseEventsDO] connectWingsWatcher error for ${serverId}:`, err)
        })
        if (this.ctx.waitUntil) {
          this.ctx.waitUntil(connectPromise)
        } else {
          void connectPromise
        }
      }
    } finally {
      this.startingWatchers.delete(serverId)
    }

    return watcher.currentStatus
  }

  private async connectWingsWatcher(
    watcher: ServerWatcherState,
    db?: Database,
  ): Promise<void> {
    if (watcher.isClosed || !this.env) return

    let wsCreds: { token: string; socket: string }
    try {
      wsCreds = await getServerConsoleWebsocketCredentials(
        this.env,
        this.clientOverride,
        watcher.serverId,
        db,
      )
    } catch {
      // If credentials cannot be fetched (e.g. unconfigured or panel unreachable), schedule reconnect
      this.scheduleWatcherReconnect(watcher, db)
      return
    }

    let fetchUrl = wsCreds.socket
    try {
      const parsed = new URL(wsCreds.socket)
      if (parsed.protocol === "wss:") {
        parsed.protocol = "https:"
      } else if (parsed.protocol === "ws:") {
        parsed.protocol = "http:"
      }
      fetchUrl = parsed.toString()
    } catch {}

    const wingsOrigin = this.env.PTERODACTYL_BASE_URL || "https://panel.example.com"

    if (typeof (globalThis as any).WebSocketPair === "undefined" && !this.clientOverride) {
      return
    }

    try {
      const upstreamRes = await fetch(fetchUrl, {
        headers: {
          Upgrade: "websocket",
          Origin: wingsOrigin,
        },
      })

      const upstreamWs = (upstreamRes as unknown as { webSocket?: WebSocket }).webSocket
      if (upstreamRes.status !== 101 || !upstreamWs) {
        this.scheduleWatcherReconnect(watcher, db)
        return
      }

      watcher.ws = upstreamWs
      watcher.backoffMs = 5000
      watcher.reconnectAttempts = 0
      upstreamWs.accept()

      // Send auth token to Wings
      try {
        upstreamWs.send(
          JSON.stringify({
            event: "auth",
            args: [wsCreds.token],
          }),
        )
      } catch {
        this.scheduleWatcherReconnect(watcher, db)
        return
      }

      upstreamWs.addEventListener("message", async (event: any) => {
        if (watcher.isClosed) return
        try {
          const data = JSON.parse(String(event.data))
          if (!data) return

          if (data.event === "status" && data.args?.[0]) {
            const rawState = String(data.args[0])
            const newStatus = mapPterodactylStateToHiKAT(rawState)
            if (newStatus !== watcher.currentStatus) {
              watcher.currentStatus = newStatus
              await this.broadcastStatus(watcher.serverId, newStatus)
            }
          } else if (data.event === "token expiring") {
            try {
              const refreshed = await getServerConsoleWebsocketCredentials(
                this.env!,
                this.clientOverride,
                watcher.serverId,
                db,
              )
              upstreamWs.send(
                JSON.stringify({
                  event: "auth",
                  args: [refreshed.token],
                }),
              )
            } catch {}
          }
        } catch {}
      })

      upstreamWs.addEventListener("close", () => {
        watcher.ws = null
        this.scheduleWatcherReconnect(watcher, db)
      })

      upstreamWs.addEventListener("error", () => {
        watcher.ws = null
        this.scheduleWatcherReconnect(watcher, db)
      })
    } catch {
      this.scheduleWatcherReconnect(watcher, db)
    }
  }

  private scheduleWatcherReconnect(
    watcher: ServerWatcherState,
    db?: Database,
  ): void {
    if (watcher.isClosed || watcher.reconnectTimer) return

    watcher.reconnectAttempts++
    watcher.reconnectTimer = setTimeout(() => {
      watcher.reconnectTimer = null
      void this.connectWingsWatcher(watcher, db)
    }, watcher.backoffMs)

    watcher.backoffMs = Math.min(watcher.backoffMs * 2, 60000)
  }

  async broadcastStatus(serverId: string, status: ServerStatus): Promise<void> {
    const existing = this.activeWatchers.get(serverId)
    if (existing) {
      existing.currentStatus = status
    }

    const message = JSON.stringify({
      type: "SERVER_STATUS_CHANGED",
      serverId,
      status,
    })

    try {
      await this.ctx.storage.put(`serverStatus_${serverId}`, message)
    } catch {}

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message)
      } catch {}
    }
  }

  stopWatcher(serverId: string): void {
    const watcher = this.activeWatchers.get(serverId)
    if (watcher) {
      watcher.isClosed = true
      if (watcher.reconnectTimer) {
        clearTimeout(watcher.reconnectTimer)
        watcher.reconnectTimer = null
      }
      if (watcher.ws) {
        try {
          watcher.ws.close()
        } catch {}
        watcher.ws = null
      }
      this.activeWatchers.delete(serverId)
    }
  }

  stopAllWatchers(): void {
    for (const serverId of Array.from(this.activeWatchers.keys())) {
      this.stopWatcher(serverId)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const message = await request.text()

      try {
        const parsed = JSON.parse(message)
        if (parsed?.type === "RELEASE_ACTIVATED") {
          await this.ctx.storage.put("latestReleaseEvent", message)
        } else if (parsed?.type === "SERVER_STATUS_CHANGED" && parsed?.serverId) {
          await this.ctx.storage.put(`serverStatus_${parsed.serverId}`, message)
          const existing = this.activeWatchers.get(parsed.serverId)
          if (existing && parsed.status) {
            existing.currentStatus = parsed.status
          }
        }
      } catch {
        // no persistir mensajes inválidos
      }

      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(message)
        } catch {}
      }

      return new Response(null, { status: 204 })
    }

    if (url.pathname === "/watch-servers" && request.method === "POST") {
      try {
        const body = (await request.json().catch(() => ({}))) as { serverIds?: string[] }
        const rawServerIds = Array.isArray(body.serverIds) ? body.serverIds : []
        const uniqueServerIds = Array.from(new Set(rawServerIds.filter(Boolean)))

        if (uniqueServerIds.length > 0) {
          await this.persistWatchedServerIds(uniqueServerIds)
        }

        const promises = uniqueServerIds.map((id) =>
          this.ensureWatcher(id, { skipPersist: true }),
        )
        const batchPromise = Promise.all(promises).catch((err) => {
          console.warn("[ReleaseEventsDO] Batch ensureWatcher error in /watch-servers:", err)
        })
        if (this.ctx.waitUntil) {
          this.ctx.waitUntil(batchPromise)
        } else {
          await batchPromise
        }
        return new Response(
          JSON.stringify({ ok: true, watchingCount: this.activeWatchers.size }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      }
    }

    if (url.pathname === "/unwatch-server" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { serverId?: string }
      if (body.serverId) {
        this.stopWatcher(body.serverId)
        await this.unpersistWatchedServerId(body.serverId)
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/watcher-status" && request.method === "GET") {
      const statuses: Record<string, ServerStatus> = {}
      for (const [id, watcher] of this.activeWatchers) {
        statuses[id] = watcher.currentStatus
      }
      return new Response(JSON.stringify({ ok: true, statuses }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    this.ctx.acceptWebSocket(server)

    const latest = await this.ctx.storage.get<string>("latestReleaseEvent")
    if (latest) {
      try {
        server.send(latest)
      } catch {}
    }

    if (this.ctx.storage.list) {
      try {
        const statuses = await this.ctx.storage.list<string>({ prefix: "serverStatus_" })
        for (const [, statusMsg] of statuses) {
          try {
            server.send(statusMsg)
          } catch {}
        }
      } catch {}
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }
}

export interface ReleaseActivatedBroadcastData {
  serverId?: string | null
  version: string
  minecraftVersion?: string | null
  modLoader?: string | null
  modLoaderVersion?: string | null
  /** @deprecated kept for backwards compat with old launchers */
  neoForgeVersion?: string | null
  mandatory?: boolean
  notes?: string | null
  cover?: ContentMediaGql | null
}

export async function broadcastReleaseActivated(
  env: Env,
  release: ReleaseActivatedBroadcastData,
): Promise<void> {
  if (!env.RELEASE_EVENTS) return

  const payload = JSON.stringify({
    type: "RELEASE_ACTIVATED",
    serverId: release.serverId || null,
    version: release.version,
    minecraftVersion: release.minecraftVersion || "1.21.1",
    modLoader: release.modLoader || "NEOFORGE",
    modLoaderVersion: release.modLoaderVersion || null,
    neoForgeVersion: release.neoForgeVersion || release.modLoaderVersion || "21.1.65",
    mandatory: true,
    notes: release.notes || null,
    cover: release.cover || null,
  })

  const id = env.RELEASE_EVENTS.idFromName("global")
  const stub = env.RELEASE_EVENTS.get(id)
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: payload,
  })
}

export async function broadcastServerUpdated(
  env: Env,
  serverId: string,
): Promise<void> {
  if (!env.RELEASE_EVENTS) return

  const payload = JSON.stringify({
    type: "SERVER_UPDATED",
    serverId,
  })

  const id = env.RELEASE_EVENTS.idFromName("global")
  const stub = env.RELEASE_EVENTS.get(id)
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: payload,
  })
}

export type CosmeticsUpdatedTarget = "SKINS" | "CAPES" | "ALL"

export async function broadcastCosmeticsUpdated(
  env: Env,
  target: CosmeticsUpdatedTarget = "ALL",
): Promise<void> {
  if (!env.RELEASE_EVENTS) return

  const payload = JSON.stringify({
    type: "COSMETICS_UPDATED",
    target,
  })

  const id = env.RELEASE_EVENTS.idFromName("global")
  const stub = env.RELEASE_EVENTS.get(id)
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: payload,
  })
}

export async function broadcastServerStatusChanged(
  env: Env,
  serverId: string,
  status: ServerStatus,
): Promise<void> {
  if (!env.RELEASE_EVENTS) return

  const payload = JSON.stringify({
    type: "SERVER_STATUS_CHANGED",
    serverId,
    status,
  })

  const id = env.RELEASE_EVENTS.idFromName("global")
  const stub = env.RELEASE_EVENTS.get(id)
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    body: payload,
  })
}

export async function notifyDurableObjectWatchServers(
  env: Env,
  serverIds: string[],
): Promise<void> {
  if (!env.RELEASE_EVENTS || serverIds.length === 0) return

  const id = env.RELEASE_EVENTS.idFromName("global")
  const stub = env.RELEASE_EVENTS.get(id)
  await stub.fetch("http://internal/watch-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverIds }),
  })
}

export async function notifyDurableObjectUnwatchServer(
  env: Env,
  serverId: string,
): Promise<void> {
  if (!env.RELEASE_EVENTS) return

  try {
    const id = env.RELEASE_EVENTS.idFromName("global")
    const stub = env.RELEASE_EVENTS.get(id)
    await stub.fetch("http://internal/unwatch-server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId }),
    })
  } catch {}
}
