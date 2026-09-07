import React, { useState, useEffect } from "react"
import type { ThemeMode, ServerResources, AdminGameOverview, BackofficeSection, ServerItem } from "../../types"
import { serverApi, newsApi, gameApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
import {
  IconServer,
  IconNews,
  IconGamepad,
  IconSpinner,
  IconPlus,
  IconSettings,
  IconTerminal,
  IconCpu,
  IconRam,
  IconDisk,
} from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface DashboardViewProps {
  theme: ThemeMode
  serverId: string
  server?: ServerItem | null
  onNavigate: (section: BackofficeSection) => void
}

const SERVER_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ONLINE: { label: "En línea", bg: "rgba(34, 197, 94, 0.15)", color: "#22c55e" },
  STARTING: { label: "Iniciando...", bg: "rgba(234, 179, 8, 0.15)", color: "#eab308" },
  STOPPING: { label: "Deteniendo...", bg: "rgba(249, 115, 22, 0.15)", color: "#f97316" },
  OFFLINE: { label: "Apagado", bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8" },
  DISCONNECTED: { label: "Desconectado", bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  UNKNOWN: { label: "No disponible", bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8" },
}

export default function DashboardView({
  theme,
  serverId,
  server,
  onNavigate,
}: DashboardViewProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  const [serverResources, setServerResources] = useState<ServerResources | null>(null)
  const [newsCounts, setNewsCounts] = useState<{ published: number; draft: number }>({ published: 0, draft: 0 })
  const [gameOverview, setGameOverview] = useState<AdminGameOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    async function loadScopedDashboard() {
      setIsLoading(true)
      try {
        const [serverStatusRes, newsRes, gameRes] = await Promise.allSettled([
          serverApi.getServerStatus(serverId),
          newsApi.getAdminNews({ serverId, first: 100 }),
          gameApi.getAdminGameOverview(serverId),
        ])

        if (!isMounted) return

        if (serverStatusRes.status === "fulfilled") {
          setServerResources(serverStatusRes.value)
        }
        if (newsRes.status === "fulfilled" && newsRes.value?.items) {
          const published = newsRes.value.items.filter((i) => i.status === "PUBLISHED").length
          const draft = newsRes.value.items.filter((i) => i.status === "DRAFT").length
          setNewsCounts({ published, draft })
        }
        if (gameRes.status === "fulfilled") {
          setGameOverview(gameRes.value)
        }
      } catch {
        if (isMounted) setToastMessage("No se pudo cargar el resumen del servidor.")
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadScopedDashboard()
    return () => {
      isMounted = false
    }
  }, [serverId])

  const currentStatusConfig = serverResources?.status
    ? SERVER_STATUS_CONFIG[serverResources.status] || SERVER_STATUS_CONFIG.UNKNOWN
    : SERVER_STATUS_CONFIG.UNKNOWN

  const pendingChangesCount =
    gameOverview?.changes?.total ||
    (gameOverview?.draftRelease?.files ? gameOverview.draftRelease.files.length : 0)

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: "32px 36px",
        overflowY: "auto",
        animation: "viewFadeIn 0.24s ease",
        fontFamily: "Inter, sans-serif",
      }}
      className="custom-scroll"
    >
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            margin: "0 0 6px 0",
            fontSize: "26px",
            fontWeight: "800",
            color: tokens.textPrimary,
            letterSpacing: "-0.02em",
          }}
        >
          {server?.name ? `Dashboard: ${server.name}` : "Panel de control del servidor"}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            fontWeight: "500",
            color: tokens.textSecondary,
          }}
        >
          Estado general, noticias y actualizaciones activas del servidor.
        </p>
      </div>

      {isLoading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            color: tokens.textMuted,
            gap: "12px",
          }}
        >
          <IconSpinner size={24} />
          <span>Cargando panel del servidor...</span>
        </div>
      ) : (
        <>
          {/* Metrics Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "20px",
              marginBottom: "32px",
            }}
          >
            {/* Card 1: Servidor Minecraft */}
            <div
              style={{
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: tokens.cardShadow,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: tokens.textSecondary }}>
                    Servidor de Juego
                  </span>
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "12px",
                      backgroundColor: isDark ? "rgba(99, 102, 241, 0.15)" : "#eef2ff",
                      color: "#6366f1",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconServer size={20} />
                  </div>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 12px",
                      borderRadius: "20px",
                      fontSize: "13px",
                      fontWeight: "600",
                      backgroundColor: currentStatusConfig.bg,
                      color: currentStatusConfig.color,
                    }}
                  >
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: currentStatusConfig.color }} />
                    {currentStatusConfig.label}
                  </span>
                </div>

                <div style={{ fontSize: "12.5px", color: tokens.textSecondary, marginTop: 6 }}>
                  {serverResources ? `${serverResources.cpuPercent.toFixed(1)}% CPU · ${(serverResources.memoryUsedBytes / (1024 * 1024)).toFixed(0)} MB RAM` : "Sin telemetría en vivo"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate("server")}
                className="launcher-btn-secondary"
                style={{
                  marginTop: "16px",
                  padding: "9px 16px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: "600",
                  textAlign: "center",
                  justifyContent: "center",
                }}
              >
                Administrar servidor →
              </button>
            </div>

            {/* Card 2: Noticias del Servidor */}
            <div
              style={{
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: tokens.cardShadow,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: tokens.textSecondary }}>
                    Noticias del Servidor
                  </span>
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "12px",
                      backgroundColor: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                      color: "#3ec4c0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconNews size={20} />
                  </div>
                </div>

                <div style={{ fontSize: "28px", fontWeight: "800", color: tokens.textPrimary, marginBottom: "4px" }}>
                  {newsCounts.published}
                </div>
                <div style={{ fontSize: "12px", color: tokens.textSecondary }}>
                  Publicadas ({newsCounts.draft} en borrador)
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate("news")}
                className="launcher-btn-secondary"
                style={{
                  marginTop: "16px",
                  padding: "9px 16px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: "600",
                  textAlign: "center",
                  justifyContent: "center",
                }}
              >
                Ver noticias →
              </button>
            </div>

            {/* Card 3: Juego / Actualizaciones del Modpack */}
            <div
              style={{
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: tokens.cardShadow,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: tokens.textSecondary }}>
                    Versión del Modpack
                  </span>
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "12px",
                      backgroundColor: isDark ? "rgba(168, 85, 247, 0.15)" : "#f5f3ff",
                      color: "#a855f7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconGamepad size={20} />
                  </div>
                </div>

                <div style={{ fontSize: "24px", fontWeight: "800", color: tokens.textPrimary, marginBottom: "4px" }}>
                  {gameOverview?.publishedRelease?.version ? `v${gameOverview.publishedRelease.version}` : "Sin publicar"}
                </div>
                <div style={{ fontSize: "12px", color: tokens.textSecondary }}>
                  {pendingChangesCount ? `${pendingChangesCount} cambios en borrador` : "Al día con los clientes"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate("game")}
                className="launcher-btn-secondary"
                style={{
                  marginTop: "16px",
                  padding: "9px 16px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: "600",
                  textAlign: "center",
                  justifyContent: "center",
                }}
              >
                Gestionar juego y mods →
              </button>
            </div>

            {/* Card 4: Ajustes y Recursos */}
            <div
              style={{
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: tokens.cardShadow,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: tokens.textSecondary }}>
                    Recursos del Servidor
                  </span>
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "12px",
                      backgroundColor: isDark ? "rgba(245, 166, 35, 0.15)" : "#fffbeb",
                      color: "#f5a623",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconCpu size={20} />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "13px", color: tokens.textPrimary }}>
                  <div>
                    <strong>CPU:</strong> {server?.cpu ? `${server.cpu}%` : "—"}
                  </div>
                  <div>
                    <strong>RAM:</strong> {server?.memoryMb ? `${(server.memoryMb / 1024).toFixed(0)} GB` : "—"}
                  </div>
                  <div>
                    <strong>Disco:</strong> {server?.diskMb ? `${(server.diskMb / 1024).toFixed(0)} GB` : "—"}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate("server-settings")}
                className="launcher-btn-secondary"
                style={{
                  marginTop: "16px",
                  padding: "9px 16px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: "600",
                  textAlign: "center",
                  justifyContent: "center",
                }}
              >
                Ajustes del servidor →
              </button>
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div
            style={{
              backgroundColor: tokens.bgCard,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: "18px",
              padding: "24px",
              boxShadow: tokens.cardShadow,
            }}
          >
            <h2
              style={{
                margin: "0 0 16px 0",
                fontSize: "16px",
                fontWeight: "700",
                color: tokens.textPrimary,
              }}
            >
              Accesos rápidos del espacio de trabajo
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <button
                type="button"
                onClick={() => onNavigate("news")}
                className="launcher-btn-secondary"
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <IconPlus size={16} />
                <span>Nueva Noticia</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate("server")}
                className="launcher-btn-secondary"
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <IconTerminal size={16} />
                <span>Consola del Servidor</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate("game")}
                className="launcher-btn-secondary"
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <IconGamepad size={16} />
                <span>Actualizaciones del Modpack</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate("server-settings")}
                className="launcher-btn-secondary"
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <IconSettings size={16} />
                <span>Ajustes del Servidor</span>
              </button>
            </div>
          </div>
        </>
      )}

      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type="error"
          theme={theme}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}

