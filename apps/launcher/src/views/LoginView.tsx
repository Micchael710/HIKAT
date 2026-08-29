import React, { useState, useEffect, useRef } from "react"
import { ThemeMode } from "../types"
import { BASE_FONT } from "../theme/tokens"
import { loginBg, logoReducedWhite, logoReducedBlack } from "../assets"
import { IconGoogle, IconDiscord } from "../theme/icons"
import { useTranslation } from "../context/LanguageContext"
import {
  sanitizeUsername,
  sanitizeEmail,
  sanitizeInput,
} from "../utils/security"
import { authService } from "../services/authService"

const LAUNCHER_VERSION = "v1.0.0"

interface LoginViewProps {
  onLogin: (username: string) => void
  theme?: ThemeMode
}

export default function LoginView({ onLogin, theme = "dark" }: LoginViewProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [keepSession, setKeepSession] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<string | null>(null)
  const [isEnteringWorld, setIsEnteringWorld] = useState(false)
  const isDark = theme === "dark"

  const pendingOAuthRef = useRef<{ codeVerifier: string; state: string } | null>(null)

  const processOAuthCallbackUrl = async (rawUrl: string) => {
    try {
      const urlObj = new URL(rawUrl)
      const code = urlObj.searchParams.get("code")
      const state = urlObj.searchParams.get("state")
      const error = urlObj.searchParams.get("error")

      if (error) {
        if (error === "EMAIL_CONFLICT_LINK_REQUIRED") {
          setErrorMessage("Este correo electrónico ya está registrado. Por favor inicia sesión con tu contraseña.")
        } else {
          setErrorMessage("Error durante la autenticación externa.")
        }
        setIsEnteringWorld(false)
        return
      }

      if (!code || !state) {
        return
      }

      const pendingVerifier =
        pendingOAuthRef.current?.codeVerifier ||
        (typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem("hikat_launcher_oauth_verifier") || undefined
          : undefined)
      const expectedState =
        pendingOAuthRef.current?.state ||
        (typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem("hikat_launcher_oauth_state") || undefined
          : undefined)

      setIsEnteringWorld(true)
      const user = await authService.handleOAuthCallback({
        code,
        codeVerifier: pendingVerifier,
        state,
        expectedState,
      })

      pendingOAuthRef.current = null
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("hikat_launcher_oauth_verifier")
        sessionStorage.removeItem("hikat_launcher_oauth_state")
      }


      setTimeout(() => {
        onLogin(user.displayName || user.username)
      }, 350)
    } catch (err: any) {
      setIsEnteringWorld(false)
      setErrorMessage(err.message || "Error al completar autenticación.")
    }
  }

  // Listen for OAuth deep link callbacks via Electron IPC & check cold-start pending callbacks
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) {
      return
    }

    if (window.electronAPI.getPendingOAuthCallback) {
      window.electronAPI
        .getPendingOAuthCallback()
        .then((pendingUrl: string | null) => {
          if (pendingUrl) {
            processOAuthCallbackUrl(pendingUrl)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI.onOAuthCallback) {
      const removeListener = window.electronAPI.onOAuthCallback((rawUrl: string) => {
        processOAuthCallbackUrl(rawUrl)
      })

      return () => {
        removeListener?.()
      }
    }
  }, [onLogin])


  const handleOAuthClick = async (provider: "GOOGLE" | "DISCORD") => {
    setErrorMessage(null)
    setSuccessNotice(null)
    try {
      const { authUrl, codeVerifier, state } = await authService.initiateOAuth(provider)
      pendingOAuthRef.current = { codeVerifier, state }
      sessionStorage.setItem("hikat_launcher_oauth_verifier", codeVerifier)
      sessionStorage.setItem("hikat_launcher_oauth_state", state)

      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl)
      } else {
        window.open(authUrl, "_blank")
      }
    } catch (err: any) {
      setErrorMessage(err.message || "No se pudo iniciar el flujo de autenticación.")
    }
  }

  const handleSubmit = async () => {
    if (isEnteringWorld) return
    setErrorMessage(null)
    setSuccessNotice(null)

    if (tab === "login") {
      const cleanEmail = sanitizeEmail(email)
      const cleanPassword = password.trim()

      if (!cleanEmail) {
        setErrorMessage("Por favor ingresa tu correo electrónico.")
        return
      }
      if (!cleanPassword) {
        setErrorMessage("Por favor ingresa tu contraseña.")
        return
      }

      setIsEnteringWorld(true)
      const res = await authService.login({
        email: cleanEmail,
        password: cleanPassword,
        keepSession,
      })

      if (res.success && res.user) {
        const displayName = res.user.displayName || res.user.username || cleanEmail.split("@")[0]
        setTimeout(() => {
          onLogin(displayName)
        }, 350)
      } else {
        setIsEnteringWorld(false)
        setErrorMessage(res.error || "No se pudo iniciar sesión. Verifica tus credenciales.")
      }
    } else {
      const cleanUsername = sanitizeUsername(username)
      const cleanEmail = sanitizeEmail(email)
      const cleanPassword = password.trim()

      if (!cleanUsername) {
        setErrorMessage("Por favor ingresa un nombre de usuario.")
        return
      }
      if (!cleanEmail) {
        setErrorMessage("Por favor ingresa tu correo electrónico.")
        return
      }
      if (!cleanPassword || cleanPassword.length < 8) {
        setErrorMessage("La contraseña debe contener al menos 8 caracteres.")
        return
      }

      setIsEnteringWorld(true)
      const res = await authService.register({
        username: cleanUsername,
        email: cleanEmail,
        password: cleanPassword,
      })

      if (res.success) {
        // Automatically attempt login after registration
        const loginRes = await authService.login({
          email: cleanEmail,
          password: cleanPassword,
          keepSession,
        })

        if (loginRes.success && loginRes.user) {
          const displayName = loginRes.user.displayName || cleanUsername
          setTimeout(() => {
            onLogin(displayName)
          }, 350)
        } else {
          setIsEnteringWorld(false)
          setTab("login")
          setSuccessNotice("¡Cuenta registrada con éxito! Por favor inicia sesión.")
        }
      } else {
        setIsEnteringWorld(false)
        setErrorMessage(res.error || "No se pudo crear la cuenta. Intenta con otro correo o usuario.")
      }
    }
  }

  const inputCss: React.CSSProperties = {
    width: "100%",
    height: 42,
    background: isDark ? "#0c1117" : "#f1f5f9",
    border: isDark
      ? "1.5px solid rgba(255, 255, 255, 0.12)"
      : "1.5px solid rgba(0, 0, 0, 0.12)",
    borderRadius: 10,
    color: isDark ? "white" : "#0f172a",
    padding: "0 14px",
    fontSize: 14,
    fontFamily: BASE_FONT,
    fontWeight: 500,
    outline: "none",
    transition: "border-color 0.18s ease, box-shadow 0.18s ease",
  }

  const labelCss: React.CSSProperties = {
    display: "block",
    fontSize: 12.5,
    fontWeight: 700,
    color: isDark ? "#8899aa" : "#556677",
    fontFamily: BASE_FONT,
    marginBottom: 6,
    letterSpacing: "0.02em",
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: isDark ? "#090d12" : "#f8fafc",
      }}
    >
      {/* Background Graphic */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${loginBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: isDark ? 0.35 : 0.15,
          filter: "blur(2px)",
          transform: "scale(1.04)",
        }}
      />

      {/* Subtle overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isDark
            ? "radial-gradient(ellipse at center, rgba(9, 13, 18, 0.7) 0%, rgba(9, 13, 18, 0.95) 100%)"
            : "radial-gradient(ellipse at center, rgba(248, 250, 252, 0.6) 0%, rgba(248, 250, 252, 0.92) 100%)",
        }}
      />

      {/* Main Authentication Card */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: 440,
          maxWidth: "90vw",
          background: isDark
            ? "linear-gradient(180deg, rgba(19, 28, 35, 0.96) 0%, rgba(13, 20, 26, 0.96) 100%)"
            : "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(245, 248, 250, 0.98) 100%)",
          border: isDark
            ? "1px solid rgba(255, 255, 255, 0.1)"
            : "1px solid rgba(0, 0, 0, 0.08)",
          borderRadius: 20,
          padding: "32px 30px",
          boxShadow: isDark
            ? "0 24px 60px rgba(0, 0, 0, 0.65), 0 0 32px rgba(239, 196, 54, 0.12)"
            : "0 24px 60px rgba(0, 0, 0, 0.1), 0 0 32px rgba(239, 196, 54, 0.08)",
          backdropFilter: "blur(16px)",
          display: "flex",
          flexDirection: "column",
          animation: "scaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Top: Logo & Title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 20,
            textAlign: "center",
          }}
        >
          <img
            src={isDark ? logoReducedWhite : logoReducedBlack}
            alt="HiKAT Logo"
            style={{
              height: 46,
              maxWidth: 220,
              objectFit: "contain",
              marginBottom: 12,
              userSelect: "none",
            }}
            draggable={false}
          />
          <div
            style={{
              fontSize: 14,
              color: isDark ? "#8899aa" : "#657788",
              fontFamily: BASE_FONT,
              fontWeight: 500,
            }}
          >
            {tab === "login"
              ? "Ingresa con tu cuenta para acceder a la red de HiKAT."
              : "Crea tu cuenta para comenzar a jugar y personalizar tu personaje."}
          </div>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: isDark ? "rgba(239, 68, 68, 0.14)" : "#fee2e2",
              border: isDark ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid #fca5a5",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 14,
              color: isDark ? "#fca5a5" : "#b91c1c",
              fontSize: 13,
              fontWeight: 600,
              animation: "shakeX 0.25s ease",
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success Banner */}
        {successNotice && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: isDark ? "rgba(16, 185, 129, 0.14)" : "#d1fae5",
              border: isDark ? "1px solid rgba(16, 185, 129, 0.35)" : "1px solid #6ee7b7",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 14,
              color: isDark ? "#6ee7b7" : "#047857",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{successNotice}</span>
          </div>
        )}

        {/* OAuth Buttons (Google & Discord) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            disabled={isEnteringWorld}
            onClick={() => handleOAuthClick("GOOGLE")}
            style={{
              width: "100%",
              height: 40,
              borderRadius: 11,
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.12)"
                : "1.5px solid rgba(0, 0, 0, 0.12)",
              background: isDark ? "#0d1217" : "#ffffff",
              color: isDark ? "#ffffff" : "#111822",
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: BASE_FONT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: isEnteringWorld ? "default" : "pointer",
              transition: "all 0.16s ease",
            }}
          >
            <IconGoogle size={18} />
            <span>Continuar con Google</span>
          </button>

          <button
            type="button"
            disabled={isEnteringWorld}
            onClick={() => handleOAuthClick("DISCORD")}
            style={{
              width: "100%",
              height: 40,
              borderRadius: 11,
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.12)"
                : "1.5px solid rgba(0, 0, 0, 0.12)",
              background: isDark ? "#0d1217" : "#ffffff",
              color: isDark ? "#ffffff" : "#111822",
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: BASE_FONT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: isEnteringWorld ? "default" : "pointer",
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
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" }} />
          <span style={{ fontSize: 11.5, color: isDark ? "#657788" : "#8899aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            o con credenciales
          </span>
          <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" }} />
        </div>

        {/* Segmented Pill Switcher [ Iniciar Sesión | Registrarse ] */}
        <div
          style={{
            display: "flex",
            background: isDark ? "#0d1217" : "#e6ebf0",
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.08)"
              : "1.5px solid rgba(0, 0, 0, 0.08)",
            borderRadius: 12,
            padding: 3,
            gap: 3,
            marginBottom: 16,
          }}
        >
          {(["login", "register"] as const).map((tCode) => {
            const isCurrent = tab === tCode
            return (
              <button
                key={tCode}
                type="button"
                onClick={() => {
                  setTab(tCode)
                  setErrorMessage(null)
                  setSuccessNotice(null)
                }}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  borderRadius: 9,
                  background: isCurrent
                    ? isDark
                      ? "#1c2630"
                      : "#ffffff"
                    : "transparent",
                  border: isCurrent
                    ? isDark
                      ? "1.5px solid rgba(255, 255, 255, 0.14)"
                      : "1.5px solid rgba(0, 0, 0, 0.08)"
                    : "1.5px solid transparent",
                  color: isCurrent
                    ? isDark
                      ? "white"
                      : "#111822"
                    : isDark
                      ? "#7a8b9e"
                      : "#667788",
                  boxShadow:
                    isCurrent && !isDark
                      ? "0 2px 8px rgba(0, 0, 0, 0.08)"
                      : "none",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: BASE_FONT,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "all 0.16s ease",
                }}
              >
                {tCode === "login"
                  ? t("auth.loginTab")
                  : t("auth.registerTab")}
              </button>
            )
          })}
        </div>

        {/* Form Fields */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginBottom: 14,
          }}
        >
          {tab === "register" && (
            <div style={{ animation: "slideUpFade 0.18s ease" }}>
              <label style={labelCss}>Nombre de usuario</label>
              <input
                type="text"
                value={username}
                maxLength={24}
                autoComplete="username"
                spellCheck={false}
                placeholder="Tu nombre de jugador"
                onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                className="launcher-input"
                style={inputCss}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit()
                }}
              />
            </div>
          )}

          <div>
            <label style={labelCss}>Correo electrónico</label>
            <input
              type="email"
              value={email}
              maxLength={254}
              autoComplete="email"
              spellCheck={false}
              placeholder="jugador@ejemplo.com"
              onChange={(e) => setEmail(sanitizeEmail(e.target.value))}
              className="launcher-input"
              style={inputCss}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit()
              }}
            />
          </div>

          <div>
            <label style={labelCss}>Contraseña</label>
            <input
              type="password"
              value={password}
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              className="launcher-input"
              style={inputCss}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit()
              }}
            />
          </div>

          {tab === "login" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: 2,
              }}
            >
              <div
                onClick={() => setKeepSession(!keepSession)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: keepSession
                      ? "#efc436"
                      : isDark
                        ? "#151e28"
                        : "#e2e8f0",
                    border: keepSession
                      ? "1px solid #efc436"
                      : isDark
                        ? "1px solid rgba(255, 255, 255, 0.2)"
                        : "1px solid rgba(0, 0, 0, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s ease",
                  }}
                >
                  {keepSession && (
                    <svg
                      width={11}
                      height={11}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#090d12"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    color: isDark ? "#8899aa" : "#556677",
                    fontFamily: BASE_FONT,
                    fontWeight: 500,
                  }}
                >
                  {t("auth.keepSession")}
                </span>
              </div>
            </div>
          )}

          {/* Primary CTA Submit Button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isEnteringWorld}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(135deg, #efc436 0%, #ffd043 100%)",
              border: "none",
              color: "#090d12",
              fontSize: 14.5,
              fontWeight: 800,
              fontFamily: BASE_FONT,
              letterSpacing: "0.02em",
              cursor: isEnteringWorld ? "default" : "pointer",
              boxShadow: isEnteringWorld
                ? "0 0 32px rgba(239, 196, 54, 0.65)"
                : "0 0 20px rgba(239, 196, 54, 0.35)",
              transition: "transform 0.18s ease, box-shadow 0.18s ease",
              marginTop: 4,
              marginBottom: 8,
              transform: isEnteringWorld ? "scale(0.98)" : "none",
            }}
          >
            {isEnteringWorld ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  style={{ animation: "spin 0.75s linear infinite" }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span>Conectando...</span>
              </div>
            ) : (
              <span>
                {tab === "login" ? "Iniciar Sesión" : "Crear Cuenta"}
              </span>
            )}
          </button>
        </div>

        {/* Bottom: Version tag */}
        <div
          style={{
            fontSize: 11,
            color: isDark ? "#4b5563" : "#9ca3af",
            fontFamily: BASE_FONT,
            textAlign: "center",
            paddingTop: 8,
          }}
        >
          HiKAT Launcher {LAUNCHER_VERSION} • Autenticación segura
        </div>
      </div>
    </div>
  )
}
