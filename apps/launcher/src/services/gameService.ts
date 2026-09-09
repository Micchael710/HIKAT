import { graphqlClient } from "./apiClient"
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
  serverId?: string | null
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
    if (isClosed) return
    if (reconnectTimer) clearTimeout(reconnectTimer)

    reconnectTimer = setTimeout(() => {
      backoffMs = Math.min(backoffMs * 1.5, 30000)
      connect()
    }, backoffMs)
  }

  connect()

  return () => {
    isClosed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    try {
      socket?.close()
    } catch (_) {}
  }
}

export const GET_PUBLISHED_MODPACK_QUERY = `
  query GetPublishedModpack($serverId: ID) {
    publishedModpack(serverId: $serverId) {
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
  async getPublishedModpack(serverId?: string): Promise<PublishedModpack | null> {
    const gqlRes = await graphqlClient<{ publishedModpack: PublishedModpack | null }>(
      GET_PUBLISHED_MODPACK_QUERY,
      serverId ? { serverId } : undefined,
    )

    if (gqlRes.success && gqlRes.data?.publishedModpack) {
      return gqlRes.data.publishedModpack
    }

    return null
  },

  subscribeReleaseEvents,

  /**
   * Check published modpack state from authoritative GraphQL Backend.
   * - GraphQL SUCCESS + modpack real: update cache & verify filesystem.
   * - GraphQL SUCCESS + publishedModpack: null: authoritative null (no modpack published),
   *   invalidates stale cache and returns null without REST fallback.
   * - NETWORK_ERROR / TIMEOUT: fallback to cached offline manifest.
   * - Non-connectivity errors (SESSION_EXPIRED, application errors): returns null.
   */
  async checkGameManifest(serverId?: string): Promise<GameManifest | null> {
    let isConnectivityFailure = false
    const cacheKey = serverId ? `hikat_game_manifest_${serverId}` : "hikat_game_manifest"

    try {
      const gqlRes = await graphqlClient<{ publishedModpack: PublishedModpack | null }>(
        GET_PUBLISHED_MODPACK_QUERY,
        serverId ? { serverId } : undefined,
      )

      if (gqlRes.success) {
        if (gqlRes.data?.publishedModpack) {
          const modpack = gqlRes.data.publishedModpack
          try {
            localStorage.setItem(cacheKey, JSON.stringify(modpack))
          } catch (_) {}

          const totalBytes = (modpack.clientFiles || []).reduce(
            (sum, file) => sum + (Number(file.sizeBytes) || 0),
            0,
          )
          const totalSizeGB = Number((totalBytes / 1024 / 1024 / 1024).toFixed(2))

          let hasUpdate = false
          let isInstalled = false
          let hasExistingInstall = false
          let hasInterruptedDownload = false
          let hasPausedSession = false
          let hasIntegrityIssue = false
          let installedModpackVersion: string | null = null
          let stagedBytes = 0
          let totalDownloadBytes = totalBytes

          // In Phase 1: only run local filesystem checkSyncPlan for legacy/default server
          // to avoid mixing global Apparatia filesystem verification with other servers.
          const isLegacySingleGame = !serverId || serverId === "apparatia"
          if (isLegacySingleGame && window.electronAPI?.checkSyncPlan && modpack.clientFiles.length > 0) {
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
                hasPausedSession = Boolean(planCheck.hasPausedSession)
                stagedBytes = planCheck.stagedBytes || 0
                if (
                  Number.isFinite(planCheck.totalDownloadBytes) &&
                  planCheck.totalDownloadBytes > 0
                ) {
                  totalDownloadBytes = planCheck.totalDownloadBytes
                }
                gameService.setGameInstalled(isInstalled)
              }
            } catch (_) {}
          } else if (isLegacySingleGame) {
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
            hasPausedSession,
            stagedBytes,
            totalDownloadBytes,
          }
        }

        // B) GraphQL SUCCESS + publishedModpack === null
        // Authoritative server state: No published modpack exists.
        // Invalidate stale cached manifest and return null.
        try {
          localStorage.removeItem(cacheKey)
        } catch (_) {}
        return null
      }

      // Authoritative transport failures only: NETWORK_ERROR or TIMEOUT
      isConnectivityFailure =
        gqlRes.errorCode === "NETWORK_ERROR" || gqlRes.errorCode === "TIMEOUT"
    } catch (_) {
      isConnectivityFailure = false
    }

    if (!isConnectivityFailure) {
      // Non-connectivity error (e.g. GRAPHQL_ERROR, SESSION_EXPIRED, AUTH_REFRESH_TRANSIENT_FAILURE, URL_BLOCKED, HTTP_*)
      return null
    }

    // C) Fallo REAL de conectividad GraphQL (NETWORK_ERROR o TIMEOUT) -> offline fallback
    try {
      const cached = localStorage.getItem(cacheKey)
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
          let offlineHasInterruptedDownload = false
          let offlineHasPausedSession = false
          let offlineStagedBytes = 0
          let offlineTotalDownloadBytes = 0
          const isLegacySingleGame = !serverId || serverId === "apparatia"

          if (isLegacySingleGame && window.electronAPI?.checkSyncPlan && cachedFiles.length > 0) {
            try {
              const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan({
                clientFiles: cachedFiles,
                directoryPolicies: cachedDirectoryPolicies,
                modpackVersion: parsed.version,
                minecraftVersion: parsed.minecraftVersion,
                modLoader: parsed.modLoader,
                modLoaderVersion: parsed.modLoaderVersion ?? undefined,
                neoForgeVersion: parsed.neoForgeVersion ?? undefined,
              })
              if (planCheck.success) {
                offlineInstalledVersion = planCheck.installedModpackVersion || null
                offlineHasUpdate = Boolean(
                  offlineInstalledVersion && offlineInstalledVersion !== parsed.version,
                )
                offlineIntegrityIssue = Boolean(planCheck.hasIntegrityIssue)
                offlineHasExistingInstall = Boolean(planCheck.hasExistingInstall)
                offlineInstalled = Boolean(planCheck.isFullyInstalled)
                offlineHasInterruptedDownload = Boolean(planCheck.hasInterruptedDownload)
                offlineHasPausedSession = Boolean(planCheck.hasPausedSession)
                offlineStagedBytes = planCheck.stagedBytes || 0
                offlineTotalDownloadBytes = planCheck.totalDownloadBytes || 0
                gameService.setGameInstalled(offlineInstalled)
              }
            } catch (_) {}
          } else if (isLegacySingleGame) {
            offlineInstalled = gameService.isGameInstalled()
          }

          const totalBytes = cachedFiles.reduce(
            (sum: number, file: any) => sum + (Number(file.sizeBytes) || 0),
            0,
          )

          return {
            version: parsed.version || "1.0.0",
            minecraftVersion: parsed.minecraftVersion || "1.21.1",
            modLoader: parsed.modLoader || "NEOFORGE",
            modLoaderVersion: parsed.modLoaderVersion ?? null,
            neoForgeVersion: parsed.neoForgeVersion ?? null,
            totalSizeGB: Number((totalBytes / 1024 / 1024 / 1024).toFixed(2)),
            hasUpdate: offlineHasUpdate,
            hasIntegrityIssue: offlineIntegrityIssue,
            installedModpackVersion: offlineInstalledVersion,
            clientFiles: cachedFiles,
            directoryPolicies: cachedDirectoryPolicies,
            installed: offlineInstalled,
            hasExistingInstall: offlineHasExistingInstall,
            hasInterruptedDownload: offlineHasInterruptedDownload,
            hasPausedSession: offlineHasPausedSession,
            stagedBytes: offlineStagedBytes,
            totalDownloadBytes: offlineTotalDownloadBytes || (offlineInstalled ? 0 : totalBytes),
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
