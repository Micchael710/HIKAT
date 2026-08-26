import React, { useState } from "react"
import type { ThemeMode, GameRelease, GameDraftChanges, GameDraftReadiness } from "../../types"
import { validateSemVer, suggestNextPatchVersion } from "@hikat/shared"
import { gameApi } from "../../services/graphqlClient"
import { IconCross, IconRocket, IconSpinner, IconCheck, IconWarning } from "../../theme/icons"

interface PublishReleaseModalProps {
  theme: ThemeMode
  draftRelease: GameRelease
  publishedRelease?: GameRelease | null
  changes?: GameDraftChanges | null
  readiness?: GameDraftReadiness | null
  onClose: () => void
  onPublished: (version: string, fileCount: number) => void
}

export default function PublishReleaseModal({
  theme,
  draftRelease,
  publishedRelease,
  changes,
  readiness,
  onClose,
  onPublished,
}: PublishReleaseModalProps) {
  const isDark = theme === "dark"

  const suggestedVersion = suggestNextPatchVersion(publishedRelease?.version)
  const [version, setVersion] = useState(suggestedVersion)
  const [notes, setNotes] = useState("")

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReady = readiness ? readiness.isReady : draftRelease.files.length > 0

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedVersion = version.trim()
    if (!trimmedVersion) {
      setError("La versión es obligatoria.")
      return
    }

    if (!validateSemVer(trimmedVersion)) {
      setError("Formato de versión inválido. Debe ser SemVer (ejemplo: 1.0.1).")
      return
    }

    if (readiness && !readiness.isReady && readiness.issues.length > 0) {
      setError(`Corrige los siguientes problemas antes de publicar: ${readiness.issues.join(". ")}`)
      return
    }

    setIsSubmitting(true)
    try {
      // 1. Execute publication mutation
      const published = await gameApi.publishGameRelease({
        version: trimmedVersion,
        notes: notes.trim() || undefined,
      })

      // 2. Post-publication verification
      const verifyOverview = await gameApi.getAdminGameOverview()
      if (verifyOverview.publishedRelease?.version !== trimmedVersion) {
        throw new Error(
          "La actualización se procesó, pero no pudimos verificar la versión activa. Recarga la página para comprobar el estado.",
        )
      }

      onPublished(trimmedVersion, published.files.length)
      onClose()
    } catch (err: any) {
      setError(err.message || "Error al publicar la actualización.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(5px)",
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
          borderRadius: "16px",
          width: "100%",
          maxWidth: "520px",
          overflow: "hidden",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
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
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Publicar actualización oficial
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: isDark ? "#94a3b8" : "#64748b",
              display: "flex",
              padding: "4px",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <form onSubmit={handlePublish} style={{ padding: "24px" }}>
          {error && (
            <div
              style={{
                marginBottom: "20px",
                padding: "10px 14px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          {/* Change Summary Card */}
          {changes && (
            <div
              style={{
                marginBottom: "20px",
                padding: "14px 16px",
                borderRadius: "10px",
                backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  color: isDark ? "#94a3b8" : "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "8px",
                }}
              >
                Resumen de cambios
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#22c55e" }}>
                  +{changes.added} añadidos
                </span>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#38bdf8" }}>
                  ↑ {changes.updated} actualizados
                </span>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#ef4444" }}>
                  − {changes.removed} eliminados
                </span>
                <span style={{ fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  = {changes.unchanged} sin cambios
                </span>
              </div>
            </div>
          )}

          {/* Version Input */}
          <div style={{ marginBottom: "18px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: isDark ? "#cbd5e1" : "#334155",
                marginBottom: "6px",
              }}
            >
              Versión a publicar
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="Ej. 1.0.1"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isDark ? "#0f172a" : "#ffffff",
                color: isDark ? "#f1f5f9" : "#0f172a",
                fontSize: "14px",
                fontWeight: "600",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Release Notes */}
          <div style={{ marginBottom: "20px" }}>
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
              placeholder="Descripción de los cambios o novedades para los jugadores..."
              rows={3}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isDark ? "#0f172a" : "#ffffff",
                color: isDark ? "#f1f5f9" : "#0f172a",
                fontSize: "13px",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
          </div>

          {/* Readiness Status Indicator */}
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "8px",
              backgroundColor: isReady ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
              border: `1px solid ${isReady ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "24px",
            }}
          >
            {isReady ? (
              <>
                <div style={{ color: "#22c55e", display: "flex" }}>
                  <IconCheck size={18} />
                </div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#22c55e" }}>
                  ✓ Lista para publicar inmediatamente
                </div>
              </>
            ) : (
              <>
                <div style={{ color: "#ef4444", display: "flex" }}>
                  <IconWarning size={18} />
                </div>
                <div style={{ fontSize: "13px", color: "#ef4444" }}>
                  {readiness?.issues.length
                    ? readiness.issues.join(". ")
                    : "No se puede publicar en este momento."}
                </div>
              </>
            )}
          </div>

          {/* Footer Actions */}
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
              disabled={isSubmitting || !isReady}
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
                cursor: isSubmitting || !isReady ? "not-allowed" : "pointer",
                opacity: isSubmitting || !isReady ? 0.6 : 1,
              }}
            >
              {isSubmitting && <IconSpinner size={16} />}
              Publicar actualización
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
