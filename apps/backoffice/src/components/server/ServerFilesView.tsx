import React, { useState, useEffect, useCallback, useRef } from "react"
import type { ThemeMode, ServerFileItem, ServerStatus, ServerManagedContentItem, ServerReleaseSyncPlan } from "../../types"
import { serverApi, serverContentApi } from "../../services/graphqlClient"
import { formatBytesToHuman, isAllowlistedTextFile } from "@hikat/shared"
import {
  IconFolder,
  IconFile,
  IconFileText,
  IconDownload,
  IconUpload,
  IconEdit,
  IconTrash,
  IconPlus,
  IconRefresh,
  IconSpinner,
  IconAlertCircle,
  IconCheck,
  IconCross,
  IconRocket,
} from "../../theme/icons"
import { ServerModSearchModal } from "./providers/ServerModSearchModal"
import { ServerReleaseSyncModal } from "./ServerReleaseSyncModal"

interface ServerFilesViewProps {
  theme: ThemeMode
  serverStatus?: ServerStatus
  onToast: (message: string, type: "success" | "error") => void
  onNavigateToGame?: () => void
}

export default function ServerFilesView({ theme, serverStatus, onToast, onNavigateToGame }: ServerFilesViewProps) {
  const isDark = theme === "dark"
  const isDisconnected = serverStatus === "DISCONNECTED"
  const [currentPath, setCurrentPath] = useState("")
  const [files, setFiles] = useState<ServerFileItem[]>([])
  const [managedContent, setManagedContent] = useState<ServerManagedContentItem[]>([])
  const [syncPlan, setSyncPlan] = useState<ServerReleaseSyncPlan | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shard 08D Modals state
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [blockedDeleteTarget, setBlockedDeleteTarget] = useState<{ file: ServerFileItem; managed: ServerManagedContentItem } | null>(null)

  // Modals state
  const [newFolderName, setNewFolderName] = useState("")
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  const [renameTarget, setRenameTarget] = useState<ServerFileItem | null>(null)
  const [newName, setNewName] = useState("")
  const [isRenaming, setIsRenaming] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ServerFileItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Text editor modal
  const [editingFile, setEditingFile] = useState<{ path: string; name: string } | null>(null)
  const [editorContent, setEditorContent] = useState("")
  const [isEditorLoading, setIsEditorLoading] = useState(false)
  const [isEditorSaving, setIsEditorSaving] = useState(false)

  // Uploading state
  const [isUploading, setIsUploading] = useState(false)

  const isMountedRef = useRef(true)

  const fetchFiles = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true)
    setError(null)
    try {
      const [filesResult, managedResult, planResult] = await Promise.allSettled([
        serverApi.getServerFiles("SERVER", currentPath || undefined),
        serverContentApi.getServerManagedContent(),
        serverContentApi.getServerReleaseSyncPlan(),
      ])

      if (isMountedRef.current) {
        if (filesResult.status === "fulfilled") {
          // Sort directories first, then alphabetically
          const sorted = [...filesResult.value].sort((a, b) => {
            if (a.isFile === b.isFile) {
              return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
            }
            return a.isFile ? 1 : -1
          })
          setFiles(sorted)
        } else {
          setFiles([])
          setError(
            filesResult.reason instanceof Error
              ? filesResult.reason.message
              : "No se pudieron cargar los archivos del servidor.",
          )
        }

        if (managedResult.status === "fulfilled") {
          setManagedContent(managedResult.value)
        }

        if (planResult.status === "fulfilled") {
          setSyncPlan(planResult.value)
        }
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los archivos.",
        )
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [currentPath])

  useEffect(() => {
    isMountedRef.current = true
    setIsLoading(true)
    fetchFiles()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchFiles])

  const navigateToFolder = (folderName: string) => {
    setCurrentPath((prev) => (prev ? `${prev}/${folderName}` : folderName))
  }

  const navigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      setCurrentPath("")
      return
    }
    const segments = currentPath.split("/").filter(Boolean)
    const newPath = segments.slice(0, index + 1).join("/")
    setCurrentPath(newPath)
  }

  // Create folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderName.trim() || isDisconnected) return
    setIsCreatingFolder(true)
    try {
      await serverApi.createServerFolder("SERVER", currentPath, newFolderName.trim())
      onToast("Carpeta creada exitosamente.", "success")
      setIsNewFolderModalOpen(false)
      setNewFolderName("")
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al crear la carpeta.",
        "error",
      )
    } finally {
      setIsCreatingFolder(false)
    }
  }

  // Rename
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameTarget || !newName.trim() || isDisconnected) return
    setIsRenaming(true)
    const targetRelative = currentPath ? `${currentPath}/${renameTarget.name}` : renameTarget.name
    try {
      await serverApi.renameServerFile("SERVER", targetRelative, newName.trim())
      onToast("Elemento renombrado exitosamente.", "success")
      setRenameTarget(null)
      setNewName("")
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al renombrar el elemento.",
        "error",
      )
    } finally {
      setIsRenaming(false)
    }
  }

  // Delete
  const handleDelete = async () => {
    if (!deleteTarget || isDisconnected) return
    setIsDeleting(true)
    const targetRelative = currentPath ? `${currentPath}/${deleteTarget.name}` : deleteTarget.name
    try {
      await serverApi.deleteServerFile("SERVER", targetRelative)
      onToast("Elemento eliminado exitosamente.", "success")
      setDeleteTarget(null)
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al eliminar el elemento.",
        "error",
      )
    } finally {
      setIsDeleting(false)
    }
  }

  // Download
  const handleDownload = async (file: ServerFileItem) => {
    if (isDisconnected) return
    const targetRelative = currentPath ? `${currentPath}/${file.name}` : file.name
    try {
      const res = await serverApi.createServerFileDownloadUrl("SERVER", targetRelative)
      if (res && res.url) {
        const link = document.createElement("a")
        link.href = res.url
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        onToast("Descarga iniciada.", "success")
      }
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al generar enlace de descarga.",
        "error",
      )
    }
  }

  // Upload file (Real upload to Wings signed URL)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || isDisconnected) return
    setIsUploading(true)
    try {
      // 1. Request signed upload URL from backend for current directory
      const { url } = await serverApi.prepareServerFileUpload("SERVER", currentPath)
      // 2. Transfer REAL bytes to Wings signed URL and check response.ok
      await serverApi.uploadFileToSignedUrl(url, file)
      // 3. Notify success only after HTTP response.ok
      onToast(`Archivo "${file.name}" subido exitosamente.`, "success")
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al subir archivo.",
        "error",
      )
    } finally {
      setIsUploading(false)
      e.target.value = ""
    }
  }

  // Text Editor
  const openTextEditor = async (file: ServerFileItem) => {
    const targetRelative = currentPath ? `${currentPath}/${file.name}` : file.name
    setEditingFile({ path: targetRelative, name: file.name })
    setIsEditorLoading(true)
    try {
      const res = await serverApi.getServerTextFile("SERVER", targetRelative)
      setEditorContent(res.content)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "No se pudo leer el archivo de texto.",
        "error",
      )
      setEditingFile(null)
    } finally {
      setIsEditorLoading(false)
    }
  }

  const handleSaveTextEditor = async () => {
    if (!editingFile) return
    setIsEditorSaving(true)
    try {
      await serverApi.writeServerTextFile("SERVER", editingFile.path, editorContent)
      onToast("Archivo guardado exitosamente.", "success")
      setEditingFile(null)
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al guardar el archivo.",
        "error",
      )
    } finally {
      setIsEditorSaving(false)
    }
  }

  const pathSegments = currentPath.split("/").filter(Boolean)

  const getManagedRecord = (file: ServerFileItem) => {
    const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name
    const normalized = fullPath.replace(/^\//, "")
    return managedContent.find(
      (m) => m.targetPath === normalized || m.targetPath === fullPath || m.name === file.name,
    )
  }

  const handleAttemptRename = (file: ServerFileItem) => {
    const managed = getManagedRecord(file)
    if (managed) {
      onToast("No se pueden renombrar archivos administrados por HiKAT.", "error")
      return
    }
    setRenameTarget(file)
    setNewName(file.name)
  }

  const handleAttemptDelete = (file: ServerFileItem) => {
    const managed = getManagedRecord(file)
    if (managed && managed.managementSource === "GAME_RELEASE") {
      setBlockedDeleteTarget({ file, managed })
      return
    }
    setDeleteTarget(file)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Pending Release Sync Banner */}
      {syncPlan?.isPending && (
        <div
          data-testid="server-release-sync-banner"
          style={{
            padding: "16px 20px",
            borderRadius: 14,
            background: isDark ? "rgba(59, 130, 246, 0.12)" : "#eff6ff",
            border: `1px solid ${isDark ? "rgba(59, 130, 246, 0.3)" : "#bfdbfe"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ color: "#3b82f6", display: "flex", alignItems: "center" }}>
              <IconRocket style={{ width: 22, height: 22 }} />
            </div>
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: isDark ? "#f3f4f6" : "#1e3a8a" }}>
                Cambios pendientes en el servidor
              </div>
              <div style={{ fontSize: "0.82rem", color: isDark ? "#93c5fd" : "#3b82f6", marginTop: 2, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span>+{syncPlan.summary.toInstall} para instalar</span>
                <span>•</span>
                <span>↑{syncPlan.summary.toUpdate} para actualizar</span>
                <span>•</span>
                <span>−{syncPlan.summary.toRemove} para eliminar</span>
                <span>•</span>
                <span
                  style={{
                    color: syncPlan.canApply
                      ? "#22c55e"
                      : syncPlan.serverStatus === "DISCONNECTED" || syncPlan.serverStatus === "UNKNOWN"
                      ? "#ef4444"
                      : "#f59e0b",
                    fontWeight: 600,
                  }}
                >
                  {syncPlan.canApply
                    ? "🟢 Servidor apagado y listo"
                    : syncPlan.serverStatus === "ONLINE" || syncPlan.serverStatus === "STARTING" || syncPlan.serverStatus === "STOPPING"
                    ? `🟠 ${syncPlan.blockReason || "Apaga el servidor antes de aplicar los cambios"}`
                    : syncPlan.serverStatus === "OFFLINE"
                    ? `🟠 ${syncPlan.blockReason || "No se pudieron verificar los archivos del servidor"}`
                    : `🔴 ${syncPlan.blockReason || "El servidor no está disponible"}`}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            data-testid="button-open-release-sync"
            onClick={() => setIsSyncModalOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 18px",
              borderRadius: 10,
              border: "none",
              background: "#3b82f6",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            <span>Revisar cambios</span>
          </button>
        </div>
      )}

      {/* Header Actions Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 700,
            color: isDark ? "#ffffff" : "#0f172a",
          }}
        >
          Archivos del servidor
        </h2>

        {/* Global Directory Actions */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            data-testid="button-open-server-search"
            onClick={() => setIsSearchModalOpen(true)}
            disabled={isDisconnected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(59, 130, 246, 0.3)" : "#93c5fd"}`,
              background: isDark ? "rgba(59, 130, 246, 0.15)" : "#eff6ff",
              color: isDark ? "#60a5fa" : "#1d4ed8",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: isDisconnected ? "not-allowed" : "pointer",
              opacity: isDisconnected ? 0.5 : 1,
            }}
          >
            <IconPlus size={16} />
            <span>Buscar contenido</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewFolderModalOpen(true)}
            disabled={isDisconnected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "#cbd5e1"}`,
              background: "transparent",
              color: isDark ? "#ffffff" : "#0f172a",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: isDisconnected ? "not-allowed" : "pointer",
              opacity: isDisconnected ? 0.5 : 1,
            }}
          >
            <IconPlus size={16} />
            <span>Nueva carpeta</span>
          </button>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e0f2f1",
              color: isDark ? "#3ec4c0" : "#00897b",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: isUploading || isDisconnected ? "not-allowed" : "pointer",
              opacity: isDisconnected ? 0.5 : 1,
            }}
          >
            {isUploading ? <IconSpinner size={16} /> : <IconUpload size={16} />}
            <span>{isUploading ? "Subiendo..." : "Subir archivo"}</span>
            <input
              type="file"
              onChange={handleFileUpload}
              disabled={isUploading || isDisconnected}
              style={{ display: "none" }}
            />
          </label>

          <button
            type="button"
            onClick={() => fetchFiles(true)}
            disabled={isRefreshing || isDisconnected}
            style={{
              border: "none",
              background: "transparent",
              color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
              cursor: isRefreshing || isDisconnected ? "not-allowed" : "pointer",
              opacity: isDisconnected ? 0.5 : 1,
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            {isRefreshing ? <IconSpinner size={16} /> : <IconRefresh size={16} />}
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "0.875rem",
          color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
          padding: "8px 16px",
          borderRadius: 10,
          background: isDark ? "rgba(255, 255, 255, 0.03)" : "#f8fafc",
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "#e2e8f0"}`,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => navigateToBreadcrumb(-1)}
          style={{
            border: "none",
            background: "transparent",
            color: currentPath ? (isDark ? "#3ec4c0" : "#0c6e6b") : isDark ? "#ffffff" : "#0f172a",
            fontWeight: currentPath ? 600 : 700,
            cursor: currentPath ? "pointer" : "default",
            padding: 0,
          }}
        >
          Archivos del servidor
        </button>

        {pathSegments.map((segment, idx) => {
          const isLast = idx === pathSegments.length - 1
          return (
            <React.Fragment key={idx}>
              <span>&gt;</span>
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(idx)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isLast ? (isDark ? "#ffffff" : "#0f172a") : isDark ? "#3ec4c0" : "#0c6e6b",
                  fontWeight: isLast ? 700 : 600,
                  cursor: isLast ? "default" : "pointer",
                  padding: 0,
                }}
              >
                {segment}
              </button>
            </React.Fragment>
          )
        })}
      </div>

      {/* File Browser Table */}
      {isLoading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "64px 0",
            color: isDark ? "#3ec4c0" : "#0c6e6b",
            gap: 12,
          }}
        >
          <IconSpinner size={32} />
          <span style={{ fontSize: "0.95rem", fontWeight: 500 }}>
            Explorando archivos...
          </span>
        </div>
      ) : files.length === 0 || isDisconnected ? (
        <div
          style={{
            padding: 48,
            borderRadius: 20,
            background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ color: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)" }}>
            <IconFolder size={48} />
          </div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: isDark ? "#ffffff" : "#0f172a" }}>
            {isDisconnected ? "Servidor sin conexión" : "Esta carpeta está vacía"}
          </h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)" }}>
            {isDisconnected
              ? "Los archivos aparecerán aquí cuando el servidor esté conectado."
              : "Sube un archivo o crea una subcarpeta para comenzar."}
          </p>
        </div>
      ) : (
        <div
          style={{
            borderRadius: 16,
            background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
            overflow: "hidden",
            boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.15)" : "0 2px 8px rgba(0,0,0,0.03)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
                  background: isDark ? "rgba(255, 255, 255, 0.02)" : "#f8fafc",
                }}
              >
                <th style={{ padding: "14px 20px", fontSize: "0.8rem", fontWeight: 700, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", textTransform: "uppercase" }}>
                  Nombre
                </th>
                <th style={{ padding: "14px 20px", fontSize: "0.8rem", fontWeight: 700, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", textTransform: "uppercase" }}>
                  Tamaño
                </th>
                <th style={{ padding: "14px 20px", fontSize: "0.8rem", fontWeight: 700, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", textTransform: "uppercase" }}>
                  Modificado
                </th>
                <th style={{ padding: "14px 20px", fontSize: "0.8rem", fontWeight: 700, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", textTransform: "uppercase", textAlign: "right" }}>
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const isEditable = file.isFile && !file.isSymlink && isAllowlistedTextFile(file.name)
                const managed = getManagedRecord(file)
                return (
                  <tr
                    key={file.name}
                    style={{
                      borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)"}`,
                    }}
                  >
                    <td style={{ padding: "12px 20px" }}>
                      <div
                        onClick={() => !file.isFile && navigateToFolder(file.name)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          cursor: !file.isFile ? "pointer" : "default",
                          color: isDark ? "#ffffff" : "#0f172a",
                          fontWeight: !file.isFile ? 600 : 400,
                        }}
                      >
                        <div style={{ color: !file.isFile ? "#3ec4c0" : isEditable ? "#60a5fa" : "rgba(100,116,139,0.7)" }}>
                          {!file.isFile ? <IconFolder size={20} /> : isEditable ? <IconFileText size={20} /> : <IconFile size={20} />}
                        </div>
                        <span>{file.name}</span>
                        {file.isSymlink && (
                          <span
                            style={{
                              fontSize: "0.72rem",
                              padding: "2px 6px",
                              borderRadius: 6,
                              background: isDark ? "rgba(234, 179, 8, 0.15)" : "#fef9c3",
                              color: isDark ? "#facc15" : "#854d0e",
                              fontWeight: 700,
                            }}
                          >
                            Enlace
                          </span>
                        )}
                        {managed && (
                          <span
                            data-testid={`badge-managed-${managed.managementSource.toLowerCase()}`}
                            style={{
                              fontSize: "0.72rem",
                              padding: "2px 6px",
                              borderRadius: 6,
                              background:
                                managed.managementSource === "GAME_RELEASE"
                                  ? isDark
                                    ? "rgba(99, 102, 241, 0.2)"
                                    : "#e0e7ff"
                                  : isDark
                                  ? "rgba(14, 165, 233, 0.2)"
                                  : "#e0f2fe",
                              color:
                                managed.managementSource === "GAME_RELEASE"
                                  ? isDark
                                    ? "#818cf8"
                                    : "#4338ca"
                                  : isDark
                                  ? "#38bdf8"
                                  : "#0369a1",
                              fontWeight: 700,
                            }}
                          >
                            {managed.managementSource === "GAME_RELEASE" ? "Release" : "Servidor"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 20px", fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.7)" : "#475569" }}>
                      {file.isFile ? formatBytesToHuman(file.sizeBytes) : "—"}
                    </td>
                    <td style={{ padding: "12px 20px", fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.5)" : "#64748b" }}>
                      {new Date(file.modifiedAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "12px 20px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        {isEditable && (
                          <button
                            type="button"
                            title="Editar texto"
                            onClick={() => openTextEditor(file)}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                              background: "transparent",
                              color: isDark ? "#3ec4c0" : "#0f766e",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <IconEdit size={16} />
                          </button>
                        )}

                        {file.isFile && !file.isSymlink && (
                          <button
                            type="button"
                            title="Descargar"
                            onClick={() => handleDownload(file)}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                              background: "transparent",
                              color: isDark ? "#60a5fa" : "#2563eb",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <IconDownload size={16} />
                          </button>
                        )}

                        <button
                          type="button"
                          title={managed ? "No se pueden renombrar archivos administrados por HiKAT" : "Renombrar"}
                          onClick={() => handleAttemptRename(file)}
                          disabled={!!managed}
                          style={{
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                            background: "transparent",
                            color: managed ? (isDark ? "rgba(255,255,255,0.2)" : "#cbd5e1") : isDark ? "rgba(255,255,255,0.7)" : "#475569",
                            cursor: managed ? "not-allowed" : "pointer",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <IconEdit size={16} />
                        </button>

                        <button
                          type="button"
                          title="Eliminar"
                          onClick={() => handleAttemptDelete(file)}
                          style={{
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                            background: "transparent",
                            color: "#ef4444",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <IconTrash size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Folder Modal */}
      {isNewFolderModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Crear nueva carpeta
              </h3>
              <button
                type="button"
                onClick={() => !isCreatingFolder && setIsNewFolderModalOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 8, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                  Nombre de la carpeta:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: backup-scripts"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setIsNewFolderModalOpen(false)}
                  disabled={isCreatingFolder}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    background: "transparent",
                    color: isDark ? "#ffffff" : "#334155",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isCreatingFolder}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: isDark ? "#3ec4c0" : "#0c6e6b",
                    color: "#ffffff",
                    cursor: isCreatingFolder ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  {isCreatingFolder ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                  <span>{isCreatingFolder ? "Creando..." : "Crear"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Renombrar elemento
              </h3>
              <button
                type="button"
                onClick={() => !isRenaming && setRenameTarget(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            <form onSubmit={handleRename} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 8, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                  Nuevo nombre:
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  disabled={isRenaming}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    background: "transparent",
                    color: isDark ? "#ffffff" : "#334155",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isRenaming}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: isDark ? "#3ec4c0" : "#0c6e6b",
                    color: "#ffffff",
                    cursor: isRenaming ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  {isRenaming ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                  <span>{isRenaming ? "Renombrando..." : "Guardar"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ color: "#ef4444" }}>
                <IconTrash size={28} />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Eliminar elemento
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: "0.9rem", color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
              ¿Estás seguro de eliminar <strong>{deleteTarget.name}</strong>?
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  background: "transparent",
                  color: isDark ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 22px",
                  borderRadius: 10,
                  border: "none",
                  background: "#ef4444",
                  color: "#ffffff",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {isDeleting ? <IconSpinner size={18} /> : <IconTrash size={18} />}
                <span>{isDeleting ? "Eliminando..." : "Eliminar"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text File Editor Modal */}
      {editingFile && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(5px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 24,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 900,
              height: "85vh",
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 24,
              boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <IconFileText size={22} />
                <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                  {editingFile.name}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => !isEditorSaving && setEditingFile(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            {isEditorLoading ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "#3ec4c0" }}>
                <IconSpinner size={28} />
                <span>Cargando contenido...</span>
              </div>
            ) : (
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                style={{
                  flex: 1,
                  width: "100%",
                  padding: 16,
                  borderRadius: 12,
                  background: isDark ? "#0c1319" : "#f8fafc",
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  color: isDark ? "#e2e8f0" : "#0f172a",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  lineHeight: 1.5,
                  resize: "none",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={() => setEditingFile(null)}
                disabled={isEditorSaving}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  background: "transparent",
                  color: isDark ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cerrar
              </button>

              <button
                type="button"
                onClick={handleSaveTextEditor}
                disabled={isEditorSaving || isEditorLoading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "none",
                  background: isDark ? "#3ec4c0" : "#0c6e6b",
                  color: "#ffffff",
                  cursor: isEditorSaving || isEditorLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {isEditorSaving ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                <span>{isEditorSaving ? "Guardando..." : "Guardar cambios"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked Delete for GAME_RELEASE Modal */}
      {blockedDeleteTarget && (
        <div
          data-testid="modal-blocked-delete"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 460,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ color: "#f59e0b", fontSize: "28px" }}>ℹ️</div>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Archivo de la versión del juego
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.8)" : "#334155", lineHeight: 1.5 }}>
              El archivo <strong>{blockedDeleteTarget.file.name}</strong> pertenece a la release oficial del modpack.
              Para eliminarlo o actualizarlo de manera sincronizada con el cliente de los jugadores, modifícalo desde <strong>Juego → Actualizaciones</strong>.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setBlockedDeleteTarget(null)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  background: "transparent",
                  color: isDark ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Entendido
              </button>

              {onNavigateToGame && (
                <button
                  type="button"
                  data-testid="button-navigate-game-from-delete"
                  onClick={() => {
                    setBlockedDeleteTarget(null)
                    onNavigateToGame()
                  }}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: "#3b82f6",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Ir a Actualizaciones →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shard 08D Modals */}
      {isSearchModalOpen && (
        <ServerModSearchModal
          onClose={() => setIsSearchModalOpen(false)}
          onSuccess={() => {
            onToast("Contenido añadido al servidor con éxito.", "success")
            fetchFiles(true)
          }}
          onNavigateToGame={onNavigateToGame}
        />
      )}

      {isSyncModalOpen && syncPlan && (
        <ServerReleaseSyncModal
          theme={theme}
          plan={syncPlan}
          onClose={() => setIsSyncModalOpen(false)}
          onSuccess={() => {
            fetchFiles(true)
          }}
          onToast={onToast}
        />
      )}
    </div>
  )
}

