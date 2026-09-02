import React, { useState, useEffect } from "react"
import type { ThemeMode, BackofficeSection, GameHandoffPayload } from "./types"
import { AuthProvider, useAuth } from "./context/AuthContext"
import LoginView from "./components/auth/LoginView"
import BackofficeSidebar from "./components/layout/BackofficeSidebar"
import BackofficeHeader from "./components/layout/BackofficeHeader"
import PlaceholderView from "./components/layout/PlaceholderView"
import NewsListView from "./components/news/NewsListView"
import ServerOverviewView from "./components/server/ServerOverviewView"
import DashboardView from "./components/dashboard/DashboardView"
import SkinsView from "./components/skins/SkinsView"
import GameView from "./components/game/GameView"
import SettingsView from "./components/settings/SettingsView"

function BackofficeShell({
  theme,
  setTheme,
}: {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
}) {
  const { user, isAuthenticated, logout } = useAuth()
  const [section, setSection] = useState<BackofficeSection>("dashboard")
  const [gameHandoff, setGameHandoff] = useState<GameHandoffPayload | null>(null)
  const isDark = theme === "dark"

  // If not authenticated, show Login View
  if (!isAuthenticated) {
    return <LoginView theme={theme} setTheme={setTheme} />
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        background: isDark ? "#090d12" : "#f5f7fa",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Dynamic Ambient Glow Background Orbs (Launcher Aesthetic) */}
      <div
        className="backoffice-bg-orb-1"
        style={{
          position: "absolute",
          top: "-15%",
          left: "20%",
          width: 700,
          height: 700,
          background: `radial-gradient(circle, rgba(62, 196, 192, ${
            isDark ? 0.16 : 0.08
          }) 0%, transparent 68%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        className="backoffice-bg-orb-2"
        style={{
          position: "absolute",
          bottom: "-15%",
          right: "15%",
          width: 750,
          height: 750,
          background: `radial-gradient(circle, rgba(62, 196, 192, ${
            isDark ? 0.12 : 0.06
          }) 0%, transparent 68%)`,
          filter: "blur(70px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Left Navigation Sidebar */}
      <BackofficeSidebar
        section={section}
        setSection={setSection}
        theme={theme}
      />

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          zIndex: 1,
          minWidth: 0,
        }}
      >
        {/* Top Header */}
        <BackofficeHeader
          theme={theme}
          setTheme={setTheme}
          user={user}
          onLogout={logout}
        />

        {/* View Router */}
        <main style={{ flex: 1, height: "calc(100vh - 64px)", overflowY: "auto", position: "relative" }}>
          {section === "dashboard" && <DashboardView theme={theme} onNavigate={setSection} />}
          {section === "news" && <NewsListView theme={theme} />}
          {section === "skins" && <SkinsView theme={theme} />}
          {section === "server" && (
            <ServerOverviewView
              theme={theme}
              onNavigate={(sec, handoff) => {
                setSection(sec)
                setGameHandoff(handoff || null)
              }}
            />
          )}
          {section === "game" && (
            <GameView
              theme={theme}
              handoff={gameHandoff}
              onClearHandoff={() => setGameHandoff(null)}
            />
          )}
          {section === "settings" && <SettingsView theme={theme} />}
        </main>
      </div>
    </div>
  )
}


export default function App() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem("hikat_backoffice_theme")
      return saved === "light" ? "light" : "dark"
    } catch {
      return "dark"
    }
  })

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme)
    try {
      localStorage.setItem("hikat_backoffice_theme", newTheme)
    } catch {}
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])

  return (
    <AuthProvider>
      <BackofficeShell theme={theme} setTheme={setTheme} />
    </AuthProvider>
  )
}
