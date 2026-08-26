import React from "react"
import type { ThemeMode, AdminUser } from "../../types"
import { IconMoon, IconSun, IconUser, IconLogout } from "../../theme/icons"

interface BackofficeHeaderProps {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  user: AdminUser | null
  onLogout: () => void
}

export default function BackofficeHeader({
  theme,
  setTheme,
  user,
  onLogout,
}: BackofficeHeaderProps) {
  const isDark = theme === "dark"

  return (
    <header
      style={{
        height: 64,
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: isDark
          ? "1.5px solid rgba(255, 255, 255, 0.08)"
          : "1.5px solid rgba(0, 0, 0, 0.08)",
        background: isDark
          ? "rgba(18, 26, 34, 0.75)"
          : "rgba(255, 255, 255, 0.8)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        zIndex: 40,
        position: "relative",
      }}
    >
      {/* Branding Title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: isDark ? "#ffffff" : "#111822",
            fontFamily: "Inter, sans-serif",
          }}
        >
          HiKAT Back Office
        </h1>
      </div>

      {/* Right Controls: Theme Toggle + User / Logout Pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "Modo Claro" : "Modo Oscuro"}
          className="launcher-btn-secondary"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>

        {/* Admin User Info & Logout Button */}
        {user && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 6px 4px 12px",
              borderRadius: 14,
              background: isDark ? "#0d1217" : "#e6ebf0",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  color: isDark ? "rgba(255,255,255,0.7)" : "#556677",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <IconUser size={15} />
              </span>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                {user.displayName || user.minecraftUsername || "Administrador"}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "rgba(62, 196, 192, 0.18)",
                  color: "#3ec4c0",
                }}
              >
                Admin
              </span>
            </div>

            <button
              type="button"
              onClick={onLogout}
              title="Cerrar sesión"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#ff6b5b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "background 0.16s ease",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(255, 60, 40, 0.15)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <IconLogout size={15} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
