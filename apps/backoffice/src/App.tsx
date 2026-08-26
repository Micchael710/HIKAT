import React, { useState, useEffect } from "react"
import type { ThemeMode, BackofficeSection } from "./types"
import { AuthProvider, useAuth } from "./context/AuthContext"
import LoginView from "./components/auth/LoginView"
import BackofficeSidebar from "./components/layout/BackofficeSidebar"
import BackofficeHeader from "./components/layout/BackofficeHeader"
import PlaceholderView from "./components/layout/PlaceholderView"
import NewsListView from "./components/news/NewsListView"
import {
  IconDashboard,
  IconShirt,
  IconServer,
  IconGamepad,
  IconSettings,
} from "./theme/icons"

function BackofficeShell({
  theme,
  setTheme,
}: {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
}) {
  const { user, isAuthenticated, logout } = useAuth()
  const [section, setSection] = useState<BackofficeSection>("news")
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
        <main style={{ flex: 1, height: "calc(100vh - 64px)", overflow: "hidden", position: "relative" }}>
          {section === "news" && <NewsListView theme={theme} />}

          {section === "dashboard" && (
            <PlaceholderView
              title="Dashboard"
              icon={<IconDashboard size={36} />}
              theme={theme}
            />
          )}

          {section === "skins" && (
            <PlaceholderView
              title="Skins"
              icon={<IconShirt size={36} />}
              theme={theme}
            />
          )}

          {section === "server" && (
            <PlaceholderView
              title="Servidor"
              icon={<IconServer size={36} />}
              theme={theme}
            />
          )}

          {section === "game" && (
            <PlaceholderView
              title="Juego"
              icon={<IconGamepad size={36} />}
              theme={theme}
            />
          )}

          {section === "settings" && (
            <PlaceholderView
              title="Ajustes"
              icon={<IconSettings size={36} />}
              theme={theme}
            />
          )}
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
