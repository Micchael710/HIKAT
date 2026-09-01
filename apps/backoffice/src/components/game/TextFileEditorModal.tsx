import React, { useState, useEffect, useCallback, useMemo } from "react"
import type { ThemeMode, SyncPolicy } from "../../types"
import { gameApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
import { MAX_GAME_TEXT_FILE_SIZE_BYTES, validateJsonContent } from "@hikat/shared"
import {
  IconCross,
  IconSpinner,
  IconCheck,
  IconAlertCircle,
  IconSave,
  IconFileText,
} from "../../theme/icons"

interface TextFileEditorModalProps {
  theme: ThemeMode
  fileId?: string
  logicalPath: string
  isNew?: boolean
  readOnly?: boolean
  initialContent?: string
  onClose: () => void
  onSaveSuccess: (savedFile: import("../../types").AdminGameFile) => void
  onToast: (message: string, type: "success" | "error") => void
}

export default function TextFileEditorModal({
  theme,
  fileId,
  logicalPath: initialLogicalPath,
  isNew = false,
  readOnly = false,
  initialContent = "",
  onClose,
  onSaveSuccess,
  onToast,
}: TextFileEditorModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [logicalPath, setLogicalPath] = useState(initialLogicalPath)
  const [content, setContent] = useState(initialContent)
  const [originalContent, setOriginalContent] = useState(initialContent)
  const [isLoading, setIsLoading] = useState(!isNew && !!fileId && !initialContent)
  const [isSaving, setIsSaving] = useState(false)
  const [explicitPolicy, setExplicitPolicy] = useState<SyncPolicy | undefined>(undefined)

  const filename = useMemo(() => logicalPath.split("/").pop() || "", [logicalPath])
  const isJson = useMemo(() => filename.toLowerCase().endsWith(".json"), [filename])

  const hasUnsavedChanges = content !== originalContent

  // Fetch file content if opening an existing file
  useEffect(() => {
    if (!isNew && fileId && !initialContent) {
      let isMounted = true
      setIsLoading(true)
      gameApi
        .readGameFileContent(fileId)
        .then((text) => {
          if (isMounted) {
            setContent(text)
            setOriginalContent(text)
          }
        })
        .catch((err) => {
          if (isMounted) {
            onToast(err instanceof Error ? err.message : "Error al leer el archivo.", "error")
            onClose()
          }
        })
        .finally(() => {
          if (isMounted) setIsLoading(false)
        })

      return () => {
        isMounted = false
      }
    }
  }, [isNew, fileId, initialContent, onClose, onToast])

  // Real-time JSON validation
  const jsonValidation = useMemo(() => {
    if (!isJson || !content.trim()) return { valid: true }
    return validateJsonContent(content)
  }, [isJson, content])

  // Size calculation
  const sizeBytes = useMemo(() => {
    try {
      return new TextEncoder().encode(content).byteLength
    } catch {
      return content.length
    }
  }, [content])

  const isOverSize = sizeBytes > MAX_GAME_TEXT_FILE_SIZE_BYTES

  const lineCount = useMemo(() => {
    return content.split("\n").length
  }, [content])

  const handleSave = useCallback(async () => {
    if (readOnly || isSaving) return
    if (isOverSize) {
      onToast("El archivo excede el tamaño máximo permitido (1 MB).", "error")
      return
    }
    if (isJson && !jsonValidation.valid) {
      onToast("El contenido no es un JSON válido.", "error")
      return
    }

    setIsSaving(true)
    try {
      const saved = await gameApi.saveGameFileContent({
        logicalPath: logicalPath.trim(),
        content,
        explicitPolicy,
      })
      setOriginalContent(content)
      onToast(`Archivo ${isNew ? "creado" : "guardado"} exitosamente.`, "success")
      onSaveSuccess(saved)
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error al guardar el archivo.", "error")
    } finally {
      setIsSaving(false)
    }
  }, [readOnly, isSaving, isOverSize, isJson, jsonValidation, isNew, fileId, logicalPath, content, explicitPolicy, onToast, onSaveSuccess])

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        if (hasUnsavedChanges) {
          if (confirm("Tienes cambios sin guardar. ¿Deseas descartarlos y salir?")) {
            onClose()
          }
        } else {
          onClose()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleSave, hasUnsavedChanges, onClose])

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (confirm("Tienes cambios sin guardar. ¿Deseas descartarlos y salir?")) {
        onClose()
      }
    } else {
      onClose()
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
        padding: "20px",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1100px",
          height: "85vh",
          backgroundColor: tokens.bgCard,
          borderRadius: "18px",
          border: `1px solid ${tokens.borderSubtle}`,
          boxShadow: tokens.cardShadowLg,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            backgroundColor: tokens.bgCardInner,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            <IconFileText style={{ width: 20, height: 20, color: "#10b981", flexShrink: 0 }} />
            {isNew ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                <span style={{ fontSize: "14px", color: tokens.textSecondary }}>Ruta:</span>
                <input
                  type="text"
                  value={logicalPath}
                  onChange={(e) => setLogicalPath(e.target.value)}
                  placeholder="config/nuevo_archivo.txt"
                  className="launcher-input"
                  style={{
                    flex: 1,
                    maxWidth: "400px",
                    fontFamily: "monospace",
                  }}
                />
              </div>
            ) : (
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: "700",
                    color: tokens.textPrimary,
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {logicalPath}
                </div>
                <div style={{ fontSize: "12px", color: tokens.textSecondary }}>
                  {readOnly ? "Modo solo lectura" : "Editor de texto en vivo (Ctrl+S para guardar)"}
                </div>
              </div>
            )}

            {/* Unsaved indicator */}
            {!readOnly && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  backgroundColor: hasUnsavedChanges
                    ? isDark
                      ? "rgba(245, 158, 11, 0.15)"
                      : "#fef3c7"
                    : isDark
                    ? "rgba(34, 197, 94, 0.15)"
                    : "#dcfce7",
                  color: hasUnsavedChanges
                    ? isDark
                      ? "#f59e0b"
                      : "#b45309"
                    : isDark
                    ? "#22c55e"
                    : "#15803d",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: hasUnsavedChanges ? "#f59e0b" : "#22c55e",
                  }}
                />
                {hasUnsavedChanges ? "Sin guardar" : "Guardado"}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {!readOnly && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isOverSize || (isJson && !jsonValidation.valid)}
                className={hasUnsavedChanges ? "launcher-btn-primary" : "launcher-btn-secondary"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  padding: "8px 18px",
                  borderRadius: "10px",
                }}
              >
                {isSaving ? <IconSpinner style={{ width: 14, height: 14 }} /> : <IconSave style={{ width: 14, height: 14 }} />}
                <span>Guardar</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleClose}
              style={{
                background: "transparent",
                border: "none",
                color: tokens.textMuted,
                cursor: "pointer",
                padding: "8px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Cerrar (Esc)"
            >
              <IconCross style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        {/* JSON Syntax Alert Banner */}
        {isJson && !jsonValidation.valid && (
          <div
            style={{
              padding: "10px 20px",
              backgroundColor: isDark ? "rgba(239, 68, 68, 0.2)" : "#fee2e2",
              borderBottom: "1px solid #ef4444",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: isDark ? "#fca5a5" : "#991b1b",
              fontSize: "13px",
            }}
          >
            <IconAlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span style={{ fontWeight: "500" }}>Error de sintaxis JSON: {jsonValidation.error}</span>
          </div>
        )}

        {/* Editor Body */}
        <div style={{ flex: 1, position: "relative", display: "flex", overflow: "hidden" }}>
          {isLoading ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              <IconSpinner style={{ width: 32, height: 32 }} />
              <span>Cargando contenido del archivo...</span>
            </div>
          ) : (
            <div style={{ display: "flex", flex: 1, overflow: "hidden", width: "100%" }}>
              {/* Line Numbers Column */}
              <div
                style={{
                  width: "50px",
                  padding: "16px 8px 16px 0",
                  textAlign: "right",
                  userSelect: "none",
                  backgroundColor: isDark ? "#0a0f1d" : "#f1f5f9",
                  color: isDark ? "#475569" : "#94a3b8",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "13px",
                  lineHeight: "20px",
                  borderRight: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
                  overflow: "hidden",
                }}
              >
                {Array.from({ length: lineCount }).map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>

              {/* Textarea Area */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                readOnly={readOnly}
                spellCheck={false}
                style={{
                  flex: 1,
                  padding: "16px",
                  border: "none",
                  outline: "none",
                  backgroundColor: isDark ? "#0f172a" : "#ffffff",
                  color: isDark ? "#e2e8f0" : "#1e293b",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "13px",
                  lineHeight: "20px",
                  resize: "none",
                  tabSize: 2,
                  whiteSpace: "pre",
                  overflowWrap: "normal",
                  overflowX: "auto",
                }}
              />
            </div>
          )}
        </div>

        {/* Modal Footer / Status Bar */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: `1px solid ${tokens.borderSubtle}`,
            backgroundColor: tokens.bgCardInner,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px",
            color: tokens.textSecondary,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span>Líneas: <strong>{lineCount}</strong></span>
            <span>Caracteres: <strong>{content.length}</strong></span>
            <span>
              Tamaño:{" "}
              <strong style={{ color: isOverSize ? "#ef4444" : undefined }}>
                {(sizeBytes / 1024).toFixed(1)} KB / 1024 KB
              </strong>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>Codificación: <strong>UTF-8</strong></span>
            {isJson && (
              <span
                style={{
                  color: jsonValidation.valid ? "#22c55e" : "#ef4444",
                  fontWeight: "600",
                }}
              >
                {jsonValidation.valid ? "✓ JSON Válido" : "✗ JSON Inválido"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
