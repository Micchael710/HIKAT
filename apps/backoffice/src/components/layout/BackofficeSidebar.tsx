import React from "react"
import type { ThemeMode, BackofficeSection } from "../../types"
import {
  HikatLogoIcon,
  IconDashboard,
  IconNews,
  IconShirt,
  IconServer,
  IconGamepad,
  IconSettings,
} from "../../theme/icons"

interface BackofficeSidebarProps {
  section: BackofficeSection
  setSection: (section: BackofficeSection) => void
  theme: ThemeMode
}

export default function BackofficeSidebar({
  section,
  setSection,
  theme,
}: BackofficeSidebarProps) {
  const isDark = theme === "dark"
  const BTN_SIZE = 48
  const ICON_SIZE = 22

  const navItems: { key: BackofficeSection; label: string; icon: React.ReactNode }[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: <IconDashboard size={ICON_SIZE} />,
    },
    {
      key: "news",
      label: "Noticias",
      icon: <IconNews size={ICON_SIZE} />,
    },
    {
      key: "skins",
      label: "Skins",
      icon: <IconShirt size={ICON_SIZE} />,
    },
    {
      key: "server",
      label: "Servidor",
      icon: <IconServer size={ICON_SIZE} />,
    },
    {
      key: "game",
      label: "Juego",
      icon: <IconGamepad size={ICON_SIZE} />,
    },
    {
      key: "settings",
      label: "Ajustes",
      icon: <IconSettings size={ICON_SIZE} />,
    },
  ]

  return (
    <aside
      style={{
        width: 80,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 0 24px",
        background: isDark
          ? "rgba(12, 17, 22, 0.88)"
          : "rgba(255, 255, 255, 0.9)",
        borderRight: isDark
          ? "1.5px solid rgba(255, 255, 255, 0.08)"
          : "1.5px solid rgba(0, 0, 0, 0.08)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 50,
        position: "relative",
      }}
    >
      {/* Top Logo */}
      <div
        onClick={() => setSection("news")}
        title="HiKAT Back Office"
        style={{
          width: 44,
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: isDark ? "#ffffff" : "#111822",
          transition: "transform 0.18s ease",
          animation: "topLogoSlideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <HikatLogoIcon size={38} />
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
        {navItems.map(({ key, label, icon }) => {
          const active = section === key
          const itemColor = { r: 62, g: 196, b: 192, css: "62, 196, 192" }

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
                    background: `radial-gradient(circle at 50% 50%, rgba(${itemColor.r}, ${itemColor.g}, ${itemColor.b}, 0.5) 0%, rgba(${itemColor.r}, ${itemColor.g}, ${itemColor.b}, 0.12) 50%, transparent 72%)`,
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
                    ? `1.5px solid rgba(${itemColor.css}, 0.6)`
                    : "1.5px solid transparent",
                  background: active
                    ? `rgba(${itemColor.r}, ${itemColor.g}, ${itemColor.b}, 0.16)`
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

      {/* Bottom spacer / indicator */}
      <div style={{ height: 20 }} />
    </aside>
  )
}
