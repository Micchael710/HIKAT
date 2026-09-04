import React, { useState, useRef, useEffect } from "react"
import { ThemeMode, SettingsTab } from "../types"
import { IconMoon, IconSun } from "../theme/icons"
import { CANVAS_W, BASE_FONT } from "../theme/tokens"
import { apparatiaLogo } from "../assets"
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
import { useDynamicAccent } from "../utils/dynamicAccent"

export { calculateAutomaticRam, formatModLoaderName }

interface SettingsViewProps {
  theme?: ThemeMode
  setTheme?: (t: ThemeMode) => void
}

interface GameItem {
  id: string
  name: string
  logo: string
}

const GAMES: GameItem[] = [
  {
    id: "apparatia",
    name: "Apparatia",
    logo: apparatiaLogo,
  },
]

export default function SettingsView({
  theme = "dark",
  setTheme,
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
  const [ramGB, setRamGBState] = useState<number>(() => {
    const defaultVal = 8
    return getStoredNumber(STORAGE_KEYS.RAM_GB, defaultVal)
  })

  const [dedicatedGPU, setDedicatedGPUState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.DEDICATED_GPU, true),
  )

  // Game & Runtime Info State
  const [selectedGameId, setSelectedGameId] = useState<string>("apparatia")
  const [manifest, setManifest] = useState<GameManifest | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<{ javaMajorVersion: number | null } | null>(null)
  const [launchStatus, setLaunchStatus] = useState<string>("idle")
  const [operationState, setOperationState] = useState<string>("IDLE")
  const [isVerifying, setIsVerifying] = useState<boolean>(false)
  const [isUninstalling, setIsUninstalling] = useState<boolean>(false)

  // Extract dynamic accent color from selected game logo
  const selectedGame = GAMES.find((g) => g.id === selectedGameId) || GAMES[0]
  const gameAccent = useDynamicAccent(selectedGame?.logo, "#3ec4c0")

  // Sync settings with Electron process and OS on mount
  useEffect(() => {
    let isMounted = true

    if (window.electronAPI?.getMemory) {
      window.electronAPI
        .getMemory()
        .then((info: any) => {
          if (isMounted && info?.totalGb) {
            setSystemTotalRAM(info.totalGb)
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

    if (window.electronAPI?.getDedicatedGpu) {
      window.electronAPI
        .getDedicatedGpu()
        .then((realState: any) => {
          if (isMounted && typeof realState === "boolean") {
            setDedicatedGPUState(realState)
            setStoredBoolean(STORAGE_KEYS.DEDICATED_GPU, realState)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.getRamAllocation) {
      window.electronAPI
        .getRamAllocation()
        .then((realRam: any) => {
          if (isMounted && typeof realRam === "number" && realRam >= 1) {
            setRamGBState(realRam)
            setStoredNumber(STORAGE_KEYS.RAM_GB, realRam)
          }
        })
        .catch(() => {})
    }

    // Load Game Manifest
    gameService
      .checkGameManifest()
      .then((m) => {
        if (isMounted && m) {
          setManifest(m)
        }
      })
      .catch(() => {})

    // Load Runtime Info
    if (window.electronAPI?.getGameRuntimeInfo) {
      window.electronAPI
        .getGameRuntimeInfo()
        .then((info: any) => {
          if (isMounted && info) {
            setRuntimeInfo(info)
          }
        })
        .catch(() => {})
    }

    // Load Launch & Operation Status
    if (window.electronAPI?.getLaunchStatus) {
      window.electronAPI
        .getLaunchStatus()
        .then((st: any) => {
          if (isMounted && st) {
            if (st.status) setLaunchStatus(st.status)
            if (st.operationState) setOperationState(st.operationState)
          }
        })
        .catch(() => {})
    }

    // Subscribe to Launch Status changes
    const unsubLaunch = window.electronAPI?.onLaunchStatus?.((status: any) => {
      if (isMounted) setLaunchStatus(status)
    })

    // Subscribe to Phase Changes
    const unsubPhase = window.electronAPI?.onPhaseChange?.((phase: any) => {
      if (isMounted) setOperationState(phase)
    })

    // Subscribe to WebSocket Release Events
    const unsubRelease = gameService.subscribeReleaseEvents(async () => {
      try {
        const fresh = await gameService.checkGameManifest()
        if (isMounted && fresh) {
          setManifest(fresh)
        }
      } catch (_) {}
    })

    return () => {
      isMounted = false
      unsubLaunch?.()
      unsubPhase?.()
      unsubRelease()
    }
  }, [])

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

  const setDedicatedGPU = (v: boolean) => {
    setDedicatedGPUState(v)
    setStoredBoolean(STORAGE_KEYS.DEDICATED_GPU, v)
    window.electronAPI?.setDedicatedGpu?.(v)
  }

  const setRamGB = (v: number) => {
    setRamGBState(v)
    setStoredNumber(STORAGE_KEYS.RAM_GB, v)
    window.electronAPI?.setRamAllocation?.(v)
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

  const handleAutoRam = () => {
    const autoRam = calculateAutomaticRam(systemTotalRAM)
    setRamGB(autoRam)
    notifySaved()
  }

  const isInstalled = Boolean(
    manifest?.installed || manifest?.hasExistingInstall || gameService.isGameInstalled(),
  )

  const hasUpdate = Boolean(
    manifest?.hasUpdate ||
      (manifest?.installedModpackVersion &&
        manifest?.version &&
        manifest.installedModpackVersion !== manifest.version),
  )

  const isGameBusy =
    launchStatus === "running" ||
    launchStatus === "preparing" ||
    (operationState !== "IDLE" && operationState !== "") ||
    isVerifying ||
    isUninstalling

  const isVerifyDisabled = !manifest || !isInstalled || hasUpdate || isGameBusy
  const isUninstallDisabled = !manifest || !isInstalled || isGameBusy

  const handleVerify = async () => {
    if (isVerifyDisabled || !manifest?.clientFiles || manifest.clientFiles.length === 0) return
    setIsVerifying(true)
    notifySaved(t("settings.verifying") || "Verificando...", "info")
    try {
      const res: any = await gameService.startSync(
        manifest.clientFiles,
        manifest.version,
        manifest.minecraftVersion,
        manifest.modLoader,
        manifest.modLoaderVersion,
        manifest.neoForgeVersion,
        true,
        manifest.directoryPolicies,
      )
      const fresh = await gameService.checkGameManifest()
      if (fresh) setManifest(fresh)
      if (window.electronAPI?.getGameRuntimeInfo) {
        const runtime = await window.electronAPI.getGameRuntimeInfo().catch(() => null)
        if (runtime) setRuntimeInfo(runtime)
      }
      if (res?.success && fresh?.installed && !fresh?.hasUpdate) {
        gameService.setGameInstalled(true)
        notifySaved(t("settings.verifiedSuccess") || "Juego verificado con éxito", "success")
      } else {
        notifySaved(t("playButton.verifyError") || "Error en verificación", "error")
      }
    } catch (_) {
      notifySaved(t("playButton.verifyError") || "Error en verificación", "error")
    } finally {
      setIsVerifying(false)
    }
  }

  const handleUninstall = async () => {
    if (isUninstallDisabled) return
    setIsUninstalling(true)
    try {
      const ok = await gameService.uninstallGame()
      if (ok) {
        const fresh = await gameService.checkGameManifest()
        setManifest(fresh)
        setRuntimeInfo({ javaMajorVersion: null })
        notifySaved(t("playButton.uninstallSuccess") || "Juego desinstalado", "success")
      } else {
        notifySaved(t("playButton.uninstallError") || "Error al desinstalar", "error")
      }
    } catch (_) {
      notifySaved(t("playButton.uninstallError") || "Error al desinstalar", "error")
    } finally {
      setIsUninstalling(false)
    }
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
        }}
      >
        {/* ── Top Header Row (Metrics aligned with SkinsView) ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 48,
            marginBottom: 4,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: BASE_FONT,
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: isDark ? "#ffffff" : "#111822",
                margin: 0,
                marginBottom: 4,
                lineHeight: 1.1,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span>{t("settings.title")}</span>
            </h1>
            <p
              style={{
                fontFamily: BASE_FONT,
                fontSize: 16,
                fontWeight: 400,
                color: isDark ? "#7a8b9e" : "#556677",
                margin: 0,
              }}
            >
              {t("settings.subtitle")}
            </p>
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
              style={{
                padding: "10px 28px",
                borderRadius: 10,
                fontFamily: BASE_FONT,
                fontSize: 15.5,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                border:
                  activeTab === "general"
                    ? isDark
                      ? "1.5px solid rgba(255, 255, 255, 0.14)"
                      : "1.5px solid rgba(0, 0, 0, 0.08)"
                    : "1.5px solid transparent",
                background:
                  activeTab === "general"
                    ? isDark
                      ? "#1c2630"
                      : "#ffffff"
                    : "transparent",
                color:
                  activeTab === "general"
                    ? isDark
                      ? "#ffffff"
                      : "#111822"
                    : isDark
                      ? "#7a8b9e"
                      : "#667788",
                boxShadow:
                  activeTab === "general" && !isDark
                    ? "0 2px 8px rgba(0, 0, 0, 0.08)"
                    : "none",
                transition: "all 0.16s ease",
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
              style={{
                padding: "10px 28px",
                borderRadius: 10,
                fontFamily: BASE_FONT,
                fontSize: 15.5,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                border:
                  activeTab === "game"
                    ? isDark
                      ? "1.5px solid rgba(255, 255, 255, 0.14)"
                      : "1.5px solid rgba(0, 0, 0, 0.08)"
                    : "1.5px solid transparent",
                background:
                  activeTab === "game"
                    ? isDark
                      ? "#1c2630"
                      : "#ffffff"
                    : "transparent",
                color:
                  activeTab === "game"
                    ? isDark
                      ? "#ffffff"
                      : "#111822"
                    : isDark
                      ? "#7a8b9e"
                      : "#667788",
                boxShadow:
                  activeTab === "game" && !isDark
                    ? "0 2px 8px rgba(0, 0, 0, 0.08)"
                    : "none",
                transition: "all 0.16s ease",
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
                      style={{
                        padding: "8px 20px",
                        borderRadius: 10,
                        background: isDark ? "#1c2630" : "transparent",
                        border: isDark
                          ? "1.5px solid rgba(255, 255, 255, 0.14)"
                          : "1.5px solid transparent",
                        color: isDark ? "white" : "#667788",
                        fontWeight: isDark ? 700 : 500,
                        fontFamily: BASE_FONT,
                        fontSize: 14,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        boxShadow: isDark
                          ? "0 2px 8px rgba(0, 0, 0, 0.3)"
                          : "none",
                        transition: "all 0.15s ease",
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
                      style={{
                        padding: "8px 20px",
                        borderRadius: 10,
                        background: !isDark ? "#ffffff" : "transparent",
                        border: !isDark
                          ? "1.5px solid rgba(0, 0, 0, 0.08)"
                          : "1.5px solid transparent",
                        color: !isDark ? "#111822" : "#7a8b9e",
                        fontWeight: !isDark ? 700 : 500,
                        fontFamily: BASE_FONT,
                        fontSize: 14,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        boxShadow: !isDark
                          ? "0 2px 8px rgba(0, 0, 0, 0.08)"
                          : "none",
                        transition: "all 0.15s ease",
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
            /* ── JUEGOS TAB: Two-Column Structure ── */
            <div
              key="settings-tab-games"
              style={{
                display: "flex",
                gap: 20,
                paddingTop: 6,
                animation: "tabSlideUpFade 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
                minHeight: 520,
              }}
            >
              {/* ── Left Column: Internal Games Sidebar (Begins directly with games list with dynamic accent) ── */}
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
                {GAMES.map((game) => {
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

              {/* ── Right Column: Selected Game Configuration Panel ── */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {/* 1. Compact Horizontal Technical Overview Card (Unified single card) */}
                <div
                  className="settings-card"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    padding: "16px 20px",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  {/* Item 1: Minecraft */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: isDark ? "#ffffff" : "#111822",
                      borderRight: isDark
                        ? "1px solid rgba(255, 255, 255, 0.08)"
                        : "1px solid rgba(0, 0, 0, 0.08)",
                      paddingRight: 12,
                      textAlign: "center",
                    }}
                  >
                    <span>{minecraftDisplay}</span>
                  </div>

                  {/* Item 2: Mod Loader */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: isDark ? "#ffffff" : "#111822",
                      borderRight: isDark
                        ? "1px solid rgba(255, 255, 255, 0.08)"
                        : "1px solid rgba(0, 0, 0, 0.08)",
                      paddingRight: 12,
                      textAlign: "center",
                    }}
                  >
                    <span>{loaderDisplay}</span>
                  </div>

                  {/* Item 3: Java Version */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: isDark ? "#ffffff" : "#111822",
                      borderRight: isDark
                        ? "1px solid rgba(255, 255, 255, 0.08)"
                        : "1px solid rgba(0, 0, 0, 0.08)",
                      paddingRight: 12,
                      textAlign: "center",
                    }}
                  >
                    <span>{javaDisplay}</span>
                  </div>

                  {/* Item 4: Modpack Version */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: isDark ? "#ffffff" : "#111822",
                      textAlign: "center",
                    }}
                  >
                    <span>{modpackDisplay}</span>
                  </div>
                </div>

                {/* 2. Card: RENDIMIENTO */}
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

                  {/* Section: RAM Manual & Automatic (Single contiguous block with no inner divider) */}
                  <div style={{ padding: "8px 0 16px" }}>
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
                        onChange={(e) => {
                          setRamGB(Number(e.target.value))
                          notifySaved()
                        }}
                        className="settings-ram-slider"
                        style={{
                          flex: 1,
                          ["--settings-accent" as any]: gameAccent.hex,
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

                    {/* Row 2: Automatic RAM selection (compact, clean, no duplicate description) */}
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

                      <button
                        type="button"
                        onClick={handleAutoRam}
                        className="launcher-btn-secondary"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: 44,
                          padding: "0 22px",
                          borderRadius: 14,
                          fontSize: 15,
                          fontWeight: 600,
                          fontFamily: BASE_FONT,
                          cursor: "pointer",
                        }}
                      >
                        {t("settings.automaticRam")}
                      </button>
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
              </div>
            </div>
          )}
        </div>

        {/* ── Real-time Auto-Save Toast ── */}
        <LiveToast message={toastState.message} type={toastState.type} />
      </div>
    </div>
  )
}
