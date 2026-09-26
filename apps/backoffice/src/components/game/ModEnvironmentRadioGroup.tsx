import React from "react"
import type { ThemeMode, ModEnvironment } from "../../types"
import { getThemeTokens } from "../../theme/tokens"

interface ModEnvironmentRadioGroupProps {
  theme: ThemeMode
  value: ModEnvironment
  onChange: (value: ModEnvironment) => void
  name?: string
  disabled?: boolean
  label?: string
}

export const ENVIRONMENT_OPTIONS: Array<{
  key: ModEnvironment
  testId: string
  title: string
  description: string
}> = [
  {
    key: "CLIENT",
    testId: "option-env-client",
    title: "Solo cliente",
    description: "El mod solo se descargará en los clientes del juego.",
  },
  {
    key: "BOTH",
    testId: "option-env-both",
    title: "Cliente y servidor",
    description: "El mod se descargará en los clientes y se sincronizará con el servidor tras publicar la release.",
  },
  {
    key: "SERVER",
    testId: "option-env-server",
    title: "Solo servidor",
    description: "El mod se sincronizará exclusivamente con el servidor y se excluirá de la descarga del cliente.",
  },
]

export default function ModEnvironmentRadioGroup({
  theme,
  value,
  onChange,
  name = "mod-environment",
  disabled = false,
  label = "¿Dónde necesita ejecutarse este mod?",
}: ModEnvironmentRadioGroupProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {label && (
        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: "600",
            color: tokens.textPrimary,
            marginBottom: "2px",
          }}
        >
          {label}
        </label>
      )}
      {ENVIRONMENT_OPTIONS.map((opt) => {
        const isSelected = value === opt.key
        return (
          <label
            key={opt.key}
            data-testid={opt.testId}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              padding: "12px 14px",
              borderRadius: "12px",
              border: `1px solid ${isSelected ? "#3ec4c0" : tokens.borderSubtle}`,
              backgroundColor: isSelected
                ? isDark
                  ? "rgba(62, 196, 192, 0.1)"
                  : "rgba(62, 196, 192, 0.06)"
                : tokens.bgCardInner,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="radio"
              name={name}
              value={opt.key}
              checked={isSelected}
              onChange={() => onChange(opt.key)}
              disabled={disabled}
              style={{ marginTop: "3px", accentColor: "#3ec4c0" }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: tokens.textPrimary }}>
                {opt.title}
              </div>
              <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                {opt.description}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}

export function formatEnvironmentLabel(env: ModEnvironment | string): string {
  switch (env) {
    case "SERVER":
      return "Solo servidor"
    case "CLIENT":
      return "Solo cliente"
    case "BOTH":
    default:
      return "Cliente y servidor"
  }
}

export function getEnvironmentBadgeStyle(env: ModEnvironment | string, isDark: boolean): React.CSSProperties {
  switch (env) {
    case "SERVER":
      return {
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: "600",
        backgroundColor: isDark ? "rgba(168, 85, 247, 0.15)" : "#f3e8ff",
        border: `1px solid ${isDark ? "rgba(168, 85, 247, 0.3)" : "#e9d5ff"}`,
        color: isDark ? "#c084fc" : "#7e22ce",
      }
    case "CLIENT":
      return {
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: "600",
        backgroundColor: isDark ? "rgba(59, 130, 246, 0.15)" : "#eff6ff",
        border: `1px solid ${isDark ? "rgba(59, 130, 246, 0.3)" : "#bfdbfe"}`,
        color: isDark ? "#60a5fa" : "#1d4ed8",
      }
    case "BOTH":
    default:
      return {
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: "600",
        backgroundColor: isDark ? "rgba(20, 184, 166, 0.15)" : "#ccfbf1",
        border: `1px solid ${isDark ? "rgba(20, 184, 166, 0.3)" : "#99f6e4"}`,
        color: isDark ? "#2dd4bf" : "#0f766e",
      }
  }
}
