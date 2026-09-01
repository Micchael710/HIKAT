import React, { useState } from "react"
import type { ThemeMode, SkinItem } from "../../types"
import { skinsApi } from "../../services/graphqlClient"
import { IconTrash, IconSpinner } from "../../theme/icons"

interface DeleteSkinModalProps {
  theme: ThemeMode
  skin: SkinItem
  onClose: () => void
  onDeleted: () => void
}

export default function DeleteSkinModal({
  theme,
  skin,
  onClose,
  onDeleted,
}: DeleteSkinModalProps) {
  const isDark = theme === "dark"
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await skinsApi.deleteSkin(skin.id)
      onDeleted()
      onClose()
    } catch (err: any) {
      setError(err.message || "No se pudo eliminar la skin.")
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
        zIndex: 900,
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
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
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
              Eliminar Skin
            </h3>
            <p
              style={{
                margin: "2px 0 0 0",
                fontSize: "13px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              Esta acción no se puede deshacer.
            </p>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 20px 0",
            fontSize: "14px",
            color: isDark ? "#cbd5e1" : "#334155",
            lineHeight: "1.5",
          }}
        >
          ¿Estás seguro de que deseas eliminar la skin <strong>{skin.name}</strong> del catálogo?
        </p>

        {error && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              borderRadius: "8px",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            onClick={onClose}
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
