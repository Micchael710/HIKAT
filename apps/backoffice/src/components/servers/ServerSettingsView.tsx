import React, { useState, useEffect, useRef } from "react"
import type { ThemeMode, ServerItem } from "../../types"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { serverApi } from "../../services/graphqlClient"
import {
  IconServer,
  IconCpu,
  IconRam,
  IconDisk,
  IconFolder,
  IconGlobe,
  IconCheck,
} from "../../theme/icons"

interface ServerSettingsViewProps {
  theme: ThemeMode
  server: ServerItem
  onServerUpdated?: (server: ServerItem) => void
}

export default function ServerSettingsView({
  theme,
  server,
  onServerUpdated,
}: ServerSettingsViewProps) {
  const isDark = theme === "dark"
  const [accentColor, setAccentColor] = useState(server.accentColor || "#3ec4c0")
  const [mainLogoFile, setMainLogoFile] = useState<File | null>(null)
  const [mainLogoPreview, setMainLogoPreview] = useState<string | null>(server.mainLogo?.url || null)
  const [sidebarLogoFile, setSidebarLogoFile] = useState<File | null>(null)
  const [sidebarLogoPreview, setSidebarLogoPreview] = useState<string | null>(server.sidebarLogo?.url || null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const mainLogoInputRef = useRef<HTMLInputElement>(null)
  const sidebarLogoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setAccentColor(server.accentColor || "#3ec4c0")
    setMainLogoFile(null)
    setMainLogoPreview(server.mainLogo?.url || null)
    setSidebarLogoFile(null)
    setSidebarLogoPreview(server.sidebarLogo?.url || null)
    setError(null)
    setSuccessMessage(null)
  }, [server.id, server.accentColor, server.mainLogo?.url, server.sidebarLogo?.url])

  const handleMainLogoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("El logo principal debe ser una imagen (PNG, JPEG, WebP).")
      return
    }
    setError(null)
    setSuccessMessage(null)
    setMainLogoFile(file)
    if (typeof URL.createObjectURL === "function") {
      setMainLogoPreview(URL.createObjectURL(file))
    }
  }

  const handleSidebarLogoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("El logo lateral debe ser una imagen (PNG, JPEG, WebP).")
      return
    }
    setError(null)
    setSuccessMessage(null)
    setSidebarLogoFile(file)
    if (typeof URL.createObjectURL === "function") {
      setSidebarLogoPreview(URL.createObjectURL(file))
    }
  }

  const handleSaveBranding = async () => {
    setError(null)
    setSuccessMessage(null)

    const trimmedAccent = accentColor.trim()
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmedAccent)) {
      setError("El color de acento debe ser un código HEX válido (ej. #3ec4c0).")
      return
    }

    setIsSaving(true)
    try {
      let mainLogoMediaId: string | null = server.mainLogo?.id ?? null
      let sidebarLogoMediaId: string | null = server.sidebarLogo?.id ?? null

      if (mainLogoFile) {
        const media = await uploadMediaFile(mainLogoFile, "IMAGE")
        mainLogoMediaId = media.id
      }

      if (sidebarLogoFile) {
        const media = await uploadMediaFile(sidebarLogoFile, "IMAGE")
        sidebarLogoMediaId = media.id
      }

      const updated = await serverApi.updateServerBranding(server.id, {
        mainLogoMediaId,
        sidebarLogoMediaId,
        accentColor: trimmedAccent,
      })

      setSuccessMessage("Branding actualizado correctamente.")
      setMainLogoFile(null)
      setSidebarLogoFile(null)
      onServerUpdated?.(updated)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar el branding del servidor.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      style={{
        padding: "32px 36px",
        maxWidth: 1100,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
              letterSpacing: "-0.02em",
            }}
          >
            Ajustes del Servidor
          </h2>
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 8,
              background: "rgba(62, 196, 192, 0.15)",
              color: "#3ec4c0",
            }}
          >
            {server.name}
          </span>
        </div>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 14,
            color: isDark ? "rgba(255, 255, 255, 0.6)" : "#657788",
          }}
        >
          Información general, especificaciones de hardware y configuración del entorno del servidor.
        </p>
      </div>

      {/* Grid of details */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Identity & General Card */}
        <div
          style={{
            background: isDark ? "#131d25" : "#ffffff",
            borderRadius: 18,
            padding: 24,
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.08)"
              : "1.5px solid rgba(0, 0, 0, 0.08)",
            boxShadow: isDark
              ? "0 8px 24px rgba(0, 0, 0, 0.2)"
              : "0 4px 16px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <IconServer size={18} />
            <span>Identidad del Servidor</span>
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Identificador (ID)
              </span>
              <code style={{ color: "#3ec4c0", fontFamily: "monospace", fontSize: 12 }}>{server.id}</code>
            </div>

            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Nombre del Servidor
              </span>
              <strong style={{ color: isDark ? "#ffffff" : "#111822" }}>{server.name}</strong>
            </div>

            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Carpeta Local del Juego
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#3ec4c0", fontFamily: "monospace", marginTop: 2 }}>
                <IconFolder size={15} />
                <span>HiKAT/games/{server.name}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Environment & Engine Card */}
        <div
          style={{
            background: isDark ? "#131d25" : "#ffffff",
            borderRadius: 18,
            padding: 24,
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.08)"
              : "1.5px solid rgba(0, 0, 0, 0.08)",
            boxShadow: isDark
              ? "0 8px 24px rgba(0, 0, 0, 0.2)"
              : "0 4px 16px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <IconGlobe size={18} />
            <span>Entorno y Mod Loader</span>
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Versión de Minecraft
              </span>
              <strong style={{ color: isDark ? "#ffffff" : "#111822" }}>Minecraft {server.minecraftVersion}</strong>
            </div>

            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Mod Loader
              </span>
              <span style={{ color: isDark ? "#ffffff" : "#111822" }}>
                {server.modLoader} {server.modLoaderVersion ? `(${server.modLoaderVersion})` : ""}
              </span>
            </div>

            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Estado de Aprovisionamiento
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: server.provisioningStatus === "READY" ? "rgba(34, 197, 94, 0.2)" : "rgba(245, 166, 35, 0.2)",
                    color: server.provisioningStatus === "READY" ? "#22c55e" : "#f5a623",
                  }}
                >
                  {server.provisioningStatus}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Resources Specs Card */}
        <div
          style={{
            background: isDark ? "#131d25" : "#ffffff",
            borderRadius: 18,
            padding: 24,
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.08)"
              : "1.5px solid rgba(0, 0, 0, 0.08)",
            boxShadow: isDark
              ? "0 8px 24px rgba(0, 0, 0, 0.2)"
              : "0 4px 16px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <IconCpu size={18} />
            <span>Especificaciones de Hardware (Pterodactyl)</span>
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div
              style={{
                padding: "14px 12px",
                borderRadius: 12,
                background: isDark ? "#0d141a" : "#f8fafc",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#3ec4c0", display: "flex", justifyContent: "center", marginBottom: 6 }}>
                <IconCpu size={20} />
              </div>
              <div style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                CPU
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: isDark ? "#ffffff" : "#111822", marginTop: 2 }}>
                {server.cpu ? `${server.cpu}%` : "—"}
              </div>
            </div>

            <div
              style={{
                padding: "14px 12px",
                borderRadius: 12,
                background: isDark ? "#0d141a" : "#f8fafc",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#3ec4c0", display: "flex", justifyContent: "center", marginBottom: 6 }}>
                <IconRam size={20} />
              </div>
              <div style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                RAM
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: isDark ? "#ffffff" : "#111822", marginTop: 2 }}>
                {server.memoryMb ? `${(server.memoryMb / 1024).toFixed(0)} GB` : "—"}
              </div>
            </div>

            <div
              style={{
                padding: "14px 12px",
                borderRadius: 12,
                background: isDark ? "#0d141a" : "#f8fafc",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#3ec4c0", display: "flex", justifyContent: "center", marginBottom: 6 }}>
                <IconDisk size={20} />
              </div>
              <div style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                Disco
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: isDark ? "#ffffff" : "#111822", marginTop: 2 }}>
                {server.diskMb ? `${(server.diskMb / 1024).toFixed(0)} GB` : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Appearance & Branding Card */}
        <div
          style={{
            background: isDark ? "#131d25" : "#ffffff",
            borderRadius: 18,
            padding: 24,
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.08)"
              : "1.5px solid rgba(0, 0, 0, 0.08)",
            boxShadow: isDark
              ? "0 8px 24px rgba(0, 0, 0, 0.2)"
              : "0 4px 16px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
            }}
          >
            Apariencia y Branding
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Logos Row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
              {/* Main logo (Horizontal Banner) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
                  Logo Principal (Horizontal)
                </span>
                <div
                  style={{
                    width: 140,
                    height: 52,
                    borderRadius: 10,
                    background: mainLogoPreview
                      ? `url(${mainLogoPreview}) center/cover no-repeat`
                      : isDark
                      ? "#0d141a"
                      : "#f1f5f9",
                    border: `1.5px solid ${accentColor}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: accentColor,
                  }}
                >
                  {!mainLogoPreview && <span style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8" }}>Sin banner</span>}
                </div>
                <input
                  ref={mainLogoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleMainLogoSelected}
                />
                <button
                  type="button"
                  onClick={() => mainLogoInputRef.current?.click()}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: isDark ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid rgba(0, 0, 0, 0.15)",
                    background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
                    color: isDark ? "#ffffff" : "#111822",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Cambiar Logo
                </button>
              </div>

              {/* Sidebar logo (Square) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
                  Logo Lateral (Cuadrado)
                </span>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 12,
                    background: sidebarLogoPreview
                      ? `url(${sidebarLogoPreview}) center/cover no-repeat`
                      : isDark
                      ? "#0d141a"
                      : "#f1f5f9",
                    border: `1.5px solid ${accentColor}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: accentColor,
                  }}
                >
                  {!sidebarLogoPreview && <IconServer size={22} />}
                </div>
                <input
                  ref={sidebarLogoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleSidebarLogoSelected}
                />
                <button
                  type="button"
                  onClick={() => sidebarLogoInputRef.current?.click()}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: isDark ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid rgba(0, 0, 0, 0.15)",
                    background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
                    color: isDark ? "#ffffff" : "#111822",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Cambiar
                </button>
              </div>
            </div>

            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Color de Acento
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <input
                  type="color"
                  value={accentColor.startsWith("#") && accentColor.length === 7 ? accentColor : "#3ec4c0"}
                  onChange={(e) => setAccentColor(e.target.value)}
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: "none",
                  }}
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#3ec4c0"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: isDark ? "1.5px solid rgba(255, 255, 255, 0.12)" : "1.5px solid rgba(0, 0, 0, 0.15)",
                    background: isDark ? "#0d141a" : "#f8fafc",
                    color: isDark ? "#ffffff" : "#111822",
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    width: 100,
                  }}
                />
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
                {error}
              </div>
            )}
            {successMessage && (
              <div style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>
                {successMessage}
              </div>
            )}

            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveBranding}
              style={{
                marginTop: 6,
                padding: "8px 16px",
                borderRadius: 8,
                background: accentColor,
                color: "#000000",
                fontWeight: 700,
                fontSize: 12.5,
                border: "none",
                cursor: isSaving ? "not-allowed" : "pointer",
                opacity: isSaving ? 0.7 : 1,
                alignSelf: "flex-start",
              }}
            >
              {isSaving ? "Guardando..." : "Guardar Branding"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
