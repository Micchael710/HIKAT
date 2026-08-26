import React, { useState } from "react"
import type { ThemeMode } from "../../types"
import { HikatLogoIcon, IconSpinner, IconMoon, IconSun } from "../../theme/icons"
import { useAuth } from "../../context/AuthContext"

interface LoginViewProps {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
}

export default function LoginView({ theme, setTheme }: LoginViewProps) {
  const { login, isLoading } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isDark = theme === "dark"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!email.trim() || !password) {
      setErrorMessage("Por favor ingrese su correo electrónico y contraseña.")
      return
    }

    try {
      await login(email.trim(), password)
    } catch (err: any) {
      setErrorMessage(err.message || "Error al iniciar sesión.")
    }
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isDark ? "#090d12" : "#f5f7fa",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background ambient glow orbs */}
      <div
        className="backoffice-bg-orb-1"
        style={{
          position: "absolute",
          top: "10%",
          left: "25%",
          width: 600,
          height: 600,
          background: `radial-gradient(circle, rgba(62, 196, 192, ${
            isDark ? 0.15 : 0.08
          }) 0%, transparent 68%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />
      <div
        className="backoffice-bg-orb-2"
        style={{
          position: "absolute",
          bottom: "10%",
          right: "25%",
          width: 500,
          height: 500,
          background: `radial-gradient(circle, rgba(239, 196, 54, ${
            isDark ? 0.12 : 0.06
          }) 0%, transparent 68%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      {/* Theme Toggle in top-right */}
      <div style={{ position: "absolute", top: 24, right: 24, zIndex: 10 }}>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "Modo Claro" : "Modo Oscuro"}
          className="launcher-btn-secondary"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>
      </div>

      {/* Login Card */}
      <div
        style={{
          width: 420,
          maxWidth: "92vw",
          padding: "40px 36px",
          background: isDark ? "#121a22" : "#ffffff",
          borderRadius: 22,
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.1)"
            : "1.5px solid rgba(0, 0, 0, 0.08)",
          boxShadow: isDark
            ? "0 20px 60px rgba(0, 0, 0, 0.6)"
            : "0 16px 48px rgba(0, 0, 0, 0.1)",
          position: "relative",
          zIndex: 1,
          animation: "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Header Branding */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 28,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: isDark ? "#0d1217" : "#eef2f6",
              border: isDark
                ? "1.5px solid rgba(62, 196, 192, 0.4)"
                : "1.5px solid rgba(62, 196, 192, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isDark ? "#ffffff" : "#111822",
              marginBottom: 16,
              boxShadow: "0 0 20px rgba(62, 196, 192, 0.2)",
            }}
          >
            <HikatLogoIcon size={36} />
          </div>

          <h2
            style={{
              margin: "0 0 6px",
              fontSize: 22,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
              letterSpacing: "-0.02em",
            }}
          >
            HiKAT Back Office
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 500,
              color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
            }}
          >
            Panel de Administración
          </p>
        </div>

        {/* Error alert */}
        {errorMessage && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(255, 60, 40, 0.12)",
              border: "1.5px solid rgba(255, 100, 80, 0.4)",
              color: "#ff6b5b",
              fontSize: 13.5,
              fontWeight: 600,
              marginBottom: 20,
              animation: "fadeIn 0.2s ease",
              lineHeight: 1.4,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 18 }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                marginBottom: 8,
                fontSize: 13.5,
                fontWeight: 700,
                color: isDark ? "rgba(255, 255, 255, 0.85)" : "#223344",
              }}
            >
              Correo Electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@hikat.org"
              disabled={isLoading}
              className="launcher-input"
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                borderRadius: 12,
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                  : "1.5px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 14.5,
                fontWeight: 500,
              }}
            />
          </div>

          <div style={{ marginBottom: 26 }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: 8,
                fontSize: 13.5,
                fontWeight: 700,
                color: isDark ? "rgba(255, 255, 255, 0.85)" : "#223344",
              }}
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
              className="launcher-input"
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                borderRadius: 12,
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                  : "1.5px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 14.5,
                fontWeight: 500,
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="launcher-btn-primary"
            style={{
              width: "100%",
              height: 46,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {isLoading ? (
              <>
                <IconSpinner size={18} />
                <span>Iniciando sesión...</span>
              </>
            ) : (
              <span>Ingresar</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
