import React, { useState, useEffect, useCallback, useRef } from "react"
import type { ThemeMode, MinecraftServerSettings, UpdateMinecraftServerSettingsInput, ServerStatus } from "../../types"
import { serverApi } from "../../services/graphqlClient"
import {
  IconSliders,
  IconCheck,
  IconSpinner,
  IconAlertCircle,
  IconRefresh,
  IconWarning,
} from "../../theme/icons"

interface ServerConfigurationViewProps {
  theme: ThemeMode
  serverStatus?: ServerStatus
  onToast: (message: string, type: "success" | "error") => void
}

export default function ServerConfigurationView({
  theme,
  serverStatus,
  onToast,
}: ServerConfigurationViewProps) {
  const isDark = theme === "dark"
  const [settings, setSettings] = useState<MinecraftServerSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDisconnected = serverStatus === "DISCONNECTED" || (Boolean(error) && !settings)

  // Form state
  const [formData, setFormData] = useState<UpdateMinecraftServerSettingsInput>({
    difficulty: "normal",
    maxPlayers: 20,
    pvp: true,
    whitelist: false,
    viewDistance: 10,
    simulationDistance: 10,
    motd: "A HiKAT Minecraft Server",
    allowFlight: false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  const isMountedRef = useRef(true)

  const fetchSettings = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true)
    setError(null)
    try {
      const data = await serverApi.getMinecraftServerSettings()
      if (isMountedRef.current) {
        setSettings(data)
        setFormData({
          difficulty: data.difficulty,
          maxPlayers: data.maxPlayers,
          pvp: data.pvp,
          whitelist: data.whitelist,
          viewDistance: data.viewDistance,
          simulationDistance: data.simulationDistance,
          motd: data.motd,
          allowFlight: data.allowFlight,
        })
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo obtener la configuración de Minecraft.",
        )
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    fetchSettings()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchSettings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isDisconnected) return
    setIsSaving(true)
    setSavedSuccess(false)
    try {
      const updated = await serverApi.updateMinecraftServerSettings(formData)
      setSettings(updated)
      setSavedSuccess(true)
      onToast("Configuración guardada exitosamente.", "success")
    } catch (err: unknown) {
      onToast(
        err instanceof Error
          ? err.message
          : "Error al guardar la configuración.",
        "error",
      )
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 0",
          color: isDark ? "#3ec4c0" : "#0c6e6b",
          gap: 12,
        }}
      >
        <IconSpinner size={32} />
        <span style={{ fontSize: "0.95rem", fontWeight: 500 }}>
          Cargando configuración del servidor...
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#0f172a",
            }}
          >
            Configuración de Minecraft
          </h2>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: "0.875rem",
              color: isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)",
            }}
          >
            Ajustes esenciales de jugabilidad y rendimiento del archivo server.properties
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchSettings(true)}
          disabled={isRefreshing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 10,
            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
            background: "transparent",
            color: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)",
            cursor: isRefreshing ? "not-allowed" : "pointer",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          {isRefreshing ? <IconSpinner size={16} /> : <IconRefresh size={16} />}
          <span>Recargar</span>
        </button>
      </div>

      {/* Restart Advice Banner */}
      {isDisconnected ? (
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            background: isDark ? "rgba(245, 158, 11, 0.1)" : "#fffbeb",
            border: `1px solid ${isDark ? "rgba(245, 158, 11, 0.25)" : "#fde68a"}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: isDark ? "#fbbf24" : "#b45309",
            fontSize: "0.875rem",
          }}
        >
          <IconWarning size={20} />
          <span>La configuración se cargará cuando el servidor esté conectado.</span>
        </div>
      ) : (
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            background: isDark ? "rgba(59, 130, 246, 0.1)" : "#eff6ff",
            border: `1px solid ${isDark ? "rgba(59, 130, 246, 0.25)" : "#bfdbfe"}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: isDark ? "#93c5fd" : "#1d4ed8",
            fontSize: "0.875rem",
          }}
        >
          <IconWarning size={20} />
          <span>
            Los cambios surtirán efecto tras reiniciar el servidor de Minecraft.
          </span>
        </div>
      )}

      {/* Configuration Form Card */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 28,
          borderRadius: 20,
          background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
          boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.2)" : "0 4px 20px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {/* Difficulty */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: 8, color: isDark ? "#ffffff" : "#0f172a" }}>
              Dificultad del juego:
            </label>
            <select
              value={formData.difficulty}
              onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                background: isDark ? "#1a252f" : "#f8fafc",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                color: isDark ? "#ffffff" : "#0f172a",
                boxSizing: "border-box",
                fontWeight: 500,
              }}
            >
              <option value="peaceful">Pacífico (Peaceful)</option>
              <option value="easy">Fácil (Easy)</option>
              <option value="normal">Normal (Normal)</option>
              <option value="hard">Difícil (Hard)</option>
            </select>
          </div>

          {/* Max Players */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: 8, color: isDark ? "#ffffff" : "#0f172a" }}>
              Máximo de jugadores:
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={formData.maxPlayers ?? 20}
              onChange={(e) => setFormData({ ...formData, maxPlayers: parseInt(e.target.value, 10) || 20 })}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                color: isDark ? "#ffffff" : "#0f172a",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* View Distance */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: 8, color: isDark ? "#ffffff" : "#0f172a" }}>
              Distancia de renderizado (chunks):
            </label>
            <input
              type="number"
              min={2}
              max={32}
              value={formData.viewDistance ?? 10}
              onChange={(e) => setFormData({ ...formData, viewDistance: parseInt(e.target.value, 10) || 10 })}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                color: isDark ? "#ffffff" : "#0f172a",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Simulation Distance */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: 8, color: isDark ? "#ffffff" : "#0f172a" }}>
              Distancia de simulación (chunks):
            </label>
            <input
              type="number"
              min={2}
              max={32}
              value={formData.simulationDistance ?? 10}
              onChange={(e) => setFormData({ ...formData, simulationDistance: parseInt(e.target.value, 10) || 10 })}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                color: isDark ? "#ffffff" : "#0f172a",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* MOTD */}
        <div>
          <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: 8, color: isDark ? "#ffffff" : "#0f172a" }}>
            Mensaje del servidor (MOTD):
          </label>
          <input
            type="text"
            maxLength={256}
            value={formData.motd ?? ""}
            onChange={(e) => setFormData({ ...formData, motd: e.target.value })}
            placeholder="A HiKAT Minecraft Server"
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
              color: isDark ? "#ffffff" : "#0f172a",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Toggles Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, paddingTop: 8 }}>
          {/* PvP */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              padding: "12px 16px",
              borderRadius: 12,
              background: isDark ? "rgba(255,255,255,0.03)" : "#f8fafc",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "#e2e8f0"}`,
            }}
          >
            <input
              type="checkbox"
              checked={formData.pvp ?? true}
              onChange={(e) => setFormData({ ...formData, pvp: e.target.checked })}
              style={{ width: 18, height: 18, accentColor: "#3ec4c0", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: isDark ? "#ffffff" : "#0f172a" }}>
              Combate PvP permitido
            </span>
          </label>

          {/* Whitelist */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              padding: "12px 16px",
              borderRadius: 12,
              background: isDark ? "rgba(255,255,255,0.03)" : "#f8fafc",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "#e2e8f0"}`,
            }}
          >
            <input
              type="checkbox"
              checked={formData.whitelist ?? false}
              onChange={(e) => setFormData({ ...formData, whitelist: e.target.checked })}
              style={{ width: 18, height: 18, accentColor: "#3ec4c0", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: isDark ? "#ffffff" : "#0f172a" }}>
              Lista blanca (Whitelist)
            </span>
          </label>

          {/* Allow Flight */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              padding: "12px 16px",
              borderRadius: 12,
              background: isDark ? "rgba(255,255,255,0.03)" : "#f8fafc",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "#e2e8f0"}`,
            }}
          >
            <input
              type="checkbox"
              checked={formData.allowFlight ?? false}
              onChange={(e) => setFormData({ ...formData, allowFlight: e.target.checked })}
              style={{ width: 18, height: 18, accentColor: "#3ec4c0", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: isDark ? "#ffffff" : "#0f172a" }}>
              Permitir vuelo (Flight)
            </span>
          </label>
        </div>

        {/* Submit button */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16, paddingTop: 12, borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }}>
          {savedSuccess && (
            <span style={{ fontSize: "0.875rem", color: isDark ? "#3ec4c0" : "#0f766e", fontWeight: 600 }}>
              Configuración guardada.
            </span>
          )}

          <button
            type="submit"
            disabled={isSaving || isDisconnected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 28px",
              borderRadius: 12,
              border: "none",
              background: isDark ? "#3ec4c0" : "#0c6e6b",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: isSaving || isDisconnected ? "not-allowed" : "pointer",
              opacity: isDisconnected ? 0.5 : 1,
              boxShadow: "0 4px 14px rgba(62, 196, 192, 0.3)",
            }}
          >
            {isSaving ? <IconSpinner size={18} /> : <IconCheck size={18} />}
            <span>{isSaving ? "Guardando..." : "Guardar cambios"}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
