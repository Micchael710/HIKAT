import React, { useRef, useEffect } from "react"
import { useLauncherState } from "./hooks/useLauncherState"
import { getThemeTokens, CANVAS_W, CANVAS_H } from "./theme/tokens"
import LauncherTitlebar from "./components/layout/LauncherTitlebar"
import LauncherSidebar from "./components/layout/LauncherSidebar"
import UserProfileCard from "./components/layout/UserProfileCard"
import LoginView from "./views/LoginView"
import HomeView from "./views/HomeView"
import SkinsView from "./views/SkinsView"
import SettingsView from "./views/SettingsView"
import ProfileView from "./views/ProfileView"

export default function App() {
  const {
    screen,
    setScreen,
    username,
    view,
    setView,
    theme,
    setTheme,
    appliedSkin,
    setAppliedSkin,
    appliedCape,
    setAppliedCape,
    allSkins,
    playerSkin,
    handleUploadSkin,
    handleDeleteSkin,
    allCapes,
    playerCapes,
    handleUploadCape,
    handleDeleteCape,
    activeSkinData,
    activeSkinAccent,
    scale,
    handleLogin,
    handleLogout,
  } = useLauncherState()

  const [pendingAuthDeepLink, setPendingAuthDeepLink] = React.useState<string | null>(null)

  const [settingsAccent, setSettingsAccent] = React.useState<{
    r: number
    g: number
    b: number
    css: string
  }>({ r: 62, g: 196, b: 192, css: "62, 196, 192" })

  const tokens = getThemeTokens(theme)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Reset scroll to top (0) whenever switching views (Home, Skins, Settings, Profile)
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [view])

  // Listen for auth deep links (/verify-email, /reset-password) when user is authenticated inside launcher
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onOAuthCallback) {
      return
    }

    const removeListener = window.electronAPI.onOAuthCallback((rawUrl: string) => {
      try {
        const urlObj = new URL(rawUrl)
        if (urlObj.protocol !== "hikat:") return
        const host = urlObj.hostname || urlObj.host
        if (host !== "auth") return
        const cleanPath = urlObj.pathname.replace(/\/+$/, "")

        if (cleanPath === "/verify-email" || cleanPath === "/reset-password") {
          if (screen !== "login") {
            setPendingAuthDeepLink(rawUrl)
            setScreen("login")
          }
        }
      } catch (_) {}
    })

    return () => {
      removeListener?.()
    }
  }, [screen, setScreen])

  // Desktop Application Protections (Prevent browser menu, accidental drag-drop, and web shortcuts)
  useEffect(() => {
    // 1. Context Menu: Block browser context menu everywhere except editable text fields
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      if (!isInput) {
        e.preventDefault()
      }
    }

    // 2. Drag & Drop: Prevent browser from navigating or opening dropped files globally
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
    }

    // 3. Prevent accidental browser navigation shortcuts (F5, Ctrl+R, etc.)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "r" && (e.ctrlKey || e.metaKey)) ||
        e.key === "F5" ||
        (e.key === "F12" && import.meta.env.PROD)
      ) {
        e.preventDefault()
      }
    }

    window.addEventListener("contextmenu", handleContextMenu)
    window.addEventListener("dragover", handleDragOver)
    window.addEventListener("drop", handleDrop)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu)
      window.removeEventListener("dragover", handleDragOver)
      window.removeEventListener("drop", handleDrop)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  if (screen === "login") {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          position: "relative",
          overflow: "hidden",
          minWidth: 1024,
          minHeight: 576,
        }}
      >
        <LauncherTitlebar theme={theme} />
        <LoginView
          onLogin={handleLogin}
          theme={theme}
          initialDeepLinkUrl={pendingAuthDeepLink}
          onConsumeInitialDeepLink={() => setPendingAuthDeepLink(null)}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: tokens.bgBase,
        position: "relative",
        overflow: "hidden",
        minWidth: 1024,
        minHeight: 576,
        animation: "screenFadeIn 0.35s ease",
      }}
    >
      {/* Desktop App Window Controls Overlay */}
      <LauncherTitlebar theme={theme} />

      {/* Main Canvas Host Container */}
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          animation:
            "worldEntrance 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        {/* Scrollable zoomed canvas */}
        <div
          ref={scrollContainerRef}
          style={{
            width: "100%",
            height: "100%",
            overflowY: view === "home" ? "auto" : "hidden",
            overflowX: "hidden",
            scrollbarWidth: "none",
          }}
        >
          <div
            ref={(el) => {
              if (el) el.style.zoom = String(scale)
            }}
            style={{
              width: CANVAS_W,
              height: view === "home" ? CANVAS_H : 1080,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ display: view === "home" ? "block" : "none" }}>
              <HomeView
                theme={theme}
                isActive={view === "home"}
              />
            </div>
            {view === "skins" && (
              <SkinsView
                username={username}
                appliedSkin={appliedSkin}
                setAppliedSkin={setAppliedSkin}
                appliedCape={appliedCape}
                setAppliedCape={setAppliedCape}
                allSkins={allSkins}
                playerSkin={playerSkin}
                onUploadSkin={handleUploadSkin}
                onDeleteSkin={handleDeleteSkin}
                allCapes={allCapes}
                playerCapes={playerCapes}
                onUploadCape={handleUploadCape}
                onDeleteCape={handleDeleteCape}
                theme={theme}
              />
            )}

            {view === "settings" && (
              <SettingsView
                theme={theme}
                setTheme={setTheme}
                onSidebarAccentChange={setSettingsAccent}
              />
            )}
            {view === "profile" && (
              <ProfileView
                username={username}
                activeSkinData={activeSkinData}
                onBack={() => setView("home")}
                onLogout={handleLogout}
                theme={theme}
              />
            )}
          </div>
        </div>

        {/* Fixed UI Overlay: Navigation Sidebar + User Profile Dropdown */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 100,
          }}
        >
          {/* Frosted Glass Sidebar Backdrop Blur on Home view */}
          {view === "home" && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: Math.round(140 * scale),
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                background: tokens.isDark
                  ? "linear-gradient(to right, rgba(26, 34, 40, 0.6) 0%, rgba(26, 34, 40, 0.25) 60%, transparent 100%)"
                  : "linear-gradient(to right, rgba(238, 242, 246, 0.75) 0%, rgba(238, 242, 246, 0.35) 60%, transparent 100%)",
                maskImage:
                  "linear-gradient(to right, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 0) 100%)",
                WebkitMaskImage:
                  "linear-gradient(to right, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 0) 100%)",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Left Navigation Sidebar */}
          <LauncherSidebar
            view={view}
            setView={setView}
            s={scale}
            theme={theme}
            activeSkinAccent={activeSkinAccent}
            settingsAccent={settingsAccent}
          />

          {/* Top-Right Profile Card / Menu (Positioned with clean breathing room beneath window controls) */}
          <div
            style={{
              position: "absolute",
              top: Math.round(56 * scale),
              right: Math.round(18 * scale),
              pointerEvents: "auto",
              animation:
                "profileCardSlideDown 0.52s cubic-bezier(0.16, 1, 0.3, 1) 0.34s both",
            }}
          >
            <UserProfileCard
              username={username}
              activeSkinData={activeSkinData}
              s={scale}
              onLogout={handleLogout}
              onOpenProfile={() => setView("profile")}
              theme={theme}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
