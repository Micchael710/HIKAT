import { graphqlClient } from "./apiClient"
import { getApiBaseUrl } from "../config/api"
import type { PublishedModpack, ClientFile, SyncPlanCheckResult } from "../vite-env"

export type GameButtonState =
  | "checking"
  | "unavailable"
  | "download"
  | "update"
  | "play"
  | "queued"
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
  pausedProgress?: number
  pausedPhase?: string
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

export interface ServerUpdatedEvent {
  type: "SERVER_UPDATED"
  serverId: string
}

export type LauncherEvent =
  | ReleaseActivatedEvent
  | ServerUpdatedEvent

const releaseEventListeners = new Set<(event: LauncherEvent) => void>()
let sharedReleaseSocket: WebSocket | null = null
let sharedReconnectTimer: any = null
let sharedBackoffMs = 5000

function connectSharedReleaseSocket() {
  if (releaseEventListeners.size === 0) return
  if (sharedReleaseSocket) return

  const wsUrl =
    getApiBaseUrl()
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/$/, "") +
    "/launcher/release-events"

  try {
    const socket = new WebSocket(wsUrl)
    sharedReleaseSocket = socket

    socket.onopen = () => {
      if (sharedReleaseSocket !== socket) return
      sharedBackoffMs = 5000
    }

    socket.onmessage = (event) => {
      if (sharedReleaseSocket !== socket) return
      try {
        const data = JSON.parse(event.data)
        if (data && (data.type === "RELEASE_ACTIVATED" || data.type === "SERVER_UPDATED")) {
          for (const listener of [...releaseEventListeners]) {
            try {
              listener(data as LauncherEvent)
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    socket.onclose = () => {
      if (sharedReleaseSocket === socket) {
        sharedReleaseSocket = null
        if (releaseEventListeners.size > 0) {
          scheduleSharedReconnect()
        }
      }
    }

    socket.onerror = () => {
      try {
        socket.close()
      } catch (_) {}
    }
  } catch (_) {
    sharedReleaseSocket = null
    scheduleSharedReconnect()
  }
}

function scheduleSharedReconnect() {
  if (releaseEventListeners.size === 0 || sharedReconnectTimer) return
  sharedReconnectTimer = setTimeout(() => {
    sharedReconnectTimer = null
    connectSharedReleaseSocket()
  }, sharedBackoffMs)
  sharedBackoffMs = Math.min(sharedBackoffMs * 2, 60000)
}

function cleanupSharedReleaseSocket() {
  if (sharedReconnectTimer) {
    clearTimeout(sharedReconnectTimer)
    sharedReconnectTimer = null
  }
  sharedBackoffMs = 5000
  if (sharedReleaseSocket) {
    const s = sharedReleaseSocket
    sharedReleaseSocket = null
    try {
      s.close()
    } catch (_) {}
  }
}

export function subscribeReleaseEvents(
  callback: (event: LauncherEvent) => void,
): () => void {
  releaseEventListeners.add(callback)

  if (releaseEventListeners.size === 1 || !sharedReleaseSocket) {
    connectSharedReleaseSocket()
  }

  return () => {
    releaseEventListeners.delete(callback)
    if (releaseEventListeners.size === 0) {
      cleanupSharedReleaseSocket()
    }
  }
}

export function _resetReleaseEventsSubscriptionForTesting() {
  releaseEventListeners.clear()
  cleanupSharedReleaseSocket()
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
   * - GraphQL SUCCESS + modpack real: update cache & verify filesystem if allowLegacyLocalFilesystem is true.
   * - GraphQL SUCCESS + publishedModpack: null: authoritative null (no modpack published),
   *   invalidates stale cache and returns null without REST fallback.
   * - NETWORK_ERROR / TIMEOUT: fallback to cached offline manifest.
   * - Non-connectivity errors (SESSION_EXPIRED, application errors): returns null.
   */
  async checkGameManifest(
    serverId?: string,
    options?: {
      allowLegacyLocalFilesystem?: boolean
      gameContext?: {
        gameId: string
        gameName: string
      }
    },
  ): Promise<GameManifest | null> {
    let isConnectivityFailure = false
    const cacheKey = serverId ? `hikat_game_manifest_${serverId}` : "hikat_game_manifest"
    const allowLegacyLocal = serverId
      ? options?.allowLegacyLocalFilesystem === true
      : (options?.allowLegacyLocalFilesystem ?? true)
    const allowSyncPlanCheck = options?.gameContext ? true : allowLegacyLocal
    const effectiveGameId = options?.gameContext?.gameId || serverId

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
          let pausedProgress: number | undefined
          let pausedPhase: string | undefined
          let stagedBytes = 0
          let totalDownloadBytes = totalBytes

          if (allowSyncPlanCheck && window.electronAPI?.checkSyncPlan && Array.isArray(modpack.clientFiles)) {
            try {
              const planPayload: any = {
                clientFiles: modpack.clientFiles,
                directoryPolicies: modpack.directoryPolicies || [],
                modpackVersion: modpack.version,
                minecraftVersion: modpack.minecraftVersion,
                modLoader: modpack.modLoader,
                modLoaderVersion: modpack.modLoaderVersion ?? undefined,
                neoForgeVersion: modpack.neoForgeVersion ?? undefined,
              }
              if (options?.gameContext) {
                planPayload.gameId = options.gameContext.gameId
                planPayload.gameName = options.gameContext.gameName
              }
              const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan(planPayload)
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
                pausedProgress = typeof planCheck.pausedProgress === "number" ? planCheck.pausedProgress : undefined
                pausedPhase = planCheck.pausedPhase || undefined
                stagedBytes = planCheck.stagedBytes || 0
                if (
                  Number.isFinite(planCheck.totalDownloadBytes) &&
                  planCheck.totalDownloadBytes > 0
                ) {
                  totalDownloadBytes = planCheck.totalDownloadBytes
                }
                gameService.setGameInstalled(isInstalled, effectiveGameId)
              }
            } catch (_) {}
          } else if (allowSyncPlanCheck) {
            isInstalled = gameService.isGameInstalled(effectiveGameId)
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
            pausedProgress,
            pausedPhase,
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
          let offlinePausedProgress: number | undefined
          let offlinePausedPhase: string | undefined
          let offlineStagedBytes = 0
          let offlineTotalDownloadBytes = 0

          if (allowSyncPlanCheck && window.electronAPI?.checkSyncPlan && Array.isArray(cachedFiles)) {
            try {
              const offlinePayload: any = {
                clientFiles: cachedFiles,
                directoryPolicies: cachedDirectoryPolicies,
                modpackVersion: parsed.version,
                minecraftVersion: parsed.minecraftVersion,
                modLoader: parsed.modLoader,
                modLoaderVersion: parsed.modLoaderVersion ?? undefined,
                neoForgeVersion: parsed.neoForgeVersion ?? undefined,
              }
              if (options?.gameContext) {
                offlinePayload.gameId = options.gameContext.gameId
                offlinePayload.gameName = options.gameContext.gameName
              }
              const planCheck: SyncPlanCheckResult = await window.electronAPI.checkSyncPlan(offlinePayload)
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
                offlinePausedProgress = typeof planCheck.pausedProgress === "number" ? planCheck.pausedProgress : undefined
                offlinePausedPhase = planCheck.pausedPhase || undefined
                offlineStagedBytes = planCheck.stagedBytes || 0
                offlineTotalDownloadBytes = planCheck.totalDownloadBytes || 0
                gameService.setGameInstalled(offlineInstalled, effectiveGameId)
              }
            } catch (_) {}
          } else if (allowSyncPlanCheck) {
            offlineInstalled = gameService.isGameInstalled(effectiveGameId)
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
            pausedProgress: offlinePausedProgress,
            pausedPhase: offlinePausedPhase,
            stagedBytes: offlineStagedBytes,
            totalDownloadBytes: offlineTotalDownloadBytes || (offlineInstalled ? 0 : totalBytes),
          }
        }
      }
    } catch (_) {}

    return null
  },

  isGameInstalled(gameId?: string): boolean {
    try {
      const key = gameId ? `hikat_game_installed_${gameId}` : "hikat_game_installed"
      return localStorage.getItem(key) === "true"
    } catch (_) {
      return false
    }
  },

  setGameInstalled(installed: boolean, gameId?: string): void {
    try {
      const key = gameId ? `hikat_game_installed_${gameId}` : "hikat_game_installed"
      localStorage.setItem(key, String(installed))
    } catch (_) {}
  },

  async uninstallGame(gameContext?: { gameId: string; gameName: string }): Promise<boolean> {
    try {
      if (window.electronAPI?.uninstallGame) {
        const res = await window.electronAPI.uninstallGame(gameContext)
        if (res && res.success) {
          try {
            if (gameContext?.gameId) {
              localStorage.removeItem(`hikat_game_installed_${gameContext.gameId}`)
              localStorage.removeItem(`hikat_game_manifest_${gameContext.gameId}`)
            } else {
              localStorage.removeItem("hikat_game_installed")
              localStorage.removeItem("hikat_game_manifest")
            }
          } catch (_) {}
          return true
        }
        return false
      }
      try {
        if (gameContext?.gameId) {
          localStorage.removeItem(`hikat_game_installed_${gameContext.gameId}`)
          localStorage.removeItem(`hikat_game_manifest_${gameContext.gameId}`)
        } else {
          localStorage.removeItem("hikat_game_installed")
          localStorage.removeItem("hikat_game_manifest")
        }
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
    gameContext?: { gameId: string; gameName: string } | null,
    options?: { resume?: boolean },
  ) {
    let actualDirectoryPolicies = directoryPolicies
    let actualGameContext = gameContext
    if (directoryPolicies && !Array.isArray(directoryPolicies) && (directoryPolicies as any).gameId) {
      actualGameContext = directoryPolicies as any
      actualDirectoryPolicies = []
    }
    if (window.electronAPI?.startSync) {
      return await window.electronAPI.startSync({
        clientFiles,
        directoryPolicies: actualDirectoryPolicies,
        modpackVersion,
        minecraftVersion,
        modLoader,
        modLoaderVersion: modLoaderVersion ?? undefined,
        neoForgeVersion: neoForgeVersion ?? undefined,
        apiBaseUrl: getApiBaseUrl(),
        isVerify,
        gameId: actualGameContext?.gameId,
        gameName: actualGameContext?.gameName,
        ...(options?.resume ? { resume: true } : {}),
      })
    }
  },

  async resumeSync(gameContext?: { gameId: string; gameName: string } | null) {
    if (typeof this.startSync === "function") {
      return await this.startSync([], "", undefined, undefined, undefined, undefined, false, undefined, gameContext, { resume: true })
    }
    if (window.electronAPI?.startSync) {
      return await window.electronAPI.startSync({
        gameId: gameContext?.gameId,
        gameName: gameContext?.gameName,
        resume: true,
      })
    }
  },

  async pauseSync(gameContext?: { gameId: string; gameName: string }) {
    if (window.electronAPI?.pauseSync) {
      return await window.electronAPI.pauseSync(gameContext)
    }
  },

  async cancelSync(gameContext?: { gameId: string; gameName: string }) {
    if (window.electronAPI?.cancelSync) {
      return await window.electronAPI.cancelSync(gameContext)
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
    gameContext?: { gameId: string; gameName: string }
  }) {
    if (window.electronAPI?.launchGame) {
      return await window.electronAPI.launchGame({
        ...options,
        modLoaderVersion: options.modLoaderVersion ?? undefined,
        neoForgeVersion: options.neoForgeVersion ?? undefined,
        gameId: options.gameContext?.gameId,
        gameName: options.gameContext?.gameName,
      })
    }
  },
}
