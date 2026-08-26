import React, { useState, useEffect, useCallback } from "react"
import type { ThemeMode, AdminGameOverview, AdminGameFile, GameRelease } from "../../types"
import { formatBytesToHuman } from "@hikat/shared"
import { gameApi } from "../../services/graphqlClient"
import {
  IconGamepad,
  IconPlus,
  IconTrash,
  IconUpload,
  IconSpinner,
  IconCheck,
  IconRefresh,
} from "../../theme/icons"
import AddGameFileModal from "./AddGameFileModal"
import PublishReleaseModal from "./PublishReleaseModal"
import DeleteGameFileModal from "./DeleteGameFileModal"
import LiveToast from "../common/LiveToast"

interface GameViewProps {
  theme: ThemeMode
}

export default function GameView({ theme }: GameViewProps) {
  const isDark = theme === "dark"

  const [overview, setOverview] = useState<AdminGameOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false)
  const [deleteTargetFile, setDeleteTargetFile] = useState<AdminGameFile | null>(null)

  const [isDiscarding, setIsDiscarding] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await gameApi.getAdminGameOverview()
      setOverview(data)
    } catch (err: any) {
      setError(err.message || "No se pudo cargar la información del juego.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  const handlePrepareDraft = async () => {
    setIsLoading(true)
    try {
      await gameApi.prepareGameDraft()
      setToastMessage("Borrador de actualización preparado.")
      await fetchOverview()
    } catch (err: any) {
      setToastMessage(err.message || "Error al preparar el borrador.")
      setIsLoading(false)
    }
  }

  const handleDiscardDraft = async () => {
    if (!window.confirm("¿Seguro que deseas descartar todos los cambios pendientes del borrador?")) {
      return
    }
    setIsDiscarding(true)
    try {
      await gameApi.discardGameDraft()
      setToastMessage("Borrador descartado correctamente.")
      await fetchOverview()
    } catch (err: any) {
      setToastMessage(err.message || "Error al descartar el borrador.")
    } finally {
      setIsDiscarding(false)
    }
  }

  const activeRelease: GameRelease | undefined = overview?.draftRelease || overview?.publishedRelease || undefined
  const isDraft = !!overview?.draftRelease
  const files: AdminGameFile[] = activeRelease?.files || []

  return (
    <div style={{ padding: "28px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "28px",
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
            Administra los mods, paquetes y versiones que sincroniza el HiKAT Launcher.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isDraft ? (
            <>
              <button
                onClick={handleDiscardDraft}
                disabled={isDiscarding}
                style={{
                  padding: "9px 16px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: isDiscarding ? "not-allowed" : "pointer",
                }}
              >
                {isDiscarding ? "Descartando..." : "Descartar borrador"}
              </button>

              <button
                onClick={() => setIsPublishModalOpen(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#22c55e",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                <IconCheck size={16} />
                Publicar actualización
              </button>
            </>
          ) : (
            <button
              onClick={handlePrepareDraft}
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
              Preparar actualización
            </button>
          )}
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
      ) : (
        <>
          {/* Status Banner */}
          <div
            style={{
              backgroundColor: isDraft
                ? (isDark ? "rgba(99, 102, 241, 0.1)" : "#eef2ff")
                : (isDark ? "#1e293b" : "#ffffff"),
              border: `1px solid ${isDraft ? "#6366f1" : isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "20px 24px",
              marginBottom: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "12px",
                  backgroundColor: isDraft ? "#6366f1" : "rgba(34, 197, 94, 0.15)",
                  color: isDraft ? "#ffffff" : "#22c55e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <IconGamepad size={24} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                    {isDraft ? "Borrador de actualización en curso" : `Versión Oficial v${overview?.publishedRelease?.version || "1.0.0"}`}
                  </h3>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: "600",
                      backgroundColor: isDraft ? "rgba(99, 102, 241, 0.2)" : "rgba(34, 197, 94, 0.15)",
                      color: isDraft ? "#6366f1" : "#22c55e",
                    }}
                  >
                    {isDraft ? "BORRADOR" : "EN PRODUCCIÓN"}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  Minecraft {activeRelease?.minecraftVersion || "1.21.1"} • NeoForge {activeRelease?.neoForgeVersion || "21.1.65"} • {files.length} mod(s) / archivo(s)
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsAddModalOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 16px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: isDark ? "#334155" : "#f1f5f9",
                color: isDark ? "#f1f5f9" : "#1e293b",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              <IconPlus size={16} />
              Añadir mod / archivo
            </button>
          </div>

          {/* Files List Table */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              overflow: "hidden",
              boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
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
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                Archivos del Modpack ({files.length})
              </h2>
            </div>

            {files.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: isDark ? "#94a3b8" : "#64748b" }}>
                No hay archivos en esta versión. Añade un archivo .jar para comenzar.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr
                      style={{
                        backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                        borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                      }}
                    >
                      <th style={{ padding: "12px 24px", fontSize: "12px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                        Nombre
                      </th>
                      <th style={{ padding: "12px 20px", fontSize: "12px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                        Ruta en el cliente
                      </th>
                      <th style={{ padding: "12px 20px", fontSize: "12px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                        Categoría
                      </th>
                      <th style={{ padding: "12px 20px", fontSize: "12px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b" }}>
                        Tamaño
                      </th>
                      <th style={{ padding: "12px 24px", fontSize: "12px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b", textAlign: "right" }}>
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr
                        key={file.id}
                        style={{
                          borderBottom: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                        }}
                      >
                        <td style={{ padding: "14px 24px", fontSize: "14px", fontWeight: "500", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                          {file.name}
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: "13px", color: isDark ? "#cbd5e1" : "#475569", fontFamily: "monospace" }}>
                          {file.logicalPath}
                        </td>
                        <td style={{ padding: "14px 20px" }}>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontWeight: "600",
                              backgroundColor: isDark ? "#334155" : "#f1f5f9",
                              color: isDark ? "#cbd5e1" : "#475569",
                            }}
                          >
                            {file.category === "MOD" ? "Mod" : file.category}
                          </span>
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                          {formatBytesToHuman(file.sizeBytes)}
                        </td>
                        <td style={{ padding: "14px 24px", textAlign: "right" }}>
                          {isDraft ? (
                            <button
                              onClick={() => setDeleteTargetFile(file)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "6px 10px",
                                borderRadius: "6px",
                                border: `1px solid rgba(239, 68, 68, 0.3)`,
                                backgroundColor: "transparent",
                                color: "#ef4444",
                                fontSize: "12px",
                                cursor: "pointer",
                              }}
                              title="Quitar mod del borrador"
                            >
                              <IconTrash size={14} />
                            </button>
                          ) : (
                            <span style={{ fontSize: "12px", color: isDark ? "#64748b" : "#94a3b8" }}>
                              Publicado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Add Game File Modal */}
      {isAddModalOpen && (
        <AddGameFileModal
          theme={theme}
          onClose={() => setIsAddModalOpen(false)}
          onAdded={() => {
            setToastMessage("Archivo añadido al borrador.")
            fetchOverview()
          }}
        />
      )}

      {/* Publish Release Modal */}
      {isPublishModalOpen && (
        <PublishReleaseModal
          theme={theme}
          currentPublishedVersion={overview?.publishedRelease?.version}
          filesCount={files.length}
          onClose={() => setIsPublishModalOpen(false)}
          onPublished={() => {
            setToastMessage("¡Actualización publicada exitosamente!")
            fetchOverview()
          }}
        />
      )}

      {/* Delete Game File Modal */}
      {deleteTargetFile && (
        <DeleteGameFileModal
          theme={theme}
          file={deleteTargetFile}
          onClose={() => setDeleteTargetFile(null)}
          onDeleted={() => {
            setToastMessage("Archivo quitado del borrador.")
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
