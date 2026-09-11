import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { PublishedModpack } from "../../vite-env"
import { ThemeMode } from "../../types"
import {
  IconDownload,
  IconPlay,
  IconPause,
  IconResume,
} from "../../theme/icons"
import { BASE_FONT } from "../../theme/tokens"
import { useTranslation } from "../../context/LanguageContext"
import {
  gameService,
  GameButtonState,
  GameManifest,
  ReleaseActivatedEvent,
} from "../../services/gameService"
import {
  STORAGE_KEYS,
  SETTINGS_CHANGED_EVENT,
  getStoredBoolean,
} from "../../utils/settingsStorage"
import LiveToast from "../common/LiveToast"
import type { AccentColor } from "../../utils/dynamicAccent"

interface DownloadPlayButtonProps {
  left: number
  top: number
  theme?: ThemeMode
  onPlay?: () => void
  serverId?: string | null
  gameId?: string | null
  gameContext?: {
    gameId: string
    gameName: string
  } | null
  accent?: AccentColor
  allowLegacyLocalOperations?: boolean
  publishedModpack?: PublishedModpack | null
  installedVersion?: string | null
  integrityDirty?: boolean
  onInstalledVersionChange?: (version: string | null) => void
  onClearIntegrityDirty?: () => void
}

export function buildManifestFromPublished(
  published: PublishedModpack | null | undefined,
  installedVersion: string | null | undefined,
  integrityDirty?: boolean,
): GameManifest | null {
  if (!published || !published.version) return null
  const clientFiles = published.clientFiles || []
  const totalBytes = manifestTotalBytes(clientFiles)
  const totalSizeGB = Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2))
  const isInstalled = Boolean(installedVersion)
  const hasUpdate = Boolean(isInstalled && installedVersion !== published.version)

  return {
    version: published.version,
    minecraftVersion: published.minecraftVersion || "",
    modLoader: (published.modLoader as any) || "NEOFORGE",
    modLoaderVersion: published.modLoaderVersion || null,
    neoForgeVersion: published.neoForgeVersion || null,
    totalSizeGB,
    hasUpdate,
    hasIntegrityIssue: Boolean(integrityDirty),
    installedModpackVersion: installedVersion || null,
    clientFiles,
    directoryPolicies: (published.directoryPolicies && published.directoryPolicies.length > 0) ? published.directoryPolicies : undefined,
    installed: isInstalled && !hasUpdate,
    hasExistingInstall: isInstalled,
    totalDownloadBytes: isInstalled ? 0 : totalBytes,
  }
}

export function deriveBaseGameButtonState(
  published: PublishedModpack | null | undefined,
  installedVersion: string | null | undefined,
): GameButtonState {
  if (!published || !published.version) return "unavailable"
  if (!installedVersion) return "download"
  if (installedVersion !== published.version) return "update"
  return "play"
}

export function resolveIdleGameButtonState(
  manifest: GameManifest | null | undefined,
  gameId?: string,
): GameButtonState {
  if (!manifest) {
    return gameService.isGameInstalled(gameId) ? "play" : "unavailable"
  }

  if (!manifest.installedModpackVersion) {
    return (!manifest.clientFiles?.length && !manifest.version) ? "unavailable" : "download"
  }

  if (manifest.installedModpackVersion !== manifest.version) {
    return "update"
  }

  return "play"
}

export function manifestTotalBytes(files?: any[] | null): number {
  return (files || []).reduce(
    (sum: number, file: any) => sum + (Number(file.sizeBytes) || 0),
    0,
  )
}

export function formatDownloadSize(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0)

  const MB = 1024 ** 2
  const GB = 1024 ** 3

  if (value >= GB) {
    const gb = value / GB

    return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`
  }

  const mb = value / MB

  return `${mb.toFixed(mb >= 100 ? 1 : 2)} MB`
}

export default function DownloadPlayButton({
  left,
  top,
  theme = "dark",
  onPlay,
  serverId,
  gameId,
  gameContext,
  accent,
  allowLegacyLocalOperations,
  publishedModpack,
  installedVersion,
  integrityDirty,
  onInstalledVersionChange,
  onClearIntegrityDirty,
}: DownloadPlayButtonProps) {
  const { t } = useTranslation()
  const activeServerId = gameContext?.gameId || serverId || gameId || undefined
  const effectiveGameContext = gameContext || undefined
  const isLocalAllowed = gameContext !== undefined
    ? Boolean(gameContext?.gameId)
    : (allowLegacyLocalOperations ?? (!activeServerId))

  const hasProvidedState = publishedModpack !== undefined
  const initialBaseStatus: GameButtonState = hasProvidedState
    ? deriveBaseGameButtonState(publishedModpack, installedVersion)
    : "checking"

  const [status, setStatusState] = useState<GameButtonState>(initialBaseStatus)
  const statusRef = useRef<GameButtonState>(initialBaseStatus)

  const accentHex = accent?.hex || "#efc436"
  const accentCss = accent?.css || "239, 196, 54"
  const accentLighter = accent
    ? `color-mix(in srgb, ${accent.hex} 55%, white)`
    : "#ffe692"
  const accentDarkForLight = accent
    ? `color-mix(in srgb, ${accent.hex} 65%, black)`
    : "#92400e"
  const accentGlow = `rgba(${accentCss}, 0.45)`

  const setStatus = useCallback((next: GameButtonState | ((prev: GameButtonState) => GameButtonState)) => {
    setStatusState((prev: GameButtonState) => {
      const resolved = typeof next === "function" ? next(prev) : next
      statusRef.current = resolved
      return resolved
    })
  }, [])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const initialManifest = useMemo(
    () => (hasProvidedState ? buildManifestFromPublished(publishedModpack, installedVersion, integrityDirty) : null),
    [],
  )
  const [manifest, setManifest] = useState<GameManifest | null>(initialManifest)
  const manifestRef = useRef<GameManifest | null>(initialManifest)
  manifestRef.current = manifest

  const [progress, setProgress] = useState(0)
  const highWaterProgressRef = useRef(0)
  const currentPhaseRef = useRef<string | null>(null)
  const pausedPhaseRef = useRef<"downloading" | "installing">("downloading")
  const [speed, setSpeed] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [timeRemainingMin, setTimeRemainingMin] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [canPauseState, setCanPauseState] = useState<boolean | undefined>(undefined)
  const [canCancelState, setCanCancelState] = useState<boolean | undefined>(undefined)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [toastState, setToastState] = useState<{
    message: string | null
    type: "success" | "error" | "info"
  }>({
    message: null,
    type: "success",
  })
  const menuRef = useRef<HTMLDivElement>(null)
  const toastTimeoutRef = useRef<any>(null)
  const isStartingSyncRef = useRef(false)
  const syncOpIdRef = useRef(0)
  const isCancellingRef = useRef(false)
  const latestManifestVersionRef = useRef<string | null>(null)
  const isIntegrityBlockedRef = useRef<boolean>(Boolean(integrityDirty))
  const pendingAutoUpdateRef = useRef(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isLaunchBlockedByOtherGame, setIsLaunchBlockedByOtherGame] = useState(false)
  const isDark = theme === "dark"

  useEffect(() => {
    if (integrityDirty !== undefined) {
      isIntegrityBlockedRef.current = integrityDirty
    }
  }, [integrityDirty])

  useEffect(() => {
    if (publishedModpack === undefined) return
    const updated = buildManifestFromPublished(publishedModpack, installedVersion, integrityDirty)
    setManifest(updated)
    const baseState = deriveBaseGameButtonState(publishedModpack, installedVersion)
    setStatus((prev) => {
      if (
        prev === "download" ||
        prev === "update" ||
        prev === "play" ||
        prev === "unavailable" ||
        prev === "checking"
      ) {
        return baseState
      }
      return prev
    })
  }, [publishedModpack, installedVersion, integrityDirty])

  useEffect(() => {
    latestManifestVersionRef.current = manifest?.version ?? null
  }, [manifest?.version])

  // Listen to filesystem integrity changes while launcher is open (marks integrity lock silently)
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onGameFileIntegrityChanged?.((data: any) => {
      if (gameContext) {
        if (data?.gameId !== gameContext.gameId) return
      } else {
        if (data?.gameId) return
      }
      isIntegrityBlockedRef.current = true
    })

    return () => {
      unsubscribe?.()
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [gameContext?.gameId])

  const showToast = useCallback((
    msg: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setToastState({ message: msg, type })
    toastTimeoutRef.current = setTimeout(() => {
      setToastState({ message: null, type: "success" })
    }, 2800)
  }, [])

  const markSyncedVersionInstalled = useCallback((syncingVersion: string) => {
    setManifest((current) => {
      if (!current) {
        return current
      }

      const isCurrentVersion = current.version === syncingVersion

      return {
        ...current,
        installed: isCurrentVersion,
        hasUpdate: !isCurrentVersion,
        hasExistingInstall: true,
        installedModpackVersion: syncingVersion,
        hasIntegrityIssue: false,
      }
    })
  }, [])

  const triggerSync = useCallback((targetManifest?: GameManifest | null) => {
    if (!isLocalAllowed) return
    const currentManifest = targetManifest || manifestRef.current
    if (
      !currentManifest ||
      !Array.isArray(currentManifest.clientFiles) ||
      !currentManifest.version ||
      !currentManifest.minecraftVersion
    ) {
      showToast(t("playButton.noClientFiles"), "error")
      return
    }
    if (isStartingSyncRef.current) return
    const syncOpId = ++syncOpIdRef.current
    isStartingSyncRef.current = true
    setDownloadedBytes(0)
    highWaterProgressRef.current = 0
    currentPhaseRef.current = "DOWNLOADING"
    setProgress(0)
    setSpeed(0)
    setTimeRemainingMin(0)
    if (currentManifest.hasExistingInstall || currentManifest.hasUpdate) {
      setTotalBytes(currentManifest.totalDownloadBytes && currentManifest.totalDownloadBytes > 0 ? currentManifest.totalDownloadBytes : 0)
    }
    setStatus("downloading")

    const syncingVersion = currentManifest.version

    gameService
      .startSync(
        currentManifest.clientFiles,
        currentManifest.version,
        currentManifest.minecraftVersion,
        currentManifest.modLoader,
        currentManifest.modLoaderVersion,
        currentManifest.neoForgeVersion,
        false,
        ...(currentManifest.directoryPolicies ? [currentManifest.directoryPolicies] : []),
        ...(gameContext ? [gameContext] : []),
      )
      .then((res: any) => {
        if (res?.queued) {
          setStatus("queued")
          isStartingSyncRef.current = false
          return
        }
        if (res?.paused) {
          setStatus("paused")
          return
        }
        if (res?.alreadyActive) {
          return
        }
        if (res?.success) {
          isIntegrityBlockedRef.current = false
          onClearIntegrityDirty?.()
          onInstalledVersionChange?.(syncingVersion)
          gameService.setGameInstalled(true, gameContext?.gameId)
          markSyncedVersionInstalled(syncingVersion)

          const hasNewerRelease = Boolean(
            latestManifestVersionRef.current &&
            latestManifestVersionRef.current !== syncingVersion
          )
          const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
          const currentLatestManifest = manifestRef.current
          const isGameBusy = statusRef.current === "launching" || statusRef.current === "running"

          if (hasNewerRelease) {
            if (
              autoUpdatesEnabled &&
              currentLatestManifest &&
              currentLatestManifest.version === latestManifestVersionRef.current &&
              Array.isArray(currentLatestManifest.clientFiles) &&
              !isGameBusy
            ) {
              showToast(t("playButton.syncSuccess"), "success")
              const nextManifest: GameManifest = {
                ...currentLatestManifest,
                installedModpackVersion: syncingVersion,
                hasUpdate: true,
                hasExistingInstall: true,
              }
              setManifest(nextManifest)
              isStartingSyncRef.current = false
              triggerSync(nextManifest)
              return
            } else {
              if (syncOpIdRef.current === syncOpId) {
                isStartingSyncRef.current = false
              }
              setStatus("update")
            }
          } else {
            if (syncOpIdRef.current === syncOpId) {
              isStartingSyncRef.current = false
            }
            setStatus("play")
          }

          showToast(t("playButton.syncSuccess"), "success")
        }
      })
      .catch((err: any) => {
        const msg = String(err?.message || err || "").toLowerCase()
        if (isCancellingRef.current || msg.includes("cancel") || msg.includes("abort")) {
          return
        }
        console.error("Sync error:", err)
        gameService.setGameInstalled(false, gameContext?.gameId)
        setStatus(resolveIdleGameButtonState(currentManifest, activeServerId))
        showToast(t("playButton.syncError"), "error")
      })
      .finally(() => {
        if (syncOpIdRef.current === syncOpId) {
          isStartingSyncRef.current = false
        }
      })
  }, [isLocalAllowed, markSyncedVersionInstalled, setStatus, showToast, t, gameContext, activeServerId])

  // Close options menu on click outside
  useEffect(() => {
    if (!isMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    window.addEventListener("mousedown", handleClickOutside)
    return () => window.removeEventListener("mousedown", handleClickOutside)
  }, [isMenuOpen])

  // Check manifest and authoritative filesystem state on mount
  useEffect(() => {
    if (!isLocalAllowed) {
      setStatus("unavailable")
      return
    }

    if (hasProvidedState) {
      let isMounted = true
      const baseManifest = buildManifestFromPublished(publishedModpack, installedVersion, integrityDirty)
      setManifest(baseManifest)
      const baseState = deriveBaseGameButtonState(publishedModpack, installedVersion)
      setStatus(baseState)
      if (baseManifest) {
        const total = baseManifest.totalDownloadBytes || manifestTotalBytes(baseManifest.clientFiles)
        setTotalBytes(total)
      }

      Promise.all([
        Promise.resolve()
          .then(() => window.electronAPI?.getLaunchStatus?.(effectiveGameContext))
          .catch(() => null),
        Promise.resolve()
          .then(() => window.electronAPI?.getDownloadQueue?.())
          .catch(() => null),
      ]).then(([launchInfo, queueSnap]) => {
        if (!isMounted) return

        const currentTargetId = gameContext?.gameId || activeServerId

        const otherGameRunning = Boolean(
          launchInfo?.runningGameId &&
          currentTargetId &&
          launchInfo.runningGameId !== currentTargetId
        )
        const otherOpVerifying = Boolean(
          launchInfo?.activeOperationGameId &&
          currentTargetId &&
          launchInfo.activeOperationGameId !== currentTargetId &&
          (launchInfo.activeOperationPhase === "VERIFYING" ||
            launchInfo.activeOperationState === "VERIFYING")
        )
        setIsLaunchBlockedByOtherGame(otherGameRunning || otherOpVerifying)

        if (
          currentTargetId &&
          launchInfo?.runningGameId === currentTargetId &&
          (launchInfo?.status === "running" || launchInfo?.status === "preparing")
        ) {
          setStatus(launchInfo.status === "preparing" ? "launching" : "running")
          return
        }
        const isQueueActive = Boolean(
          currentTargetId &&
          (queueSnap?.active?.gameId === currentTargetId || launchInfo?.activeOperationGameId === currentTargetId)
        )

        if (isQueueActive) {
          const isPaused = Boolean(
            queueSnap?.active?.state === "PAUSED" ||
            queueSnap?.active?.isPaused ||
            queueSnap?.active?.phase === "PAUSED" ||
            launchInfo?.operationState === "PAUSED"
          )
          const opPhase = queueSnap?.active?.phase || launchInfo?.activeOperationPhase || launchInfo?.operationState
          const isPhaseChange = Boolean(
            currentPhaseRef.current &&
            opPhase &&
            currentPhaseRef.current !== opPhase &&
            opPhase !== "PAUSED" &&
            currentPhaseRef.current !== "PAUSED"
          )
          if (isPhaseChange) {
            highWaterProgressRef.current = 0
          }
          if (opPhase && opPhase !== "PAUSED") {
            currentPhaseRef.current = opPhase
          }
          if (isPaused) {
            if (opPhase === "INSTALLING") {
              pausedPhaseRef.current = "installing"
            } else {
              pausedPhaseRef.current = "downloading"
            }
            setStatus("paused")
          } else if (opPhase === "INSTALLING") {
            pausedPhaseRef.current = "installing"
            setStatus("installing")
          } else if (opPhase === "VERIFYING") {
            setStatus("verifying")
          } else {
            pausedPhaseRef.current = "downloading"
            setStatus("downloading")
          }

          isStartingSyncRef.current = !isPaused

          const activeSnap = queueSnap?.active || launchInfo?.operationSnapshot
          if (activeSnap) {
            if (activeSnap.isCommitting !== undefined) {
              setIsCommitting(Boolean(activeSnap.isCommitting))
            }
            if (activeSnap.canPause !== undefined) {
              setCanPauseState(Boolean(activeSnap.canPause))
            }
            if (activeSnap.canCancel !== undefined) {
              setCanCancelState(Boolean(activeSnap.canCancel))
            }
            if (typeof activeSnap.progress === "number") {
              setProgress(activeSnap.progress)
            }
            if (typeof activeSnap.speedMBs === "number") setSpeed(activeSnap.speedMBs)
            if (typeof activeSnap.downloadedBytes === "number") setDownloadedBytes(activeSnap.downloadedBytes)
            if (typeof activeSnap.totalBytes === "number" && activeSnap.totalBytes > 0) setTotalBytes(activeSnap.totalBytes)
            if (typeof activeSnap.remainingMinutes === "number") setTimeRemainingMin(activeSnap.remainingMinutes)
          }
          return
        }

        const isQueued = Boolean(
          currentTargetId &&
          queueSnap?.queued?.some((q: any) => q.gameId === currentTargetId)
        )
        if (isQueued) {
          setStatus("queued")
          return
        }
      })

      return () => {
        isMounted = false
      }
    }

    let isMounted = true
    gameService
      .checkGameManifest(activeServerId, {
        allowLegacyLocalFilesystem: isLocalAllowed,
        gameContext: effectiveGameContext,
      })
      .then(async (res) => {
        if (!isMounted) return
        setManifest(res)
        if (res) {
          if (res.hasIntegrityIssue) {
            isIntegrityBlockedRef.current = true
          } else if (res.installedModpackVersion === res.version) {
            isIntegrityBlockedRef.current = false
          }

          const total = res.totalDownloadBytes || manifestTotalBytes(res.clientFiles)
          setTotalBytes(total)

          if (!isLocalAllowed) {
            setStatus("unavailable")
            return
          }

          const [launchInfo, queueSnap] = await Promise.all([
            window.electronAPI?.getLaunchStatus?.(effectiveGameContext).catch(() => null),
            window.electronAPI?.getDownloadQueue?.().catch(() => null),
          ])

          const otherGameRunning = Boolean(
            launchInfo?.runningGameId &&
            gameContext?.gameId &&
            launchInfo.runningGameId !== gameContext.gameId
          )
          const otherOpVerifying = Boolean(
            launchInfo?.activeOperationGameId &&
            gameContext?.gameId &&
            launchInfo.activeOperationGameId !== gameContext.gameId &&
            (launchInfo.activeOperationPhase === "VERIFYING" ||
              launchInfo.activeOperationState === "VERIFYING")
          )
          setIsLaunchBlockedByOtherGame(otherGameRunning || otherOpVerifying)

          if (
            gameContext?.gameId &&
            launchInfo?.runningGameId === gameContext.gameId &&
            (launchInfo?.status === "running" || launchInfo?.status === "preparing")
          ) {
            setStatus(launchInfo.status === "preparing" ? "launching" : "running")
            const hasUpdate = Boolean(
              res.installedModpackVersion && res.installedModpackVersion !== res.version
            )
            const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
            if (autoUpdatesEnabled && hasUpdate) {
              pendingAutoUpdateRef.current = true
            }
            return
          }

          const currentTargetId = gameContext?.gameId || activeServerId
          const isQueueActive = Boolean(
            currentTargetId &&
            (queueSnap?.active?.gameId === currentTargetId || launchInfo?.activeOperationGameId === currentTargetId)
          )

          if (isQueueActive) {
            const isPaused = Boolean(
              queueSnap?.active?.state === "PAUSED" ||
              queueSnap?.active?.isPaused ||
              queueSnap?.active?.phase === "PAUSED" ||
              launchInfo?.operationState === "PAUSED"
            )
            const opPhase = queueSnap?.active?.phase || launchInfo?.activeOperationPhase || launchInfo?.operationState
            const isPhaseChange = Boolean(
              currentPhaseRef.current &&
              opPhase &&
              currentPhaseRef.current !== opPhase &&
              opPhase !== "PAUSED" &&
              currentPhaseRef.current !== "PAUSED"
            )
            if (isPhaseChange) {
              highWaterProgressRef.current = 0
            }
            if (opPhase && opPhase !== "PAUSED") {
              currentPhaseRef.current = opPhase
            }
            if (isPaused) {
              if (opPhase === "INSTALLING") {
                pausedPhaseRef.current = "installing"
              } else {
                pausedPhaseRef.current = "downloading"
              }
              setStatus("paused")
            } else if (opPhase === "INSTALLING") {
              pausedPhaseRef.current = "installing"
              setStatus("installing")
            } else if (opPhase === "VERIFYING") {
              setStatus("verifying")
            } else {
              pausedPhaseRef.current = "downloading"
              setStatus("downloading")
            }

            isStartingSyncRef.current = !isPaused

            const activeSnap = queueSnap?.active || launchInfo?.operationSnapshot
            if (activeSnap) {
              if (activeSnap.isCommitting !== undefined) {
                setIsCommitting(Boolean(activeSnap.isCommitting))
              }
              if (activeSnap.canPause !== undefined) {
                setCanPauseState(Boolean(activeSnap.canPause))
              }
              if (activeSnap.canCancel !== undefined) {
                setCanCancelState(Boolean(activeSnap.canCancel))
              }
              if (typeof activeSnap.progress === "number") {
                setProgress(activeSnap.progress)
              }
              if (typeof activeSnap.speedMBs === "number") setSpeed(activeSnap.speedMBs)
              if (typeof activeSnap.downloadedBytes === "number") setDownloadedBytes(activeSnap.downloadedBytes)
              if (typeof activeSnap.totalBytes === "number" && activeSnap.totalBytes > 0) setTotalBytes(activeSnap.totalBytes)
              if (typeof activeSnap.remainingMinutes === "number") setTimeRemainingMin(activeSnap.remainingMinutes)
            }
            return
          }

          const isQueued = Boolean(
            currentTargetId &&
            queueSnap?.queued?.some((q: any) => q.gameId === currentTargetId)
          )
          if (isQueued) {
            setStatus("queued")
            return
          }

          const isPausedSession = Boolean(
            (res.hasPausedSession || res.hasInterruptedDownload) && !res.installed
          )
          if (isPausedSession) {
            const staged = res.stagedBytes || 0
            setDownloadedBytes(staged)
            const pct =
              typeof res.pausedProgress === "number" && res.pausedProgress > 0
                ? res.pausedProgress
                : total > 0 && staged > 0 ? Math.min(100, Math.round((staged / total) * 100)) : 0
            highWaterProgressRef.current = pct
            setProgress(pct)
            if (res.pausedPhase === "INSTALLING") {
              pausedPhaseRef.current = "installing"
              currentPhaseRef.current = "INSTALLING"
            } else {
              pausedPhaseRef.current = "downloading"
              currentPhaseRef.current = "DOWNLOADING"
            }
            setStatus("paused")
          } else {
            const isThisGameRunning =
              (launchInfo?.runningGameId && gameContext?.gameId
                ? launchInfo.runningGameId === gameContext.gameId
                : true) &&
              (launchInfo?.status === "running" || launchInfo?.status === "preparing")

            const isGameRunning =
              isThisGameRunning ||
              statusRef.current === "launching" ||
              statusRef.current === "running"

            if (isGameRunning) {
              setStatus(launchInfo?.status === "preparing" ? "launching" : "running")
              const hasUpdate = Boolean(
                res.installedModpackVersion && res.installedModpackVersion !== res.version
              )
              const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
              if (autoUpdatesEnabled && hasUpdate) {
                pendingAutoUpdateRef.current = true
              }
              return
            }

            const idleState = resolveIdleGameButtonState(res, activeServerId)
            setStatus(idleState)

            const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
            const hasUpdate = Boolean(
              res.installedModpackVersion && res.installedModpackVersion !== res.version
            )

            if (
              autoUpdatesEnabled &&
              hasUpdate &&
              !isStartingSyncRef.current &&
              statusRef.current !== "paused" &&
              Array.isArray(res.clientFiles)
            ) {
              triggerSync(res)
            }
          }
        } else {
          setStatus(isLocalAllowed ? resolveIdleGameButtonState(null, activeServerId) : "unavailable")
        }
      })
    return () => {
      isMounted = false
    }
  }, [triggerSync, activeServerId, isLocalAllowed, gameContext])

  // Real-time WebSocket subscription for release activation events
  useEffect(() => {
    if (hasProvidedState) return
    if (!manifest) return

    const unsubscribe = gameService.subscribeReleaseEvents(async (event) => {
      if ((event as any).type === "SERVER_UPDATED") return
      const releaseEvent = event as ReleaseActivatedEvent
      if (gameContext) {
        if (releaseEvent.serverId !== gameContext.gameId) return
      } else if (releaseEvent.serverId) {
        if (!activeServerId || releaseEvent.serverId !== activeServerId) {
          return
        }
      } else {
        if (activeServerId) {
          return
        }
      }
      if (releaseEvent.version === manifest.version) {
        return
      }

      const published = await gameService.getPublishedModpack(activeServerId)
      if (!published || published.version === manifest.version) return

      latestManifestVersionRef.current = published.version
      const clientFiles = published.clientFiles || []
      const directoryPolicies = published.directoryPolicies || []
      const totalBytes = manifestTotalBytes(clientFiles)
      const totalSizeGB = totalBytes / (1024 * 1024 * 1024)

      const isInstalled = Boolean(manifest.installed || manifest.hasExistingInstall)

      const freshManifest: GameManifest = {
        ...manifest,
        version: published.version,
        minecraftVersion: published.minecraftVersion,
        modLoader: (published.modLoader as any) || manifest.modLoader || "NEOFORGE",
        modLoaderVersion: published.modLoaderVersion ?? manifest.modLoaderVersion ?? null,
        neoForgeVersion: published.neoForgeVersion ?? manifest.neoForgeVersion ?? null,
        clientFiles,
        directoryPolicies,
        totalSizeGB,
        totalDownloadBytes: isInstalled ? 0 : totalBytes,
        hasUpdate: isInstalled,
        installed: false,
        hasExistingInstall: isInstalled,
        installedModpackVersion:
          manifest.installedModpackVersion || (manifest.installed ? manifest.version : null),
        hasIntegrityIssue: false,
      }

      setManifest(freshManifest)
      setTotalBytes(isInstalled ? 0 : totalBytes)

      if (!isLocalAllowed) {
        setStatus("unavailable")
        return
      }

      const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
      const isGameBusy = statusRef.current === "launching" || statusRef.current === "running"

      if (isGameBusy) {
        if (autoUpdatesEnabled) {
          pendingAutoUpdateRef.current = true
        }
        return
      }

      setStatus((prevStatus: GameButtonState) => {
        if (
          prevStatus === "downloading" ||
          prevStatus === "paused" ||
          prevStatus === "installing" ||
          prevStatus === "verifying" ||
          prevStatus === "launching" ||
          prevStatus === "running"
        ) {
          return prevStatus
        }

        return resolveIdleGameButtonState(freshManifest, activeServerId)
      })

      const hasUpdate = Boolean(
        freshManifest.installedModpackVersion &&
        freshManifest.installedModpackVersion !== freshManifest.version
      )

      if (
        isLocalAllowed &&
        autoUpdatesEnabled &&
        hasUpdate &&
        !isStartingSyncRef.current &&
        statusRef.current !== "downloading" &&
        statusRef.current !== "installing" &&
        statusRef.current !== "verifying" &&
        statusRef.current !== "launching" &&
        statusRef.current !== "running" &&
        statusRef.current !== "paused" &&
        Array.isArray(freshManifest.clientFiles)
      ) {
        triggerSync(freshManifest)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [manifest, triggerSync, activeServerId, isLocalAllowed, gameContext])

  // Listen to renderer settings changes (e.g. AUTO_UPDATES toggled ON/OFF in SettingsView)
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      if (!isLocalAllowed) return
      const customEvent = e as CustomEvent<{ key: string; value: any }>
      if (!customEvent.detail || customEvent.detail.key !== STORAGE_KEYS.AUTO_UPDATES) {
        return
      }

      const isEnabled = Boolean(customEvent.detail.value)
      if (!isEnabled) {
        // Toggling OFF does not cancel or pause ongoing downloads/installations
        return
      }

      const currentManifest = manifestRef.current
      if (!currentManifest) return

      const isGameBusy =
        statusRef.current === "launching" || statusRef.current === "running"
      const hasUpdate = Boolean(
        currentManifest.installedModpackVersion &&
        currentManifest.installedModpackVersion !== currentManifest.version
      )

      if (isGameBusy) {
        if (hasUpdate) {
          pendingAutoUpdateRef.current = true
        }
        return
      }

      const isOperationActive =
        statusRef.current === "downloading" ||
        statusRef.current === "installing" ||
        statusRef.current === "verifying" ||
        statusRef.current === "paused" ||
        isStartingSyncRef.current

      if (isOperationActive) {
        return
      }

      if (
        isLocalAllowed &&
        hasUpdate &&
        Array.isArray(currentManifest.clientFiles)
      ) {
        triggerSync(currentManifest)
      }
    }

    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChange)
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChange)
    }
  }, [triggerSync, isLocalAllowed])

  // Listen to game launch lifecycle status from Electron Main
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onLaunchStatus?.(
      (
        launchStatus: "idle" | "preparing" | "running",
        details?: { unexpected?: boolean; code?: number | null; error?: any; gameId?: string | null; runningGameId?: string | null },
      ) => {
        if (!isLocalAllowed) {
          setStatus("unavailable")
          return
        }

        const eventGameId = details?.gameId || details?.runningGameId || null
        const isOtherGame = Boolean(gameContext?.gameId && eventGameId && eventGameId !== gameContext.gameId)

        if (isOtherGame) {
          if (launchStatus === "preparing" || launchStatus === "running") {
            setIsLaunchBlockedByOtherGame(true)
          } else if (launchStatus === "idle") {
            window.electronAPI?.getLaunchStatus?.(effectiveGameContext).then((info: any) => {
              const stillRunningOther = Boolean(
                info?.runningGameId &&
                gameContext?.gameId &&
                info.runningGameId !== gameContext.gameId
              )
              const otherOpVerifying = Boolean(
                info?.activeOperationGameId &&
                gameContext?.gameId &&
                info.activeOperationGameId !== gameContext.gameId &&
                (info.activeOperationPhase === "VERIFYING" ||
                  info.activeOperationState === "VERIFYING")
              )
              setIsLaunchBlockedByOtherGame(stillRunningOther || otherOpVerifying)
            }).catch(() => {})
          }
          return
        }

        if (launchStatus === "idle") {
          window.electronAPI?.getLaunchStatus?.(effectiveGameContext).then((info: any) => {
            const stillRunningOther = Boolean(
              info?.runningGameId &&
              gameContext?.gameId &&
              info.runningGameId !== gameContext.gameId
            )
            const otherOpVerifying = Boolean(
              info?.activeOperationGameId &&
              gameContext?.gameId &&
              info.activeOperationGameId !== gameContext.gameId &&
              (info.activeOperationPhase === "VERIFYING" ||
                info.activeOperationState === "VERIFYING")
            )
            setIsLaunchBlockedByOtherGame(stillRunningOther || otherOpVerifying)
          }).catch(() => {})
        }

        if (gameContext) {
          if (!details?.gameId || details.gameId !== gameContext.gameId) return
        }

        if (launchStatus === "preparing") {
          setStatus("launching")
          return
        }

        if (launchStatus === "running") {
          setStatus("running")
          return
        }

        if (launchStatus === "idle") {
          if (details?.unexpected) {
            showToast(t("playButton.unexpectedGameExit"), "error")
          }

          const wasRunningOrLaunching =
            statusRef.current === "launching" || statusRef.current === "running"

          if (wasRunningOrLaunching) {
            const currentManifest = manifestRef.current
            const idleState = resolveIdleGameButtonState(currentManifest, activeServerId)
            setStatus(idleState)

            const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
            const hasUpdate = Boolean(
              currentManifest?.installedModpackVersion &&
              currentManifest?.installedModpackVersion !== currentManifest?.version
            )

            if (
              autoUpdatesEnabled &&
              (pendingAutoUpdateRef.current || hasUpdate) &&
              !isStartingSyncRef.current &&
              statusRef.current !== "paused" &&
              Array.isArray(currentManifest?.clientFiles)
            ) {
              pendingAutoUpdateRef.current = false
              triggerSync(currentManifest)
            } else {
              pendingAutoUpdateRef.current = false
            }
          }
        }
      },
    )

    return () => unsubscribe?.()
  }, [setStatus, showToast, t, triggerSync, isLocalAllowed, gameContext, activeServerId])

  // Listen to IPC download progress and phase events if running in Electron
  useEffect(() => {
    if (!isLocalAllowed) return
    const unsubProgress = window.electronAPI?.onDownloadProgress?.((data: any) => {
      if (gameContext) {
        if (data?.gameId && data.gameId !== gameContext.gameId) return
      }
      if (!isStartingSyncRef.current) {
        isStartingSyncRef.current = true
      }
      if (data?.isCommitting !== undefined) {
        setIsCommitting(Boolean(data.isCommitting))
      }
      if (data?.canPause !== undefined) {
        setCanPauseState(Boolean(data.canPause))
      }
      if (data?.canCancel !== undefined) {
        setCanCancelState(Boolean(data.canCancel))
      }
      const rawProgress = typeof data.progress === "number" ? data.progress : 0
      const activePhase = data.phase || (statusRef.current === "installing" ? "INSTALLING" : "DOWNLOADING")
      if (activePhase && activePhase !== "PAUSED") {
        currentPhaseRef.current = activePhase
      }

      setProgress(rawProgress)
      setSpeed(data.speedMBs || 0)
      if (Number.isFinite(data.downloadedBytes)) {
        setDownloadedBytes(data.downloadedBytes)
      }
      if (Number.isFinite(data.totalBytes) && data.totalBytes >= 0) {
        setTotalBytes(data.totalBytes)
      }
      setTimeRemainingMin(data.remainingMinutes)

      setStatus((prev) => {
        if (prev === "verifying") return prev
        if (prev === "launching" || prev === "running") return prev
        if (prev === "paused") {
          if (data.phase === "INSTALLING") {
            pausedPhaseRef.current = "installing"
          } else if (data.phase === "DOWNLOADING") {
            pausedPhaseRef.current = "downloading"
          }
          return prev
        }
        if (prev !== "downloading" && prev !== "installing" && prev !== "queued") return prev
        if (data.phase === "INSTALLING") {
          pausedPhaseRef.current = "installing"
          return "installing"
        }
        if (data.phase === "DOWNLOADING") {
          pausedPhaseRef.current = "downloading"
          return "downloading"
        }
        return prev
      })
    })

    const unsubPhase = window.electronAPI?.onPhaseChange?.((phase: string, eventGameId?: string | null, underlyingPhase?: string | null) => {
      if (gameContext && eventGameId && eventGameId !== gameContext.gameId) {
        if (phase === "VERIFYING") {
          setIsLaunchBlockedByOtherGame(true)
        } else {
          window.electronAPI?.getLaunchStatus?.(effectiveGameContext).then((info: any) => {
            const stillRunningOther = Boolean(
              info?.runningGameId &&
              gameContext?.gameId &&
              info.runningGameId !== gameContext.gameId
            )
            const otherOpVerifying = Boolean(
              info?.activeOperationGameId &&
              gameContext?.gameId &&
              info.activeOperationGameId !== gameContext.gameId &&
              (info.activeOperationPhase === "VERIFYING" ||
                info.activeOperationState === "VERIFYING")
            )
            setIsLaunchBlockedByOtherGame(stillRunningOther || otherOpVerifying)
          }).catch(() => {})
        }
        return
      }

      const currentTargetId = gameContext?.gameId || activeServerId
      if (currentTargetId && eventGameId && eventGameId !== currentTargetId) {
        return
      }

      if (statusRef.current === "launching" || statusRef.current === "running") {
        return
      }

      if (phase === "PAUSED") {
        isStartingSyncRef.current = false
        if (underlyingPhase === "INSTALLING") {
          pausedPhaseRef.current = "installing"
          currentPhaseRef.current = "INSTALLING"
        } else if (underlyingPhase === "DOWNLOADING") {
          pausedPhaseRef.current = "downloading"
          currentPhaseRef.current = "DOWNLOADING"
        }
        setStatus("paused")
        return
      }

      if (phase === "DOWNLOADING") {
        if (!currentPhaseRef.current || (currentPhaseRef.current !== "DOWNLOADING" && currentPhaseRef.current !== "PAUSED")) {
          highWaterProgressRef.current = 0
          setProgress(0)
        }
        currentPhaseRef.current = "DOWNLOADING"
        pausedPhaseRef.current = "downloading"
        setStatus("downloading")
        return
      }

      if (phase === "INSTALLING") {
        if (!currentPhaseRef.current || (currentPhaseRef.current !== "INSTALLING" && currentPhaseRef.current !== "PAUSED")) {
          highWaterProgressRef.current = 0
          setProgress(0)
        }
        currentPhaseRef.current = "INSTALLING"
        pausedPhaseRef.current = "installing"
        setStatus("installing")
        return
      }

      if (phase === "VERIFYING") {
        if (!currentPhaseRef.current || (currentPhaseRef.current !== "VERIFYING" && currentPhaseRef.current !== "PAUSED")) {
          highWaterProgressRef.current = 0
          setProgress(0)
        }
        currentPhaseRef.current = "VERIFYING"
        setStatus("verifying")
        return
      }

      if (phase === "ERROR") {
        currentPhaseRef.current = null
        highWaterProgressRef.current = 0
        isStartingSyncRef.current = false
        setIsCommitting(false)
        setCanPauseState(undefined)
        setCanCancelState(undefined)
        syncOpIdRef.current++
        showToast(t("playButton.syncError"), "error")
        gameService
          .checkGameManifest(activeServerId, {
            allowLegacyLocalFilesystem: isLocalAllowed,
            gameContext: effectiveGameContext,
          })
          .then((fresh) => {
            setManifest(fresh)
            setStatus(isLocalAllowed ? resolveIdleGameButtonState(fresh, activeServerId) : "unavailable")
          })
        return
      }

      if (phase === "IDLE") {
        currentPhaseRef.current = null
        highWaterProgressRef.current = 0
        isStartingSyncRef.current = false
        setIsCommitting(false)
        setCanPauseState(undefined)
        setCanCancelState(undefined)
        syncOpIdRef.current++
        gameService
          .checkGameManifest(activeServerId, {
            allowLegacyLocalFilesystem: isLocalAllowed,
            gameContext: effectiveGameContext,
          })
          .then((fresh) => {
            setManifest(fresh)
            setStatus(isLocalAllowed ? resolveIdleGameButtonState(fresh, activeServerId) : "unavailable")
          })
        return
      }
    })

    const unsubQueue = window.electronAPI?.onDownloadQueueChanged?.((snap: any) => {
      if (!isLocalAllowed || !snap || typeof snap !== "object") return
      const currentTargetId = gameContext?.gameId || activeServerId
      if (!currentTargetId) return

      if (statusRef.current === "launching" || statusRef.current === "running") {
        return
      }

      // 1. Active download matching this game
      if (snap.active?.gameId === currentTargetId) {
        if (snap.active.isCommitting !== undefined) {
          setIsCommitting(Boolean(snap.active.isCommitting))
        }
        if (snap.active.canPause !== undefined) {
          setCanPauseState(Boolean(snap.active.canPause))
        }
        if (snap.active.canCancel !== undefined) {
          setCanCancelState(Boolean(snap.active.canCancel))
        }
        const isPaused = Boolean(snap.active.state === "PAUSED" || snap.active.isPaused || snap.active.phase === "PAUSED")
        if (isPaused) {
          isStartingSyncRef.current = false
        }
        const opPhase = snap.active.phase
        if (opPhase && opPhase !== "PAUSED") {
          currentPhaseRef.current = opPhase
        }
        if (isPaused) {
          if (opPhase === "INSTALLING") {
            pausedPhaseRef.current = "installing"
          } else {
            pausedPhaseRef.current = "downloading"
          }
          setStatus("paused")
        } else if (opPhase === "INSTALLING") {
          pausedPhaseRef.current = "installing"
          setStatus("installing")
        } else if (opPhase === "VERIFYING") {
          setStatus("verifying")
        } else {
          pausedPhaseRef.current = "downloading"
          setStatus("downloading")
        }
        if (typeof snap.active.progress === "number") {
          setProgress(snap.active.progress)
        }
        if (typeof snap.active.speedMBs === "number") setSpeed(snap.active.speedMBs)
        if (typeof snap.active.downloadedBytes === "number") setDownloadedBytes(snap.active.downloadedBytes)
        if (typeof snap.active.totalBytes === "number" && snap.active.totalBytes > 0) setTotalBytes(snap.active.totalBytes)
        if (typeof snap.active.remainingMinutes === "number") setTimeRemainingMin(snap.active.remainingMinutes)
        return
      }

      // 2. Queued download matching this game
      const isQueued = Boolean(snap.queued?.some((q: any) => q.gameId === currentTargetId))
      if (isQueued) {
        setStatus("queued")
        return
      }

      // 3. Neither active nor queued: if it was previously active/queued, restore idle state
      const wasInQueueOrActive =
        statusRef.current === "queued" ||
        statusRef.current === "downloading" ||
        statusRef.current === "paused"

      if (wasInQueueOrActive && !isStartingSyncRef.current) {
        gameService
          .checkGameManifest(activeServerId, {
            allowLegacyLocalFilesystem: isLocalAllowed,
            gameContext: effectiveGameContext,
          })
          .then((fresh) => {
            setManifest(fresh)
            setStatus(isLocalAllowed ? resolveIdleGameButtonState(fresh, activeServerId) : "unavailable")
          })
      }
    })

    return () => {
      unsubProgress?.()
      unsubPhase?.()
      unsubQueue?.()
    }
  }, [isLocalAllowed, gameContext, activeServerId])

  const isExpanded =
    status === "downloading" ||
    status === "paused" ||
    status === "installing" ||
    status === "verifying"

  const effectiveCanPause = canPauseState !== false && !isCommitting && status !== "verifying"
  const effectiveCanCancel = canCancelState !== false && !isCommitting && status !== "verifying"
  const isCardClickable =
    !isCommitting &&
    status !== "verifying" &&
    (status === "paused" ? true : effectiveCanPause)

  const cancel = async () => {
    if (!isLocalAllowed || isTransitioning || status === "verifying" || isCommitting || !effectiveCanCancel) return
    setIsTransitioning(true)
    isCancellingRef.current = true
    try {
      const res: any = await gameService.cancelSync(effectiveGameContext)
      if (res?.success || res === true) {
        syncOpIdRef.current++
        isStartingSyncRef.current = false
        const freshManifest = await gameService.checkGameManifest(activeServerId, {
          allowLegacyLocalFilesystem: isLocalAllowed,
          gameContext: effectiveGameContext,
        })
        setManifest(freshManifest)
        setStatus(isLocalAllowed ? resolveIdleGameButtonState(freshManifest, activeServerId) : "unavailable")
        highWaterProgressRef.current = 0
        currentPhaseRef.current = null
        setProgress(0)
        setSpeed(0)
        setDownloadedBytes(0)
        setIsHovered(false)
      } else {
        showToast(t("playButton.syncError"), "error")
      }
    } catch (err) {
      console.error("Cancel sync error:", err)
      showToast(t("playButton.syncError"), "error")
    } finally {
      isCancellingRef.current = false
      setIsTransitioning(false)
    }
  }

  const togglePauseResume = async () => {
    if (!isLocalAllowed || isTransitioning || status === "verifying" || isCommitting) return

    if (status === "downloading" || status === "installing") {
      if (!effectiveCanPause) return
      setIsTransitioning(true)
      const currentPhase = status
      try {
        const res: any = await gameService.pauseSync(effectiveGameContext)
        if (res?.paused || res?.success || res === true) {
          pausedPhaseRef.current = currentPhase
          setStatus("paused")
          syncOpIdRef.current++
          isStartingSyncRef.current = false
        } else {
          showToast(t("playButton.syncError"), "error")
        }
      } catch (err) {
        console.error("Pause sync error:", err)
        showToast(t("playButton.syncError"), "error")
      } finally {
        setIsTransitioning(false)
      }
    } else if (status === "paused") {
      if (!isLocalAllowed || isStartingSyncRef.current) return
      const nextStatus = pausedPhaseRef.current === "installing" ? "installing" : "downloading"
      setStatus(nextStatus)
      isStartingSyncRef.current = true
      const syncOpId = ++syncOpIdRef.current

      gameService
        .resumeSync(effectiveGameContext)
        .then((res: any) => {
          if (res?.queued) {
            setStatus("queued")
            isStartingSyncRef.current = false
            return
          }
          if (res?.paused) {
            setStatus("paused")
            isStartingSyncRef.current = false
            return
          }
          if (res?.alreadyActive) {
            return
          }
          if (res?.success) {
            if (syncOpIdRef.current === syncOpId) {
              isStartingSyncRef.current = false
            }
            gameService.setGameInstalled(true, gameContext?.gameId)
            if (manifest?.version) {
              markSyncedVersionInstalled(manifest.version)
            }

            if (
              latestManifestVersionRef.current &&
              manifest?.version &&
              latestManifestVersionRef.current !== manifest.version
            ) {
              setStatus("update")
            } else {
              setStatus("play")
            }

            showToast(t("playButton.syncSuccess"), "success")
          }
        })
        .catch((err) => {
          const msg = String(err?.message || err || "").toLowerCase()
          if (isCancellingRef.current || msg.includes("cancel") || msg.includes("abort")) {
            return
          }
          console.error("Resume sync error, trying fallback:", err)
          // Fallback based on manifest/staging only if no active recoverable operation exists
          if (
            manifest &&
            Array.isArray(manifest.clientFiles) &&
            manifest.version &&
            manifest.minecraftVersion
          ) {
            if (syncOpIdRef.current === syncOpId) {
              isStartingSyncRef.current = false
            }
            triggerSync(manifest)
          } else {
            isStartingSyncRef.current = false
            gameService.setGameInstalled(false, gameContext?.gameId)
            setStatus(isLocalAllowed ? resolveIdleGameButtonState(manifest, activeServerId) : "unavailable")
            showToast(t("playButton.syncError"), "error")
          }
        })
        .finally(() => {
          if (syncOpIdRef.current === syncOpId) {
            isStartingSyncRef.current = false
          }
        })
    }
  }

  const handleClick = async () => {
    if (
      !isLocalAllowed ||
      isTransitioning ||
      isStartingSyncRef.current ||
      status === "checking" ||
      status === "unavailable" ||
      status === "installing" ||
      status === "verifying" ||
      status === "launching" ||
      status === "running" ||
      status === "queued"
    ) {
      return
    }
    if (status === "download" || status === "update") {
      triggerSync(manifest)
    } else if (status === "play") {
      if (isLaunchBlockedByOtherGame) {
        return
      }
      const isDirty = Boolean(integrityDirty || isIntegrityBlockedRef.current)
      if (isDirty) {
        if (window.electronAPI?.checkSyncPlan && manifest?.clientFiles) {
          try {
            const planPayload: any = {
              clientFiles: manifest.clientFiles,
              directoryPolicies: manifest.directoryPolicies || [],
              modpackVersion: manifest.version,
              minecraftVersion: manifest.minecraftVersion,
              modLoader: manifest.modLoader,
              modLoaderVersion: manifest.modLoaderVersion ?? undefined,
              neoForgeVersion: manifest.neoForgeVersion ?? undefined,
            }
            if (gameContext) {
              planPayload.gameId = gameContext.gameId
              planPayload.gameName = gameContext.gameName
            }
            const planCheck = await window.electronAPI.checkSyncPlan(planPayload)
            if (planCheck?.hasIntegrityIssue || !planCheck?.isFullyInstalled) {
              isIntegrityBlockedRef.current = true
              showToast(t("playButton.launchVerifyHint"), "error")
              return
            }
            isIntegrityBlockedRef.current = false
            onClearIntegrityDirty?.()
          } catch {
            showToast(t("playButton.launchVerifyHint"), "error")
            return
          }
        } else {
          showToast(t("playButton.launchVerifyHint"), "error")
          return
        }
      }

      let playerName = "Player"
      try {
        const userRaw = localStorage.getItem("hikat_user_data")
        if (userRaw) {
          const parsed = JSON.parse(userRaw)
          if (parsed?.username) playerName = parsed.username
        }
      } catch (_) { }

      try {
        await gameService.launchGame({
          playerName,
          minecraftVersion: manifest?.minecraftVersion,
          modLoader: manifest?.modLoader,
          modLoaderVersion: manifest?.modLoaderVersion,
          neoForgeVersion: manifest?.neoForgeVersion,
          gameContext: effectiveGameContext,
        })
        if (onPlay) onPlay()
      } catch (err: any) {
        console.error("Launch error:", err)
        showToast(t("playButton.launchVerifyHint"), "error")
      }
    }
  }

  const handleVerifyInstallation = async () => {
    setIsMenuOpen(false)
    if (
      !isLocalAllowed ||
      status !== "play" ||
      isTransitioning ||
      isStartingSyncRef.current ||
      manifest?.hasUpdate ||
      Boolean(
        manifest?.installedModpackVersion &&
          manifest?.version &&
          manifest.installedModpackVersion !== manifest.version,
      )
    ) {
      return
    }
    if (!manifest || !Array.isArray(manifest.clientFiles) || !manifest.version) {
      showToast(t("playButton.verifyError"), "error")
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "verify", state: "finished", success: false, gameId: gameContext?.gameId },
        }),
      )
      return
    }
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-status", {
        detail: { action: "verify", state: "started", gameId: gameContext?.gameId },
      }),
    )
    showToast(t("playButton.verifying"), "info")
    setDownloadedBytes(0)
    setProgress(0)
    setSpeed(0)
    setTimeRemainingMin(0)
    const syncOpId = ++syncOpIdRef.current
    isStartingSyncRef.current = true
    setStatus("verifying")

    let verifySuccess = false
    gameService
      .startSync(
        manifest.clientFiles,
        manifest.version,
        manifest.minecraftVersion,
        manifest.modLoader,
        manifest.modLoaderVersion,
        manifest.neoForgeVersion,
        true,
        ...(manifest.directoryPolicies ? [manifest.directoryPolicies] : []),
        ...(gameContext ? [gameContext] : []),
      )
      .then(async (res: any) => {
        if (res?.paused) {
          setStatus("paused")
          return
        }
        const verified = await gameService.checkGameManifest(activeServerId, {
          allowLegacyLocalFilesystem: isLocalAllowed,
          gameContext: effectiveGameContext,
        })

        if (verified) {
          latestManifestVersionRef.current = verified.version
          setManifest(verified)
        }

        const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
        const hasUpdate = Boolean(
          verified?.installedModpackVersion &&
          verified?.installedModpackVersion !== verified?.version
        )

        if (verified?.installed && !hasUpdate && !verified?.hasIntegrityIssue) {
          isIntegrityBlockedRef.current = false
          onClearIntegrityDirty?.()
          if (verified.version) {
            onInstalledVersionChange?.(verified.version)
          }
          gameService.setGameInstalled(true, gameContext?.gameId)
          setStatus("play")
          verifySuccess = true
          showToast(t("playButton.verifySuccess"), "success")
        } else if (hasUpdate && verified?.clientFiles && verified.clientFiles.length > 0) {
          isIntegrityBlockedRef.current = false
          onClearIntegrityDirty?.()
          if (verified.installedModpackVersion) {
            onInstalledVersionChange?.(verified.installedModpackVersion)
          }
          verifySuccess = true
          if (autoUpdatesEnabled) {
            if (syncOpIdRef.current === syncOpId) {
              isStartingSyncRef.current = false
            }
            triggerSync(verified)
          } else {
            setStatus("update")
          }
        } else {
          gameService.setGameInstalled(false, gameContext?.gameId)
          setStatus(isLocalAllowed ? resolveIdleGameButtonState(verified, activeServerId) : "unavailable")
          showToast(t("playButton.verifyError"), "error")
        }
      })
      .catch((err: any) => {
        console.error("Verify repair error:", err)
        gameService.setGameInstalled(false, gameContext?.gameId)
        showToast(t("playButton.verifyError"), "error")
        setStatus(isLocalAllowed ? resolveIdleGameButtonState(manifest, activeServerId) : "unavailable")
      })
      .finally(() => {
        if (syncOpIdRef.current === syncOpId) {
          isStartingSyncRef.current = false
        }
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-status", {
            detail: { action: "verify", state: "finished", success: verifySuccess, gameId: gameContext?.gameId },
          }),
        )
      })
  }

  const handleUninstallGame = async () => {
    setIsMenuOpen(false)
    if (!isLocalAllowed || isTransitioning || (status !== "play" && status !== "update")) return
    setIsTransitioning(true)
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-status", {
        detail: { action: "uninstall", state: "started", gameId: gameContext?.gameId },
      }),
    )
    let success = false
    try {
      success = await gameService.uninstallGame(effectiveGameContext)
      if (success) {
        isIntegrityBlockedRef.current = false
        onClearIntegrityDirty?.()
        onInstalledVersionChange?.(null)
        const freshManifest = await gameService.checkGameManifest(activeServerId, {
          allowLegacyLocalFilesystem: isLocalAllowed,
          gameContext: effectiveGameContext,
        })
        setManifest(freshManifest)
        setTotalBytes(
          freshManifest?.totalDownloadBytes ||
            (freshManifest ? manifestTotalBytes(freshManifest.clientFiles) : 0),
        )
        setStatus(isLocalAllowed ? resolveIdleGameButtonState(freshManifest, activeServerId) : "unavailable")
        showToast(t("playButton.uninstallSuccess"), "success")
      } else {
        showToast(t("playButton.uninstallError"), "error")
      }
    } finally {
      setIsTransitioning(false)
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "uninstall", state: "finished", success: Boolean(success), gameId: gameContext?.gameId },
        }),
      )
    }
  }

  // Listen for game action requests from SettingsView
  useEffect(() => {
    const handleGameActionRequest = (e: Event) => {
      if (!isLocalAllowed || !gameContext) return
      const customEvt = e as CustomEvent<{ action: "verify" | "uninstall"; gameId?: string }>
      if (customEvt.detail?.gameId !== gameContext.gameId) {
        return
      }
      const action = customEvt.detail?.action
      if (action === "verify") {
        handleVerifyInstallation()
      } else if (action === "uninstall") {
        handleUninstallGame()
      }
    }

    window.addEventListener("hikat:game-action-request", handleGameActionRequest)
    return () => {
      window.removeEventListener("hikat:game-action-request", handleGameActionRequest)
    }
  }, [handleVerifyInstallation, handleUninstallGame, isLocalAllowed, gameContext])

  /* ── IDLE / UNAVAILABLE / CHECKING / DOWNLOAD / UPDATE / PLAY / QUEUED ── */
  if (!isExpanded) {
    const isChecking = status === "checking"
    const isUnavailable = status === "unavailable"
    const isUpdate = status === "update"
    const isPlay = status === "play"
    const isQueued = status === "queued"
    const isLaunching = status === "launching"
    const isRunning = status === "running"
    const isBlockedPlay = isPlay && isLaunchBlockedByOtherGame
    const isDisabled =
      isChecking ||
      isUnavailable ||
      isLaunching ||
      isRunning ||
      isQueued ||
      isBlockedPlay

    return (
      <div
        style={{
          position: "absolute",
          left,
          top,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          type="button"
          disabled={isDisabled}
          className={isDisabled ? "" : "dl-idle-btn"}
          style={{
            width: 272,
            height: 76,
            borderRadius: 24,
            background: isDisabled
              ? isDark
                ? `linear-gradient(135deg, rgba(${accentCss}, 0.22), rgba(${accentCss}, 0.22))`
                : `linear-gradient(135deg, rgba(${accentCss}, 0.35), rgba(${accentCss}, 0.35))`
              : `linear-gradient(135deg, ${accentHex}, ${accentLighter})`,
            boxShadow: isDisabled
              ? "none"
              : `0 0 28px -6px ${accentGlow}`,
            border: "none",
            cursor: isDisabled ? "not-allowed" : "pointer",
            opacity: isDisabled ? 0.65 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            transition: "all 0.25s ease",
            userSelect: "none",
          }}
          onClick={handleClick}
        >
          {isPlay || isLaunching || isRunning ? (
            <IconPlay size={34} />
          ) : (
            <IconDownload size={38} />
          )}
          <span
            style={{
              color: "white",
              fontFamily: BASE_FONT,
              fontWeight: 800,
              fontSize: isChecking || isLaunching || isRunning || isQueued ? 16 : isUnavailable ? 19 : 23,
              letterSpacing: ".06em",
              textShadow: "0 1px 6px rgba(0,0,0,0.35)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {isChecking
              ? t("playButton.checkingUpdates")
              : isLaunching
                ? t("playButton.launching")
                : isRunning
                  ? t("playButton.running")
                  : isQueued
                    ? t("playButton.queued")
                    : isUnavailable
                      ? t("playButton.unavailable")
                      : isUpdate
                        ? t("playButton.update")
                        : isPlay
                          ? t("playButton.play")
                          : t("playButton.download")}
          </span>
        </button>

        {/* ── Cancel Button (When Queued) ── */}
        {isQueued && (
          <button
            type="button"
            onClick={cancel}
            disabled={isTransitioning}
            title={t("playButton.cancel")}
            className="dl-cancel-btn"
            style={{
              width: 76,
              height: 76,
              borderRadius: 24,
              flexShrink: 0,
              background: isDark ? "rgba(255, 255, 255, 0.05)" : "#ffffff",
              border: isDark
                ? "1px solid rgba(255, 255, 255, 0.12)"
                : "1px solid rgba(0, 0, 0, 0.12)",
              color: isDark ? "rgba(255, 255, 255, 0.65)" : "#556677",
              boxShadow: isDark ? "none" : "0 2px 8px rgba(0, 0, 0, 0.06)",
              cursor: isTransitioning ? "not-allowed" : "pointer",
              opacity: isTransitioning ? 0.35 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "opacity 0.2s ease",
            }}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 14 14"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
            >
              <line x1={2} y1={2} x2={12} y2={12} />
              <line x1={12} y1={2} x2={2} y2={12} />
            </svg>
          </button>
        )}

        {/* ── Quick Action Options Button (When Ready to Play or Update) ── */}
        {(isPlay || isUpdate) && !isBlockedPlay && (
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              title={t("playButton.options")}
              className="dl-cancel-btn"
              style={{
                width: 76,
                height: 76,
                borderRadius: 24,
                flexShrink: 0,
                background: isDark ? "rgba(255, 255, 255, 0.05)" : "#ffffff",
                border: isDark
                  ? "1px solid rgba(255, 255, 255, 0.12)"
                  : "1px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "rgba(255, 255, 255, 0.65)" : "#556677",
                boxShadow: isDark ? "none" : "0 2px 8px rgba(0, 0, 0, 0.06)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.18s ease",
              }}
            >
              <svg
                width={18}
                height={12}
                viewBox="0 0 12 8"
                fill="currentColor"
                style={{
                  transform: isMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.22s ease",
                }}
              >
                <path d="M1.41.84h9.18c.7 0 1.08.81.63 1.31L6.63 7.03a.85.85 0 0 1-1.26 0L.78 2.15C.33 1.65.71.84 1.41.84z" />
              </svg>
            </button>

            {/* Dropdown Menu Popup on the Right */}
            {isMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  left: "calc(100% + 12px)",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 220,
                  borderRadius: 18,
                  padding: "12px 10px",
                  background: isDark ? "#11181f" : "#ffffff",
                  border: isDark
                    ? "2px solid rgba(255, 255, 255, 0.12)"
                    : "1.5px solid rgba(0, 0, 0, 0.1)",
                  boxShadow: isDark
                    ? "0 16px 40px rgba(0, 0, 0, 0.75)"
                    : "0 16px 40px rgba(0, 0, 0, 0.15)",
                  zIndex: 100,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  animation:
                    "optionsMenuFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                  transformOrigin: "left center",
                  userSelect: "none",
                }}
              >
                {/* Option 1: Verificar instalación */}
                <button
                  type="button"
                  disabled={isUpdate}
                  onClick={handleVerifyInstallation}
                  className="profile-menu-item"
                  style={{
                    padding: "9px 12px",
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: isUpdate
                      ? isDark
                        ? "rgba(255,255,255,0.3)"
                        : "rgba(17,24,34,0.35)"
                      : isDark
                        ? "rgba(255,255,255,0.75)"
                        : "#111822",
                    cursor: isUpdate ? "not-allowed" : "pointer",
                    opacity: isUpdate ? 0.5 : 1,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  {t("playButton.verifyInstallation")}
                </button>

                {/* Option 2: Desinstalar juego */}
                <button
                  type="button"
                  onClick={handleUninstallGame}
                  className="profile-menu-item is-danger"
                  style={{
                    padding: "9px 12px",
                    fontSize: 14.5,
                    fontWeight: 700,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  {t("playButton.uninstallGame")}
                </button>
              </div>
            )}
          </div>
        )}

        <LiveToast message={toastState.message} type={toastState.type} />
      </div>
    )
  }

  /* ── DOWNLOADING / PAUSED / INSTALLING / VERIFYING (Progress card) ── */
  const currentDownloadedBytes =
    downloadedBytes > 0
      ? downloadedBytes
      : totalBytes > 0
        ? (totalBytes * progress) / 100
        : 0
  const isUpdating = Boolean(manifest?.hasExistingInstall)
  const isInstalling = status === "installing"
  const isVerifying = status === "verifying"

  const installMessageKey =
    progress < 15
      ? "installMessage1"
      : progress < 30
        ? "installMessage2"
        : progress < 45
          ? "installMessage3"
          : progress < 60
            ? "installMessage4"
            : progress < 75
              ? "installMessage5"
              : progress < 90
                ? "installMessage6"
                : "installMessage7"

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Main Progress Card */}
      <div
        className="dl-progress-card"
        onClick={isCardClickable ? togglePauseResume : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: 336,
          height: 76,
          borderRadius: 24,
          background: isDark
            ? status === "paused"
              ? "#182026"
              : "#141d24"
            : status === "paused"
              ? "#e9eff5"
              : "#ffffff",
          border: isDark
            ? "2.5px solid rgba(255, 255, 255, 0.12)"
            : "2.5px solid rgba(0, 0, 0, 0.1)",
          cursor: isCardClickable ? "pointer" : "default",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "12px 18px",
          boxShadow: isDark
            ? "0 12px 32px rgba(0, 0, 0, 0.45)"
            : "0 8px 24px rgba(0, 0, 0, 0.08)",
          userSelect: "none",
          transition: "width 0.25s ease",
        }}
      >
        {/* Progress bar background fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress}%`,
            background: isDark
              ? status === "paused"
                ? `linear-gradient(90deg, rgba(${accentCss}, 0.15), rgba(${accentCss}, 0.28))`
                : `linear-gradient(90deg, rgba(${accentCss}, 0.25), rgba(${accentCss}, 0.5))`
              : status === "paused"
                ? `linear-gradient(90deg, rgba(${accentCss}, 0.22), rgba(${accentCss}, 0.38))`
                : `linear-gradient(90deg, rgba(${accentCss}, 0.32), rgba(${accentCss}, 0.6))`,
            transition: "width 0.15s ease",
            pointerEvents: "none",
          }}
        />

        {/* Top row: Status label + Percent */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {status === "paused" && isHovered && (
              <IconResume size={13} color={isDark ? accentHex : accentDarkForLight} />
            )}
            <span
              style={{
                color: isDark ? accentHex : accentDarkForLight,
                fontFamily: BASE_FONT,
                fontWeight: 800,
                fontSize: 13.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {status === "paused"
                ? isHovered
                  ? t("playButton.resume")
                  : t("playButton.paused")
                : isVerifying
                  ? t("playButton.verifyingAction")
                  : isInstalling
                    ? t("playButton.installing")
                    : isUpdating
                      ? t("playButton.updating")
                      : t("playButton.downloading")}
            </span>
          </div>

          <span
            style={{
              color: isDark ? "white" : "#111822",
              fontFamily: BASE_FONT,
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            {Math.round(progress)}%
          </span>
        </div>

        {/* Bottom row: Download details & Speed or hover action prompt or install phrase */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            zIndex: 2,
          }}
        >
          {(status === "downloading" || status === "installing") && isHovered && effectiveCanPause ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: isDark ? "rgba(255, 255, 255, 0.9)" : "#111822",
              }}
            >
              <IconPause
                size={12}
                color={isDark ? "rgba(255, 255, 255, 0.9)" : "#111822"}
              />
              <span
                style={{
                  fontFamily: BASE_FONT,
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: "0.05em",
                }}
              >
                {t("playButton.pause")}
              </span>
            </div>
          ) : isVerifying ? (
            <span
              style={{
                color: isDark ? "rgba(255,255,255,.6)" : "#475569",
                fontFamily: BASE_FONT,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {t("playButton.verifyMessage")}
            </span>
          ) : isInstalling ? (
            <span
              style={{
                color: isDark ? "rgba(255,255,255,.6)" : "#475569",
                fontFamily: BASE_FONT,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {t(`playButton.${installMessageKey}`)}
            </span>
          ) : (
            <span
              style={{
                color: isDark ? "rgba(255,255,255,.6)" : "#475569",
                fontFamily: BASE_FONT,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {formatDownloadSize(currentDownloadedBytes)} / {totalBytes > 0 ? formatDownloadSize(totalBytes) : "--"} · {speed > 0 ? `${speed.toFixed(1)} MB/s` : `-- MB/s`}
            </span>
          )}

          {!isInstalling && !isVerifying && (
            <span
              style={{
                color: isDark ? "rgba(255,255,255,.6)" : "#475569",
                fontFamily: BASE_FONT,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {timeRemainingMin > 0 ? `${timeRemainingMin} ${t("common.min")}` : `-- ${t("common.min")}`}
            </span>
          )}
        </div>
      </div>

      {/* ── External Cancel Button (76x76px matching Play Button) ── */}
      {!isVerifying && (
        <button
          type="button"
          onClick={cancel}
          disabled={isTransitioning || isCommitting || !effectiveCanCancel}
          title={t("playButton.cancel")}
          className="dl-cancel-btn"
        style={{
          width: 76,
          height: 76,
          borderRadius: 24,
          flexShrink: 0,
          background: isDark ? "rgba(255, 255, 255, 0.05)" : "#ffffff",
          border: isDark
            ? "1px solid rgba(255, 255, 255, 0.12)"
            : "1px solid rgba(0, 0, 0, 0.12)",
          color: isDark ? "rgba(255, 255, 255, 0.45)" : "#556677",
          boxShadow: isDark ? "none" : "0 2px 8px rgba(0, 0, 0, 0.06)",
          cursor: isTransitioning || isCommitting || !effectiveCanCancel ? "not-allowed" : "pointer",
          opacity: isTransitioning || isCommitting || !effectiveCanCancel ? 0.35 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "opacity 0.2s ease",
        }}
      >
          <svg
            width={20}
            height={20}
            viewBox="0 0 14 14"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <line x1={2} y1={2} x2={12} y2={12} />
            <line x1={12} y1={2} x2={2} y2={12} />
          </svg>
        </button>
      )}

      <LiveToast message={toastState.message} type={toastState.type} />
    </div>
  )
}
