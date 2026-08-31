import React, { useState, useRef } from "react"
import type { ThemeMode, AdminGameFile, GameFileCategory } from "../../types"
import { sanitizeGameFileName } from "@hikat/shared"
import { gameApi } from "../../services/graphqlClient"
import { uploadGameFileDirect } from "../../services/gameFileUploadService"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconUpload, IconSpinner, IconBox } from "../../theme/icons"
import BackofficeSelect, { SelectOption } from "../common/BackofficeSelect"

interface AddGameFileModalProps {
  theme: ThemeMode
  targetFile?: AdminGameFile | null
  onClose: () => void
  onSaved: () => void
}

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: "MOD", label: "Mod (.jar)" },
  { value: "RESOURCE_PACK", label: "Paquete de recursos (.zip)" },
  { value: "SHADER_PACK", label: "Paquete de shaders (.zip)" },
  { value: "KUBEJS", label: "KubeJS (.js / .zip)" },
  { value: "SCRIPT", label: "Script (.js / .json)" },
]

export default function AddGameFileModal({
  theme,
  targetFile,
  onClose,
  onSaved,
}: AddGameFileModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const isReplace = !!targetFile

  const [name, setName] = useState(targetFile?.name || "")
  const [category, setCategory] = useState<GameFileCategory>(targetFile?.category || "MOD")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)

    if (!name || isReplace) {
      const clean = sanitizeGameFileName(file.name)
        .replace(/\.(jar|zip|json|js)$/i, "")
        .replace(/[-_]/g, " ")

      setName(clean)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("El nombre del archivo es obligatorio.")
      return
    }

    if (!isReplace && !selectedFile) {
      setError("Debes seleccionar un archivo para subir.")
      return
    }

    setIsSubmitting(true)
    try {
      let tokenHash: string | undefined

      if (selectedFile) {
        // 1. Request upload ticket
        const ticket = await gameApi.createGameFileUpload({
          category,
          originalFilename: selectedFile.name,
          sizeBytes: selectedFile.size,
        })

        // 2. Direct multipart upload to R2
        const uploaded = await uploadGameFileDirect(selectedFile, ticket)

        // 3. Confirm upload on backend
        const completed = await gameApi.completeGameFileUpload({
          uploadToken: ticket.uploadToken,
          sha256: uploaded.sha256,
          sizeBytes: uploaded.sizeBytes,
        })

        tokenHash = completed.tokenHash
      }

      if (isReplace && targetFile) {
        await gameApi.updateGameFile(targetFile.id, {
          name: name.trim(),
          category,
          tokenHash,
        })
      } else {
        await gameApi.addGameFile({
          name: name.trim(),
          category,
          tokenHash: tokenHash!,
        })
      }

      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.message || "Error al procesar el archivo.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "16px",
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
          maxWidth: "520px",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Modal Header */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                backgroundColor: "rgba(62, 196, 192, 0.15)",
                color: "#3ec4c0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconBox size={20} />
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: "700",
                color: tokens.textPrimary,
              }}
            >
              {isReplace ? "Actualizar archivo" : "Añadir mod o archivo"}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: tokens.textMuted,
              display: "flex",
              padding: "4px",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} style={{ padding: "24px" }}>
          {error && (
            <div
              style={{
                marginBottom: "20px",
                padding: "10px 14px",
                borderRadius: "10px",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#ef4444",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          {/* File Selector */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: tokens.textSecondary,
                marginBottom: "8px",
              }}
            >
              {isReplace ? "Reemplazar archivo (opcional si solo cambias nombre)" : "Archivo (.jar / .zip)"}
            </label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".jar,.zip,.json,.js"
              style={{ display: "none" }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${selectedFile ? "#3ec4c0" : tokens.borderSubtle}`,
                borderRadius: "12px",
                padding: "24px 16px",
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: selectedFile
                  ? (isDark ? "rgba(62, 196, 192, 0.08)" : "#f0fdfa")
                  : tokens.bgCardInner,
                transition: "all 0.15s ease",
              }}
            >
              <div
                style={{
                  color: selectedFile ? "#3ec4c0" : tokens.textMuted,
                  margin: "0 auto 8px auto",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <IconUpload size={28} />
              </div>

              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: tokens.textPrimary,
                }}
              >
                {selectedFile
                  ? selectedFile.name
                  : isReplace
                    ? "Haz clic para seleccionar nuevo archivo .jar"
                    : "Haz clic para seleccionar archivo"}
              </div>
              <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "4px" }}>
                {selectedFile
                  ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                  : "Formatos permitidos: .jar, .zip, .json, .js"}
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
                color: tokens.textSecondary,
                marginBottom: "6px",
              }}
            >
              Nombre visible
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. JourneyMap, Sodium, Shaders Complementary..."
              className="launcher-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Category Selector */}
          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                color: tokens.textSecondary,
                marginBottom: "6px",
              }}
            >
              Tipo de contenido
            </label>
            <BackofficeSelect
              theme={theme}
              value={category}
              onChange={(val) => setCategory(val as GameFileCategory)}
              options={CATEGORY_OPTIONS}
            />
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              paddingTop: "16px",
              borderTop: `1px solid ${tokens.borderSubtle}`,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="launcher-btn-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="launcher-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isSubmitting && <IconSpinner size={16} />}
              {isReplace ? "Guardar cambios" : "Añadir archivo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
