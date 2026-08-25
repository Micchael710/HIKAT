import { ThemeMode } from "../types"

import {
  logoWhite,
  logoBlack,
  logoReducedWhite,
  logoReducedBlack,
} from "../assets"

export const CANVAS_W = 1920

export const CANVAS_H = 2460

export const MIN_WINDOW_W = 1024

export const MIN_WINDOW_H = 576

export const DEFAULT_WINDOW_W = 1280

export const DEFAULT_WINDOW_H = 720

export const BASE_FONT = "Inter, sans-serif"

export function hexToRGB(hex: string) {
  if (!hex || !hex.startsWith("#") || hex.length < 7) {
    return { r: 130, g: 188, b: 208, css: "130, 188, 208" }
  }

  const r = parseInt(hex.slice(1, 3), 16)

  const g = parseInt(hex.slice(3, 5), 16)

  const b = parseInt(hex.slice(5, 7), 16)

  return { r, g, b, css: `${r}, ${g}, ${b}` }
}

export function getThemeTokens(theme: ThemeMode) {
  const isDark = theme === "dark"

  return {
    isDark,

    bgBase: isDark ? "#1a2228" : "#eef2f6",

    bgScreen: isDark ? "#090d12" : "#f5f7fa",

    bgCard: isDark ? "#121a22" : "#ffffff",

    bgCardAlt: isDark ? "#11181f" : "#f8fafc",

    bgCardInner: isDark ? "#080e13" : "#f0f3f7",

    bgCardHover: isDark ? "#15222b" : "#f0f4f8",

    bgInput: isDark ? "#0d1217" : "#f0f3f7",

    bgPill: isDark ? "#0d1217" : "#e6ebf0",

    bgPillActive: isDark ? "#1c2630" : "#ffffff",

    bgSidebar: isDark ? "rgba(12, 17, 22, 0.75)" : "rgba(255, 255, 255, 0.85)",

    borderSubtle: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",

    borderMedium: isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.14)",

    borderHover: isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.22)",

    textPrimary: isDark ? "#ffffff" : "#111822",

    textSecondary: isDark ? "#8899aa" : "#556677",

    textTertiary: isDark ? "#657788" : "#778899",

    textMuted: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)",

    divider: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",

    cardShadow: isDark
      ? "0 8px 24px rgba(0, 0, 0, 0.35)"
      : "0 8px 24px rgba(0, 0, 0, 0.06)",

    cardShadowLg: isDark
      ? "0 16px 48px rgba(0, 0, 0, 0.55)"
      : "0 16px 48px rgba(0, 0, 0, 0.12)",

    dropdownShadow: isDark
      ? "0 16px 40px rgba(0, 0, 0, 0.75)"
      : "0 16px 40px rgba(0, 0, 0, 0.15)",

    homeLeftGradient: isDark
      ? "linear-gradient(to right, #1a2228 0%, #1a2228 18%, rgba(26,34,40,0.85) 32%, rgba(26,34,40,0) 74%)"
      : "linear-gradient(to right, #eef2f6 0%, #eef2f6 18%, rgba(238,242,246,0.85) 32%, rgba(238,242,246,0) 74%)",

    homeBottomGradient: isDark
      ? "linear-gradient(to bottom, rgba(26, 34, 40, 0) 0%, rgba(26, 34, 40, 0.4) 35%, rgba(26, 34, 40, 0.88) 65%, #1a2228 85%, #1a2228 100%)"
      : "linear-gradient(to bottom, rgba(238, 242, 246, 0) 0%, rgba(238, 242, 246, 0.4) 35%, rgba(238, 242, 246, 0.92) 65%, #eef2f6 85%, #eef2f6 100%)",

    homeBottomCutBg: isDark ? "#090d12" : "#f5f7fa",

    logoReduced: isDark ? logoReducedWhite : logoReducedBlack,

    logoExpanded: isDark ? logoWhite : logoBlack,
  }
}
