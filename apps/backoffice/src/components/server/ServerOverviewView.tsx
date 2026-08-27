import React, { useState, useEffect, useRef, useCallback } from "react"
import type { ThemeMode, ServerResources, ServerPowerAction, ServerActivityItem } from "../../types"
import { serverApi } from "../../services/graphqlClient"
import { formatBytesToHuman, formatUptime } from "@hikat/shared"
import ServerStatusBadge from "./ServerStatusBadge"
import ServerResourceCard from "./ServerResourceCard"
import ServerPowerActions from "./ServerPowerActions"
import ServerConsoleView from "./ServerConsoleView"
import ServerWorldView from "./ServerWorldView"
import ServerBackupsView from "./ServerBackupsView"
import ServerAutomationsView from "./ServerAutomationsView"
import ServerConfigurationView from "./ServerConfigurationView"
import ServerFilesView from "./ServerFilesView"
import LiveToast from "../common/LiveToast"
import {
  IconServer,
  IconCpu,
  IconRam,
  IconDisk,
  IconTerminal,
  IconClock,
  IconRefresh,
  IconSpinner,
  IconAlertCircle,
  IconGlobe,
  IconArchive,
  IconCalendar,
  IconSliders,
  IconFolder,
  IconDownload,
  IconUpload,
  IconHistory,
} from "../../theme/icons"

interface ServerOverviewViewProps {
  theme: ThemeMode
}

export type ServerSubTab =
  | "overview"
  | "console"
  | "world"
  | "backups"
  | "automations"
  | "configuration"
  | "files"

const SUB_TABS: Array<{ id: ServerSubTab; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Resumen", icon: <IconServer size={18} /> },
  { id: "console", label: "Consola", icon: <IconTerminal size={18} /> },
  { id: "world", label: "Mundo", icon: <IconGlobe size={18} /> },
  { id: "backups", label: "Copias", icon: <IconArchive size={18} /> },
  { id: "automations", label: "Automatizaciones", icon: <IconCalendar size={18} /> },
  { id: "configuration", label: "Configuración", icon: <IconSliders size={18} /> },
  { id: "files", label: "Archivos", icon: <IconFolder size={18} /> },
]

export default function ServerOverviewView({ theme }: ServerOverviewViewProps) {
  const isDark = theme === "dark"
  const [activeTab, setActiveTab] = useState<ServerSubTab>("overview")
  const [resources, setResources] = useState<ServerResources | null>(null)
  const [activity, setActivity] = useState<ServerActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isActivityLoading, setIsActivityLoading] = useState(false)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<"success" | "error">("success")

  const isMountedRef = useRef(true)
  const isFetchingRef = useRef(false)
  const hasDataRef = useRef(false)
  const isActionLoadingRef = useRef(false)

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToastMessage(message)
    setToastType(type)
  }, [])

  // Stable status fetcher
  const fetchStatus = useCallback(async (isManual: boolean = false) => {
    if (isFetchingRef.current || !isMountedRef.current) return
    isFetchingRef.current = true

    if (isManual) {
      setError(null)
    }

    try {
      const data = await serverApi.getServerStatus()
      if (isMountedRef.current) {
        setResources(data)
        hasDataRef.current = true
        setError(null)
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const msg =
          err instanceof Error
            ? err.message
            : "No se pudo obtener el estado del servidor."
        if (!hasDataRef.current) {
          setError(msg)
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
      isFetchingRef.current = false
    }
  }, [])

  // Activity fetcher
  const fetchActivity = useCallback(async () => {
    setIsActivityLoading(true)
    try {
      const list = await serverApi.getServerActivity()
      if (isMountedRef.current) {
        setActivity(list)
      }
    } catch {
      // Non-critical, ignore
    } finally {
      if (isMountedRef.current) {
        setIsActivityLoading(false)
      }
    }
  }, [])

  // Controlled polling: exactly 1 initial fetch, then maximum once per ~5s when visible
  useEffect(() => {
    isMountedRef.current = true
    fetchStatus()
    fetchActivity()

    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && !isActionLoadingRef.current) {
        fetchStatus()
      }
    }, 5000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !isActionLoadingRef.current) {
        fetchStatus()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      isMountedRef.current = false
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchStatus, fetchActivity])

  const handlePowerAction = async (action: ServerPowerAction) => {
    setIsActionLoading(true)
    isActionLoadingRef.current = true
    try {
      let res: { success: boolean; message?: string }
      if (action === "START") {
        res = await serverApi.startServer()
      } else if (action === "RESTART") {
        res = await serverApi.restartServer()
      } else {
        res = await serverApi.stopServer()
      }

      showToast(res.message || "Acción enviada correctamente.", "success")
      await fetchStatus()
      await fetchActivity()
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se pudo ejecutar la acción del servidor."
      showToast(msg, "error")
    } finally {
      setIsActionLoading(false)
      isActionLoadingRef.current = false
    }
  }

  const currentStatus = resources?.status || (error ? "DISCONNECTED" : "UNKNOWN")

  // RAM calculations
  const memUsed = resources?.memoryUsedBytes ?? 0
  const memLimit = resources?.memoryLimitBytes ?? null
  const memPercent =
    memLimit && memLimit > 0 ? (memUsed / memLimit) * 100 : null

  // Disk calculations
  const diskUsed = resources?.diskUsedBytes ?? 0
  const diskLimit = resources?.diskLimitBytes ?? null
  const diskPercent =
    diskLimit && diskLimit > 0 ? (diskUsed / diskLimit) * 100 : null

  // CPU calculations
  const cpuVal = resources?.cpuPercent ?? 0
  const cpuLimit = resources?.cpuLimitPercent ?? null

  // Network calculations
  const rxBytes = resources?.networkRxBytes ?? 0
  const txBytes = resources?.networkTxBytes ?? 0

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "24px 32px",
        overflowY: "auto",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* Toast Alert */}
      <LiveToast
        message={toastMessage}
        type={toastType}
        theme={theme}
        onClose={() => setToastMessage(null)}
      />

      {/* Top Header & Sub-Navigation (Always mounted and accessible) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.75rem",
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#0f172a",
              letterSpacing: "-0.02em",
            }}
          >
            Servidor
          </h1>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: "0.9rem",
              color: isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)",
            }}
          >
            Administración completa del servidor principal de Minecraft HiKAT
          </p>
        </div>

        {/* Extended 7 Sub-tabs switcher with responsive wrap */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 4,
            padding: 4,
            borderRadius: 14,
            background: isDark ? "rgba(19, 28, 35, 0.85)" : "#e2e8f0",
            border: `1px solid ${
              isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"
            }`,
          }}
        >
          {SUB_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: isActive
                    ? isDark
                      ? "rgba(62, 196, 192, 0.2)"
                      : "#ffffff"
                    : "transparent",
                  color: isActive
                    ? isDark
                      ? "#3ec4c0"
                      : "#0c6e6b"
                    : isDark
                    ? "rgba(255, 255, 255, 0.6)"
                    : "rgba(0, 0, 0, 0.6)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow:
                    isActive && !isDark
                      ? "0 2px 8px rgba(0, 0, 0, 0.08)"
                      : "none",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Subtab View Content */}
      {activeTab === "overview" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            animation: "fadeIn 0.2s ease",
          }}
        >
          {isLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "64px 0",
                gap: 12,
                color: isDark ? "#3ec4c0" : "#0c6e6b",
              }}
            >
              <IconSpinner size={28} />
              <span style={{ fontSize: "1rem", fontWeight: 500 }}>
                Conectando con el servidor...
              </span>
            </div>
          ) : error && !resources ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: 32,
                borderRadius: 20,
                background: isDark ? "rgba(19, 28, 35, 0.7)" : "#ffffff",
                border: `1px solid ${
                  isDark ? "rgba(239, 68, 68, 0.2)" : "rgba(239, 68, 68, 0.15)"
                }`,
                textAlign: "center",
              }}
            >
              <div style={{ color: "#ef4444" }}>
                <IconAlertCircle size={48} />
              </div>
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    color: isDark ? "#ffffff" : "#0f172a",
                  }}
                >
                  No se pudo conectar con la infraestructura del servidor
                </h3>
                <p
                  style={{
                    margin: "6px 0 0 0",
                    fontSize: "0.9rem",
                    color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
                    maxWidth: 420,
                  }}
                >
                  La infraestructura del servidor no respondió. Puedes consultar las demás pestañas o intentar reconectar.
                </p>
              </div>

              <button
                type="button"
                onClick={() => fetchStatus(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 22px",
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #3ec4c0 0%, #2ba5a1 100%)",
                  color: "#0a0e14",
                  fontSize: "0.925rem",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <IconRefresh size={18} />
                <span>Reintentar</span>
              </button>
            </div>
          ) : (
            <>
              {/* Server Primary Status Card */}
              <div
                style={{
                  padding: "24px 28px",
                  borderRadius: 20,
                  background: isDark
                    ? "linear-gradient(135deg, rgba(19, 28, 35, 0.9) 0%, rgba(13, 20, 26, 0.9) 100%)"
                    : "#ffffff",
                  border: `1px solid ${
                    isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)"
                  }`,
                  boxShadow: isDark
                    ? "0 10px 30px rgba(0, 0, 0, 0.35)"
                    : "0 10px 30px rgba(0, 0, 0, 0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 20,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      background: "rgba(62, 196, 192, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#3ec4c0",
                    }}
                  >
                    <IconServer size={28} />
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 4,
                      }}
                    >
                      <h2
                        style={{
                          margin: 0,
                          fontSize: "1.35rem",
                          fontWeight: 700,
                          color: isDark ? "#ffffff" : "#0f172a",
                        }}
                      >
                        Servidor Principal
                      </h2>
                      <ServerStatusBadge status={currentStatus} theme={theme} />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        fontSize: "0.85rem",
                        color: isDark
                          ? "rgba(255, 255, 255, 0.5)"
                          : "rgba(0, 0, 0, 0.5)",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <IconClock size={14} />
                        Tiempo encendido: {formatUptime(resources?.uptimeMs)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Power Control Buttons */}
                <ServerPowerActions
                  status={currentStatus}
                  isLoading={isActionLoading}
                  onPowerAction={handlePowerAction}
                  onRetry={() => fetchStatus(true)}
                  theme={theme}
                />
              </div>

              {/* Resource Metrics Grid including Rx/Tx */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 16,
                }}
              >
                <ServerResourceCard
                  label="CPU"
                  icon={<IconCpu size={20} />}
                  value={`${cpuVal.toFixed(1)} %`}
                  subValue={cpuLimit ? `/ ${cpuLimit} %` : undefined}
                  percentage={cpuVal}
                  theme={theme}
                  accentColor="#3ec4c0"
                />

                <ServerResourceCard
                  label="Memoria RAM"
                  icon={<IconRam size={20} />}
                  value={formatBytesToHuman(memUsed)}
                  subValue={memLimit ? `/ ${formatBytesToHuman(memLimit)}` : undefined}
                  percentage={memPercent}
                  theme={theme}
                  accentColor="#818cf8"
                />

                <ServerResourceCard
                  label="Disco"
                  icon={<IconDisk size={20} />}
                  value={formatBytesToHuman(diskUsed)}
                  subValue={diskLimit ? `/ ${formatBytesToHuman(diskLimit)}` : undefined}
                  percentage={diskPercent}
                  theme={theme}
                  accentColor="#f59e0b"
                />

                <ServerResourceCard
                  label="Tráfico recibido (RX)"
                  icon={<IconDownload size={20} />}
                  value={formatBytesToHuman(rxBytes)}
                  theme={theme}
                  accentColor="#38bdf8"
                />

                <ServerResourceCard
                  label="Tráfico enviado (TX)"
                  icon={<IconUpload size={20} />}
                  value={formatBytesToHuman(txBytes)}
                  theme={theme}
                  accentColor="#a78bfa"
                />
              </div>

              {/* Recent Activity Card */}
              <div
                style={{
                  padding: "20px 24px",
                  borderRadius: 18,
                  background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
                  border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.15)" : "0 2px 8px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ color: isDark ? "#3ec4c0" : "#0c6e6b" }}>
                      <IconHistory size={20} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                      Actividad reciente
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={fetchActivity}
                    disabled={isActivityLoading}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
                      cursor: isActivityLoading ? "not-allowed" : "pointer",
                      padding: 4,
                    }}
                  >
                    {isActivityLoading ? <IconSpinner size={16} /> : <IconRefresh size={16} />}
                  </button>
                </div>

                {activity.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)" }}>
                    No hay eventos recientes registrados.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activity.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          borderRadius: 10,
                          background: isDark ? "rgba(255,255,255,0.03)" : "#f8fafc",
                          fontSize: "0.85rem",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: isDark ? "#ffffff" : "#0f172a" }}>
                          {item.description}
                        </span>
                        <span style={{ color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)", fontSize: "0.8rem" }}>
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: CONSOLE */}
      {activeTab === "console" && (
        <div
          style={{
            flex: 1,
            minHeight: 480,
            display: "flex",
            flexDirection: "column",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <ServerConsoleView
            serverStatus={currentStatus}
            theme={theme}
          />
        </div>
      )}

      {/* TAB 3: WORLD */}
      {activeTab === "world" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <ServerWorldView
            theme={theme}
            serverStatus={currentStatus}
            onToast={showToast}
          />
        </div>
      )}

      {/* TAB 4: BACKUPS */}
      {activeTab === "backups" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <ServerBackupsView
            theme={theme}
            serverStatus={currentStatus}
            onToast={showToast}
          />
        </div>
      )}

      {/* TAB 5: AUTOMATIONS */}
      {activeTab === "automations" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <ServerAutomationsView
            theme={theme}
            onToast={showToast}
          />
        </div>
      )}

      {/* TAB 6: CONFIGURATION */}
      {activeTab === "configuration" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <ServerConfigurationView
            theme={theme}
            onToast={showToast}
          />
        </div>
      )}

      {/* TAB 7: FILES */}
      {activeTab === "files" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <ServerFilesView
            theme={theme}
            onToast={showToast}
          />
        </div>
      )}
    </div>
  )
}
