import React, { useState, useEffect, useCallback } from "react"
import type {
  ThemeMode,
  AdminGameOverview,
  AdminGameFile,
  GameRelease,
} from "../../types"
import { gameApi } from "../../services/graphqlClient"
import {
  IconRocket,
  IconTrash,
  IconSpinner,
  IconCheck,
  IconRefresh,
  IconEdit,
  IconHistory,
  IconAlertCircle,
} from "../../theme/icons"
import GameFilesExplorer from "./GameFilesExplorer"
import PublishReleaseModal from "./PublishReleaseModal"
import LiveToast from "../common/LiveToast"

interface GameViewProps {
  theme: ThemeMode
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

  const [isPublishOpen, setIsPublishOpen] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type })
  }, [])

  const fetchOverview = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await gameApi.getAdminGameOverview()
      setOverview(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la información de versiones.")
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
      // Fallback
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
      showToast("Borrador de actualización preparado.", "success")
      await fetchOverview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al preparar el borrador.")
      showToast(err instanceof Error ? err.message : "Error al preparar el borrador.", "error")
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
      showToast("Borrador descartado correctamente.", "success")
      await fetchOverview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al descartar el borrador.")
      showToast(err instanceof Error ? err.message : "Error al descartar el borrador.", "error")
    } finally {
      setIsDiscardingDraft(false)
    }
  }

  const draft = overview?.draftRelease
  const published = overview?.publishedRelease
  const hasDraft = !!draft
  const activeRelease = draft || published
  const files = activeRelease?.files || []

  return (
    <div style={{ padding: "28px", maxWidth: "1380px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
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
            Explorador de Archivos del Juego
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              color: isDark ? "#94a3b8" : "#64748b",
            }}
          >
            Administra los archivos, carpetas, mods y configuraciones que sincroniza el HiKAT Launcher.
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
            📁 Explorador de Archivos
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
            <IconHistory style={{ width: 14, height: 14 }} />
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
          <IconSpinner style={{ width: 24, height: 24 }} />
          <span>Cargando gestor de archivos...</span>
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
              <IconSpinner style={{ width: 24, height: 24 }} />
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
                          {rel.status === "PUBLISHED" ? "Publicada (Activa)" : "Histórica"}
                        </span>
                        <span style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                          {rel.publishedAt ? new Date(rel.publishedAt).toLocaleDateString() : ""}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <span style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                          {rel.files.length} archivos
                        </span>
                        <span style={{ fontSize: "13px", color: "#3b82f6", fontWeight: "600" }}>
                          {isSelected ? "Ocultar explorador ▲" : "Abrir explorador ▼"}
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
                            <strong>Notas de la versión:</strong> {rel.notes}
                          </div>
                        )}
                        <GameFilesExplorer
                          theme={theme}
                          files={rel.files}
                          isDraft={false}
                          onRefresh={fetchHistory}
                          onToast={showToast}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Current / Draft Explorer View */
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Status Header Banner Card */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${hasDraft ? "#3b82f6" : isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "20px 24px",
              boxShadow: hasDraft
                ? "0 4px 20px -4px rgba(59, 130, 246, 0.25)"
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
                      backgroundColor: hasDraft ? "rgba(59, 130, 246, 0.2)" : "rgba(34, 197, 94, 0.15)",
                      color: hasDraft ? "#60a5fa" : "#22c55e",
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
                    {published ? `v${published.version}` : "Sin versión previa"}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "14px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  {hasDraft
                    ? "Puedes crear carpetas, editar archivos de configuración y subir mods. Los cambios se aplicarán a los jugadores al publicar."
                    : "Esta es la versión oficial actualmente descargable. Pulsa Preparar actualización para realizar modificaciones en el explorador."}
                </p>
              </div>

              {/* Header Action Buttons */}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                {!hasDraft ? (
                  <button
                    type="button"
                    onClick={handlePrepareDraft}
                    disabled={isPreparingDraft}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 20px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "#3b82f6",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: isPreparingDraft ? "not-allowed" : "pointer",
                      opacity: isPreparingDraft ? 0.7 : 1,
                    }}
                  >
                    {isPreparingDraft ? <IconSpinner style={{ width: 16, height: 16 }} /> : <IconEdit style={{ width: 16, height: 16 }} />}
                    <span>Preparar actualización</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
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
                      type="button"
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
                      <IconRocket style={{ width: 16, height: 16 }} />
                      <span>Publicar actualización</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Readiness Checklist when Draft is Active */}
            {hasDraft && overview?.readiness && (
              <div
                style={{
                  marginTop: "16px",
                  paddingTop: "14px",
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
                      color: files.filter((f) => !f.isDirectory && f.changeStatus !== "REMOVED").length > 0 ? "#22c55e" : "#ef4444",
                    }}
                  >
                    <IconCheck style={{ width: 16, height: 16 }} />
                    {files.filter((f) => !f.isDirectory && f.changeStatus !== "REMOVED").length} archivos descargables
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
                    <IconCheck style={{ width: 16, height: 16 }} />
                    Sin conflictos
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
                    <IconCheck style={{ width: 16, height: 16 }} />
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
                      ⚠ Hay problemas pendientes para publicar
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Main Game Files Explorer */}
          <GameFilesExplorer
            theme={theme}
            files={files}
            isDraft={hasDraft}
            onRefresh={fetchOverview}
            onToast={showToast}
            onPrepareDraft={handlePrepareDraft}
          />
        </div>
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
            showToast(`Versión ${ver} publicada correctamente. ${count} archivos disponibles.`, "success")
            fetchOverview()
          }}
        />
      )}

      {toast && (
        <LiveToast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
