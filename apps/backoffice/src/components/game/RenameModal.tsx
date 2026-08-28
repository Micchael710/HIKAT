import React, { useState } from "react"
import type { ThemeMode } from "../../types"
import { IconCross, IconEdit, IconSpinner } from "../../theme/icons"

interface RenameModalProps {
  theme: ThemeMode
  oldName: string
  isDirectory: boolean
  onClose: () => void
  onSubmit: (newName: string) => Promise<void>
}

export default function RenameModal({
  theme,
  oldName,
  isDirectory,
  onClose,
  onSubmit,
}: RenameModalProps) {
  const isDark = theme === "dark"
  const [newName, setNewName] = useState(oldName)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) {
      setError("El nuevo nombre no puede estar vacío.")
      return
    }
    if (trimmed === oldName) {
      onClose()
      return
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError("El nombre no puede contener barras.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al renombrar.")
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
          maxWidth: "460px",
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
            <IconEdit style={{ width: 20, height: 20, color: "#3b82f6" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: isDark ? "#f8fafc" : "#0f172a" }}>
              Renombrar {isDirectory ? "Carpeta" : "Archivo"}
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

        <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
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

          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                fontWeight: "500",
                color: isDark ? "#cbd5e1" : "#334155",
              }}
            >
              Nuevo nombre
            </label>
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                backgroundColor: isDark ? "#1e293b" : "#f8fafc",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                borderRadius: "8px",
                color: isDark ? "#f8fafc" : "#0f172a",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

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
              type="submit"
              disabled={isSubmitting || !newName.trim()}
              style={{
                padding: "8px 20px",
                backgroundColor: "#3b82f6",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: isSubmitting || !newName.trim() ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isSubmitting && <IconSpinner style={{ width: 14, height: 14 }} />}
              <span>Guardar</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
