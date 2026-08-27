import React, { useState, useRef } from "react"
import type { ThemeMode, AdminPlayerSkin, SkinModel } from "../../types"
import { inspectMinecraftSkinTexture } from "@hikat/shared"
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

  const [model, setModel] = useState<SkinModel>(skin.model || "CLASSIC")
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

    if (
      file.type !== "image/png" &&
      !file.name.toLowerCase().endsWith(".png")
    ) {
      setFileError("El archivo debe ser una imagen PNG.")
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      const inspection = inspectMinecraftSkinTexture(buffer)
      if (!inspection.valid) {
        setFileError(inspection.error || "Dimensiones de skin no válidas.")
        return
      }

      setSelectedFile(file)
      if (inspection.model) {
        setModel(inspection.model)
      }
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

    setError(null)
    setIsSubmitting(true)
    try {
      let mediaId: string | undefined

      if (selectedFile) {
        const uploadedMedia = await uploadMediaFile(selectedFile, "IMAGE")
        mediaId = uploadedMedia.id
      }

      await skinsApi.updateAdminPlayerSkin(skin.id, {
        mediaId,
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
        zIndex: 1000,
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
              {isViewOnly
                ? `Skin de ${skin.userDisplayName}`
                : `Editar skin de ${skin.userDisplayName}`}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              {isViewOnly
                ? "Inspección 3D y detalles de la skin personalizada."
                : "Modifica el modelo o reemplaza la textura del jugador."}
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

        {/* Content */}
        <div
          style={{
            padding: "24px",
            overflowY: "auto",
            flex: 1,
          }}
        >
          {error && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#ef4444",
                fontSize: "14px",
                marginBottom: "20px",
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "24px",
            }}
          >
            {/* Left Column: 3D Preview */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "12px",
                padding: "16px",
                minHeight: "340px",
              }}
            >
              <SkinViewer3D
                skinUrl={previewUrl}
                model={model}
                theme={theme}
                width={260}
                height={320}
              />
            </div>

            {/* Right Column: Controls or Details */}
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "20px" }}
            >
              {/* Player Name */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#475569",
                    marginBottom: "6px",
                  }}
                >
                  Jugador
                </label>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "8px",
                    backgroundColor: isDark ? "#0f172a" : "#f8fafc",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                    color: isDark ? "#f1f5f9" : "#0f172a",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  {skin.userDisplayName}
                </div>
              </div>

              {/* Auto-detected Model Badge */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDark ? "#cbd5e1" : "#475569",
                    marginBottom: "6px",
                  }}
                >
                  Modelo detectado
                </label>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    backgroundColor: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                    color: isDark ? "#3ec4c0" : "#0c6e6b",
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  <span>{model === "SLIM" ? "Alex / Slim (3px)" : "Steve / Clásico (4px)"}</span>
                  <span style={{ fontSize: "11px", opacity: 0.8 }}>(automático)</span>
                </div>
              </div>

              {/* Texture Replacement (Edit mode) */}
              {!isViewOnly && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: isDark ? "#cbd5e1" : "#475569",
                      marginBottom: "6px",
                    }}
                  >
                    Reemplazar textura (.png)
                  </label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/png"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${
                        fileError ? "#ef4444" : isDark ? "#334155" : "#cbd5e1"
                      }`,
                      borderRadius: "10px",
                      padding: "20px",
                      textAlign: "center",
                      cursor: "pointer",
                      backgroundColor: isDark
                        ? "rgba(15, 23, 42, 0.5)"
                        : "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        margin: "0 auto 8px auto",
                        color: fileError
                          ? "#ef4444"
                          : isDark
                            ? "#94a3b8"
                            : "#64748b",
                      }}
                    >
                      <IconUpload size={24} />
                    </div>
                    <p
                      style={{
                        margin: "0 0 4px 0",
                        fontSize: "13px",
                        fontWeight: "500",
                        color: isDark ? "#f1f5f9" : "#0f172a",
                      }}
                    >
                      {selectedFile
                        ? selectedFile.name
                        : "Haz clic para seleccionar nueva textura PNG"}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "11px",
                        color: isDark ? "#64748b" : "#94a3b8",
                      }}
                    >
                      Formato estándar 64x64 o 64x32
                    </p>
                  </div>
                  {fileError && (
                    <p
                      style={{
                        margin: "6px 0 0 0",
                        fontSize: "12px",
                        color: "#ef4444",
                      }}
                    >
                      {fileError}
                    </p>
                  )}
                </div>
              )}

              {/* Date Info */}
              <div
                style={{
                  marginTop: "auto",
                  fontSize: "12px",
                  color: isDark ? "#64748b" : "#94a3b8",
                }}
              >
                <span>
                  Subida el: {new Date(skin.createdAt).toLocaleDateString()}
                </span>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "12px",
            padding: "16px 24px",
            borderTop: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
            backgroundColor: isDark ? "#0f172a" : "#f8fafc",
          }}
        >
          {isViewOnly ? (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "9px 16px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#0f172a",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => setCurrentMode("edit")}
                style={{
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#6366f1",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Editar skin
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                style={{
                  padding: "9px 16px",
                  borderRadius: "8px",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  backgroundColor: "transparent",
                  color: isDark ? "#f1f5f9" : "#0f172a",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#6366f1",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                {isSubmitting && <IconSpinner size={16} />}
                Guardar cambios
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
