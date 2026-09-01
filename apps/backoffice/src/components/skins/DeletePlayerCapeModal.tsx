import React, { useState } from "react"
import type { ThemeMode, AdminPlayerCape } from "../../types"
import { capesApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
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
  const tokens = getThemeTokens(theme)
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
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "440px",
          padding: "24px",
          boxShadow: tokens.cardShadowLg,
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
              width: "42px",
              height: "42px",
              borderRadius: "12px",
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
                fontSize: "17px",
                fontWeight: "700",
                color: tokens.textPrimary,
              }}
            >
              Eliminar Capa de Jugador
            </h3>
            <p
              style={{
                margin: "2px 0 0 0",
                fontSize: "13px",
                color: tokens.textMuted,
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
            color: tokens.textSecondary,
          }}
        >
          ¿Estás seguro de que deseas eliminar la capa{" "}
          <strong style={{ color: tokens.textPrimary }}>
            "{cape.name}"
          </strong>{" "}
          del jugador{" "}
          <strong style={{ color: tokens.textPrimary }}>
            "{cape.userDisplayName}"
          </strong>
          ?
        </p>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
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
