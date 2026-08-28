import React, { useState } from "react"
import type { ThemeMode } from "../../types"
import { IconCross, IconTrash, IconSpinner, IconAlertCircle } from "../../theme/icons"

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
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
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
          backgroundColor: isDark ? "#0f172a" : "#ffffff",
          borderRadius: "16px",
          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: isDark ? "#0b1120" : "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <IconTrash style={{ width: 20, height: 20, color: "#ef4444" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: isDark ? "#f8fafc" : "#0f172a" }}>
              {isSingle ? "Eliminar Elemento" : `Eliminar ${count} Elementos`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: isDark ? "#94a3b8" : "#64748b",
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
                backgroundColor: isDark ? "rgba(239, 68, 68, 0.15)" : "#fee2e2",
                border: "1px solid #ef4444",
                borderRadius: "8px",
                color: isDark ? "#fca5a5" : "#991b1b",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: isDark ? "#cbd5e1" : "#334155", lineHeight: "1.5" }}>
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
                backgroundColor: isDark ? "#1e293b" : "#f1f5f9",
                borderRadius: "8px",
                marginBottom: "20px",
                fontSize: "12px",
                fontFamily: "monospace",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
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
              style={{
                padding: "8px 16px",
                backgroundColor: "transparent",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                borderRadius: "8px",
                color: isDark ? "#cbd5e1" : "#475569",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isDeleting}
              style={{
                padding: "8px 20px",
                backgroundColor: "#ef4444",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: isDeleting ? "not-allowed" : "pointer",
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
