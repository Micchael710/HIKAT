import React, { useState, useEffect } from "react"
import type { ThemeMode, UpdateDeploymentOrder } from "../../types"
import { settingsApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
import { IconSpinner, IconCheck, IconWarning } from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface SettingsViewProps {
  theme: ThemeMode
}

export default function SettingsView({ theme }: SettingsViewProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  const [deploymentOrder, setDeploymentOrder] = useState<UpdateDeploymentOrder>("SERVER_FIRST")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    async function loadSettings() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await settingsApi.getAdminSettings()
        if (isMounted && data) {
          setDeploymentOrder(data.updateDeploymentOrder || "SERVER_FIRST")
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || "No se pudieron cargar los ajustes.")
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    loadSettings()
    return () => {
      isMounted = false
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const updated = await settingsApi.updateAdminSettings({
        updateDeploymentOrder: deploymentOrder,
      })
      if (updated?.updateDeploymentOrder) {
        setDeploymentOrder(updated.updateDeploymentOrder)
      }
      setToastMessage("Ajustes guardados correctamente.")
    } catch (err: any) {
      setError(err.message || "Error al guardar los ajustes.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: "32px 36px",
        overflowY: "auto",
        animation: "viewFadeIn 0.24s ease",
        fontFamily: "Inter, sans-serif",
        boxSizing: "border-box",
      }}
      className="custom-scroll"
    >
      {/* Top Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            margin: "0 0 6px 0",
            fontSize: "26px",
            fontWeight: "800",
            color: tokens.textPrimary,
            letterSpacing: "-0.02em",
          }}
        >
          Configuración
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            fontWeight: "500",
            color: tokens.textSecondary,
          }}
        >
          Ajustes de despliegue y disponibilidad de versiones para los jugadores y el servidor.
        </p>
      </div>

      {isLoading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            color: tokens.textMuted,
            gap: "12px",
          }}
        >
          <IconSpinner size={24} />
          <span>Cargando ajustes...</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: "800px" }}>
          {error && (
            <div
              style={{
                marginBottom: "24px",
                padding: "12px 16px",
                borderRadius: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#ef4444",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          {/* Section: Deployment Order */}
          <div
            style={{
              backgroundColor: tokens.bgCard,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: "18px",
              padding: "24px",
              marginBottom: "24px",
              boxShadow: tokens.cardShadow,
            }}
          >
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "16px",
                fontWeight: "700",
                color: tokens.textPrimary,
              }}
            >
              Orden de las actualizaciones
            </h2>
            <p
              style={{
                margin: "0 0 20px 0",
                fontSize: "13px",
                color: tokens.textSecondary,
                lineHeight: "1.5",
              }}
            >
              Decide cuándo una versión publicada estará disponible para los jugadores.
            </p>

            <div style={{ display: "grid", gap: "14px" }}>
              {/* Option 1: Servidor primero */}
              <div
                onClick={() => setDeploymentOrder("SERVER_FIRST")}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "14px",
                  padding: "16px 18px",
                  borderRadius: "12px",
                  border: `2px solid ${
                    deploymentOrder === "SERVER_FIRST"
                      ? "#3ec4c0"
                      : tokens.borderSubtle
                  }`,
                  backgroundColor:
                    deploymentOrder === "SERVER_FIRST"
                      ? isDark
                        ? "rgba(62, 196, 192, 0.1)"
                        : "rgba(62, 196, 192, 0.06)"
                      : tokens.bgCardInner,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  id="order-server-first"
                  name="deploymentOrder"
                  checked={deploymentOrder === "SERVER_FIRST"}
                  onChange={() => setDeploymentOrder("SERVER_FIRST")}
                  style={{
                    marginTop: "3px",
                    accentColor: "#3ec4c0",
                    cursor: "pointer",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <label
                      htmlFor="order-server-first"
                      style={{
                        fontSize: "14px",
                        fontWeight: "700",
                        color: tokens.textPrimary,
                        cursor: "pointer",
                      }}
                    >
                      Servidor primero
                    </label>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: "11px",
                        fontWeight: "700",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        backgroundColor: isDark ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.12)",
                        color: isDark ? "#34d399" : "#059669",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                      }}
                    >
                      Recomendado
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      color: tokens.textSecondary,
                      lineHeight: "1.4",
                    }}
                  >
                    La actualización estará disponible para los jugadores después de aplicarse correctamente al servidor.
                  </p>
                </div>
              </div>

              {/* Option 2: Jugadores primero */}
              <div
                onClick={() => setDeploymentOrder("PLAYERS_FIRST")}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "14px",
                  padding: "16px 18px",
                  borderRadius: "12px",
                  border: `2px solid ${
                    deploymentOrder === "PLAYERS_FIRST"
                      ? "#3ec4c0"
                      : tokens.borderSubtle
                  }`,
                  backgroundColor:
                    deploymentOrder === "PLAYERS_FIRST"
                      ? isDark
                        ? "rgba(62, 196, 192, 0.1)"
                        : "rgba(62, 196, 192, 0.06)"
                      : tokens.bgCardInner,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  id="order-players-first"
                  name="deploymentOrder"
                  checked={deploymentOrder === "PLAYERS_FIRST"}
                  onChange={() => setDeploymentOrder("PLAYERS_FIRST")}
                  style={{
                    marginTop: "3px",
                    accentColor: "#3ec4c0",
                    cursor: "pointer",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <label
                      htmlFor="order-players-first"
                      style={{
                        fontSize: "14px",
                        fontWeight: "700",
                        color: tokens.textPrimary,
                        cursor: "pointer",
                      }}
                    >
                      Jugadores primero
                    </label>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      color: tokens.textSecondary,
                      lineHeight: "1.4",
                    }}
                  >
                    La actualización estará disponible para los jugadores al publicarla. El servidor podrá actualizarse después.
                  </p>
                </div>
              </div>
            </div>

            {/* Warning when PLAYERS_FIRST is selected */}
            {deploymentOrder === "PLAYERS_FIRST" && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  backgroundColor: isDark ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.08)",
                  border: `1px solid ${isDark ? "rgba(245, 158, 11, 0.3)" : "rgba(245, 158, 11, 0.25)"}`,
                  color: isDark ? "#fbbf24" : "#d97706",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  lineHeight: "1.4",
                }}
              >
                <IconWarning size={18} style={{ flexShrink: 0 }} />
                <span>Puede existir un periodo en el que los jugadores y el servidor tengan versiones diferentes.</span>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={isSaving}
              className="launcher-btn-primary"
              style={{
                padding: "10px 24px",
                fontSize: "14px",
              }}
            >
              {isSaving ? <IconSpinner size={16} /> : <IconCheck size={16} />}
              Guardar cambios
            </button>
          </div>
        </form>
      )}

      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type="success"
          theme={theme}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}
