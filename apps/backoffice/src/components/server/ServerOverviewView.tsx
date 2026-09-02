import React, { useState, useEffect, useRef, useCallback } from "react"
import type { ThemeMode, ServerResources, ServerPowerAction, ConsoleLogEntry, ServerReleaseSyncPlan } from "../../types"
import { serverApi, serverContentApi } from "../../services/graphqlClient"
import { consoleService } from "../../services/consoleService"
import { getThemeTokens } from "../../theme/tokens"
import { formatBytesToHuman, formatUptime } from "@hikat/shared"
import ServerStatusBadge from "./ServerStatusBadge"
import ServerResourceCard from "./ServerResourceCard"
import ServerPowerActions from "./ServerPowerActions"
import ServerConsoleView from "./ServerConsoleView"
import ServerBackupsView from "./ServerBackupsView"
import ServerTasksView from "./ServerTasksView"
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
  IconArchive,
  IconCalendar,
  IconFolder,
} from "../../theme/icons"

interface ServerOverviewViewProps {
  theme: ThemeMode
  onNavigate?: (section: any, handoff?: import("../../types").GameHandoffPayload) => void
}

export type ServerSubTab = "general" | "console" | "files" | "backups" | "tasks"

const SUB_TABS: Array<{ id: ServerSubTab; label: string; icon: React.ReactNode }> = [
  { id: "general", label: "General", icon: <IconServer size={18} /> },
  { id: "console", label: "Consola", icon: <IconTerminal size={18} /> },
  { id: "files", label: "Archivos", icon: <IconFolder size={18} /> },
  { id: "backups", label: "Backups", icon: <IconArchive size={18} /> },
  { id: "tasks", label: "Tareas", icon: <IconCalendar size={18} /> },
]

export default function ServerOverviewView({ theme, onNavigate }: ServerOverviewViewProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [activeTab, setActiveTab] = useState<ServerSubTab>("general")
  const [infraState, setInfraState] = useState<"CHECKING" | "CONNECTED" | "DISCONNECTED">("CHECKING")
  const [resources, setResources] = useState<ServerResources | null>(null)
  const [syncPlan, setSyncPlan] = useState<ServerReleaseSyncPlan | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<"success" | "error">("success")

  // Live Console Preview State for General tab
  const [liveLogs, setLiveLogs] = useState<ConsoleLogEntry[]>([])
  const [isConsoleConnected, setIsConsoleConnected] = useState(false)
  const liveLogsContainerRef = useRef<HTMLDivElement>(null)

  const isMountedRef = useRef(true)
  const isFetchingRef = useRef(false)
  const hasDataRef = useRef(false)
  const isActionLoadingRef = useRef(false)

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToastMessage(message)
    setToastType(type)
  }, [])

  // Sync plan fetcher
  const fetchSyncPlan = useCallback(async () => {
    try {
      const plan = await serverContentApi.getServerReleaseSyncPlan()
      if (isMountedRef.current) {
        setSyncPlan(plan)
      }
    } catch {
      if (isMountedRef.current) {
        setSyncPlan(null)
      }
    }
  }, [])

  // Stable status fetcher
  const fetchStatus = useCallback(async (isManual: boolean = false) => {
    if (isFetchingRef.current || !isMountedRef.current) return
    isFetchingRef.current = true

    if (isManual) {
      setError(null)
      setInfraState("CHECKING")
      fetchSyncPlan()
    }

    try {
      const data = await serverApi.getServerStatus()
      if (isMountedRef.current) {
        setResources(data)
        setInfraState("CONNECTED")
        hasDataRef.current = true
        setError(null)
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const msg =
          err instanceof Error
            ? err.message
            : "No se pudo obtener el estado del servidor."
        setResources(null)
        setInfraState("DISCONNECTED")
        setError(msg)
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
      isFetchingRef.current = false
    }
  }, [fetchSyncPlan])

  // Controlled polling: initial fetch, then once every 5s
  useEffect(() => {
    isMountedRef.current = true
    fetchStatus()
    fetchSyncPlan()

    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && !isActionLoadingRef.current) {
        fetchStatus()
        fetchSyncPlan()
      }
    }, 5000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !isActionLoadingRef.current) {
        fetchStatus()
        fetchSyncPlan()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      isMountedRef.current = false
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchStatus, fetchSyncPlan])

  // Refresh plan on tab activation
  useEffect(() => {
    if (activeTab === "general") {
      fetchSyncPlan()
    }
  }, [activeTab, fetchSyncPlan])

  // Live console preview subscription on General tab
  useEffect(() => {
    if (activeTab !== "general") return

    // Pre-populate with existing rolling logs
    setLiveLogs(consoleService.getRecentLogs(15))

    const unretain = consoleService.retain()

    const unsubLog = consoleService.onLog((entry) => {
      setLiveLogs((prev) => [...prev.slice(-20), entry])
    })

    const unsubConn = consoleService.onConnectionChange((connected) => {
      setIsConsoleConnected(connected)
    })

    return () => {
      unsubLog()
      unsubConn()
      unretain()
    }
  }, [activeTab])

  // Auto-scroll live console preview safely inside local container
  useEffect(() => {
    if (activeTab === "general" && liveLogsContainerRef.current) {
      liveLogsContainerRef.current.scrollTop = liveLogsContainerRef.current.scrollHeight
    }
  }, [liveLogs, activeTab])

  // Power action dispatcher
  const handlePowerAction = async (action: ServerPowerAction) => {
    setIsActionLoading(true)
    isActionLoadingRef.current = true

    try {
      let result: { success: boolean; status: any; message?: string }
      if (action === "START") {
        result = await serverApi.startServer()
      } else if (action === "RESTART") {
        result = await serverApi.restartServer()
      } else {
        result = await serverApi.stopServer()
      }

      if (result.success) {
        const actionLabels: Record<ServerPowerAction, string> = {
          START: "Orden de encendido enviada.",
          RESTART: "Orden de reinicio enviada.",
          STOP: "Orden de apagado enviada.",
        }
        showToast(actionLabels[action], "success")

        if (resources) {
          setResources({ ...resources, status: result.status })
        }

        setTimeout(() => {
          fetchStatus()
        }, 1500)
      } else {
        showToast(
          result.message || `No se pudo ejecutar la acción ${action}.`,
          "error",
        )
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error al ejecutar acción de energía."
      showToast(msg, "error")
    } finally {
      setIsActionLoading(false)
      isActionLoadingRef.current = false
    }
  }

  // Calculated metrics
  const currentStatus = resources?.status || (infraState === "DISCONNECTED" ? "DISCONNECTED" : "OFFLINE")
  const cpuVal = resources?.cpuPercent ?? 0
  const cpuLimit = resources?.cpuLimitPercent ?? 0
  const memUsed = resources?.memoryUsedBytes ?? 0
  const memLimit = resources?.memoryLimitBytes ?? 0
  const memPercent = memLimit > 0 ? (memUsed / memLimit) * 100 : null
  const diskUsed = resources?.diskUsedBytes ?? 0
  const diskLimit = resources?.diskLimitBytes ?? 0
  const diskPercent = diskLimit > 0 ? (diskUsed / diskLimit) * 100 : null

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "32px 36px",
        width: "100%",
        boxSizing: "border-box",
        animation: "viewFadeIn 0.24s ease",
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type={toastType}
          theme={theme}
          onClose={() => setToastMessage(null)}
        />
      )}

      {/* Top Header & 5 Sub-Tabs Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          borderBottom: `1px solid ${tokens.borderSubtle}`,
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "1.75rem",
                fontWeight: 800,
                color: tokens.textPrimary,
                letterSpacing: "-0.02em",
              }}
            >
              Servidor
            </h1>

            {infraState === "CONNECTED" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: isDark ? "rgba(74, 222, 128, 0.15)" : "#dcfce7",
                  color: isDark ? "#4ade80" : "#16a34a",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: isDark ? "#4ade80" : "#16a34a",
                  }}
                />
                <span>Servidor disponible</span>
              </span>
            )}

            {infraState === "DISCONNECTED" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 12px",
                  borderRadius: 999,
                  background: isDark ? "rgba(239, 68, 68, 0.15)" : "#fee2e2",
                  color: isDark ? "#f87171" : "#b91c1c",
                  fontSize: "0.775rem",
                  fontWeight: 600,
                }}
              >
                <span>Servidor no disponible</span>
                <button
                  type="button"
                  onClick={() => fetchStatus(true)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                    fontSize: "0.775rem",
                  }}
                >
                  Reintentar
                </button>
              </span>
            )}
          </div>
        </div>

        {/* 5 Sub-tabs switcher */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: tokens.bgCardInner,
            padding: "4px",
            borderRadius: "14px",
            border: `1px solid ${tokens.borderSubtle}`,
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
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "none",
                  backgroundColor: isActive ? tokens.bgCard : "transparent",
                  color: isActive ? tokens.textPrimary : tokens.textSecondary,
                  boxShadow: isActive ? tokens.cardShadow : "none",
                  fontSize: "13px",
                  fontWeight: isActive ? "700" : "500",
                  cursor: "pointer",
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
      {activeTab === "general" && (
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
                        Tiempo encendido: {resources ? formatUptime(resources.uptimeMs) : "—"}
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

              {/* Pending Server Release Changes Banner */}
              {syncPlan?.isPending && (
                <div
                  data-testid="server-overview-pending-changes-banner"
                  style={{
                    padding: "16px 20px",
                    borderRadius: 16,
                    background: isDark ? "rgba(59, 130, 246, 0.12)" : "#eff6ff",
                    border: `1px solid ${isDark ? "rgba(59, 130, 246, 0.3)" : "#bfdbfe"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        backgroundColor: "rgba(59, 130, 246, 0.15)",
                        color: "#3b82f6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <IconFolder size={22} />
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: "0.95rem",
                          fontWeight: 700,
                          color: isDark ? "#f3f4f6" : "#1e3a8a",
                        }}
                      >
                        Cambios pendientes en el servidor
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: isDark ? "#94a3b8" : "#475569",
                          marginTop: 2,
                        }}
                      >
                        La versión v{syncPlan.releaseVersion || "—"} tiene cambios que todavía no se han aplicado al servidor.
                      </div>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: isDark ? "#93c5fd" : "#3b82f6",
                          marginTop: 4,
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>{syncPlan.summary.toInstall} para instalar</span>
                        <span>•</span>
                        <span>{syncPlan.summary.toUpdate} para actualizar</span>
                        {syncPlan.summary.toRemove > 0 && (
                          <>
                            <span>•</span>
                            <span>{syncPlan.summary.toRemove} para eliminar</span>
                          </>
                        )}
                        <span>•</span>
                        <span
                          style={{
                            color: syncPlan.canApply
                              ? "#22c55e"
                              : syncPlan.serverStatus === "DISCONNECTED" || syncPlan.serverStatus === "UNKNOWN"
                              ? "#ef4444"
                              : "#f59e0b",
                            fontWeight: 600,
                          }}
                        >
                          {syncPlan.canApply
                            ? "Servidor apagado y listo para aplicar los cambios."
                            : syncPlan.serverStatus === "ONLINE" || syncPlan.serverStatus === "STARTING" || syncPlan.serverStatus === "STOPPING"
                            ? `${syncPlan.blockReason || "Apaga el servidor para aplicar los cambios."}`
                            : syncPlan.serverStatus === "OFFLINE"
                            ? `${syncPlan.blockReason || "No se pudieron verificar los archivos del servidor."}`
                            : `${syncPlan.blockReason || "El servidor no está disponible en este momento."}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    data-testid="button-overview-review-pending-changes"
                    onClick={() => setActiveTab("files")}
                    className="launcher-btn-primary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "13px",
                      padding: "8px 16px",
                      borderRadius: "10px",
                    }}
                  >
                    <span>Revisar cambios</span>
                  </button>
                </div>
              )}

              {/* Resource Metrics Grid (CPU, RAM, Disco) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 16,
                }}
              >
                <ServerResourceCard
                  label="CPU"
                  icon={<IconCpu size={20} />}
                  value={resources ? `${cpuVal.toFixed(1)} %` : "—"}
                  subValue={resources && cpuLimit ? `/ ${cpuLimit} %` : undefined}
                  percentage={resources ? cpuVal : null}
                  theme={theme}
                  accentColor="#3ec4c0"
                />

                <ServerResourceCard
                  label="Memoria RAM"
                  icon={<IconRam size={20} />}
                  value={resources ? formatBytesToHuman(memUsed) : "—"}
                  subValue={resources && memLimit ? `/ ${formatBytesToHuman(memLimit)}` : undefined}
                  percentage={resources ? memPercent : null}
                  theme={theme}
                  accentColor="#818cf8"
                />

                <ServerResourceCard
                  label="Disco"
                  icon={<IconDisk size={20} />}
                  value={resources ? formatBytesToHuman(diskUsed) : "—"}
                  subValue={resources && diskLimit ? `/ ${formatBytesToHuman(diskLimit)}` : undefined}
                  percentage={resources ? diskPercent : null}
                  theme={theme}
                  accentColor="#f59e0b"
                />
              </div>

              {/* Live Console Card */}
              <div
                style={{
                  padding: "20px 24px",
                  borderRadius: 18,
                  background: tokens.bgCard,
                  border: `1px solid ${tokens.borderSubtle}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  boxShadow: tokens.cardShadow,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ color: isDark ? "#3ec4c0" : "#0c6e6b" }}>
                      <IconTerminal size={20} />
                    </div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        color: tokens.textPrimary,
                      }}
                    >
                      Consola en vivo
                    </h3>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: "0.75rem",
                        color: isConsoleConnected
                          ? isDark ? "#4ade80" : "#16a34a"
                          : tokens.textMuted,
                        fontWeight: 600,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: isConsoleConnected ? "#4ade80" : "#94a3b8",
                        }}
                      />
                      {isConsoleConnected ? "Conectada" : "En espera"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab("console")}
                    className="launcher-btn-secondary"
                    style={{
                      fontSize: "12px",
                      padding: "6px 14px",
                      borderRadius: "10px",
                    }}
                  >
                    <span>Abrir consola →</span>
                  </button>
                </div>

                {/* Console Log Preview Window */}
                <div
                  ref={liveLogsContainerRef}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: isDark ? "#0b1116" : "#0f172a",
                    border: `1px solid ${
                      isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.2)"
                    }`,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: "0.8rem",
                    lineHeight: 1.5,
                    color: "#e2e8f0",
                    height: 180,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                  }}
                  className="custom-scroll"
                >
                  {liveLogs.length === 0 ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: "100%",
                        color: "rgba(255, 255, 255, 0.35)",
                        fontSize: "0.85rem",
                      }}
                    >
                      {currentStatus === "OFFLINE"
                        ? "El servidor está apagado."
                        : "Esperando registros de consola..."}
                    </div>
                  ) : (
                    liveLogs.map((log) => (
                      <div
                        key={log.id}
                        style={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          color: log.type === "stderr" ? "#f87171" : "#cbd5e1",
                        }}
                      >
                        {log.line}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Subtab Views */}
      {activeTab === "console" && (
        <ServerConsoleView theme={theme} serverStatus={resources?.status || "UNKNOWN"} />
      )}

      {activeTab === "files" && (
        <ServerFilesView
          theme={theme}
          onToast={showToast}
          onNavigateToGame={(handoff) => onNavigate?.("game", handoff)}
        />
      )}

      {activeTab === "backups" && (
        <ServerBackupsView theme={theme} onToast={showToast} />
      )}

      {activeTab === "tasks" && (
        <ServerTasksView
          theme={theme}
          serverStatus={resources?.status}
          onToast={showToast}
        />
      )}
    </div>
  )
}
