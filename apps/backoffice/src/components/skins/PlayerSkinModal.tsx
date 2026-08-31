import React, { useState, useRef } from "react"
import type { ThemeMode, AdminPlayerSkin } from "../../types"
import { validateMinecraftSkinTexture, MAX_SKIN_SIZE_BYTES } from "@hikat/shared"
import { skinsApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
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
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
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
          backgroundColor: isDark ? "#1e293b" : "#ffffff",
          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          borderRadius: "16px",
          width: "100%",
          maxWidth: "800px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: isDark
            ? "0 25px 50px -12px rgba(0,0,0,0.5)"
            : "0 20px 25px -5px rgba(0,0,0,0.1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 4px 0",
                fontSize: "18px",
                fontWeight: "700",
                color: isDark ? "#f1f5f9" : "#0f172a",
              }}
            >
              Skin de {skin.userDisplayName}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              ID Usuario: <code style={{ fontSize: "12px" }}>{skin.userId}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: isDark ? "#334155" : "#f1f5f9",
              color: isDark ? "#94a3b8" : "#64748b",
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
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: isDark ? "rgba(239, 68, 68, 0.2)" : "#fef2f2",
                border: "1px solid #ef4444",
                color: isDark ? "#fca5a5" : "#b91c1c",
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
                    {selectedFile ? "Cambiar PNG..." : "Reemplazar textura..."}
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
                    color: isDark ? "#94a3b8" : "#64748b",
                    marginBottom: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Jugador
                </label>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: "600",
                    color: isDark ? "#f1f5f9" : "#0f172a",
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
                    color: isDark ? "#94a3b8" : "#64748b",
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
                    color: isDark ? "#cbd5e1" : "#334155",
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
                    color: isDark ? "#94a3b8" : "#64748b",
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
                    color: isDark ? "#cbd5e1" : "#334155",
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
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "#6366f1",
                      color: "#ffffff",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
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
              paddingTop: "16px",
              borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 16px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isDark ? "#334155" : "#f8fafc",
                color: isDark ? "#f1f5f9" : "#334155",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {isViewOnly ? "Cerrar" : "Cancelar"}
            </button>
            {!isViewOnly && (
              <button
                type="submit"
                disabled={isSubmitting || !selectedFile}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "9px 20px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#6366f1",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: isSubmitting || !selectedFile ? "not-allowed" : "pointer",
                  opacity: isSubmitting || !selectedFile ? 0.6 : 1,
                }}
              >
                {isSubmitting && <IconSpinner size={16} />}
                {isSubmitting ? "Guardando..." : "Guardar Nueva Textura"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
