import React, { useState, useEffect, useCallback, useRef } from "react"
import { ThemeMode } from "../types"
import type { LauncherServer } from "../services/serverService"
import { CANVAS_W, BASE_FONT, DEFAULT_BLUE_ACCENT } from "../theme/tokens"
import { IconDownload, IconPause, IconResume } from "../theme/icons"
import { useTranslation } from "../context/LanguageContext"
import { parseFallbackAccent } from "../utils/dynamicAccent"
import { resolveApiAssetUrl } from "../config/api"
import { gameService } from "../services/gameService"
import type { DownloadQueueSnapshot, ActiveDownloadSnapshot, QueuedDownloadItem } from "../vite-env"

const CONTENT_LEFT = 184

interface DownloadsViewProps {
  theme?: ThemeMode
  servers?: LauncherServer[]
}

function formatBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0)
  const MB = 1024 ** 2
  const GB = 1024 ** 3
  if (value >= GB) {
    return `${(value / GB).toFixed(1)} GB`
  }
  return `${(value / MB).toFixed(1)} MB`
}

export default function DownloadsView({
  theme = "dark",
  servers = [],
}: DownloadsViewProps) {
  const { t } = useTranslation()
  const isDark = theme === "dark"

  const [queueData, setQueueData] = useState<DownloadQueueSnapshot>({
    active: null,
    queued: [],
  })

  const queueDataRef = useRef(queueData)
  queueDataRef.current = queueData

  const [activeProgress, setActiveProgress] = useState<{
    progress: number
    speedMBs: number
    downloadedBytes: number
    totalBytes: number
    remainingMinutes: number
    phase: string
    isCommitting?: boolean
    canPause?: boolean
    canCancel?: boolean
  }>({
    progress: 0,
    speedMBs: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    remainingMinutes: 0,
    phase: "DOWNLOADING",
    isCommitting: false,
    canPause: true,
    canCancel: true,
  })

  const activeGameIdRef = useRef<string | null>(null)

  const refreshQueue = useCallback(async () => {
    try {
      if (window.electronAPI?.getDownloadQueue) {
        const snap = await window.electronAPI.getDownloadQueue()
        if (snap) {
          setQueueData(snap)
          if (snap.active) {
            const rawProgress = snap.active.progress ?? 0
            const gameChanged = snap.active.gameId !== activeGameIdRef.current
            activeGameIdRef.current = snap.active.gameId || null

            setActiveProgress((prev) => ({
              progress: rawProgress,
              speedMBs: snap.active?.speedMBs ?? prev.speedMBs,
              downloadedBytes: snap.active?.downloadedBytes ?? prev.downloadedBytes,
              totalBytes: snap.active?.totalBytes ?? prev.totalBytes,
              remainingMinutes: snap.active?.remainingMinutes ?? prev.remainingMinutes,
              phase: snap.active?.phase || prev.phase,
              isCommitting: snap.active?.isCommitting ?? prev.isCommitting,
              canPause: snap.active?.canPause ?? prev.canPause,
              canCancel: snap.active?.canCancel ?? prev.canCancel,
            }))
          } else {
            activeGameIdRef.current = null
            setActiveProgress({
              progress: 0,
              speedMBs: 0,
              downloadedBytes: 0,
              totalBytes: 0,
              remainingMinutes: 0,
              phase: "DOWNLOADING",
              isCommitting: false,
              canPause: true,
              canCancel: true,
            })
          }
        }
      }
    } catch (err) {
      console.error("[DownloadsView] Failed to get download queue:", err)
    }
  }, [])

  useEffect(() => {
    refreshQueue()

    const unsubQueue = window.electronAPI?.onDownloadQueueChanged?.((snap: any) => {
      if (snap && typeof snap === "object") {
        setQueueData(snap)
        if (snap.active) {
          const rawProgress = snap.active.progress ?? 0
          activeGameIdRef.current = snap.active.gameId || null

          setActiveProgress((prev) => ({
            progress: rawProgress,
            speedMBs: snap.active?.speedMBs ?? prev.speedMBs,
            downloadedBytes: snap.active?.downloadedBytes ?? prev.downloadedBytes,
            totalBytes: snap.active?.totalBytes ?? prev.totalBytes,
            remainingMinutes: snap.active?.remainingMinutes ?? prev.remainingMinutes,
            phase: snap.active?.phase || prev.phase,
            isCommitting: snap.active?.isCommitting ?? prev.isCommitting,
            canPause: snap.active?.canPause ?? prev.canPause,
            canCancel: snap.active?.canCancel ?? prev.canCancel,
          }))
        } else {
          activeGameIdRef.current = null
          setActiveProgress({
            progress: 0,
            speedMBs: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            remainingMinutes: 0,
            phase: "DOWNLOADING",
            isCommitting: false,
            canPause: true,
            canCancel: true,
          })
        }
      } else {
        refreshQueue()
      }
    })

    const unsubProgress = window.electronAPI?.onDownloadProgress?.((data: any) => {
      const currentActive = queueDataRef.current.active
      if (data?.gameId && currentActive?.gameId && data.gameId !== currentActive.gameId) {
        return
      }

      const rawProgress = typeof data.progress === "number" ? data.progress : 0
      setActiveProgress((prev) => ({
        progress: rawProgress,
        speedMBs: typeof data.speedMBs === "number" ? data.speedMBs : 0,
        downloadedBytes: typeof data.downloadedBytes === "number" ? data.downloadedBytes : 0,
        totalBytes: typeof data.totalBytes === "number" ? data.totalBytes : 0,
        remainingMinutes: typeof data.remainingMinutes === "number" ? data.remainingMinutes : 0,
        phase: data.phase || prev.phase || "DOWNLOADING",
        isCommitting: data.isCommitting ?? prev.isCommitting,
        canPause: data.canPause ?? prev.canPause,
        canCancel: data.canCancel ?? prev.canCancel,
      }))
    })

    return () => {
      unsubQueue?.()
      unsubProgress?.()
    }
  }, [refreshQueue])

  // Ambient mouse offset parallax matching SettingsView
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

  const getServerInfo = (gameId: string) => {
    const server = servers.find((s) => s.id === gameId)
    const name = server?.name || gameId
    const logoUrl = server?.sidebarLogo?.url
      ? resolveApiAssetUrl(server.sidebarLogo.url)
      : server?.mainLogo?.url
        ? resolveApiAssetUrl(server.mainLogo.url)
        : ""
    const accent = parseFallbackAccent(server?.accentColor || undefined)
    return { server, name, logoUrl, accent }
  }

  const active = queueData.active
  const queued = queueData.queued || []
  const hasContent = Boolean(active || queued.length > 0)

  // Determine ambient accent color: active -> queued[0] -> default neutral blue
  const activeServer = active ? servers.find((s) => s.id === active.gameId) : null
  const firstQueuedServer = !active && queued.length > 0 ? servers.find((s) => s.id === queued[0].gameId) : null
  const ambientTarget = activeServer || firstQueuedServer
  const ambientAccent = ambientTarget?.accentColor
    ? parseFallbackAccent(ambientTarget.accentColor)
    : DEFAULT_BLUE_ACCENT

  const ambientR = ambientAccent.r
  const ambientG = ambientAccent.g
  const ambientB = ambientAccent.b

  const handlePause = async (activeItem: ActiveDownloadSnapshot) => {
    const info = getServerInfo(activeItem.gameId)
    try {
      await gameService.pauseSync({ gameId: activeItem.gameId, gameName: info.name })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Pause failed:", err)
    }
  }

  const handleResume = async (activeItem: ActiveDownloadSnapshot) => {
    const info = getServerInfo(activeItem.gameId)
    try {
      await gameService.resumeSync({ gameId: activeItem.gameId, gameName: info.name })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Resume failed:", err)
    }
  }

  const handleCancelActive = async (activeItem: ActiveDownloadSnapshot) => {
    const info = getServerInfo(activeItem.gameId)
    try {
      await gameService.cancelSync({ gameId: activeItem.gameId, gameName: info.name })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Cancel active failed:", err)
    }
  }

  const handleCancelQueued = async (item: QueuedDownloadItem) => {
    try {
      await gameService.cancelSync({ gameId: item.gameId, gameName: item.gameName })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Cancel queued failed:", err)
    }
  }

  const handlePromoteQueued = async (item: QueuedDownloadItem) => {
    try {
      const isAnyActiveCommittingOrVerifying = Boolean(
        active &&
        (active.isCommitting || active.phase === "VERIFYING" || active.canPause === false || activeProgress.isCommitting || activeProgress.phase === "VERIFYING" || activeProgress.canPause === false) &&
        active.state !== "PAUSED" &&
        active.phase !== "PAUSED"
      )
      if (isAnyActiveCommittingOrVerifying) {
        return
      }
      await gameService.promoteQueuedSync({ gameId: item.gameId, gameName: item.gameName })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Promote queued failed:", err)
    }
  }

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
        userSelect: "none",
        fontFamily: BASE_FONT,
      }}
    >
      {/* ── Dynamic Ambient Glow Background (Pattern identical to SettingsView) ── */}
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

      {/* ── Ambient Radial Atmosphere Overlay (Pattern identical to SettingsView) ── */}
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

      {/* ── Main Content Container (Aligned exactly to left: 184, top: 145, right: 80, bottom: 24 matching Settings/Skins) ── */}
      <div
        data-testid="downloads-view-container"
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 145,
          right: 80,
          bottom: 24,
          display: "flex",
          flexDirection: "column",
          zIndex: 10,
          animation: "viewFadeIn 0.24s ease",
        }}
      >
        {/* ── Header Row (Identical structure and metrics with Settings/Skins) ── */}
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
              {t("downloads.title")}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 400,
                color: isDark ? "#8899aa" : "#556677",
              }}
            >
              {t("downloads.subtitle")}
            </div>
          </div>
        </div>

        {/* ── View Content (Scrollable, full width between left: 184 and right: 80) ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            paddingRight: 8,
            width: "100%",
          }}
        >
          {!hasContent ? (
            /* ── EMPTY STATE (Centered across the entire available panel width) ── */
            <div
              style={{
                flex: 1,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
                  border: isDark
                    ? "1px solid rgba(255, 255, 255, 0.08)"
                    : "1px solid rgba(0, 0, 0, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.4)",
                }}
              >
                <IconDownload size={26} />
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                {t("downloads.empty")}
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  color: isDark ? "#8899aa" : "#556677",
                  maxWidth: 380,
                  lineHeight: 1.45,
                }}
              >
                {t("downloads.emptySubtitle")}
              </div>
            </div>
          ) : (
            <>
              {/* ── UNIFIED DOWNLOADS SECTION (ACTIVA) ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                  }}
                >
                  {t("downloads.active")}
                </div>

                {active && (() => {
                    const info = getServerInfo(active.gameId)
                    const isPaused = active.state === "PAUSED" || active.phase === "PAUSED"
                    const phase = activeProgress.phase || active.phase || "DOWNLOADING"
                    const isInstalling = phase === "INSTALLING"
                    const isVerifying = phase === "VERIFYING"
                    const isCommitting = Boolean(activeProgress.isCommitting || active.isCommitting)
                    const canPause = active.canPause !== false && activeProgress.canPause !== false && !isCommitting && !isVerifying
                    const canCancel = active.canCancel !== false && activeProgress.canCancel !== false && !isCommitting && !isVerifying
                    const progress = activeProgress.progress ?? active.progress ?? 0
                    const speedMBs = activeProgress.speedMBs ?? active.speedMBs ?? 0
                    const downloaded = activeProgress.downloadedBytes ?? active.downloadedBytes ?? 0
                    const total = activeProgress.totalBytes ?? active.totalBytes ?? 0
                    const remainingMin = activeProgress.remainingMinutes ?? active.remainingMinutes ?? 0

                    const statusLabel = isPaused
                      ? t("downloads.paused")
                      : isInstalling
                        ? t("downloads.installing")
                        : isVerifying
                          ? t("downloads.verifying")
                          : t("downloads.downloading")

                    const statusColor = info.accent.hex

                    return (
                      <div
                        style={{
                          background: isDark ? "#0d1217" : "#ffffff",
                          borderRadius: 16,
                          border: isDark
                            ? "1.5px solid rgba(255, 255, 255, 0.08)"
                            : "1.5px solid rgba(0, 0, 0, 0.08)",
                          padding: "20px 24px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 16,
                        }}
                      >
                        {/* Header Row: Server Info + Actions */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            {info.logoUrl ? (
                              <img
                                src={info.logoUrl}
                                alt={info.name}
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 12,
                                  objectFit: "contain",
                                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 12,
                                  background: `rgba(${info.accent.css}, 0.15)`,
                                  color: info.accent.hex,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 800,
                                  fontSize: 18,
                                }}
                              >
                                {info.name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <div
                                style={{
                                  fontSize: 17,
                                  fontWeight: 700,
                                  color: isDark ? "#ffffff" : "#111822",
                                  marginBottom: 3,
                                }}
                              >
                                {info.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 14.5,
                                  fontWeight: 600,
                                  color: statusColor,
                                  opacity: isPaused ? 0.75 : 1,
                                }}
                              >
                                {statusLabel}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons: Pause/Resume + Cancel */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {isPaused ? (
                              <button
                                type="button"
                                className="launcher-btn-secondary"
                                onClick={() => handleResume(active)}
                                disabled={isCommitting}
                                title={t("downloads.resume")}
                                style={{
                                  padding: "8px 16px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: `linear-gradient(135deg, ${info.accent.hex}, color-mix(in srgb, ${info.accent.hex} 75%, white))`,
                                  color: "white",
                                  fontSize: 14,
                                  fontWeight: 700,
                                  cursor: isCommitting ? "not-allowed" : "pointer",
                                  opacity: isCommitting ? 0.5 : 1,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  boxShadow: `0 2px 10px rgba(${info.accent.css}, 0.35)`,
                                  transition: "opacity 0.18s ease, transform 0.18s ease",
                                }}
                              >
                                <IconResume size={14} color="white" />
                                {t("downloads.resume")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="launcher-btn-secondary"
                                onClick={() => handlePause(active)}
                                disabled={!canPause}
                                title={t("downloads.pause")}
                                style={{
                                  padding: "8px 16px",
                                  borderRadius: 10,
                                  border: isDark
                                    ? "1.5px solid rgba(255, 255, 255, 0.1)"
                                    : "1.5px solid rgba(0, 0, 0, 0.1)",
                                  background: isDark ? "rgba(255, 255, 255, 0.05)" : "#f1f5f9",
                                  color: isDark ? "#ffffff" : "#111822",
                                  fontSize: 14,
                                  fontWeight: 700,
                                  cursor: !canPause ? "not-allowed" : "pointer",
                                  opacity: !canPause ? 0.5 : 1,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  transition: "all 0.18s ease",
                                }}
                              >
                                <IconPause size={14} color={isDark ? "white" : "#111822"} />
                                {t("downloads.pause")}
                              </button>
                            )}

                            <button
                              type="button"
                              className="launcher-btn-danger dl-cancel-btn"
                              onClick={() => handleCancelActive(active)}
                              disabled={!canCancel}
                              title={t("downloads.cancel")}
                              style={{
                                padding: "8px 16px",
                                borderRadius: 10,
                                border: isDark
                                  ? "1.5px solid rgba(239, 68, 68, 0.25)"
                                  : "1.5px solid rgba(239, 68, 68, 0.3)",
                                background: isDark ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.06)",
                                color: "#ef4444",
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: !canCancel ? "not-allowed" : "pointer",
                                opacity: !canCancel ? 0.5 : 1,
                                transition: "all 0.18s ease",
                              }}
                            >
                              {t("downloads.cancel")}
                            </button>
                          </div>
                        </div>

                        {/* Progress Bar with Server-Specific Accent */}
                        <div
                          style={{
                            width: "100%",
                            height: 8,
                            borderRadius: 4,
                            background: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                            overflow: "hidden",
                            position: "relative",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, progress))}%`,
                              height: "100%",
                              borderRadius: 4,
                              background: isPaused
                                ? `linear-gradient(90deg, rgba(${info.accent.css}, 0.5), rgba(${info.accent.css}, 0.7))`
                                : `linear-gradient(90deg, ${info.accent.hex}, color-mix(in srgb, ${info.accent.hex} 70%, white))`,
                              boxShadow: isPaused
                                ? `0 0 6px rgba(${info.accent.css}, 0.25)`
                                : `0 0 12px rgba(${info.accent.css}, 0.5)`,
                              opacity: isPaused ? 0.8 : 1,
                              transition: "width 0.25s ease-out",
                            }}
                          />
                        </div>

                        {/* Progress Details: Two-Zone Layout (Left: Size & Speed, Right: Percent & ETA) */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 16,
                          }}
                        >
                          {/* Bloque Izquierdo: tamaño descargado / total y velocidad */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 16,
                              fontSize: 14.5,
                              color: isDark ? "#8899aa" : "#64748b",
                            }}
                          >
                            <div data-testid="download-metric-size" style={{ whiteSpace: "nowrap" }}>
                              {total > 0 ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : "--"}
                            </div>

                            <div
                              data-testid="download-metric-speed"
                              style={{
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {!isPaused && speedMBs > 0 ? `${speedMBs.toFixed(1)} MB/s` : ""}
                            </div>
                          </div>

                          {/* Bloque Derecho: porcentaje como dato principal a la derecha, ETA debajo */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              textAlign: "right",
                            }}
                          >
                            <div
                              data-testid="download-metric-percent"
                              style={{
                                fontWeight: 800,
                                fontSize: 16,
                                lineHeight: 1.1,
                                color: isDark ? "#ffffff" : "#111822",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {progress}%
                            </div>

                            <div
                              data-testid="download-metric-eta"
                              style={{
                                fontSize: 12.5,
                                color: isDark ? "#8899aa" : "#64748b",
                                whiteSpace: "nowrap",
                                marginTop: !isPaused && remainingMin > 0 ? 3 : 0,
                              }}
                            >
                              {!isPaused && remainingMin > 0 ? `${remainingMin} min ${t("downloads.remaining")}` : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                {/* ── QUEUED DOWNLOADS (IMMEDIATELY BELOW ACTIVE) ── */}
                {queued.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {queued.map((item) => {
                      const info = getServerInfo(item.gameId)
                      const hasStarted = Boolean(
                        item.hasStarted ||
                        item.savedPhase ||
                        (typeof item.savedProgress === "number" && item.savedProgress > 0)
                      )
                      const isCannotPromote = Boolean(
                        active &&
                        (active.isCommitting || active.phase === "VERIFYING" || active.canPause === false || activeProgress.isCommitting || activeProgress.phase === "VERIFYING" || activeProgress.canPause === false) &&
                        active.state !== "PAUSED" &&
                        active.phase !== "PAUSED"
                      )
                      return (
                        <div
                          key={item.gameId}
                          style={{
                            background: isDark ? "#0d1217" : "#ffffff",
                            borderRadius: 14,
                            border: isDark
                              ? "1.5px solid rgba(255, 255, 255, 0.06)"
                              : "1.5px solid rgba(0, 0, 0, 0.06)",
                            padding: "14px 18px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          {/* Item Left: Logo + Title + Position */}
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {info.logoUrl ? (
                              <img
                                src={info.logoUrl}
                                alt={info.name}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  objectFit: "contain",
                                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  background: `rgba(${info.accent.css}, 0.15)`,
                                  color: info.accent.hex,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 800,
                                  fontSize: 15,
                                }}
                              >
                                {info.name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <div
                                style={{
                                  fontSize: 17,
                                  fontWeight: 700,
                                  color: isDark ? "#ffffff" : "#111822",
                                  marginBottom: 2,
                                }}
                              >
                                {info.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 14.5,
                                  color: isDark ? "#8899aa" : "#64748b",
                                }}
                              >
                                {t("downloads.installationQueued")}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons: Start/Resume + Cancel */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button
                              type="button"
                              className="launcher-btn-secondary"
                              onClick={() => handlePromoteQueued(item)}
                              disabled={isCannotPromote}
                              title={hasStarted ? t("downloads.resume") : t("downloads.startNow")}
                              style={{
                                padding: "7px 14px",
                                borderRadius: 10,
                                border: "none",
                                background: `linear-gradient(135deg, ${info.accent.hex}, color-mix(in srgb, ${info.accent.hex} 75%, white))`,
                                color: "white",
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: isCannotPromote ? "not-allowed" : "pointer",
                                opacity: isCannotPromote ? 0.5 : 1,
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                boxShadow: `0 2px 10px rgba(${info.accent.css}, 0.35)`,
                                transition: "all 0.18s ease",
                              }}
                            >
                              {hasStarted ? (
                                <IconResume size={14} color="white" />
                              ) : (
                                <IconDownload size={14} color="white" />
                              )}
                              {hasStarted ? t("downloads.resume") : t("downloads.startNow")}
                            </button>

                            {/* Cancel queued item button */}
                            <button
                              type="button"
                              className="launcher-btn-danger dl-cancel-btn"
                              onClick={() => handleCancelQueued(item)}
                              title={t("downloads.cancel")}
                              style={{
                                padding: "7px 14px",
                                borderRadius: 10,
                                border: isDark
                                  ? "1.5px solid rgba(239, 68, 68, 0.25)"
                                  : "1.5px solid rgba(239, 68, 68, 0.3)",
                                background: isDark ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.06)",
                                color: "#ef4444",
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: "pointer",
                                transition: "all 0.18s ease",
                              }}
                            >
                              {t("downloads.cancel")}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
