import React, { useState, useRef, useEffect } from "react"
import { ThemeMode, SkinItem } from "../types"
import { hexToRGB, CANVAS_W, BASE_FONT } from "../theme/tokens"
import MinecraftHead from "../components/minecraft/MinecraftHead"
import LiveToast from "../components/common/LiveToast"
import { useTranslation } from "../context/LanguageContext"

import { authService } from "../services/authService"

interface ProfileViewProps {
  username: string
  activeSkinData?: SkinItem | null
  onBack: () => void
  theme?: ThemeMode
}

export default function ProfileView({
  username,
  activeSkinData,
  onBack,
  theme = "dark",
}: ProfileViewProps) {
  const { t } = useTranslation()
  const cachedUser = authService.getCachedUser()

  const [email] = useState(
    cachedUser?.email ||
      `${username.toLowerCase().replace(/\s+/g, "")}@gmail.com`,
  )
  const [joinDate] = useState(
    cachedUser?.createdAt
      ? new Date(cachedUser.createdAt).toLocaleDateString()
      : "24/11/2025",
  )
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
        showToast(res.message || t("profile.emailError"), "error")
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
              style={{ borderBottom: "none", paddingBottom: 0, paddingTop: 6 }}
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
                  {t("profile.resetPassword")}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: isDark ? "#8899aa" : "#556677",
                    lineHeight: 1.45,
                  }}
                >
                  {t("profile.resetPasswordDesc")}
                </div>
              </div>

              {/* Password Reset Action Button */}
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
            </div>
          </div>
        </div>

        {/* ── Real-time Toast ── */}
        <LiveToast message={toastState.message} type={toastState.type} />
      </div>
    </div>
  )
}
