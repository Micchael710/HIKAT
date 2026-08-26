import React, { useState, useRef, useEffect } from "react"
import type { ThemeMode, SkinItem, SkinModel, SkinStatus } from "../../types"
import { validateMinecraftSkinTexture } from "@hikat/shared"
import { skinsApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { IconCross, IconUpload, IconSpinner } from "../../theme/icons"

import SkinHeadPreview from "./SkinHeadPreview"

interface SkinFormModalProps {
  theme: ThemeMode
  skin: SkinItem | null
  onClose: () => void
  onSaved: () => void
}

export default function SkinFormModal({
  theme,
  skin,
  onClose,
  onSaved,
}: SkinFormModalProps) {
  const isDark = theme === "dark"
  const isEdit = !!skin

  const [name, setName] = useState(skin?.name || "")
  const [model, setModel] = useState<SkinModel>(skin?.model || "CLASSIC")
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
          model,
          status,
          mediaId,
        })
      } else {
        if (!mediaId) {
          throw new Error("No se pudo subir la textura.")
        }
        await skinsApi.createSkin({
          name: name.trim(),
          model,
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
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: isDark ? "#1e293b" : "#ffffff",
          border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
          borderRadius: "16px",
          width: "100%",
          maxWidth: "480px",
          overflow: "hidden",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
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
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: "600",
              color: isDark ? "#f1f5f9" : "#0f172a",
            }}
          >
            {isEdit ? "Editar Skin" : "Nueva Skin"}
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: "24px" }}>
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

          {/* Texture Upload & Preview */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: isDark ? "#cbd5e1" : "#334155",
                marginBottom: "8px",
              }}
            >
              Textura de Skin (.png)
            </label>

            <div
              style={{
                display: "flex",
                gap: "16px",
                alignItems: "center",
              }}
            >
              {previewUrl && (
                <div style={{ flexShrink: 0 }}>
                  <SkinHeadPreview imageUrl={previewUrl} size={64} />
                </div>
              )}

              <div style={{ flex: 1 }}>
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
                    padding: "9px 14px",
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
                {selectedFile && (
                  <div style={{ marginTop: "4px", fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                    {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
                {fileError && (
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "#ef4444" }}>
                    {fileError}
                  </div>
                )}
              </div>
            </div>
          </div>

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
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Alex Aventurero, Traje Espacial..."
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
          </div>

          {/* Model Selector */}
          <div style={{ marginBottom: "18px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: isDark ? "#cbd5e1" : "#334155",
                marginBottom: "8px",
              }}
            >
              Modelo de brazos
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setModel("CLASSIC")}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: `1px solid ${model === "CLASSIC" ? "#6366f1" : isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: model === "CLASSIC" ? (isDark ? "rgba(99, 102, 241, 0.2)" : "#eef2ff") : "transparent",
                  color: model === "CLASSIC" ? "#6366f1" : isDark ? "#94a3b8" : "#64748b",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Clásico (4px)
              </button>
              <button
                type="button"
                onClick={() => setModel("SLIM")}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: `1px solid ${model === "SLIM" ? "#6366f1" : isDark ? "#475569" : "#cbd5e1"}`,
                  backgroundColor: model === "SLIM" ? (isDark ? "rgba(99, 102, 241, 0.2)" : "#eef2ff") : "transparent",
                  color: model === "SLIM" ? "#6366f1" : isDark ? "#94a3b8" : "#64748b",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Delgado / Slim (3px)
              </button>
            </div>
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
          </div>

          {/* Footer Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 16px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: "transparent",
                color: isDark ? "#94a3b8" : "#64748b",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
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
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting && <IconSpinner size={16} />}
              {isEdit ? "Guardar cambios" : "Crear Skin"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
