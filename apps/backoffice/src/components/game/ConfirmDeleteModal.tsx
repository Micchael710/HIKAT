import React, { useState } from "react"
import type { ThemeMode } from "../../types"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconTrash, IconSpinner } from "../../theme/icons"

interface ConfirmDeleteModalProps {
  theme: ThemeMode
  paths: string[]
  onClose: () => void
  onConfirm: () => Promise<void>
}

export default function ConfirmDeleteModal({
  theme,
  paths,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = paths.length
  const isSingle = count === 1

  const handleConfirm = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al eliminar.")
    } finally {
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
        zIndex: 1000,
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
          maxWidth: "480px",
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
            <IconTrash style={{ width: 20, height: 20, color: "#ef4444" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: tokens.textPrimary }}>
              {isSingle ? "Eliminar elemento" : `Eliminar ${count} elementos`}
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

        <div style={{ padding: "20px" }}>
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

          <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: tokens.textSecondary, lineHeight: "1.5" }}>
            {isSingle ? (
              <>
                ¿Estás seguro de que deseas eliminar <strong>{paths[0]}</strong>? Si es una carpeta, se eliminarán todos los archivos y subcarpetas que contiene.
              </>
            ) : (
              <>
                ¿Estás seguro de que deseas eliminar los siguientes <strong>{count}</strong> elementos seleccionados de la actualización en preparación?
              </>
            )}
          </p>

          {count > 1 && (
            <div
              style={{
                maxHeight: "150px",
                overflowY: "auto",
                padding: "10px 14px",
                backgroundColor: tokens.bgCardInner,
                borderRadius: "10px",
                border: `1px solid ${tokens.borderSubtle}`,
                marginBottom: "20px",
                fontSize: "12px",
                fontFamily: "monospace",
                color: tokens.textSecondary,
              }}
              className="custom-scroll"
            >
              {paths.map((p) => (
                <div key={p} style={{ padding: "2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  • {p}
                </div>
              ))}
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
              onClick={handleConfirm}
              disabled={isDeleting}
              className="launcher-btn-danger"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isDeleting && <IconSpinner style={{ width: 14, height: 14 }} />}
              <span>Eliminar definitivamente</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
