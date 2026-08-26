import React from "react"
import type { ThemeMode } from "../../types"

interface ServerResourceCardProps {
  label: string
  icon: React.ReactNode
  value: string
  subValue?: string
  percentage?: number | null
  theme: ThemeMode
  accentColor?: string
}

export default function ServerResourceCard({
  label,
  icon,
  value,
  subValue,
  percentage,
  theme,
  accentColor = "#3ec4c0",
}: ServerResourceCardProps) {
  const isDark = theme === "dark"
  const clampedPercent = percentage !== null && percentage !== undefined ? Math.min(Math.max(percentage, 0), 100) : null

  return (
    <div
      style={{
        flex: 1,
        minWidth: 200,
        padding: "18px 20px",
        borderRadius: 16,
        background: isDark
          ? "linear-gradient(145deg, rgba(19, 28, 35, 0.7) 0%, rgba(13, 20, 26, 0.7) 100%)"
          : "linear-gradient(145deg, rgba(255, 255, 255, 0.9) 0%, rgba(240, 243, 246, 0.9) 100%)",
        border: `1px solid ${
          isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"
        }`,
        boxShadow: isDark
          ? "0 4px 20px rgba(0, 0, 0, 0.25)"
          : "0 4px 20px rgba(0, 0, 0, 0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.65)",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          <span style={{ color: accentColor, display: "flex", alignItems: "center" }}>
            {icon}
          </span>
          <span>{label}</span>
        </div>

        {clampedPercent !== null && (
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)",
            }}
          >
            {clampedPercent.toFixed(0)} %
          </span>
        )}
      </div>

      {/* Main Metric Value */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: isDark ? "#ffffff" : "#0f172a",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        {subValue && (
          <span
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)",
            }}
          >
            {subValue}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {clampedPercent !== null && (
        <div
          style={{
            width: "100%",
            height: 6,
            borderRadius: 999,
            background: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${clampedPercent}%`,
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${accentColor} 0%, ${accentColor}dd 100%)`,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      )}
    </div>
  )
}
