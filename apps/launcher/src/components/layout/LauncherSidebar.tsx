import React from "react"
import { ThemeMode, LauncherView } from "../../types"
import { IconShirt, IconSettings, IconDownload } from "../../theme/icons"
import { getThemeTokens } from "../../theme/tokens"
import { useTranslation } from "../../context/LanguageContext"
import type { LauncherServer } from "../../services/serverService"
import { resolveApiAssetUrl } from "../../config/api"

interface LauncherSidebarProps {
  view: LauncherView
  setView: (view: LauncherView) => void
  s: number
  theme: ThemeMode
  activeSkinAccent: { r: number; g: number; b: number; css: string }
  settingsAccent?: { r: number; g: number; b: number; css: string }
  homeAccent?: { r: number; g: number; b: number; css: string }
  servers?: LauncherServer[]
  selectedGameId?: string | null
  onSelectServer?: (id: string) => void
}

export default function LauncherSidebar({
  view,
  setView,
  s,
  theme,
  activeSkinAccent,
  settingsAccent,
  homeAccent,
  servers,
  selectedGameId,
  onSelectServer,
}: LauncherSidebarProps) {
  const { t } = useTranslation()
  const tokens = getThemeTokens(theme)
  const SIDEBAR_CENTER_X = 46
  const BTN_PX = Math.round(48 * s)
  const ICON_PX = Math.round(24 * s)
  const LOGO_SIZE = Math.round(48 * s)
  const defaultAccent = { r: 62, g: 196, b: 192, css: "62, 196, 192" }
  const effectiveHomeAccent = homeAccent || defaultAccent

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
        {/* Dynamic Server Buttons */}
        {servers &&
          servers.map((server) => {
            const active = view === "home" && selectedGameId === server.id
            const itemColor = effectiveHomeAccent
            const logoRaw = server.sidebarLogo?.url || server.mainLogo?.url || null
            const logoUrl = logoRaw ? resolveApiAssetUrl(logoRaw) : null

            return (
              <div
                key={server.id}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
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

                <button
                  type="button"
                  onClick={() => {
                    onSelectServer?.(server.id)
                    setView("home")
                  }}
                  title={server.name}
                  aria-label={server.name}
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
                    padding: Math.round(8 * s),
                    overflow: "hidden",
                  }}
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={server.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        borderRadius: Math.round(6 * s),
                      }}
                    />
                  ) : null}
                </button>
              </div>
            )
          })}

        {/* Skins Button */}
        {(() => {
          const active = view === "skins"
          const itemColor = activeSkinAccent
          return (
            <div
              key="skins"
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
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

              <button
                type="button"
                onClick={() => setView("skins")}
                title={t("nav.skins")}
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
                <IconShirt active={active} size={ICON_PX} />
              </button>
            </div>
          )
        })()}

        {/* Settings Button */}
        {(() => {
          const active = view === "settings"
          const itemColor = settingsAccent || defaultAccent
          return (
            <div
              key="settings"
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
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

              <button
                type="button"
                onClick={() => setView("settings")}
                title={t("nav.settings")}
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
                <IconSettings active={active} size={ICON_PX} />
              </button>
            </div>
          )
        })()}
      </div>

      {/* Standalone Downloads Button at Bottom of Sidebar */}
      {(() => {
        const active = view === "downloads"
        const itemColor = defaultAccent
        return (
          <div
            key="downloads"
            style={{
              position: "absolute",
              bottom: Math.round(24 * s),
              left: Math.round(SIDEBAR_CENTER_X * s - BTN_PX / 2),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
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

            <button
              type="button"
              onClick={() => setView("downloads")}
              title={t("nav.downloads")}
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
              <IconDownload size={ICON_PX} />
            </button>
          </div>
        )
      })()}
    </>
  )
}
