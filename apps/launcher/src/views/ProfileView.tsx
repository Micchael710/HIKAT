import React, { useState, useRef, useEffect, useMemo } from "react"
import { ThemeMode, SkinItem } from "../types"
import { hexToRGB, CANVAS_W, BASE_FONT } from "../theme/tokens"
import MinecraftHead from "../components/minecraft/MinecraftHead"
import LiveToast from "../components/common/LiveToast"
import { useTranslation } from "../context/LanguageContext"

import { authService, LinkedAuthMethod } from "../services/authService"

interface ProfileViewProps {
  username: string
  activeSkinData?: SkinItem | null
  onBack: () => void
  onLogout?: () => void
  theme?: ThemeMode
}

export default function ProfileView({
  username,
  activeSkinData,
  onBack,
  onLogout,
  theme = "dark",
}: ProfileViewProps) {
  const { t, language } = useTranslation()
  const user = authService.getUser() || authService.getCachedUser()

  const [email] = useState(
    user?.email ||
      `${username.toLowerCase().replace(/\s+/g, "")}@gmail.com`,
  )

  const joinDate = useMemo(() => {
    if (!user?.createdAt) return "—"
    try {
      const d = new Date(user.createdAt)
      if (isNaN(d.getTime())) return "—"
      return d.toLocaleDateString(language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    } catch {
      return "—"
    }
  }, [user?.createdAt, language])

  const [authMethods, setAuthMethods] = useState<LinkedAuthMethod[] | null>(null)
  const [loadingMethods, setLoadingMethods] = useState(true)
  const [methodsError, setMethodsError] = useState(false)

  useEffect(() => {
    let active = true
    setLoadingMethods(true)
    setMethodsError(false)
    authService
      .getLinkedMethods()
      .then((res) => {
        if (active) {
          if (res.success && res.methods) {
            setAuthMethods(res.methods)
          } else {
            setMethodsError(true)
          }
          setLoadingMethods(false)
        }
      })
      .catch(() => {
        if (active) {
          setMethodsError(true)
          setLoadingMethods(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  const hasPassword = Boolean(
    !loadingMethods && authMethods?.some((m) => m.type === "PASSWORD"),
  )
  const externalMethods = useMemo(() => {
    if (loadingMethods || !authMethods) return []
    return authMethods.filter((m) => m.type === "GOOGLE" || m.type === "DISCORD")
  }, [loadingMethods, authMethods])

  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">(
    "idle",
  )
  const [toastState, setToastState] = useState<{
    message: string | null
    type: "success" | "error" | "info"
  }>({
    message: null,
    type: "success",
  })
  const toastTimeoutRef = useRef<any>(null)
  const isDark = theme === "dark"

  const showToast = (
    msg?: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setToastState({ message: msg || t("settings.toastSaved"), type })
    toastTimeoutRef.current = setTimeout(() => {
      setToastState({ message: null, type: "success" })
    }, 2800)
  }

  const handleSendResetEmail = async () => {
    if (resetState === "sending") return
    setResetState("sending")
    try {
      const res = await authService.requestPasswordReset(email)
      if (res.success) {
        setResetState("sent")
        showToast(t("profile.emailSent"), "success")
      } else {
        setResetState("idle")
        showToast(res.error || t("profile.emailError"), "error")
      }
    } catch (_) {
      setResetState("idle")
      showToast(t("profile.emailError"), "error")
    }
    setTimeout(() => setResetState("idle"), 3500)
  }

  const currentAccent = hexToRGB(
    activeSkinData?.accent || activeSkinData?.shirt || "#38bdf8",
  )
  const CONTENT_LEFT = 184

  /* Smooth delayed mouse-following parallax */
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const relX = e.clientX / window.innerWidth - 0.5
      const relY = e.clientY / window.innerHeight - 0.5
      setMouseOffset({
        x: Math.round(relX * 220),
        y: Math.round(relY * 150),
      })
    }

    window.addEventListener("mousemove", handleWindowMouseMove, {
      passive: true,
    })
    return () => window.removeEventListener("mousemove", handleWindowMouseMove)
  }, [])

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: CANVAS_W,
        height: 1080,
        background: isDark ? "#090d12" : "#f5f7fa",
        overflow: "hidden",
      }}
    >
      {/* ── Dynamic Ambient Glow Background ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 0,
        }}
      >
        {/* Orb 1 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${mouseOffset.x}px, ${mouseOffset.y}px, 0)`,
            transition: "transform 1.4s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-1"
            style={{
              position: "absolute",
              top: "-10%",
              left: "15%",
              width: 850,
              height: 850,
              background: `radial-gradient(circle, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                isDark ? 0.24 : 0.14
              }) 0%, transparent 68%)`,
              filter: "blur(55px)",
              transition: "background 0.55s ease",
            }}
          />
        </div>

        {/* Orb 2 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${Math.round(mouseOffset.x * 0.45)}px, ${Math.round(mouseOffset.y * 0.45)}px, 0)`,
            transition: "transform 1.8s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-2"
            style={{
              position: "absolute",
              top: "25%",
              right: "5%",
              width: 900,
              height: 900,
              background: `radial-gradient(circle, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                isDark ? 0.16 : 0.1
              }) 0%, transparent 68%)`,
              filter: "blur(65px)",
              transition: "background 0.55s ease",
            }}
          />
        </div>

        {/* Orb 3 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${Math.round(mouseOffset.x * 0.25)}px, ${Math.round(mouseOffset.y * 0.25)}px, 0)`,
            transition: "transform 2.2s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-3"
            style={{
              position: "absolute",
              bottom: "-15%",
              left: "25%",
              width: 800,
              height: 800,
              background: `radial-gradient(circle, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                isDark ? 0.14 : 0.08
              }) 0%, transparent 70%)`,
              filter: "blur(55px)",
              transition: "background 0.55s ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 145,
          width: CANVAS_W - CONTENT_LEFT - 120,
          height: 880,
          display: "flex",
          flexDirection: "column",
          fontFamily: BASE_FONT,
          zIndex: 1,
          animation: "viewFadeIn 0.24s ease",
        }}
      >
        {/* ── Top Header Row with Integrated Back Button ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Integrated Back Button */}
            <button
              type="button"
              onClick={onBack}
              title={t("common.back")}
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: isDark ? "#0d1217" : "#ffffff",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.1)"
                  : "1.5px solid rgba(0, 0, 0, 0.1)",
                boxShadow: isDark ? "none" : "0 2px 8px rgba(0, 0, 0, 0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isDark ? "#8899aa" : "#556677",
                cursor: "pointer",
                flexShrink: 0,
                transition: "all 0.16s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = isDark ? "#ffffff" : "#111822"
                e.currentTarget.style.borderColor = isDark
                  ? "rgba(255, 255, 255, 0.26)"
                  : "rgba(0, 0, 0, 0.25)"
                e.currentTarget.style.background = isDark
                  ? "#151e26"
                  : "#f0f3f7"
                e.currentTarget.style.transform = "translateX(-2px)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = isDark ? "#8899aa" : "#556677"
                e.currentTarget.style.borderColor = isDark
                  ? "rgba(255, 255, 255, 0.1)"
                  : "rgba(0, 0, 0, 0.1)"
                e.currentTarget.style.background = isDark
                  ? "#0d1217"
                  : "#ffffff"
                e.currentTarget.style.transform = "none"
              }}
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>

            <div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: isDark ? "white" : "#111822",
                  letterSpacing: "-0.02em",
                  marginBottom: 2,
                }}
              >
                {t("profile.title")}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 400,
                  color: isDark ? "#8899aa" : "#556677",
                }}
              >
                {t("profile.subtitle")}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main Content Area ── */}
        <div
          className="custom-grid-scroll"
          style={{
            flex: 1,
            overflowY: "auto",
            maxHeight: 780,
            paddingRight: 6,
            paddingBottom: 20,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {/* Card 1: Identidad & Información de Cuenta */}
          <div className="settings-card">
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: isDark ? "#657788" : "#778899",
                marginBottom: 16,
              }}
            >
              {t("profile.accountInfo")}
            </div>

            {/* User Hero Row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                marginBottom: 20,
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  overflow: "hidden",
                  border: isDark
                    ? "2px solid rgba(255, 255, 255, 0.14)"
                    : "2px solid rgba(0, 0, 0, 0.1)",
                  background: isDark ? "#0d151c" : "#f0f3f7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: isDark
                    ? "0 8px 24px rgba(0, 0, 0, 0.45)"
                    : "0 8px 24px rgba(0, 0, 0, 0.1)",
                }}
              >
                <MinecraftHead
                  skinId={activeSkinData?.id}
                  skinColor={activeSkinData?.skin}
                  customImgUrl={activeSkinData?.customImgUrl || activeSkinData?.skinUrl}
                  size={72}
                  shape="square"
                />
              </div>

              {/* Username & Email */}
              <div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    color: isDark ? "white" : "#111822",
                    letterSpacing: "-0.02em",
                    marginBottom: 2,
                  }}
                >
                  {username}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: isDark ? "#8899aa" : "#556677",
                    fontWeight: 500,
                  }}
                >
                  {email}
                </div>
              </div>
            </div>

            {/* 3 Read-Only Information Tiles */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 14,
              }}
            >
              {/* Tile 1: Usuario */}
              <div
                style={{
                  background: isDark ? "#0d1217" : "#f0f3f7",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.06)"
                    : "1.5px solid rgba(0, 0, 0, 0.06)",
                  borderRadius: 14,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                  }}
                >
                  {t("profile.username")}
                </div>
                <div
                  style={{
                    fontSize: 15.5,
                    fontWeight: 600,
                    color: isDark ? "#8899aa" : "#334455",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {username}
                </div>
              </div>

              {/* Tile 2: Correo */}
              <div
                style={{
                  background: isDark ? "#0d1217" : "#f0f3f7",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.06)"
                    : "1.5px solid rgba(0, 0, 0, 0.06)",
                  borderRadius: 14,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                  }}
                >
                  {t("profile.email")}
                </div>
                <div
                  style={{
                    fontSize: 15.5,
                    fontWeight: 600,
                    color: isDark ? "#8899aa" : "#334455",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {email}
                </div>
              </div>

              {/* Tile 3: Fecha */}
              <div
                style={{
                  background: isDark ? "#0d1217" : "#f0f3f7",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.06)"
                    : "1.5px solid rgba(0, 0, 0, 0.06)",
                  borderRadius: 14,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isDark ? "#657788" : "#778899",
                  }}
                >
                  {t("profile.memberSince")}
                </div>
                <div
                  style={{
                    fontSize: 15.5,
                    fontWeight: 600,
                    color: isDark ? "#8899aa" : "#334455",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {joinDate}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Seguridad y Contraseña */}
          <div className="settings-card">
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: isDark ? "#657788" : "#778899",
                marginBottom: 8,
              }}
            >
              {t("profile.security")}
            </div>

            <div
              className="settings-row"
              style={{
                borderBottom: "none",
                paddingBottom: 0,
                paddingTop: 6,
                minHeight: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              {loadingMethods ? (
                <>
                  <div>
                    <div
                      style={{
                        fontSize: 17.5,
                        fontWeight: 700,
                        color: isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(17, 24, 34, 0.4)",
                        marginBottom: 3,
                      }}
                    >
                      {t("profile.security")}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        color: isDark ? "#657788" : "#8899aa",
                        lineHeight: 1.45,
                      }}
                    >
                      {t("common.loading")}
                    </div>
                  </div>
                  <div
                    style={{
                      height: 44,
                      padding: "0 20px",
                      borderRadius: 12,
                      background: isDark ? "#0d1217" : "#f0f3f7",
                      border: isDark
                        ? "1.5px solid rgba(255, 255, 255, 0.08)"
                        : "1.5px solid rgba(0, 0, 0, 0.08)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: isDark ? "#657788" : "#8899aa",
                      fontFamily: BASE_FONT,
                      fontSize: 14,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={14}
                      height={14}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      style={{ animation: "spin 1s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span>{t("common.loading")}</span>
                  </div>
                </>
              ) : methodsError || !authMethods ? (
                <div>
                  <div
                    style={{
                      fontSize: 17.5,
                      fontWeight: 700,
                      color: isDark ? "white" : "#111822",
                      marginBottom: 3,
                    }}
                  >
                    {t("profile.security")}
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      color: isDark ? "#8899aa" : "#556677",
                      lineHeight: 1.45,
                    }}
                  >
                    {t("profile.methodsError")}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div
                      style={{
                        fontSize: 17.5,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                        marginBottom: 3,
                      }}
                    >
                      {hasPassword
                        ? t("profile.resetPassword")
                        : t("profile.linkedMethods")}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        color: isDark ? "#8899aa" : "#556677",
                        lineHeight: 1.45,
                      }}
                    >
                      {hasPassword
                        ? t("profile.resetPasswordDesc")
                        : t("profile.oauthManagedDesc")}
                    </div>
                  </div>

                  {/* Action Area: Password Reset Action Button OR Linked Providers Display */}
                  {hasPassword ? (
                    <button
                      type="button"
                      onClick={handleSendResetEmail}
                      disabled={resetState === "sending"}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "11px 24px",
                        borderRadius: 12,
                        background: isDark ? "#0d1217" : "#f0f3f7",
                        border: isDark
                          ? "1.5px solid rgba(255, 255, 255, 0.12)"
                          : "1.5px solid rgba(0, 0, 0, 0.12)",
                        cursor: resetState === "sending" ? "wait" : "pointer",
                        color: isDark ? "white" : "#111822",
                        fontFamily: BASE_FONT,
                        fontSize: 15,
                        fontWeight: 700,
                        transition: "all 0.16s ease",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        if (resetState !== "sending") {
                          e.currentTarget.style.borderColor = isDark
                            ? "rgba(255, 255, 255, 0.28)"
                            : "rgba(0, 0, 0, 0.25)"
                          e.currentTarget.style.background = isDark
                            ? "#151e26"
                            : "#e4e8ee"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (resetState !== "sending") {
                          e.currentTarget.style.borderColor = isDark
                            ? "rgba(255, 255, 255, 0.12)"
                            : "rgba(0, 0, 0, 0.12)"
                          e.currentTarget.style.background = isDark
                            ? "#0d1217"
                            : "#f0f3f7"
                        }
                      }}
                    >
                      {resetState === "sending" ? (
                        <>
                          <svg
                            width={14}
                            height={14}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            style={{ animation: "spin 1s linear infinite" }}
                          >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                          <span>{t("common.loading")}...</span>
                        </>
                      ) : resetState === "sent" ? (
                        <>
                          <svg
                            width={14}
                            height={14}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#3ec4c0"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span style={{ color: isDark ? "#ffffff" : "#111822" }}>
                            {t("profile.emailSent")}
                          </span>
                        </>
                      ) : (
                        <>
                          <svg
                            width={14}
                            height={14}
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
                          <span>{t("profile.sendResetEmail")}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      {externalMethods.map((m) => (
                        <div
                          key={m.type}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 18px",
                            borderRadius: 12,
                            background: isDark ? "#0d1217" : "#f0f3f7",
                            border: isDark
                              ? "1.5px solid rgba(255, 255, 255, 0.12)"
                              : "1.5px solid rgba(0, 0, 0, 0.12)",
                            color: isDark ? "white" : "#111822",
                            fontFamily: BASE_FONT,
                            fontSize: 14.5,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {m.type === "GOOGLE" && (
                            <svg width={16} height={16} viewBox="0 0 24 24">
                              <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                fill="#4285F4"
                              />
                              <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                              />
                              <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                                fill="#FBBC05"
                              />
                              <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                                fill="#EA4335"
                              />
                            </svg>
                          )}
                          {m.type === "DISCORD" && (
                            <svg
                              width={16}
                              height={16}
                              viewBox="0 0 24 24"
                              fill="#5865F2"
                            >
                              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                            </svg>
                          )}
                          <span>
                            {m.type === "GOOGLE"
                              ? t("profile.providerGoogle")
                              : m.type === "DISCORD"
                                ? t("profile.providerDiscord")
                                : m.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Card 3: Sesión & Cerrar Sesión */}
          <div className="settings-card">
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: isDark ? "#657788" : "#778899",
                marginBottom: 8,
              }}
            >
              {t("profile.session")}
            </div>

            <div
              className="settings-row"
              style={{
                borderBottom: "none",
                paddingBottom: 0,
                paddingTop: 6,
                minHeight: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 17.5,
                    fontWeight: 700,
                    color: isDark ? "white" : "#111822",
                    marginBottom: 3,
                  }}
                >
                  {t("profile.logoutTitle")}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: isDark ? "#8899aa" : "#556677",
                    lineHeight: 1.45,
                  }}
                >
                  {t("profile.logoutDesc")}
                </div>
              </div>

              <button
                type="button"
                onClick={onLogout}
                className="launcher-btn-danger"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 44,
                  padding: "0 22px",
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: BASE_FONT,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>{t("profile.logoutButton")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Real-time Toast ── */}
        <LiveToast message={toastState.message} type={toastState.type} />
      </div>
    </div>
  )
}
