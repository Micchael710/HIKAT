import React, { useState } from "react"
import type { ThemeMode, SyncPolicy } from "../../types"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconSpinner, IconLock, IconUnlock, IconRefresh, IconEdit } from "../../theme/icons"

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
  const tokens = getThemeTokens(theme)
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
          maxWidth: "520px",
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
            <IconLock style={{ width: 20, height: 20, color: "#3ec4c0" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: tokens.textPrimary }}>
              Política de sincronización
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

          <div
            style={{
              padding: "12px 16px",
              backgroundColor: tokens.bgCardInner,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: "10px",
              marginBottom: "16px",
              fontSize: "13px",
            }}
          >
            <div style={{ color: tokens.textSecondary, marginBottom: "4px" }}>
              {isDirectory ? "Carpeta seleccionada:" : "Archivo seleccionado:"}
            </div>
            <div style={{ fontWeight: "600", color: tokens.textPrimary, fontFamily: "monospace" }}>
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
                borderRadius: "12px",
                border: `1px solid ${
                  selectedPolicy === "INHERIT"
                    ? "#3ec4c0"
                    : tokens.borderSubtle
                }`,
                backgroundColor:
                  selectedPolicy === "INHERIT"
                    ? isDark
                      ? "rgba(62, 196, 192, 0.1)"
                      : "rgba(62, 196, 192, 0.06)"
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
                style={{ marginTop: "3px", accentColor: "#3ec4c0" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "700", color: tokens.textPrimary }}>
                  <IconRefresh size={15} />
                  <span>Heredar de la carpeta superior (por defecto)</span>
                </div>
                <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
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
                borderRadius: "12px",
                border: `1px solid ${
                  selectedPolicy === "NO_MODIFICABLE"
                    ? "#ef4444"
                    : tokens.borderSubtle
                }`,
                backgroundColor:
                  selectedPolicy === "NO_MODIFICABLE"
                    ? isDark
                      ? "rgba(239, 68, 68, 0.12)"
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
                style={{ marginTop: "3px", accentColor: "#ef4444" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "700", color: isDark ? "#f87171" : "#dc2626" }}>
                  <IconLock size={15} />
                  <span>Override: Protegido (NO_MODIFICABLE)</span>
                </div>
                <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
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
                borderRadius: "12px",
                border: `1px solid ${
                  selectedPolicy === "MODIFICABLE"
                    ? "#10b981"
                    : tokens.borderSubtle
                }`,
                backgroundColor:
                  selectedPolicy === "MODIFICABLE"
                    ? isDark
                      ? "rgba(16, 185, 129, 0.12)"
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
                style={{ marginTop: "3px", accentColor: "#10b981" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "700", color: isDark ? "#34d399" : "#059669" }}>
                  <IconUnlock size={15} />
                  <span>Override: Personalizable (MODIFICABLE)</span>
                </div>
                <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                  Se descarga una sola vez como plantilla inicial. El Launcher preservará las modificaciones locales del jugador.
                </div>
              </div>
            </label>
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
              disabled={isSubmitting}
              className="launcher-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isSubmitting && <IconSpinner style={{ width: 14, height: 14 }} />}
              <span>Aplicar política</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
