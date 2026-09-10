import React, { useState, useEffect, useCallback } from "react"
import { ThemeMode } from "../types"
import type { LauncherServer } from "../services/serverService"
import { BASE_FONT } from "../theme/tokens"
import { IconDownload, IconPause, IconResume } from "../theme/icons"
import { useTranslation } from "../context/LanguageContext"
import { parseFallbackAccent } from "../utils/dynamicAccent"
import { resolveApiAssetUrl } from "../config/api"
import { gameService } from "../services/gameService"
import type { DownloadQueueSnapshot, ActiveDownloadSnapshot, QueuedDownloadItem } from "../vite-env"

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

  const [activeProgress, setActiveProgress] = useState<{
    progress: number
    speedMBs: number
    downloadedBytes: number
    totalBytes: number
    remainingMinutes: number
    phase: string
  }>({
    progress: 0,
    speedMBs: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    remainingMinutes: 0,
    phase: "DOWNLOADING",
  })

  const refreshQueue = useCallback(async () => {
    try {
      if (window.electronAPI?.getDownloadQueue) {
        const snap = await window.electronAPI.getDownloadQueue()
        if (snap) {
          setQueueData(snap)
          if (snap.active) {
            setActiveProgress((prev) => ({
              progress: snap.active?.progress ?? prev.progress,
              speedMBs: snap.active?.speedMBs ?? prev.speedMBs,
              downloadedBytes: snap.active?.downloadedBytes ?? prev.downloadedBytes,
              totalBytes: snap.active?.totalBytes ?? prev.totalBytes,
              remainingMinutes: snap.active?.remainingMinutes ?? prev.remainingMinutes,
              phase: snap.active?.phase || prev.phase,
            }))
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
      if (snap) {
        setQueueData(snap)
        if (snap.active) {
          setActiveProgress((prev) => ({
            progress: snap.active?.progress ?? prev.progress,
            speedMBs: snap.active?.speedMBs ?? prev.speedMBs,
            downloadedBytes: snap.active?.downloadedBytes ?? prev.downloadedBytes,
            totalBytes: snap.active?.totalBytes ?? prev.totalBytes,
            remainingMinutes: snap.active?.remainingMinutes ?? prev.remainingMinutes,
            phase: snap.active?.phase || prev.phase,
          }))
        }
      } else {
        refreshQueue()
      }
    })

    const unsubProgress = window.electronAPI?.onDownloadProgress?.((data: any) => {
      setActiveProgress({
        progress: typeof data.progress === "number" ? data.progress : 0,
        speedMBs: typeof data.speedMBs === "number" ? data.speedMBs : 0,
        downloadedBytes: typeof data.downloadedBytes === "number" ? data.downloadedBytes : 0,
        totalBytes: typeof data.totalBytes === "number" ? data.totalBytes : 0,
        remainingMinutes: typeof data.remainingMinutes === "number" ? data.remainingMinutes : 0,
        phase: data.phase || "DOWNLOADING",
      })
    })

    return () => {
      unsubQueue?.()
      unsubProgress?.()
    }
  }, [refreshQueue])

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

  const handlePause = async (active: ActiveDownloadSnapshot) => {
    const info = getServerInfo(active.gameId)
    try {
      await gameService.pauseSync({ gameId: active.gameId, gameName: info.name })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Pause failed:", err)
    }
  }

  const handleResume = async (active: ActiveDownloadSnapshot) => {
    const info = getServerInfo(active.gameId)
    try {
      await gameService.resumeSync({ gameId: active.gameId, gameName: info.name })
      refreshQueue()
    } catch (err) {
      console.error("[DownloadsView] Resume failed:", err)
    }
  }

  const handleCancelActive = async (active: ActiveDownloadSnapshot) => {
    const info = getServerInfo(active.gameId)
    try {
      await gameService.cancelSync({ gameId: active.gameId, gameName: info.name })
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

  const active = queueData.active
  const queued = queueData.queued || []
  const hasContent = Boolean(active || queued.length > 0)

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        background: isDark ? "#090d12" : "#f5f7fa",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
        fontFamily: BASE_FONT,
      }}
    >
      {/* Dynamic Ambient Background Glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: isDark
            ? "radial-gradient(1000px 600px at 40% 20%, rgba(56, 189, 248, 0.06), transparent 75%), radial-gradient(800px 500px at 80% 70%, rgba(120, 80, 220, 0.04), transparent 70%)"
            : "radial-gradient(900px 500px at 40% 25%, rgba(56, 189, 248, 0.08), transparent 70%)",
        }}
      />

      {/* Main Content Area */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "54px 80px 48px 120px",
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: isDark ? "#ffffff" : "#111822",
            }}
          >
            {t("downloads.title")}
          </h1>
        </div>

        {/* Scrollable View Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 32,
            paddingRight: 16,
            maxWidth: 1100,
          }}
        >
          {!hasContent ? (
            /* ── EMPTY STATE ── */
            <div
              style={{
                flex: 1,
                minHeight: 480,
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
                  width: 72,
                  height: 72,
                  borderRadius: 22,
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
                <IconDownload size={32} />
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                {t("downloads.empty")}
              </div>
              <div
                style={{
                  fontSize: 15,
                  color: isDark ? "#7a8a99" : "#64748b",
                  maxWidth: 380,
                  lineHeight: 1.45,
                }}
              >
                {t("downloads.emptySubtitle")}
              </div>
            </div>
          ) : (
            <>
              {/* ── ACTIVE DOWNLOAD SECTION ── */}
              {active && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: isDark ? "#657788" : "#778899",
                    }}
                  >
                    {t("downloads.active")}
                  </div>

                  {(() => {
                    const info = getServerInfo(active.gameId)
                    const isPaused = active.state === "PAUSED"
                    const phase = activeProgress.phase || active.phase || "DOWNLOADING"
                    const isInstalling = phase === "INSTALLING"
                    const isVerifying = phase === "VERIFYING"
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

                    const statusColor = isPaused
                      ? "#f59e0b"
                      : isInstalling
                        ? "#38bdf8"
                        : isVerifying
                          ? "#a855f7"
                          : info.accent.hex

                    return (
                      <div
                        style={{
                          background: isDark ? "#121820" : "#ffffff",
                          borderRadius: 20,
                          border: isDark
                            ? "1px solid rgba(255, 255, 255, 0.08)"
                            : "1px solid rgba(0, 0, 0, 0.08)",
                          padding: "24px 28px",
                          boxShadow: isDark
                            ? "0 12px 36px rgba(0, 0, 0, 0.35)"
                            : "0 12px 36px rgba(0, 0, 0, 0.06)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 18,
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
                          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            {info.logoUrl ? (
                              <img
                                src={info.logoUrl}
                                alt={info.name}
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 12,
                                  objectFit: "contain",
                                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 12,
                                  background: `rgba(${info.accent.css}, 0.15)`,
                                  color: info.accent.hex,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 800,
                                  fontSize: 20,
                                }}
                              >
                                {info.name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <div
                                style={{
                                  fontSize: 18,
                                  fontWeight: 700,
                                  color: isDark ? "#ffffff" : "#111822",
                                  marginBottom: 3,
                                }}
                              >
                                {info.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 13.5,
                                  fontWeight: 600,
                                  color: statusColor,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <span
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: statusColor,
                                    boxShadow: `0 0 8px ${statusColor}`,
                                  }}
                                />
                                {statusLabel}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons: Pause/Resume + Cancel */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {isPaused ? (
                              <button
                                type="button"
                                onClick={() => handleResume(active)}
                                title={t("downloads.resume")}
                                style={{
                                  padding: "9px 18px",
                                  borderRadius: 12,
                                  border: "none",
                                  background: `linear-gradient(135deg, ${info.accent.hex}, color-mix(in srgb, ${info.accent.hex} 75%, white))`,
                                  color: "white",
                                  fontSize: 14,
                                  fontWeight: 700,
                                  cursor: "pointer",
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
                                onClick={() => handlePause(active)}
                                title={t("downloads.pause")}
                                style={{
                                  padding: "9px 18px",
                                  borderRadius: 12,
                                  border: isDark
                                    ? "1px solid rgba(255, 255, 255, 0.12)"
                                    : "1px solid rgba(0, 0, 0, 0.12)",
                                  background: isDark ? "rgba(255, 255, 255, 0.06)" : "#f1f5f9",
                                  color: isDark ? "#ffffff" : "#111822",
                                  fontSize: 14,
                                  fontWeight: 700,
                                  cursor: "pointer",
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
                              onClick={() => handleCancelActive(active)}
                              title={t("downloads.cancel")}
                              style={{
                                padding: "9px 18px",
                                borderRadius: 12,
                                border: isDark
                                  ? "1px solid rgba(239, 68, 68, 0.25)"
                                  : "1px solid rgba(239, 68, 68, 0.3)",
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

                        {/* Progress Bar with Server-Specific Accent */}
                        <div
                          style={{
                            width: "100%",
                            height: 10,
                            borderRadius: 6,
                            background: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                            overflow: "hidden",
                            position: "relative",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, progress))}%`,
                              height: "100%",
                              borderRadius: 6,
                              background: isPaused
                                ? "#f59e0b"
                                : `linear-gradient(90deg, ${info.accent.hex}, color-mix(in srgb, ${info.accent.hex} 70%, white))`,
                              boxShadow: isPaused
                                ? "0 0 10px rgba(245, 158, 11, 0.5)"
                                : `0 0 12px rgba(${info.accent.css}, 0.5)`,
                              transition: "width 0.25s ease-out",
                            }}
                          />
                        </div>

                        {/* Progress Details Row */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: 13.5,
                            color: isDark ? "#8899aa" : "#64748b",
                          }}
                        >
                          <div>
                            {total > 0 ? (
                              <>
                                {formatBytes(downloaded)} / {formatBytes(total)}{" "}
                                <span style={{ fontWeight: 700, color: isDark ? "#ffffff" : "#111822" }}>
                                  ({progress}%)
                                </span>
                              </>
                            ) : (
                              <span>{progress}%</span>
                            )}
                          </div>

                          {!isPaused && speedMBs > 0 && (
                            <div style={{ fontWeight: 600 }}>
                              {speedMBs.toFixed(1)} MB/s
                            </div>
                          )}

                          {!isPaused && remainingMin > 0 && (
                            <div>
                              {remainingMin} min {t("downloads.remaining")}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* ── QUEUED DOWNLOADS SECTION ── */}
              {queued.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: isDark ? "#657788" : "#778899",
                    }}
                  >
                    {t("downloads.queue")}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {queued.map((item) => {
                      const info = getServerInfo(item.gameId)
                      return (
                        <div
                          key={item.gameId}
                          style={{
                            background: isDark ? "#121820" : "#ffffff",
                            borderRadius: 16,
                            border: isDark
                              ? "1px solid rgba(255, 255, 255, 0.06)"
                              : "1px solid rgba(0, 0, 0, 0.06)",
                            padding: "16px 20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            boxShadow: isDark
                              ? "0 4px 16px rgba(0, 0, 0, 0.2)"
                              : "0 4px 16px rgba(0, 0, 0, 0.03)",
                          }}
                        >
                          {/* Item Left: Logo + Title + Position */}
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            {info.logoUrl ? (
                              <img
                                src={info.logoUrl}
                                alt={info.name}
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: 10,
                                  objectFit: "contain",
                                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: 10,
                                  background: `rgba(${info.accent.css}, 0.15)`,
                                  color: info.accent.hex,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 800,
                                  fontSize: 16,
                                }}
                              >
                                {info.name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <div
                                style={{
                                  fontSize: 16,
                                  fontWeight: 700,
                                  color: isDark ? "#ffffff" : "#111822",
                                  marginBottom: 2,
                                }}
                              >
                                {info.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 13,
                                  color: isDark ? "#8899aa" : "#64748b",
                                }}
                              >
                                {t("downloads.position", { position: item.position })}
                              </div>
                            </div>
                          </div>

                          {/* Cancel queued item button */}
                          <button
                            type="button"
                            onClick={() => handleCancelQueued(item)}
                            title={t("downloads.cancel")}
                            style={{
                              padding: "7px 14px",
                              borderRadius: 10,
                              border: isDark
                                ? "1px solid rgba(239, 68, 68, 0.25)"
                                : "1px solid rgba(239, 68, 68, 0.3)",
                              background: isDark ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.06)",
                              color: "#ef4444",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                              transition: "all 0.18s ease",
                            }}
                          >
                            {t("downloads.cancel")}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
