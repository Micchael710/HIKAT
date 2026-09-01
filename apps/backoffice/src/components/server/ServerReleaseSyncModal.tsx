import React, { useState } from "react"
import type { ThemeMode, ServerReleaseSyncPlan } from "../../types"
import { graphqlClient } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
import { formatBytesToHuman } from "@hikat/shared"
import { IconAlertCircle, IconCheck, IconCross } from "../../theme/icons"

interface ServerReleaseSyncModalProps {
  theme: ThemeMode
  plan: ServerReleaseSyncPlan
  onClose: () => void
  onSuccess: () => void
  onToast: (message: string, type: "success" | "error") => void
}

export const ServerReleaseSyncModal: React.FC<ServerReleaseSyncModalProps> = ({
  theme,
  plan,
  onClose,
  onSuccess,
  onToast,
}) => {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [createBackup, setCreateBackup] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canApply = plan.canApply === true

  const handleApply = async () => {
    if (!canApply) {
      setError(plan.blockReason || "No se pueden aplicar los cambios en el estado actual del servidor.")
      return
    }

    setIsApplying(true)
    setError(null)

    try {
      const res = await graphqlClient.applyServerReleaseSync(createBackup)
      if (res.success) {
        onToast(res.message || "Cambios aplicados al servidor con éxito.", "success")
        onSuccess()
        onClose()
      } else {
        setError(res.message || "Error al aplicar los cambios al servidor.")
      }
    } catch (err: any) {
      setError(err.message || "Error inesperado al aplicar los cambios.")
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div
      data-testid="server-release-sync-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "24px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isApplying) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "750px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: "700", color: tokens.textPrimary }}>
              Aplicar cambios al servidor
            </h2>
            <div style={{ fontSize: "13px", color: tokens.textSecondary, marginTop: "2px" }}>
              Versión de la actualización: <strong>v{plan.releaseVersion || "—"}</strong>
            </div>
          </div>

          <button
            type="button"
            data-testid="button-close-sync-modal"
            onClick={onClose}
            disabled={isApplying}
            style={{
              background: "transparent",
              border: "none",
              color: tokens.textMuted,
              cursor: isApplying ? "not-allowed" : "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Summary Badges */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                background: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
              }}
            >
              +{plan.summary.toInstall} para instalar
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                background: "rgba(59, 130, 246, 0.15)",
                color: "#60a5fa",
              }}
            >
              ↑ {plan.summary.toUpdate} para actualizar
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
              }}
            >
              − {plan.summary.toRemove} para eliminar
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "600",
                background: isDark ? "rgba(255, 255, 255, 0.06)" : "#f3f4f6",
                color: isDark ? "#9ca3af" : "#6b7280",
              }}
            >
              = {plan.summary.toKeep} sin cambios
            </span>
          </div>

          {/* Server Precondition Warning or Ready Notice */}
          {!canApply ? (
            <div
              data-testid="sync-server-not-offline-warning"
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background:
                  plan.serverStatus === "DISCONNECTED" || plan.serverStatus === "UNKNOWN"
                    ? "rgba(239, 68, 68, 0.12)"
                    : "rgba(245, 158, 11, 0.12)",
                border: `1px solid ${
                  plan.serverStatus === "DISCONNECTED" || plan.serverStatus === "UNKNOWN"
                    ? "rgba(239, 68, 68, 0.3)"
                    : "rgba(245, 158, 11, 0.3)"
                }`,
                color:
                  plan.serverStatus === "DISCONNECTED" || plan.serverStatus === "UNKNOWN"
                    ? "#fca5a5"
                    : "#fcd34d",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", color: plan.serverStatus === "DISCONNECTED" || plan.serverStatus === "UNKNOWN" ? "#ef4444" : "#f59e0b" }}>
                <IconAlertCircle size={20} />
              </div>
              <div>
                <strong>
                  {plan.blockReason ||
                    (plan.serverStatus === "DISCONNECTED" || plan.serverStatus === "UNKNOWN"
                      ? "El servidor no está disponible."
                      : plan.serverStatus === "OFFLINE"
                      ? "No se pudieron verificar los archivos del servidor."
                      : "Apaga el servidor antes de aplicar los cambios.")}
                </strong>
                {plan.serverStatus === "ONLINE" || plan.serverStatus === "STARTING" || plan.serverStatus === "STOPPING" ? (
                  <div style={{ marginTop: "2px", fontSize: "12px", opacity: 0.9 }}>
                    Estado actual: <strong>{plan.serverStatus}</strong>. Apágalo para prevenir bloqueos y daños de datos.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              data-testid="sync-server-ready-notice"
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                background: "rgba(34, 197, 94, 0.12)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                color: "#22c55e",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <IconCheck size={18} style={{ color: "#22c55e" }} />
              <span>
                <strong>Servidor apagado y listo.</strong> Puedes aplicar los cambios con seguridad.
              </span>
            </div>
          )}

          {/* Items breakdown list */}
          <div
            style={{
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#e5e7eb"}`,
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                background: isDark ? "rgba(255, 255, 255, 0.03)" : "#f9fafb",
                fontSize: "12px",
                fontWeight: "700",
                color: isDark ? "#9ca3af" : "#6b7280",
                textTransform: "uppercase",
              }}
            >
              Detalle de modificaciones ({plan.items.length})
            </div>

            <div style={{ maxHeight: "240px", overflowY: "auto" }}>
              {plan.items.map((item, idx) => {
                let badgeBg = "rgba(107, 114, 128, 0.15)"
                let badgeColor = "#9ca3af"
                let actionLabel = "Sin cambios"

                if (item.action === "INSTALL") {
                  badgeBg = "rgba(34, 197, 94, 0.2)"
                  badgeColor = "#4ade80"
                  actionLabel = "Instalar"
                } else if (item.action === "UPDATE") {
                  badgeBg = "rgba(59, 130, 246, 0.2)"
                  badgeColor = "#60a5fa"
                  actionLabel = "Actualizar"
                } else if (item.action === "REMOVE") {
                  badgeBg = "rgba(239, 68, 68, 0.2)"
                  badgeColor = "#f87171"
                  actionLabel = "Eliminar"
                }

                return (
                  <div
                    key={`${item.filename}-${idx}`}
                    style={{
                      padding: "10px 14px",
                      borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.04)" : "#f3f4f6"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: "600", color: isDark ? "#f9fafb" : "#111827" }}>
                        {item.filename}
                      </div>
                      <div style={{ fontSize: "11px", color: isDark ? "#6b7280" : "#9ca3af" }}>
                        /{item.targetPath} {item.sizeBytes > 0 && `• ${formatBytesToHuman(item.sizeBytes)}`}
                      </div>
                    </div>

                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: "700",
                        background: badgeBg,
                        color: badgeColor,
                      }}
                    >
                      {actionLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Backup Option Checkbox */}
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: isDark ? "rgba(255, 255, 255, 0.03)" : "#f9fafb",
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "#e5e7eb"}`,
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <input
              type="checkbox"
              id="checkbox-pre-sync-backup"
              data-testid="checkbox-pre-sync-backup"
              checked={createBackup}
              onChange={(e) => setCreateBackup(e.target.checked)}
              disabled={isApplying}
              style={{ cursor: "pointer", width: "16px", height: "16px" }}
            />
            <label
              htmlFor="checkbox-pre-sync-backup"
              style={{ fontSize: "13px", color: isDark ? "#e5e7eb" : "#374151", cursor: "pointer" }}
            >
              Crear copia de seguridad antes de aplicar los cambios (recomendado)
            </label>
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "8px",
                color: "#fca5a5",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className="launcher-btn-secondary"
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              fontSize: "14px",
            }}
          >
            Cancelar
          </button>

          <button
            type="button"
            data-testid="button-apply-release-sync"
            onClick={handleApply}
            disabled={isApplying || !canApply}
            className="launcher-btn-primary"
            style={{
              padding: "10px 22px",
              borderRadius: 12,
              fontSize: "14px",
              opacity: isApplying || !canApply ? 0.5 : 1,
              cursor: isApplying || !canApply ? "not-allowed" : "pointer",
            }}
          >
            {isApplying ? "Aplicando cambios..." : "Aplicar cambios al servidor"}
          </button>
        </div>
      </div>
    </div>
  )
}
