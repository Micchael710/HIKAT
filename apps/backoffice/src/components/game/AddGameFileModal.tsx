import React, { useState, useRef } from "react"
import type { ThemeMode, GameFileCategory } from "../../types"
import { sanitizeGameFileName } from "@hikat/shared"
import { gameApi } from "../../services/graphqlClient"
import { IconCross, IconUpload, IconSpinner } from "../../theme/icons"
import BackofficeSelect, { SelectOption } from "../common/BackofficeSelect"

interface AddGameFileModalProps {
  theme: ThemeMode
  onClose: () => void
  onAdded: () => void
}

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: "MOD", label: "Mod (.jar) — mods/" },
  { value: "RESOURCE_PACK", label: "Paquete de Recursos (.zip) — resourcepacks/" },
  { value: "SHADER_PACK", label: "Paquete de Shaders (.zip) — shaderpacks/" },
  { value: "KUBEJS", label: "KubeJS — kubejs/" },
  { value: "SCRIPT", label: "Script — scripts/" },
]

export default function AddGameFileModal({
  theme,
  onClose,
  onAdded,
}: AddGameFileModalProps) {
  const isDark = theme === "dark"

  const [category, setCategory] = useState<GameFileCategory>("MOD")
  const [name, setName] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileError(null)

    if (category === "MOD" && !file.name.toLowerCase().endsWith(".jar")) {
      setFileError("Un mod debe ser un archivo con extensión .jar.")
      return
    }

    if (
      (category === "RESOURCE_PACK" || category === "SHADER_PACK") &&
      !file.name.toLowerCase().endsWith(".zip")
    ) {
      setFileError("El paquete debe ser un archivo con extensión .zip.")
      return
    }

    setSelectedFile(file)

    if (!name) {
      const cleanName = sanitizeGameFileName(file.name)
        .replace(/\.(jar|zip)$/i, "")
        .replace(/[_-]/g, " ")
      setName(cleanName)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedFile) {
      setError("Debes seleccionar un archivo para subir.")
      return
    }

    if (!name.trim()) {
      setError("El nombre del mod o archivo es obligatorio.")
      return
    }

    setIsSubmitting(true)
    try {
      // 1. Request game upload ticket
      const ticket = await gameApi.createGameFileUpload({
        category,
        originalFilename: selectedFile.name,
        sizeBytes: selectedFile.size,
      })

      // 2. Upload binary payload to /game/files/upload
      const uploaded = await gameApi.uploadGameBinary(
        selectedFile,
        ticket.uploadUrl,
        ticket.uploadToken,
      )

      // 3. Attach uploaded file to draft
      await gameApi.addGameFile({
        name: name.trim(),
        category,
        tokenHash: uploaded.tokenHash,
      })

      onAdded()
      onClose()
    } catch (err: any) {
      setError(err.message || "Error al subir y añadir el archivo.")
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
            Añadir Mod / Archivo al Juego
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

          {/* Category Selector */}
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
              Categoría de archivo
            </label>
            <BackofficeSelect
              theme={theme}
              value={category}
              onChange={(val) => setCategory(val as GameFileCategory)}
              options={CATEGORY_OPTIONS}
            />
          </div>

          {/* File Picker */}
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
              Archivo binario
            </label>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept={category === "MOD" ? ".jar" : ".zip,.jar"}
              style={{ display: "none" }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%",
                padding: "20px",
                borderRadius: "10px",
                border: `2px dashed ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isDark ? "rgba(15, 23, 42, 0.5)" : "#f8fafc",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  backgroundColor: isDark ? "#334155" : "#e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isDark ? "#f1f5f9" : "#1e293b",
                }}
              >
                <IconUpload size={20} />
              </div>
              <span style={{ fontSize: "13px", fontWeight: "500", color: isDark ? "#f1f5f9" : "#1e293b" }}>
                {selectedFile ? selectedFile.name : "Haz clic para seleccionar el archivo..."}
              </span>
              {selectedFile && (
                <span style={{ fontSize: "12px", color: isDark ? "#94a3b8" : "#64748b" }}>
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              )}
            </button>

            {fileError && (
              <div style={{ marginTop: "6px", fontSize: "12px", color: "#ef4444" }}>
                {fileError}
              </div>
            )}
          </div>

          {/* Name Field */}
          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: isDark ? "#cbd5e1" : "#334155",
                marginBottom: "6px",
              }}
            >
              Nombre visible
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. JourneyMap, Sodium, Iris Shaders..."
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
              Añadir al borrador
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
