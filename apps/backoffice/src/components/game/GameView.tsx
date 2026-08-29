import React, { useState, useEffect, useCallback } from "react"
import type {
  ThemeMode,
  AdminGameOverview,
  AdminGameFile,
  GameRelease,
  ServerReleaseSyncPlan,
} from "../../types"
import { gameApi, serverContentApi } from "../../services/graphqlClient"
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
import { ServerReleaseSyncModal } from "../server/ServerReleaseSyncModal"
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

  // Server update handoff state
  const [serverPlan, setServerPlan] = useState<ServerReleaseSyncPlan | null>(null)
  const [isServerChangesModalOpen, setIsServerChangesModalOpen] = useState(false)

  const [publishingDraft, setPublishingDraft] = useState<GameRelease | null>(null)
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

  const fetchServerPlan = useCallback(async () => {
    try {
      const plan = await serverContentApi.getServerReleaseSyncPlan()
      setServerPlan(plan)
    } catch {
      // Best-effort: Server might be disconnected or Pterodactyl down
    }
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
    fetchServerPlan()
  }, [fetchOverview, fetchServerPlan])

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
  const changes = overview?.changes
  const readiness = overview?.readiness

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
                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        {/* Cover thumbnail / indicator */}
                        {rel.cover ? (
                          <div
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "8px",
                              overflow: "hidden",
                              backgroundColor: isDark ? "#0f172a" : "#f1f5f9",
                              flexShrink: 0,
                            }}
                          >
                            {rel.cover.mediaType === "IMAGE" ? (
                              <img
                                src={rel.cover.url}
                                alt={`Portada v${rel.version}`}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  backgroundColor: "#1e293b",
                                  color: "#38bdf8",
                                  fontSize: "10px",
                                  fontWeight: "700",
                                }}
                              >
                                VIDEO
                              </div>
                            )}
                          </div>
                        ) : (
                          <div
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "8px",
                              backgroundColor: isDark ? "#0f172a" : "#f1f5f9",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: isDark ? "#64748b" : "#94a3b8",
                              fontSize: "10px",
                              flexShrink: 0,
                            }}
                          >
                            MODPACK
                          </div>
                        )}

                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
                            <span style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                              MC {rel.minecraftVersion} • NeoForge {rel.neoForgeVersion}
                            </span>
                          </div>

                          <div style={{ fontSize: "12px", color: isDark ? "#64748b" : "#94a3b8", marginTop: "2px" }}>
                            {rel.publishedAt ? `Publicada el ${new Date(rel.publishedAt).toLocaleDateString()}` : "Sin fecha de publicación"} • {rel.files.length} archivos
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
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
          {/* Pending Server Changes Banner */}
          {serverPlan?.isPending && (
            <div
              data-testid="game-pending-server-changes-banner"
              style={{
                padding: "16px 20px",
                borderRadius: "14px",
                backgroundColor: isDark ? "rgba(59, 130, 246, 0.12)" : "#eff6ff",
                border: `1px solid ${isDark ? "rgba(59, 130, 246, 0.3)" : "#bfdbfe"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ color: "#3b82f6", display: "flex", alignItems: "center" }}>
                  <IconRocket style={{ width: 22, height: 22 }} />
                </div>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#1e3a8a" }}>
                    Cambios pendientes en el servidor
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: isDark ? "#93c5fd" : "#3b82f6",
                      marginTop: "2px",
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{serverPlan.summary.toInstall} para instalar</span>
                    <span>•</span>
                    <span>{serverPlan.summary.toUpdate} para actualizar</span>
                    {serverPlan.summary.toRemove > 0 && (
                      <>
                        <span>•</span>
                        <span>{serverPlan.summary.toRemove} para eliminar</span>
                      </>
                    )}
                    <span>•</span>
                    <span
                      style={{
                        color: serverPlan.canApply
                          ? "#22c55e"
                          : serverPlan.serverStatus === "DISCONNECTED" || serverPlan.serverStatus === "UNKNOWN"
                          ? "#ef4444"
                          : "#f59e0b",
                        fontWeight: "600",
                      }}
                    >
                      {serverPlan.canApply
                        ? "🟢 Servidor apagado y listo"
                        : serverPlan.serverStatus === "ONLINE" || serverPlan.serverStatus === "STARTING" || serverPlan.serverStatus === "STOPPING"
                        ? `🟠 ${serverPlan.blockReason || "Apaga el servidor antes de aplicar los cambios"}`
                        : serverPlan.serverStatus === "OFFLINE"
                        ? `🟠 ${serverPlan.blockReason || "No se pudieron verificar los archivos del servidor"}`
                        : `🔴 ${serverPlan.blockReason || "El servidor no está disponible"}`}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                data-testid="button-open-server-changes-from-game"
                onClick={() => setIsServerChangesModalOpen(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#3b82f6",
                  color: "#ffffff",
                  fontWeight: "700",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Revisar cambios
              </button>
            </div>
          )}

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
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
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

                  {/* Change counters badge in banner when draft is active */}
                  {hasDraft && changes && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: "600" }}>
                      <span style={{ color: "#22c55e" }}>+{changes.added}</span>
                      <span style={{ color: "#38bdf8" }}>↑ {changes.updated}</span>
                      <span style={{ color: "#ef4444" }}>− {changes.removed}</span>
                    </div>
                  )}
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
                      onClick={() => {
                        setPublishingDraft(draft)
                        setIsPublishOpen(true)
                      }}
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
                      <span>Revisar y publicar</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Readiness Checklist when Draft is Active */}
            {hasDraft && readiness && (
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
                      color: readiness.hasFiles ? "#22c55e" : "#ef4444",
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
                      color: readiness.noConflicts ? "#22c55e" : "#ef4444",
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
                      color: readiness.storageVerified ? "#22c55e" : "#ef4444",
                    }}
                  >
                    <IconCheck style={{ width: 16, height: 16 }} />
                    Almacenamiento verificado
                  </span>
                </div>

                <div>
                  {readiness.isReady ? (
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
      {isPublishOpen && (publishingDraft || draft) && (
        <PublishReleaseModal
          theme={theme}
          draftRelease={publishingDraft || draft!}
          publishedRelease={published}
          changes={overview?.changes}
          readiness={overview?.readiness}
          onClose={() => {
            setIsPublishOpen(false)
            setPublishingDraft(null)
            fetchOverview()
            fetchServerPlan()
          }}
          onPublished={(ver, count) => {
            showToast(`Versión ${ver} publicada correctamente. ${count} archivos disponibles.`, "success")
          }}
          onReviewServerChanges={(plan) => {
            setIsPublishOpen(false)
            setPublishingDraft(null)
            setServerPlan(plan)
            setIsServerChangesModalOpen(true)
            fetchOverview()
          }}
        />
      )}

      {/* Server Changes / Sync Modal */}
      {isServerChangesModalOpen && serverPlan && (
        <ServerReleaseSyncModal
          theme={theme}
          plan={serverPlan}
          onClose={() => setIsServerChangesModalOpen(false)}
          onSuccess={() => {
            fetchServerPlan()
            fetchOverview()
          }}
          onToast={showToast}
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
