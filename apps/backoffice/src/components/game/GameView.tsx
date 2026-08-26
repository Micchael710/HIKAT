import React, { useState, useEffect, useCallback } from "react"
import type {
  ThemeMode,
  AdminGameOverview,
  AdminGameFile,
  GameRelease,
} from "../../types"
import { gameApi } from "../../services/graphqlClient"
import {
  IconPlus,
  IconRocket,
  IconTrash,
  IconSpinner,
  IconCheck,
  IconBox,
  IconRefresh,
  IconEdit,
  IconHistory,
} from "../../theme/icons"
import AddGameFileModal from "./AddGameFileModal"
import PublishReleaseModal from "./PublishReleaseModal"
import DeleteGameFileModal from "./DeleteGameFileModal"
import LiveToast from "../common/LiveToast"

interface GameViewProps {
  theme: ThemeMode
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function getCategoryHumanName(cat: string): string {
  switch (cat) {
    case "MOD":
      return "Mod"
    case "RESOURCE_PACK":
      return "Paquete de recursos"
    case "SHADER_PACK":
      return "Shaders"
    case "KUBEJS":
      return "KubeJS"
    case "SCRIPT":
      return "Script"
    default:
      return "Archivo"
  }
}

export default function GameView({ theme }: GameViewProps) {
  const isDark = theme === "dark"

  const [activeTab, setActiveTab] = useState<"current" | "history">("current")
  const [overview, setOverview] = useState<AdminGameOverview | null>(null)
  const [history, setHistory] = useState<GameRelease[]>([])
  const [selectedHistoryRelease, setSelectedHistoryRelease] = useState<GameRelease | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isPreparingDraft, setIsPreparingDraft] = useState(false)
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isAddFileOpen, setIsAddFileOpen] = useState(false)
  const [targetFileToUpdate, setTargetFileToUpdate] = useState<AdminGameFile | null>(null)
  const [deleteFileItem, setDeleteFileItem] = useState<AdminGameFile | null>(null)
  const [isPublishOpen, setIsPublishOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await gameApi.getAdminGameOverview()
      setOverview(data)
    } catch (err: any) {
      setError(err.message || "No se pudo cargar la información de versiones.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    setIsHistoryLoading(true)
    try {
      const list = await gameApi.getGameReleaseHistory()
      setHistory(list)
    } catch {
      // Keep silent or fallback
    } finally {
      setIsHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    if (activeTab === "history") {
      fetchHistory()
    }
  }, [activeTab, fetchHistory])

  const handlePrepareDraft = async () => {
    setIsPreparingDraft(true)
    setError(null)
    try {
      await gameApi.prepareGameDraft()
      setToastMessage("Borrador de actualización preparado.")
      await fetchOverview()
    } catch (err: any) {
      setError(err.message || "Error al preparar el borrador.")
    } finally {
      setIsPreparingDraft(false)
    }
  }

  const handleDiscardDraft = async () => {
    if (!confirm("¿Estás seguro de que deseas descartar el borrador y todos los cambios pendientes?")) {
      return
    }
    setIsDiscardingDraft(true)
    setError(null)
    try {
      await gameApi.discardGameDraft()
      setToastMessage("Borrador descartado correctamente.")
      await fetchOverview()
    } catch (err: any) {
      setError(err.message || "Error al descartar el borrador.")
    } finally {
      setIsDiscardingDraft(false)
    }
  }

  const handleRestoreFile = async (file: AdminGameFile) => {
    try {
      await gameApi.restoreGameFile(file.id)
      setToastMessage(`"${file.name}" reincorporado a la actualización.`)
      await fetchOverview()
    } catch (err: any) {
      setError(err.message || "Error al reincorporar el archivo.")
    }
  }

  const draft = overview?.draftRelease
  const published = overview?.publishedRelease
  const hasDraft = !!draft
  const activeRelease = draft || published
  const files = activeRelease?.files || []

  return (
    <div style={{ padding: "28px", maxWidth: "1280px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "20px",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1
            style={{
              margin: "0 0 6px 0",
              fontSize: "24px",
              fontWeight: "700",
              color: isDark ? "#f1f5f9" : "#0f172a",
              letterSpacing: "-0.02em",
            }}
          >
            Juego y Actualizaciones
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              color: isDark ? "#94a3b8" : "#64748b",
            }}
          >
            Gestiona los mods, paquetes de recursos y versiones oficiales que sincroniza el Launcher.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: isDark ? "#1e293b" : "#e2e8f0",
            padding: "4px",
            borderRadius: "10px",
          }}
        >
          <button
            onClick={() => setActiveTab("current")}
            style={{
              padding: "7px 14px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: activeTab === "current" ? (isDark ? "#334155" : "#ffffff") : "transparent",
              color: activeTab === "current" ? (isDark ? "#f1f5f9" : "#0f172a") : (isDark ? "#94a3b8" : "#64748b"),
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: activeTab === "current" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            Actualización
          </button>
          <button
            onClick={() => setActiveTab("history")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: activeTab === "history" ? (isDark ? "#334155" : "#ffffff") : "transparent",
              color: activeTab === "history" ? (isDark ? "#f1f5f9" : "#0f172a") : (isDark ? "#94a3b8" : "#64748b"),
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: activeTab === "history" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            <IconHistory size={14} />
            Historial de versiones
          </button>
        </div>
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
          <span>Cargando gestor de actualizaciones...</span>
        </div>
      ) : error ? (
        <div
          style={{
            padding: "24px",
            borderRadius: "12px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            color: "#ef4444",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      ) : activeTab === "history" ? (
        /* History View */
        <div>
          {isHistoryLoading ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: isDark ? "#94a3b8" : "#64748b" }}>
              <IconSpinner size={24} />
              <div style={{ marginTop: "10px", fontSize: "14px" }}>Cargando historial...</div>
            </div>
          ) : history.length === 0 ? (
            <div
              style={{
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "60px 24px",
                textAlign: "center",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              No hay versiones históricas registradas todavía.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "16px" }}>
              {history.map((rel) => {
                const isSelected = selectedHistoryRelease?.id === rel.id
                return (
                  <div
                    key={rel.id}
                    style={{
                      backgroundColor: isDark ? "#1e293b" : "#ffffff",
                      border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                      borderRadius: "14px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={() => setSelectedHistoryRelease(isSelected ? null : rel)}
                      style={{
                        padding: "18px 24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        backgroundColor: isSelected ? (isDark ? "rgba(99, 102, 241, 0.05)" : "#f8fafc") : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span
                          style={{
                            fontSize: "17px",
                            fontWeight: "700",
                            color: isDark ? "#f1f5f9" : "#0f172a",
                          }}
                        >
                          v{rel.version}
                        </span>
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "600",
                            backgroundColor:
                              rel.status === "PUBLISHED"
                                ? "rgba(34, 197, 94, 0.15)"
                                : isDark
                                  ? "#334155"
                                  : "#f1f5f9",
                            color: rel.status === "PUBLISHED" ? "#22c55e" : isDark ? "#cbd5e1" : "#64748b",
                          }}
                        >
                          {rel.status === "PUBLISHED" ? "Publicada (Activa)" : "Anterior"}
                        </span>
                        <span style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                          {rel.publishedAt ? new Date(rel.publishedAt).toLocaleDateString() : ""}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <span style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                          {rel.files.length} archivos
                        </span>
                        <span style={{ fontSize: "13px", color: "#6366f1", fontWeight: "600" }}>
                          {isSelected ? "Ocultar archivos ▲" : "Ver archivos ▼"}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <div
                        style={{
                          padding: "16px 24px",
                          borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                          backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                        }}
                      >
                        {rel.notes && (
                          <div style={{ marginBottom: "14px", fontSize: "13px", color: isDark ? "#cbd5e1" : "#334155" }}>
                            <strong>Notas:</strong> {rel.notes}
                          </div>
                        )}
                        <div style={{ display: "grid", gap: "8px" }}>
                          {rel.files.map((f) => (
                            <div
                              key={f.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                                fontSize: "13px",
                              }}
                            >
                              <span style={{ fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                                {f.name}
                              </span>
                              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                <span
                                  style={{
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontSize: "11px",
                                    backgroundColor: isDark ? "#334155" : "#f1f5f9",
                                    color: isDark ? "#cbd5e1" : "#64748b",
                                  }}
                                >
                                  {getCategoryHumanName(f.category)}
                                </span>
                                <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                                  {formatBytes(f.sizeBytes)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Current / Draft Update View */
        <div>
          {/* Status Header Banner Card */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${hasDraft ? "#6366f1" : isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "24px",
              marginBottom: "24px",
              boxShadow: hasDraft
                ? "0 4px 20px -4px rgba(99, 102, 241, 0.25)"
                : isDark
                  ? "0 4px 6px -1px rgba(0,0,0,0.3)"
                  : "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "16px",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "700",
                      backgroundColor: hasDraft ? "rgba(99, 102, 241, 0.2)" : "rgba(34, 197, 94, 0.15)",
                      color: hasDraft ? "#818cf8" : "#22c55e",
                    }}
                  >
                    {hasDraft ? "Actualización en preparación (Borrador)" : "Versión oficial publicada"}
                  </span>
                  <span
                    style={{
                      fontSize: "18px",
                      fontWeight: "700",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                    }}
                  >
                    {published ? `v${published.version}` : "Sin publicar"}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "14px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  {hasDraft
                    ? "Los cambios que realices aquí no afectarán a los jugadores hasta que pulses Publicar actualización."
                    : "Para añadir, actualizar o eliminar archivos, prepara una nueva actualización."}
                </p>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                {!hasDraft ? (
                  <button
                    onClick={handlePrepareDraft}
                    disabled={isPreparingDraft}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 20px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "#6366f1",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: isPreparingDraft ? "not-allowed" : "pointer",
                      opacity: isPreparingDraft ? 0.7 : 1,
                    }}
                  >
                    {isPreparingDraft ? <IconSpinner size={16} /> : <IconEdit size={16} />}
                    Preparar actualización
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleDiscardDraft}
                      disabled={isDiscardingDraft}
                      style={{
                        padding: "9px 16px",
                        borderRadius: "8px",
                        border: `1px solid rgba(239, 68, 68, 0.3)`,
                        backgroundColor: "transparent",
                        color: "#ef4444",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: isDiscardingDraft ? "not-allowed" : "pointer",
                      }}
                    >
                      {isDiscardingDraft ? "Descartando..." : "Descartar borrador"}
                    </button>

                    <button
                      onClick={() => {
                        setTargetFileToUpdate(null)
                        setIsAddFileOpen(true)
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "9px 16px",
                        borderRadius: "8px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: isDark ? "#334155" : "#f8fafc",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      <IconPlus size={16} />
                      Añadir mod
                    </button>

                    <button
                      onClick={() => setIsPublishOpen(true)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "9px 20px",
                        borderRadius: "8px",
                        border: "none",
                        backgroundColor: "#22c55e",
                        color: "#ffffff",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      <IconRocket size={16} />
                      Publicar actualización
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Readiness Checklist when Draft is Active */}
            {hasDraft && overview?.readiness && (
              <div
                style={{
                  marginTop: "20px",
                  paddingTop: "16px",
                  borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "13px",
                      color: files.filter((f) => f.changeStatus !== "REMOVED").length > 0 ? "#22c55e" : "#ef4444",
                    }}
                  >
                    <IconCheck size={16} />
                    {files.filter((f) => f.changeStatus !== "REMOVED").length} archivos preparados
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "13px",
                      color: overview.readiness.noConflicts ? "#22c55e" : "#ef4444",
                    }}
                  >
                    <IconCheck size={16} />
                    Sin conflictos de nombre
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "13px",
                      color: overview.readiness.storageVerified ? "#22c55e" : "#ef4444",
                    }}
                  >
                    <IconCheck size={16} />
                    Almacenamiento verificado
                  </span>
                </div>

                <div>
                  {overview.readiness.isReady ? (
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: "700",
                        color: "#22c55e",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        backgroundColor: "rgba(34, 197, 94, 0.15)",
                      }}
                    >
                      ✓ Lista para publicar
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: "700",
                        color: "#ef4444",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        backgroundColor: "rgba(239, 68, 68, 0.15)",
                      }}
                    >
                      ⚠ Hay problemas que debes corregir antes de publicar
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Files List Table Card */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "18px 24px",
                borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "16px",
                  fontWeight: "600",
                  color: isDark ? "#f1f5f9" : "#0f172a",
                }}
              >
                {hasDraft ? "Archivos en el borrador" : "Archivos oficiales sincronizados"} ({files.length})
              </h3>
            </div>

            {files.length === 0 ? (
              <div
                style={{
                  padding: "60px 24px",
                  textAlign: "center",
                  color: isDark ? "#94a3b8" : "#64748b",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    backgroundColor: isDark ? "rgba(99, 102, 241, 0.15)" : "#eef2ff",
                    color: "#6366f1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px auto",
                  }}
                >
                  <IconBox size={24} />
                </div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                  No hay archivos registrados
                </h3>
                <p style={{ margin: "0 0 20px 0", fontSize: "14px" }}>
                  {hasDraft
                    ? "Añade los mods o paquetes que formarán parte de esta versión."
                    : "Prepara una actualización para comenzar a añadir mods al servidor."}
                </p>
                {hasDraft && (
                  <button
                    onClick={() => {
                      setTargetFileToUpdate(null)
                      setIsAddFileOpen(true)
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 18px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "#6366f1",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    <IconPlus size={16} />
                    Añadir primer mod
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                        backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: isDark ? "#94a3b8" : "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      <th style={{ padding: "12px 24px" }}>Nombre</th>
                      <th style={{ padding: "12px 16px" }}>Tipo</th>
                      <th style={{ padding: "12px 16px" }}>Tamaño</th>
                      {hasDraft && <th style={{ padding: "12px 16px" }}>Estado del cambio</th>}
                      {hasDraft && <th style={{ padding: "12px 24px", textAlign: "right" }}>Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => {
                      const isRemoved = file.changeStatus === "REMOVED"
                      return (
                        <tr
                          key={file.id}
                          style={{
                            borderBottom: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                            fontSize: "14px",
                            opacity: isRemoved ? 0.7 : 1,
                            backgroundColor: isRemoved
                              ? isDark
                                ? "rgba(239, 68, 68, 0.05)"
                                : "rgba(239, 68, 68, 0.02)"
                              : "transparent",
                          }}
                        >
                          {/* Name */}
                          <td style={{ padding: "14px 24px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                            <span style={{ textDecoration: isRemoved ? "line-through" : "none" }}>
                              {file.name}
                            </span>
                          </td>

                          {/* Category */}
                          <td style={{ padding: "14px 16px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "600",
                                backgroundColor: isDark ? "#334155" : "#f1f5f9",
                                color: isDark ? "#cbd5e1" : "#475569",
                              }}
                            >
                              {getCategoryHumanName(file.category)}
                            </span>
                          </td>

                          {/* Size */}
                          <td style={{ padding: "14px 16px", color: isDark ? "#94a3b8" : "#64748b" }}>
                            {formatBytes(file.sizeBytes)}
                          </td>

                          {/* Change Status (in Draft) */}
                          {hasDraft && (
                            <td style={{ padding: "14px 16px" }}>
                              {file.changeStatus === "ADDED" ? (
                                <span
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    backgroundColor: "rgba(34, 197, 94, 0.15)",
                                    color: "#22c55e",
                                  }}
                                >
                                  + Añadido
                                </span>
                              ) : file.changeStatus === "UPDATED" ? (
                                <span
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    backgroundColor: "rgba(56, 189, 248, 0.15)",
                                    color: "#38bdf8",
                                  }}
                                >
                                  ↑ Actualizado
                                </span>
                              ) : file.changeStatus === "REMOVED" ? (
                                <span
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    backgroundColor: "rgba(239, 68, 68, 0.15)",
                                    color: "#ef4444",
                                  }}
                                >
                                  − Se eliminará
                                </span>
                              ) : (
                                <span
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    backgroundColor: isDark ? "#334155" : "#f1f5f9",
                                    color: isDark ? "#94a3b8" : "#64748b",
                                  }}
                                >
                                  Sin cambios
                                </span>
                              )}
                            </td>
                          )}

                          {/* Row Actions (Draft only) */}
                          {hasDraft && (
                            <td style={{ padding: "14px 24px", textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: "8px", justifyContent: "flex-end" }}>
                                {isRemoved ? (
                                  <button
                                    onClick={() => handleRestoreFile(file)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      padding: "6px 12px",
                                      borderRadius: "6px",
                                      border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                                      backgroundColor: "transparent",
                                      color: "#6366f1",
                                      fontSize: "12px",
                                      fontWeight: "600",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <IconRefresh size={13} />
                                    Deshacer
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => {
                                        setTargetFileToUpdate(file)
                                        setIsAddFileOpen(true)
                                      }}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "4px",
                                        padding: "6px 10px",
                                        borderRadius: "6px",
                                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                                        backgroundColor: "transparent",
                                        color: isDark ? "#f1f5f9" : "#1e293b",
                                        fontSize: "12px",
                                        fontWeight: "500",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <IconEdit size={13} />
                                      Actualizar
                                    </button>
                                    <button
                                      onClick={() => setDeleteFileItem(file)}
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: "6px",
                                        border: "1px solid rgba(239, 68, 68, 0.3)",
                                        backgroundColor: "transparent",
                                        color: "#ef4444",
                                        fontSize: "12px",
                                        cursor: "pointer",
                                      }}
                                      title="Eliminar del borrador"
                                    >
                                      <IconTrash size={13} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Replace Game File Modal */}
      {isAddFileOpen && (
        <AddGameFileModal
          theme={theme}
          targetFile={targetFileToUpdate}
          onClose={() => {
            setIsAddFileOpen(false)
            setTargetFileToUpdate(null)
          }}
          onSaved={() => {
            setToastMessage(targetFileToUpdate ? "Archivo actualizado en el borrador." : "Archivo añadido al borrador.")
            fetchOverview()
          }}
        />
      )}

      {/* Publish Release Modal */}
      {isPublishOpen && draft && (
        <PublishReleaseModal
          theme={theme}
          draftRelease={draft}
          publishedRelease={published}
          changes={overview?.changes}
          readiness={overview?.readiness}
          onClose={() => setIsPublishOpen(false)}
          onPublished={(ver, count) => {
            setToastMessage(`Versión ${ver} publicada correctamente. ${count} archivos disponibles.`)
            fetchOverview()
          }}
        />
      )}

      {/* Delete File Confirmation Modal */}
      {deleteFileItem && (
        <DeleteGameFileModal
          theme={theme}
          file={deleteFileItem}
          onClose={() => setDeleteFileItem(null)}
          onDeleted={() => {
            setToastMessage("Archivo eliminado del borrador.")
            fetchOverview()
          }}
        />
      )}

      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type="success"
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}
