import React, { useState, useEffect, useCallback, useRef } from "react"
import type { ThemeMode, ServerBackupItem, ServerStatus } from "../../types"
import { serverApi } from "../../services/graphqlClient"
import { formatBytesToHuman } from "@hikat/shared"
import {
  IconArchive,
  IconPlus,
  IconDownload,
  IconLock,
  IconUnlock,
  IconTrash,
  IconRefresh,
  IconSpinner,
  IconAlertCircle,
  IconWarning,
  IconCheck,
  IconCross,
} from "../../theme/icons"

interface ServerBackupsViewProps {
  theme: ThemeMode
  serverStatus?: ServerStatus
  onToast: (message: string, type: "success" | "error") => void
}

export default function ServerBackupsView({
  theme,
  serverStatus,
  onToast,
}: ServerBackupsViewProps) {
  const isDark = theme === "dark"
  const [backups, setBackups] = useState<ServerBackupItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newBackupName, setNewBackupName] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Restore Modal state
  const [restoreBackupTarget, setRestoreBackupTarget] = useState<ServerBackupItem | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  // Delete Modal state
  const [deleteBackupTarget, setDeleteBackupTarget] = useState<ServerBackupItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Action loading state map
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({})

  const isMountedRef = useRef(true)

  const fetchBackups = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true)
    setError(null)
    try {
      const data = await serverApi.getServerBackups()
      if (isMountedRef.current) {
        setBackups(data)
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar las copias de seguridad.",
        )
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    fetchBackups()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchBackups])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)
    try {
      await serverApi.createServerBackup(newBackupName.trim() || undefined)
      onToast("Copia de seguridad creada exitosamente.", "success")
      setIsCreateModalOpen(false)
      setNewBackupName("")
      await fetchBackups(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al crear copia de seguridad.",
        "error",
      )
    } finally {
      setIsCreating(false)
    }
  }

  const handleToggleLock = async (backup: ServerBackupItem) => {
    setActionLoadingMap((prev) => ({ ...prev, [backup.id]: true }))
    try {
      await serverApi.toggleServerBackupLock(backup.id)
      onToast(
        backup.isLocked
          ? "Copia de seguridad desprotegida."
          : "Copia de seguridad protegida.",
        "success",
      )
      await fetchBackups(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al cambiar protección.",
        "error",
      )
    } finally {
      setActionLoadingMap((prev) => ({ ...prev, [backup.id]: false }))
    }
  }

  const handleDownload = async (backup: ServerBackupItem) => {
    setActionLoadingMap((prev) => ({ ...prev, [backup.id]: true }))
    try {
      const res = await serverApi.createServerBackupDownloadUrl(backup.id, backup.name)
      if (res && res.url) {
        const link = document.createElement("a")
        link.href = res.url
        link.download = `${backup.name || "backup"}.zip`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        onToast("Descarga de copia iniciada.", "success")
      }
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al descargar copia.",
        "error",
      )
    } finally {
      setActionLoadingMap((prev) => ({ ...prev, [backup.id]: false }))
    }
  }

  const handleConfirmRestore = async () => {
    if (!restoreBackupTarget) return
    setIsRestoring(true)
    try {
      await serverApi.restoreServerBackup(restoreBackupTarget.id)
      onToast("Copia restaurada exitosamente.", "success")
      setRestoreBackupTarget(null)
      await fetchBackups(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al restaurar copia.",
        "error",
      )
    } finally {
      setIsRestoring(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteBackupTarget) return
    setIsDeleting(true)
    try {
      await serverApi.deleteServerBackup(deleteBackupTarget.id)
      onToast("Copia eliminada exitosamente.", "success")
      setDeleteBackupTarget(null)
      await fetchBackups(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al eliminar copia.",
        "error",
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const isServerOffline = serverStatus === "OFFLINE"

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 0",
          color: isDark ? "#3ec4c0" : "#0c6e6b",
          gap: 12,
        }}
      >
        <IconSpinner size={32} />
        <span style={{ fontSize: "0.95rem", fontWeight: 500 }}>
          Cargando copias de seguridad...
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          padding: 24,
          borderRadius: 16,
          background: isDark ? "rgba(239, 68, 68, 0.1)" : "#fee2e2",
          border: `1px solid ${isDark ? "rgba(239, 68, 68, 0.25)" : "#fca5a5"}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
          margin: "24px 0",
        }}
      >
        <div style={{ color: "#ef4444" }}>
          <IconAlertCircle size={36} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: isDark ? "#ffffff" : "#991b1b" }}>
            No se pudieron cargar las copias de seguridad
          </h3>
          <p style={{ margin: "6px 0 0 0", fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.7)" : "#7f1d1d" }}>
            {error}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchBackups(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 18px",
            borderRadius: 10,
            border: "none",
            background: "#ef4444",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <IconRefresh size={16} />
          <span>Reintentar</span>
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#0f172a",
            }}
          >
            Copias de seguridad ({backups.length})
          </h2>
          <button
            type="button"
            onClick={() => fetchBackups(true)}
            disabled={isRefreshing}
            style={{
              border: "none",
              background: "transparent",
              color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
              cursor: isRefreshing ? "not-allowed" : "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            {isRefreshing ? <IconSpinner size={16} /> : <IconRefresh size={16} />}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 12,
            border: "none",
            background: isDark ? "#3ec4c0" : "#0c6e6b",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "0.9rem",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(62, 196, 192, 0.3)",
          }}
        >
          <IconPlus size={18} />
          <span>Crear copia ahora</span>
        </button>
      </div>

      {/* Backups List / Table */}
      {backups.length === 0 ? (
        <div
          style={{
            padding: 48,
            borderRadius: 20,
            background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ color: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)" }}>
            <IconArchive size={48} />
          </div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: isDark ? "#ffffff" : "#0f172a" }}>
            No hay copias de seguridad disponibles
          </h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)" }}>
            Crea una copia de seguridad manual o configura una automatización programada.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 16,
          }}
        >
          {backups.map((backup) => {
            const isLoadingAction = actionLoadingMap[backup.id] || false
            return (
              <div
                key={backup.id}
                style={{
                  padding: 20,
                  borderRadius: 16,
                  background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
                  border: `1px solid ${
                    backup.isLocked
                      ? isDark
                        ? "rgba(62, 196, 192, 0.4)"
                        : "rgba(12, 110, 107, 0.4)"
                      : isDark
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(0, 0, 0, 0.06)"
                  }`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16,
                  boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.15)" : "0 2px 8px rgba(0,0,0,0.03)",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e0f2f1",
                          color: isDark ? "#3ec4c0" : "#00897b",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <IconArchive size={18} />
                      </div>
                      <h4
                        style={{
                          margin: 0,
                          fontSize: "1rem",
                          fontWeight: 700,
                          color: isDark ? "#ffffff" : "#0f172a",
                          wordBreak: "break-word",
                        }}
                      >
                        {backup.name || "Copia de seguridad"}
                      </h4>
                    </div>

                    {backup.isLocked && (
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: 8,
                          background: isDark ? "rgba(62, 196, 192, 0.2)" : "#ccfbf1",
                          color: isDark ? "#3ec4c0" : "#0f766e",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          flexShrink: 0,
                        }}
                      >
                        <IconLock size={12} />
                        Protegida
                      </span>
                    )}
                  </div>

                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)" }}>
                    <div>Tamaño: <strong style={{ color: isDark ? "#ffffff" : "#0f172a" }}>{formatBytesToHuman(backup.bytes)}</strong></div>
                    <div>Fecha: <span>{new Date(backup.createdAt).toLocaleString()}</span></div>
                  </div>
                </div>

                {/* Actions row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 12,
                    borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)"}`,
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      title="Descargar"
                      onClick={() => handleDownload(backup)}
                      disabled={isLoadingAction}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                        background: "transparent",
                        color: isDark ? "#60a5fa" : "#2563eb",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <IconDownload size={16} />
                    </button>

                    <button
                      type="button"
                      title={backup.isLocked ? "Desproteger copia" : "Proteger copia"}
                      onClick={() => handleToggleLock(backup)}
                      disabled={isLoadingAction}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                        background: "transparent",
                        color: backup.isLocked ? (isDark ? "#3ec4c0" : "#0f766e") : (isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)"),
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {backup.isLocked ? <IconLock size={16} /> : <IconUnlock size={16} />}
                    </button>

                    <button
                      type="button"
                      title="Eliminar"
                      onClick={() => setDeleteBackupTarget(backup)}
                      disabled={isLoadingAction || backup.isLocked}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                        background: "transparent",
                        color: backup.isLocked ? "rgba(100,116,139,0.3)" : "#ef4444",
                        cursor: backup.isLocked ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setRestoreBackupTarget(backup)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: isDark ? "rgba(245, 158, 11, 0.15)" : "#fef3c7",
                      color: isDark ? "#fbbf24" : "#d97706",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Restaurar
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Backup Modal */}
      {isCreateModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Crear copia de seguridad
              </h3>
              <button
                type="button"
                onClick={() => !isCreating && setIsCreateModalOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    marginBottom: 8,
                    color: isDark ? "rgba(255,255,255,0.8)" : "#334155",
                  }}
                >
                  Nombre de la copia (opcional):
                </label>
                <input
                  type="text"
                  placeholder="Ej: Copia manual antes de mantenimiento"
                  value={newBackupName}
                  onChange={(e) => setNewBackupName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isCreating}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    background: "transparent",
                    color: isDark ? "#ffffff" : "#334155",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isCreating}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: isDark ? "#3ec4c0" : "#0c6e6b",
                    color: "#ffffff",
                    cursor: isCreating ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  {isCreating ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                  <span>{isCreating ? "Creando..." : "Crear copia"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {restoreBackupTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ color: "#f59e0b" }}>
                <IconWarning size={28} />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Restaurar copia de seguridad
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: "0.9rem", color: isDark ? "rgba(255,255,255,0.8)" : "#334155", lineHeight: 1.5 }}>
              ¿Estás seguro de restaurar <strong>{restoreBackupTarget.name}</strong>? Se reemplazará el estado actual del servidor por esta copia.
            </p>

            {!isServerOffline && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: isDark ? "rgba(239, 68, 68, 0.15)" : "#fee2e2",
                  border: `1px solid ${isDark ? "rgba(239, 68, 68, 0.3)" : "#fca5a5"}`,
                  fontSize: "0.85rem",
                  color: isDark ? "#fca5a5" : "#b91c1c",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <IconAlertCircle size={18} />
                <span>El servidor debe estar <strong>Apagado (OFFLINE)</strong> para restaurar.</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={() => setRestoreBackupTarget(null)}
                disabled={isRestoring}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  background: "transparent",
                  color: isDark ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={!isServerOffline || isRestoring}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 22px",
                  borderRadius: 10,
                  border: "none",
                  background: isServerOffline ? "#f59e0b" : "rgba(100,116,139,0.3)",
                  color: "#ffffff",
                  cursor: isServerOffline && !isRestoring ? "pointer" : "not-allowed",
                  fontWeight: 700,
                }}
              >
                {isRestoring ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                <span>{isRestoring ? "Restaurando..." : "Confirmar restauración"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteBackupTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ color: "#ef4444" }}>
                <IconTrash size={28} />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Eliminar copia de seguridad
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: "0.9rem", color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
              ¿Estás seguro de eliminar <strong>{deleteBackupTarget.name}</strong>? Esta acción no se puede deshacer.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={() => setDeleteBackupTarget(null)}
                disabled={isDeleting}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  background: "transparent",
                  color: isDark ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 22px",
                  borderRadius: 10,
                  border: "none",
                  background: "#ef4444",
                  color: "#ffffff",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {isDeleting ? <IconSpinner size={18} /> : <IconTrash size={18} />}
                <span>{isDeleting ? "Eliminando..." : "Eliminar copia"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
