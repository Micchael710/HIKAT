import React, { useState, useEffect, useRef } from "react"
import { ThemeMode } from "../types"
import { BASE_FONT } from "../theme/tokens"
import { loginBg, logoWhite, logoBlack } from "../assets"
import { IconGoogle, IconDiscord } from "../theme/icons"
import { useTranslation } from "../context/LanguageContext"
import {
  sanitizeUsername,
  sanitizeEmail,
} from "../utils/security"
import { authService } from "../services/authService"

interface LoginViewProps {
  onLogin: (username: string) => void
  theme?: ThemeMode
  initialDeepLinkUrl?: string | null
  onConsumeInitialDeepLink?: () => void
}

type AuthMode = "auth" | "forgot-password" | "verify-email" | "reset-password"

export default function LoginView({
  onLogin,
  theme = "dark",
  initialDeepLinkUrl,
  onConsumeInitialDeepLink,
}: LoginViewProps) {
  const { t, language } = useTranslation()
  const [mode, setMode] = useState<AuthMode>("auth")
  const [tab, setTab] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [forgotEmail, setForgotEmail] = useState("")
  const [registeredEmail, setRegisteredEmail] = useState("")
  const [forgotSuccess, setForgotSuccess] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [isResendingVerification, setIsResendingVerification] = useState(false)
  const [keepSession, setKeepSession] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<string | null>(null)
  const [isEnteringWorld, setIsEnteringWorld] = useState(false)
  const isDark = theme === "dark"

  const pendingOAuthRef = useRef<{
    codeVerifier: string
    state: string
    keepSession: boolean
  } | null>(null)

  const processDeepLinkUrl = async (rawUrl: string) => {
    try {
      const urlObj = new URL(rawUrl)
      if (urlObj.protocol !== "hikat:") return
      const host = urlObj.hostname || urlObj.host
      if (host !== "auth") return
      const cleanPath = urlObj.pathname.replace(/\/+$/, "")

      if (cleanPath === "/callback") {
        const code = urlObj.searchParams.get("code")
        const state = urlObj.searchParams.get("state")
        const error = urlObj.searchParams.get("error")

        if (error) {
          if (error === "EMAIL_CONFLICT_LINK_REQUIRED") {
            setErrorMessage(t("auth.emailConflictError"))
          } else {
            setErrorMessage(t("auth.externalAuthError"))
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
        const pendingKeepSession = pendingOAuthRef.current?.keepSession

        setIsEnteringWorld(true)
        const user = await authService.handleOAuthCallback({
          code,
          codeVerifier: pendingVerifier,
          state,
          expectedState,
          keepSession: pendingKeepSession,
        })

        pendingOAuthRef.current = null
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("hikat_launcher_oauth_verifier")
          sessionStorage.removeItem("hikat_launcher_oauth_state")
          sessionStorage.removeItem("hikat_launcher_oauth_keep_session")
        }

        setTimeout(() => {
          onLogin(user.displayName || user.username)
        }, 350)
        return
      }

      if (cleanPath === "/verify-email") {
        const token = urlObj.searchParams.get("token")
        if (!token) {
          setErrorMessage(t("auth.invalidVerificationToken"))
          setMode("auth")
          setTab("login")
          return
        }
        setErrorMessage(null)
        setSuccessNotice(null)
        const res = await authService.verifyEmail(token)
        setMode("auth")
        setTab("login")
        if (res.success) {
          setSuccessNotice(t("auth.emailVerifiedSuccess"))
        } else {
          setErrorMessage(t("auth.invalidVerificationToken"))
        }
        return
      }

      if (cleanPath === "/reset-password") {
        const token = urlObj.searchParams.get("token")
        if (!token) {
          setErrorMessage(t("auth.invalidResetToken"))
          setMode("auth")
          setTab("login")
          return
        }
        setResetToken(token)
        setNewPassword("")
        setConfirmPassword("")
        setMode("reset-password")
        setErrorMessage(null)
        setSuccessNotice(null)
        return
      }
    } catch (err: any) {
      setIsEnteringWorld(false)
      setErrorMessage(err.message || t("auth.genericAuthError"))
    }
  }

  const onConsumeRef = useRef(onConsumeInitialDeepLink)
  onConsumeRef.current = onConsumeInitialDeepLink

  // Process initial deep link forwarded from parent (e.g. when authenticated screen changed to login)
  useEffect(() => {
    if (initialDeepLinkUrl) {
      processDeepLinkUrl(initialDeepLinkUrl)
      onConsumeRef.current?.()
    }
  }, [initialDeepLinkUrl])

  // Listen for deep link callbacks via Electron IPC while launcher is open
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onOAuthCallback) {
      return
    }

    const removeListener = window.electronAPI.onOAuthCallback((rawUrl: string) => {
      processDeepLinkUrl(rawUrl)
    })

    return () => {
      removeListener?.()
    }
  }, [onLogin, keepSession])

  const handleOAuthClick = async (provider: "GOOGLE" | "DISCORD") => {
    setErrorMessage(null)
    setSuccessNotice(null)
    try {
      const { authUrl, codeVerifier, state } = await authService.initiateOAuth(provider, keepSession, language)
      pendingOAuthRef.current = { codeVerifier, state, keepSession }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("hikat_launcher_oauth_verifier", codeVerifier)
        sessionStorage.setItem("hikat_launcher_oauth_state", state)
        sessionStorage.setItem("hikat_launcher_oauth_keep_session", keepSession ? "true" : "false")
      }

      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authUrl)
      } else {
        window.open(authUrl, "_blank")
      }
    } catch (err: any) {
      setErrorMessage(err.message || t("auth.oauthInitError"))
    }
  }

  const handleSubmit = async () => {
    if (isEnteringWorld) return
    setErrorMessage(null)
    setSuccessNotice(null)

    if (tab === "login") {
      const cleanEmail = sanitizeEmail(email)
      const cleanPassword = password.trim()

      if (!cleanEmail || !cleanPassword) {
        setErrorMessage(t("auth.missingFields"))
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
        if (
          res.error === "EMAIL_NOT_VERIFIED" ||
          res.error?.includes("EMAIL_NOT_VERIFIED") ||
          res.error?.toLowerCase().includes("email verification is required")
        ) {
          setRegisteredEmail(cleanEmail)
          setMode("verify-email")
          setErrorMessage(t("auth.emailNotVerifiedError"))
        } else {
          setErrorMessage(res.error || t("auth.loginFailed"))
        }
      }
    } else {
      const cleanUsername = sanitizeUsername(username)
      const cleanEmail = sanitizeEmail(email)
      const cleanPassword = password.trim()

      if (!cleanUsername || !cleanEmail || !cleanPassword) {
        setErrorMessage(t("auth.missingFields"))
        return
      }
      if (cleanPassword.length < 8) {
        setErrorMessage(t("auth.passwordMinLength"))
        return
      }

      setIsEnteringWorld(true)
      const res = await authService.register({
        username: cleanUsername,
        email: cleanEmail,
        password: cleanPassword,
        locale: language,
      })

      if (res.success) {
        if (res.emailVerificationRequired) {
          setIsEnteringWorld(false)
          setRegisteredEmail(cleanEmail)
          setMode("verify-email")
          return
        }

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
          setSuccessNotice(t("auth.registrationSuccess"))
        }
      } else {
        setIsEnteringWorld(false)
        setErrorMessage(res.error || t("auth.registrationFailed"))
      }
    }
  }

  const handleForgotPasswordSubmit = async () => {
    if (isSendingReset) return
    const cleanEmail = sanitizeEmail(forgotEmail || email)
    if (!cleanEmail) {
      setErrorMessage(t("auth.missingFields"))
      return
    }

    setErrorMessage(null)
    setIsSendingReset(true)
    try {
      const res = await authService.requestPasswordReset(cleanEmail, language)
      setIsSendingReset(false)
      if (res.success) {
        setForgotSuccess(true)
      } else {
        setErrorMessage(res.error || t("profile.emailError"))
      }
    } catch {
      setIsSendingReset(false)
      setErrorMessage(t("profile.emailError"))
    }
  }

  const handleResetPasswordSubmit = async () => {
    if (isResettingPassword) return
    const p1 = newPassword.trim()
    const p2 = confirmPassword.trim()

    if (!p1 || !p2) {
      setErrorMessage(t("auth.missingFields"))
      return
    }
    if (p1.length < 8) {
      setErrorMessage(t("auth.passwordMinLength"))
      return
    }
    if (p1 !== p2) {
      setErrorMessage(t("auth.passwordsDoNotMatch"))
      return
    }
    if (!resetToken) {
      setErrorMessage(t("auth.invalidResetToken"))
      return
    }

    setErrorMessage(null)
    setIsResettingPassword(true)
    try {
      const res = await authService.resetPassword(resetToken, p1)
      setIsResettingPassword(false)
      if (res.success) {
        authService.clearSession()
        setResetToken(null)
        setNewPassword("")
        setConfirmPassword("")
        setMode("auth")
        setTab("login")
        setSuccessNotice(t("auth.passwordResetSuccess"))
      } else {
        setErrorMessage(t("auth.invalidResetToken"))
      }
    } catch {
      setIsResettingPassword(false)
      setErrorMessage(t("auth.invalidResetToken"))
    }
  }

  const handleResendVerification = async () => {
    const targetEmail = registeredEmail || email
    if (!targetEmail || isResendingVerification) return
    setErrorMessage(null)
    setSuccessNotice(null)
    setIsResendingVerification(true)
    try {
      const res = await authService.requestEmailVerification(targetEmail, language)
      setIsResendingVerification(false)
      if (res.success) {
        setSuccessNotice(t("auth.verificationResentSuccess"))
      } else {
        setErrorMessage(res.error || t("auth.genericAuthError"))
      }
    } catch {
      setIsResendingVerification(false)
      setErrorMessage(t("auth.genericAuthError"))
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

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = isDark
      ? "rgba(255, 255, 255, 0.35)"
      : "rgba(0, 0, 0, 0.35)"
    e.currentTarget.style.boxShadow = isDark
      ? "0 0 0 3px rgba(255, 255, 255, 0.08)"
      : "0 0 0 3px rgba(0, 0, 0, 0.06)"
  }

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = isDark
      ? "rgba(255, 255, 255, 0.12)"
      : "rgba(0, 0, 0, 0.12)"
    e.currentTarget.style.boxShadow = "none"
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
            ? "linear-gradient(180deg, rgba(20, 29, 38, 0.96) 0%, rgba(13, 18, 24, 0.96) 100%)"
            : "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(245, 248, 250, 0.98) 100%)",
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.1)"
            : "1.5px solid rgba(0, 0, 0, 0.08)",
          borderRadius: 20,
          padding: "32px 30px",
          boxShadow: isDark
            ? "0 24px 60px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.4)"
            : "0 24px 60px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)",
          backdropFilter: "blur(16px)",
          display: "flex",
          flexDirection: "column",
          animation: "scaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* 1. Logo & Subtitle */}
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
            src={isDark ? logoWhite : logoBlack}
            alt="HiKAT Logo"
            style={{
              height: 48,
              maxWidth: 240,
              objectFit: "contain",
              marginBottom: mode === "auth" ? 12 : 8,
              userSelect: "none",
            }}
            draggable={false}
          />
          {mode === "forgot-password" && (
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#0f172a",
                fontFamily: BASE_FONT,
                marginBottom: 4,
              }}
            >
              {t("auth.forgotPasswordTitle")}
            </div>
          )}
          {mode === "verify-email" && (
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#0f172a",
                fontFamily: BASE_FONT,
                marginBottom: 4,
              }}
            >
              {t("auth.verifyEmailTitle")}
            </div>
          )}
          {mode === "reset-password" && (
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#0f172a",
                fontFamily: BASE_FONT,
                marginBottom: 4,
              }}
            >
              {t("auth.resetPasswordTitle")}
            </div>
          )}
          {!(mode === "forgot-password" && forgotSuccess) && (
            <div
              style={{
                fontSize: 14,
                color: isDark ? "#8899aa" : "#657788",
                fontFamily: BASE_FONT,
                fontWeight: 500,
              }}
            >
              {mode === "forgot-password"
                ? t("auth.forgotPasswordSubtitle")
                : mode === "verify-email"
                  ? t("auth.verifyEmailDesc")
                  : mode === "reset-password"
                    ? t("auth.resetPasswordDesc")
                    : tab === "login"
                      ? t("auth.loginSubtitle")
                      : t("auth.registerSubtitle")}
            </div>
          )}
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: isDark ? "rgba(239, 68, 68, 0.14)" : "#fee2e2",
              border: isDark ? "1.5px solid rgba(239, 68, 68, 0.35)" : "1.5px solid #fca5a5",
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
              border: isDark ? "1.5px solid rgba(16, 185, 129, 0.35)" : "1.5px solid #6ee7b7",
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

        {/* MODE: FORGOT PASSWORD */}
        {mode === "forgot-password" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fadeIn 0.2s ease" }}>
            {forgotSuccess ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "center", alignItems: "center", padding: "10px 0" }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: isDark ? "rgba(56, 189, 248, 0.12)" : "rgba(2, 132, 199, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: isDark ? "#38bdf8" : "#0284c7",
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width={20}
                    height={20}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div style={{ fontSize: 14.5, color: isDark ? "#c2d0dd" : "#334455", fontWeight: 500, lineHeight: 1.5 }}>
                  {t("auth.resetEmailSentNotice")}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMode("auth")
                    setTab("login")
                    setForgotSuccess(false)
                    setErrorMessage(null)
                    setSuccessNotice(null)
                  }}
                  className="launcher-btn-secondary"
                  style={{
                    width: "100%",
                    height: 42,
                    borderRadius: 12,
                    fontSize: 14.5,
                    fontWeight: 600,
                    fontFamily: BASE_FONT,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 6,
                  }}
                >
                  {t("auth.backToLogin")}
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label style={labelCss}>{t("auth.emailLabel")}</label>
                  <input
                    type="email"
                    value={forgotEmail || email}
                    maxLength={254}
                    autoComplete="email"
                    spellCheck={false}
                    placeholder={t("auth.emailPlaceholder")}
                    onChange={(e) => setForgotEmail(sanitizeEmail(e.target.value))}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    className="launcher-input"
                    style={inputCss}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleForgotPasswordSubmit()
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleForgotPasswordSubmit}
                  disabled={isSendingReset}
                  className="launcher-btn-primary"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    width: "100%",
                    height: 44,
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: BASE_FONT,
                    letterSpacing: "0.02em",
                    cursor: isSendingReset ? "default" : "pointer",
                    marginTop: 4,
                    opacity: isSendingReset ? 0.75 : 1,
                  }}
                >
                  {isSendingReset ? (
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
                      <span>{t("common.loading")}</span>
                    </div>
                  ) : (
                    <span>{t("auth.sendResetEmail")}</span>
                  )}
                </button>

                <div style={{ textAlign: "center", marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("auth")
                      setErrorMessage(null)
                      setSuccessNotice(null)
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "6px 12px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: isDark ? "#8899aa" : "#556677",
                      fontFamily: BASE_FONT,
                      cursor: "pointer",
                      transition: "color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = isDark ? "#ffffff" : "#111822"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = isDark ? "#8899aa" : "#556677"
                    }}
                  >
                    {t("auth.backToLogin")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* MODE: VERIFY EMAIL */}
        {mode === "verify-email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.2s ease" }}>
            <div
              style={{
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.08)"
                  : "1.5px solid rgba(0, 0, 0, 0.08)",
                borderRadius: 14,
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: isDark ? "rgba(56, 189, 248, 0.12)" : "rgba(2, 132, 199, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isDark ? "#38bdf8" : "#0284c7",
                  flexShrink: 0,
                }}
              >
                <svg
                  width={20}
                  height={20}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: isDark ? "#657788" : "#778899", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                  {t("auth.emailLabel")}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? "#ffffff" : "#111822", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {registeredEmail || email}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResendVerification}
              disabled={isResendingVerification}
              className="launcher-btn-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                height: 42,
                borderRadius: 12,
                fontSize: 14.5,
                fontWeight: 600,
                fontFamily: BASE_FONT,
                cursor: isResendingVerification ? "default" : "pointer",
                opacity: isResendingVerification ? 0.75 : 1,
              }}
            >
              {isResendingVerification ? t("auth.resendingVerification") : t("auth.resendVerification")}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("auth")
                setTab("login")
                setErrorMessage(null)
                setSuccessNotice(null)
              }}
              className="launcher-btn-primary"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: 44,
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                fontFamily: BASE_FONT,
                cursor: "pointer",
                marginTop: 2,
              }}
            >
              {t("auth.backToLogin")}
            </button>
          </div>
        )}

        {/* MODE: RESET PASSWORD */}
        {mode === "reset-password" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fadeIn 0.2s ease" }}>
            <div>
              <label style={labelCss}>{t("auth.newPasswordLabel")}</label>
              <input
                type="password"
                value={newPassword}
                placeholder={t("auth.newPasswordPlaceholder")}
                onChange={(e) => setNewPassword(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                className="launcher-input"
                style={inputCss}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleResetPasswordSubmit()
                }}
              />
            </div>

            <div>
              <label style={labelCss}>{t("auth.confirmPasswordLabel")}</label>
              <input
                type="password"
                value={confirmPassword}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                className="launcher-input"
                style={inputCss}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleResetPasswordSubmit()
                }}
              />
            </div>

            <button
              type="button"
              onClick={handleResetPasswordSubmit}
              disabled={isResettingPassword}
              className="launcher-btn-primary"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                height: 44,
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                fontFamily: BASE_FONT,
                letterSpacing: "0.02em",
                cursor: isResettingPassword ? "default" : "pointer",
                marginTop: 4,
                opacity: isResettingPassword ? 0.75 : 1,
              }}
            >
              {isResettingPassword ? (
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
                  <span>{t("common.loading")}</span>
                </div>
              ) : (
                <span>{t("auth.changePassword")}</span>
              )}
            </button>

            <div style={{ textAlign: "center", marginTop: 4 }}>
              <button
                type="button"
                onClick={() => {
                  setMode("auth")
                  setTab("login")
                  setResetToken(null)
                  setErrorMessage(null)
                  setSuccessNotice(null)
                }}
                style={{
                  background: "none",
                  border: "none",
                  padding: "6px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: isDark ? "#8899aa" : "#556677",
                  fontFamily: BASE_FONT,
                  cursor: "pointer",
                  transition: "color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = isDark ? "#ffffff" : "#111822"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = isDark ? "#8899aa" : "#556677"
                }}
              >
                {t("auth.backToLogin")}
              </button>
            </div>
          </div>
        )}

        {/* MODE: AUTH (LOGIN / REGISTER) */}
        {mode === "auth" && (
          <>
            {/* 2. Segmented Switcher [ Sign In | Sign Up ] */}
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

            {/* 3. Form Fields (Username for register, Email, Password) */}
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
                  <label style={labelCss}>{t("auth.usernameRegisterLabel")}</label>
                  <input
                    type="text"
                    value={username}
                    maxLength={24}
                    autoComplete="username"
                    spellCheck={false}
                    placeholder={t("auth.usernamePlaceholderRegister")}
                    onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    className="launcher-input"
                    style={inputCss}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmit()
                    }}
                  />
                </div>
              )}

              <div>
                <label style={labelCss}>{t("auth.emailLabel")}</label>
                <input
                  type="email"
                  value={email}
                  maxLength={254}
                  autoComplete="email"
                  spellCheck={false}
                  placeholder={t("auth.emailPlaceholder")}
                  onChange={(e) => setEmail(sanitizeEmail(e.target.value))}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  className="launcher-input"
                  style={inputCss}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit()
                  }}
                />
              </div>

              <div>
                <label style={labelCss}>{t("auth.passwordLabel")}</label>
                <input
                  type="password"
                  value={password}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  placeholder={t("auth.passwordPlaceholder")}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  className="launcher-input"
                  style={inputCss}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit()
                  }}
                />
              </div>

              {/* 4. Keep me signed in & Forgot Password link (Login tab only) */}
              {tab === "login" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 2,
                    marginBottom: 2,
                  }}
                >
                  <label
                    onClick={() => setKeepSession(!keepSession)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      userSelect: "none",
                      color: isDark ? "#8899aa" : "#556677",
                      transition: "color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = isDark ? "#ffffff" : "#0f172a"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = isDark ? "#8899aa" : "#556677"
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: keepSession
                          ? isDark
                            ? "rgba(255, 255, 255, 0.15)"
                            : "rgba(0, 0, 0, 0.1)"
                          : isDark
                            ? "rgba(255, 255, 255, 0.04)"
                            : "#e2e8f0",
                        border: keepSession
                          ? isDark
                            ? "1.5px solid rgba(255, 255, 255, 0.7)"
                            : "1.5px solid rgba(0, 0, 0, 0.7)"
                          : isDark
                            ? "1.5px solid rgba(255, 255, 255, 0.2)"
                            : "1.5px solid rgba(0, 0, 0, 0.2)",
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
                          stroke={isDark ? "#ffffff" : "#0f172a"}
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
                        fontFamily: BASE_FONT,
                        fontWeight: 500,
                        color: "inherit",
                      }}
                    >
                      {t("auth.keepSession")}
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot-password")
                      setErrorMessage(null)
                      setSuccessNotice(null)
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: isDark ? "#8899aa" : "#556677",
                      fontFamily: BASE_FONT,
                      cursor: "pointer",
                      textDecoration: "none",
                      transition: "color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = isDark ? "#ffffff" : "#0f172a"
                      e.currentTarget.style.textDecoration = "underline"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = isDark ? "#8899aa" : "#556677"
                      e.currentTarget.style.textDecoration = "none"
                    }}
                  >
                    {t("auth.forgotPasswordLink")}
                  </button>
                </div>
              )}

              {/* 5. Primary CTA Submit Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isEnteringWorld}
                className="launcher-btn-primary"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  width: "100%",
                  height: 44,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: BASE_FONT,
                  letterSpacing: "0.02em",
                  cursor: isEnteringWorld ? "default" : "pointer",
                  marginTop: 6,
                  marginBottom: 4,
                  opacity: isEnteringWorld ? 0.75 : 1,
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
                    <span>{t("auth.connecting")}</span>
                  </div>
                ) : (
                  <span>
                    {tab === "login"
                      ? t("auth.submitLogin")
                      : t("auth.submitRegister")}
                  </span>
                )}
              </button>
            </div>

            {/* 6. Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
                marginTop: 4,
              }}
            >
              <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" }} />
              <span style={{ fontSize: 11.5, color: isDark ? "#657788" : "#8899aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("auth.orContinueWith")}
              </span>
              <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" }} />
            </div>

            {/* 7. OAuth Buttons (Google & Discord) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
              <button
                type="button"
                disabled={isEnteringWorld}
                onClick={() => handleOAuthClick("GOOGLE")}
                className="launcher-btn-secondary"
                style={{
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: BASE_FONT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  cursor: isEnteringWorld ? "default" : "pointer",
                  opacity: isEnteringWorld ? 0.6 : 1,
                }}
              >
                <IconGoogle size={18} />
                <span>{t("auth.continueGoogle")}</span>
              </button>

              <button
                type="button"
                disabled={isEnteringWorld}
                onClick={() => handleOAuthClick("DISCORD")}
                className="launcher-btn-secondary"
                style={{
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: BASE_FONT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  cursor: isEnteringWorld ? "default" : "pointer",
                  opacity: isEnteringWorld ? 0.6 : 1,
                }}
              >
                <IconDiscord size={18} />
                <span>{t("auth.continueDiscord")}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
