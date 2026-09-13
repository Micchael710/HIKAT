import React from "react"
import type { ModProvider, ContentType, GameModLoader, ThemeMode } from "../../../types"
import { getThemeTokens } from "../../../theme/tokens"
import { IconSpinner, IconWarning } from "../../../theme/icons"

export interface QueuedItemSummary {
  provider: ModProvider
  projectId: string
  projectName: string
  versionNumber: string
  contentType?: ContentType
  loaderOverride?: GameModLoader | null
}

export interface QueuedItemsBarProps {
  mode: "RELEASE" | "SERVER"
  queuedItems: QueuedItemSummary[]
  onRemoveItem: (projectId: string) => void
  onConfirmInstall: () => void
  installing: boolean
  installProgress?: { current: number; total: number } | null
  batchError?: string | null
  theme?: ThemeMode
}

export const QueuedItemsBar: React.FC<QueuedItemsBarProps> = ({
  mode,
  queuedItems,
  onRemoveItem,
  onConfirmInstall,
  installing,
  installProgress,
  batchError,
  theme = "dark",
}) => {
  const tokens = getThemeTokens(theme)

  if (queuedItems.length === 0) return null

  const isServer = mode === "SERVER"
  const barTestId = isServer ? "server-queue-bar" : "queued-mods-bar"
  const countTestId = isServer ? "server-queue-count" : "queued-mods-count"
  const buttonTestId = isServer ? "button-confirm-server-batch" : "button-confirm-batch-install"

  let buttonText = ""
  if (installing) {
    if (isServer && installProgress) {
      buttonText = `Instalando ${installProgress.current} de ${installProgress.total}...`
    } else {
      buttonText = "Instalando..."
    }
  } else {
    if (isServer) {
      buttonText = `Añadir ${queuedItems.length} al servidor`
    } else {
      buttonText = `Añadir ${queuedItems.length} al borrador`
    }
  }

  return (
    <div
      data-testid={barTestId}
      style={{
        padding: "12px 20px",
        background: tokens.bgCard,
        borderTop: `1px solid ${tokens.borderSubtle}`,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        boxShadow: "0 -4px 16px rgba(0,0,0,0.25)",
      }}
    >
      {batchError && (
        <div
          data-testid={isServer ? "server-queue-error" : "queue-batch-error"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            padding: "8px 12px",
            borderRadius: "8px",
            fontSize: "13px",
          }}
        >
          <IconWarning size={16} />
          <span>{batchError}</span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        {/* Left: Count and chips */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <span
            data-testid={countTestId}
            style={{
              fontSize: "13px",
              fontWeight: "700",
              color: tokens.textPrimary,
              whiteSpace: "nowrap",
            }}
          >
            Seleccionados: {queuedItems.length}
          </span>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexWrap: "wrap",
              maxHeight: "68px",
              overflowY: "auto",
            }}
          >
            {queuedItems.map((item) => {
              const isModrinth = item.provider === "MODRINTH"
              return (
                <span
                  key={item.projectId}
                  data-testid={isServer ? `queue-chip-${item.projectId}` : `chip-queued-${item.provider}-${item.projectId}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: tokens.bgCardInner,
                    border: `1px solid ${tokens.borderSubtle}`,
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "12px",
                    color: tokens.textPrimary,
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: "700",
                      color: isModrinth ? "#10b981" : "#f97316",
                    }}
                  >
                    {isModrinth ? "MR" : "CF"}
                  </span>
                  <span style={{ fontWeight: "600", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.projectName}
                  </span>
                  <span style={{ color: tokens.textMuted, fontSize: "11px" }}>
                    v{item.versionNumber || "latest"}
                  </span>
                  {item.loaderOverride && (
                    <span style={{ color: "#3ec4c0", fontSize: "10px", fontWeight: "600" }}>
                      ({item.loaderOverride})
                    </span>
                  )}
                  {!installing && (
                    <button
                      type="button"
                      data-testid={isServer ? `button-remove-queue-${item.projectId}` : `remove-queued-${item.provider}-${item.projectId}`}
                      onClick={() => onRemoveItem(item.projectId)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: tokens.textMuted,
                        cursor: "pointer",
                        padding: "0 2px",
                        fontSize: "13px",
                        lineHeight: 1,
                      }}
                      title="Eliminar de la selección"
                    >
                      ✕
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        </div>

        {/* Right: Confirm Button */}
        <div>
          <button
            type="button"
            data-testid={buttonTestId}
            onClick={onConfirmInstall}
            disabled={installing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: installing ? tokens.textMuted : "#3ec4c0",
              color: "#ffffff",
              border: "none",
              borderRadius: "10px",
              padding: "9px 20px",
              fontSize: "13px",
              fontWeight: "700",
              cursor: installing ? "not-allowed" : "pointer",
              boxShadow: tokens.cardShadow,
              transition: "all 0.15s ease",
            }}
          >
            {installing && <IconSpinner size={16} />}
            <span>{buttonText}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
