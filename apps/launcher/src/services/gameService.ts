import { graphqlClient, apiClient } from "./apiClient"
import { getApiBaseUrl } from "../config/api"
import type { PublishedModpack, ClientFile, SyncPlanCheckResult } from "../vite-env"

export type GameButtonState =
  | "checking"
  | "unavailable"
  | "download"
  | "update"
  | "play"
  | "downloading"
  | "paused"
  | "installing"
  | "verifying"
  | "launching"
  | "running"

export interface GameManifest {
  version: string
  minecraftVersion: string
  modLoader: import("../vite-env").GameModLoader
  modLoaderVersion?: string | null
  /** @deprecated Use modLoader + modLoaderVersion */
  neoForgeVersion?: string | null
  totalSizeGB: number
  hasUpdate: boolean
  hasIntegrityIssue?: boolean
  installedModpackVersion?: string | null
  clientFiles: ClientFile[]
  directoryPolicies?: import("../vite-env").DirectoryPolicy[]
  installed: boolean
  hasExistingInstall?: boolean
  hasInterruptedDownload?: boolean
  hasPausedSession?: boolean
  stagedBytes?: number
  totalDownloadBytes?: number
}

export interface ReleaseActivatedEvent {
  type: "RELEASE_ACTIVATED"
  version: string
  minecraftVersion: string
  modLoader?: string
  modLoaderVersion?: string | null
  /** @deprecated */
  neoForgeVersion?: string | null
  mandatory?: boolean
}

export function subscribeReleaseEvents(
  callback: (event: ReleaseActivatedEvent) => void,
): () => void {
  let isClosed = false
  let socket: WebSocket | null = null
  let reconnectTimer: any = null
  let backoffMs = 5000

  const connect = () => {
    if (isClosed) return

    const wsUrl =
      getApiBaseUrl()
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:")
        .replace(/\/$/, "") +
      "/launcher/release-events"

    try {
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        backoffMs = 5000
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data && data.type === "RELEASE_ACTIVATED") {
            callback(data as ReleaseActivatedEvent)
          }
        } catch (_) {}
      }

      socket.onclose = () => {
        if (!isClosed) {
          scheduleReconnect()
        }
      }

      socket.onerror = () => {
        try {
          socket?.close()
        } catch (_) {}
      }
    } catch (_) {
      scheduleReconnect()
    }
  }

  const scheduleReconnect = () => {
    if (isClosed || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoffMs)
    backoffMs = Math.min(backoffMs * 2, 60000)
  }

  connect()

  return () => {
    isClosed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket) {
      try {
        socket.close()
      } catch (_) {}
      socket = null
    }
  }
}

export const GET_PUBLISHED_MODPACK_QUERY = `
  query GetPublishedModpack {
    publishedModpack {
      version
      minecraftVersion
      modLoader
      modLoaderVersion
      neoForgeVersion
      mandatory
      clientFiles {
        path
        sha256
        sizeBytes
        downloadUrl
        policy
      }
      directoryPolicies {
        path
        policy
      }
      notes
      cover {
        id
        mediaType
        mimeType
        sizeBytes
        url
        createdAt
      }
    }
  }
`

export const gameService = {
  /**
   * Fast query to get the current published modpack without disk verification or XMCL checks.
   */
  async getPublishedModpack(): Promise<PublishedModpack | null> {
    const gqlRes = await graphqlClient<{ publishedModpack: PublishedModpack }>(
      GET_PUBLISHED_MODPACK_QUERY,
    )

    if (gqlRes.success && gqlRes.data?.publishedModpack) {
      return gqlRes.data.publishedModpack
    }

    return null
  },

  subscribeReleaseEvents,

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
          minecraftVersion: raw.minecraftVersion,
          modLoader: raw.modLoader || "NEOFORGE",
          modLoaderVersion: raw.modLoaderVersion ?? null,
          neoForgeVersion: raw.neoForgeVersion ?? null,
          clientFiles: Array.isArray(raw.clientFiles) ? raw.clientFiles : [],
          directoryPolicies: Array.isArray(raw.directoryPolicies) ? raw.directoryPolicies : [],
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
      let hasInterruptedDownload = false
      let hasIntegrityIssue = false
      let installedModpackVersion: string | null = null
      let stagedBytes = 0
      let totalDownloadBytes = totalBytes

      if (window.electronAPI?.checkSyncPlan && modpack.clientFiles.length > 0) {
        try {
          const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan({
            clientFiles: modpack.clientFiles,
            directoryPolicies: modpack.directoryPolicies || [],
            modpackVersion: modpack.version,
            minecraftVersion: modpack.minecraftVersion,
            modLoader: modpack.modLoader,
            modLoaderVersion: modpack.modLoaderVersion ?? undefined,
            neoForgeVersion: modpack.neoForgeVersion ?? undefined,
          })
          if (planCheck.success) {
            installedModpackVersion = planCheck.installedModpackVersion || null
            hasUpdate = Boolean(
              installedModpackVersion && installedModpackVersion !== modpack.version,
            )
            hasIntegrityIssue = Boolean(planCheck.hasIntegrityIssue)
            hasExistingInstall = Boolean(planCheck.hasExistingInstall)
            isInstalled = Boolean(planCheck.isFullyInstalled)
            hasInterruptedDownload = Boolean(planCheck.hasInterruptedDownload)
            stagedBytes = planCheck.stagedBytes || 0
            if (Number.isFinite(planCheck.totalDownloadBytes) && planCheck.totalDownloadBytes > 0) {
              totalDownloadBytes = planCheck.totalDownloadBytes
            }
            gameService.setGameInstalled(isInstalled)
          }
        } catch (_) {}
      } else {
        isInstalled = gameService.isGameInstalled()
      }

      return {
        version: modpack.version,
        minecraftVersion: modpack.minecraftVersion,
        modLoader: modpack.modLoader || "NEOFORGE",
        modLoaderVersion: modpack.modLoaderVersion ?? null,
        neoForgeVersion: modpack.neoForgeVersion ?? null,
        totalSizeGB,
        hasUpdate,
        hasIntegrityIssue,
        installedModpackVersion,
        clientFiles: modpack.clientFiles,
        directoryPolicies: modpack.directoryPolicies || [],
        installed: isInstalled,
        hasExistingInstall,
        hasInterruptedDownload,
        stagedBytes,
        totalDownloadBytes,
      }
    }

    // Offline mode: Try loading cached manifest and verify local filesystem integrity
    try {
      const cached = localStorage.getItem("hikat_game_manifest")
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") {
          const cachedFiles = Array.isArray(parsed.clientFiles) ? parsed.clientFiles : []
          const cachedDirectoryPolicies = Array.isArray(parsed.directoryPolicies)
            ? parsed.directoryPolicies
            : []
          let offlineInstalled = false
          let offlineIntegrityIssue = false
          let offlineInstalledVersion: string | null = null
          let offlineHasUpdate = false
          let offlineHasExistingInstall = false

          if (window.electronAPI?.checkSyncPlan && cachedFiles.length > 0) {
            try {
              const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan({
                clientFiles: cachedFiles,
                directoryPolicies: cachedDirectoryPolicies,
                modpackVersion: parsed.version,
                minecraftVersion: parsed.minecraftVersion,
                modLoader: parsed.modLoader,
                modLoaderVersion: parsed.modLoaderVersion,
                neoForgeVersion: parsed.neoForgeVersion,
              })
              if (planCheck.success) {
                offlineInstalledVersion = planCheck.installedModpackVersion || null
                offlineHasUpdate = Boolean(
                  offlineInstalledVersion && offlineInstalledVersion !== parsed.version,
                )
                offlineIntegrityIssue = Boolean(planCheck.hasIntegrityIssue)
                offlineHasExistingInstall = Boolean(planCheck.hasExistingInstall)
                offlineInstalled = Boolean(planCheck.isFullyInstalled)
              }
            } catch (_) {}
          } else {
            offlineInstalled = gameService.isGameInstalled()
          }

          gameService.setGameInstalled(offlineInstalled)

          return {
            version: parsed.version || "1.0.0",
            minecraftVersion: parsed.minecraftVersion,
            modLoader: parsed.modLoader || "NEOFORGE",
            modLoaderVersion: parsed.modLoaderVersion ?? null,
            neoForgeVersion: parsed.neoForgeVersion ?? null,
            totalSizeGB: 0,
            hasUpdate: offlineHasUpdate,
            hasIntegrityIssue: offlineIntegrityIssue,
            installedModpackVersion: offlineInstalledVersion,
            clientFiles: cachedFiles,
            directoryPolicies: cachedDirectoryPolicies,
            installed: offlineInstalled,
            hasExistingInstall: offlineHasExistingInstall,
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

  async startSync(
    clientFiles: ClientFile[],
    modpackVersion: string,
    minecraftVersion?: string,
    modLoader?: import("../vite-env").GameModLoader,
    modLoaderVersion?: string | null,
    neoForgeVersion?: string | null,
    isVerify?: boolean,
    directoryPolicies?: import("../vite-env").DirectoryPolicy[],
  ) {
    if (window.electronAPI?.startSync) {
      return await window.electronAPI.startSync({
        clientFiles,
        directoryPolicies,
        modpackVersion,
        minecraftVersion,
        modLoader,
        modLoaderVersion: modLoaderVersion ?? undefined,
        neoForgeVersion: neoForgeVersion ?? undefined,
        apiBaseUrl: getApiBaseUrl(),
        isVerify,
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
    minecraftVersion?: string
    modLoader?: import("../vite-env").GameModLoader
    modLoaderVersion?: string | null
    neoForgeVersion?: string | null
    customJavaPath?: string
    customArgs?: string[]
  }) {
    if (window.electronAPI?.launchGame) {
      return await window.electronAPI.launchGame({
        ...options,
        modLoaderVersion: options.modLoaderVersion ?? undefined,
        neoForgeVersion: options.neoForgeVersion ?? undefined,
      })
    }
  },
}
