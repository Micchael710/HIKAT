import React, { useState, useEffect, useRef, useCallback } from "react"
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
} from "../../services/gameService"
import { STORAGE_KEYS, getStoredBoolean } from "../../utils/settingsStorage"
import LiveToast from "../common/LiveToast"

interface DownloadPlayButtonProps {
  left: number
  top: number
  theme?: ThemeMode
  onPlay?: () => void
}

export function resolveIdleGameButtonState(
  manifest: GameManifest | null | undefined,
): GameButtonState {
  if (!manifest) {
    return gameService.isGameInstalled() ? "play" : "unavailable"
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
}: DownloadPlayButtonProps) {
  const { t } = useTranslation()
  const [status, setStatusState] = useState<GameButtonState>("checking")
  const statusRef = useRef<GameButtonState>("checking")

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

  const [manifest, setManifest] = useState<GameManifest | null>(null)
  const manifestRef = useRef<GameManifest | null>(null)
  manifestRef.current = manifest

  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [timeRemainingMin, setTimeRemainingMin] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
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
  const isIntegrityBlockedRef = useRef(false)
  const pendingAutoUpdateRef = useRef(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const isDark = theme === "dark"

  useEffect(() => {
    latestManifestVersionRef.current = manifest?.version ?? null
  }, [manifest?.version])

  // Listen to filesystem integrity changes while launcher is open (marks integrity lock silently)
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onGameFileIntegrityChanged?.(() => {
      isIntegrityBlockedRef.current = true
    })

    return () => unsubscribe?.()
  }, [])

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
    const currentManifest = targetManifest || manifestRef.current
    if (!currentManifest?.clientFiles || currentManifest.clientFiles.length === 0) {
      showToast(t("playButton.noClientFiles"), "error")
      return
    }
    if (isStartingSyncRef.current) return
    const syncOpId = ++syncOpIdRef.current
    isStartingSyncRef.current = true
    setDownloadedBytes(0)
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
      )
      .then((res: any) => {
        if (res?.paused) {
          setStatus("paused")
          return
        }
        if (res?.success) {
          isIntegrityBlockedRef.current = false
          gameService.setGameInstalled(true)
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
              currentLatestManifest.clientFiles &&
              currentLatestManifest.clientFiles.length > 0 &&
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
        gameService.setGameInstalled(false)
        setStatus(resolveIdleGameButtonState(currentManifest))
        showToast(t("playButton.syncError"), "error")
      })
      .finally(() => {
        if (syncOpIdRef.current === syncOpId) {
          isStartingSyncRef.current = false
        }
      })
  }, [markSyncedVersionInstalled, setStatus, showToast, t])

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
    let isMounted = true
    gameService.checkGameManifest().then(async (res) => {
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
        const isPausedSession = Boolean(
          (res.hasPausedSession || res.hasInterruptedDownload) && !res.installed
        )
        if (isPausedSession) {
          const staged = res.stagedBytes || 0
          setDownloadedBytes(staged)
          const pct =
            total > 0 && staged > 0 ? Math.min(100, Math.round((staged / total) * 100)) : 0
          setProgress(pct)
          setStatus("paused")
        } else {
          const launchInfo = await window.electronAPI?.getLaunchStatus?.().catch(() => null)
          const isGameRunning =
            launchInfo?.status === "running" ||
            launchInfo?.status === "preparing" ||
            statusRef.current === "launching" ||
            statusRef.current === "running"

          if (isGameRunning) {
            setStatus("running")
            const hasUpdate = Boolean(
              res.installedModpackVersion && res.installedModpackVersion !== res.version
            )
            const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
            if (autoUpdatesEnabled && hasUpdate) {
              pendingAutoUpdateRef.current = true
            }
            return
          }

          const idleState = resolveIdleGameButtonState(res)
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
            res.clientFiles &&
            res.clientFiles.length > 0
          ) {
            triggerSync(res)
          }
        }
      } else {
        setStatus(resolveIdleGameButtonState(null))
      }
    })
    return () => {
      isMounted = false
    }
  }, [triggerSync])

  // Real-time WebSocket subscription for release activation events
  useEffect(() => {
    if (!manifest) return

    const unsubscribe = gameService.subscribeReleaseEvents(async (event) => {
      if (event.version === manifest.version) {
        return
      }

      const published = await gameService.getPublishedModpack()
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

        return resolveIdleGameButtonState(freshManifest)
      })

      const hasUpdate = Boolean(
        freshManifest.installedModpackVersion &&
        freshManifest.installedModpackVersion !== freshManifest.version
      )

      if (
        autoUpdatesEnabled &&
        hasUpdate &&
        !isStartingSyncRef.current &&
        statusRef.current !== "downloading" &&
        statusRef.current !== "installing" &&
        statusRef.current !== "verifying" &&
        statusRef.current !== "paused" &&
        clientFiles.length > 0
      ) {
        triggerSync(freshManifest)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [manifest, triggerSync])

  // Listen to game launch lifecycle status from Electron Main
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onLaunchStatus?.((launchStatus: "idle" | "preparing" | "running") => {
      if (launchStatus === "preparing") {
        setStatus("launching")
        return
      }

      if (launchStatus === "running") {
        setStatus("running")
        return
      }

      if (launchStatus === "idle") {
        const wasRunningOrLaunching =
          statusRef.current === "launching" || statusRef.current === "running"

        if (wasRunningOrLaunching) {
          const currentManifest = manifestRef.current
          const idleState = resolveIdleGameButtonState(currentManifest)
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
            currentManifest?.clientFiles &&
            currentManifest.clientFiles.length > 0
          ) {
            pendingAutoUpdateRef.current = false
            triggerSync(currentManifest)
          } else {
            pendingAutoUpdateRef.current = false
          }
        }
      }
    })

    return () => unsubscribe?.()
  }, [setStatus, triggerSync])

  // Listen to IPC download progress and phase events if running in Electron
  useEffect(() => {
    const unsubProgress = window.electronAPI?.onDownloadProgress?.((data: any) => {
      if (!isStartingSyncRef.current) return
      setProgress(data.progress)
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
        if (!isStartingSyncRef.current) return prev
        if (prev !== "downloading" && prev !== "installing") return prev
        if (data.phase === "INSTALLING") return "installing"
        if (data.phase === "DOWNLOADING" && prev === "installing") return "downloading"
        return prev
      })
    })

    const unsubPhase = window.electronAPI?.onPhaseChange?.((phase: string) => {
      setStatus((prev) => {
        if (prev === "verifying") return prev
        if (!isStartingSyncRef.current) return prev
        if (prev !== "downloading" && prev !== "installing") return prev
        if (phase === "INSTALLING") return "installing"
        if (phase === "DOWNLOADING" && prev === "installing") return "downloading"
        return prev
      })
    })

    return () => {
      unsubProgress?.()
      unsubPhase?.()
    }
  }, [])

  const isExpanded =
    status === "downloading" ||
    status === "paused" ||
    status === "installing" ||
    status === "verifying"

  const cancel = async () => {
    if (isTransitioning || status === "installing") return
    setIsTransitioning(true)
    isCancellingRef.current = true
    try {
      const res: any = await gameService.cancelSync()
      if (res?.success || res === true) {
        syncOpIdRef.current++
        isStartingSyncRef.current = false
        const freshManifest = await gameService.checkGameManifest()
        setManifest(freshManifest)
        setStatus(resolveIdleGameButtonState(freshManifest))
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
    if (isTransitioning || status === "installing" || status === "verifying") return

    if (status === "downloading") {
      setIsTransitioning(true)
      try {
        const res: any = await gameService.pauseSync()
        if (res?.paused || res?.success || res === true) {
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
      if (isStartingSyncRef.current) return
      if (!manifest?.clientFiles || manifest.clientFiles.length === 0) {
        showToast(t("playButton.noClientFiles"), "error")
        return
      }
      const syncOpId = ++syncOpIdRef.current
      isStartingSyncRef.current = true
      setStatus("downloading")

      const syncingVersion = manifest.version

      gameService
        .startSync(
          manifest.clientFiles,
          manifest.version,
          manifest.minecraftVersion,
          manifest.modLoader,
          manifest.modLoaderVersion,
          manifest.neoForgeVersion,
          false,
          ...(manifest.directoryPolicies ? [manifest.directoryPolicies] : []),
        )
        .then((res: any) => {
          if (res?.paused) {
            setStatus("paused")
            return
          }
          if (res?.success) {
            if (syncOpIdRef.current === syncOpId) {
              isStartingSyncRef.current = false
            }
            gameService.setGameInstalled(true)
            markSyncedVersionInstalled(syncingVersion)

            if (
              latestManifestVersionRef.current &&
              latestManifestVersionRef.current !== syncingVersion
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
          console.error("Sync resume error:", err)
          gameService.setGameInstalled(false)
          setStatus(resolveIdleGameButtonState(manifest))
          showToast(t("playButton.syncError"), "error")
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
      isTransitioning ||
      isStartingSyncRef.current ||
      status === "checking" ||
      status === "unavailable" ||
      status === "installing" ||
      status === "verifying" ||
      status === "launching" ||
      status === "running"
    ) {
      return
    }
    if (status === "download" || status === "update") {
      triggerSync(manifest)
    } else if (status === "play") {
      if (isIntegrityBlockedRef.current) {
        showToast(t("playButton.launchVerifyHint"), "error")
        return
      }

      const ramGB = Number(localStorage.getItem("hikat_ram_gb")) || 4
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
          ramGB,
          minecraftVersion: manifest?.minecraftVersion,
          modLoader: manifest?.modLoader,
          modLoaderVersion: manifest?.modLoaderVersion,
          neoForgeVersion: manifest?.neoForgeVersion,
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
    if (isTransitioning || isStartingSyncRef.current || status === "installing" || status === "verifying") return
    if (!manifest?.clientFiles || manifest.clientFiles.length === 0) {
      showToast(t("playButton.verifyError"), "error")
      return
    }
    showToast(t("playButton.verifying"), "info")
    setDownloadedBytes(0)
    setProgress(0)
    setSpeed(0)
    setTimeRemainingMin(0)
    const syncOpId = ++syncOpIdRef.current
    isStartingSyncRef.current = true
    setStatus("verifying")

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
      )
      .then(async (res: any) => {
        if (res?.paused) {
          setStatus("paused")
          return
        }
        const verified = await gameService.checkGameManifest()

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
          gameService.setGameInstalled(true)
          setStatus("play")
          showToast(t("playButton.verifySuccess"), "success")
        } else if (hasUpdate && verified?.clientFiles && verified.clientFiles.length > 0) {
          isIntegrityBlockedRef.current = false
          if (autoUpdatesEnabled) {
            if (syncOpIdRef.current === syncOpId) {
              isStartingSyncRef.current = false
            }
            triggerSync(verified)
          } else {
            setStatus("update")
          }
        } else {
          gameService.setGameInstalled(false)
          setStatus(resolveIdleGameButtonState(verified))
          showToast(t("playButton.verifyError"), "error")
        }
      })
      .catch((err: any) => {
        console.error("Verify repair error:", err)
        gameService.setGameInstalled(false)
        showToast(t("playButton.verifyError"), "error")
        setStatus(resolveIdleGameButtonState(manifest))
      })
      .finally(() => {
        if (syncOpIdRef.current === syncOpId) {
          isStartingSyncRef.current = false
        }
      })
  }

  const handleUninstallGame = async () => {
    setIsMenuOpen(false)
    if (isTransitioning) return
    setIsTransitioning(true)
    try {
      const success = await gameService.uninstallGame()
      if (success) {
        const freshManifest = await gameService.checkGameManifest()
        setManifest(freshManifest)
        setTotalBytes(
          freshManifest?.totalDownloadBytes ||
            (freshManifest ? manifestTotalBytes(freshManifest.clientFiles) : 0),
        )
        setStatus(resolveIdleGameButtonState(freshManifest))
        showToast(t("playButton.uninstallSuccess"), "success")
      } else {
        showToast(t("playButton.uninstallError"), "error")
      }
    } finally {
      setIsTransitioning(false)
    }
  }

  /* ── IDLE / UNAVAILABLE / CHECKING / DOWNLOAD / UPDATE / PLAY ── */
  if (!isExpanded) {
    const isChecking = status === "checking"
    const isUnavailable = status === "unavailable"
    const isUpdate = status === "update"
    const isPlay = status === "play"
    const isLaunching = status === "launching"
    const isRunning = status === "running"
    const isDisabled =
      isChecking ||
      isUnavailable ||
      isLaunching ||
      isRunning

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
                ? "linear-gradient(135deg, rgba(239, 196, 54, 0.22), rgba(255, 230, 146, 0.22))"
                : "linear-gradient(135deg, rgba(239, 196, 54, 0.35), rgba(255, 230, 146, 0.35))"
              : "linear-gradient(135deg, #efc436, #ffe692)",
            boxShadow: isDisabled
              ? "none"
              : "0 0 28px -6px rgba(245, 208, 86, 0.45)",
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
              fontSize: isChecking || isLaunching || isRunning ? 16 : isUnavailable ? 19 : 23,
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
                  : isUnavailable
                    ? t("playButton.unavailable")
                    : isUpdate
                      ? t("playButton.update")
                      : isPlay
                        ? t("playButton.play")
                        : t("playButton.download")}
          </span>
        </button>

        {/* ── Quick Action Options Button (When Ready to Play) ── */}
        {isPlay && (
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
                  onClick={handleVerifyInstallation}
                  className="profile-menu-item"
                  style={{
                    padding: "9px 12px",
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: isDark ? "rgba(255,255,255,0.75)" : "#111822",
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
        onClick={togglePauseResume}
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
          cursor: isInstalling || isVerifying ? "default" : "pointer",
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
                ? "linear-gradient(90deg, rgba(239, 196, 54, 0.15), rgba(239, 196, 54, 0.28))"
                : "linear-gradient(90deg, rgba(239, 196, 54, 0.25), rgba(239, 196, 54, 0.5))"
              : status === "paused"
                ? "linear-gradient(90deg, rgba(239, 196, 54, 0.22), rgba(239, 196, 54, 0.38))"
                : "linear-gradient(90deg, rgba(239, 196, 54, 0.32), rgba(239, 196, 54, 0.6))",
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
              <IconResume size={13} color={isDark ? "#efc436" : "#92400e"} />
            )}
            <span
              style={{
                color: isDark ? "#efc436" : "#92400e",
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
                  ? t("playButton.verifyingAction") || "VERIFICANDO"
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
          {status === "downloading" && isHovered ? (
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
      <button
        type="button"
        onClick={cancel}
        disabled={isInstalling || isVerifying}
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
          cursor: isInstalling || isVerifying ? "not-allowed" : "pointer",
          opacity: isInstalling || isVerifying ? 0.35 : 1,
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

      <LiveToast message={toastState.message} type={toastState.type} />
    </div>
  )
}
