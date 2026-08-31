import React, { useState } from "react"
import type { ThemeMode } from "../../types"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconFolder, IconSpinner } from "../../theme/icons"

interface NewFolderModalProps {
  theme: ThemeMode
  currentPath: string
  onClose: () => void
  onSubmit: (folderName: string) => Promise<void>
}

export default function NewFolderModal({
  theme,
  currentPath,
  onClose,
  onSubmit,
}: NewFolderModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [folderName, setFolderName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = folderName.trim()
    if (!trimmed) {
      setError("El nombre de la carpeta no puede estar vacío.")
      return
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError("El nombre de la carpeta no puede contener barras.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al crear la carpeta.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const targetPreview = currentPath ? `${currentPath}/${folderName.trim() || "..."}` : folderName.trim() || "..."

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "20px",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          backgroundColor: tokens.bgCard,
          borderRadius: "18px",
          border: `1px solid ${tokens.borderSubtle}`,
          boxShadow: tokens.cardShadowLg,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: tokens.bgCardInner,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <IconFolder style={{ width: 20, height: 20, color: "#3b82f6" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: tokens.textPrimary }}>
              Nueva carpeta
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: tokens.textMuted,
              cursor: "pointer",
              padding: "4px",
              display: "flex",
            }}
          >
            <IconCross style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
          {error && (
            <div
              style={{
                padding: "10px 14px",
                marginBottom: "16px",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: "10px",
                color: "#ef4444",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                fontWeight: "600",
                color: tokens.textSecondary,
              }}
            >
              Nombre de la carpeta
            </label>
            <input
              type="text"
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="ejemplo: custom_config"
              className="launcher-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div
            style={{
              padding: "10px 14px",
              backgroundColor: tokens.bgCardInner,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: "10px",
              marginBottom: "20px",
              fontSize: "12px",
              color: tokens.textSecondary,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            <strong>Ruta de destino:</strong> {targetPreview}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              className="launcher-btn-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !folderName.trim()}
              className="launcher-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isSubmitting && <IconSpinner style={{ width: 14, height: 14 }} />}
              <span>Crear carpeta</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
