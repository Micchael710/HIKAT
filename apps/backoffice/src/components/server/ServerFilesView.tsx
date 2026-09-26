import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type {
  ThemeMode,
  ServerFileItem,
  ServerStatus,
  ServerManagedContentItem,
  ServerReleaseSyncPlan,
} from "../../types"
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
  IconSearch,
  IconArrowDown,
} from "../../theme/icons"
import { getThemeTokens } from "../../theme/tokens"
import NewFolderModal from "../game/NewFolderModal"
import RenameModal from "../game/RenameModal"
import { ServerModSearchModal } from "./providers/ServerModSearchModal"
import { ServerReleaseSyncModal } from "./ServerReleaseSyncModal"

interface ServerFilesViewProps {
  theme: ThemeMode
  serverId: string
  serverStatus?: ServerStatus
  onToast: (message: string, type: "success" | "error") => void
  onNavigateToGame?: (handoff?: import("../../types").GameHandoffPayload) => void
}

export default function ServerFilesView({
  theme,
  serverId,
  serverStatus,
  onToast,
  onNavigateToGame,
}: ServerFilesViewProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const isDisconnected = serverStatus === "DISCONNECTED"

  const [currentPath, setCurrentPath] = useState("")
  const [files, setFiles] = useState<ServerFileItem[]>([])
  const [managedContent, setManagedContent] = useState<ServerManagedContentItem[]>([])
  const [syncPlan, setSyncPlan] = useState<ServerReleaseSyncPlan | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selection & Search
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")

  // Clipboard for copy/cut/paste
  const [clipboard, setClipboard] = useState<{
    action: "copy" | "cut"
    sources: Array<{ name: string; relativePath: string; isFile: boolean }>
  } | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    target: ServerFileItem | null
  } | null>(null)

  // Modals state
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ServerFileItem | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<ServerFileItem[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Text editor modal state
  const [editingFile, setEditingFile] = useState<{
    path: string
    name: string
    isNew?: boolean
  } | null>(null)
  const [editorContent, setEditorContent] = useState("")
  const [isEditorLoading, setIsEditorLoading] = useState(false)
  const [isEditorSaving, setIsEditorSaving] = useState(false)

  // Uploading state
  const [isUploading, setIsUploading] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const explorerContainerRef = useRef<HTMLDivElement>(null)
  const isMountedRef = useRef(true)

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener("click", handleClick)
    return () => window.removeEventListener("click", handleClick)
  }, [])

  const fetchFiles = useCallback(
    async (manual: boolean = false) => {
      if (manual) setIsRefreshing(true)
      setError(null)
      try {
        const [filesResult, managedResult, planResult] = await Promise.allSettled([
          serverApi.getServerFiles("SERVER", currentPath || undefined, serverId),
          serverContentApi.getServerManagedContent(serverId),
          serverContentApi.getServerReleaseSyncPlan(serverId),
        ])

        if (isMountedRef.current) {
          if (filesResult.status === "fulfilled") {
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
    },
    [currentPath, serverId],
  )

  useEffect(() => {
    isMountedRef.current = true
    setIsLoading(true)
    fetchFiles()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchFiles])

  // Navigation handlers
  const navigateToFolder = (folderName: string) => {
    setCurrentPath((prev) => (prev ? `${prev}/${folderName}` : folderName))
    setSelectedNames(new Set())
  }

  const navigateToBreadcrumb = (index: number) => {
    setSelectedNames(new Set())
    if (index === -1) {
      setCurrentPath("")
      return
    }
    const segments = currentPath.split("/").filter(Boolean)
    const newPath = segments.slice(0, index + 1).join("/")
    setCurrentPath(newPath)
  }

  const handleGoUp = () => {
    if (!currentPath) return
    setSelectedNames(new Set())
    const segments = currentPath.split("/").filter(Boolean)
    segments.pop()
    setCurrentPath(segments.join("/"))
  }

  // Managed content lookup helper
  const getManagedRecord = useCallback(
    (file: ServerFileItem) => {
      const fullPath = currentPath ? `${currentPath}/${file.name}` : file.name
      const normalized = fullPath.replace(/^\//, "")
      return managedContent.find(
        (m) =>
          m.targetPath === normalized ||
          m.targetPath === fullPath ||
          m.targetPath === `mods/${normalized}` ||
          m.targetPath.endsWith(`/${file.name}`) ||
          m.name === file.name,
      )
    },
    [currentPath, managedContent],
  )

  // Filtered files based on search
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files
    const q = searchQuery.trim().toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, searchQuery])

  // Selection handlers
  const handleItemClick = (e: React.MouseEvent, file: ServerFileItem) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedNames)
      if (next.has(file.name)) {
        next.delete(file.name)
      } else {
        next.add(file.name)
      }
      setSelectedNames(next)
    } else if (e.shiftKey && selectedNames.size > 0) {
      const lastSelected = Array.from(selectedNames).pop()
      const lastIdx = filteredFiles.findIndex((i) => i.name === lastSelected)
      const currentIdx = filteredFiles.findIndex((i) => i.name === file.name)
      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx)
        const end = Math.max(lastIdx, currentIdx)
        const next = new Set(selectedNames)
        for (let i = start; i <= end; i++) {
          next.add(filteredFiles[i].name)
        }
        setSelectedNames(next)
      }
    } else {
      setSelectedNames(new Set([file.name]))
    }
  }

  const handleSelectAll = () => {
    setSelectedNames(new Set(filteredFiles.map((f) => f.name)))
  }

  const handleClearSelection = () => {
    setSelectedNames(new Set())
  }

  // Double click handler
  const handleItemDoubleClick = (file: ServerFileItem) => {
    if (!file.isFile) {
      navigateToFolder(file.name)
    } else if (!file.isSymlink && isAllowlistedTextFile(file.name)) {
      openTextEditor(file)
    }
  }

  // Context menu handler
  const handleContextMenu = (e: React.MouseEvent, file: ServerFileItem | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (file && !selectedNames.has(file.name)) {
      setSelectedNames(new Set([file.name]))
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: file,
    })
  }

  // Rename attempt handler
  const handleAttemptRename = (file: ServerFileItem) => {
    const managed = getManagedRecord(file)
    if (managed) {
      onToast("No se pueden renombrar archivos administrados por HiKAT.", "error")
      return
    }
    setRenameTarget(file)
  }

  // Delete attempt handler
  const handleAttemptDelete = (file: ServerFileItem) => {
    setDeleteTargets([file])
  }

  // Batch delete selected items
  const handleDeleteSelected = () => {
    if (selectedNames.size === 0 || isDisconnected) return
    const items = filteredFiles.filter((f) => selectedNames.has(f.name))
    if (items.length > 0) {
      setDeleteTargets(items)
    }
  }

  // Execute deletion for all items in deleteTargets (handles both managed and regular files)
  const handleExecuteDelete = async () => {
    if (!deleteTargets || isDisconnected) return
    setIsDeleting(true)
    try {
      for (const file of deleteTargets) {
        const targetRelative = currentPath ? `${currentPath}/${file.name}` : file.name
        await serverApi.deleteServerFile("SERVER", targetRelative, serverId)
      }
      onToast(
        deleteTargets.length === 1
          ? "Elemento eliminado exitosamente del servidor."
          : `${deleteTargets.length} elementos eliminados exitosamente del servidor.`,
        "success",
      )
      setSelectedNames((prev) => {
        const next = new Set(prev)
        for (const file of deleteTargets) next.delete(file.name)
        return next
      })
      setDeleteTargets(null)
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al eliminar elementos.",
        "error",
      )
    } finally {
      setIsDeleting(false)
    }
  }

  // Download file
  const handleDownload = async (file: ServerFileItem) => {
    if (isDisconnected) return
    const targetRelative = currentPath ? `${currentPath}/${file.name}` : file.name
    try {
      const res = await serverApi.createServerFileDownloadUrl("SERVER", targetRelative, serverId)
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

  // Upload handler for files & folders
  const handleUploadFiles = async (
    fileList: FileList | null | Array<File | { file: File; relativePath?: string }>,
    stripFirstFolder = false,
  ) => {
    if (!fileList || fileList.length === 0 || isDisconnected) return
    setIsUploading(true)
    try {
      for (let i = 0; i < fileList.length; i++) {
        const item = fileList[i]
        const file = "file" in item ? (item as any).file : (item as File)
        const rel = (item as any).relativePath || (file as any).webkitRelativePath || ""
        let uploadDir = currentPath
        if (rel) {
          let cleanRel = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
          if (stripFirstFolder) {
            const parts = cleanRel.split("/").filter(Boolean)
            cleanRel = parts.length > 1 ? parts.slice(1).join("/") : parts.join("/")
          }
          const parentParts = cleanRel.split("/").filter(Boolean)
          parentParts.pop()
          if (parentParts.length > 0) {
            uploadDir = currentPath ? `${currentPath}/${parentParts.join("/")}` : parentParts.join("/")
          }
        }
        const { url } = await serverApi.prepareServerFileUpload("SERVER", uploadDir, serverId)
        await serverApi.uploadFileToSignedUrl(url, file)
      }
      onToast(
        fileList.length === 1 ? "Archivo subido exitosamente." : `${fileList.length} archivos subidos exitosamente.`,
        "success",
      )
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error al subir archivo.", "error")
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
      if (folderInputRef.current) folderInputRef.current.value = ""
    }
  }

  // Drag and drop handler
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isDisconnected) return
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files, false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Clipboard operations (Copy / Cut / Paste)
  const handleCopy = () => {
    if (selectedNames.size === 0) return
    const items = filteredFiles.filter((f) => selectedNames.has(f.name))
    setClipboard({
      action: "copy",
      sources: items.map((f) => ({
        name: f.name,
        relativePath: currentPath ? `${currentPath}/${f.name}` : f.name,
        isFile: f.isFile,
      })),
    })
    onToast(`${selectedNames.size} elemento(s) copiado(s).`, "success")
  }

  const handleCut = () => {
    if (selectedNames.size === 0 || isDisconnected) return
    const items = filteredFiles.filter((f) => selectedNames.has(f.name))
    setClipboard({
      action: "cut",
      sources: items.map((f) => ({
        name: f.name,
        relativePath: currentPath ? `${currentPath}/${f.name}` : f.name,
        isFile: f.isFile,
      })),
    })
    onToast(`${selectedNames.size} elemento(s) cortado(s).`, "success")
  }

  const handlePaste = async () => {
    if (!clipboard || clipboard.sources.length === 0 || isDisconnected) return
    try {
      if (clipboard.action === "cut") {
        for (const item of clipboard.sources) {
          const newPath = currentPath ? `${currentPath}/${item.name}` : item.name
          if (newPath !== item.relativePath) {
            await serverApi.renameServerFile("SERVER", item.relativePath, item.name, serverId)
          }
        }
        onToast("Elementos movidos exitosamente.", "success")
        setClipboard(null)
      } else {
        for (const item of clipboard.sources) {
          if (item.isFile && isAllowlistedTextFile(item.name)) {
            const fileData = await serverApi.getServerTextFile("SERVER", item.relativePath, serverId)
            const baseParts = item.name.split(".")
            const ext = baseParts.length > 1 ? `.${baseParts.pop()}` : ""
            const base = baseParts.join(".")
            const copyName = `${base}-copia${ext}`
            const destPath = currentPath ? `${currentPath}/${copyName}` : copyName
            await serverApi.writeServerTextFile("SERVER", destPath, fileData.content, serverId)
          }
        }
        onToast("Elementos pegados correctamente.", "success")
      }
      await fetchFiles(true)
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error al pegar elementos.", "error")
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault()
        handleSelectAll()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault()
        handleCopy()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        e.preventDefault()
        handleCut()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault()
        handlePaste()
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNames.size > 0 && !isDisconnected) {
          e.preventDefault()
          handleDeleteSelected()
        }
      } else if (e.key === "F2") {
        if (selectedNames.size === 1 && !isDisconnected) {
          e.preventDefault()
          const name = Array.from(selectedNames)[0]
          const item = filteredFiles.find((f) => f.name === name)
          if (item) handleAttemptRename(item)
        }
      } else if (e.key === "Escape") {
        handleClearSelection()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  // Open text editor
  const openTextEditor = async (file: ServerFileItem) => {
    const targetRelative = currentPath ? `${currentPath}/${file.name}` : file.name
    setEditingFile({ path: targetRelative, name: file.name, isNew: false })
    setIsEditorLoading(true)
    try {
      const res = await serverApi.getServerTextFile("SERVER", targetRelative, serverId)
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
      await serverApi.writeServerTextFile("SERVER", editingFile.path, editorContent, serverId)
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

  // Item icon helper
  const getItemIcon = (file: ServerFileItem) => {
    if (!file.isFile) {
      return (
        <IconFolder
          style={{ width: 20, height: 20, color: isDark ? "#3ec4c0" : "#0284c7", flexShrink: 0 }}
        />
      )
    }
    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`
    if ([".json", ".toml", ".yaml", ".yml", ".cfg", ".properties", ".txt", ".log"].includes(ext)) {
      return <IconFileText style={{ width: 20, height: 20, color: "#38bdf8", flexShrink: 0 }} />
    }
    if (ext === ".jar") {
      return <IconFile style={{ width: 20, height: 20, color: "#eab308", flexShrink: 0 }} />
    }
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      return <IconFile style={{ width: 20, height: 20, color: "#a855f7", flexShrink: 0 }} />
    }
    return <IconFile style={{ width: 20, height: 20, color: tokens.textSecondary, flexShrink: 0 }} />
  }

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return []
    return currentPath.split("/").filter(Boolean)
  }, [currentPath])

  return (
    <div data-testid="server-files-view" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header title */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 700,
            color: tokens.textPrimary,
          }}
        >
          Archivos del servidor
        </h2>
      </div>

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
              <div
                style={{
                  fontSize: "0.82rem",
                  color: isDark ? "#93c5fd" : "#3b82f6",
                  marginTop: 2,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
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
                    ? "Servidor apagado y listo"
                    : syncPlan.serverStatus === "ONLINE" ||
                      syncPlan.serverStatus === "STARTING" ||
                      syncPlan.serverStatus === "STOPPING"
                    ? `${syncPlan.blockReason || "Apaga el servidor antes de aplicar los cambios"}`
                    : syncPlan.serverStatus === "OFFLINE"
                    ? `${syncPlan.blockReason || "No se pudieron verificar los archivos del servidor"}`
                    : `${syncPlan.blockReason || "El servidor no está disponible"}`}
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

      {/* Explorer Card Container */}
      <div
        ref={explorerContainerRef}
        onContextMenu={(e) => handleContextMenu(e, null)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: tokens.bgCard,
          borderRadius: "18px",
          border: `1px solid ${tokens.borderSubtle}`,
          boxShadow: tokens.cardShadow,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Explorer Top Toolbar */}
        <div
          style={{
            padding: "12px 18px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            backgroundColor: tokens.bgCardInner,
          }}
        >
          {/* Left Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="button-open-server-search"
              onClick={() => setIsSearchModalOpen(true)}
              disabled={isDisconnected}
              className="launcher-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "8px 16px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "700",
                opacity: isDisconnected ? 0.5 : 1,
                cursor: isDisconnected ? "not-allowed" : "pointer",
              }}
              title="Buscar e instalar contenido desde Modrinth y CurseForge"
            >
              <IconPlus size={15} />
              <span>Buscar contenido</span>
            </button>

            <button
              type="button"
              onClick={() => setIsNewFolderOpen(true)}
              disabled={isDisconnected}
              className="launcher-btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                opacity: isDisconnected ? 0.5 : 1,
                cursor: isDisconnected ? "not-allowed" : "pointer",
              }}
              title="Crear una nueva carpeta en el directorio actual"
            >
              <IconFolder size={15} />
              <span>Nueva carpeta</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setEditingFile({
                  path: currentPath ? `${currentPath}/nuevo_archivo.txt` : "nuevo_archivo.txt",
                  name: "nuevo_archivo.txt",
                  isNew: true,
                })
              }
              disabled={isDisconnected}
              className="launcher-btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                opacity: isDisconnected ? 0.5 : 1,
                cursor: isDisconnected ? "not-allowed" : "pointer",
              }}
              title="Crear un archivo de texto o configuración"
            >
              <IconFileText size={15} />
              <span>Nuevo archivo</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isDisconnected}
              className="launcher-btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                opacity: isUploading || isDisconnected ? 0.5 : 1,
                cursor: isUploading || isDisconnected ? "not-allowed" : "pointer",
              }}
              title="Subir archivos al directorio actual"
            >
              {isUploading ? <IconSpinner size={15} /> : <IconUpload size={15} />}
              <span>{isUploading ? "Subiendo..." : "Subir archivo"}</span>
            </button>

            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={isUploading || isDisconnected}
              className="launcher-btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                opacity: isUploading || isDisconnected ? 0.5 : 1,
                cursor: isUploading || isDisconnected ? "not-allowed" : "pointer",
              }}
              title="Subir una carpeta completa con su estructura interna"
            >
              <IconFolder size={15} />
              <span>Subir carpeta</span>
            </button>

            {/* Hidden upload inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleUploadFiles(e.target.files, false)}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard browser attribute
              webkitdirectory="true"
              directory=""
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleUploadFiles(e.target.files, true)}
            />
          </div>

          {/* Right Search & Refresh */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
            <div style={{ position: "relative" }}>
              <IconSearch
                style={{
                  position: "absolute",
                  left: "11px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 14,
                  height: 14,
                  color: tokens.textMuted,
                }}
              />
              <input
                type="text"
                placeholder="Buscar en el explorador..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="launcher-input"
                style={{
                  padding: "7px 12px 7px 32px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  width: "220px",
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => fetchFiles(true)}
              disabled={isRefreshing || isDisconnected}
              className="launcher-btn-secondary"
              style={{
                padding: "7px 10px",
                borderRadius: "10px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Recargar archivos"
            >
              <IconRefresh
                style={{
                  width: 16,
                  height: 16,
                  animation: isRefreshing ? "spin 1s linear infinite" : "none",
                }}
              />
            </button>
          </div>
        </div>

        {/* Breadcrumb Navigation Bar */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            backgroundColor: tokens.bgCardInner,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            overflowX: "auto",
          }}
        >
          <button
            type="button"
            onClick={handleGoUp}
            disabled={!currentPath}
            style={{
              background: "none",
              border: "none",
              cursor: currentPath ? "pointer" : "default",
              opacity: currentPath ? 1 : 0.4,
              padding: "4px 8px",
              borderRadius: "6px",
              color: tokens.textSecondary,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            title="Subir un nivel"
          >
            <IconArrowDown size={14} style={{ transform: "rotate(180deg)" }} />
          </button>

          <div
            style={{
              height: "16px",
              width: "1px",
              backgroundColor: tokens.borderSubtle,
              margin: "0 4px",
            }}
          />

          {/* Root item */}
          <button
            type="button"
            role="button"
            aria-label="Archivos del servidor"
            title="Archivos del servidor (Raíz)"
            onClick={() => navigateToBreadcrumb(-1)}
            style={{
              cursor: "pointer",
              fontWeight: breadcrumbs.length === 0 ? "700" : "500",
              color: breadcrumbs.length === 0 ? (isDark ? "#3ec4c0" : "#0c6e6b") : tokens.textSecondary,
              padding: "3px 8px",
              borderRadius: "6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              background: "none",
              border: "none",
            }}
          >
            <IconFolder size={14} />
            <span>Raíz</span>
          </button>

          {breadcrumbs.map((segment, idx) => (
            <React.Fragment key={idx}>
              <span style={{ color: tokens.textMuted }}>/</span>
              <button
                type="button"
                role="button"
                onClick={() => navigateToBreadcrumb(idx)}
                style={{
                  cursor: "pointer",
                  fontWeight: idx === breadcrumbs.length - 1 ? "700" : "500",
                  color: idx === breadcrumbs.length - 1 ? (isDark ? "#3ec4c0" : "#0c6e6b") : tokens.textSecondary,
                  padding: "3px 8px",
                  borderRadius: "6px",
                  background: "none",
                  border: "none",
                }}
              >
                {segment}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Main Files Table Area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          style={{
            minHeight: "340px",
            overflowY: "auto",
            padding: "8px",
            position: "relative",
          }}
        >
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
          ) : isDisconnected ? (
            <div
              style={{
                padding: 48,
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
                Servidor sin conexión
              </h3>
              <p style={{ margin: 0, fontSize: "0.875rem", color: tokens.textMuted }}>
                Los archivos aparecerán aquí cuando el servidor esté conectado.
              </p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div
              style={{
                padding: "48px 16px",
                textAlign: "center",
                color: tokens.textMuted,
              }}
            >
              <IconFolder style={{ width: 48, height: 48, margin: "0 auto 12px auto", opacity: 0.4 }} />
              <div style={{ fontSize: "15px", fontWeight: "600", marginBottom: "4px", color: tokens.textSecondary }}>
                Esta carpeta está vacía
              </div>
              <div style={{ fontSize: "13px" }}>
                {searchQuery ? "No se encontraron elementos con ese filtro." : "Sube un archivo o crea una subcarpeta para comenzar."}
              </div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.borderSubtle}`, color: tokens.textMuted }}>
                  <th style={{ padding: "10px 14px", width: "36px" }}>
                    <input
                      type="checkbox"
                      checked={selectedNames.size === filteredFiles.length && filteredFiles.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) handleSelectAll()
                        else handleClearSelection()
                      }}
                    />
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: "600" }}>Nombre</th>
                  <th style={{ padding: "10px 14px", width: "120px", fontWeight: "600" }}>Tamaño</th>
                  <th style={{ padding: "10px 14px", width: "150px", fontWeight: "600" }}>Modificado</th>
                  <th style={{ padding: "10px 14px", width: "140px", fontWeight: "600", textAlign: "right" }}>
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map((file) => {
                  const isSelected = selectedNames.has(file.name)
                  const isEditable = file.isFile && !file.isSymlink && isAllowlistedTextFile(file.name)
                  const managed = getManagedRecord(file)

                  return (
                    <tr
                      key={file.name}
                      onClick={(e) => handleItemClick(e, file)}
                      onDoubleClick={() => handleItemDoubleClick(file)}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                      style={{
                        cursor: "pointer",
                        userSelect: "none",
                        backgroundColor: isSelected
                          ? isDark
                            ? "rgba(62, 196, 192, 0.15)"
                            : "#e0f2fe"
                          : "transparent",
                        borderBottom: `1px solid ${tokens.borderSubtle}`,
                        transition: "background-color 0.12s ease",
                      }}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>

                      <td style={{ padding: "10px 14px" }}>
                        <div
                          onClick={(e) => {
                            if (!file.isFile) {
                              e.stopPropagation()
                              navigateToFolder(file.name)
                            }
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            flexWrap: "wrap",
                            cursor: !file.isFile ? "pointer" : "default",
                          }}
                        >
                          {getItemIcon(file)}
                          <span
                            style={{
                              fontWeight: !file.isFile ? "600" : "400",
                              color: tokens.textPrimary,
                            }}
                          >
                            {file.name}
                          </span>

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

                      <td style={{ padding: "10px 14px", color: tokens.textSecondary, fontFamily: "monospace" }}>
                        {file.isFile ? formatBytesToHuman(file.sizeBytes) : "—"}
                      </td>

                      <td style={{ padding: "10px 14px", color: tokens.textMuted }}>
                        {file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : "—"}
                      </td>

                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          {isEditable && (
                            <button
                              type="button"
                              title="Editar texto"
                              onClick={(e) => {
                                e.stopPropagation()
                                openTextEditor(file)
                              }}
                              className="launcher-btn-secondary"
                              style={{
                                padding: "5px 7px",
                                borderRadius: 8,
                                color: isDark ? "#3ec4c0" : "#0f766e",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}

                          {file.isFile && !file.isSymlink && (
                            <button
                              type="button"
                              title="Descargar"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownload(file)
                              }}
                              className="launcher-btn-secondary"
                              style={{
                                padding: "5px 7px",
                                borderRadius: 8,
                                color: isDark ? "#60a5fa" : "#2563eb",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <IconDownload size={15} />
                            </button>
                          )}

                          <button
                            type="button"
                            title={managed ? "No se pueden renombrar archivos administrados por HiKAT" : "Renombrar"}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAttemptRename(file)
                            }}
                            disabled={!!managed || isDisconnected}
                            className="launcher-btn-secondary"
                            style={{
                              padding: "5px 7px",
                              borderRadius: 8,
                              color: managed
                                ? isDark
                                  ? "rgba(255,255,255,0.2)"
                                  : "#cbd5e1"
                                : isDark
                                ? "rgba(255,255,255,0.7)"
                                : "#475569",
                              cursor: managed || isDisconnected ? "not-allowed" : "pointer",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <IconEdit size={15} />
                          </button>

                          <button
                            type="button"
                            title="Eliminar"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAttemptDelete(file)
                            }}
                            disabled={isDisconnected}
                            className="launcher-btn-secondary"
                            style={{
                              padding: "5px 7px",
                              borderRadius: 8,
                              color: "#ef4444",
                              cursor: isDisconnected ? "not-allowed" : "pointer",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Explorer Footer Status Bar */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: `1px solid ${tokens.borderSubtle}`,
            backgroundColor: tokens.bgCardInner,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12.5px",
            color: tokens.textMuted,
          }}
        >
          <div>
            {filteredFiles.length} elemento(s) en esta carpeta
            {selectedNames.size > 0 && ` | ${selectedNames.size} seleccionado(s)`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {selectedNames.size > 0 && !isDisconnected && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "none",
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#ef4444",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                <IconTrash size={12} />
                <span>Eliminar selección</span>
              </button>
            )}
            {clipboard && (
              <span style={{ color: isDark ? "#3ec4c0" : "#0c6e6b", fontWeight: "600" }}>
                Portapapeles: {clipboard.sources.length} elemento(s) para{" "}
                {clipboard.action === "copy" ? "copiar" : "mover"}
              </span>
            )}
          </div>
        </div>

        {/* Custom Context Menu */}
        {contextMenu && (
          <div
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: tokens.bgCard,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: "12px",
              boxShadow: tokens.dropdownShadow,
              padding: "6px",
              zIndex: 100,
              minWidth: "180px",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.target ? (
              <>
                {!contextMenu.target.isFile ? (
                  <button
                    type="button"
                    onClick={() => {
                      navigateToFolder(contextMenu.target!.name)
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconFolder style={{ width: 14, height: 14 }} />
                    <span>Abrir carpeta</span>
                  </button>
                ) : isAllowlistedTextFile(contextMenu.target.name) ? (
                  <button
                    type="button"
                    onClick={() => {
                      openTextEditor(contextMenu.target!)
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconFileText style={{ width: 14, height: 14 }} />
                    <span>Editar archivo</span>
                  </button>
                ) : null}

                {contextMenu.target.isFile && !contextMenu.target.isSymlink && (
                  <button
                    type="button"
                    onClick={() => {
                      handleDownload(contextMenu.target!)
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconDownload style={{ width: 14, height: 14 }} />
                    <span>Descargar</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    handleAttemptRename(contextMenu.target!)
                    setContextMenu(null)
                  }}
                  disabled={Boolean(getManagedRecord(contextMenu.target!))}
                  style={{
                    ...contextMenuItemStyle(isDark),
                    opacity: getManagedRecord(contextMenu.target!) ? 0.5 : 1,
                    cursor: getManagedRecord(contextMenu.target!) ? "not-allowed" : "pointer",
                  }}
                >
                  <IconEdit style={{ width: 14, height: 14 }} />
                  <span>Renombrar (F2)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleCopy()
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconFile style={{ width: 14, height: 14 }} />
                  <span>Copiar (Ctrl+C)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleCut()
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconEdit style={{ width: 14, height: 14 }} />
                  <span>Cortar (Ctrl+X)</span>
                </button>

                <div style={{ height: "1px", backgroundColor: tokens.borderSubtle, margin: "4px 0" }} />

                <button
                  type="button"
                  onClick={() => {
                    handleAttemptDelete(contextMenu.target!)
                    setContextMenu(null)
                  }}
                  style={{ ...contextMenuItemStyle(isDark), color: "#ef4444" }}
                >
                  <IconTrash style={{ width: 14, height: 14 }} />
                  <span>Eliminar (Supr)</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewFolderOpen(true)
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconFolder style={{ width: 14, height: 14, color: "#3ec4c0" }} />
                  <span>Nueva carpeta</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditingFile({
                      path: currentPath ? `${currentPath}/nuevo_archivo.txt` : "nuevo_archivo.txt",
                      name: "nuevo_archivo.txt",
                      isNew: true,
                    })
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconFileText style={{ width: 14, height: 14, color: "#10b981" }} />
                  <span>Nuevo archivo</span>
                </button>

                {clipboard && (
                  <button
                    type="button"
                    onClick={() => {
                      handlePaste()
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconFile style={{ width: 14, height: 14 }} />
                    <span>Pegar ({clipboard.sources.length})</span>
                  </button>
                )}

                <div style={{ height: "1px", backgroundColor: tokens.borderSubtle, margin: "4px 0" }} />

                <button
                  type="button"
                  onClick={() => {
                    fileInputRef.current?.click()
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconUpload style={{ width: 14, height: 14 }} />
                  <span>Subir archivos</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    folderInputRef.current?.click()
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconFolder style={{ width: 14, height: 14 }} />
                  <span>Subir carpeta</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    fetchFiles(true)
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconRefresh style={{ width: 14, height: 14 }} />
                  <span>Recargar</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* New Folder Modal (Reused from game) */}
      {isNewFolderOpen && (
        <NewFolderModal
          theme={theme}
          currentPath={currentPath}
          onClose={() => setIsNewFolderOpen(false)}
          onSubmit={async (folderName: string) => {
            await serverApi.createServerFolder("SERVER", currentPath, folderName, serverId)
            onToast("Carpeta creada exitosamente.", "success")
            await fetchFiles(true)
          }}
        />
      )}

      {/* Rename Modal (Reused from game) */}
      {renameTarget && (
        <RenameModal
          theme={theme}
          oldName={renameTarget.name}
          isDirectory={!renameTarget.isFile}
          onClose={() => setRenameTarget(null)}
          onSubmit={async (newName: string) => {
            const targetRelative = currentPath ? `${currentPath}/${renameTarget.name}` : renameTarget.name
            await serverApi.renameServerFile("SERVER", targetRelative, newName, serverId)
            onToast("Elemento renombrado exitosamente.", "success")
            await fetchFiles(true)
          }}
        />
      )}

      {/* Unified Delete Confirmation Modal for Server Files */}
      {deleteTargets && (() => {
        const count = deleteTargets.length
        const isSingle = count === 1

        return (
          <div
            data-testid="modal-delete-confirm"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 20,
              boxSizing: "border-box",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDeleting) setDeleteTargets(null)
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 520,
                backgroundColor: tokens.bgCard,
                borderRadius: 18,
                border: `1px solid ${tokens.borderSubtle}`,
                boxShadow: tokens.cardShadowLg,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: "18px 20px",
                  borderBottom: `1px solid ${tokens.borderSubtle}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: tokens.bgCardInner,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconTrash style={{ width: 20, height: 20, color: "#ef4444" }} />
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: tokens.textPrimary }}>
                    {isSingle ? "Eliminar elemento" : `Eliminar ${count} elementos`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => !isDeleting && setDeleteTargets(null)}
                  disabled={isDeleting}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: tokens.textMuted,
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    padding: 4,
                    display: "flex",
                  }}
                >
                  <IconCross size={18} />
                </button>
              </div>

              {/* Modal Content */}
              <div style={{ padding: 20 }}>
                <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: tokens.textSecondary, lineHeight: 1.5 }}>
                  {isSingle ? (
                    <>
                      ¿Estás seguro de que deseas eliminar <strong>{deleteTargets[0].name}</strong> del servidor? Si es una carpeta, se eliminarán todos los archivos y subcarpetas que contiene.
                    </>
                  ) : (
                    <>
                      ¿Estás seguro de que deseas eliminar los siguientes <strong>{count}</strong> elementos del servidor? Esta acción no se puede deshacer.
                    </>
                  )}
                </p>

                {/* Bullet list of items to delete */}
                <div
                  style={{
                    maxHeight: 160,
                    overflowY: "auto",
                    padding: "10px 14px",
                    backgroundColor: tokens.bgCardInner,
                    borderRadius: 10,
                    border: `1px solid ${tokens.borderSubtle}`,
                    marginBottom: 20,
                    fontSize: "12px",
                    fontFamily: "monospace",
                    color: tokens.textSecondary,
                  }}
                  className="custom-scroll"
                >
                  {deleteTargets.map((file) => (
                    <div
                      key={file.name}
                      style={{
                        padding: "3px 0",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      • {file.name}
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDeleteTargets(null)}
                    className="launcher-btn-secondary"
                    disabled={isDeleting}
                    style={{
                      padding: "10px 18px",
                      borderRadius: "12px",
                      fontSize: "14px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    data-testid="button-force-delete-from-server"
                    onClick={handleExecuteDelete}
                    disabled={isDeleting}
                    className="launcher-btn-danger"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 20px",
                      borderRadius: "12px",
                      fontSize: "14px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isDeleting && <IconSpinner size={16} />}
                    <span>Eliminar definitivamente</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

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
            zIndex: 900,
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
                <IconFileText size={22} style={{ color: "#3ec4c0" }} />
                {editingFile.isNew ? (
                  <input
                    type="text"
                    value={editingFile.name}
                    onChange={(e) => {
                      const val = e.target.value
                      setEditingFile((prev) =>
                        prev
                          ? {
                              ...prev,
                              name: val,
                              path: currentPath ? `${currentPath}/${val}` : val,
                            }
                          : null,
                      )
                    }}
                    placeholder="nombre_archivo.txt"
                    className="launcher-input"
                    style={{
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontSize: "1rem",
                      fontWeight: 700,
                    }}
                  />
                ) : (
                  <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: tokens.textPrimary }}>
                    {editingFile.name}
                  </h3>
                )}
              </div>

              <button
                type="button"
                onClick={() => !isEditorSaving && setEditingFile(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: tokens.textMuted,
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            {isEditorLoading ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  color: "#3ec4c0",
                }}
              >
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
                className="launcher-btn-secondary"
              >
                Cerrar
              </button>

              <button
                type="button"
                onClick={handleSaveTextEditor}
                disabled={isEditorSaving || isEditorLoading}
                className="launcher-btn-primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isEditorSaving ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                <span>{isEditorSaving ? "Guardando..." : "Guardar cambios"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shard 08D Search & Sync Modals */}
      {isSearchModalOpen && (
        <ServerModSearchModal
          serverId={serverId}
          theme={theme}
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
          serverId={serverId}
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

function contextMenuItemStyle(isDark: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "none",
    background: "none",
    width: "100%",
    textAlign: "left",
    fontSize: "13px",
    fontWeight: "500",
    color: isDark ? "#f1f5f9" : "#0f172a",
    cursor: "pointer",
    transition: "background-color 0.12s ease",
  }
}
