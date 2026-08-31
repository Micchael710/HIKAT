import React, { useState } from "react"
import type { ThemeMode, AdminGameFile } from "../../types"
import { gameApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
import { IconTrash, IconSpinner } from "../../theme/icons"

interface DeleteGameFileModalProps {
  theme: ThemeMode
  file: AdminGameFile
  onClose: () => void
  onDeleted: () => void
}

export default function DeleteGameFileModal({
  theme,
  file,
  onClose,
  onDeleted,
}: DeleteGameFileModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await gameApi.removeGameFile(file.id)
      onDeleted()
      onClose()
    } catch (err: any) {
      setError(err.message || "No se pudo quitar el archivo.")
      setIsDeleting(false)
    }
  }

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
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "420px",
          padding: "24px",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconTrash size={20} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: "700",
                color: tokens.textPrimary,
              }}
            >
              Quitar archivo
            </h3>
            <p
              style={{
                margin: "2px 0 0 0",
                fontSize: "13px",
                color: tokens.textSecondary,
              }}
            >
              Se quitará de la próxima actualización.
            </p>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 20px 0",
            fontSize: "14px",
            color: tokens.textSecondary,
            lineHeight: "1.5",
          }}
        >
          ¿Deseas quitar <strong>{file.name}</strong> ({file.logicalPath}) del borrador de actualización?
        </p>

        {error && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              borderRadius: "10px",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              color: "#ef4444",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            onClick={onClose}
            className="launcher-btn-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="launcher-btn-danger"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {isDeleting && <IconSpinner size={16} />}
            Quitar del borrador
          </button>
        </div>
      </div>
    </div>
  )
}
