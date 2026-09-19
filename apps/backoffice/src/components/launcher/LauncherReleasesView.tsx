import React, { useState, useEffect, useCallback } from "react"
import type { ThemeMode, LauncherReleaseItem } from "../../types"
import { graphqlClient, getBackendBaseUrl } from "../../services/graphqlClient"
import { uploadLauncherRelease, LauncherUploadProgress } from "../../services/launcherUploadService"
import { getThemeTokens } from "../../theme/tokens"
import {
  IconRocket,
  IconPlus,
  IconDownload,
  IconSpinner,
  IconCheck,
  IconTrash,
} from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface LauncherReleasesViewProps {
  theme: ThemeMode
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "—"
  try {
    const d = new Date(isoDate)
    return d.toLocaleString("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return isoDate
  }
}

function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, "").trim()
  const clean2 = v2.replace(/^v/i, "").trim()
  const [main1, pre1] = clean1.split("-")
  const [main2, pre2] = clean2.split("-")
  const parts1 = (main1 || "").split(".").map((p) => parseInt(p, 10) || 0)
  const parts2 = (main2 || "").split(".").map((p) => parseInt(p, 10) || 0)
  const maxLen = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] ?? 0
    const num2 = parts2[i] ?? 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  if (!pre1 && pre2) return 1
  if (pre1 && !pre2) return -1
  if (pre1 && pre2) return pre1.localeCompare(pre2, undefined, { numeric: true })
  return 0
}

export default function LauncherReleasesView({ theme }: LauncherReleasesViewProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  const [releases, setReleases] = useState<LauncherReleaseItem[]>([])
  const [publishedRelease, setPublishedRelease] = useState<LauncherReleaseItem | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false)
  const [versionInput, setVersionInput] = useState<string>("")
  const [notesInput, setNotesInput] = useState<string>("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [publishImmediately, setPublishImmediately] = useState<boolean>(true)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<LauncherUploadProgress | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Publish confirmation modal state
  const [publishTarget, setPublishTarget] = useState<LauncherReleaseItem | null>(null)
  const [isPublishing, setIsPublishing] = useState<boolean>(false)

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<LauncherReleaseItem | null>(null)
  const [isDeleting, setIsDeleting] = useState<boolean>(false)

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copiedSha, setCopiedSha] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [all, active] = await Promise.all([
        graphqlClient.getLauncherReleases(),
        graphqlClient.getPublishedLauncherRelease(),
      ])
      setReleases(all)
      setPublishedRelease(active)
    } catch (err: any) {
      setError(err.message || "Error al cargar las versiones del launcher.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha)
    setCopiedSha(sha)
    setTimeout(() => setCopiedSha(null), 2000)
    setToastMessage("SHA-512 copiado al portapapeles")
  }

  const handleStartUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile) {
      setUploadError("Selecciona un archivo instalador ejecutable (.exe).")
      return
    }
    const cleanVer = versionInput.trim()
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(cleanVer)) {
      setUploadError("El formato de versión debe seguir SemVer (ej: 1.0.1 o 1.0.1-beta.1).")
      return
    }

    if (publishImmediately && publishedRelease && compareVersions(cleanVer, publishedRelease.version) <= 0) {
      setUploadError(
        `No se puede publicar la versión ${cleanVer} porque ya existe una versión publicada mayor o igual (v${publishedRelease.version}). Desmarca "Publicar inmediatamente" para guardarla como borrador.`
      )
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      const release = await uploadLauncherRelease(
        selectedFile,
        cleanVer,
        notesInput,
        (progress) => setUploadProgress(progress),
      )

      if (publishImmediately) {
        setUploadProgress({
          phase: "completing",
          percentage: 100,
          message: "Publicando release en producción...",
        })
        await graphqlClient.publishLauncherRelease(release.id)
      }

      setToastMessage(
        publishImmediately
          ? `Versión ${cleanVer} subida y publicada con éxito.`
          : `Versión ${cleanVer} subida en estado Borrador.`,
      )
      setIsUploadOpen(false)
      setSelectedFile(null)
      setVersionInput("")
      setNotesInput("")
      setUploadProgress(null)
      await loadData()
    } catch (err: any) {
      setUploadError(err.message || "Error durante la subida del instalador.")
    } finally {
      setIsUploading(false)
    }
  }

  const handleConfirmPublish = async () => {
    if (!publishTarget) return
    setIsPublishing(true)
    try {
      await graphqlClient.publishLauncherRelease(publishTarget.id)
      setToastMessage(`Versión ${publishTarget.version} publicada. La versión previa ha sido archivada.`)
      setPublishTarget(null)
      await loadData()
    } catch (err: any) {
      setToastMessage(err.message || "Error al publicar la versión.")
    } finally {
      setIsPublishing(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await graphqlClient.deleteLauncherRelease(deleteTarget.id)
      setToastMessage(`Release v${deleteTarget.version} eliminada correctamente.`)
      setDeleteTarget(null)
      await loadData()
    } catch (err: any) {
      setToastMessage(err.message || "Error al eliminar la release.")
    } finally {
      setIsDeleting(false)
    }
  }

  const getDownloadUrl = (filename: string) => {
    const backendBase = getBackendBaseUrl()
    return `${backendBase}/launcher/update/download/${encodeURIComponent(filename)}`
  }

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1200, margin: "0 auto", color: tokens.textPrimary }}>
      {toastMessage && (
        <LiveToast
          message={toastMessage}
          onClose={() => setToastMessage(null)}
          theme={theme}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 32,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(62, 196, 192, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#3ec4c0",
              }}
            >
              <IconRocket size={22} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
              HiKAT Desktop Launcher
            </h1>
          </div>
          <p style={{ margin: 0, color: tokens.textSecondary, fontSize: 14 }}>
            Control de versiones y sistema de actualización automática en producción para Windows.
          </p>
        </div>

        <button
          onClick={() => {
            setUploadError(null)
            setUploadProgress(null)
            setIsUploadOpen(true)
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            background: "linear-gradient(135deg, #3ec4c0 0%, #2ba5a1 100%)",
            color: "#090d12",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(62, 196, 192, 0.35)",
            transition: "all 0.2s ease",
          }}
        >
          <IconPlus size={16} />
          Subir Nueva Versión
        </button>
      </div>

      {isLoading ? (
        <div
          style={{
            padding: 60,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            color: tokens.textSecondary,
          }}
        >
          <IconSpinner size={24} className="spin" />
          <span>Cargando versiones del launcher...</span>
        </div>
      ) : error ? (
        <div
          style={{
            padding: 24,
            borderRadius: 12,
            background: isDark ? "rgba(239, 68, 68, 0.1)" : "#fee2e2",
            color: "#ef4444",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            marginBottom: 24,
          }}
        >
          {error}
        </div>
      ) : (
        <>
          {/* Active Production Release Banner */}
          <div
            style={{
              marginBottom: 32,
              padding: 24,
              borderRadius: 14,
              background: isDark
                ? "linear-gradient(135deg, rgba(62, 196, 192, 0.08) 0%, rgba(18, 26, 34, 0.95) 100%)"
                : "linear-gradient(135deg, #e6f9f8 0%, #ffffff 100%)",
              border: `1px solid ${isDark ? "rgba(62, 196, 192, 0.3)" : "rgba(62, 196, 192, 0.4)"}`,
              boxShadow: isDark
                ? "0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(62, 196, 192, 0.2)"
                : "0 8px 32px rgba(62, 196, 192, 0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 20,
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "#10b981",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#10b981",
                        boxShadow: "0 0 8px #10b981",
                      }}
                    />
                    Versión Publicada
                  </span>

                  {publishedRelease && (
                    <span style={{ fontSize: 13, color: tokens.textSecondary }}>
                      Publicada el {formatDate(publishedRelease.publishedAt)}
                    </span>
                  )}
                </div>

                {publishedRelease ? (
                  <div>
                    <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 6px 0", color: "#3ec4c0" }}>
                      v{publishedRelease.version}
                    </h2>
                    <div style={{ fontSize: 14, color: tokens.textSecondary, marginBottom: 12 }}>
                      Archivo: <strong style={{ color: tokens.textPrimary }}>{publishedRelease.filename}</strong> (
                      {formatBytes(publishedRelease.sizeBytes)})
                    </div>

                    {/* SHA-512 Box */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: isDark ? "rgba(0, 0, 0, 0.3)" : "#f1f5f9",
                        padding: "8px 12px",
                        borderRadius: 8,
                        maxWidth: 700,
                        border: `1px solid ${tokens.borderSubtle}`,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: tokens.textTertiary }}>
                        SHA-512:
                      </span>
                      <code
                        style={{
                          fontSize: 12,
                          fontFamily: "monospace",
                          color: tokens.textSecondary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {publishedRelease.sha512}
                      </code>
                      <button
                        onClick={() => handleCopySha(publishedRelease.sha512)}
                        style={{
                          background: "none",
                          border: "none",
                          color: copiedSha === publishedRelease.sha512 ? "#10b981" : "#3ec4c0",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {copiedSha === publishedRelease.sha512 ? "¡Copiado!" : "Copiar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px 0", color: tokens.textSecondary }}>
                      No hay ninguna versión publicada actualmente
                    </h2>
                    <p style={{ fontSize: 14, color: tokens.textTertiary, margin: 0 }}>
                      Sube una nueva release para que el actualizador automático pueda servir las descargas a los clientes.
                    </p>
                  </div>
                )}
              </div>

              {publishedRelease && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <a
                    href={getDownloadUrl(publishedRelease.filename)}
                    target="_blank"
                    rel="noreferrer"
                    download={publishedRelease.filename}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 18px",
                      background: isDark ? "rgba(255, 255, 255, 0.08)" : "#e2e8f0",
                      color: tokens.textPrimary,
                      textDecoration: "none",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      transition: "background 0.2s",
                    }}
                  >
                    <IconDownload size={16} />
                    Descargar Instalador (.exe)
                  </a>

                  <a
                    href="/launcher/update/latest.yml"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: tokens.textTertiary,
                      textDecoration: "none",
                    }}
                  >
                    Ver feed <code>latest.yml</code> ↗
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* All Releases Table */}
          <div
            style={{
              background: tokens.bgCard,
              borderRadius: 14,
              border: `1px solid ${tokens.borderSubtle}`,
              overflow: "hidden",
              boxShadow: tokens.cardShadow,
            }}
          >
            <div
              style={{
                padding: "20px 24px",
                borderBottom: `1px solid ${tokens.borderSubtle}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                Historial de Releases ({releases.length})
              </h3>
            </div>

            {releases.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: tokens.textSecondary }}>
                No hay releases registradas todavía.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
                  <thead>
                    <tr
                      style={{
                        background: isDark ? "rgba(255, 255, 255, 0.02)" : "#f8fafc",
                        borderBottom: `1px solid ${tokens.borderSubtle}`,
                        color: tokens.textSecondary,
                        fontSize: 12,
                        textTransform: "uppercase",
                      }}
                    >
                      <th style={{ padding: "14px 20px" }}>Versión</th>
                      <th style={{ padding: "14px 20px" }}>Archivo</th>
                      <th style={{ padding: "14px 20px" }}>Tamaño</th>
                      <th style={{ padding: "14px 20px" }}>Estado</th>
                      <th style={{ padding: "14px 20px" }}>Fecha de Subida</th>
                      <th style={{ padding: "14px 20px", textAlign: "right" }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {releases.map((rel) => {
                      const isPub = rel.status === "PUBLISHED"
                      const isArchived = rel.status === "ARCHIVED"
                      const isDraft = rel.status === "DRAFT"
                      const canDelete = !isPub // DRAFT or ARCHIVED
                      const canPublish =
                        !isPub &&
                        (!publishedRelease || compareVersions(rel.version, publishedRelease.version) > 0)
                      return (
                        <tr
                          key={rel.id}
                          style={{
                            borderBottom: `1px solid ${tokens.borderSubtle}`,
                            transition: "background 0.15s",
                            background: isPub
                              ? isDark
                                ? "rgba(62, 196, 192, 0.03)"
                                : "rgba(62, 196, 192, 0.05)"
                              : undefined,
                          }}
                        >
                          <td style={{ padding: "16px 20px", fontWeight: 700 }}>
                            v{rel.version}
                          </td>
                          <td style={{ padding: "16px 20px", color: tokens.textSecondary }}>
                            {rel.filename}
                          </td>
                          <td style={{ padding: "16px 20px", color: tokens.textSecondary }}>
                            {formatBytes(rel.sizeBytes)}
                          </td>
                          <td style={{ padding: "16px 20px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                background: isPub
                                  ? "rgba(16, 185, 129, 0.15)"
                                  : isArchived
                                  ? "rgba(148, 163, 184, 0.15)"
                                  : "rgba(245, 158, 11, 0.15)",
                                color: isPub
                                  ? "#10b981"
                                  : isArchived
                                  ? "#94a3b8"
                                  : "#f59e0b",
                              }}
                            >
                              {isPub ? "Publicada" : isArchived ? "Archivada" : "Borrador"}
                            </span>
                          </td>
                          <td style={{ padding: "16px 20px", color: tokens.textSecondary }}>
                            {formatDate(rel.createdAt)}
                          </td>
                          <td style={{ padding: "16px 20px", textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
                              {canPublish && (
                                <button
                                  onClick={() => setPublishTarget(rel)}
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: 6,
                                    background: "#3ec4c0",
                                    color: "#090d12",
                                    border: "none",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  Publicar
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => setDeleteTarget(rel)}
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: 6,
                                    background: isDark ? "rgba(239, 68, 68, 0.12)" : "#fee2e2",
                                    color: "#ef4444",
                                    border: "1px solid rgba(239, 68, 68, 0.3)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <IconTrash size={13} />
                                  Eliminar
                                </button>
                              )}
                              {(isPub || isArchived) && (
                                <a
                                  href={getDownloadUrl(rel.filename)}
                                  target="_blank"
                                  rel="noreferrer"
                                  download={rel.filename}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 6,
                                    background: isDark ? "rgba(255, 255, 255, 0.08)" : "#e2e8f0",
                                    color: tokens.textPrimary,
                                    border: "none",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    textDecoration: "none",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <IconDownload size={14} />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Upload Release Modal */}
      {isUploadOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 540,
              background: tokens.bgCard,
              borderRadius: 16,
              border: `1px solid ${tokens.borderMedium}`,
              padding: 28,
              boxShadow: tokens.cardShadowLg,
              position: "relative",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px 0" }}>
              Subir Nueva Release del Launcher
            </h2>
            <p style={{ fontSize: 13, color: tokens.textSecondary, margin: "0 0 20px 0" }}>
              Sube el instalador NSIS generado por electron-builder (.exe). Se calculará el hash SHA-512 automáticamente y se transferirá directamente a Cloudflare R2.
            </p>

            {uploadError && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: isDark ? "rgba(239, 68, 68, 0.12)" : "#fee2e2",
                  color: "#ef4444",
                  fontSize: 13,
                  marginBottom: 16,
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                }}
              >
                {uploadError}
              </div>
            )}

            {isUploading ? (
              <div style={{ padding: "30px 10px", textAlign: "center" }}>
                <IconSpinner size={36} className="spin" style={{ color: "#3ec4c0", marginBottom: 16 }} />
                <h4 style={{ margin: "0 0 8px 0", fontSize: 16 }}>
                  {uploadProgress?.message || "Procesando subida..."}
                </h4>
                {uploadProgress && (
                  <div style={{ maxWidth: 360, margin: "0 auto" }}>
                    <div
                      style={{
                        height: 6,
                        background: isDark ? "rgba(255, 255, 255, 0.1)" : "#e2e8f0",
                        borderRadius: 3,
                        overflow: "hidden",
                        marginTop: 12,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${uploadProgress.percentage}%`,
                          background: "#3ec4c0",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: tokens.textSecondary, marginTop: 6, display: "block" }}>
                      Fase: {uploadProgress.phase.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleStartUpload}>
                {/* Version input */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Versión SemVer <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ej: 1.0.1"
                    value={versionInput}
                    onChange={(e) => setVersionInput(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${tokens.borderMedium}`,
                      background: tokens.bgInput,
                      color: tokens.textPrimary,
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* File picker */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Instalador NSIS (.exe) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="file"
                    accept=".exe"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0])
                        // Auto-extract version if possible from filename like "HiKAT Launcher Setup 1.0.1.exe"
                        const match = e.target.files[0].name.match(/(\d+\.\d+\.\d+)/)
                        if (match && match[1] && !versionInput) {
                          setVersionInput(match[1])
                        }
                      }
                    }}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${tokens.borderMedium}`,
                      background: tokens.bgInput,
                      color: tokens.textPrimary,
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                  {selectedFile && (
                    <div style={{ fontSize: 12, color: tokens.textSecondary, marginTop: 4 }}>
                      Tamaño: {formatBytes(selectedFile.size)}
                    </div>
                  )}
                </div>

                {/* Notes input */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Notas de la Versión (Opcional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Detalles de novedades o correcciones en esta release..."
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${tokens.borderMedium}`,
                      background: tokens.bgInput,
                      color: tokens.textPrimary,
                      fontSize: 13,
                      outline: "none",
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Publish Immediately checkbox */}
                <div style={{ marginBottom: 24 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={publishImmediately}
                      onChange={(e) => setPublishImmediately(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "#3ec4c0", cursor: "pointer" }}
                    />
                    <span>Publicar inmediatamente en producción tras subir</span>
                  </label>
                  <p style={{ fontSize: 12, color: tokens.textTertiary, margin: "4px 0 0 24px" }}>
                    Archivará de forma automática la versión actualmente activa.
                  </p>
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setIsUploadOpen(false)}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 8,
                      background: "none",
                      border: `1px solid ${tokens.borderMedium}`,
                      color: tokens.textPrimary,
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: "10px 20px",
                      borderRadius: 8,
                      background: "#3ec4c0",
                      color: "#090d12",
                      border: "none",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: "0 2px 10px rgba(62, 196, 192, 0.35)",
                    }}
                  >
                    Subir Instalador
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Publish Confirmation Modal */}
      {publishTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: tokens.bgCard,
              borderRadius: 16,
              border: `1px solid ${tokens.borderMedium}`,
              padding: 28,
              boxShadow: tokens.cardShadowLg,
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px 0" }}>
              ¿Publicar la versión v{publishTarget.version}?
            </h3>
            <p style={{ fontSize: 14, color: tokens.textSecondary, lineHeight: 1.5, margin: "0 0 20px 0" }}>
              Esta versión pasará a ser la versión activa servida por el feed de actualización automática.
              {publishedRelease && (
                <> La versión actual <strong>v{publishedRelease.version}</strong> pasará a estado archivado.</>
              )}
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                disabled={isPublishing}
                onClick={() => setPublishTarget(null)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  background: "none",
                  border: `1px solid ${tokens.borderMedium}`,
                  color: tokens.textPrimary,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPublishing}
                onClick={handleConfirmPublish}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  background: "#10b981",
                  color: "#ffffff",
                  border: "none",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isPublishing ? (
                  <>
                    <IconSpinner size={16} className="spin" />
                    Publicando...
                  </>
                ) : (
                  <>
                    <IconCheck size={16} />
                    Confirmar y Publicar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: tokens.bgCard,
              borderRadius: 16,
              border: `1px solid ${tokens.borderMedium}`,
              padding: 28,
              boxShadow: tokens.cardShadowLg,
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px 0", color: "#ef4444" }}>
              ¿Eliminar release v{deleteTarget.version}?
            </h3>
            <p style={{ fontSize: 14, color: tokens.textSecondary, lineHeight: 1.5, margin: "0 0 20px 0" }}>
              Se eliminará de forma permanente el instalador ejecutable <strong>{deleteTarget.filename}</strong> de Cloudflare R2 y su registro en la base de datos. Esta acción no se puede deshacer.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  background: "none",
                  border: `1px solid ${tokens.borderMedium}`,
                  color: tokens.textPrimary,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  background: "#ef4444",
                  color: "#ffffff",
                  border: "none",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isDeleting ? (
                  <>
                    <IconSpinner size={16} className="spin" />
                    Eliminando...
                  </>
                ) : (
                  <>
                    <IconTrash size={16} />
                    Eliminar Release
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
