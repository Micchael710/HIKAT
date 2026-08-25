import React, { useState, useRef, useEffect } from "react"

import { ThemeMode, SkinItem } from "../../types"

import MinecraftHead from "../minecraft/MinecraftHead"

import { useTranslation } from "../../context/LanguageContext"

interface UserProfileCardProps {
  username: string

  activeSkinData?: SkinItem | null

  s: number

  onLogout: () => void

  onOpenProfile: () => void

  theme?: ThemeMode
}

export default function UserProfileCard({
  username,

  activeSkinData,

  s,

  onLogout,

  onOpenProfile,

  theme = "dark",
}: UserProfileCardProps) {
  const { t } = useTranslation()

  const [isOpen, setIsOpen] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)

  const isDark = theme === "dark"

  // Close on outside click

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    window.addEventListener("mousedown", handleClickOutside)

    return () => window.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen])

  const smallAvatarSize = Math.round(38 * s)

  const largeAvatarSize = Math.round(52 * s)

  return (
    <div ref={cardRef} style={{ position: "relative", pointerEvents: "auto" }}>
      {!isOpen ? (
        /* ── Collapsed Pill ── */

        <button
          onClick={() => setIsOpen(true)}
          className="profile-pill-btn"
          style={{
            display: "inline-flex",

            alignItems: "center",

            gap: Math.round(10 * s),

            borderRadius: Math.round(20 * s),

            padding: `${Math.round(4 * s)}px ${Math.round(12 * s)}px ${Math.round(4 * s)}px ${Math.round(4 * s)}px`,

            cursor: "pointer",

            border: isDark
              ? "2px solid rgba(255,255,255,0.08)"
              : "1.5px solid rgba(0,0,0,0.1)",

            background: isDark ? "#131c23" : "#ffffff",

            boxShadow: isDark ? "none" : "0 4px 14px rgba(0, 0, 0, 0.08)",

            userSelect: "none",
          }}
        >
          <div
            style={{
              width: smallAvatarSize,

              height: smallAvatarSize,

              borderRadius: "50%",

              overflow: "hidden",

              border: `${Math.max(1, Math.round(1.5 * s))}px solid ${
                isDark ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.15)"
              }`,

              background: isDark ? "#131c23" : "#f0f3f7",

              display: "flex",

              alignItems: "center",

              justifyContent: "center",

              flexShrink: 0,
            }}
          >
            <MinecraftHead
              skinId={activeSkinData?.id}
              skinColor={activeSkinData?.skin}
              customImgUrl={
                activeSkinData?.customImgUrl || activeSkinData?.skinUrl
              }
              size={smallAvatarSize}
            />
          </div>
          <svg
            width={Math.round(11 * s)}
            height={Math.round(8 * s)}
            viewBox="0 0 12 8"
            fill={isDark ? "rgba(255,255,255,.8)" : "#111822"}
            style={{
              flexShrink: 0,

              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",

              transition: "transform 0.22s ease",
            }}
          >
            <path d="M1.41.84h9.18c.7 0 1.08.81.63 1.31L6.63 7.03a.85.85 0 0 1-1.26 0L.78 2.15C.33 1.65.71.84 1.41.84z" />
          </svg>
        </button>
      ) : (
        /* ── Expanded Profile Dropdown Card ── */

        <div
          className="profile-dropdown-card"
          style={{
            width: Math.round(230 * s),

            borderRadius: Math.round(18 * s),

            padding: `${Math.round(18 * s)}px ${Math.round(16 * s)}px ${Math.round(14 * s)}px`,

            background: isDark ? "#11181f" : "#ffffff",

            border: isDark
              ? "2px solid rgba(255, 255, 255, 0.12)"
              : "1.5px solid rgba(0, 0, 0, 0.1)",

            boxShadow: isDark
              ? "0 16px 40px rgba(0, 0, 0, 0.75)"
              : "0 16px 40px rgba(0, 0, 0, 0.15)",

            userSelect: "none",

            animation: "profileDropIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",

            transformOrigin: "top right",
          }}
        >
          {/* Top Identity Block — Entire header is clickable to close */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              cursor: "pointer",

              borderRadius: Math.round(10 * s),

              transition: "background 0.16s ease",
            }}
          >
            <div
              style={{
                display: "flex",

                alignItems: "center",

                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  width: largeAvatarSize,

                  height: largeAvatarSize,

                  borderRadius: "50%",

                  overflow: "hidden",

                  border: `${Math.max(1.5, Math.round(2 * s))}px solid ${
                    isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.12)"
                  }`,

                  background: isDark ? "#131c23" : "#f0f3f7",

                  display: "flex",

                  alignItems: "center",

                  justifyContent: "center",

                  flexShrink: 0,

                  boxShadow: isDark
                    ? "0 4px 14px rgba(0, 0, 0, 0.45)"
                    : "0 4px 14px rgba(0, 0, 0, 0.08)",
                }}
              >
                <MinecraftHead
                  skinId={activeSkinData?.id}
                  skinColor={activeSkinData?.skin}
                  customImgUrl={
                    activeSkinData?.customImgUrl || activeSkinData?.skinUrl
                  }
                  size={largeAvatarSize}
                />
              </div>

              {/* Close Chevron Indicator */}
              <div
                style={{
                  display: "flex",

                  alignItems: "center",

                  justifyContent: "center",

                  padding: Math.round(6 * s),

                  borderRadius: "50%",

                  color: isDark ? "rgba(255, 255, 255, 0.5)" : "#556677",
                }}
              >
                <svg
                  width={Math.round(11 * s)}
                  height={Math.round(8 * s)}
                  viewBox="0 0 12 8"
                  fill="currentColor"
                  style={{
                    transform: "rotate(180deg)",

                    transition: "transform 0.22s ease",
                  }}
                >
                  <path d="M1.41.84h9.18c.7 0 1.08.81.63 1.31L6.63 7.03a.85.85 0 0 1-1.26 0L.78 2.15C.33 1.65.71.84 1.41.84z" />
                </svg>
              </div>
            </div>

            {/* Username */}
            <div
              style={{
                marginTop: Math.round(14 * s),

                marginBottom: Math.round(18 * s),
              }}
            >
              <div
                style={{
                  fontSize: Math.round(18 * s),

                  fontWeight: 800,

                  color: isDark ? "#ffffff" : "#111822",

                  fontFamily: "Inter, sans-serif",

                  letterSpacing: "-0.02em",

                  whiteSpace: "nowrap",

                  overflow: "hidden",

                  textOverflow: "ellipsis",

                  lineHeight: 1.15,
                }}
              >
                {username}
              </div>
            </div>
          </div>

          {/* Menu items: Ver perfil & Cerrar sesión */}
          <div
            style={{
              display: "flex",

              flexDirection: "column",

              gap: Math.round(4 * s),
            }}
          >
            <button
              onClick={() => {
                setIsOpen(false)

                onOpenProfile()
              }}
              className="profile-menu-item"
              style={{
                padding: `${Math.round(9 * s)}px ${Math.round(12 * s)}px`,

                fontSize: Math.round(14.5 * s),

                fontWeight: 700,

                color: isDark ? "rgba(255,255,255,0.75)" : "#111822",
              }}
            >
              {t("user.profile")}
            </button>

            <button
              onClick={() => {
                setIsOpen(false)

                onLogout()
              }}
              className="profile-menu-item is-danger"
              style={{
                padding: `${Math.round(9 * s)}px ${Math.round(12 * s)}px`,

                fontSize: Math.round(14.5 * s),

                fontWeight: 700,
              }}
            >
              {t("user.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
