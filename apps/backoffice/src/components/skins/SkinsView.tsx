import React, { useState, useEffect, useCallback } from "react"
import type { ThemeMode, SkinItem } from "../../types"
import { skinsApi } from "../../services/graphqlClient"
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconSpinner,
  IconShirt,
  IconEye,
} from "../../theme/icons"
import SkinHeadPreview from "./SkinHeadPreview"
import SkinFormModal from "./SkinFormModal"
import DeleteSkinModal from "./DeleteSkinModal"
import LiveToast from "../common/LiveToast"
import BackofficeSelect, { SelectOption } from "../common/BackofficeSelect"

interface SkinsViewProps {
  theme: ThemeMode
}

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "Todos los estados" },
  { value: "AVAILABLE", label: "Disponibles" },
  { value: "UNAVAILABLE", label: "Ocultos" },
]

export default function SkinsView({ theme }: SkinsViewProps) {
  const isDark = theme === "dark"

  const [skins, setSkins] = useState<SkinItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")

  const [modalMode, setModalMode] = useState<"edit" | "view">("edit")
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [activeSkin, setActiveSkin] = useState<SkinItem | null>(null)
  const [deleteSkinItem, setDeleteSkinItem] = useState<SkinItem | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const fetchSkins = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await skinsApi.getAdminSkins({ status: statusFilter })
      setSkins(data?.items || [])
    } catch (err: any) {
      setError(err.message || "No se pudieron cargar las skins.")
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchSkins()
  }, [fetchSkins])

  return (
    <div style={{ padding: "28px", maxWidth: "1280px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Top Header - Responsive flexbox layout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "20px",
          marginBottom: "28px",
          width: "100%",
        }}
      >
        <div style={{ minWidth: "240px", flex: "1 1 300px" }}>
          <h1
            style={{
              margin: "0 0 6px 0",
              fontSize: "24px",
              fontWeight: "700",
              color: isDark ? "#f1f5f9" : "#0f172a",
              letterSpacing: "-0.02em",
            }}
          >
            Skins
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              color: isDark ? "#94a3b8" : "#64748b",
            }}
          >
            Administra las apariencias y skins disponibles para los jugadores.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            justifyContent: "flex-end",
            flex: "0 1 auto",
          }}
        >
          <div style={{ minWidth: "170px", width: "180px" }}>
            <BackofficeSelect
              theme={theme}
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              options={STATUS_FILTER_OPTIONS}
            />
          </div>

          <button
            onClick={() => {
              setActiveSkin(null)
              setModalMode("edit")
              setIsFormOpen(true)
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#6366f1",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <IconPlus size={16} />
            Nueva Skin
          </button>
        </div>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            color: isDark ? "#94a3b8" : "#64748b",
            gap: "12px",
          }}
        >
          <IconSpinner size={24} />
          <span>Cargando catálogo de skins...</span>
        </div>
      ) : error ? (
        <div
          style={{
            padding: "24px",
            borderRadius: "12px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            color: "#ef4444",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      ) : skins.length === 0 ? (
        <div
          style={{
            backgroundColor: isDark ? "#1e293b" : "#ffffff",
            border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
            borderRadius: "14px",
            padding: "60px 24px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              backgroundColor: isDark ? "rgba(99, 102, 241, 0.15)" : "#eef2ff",
              color: "#6366f1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px auto",
            }}
          >
            <IconShirt size={24} />
          </div>
          <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
            No hay skins registradas
          </h3>
          <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: isDark ? "#94a3b8" : "#64748b" }}>
            {statusFilter !== "ALL" ? "No hay skins con el filtro seleccionado." : "Sube la primera textura de skin para los jugadores."}
          </p>
          <button
            onClick={() => {
              setActiveSkin(null)
              setModalMode("edit")
              setIsFormOpen(true)
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#6366f1",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            <IconPlus size={16} />
            Subir primera skin
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "20px",
          }}
        >
          {skins.map((skin) => (
            <div
              key={skin.id}
              style={{
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.05)",
                position: "relative",
              }}
            >
              {/* Skin Avatar Preview */}
              <div
                onClick={() => {
                  setActiveSkin(skin)
                  setModalMode("view")
                  setIsFormOpen(true)
                }}
                style={{ marginBottom: "14px", cursor: "pointer" }}
                title="Haz clic para ver en 3D"
              >
                <SkinHeadPreview imageUrl={skin.imageUrl} size={72} />
              </div>

              {/* Skin Info */}
              <h3
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "15px",
                  fontWeight: "600",
                  color: isDark ? "#f1f5f9" : "#0f172a",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                }}
              >
                {skin.name}
              </h3>

              {/* Badges */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "18px", flexWrap: "wrap", justifyContent: "center" }}>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "600",
                    backgroundColor: isDark ? "#334155" : "#f1f5f9",
                    color: isDark ? "#cbd5e1" : "#475569",
                  }}
                >
                  {skin.model === "SLIM" ? "Delgado (3px)" : "Clásico (4px)"}
                </span>

                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "600",
                    backgroundColor:
                      skin.status === "AVAILABLE"
                        ? "rgba(34, 197, 94, 0.15)"
                        : "rgba(249, 115, 22, 0.15)",
                    color: skin.status === "AVAILABLE" ? "#22c55e" : "#f97316",
                  }}
                >
                  {skin.status === "AVAILABLE" ? "Disponible" : "Oculto"}
                </span>
              </div>

              {/* Card Actions */}
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  gap: "6px",
                  borderTop: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                  paddingTop: "14px",
                }}
              >
                <button
                  onClick={() => {
                    setActiveSkin(skin)
                    setModalMode("view")
                    setIsFormOpen(true)
                  }}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "7px 8px",
                    borderRadius: "6px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: "transparent",
                    color: isDark ? "#f1f5f9" : "#1e293b",
                    fontSize: "12px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                  title="Ver en 3D"
                >
                  <IconEye size={14} />
                  Ver
                </button>

                <button
                  onClick={() => {
                    setActiveSkin(skin)
                    setModalMode("edit")
                    setIsFormOpen(true)
                  }}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "7px 8px",
                    borderRadius: "6px",
                    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                    backgroundColor: "transparent",
                    color: isDark ? "#f1f5f9" : "#1e293b",
                    fontSize: "12px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  <IconEdit size={14} />
                  Editar
                </button>

                <button
                  onClick={() => setDeleteSkinItem(skin)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "7px 8px",
                    borderRadius: "6px",
                    border: `1px solid rgba(239, 68, 68, 0.3)`,
                    backgroundColor: "transparent",
                    color: "#ef4444",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                  title="Eliminar skin"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Skin Create / View / Edit Modal */}
      {isFormOpen && (
        <SkinFormModal
          theme={theme}
          skin={activeSkin}
          mode={modalMode}
          onClose={() => {
            setIsFormOpen(false)
            setActiveSkin(null)
          }}
          onSaved={() => {
            setToastMessage(activeSkin ? "Skin actualizada correctamente." : "Skin creada exitosamente.")
            fetchSkins()
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteSkinItem && (
        <DeleteSkinModal
          theme={theme}
          skin={deleteSkinItem}
          onClose={() => setDeleteSkinItem(null)}
          onDeleted={() => {
            setToastMessage("Skin eliminada correctamente.")
            fetchSkins()
          }}
        />
      )}

      {toastMessage && (
        <LiveToast
          message={toastMessage}
          type="success"
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}
