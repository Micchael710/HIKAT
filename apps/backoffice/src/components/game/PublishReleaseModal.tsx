import React, { useState, useEffect, useRef } from "react"
import type {
  ThemeMode,
  GameRelease,
  GameDraftChanges,
  GameDraftReadiness,
  ContentMedia,
  ServerReleaseSyncPlan,
} from "../../types"
import {
  validateSemVer,
  suggestNextPatchVersion,
  formatBytesToHuman,
} from "@hikat/shared"
import { gameApi, serverContentApi, graphqlClient } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { getThemeTokens } from "../../theme/tokens"
import {
  IconCross,
  IconRocket,
  IconSpinner,
  IconCheck,
  IconWarning,
  IconUpload,
  IconTrash,
  IconFolder,
  IconFile,
  IconAlertCircle,
} from "../../theme/icons"

interface PublishReleaseModalProps {
  theme: ThemeMode
  draftRelease: GameRelease
  publishedRelease?: GameRelease | null
  changes?: GameDraftChanges | null
  readiness?: GameDraftReadiness | null
  onClose: () => void
  onPublished: (version: string, fileCount: number) => void
  onReviewServerChanges?: (plan: ServerReleaseSyncPlan) => void
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
  onReviewServerChanges,
}: PublishReleaseModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  // Step wizard state
  const [currentStep, setCurrentStep] = useState<Step>(1)

  // Live draft state (freshened on step transitions)
  const [currentDraft, setCurrentDraft] = useState<GameRelease>(draftRelease)
  const [currentChanges, setCurrentChanges] = useState<GameDraftChanges | null>(changes || null)
  const [currentReadiness, setCurrentReadiness] = useState<GameDraftReadiness | null>(initialReadiness || null)
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null)

  // Post-publish success state
  const [postPublishState, setPostPublishState] = useState<{
    publishedVersion: string
    fileCount: number
    plan: ServerReleaseSyncPlan | null
    planFetchFailed: boolean
  } | null>(null)

  // Step 1: Details state
  const initialVersion =
    draftRelease.version && !draftRelease.version.startsWith("draft-")
      ? draftRelease.version
      : suggestNextPatchVersion(publishedRelease?.version)
  const [version, setVersion] = useState(initialVersion)
  const [notes, setNotes] = useState(draftRelease.notes || "")
  const [cover, setCover] = useState<ContentMedia | null>(draftRelease.cover || null)
  const [coverMediaId, setCoverMediaId] = useState<string | null>(draftRelease.coverMediaId || null)

  // Cover upload and orphan compensation lifecycle tracking
  const initialCoverRef = useRef<{ id: string | null; cover: ContentMedia | null }>({
    id: draftRelease.coverMediaId || null,
    cover: draftRelease.cover || null,
  })
  const transientMediaIdsRef = useRef<Set<string>>(new Set())
  const isPublishedRef = useRef(false)

  const [isCoverUploading, setIsCoverUploading] = useState(false)
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2: Changes filter state
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("ALL")

  // Step 3: Confirmation state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatusText, setSubmitStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isMountedRef = useRef(true)

  const cleanupTransientMedia = async (mediaId: string) => {
    try {
      await graphqlClient.deleteContentMedia(mediaId)
    } catch {
      // Best-effort cleanup
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (!isPublishedRef.current) {
        for (const id of Array.from(transientMediaIdsRef.current)) {
          cleanupTransientMedia(id)
        }
      }
    }
  }, [])

  const handleCloseModal = async () => {
    if (!isPublishedRef.current) {
      for (const id of Array.from(transientMediaIdsRef.current)) {
        if (id !== currentDraft.coverMediaId) {
          cleanupTransientMedia(id)
        }
      }
    }
    onClose()
  }

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
        // If previous cover was transient, clean it up before switching to new one
        if (
          coverMediaId &&
          coverMediaId !== initialCoverRef.current.id &&
          transientMediaIdsRef.current.has(coverMediaId)
        ) {
          cleanupTransientMedia(coverMediaId)
          transientMediaIdsRef.current.delete(coverMediaId)
        }

        transientMediaIdsRef.current.add(uploaded.id)
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
    if (
      coverMediaId &&
      coverMediaId !== initialCoverRef.current.id &&
      transientMediaIdsRef.current.has(coverMediaId)
    ) {
      cleanupTransientMedia(coverMediaId)
      transientMediaIdsRef.current.delete(coverMediaId)
    }
    setCover(null)
    setCoverMediaId(null)
    setCoverUploadError(null)
  }

  // Navigate to Step 2 with validation, metadata persistence & fresh overview request
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

    try {
      await gameApi.updateGameDraftMetadata({
        version: trimmedVersion,
        notes: notes.trim() || null,
        coverMediaId: coverMediaId || null,
      })

      // Fetch fresh live overview
      const overview = await gameApi.getAdminGameOverview()
      if (!overview.draftRelease) {
        throw new Error("No se encontró ningún borrador activo.")
      }

      if (isMountedRef.current) {
        setCurrentDraft(overview.draftRelease)
        setCurrentChanges(overview.changes || null)
        setCurrentReadiness(overview.readiness || null)
        setCurrentFingerprint(overview.draftFingerprint || null)
        setCurrentStep(2)
      }
    } catch (err: any) {
      // Compensate: If newly uploaded transient cover failed to persist, clean it up
      if (
        coverMediaId &&
        coverMediaId !== initialCoverRef.current.id &&
        transientMediaIdsRef.current.has(coverMediaId)
      ) {
        await cleanupTransientMedia(coverMediaId)
        transientMediaIdsRef.current.delete(coverMediaId)
        if (isMountedRef.current) {
          setCover(initialCoverRef.current.cover)
          setCoverMediaId(initialCoverRef.current.id)
        }
      }
      if (isMountedRef.current) {
        setError(err.message || "Error al guardar los detalles del borrador.")
      }
    }
  }

  // Navigate to Step 3 with fresh overview request
  const handleGoToStep3 = async () => {
    setError(null)
    try {
      const overview = await gameApi.getAdminGameOverview()
      if (!overview.draftRelease) {
        throw new Error("No se encontró ningún borrador activo.")
      }

      if (isMountedRef.current) {
        setCurrentDraft(overview.draftRelease)
        setCurrentChanges(overview.changes || null)
        setCurrentReadiness(overview.readiness || null)
        setCurrentFingerprint(overview.draftFingerprint || null)
        setCurrentStep(3)
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "No se pudo actualizar el estado del borrador para la confirmación.")
      }
    }
  }

  // Changed files from live draft
  const changedFiles = currentDraft.files.filter(
    (f) => f.changeStatus && f.changeStatus !== "UNCHANGED",
  )

  const filteredFiles = changedFiles.filter((f) => {
    if (changeFilter === "ALL") return true
    return f.changeStatus === changeFilter
  })

  const isReady = currentReadiness ? currentReadiness.isReady : currentDraft.files.length > 0

  // Final Publication Handler with review fingerprint & post-publication verification
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setError(null)
    const trimmedVersion = version.trim()

    if (!trimmedVersion || !validateSemVer(trimmedVersion)) {
      setError("Formato de versión inválido. Debe ser SemVer (ejemplo: 1.0.1).")
      return
    }

    if (currentReadiness && !currentReadiness.isReady) {
      const issueMsg = currentReadiness.issues.length
        ? currentReadiness.issues.join(". ")
        : "El borrador no está listo para publicar."
      setError(`No se puede publicar la actualización: ${issueMsg}`)
      return
    }

    setIsSubmitting(true)

    try {
      // 1. Publish Game Release via authoritative GraphQL mutation
      setSubmitStatusText("Publicando actualización oficial...")
      const published = await gameApi.publishGameRelease({
        version: trimmedVersion,
        notes: notes.trim() || null,
        coverMediaId: coverMediaId || null,
        expectedDraftFingerprint: currentFingerprint || undefined,
      })

      // 2. Post-publication verification
      setSubmitStatusText("Verificando publicación en vivo...")
      try {
        const verifyOverview = await gameApi.getAdminGameOverview()
        if (
          verifyOverview.publishedRelease?.version !== trimmedVersion ||
          verifyOverview.draftRelease?.id === currentDraft.id
        ) {
          throw new Error("Verification mismatch")
        }
      } catch {
        setError(
          "La publicación fue procesada, pero no pudo verificarse el estado activo. Recarga la página antes de intentar nuevamente.",
        )
        return
      }

      isPublishedRef.current = true
      onPublished(trimmedVersion, published.files.length)

      // 3. Fetch server changes plan without converting failures to error
      setSubmitStatusText("Comprobando cambios en el servidor...")
      let fetchedPlan: ServerReleaseSyncPlan | null = null
      let planFetchFailed = false
      try {
        fetchedPlan = await serverContentApi.getServerReleaseSyncPlan()
      } catch {
        planFetchFailed = true
      }

      if (isMountedRef.current) {
        setPostPublishState({
          publishedVersion: trimmedVersion,
          fileCount: published.files.length,
          plan: fetchedPlan,
          planFetchFailed,
        })
      }
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
      data-testid="publish-release-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) handleCloseModal()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "680px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Modal Header & Wizard Step Bar */}
        <div
          style={{
            padding: "20px 24px 16px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            backgroundColor: tokens.bgCardInner,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: postPublishState ? "0" : "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  backgroundColor: "rgba(62, 196, 192, 0.15)",
                  color: "#3ec4c0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {postPublishState ? <IconCheck size={20} /> : <IconRocket size={20} />}
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: "700",
                  color: tokens.textPrimary,
                }}
              >
                {postPublishState ? "Actualización publicada" : "Publicar actualización oficial"}
              </h2>
            </div>
            <button
              onClick={handleCloseModal}
              disabled={isSubmitting}
              style={{
                background: "none",
                border: "none",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                color: tokens.textMuted,
                display: "flex",
                padding: "4px",
              }}
            >
              <IconCross size={18} />
            </button>
          </div>

          {/* Steps Indicator (hidden in post-publish state) */}
          {!postPublishState && (
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
          )}
        </div>

        {/* Modal Scrollable Body */}
        {postPublishState ? (
          <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "12px",
                  backgroundColor: "rgba(34, 197, 94, 0.15)",
                  color: "#22c55e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <IconCheck size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                  Actualización publicada
                </h3>
                <div style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "2px" }}>
                  La versión v{postPublishState.publishedVersion} ya está disponible para los jugadores.
                </div>
              </div>
            </div>

            {postPublishState.planFetchFailed ? (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "10px",
                  backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#f8fafc",
                  border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                  fontSize: "13px",
                  color: isDark ? "#94a3b8" : "#64748b",
                }}
              >
                No se pudo comprobar el estado del servidor en este momento.
              </div>
            ) : postPublishState.plan?.isPending ? (
              <div
                data-testid="post-publish-server-changes-card"
                style={{
                  padding: "16px 18px",
                  borderRadius: "14px",
                  backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                  border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                    Cambios pendientes en el servidor
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: isDark ? "#60a5fa" : "#2563eb" }}>
                    {postPublishState.plan.summary.toInstall} para instalar · {postPublishState.plan.summary.toUpdate} para actualizar
                    {postPublishState.plan.summary.toRemove > 0 && ` · ${postPublishState.plan.summary.toRemove} para eliminar`}
                  </div>
                </div>

                <div style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  Esta actualización también incluye cambios que deben aplicarse al servidor.
                </div>

                {/* Server Status Indicator using canApply authority */}
                {postPublishState.plan.canApply ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "#22c55e",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(34, 197, 94, 0.1)",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#22c55e", display: "inline-block", flexShrink: 0 }} />
                    <div>
                      <strong>Servidor apagado y listo.</strong> Puedes revisar y aplicar los cambios ahora.
                    </div>
                  </div>
                ) : postPublishState.plan.serverStatus === "DISCONNECTED" || postPublishState.plan.serverStatus === "UNKNOWN" ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "#ef4444",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(239, 68, 68, 0.1)",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#ef4444", display: "inline-block", flexShrink: 0 }} />
                    <div>
                      <strong>{postPublishState.plan.blockReason || "El servidor no está disponible."}</strong> La actualización ya fue publicada. Los cambios del servidor quedarán pendientes hasta que vuelva a estar disponible.
                    </div>
                  </div>
                ) : postPublishState.plan.serverStatus === "OFFLINE" ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "#f59e0b",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(245, 158, 11, 0.1)",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#f59e0b", display: "inline-block", flexShrink: 0 }} />
                    <div>
                      <strong>{postPublishState.plan.blockReason || "No se pudieron verificar los archivos del servidor."}</strong>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "#f59e0b",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(245, 158, 11, 0.1)",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#f59e0b", display: "inline-block", flexShrink: 0 }} />
                    <div>
                      <strong>{postPublishState.plan.blockReason || "Apaga el servidor antes de aplicar los cambios."}</strong>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Post-publish Actions */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                paddingTop: "16px",
                borderTop: `1px solid ${tokens.borderSubtle}`,
              }}
            >
              <button
                type="button"
                data-testid="button-post-publish-close"
                onClick={onClose}
                className="launcher-btn-secondary"
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  fontSize: "14px",
                }}
              >
                Cerrar
              </button>

              {postPublishState.plan?.isPending && (
                <button
                  type="button"
                  data-testid="button-post-publish-review-server"
                  onClick={() => {
                    if (onReviewServerChanges && postPublishState.plan) {
                      onReviewServerChanges(postPublishState.plan)
                    } else {
                      onClose()
                    }
                  }}
                  className="launcher-btn-primary"
                  style={{
                    padding: "10px 22px",
                    borderRadius: "12px",
                    fontSize: "14px",
                  }}
                >
                  {postPublishState.plan.canApply
                    ? "Revisar cambios del servidor"
                    : "Ver cambios pendientes"}
                </button>
              )}
            </div>
          </div>
        ) : (
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
                      {currentDraft.minecraftVersion} <span style={{ fontSize: "11px", fontWeight: "500", color: isDark ? "#64748b" : "#94a3b8" }}>(Borrador)</span>
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase" }}>
                      NeoForge
                    </span>
                    <div style={{ fontSize: "15px", fontWeight: "700", color: isDark ? "#f1f5f9" : "#0f172a", marginTop: "2px" }}>
                      {currentDraft.neoForgeVersion} <span style={{ fontSize: "11px", fontWeight: "500", color: isDark ? "#64748b" : "#94a3b8" }}>(Borrador)</span>
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
                      <div style={{ marginBottom: "10px", maxHeight: "220px", display: "flex", alignItems: "center", gap: "12px" }}>
                        {cover.mediaType === "VIDEO" ? (
                          <video
                            src={cover.url}
                            controls
                            style={{ width: "48px", height: "48px", borderRadius: "6px", objectFit: "cover" }}
                          />
                        ) : (
                          <img
                            src={cover.url}
                            alt="Portada de actualización"
                            style={{ width: "48px", height: "48px", borderRadius: "6px", objectFit: "cover" }}
                          />
                        )}
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                            {cover.mediaType === "IMAGE" ? "Imagen de portada" : `VIDEO (${cover.mimeType})`}
                          </div>
                          <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                            {cover.mimeType} • {formatBytesToHuman(cover.sizeBytes)}
                          </div>
                        </div>
                      </div>

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
                            Imágenes (PNG, JPEG, WebP) o Videos (MP4, WebM)
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
                    onClick={handleCloseModal}
                    className="launcher-btn-secondary"
                    style={{
                      padding: "10px 18px",
                      borderRadius: "12px",
                      fontSize: "14px",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isCoverUploading}
                    className="launcher-btn-primary"
                    style={{
                      padding: "10px 22px",
                      borderRadius: "12px",
                      fontSize: "14px",
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
                {currentChanges && (
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
                        +{currentChanges.added} añadidos
                      </span>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: "#38bdf8" }}>
                        ↑ {currentChanges.updated} actualizados
                      </span>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: "#ef4444" }}>
                        − {currentChanges.removed} eliminados
                      </span>
                      <span style={{ fontSize: "14px", color: isDark ? "#94a3b8" : "#64748b" }}>
                        = {currentChanges.unchanged} sin cambios
                      </span>
                    </div>
                  </div>
                )}

                {/* Filter Tabs */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {(
                    [
                      { key: "ALL", label: `Todos los cambios (${changedFiles.length})` },
                      { key: "ADDED", label: `Añadidos (+${currentChanges?.added || 0})` },
                      { key: "UPDATED", label: `Actualizados (↑${currentChanges?.updated || 0})` },
                      { key: "REMOVED", label: `Eliminados (−${currentChanges?.removed || 0})` },
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
                {currentChanges && currentChanges.unchanged > 0 && (
                  <div style={{ fontSize: "12px", color: tokens.textSecondary, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <IconCheck size={14} style={{ color: "#22c55e" }} />
                    <span>{currentChanges.unchanged} archivos permanecen sin cambios respecto a la versión oficial anterior.</span>
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
                    className="launcher-btn-secondary"
                    style={{
                      padding: "10px 18px",
                      borderRadius: "12px",
                      fontSize: "14px",
                    }}
                  >
                    ← Volver a detalles
                  </button>
                  <button
                    type="button"
                    onClick={handleGoToStep3}
                    className="launcher-btn-primary"
                    style={{
                      padding: "10px 22px",
                      borderRadius: "12px",
                      fontSize: "14px",
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
                        MC {currentDraft.minecraftVersion} • NeoForge {currentDraft.neoForgeVersion}
                      </div>
                    </div>
                  </div>

                  {/* Cover & Notes Summary */}
                  <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
                    {cover ? (
                      <div style={{ width: "48px", height: "48px", borderRadius: "8px", overflow: "hidden", flexShrink: 0 }}>
                        {cover.mediaType === "VIDEO" ? (
                          <div style={{ width: "100%", height: "100%", backgroundColor: "#334155", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "10px" }}>
                            VIDEO
                          </div>
                        ) : (
                          <img src={cover.url} alt="Cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                  {currentChanges && (
                    <div
                      style={{
                        display: "flex",
                        gap: "12px",
                        paddingTop: "10px",
                        borderTop: `1px solid ${tokens.borderSubtle}`,
                        fontSize: "12px",
                      }}
                    >
                      <span style={{ color: "#22c55e", fontWeight: "600" }}>+{currentChanges.added} añadidos</span>
                      <span style={{ color: isDark ? "#3ec4c0" : "#0284c7", fontWeight: "600" }}>↑ {currentChanges.updated} actualizados</span>
                      <span style={{ color: "#ef4444", fontWeight: "600" }}>− {currentChanges.removed} eliminados</span>
                      <span style={{ color: tokens.textSecondary }}>{currentChanges.total} archivos totales</span>
                    </div>
                  )}
                </div>

                {/* Blocking Issues Alert if any */}
                {currentReadiness?.issues && currentReadiness.issues.length > 0 && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: "12px",
                      backgroundColor: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      color: "#ef4444",
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <IconAlertCircle size={16} />
                    <span>{currentReadiness.issues.join(". ")}</span>
                  </div>
                )}

                {/* Scope Notice */}
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "12px",
                    backgroundColor: isDark ? "rgba(62, 196, 192, 0.08)" : "rgba(62, 196, 192, 0.05)",
                    border: `1px solid ${isDark ? "rgba(62, 196, 192, 0.2)" : "rgba(12, 110, 107, 0.2)"}`,
                    fontSize: "13px",
                    color: isDark ? "#3ec4c0" : "#0c6e6b",
                    lineHeight: "1.5",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                  }}
                >
                  <IconAlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    Publicar convierte el borrador en la versión oficial del modpack para los jugadores. Los archivos en el servidor físico se mantendrán hasta que decidas aplicar los cambios correspondientes.
                  </div>
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
                    className="launcher-btn-secondary"
                    style={{
                      padding: "10px 18px",
                      borderRadius: "12px",
                      fontSize: "14px",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    ← Volver a cambios
                  </button>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      disabled={isSubmitting}
                      className="launcher-btn-secondary"
                      style={{
                        padding: "10px 18px",
                        borderRadius: "12px",
                        fontSize: "14px",
                        cursor: isSubmitting ? "not-allowed" : "pointer",
                      }}
                    >
                      Cancelar
                    </button>

                    <button
                      type="submit"
                      disabled={isSubmitting || !isReady}
                      className="launcher-btn-primary"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 24px",
                        borderRadius: "12px",
                        fontSize: "14px",
                        fontWeight: "700",
                        cursor: isSubmitting || !isReady ? "not-allowed" : "pointer",
                        opacity: isSubmitting || !isReady ? 0.6 : 1,
                      }}
                    >
                      {isSubmitting ? <IconSpinner size={16} /> : <IconRocket size={16} />}
                      <span>Publicar actualización oficial</span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
