import React, { useState, useEffect } from "react"
import type { ThemeMode, AdminSettings } from "../../types"
import { settingsApi } from "../../services/graphqlClient"
import { IconSettings, IconSpinner, IconCheck } from "../../theme/icons"
import LiveToast from "../common/LiveToast"

interface SettingsViewProps {
  theme: ThemeMode
}

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
  const [serverPort, setServerPort] = useState(25565)
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
          setServerPort(data.serverPort || 25565)
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
      setError("La IP del servidor es obligatoria.")
      return
    }

    if (serverPort < 1 || serverPort > 65535) {
      setError("El puerto debe estar entre 1 y 65535.")
      return
    }

    if (minRamGb < 1 || minRamGb > 64 || recommendedRamGb < 1 || recommendedRamGb > 64) {
      setError("Los valores de memoria RAM deben estar entre 1 y 64 GB.")
      return
    }

    setIsSaving(true)
    try {
      const updated = await settingsApi.updateAdminSettings({
        projectName: projectName.trim(),
        serverIp: serverIp.trim(),
        serverPort: Number(serverPort),
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
    <div style={{ padding: "28px", maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
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
          Ajustes del Proyecto
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            color: isDark ? "#94a3b8" : "#64748b",
          }}
        >
          Configuración general del servidor, mantenimiento y requisitos del lanzador.
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
                marginBottom: "20px",
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          {/* Section 1: Server & Project Info */}
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
              }}
            >
              Información de Conexión
            </h2>

            <div style={{ marginBottom: "16px" }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "16px", marginBottom: "16px" }}>
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
                  IP de Conexión
                </label>
                <input
                  type="text"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
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
                  Puerto
                </label>
                <input
                  type="number"
                  value={serverPort}
                  onChange={(e) => setServerPort(Number(e.target.value))}
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
                  Enlace de Discord (opcional)
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
                  Sitio Web (opcional)
                </label>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://..."
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

          {/* Section 2: Maintenance Mode */}
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
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
                  Informa a los jugadores en el Launcher si el servidor está en mantenimiento.
                </p>
              </div>

              <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={maintenanceEnabled}
                  onChange={(e) => setMaintenanceEnabled(e.target.checked)}
                  style={{ width: "18px", height: "18px", accentColor: "#6366f1" }}
                />
                <span style={{ marginLeft: "8px", fontSize: "13px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                  {maintenanceEnabled ? "Activado" : "Desactivado"}
                </span>
              </label>
            </div>

            {maintenanceEnabled && (
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
                  Mensaje para los jugadores
                </label>
                <input
                  type="text"
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  placeholder="Ej. Servidor en mantenimiento programado. Volvemos a las 18:00."
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
            )}
          </div>

          {/* Section 3: Launcher RAM Requirements */}
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
                margin: "0 0 6px 0",
                fontSize: "16px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Requisitos de Memoria RAM para el Launcher
            </h2>
            <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: isDark ? "#94a3b8" : "#64748b" }}>
              Valores sugeridos al cliente para la asignación de memoria Java.
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
                  RAM Mínima (GB)
                </label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={minRamGb}
                  onChange={(e) => setMinRamGb(Number(e.target.value))}
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
                  RAM Recomendada (GB)
                </label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={recommendedRamGb}
                  onChange={(e) => setRecommendedRamGb(Number(e.target.value))}
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

          {/* Submit Button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
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
              {isSaving ? "Guardando..." : "Guardar ajustes"}
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
