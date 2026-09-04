import React from "react"
import { ThemeMode, LauncherView } from "../../types"
import { IconHome, IconShirt, IconSettings } from "../../theme/icons"
import { getThemeTokens } from "../../theme/tokens"
import { useTranslation } from "../../context/LanguageContext"

interface LauncherSidebarProps {
  view: LauncherView
  setView: (view: LauncherView) => void
  s: number
  theme: ThemeMode
  activeSkinAccent: { r: number; g: number; b: number; css: string }
  settingsAccent?: { r: number; g: number; b: number; css: string }
}

export default function LauncherSidebar({
  view,
  setView,
  s,
  theme,
  activeSkinAccent,
  settingsAccent,
}: LauncherSidebarProps) {
  const { t } = useTranslation()
  const tokens = getThemeTokens(theme)
  const SIDEBAR_CENTER_X = 46
  const BTN_PX = Math.round(48 * s)
  const ICON_PX = Math.round(24 * s)
  const LOGO_SIZE = Math.round(48 * s)

  const navItems = [
    {
      icon: "home" as const,
      viewKey: "home" as LauncherView,
      label: t("nav.home"),
    },
    {
      icon: "shirt" as const,
      viewKey: "skins" as LauncherView,
      label: t("nav.skins"),
    },
    {
      icon: "gear" as const,
      viewKey: "settings" as LauncherView,
      label: t("nav.settings"),
    },
  ]

  return (
    <>
      {/* Brand Logo at Top-Left */}
      <div
        style={{
          position: "absolute",
          top: Math.round(20 * s),
          left: Math.round(SIDEBAR_CENTER_X * s - LOGO_SIZE / 2),
          width: LOGO_SIZE,
          height: LOGO_SIZE,
          pointerEvents: "auto",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.18s ease",
          animation:
            "topLogoSlideDown 0.48s cubic-bezier(0.16, 1, 0.3, 1) 0.28s both",
        }}
        onClick={() => setView("home")}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.06)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)"
        }}
      >
        <img
          src={tokens.logoReduced}
          alt="HiKAT Logo"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>

      {/* Vertical Navigation Bar — Vertically centered in the launcher */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: Math.round(SIDEBAR_CENTER_X * s - BTN_PX / 2),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: Math.round(18 * s),
          pointerEvents: "none",
          animation:
            "sidebarNavSlideDown 0.52s cubic-bezier(0.16, 1, 0.3, 1) 0.34s both",
        }}
      >
        {navItems.map(({ icon, viewKey, label }) => {
          const active = view === viewKey
          const itemColor =
            icon === "home"
              ? { r: 239, g: 196, b: 54, css: "239, 196, 54" }
              : icon === "shirt"
                ? activeSkinAccent
                : (settingsAccent || { r: 62, g: 196, b: 192, css: "62, 196, 192" })

          return (
            <div
              key={icon}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Radial glow behind active button */}
              {active && (
                <div
                  style={{
                    position: "absolute",
                    inset: -Math.round(14 * s),
                    background: `radial-gradient(circle at 50% 50%, rgba(${itemColor.r}, ${itemColor.g}, ${itemColor.b}, 0.55) 0%, rgba(${itemColor.r}, ${itemColor.g}, ${itemColor.b}, 0.16) 45%, transparent 72%)`,
                    filter: "blur(10px)",
                    pointerEvents: "none",
                    zIndex: 0,
                    animation: "fadeIn 0.25s ease",
                  }}
                />
              )}

              {/* Squircle Button */}
              <button
                type="button"
                onClick={() => setView(viewKey)}
                title={label}
                className={`sidebar-nav-btn ${active ? "is-active" : ""}`}
                style={{
                  width: BTN_PX,
                  height: BTN_PX,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  position: "relative",
                  zIndex: 1,
                  borderRadius: Math.round(15 * s),
                  pointerEvents: "auto",
                  flexShrink: 0,
                  background: active
                    ? `rgba(${itemColor.r}, ${itemColor.g}, ${itemColor.b}, 0.18)`
                    : undefined,
                  borderColor: active
                    ? `rgba(${itemColor.css}, 0.5)`
                    : undefined,
                  boxShadow: active
                    ? `0 0 16px rgba(${itemColor.css}, 0.35), 0 4px 14px rgba(0, 0, 0, 0.4)`
                    : undefined,
                  transition:
                    "background 0.22s ease, border-color 0.22s ease, transform 0.18s ease, box-shadow 0.22s ease",
                }}
              >
                {icon === "home" && <IconHome active={active} size={ICON_PX} />}
                {icon === "shirt" && (
                  <IconShirt active={active} size={ICON_PX} />
                )}
                {icon === "gear" && (
                  <IconSettings active={active} size={ICON_PX} />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
