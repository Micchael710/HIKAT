import React, { useState } from "react"
import type { ThemeMode, AdminPlayerCape } from "../../types"
import { capesApi } from "../../services/graphqlClient"
import { IconTrash, IconSpinner } from "../../theme/icons"

interface DeletePlayerCapeModalProps {
  theme: ThemeMode
  cape: AdminPlayerCape
  onClose: () => void
  onDeleted: () => void
}

export default function DeletePlayerCapeModal({
  theme,
  cape,
  onClose,
  onDeleted,
}: DeletePlayerCapeModalProps) {
  const isDark = theme === "dark"
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await capesApi.deleteAdminPlayerCape(cape.id)
      onDeleted()
      onClose()
    } catch (err: any) {
      setError(err.message || "No se pudo eliminar la capa del jugador.")
      setIsDeleting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: isDark ? "#1e293b" : "#ffffff",
          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          borderRadius: "16px",
          width: "100%",
          maxWidth: "420px",
          padding: "24px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconTrash size={20} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: "600",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Eliminar Capa de Jugador
            </h3>
            <p
              style={{
                margin: "2px 0 0 0",
                fontSize: "13px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              Esta acción eliminará la capa personalizada.
            </p>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 20px 0",
            fontSize: "14px",
            lineHeight: 1.5,
            color: isDark ? "#cbd5e1" : "#475569",
          }}
        >
          ¿Estás seguro de que deseas eliminar la capa{" "}
          <strong style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}>
            "{cape.name}"
          </strong>{" "}
          del jugador{" "}
          <strong style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}>
            "{cape.userDisplayName}"
          </strong>
          ?
        </p>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="launcher-btn-secondary"
            style={{
              padding: "10px 18px",
              borderRadius: "12px",
              fontSize: "14px",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="launcher-btn-danger"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 20px",
              borderRadius: "12px",
              fontSize: "14px",
            }}
          >
            {isDeleting && <IconSpinner size={16} />}
            <span>Eliminar</span>
          </button>
        </div>
      </div>
    </div>
  )
}
