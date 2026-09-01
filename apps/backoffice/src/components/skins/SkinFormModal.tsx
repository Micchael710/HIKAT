import React, { useState, useRef } from "react"
import type { ThemeMode, SkinItem, SkinStatus } from "../../types"
import { validateMinecraftSkinTexture, MAX_SKIN_SIZE_BYTES } from "@hikat/shared"
import { skinsApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { IconCross, IconUpload } from "../../theme/icons"
import SkinViewer3D from "./SkinViewer3D"

interface SkinFormModalProps {
  theme: ThemeMode
  skin: SkinItem | null
  mode?: "edit" | "view"
  onClose: () => void
  onSaved: () => void
}

export default function SkinFormModal({
  theme,
  skin,
  mode = "edit",
  onClose,
  onSaved,
}: SkinFormModalProps) {
  const isDark = theme === "dark"
  const isEdit = !!skin
  const isViewOnly = mode === "view"

  const [name, setName] = useState(skin?.name || "")
  const [status, setStatus] = useState<SkinStatus>(skin?.status || "AVAILABLE")

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>(skin?.imageUrl || "")
  const [fileError, setFileError] = useState<string | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileError(null)

    if (file.size > MAX_SKIN_SIZE_BYTES) {
      setFileError("El archivo supera el tamaño máximo permitido de 1 MB.")
      return
    }

    if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
      setFileError("El archivo debe ser una imagen PNG.")
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      const validation = validateMinecraftSkinTexture(buffer)
      if (!validation.valid) {
        setFileError(validation.error || "Dimensiones de skin no válidas.")
        return
      }

      setSelectedFile(file)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)

      if (!name) {
        const cleanName = file.name.replace(/\.png$/i, "").replace(/[_-]/g, " ")
        setName(cleanName)
      }
    } catch {
      setFileError("No se pudo leer la textura de la skin.")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isViewOnly) {
      onClose()
      return
    }

    setError(null)

    if (!name.trim()) {
      setError("El nombre de la skin es obligatorio.")
      return
    }

    if (!isEdit && !selectedFile) {
      setError("Debes seleccionar un archivo de skin (.png).")
      return
    }

    setIsSubmitting(true)
    try {
      let mediaId: string | undefined

      if (selectedFile) {
        const uploadedMedia = await uploadMediaFile(selectedFile, "IMAGE")
        mediaId = uploadedMedia.id
      }

      if (isEdit) {
        await skinsApi.updateSkin(skin.id, {
          name: name.trim(),
          status,
          mediaId,
        })
      } else {
        if (!mediaId) {
          throw new Error("No se pudo subir la textura.")
        }
        await skinsApi.createSkin({
          name: name.trim(),
          status,
          mediaId,
        })
      }

      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.message || "Error al guardar la skin.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(5px)",
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
          maxWidth: "760px",
          overflow: "hidden",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: "600",
              color: isDark ? "#f1f5f9" : "#0f172a",
            }}
          >
            {isViewOnly ? "Detalles de la Skin" : isEdit ? "Editar Skin" : "Nueva Skin"}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: isDark ? "#94a3b8" : "#64748b",
              display: "flex",
              padding: "4px",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        {/* Modal Body: Two Column Layout (3D Viewer on Left, Form on Right) */}
        <form onSubmit={handleSubmit} style={{ overflowY: "auto", padding: "24px", flex: 1 }}>
          {error && (
            <div
              style={{
                marginBottom: "20px",
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "24px",
              alignItems: "start",
            }}
          >
            {/* Left Column: 3D Viewer & Upload */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ marginBottom: "16px" }}>
                {previewUrl ? (
                  <SkinViewer3D
                    skinUrl={previewUrl}
                    width={280}
                    height={340}
                    theme={theme}
                    autoRotate={true}
                  />
                ) : (
                  <div
                    style={{
                      width: "280px",
                      height: "340px",
                      borderRadius: "12px",
                      backgroundColor: isDark ? "#0f172a" : "#f1f5f9",
                      border: `2px dashed ${isDark ? "#334155" : "#cbd5e1"}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isDark ? "#64748b" : "#94a3b8",
                      padding: "20px",
                      textAlign: "center",
                    }}
                  >
                    <IconUpload size={32} />
                    <span style={{ marginTop: "12px", fontSize: "13px", fontWeight: "500" }}>
                      Selecciona una textura PNG para ver el visor 3D
                    </span>
                  </div>
                )}
              </div>

              {!isViewOnly && (
                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/png"
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                      backgroundColor: isDark ? "#334155" : "#f8fafc",
                      color: isDark ? "#f1f5f9" : "#1e293b",
                      fontSize: "13px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    <IconUpload size={16} />
                    {selectedFile ? "Cambiar archivo..." : isEdit ? "Reemplazar textura..." : "Seleccionar PNG (64x64)..."}
                  </button>
                  {fileError && (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "#ef4444", textAlign: "center" }}>
                      {fileError}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Fields */}
            <div>
              {/* Name Field */}
              <div style={{ marginBottom: "18px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "6px",
                  }}
                >
                  Nombre de la Skin
                </label>
                {isViewOnly ? (
                  <div style={{ fontSize: "15px", fontWeight: "600", color: isDark ? "#f1f5f9" : "#0f172a" }}>
                    {name}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Alex Aventurera, Traje Espacial..."
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                )}
              </div>

              {/* Status Selector */}
              <div style={{ marginBottom: "24px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "8px",
                  }}
                >
                  Visibilidad en el catálogo
                </label>
                {isViewOnly ? (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "600",
                      backgroundColor: status === "AVAILABLE" ? "rgba(34, 197, 94, 0.15)" : "rgba(249, 115, 22, 0.15)",
                      color: status === "AVAILABLE" ? "#22c55e" : "#f97316",
                    }}
                  >
                    {status === "AVAILABLE" ? "Disponible" : "Oculto"}
                  </span>
                ) : (
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={() => setStatus("AVAILABLE")}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${status === "AVAILABLE" ? "#22c55e" : isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: status === "AVAILABLE" ? (isDark ? "rgba(34, 197, 94, 0.2)" : "#f0fdf4") : "transparent",
                        color: status === "AVAILABLE" ? "#22c55e" : isDark ? "#94a3b8" : "#64748b",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      Disponible
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus("UNAVAILABLE")}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${status === "UNAVAILABLE" ? "#f97316" : isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: status === "UNAVAILABLE" ? (isDark ? "rgba(249, 115, 22, 0.2)" : "#fff7ed") : "transparent",
                        color: status === "UNAVAILABLE" ? "#f97316" : isDark ? "#94a3b8" : "#64748b",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      Oculto
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "24px",
              paddingTop: "20px",
              borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
            }}
          >
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
              {isViewOnly ? "Cerrar" : "Cancelar"}
            </button>
            {!isViewOnly && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="launcher-btn-primary"
                style={{
                  padding: "10px 22px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: "700",
                }}
              >
                {isSubmitting ? "Guardando..." : isEdit ? "Actualizar Skin" : "Crear Skin"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
