import React from "react"
import { ThemeMode } from "../../types"

interface LiveToastProps {
  message: string | null
  type?: "success" | "error" | "info"
  theme?: ThemeMode
}

export default function LiveToast({
  message,
  type = "success",
  theme = "dark",
}: LiveToastProps) {
  if (!message) return null

  const isDark = theme === "dark"
  const isError = type === "error"
  const isInfo = type === "info"

  const borderColor = isError
    ? "rgba(255, 100, 80, 0.6)"
    : isInfo
      ? "rgba(239, 196, 54, 0.6)"
      : "rgba(62, 196, 192, 0.6)"

  const iconColor = isError
    ? "#ff6b5b"
    : isInfo
      ? "#efc436"
      : "#3ec4c0"

  return (
    <div
      style={{
        position: "fixed",
        bottom: 28,
        right: 28,
        background: isDark ? "#12181f" : "#ffffff",
        border: `1.5px solid ${borderColor}`,
        boxShadow: isDark
          ? "0 16px 40px rgba(0, 0, 0, 0.75)"
          : "0 16px 40px rgba(0, 0, 0, 0.15)",
        borderRadius: 14,
        padding: "12px 22px",
        color: isDark ? "#ffffff" : "#111822",
        fontSize: 14,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 9999,
        animation: "toastSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: iconColor,
          display: "inline-block",
        }}
      />
      <span>{message}</span>
    </div>
  )
}
