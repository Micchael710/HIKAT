import React from "react"
import type { ModSearchResultItem, ThemeMode } from "../../../types"
import { getThemeTokens } from "../../../theme/tokens"
import { IconBox, IconDownload } from "../../../theme/icons"

interface ModCardProps {
  mod: ModSearchResultItem
  onSelect: (mod: ModSearchResultItem) => void
  theme?: ThemeMode
}

export const ModCard: React.FC<ModCardProps> = ({ mod, onSelect, theme = "dark" }) => {
  const isModrinth = mod.provider === "MODRINTH"
  const tokens = getThemeTokens(theme)

  return (
    <div
      data-testid={`mod-card-${mod.provider.toLowerCase()}-${mod.projectId}`}
      onClick={() => onSelect(mod)}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: tokens.bgCard,
        border: `1px solid ${tokens.borderSubtle}`,
        borderRadius: "14px",
        padding: "16px",
        cursor: "pointer",
        transition: "all 0.2s ease-in-out",
        boxShadow: tokens.cardShadow,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = isModrinth ? "rgba(16, 185, 129, 0.5)" : "rgba(249, 115, 22, 0.5)"
        e.currentTarget.style.transform = "translateY(-2px)"
        e.currentTarget.style.boxShadow = tokens.cardShadowLg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = tokens.borderSubtle
        e.currentTarget.style.transform = "translateY(0)"
        e.currentTarget.style.boxShadow = tokens.cardShadow
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
                borderRadius: "10px",
                objectFit: "cover",
                flexShrink: 0,
                background: "rgba(0, 0, 0, 0.1)",
              }}
            />
          ) : (
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                background: tokens.bgCardInner,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: tokens.textMuted,
              }}
            >
              <IconBox size={24} />
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h4
                style={{
                  margin: 0,
                  fontSize: "15px",
                  fontWeight: "700",
                  color: tokens.textPrimary,
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
                  fontWeight: "700",
                  padding: "2px 6px",
                  borderRadius: "6px",
                  background: isModrinth ? "rgba(16, 185, 129, 0.15)" : "rgba(249, 115, 22, 0.15)",
                  color: isModrinth ? "#10b981" : "#f97316",
                  border: `1px solid ${isModrinth ? "rgba(16, 185, 129, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                }}
              >
                {isModrinth ? "Modrinth" : "CurseForge"}
              </span>

              {mod.contentType && mod.contentType !== "MOD" && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    padding: "2px 6px",
                    borderRadius: "6px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "#60a5fa",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
                  }}
                >
                  {mod.contentType === "RESOURCE_PACK"
                    ? "Resource Pack"
                    : mod.contentType === "DATA_PACK"
                    ? "Data Pack"
                    : mod.contentType === "SHADER"
                    ? "Shader"
                    : mod.contentType}
                </span>
              )}

              {mod.environment && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    padding: "2px 6px",
                    borderRadius: "6px",
                    background: "rgba(168, 85, 247, 0.15)",
                    color: "#c084fc",
                    border: "1px solid rgba(168, 85, 247, 0.3)",
                  }}
                >
                  {mod.environment}
                </span>
              )}
            </div>

            <div style={{ fontSize: "12px", color: tokens.textSecondary }}>
              por <span style={{ color: tokens.textPrimary, fontWeight: "600" }}>{mod.author}</span>
            </div>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 14px 0",
            fontSize: "13px",
            color: tokens.textSecondary,
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
          borderTop: `1px solid ${tokens.borderSubtle}`,
          fontSize: "12px",
          color: tokens.textSecondary,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <IconDownload size={14} style={{ color: tokens.textMuted }} />
          <span>
            {mod.downloads > 1000000
              ? `${(mod.downloads / 1000000).toFixed(1)}M`
              : mod.downloads > 1000
              ? `${(mod.downloads / 1000).toFixed(0)}k`
              : mod.downloads}
          </span>
        </span>

        <button
          type="button"
          style={{
            background: tokens.bgPill,
            border: `1px solid ${tokens.borderSubtle}`,
            color: tokens.textPrimary,
            borderRadius: "8px",
            padding: "4px 10px",
            fontSize: "12px",
            fontWeight: "600",
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
