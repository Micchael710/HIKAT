import { graphqlClient } from "./apiClient"
import type { ServerStatusResponse } from "../types"

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
  createdAt: string
  updatedAt: string
}

export const serverService = {
  /**
   * Fetch published servers available to the launcher.
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
          createdAt
          updatedAt
        }
      }
    `
    const res = await graphqlClient<{ launcherServers: LauncherServer[] }>(query)
    if (res.success && Array.isArray(res.data?.launcherServers)) {
      try {
        localStorage.setItem(
          "hikat_launcher_servers",
          JSON.stringify(res.data.launcherServers),
        )
      } catch (_) {}
      return res.data.launcherServers
    }

    try {
      const cached = localStorage.getItem("hikat_launcher_servers")
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed)) return parsed
      }
    } catch (_) {}

    return []
  },

  /**
   * Fetch live Minecraft server ping status & player count.
   * Note: In Phase 1, the backend GraphQL serverStatus query requires ADMIN privileges.
   * The Launcher must not call this administrative query.
   * Returns cached status if available, or null.
   */
  async getServerStatus(serverId?: string): Promise<ServerStatusResponse | null> {
    const cacheKey = serverId
      ? `hikat_cached_server_status_${serverId}`
      : "hikat_cached_server_status"

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


