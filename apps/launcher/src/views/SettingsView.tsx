import React, { useState, useRef, useEffect } from "react"
import { ThemeMode, SettingsTab } from "../types"
import { IconMoon, IconSun } from "../theme/icons"
import { CANVAS_W, BASE_FONT } from "../theme/tokens"
import LauncherToggle from "../components/common/LauncherToggle"
import LauncherSelect from "../components/common/LauncherSelect"
import LiveToast from "../components/common/LiveToast"
import {
  useTranslation,
  getTranslation,
  LanguageCode,
} from "../context/LanguageContext"
import {
  STORAGE_KEYS,
  getStoredBoolean,
  setStoredBoolean,
  getStoredNumber,
  setStoredNumber,
} from "../utils/settingsStorage"
import { gameService, GameManifest } from "../services/gameService"
import {
  calculateAutomaticRam,
  formatModLoaderName,
} from "../utils/gameSettings"
import { useDynamicAccent, useServerAccent } from "../utils/dynamicAccent"
import { LauncherServer } from "../services/serverService"
import { resolveApiAssetUrl } from "../config/api"

export { calculateAutomaticRam, formatModLoaderName }

interface SettingsViewProps {
  theme?: ThemeMode
  setTheme?: (t: ThemeMode) => void
  onSidebarAccentChange?: (accent: { r: number; g: number; b: number; css: string }) => void
  servers?: LauncherServer[]
  selectedGameId?: string | null
  onSelectGameId?: (id: string) => void
}

interface GameItem {
  id: string
  name: string
  logo: string
  accentColor?: string | null
}

export default function SettingsView({
  theme = "dark",
  setTheme,
  onSidebarAccentChange,
  servers,
  selectedGameId: propSelectedGameId,
  onSelectGameId,
}: SettingsViewProps) {
  const { t, language, setLanguage } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>("general")

  const [startWithSystem, setStartWithSystemState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.START_WITH_SYSTEM, true),
  )
  const [minimizeToTray, setMinimizeToTrayState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.MINIMIZE_TO_TRAY, true),
  )
  const [minimizeOnGameLaunch, setMinimizeOnGameLaunchState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.MINIMIZE_ON_GAME_LAUNCH, true),
  )
  const [autoUpdates, setAutoUpdatesState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true),
  )
  const isDark = theme === "dark"

  // Detect client system RAM with fallback to Node.js memory IPC
  const [systemTotalRAM, setSystemTotalRAM] = useState<number>(() => {
    if (typeof navigator !== "undefined" && "deviceMemory" in navigator) {
      const devMem = (navigator as any).deviceMemory
      if (typeof devMem === "number" && devMem > 0) {
        return Math.max(4, Math.round(devMem))
      }
    }
    return 16
  })

  // Game & Performance State
  const [ramGB, setRamGBState] = useState<number>(8)
  const [ramAuto, setRamAutoState] = useState<boolean>(false)
  const [dedicatedGPU, setDedicatedGPUState] = useState<boolean>(true)

  const games: GameItem[] = React.useMemo(() => {
    if (!servers || servers.length === 0) {
      return []
    }
    return servers.map((s) => {
      const logoUrl = s.sidebarLogo?.url
        ? resolveApiAssetUrl(s.sidebarLogo.url)
        : s.mainLogo?.url
          ? resolveApiAssetUrl(s.mainLogo.url)
          : ""
      return {
        id: s.id,
        name: s.name,
        logo: logoUrl,
        accentColor: s.accentColor,
      }
    })
  }, [servers])

  const [internalSelectedGameId, setInternalSelectedGameId] = useState<string>(() => {
    return propSelectedGameId || games[0]?.id || ""
  })

  const selectedGameId = (propSelectedGameId && games.some((g) => g.id === propSelectedGameId))
    ? propSelectedGameId
    : (games.some((g) => g.id === internalSelectedGameId) ? internalSelectedGameId : games[0]?.id || "")

  const selectedServer = servers?.find((s) => s.id === selectedGameId)
  const gameContext = selectedServer
    ? {
        gameId: selectedServer.id,
        gameName: selectedServer.name,
      }
    : undefined

  const setSelectedGameId = (id: string) => {
    setInternalSelectedGameId(id)
    onSelectGameId?.(id)
  }

  // Sync state values on selectedGameId change
  useEffect(() => {
    if (gameContext) {
      const savedGpu = localStorage.getItem(`hikat_dedicated_gpu_${gameContext.gameId}`)
      setDedicatedGPUState(savedGpu === null ? true : savedGpu === "true")

      const isAuto = localStorage.getItem(`hikat_ram_auto_${gameContext.gameId}`) === "true"
      setRamAutoState(isAuto)

      const savedRam = localStorage.getItem(`hikat_ram_gb_${gameContext.gameId}`)
      const parsedRam = savedRam !== null ? parseInt(savedRam, 10) : 8
      setRamGBState(!isNaN(parsedRam) && parsedRam >= 1 ? parsedRam : 8)

      const savedJava = localStorage.getItem(`hikat_java_major_version_${gameContext.gameId}`)
      if (savedJava !== null) {
        const p = parseInt(savedJava, 10)
        setRuntimeInfo(!isNaN(p) && p > 0 ? { javaMajorVersion: p } : null)
      } else {
        setRuntimeInfo(null)
      }
    } else {
      setDedicatedGPUState(true)
      setRamAutoState(false)
      setRamGBState(8)
      setRuntimeInfo(null)
    }
  }, [selectedGameId, gameContext?.gameId])

  // Game & Runtime Info State (Hydrated from local cache to prevent flickering)
  const [manifest, setManifest] = useState<GameManifest | null>(() => {
    if (typeof window !== "undefined" && gameContext) {
      try {
        const cacheKey = `hikat_game_manifest_${gameContext.gameId}`
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const parsed = JSON.parse(cached)
          if (parsed && typeof parsed === "object") {
            return parsed
          }
        }
      } catch (_) {}
    }
    return null
  })
  const manifestRef = useRef<GameManifest | null>(manifest)
  manifestRef.current = manifest

  useEffect(() => {
    manifestRef.current = manifest
  }, [manifest])

  const [runtimeInfo, setRuntimeInfo] = useState<{ javaMajorVersion: number | null } | null>(() => {
    if (typeof window !== "undefined" && gameContext) {
      try {
        const cachedJava = localStorage.getItem(`hikat_java_major_version_${gameContext.gameId}`)
        if (cachedJava !== null) {
          const parsedNum = parseInt(cachedJava, 10)
          if (!isNaN(parsedNum) && parsedNum > 0) {
            return { javaMajorVersion: parsedNum }
          }
        }
      } catch (_) {}
    }
    return null
  })
  const [launchStatus, setLaunchStatus] = useState<string>("idle")
  const [operationState, setOperationState] = useState<string>("IDLE")
  const [isVerifying, setIsVerifying] = useState<boolean>(false)
  const [isUninstalling, setIsUninstalling] = useState<boolean>(false)
  const [hasPendingRestartChanges, setHasPendingRestartChanges] = useState<boolean>(false)

  // Clear pending restart notice automatically when game returns to idle
  useEffect(() => {
    if (launchStatus === "idle") {
      setHasPendingRestartChanges(false)
    }
  }, [launchStatus])

  const markPendingRestartChangeIfNeeded = () => {
    if (launchStatus === "running" || launchStatus === "preparing") {
      setHasPendingRestartChanges(true)
    }
  }

  // Extract dynamic accent color from selected game: server.accentColor -> dynamic logo -> fallback
  const selectedGame = games.find((g) => g.id === selectedGameId) || games[0]
  const gameAccent = useServerAccent(selectedGame?.accentColor, selectedGame?.logo, "#3ec4c0")
  const showGameSidebar = games.length > 1

  // Inform sidebar of current active accent for Settings (general vs selected game)
  useEffect(() => {
    if (onSidebarAccentChange) {
      if (activeTab === "game") {
        onSidebarAccentChange({
          r: gameAccent.r,
          g: gameAccent.g,
          b: gameAccent.b,
          css: gameAccent.css,
        })
      } else {
        onSidebarAccentChange({
          r: 62,
          g: 196,
          b: 192,
          css: "62, 196, 192",
        })
      }
    }
  }, [activeTab, gameAccent.r, gameAccent.g, gameAccent.b, gameAccent.css, onSidebarAccentChange])

  // Operative state resolved locally via checkSyncPlan (without GraphQL queries)
  const [operativeState, setOperativeState] = useState<{
    isInstalled: boolean
    hasUpdate: boolean
    installedModpackVersion: string | null
    hasIntegrityIssue: boolean
  }>(() => ({
    isInstalled: gameContext ? gameService.isGameInstalled(gameContext.gameId) : false,
    hasUpdate: false,
    installedModpackVersion: null,
    hasIntegrityIssue: false,
  }))

  const refreshOperationalState = async (targetManifest?: GameManifest | null) => {
    if (!gameContext) {
      setOperativeState({
        isInstalled: false,
        hasUpdate: false,
        installedModpackVersion: null,
        hasIntegrityIssue: false,
      })
      return
    }

    const effectiveGameId = gameContext.gameId
    const m = targetManifest !== undefined ? targetManifest : manifestRef.current
    if (window.electronAPI?.checkSyncPlan && m?.clientFiles && m.clientFiles.length > 0) {
      try {
        const planPayload: any = {
          clientFiles: m.clientFiles,
          directoryPolicies: m.directoryPolicies || [],
          modpackVersion: m.version,
          minecraftVersion: m.minecraftVersion,
          modLoader: m.modLoader,
          modLoaderVersion: m.modLoaderVersion ?? undefined,
          neoForgeVersion: m.neoForgeVersion ?? undefined,
          gameId: gameContext.gameId,
          gameName: gameContext.gameName,
        }
        const planCheck = await window.electronAPI.checkSyncPlan(planPayload)
        if (planCheck?.success) {
          const isInst =
            typeof planCheck.hasExistingInstall === "boolean"
              ? planCheck.hasExistingInstall
              : Boolean(planCheck.isFullyInstalled || gameService.isGameInstalled(effectiveGameId))
          const instVer = planCheck.installedModpackVersion || null
          const hasUpd = Boolean(instVer && m.version && instVer !== m.version)
          setOperativeState({
            isInstalled: isInst,
            hasUpdate: hasUpd,
            installedModpackVersion: instVer,
            hasIntegrityIssue: Boolean(planCheck.hasIntegrityIssue),
          })
          if (typeof planCheck.hasExistingInstall === "boolean") {
            gameService.setGameInstalled(planCheck.hasExistingInstall, effectiveGameId)
          }
          return
        }
      } catch (_) {}
    }
    setOperativeState({
      isInstalled: gameService.isGameInstalled(effectiveGameId),
      hasUpdate: false,
      installedModpackVersion: null,
      hasIntegrityIssue: false,
    })
  }

  // Sync global settings with Electron process and OS on mount
  useEffect(() => {
    let isMounted = true

    if (window.electronAPI?.getMemory) {
      window.electronAPI
        .getMemory()
        .then((info: any) => {
          if (isMounted && info?.totalGb) {
            setSystemTotalRAM(info.totalGb)
            const isAuto = gameContext
              ? localStorage.getItem(`hikat_ram_auto_${gameContext.gameId}`) === "true"
              : false
            if (isAuto && gameContext) {
              const autoRam = calculateAutomaticRam(info.totalGb)
              setRamGBState(autoRam)
              localStorage.setItem(`hikat_ram_gb_${gameContext.gameId}`, String(autoRam))
              window.electronAPI?.setRamAllocation?.(autoRam, gameContext)
            }
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.getStartWithSystem) {
      window.electronAPI
        .getStartWithSystem()
        .then((realState: any) => {
          if (isMounted && typeof realState === "boolean") {
            setStartWithSystemState(realState)
            setStoredBoolean(STORAGE_KEYS.START_WITH_SYSTEM, realState)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.getMinimizeToTray) {
      window.electronAPI
        .getMinimizeToTray()
        .then((realState: any) => {
          if (isMounted && typeof realState === "boolean") {
            setMinimizeToTrayState(realState)
            setStoredBoolean(STORAGE_KEYS.MINIMIZE_TO_TRAY, realState)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.getMinimizeOnGameLaunch) {
      window.electronAPI
        .getMinimizeOnGameLaunch()
        .then((realState: any) => {
          if (isMounted && typeof realState === "boolean") {
            setMinimizeOnGameLaunchState(realState)
            setStoredBoolean(STORAGE_KEYS.MINIMIZE_ON_GAME_LAUNCH, realState)
          }
        })
        .catch(() => {})
    }

    return () => {
      isMounted = false
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  // Game-specific operations and Electron subscriptions
  useEffect(() => {
    let isMounted = true

    if (!gameContext) {
      setLaunchStatus("idle")
      setOperationState("IDLE")
      return
    }

    refreshOperationalState()

    if (window.electronAPI?.getDedicatedGpu) {
      window.electronAPI.getDedicatedGpu(gameContext)
        .then((realState: any) => {
          if (isMounted && typeof realState === "boolean") {
            setDedicatedGPUState(realState)
            localStorage.setItem(`hikat_dedicated_gpu_${gameContext.gameId}`, String(realState))
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.getRamAllocation) {
      window.electronAPI.getRamAllocation(gameContext)
        .then((realRam: any) => {
          const isAuto = localStorage.getItem(`hikat_ram_auto_${gameContext.gameId}`) === "true"
          if (isMounted && typeof realRam === "number" && realRam >= 1 && !isAuto) {
            setRamGBState(realRam)
            localStorage.setItem(`hikat_ram_gb_${gameContext.gameId}`, String(realRam))
          }
        })
        .catch(() => {})
    }

    // Load Runtime Info
    if (window.electronAPI?.getGameRuntimeInfo) {
      window.electronAPI.getGameRuntimeInfo(gameContext)
        .then((info: any) => {
          if (isMounted && info && typeof info.javaMajorVersion === "number" && info.javaMajorVersion > 0) {
            setRuntimeInfo(info)
            try {
              localStorage.setItem(`hikat_java_major_version_${gameContext.gameId}`, String(info.javaMajorVersion))
            } catch (_) {}
          }
        })
        .catch(() => {})
    }

    // Load Launch & Operation Status
    if (window.electronAPI?.getLaunchStatus) {
      window.electronAPI.getLaunchStatus(gameContext)
        .then((st: any) => {
          if (isMounted && st) {
            if (st.status) setLaunchStatus(st.status)
            if (st.operationState) setOperationState(st.operationState)
          }
        })
        .catch(() => {})
    }

    // Subscribe to Launch Status changes (filter other games)
    const unsubLaunch = window.electronAPI?.onLaunchStatus?.((status: any, details?: any) => {
      if (!isMounted) return
      if (details?.gameId !== gameContext.gameId) return
      setLaunchStatus(status)
    })

    // Subscribe to Phase Changes (filter other games)
    const unsubPhase = window.electronAPI?.onPhaseChange?.((phase: any, evtGameId?: any) => {
      if (!isMounted) return
      if (evtGameId !== gameContext.gameId) return
      setOperationState(phase)
    })

    // Subscribe to integrity changed (filter other games)
    const unsubIntegrity = window.electronAPI?.onGameFileIntegrityChanged?.((data: any) => {
      if (!isMounted) return
      if (data?.gameId !== gameContext.gameId) return
      refreshOperationalState()
    })

    // Listen to game action status events from DownloadPlayButton
    const handleActionStatus = (e: Event) => {
      const customEvt = e as CustomEvent<{
        action: "verify" | "uninstall"
        state: "started" | "finished"
        success?: boolean
        gameId?: string
      }>
      const { action, state, success, gameId: eventGameId } = customEvt.detail || {}
      if (eventGameId !== gameContext.gameId) return

      if (action === "verify") {
        setIsVerifying(state === "started")
        if (state === "started") {
          notifySaved(t("settings.verifying"), "info")
        } else if (state === "finished") {
          refreshOperationalState()
          if (success) {
            notifySaved(t("settings.verifiedSuccess"), "success")
          } else {
            notifySaved(t("playButton.verifyError"), "error")
          }
          if (window.electronAPI?.getGameRuntimeInfo) {
            window.electronAPI.getGameRuntimeInfo(gameContext)
              .then((runtime: any) => {
                if (
                  isMounted &&
                  runtime &&
                  typeof runtime.javaMajorVersion === "number" &&
                  runtime.javaMajorVersion > 0
                ) {
                  setRuntimeInfo(runtime)
                  if (gameContext?.gameId) {
                    try {
                      localStorage.setItem(
                        `hikat_java_major_version_${gameContext.gameId}`,
                        String(runtime.javaMajorVersion),
                      )
                    } catch (_) {}
                  }
                }
              })
              .catch(() => {})
          }
        }
      } else if (action === "uninstall") {
        setIsUninstalling(state === "started")
        if (state === "finished") {
          refreshOperationalState()
          if (success) {
            setRuntimeInfo(null)
            try {
              localStorage.removeItem(`hikat_java_major_version_${gameContext.gameId}`)
            } catch (_) {}
            notifySaved(t("playButton.uninstallSuccess"), "success")
          } else {
            notifySaved(t("playButton.uninstallError"), "error")
          }
        }
      }
    }

    window.addEventListener("hikat:game-action-status", handleActionStatus)

    return () => {
      isMounted = false
      unsubLaunch?.()
      unsubPhase?.()
      unsubIntegrity?.()
      window.removeEventListener("hikat:game-action-status", handleActionStatus)
    }
  }, [selectedGameId, gameContext?.gameId])

  // Dedicated WebSocket release events subscription with current server scope
  useEffect(() => {
    if (!gameContext) return
    let isMounted = true
    const activeServerId = gameContext.gameId

    const unsubscribe = gameService.subscribeReleaseEvents(async (event) => {
      if (!event?.serverId || event.serverId !== activeServerId) {
        return
      }

      try {
        const fresh = await gameService.checkGameManifest(activeServerId, {
          allowLegacyLocalFilesystem: false,
          gameContext,
        })
        if (isMounted && fresh) {
          setManifest(fresh)
          refreshOperationalState(fresh)
        }
      } catch (_) {}
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [selectedGameId, gameContext?.gameId])

  // Load/update manifest when selectedGameId changes
  useEffect(() => {
    if (!gameContext) {
      setManifest(null)
      return
    }
    let isMounted = true
    const cacheKey = `hikat_game_manifest_${gameContext.gameId}`
    let hasCached = false
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") {
          hasCached = true
          setManifest(parsed)
          refreshOperationalState(parsed)
        }
      }
    } catch (_) {}

    if (!hasCached) {
      gameService
        .checkGameManifest(gameContext.gameId, {
          allowLegacyLocalFilesystem: false,
          gameContext,
        })
        .then((m) => {
          if (isMounted && m) {
            setManifest(m)
            refreshOperationalState(m)
          }
        })
        .catch(() => {})
    }

    return () => {
      isMounted = false
    }
  }, [selectedGameId, gameContext?.gameId])

  const setStartWithSystem = async (v: boolean) => {
    setStartWithSystemState(v)
    setStoredBoolean(STORAGE_KEYS.START_WITH_SYSTEM, v)
    try {
      const res = await window.electronAPI?.setStartWithSystem?.(v)
      if (typeof res === "boolean") {
        setStartWithSystemState(res)
        setStoredBoolean(STORAGE_KEYS.START_WITH_SYSTEM, res)
      }
    } catch (_) {}
  }

  const setMinimizeToTray = async (v: boolean) => {
    setMinimizeToTrayState(v)
    setStoredBoolean(STORAGE_KEYS.MINIMIZE_TO_TRAY, v)
    try {
      await window.electronAPI?.setMinimizeToTray?.(v)
    } catch (_) {}
  }

  const setMinimizeOnGameLaunch = async (v: boolean) => {
    setMinimizeOnGameLaunchState(v)
    setStoredBoolean(STORAGE_KEYS.MINIMIZE_ON_GAME_LAUNCH, v)
    try {
      await window.electronAPI?.setMinimizeOnGameLaunch?.(v)
    } catch (_) {}
  }

  const setAutoUpdates = (v: boolean) => {
    setAutoUpdatesState(v)
    setStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, v)
  }

  const setDedicatedGPU = async (v: boolean) => {
    if (!gameContext) return
    const prev = dedicatedGPU
    setDedicatedGPUState(v)
    localStorage.setItem(`hikat_dedicated_gpu_${gameContext.gameId}`, String(v))
    try {
      const res = await window.electronAPI?.setDedicatedGpu?.(v, gameContext)
      if (typeof res === "boolean") {
        setDedicatedGPUState(res)
        localStorage.setItem(`hikat_dedicated_gpu_${gameContext.gameId}`, String(res))
        if (res !== prev) {
          markPendingRestartChangeIfNeeded()
        }
      } else if (v !== prev) {
        markPendingRestartChangeIfNeeded()
      }
      notifySaved(t("settings.savedNotice"), "success")
    } catch (_) {
      setDedicatedGPUState(prev)
      localStorage.setItem(`hikat_dedicated_gpu_${gameContext.gameId}`, String(prev))
      notifySaved(t("settings.toastSaveError"), "error")
    }
  }

  const setRamGB = (v: number) => {
    if (!gameContext) return
    setRamGBState(v)
    localStorage.setItem(`hikat_ram_gb_${gameContext.gameId}`, String(v))
    markPendingRestartChangeIfNeeded()
    window.electronAPI?.setRamAllocation?.(v, gameContext)
  }

  const [toastState, setToastState] = useState<{
    message: string | null
    type: "success" | "error" | "info"
  }>({
    message: null,
    type: "success",
  })
  const toastTimeoutRef = useRef<any>(null)

  const notifySaved = (customMsg?: string, type: "success" | "error" | "info" = "success") => {
    const msg = customMsg || t("settings.toastSaved")
    setToastState({ message: msg, type })
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    toastTimeoutRef.current = setTimeout(() => {
      setToastState({ message: null, type: "success" })
    }, 2800)
  }

  const handleToggleAutoRam = (v: boolean) => {
    if (!gameContext) return
    setRamAutoState(v)
    localStorage.setItem(`hikat_ram_auto_${gameContext.gameId}`, String(v))
    markPendingRestartChangeIfNeeded()
    if (v) {
      const autoRam = calculateAutomaticRam(systemTotalRAM)
      setRamGB(autoRam)
    }
    notifySaved()
  }

  const handleAutoRam = () => {
    if (!gameContext) return
    handleToggleAutoRam(true)
  }

  const isInstalled = operativeState.isInstalled
  const hasUpdate = operativeState.hasUpdate

  const isGameBusy =
    launchStatus === "running" ||
    launchStatus === "preparing" ||
    (operationState !== "IDLE" && operationState !== "") ||
    isVerifying ||
    isUninstalling

  const isVerifyDisabled = !gameContext || !isInstalled || hasUpdate || isGameBusy
  const isUninstallDisabled = !gameContext || !isInstalled || isGameBusy

  const handleVerify = () => {
    if (!gameContext || isVerifyDisabled) return
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-request", {
        detail: { action: "verify", gameId: gameContext.gameId },
      }),
    )
  }

  const handleUninstall = () => {
    if (!gameContext || isUninstallDisabled) return
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-request", {
        detail: { action: "uninstall", gameId: gameContext.gameId },
      }),
    )
  }

  const hasMinecraftVersion = Boolean(manifest?.minecraftVersion)
  const minecraftDisplay = hasMinecraftVersion
    ? `Minecraft ${manifest!.minecraftVersion}`
    : "—"

  const hasModLoader = Boolean(manifest?.modLoader)
  const isVanilla = hasModLoader && manifest!.modLoader.toUpperCase() === "VANILLA"
  const loaderFormatted = hasModLoader ? formatModLoaderName(manifest!.modLoader) : ""
  const loaderVersion = manifest?.modLoaderVersion || manifest?.neoForgeVersion || ""
  const loaderDisplay = !hasModLoader
    ? "—"
    : isVanilla
      ? "Vanilla"
      : loaderVersion
        ? `${loaderFormatted} ${loaderVersion}`
        : loaderFormatted

  const javaDisplay = runtimeInfo?.javaMajorVersion
    ? `Java ${runtimeInfo.javaMajorVersion}`
    : "—"

  const hasModpackVersion = Boolean(manifest?.version)
  const modpackDisplay = hasModpackVersion
    ? `Modpack ${manifest!.version}`
    : "—"

  const CONTENT_LEFT = 184

  /* Dynamic ambient RGB channels based on tab and gameAccent */
  const ambientR = activeTab === "game" ? gameAccent.r : 62
  const ambientG = activeTab === "game" ? gameAccent.g : 196
  const ambientB = activeTab === "game" ? gameAccent.b : 192

  /* Smooth delayed mouse-following parallax */
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const relX = e.clientX / window.innerWidth - 0.5
      const relY = e.clientY / window.innerHeight - 0.5
      setMouseOffset({
        x: Math.round(relX * 220),
        y: Math.round(relY * 150),
      })
    }

    window.addEventListener("mousemove", handleWindowMouseMove, {
      passive: true,
    })
    return () => window.removeEventListener("mousemove", handleWindowMouseMove)
  }, [])

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: CANVAS_W,
        height: 1080,
        background: isDark ? "#090d12" : "#f5f7fa",
        overflow: "hidden",
      }}
    >
      {/* ── Dynamic Ambient Glow Background ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: isDark
            ? `radial-gradient(1100px 700px at calc(38% + ${mouseOffset.x}px) calc(20% + ${mouseOffset.y}px), rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.08), transparent 75%),
               radial-gradient(850px 600px at calc(85% - ${mouseOffset.x * 0.8}px) calc(65% - ${mouseOffset.y * 0.8}px), rgba(77, 166, 255, 0.06), transparent 70%),
               radial-gradient(650px 500px at calc(20% + ${mouseOffset.x * 0.5}px) calc(80% + ${mouseOffset.y * 0.5}px), rgba(120, 80, 220, 0.04), transparent 65%),
               #090d12`
            : `radial-gradient(1000px 600px at calc(40% + ${mouseOffset.x}px) calc(25% + ${mouseOffset.y}px), rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.12), transparent 70%),
               radial-gradient(800px 500px at calc(80% - ${mouseOffset.x * 0.6}px) calc(70% - ${mouseOffset.y * 0.6}px), rgba(77, 166, 255, 0.09), transparent 65%),
               #f5f7fa`,
          transition: "background 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />

      {/* ── Ambient Radial Atmosphere Overlay ── */}
      <div
        style={{
          position: "absolute",
          top: -120,
          right: 80,
          width: 680,
          height: 680,
          borderRadius: "50%",
          background: isDark
            ? `radial-gradient(circle, rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.06) 0%, rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.015) 50%, transparent 75%)`
            : `radial-gradient(circle, rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.12) 0%, rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.03) 50%, transparent 75%)`,
          filter: "blur(50px)",
          pointerEvents: "none",
          transform: `translate3d(${mouseOffset.x * 0.4}px, ${mouseOffset.y * 0.4}px, 0)`,
          transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background 0.55s ease",
          zIndex: 1,
        }}
      />

      {/* ── Main Settings Panel Content (Aligned to top: 145, right: 80 matching SkinsView) ── */}
      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 145,
          right: 80,
          bottom: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          zIndex: 10,
          animation: "viewFadeIn 0.24s ease",
        }}
      >
        {/* ── Top Header Row (Identical structure and metrics with SkinsView) ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 22,
            position: "relative",
            minHeight: 48,
          }}
        >
          {/* Title & Subtitle */}
          <div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: isDark ? "white" : "#111822",
                letterSpacing: "-0.02em",
                marginBottom: 4,
              }}
            >
              {t("settings.title")}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 400,
                color: isDark ? "#8899aa" : "#556677",
              }}
            >
              {t("settings.subtitle")}
            </div>
          </div>

          {/* ── Main Tab Navigation Switcher ── */}
          <div
            style={{
              display: "inline-flex",
              background: isDark ? "#0d1217" : "#e6ebf0",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
              borderRadius: 14,
              padding: 4,
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("general")}
              className={`launcher-tab-btn ${activeTab === "general" ? "is-active" : ""}`}
              style={{
                padding: "10px 28px",
                fontFamily: BASE_FONT,
                fontSize: 15.5,
              }}
            >
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>{t("settings.tabGeneral")}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("game")}
              className={`launcher-tab-btn ${activeTab === "game" ? "is-active" : ""}`}
              style={{
                padding: "10px 28px",
                fontFamily: BASE_FONT,
                fontSize: 15.5,
              }}
            >
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="6" width="20" height="12" rx="6" />
                <line x1="6" y1="12" x2="10" y2="12" />
                <line x1="8" y1="10" x2="8" y2="14" />
                <circle cx="15" cy="13" r="1" fill="currentColor" />
                <circle cx="18" cy="11" r="1" fill="currentColor" />
              </svg>
              <span>{t("settings.tabGame")}</span>
            </button>
          </div>
        </div>

        {/* ── Tab Content Container ── */}
        <div
          className="custom-grid-scroll"
          style={{
            flex: 1,
            overflowY: "auto",
            maxHeight: 760,
            paddingRight: 6,
            paddingBottom: 4,
          }}
        >
          {activeTab === "general" ? (
            <div
              key="settings-tab-general"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                animation: "tabSlideUpFade 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {/* Card 1: Apariencia y Tema */}
              <div className="settings-card">
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                    marginBottom: 6,
                  }}
                >
                  {t("settings.appearance")}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 2,
                      }}
                    >
                      {t("settings.themeTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.themeDesc")}
                    </div>
                  </div>

                  {/* Theme Switcher Toggle */}
                  <div
                    style={{
                      display: "inline-flex",
                      background: isDark ? "#0d1217" : "#e6ebf0",
                      border: isDark
                        ? "1.5px solid rgba(255, 255, 255, 0.08)"
                        : "1.5px solid rgba(0, 0, 0, 0.08)",
                      borderRadius: 14,
                      padding: 4,
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setTheme?.("dark")
                        notifySaved(t("settings.toastDarkTheme"))
                      }}
                      className={`launcher-tab-btn ${isDark ? "is-active" : ""}`}
                      style={{
                        padding: "8px 20px",
                        fontFamily: BASE_FONT,
                        fontSize: 14,
                      }}
                    >
                      <IconMoon size={15} />
                      <span>{t("settings.themeDark")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTheme?.("light")
                        notifySaved(t("settings.toastLightTheme"))
                      }}
                      className={`launcher-tab-btn ${!isDark ? "is-active" : ""}`}
                      style={{
                        padding: "8px 20px",
                        fontFamily: BASE_FONT,
                        fontSize: 14,
                      }}
                    >
                      <IconSun size={15} />
                      <span>{t("settings.themeLight")}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: Idioma de la interfaz */}
              <div className="settings-card">
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                    marginBottom: 6,
                  }}
                >
                  {t("settings.languageTitle")}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 2,
                      }}
                    >
                      {t("settings.languageTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.languageDesc")}
                    </div>
                  </div>

                  <LauncherSelect
                    value={language}
                    onChange={(val) => {
                      setLanguage(val as LanguageCode)
                      notifySaved(
                        getTranslation(val as LanguageCode, "settings.toastSaved"),
                      )
                    }}
                    options={[
                      { value: "es", label: "Español (ES)" },
                      { value: "en", label: "English (US)" },
                      { value: "fr", label: "Français (FR)" },
                      { value: "pt", label: "Português (BR)" },
                    ]}
                    theme={theme}
                    width={210}
                  />
                </div>
              </div>

              {/* Card 3: Comportamiento de Inicio */}
              <div className="settings-card">
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                    marginBottom: 4,
                  }}
                >
                  {t("settings.launcherBehavior")}
                </div>

                {/* Iniciar con el sistema */}
                <div className="settings-row">
                  <div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 2,
                      }}
                    >
                      {t("settings.startWithSystemTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.startWithSystemDesc")}
                    </div>
                  </div>
                  <LauncherToggle
                    checked={startWithSystem}
                    theme={theme}
                    onChange={(v) => {
                      setStartWithSystem(v)
                      notifySaved()
                    }}
                    label={t("settings.startWithSystemTitle")}
                  />
                </div>

                {/* Minimizar a la bandeja */}
                <div className="settings-row">
                  <div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 2,
                      }}
                    >
                      {t("settings.minimizeToTrayTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.minimizeToTrayDesc")}
                    </div>
                  </div>
                  <LauncherToggle
                    checked={minimizeToTray}
                    theme={theme}
                    onChange={(v) => {
                      setMinimizeToTray(v)
                      notifySaved()
                    }}
                    label={t("settings.minimizeToTrayTitle")}
                  />
                </div>

                {/* Minimizar al iniciar el juego */}
                <div
                  className="settings-row"
                  style={{
                    borderBottom: "none",
                    paddingBottom: 0,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 2,
                      }}
                    >
                      {t("settings.minimizeOnGameLaunchTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.minimizeOnGameLaunchDesc")}
                    </div>
                  </div>
                  <LauncherToggle
                    checked={minimizeOnGameLaunch}
                    theme={theme}
                    onChange={(v) => {
                      setMinimizeOnGameLaunch(v)
                      notifySaved()
                    }}
                    label={t("settings.minimizeOnGameLaunchTitle")}
                  />
                </div>
              </div>

              {/* Card 4: Actualizaciones y Conectividad */}
              <div className="settings-card">
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                    marginBottom: 4,
                  }}
                >
                  {t("settings.autoUpdatesTitle")}
                </div>

                {/* Actualizaciones automáticas */}
                <div className="settings-row">
                  <div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 2,
                      }}
                    >
                      {t("settings.autoUpdatesTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.autoUpdatesDesc")}
                    </div>
                  </div>
                  <LauncherToggle
                    checked={autoUpdates}
                    theme={theme}
                    onChange={(v) => {
                      setAutoUpdates(v)
                      notifySaved()
                    }}
                    label={t("settings.autoUpdatesTitle")}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* ── JUEGOS TAB: Dynamic Structure based on available games ── */
            <div
              key="settings-tab-games"
              style={{
                display: "flex",
                gap: showGameSidebar ? 20 : 0,
                paddingTop: 6,
                animation: "tabSlideUpFade 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
                minHeight: 520,
              }}
            >
                  {/* ── Left Column: Internal Games Sidebar (Rendered only when > 1 game exists) ── */}
                  {showGameSidebar && (
                    <div
                      style={{
                        width: 220,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {/* Games collection */}
                      {games.map((game) => {
                        const isSelected = selectedGameId === game.id
                        return (
                          <button
                            key={game.id}
                            type="button"
                            onClick={() => setSelectedGameId(game.id)}
                            className={`game-selector-item ${isSelected ? "is-selected" : ""}`}
                            style={{
                              ["--game-border-color" as any]: `rgba(${gameAccent.css}, 0.88)`,
                              ["--game-glow-color" as any]: `rgba(${gameAccent.css}, 0.28)`,
                              ["--card-border-color" as any]: `rgba(${gameAccent.css}, 0.88)`,
                              ["--card-glow-color" as any]: `rgba(${gameAccent.css}, 0.28)`,
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "10px 14px",
                              borderRadius: 14,
                              fontFamily: BASE_FONT,
                              fontSize: 15,
                              fontWeight: 700,
                              cursor: "pointer",
                              background: isSelected
                                ? isDark
                                  ? "#161f28"
                                  : "#ffffff"
                                : isDark
                                  ? "rgba(255, 255, 255, 0.02)"
                                  : "rgba(0, 0, 0, 0.02)",
                              color: isSelected
                                ? isDark
                                  ? "#ffffff"
                                  : "#111822"
                                : isDark
                                  ? "#8899aa"
                                  : "#556677",
                              textAlign: "left",
                            }}
                          >
                            <img
                              src={game.logo}
                              alt={game.name}
                              style={{
                                width: 32,
                                height: 32,
                                objectFit: "contain",
                                borderRadius: 8,
                              }}
                            />
                            <span
                              style={{
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {game.name}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* ── Main Game Configuration Panel ── */}
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      width: "100%",
                    }}
                  >
                    {/* Selected Game Identity Header: Logo + Name */}
                    {selectedGame && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 14,
                          padding: "2px 0 6px",
                        }}
                      >
                        {selectedGame.logo ? (
                          <img
                            src={selectedGame.logo}
                            alt={selectedGame.name}
                            style={{
                              width: 48,
                              height: 48,
                              objectFit: "contain",
                              borderRadius: 12,
                            }}
                          />
                        ) : null}
                        <span
                          style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: isDark ? "#ffffff" : "#111822",
                            letterSpacing: "-0.01em",
                          }}
                        >
                          {selectedGame.name}
                        </span>
                      </div>
                    )}

                    {/* Inline Pending Restart Notice */}
                    {hasPendingRestartChanges && (
                      <div
                        data-testid="settings-pending-restart-notice"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 14px",
                          borderRadius: 10,
                          marginTop: 4,
                          marginBottom: 4,
                          background: isDark
                            ? `rgba(${gameAccent.r}, ${gameAccent.g}, ${gameAccent.b}, 0.1)`
                            : `rgba(${gameAccent.r}, ${gameAccent.g}, ${gameAccent.b}, 0.08)`,
                          border: isDark
                            ? `1px solid rgba(${gameAccent.r}, ${gameAccent.g}, ${gameAccent.b}, 0.25)`
                            : `1px solid rgba(${gameAccent.r}, ${gameAccent.g}, ${gameAccent.b}, 0.2)`,
                          color: isDark ? "#d0dce8" : "#2d3e50",
                          fontSize: 13.5,
                          fontWeight: 600,
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={gameAccent.hex}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ flexShrink: 0 }}
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <span>{t("settings.pendingRestartNotice")}</span>
                      </div>
                    )}

                    {/* 1. Card: RENDIMIENTO */}
                    <div className="settings-card">
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 800,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: isDark ? "#657788" : "#778899",
                          marginBottom: 6,
                        }}
                      >
                        {t("settings.performance")}
                      </div>

                      {/* Section: RAM Manual & Automatic Mode */}
                      <div style={{ padding: "8px 0 16px" }}>
                        {/* Manual RAM Block (Dimmed and non-interactive when ramAuto is active) */}
                        <div
                          style={{
                            opacity: ramAuto ? 0.55 : 1,
                            pointerEvents: ramAuto ? "none" : "auto",
                            transition: "opacity 0.2s ease",
                          }}
                        >
                          {/* Row 1: Title, description, RAM badge */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: 17,
                                  fontWeight: 700,
                                  color: isDark ? "white" : "#111822",
                                  marginBottom: 2,
                                }}
                              >
                                {t("settings.ramTitle")}
                              </div>
                              <div
                                style={{
                                  fontSize: 14.5,
                                  color: isDark ? "#8899aa" : "#556677",
                                  lineHeight: 1.45,
                                }}
                              >
                                {t("settings.ramDesc")}
                              </div>
                            </div>

                            {/* Right: [ 9 GB ] badge styled with gameAccent */}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                background: isDark ? "#0d1217" : "#f0f3f7",
                                border: isDark
                                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                                  : "1.5px solid rgba(0, 0, 0, 0.1)",
                                borderRadius: 10,
                                padding: "5px 14px",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 15.5,
                                  fontWeight: 800,
                                  color: gameAccent.hex,
                                }}
                              >
                                {ramGB}
                              </span>
                              <span
                                style={{
                                  fontSize: 13.5,
                                  fontWeight: 700,
                                  color: isDark
                                    ? "rgba(255, 255, 255, 0.7)"
                                    : "#556677",
                                }}
                              >
                                GB
                              </span>
                            </div>
                          </div>

                          {/* Slider bar */}
                          <div
                            style={{
                              marginTop: 12,
                              marginBottom: 16,
                              display: "flex",
                              alignItems: "center",
                              gap: 14,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: isDark ? "#7a8b9e" : "#778899",
                                minWidth: 36,
                              }}
                            >
                              2 GB
                            </span>
                            <input
                              type="range"
                              min={2}
                              max={systemTotalRAM}
                              step={1}
                              value={ramGB}
                              disabled={ramAuto}
                              onChange={(e) => {
                                setRamGB(Number(e.target.value))
                                notifySaved()
                              }}
                              className="settings-ram-slider"
                              style={{
                                flex: 1,
                                ["--settings-accent" as any]: gameAccent.hex,
                                cursor: ramAuto ? "not-allowed" : "pointer",
                                background: `linear-gradient(to right, ${gameAccent.hex} 0%, ${gameAccent.hex} ${((ramGB - 2) / Math.max(1, systemTotalRAM - 2)) * 100}%, ${
                                  isDark
                                    ? "rgba(255, 255, 255, 0.1)"
                                    : "rgba(0, 0, 0, 0.1)"
                                } ${((ramGB - 2) / Math.max(1, systemTotalRAM - 2)) * 100}%, ${
                                  isDark
                                    ? "rgba(255, 255, 255, 0.1)"
                                    : "rgba(0, 0, 0, 0.1)"
                                } 100%)`,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: isDark ? "#7a8b9e" : "#778899",
                                minWidth: 44,
                                textAlign: "right",
                              }}
                            >
                              {systemTotalRAM} GB
                            </span>
                          </div>
                        </div>

                        {/* Row 2: Automatic RAM Mode Toggle */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            paddingTop: 4,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                color: isDark ? "white" : "#111822",
                              }}
                            >
                              {t("settings.automaticRam")}
                            </div>
                          </div>

                          <LauncherToggle
                            checked={ramAuto}
                            theme={theme}
                            accentColor={gameAccent.hex}
                            onChange={handleToggleAutoRam}
                            label={t("settings.automaticRam")}
                          />
                        </div>
                      </div>

                  {/* Divider line ONLY before GPU */}
                  <div
                    className="settings-row"
                    style={{
                      borderBottom: "none",
                      borderTop: isDark
                        ? "1px solid rgba(255, 255, 255, 0.05)"
                        : "1px solid rgba(0, 0, 0, 0.06)",
                      paddingBottom: 0,
                      paddingTop: 16,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          color: isDark ? "white" : "#111822",
                          marginBottom: 2,
                        }}
                      >
                        {t("settings.gpuTitle")}
                      </div>
                      <div
                        style={{
                          fontSize: 14.5,
                          color: isDark ? "#8899aa" : "#556677",
                          lineHeight: 1.45,
                        }}
                      >
                        {t("settings.gpuDesc")}
                      </div>
                    </div>
                    <LauncherToggle
                      checked={dedicatedGPU}
                      theme={theme}
                      accentColor={gameAccent.hex}
                      onChange={(v) => {
                        setDedicatedGPU(v)
                        notifySaved()
                      }}
                      label={t("settings.gpuTitle")}
                    />
                  </div>
                </div>

                {/* 3. Card: ADMINISTRACIÓN */}
                <div className="settings-card">
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: isDark ? "#657788" : "#778899",
                      marginBottom: 6,
                    }}
                  >
                    {t("settings.administration")}
                  </div>

                  {/* Row 1: Verificar instalación */}
                  <div className="settings-row">
                    <div>
                      <div
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          color: isDark ? "white" : "#111822",
                          marginBottom: 2,
                        }}
                      >
                        {t("settings.verifyInstallation")}
                      </div>
                      <div
                        style={{
                          fontSize: 14.5,
                          color: isDark ? "#8899aa" : "#556677",
                          lineHeight: 1.45,
                        }}
                      >
                        {t("settings.verifyInstallationDesc")}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={isVerifyDisabled}
                      className="launcher-btn-secondary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 160,
                        height: 44,
                        padding: "0 22px",
                        borderRadius: 14,
                        fontSize: 15,
                        fontWeight: 600,
                        fontFamily: BASE_FONT,
                        cursor: isVerifyDisabled ? "not-allowed" : "pointer",
                        opacity: isVerifyDisabled ? 0.45 : 1,
                      }}
                    >
                      {isVerifying
                        ? t("settings.verifying")
                        : (t("settings.verifyButton") || t("settings.verifyInstallation"))}
                    </button>
                  </div>

                  {/* Row 2: Desinstalar */}
                  <div
                    className="settings-row"
                    style={{
                      borderBottom: "none",
                      paddingBottom: 0,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          color: isDark ? "white" : "#111822",
                          marginBottom: 2,
                        }}
                      >
                        {t("settings.uninstallGame")}
                      </div>
                      <div
                        style={{
                          fontSize: 14.5,
                          color: isDark ? "#8899aa" : "#556677",
                          lineHeight: 1.45,
                        }}
                      >
                        {t("settings.uninstallGameDesc")}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleUninstall}
                      disabled={isUninstallDisabled}
                      className="launcher-btn-danger"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 160,
                        height: 44,
                        padding: "0 22px",
                        borderRadius: 14,
                        fontSize: 15,
                        fontWeight: 600,
                        fontFamily: BASE_FONT,
                        cursor: isUninstallDisabled ? "not-allowed" : "pointer",
                        opacity: isUninstallDisabled ? 0.45 : 1,
                      }}
                    >
                      {isUninstalling
                        ? "..."
                        : (t("settings.uninstallButton") || t("settings.uninstallGame"))}
                    </button>
                    </div>
                  </div>

                  {/* 3. Technical Details Discrete Metadata Footer */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 4px 12px",
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: isDark
                        ? "rgba(136, 153, 170, 0.65)"
                        : "rgba(85, 102, 119, 0.75)",
                      fontFamily: BASE_FONT,
                    }}
                  >
                    <span>{minecraftDisplay}</span>
                    <span>·</span>
                    <span>{loaderDisplay}</span>
                    <span>·</span>
                    <span>{javaDisplay}</span>
                    <span>·</span>
                    <span>{modpackDisplay}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Real-time Auto-Save Toast ── */}
          <LiveToast
            message={toastState.message}
            type={toastState.type}
            accentColor={activeTab === "game" ? gameAccent.hex : undefined}
          />
        </div>
      </div>
    )
  }
