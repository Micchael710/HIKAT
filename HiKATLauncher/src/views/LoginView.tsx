import React, { useState } from "react";
import { ThemeMode } from "../types";
import { IconGoogle } from "../theme/icons";
import { BASE_FONT } from "../theme/tokens";
import { loginBg, logoReducedWhite, logoReducedBlack } from "../assets";
import { useTranslation } from "../context/LanguageContext";
import {
  sanitizeUsername,
  sanitizeEmail,
  sanitizeInput,
} from "../utils/security";

const LAUNCHER_VERSION = "v1.0.0";

interface LoginViewProps {
  onLogin: (username: string) => void;
  theme?: ThemeMode;
}

export default function LoginView({ onLogin, theme = "dark" }: LoginViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [keepSession, setKeepSession] = useState(false);
  const [isEnteringWorld, setIsEnteringWorld] = useState(false);
  const isDark = theme === "dark";

  const handleSubmit = () => {
    if (isEnteringWorld) return;
    setIsEnteringWorld(true);
    const cleanName = sanitizeUsername(username.trim()) || t("user.anonymous");
    setTimeout(() => {
      onLogin(cleanName);
    }, 420);
  };

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
  };

  const labelCss: React.CSSProperties = {
    display: "block",
    marginBottom: 5,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: isDark ? "#657788" : "#778899",
    fontFamily: BASE_FONT,
    textTransform: "uppercase",
  };

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
                ? t("auth.loginSubtitle")
                : t("auth.registerSubtitle")}
            </div>
          </div>

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
              const isCurrent = tab === tCode;
              return (
                <button
                  key={tCode}
                  type="button"
                  onClick={() => setTab(tCode)}
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
              );
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
            <div>
              <label style={labelCss}>
                {tab === "login"
                  ? t("auth.usernameLabel")
                  : t("auth.usernameRegisterLabel")}
              </label>
              <input
                type="text"
                value={username}
                maxLength={16}
                autoComplete="username"
                spellCheck={false}
                placeholder={
                  tab === "login"
                    ? t("auth.usernamePlaceholderLogin")
                    : t("auth.usernamePlaceholderRegister")
                }
                onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                className="launcher-input"
                style={inputCss}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>

            {tab === "register" && (
              <div style={{ animation: "slideUpFade 0.18s ease" }}>
                <label style={labelCss}>{t("auth.emailLabel")}</label>
                <input
                  type="email"
                  value={email}
                  maxLength={254}
                  autoComplete="email"
                  spellCheck={false}
                  placeholder={t("auth.emailPlaceholder")}
                  onChange={(e) => setEmail(sanitizeEmail(e.target.value))}
                  className="launcher-input"
                  style={inputCss}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                  }}
                />
              </div>
            )}

            <div>
              <label style={labelCss}>{t("auth.passwordLabel")}</label>
              <input
                type="password"
                value={password}
                maxLength={128}
                autoComplete={
                  tab === "login" ? "current-password" : "new-password"
                }
                placeholder={t("auth.passwordPlaceholder")}
                onChange={(e) =>
                  setPassword(sanitizeInput(e.target.value, 128))
                }
                className="launcher-input"
                style={inputCss}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
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

          {/* Primary CTA Submit Button with white text & shadow */}
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
              color: "white",
              fontSize: 15,
              fontWeight: 800,
              fontFamily: BASE_FONT,
              letterSpacing: "0.03em",
              cursor: isEnteringWorld ? "default" : "pointer",
              textShadow: "0 1px 4px rgba(0,0,0,0.35)",
              boxShadow: isEnteringWorld
                ? "0 0 32px rgba(239, 196, 54, 0.65)"
                : "0 0 20px rgba(239, 196, 54, 0.35)",
              transition: "transform 0.18s ease, box-shadow 0.18s ease",
              marginBottom: 10,
              transform: isEnteringWorld ? "scale(0.98)" : "none",
            }}
            onMouseEnter={(e) => {
              if (!isEnteringWorld) {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow =
                  "0 0 28px rgba(239, 196, 54, 0.55), 0 6px 20px rgba(0, 0, 0, 0.4)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isEnteringWorld) {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow =
                  "0 0 20px rgba(239, 196, 54, 0.35)";
              }
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
                <span>{t("auth.entering")}</span>
              </div>
            ) : (
              <>
                <span>
                  {tab === "login"
                    ? t("auth.continue")
                    : t("auth.createAccount")}
                </span>
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 20 20"
                  fill="none"
                  style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }}
                >
                  <path
                    d="M6.6875 18.3333L5.20833 16.8542L12.0625 10L5.20833 3.14583L6.6875 1.66667L15.0208 10L6.6875 18.3333Z"
                    fill="white"
                  />
                </svg>
              </>
            )}
          </button>

          {/* Social Auth (Google) */}
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
              height: 42,
              borderRadius: 12,
              background: isDark ? "#121a22" : "#f0f3f7",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.1)",
              color: isDark ? "white" : "#111822",
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: BASE_FONT,
              cursor: isEnteringWorld ? "default" : "pointer",
              transition: "all 0.18s ease",
            }}
            onMouseEnter={(e) => {
              if (!isEnteringWorld) {
                e.currentTarget.style.borderColor = isDark
                  ? "rgba(255, 255, 255, 0.2)"
                  : "rgba(0, 0, 0, 0.2)";
                e.currentTarget.style.background = isDark
                  ? "#182430"
                  : "#e4e8ee";
              }
            }}
            onMouseLeave={(e) => {
              if (!isEnteringWorld) {
                e.currentTarget.style.borderColor = isDark
                  ? "rgba(255, 255, 255, 0.08)"
                  : "rgba(0, 0, 0, 0.1)";
                e.currentTarget.style.background = isDark
                  ? "#121a22"
                  : "#f0f3f7";
              }
            }}
          >
            <IconGoogle size={16} />
            <span>
              {tab === "login"
                ? t("auth.continueGoogle")
                : t("auth.registerGoogle")}
            </span>
          </button>
        </div>

        {/* Bottom Footer */}
        <div
          style={{
            paddingTop: 16,
            borderTop: isDark
              ? "1px solid rgba(255, 255, 255, 0.06)"
              : "1px solid rgba(0, 0, 0, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: isDark ? "#657788" : "#778899",
              fontFamily: BASE_FONT,
            }}
          >
            HiKAT Launcher
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: isDark ? "#657788" : "#778899",
              fontFamily: BASE_FONT,
            }}
          >
            {LAUNCHER_VERSION}
          </span>
        </div>
      </div>

      {/* ── Right Hero Panel ── */}
      <div
        style={{
          flex: 1,
          height: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <img
          src={loginBg}
          alt="Apparatia World"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "left center",
            display: "block",
            transform: isEnteringWorld ? "scale(1.08)" : "scale(1)",
            filter: isEnteringWorld
              ? "brightness(1.15) blur(2px)"
              : "brightness(1) blur(0)",
            transition:
              "transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), filter 0.55s ease",
          }}
        />
      </div>
    </div>
  );
}
