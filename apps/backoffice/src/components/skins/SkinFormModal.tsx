import React, { useState, useRef, useEffect } from "react"
import type { ThemeMode, SkinItem, SkinStatus } from "../../types"
import { validateMinecraftSkinTexture, MAX_SKIN_SIZE_BYTES } from "@hikat/shared"
import { skinsApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconUpload, IconSpinner } from "../../theme/icons"
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
  const tokens = getThemeTokens(theme)
  const isDark = theme === "dark"
  const isViewOnly = mode === "view"
  const isEdit = mode === "edit" && skin !== null

  const [name, setName] = useState(skin?.name || "")
  const [status, setStatus] = useState<SkinStatus>(skin?.status || "AVAILABLE")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>(skin?.imageUrl || "")
  const [fileError, setFileError] = useState<string | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setName(skin?.name || "")
    setStatus(skin?.status || "AVAILABLE")
    setSelectedFile(null)
    setFileError(null)
    setError(null)
    setPreviewUrl(skin?.imageUrl || "")
  }, [skin, mode])

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
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(file)
        setPreviewUrl(url)
      }

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

    const trimmedName = name.trim()
    if (!trimmedName) {
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

      if (isEdit && skin) {
        await skinsApi.updateSkin(skin.id, {
          name: trimmedName,
          status,
          mediaId,
        })
      } else {
        if (!mediaId) {
          throw new Error("No se pudo subir la textura.")
        }
        await skinsApi.createSkin({
          name: trimmedName,
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
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "760px",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            backgroundColor: tokens.bgCardInner,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: "700",
              color: tokens.textPrimary,
            }}
          >
            {isViewOnly ? "Detalles de la Skin" : isEdit ? "Editar Skin" : "Nueva Skin"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: tokens.textMuted,
              display: "flex",
              padding: "6px",
              borderRadius: "8px",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ overflowY: "auto", padding: "24px", flex: 1 }}>
          {error && (
            <div
              style={{
                marginBottom: "20px",
                padding: "10px 14px",
                borderRadius: "10px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
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
                      borderRadius: "14px",
                      backgroundColor: tokens.bgCardInner,
                      border: `2px dashed ${tokens.borderSubtle}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: tokens.textMuted,
                      padding: "20px",
                      textAlign: "center",
                    }}
                  >
                    <IconUpload size={32} />
                    <span style={{ marginTop: "12px", fontSize: "13px", fontWeight: "500" }}>
                      Selecciona una textura PNG
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
                    className="launcher-btn-secondary"
                    style={{
                      padding: "8px 16px",
                      borderRadius: "10px",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    <IconUpload size={16} />
                    <span>{selectedFile ? "Cambiar archivo..." : isEdit ? "Reemplazar textura..." : "Seleccionar PNG (64x64)..."}</span>
                  </button>
                  {fileError && (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "#ef4444", textAlign: "center" }}>
                      {fileError}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div style={{ marginBottom: "18px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: tokens.textSecondary,
                    marginBottom: "6px",
                  }}
                >
                  Nombre de la Skin
                </label>
                {isViewOnly ? (
                  <div style={{ fontSize: "16px", fontWeight: "700", color: tokens.textPrimary }}>
                    {name}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Alex Aventurera, Traje Espacial..."
                    className="launcher-input"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "12px",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                )}
              </div>

              <div style={{ marginBottom: "24px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: tokens.textSecondary,
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
                      borderRadius: "8px",
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
                        borderRadius: "10px",
                        border: `1.5px solid ${status === "AVAILABLE" ? "#22c55e" : tokens.borderSubtle}`,
                        backgroundColor: status === "AVAILABLE" ? (isDark ? "rgba(34, 197, 94, 0.18)" : "#f0fdf4") : tokens.bgCardInner,
                        color: status === "AVAILABLE" ? "#22c55e" : tokens.textSecondary,
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
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
                        borderRadius: "10px",
                        border: `1.5px solid ${status === "UNAVAILABLE" ? "#f97316" : tokens.borderSubtle}`,
                        backgroundColor: status === "UNAVAILABLE" ? (isDark ? "rgba(249, 115, 22, 0.18)" : "#fff7ed") : tokens.bgCardInner,
                        color: status === "UNAVAILABLE" ? "#f97316" : tokens.textSecondary,
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      Oculto
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "24px",
              paddingTop: "20px",
              borderTop: `1px solid ${tokens.borderSubtle}`,
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
