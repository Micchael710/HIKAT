import React, { useState } from "react"
import type { ThemeMode } from "../../types"
import { validateSemVer, suggestNextPatchVersion } from "@hikat/shared"
import { gameApi } from "../../services/graphqlClient"
import { IconCross, IconSpinner, IconGamepad } from "../../theme/icons"

interface PublishReleaseModalProps {
  theme: ThemeMode
  currentPublishedVersion?: string | null
  filesCount: number
  onClose: () => void
  onPublished: () => void
}

export default function PublishReleaseModal({
  theme,
  currentPublishedVersion,
  filesCount,
  onClose,
  onPublished,
}: PublishReleaseModalProps) {
  const isDark = theme === "dark"
  const defaultVersion = suggestNextPatchVersion(currentPublishedVersion)

  const [version, setVersion] = useState(defaultVersion)
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedVersion = version.trim()
    if (!trimmedVersion) {
      setError("La versión es obligatoria.")
      return
    }

    if (!validateSemVer(trimmedVersion)) {
      setError("Formato de versión inválido. Debe seguir el formato SemVer (ejemplo: 1.4.3).")
      return
    }

    setIsSubmitting(true)
    try {
      await gameApi.publishGameRelease({
        version: trimmedVersion,
        notes: notes.trim() || undefined,
      })
      onPublished()
      onClose()
    } catch (err: any) {
      setError(err.message || "Error al publicar la actualización.")
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
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
          maxWidth: "480px",
          overflow: "hidden",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
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
              <IconGamepad size={20} />
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Publicar Actualización
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: "24px" }}>
          {error && (
            <div
              style={{
                marginBottom: "16px",
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

          <p
            style={{
              margin: "0 0 16px 0",
              fontSize: "14px",
              color: isDark ? "#cbd5e1" : "#334155",
              lineHeight: "1.5",
            }}
          >
            Se publicará la nueva versión con <strong>{filesCount} archivo(s) / mod(s)</strong>. Todos los jugadores conectados al lanzador se sincronizarán automáticamente con esta versión oficial.
          </p>

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
              Número de versión
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="Ej. 1.4.3"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isDark ? "#0f172a" : "#ffffff",
                color: isDark ? "#f1f5f9" : "#0f172a",
                fontSize: "14px",
                boxSizing: "border-box",
                fontWeight: "600",
              }}
            />
            {currentPublishedVersion && (
              <span style={{ display: "block", marginTop: "4px", fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                Versión actual publicada: v{currentPublishedVersion}
              </span>
            )}
          </div>

          {/* Notes / Changelog */}
          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: isDark ? "#cbd5e1" : "#334155",
                marginBottom: "6px",
              }}
            >
              Notas de la actualización (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Describe brevemente los mods añadidos o corregidos..."
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
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Footer Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
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
              disabled={isSubmitting}
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
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting && <IconSpinner size={16} />}
              Publicar ahora
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
