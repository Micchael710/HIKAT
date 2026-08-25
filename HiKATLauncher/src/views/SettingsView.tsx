import React, { useState, useRef, useEffect } from "react"
import { ThemeMode, SettingsTab } from "../types"
import { IconMoon, IconSun } from "../theme/icons"
import { CANVAS_W, BASE_FONT } from "../theme/tokens"
import LauncherToggle from "../components/common/LauncherToggle"
import LauncherSelect from "../components/common/LauncherSelect"
import LiveToast from "../components/common/LiveToast"
import { gameService } from "../services/gameService"
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

interface SettingsViewProps {
  theme?: ThemeMode
  setTheme?: (t: ThemeMode) => void
}

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
  const [autoUpdates, setAutoUpdatesState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true),
  )
  const [notifications, setNotificationsState] = useState<boolean>(() =>
    getStoredBoolean(STORAGE_KEYS.NOTIFICATIONS, true),
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

  // Sync settings with Electron process and OS on mount
  useEffect(() => {
    let isMounted = true

    if (window.electronAPI?.getMemory) {
      window.electronAPI
        .getMemory()
        .then((info) => {
          if (isMounted && info?.totalGb) {
            setSystemTotalRAM(info.totalGb)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.getStartWithSystem) {
      window.electronAPI
        .getStartWithSystem()
        .then((realState) => {
          if (isMounted && typeof realState === "boolean") {
            setStartWithSystemState(realState)
            setStoredBoolean(STORAGE_KEYS.START_WITH_SYSTEM, realState)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.setMinimizeToTray) {
      window.electronAPI.setMinimizeToTray(minimizeToTray)
    }

    if (window.electronAPI?.setDedicatedGpu) {
      window.electronAPI.setDedicatedGpu(dedicatedGPU)
    }

    return () => {
      isMounted = false
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

  const setAutoUpdates = (v: boolean) => {
    setAutoUpdatesState(v)
    setStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, v)
    window.electronAPI?.setAutoUpdates?.(v)
  }

  const setNotifications = (v: boolean) => {
    setNotificationsState(v)
    setStoredBoolean(STORAGE_KEYS.NOTIFICATIONS, v)
    window.electronAPI?.setNotifications?.(v)
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

  // Maintenance state
  const [repairState, setRepairState] = useState<"idle" | "scanning" | "done">(
    "idle",
  )
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

  const handleRepair = async () => {
    if (repairState === "scanning") return
    setRepairState("scanning")
    notifySaved(t("settings.repairScanning"), "info")
    try {
      const manifest = await gameService.checkGameManifest()
      if (manifest?.clientFiles && manifest.clientFiles.length > 0) {
        await gameService.startSync(manifest.clientFiles, manifest.version)
        setRepairState("done")
        notifySaved(t("settings.repairSuccess"), "success")
        setTimeout(() => setRepairState("idle"), 3500)
      } else {
        setRepairState("idle")
        notifySaved(t("settings.repairNoFiles"), "error")
      }
    } catch (err: any) {
      console.error("Repair error:", err)
      setRepairState("idle")
      notifySaved(t("settings.repairError"), "error")
    }
  }

  const CONTENT_LEFT = 184

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
          overflow: "hidden",
          zIndex: 0,
        }}
      >
        {/* Orb 1 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${mouseOffset.x}px, ${mouseOffset.y}px, 0)`,
            transition: "transform 1.4s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-1"
            style={{
              position: "absolute",
              top: "-10%",
              left: "15%",
              width: 850,
              height: 850,
              background: `radial-gradient(circle, rgba(62, 196, 192, ${
                isDark ? 0.22 : 0.12
              }) 0%, transparent 68%)`,
              filter: "blur(55px)",
            }}
          />
        </div>

        {/* Orb 2 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${Math.round(mouseOffset.x * 0.45)}px, ${Math.round(mouseOffset.y * 0.45)}px, 0)`,
            transition: "transform 1.8s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-2"
            style={{
              position: "absolute",
              top: "25%",
              right: "5%",
              width: 900,
              height: 900,
              background: `radial-gradient(circle, rgba(62, 196, 192, ${
                isDark ? 0.15 : 0.08
              }) 0%, transparent 68%)`,
              filter: "blur(65px)",
            }}
          />
        </div>

        {/* Orb 3 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${Math.round(mouseOffset.x * 0.25)}px, ${Math.round(mouseOffset.y * 0.25)}px, 0)`,
            transition: "transform 2.2s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-3"
            style={{
              position: "absolute",
              bottom: "-15%",
              left: "25%",
              width: 800,
              height: 800,
              background: `radial-gradient(circle, rgba(62, 196, 192, ${
                isDark ? 0.12 : 0.06
              }) 0%, transparent 70%)`,
              filter: "blur(55px)",
            }}
          />
        </div>
      </div>

      {/* Main Container */}
      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 145,
          width: CANVAS_W - CONTENT_LEFT - 120,
          height: 880,
          display: "flex",
          flexDirection: "column",
          fontFamily: BASE_FONT,
          zIndex: 1,
          animation: "viewFadeIn 0.24s ease",
        }}
      >
        {/* Header Row: Title on Left, Dual Tab Pills on Right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
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

          {/* ── Dual Tab Pills ── */}
          <div
            style={{
              display: "flex",
              background: isDark ? "#0d1217" : "#e6ebf0",
              borderRadius: 14,
              padding: 4,
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
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
            maxHeight: 830,
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
                        color: isDark ? "#ffffff" : "#667788",
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: BASE_FONT,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        transition: "all 0.16s ease",
                      }}
                    >
                      <IconMoon size={16} />
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
                        boxShadow: !isDark
                          ? "0 2px 8px rgba(0, 0, 0, 0.08)"
                          : "none",
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: BASE_FONT,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        transition: "all 0.16s ease",
                      }}
                    >
                      <IconSun size={16} />
                      <span>{t("settings.themeLight")}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: Idioma */}
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
                    theme={theme}
                    onChange={(v) => {
                      const newLang = v as LanguageCode
                      setLanguage(newLang)
                      notifySaved(
                        getTranslation(newLang, "settings.toastSaved"),
                      )
                    }}
                    options={[
                      { value: "es", label: "Español (Latinoamérica)" },
                      { value: "en", label: "English (United States)" },
                      { value: "pt", label: "Português (Brasil)" },
                      { value: "fr", label: "Français (France)" },
                    ]}
                  />
                </div>
              </div>

              {/* Card 3: Inicio y Comportamiento */}
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

                {/* Notificaciones */}
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
                      {t("settings.notificationsTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.notificationsDesc")}
                    </div>
                  </div>
                  <LauncherToggle
                    checked={notifications}
                    theme={theme}
                    onChange={(v) => {
                      setNotifications(v)
                      notifySaved()
                    }}
                    label={t("settings.notificationsTitle")}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div
              key="settings-tab-game"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                animation: "tabSlideUpFade 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {/* Card 1: Rendimiento y Hardware */}
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
                  {t("settings.performanceHardware")}
                </div>

                {/* Row 1: RAM Slider */}
                <div
                  style={{
                    padding: "8px 0 14px",
                    borderBottom: isDark
                      ? "1px solid rgba(255, 255, 255, 0.05)"
                      : "1px solid rgba(0, 0, 0, 0.06)",
                  }}
                >
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

                    {/* RAM value badge */}
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
                          color: "#3ec4c0",
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
                        background: `linear-gradient(to right, #3ec4c0 0%, #3ec4c0 ${((ramGB - 2) / Math.max(1, systemTotalRAM - 2)) * 100}%, ${
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

                {/* Row 2: GPU Dedicada */}
                <div
                  className="settings-row"
                  style={{
                    borderBottom: "none",
                    paddingBottom: 0,
                    paddingTop: 14,
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          color: isDark ? "white" : "#111822",
                        }}
                      >
                        {t("settings.gpuTitle")}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 800,
                          color: "#3ec4c0",
                          background: "rgba(62, 196, 192, 0.12)",
                          padding: "2px 8px",
                          borderRadius: 6,
                        }}
                      >
                        NVIDIA / AMD
                      </span>
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
                    onChange={(v) => {
                      setDedicatedGPU(v)
                      notifySaved()
                    }}
                    label={t("settings.gpuTitle")}
                  />
                </div>
              </div>

              {/* Card 2: Herramientas y Mantenimiento */}
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
                  {t("settings.maintenance")}
                </div>

                <div
                  className="settings-row"
                  style={{
                    borderBottom: "none",
                    paddingBottom: 0,
                    paddingTop: 6,
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
                      {t("settings.repairTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("settings.repairDesc")}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleRepair}
                    disabled={repairState === "scanning"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 22px",
                      borderRadius: 12,
                      background: isDark ? "#0d1217" : "#f0f3f7",
                      border: isDark
                        ? "1.5px solid rgba(255, 255, 255, 0.12)"
                        : "1.5px solid rgba(0, 0, 0, 0.12)",
                      cursor: repairState === "scanning" ? "wait" : "pointer",
                      color: isDark ? "white" : "#111822",
                      fontFamily: BASE_FONT,
                      fontSize: 14.5,
                      fontWeight: 700,
                      transition: "all 0.16s ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (repairState !== "scanning") {
                        e.currentTarget.style.borderColor = isDark
                          ? "rgba(255, 255, 255, 0.28)"
                          : "rgba(0, 0, 0, 0.25)"
                        e.currentTarget.style.background = isDark
                          ? "#151e26"
                          : "#e4e8ee"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (repairState !== "scanning") {
                        e.currentTarget.style.borderColor = isDark
                          ? "rgba(255, 255, 255, 0.12)"
                          : "rgba(0, 0, 0, 0.12)"
                        e.currentTarget.style.background = isDark
                          ? "#0d1217"
                          : "#f0f3f7"
                      }
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: isDark
                          ? "rgba(255, 255, 255, 0.06)"
                          : "rgba(0, 0, 0, 0.06)",
                        color: "#3ec4c0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {repairState === "scanning" ? (
                        <svg
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          style={{ animation: "spin 1s linear infinite" }}
                        >
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      ) : repairState === "done" ? (
                        <svg
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#3ec4c0"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                      )}
                    </div>
                    <span>
                      {repairState === "scanning"
                        ? t("settings.repairScanning")
                        : repairState === "done"
                          ? t("settings.repairSuccess")
                          : t("settings.repairBtn")}
                    </span>
                  </button>
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
