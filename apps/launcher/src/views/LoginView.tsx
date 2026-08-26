import React, { useState } from "react"
import { ThemeMode } from "../types"
import { BASE_FONT } from "../theme/tokens"
import { loginBg, logoReducedWhite, logoReducedBlack } from "../assets"
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
        setErrorMessage(res.error || "Error al registrar la cuenta. Inténtalo de nuevo.")
      }
    }
  }

  const inputCss: React.CSSProperties = {
    width: "100%",
    height: 44,
    borderRadius: 12,
    border: isDark
      ? "1.5px solid rgba(255, 255, 255, 0.08)"
      : "1.5px solid rgba(0, 0, 0, 0.1)",
    background: isDark ? "#0d1217" : "#f0f3f7",
    color: isDark ? "white" : "#111822",
    fontSize: 14,
    fontFamily: BASE_FONT,
    fontWeight: 500,
    padding: "0 14px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.18s ease, box-shadow 0.18s ease",
  }

  const labelCss: React.CSSProperties = {
    display: "block",
    marginBottom: 5,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: isDark ? "#657788" : "#778899",
    fontFamily: BASE_FONT,
    textTransform: "uppercase",
  }

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: isDark ? "#090d12" : "#f5f7fa",
        animation: "screenFadeIn 0.35s ease",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Golden Portal Flash Overlay on Entrance */}
      {isEnteringWorld && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 60% 50%, rgba(239, 196, 54, 0.45) 0%, rgba(245, 158, 11, 0.2) 40%, transparent 75%)",
            pointerEvents: "none",
            zIndex: 90,
            animation: "portalGlowFlash 0.45s ease forwards",
          }}
        />
      )}

      {/* ── Left Form Panel ── */}
      <div
        style={{
          width: 440,
          flexShrink: 0,
          height: "100%",
          background: isDark ? "#090d12" : "#ffffff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "28px 36px 20px",
          borderRight: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.08)"
            : "1.5px solid rgba(0, 0, 0, 0.08)",
          boxSizing: "border-box",
          overflowY: "auto",
          scrollbarWidth: "none",
          transform: isEnteringWorld ? "translateX(-60px)" : "translateX(0)",
          opacity: isEnteringWorld ? 0 : 1,
          transition:
            "transform 0.42s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.38s ease",
          zIndex: 2,
        }}
      >
        {/* Top: Branding & Form Container */}
        <div>
          {/* Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: 36,
            }}
          >
            <img
              src={isDark ? logoReducedWhite : logoReducedBlack}
              alt="HiKAT"
              style={{ width: 32, height: 32, objectFit: "contain" }}
            />
            <span
              style={{
                fontFamily: '"Kanit:Regular", Kanit, sans-serif',
                fontSize: 24,
                color: isDark ? "white" : "#111822",
                letterSpacing: -0.5,
                lineHeight: 1,
              }}
            >
              HiKAT
            </span>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: isDark ? "white" : "#111822",
                letterSpacing: "-0.02em",
                marginBottom: 4,
                fontFamily: BASE_FONT,
              }}
            >
              {tab === "login" ? t("auth.loginTab") : t("auth.registerTab")}
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: isDark ? "#8899aa" : "#556677",
                fontWeight: 400,
                lineHeight: 1.4,
                fontFamily: BASE_FONT,
              }}
            >
              {tab === "login"
                ? "Inicia sesión con tu cuenta de HiKAT para sincronizar tus skins y partidas."
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

          {/* Clean Segmented Pill Switcher [ Iniciar Sesión | Registrarse ] */}
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
              marginBottom: 18,
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
                    padding: "8px 0",
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
                    fontSize: 13.5,
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
                maxLength={128}
                autoComplete={
                  tab === "login" ? "current-password" : "new-password"
                }
                placeholder="••••••••••••"
                onChange={(e) =>
                  setPassword(sanitizeInput(e.target.value, 128))
                }
                className="launcher-input"
                style={inputCss}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit()
                }}
              />
            </div>
          </div>

          {/* Options Row (Mantener sesión iniciada) */}
          {tab === "login" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={() => setKeepSession((v) => !v)}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 5,
                    flexShrink: 0,
                    border: keepSession
                      ? "1.5px solid #efc436"
                      : isDark
                        ? "1.5px solid rgba(255, 255, 255, 0.15)"
                        : "1.5px solid rgba(0, 0, 0, 0.15)",
                    background: keepSession
                      ? "#efc436"
                      : isDark
                        ? "#0d1217"
                        : "#f0f3f7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.16s ease",
                  }}
                >
                  {keepSession && (
                    <svg
                      width={9}
                      height={9}
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="#090d12"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6l3 3 5-5" />
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
              fontSize: 15,
              fontWeight: 800,
              fontFamily: BASE_FONT,
              letterSpacing: "0.03em",
              cursor: isEnteringWorld ? "default" : "pointer",
              boxShadow: isEnteringWorld
                ? "0 0 32px rgba(239, 196, 54, 0.65)"
                : "0 0 20px rgba(239, 196, 54, 0.35)",
              transition: "transform 0.18s ease, box-shadow 0.18s ease",
              marginBottom: 10,
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
            paddingTop: 12,
          }}
        >
          HiKAT Launcher {LAUNCHER_VERSION} • Autenticación segura
        </div>
      </div>

      {/* ── Right Splash Image ── */}
      <div
        style={{
          flex: 1,
          height: "100%",
          position: "relative",
          overflow: "hidden",
          background: isDark ? "#090d12" : "#e2e8f0",
        }}
      >
        <img
          src={loginBg}
          alt="HiKAT World"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: isEnteringWorld ? "brightness(1.2) scale(1.05)" : "none",
            transition: "filter 0.45s ease, transform 0.45s ease",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: isDark
              ? "linear-gradient(90deg, #090d12 0%, rgba(9, 13, 18, 0.4) 40%, transparent 100%)"
              : "linear-gradient(90deg, #ffffff 0%, rgba(255, 255, 255, 0.4) 40%, transparent 100%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  )
}
