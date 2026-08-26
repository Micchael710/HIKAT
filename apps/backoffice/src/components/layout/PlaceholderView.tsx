import React from "react"
import type { ThemeMode } from "../../types"

interface PlaceholderViewProps {
  title: string
  icon: React.ReactNode
  theme: ThemeMode
}

export default function PlaceholderView({
  title,
  icon,
  theme,
}: PlaceholderViewProps) {
  const isDark = theme === "dark"

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "viewFadeIn 0.24s ease",
        textAlign: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 24,
          background: isDark ? "#121a22" : "#ffffff",
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.1)"
            : "1.5px solid rgba(0, 0, 0, 0.08)",
          boxShadow: isDark
            ? "0 12px 32px rgba(0, 0, 0, 0.4)"
            : "0 8px 24px rgba(0, 0, 0, 0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#3ec4c0",
          marginBottom: 20,
        }}
      >
        {icon}
      </div>

      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 26,
          fontWeight: 800,
          color: isDark ? "#ffffff" : "#111822",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 500,
          color: isDark ? "rgba(255, 255, 255, 0.45)" : "#778899",
        }}
      >
        Próximamente
      </p>
    </div>
  )
}
