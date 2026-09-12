import { graphqlClient } from "./apiClient"
import type { ServerStatusResponse } from "../types"

export interface LauncherReleaseSummary {
  version: string
  minecraftVersion: string
  modLoader: string
  modLoaderVersion?: string | null
  neoForgeVersion?: string | null
  notes?: string | null
  cover?: {
    id: string
    mediaType: "IMAGE" | "VIDEO"
    mimeType: string
    url: string
  } | null
}

export interface LauncherServer {
  id: string
  name: string
  minecraftVersion: string
  modLoader: string
  modLoaderVersion?: string | null
  mainLogo?: {
    id: string
    url: string
  } | null
  sidebarLogo?: {
    id: string
    url: string
  } | null
  accentColor?: string | null
  launcherActiveReleaseId: string
  activeRelease?: LauncherReleaseSummary | null
  createdAt: string
  updatedAt: string
}

let inMemoryServers: LauncherServer[] = []

export const serverService = {
  /**
   * Fetch published servers available to the launcher.
   * Authoritative source is Backend GraphQL launcherServers.
   * Does NOT read or write localStorage catalog cache.
   */
  async getLauncherServers(): Promise<LauncherServer[]> {
    const query = /* GraphQL */ `
      query GetLauncherServers {
        launcherServers {
          id
          name
          minecraftVersion
          modLoader
          modLoaderVersion
          mainLogo {
            id
            url
          }
          sidebarLogo {
            id
            url
          }
          accentColor
          launcherActiveReleaseId
          activeRelease {
            version
            minecraftVersion
            modLoader
            modLoaderVersion
            neoForgeVersion
            notes
            cover {
              id
              mediaType
              mimeType
              url
            }
          }
          createdAt
          updatedAt
        }
      }
    `
    const res = await graphqlClient<{ launcherServers: LauncherServer[] }>(query)
    if (res.success && Array.isArray(res.data?.launcherServers)) {
      inMemoryServers = res.data.launcherServers
      return res.data.launcherServers
    }

    return inMemoryServers
  },

  /**
   * Fetch lightweight live Minecraft server ping (latency & players) via GraphQL.
   */
  async getServerPing(serverId: string): Promise<LauncherServerPingResult | null> {
    try {
      const res = await graphqlClient<{ launcherServerPing: LauncherServerPingResult | null }>(
        LAUNCHER_SERVER_PING_QUERY,
        { serverId },
      )
      if (res.success && res.data?.launcherServerPing) {
        return res.data.launcherServerPing
      }
    } catch (_) {}

    return null
  },

  /**
   * Fetch live Minecraft server ping status & player count.
   * Returns cached per-server status if available, or null.
   * Does NOT use global cached status.
   */
  async getServerStatus(serverId?: string): Promise<ServerStatusResponse | null> {
    const cacheKey = serverId ? `hikat_cached_server_status_${serverId}` : "hikat_cached_server_status"

    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") return parsed
      }
    } catch (_) {}

    return null
  },
}

export interface LauncherServerPingResult {
  latencyMs: number
  playersOnline: number
  maxPlayers: number
}

export const LAUNCHER_SERVER_PING_QUERY = /* GraphQL */ `
  query LauncherServerPing($serverId: ID!) {
    launcherServerPing(serverId: $serverId) {
      latencyMs
      playersOnline
      maxPlayers
    }
  }
`


