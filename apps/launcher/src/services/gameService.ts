import { graphqlClient, apiClient } from "./apiClient"
import { getApiBaseUrl } from "../config/api"
import type { PublishedModpack, ClientFile, SyncPlanCheckResult } from "../vite-env"

export type GameButtonState =
  | "unavailable"
  | "download"
  | "update"
  | "play"
  | "downloading"
  | "paused"
  | "installing"

export interface GameManifest {
  version: string
  minecraftVersion: string
  neoForgeVersion: string
  totalSizeGB: number
  hasUpdate: boolean
  clientFiles: ClientFile[]
  installed: boolean
  hasExistingInstall?: boolean
}

export const GET_PUBLISHED_MODPACK_QUERY = `
  query GetPublishedModpack {
    publishedModpack {
      version
      minecraftVersion
      neoForgeVersion
      mandatory
      clientFiles {
        path
        sha256
        sizeBytes
        downloadUrl
        policy
      }
    }
  }
`

export const gameService = {
  /**
   * Check published modpack state from GraphQL Backend, with fallback to cached/REST manifest.
   * Filesystem verification is the single source of truth when running in Electron.
   */
  async checkGameManifest(): Promise<GameManifest | null> {
    // 1. Attempt GraphQL Query
    const gqlRes = await graphqlClient<{ publishedModpack: PublishedModpack }>(
      GET_PUBLISHED_MODPACK_QUERY,
    )

    let modpack: PublishedModpack | null = null

    if (gqlRes.success && gqlRes.data?.publishedModpack) {
      modpack = gqlRes.data.publishedModpack
    } else {
      // REST endpoint fallback
      const restRes = await apiClient<PublishedModpack | GameManifest>("/game/manifest")
      if (restRes.success && restRes.data) {
        const raw = restRes.data as any
        modpack = {
          version: raw.version || "1.0.0",
          minecraftVersion: raw.minecraftVersion || "1.21.1",
          neoForgeVersion: raw.neoForgeVersion || "21.1.65",
          clientFiles: Array.isArray(raw.clientFiles) ? raw.clientFiles : [],
        }
      }
    }

    if (modpack) {
      try {
        localStorage.setItem("hikat_game_manifest", JSON.stringify(modpack))
      } catch (_) {}

      const totalBytes = (modpack.clientFiles || []).reduce(
        (sum, file) => sum + (Number(file.sizeBytes) || 0),
        0,
      )
      const totalSizeGB = Number((totalBytes / 1024 / 1024 / 1024).toFixed(2))

      // Check plan with Electron engine if available (Filesystem is the real authority)
      let hasUpdate = false
      let isInstalled = false
      let hasExistingInstall = false

      if (window.electronAPI?.checkSyncPlan && modpack.clientFiles.length > 0) {
        try {
          const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan({
            clientFiles: modpack.clientFiles,
            modpackVersion: modpack.version,
          })
          if (planCheck.success) {
            hasUpdate = planCheck.needsUpdate
            hasExistingInstall = Boolean(planCheck.hasExistingInstall)
            isInstalled = Boolean(
              planCheck.isFullyInstalled ||
                (!planCheck.needsUpdate && modpack.clientFiles.length > 0),
            )
            gameService.setGameInstalled(isInstalled)
          }
        } catch (_) {}
      } else {
        isInstalled = gameService.isGameInstalled()
      }

      return {
        version: modpack.version,
        minecraftVersion: modpack.minecraftVersion || "1.21.1",
        neoForgeVersion: modpack.neoForgeVersion || "21.1.65",
        totalSizeGB,
        hasUpdate,
        clientFiles: modpack.clientFiles,
        installed: isInstalled,
        hasExistingInstall,
      }
    }

    // Offline mode: Try loading cached manifest and verify local filesystem integrity
    try {
      const cached = localStorage.getItem("hikat_game_manifest")
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") {
          const cachedFiles = Array.isArray(parsed.clientFiles) ? parsed.clientFiles : []
          let offlineInstalled = false

          if (window.electronAPI?.checkSyncPlan && cachedFiles.length > 0) {
            try {
              const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan({
                clientFiles: cachedFiles,
                modpackVersion: parsed.version,
              })
              if (planCheck.success && !planCheck.needsUpdate && planCheck.isFullyInstalled) {
                offlineInstalled = true
              }
            } catch (_) {}
          } else {
            offlineInstalled = gameService.isGameInstalled()
          }

          gameService.setGameInstalled(offlineInstalled)

          return {
            version: parsed.version || "1.0.0",
            minecraftVersion: parsed.minecraftVersion || "1.21.1",
            neoForgeVersion: parsed.neoForgeVersion || "21.1.65",
            totalSizeGB: 0,
            hasUpdate: false,
            clientFiles: cachedFiles,
            installed: offlineInstalled,
            hasExistingInstall: offlineInstalled,
          }
        }
      }
    } catch (_) {}

    return null
  },

  isGameInstalled(): boolean {
    try {
      return localStorage.getItem("hikat_game_installed") === "true"
    } catch (_) {
      return false
    }
  },

  setGameInstalled(installed: boolean): void {
    try {
      localStorage.setItem("hikat_game_installed", String(installed))
    } catch (_) {}
  },

  async uninstallGame(): Promise<boolean> {
    try {
      if (window.electronAPI?.uninstallGame) {
        const res = await window.electronAPI.uninstallGame()
        if (res && res.success) {
          try {
            localStorage.removeItem("hikat_game_installed")
            localStorage.removeItem("hikat_game_manifest")
          } catch (_) {}
          return true
        }
        return false
      }
      try {
        localStorage.removeItem("hikat_game_installed")
        localStorage.removeItem("hikat_game_manifest")
      } catch (_) {}
      return true
    } catch (err) {
      console.error("[GameService] Uninstall error:", err)
      return false
    }
  },

  async startSync(clientFiles: ClientFile[], modpackVersion: string) {
    if (window.electronAPI?.startSync) {
      return await window.electronAPI.startSync({
        clientFiles,
        modpackVersion,
        apiBaseUrl: getApiBaseUrl(),
      })
    }
  },

  async pauseSync() {
    if (window.electronAPI?.pauseSync) {
      return await window.electronAPI.pauseSync()
    }
  },

  async cancelSync() {
    if (window.electronAPI?.cancelSync) {
      return await window.electronAPI.cancelSync()
    }
  },

  async launchGame(options: {
    playerName?: string
    ramGB?: number
    neoForgeVersion?: string
    customJavaPath?: string
    customArgs?: string[]
  }) {
    if (window.electronAPI?.launchGame) {
      return await window.electronAPI.launchGame(options)
    }
  },
}
