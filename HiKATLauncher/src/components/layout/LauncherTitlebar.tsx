import React, { useState } from "react"
import { ThemeMode } from "../../types"

interface LauncherTitlebarProps {
  theme?: ThemeMode
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
}

export default function LauncherTitlebar({
  theme = "dark",
  onMinimize,
  onMaximize,
  onClose,
}: LauncherTitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const isDark = theme === "dark"

  React.useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (window as any).electronAPI?.onMaximizeChange
    ) {
      const cleanup = (window as any).electronAPI.onMaximizeChange(
        (maxState: boolean) => {
          setIsMaximized(maxState)
        },
      )
      ;(window as any).electronAPI.isMaximized?.().then?.((res: boolean) => {
        if (typeof res === "boolean") setIsMaximized(res)
      })
      return cleanup
    }
  }, [])

  const handleMinimize = () => {
    if (onMinimize) onMinimize()
    else if ((window as any).electronAPI) {
      ;(window as any).electronAPI?.minimizeWindow?.()
    }
  }

  const handleMaximize = () => {
    if (onMaximize) onMaximize()
    else if ((window as any).electronAPI) {
      ;(window as any).electronAPI?.maximizeWindow?.()
    } else {
      setIsMaximized((v) => !v)
    }
  }

  const handleClose = () => {
    if (onClose) onClose()
    else if ((window as any).electronAPI) {
      ;(window as any).electronAPI?.closeWindow?.()
    }
  }

  return (
    <>
      {/* Invisible Top Drag Region for Frameless Window */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 38,
          zIndex: 9990,
          WebkitAppRegion: "drag" as any,
          pointerEvents: "auto",
        }}
      />

      {/* Top-Right Window Action Buttons Overlay (Corner Flush) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: 36,
          display: "flex",
          alignItems: "stretch",
          zIndex: 9999,
          pointerEvents: "auto",
          WebkitAppRegion: "no-drag" as any,
        }}
      >
        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          title="Minimizar"
          style={{
            width: 44,
            height: "100%",
            background: "transparent",
            border: "none",
            color: isDark ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.14s ease, color 0.14s ease",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(0, 0, 0, 0.08)"
            e.currentTarget.style.color = isDark ? "#ffffff" : "#000000"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent"
            e.currentTarget.style.color = isDark
              ? "rgba(255, 255, 255, 0.75)"
              : "rgba(0, 0, 0, 0.65)"
          }}
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            fill="none"
            style={{ display: "block" }}
          >
            <line
              x1={2}
              y1={6}
              x2={10}
              y2={6}
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={handleMaximize}
          title={isMaximized ? "Modo ventana" : "Maximizar"}
          style={{
            width: 44,
            height: "100%",
            background: "transparent",
            border: "none",
            color: isDark ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.14s ease, color 0.14s ease",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(0, 0, 0, 0.08)"
            e.currentTarget.style.color = isDark ? "#ffffff" : "#000000"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent"
            e.currentTarget.style.color = isDark
              ? "rgba(255, 255, 255, 0.75)"
              : "rgba(0, 0, 0, 0.65)"
          }}
        >
          {isMaximized ? (
            /* Crisp Restore / Modo Ventana Icon */
            <svg
              width={12}
              height={12}
              viewBox="0 0 12 12"
              fill="none"
              style={{ display: "block" }}
            >
              <path
                d="M4 2.5H9.5C10.05 2.5 10.5 2.95 10.5 3.5V9"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x={1.5}
                y={3.5}
                width={7}
                height={7}
                rx={1.2}
                stroke="currentColor"
                strokeWidth={1.25}
              />
            </svg>
          ) : (
            /* Crisp Maximize Icon */
            <svg
              width={12}
              height={12}
              viewBox="0 0 12 12"
              fill="none"
              style={{ display: "block" }}
            >
              <rect
                x={1.5}
                y={1.5}
                width={9}
                height={9}
                rx={1.5}
                stroke="currentColor"
                strokeWidth={1.3}
              />
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          title="Cerrar"
          style={{
            width: 48,
            height: "100%",
            background: "transparent",
            border: "none",
            color: isDark ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.14s ease, color 0.14s ease",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e11d48"
            e.currentTarget.style.color = "#ffffff"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent"
            e.currentTarget.style.color = isDark
              ? "rgba(255, 255, 255, 0.75)"
              : "rgba(0, 0, 0, 0.65)"
          }}
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            fill="none"
            style={{ display: "block" }}
          >
            <line
              x1={2.5}
              y1={2.5}
              x2={9.5}
              y2={9.5}
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
            />
            <line
              x1={9.5}
              y1={2.5}
              x2={2.5}
              y2={9.5}
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </>
  )
}
