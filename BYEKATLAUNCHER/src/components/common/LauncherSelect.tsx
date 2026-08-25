import React, { useState, useRef, useEffect } from "react"
import { ThemeMode } from "../../types"
import { BASE_FONT } from "../../theme/tokens"

export interface LauncherSelectOption {
  value: string
  label: string
}

interface LauncherSelectProps {
  value: string
  options: LauncherSelectOption[]
  onChange: (val: string) => void
  theme?: ThemeMode
  width?: number | string
}

export default function LauncherSelect({
  value,
  options,
  onChange,
  theme = "dark",
  width = 280,
}: LauncherSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isDark = theme === "dark"

  const current = options.find((o) => o.value === value) || options[0]

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          height: 48,
          padding: "0 18px",
          borderRadius: 12,
          background: isDark ? "#0d1217" : "#f0f3f7",
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.12)"
            : "1.5px solid rgba(0, 0, 0, 0.12)",
          color: isDark ? "white" : "#111822",
          fontSize: 15.5,
          fontWeight: 600,
          fontFamily: BASE_FONT,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          transition: "border-color 0.16s ease",
        }}
      >
        <span>{current.label}</span>
        <svg
          width={11}
          height={11}
          viewBox="0 0 11 11"
          fill="none"
          stroke={isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)"}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        >
          <polyline points="1 3.5 5.5 8 10 3.5" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: isDark ? "#131c23" : "#ffffff",
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.12)"
              : "1.5px solid rgba(0, 0, 0, 0.12)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: isDark
              ? "0 16px 40px rgba(0, 0, 0, 0.75)"
              : "0 16px 40px rgba(0, 0, 0, 0.15)",
            zIndex: 999,
            animation: "fadeIn 0.15s ease",
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                style={{
                  width: "100%",
                  padding: "12px 18px",
                  textAlign: "left",
                  background: isSelected
                    ? isDark
                      ? "#1e2c38"
                      : "#e6ebf0"
                    : "transparent",
                  color: isSelected ? "#3ec4c0" : isDark ? "white" : "#111822",
                  fontSize: 15,
                  fontWeight: isSelected ? 700 : 500,
                  fontFamily: BASE_FONT,
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "background 0.12s ease",
                }}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="#3ec4c0"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="2.5 6 5 8.5 9.5 3.5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
