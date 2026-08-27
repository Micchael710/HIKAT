import React, { useState, useEffect, useCallback, useRef } from "react"
import type { ThemeMode, ServerWorldInfo, ServerStatus } from "../../types"
import { serverApi } from "../../services/graphqlClient"
import { formatBytesToHuman } from "@hikat/shared"
import {
  IconGlobe,
  IconDownload,
  IconUpload,
  IconArchive,
  IconSpinner,
  IconAlertCircle,
  IconWarning,
  IconCheck,
  IconCross,
  IconRefresh,
} from "../../theme/icons"

interface ServerWorldViewProps {
  theme: ThemeMode
  serverStatus?: ServerStatus
  onToast: (message: string, type: "success" | "error") => void
}

export default function ServerWorldView({
  theme,
  serverStatus,
  onToast,
}: ServerWorldViewProps) {
  const isDark = theme === "dark"
  const [worldInfo, setWorldInfo] = useState<ServerWorldInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Actions loading
  const [isBackupLoading, setIsBackupLoading] = useState(false)
  const [isDownloadLoading, setIsDownloadLoading] = useState(false)
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const isMountedRef = useRef(true)

  const fetchWorld = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true)
    setError(null)
    try {
      const data = await serverApi.getServerWorld()
      if (isMountedRef.current) {
        setWorldInfo(data)
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo obtener la información del mundo.",
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
    fetchWorld()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchWorld])

  const handleCreateBackup = async () => {
    setIsBackupLoading(true)
    try {
      await serverApi.createServerBackup("Copia de mundo")
      onToast("Copia de seguridad del mundo iniciada con éxito.", "success")
    } catch (err: unknown) {
      onToast(
        err instanceof Error
          ? err.message
          : "Error al crear copia de seguridad.",
        "error",
      )
    } finally {
      setIsBackupLoading(false)
    }
  }

  const handleDownloadWorld = async () => {
    setIsDownloadLoading(true)
    try {
      const res = await serverApi.createServerWorldDownloadUrl()
      if (res && res.url) {
        const link = document.createElement("a")
        link.href = res.url
        link.download = `${worldInfo?.name || "world"}.zip`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        onToast("Descarga de mundo iniciada.", "success")
      }
    } catch (err: unknown) {
      onToast(
        err instanceof Error
          ? err.message
          : "Error al generar descarga del mundo.",
        "error",
      )
    } finally {
      setIsDownloadLoading(false)
    }
  }

  const handleReplaceWorld = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile) return
    setIsUploading(true)

    try {
      // 1. Prepare upload ticket / url
      await serverApi.prepareServerWorldUpload()

      // 2. Call replace world mutation
      await serverApi.replaceServerWorld(selectedFile.name)

      onToast("Mundo reemplazado exitosamente.", "success")
      setIsReplaceModalOpen(false)
      setSelectedFile(null)
      await fetchWorld(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al reemplazar el mundo.",
        "error",
      )
    } finally {
      setIsUploading(false)
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
          Cargando información del mundo...
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
            No se pudo cargar la información del mundo
          </h3>
          <p style={{ margin: "6px 0 0 0", fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.7)" : "#7f1d1d" }}>
            {error}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchWorld(true)}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Active World Card */}
      <div
        style={{
          padding: 28,
          borderRadius: 20,
          background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
          boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.2)" : "0 4px 20px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e0f2f1",
                color: isDark ? "#3ec4c0" : "#00897b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconGlobe size={28} />
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.5)" }}>
                Mundo activo detectado
              </div>
              <h2 style={{ margin: "2px 0 0 0", fontSize: "1.5rem", fontWeight: 800, color: isDark ? "#ffffff" : "#0f172a" }}>
                {worldInfo?.name || "world"}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fetchWorld(true)}
            disabled={isRefreshing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              background: "transparent",
              color: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)",
              cursor: isRefreshing ? "not-allowed" : "pointer",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            {isRefreshing ? <IconSpinner size={16} /> : <IconRefresh size={16} />}
            <span>Actualizar</span>
          </button>
        </div>

        {/* World metadata pills */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {worldInfo?.sizeBytes !== null && worldInfo?.sizeBytes !== undefined && (
            <div
              style={{
                padding: "6px 14px",
                borderRadius: 10,
                background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9",
                fontSize: "0.85rem",
                color: isDark ? "rgba(255,255,255,0.8)" : "#334155",
                fontWeight: 500,
              }}
            >
              Tamaño: <strong>{formatBytesToHuman(worldInfo.sizeBytes)}</strong>
            </div>
          )}
          {worldInfo?.lastModified && (
            <div
              style={{
                padding: "6px 14px",
                borderRadius: 10,
                background: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9",
                fontSize: "0.85rem",
                color: isDark ? "rgba(255,255,255,0.8)" : "#334155",
                fontWeight: 500,
              }}
            >
              Modificado: <strong>{new Date(worldInfo.lastModified).toLocaleDateString()}</strong>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 8, borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }}>
          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={isBackupLoading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e0f2f1",
              color: isDark ? "#3ec4c0" : "#00897b",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: isBackupLoading ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {isBackupLoading ? <IconSpinner size={18} /> : <IconArchive size={18} />}
            <span>Crear copia de seguridad</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadWorld}
            disabled={isDownloadLoading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: isDark ? "rgba(59, 130, 246, 0.15)" : "#eff6ff",
              color: isDark ? "#60a5fa" : "#2563eb",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: isDownloadLoading ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {isDownloadLoading ? <IconSpinner size={18} /> : <IconDownload size={18} />}
            <span>Descargar mundo (.zip)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsReplaceModalOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: isDark ? "rgba(245, 158, 11, 0.15)" : "#fef3c7",
              color: isDark ? "#fbbf24" : "#d97706",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <IconUpload size={18} />
            <span>Reemplazar mundo</span>
          </button>
        </div>
      </div>

      {/* Replace World Modal */}
      {isReplaceModalOpen && (
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
              maxWidth: 520,
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
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ color: "#f59e0b" }}>
                  <IconWarning size={28} />
                </div>
                <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                  Reemplazar mundo
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !isUploading && setIsReplaceModalOpen(false)}
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

            {/* Warning banner */}
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: isDark ? "rgba(245, 158, 11, 0.1)" : "#fffbeb",
                border: `1px solid ${isDark ? "rgba(245, 158, 11, 0.2)" : "#fde68a"}`,
                fontSize: "0.85rem",
                color: isDark ? "rgba(255,255,255,0.85)" : "#92400e",
                lineHeight: 1.4,
              }}
            >
              <strong>Atención:</strong> Esta operación reemplazará los archivos del mundo actual por el archivo subido. Por seguridad, se creará automáticamente una copia de respaldo antes de aplicar los cambios.
            </div>

            {/* Offline Requirement check */}
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
                <span>El servidor debe estar <strong>Apagado (OFFLINE)</strong> para reemplazar el mundo.</span>
              </div>
            )}

            <form onSubmit={handleReplaceWorld} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                  Archivo comprimido (.zip) del mundo:
                </label>
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
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
                  onClick={() => setIsReplaceModalOpen(false)}
                  disabled={isUploading}
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
                  disabled={!selectedFile || isUploading || !isServerOffline}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: isServerOffline && selectedFile ? "#f59e0b" : "rgba(100,116,139,0.3)",
                    color: "#ffffff",
                    cursor: isServerOffline && selectedFile && !isUploading ? "pointer" : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  {isUploading ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                  <span>{isUploading ? "Procesando..." : "Confirmar reemplazo"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
