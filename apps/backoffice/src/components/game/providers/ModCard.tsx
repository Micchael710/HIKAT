import React from "react"
import type { ModSearchResultItem } from "../../../types"

interface ModCardProps {
  mod: ModSearchResultItem
  onSelect: (mod: ModSearchResultItem) => void
}

export const ModCard: React.FC<ModCardProps> = ({ mod, onSelect }) => {
  const isModrinth = mod.provider === "MODRINTH"

  return (
    <div
      data-testid={`mod-card-${mod.provider.toLowerCase()}-${mod.projectId}`}
      onClick={() => onSelect(mod)}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "12px",
        padding: "16px",
        cursor: "pointer",
        transition: "all 0.2s ease-in-out",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = isModrinth ? "rgba(16, 185, 129, 0.5)" : "rgba(249, 115, 22, 0.5)"
        e.currentTarget.style.transform = "translateY(-2px)"
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.25)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)"
        e.currentTarget.style.transform = "translateY(0)"
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.1)"
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "12px" }}>
          {mod.iconUrl ? (
            <img
              src={mod.iconUrl}
              alt={mod.name}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                objectFit: "cover",
                flexShrink: 0,
                background: "rgba(0, 0, 0, 0.2)",
              }}
            />
          ) : (
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                flexShrink: 0,
                color: "rgba(255, 255, 255, 0.4)",
              }}
            >
              📦
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h4
                style={{
                  margin: 0,
                  fontSize: "15px",
                  fontWeight: "600",
                  color: "#f3f4f6",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "200px",
                }}
                title={mod.name}
              >
                {mod.name}
              </h4>

              <span
                data-testid={`badge-provider-${mod.provider.toLowerCase()}`}
                style={{
                  fontSize: "11px",
                  fontWeight: "600",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: isModrinth ? "rgba(16, 185, 129, 0.15)" : "rgba(249, 115, 22, 0.15)",
                  color: isModrinth ? "#10b981" : "#f97316",
                  border: `1px solid ${isModrinth ? "rgba(16, 185, 129, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                }}
              >
                {isModrinth ? "Modrinth" : "CurseForge"}
              </span>
            </div>

            <div style={{ fontSize: "12px", color: "#9ca3af" }}>
              por <span style={{ color: "#d1d5db", fontWeight: "500" }}>{mod.author}</span>
            </div>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 14px 0",
            fontSize: "13px",
            color: "#9ca3af",
            lineHeight: "1.4",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minHeight: "36px",
          }}
          title={mod.summary}
        >
          {mod.summary || "Sin descripción proporcionada."}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "10px",
          borderTop: "1px solid rgba(255, 255, 255, 0.05)",
          fontSize: "12px",
          color: "#9ca3af",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span>⬇️</span>
          {mod.downloads > 1000000
            ? `${(mod.downloads / 1000000).toFixed(1)}M`
            : mod.downloads > 1000
            ? `${(mod.downloads / 1000).toFixed(0)}k`
            : mod.downloads}
        </span>

        <button
          type="button"
          style={{
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            color: "#e5e7eb",
            borderRadius: "6px",
            padding: "4px 10px",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          Ver detalles →
        </button>
      </div>
    </div>
  )
}
