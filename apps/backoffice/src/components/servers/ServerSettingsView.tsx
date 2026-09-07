import React from "react"
import type { ThemeMode, ServerItem } from "../../types"
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
}

export default function ServerSettingsView({
  theme,
  server,
}: ServerSettingsViewProps) {
  const isDark = theme === "dark"
  const accent = server.accentColor || "#3ec4c0"

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
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {/* Main logo (Horizontal Banner) */}
              <div>
                <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
                  Logo Principal (Horizontal)
                </span>
                <div
                  style={{
                    width: 140,
                    height: 52,
                    borderRadius: 10,
                    background: server.mainLogo?.url
                      ? `url(${server.mainLogo.url}) center/cover no-repeat`
                      : isDark
                      ? "#0d141a"
                      : "#f1f5f9",
                    border: `1.5px solid ${accent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: accent,
                  }}
                >
                  {!server.mainLogo?.url && <span style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8" }}>Sin banner</span>}
                </div>
              </div>

              {/* Sidebar logo (Square) */}
              <div>
                <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
                  Logo Lateral (Cuadrado)
                </span>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 12,
                    background: server.sidebarLogo?.url
                      ? `url(${server.sidebarLogo.url}) center/cover no-repeat`
                      : isDark
                      ? "#0d141a"
                      : "#f1f5f9",
                    border: `1.5px solid ${accent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: accent,
                  }}
                >
                  {!server.sidebarLogo?.url && <IconServer size={22} />}
                </div>
              </div>
            </div>

            <div>
              <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                Color de Acento
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: accent, display: "inline-block" }} />
                <code style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: isDark ? "#ffffff" : "#111822" }}>
                  {accent}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
