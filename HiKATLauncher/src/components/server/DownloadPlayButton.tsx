import React, { useState, useEffect, useRef } from "react"

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

import LiveToast from "../common/LiveToast"

interface DownloadPlayButtonProps {
  left: number

  top: number

  theme?: ThemeMode

  onPlay?: () => void
}

export default function DownloadPlayButton({
  left,

  top,

  theme = "dark",

  onPlay,
}: DownloadPlayButtonProps) {
  const { t } = useTranslation()

  const [status, setStatus] = useState<GameButtonState>(() => {
    if (gameService.isGameInstalled()) return "play"

    return "unavailable"
  })

  const [manifest, setManifest] = useState<GameManifest | null>(null)

  const [progress, setProgress] = useState(0)

  const [speed, setSpeed] = useState(0)

  const [totalGB, setTotalGB] = useState(28.8)

  const [downloadedGB, setDownloadedGB] = useState(0)

  const [timeRemainingMin, setTimeRemainingMin] = useState(0)

  const [isHovered, setIsHovered] = useState(false)

  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)

  const toastTimeoutRef = useRef<any>(null)

  const isDark = theme === "dark"

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)

    setToastMessage(msg)

    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null)
    }, 2400)
  }

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

  // Check manifest and server availability on mount

  useEffect(() => {
    let isMounted = true

    gameService.checkGameManifest().then((res) => {
      if (!isMounted) return

      setManifest(res)

      if (res) {
        if (res.totalSizeGB) setTotalGB(res.totalSizeGB)

        if (res.installed || gameService.isGameInstalled()) {
          setStatus(res.hasUpdate ? "update" : "play")
        } else if (res.downloadUrl || res.latestVersion) {
          setStatus("download")
        } else {
          setStatus("unavailable")
        }
      } else {
        if (gameService.isGameInstalled()) {
          setStatus("play")
        } else {
          setStatus("unavailable")
        }
      }
    })

    return () => {
      isMounted = false
    }
  }, [])

  // Listen to IPC download progress events if running in Electron

  useEffect(() => {
    const unsub = window.electronAPI?.onDownloadProgress?.((data) => {
      setProgress(data.progress)

      setSpeed(data.speedMBs)

      setDownloadedGB(data.downloadedGB)

      if (data.totalGB) setTotalGB(data.totalGB)

      setTimeRemainingMin(data.remainingMinutes)

      if (data.progress >= 100) {
        gameService.setGameInstalled(true)

        setStatus("play")
      }
    })

    return () => {
      unsub?.()
    }
  }, [])

  const isExpanded = status === "downloading" || status === "paused"

  const cancel = () => {
    window.electronAPI?.cancelDownload?.()

    setStatus(
      manifest?.hasUpdate
        ? "update"
        : manifest?.downloadUrl
          ? "download"
          : "unavailable",
    )

    setProgress(0)

    setSpeed(0)

    setIsHovered(false)
  }

  const togglePauseResume = () => {
    if (status === "downloading") {
      window.electronAPI?.pauseDownload?.()

      setStatus("paused")
    } else if (status === "paused") {
      window.electronAPI?.resumeDownload?.()

      setStatus("downloading")
    }
  }

  const handleClick = () => {
    if (status === "unavailable") {
      return
    }

    if (status === "download" || status === "update") {
      setStatus("downloading")

      window.electronAPI?.startDownload?.(manifest)
    } else if (status === "play") {
      window.electronAPI?.launchGame?.({
        version: manifest?.version || "1.20.1",
      })

      if (onPlay) onPlay()
    }
  }

  const handleVerifyInstallation = () => {
    setIsMenuOpen(false)

    gameService.repairGame()

    showToast(t("playButton.verifying"))

    setTimeout(() => {
      showToast(t("playButton.verifySuccess"))
    }, 2200)
  }

  const handleUninstallGame = () => {
    setIsMenuOpen(false)

    gameService.uninstallGame()

    setStatus(manifest?.downloadUrl ? "download" : "unavailable")

    showToast(t("playButton.uninstallSuccess"))
  }

  /* ── IDLE / UNAVAILABLE / DOWNLOAD / UPDATE / PLAY ── */

  if (!isExpanded) {
    const isUnavailable = status === "unavailable"

    const isUpdate = status === "update"

    const isPlay = status === "play"

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
          disabled={isUnavailable}
          className={isUnavailable ? "" : "dl-idle-btn"}
          style={{
            width: 272,

            height: 76,

            borderRadius: 24,

            background: isUnavailable
              ? isDark
                ? "linear-gradient(135deg, rgba(239, 196, 54, 0.22), rgba(255, 230, 146, 0.22))"
                : "linear-gradient(135deg, rgba(239, 196, 54, 0.35), rgba(255, 230, 146, 0.35))"
              : "linear-gradient(135deg, #efc436, #ffe692)",

            boxShadow: isUnavailable
              ? "none"
              : "0 0 28px -6px rgba(245, 208, 86, 0.45)",

            border: "none",

            cursor: isUnavailable ? "not-allowed" : "pointer",

            opacity: isUnavailable ? 0.65 : 1,

            display: "flex",

            alignItems: "center",

            justifyContent: "center",

            gap: 12,

            transition: "all 0.25s ease",

            userSelect: "none",
          }}
          onClick={handleClick}
        >
          {isPlay ? <IconPlay size={34} /> : <IconDownload size={38} />}
          <span
            style={{
              color: "white",

              fontFamily: BASE_FONT,

              fontWeight: 800,

              fontSize: isUnavailable ? 19 : 23,

              letterSpacing: ".06em",

              textShadow: "0 1px 6px rgba(0,0,0,0.35)",

              textTransform: "uppercase",
            }}
          >
            {isUnavailable
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

        <LiveToast message={toastMessage} />
      </div>
    )
  }

  /* ── DOWNLOADING / PAUSED (Progress card) ── */

  const dlGB = downloadedGB > 0 ? downloadedGB : (totalGB * progress) / 100

  const isUpdating = manifest?.hasUpdate

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
          width: 272,

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

          cursor: "pointer",

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

        {/* Bottom row: Download details or hover action prompt */}
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
          ) : (
            <span
              style={{
                color: isDark ? "rgba(255,255,255,.6)" : "#475569",

                fontFamily: BASE_FONT,

                fontWeight: 700,

                fontSize: 13,
              }}
            >
              {Math.round(dlGB * 10) / 10} / {totalGB} GB
            </span>
          )}

          <span
            style={{
              color: isDark ? "rgba(255,255,255,.6)" : "#475569",

              fontFamily: BASE_FONT,

              fontWeight: 700,

              fontSize: 13,
            }}
          >
            {timeRemainingMin > 0 ? `${timeRemainingMin} MIN` : "-- MIN"}
          </span>
        </div>
      </div>

      {/* ── External Cancel Button (76x76px matching Play Button) ── */}
      <button
        type="button"
        onClick={cancel}
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

          cursor: "pointer",

          display: "flex",

          alignItems: "center",

          justifyContent: "center",
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

      <LiveToast message={toastMessage} />
    </div>
  )
}
