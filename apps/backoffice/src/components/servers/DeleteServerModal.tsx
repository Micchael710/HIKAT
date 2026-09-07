import React, { useState } from "react"
import type { ThemeMode, ServerItem } from "../../types"
import { IconSpinner, IconTrash, IconWarning } from "../../theme/icons"

interface DeleteServerModalProps {
  server: ServerItem | null
  isOpen: boolean
  isLoading: boolean
  onConfirm: (deletePterodactyl: boolean) => void
  onClose: () => void
  theme?: ThemeMode
}

export default function DeleteServerModal({
  server,
  isOpen,
  isLoading,
  onConfirm,
  onClose,
  theme = "dark",
}: DeleteServerModalProps) {
  const [deletePterodactyl, setDeletePterodactyl] = useState<boolean>(false)

  if (!isOpen || !server) return null

  const isDark = theme === "dark"

  return (
    <div
      onClick={isLoading ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: "fadeIn 0.18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "92vw",
          background: isDark ? "#131d25" : "#ffffff",
          borderRadius: 20,
          padding: "28px 30px",
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.1)"
            : "1.5px solid rgba(0, 0, 0, 0.1)",
          boxShadow: isDark
            ? "0 24px 80px rgba(0, 0, 0, 0.75)"
            : "0 20px 60px rgba(0, 0, 0, 0.15)",
          animation: "slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "rgba(255, 60, 40, 0.15)",
              border: "1.5px solid rgba(255, 100, 80, 0.4)",
              color: "#ff6b5b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconTrash size={22} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 800,
                color: isDark ? "#ffffff" : "#111822",
                letterSpacing: "-0.01em",
              }}
            >
              Eliminar servidor
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
              }}
            >
              Selecciona el alcance de la eliminación
            </p>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 20px",
            fontSize: 14.5,
            lineHeight: 1.5,
            color: isDark ? "rgba(255, 255, 255, 0.75)" : "#445566",
          }}
        >
          ¿Estás seguro de que deseas eliminar el servidor{" "}
          <strong style={{ color: isDark ? "#ffffff" : "#111822" }}>
            "{server.name}"
          </strong>
          ?
        </p>

        {/* Options */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 24,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 16px",
              borderRadius: 12,
              cursor: isLoading ? "not-allowed" : "pointer",
              background: !deletePterodactyl
                ? isDark
                  ? "rgba(62, 196, 192, 0.12)"
                  : "rgba(62, 196, 192, 0.08)"
                : isDark
                ? "rgba(255, 255, 255, 0.03)"
                : "rgba(0, 0, 0, 0.02)",
              border: !deletePterodactyl
                ? "1.5px solid #3ec4c0"
                : isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="radio"
              name="deleteScope"
              checked={!deletePterodactyl}
              onChange={() => setDeletePterodactyl(false)}
              disabled={isLoading}
              style={{ marginTop: 3, accentColor: "#3ec4c0" }}
            />
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                Eliminar solo de HiKAT
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: isDark ? "rgba(255, 255, 255, 0.6)" : "#657788",
                  marginTop: 2,
                }}
              >
                Elimina el registro de la base de datos de HiKAT. La instancia en Pterodactyl permanecerá intacta.
              </div>
            </div>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 16px",
              borderRadius: 12,
              cursor: isLoading ? "not-allowed" : "pointer",
              background: deletePterodactyl
                ? isDark
                  ? "rgba(255, 60, 40, 0.12)"
                  : "rgba(255, 60, 40, 0.06)"
                : isDark
                ? "rgba(255, 255, 255, 0.03)"
                : "rgba(0, 0, 0, 0.02)",
              border: deletePterodactyl
                ? "1.5px solid #ff6b5b"
                : isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="radio"
              name="deleteScope"
              checked={deletePterodactyl}
              onChange={() => setDeletePterodactyl(true)}
              disabled={isLoading}
              style={{ marginTop: 3, accentColor: "#ff6b5b" }}
            />
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: isDark ? "#ffffff" : "#111822",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>Eliminar también de Pterodactyl</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(255, 60, 40, 0.2)",
                    color: "#ff6b5b",
                  }}
                >
                  Destructivo
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: isDark ? "rgba(255, 255, 255, 0.6)" : "#657788",
                  marginTop: 2,
                }}
              >
                Eliminará la instancia de servidor, contenedor y archivos en Pterodactyl de forma permanente.
              </div>
            </div>
          </label>
        </div>

        {deletePterodactyl && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(255, 170, 0, 0.12)",
              border: "1px solid rgba(255, 170, 0, 0.35)",
              color: "#f5a623",
              fontSize: 12.5,
              marginBottom: 20,
            }}
          >
            <IconWarning size={18} />
            <span>
              Atención: Los datos del servidor en Pterodactyl se perderán definitivamente y no se podrán recuperar.
            </span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="launcher-btn-secondary"
            style={{
              padding: "10px 18px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={() => onConfirm(deletePterodactyl)}
            disabled={isLoading}
            className="launcher-btn-danger"
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {isLoading ? (
              <>
                <IconSpinner size={16} />
                <span>Eliminando...</span>
              </>
            ) : (
              <span>Confirmar Eliminación</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
