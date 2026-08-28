import React, { useState } from "react"
import type { ThemeMode, SyncPolicy } from "../../types"
import { IconCross, IconSpinner, IconCheck } from "../../theme/icons"

interface PolicyModalProps {
  theme: ThemeMode
  path: string
  isDirectory: boolean
  currentExplicitPolicy: SyncPolicy | null
  currentEffectivePolicy: SyncPolicy
  onClose: () => void
  onSubmit: (policy: SyncPolicy | null) => Promise<void>
}

export default function PolicyModal({
  theme,
  path,
  isDirectory,
  currentExplicitPolicy,
  currentEffectivePolicy,
  onClose,
  onSubmit,
}: PolicyModalProps) {
  const isDark = theme === "dark"
  const [selectedPolicy, setSelectedPolicy] = useState<SyncPolicy | "INHERIT">(
    currentExplicitPolicy === null ? "INHERIT" : currentExplicitPolicy,
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const explicitVal = selectedPolicy === "INHERIT" ? null : selectedPolicy
      await onSubmit(explicitVal)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al configurar la política de sincronización.")
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
          maxWidth: "520px",
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
            <span style={{ fontSize: "20px" }}>🛡️</span>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: isDark ? "#f8fafc" : "#0f172a" }}>
              Política de Sincronización
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

          <div
            style={{
              padding: "12px 16px",
              backgroundColor: isDark ? "#1e293b" : "#f8fafc",
              border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "8px",
              marginBottom: "16px",
              fontSize: "13px",
            }}
          >
            <div style={{ color: isDark ? "#94a3b8" : "#64748b", marginBottom: "4px" }}>
              {isDirectory ? "Carpeta seleccionada:" : "Archivo seleccionado:"}
            </div>
            <div style={{ fontWeight: "600", color: isDark ? "#f8fafc" : "#0f172a", fontFamily: "monospace" }}>
              {path}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
            {/* INHERIT OPTION */}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: `1px solid ${
                  selectedPolicy === "INHERIT"
                    ? "#3b82f6"
                    : isDark
                    ? "#334155"
                    : "#e2e8f0"
                }`,
                backgroundColor:
                  selectedPolicy === "INHERIT"
                    ? isDark
                      ? "rgba(59, 130, 246, 0.1)"
                      : "#eff6ff"
                    : "transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <input
                type="radio"
                name="policy"
                value="INHERIT"
                checked={selectedPolicy === "INHERIT"}
                onChange={() => setSelectedPolicy("INHERIT")}
                style={{ marginTop: "3px" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#f8fafc" : "#0f172a" }}>
                  🔄 Heredar de la carpeta superior (por defecto)
                </div>
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "2px" }}>
                  Hereda la política de la carpeta padre o del estándar de la raíz ({currentEffectivePolicy === "NO_MODIFICABLE" ? "Protegido" : "Personalizable"}).
                </div>
              </div>
            </label>

            {/* NO_MODIFICABLE OPTION */}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: `1px solid ${
                  selectedPolicy === "NO_MODIFICABLE"
                    ? "#ef4444"
                    : isDark
                    ? "#334155"
                    : "#e2e8f0"
                }`,
                backgroundColor:
                  selectedPolicy === "NO_MODIFICABLE"
                    ? isDark
                      ? "rgba(239, 68, 68, 0.1)"
                      : "#fef2f2"
                    : "transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <input
                type="radio"
                name="policy"
                value="NO_MODIFICABLE"
                checked={selectedPolicy === "NO_MODIFICABLE"}
                onChange={() => setSelectedPolicy("NO_MODIFICABLE")}
                style={{ marginTop: "3px" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#f87171" : "#dc2626" }}>
                  🔒 Override: Protegido (NO_MODIFICABLE)
                </div>
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "2px" }}>
                  El Launcher sobreescribe y sincroniza obligatoriamente este contenido. El jugador no puede alterarlo.
                </div>
              </div>
            </label>

            {/* MODIFICABLE OPTION */}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: `1px solid ${
                  selectedPolicy === "MODIFICABLE"
                    ? "#10b981"
                    : isDark
                    ? "#334155"
                    : "#e2e8f0"
                }`,
                backgroundColor:
                  selectedPolicy === "MODIFICABLE"
                    ? isDark
                      ? "rgba(16, 185, 129, 0.1)"
                      : "#f0fdf4"
                    : "transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <input
                type="radio"
                name="policy"
                value="MODIFICABLE"
                checked={selectedPolicy === "MODIFICABLE"}
                onChange={() => setSelectedPolicy("MODIFICABLE")}
                style={{ marginTop: "3px" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "600", color: isDark ? "#34d399" : "#059669" }}>
                  ✏️ Override: Personalizable (MODIFICABLE)
                </div>
                <div style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b", marginTop: "2px" }}>
                  Se descarga una sola vez como plantilla inicial. El Launcher preservará las modificaciones locales del jugador.
                </div>
              </div>
            </label>
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
              disabled={isSubmitting}
              style={{
                padding: "8px 20px",
                backgroundColor: "#3b82f6",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isSubmitting && <IconSpinner style={{ width: 14, height: 14 }} />}
              <span>Aplicar Política</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
