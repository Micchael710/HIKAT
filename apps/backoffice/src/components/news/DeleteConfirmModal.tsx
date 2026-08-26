import React from "react"
import type { ThemeMode, NewsItem } from "../../types"
import { IconSpinner, IconTrash } from "../../theme/icons"

interface DeleteConfirmModalProps {
  newsItem: NewsItem | null
  isOpen: boolean
  isLoading: boolean
  onConfirm: () => void
  onClose: () => void
  theme?: ThemeMode
}

export default function DeleteConfirmModal({
  newsItem,
  isOpen,
  isLoading,
  onConfirm,
  onClose,
  theme = "dark",
}: DeleteConfirmModalProps) {
  if (!isOpen || !newsItem) return null

  const isDark = theme === "dark"

  return (
    <div
      onClick={onClose}
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
          width: 460,
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
              Eliminar noticia
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
              }}
            >
              Esta acción no se puede revertir
            </p>
          </div>
        </div>

        <p
          style={{
            margin: "0 0 24px",
            fontSize: 14.5,
            lineHeight: 1.5,
            color: isDark ? "rgba(255, 255, 255, 0.75)" : "#445566",
          }}
        >
          ¿Estás seguro de que deseas eliminar permanentemente la noticia{" "}
          <strong style={{ color: isDark ? "#ffffff" : "#111822" }}>
            "{newsItem.title}"
          </strong>
          ?
        </p>

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
            onClick={onConfirm}
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
              <span>Eliminar</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
