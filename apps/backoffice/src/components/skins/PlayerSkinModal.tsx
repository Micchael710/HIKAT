import React, { useState, useRef } from "react"
import type { ThemeMode, AdminPlayerSkin } from "../../types"
import { validateMinecraftSkinTexture, MAX_SKIN_SIZE_BYTES } from "@hikat/shared"
import { skinsApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconUpload, IconSpinner } from "../../theme/icons"
import SkinViewer3D from "./SkinViewer3D"

interface PlayerSkinModalProps {
  theme: ThemeMode
  skin: AdminPlayerSkin
  mode?: "edit" | "view"
  onClose: () => void
  onSaved: () => void
}

export default function PlayerSkinModal({
  theme,
  skin,
  mode = "edit",
  onClose,
  onSaved,
}: PlayerSkinModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [currentMode, setCurrentMode] = useState<"edit" | "view">(mode)
  const isViewOnly = currentMode === "view"

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>(skin.imageUrl)
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

    if (
      file.type !== "image/png" &&
      !file.name.toLowerCase().endsWith(".png")
    ) {
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

    if (!selectedFile) {
      setError("Debes seleccionar una nueva textura PNG para guardar cambios.")
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      const uploadedMedia = await uploadMediaFile(selectedFile, "IMAGE")
      await skinsApi.updateAdminPlayerSkin(skin.id, {
        mediaId: uploadedMedia.id,
      })

      onSaved()
    } catch (err: any) {
      setError(err.message || "Error al actualizar la skin del jugador.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "20px",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "800px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Header */}
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
          <div>
            <h2
              style={{
                margin: "0 0 4px 0",
                fontSize: "18px",
                fontWeight: "700",
                color: tokens.textPrimary,
              }}
            >
              Skin de {skin.userDisplayName}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: tokens.textMuted,
              }}
            >
              ID Usuario: <code style={{ fontSize: "12px" }}>{skin.userId}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: tokens.textMuted,
              padding: "6px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        {/* Content Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: "24px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {error && (
            <div
              style={{
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
              gridTemplateColumns: "280px 1fr",
              gap: "24px",
            }}
          >
            {/* 3D Skin Viewer */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <SkinViewer3D
                skinUrl={previewUrl}
                width={280}
                height={340}
                theme={theme}
                autoRotate={true}
              />

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
                    }}
                  >
                    <IconUpload size={16} />
                    <span>{selectedFile ? "Cambiar PNG..." : "Reemplazar textura..."}</span>
                  </button>
                  {fileError && (
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        color: "#ef4444",
                        textAlign: "center",
                      }}
                    >
                      {fileError}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Metadata & Actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: tokens.textSecondary,
                    marginBottom: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Jugador
                </label>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: "700",
                    color: tokens.textPrimary,
                  }}
                >
                  {skin.userDisplayName}
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: tokens.textSecondary,
                    marginBottom: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Fecha de Subida
                </label>
                <div
                  style={{
                    fontSize: "14px",
                    color: tokens.textSecondary,
                  }}
                >
                  {new Date(skin.createdAt).toLocaleString()}
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: tokens.textSecondary,
                    marginBottom: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Última Actualización
                </label>
                <div
                  style={{
                    fontSize: "14px",
                    color: tokens.textSecondary,
                  }}
                >
                  {new Date(skin.updatedAt).toLocaleString()}
                </div>
              </div>

              {isViewOnly && (
                <div style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    onClick={() => setCurrentMode("edit")}
                    className="launcher-btn-primary"
                    style={{
                      padding: "8px 16px",
                      borderRadius: "10px",
                      fontSize: "13px",
                    }}
                  >
                    Reemplazar textura como Administrador
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
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
                disabled={isSubmitting || !selectedFile}
                className="launcher-btn-primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 22px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: isSubmitting || !selectedFile ? "not-allowed" : "pointer",
                  opacity: isSubmitting || !selectedFile ? 0.6 : 1,
                }}
              >
                {isSubmitting && <IconSpinner size={16} />}
                <span>{isSubmitting ? "Guardando..." : "Guardar Nueva Textura"}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
