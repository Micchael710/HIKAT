import { apiClient, ApiResponse } from "./apiClient"
import { ServerStatusResponse, PlayerStats } from "../types"

export const serverService = {
  /**
   * Fetch live Minecraft server ping status & player count.
   * Returns null if unreachable and no cache exists.
   */
  async getServerStatus(): Promise<ServerStatusResponse | null> {
    const res = await apiClient<ServerStatusResponse>("/server/status")

    if (res.success && res.data) {
      try {
        localStorage.setItem(
          "hikat_cached_server_status",
          JSON.stringify(res.data),
        )
      } catch (_) {}
      return res.data
    }

    try {
      const cached = localStorage.getItem("hikat_cached_server_status")
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") return parsed
      }
    } catch (_) {}

    return null
  },

  /**
   * Fetch user gameplay stats (playtime, achievements, rank).
   * Returns null if unreachable and no cache exists.
   */
  async getPlayerStats(username?: string): Promise<PlayerStats | null> {
    const user = username || "player"
    const res = await apiClient<PlayerStats>(
      `/players/${encodeURIComponent(user)}/stats`,
    )

    if (res.success && res.data) {
      try {
        localStorage.setItem(
          `hikat_user_${user}_stats`,
          JSON.stringify(res.data),
        )
      } catch (_) {}
      return res.data
    }

    try {
      const cached = localStorage.getItem(`hikat_user_${user}_stats`)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") return parsed
      }
    } catch (_) {}

    return null
  },
}
