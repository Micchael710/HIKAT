import React from "react"
import type { ServerStatus, ThemeMode } from "../../types"
import { getServerStatusLabel } from "@hikat/shared"

interface ServerStatusBadgeProps {
  status: ServerStatus
  theme: ThemeMode
  size?: "sm" | "md" | "lg"
}

export default function ServerStatusBadge({
  status,
  theme,
  size = "md",
}: ServerStatusBadgeProps) {
  const isDark = theme === "dark"

  const getStatusColor = (s: ServerStatus) => {
    switch (s) {
      case "ONLINE":
        return {
          bg: isDark ? "rgba(16, 185, 129, 0.16)" : "rgba(16, 185, 129, 0.12)",
          border: "rgba(16, 185, 129, 0.35)",
          text: isDark ? "#34d399" : "#059669",
          dot: "#10b981",
          pulse: true,
        }
      case "STARTING":
        return {
          bg: isDark ? "rgba(245, 158, 11, 0.16)" : "rgba(245, 158, 11, 0.12)",
          border: "rgba(245, 158, 11, 0.35)",
          text: isDark ? "#fbbf24" : "#d97706",
          dot: "#f59e0b",
          pulse: true,
        }
      case "STOPPING":
        return {
          bg: isDark ? "rgba(249, 115, 22, 0.16)" : "rgba(249, 115, 22, 0.12)",
          border: "rgba(249, 115, 22, 0.35)",
          text: isDark ? "#fb923c" : "#ea580c",
          dot: "#f97316",
          pulse: true,
        }
      case "OFFLINE":
        return {
          bg: isDark ? "rgba(107, 114, 128, 0.16)" : "rgba(107, 114, 128, 0.12)",
          border: "rgba(107, 114, 128, 0.3)",
          text: isDark ? "#9ca3af" : "#4b5563",
          dot: "#6b7280",
          pulse: false,
        }
      case "DISCONNECTED":
        return {
          bg: isDark ? "rgba(239, 68, 68, 0.16)" : "rgba(239, 68, 68, 0.12)",
          border: "rgba(239, 68, 68, 0.35)",
          text: isDark ? "#f87171" : "#dc2626",
          dot: "#ef4444",
          pulse: false,
        }
      case "UNKNOWN":
      default:
        return {
          bg: isDark ? "rgba(148, 163, 184, 0.16)" : "rgba(148, 163, 184, 0.12)",
          border: "rgba(148, 163, 184, 0.3)",
          text: isDark ? "#cbd5e1" : "#64748b",
          dot: "#94a3b8",
          pulse: false,
        }
    }
  }

  const config = getStatusColor(status)
  const label = getServerStatusLabel(status)

  const sizeStyles = {
    sm: { padding: "4px 10px", fontSize: "0.8rem", dotSize: 7 },
    md: { padding: "6px 14px", fontSize: "0.875rem", dotSize: 9 },
    lg: { padding: "8px 18px", fontSize: "1rem", dotSize: 11 },
  }[size]

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: sizeStyles.padding,
        borderRadius: 999,
        background: config.bg,
        border: `1px solid ${config.border}`,
        color: config.text,
        fontSize: sizeStyles.fontSize,
        fontWeight: 600,
        letterSpacing: "0.02em",
        userSelect: "none",
        backdropFilter: "blur(8px)",
      }}
    >
      <span
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: sizeStyles.dotSize,
          height: sizeStyles.dotSize,
        }}
      >
        {config.pulse && (
          <span
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: config.dot,
              opacity: 0.65,
              animation: "ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite",
            }}
          />
        )}
        <span
          style={{
            position: "relative",
            width: sizeStyles.dotSize,
            height: sizeStyles.dotSize,
            borderRadius: "50%",
            background: config.dot,
            boxShadow: `0 0 8px ${config.dot}`,
          }}
        />
      </span>
      <span>{label}</span>
    </div>
  )
}
