import React from "react";
import { ThemeMode } from "../../types";

interface LauncherToggleProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  label?: string;
  theme?: ThemeMode;
}

export default function LauncherToggle({
  checked,
  onChange,
  label,
  theme = "dark",
}: LauncherToggleProps) {
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label || "Toggle"}
      onClick={() => onChange(!checked)}
      style={{
        width: 48,
        height: 26,
        borderRadius: 13,
        padding: 3,
        background: checked ? "#3ec4c0" : isDark ? "#1a242f" : "#cbd5e1",
        border: checked
          ? "1.5px solid #3ec4c0"
          : isDark
            ? "1.5px solid rgba(255, 255, 255, 0.12)"
            : "1.5px solid rgba(0, 0, 0, 0.12)",
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.18s ease, border-color 0.18s ease",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#ffffff",
          boxShadow: "0 1px 4px rgba(0, 0, 0, 0.35)",
          transform: checked ? "translateX(22px)" : "translateX(0px)",
          transition: "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <svg
            width={10}
            height={10}
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
      </div>
    </button>
  );
}
