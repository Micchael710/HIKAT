import React, { useState, useEffect } from "react"
import type { ThemeMode, UpdateDeploymentOrder } from "../../types"
import { settingsApi } from "../../services/graphqlClient"
import { IconSpinner, IconCheck, IconWarning } from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface SettingsViewProps {
  theme: ThemeMode
}

export default function SettingsView({ theme }: SettingsViewProps) {
  const isDark = theme === "dark"

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
    <div style={{ padding: "28px", maxWidth: "800px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Top Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            margin: "0 0 6px 0",
            fontSize: "24px",
            fontWeight: "700",
            color: isDark ? "#f1f5f9" : "#0f172a",
            letterSpacing: "-0.02em",
          }}
        >
          Configuración
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            color: isDark ? "#94a3b8" : "#64748b",
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
            color: isDark ? "#94a3b8" : "#64748b",
            gap: "12px",
          }}
        >
          <IconSpinner size={24} />
          <span>Cargando ajustes...</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div
              style={{
                marginBottom: "24px",
                padding: "12px 16px",
                borderRadius: "10px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
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
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "24px",
              marginBottom: "24px",
              boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <h2
              style={{
                margin: "0 0 6px 0",
                fontSize: "16px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Orden de las actualizaciones
            </h2>
            <p
              style={{
                margin: "0 0 20px 0",
                fontSize: "13px",
                color: isDark ? "#94a3b8" : "#64748b",
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
                  borderRadius: "10px",
                  border: `2px solid ${
                    deploymentOrder === "SERVER_FIRST"
                      ? "#6366f1"
                      : isDark
                        ? "#334155"
                        : "#e2e8f0"
                  }`,
                  backgroundColor:
                    deploymentOrder === "SERVER_FIRST"
                      ? isDark
                        ? "rgba(99, 102, 241, 0.08)"
                        : "rgba(99, 102, 241, 0.04)"
                      : isDark
                        ? "#0f172a"
                        : "#f8fafc",
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
                    accentColor: "#6366f1",
                    cursor: "pointer",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <label
                      htmlFor="order-server-first"
                      style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        color: isDark ? "#f1f5f9" : "#0f172a",
                        cursor: "pointer",
                      }}
                    >
                      Servidor primero
                    </label>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: "11px",
                        fontWeight: "600",
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
                      color: isDark ? "#94a3b8" : "#64748b",
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
                  borderRadius: "10px",
                  border: `2px solid ${
                    deploymentOrder === "PLAYERS_FIRST"
                      ? "#6366f1"
                      : isDark
                        ? "#334155"
                        : "#e2e8f0"
                  }`,
                  backgroundColor:
                    deploymentOrder === "PLAYERS_FIRST"
                      ? isDark
                        ? "rgba(99, 102, 241, 0.08)"
                        : "rgba(99, 102, 241, 0.04)"
                      : isDark
                        ? "#0f172a"
                        : "#f8fafc",
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
                    accentColor: "#6366f1",
                    cursor: "pointer",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <label
                      htmlFor="order-players-first"
                      style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        color: isDark ? "#f1f5f9" : "#0f172a",
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
                      color: isDark ? "#94a3b8" : "#64748b",
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
                  borderRadius: "10px",
                  backgroundColor: isDark ? "rgba(245, 158, 11, 0.1)" : "rgba(245, 158, 11, 0.08)",
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
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 24px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#6366f1",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: "600",
                cursor: isSaving ? "not-allowed" : "pointer",
                opacity: isSaving ? 0.7 : 1,
                transition: "opacity 0.15s ease",
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
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}
