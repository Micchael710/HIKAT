import React, { useState, useEffect } from "react"
import type { ThemeMode, AdminDashboardSummary, BackofficeSection } from "../../types"
import { dashboardApi } from "../../services/graphqlClient"
import {
  IconDashboard,
  IconServer,
  IconNews,
  IconShirt,
  IconGamepad,
  IconSpinner,
  IconPlus,
} from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface DashboardViewProps {
  theme: ThemeMode
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

export default function DashboardView({ theme, onNavigate }: DashboardViewProps) {
  const isDark = theme === "dark"
  const [data, setData] = useState<AdminDashboardSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    async function loadDashboard() {
      setIsLoading(true)
      try {
        const summary = await dashboardApi.getAdminDashboard()
        if (isMounted) setData(summary)
      } catch (err: any) {
        if (isMounted) setToastMessage("No se pudo cargar el resumen del panel.")
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    loadDashboard()
    return () => {
      isMounted = false
    }
  }, [])

  const serverStatus = data?.server?.status ? (SERVER_STATUS_CONFIG[data.server.status] || SERVER_STATUS_CONFIG.UNKNOWN) : SERVER_STATUS_CONFIG.UNKNOWN

  return (
    <div style={{ padding: "28px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            margin: "0 0 6px 0",
            fontSize: "24px",
            fontWeight: "700",
            color: isDark ? "#f1f5f9" : "#0f172a",
            letterSpacing: "-0.02em",
          }}
        >
          Panel de control
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            color: isDark ? "#94a3b8" : "#64748b",
          }}
        >
          Estado general y métricas clave de HiKAT.
        </p>
      </div>

      {isLoading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            color: isDark ? "#94a3b8" : "#64748b",
            gap: "12px",
          }}
        >
          <IconSpinner size={24} />
          <span>Cargando panel de control...</span>
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
            {/* Card 1: Servidor */}
            <div
              style={{
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                    Servidor Minecraft
                  </span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
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
                      padding: "4px 10px",
                      borderRadius: "20px",
                      fontSize: "13px",
                      fontWeight: "600",
                      backgroundColor: serverStatus.bg,
                      color: serverStatus.color,
                    }}
                  >
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: serverStatus.color }} />
                    {serverStatus.label}
                  </span>
                </div>
              </div>

              <button
                onClick={() => onNavigate("server")}
                style={{
                  marginTop: "16px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Administrar servidor →
              </button>
            </div>

            {/* Card 2: Noticias */}
            <div
              style={{
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                    Noticias y Anuncios
                  </span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
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

                <div style={{ fontSize: "28px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a", marginBottom: "4px" }}>
                  {data?.news?.publishedCount || 0}
                </div>
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  Publicadas ({data?.news?.draftCount || 0} en borrador)
                </div>
              </div>

              <button
                onClick={() => onNavigate("news")}
                style={{
                  marginTop: "16px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Ver noticias →
              </button>
            </div>

            {/* Card 3: Skins */}
            <div
              style={{
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                    Catálogo de Skins
                  </span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      backgroundColor: isDark ? "rgba(244, 63, 94, 0.15)" : "#fff1f2",
                      color: "#f43f5e",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconShirt size={20} />
                  </div>
                </div>

                <div style={{ fontSize: "28px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a", marginBottom: "4px" }}>
                  {data?.skins?.availableCount || 0}
                </div>
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  Disponibles en el catálogo ({data?.skins?.totalCount || 0} total)
                </div>
              </div>

              <button
                onClick={() => onNavigate("skins")}
                style={{
                  marginTop: "16px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Ver skins →
              </button>
            </div>

            {/* Card 4: Juego / Actualizaciones */}
            <div
              style={{
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                    Versión del Juego
                  </span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
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

                <div style={{ fontSize: "24px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a", marginBottom: "4px" }}>
                  {data?.game?.publishedVersion ? `v${data.game.publishedVersion}` : "Sin publicar"}
                </div>
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  {data?.game?.pendingChangesCount ? `${data.game.pendingChangesCount} cambios en borrador` : "Al día con el cliente"}
                </div>
              </div>

              <button
                onClick={() => onNavigate("game")}
                style={{
                  marginTop: "16px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Gestionar juego y mods →
              </button>
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "24px",
              boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <h2
              style={{
                margin: "0 0 16px 0",
                fontSize: "16px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Accesos rápidos
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <button
                onClick={() => onNavigate("news")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  backgroundColor: isDark ? "#334155" : "#f1f5f9",
                  border: "none",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                <IconPlus size={16} />
                Nueva Noticia
              </button>

              <button
                onClick={() => onNavigate("skins")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  backgroundColor: isDark ? "#334155" : "#f1f5f9",
                  border: "none",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                <IconPlus size={16} />
                Subir Skin
              </button>

              <button
                onClick={() => onNavigate("game")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  backgroundColor: isDark ? "#334155" : "#f1f5f9",
                  border: "none",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                <IconGamepad size={16} />
                Actualizaciones del Juego
              </button>

              <button
                onClick={() => onNavigate("settings")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  backgroundColor: isDark ? "#334155" : "#f1f5f9",
                  border: "none",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Ajustes Generales
              </button>
            </div>
          </div>
        </>
      )}

      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type="error"
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}
