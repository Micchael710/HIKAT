import React, { useState, useEffect, useRef } from "react"
import type {
  ThemeMode,
  GameRelease,
  GameDraftChanges,
  GameDraftReadiness,
  ContentMedia,
} from "../../types"
import {
  validateSemVer,
  suggestNextPatchVersion,
  formatBytesToHuman,
} from "@hikat/shared"
import { gameApi, serverApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import {
  IconCross,
  IconRocket,
  IconSpinner,
  IconCheck,
  IconWarning,
  IconUpload,
  IconTrash,
  IconArchive,
  IconFile,
  IconFolder,
  IconRefresh,
} from "../../theme/icons"

interface PublishReleaseModalProps {
  theme: ThemeMode
  draftRelease: GameRelease
  publishedRelease?: GameRelease | null
  changes?: GameDraftChanges | null
  readiness?: GameDraftReadiness | null
  onClose: () => void
  onPublished: (version: string, fileCount: number) => void
}

type Step = 1 | 2 | 3
type ChangeFilter = "ALL" | "ADDED" | "UPDATED" | "REMOVED"

export default function PublishReleaseModal({
  theme,
  draftRelease,
  publishedRelease,
  changes,
  readiness: initialReadiness,
  onClose,
  onPublished,
}: PublishReleaseModalProps) {
  const isDark = theme === "dark"

  // Step wizard state
  const [currentStep, setCurrentStep] = useState<Step>(1)

  // Step 1: Details state
  const initialVersion =
    draftRelease.version && !draftRelease.version.startsWith("draft-")
      ? draftRelease.version
      : suggestNextPatchVersion(publishedRelease?.version)
  const [version, setVersion] = useState(initialVersion)
  const [notes, setNotes] = useState(draftRelease.notes || "")
  const [cover, setCover] = useState<ContentMedia | null>(draftRelease.cover || null)
  const [coverMediaId, setCoverMediaId] = useState<string | null>(draftRelease.coverMediaId || null)

  // Cover upload state
  const [isCoverUploading, setIsCoverUploading] = useState(false)
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2: Changes filter state
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("ALL")

  // Step 3: Confirmation & Backup state
  const [createBackupBeforePublish, setCreateBackupBeforePublish] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatusText, setSubmitStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [liveReadiness, setLiveReadiness] = useState<GameDraftReadiness | null>(initialReadiness || null)

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Cover file selection / drop handler
  const handleCoverFileSelected = async (file: File) => {
    setCoverUploadError(null)
    const mimeType = file.type.toLowerCase().trim()
    const isImage = mimeType.startsWith("image/")
    const isVideo = mimeType.startsWith("video/")

    if (!isImage && !isVideo) {
      setCoverUploadError("Formato de portada no compatible. Use PNG, JPEG, WebP, MP4 o WebM.")
      return
    }

    setIsCoverUploading(true)
    try {
      const uploaded = await uploadMediaFile(file, isImage ? "IMAGE" : "VIDEO")
      if (isMountedRef.current) {
        setCover(uploaded)
        setCoverMediaId(uploaded.id)
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setCoverUploadError(err.message || "Error al subir la portada.")
      }
    } finally {
      if (isMountedRef.current) {
        setIsCoverUploading(false)
      }
    }
  }

  const handleRemoveCover = () => {
    setCover(null)
    setCoverMediaId(null)
    setCoverUploadError(null)
  }

  // Navigate to Step 2 with validation & metadata persistence
  const handleGoToStep2 = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)

    const trimmedVersion = version.trim()
    if (!trimmedVersion) {
      setError("La versión es obligatoria.")
      return
    }

    if (!validateSemVer(trimmedVersion)) {
      setError("Formato de versión inválido. Debe seguir el formato SemVer (ejemplo: 1.0.1).")
      return
    }

    // Persist draft metadata
    try {
      await gameApi.updateGameDraftMetadata({
        version: trimmedVersion,
        notes: notes.trim() || null,
        coverMediaId: coverMediaId || null,
      })
      // Refresh readiness
      const overview = await gameApi.getAdminGameOverview()
      if (isMountedRef.current) {
        setLiveReadiness(overview.readiness || null)
        setCurrentStep(2)
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "Error al guardar los detalles del borrador.")
      }
    }
  }

  // Navigate to Step 3
  const handleGoToStep3 = async () => {
    setError(null)
    try {
      const overview = await gameApi.getAdminGameOverview()
      if (isMountedRef.current) {
        setLiveReadiness(overview.readiness || null)
        setCurrentStep(3)
      }
    } catch {
      if (isMountedRef.current) {
        setCurrentStep(3)
      }
    }
  }

  // Changed files from draft
  const changedFiles = draftRelease.files.filter(
    (f) => f.changeStatus && f.changeStatus !== "UNCHANGED",
  )

  const filteredFiles = changedFiles.filter((f) => {
    if (changeFilter === "ALL") return true
    return f.changeStatus === changeFilter
  })

  const isReady = liveReadiness ? liveReadiness.isReady : draftRelease.files.length > 0

  // Optional Backup Polling Logic
  const executeBackupFlow = async (targetVersion: string): Promise<boolean> => {
    setSubmitStatusText("Iniciando copia de seguridad del servidor...")
    const backupName = `Pre-release v${targetVersion}`
    const backup = await serverApi.createServerBackup(backupName)

    if (!backup || !backup.id) {
      throw new Error("No se pudo iniciar la copia de seguridad.")
    }

    // Poll until completedAt & isSuccessful or timeout (max 60 seconds)
    const backupId = backup.id
    const startTime = Date.now()
    const timeoutMs = 60000
    const pollIntervalMs = 1500

    setSubmitStatusText("Generando copia de seguridad en Pterodactyl...")

    while (Date.now() - startTime < timeoutMs) {
      const backupsList = await serverApi.getServerBackups()
      const found = backupsList.find((b) => b.id === backupId)

      if (found && found.completedAt) {
        if (found.isSuccessful) {
          return true
        } else {
          throw new Error("La copia de seguridad finalizó con error.")
        }
      }

      await new Promise((res) => setTimeout(res, pollIntervalMs))
      if (!isMountedRef.current) return false
    }

    throw new Error("Tiempo de espera agotado al generar la copia de seguridad.")
  }

  // Final Publication Handler
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setError(null)
    const trimmedVersion = version.trim()

    if (!trimmedVersion || !validateSemVer(trimmedVersion)) {
      setError("Formato de versión inválido. Debe ser SemVer (ejemplo: 1.0.1).")
      return
    }

    if (liveReadiness && !liveReadiness.isReady) {
      const issueMsg = liveReadiness.issues.length
        ? liveReadiness.issues.join(". ")
        : "El borrador no está listo para publicar."
      setError(`No se puede publicar la actualización: ${issueMsg}`)
      return
    }

    setIsSubmitting(true)

    try {
      // 1. Optional Backup Execution
      if (createBackupBeforePublish) {
        try {
          await executeBackupFlow(trimmedVersion)
        } catch (backupErr: any) {
          throw new Error(
            `No se pudo completar la copia de seguridad. La actualización no fue publicada. (${backupErr.message || "Error desconocido"})`,
          )
        }
      }

      // 2. Publish Game Release via authoritative GraphQL mutation
      setSubmitStatusText("Publicando actualización oficial...")
      const published = await gameApi.publishGameRelease({
        version: trimmedVersion,
        notes: notes.trim() || null,
        coverMediaId: coverMediaId || null,
      })

      onPublished(trimmedVersion, published.files.length)
      onClose()
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "Error al publicar la actualización.")
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false)
        setSubmitStatusText(null)
      }
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: isDark ? "#1e293b" : "#ffffff",
          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "680px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Modal Header & Wizard Step Bar */}
        <div
          style={{
            padding: "20px 24px 16px 24px",
            borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(34, 197, 94, 0.15)",
                  color: "#22c55e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconRocket size={20} />
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: "700",
                  color: isDark ? "#f1f5f9" : "#0f172a",
                }}
              >
                Publicar actualización oficial
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                background: "none",
                border: "none",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                color: isDark ? "#94a3b8" : "#64748b",
                display: "flex",
                padding: "4px",
              }}
            >
              <IconCross size={18} />
            </button>
          </div>

          {/* Steps Indicator */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "8px",
            }}
          >
            {[
              { num: 1, label: "1. Detalles" },
              { num: 2, label: "2. Revisar cambios" },
              { num: 3, label: "3. Confirmación" },
            ].map((s) => {
              const isActive = currentStep === s.num
              const isPast = currentStep > s.num
              return (
                <div
                  key={s.num}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    textAlign: "center",
                    fontSize: "12px",
                    fontWeight: "600",
                    backgroundColor: isActive
                      ? isDark
                        ? "rgba(59, 130, 246, 0.2)"
                        : "rgba(59, 130, 246, 0.1)"
                      : isPast
                      ? isDark
                        ? "rgba(34, 197, 94, 0.15)"
                        : "rgba(34, 197, 94, 0.1)"
                      : isDark
                      ? "#0f172a"
                      : "#f1f5f9",
                    color: isActive
                      ? "#3b82f6"
                      : isPast
                      ? "#22c55e"
                      : isDark
                      ? "#64748b"
                      : "#94a3b8",
                    border: `1px solid ${
                      isActive
                        ? "rgba(59, 130, 246, 0.4)"
                        : isPast
                        ? "rgba(34, 197, 94, 0.3)"
                        : "transparent"
                    }`,
                    transition: "all 0.2s ease",
                  }}
                >
                  {s.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
          {error && (
            <div
              style={{
                marginBottom: "20px",
                padding: "12px 16px",
                borderRadius: "10px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                fontSize: "13px",
                lineHeight: "1.4",
              }}
            >
              {error}
            </div>
          )}

          {/* STEP 1: DETALLES */}
          {currentStep === 1 && (
            <form onSubmit={handleGoToStep2} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Read-only Minecraft & NeoForge Badges */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  padding: "14px 16px",
                  borderRadius: "12px",
                  backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                  border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                }}
              >
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase" }}>
                    Minecraft
                  </span>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a", marginTop: "2px" }}>
                    {draftRelease.minecraftVersion} <span style={{ fontSize: "11px", fontWeight: "500", color: isDark ? "#64748b" : "#94a3b8" }}>(Borrador)</span>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase" }}>
                    NeoForge
                  </span>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a", marginTop: "2px" }}>
                    {draftRelease.neoForgeVersion} <span style={{ fontSize: "11px", fontWeight: "500", color: isDark ? "#64748b" : "#94a3b8" }}>(Borrador)</span>
                  </div>
                </div>
              </div>

              {/* Version input */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Versión de la actualización (SemVer) <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="Ej. 1.0.1"
                  style={{
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: "10px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: isDark ? "#0f172a" : "#ffffff",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontSize: "14px",
                    fontWeight: "600",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "4px", display: "block" }}>
                  {publishedRelease ? `Versión oficial actual: v${publishedRelease.version}` : "Primera versión del modpack."}
                </span>
              </div>

              {/* Notes textarea */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Notas de la versión (opcional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe los cambios, novedades, correcciones o mods añadidos en esta versión..."
                  rows={3}
                  maxLength={5000}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: isDark ? "#0f172a" : "#ffffff",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontSize: "13px",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Cover media uploader section */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Portada de la actualización (opcional)
                </label>

                {cover ? (
                  /* Preview Card */
                  <div
                    style={{
                      borderRadius: "12px",
                      overflow: "hidden",
                      border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                      backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                      padding: "14px",
                    }}
                  >
                    <div style={{ marginBottom: "10px", maxHeight: "220px", display: "flex", justifyContent: "center" }}>
                      {cover.mediaType === "IMAGE" ? (
                        <img
                          src={cover.url}
                          alt="Portada de actualización"
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            borderRadius: "8px",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <video
                          src={cover.url}
                          controls
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            borderRadius: "8px",
                          }}
                        />
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingTop: "10px",
                        borderTop: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
                      }}
                    >
                      <span style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                        {cover.mediaType} ({cover.mimeType}) • {formatBytesToHuman(cover.sizeBytes)}
                      </span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isCoverUploading}
                          style={{
                            padding: "5px 12px",
                            borderRadius: "6px",
                            border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                            backgroundColor: "transparent",
                            color: isDark ? "#cbd5e1" : "#334155",
                            fontSize: "12px",
                            cursor: "pointer",
                          }}
                        >
                          Reemplazar
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveCover}
                          disabled={isCoverUploading}
                          style={{
                            padding: "5px 12px",
                            borderRadius: "6px",
                            border: "1px solid rgba(239, 68, 68, 0.3)",
                            backgroundColor: "transparent",
                            color: "#ef4444",
                            fontSize: "12px",
                            cursor: "pointer",
                          }}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Upload Dropzone */
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (e.dataTransfer.files?.[0]) {
                        handleCoverFileSelected(e.dataTransfer.files[0])
                      }
                    }}
                    style={{
                      border: `2px dashed ${isDark ? "#475569" : "#cbd5e1"}`,
                      borderRadius: "12px",
                      padding: "24px 16px",
                      textAlign: "center",
                      backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                      cursor: isCoverUploading ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleCoverFileSelected(e.target.files[0])
                        }
                      }}
                    />

                    {isCoverUploading ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                        <IconSpinner size={24} />
                        <span style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                          Subiendo portada a Cloudflare R2...
                        </span>
                      </div>
                    ) : (
                      <>
                        <div style={{ color: "#3b82f6", display: "flex", justifyContent: "center", marginBottom: "8px" }}>
                          <IconUpload size={24} />
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: isDark ? "#cbd5e1" : "#334155" }}>
                          Arrastra o haz clic para seleccionar imagen o video
                        </div>
                        <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "4px" }}>
                          Imágenes (PNG, JPEG, WebP hasta 5 MB) o Videos (MP4, WebM hasta 25 MB)
                        </div>
                      </>
                    )}
                  </div>
                )}

                {coverUploadError && (
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#ef4444" }}>
                    {coverUploadError}
                  </div>
                )}
              </div>

              {/* Step 1 Footer Action */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  paddingTop: "16px",
                  borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "8px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: "transparent",
                    color: isDark ? "#94a3b8" : "#64748b",
                    fontSize: "13px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCoverUploading}
                  style={{
                    padding: "9px 20px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: isCoverUploading ? "not-allowed" : "pointer",
                  }}
                >
                  Siguiente: Revisar cambios →
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: REVISAR CAMBIOS */}
          {currentStep === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Change Summary Card */}
              {changes && (
                <div
                  style={{
                    padding: "14px 18px",
                    borderRadius: "12px",
                    backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: isDark ? "#94a3b8" : "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: "10px",
                    }}
                  >
                    Resumen de cambios a publicar
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "700", color: "#22c55e" }}>
                      +{changes.added} añadidos
                    </span>
                    <span style={{ fontSize: "14px", fontWeight: "700", color: "#38bdf8" }}>
                      ↑ {changes.updated} actualizados
                    </span>
                    <span style={{ fontSize: "14px", fontWeight: "700", color: "#ef4444" }}>
                      − {changes.removed} eliminados
                    </span>
                    <span style={{ fontSize: "14px", color: isDark ? "#94a3b8" : "#64748b" }}>
                      = {changes.unchanged} sin cambios
                    </span>
                  </div>
                </div>
              )}

              {/* Filter Tabs */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(
                  [
                    { key: "ALL", label: `Todos los cambios (${changedFiles.length})` },
                    { key: "ADDED", label: `Añadidos (+${changes?.added || 0})` },
                    { key: "UPDATED", label: `Actualizados (↑${changes?.updated || 0})` },
                    { key: "REMOVED", label: `Eliminados (−${changes?.removed || 0})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setChangeFilter(tab.key)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: "600",
                      border: "none",
                      backgroundColor:
                        changeFilter === tab.key
                          ? isDark
                            ? "#334155"
                            : "#e2e8f0"
                          : "transparent",
                      color:
                        changeFilter === tab.key
                          ? isDark
                            ? "#f1f5f9"
                            : "#0f172a"
                          : isDark
                          ? "#94a3b8"
                          : "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Changed Files List */}
              <div
                style={{
                  borderRadius: "12px",
                  border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                  backgroundColor: isDark ? "#0f172a" : "#ffffff",
                  maxHeight: "260px",
                  overflowY: "auto",
                }}
              >
                {filteredFiles.length === 0 ? (
                  <div
                    style={{
                      padding: "36px 16px",
                      textAlign: "center",
                      color: isDark ? "#94a3b8" : "#64748b",
                      fontSize: "13px",
                    }}
                  >
                    {changedFiles.length === 0
                      ? "No hay cambios de archivos pendientes respecto a la versión oficial."
                      : "No hay archivos en esta categoría."}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {filteredFiles.map((file) => {
                      const isAdded = file.changeStatus === "ADDED"
                      const isUpdated = file.changeStatus === "UPDATED"
                      const isRemoved = file.changeStatus === "REMOVED"

                      const badgeBg = isAdded
                        ? "rgba(34, 197, 94, 0.15)"
                        : isUpdated
                        ? "rgba(56, 189, 248, 0.15)"
                        : "rgba(239, 68, 68, 0.15)"

                      const badgeColor = isAdded ? "#22c55e" : isUpdated ? "#38bdf8" : "#ef4444"

                      const badgeText = isAdded ? "AÑADIDO" : isUpdated ? "ACTUALIZADO" : "ELIMINADO"

                      return (
                        <div
                          key={file.id}
                          style={{
                            padding: "10px 14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "12px",
                            borderBottom: `1px solid ${isDark ? "#1e293b" : "#f1f5f9"}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                            <div style={{ color: isDark ? "#94a3b8" : "#64748b", display: "flex" }}>
                              {file.isDirectory ? <IconFolder size={18} /> : <IconFile size={18} />}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: "13px",
                                  fontWeight: "600",
                                  color: isDark ? "#f1f5f9" : "#0f172a",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {file.name}
                              </div>
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: isDark ? "#64748b" : "#94a3b8",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {file.logicalPath} • {file.category}
                                {file.sourceProvider ? ` • ${file.sourceProvider}` : ""}
                                {!file.isDirectory ? ` • ${formatBytesToHuman(file.sizeBytes)}` : ""}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                            <span
                              style={{
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "10px",
                                fontWeight: "700",
                                backgroundColor:
                                  file.effectivePolicy === "MODIFICABLE"
                                    ? "rgba(34, 197, 94, 0.1)"
                                    : "rgba(148, 163, 184, 0.1)",
                                color:
                                  file.effectivePolicy === "MODIFICABLE"
                                    ? "#22c55e"
                                    : isDark
                                    ? "#94a3b8"
                                    : "#64748b",
                              }}
                            >
                              {file.effectivePolicy === "MODIFICABLE" ? "Modificable" : "No modificable"}
                            </span>

                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "700",
                                backgroundColor: badgeBg,
                                color: badgeColor,
                              }}
                            >
                              {badgeText}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Unchanged summary notice */}
              {changes && changes.unchanged > 0 && (
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", textAlign: "center" }}>
                  ✓ {changes.unchanged} archivos permanecen sin cambios respecto a la versión oficial anterior.
                </div>
              )}

              {/* Step 2 Footer Actions */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "10px",
                  paddingTop: "16px",
                  borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "8px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: "transparent",
                    color: isDark ? "#94a3b8" : "#64748b",
                    fontSize: "13px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  ← Volver a detalles
                </button>
                <button
                  type="button"
                  onClick={handleGoToStep3}
                  style={{
                    padding: "9px 20px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Siguiente: Confirmación →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: CONFIRMACIÓN */}
          {currentStep === 3 && (
            <form onSubmit={handlePublish} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Summary Review Card */}
              <div
                style={{
                  padding: "16px 20px",
                  borderRadius: "14px",
                  backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                  border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase" }}>
                      Versión oficial definitiva
                    </span>
                    <div style={{ fontSize: "20px", fontWeight: "800", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                      v{version}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase" }}>
                      Entorno
                    </span>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: isDark ? "#cbd5e1" : "#334155" }}>
                      MC {draftRelease.minecraftVersion} • NeoForge {draftRelease.neoForgeVersion}
                    </div>
                  </div>
                </div>

                {/* Cover & Notes Summary */}
                <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
                  {cover ? (
                    <div style={{ width: "48px", height: "48px", borderRadius: "8px", overflow: "hidden", flexShrink: 0 }}>
                      {cover.mediaType === "IMAGE" ? (
                        <img src={cover.url} alt="Cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", backgroundColor: "#334155", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "10px" }}>
                          VIDEO
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: "12px", color: isDark ? "#64748b" : "#94a3b8" }}>
                      Sin portada
                    </span>
                  )}

                  <div style={{ fontSize: "13px", color: isDark ? "#cbd5e1" : "#334155", fontStyle: notes ? "normal" : "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {notes ? notes : "Sin notas de versión."}
                  </div>
                </div>

                {/* Change Counters Pill */}
                {changes && (
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      paddingTop: "10px",
                      borderTop: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ color: "#22c55e", fontWeight: "600" }}>+{changes.added} añadidos</span>
                    <span style={{ color: "#38bdf8", fontWeight: "600" }}>↑ {changes.updated} actualizados</span>
                    <span style={{ color: "#ef4444", fontWeight: "600" }}>− {changes.removed} eliminados</span>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>{changes.total} archivos totales</span>
                  </div>
                )}
              </div>

              {/* Readiness Checklist Card */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "12px",
                  backgroundColor: isReady ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.08)",
                  border: `1px solid ${isReady ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "700", color: isReady ? "#22c55e" : "#ef4444", marginBottom: "8px" }}>
                  {isReady ? "✓ Verificación de preparación completada" : "⚠ Problemas detectados antes de publicar"}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "12px" }}>
                  <div style={{ color: liveReadiness?.validVersion ? "#22c55e" : "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
                    {liveReadiness?.validVersion ? "✓" : "✗"} Versión SemVer válida
                  </div>
                  <div style={{ color: liveReadiness?.uniqueVersion ? "#22c55e" : "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
                    {liveReadiness?.uniqueVersion ? "✓" : "✗"} Versión disponible
                  </div>
                  <div style={{ color: liveReadiness?.hasFiles ? "#22c55e" : "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
                    {liveReadiness?.hasFiles ? "✓" : "✗"} Archivos descargables
                  </div>
                  <div style={{ color: liveReadiness?.noConflicts ? "#22c55e" : "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
                    {liveReadiness?.noConflicts ? "✓" : "✗"} Sin conflictos de ruta
                  </div>
                  <div style={{ color: liveReadiness?.storageVerified ? "#22c55e" : "#ef4444", display: "flex", alignItems: "center", gap: "6px" }}>
                    {liveReadiness?.storageVerified ? "✓" : "✗"} Almacenamiento R2 verificado
                  </div>
                </div>

                {liveReadiness?.issues && liveReadiness.issues.length > 0 && (
                  <div style={{ marginTop: "10px", fontSize: "12px", color: "#ef4444" }}>
                    {liveReadiness.issues.join(". ")}
                  </div>
                )}
              </div>

              {/* Optional Server Backup Checkbox */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "12px",
                  backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                  border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                }}
              >
                <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={createBackupBeforePublish}
                    onChange={(e) => setCreateBackupBeforePublish(e.target.checked)}
                    disabled={isSubmitting}
                    style={{ marginTop: "3px", width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                      Crear una copia de seguridad del servidor antes de publicar
                    </div>
                    <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "2px" }}>
                      Genera un respaldo completo del servidor en Pterodactyl antes de publicar la versión oficial. (Desactivado por defecto).
                    </div>
                  </div>
                </label>
              </div>

              {/* Scope Notice */}
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  backgroundColor: isDark ? "rgba(59, 130, 246, 0.08)" : "rgba(59, 130, 246, 0.05)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                  fontSize: "12px",
                  color: isDark ? "#93c5fd" : "#2563eb",
                  lineHeight: "1.4",
                }}
              >
                ℹ Publicar convierte el borrador en la versión oficial del modpack para los jugadores. Los archivos en el servidor físico se mantendrán hasta su sincronización programada.
              </div>

              {/* Submit Status Banner */}
              {isSubmitting && submitStatusText && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    color: "#3b82f6",
                    fontSize: "13px",
                    fontWeight: "500",
                  }}
                >
                  <IconSpinner size={16} />
                  <span>{submitStatusText}</span>
                </div>
              )}

              {/* Step 3 Footer Actions */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "10px",
                  paddingTop: "16px",
                  borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  disabled={isSubmitting}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "8px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: "transparent",
                    color: isDark ? "#94a3b8" : "#64748b",
                    fontSize: "13px",
                    fontWeight: "500",
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  ← Volver a cambios
                </button>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    style={{
                      padding: "9px 16px",
                      borderRadius: "8px",
                      border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                      backgroundColor: "transparent",
                      color: isDark ? "#94a3b8" : "#64748b",
                      fontSize: "13px",
                      fontWeight: "500",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting || !isReady}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "9px 22px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "#22c55e",
                      color: "#ffffff",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: isSubmitting || !isReady ? "not-allowed" : "pointer",
                      opacity: isSubmitting || !isReady ? 0.6 : 1,
                      boxShadow: isReady ? "0 2px 8px rgba(34, 197, 94, 0.4)" : "none",
                    }}
                  >
                    {isSubmitting ? <IconSpinner size={16} /> : <IconRocket size={16} />}
                    Publicar actualización oficial
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
