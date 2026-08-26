import React, { useState, useEffect } from "react"
import type { ThemeMode, AdminSettings } from "../../types"
import { settingsApi } from "../../services/graphqlClient"
import { IconSettings, IconSpinner, IconCheck } from "../../theme/icons"
import LiveToast from "../common/LiveToast"
import BackofficeSelect, { SelectOption } from "../common/BackofficeSelect"

interface SettingsViewProps {
  theme: ThemeMode
}

const RAM_OPTIONS: SelectOption[] = [
  { value: "2", label: "2 GB" },
  { value: "4", label: "4 GB" },
  { value: "6", label: "6 GB" },
  { value: "8", label: "8 GB" },
  { value: "10", label: "10 GB" },
  { value: "12", label: "12 GB" },
  { value: "16", label: "16 GB" },
  { value: "24", label: "24 GB" },
  { value: "32", label: "32 GB" },
]

export default function SettingsView({ theme }: SettingsViewProps) {
  const isDark = theme === "dark"

  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Form State
  const [projectName, setProjectName] = useState("HiKAT")
  const [serverIp, setServerIp] = useState("mc.hikat.org")
  const [discordUrl, setDiscordUrl] = useState("")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState("")
  const [minRamGb, setMinRamGb] = useState(4)
  const [recommendedRamGb, setRecommendedRamGb] = useState(8)

  useEffect(() => {
    let isMounted = true
    async function loadSettings() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await settingsApi.getAdminSettings()
        if (isMounted && data) {
          setSettings(data)
          setProjectName(data.projectName || "HiKAT")
          setServerIp(data.serverIp || "mc.hikat.org")
          setDiscordUrl(data.discordUrl || "")
          setWebsiteUrl(data.websiteUrl || "")
          setMaintenanceEnabled(!!data.maintenanceEnabled)
          setMaintenanceMessage(data.maintenanceMessage || "")
          setMinRamGb(data.minRamGb || 4)
          setRecommendedRamGb(data.recommendedRamGb || 8)
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

    if (!projectName.trim()) {
      setError("El nombre del proyecto es obligatorio.")
      return
    }

    if (!serverIp.trim()) {
      setError("La dirección para jugar es obligatoria.")
      return
    }

    if (recommendedRamGb < minRamGb) {
      setError("La memoria RAM recomendada debe ser igual o mayor que la RAM mínima.")
      return
    }

    setIsSaving(true)
    try {
      const updated = await settingsApi.updateAdminSettings({
        projectName: projectName.trim(),
        serverIp: serverIp.trim(),
        discordUrl: discordUrl.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        maintenanceEnabled,
        maintenanceMessage: maintenanceMessage.trim() || undefined,
        minRamGb: Number(minRamGb),
        recommendedRamGb: Number(recommendedRamGb),
      })
      setSettings(updated)
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
          Ajustes Generales
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            color: isDark ? "#94a3b8" : "#64748b",
          }}
        >
          Configuración global del servidor, enlaces comunitarios y parámetros de rendimiento para el Launcher.
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

          {/* Section 1: General Project Info */}
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
                margin: "0 0 16px 0",
                fontSize: "16px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <IconSettings size={18} />
              Información General
            </h2>

            <div style={{ display: "grid", gap: "18px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Nombre del Proyecto
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ej. HiKAT"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: isDark ? "#0f172a" : "#ffffff",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Dirección para jugar
                </label>
                <input
                  type="text"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="Ej. mc.hikat.org o play.miservidor.com"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: isDark ? "#0f172a" : "#ffffff",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: isDark ? "#64748b" : "#94a3b8" }}>
                  Dirección del servidor a la que se conectará el Launcher automáticamente.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: isDark ? "#cbd5e1" : "#334155",
                      marginBottom: "6px",
                    }}
                  >
                    Enlace de Discord (Opcional)
                  </label>
                  <input
                    type="url"
                    value={discordUrl}
                    onChange={(e) => setDiscordUrl(e.target.value)}
                    placeholder="https://discord.gg/..."
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: isDark ? "#cbd5e1" : "#334155",
                      marginBottom: "6px",
                    }}
                  >
                    Sitio Web Oficial (Opcional)
                  </label>
                  <input
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://hikat.org"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Maintenance Mode */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${maintenanceEnabled ? "#f59e0b" : isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "24px",
              marginBottom: "24px",
              boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
              transition: "border-color 0.2s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: maintenanceEnabled ? "16px" : 0,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: "0 0 4px 0",
                    fontSize: "16px",
                    fontWeight: "600",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                  }}
                >
                  Modo Mantenimiento
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  Bloquea temporalmente el acceso de los jugadores desde el Launcher mostrando un aviso.
                </p>
              </div>

              {/* Modern Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={maintenanceEnabled}
                onClick={() => setMaintenanceEnabled(!maintenanceEnabled)}
                style={{
                  width: "48px",
                  height: "26px",
                  borderRadius: "13px",
                  backgroundColor: maintenanceEnabled ? "#f59e0b" : isDark ? "#475569" : "#cbd5e1",
                  border: "none",
                  padding: "2px",
                  cursor: "pointer",
                  position: "relative",
                  transition: "background-color 0.2s ease",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    backgroundColor: "#ffffff",
                    position: "absolute",
                    top: "2px",
                    left: maintenanceEnabled ? "24px" : "2px",
                    transition: "left 0.2s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                />
              </button>
            </div>

            {maintenanceEnabled && (
              <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}` }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Mensaje para los jugadores
                </label>
                <textarea
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  placeholder="Ej. Servidor en mantenimiento programado. Volvemos pronto..."
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: isDark ? "#0f172a" : "#ffffff",
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontSize: "13px",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </div>
            )}
          </div>

          {/* Section 3: Performance & RAM */}
          <div
            style={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "24px",
              marginBottom: "28px",
              boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <h2
              style={{
                margin: "0 0 4px 0",
                fontSize: "16px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Parámetros de Memoria RAM (Launcher)
            </h2>
            <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
              Límites sugeridos para la asignación de memoria RAM al iniciar Minecraft.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  RAM mínima
                </label>
                <BackofficeSelect
                  theme={theme}
                  value={String(minRamGb)}
                  onChange={(val) => setMinRamGb(Number(val))}
                  options={RAM_OPTIONS}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  RAM recomendada
                </label>
                <BackofficeSelect
                  theme={theme}
                  value={String(recommendedRamGb)}
                  onChange={(val) => setRecommendedRamGb(Number(val))}
                  options={RAM_OPTIONS}
                />
              </div>
            </div>
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
              }}
            >
              {isSaving ? <IconSpinner size={16} /> : <IconCheck size={16} />}
              Guardar ajustes
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
