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

export interface LauncherServersFetchResult {
  success: boolean
  servers: LauncherServer[]
  error?: string
}

export const serverService = {
  /**
   * Internal authoritative fetcher against Backend GraphQL launcherServers.
   */
  async fetchLauncherServersAuthoritative(): Promise<LauncherServersFetchResult> {
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
    try {
      const res = await graphqlClient<{ launcherServers: LauncherServer[] }>(query)
      if (res.success && Array.isArray(res.data?.launcherServers)) {
        inMemoryServers = res.data.launcherServers
        return {
          success: true,
          servers: res.data.launcherServers,
        }
      }

      return {
        success: false,
        servers: inMemoryServers,
        error: res.error || "Failed to fetch launcher servers",
      }
    } catch (err: any) {
      return {
        success: false,
        servers: inMemoryServers,
        error: err?.message || "Network error",
      }
    }
  },

  /**
   * Fetch published servers with explicit outcome envelope.
   * Allows consumers to distinguish a valid empty catalog ([])
   * from a network or GraphQL error.
   */
  async getLauncherServersResult(): Promise<LauncherServersFetchResult> {
    const isMocked = Boolean((this.getLauncherServers as any)?.mock)
    if (isMocked) {
      try {
        const mocked = await (this.getLauncherServers as any)()
        return {
          success: true,
          servers: Array.isArray(mocked) ? mocked : [],
        }
      } catch (err: any) {
        return {
          success: false,
          servers: inMemoryServers,
          error: err?.message || "Mock error",
        }
      }
    }

    return this.fetchLauncherServersAuthoritative()
  },

  /**
   * Fetch published servers available to the launcher.
   * Authoritative source is Backend GraphQL launcherServers.
   * Does NOT read or write localStorage catalog cache.
   */
  async getLauncherServers(): Promise<LauncherServer[]> {
    const res = await this.fetchLauncherServersAuthoritative()
    return res.servers
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


