import { mapPterodactylStateToHiKAT, type ServerStatus } from "@hikat/shared"
import type { Database } from "@hikat/database"
import type { Env } from "../../types"
import { broadcastServerStatusChanged } from "../../releaseEvents"
import {
  getServerStatus,
  getServerConsoleWebsocketCredentials,
} from "./serverAdministrationService"
import type { IPterodactylClient } from "./types"

interface ServerWatcherState {
  serverId: string
  currentStatus: ServerStatus
  isClosed: boolean
  ws: WebSocket | null
  reconnectTimer: any
  backoffMs: number
}

const activeWatchers = new Map<string, ServerWatcherState>()

export function _resetServerStatusWatchersForTesting(): void {
  for (const [, watcher] of activeWatchers) {
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
  }
  activeWatchers.clear()
}

export function _setServerWatcherStatusForTesting(
  serverId: string,
  status: ServerStatus,
): void {
  let watcher = activeWatchers.get(serverId)
  if (!watcher) {
    watcher = {
      serverId,
      currentStatus: status,
      isClosed: false,
      ws: null,
      reconnectTimer: null,
      backoffMs: 5000,
    }
    activeWatchers.set(serverId, watcher)
  } else {
    watcher.currentStatus = status
  }
}

export function getServerWatcherStatus(serverId: string): ServerStatus | undefined {
  return activeWatchers.get(serverId)?.currentStatus
}

export async function ensureServerStatusWatcher(
  env: Env,
  serverId: string,
  db?: Database,
  clientOverride?: IPterodactylClient,
): Promise<ServerStatus> {
  const existing = activeWatchers.get(serverId)
  if (existing) {
    return existing.currentStatus
  }

  const watcher: ServerWatcherState = {
    serverId,
    currentStatus: "UNKNOWN",
    isClosed: false,
    ws: null,
    reconnectTimer: null,
    backoffMs: 5000,
  }
  activeWatchers.set(serverId, watcher)

  // 1. Initial status fetch via Pterodactyl REST
  try {
    const statusMetrics = await getServerStatus(env, clientOverride, serverId, db)
    if (statusMetrics?.status) {
      watcher.currentStatus = statusMetrics.status
      await broadcastServerStatusChanged(env, serverId, watcher.currentStatus)
    }
  } catch (err) {
    console.warn(`[ServerStatusWatcher] Initial status fetch failed for ${serverId}:`, err)
  }

  // 2. Connect to Wings WebSocket for real-time status transitions
  void connectWingsWatcher(env, watcher, db, clientOverride)

  return watcher.currentStatus
}

async function connectWingsWatcher(
  env: Env,
  watcher: ServerWatcherState,
  db?: Database,
  clientOverride?: IPterodactylClient,
): Promise<void> {
  if (watcher.isClosed) return

  let wsCreds: { token: string; socket: string }
  try {
    wsCreds = await getServerConsoleWebsocketCredentials(
      env,
      clientOverride,
      watcher.serverId,
      db,
    )
  } catch {
    // If credentials cannot be fetched (e.g. server unconfigured), don't crash
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

  const wingsOrigin = env.PTERODACTYL_BASE_URL || "https://panel.example.com"

  // In test environments where WebSocketPair is undefined or WebSocket upgrade is not supported
  if (typeof (globalThis as any).WebSocketPair === "undefined") {
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
      scheduleWatcherReconnect(env, watcher, db, clientOverride)
      return
    }

    watcher.ws = upstreamWs
    watcher.backoffMs = 5000
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
      scheduleWatcherReconnect(env, watcher, db, clientOverride)
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
            await broadcastServerStatusChanged(env, watcher.serverId, newStatus)
          }
        } else if (data.event === "token expiring") {
          try {
            const refreshed = await getServerConsoleWebsocketCredentials(
              env,
              clientOverride,
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
      scheduleWatcherReconnect(env, watcher, db, clientOverride)
    })

    upstreamWs.addEventListener("error", () => {
      watcher.ws = null
      scheduleWatcherReconnect(env, watcher, db, clientOverride)
    })
  } catch {
    scheduleWatcherReconnect(env, watcher, db, clientOverride)
  }
}

function scheduleWatcherReconnect(
  env: Env,
  watcher: ServerWatcherState,
  db?: Database,
  clientOverride?: IPterodactylClient,
): void {
  if (watcher.isClosed || watcher.reconnectTimer) return

  watcher.reconnectTimer = setTimeout(() => {
    watcher.reconnectTimer = null
    void connectWingsWatcher(env, watcher, db, clientOverride)
  }, watcher.backoffMs)

  watcher.backoffMs = Math.min(watcher.backoffMs * 2, 60000)
}

export function stopServerStatusWatcher(serverId: string): void {
  const watcher = activeWatchers.get(serverId)
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
    activeWatchers.delete(serverId)
  }
}
