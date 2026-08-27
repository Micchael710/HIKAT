import React, { useState } from "react"
import type { ServerStatus, ServerPowerAction, ThemeMode } from "../../types"
import { IconPlay, IconRefresh, IconStop, IconSpinner } from "../../theme/icons"

interface ServerPowerActionsProps {
  status: ServerStatus
  isLoading: boolean
  onPowerAction: (action: ServerPowerAction) => Promise<void>
  onRetry?: () => void
  theme: ThemeMode
}

export default function ServerPowerActions({
  status,
  isLoading,
  onPowerAction,
  onRetry,
  theme,
}: ServerPowerActionsProps) {
  const isDark = theme === "dark"
  const [modalAction, setModalAction] = useState<"RESTART" | "STOP" | null>(null)

  const handleStart = async () => {
    if (isLoading) return
    await onPowerAction("START")
  }

  const confirmAction = async () => {
    if (!modalAction || isLoading) return
    const act = modalAction
    setModalAction(null)
    await onPowerAction(act)
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {/* 1. Offline -> Start button */}
      {status === "OFFLINE" && (
        <button
          type="button"
          disabled={isLoading}
          onClick={handleStart}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 22px",
            borderRadius: 12,
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            color: "#ffffff",
            fontSize: "0.925rem",
            fontWeight: 600,
            border: "none",
            cursor: isLoading ? "not-allowed" : "pointer",
            boxShadow: "0 4px 16px rgba(16, 185, 129, 0.3)",
            opacity: isLoading ? 0.6 : 1,
            transition: "all 0.15s ease",
          }}
        >
          {isLoading ? <IconSpinner size={18} /> : <IconPlay size={18} />}
          <span>{isLoading ? "Iniciando..." : "Iniciar"}</span>
        </button>
      )}

      {/* 2. Online -> Restart and Stop buttons */}
      {status === "ONLINE" && (
        <>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => setModalAction("RESTART")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 12,
              background: isDark ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.12)",
              color: isDark ? "#fbbf24" : "#d97706",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              fontSize: "0.925rem",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              transition: "all 0.15s ease",
            }}
          >
            {isLoading && modalAction === "RESTART" ? <IconSpinner size={18} /> : <IconRefresh size={18} />}
            <span>Reiniciar</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => setModalAction("STOP")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 12,
              background: isDark ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.12)",
              color: isDark ? "#f87171" : "#dc2626",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              fontSize: "0.925rem",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              transition: "all 0.15s ease",
            }}
          >
            {isLoading && modalAction === "STOP" ? <IconSpinner size={18} /> : <IconStop size={18} />}
            <span>Detener</span>
          </button>
        </>
      )}

      {/* 3. Starting -> Disabled indicator */}
      {status === "STARTING" && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 12,
            background: isDark ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.25)",
            color: isDark ? "#fbbf24" : "#d97706",
            fontSize: "0.925rem",
            fontWeight: 600,
          }}
        >
          <IconSpinner size={18} />
          <span>Iniciando servidor...</span>
        </div>
      )}

      {/* 4. Stopping -> Disabled indicator */}
      {status === "STOPPING" && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 12,
            background: isDark ? "rgba(249, 115, 22, 0.12)" : "rgba(249, 115, 22, 0.1)",
            border: "1px solid rgba(249, 115, 22, 0.25)",
            color: isDark ? "#fb923c" : "#ea580c",
            fontSize: "0.925rem",
            fontWeight: 600,
          }}
        >
          <IconSpinner size={18} />
          <span>Apagando servidor...</span>
        </div>
      )}

      {/* 5. Disconnected / Unknown -> Disabled buttons with notice */}
      {(status === "DISCONNECTED" || status === "UNKNOWN") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              disabled
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 10,
                background: isDark ? "rgba(16, 185, 129, 0.1)" : "#dcfce7",
                color: isDark ? "rgba(74, 222, 128, 0.5)" : "#86efac",
                fontSize: "0.85rem",
                fontWeight: 600,
                border: "none",
                cursor: "not-allowed",
                opacity: 0.5,
              }}
            >
              <IconPlay size={16} />
              <span>Iniciar</span>
            </button>

            <button
              type="button"
              disabled
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 10,
                background: isDark ? "rgba(245, 158, 11, 0.1)" : "#fef3c7",
                color: isDark ? "rgba(251, 191, 36, 0.5)" : "#fcd34d",
                fontSize: "0.85rem",
                fontWeight: 600,
                border: "none",
                cursor: "not-allowed",
                opacity: 0.5,
              }}
            >
              <IconRefresh size={16} />
              <span>Reiniciar</span>
            </button>

            <button
              type="button"
              disabled
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 10,
                background: isDark ? "rgba(239, 68, 68, 0.1)" : "#fee2e2",
                color: isDark ? "rgba(248, 113, 113, 0.5)" : "#fca5a5",
                fontSize: "0.85rem",
                fontWeight: 600,
                border: "none",
                cursor: "not-allowed",
                opacity: 0.5,
              }}
            >
              <IconStop size={16} />
              <span>Apagar</span>
            </button>
          </div>

          <span style={{ fontSize: "0.775rem", color: isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.4)" }}>
            Disponible cuando el servidor esté conectado.
          </span>
        </div>
      )}

      {/* Confirmation Modal for Restart and Stop */}
      {modalAction && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            animation: "fadeIn 0.15s ease",
          }}
          onClick={() => !isLoading && setModalAction(null)}
        >
          <div
            style={{
              width: "90%",
              maxWidth: 440,
              padding: 28,
              borderRadius: 20,
              background: isDark ? "#131c24" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)"}`,
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.45)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#0f172a",
                }}
              >
                {modalAction === "RESTART" ? "¿Reiniciar el servidor?" : "¿Detener el servidor?"}
              </h3>
              <p
                style={{
                  margin: "10px 0 0 0",
                  fontSize: "0.925rem",
                  color: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.6)",
                  lineHeight: 1.5,
                }}
              >
                {modalAction === "RESTART"
                  ? "Los jugadores conectados serán desconectados temporalmente."
                  : "Los jugadores conectados serán desconectados."}
              </p>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setModalAction(null)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  background: "transparent",
                  border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"}`,
                  color: isDark ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.75)",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={isLoading}
                onClick={confirmAction}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 22px",
                  borderRadius: 10,
                  background:
                    modalAction === "RESTART"
                      ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
                      : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  color: "#ffffff",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  boxShadow:
                    modalAction === "RESTART"
                      ? "0 4px 14px rgba(245, 158, 11, 0.35)"
                      : "0 4px 14px rgba(239, 68, 68, 0.35)",
                }}
              >
                {isLoading && <IconSpinner size={16} />}
                <span>{modalAction === "RESTART" ? "Reiniciar" : "Detener"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
