import React from "react"

export interface LiveToastProps {
  message: string | null
  type?: "success" | "error" | "info"
  accentColor?: string
}

export default function LiveToast({
  message,
  type = "success",
  accentColor,
}: LiveToastProps) {
  if (!message) return null

  const isError = type === "error"
  const strokeColor = isError ? "#ef4444" : (accentColor || "#3ec4c0")

  return (
    <div
      className={`settings-live-toast ${isError ? "is-error" : ""}`}
      style={{
        borderColor: isError
          ? "rgba(239, 68, 68, 0.65)"
          : accentColor
            ? accentColor
            : undefined,
        boxShadow: isError
          ? "0 16px 40px rgba(0, 0, 0, 0.75), 0 0 20px rgba(239, 68, 68, 0.25)"
          : accentColor
            ? `0 16px 40px rgba(0, 0, 0, 0.75), 0 0 20px ${accentColor}44`
            : undefined,
      }}
    >
      {isError ? (
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ef4444"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ) : (
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
      <span>{message}</span>
    </div>
  )
}
