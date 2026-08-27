import React, { useState, useEffect, useRef, useCallback } from "react"
import type { ThemeMode, ServerResources, ServerPowerAction, ConsoleLogEntry } from "../../types"
import { serverApi } from "../../services/graphqlClient"
import { consoleService } from "../../services/consoleService"
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
}

export type ServerSubTab = "general" | "console" | "files" | "backups" | "tasks"

const SUB_TABS: Array<{ id: ServerSubTab; label: string; icon: React.ReactNode }> = [
  { id: "general", label: "General", icon: <IconServer size={18} /> },
  { id: "console", label: "Consola", icon: <IconTerminal size={18} /> },
  { id: "files", label: "Archivos", icon: <IconFolder size={18} /> },
  { id: "backups", label: "Backups", icon: <IconArchive size={18} /> },
  { id: "tasks", label: "Tasks", icon: <IconCalendar size={18} /> },
]

export default function ServerOverviewView({ theme }: ServerOverviewViewProps) {
  const isDark = theme === "dark"
  const [activeTab, setActiveTab] = useState<ServerSubTab>("general")
  const [infraState, setInfraState] = useState<"CHECKING" | "CONNECTED" | "DISCONNECTED">("CHECKING")
  const [resources, setResources] = useState<ServerResources | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<"success" | "error">("success")

  // Live Console Preview State for General tab
  const [liveLogs, setLiveLogs] = useState<ConsoleLogEntry[]>([])
  const [isConsoleConnected, setIsConsoleConnected] = useState(false)
  const liveConsoleEndRef = useRef<HTMLDivElement>(null)

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
      setInfraState("CHECKING")
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
  }, [])

  // Controlled polling: initial fetch, then once every 5s
  useEffect(() => {
    isMountedRef.current = true
    fetchStatus()

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
  }, [fetchStatus])

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

  // Auto-scroll live console preview
  useEffect(() => {
    if (activeTab === "general" && liveConsoleEndRef.current) {
      liveConsoleEndRef.current.scrollIntoView({ behavior: "smooth" })
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
        paddingBottom: 40,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type={toastType}
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
          borderBottom: `1px solid ${
            isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"
          }`,
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "1.65rem",
                fontWeight: 800,
                color: isDark ? "#ffffff" : "#0f172a",
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
                <span>Infraestructura conectada</span>
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
                  background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
                  border: `1px solid ${
                    isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"
                  }`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  boxShadow: isDark
                    ? "0 4px 16px rgba(0,0,0,0.15)"
                    : "0 2px 8px rgba(0,0,0,0.03)",
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
                        color: isDark ? "#ffffff" : "#0f172a",
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
                          : isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
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
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                      color: isDark ? "#3ec4c0" : "#0c6e6b",
                      fontSize: "0.825rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <span>Abrir consola →</span>
                  </button>
                </div>

                {/* Console Log Preview Window */}
                <div
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
                  <div ref={liveConsoleEndRef} />
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
        <ServerFilesView theme={theme} onToast={showToast} />
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
