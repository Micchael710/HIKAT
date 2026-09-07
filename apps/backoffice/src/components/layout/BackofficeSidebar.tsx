import React from "react"
import type { ThemeMode, BackofficeSection, ServerItem } from "../../types"
import logoReducedWhite from "../../assets/branding/logo-reduced-white.png"
import logoReducedBlack from "../../assets/branding/logo-reduced-black.png"
import {
  IconDashboard,
  IconNews,
  IconShirt,
  IconServer,
  IconGamepad,
  IconSettings,
  IconArrowLeft,
} from "../../theme/icons"

interface BackofficeSidebarProps {
  section: BackofficeSection
  setSection: (section: BackofficeSection) => void
  theme: ThemeMode
  selectedServer: ServerItem | null
  onExitWorkspace: () => void
}

export default function BackofficeSidebar({
  section,
  setSection,
  theme,
  selectedServer,
  onExitWorkspace,
}: BackofficeSidebarProps) {
  const isDark = theme === "dark"
  const BTN_SIZE = 48

  // Global navigation items
  const globalNavItems: { key: BackofficeSection; label: string; icon: React.ReactNode }[] = [
    {
      key: "servers",
      label: "Servidores",
      icon: <IconServer size={24} />,
    },
    {
      key: "skins",
      label: "Skins",
      icon: <IconShirt size={24} />,
    },
    {
      key: "settings",
      label: "Configuración",
      icon: <IconSettings size={24} />,
    },
  ]

  // Server Workspace navigation items
  const workspaceNavItems: { key: BackofficeSection; label: string; icon: React.ReactNode }[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: <IconDashboard size={24} />,
    },
    {
      key: "news",
      label: "Noticias",
      icon: <IconNews size={24} />,
    },
    {
      key: "server",
      label: "Servidor",
      icon: <IconServer size={24} />,
    },
    {
      key: "game",
      label: "Juego",
      icon: <IconGamepad size={24} />,
    },
    {
      key: "server-settings",
      label: "Ajustes del Servidor",
      icon: <IconSettings size={24} />,
    },
  ]

  const isWorkspace = selectedServer !== null
  const currentNavItems = isWorkspace ? workspaceNavItems : globalNavItems
  const accentHex = selectedServer?.accentColor || "#3ec4c0"

  return (
    <aside
      style={{
        width: 80,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 0",
        background: isDark
          ? "linear-gradient(180deg, #131c23 0%, #0d141a 100%)"
          : "linear-gradient(180deg, #ffffff 0%, #f0f3f6 100%)",
        borderRight: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
        boxShadow: isDark
          ? "4px 0 24px rgba(0, 0, 0, 0.35)"
          : "4px 0 24px rgba(0, 0, 0, 0.04)",
        zIndex: 20,
        userSelect: "none",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {/* Top Section: Logo or Back Button */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div
          onClick={isWorkspace ? onExitWorkspace : () => setSection("servers")}
          title={isWorkspace ? "Volver a lista de servidores" : "HiKAT Back Office"}
          style={{
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "transform 0.18s ease",
            animation: "topLogoSlideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          <img
            src={isDark ? logoReducedWhite : logoReducedBlack}
            alt="HiKAT Logo"
            style={{
              width: 38,
              height: 38,
              objectFit: "contain",
              userSelect: "none",
            }}
            draggable={false}
          />
        </div>

        {/* Back to Servers Button (when in workspace) */}
        {isWorkspace && (
          <button
            type="button"
            onClick={onExitWorkspace}
            title="Volver a servidores"
            className="sidebar-nav-btn"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
              background: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)",
              color: isDark ? "#ffffff" : "#111822",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.16s ease",
            }}
          >
            <IconArrowLeft size={17} />
          </button>
        )}
      </div>

      {/* Navigation Buttons Center */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          animation: "sidebarNavSlideDown 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {currentNavItems.map(({ key, label, icon }) => {
          const active = section === key

          return (
            <div
              key={key}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Radial glow for active item */}
              {active && (
                <div
                  style={{
                    position: "absolute",
                    inset: -10,
                    background: `radial-gradient(circle at 50% 50%, rgba(62, 196, 192, 0.5) 0%, rgba(62, 196, 192, 0.12) 50%, transparent 72%)`,
                    filter: "blur(8px)",
                    pointerEvents: "none",
                    zIndex: 0,
                    animation: "fadeIn 0.2s ease",
                  }}
                />
              )}

              <button
                type="button"
                onClick={() => setSection(key)}
                title={label}
                className={`sidebar-nav-btn ${active ? "is-active" : ""}`}
                style={{
                  width: BTN_SIZE,
                  height: BTN_SIZE,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  position: "relative",
                  zIndex: 1,
                  borderRadius: 14,
                  border: active
                    ? `1.5px solid rgba(62, 196, 192, 0.6)`
                    : "1.5px solid transparent",
                  background: active
                    ? `rgba(62, 196, 192, 0.16)`
                    : "transparent",
                  color: active
                    ? isDark ? "#ffffff" : "#0c6e6b"
                    : isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.45)",
                }}
              >
                {icon}
              </button>
            </div>
          )
        })}
      </div>

      {/* Bottom spacer / Server indicator */}
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isWorkspace && (
          <div
            title={`Servidor activo: ${selectedServer?.name}`}
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: accentHex,
              boxShadow: `0 0 10px ${accentHex}`,
            }}
          />
        )}
      </div>
    </aside>
  )
}

