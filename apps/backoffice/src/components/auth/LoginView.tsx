import React, { useState, useEffect } from "react"
import type { ThemeMode } from "../../types"
import logoWhite from "../../assets/branding/logo-white.png"
import logoBlack from "../../assets/branding/logo-black.png"
import { IconSpinner, IconMoon, IconSun, IconGoogle, IconDiscord } from "../../theme/icons"
import { useAuth } from "../../context/AuthContext"

interface LoginViewProps {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
}

export default function LoginView({ theme, setTheme }: LoginViewProps) {
  const { login, initiateOAuth, handleOAuthCallback, isLoading } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isDark = theme === "dark"

  // Process web OAuth PKCE callback if URL contains code & state
  useEffect(() => {
    const search = window.location.search
    if (!search) return

    const params = new URLSearchParams(search)
    const code = params.get("code")
    const state = params.get("state")
    const error = params.get("error")

    if (error) {
      if (error === "EMAIL_CONFLICT_LINK_REQUIRED") {
        setErrorMessage("Este correo ya está registrado. Por favor inicia sesión con tu contraseña.")
      } else {
        setErrorMessage("Error de autenticación con el proveedor OAuth.")
      }
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    if (code && state) {
      const storedVerifier = sessionStorage.getItem("hikat_oauth_verifier") || ""
      const storedState = sessionStorage.getItem("hikat_oauth_state") || ""

      sessionStorage.removeItem("hikat_oauth_verifier")
      sessionStorage.removeItem("hikat_oauth_state")

      window.history.replaceState({}, document.title, window.location.pathname)

      handleOAuthCallback({
        code,
        codeVerifier: storedVerifier,
        state,
        expectedState: storedState,
      }).catch((err) => {
        setErrorMessage(err.message || "Error al completar inicio de sesión OAuth.")
      })
    }
  }, [handleOAuthCallback])

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

  const handleOAuthClick = async (provider: "GOOGLE" | "DISCORD") => {
    setErrorMessage(null)
    try {
      await initiateOAuth(provider)
    } catch (err: any) {
      setErrorMessage(err.message || "No se pudo iniciar el flujo de autenticación.")
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
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Background glow orbs */}
      <div
        className="backoffice-bg-orb-1"
        style={{
          position: "absolute",
          top: "10%",
          left: "25%",
          width: 500,
          height: 500,
          background: `radial-gradient(circle, rgba(62, 196, 192, ${
            isDark ? 0.18 : 0.09
          }) 0%, transparent 70%)`,
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
          width: 550,
          height: 550,
          background: `radial-gradient(circle, rgba(62, 196, 192, ${
            isDark ? 0.12 : 0.06
          }) 0%, transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      {/* Top right theme toggle */}
      <button
        onClick={() => setTheme(isDark ? "light" : "dark")}
        style={{
          position: "absolute",
          top: 24,
          right: 24,
          width: 40,
          height: 40,
          borderRadius: 12,
          border: `1px solid ${
            isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
          }`,
          background: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)",
          color: isDark ? "#ffffff" : "#111822",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "all 0.18s ease",
          zIndex: 10,
        }}
        title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      >
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </button>

      {/* Login Card */}
      <div
        className="launcher-card"
        style={{
          width: 430,
          maxWidth: "92vw",
          padding: "36px 32px",
          borderRadius: 20,
          background: isDark
            ? "linear-gradient(180deg, rgba(19, 28, 35, 0.95) 0%, rgba(13, 20, 26, 0.95) 100%)"
            : "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(245, 248, 250, 0.98) 100%)",
          border: `1px solid ${
            isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)"
          }`,
          boxShadow: isDark
            ? "0 24px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(62, 196, 192, 0.1)"
            : "0 24px 60px rgba(0, 0, 0, 0.08), 0 0 30px rgba(62, 196, 192, 0.06)",
          backdropFilter: "blur(20px)",
          position: "relative",
          zIndex: 5,
          animation: "scaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Header Branding */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <img
              src={isDark ? logoWhite : logoBlack}
              alt="HiKAT Logo"
              style={{
                height: 44,
                maxWidth: 240,
                objectFit: "contain",
                userSelect: "none",
              }}
              draggable={false}
            />
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

        {/* OAuth Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleOAuthClick("GOOGLE")}
            style={{
              width: "100%",
              height: 42,
              borderRadius: 12,
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.12)"
                : "1.5px solid rgba(0, 0, 0, 0.12)",
              background: isDark ? "#0d1217" : "#ffffff",
              color: isDark ? "#ffffff" : "#111822",
              fontSize: 13.5,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: "pointer",
              transition: "all 0.16s ease",
            }}
          >
            <IconGoogle size={18} />
            <span>Continuar con Google</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleOAuthClick("DISCORD")}
            style={{
              width: "100%",
              height: 42,
              borderRadius: 12,
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.12)"
                : "1.5px solid rgba(0, 0, 0, 0.12)",
              background: isDark ? "#0d1217" : "#ffffff",
              color: isDark ? "#ffffff" : "#111822",
              fontSize: 13.5,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: "pointer",
              transition: "all 0.16s ease",
            }}
          >
            <IconDiscord size={18} />
            <span>Continuar con Discord</span>
          </button>
        </div>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" }} />
          <span style={{ fontSize: 12, color: isDark ? "#657788" : "#8899aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            o con credenciales
          </span>
          <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: 13,
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
                height: 42,
                padding: "0 14px",
                borderRadius: 12,
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                  : "1.5px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 14,
                fontWeight: 500,
              }}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: 6,
                fontSize: 13,
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
                height: 42,
                padding: "0 14px",
                borderRadius: 12,
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                  : "1.5px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 14,
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
              height: 44,
              borderRadius: 12,
              fontSize: 14.5,
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
