import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { ThemeMode, AdminGameFile, SyncPolicy } from "../../types"
import { gameApi } from "../../services/graphqlClient"
import {
  formatBytesToHuman,
  isEditableTextFile,
  inferGameCategory,
  GAME_TEXT_FILE_EXTENSIONS,
} from "@hikat/shared"
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
  IconSearch,
} from "../../theme/icons"
import TextFileEditorModal from "./TextFileEditorModal"
import NewFolderModal from "./NewFolderModal"
import RenameModal from "./RenameModal"
import PolicyModal from "./PolicyModal"
import ConfirmDeleteModal from "./ConfirmDeleteModal"

interface GameFilesExplorerProps {
  theme: ThemeMode
  files: AdminGameFile[]
  isDraft: boolean
  onRefresh: () => Promise<void>
  onToast: (message: string, type: "success" | "error") => void
  onPrepareDraft?: () => void
}

interface ExplorerItem {
  id: string
  name: string
  logicalPath: string
  isDirectory: boolean
  sizeBytes: number
  category: string
  sha256: string
  policy: SyncPolicy
  explicitPolicy: SyncPolicy | null
  effectivePolicy: SyncPolicy
  isInherited: boolean
  changeStatus?: string | null
  rawFile?: AdminGameFile
}

export default function GameFilesExplorer({
  theme,
  files,
  isDraft,
  onRefresh,
  onToast,
  onPrepareDraft,
}: GameFilesExplorerProps) {
  const isDark = theme === "dark"
  const [currentPath, setCurrentPath] = useState("")
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Clipboard (Copy / Cut / Paste)
  const [clipboard, setClipboard] = useState<{
    action: "copy" | "cut"
    sources: string[]
  } | null>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    target: ExplorerItem | null
  } | null>(null)

  // Modals
  const [editorModal, setEditorModal] = useState<{
    isOpen: boolean
    file?: AdminGameFile
    isNew?: boolean
    initialPath?: string
    logicalPath?: string
  } | null>(null)

  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ExplorerItem | null>(null)
  const [policyTarget, setPolicyTarget] = useState<ExplorerItem | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null)

  // Uploading state
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    current: number
    total: number
    filename: string
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const explorerContainerRef = useRef<HTMLDivElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener("click", handleClick)
    return () => window.removeEventListener("click", handleClick)
  }, [])

  // Build the unified virtual tree for currentPath
  const currentItems = useMemo(() => {
    const itemMap = new Map<string, ExplorerItem>()

    const normCurrent = currentPath ? `${currentPath}/` : ""

    for (const f of files) {
      const p = f.logicalPath

      // Direct match in current directory
      if (!currentPath) {
        if (!p.includes("/")) {
          itemMap.set(p, {
            id: f.id,
            name: f.name || p,
            logicalPath: p,
            isDirectory: f.isDirectory,
            sizeBytes: f.sizeBytes,
            category: f.category,
            sha256: f.sha256,
            policy: f.policy,
            explicitPolicy: f.explicitPolicy ?? null,
            effectivePolicy: f.effectivePolicy,
            isInherited: f.isInherited,
            changeStatus: f.changeStatus,
            rawFile: f,
          })
        } else {
          // Top-level folder
          const topFolder = p.split("/")[0]
          if (!itemMap.has(topFolder)) {
            itemMap.set(topFolder, {
              id: `virtual-folder-${topFolder}`,
              name: topFolder,
              logicalPath: topFolder,
              isDirectory: true,
              sizeBytes: 0,
              category: inferGameCategory(topFolder),
              sha256: "",
              policy: "NO_MODIFICABLE",
              explicitPolicy: null,
              effectivePolicy: topFolder === "config" || topFolder === "resourcepacks" || topFolder === "shaderpacks" ? "MODIFICABLE" : "NO_MODIFICABLE",
              isInherited: true,
            })
          }
        }
      } else {
        if (p.startsWith(normCurrent)) {
          const sub = p.slice(normCurrent.length)
          if (!sub.includes("/")) {
            // Direct child file or folder
            itemMap.set(p, {
              id: f.id,
              name: f.name || sub,
              logicalPath: p,
              isDirectory: f.isDirectory,
              sizeBytes: f.sizeBytes,
              category: f.category,
              sha256: f.sha256,
              policy: f.policy,
              explicitPolicy: f.explicitPolicy ?? null,
              effectivePolicy: f.effectivePolicy,
              isInherited: f.isInherited,
              changeStatus: f.changeStatus,
              rawFile: f,
            })
          } else {
            // Direct subfolder
            const folderSegment = sub.split("/")[0]
            const folderPath = `${currentPath}/${folderSegment}`
            if (!itemMap.has(folderPath)) {
              itemMap.set(folderPath, {
                id: `virtual-folder-${folderPath}`,
                name: folderSegment,
                logicalPath: folderPath,
                isDirectory: true,
                sizeBytes: 0,
                category: inferGameCategory(folderPath),
                sha256: "",
                policy: "NO_MODIFICABLE",
                explicitPolicy: null,
                effectivePolicy: folderPath.startsWith("config") ? "MODIFICABLE" : "NO_MODIFICABLE",
                isInherited: true,
              })
            }
          }
        }
      }
    }

    let result = Array.from(itemMap.values())

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.logicalPath.toLowerCase().includes(q),
      )
    }

    // Sort: directories first, then alphabetically
    result.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      }
      return a.isDirectory ? -1 : 1
    })

    return result
  }, [files, currentPath, searchQuery])

  // Navigation handlers
  const handleOpenFolder = (folderPath: string) => {
    setCurrentPath(folderPath)
    setSelectedPaths(new Set())
  }

  const handleNavigateBreadcrumb = (index: number) => {
    if (index === -1) {
      setCurrentPath("")
      setSelectedPaths(new Set())
      return
    }
    const segments = currentPath.split("/").filter(Boolean)
    const newPath = segments.slice(0, index + 1).join("/")
    setCurrentPath(newPath)
    setSelectedPaths(new Set())
  }

  const handleGoUp = () => {
    if (!currentPath) return
    const segments = currentPath.split("/").filter(Boolean)
    segments.pop()
    setCurrentPath(segments.join("/"))
    setSelectedPaths(new Set())
  }

  // Selection handlers
  const handleItemClick = (e: React.MouseEvent, item: ExplorerItem) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedPaths)
      if (next.has(item.logicalPath)) {
        next.delete(item.logicalPath)
      } else {
        next.add(item.logicalPath)
      }
      setSelectedPaths(next)
    } else if (e.shiftKey && selectedPaths.size > 0) {
      const lastSelected = Array.from(selectedPaths).pop()
      const lastIdx = currentItems.findIndex((i) => i.logicalPath === lastSelected)
      const currentIdx = currentItems.findIndex((i) => i.logicalPath === item.logicalPath)
      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx)
        const end = Math.max(lastIdx, currentIdx)
        const next = new Set(selectedPaths)
        for (let i = start; i <= end; i++) {
          next.add(currentItems[i].logicalPath)
        }
        setSelectedPaths(next)
      }
    } else {
      setSelectedPaths(new Set([item.logicalPath]))
    }
  }

  const handleSelectAll = () => {
    setSelectedPaths(new Set(currentItems.map((i) => i.logicalPath)))
  }

  const handleClearSelection = () => {
    setSelectedPaths(new Set())
  }

  // Double click handler
  const handleItemDoubleClick = (item: ExplorerItem) => {
    if (item.isDirectory) {
      handleOpenFolder(item.logicalPath)
    } else if (item.rawFile) {
      if (isEditableTextFile(item.name) || item.sizeBytes <= 1024 * 1024) {
        setEditorModal({
          isOpen: true,
          file: item.rawFile,
          logicalPath: item.logicalPath,
        })
      }
    }
  }

  // Right-click context menu
  const handleContextMenu = (e: React.MouseEvent, item: ExplorerItem | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (item && !selectedPaths.has(item.logicalPath)) {
      setSelectedPaths(new Set([item.logicalPath]))
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: item,
    })
  }

  // Clipboard operations (Copy / Cut / Paste)
  const handleCopy = () => {
    if (selectedPaths.size === 0) return
    setClipboard({
      action: "copy",
      sources: Array.from(selectedPaths),
    })
    onToast(`${selectedPaths.size} elemento(s) copiado(s).`, "success")
  }

  const handleCut = () => {
    if (selectedPaths.size === 0 || !isDraft) return
    setClipboard({
      action: "cut",
      sources: Array.from(selectedPaths),
    })
    onToast(`${selectedPaths.size} elemento(s) cortado(s).`, "success")
  }

  const handlePaste = async () => {
    if (!clipboard || !isDraft) return
    try {
      if (clipboard.action === "copy") {
        await gameApi.copyGamePaths(clipboard.sources, currentPath)
        onToast("Elementos pegados correctamente.", "success")
      } else {
        await gameApi.moveGamePaths(clipboard.sources, currentPath)
        onToast("Elementos movidos correctamente.", "success")
        setClipboard(null)
      }
      await onRefresh()
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error al pegar elementos.", "error")
    }
  }

  // Delete handler
  const handleDeleteSelected = () => {
    if (selectedPaths.size === 0 || !isDraft) return
    setDeleteTargets(Array.from(selectedPaths))
  }

  // Rename handler
  const handleRenameSelected = () => {
    if (selectedPaths.size !== 1 || !isDraft) return
    const targetPath = Array.from(selectedPaths)[0]
    const item = currentItems.find((i) => i.logicalPath === targetPath)
    if (item) setRenameTarget(item)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if inside an input/textarea
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
        if (selectedPaths.size > 0 && isDraft) {
          e.preventDefault()
          handleDeleteSelected()
        }
      } else if (e.key === "F2") {
        if (selectedPaths.size === 1 && isDraft) {
          e.preventDefault()
          handleRenameSelected()
        }
      } else if (e.key === "Escape") {
        handleClearSelection()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  // Binary upload handler
  const handleUploadFiles = async (fileList: FileList | null, preserveRelativePaths = false) => {
    if (!fileList || fileList.length === 0 || !isDraft) return
    setIsUploading(true)
    const filesToUpload = Array.from(fileList)

    try {
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i]
        setUploadProgress({
          current: i + 1,
          total: filesToUpload.length,
          filename: file.name,
        })

        // Determine destination logical path
        let targetLogicalPath: string
        const webkitPath = (file as any).webkitRelativePath as string | undefined

        if (preserveRelativePaths && webkitPath) {
          targetLogicalPath = currentPath ? `${currentPath}/${webkitPath}` : webkitPath
        } else {
          targetLogicalPath = currentPath ? `${currentPath}/${file.name}` : file.name
        }

        const category = inferGameCategory(targetLogicalPath)

        // 1. Request upload ticket
        const ticket = await gameApi.createGameFileUpload({
          category,
          originalFilename: file.name,
          logicalPath: targetLogicalPath,
          sizeBytes: file.size,
        })

        // 2. Upload binary payload
        const uploaded = await gameApi.uploadGameBinary(
          file,
          ticket.uploadUrl,
          ticket.uploadToken,
        )

        // 3. Add game file to active draft
        await gameApi.addGameFile({
          name: file.name,
          category,
          logicalPath: targetLogicalPath,
          tokenHash: uploaded.tokenHash,
        })
      }

      onToast(`${filesToUpload.length} archivo(s) subido(s) exitosamente.`, "success")
      await onRefresh()
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error durante la subida.", "error")
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      if (folderInputRef.current) folderInputRef.current.value = ""
    }
  }

  // Drag and drop handler
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDraft) return

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files, false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Helper for item icon
  const getItemIcon = (item: ExplorerItem) => {
    if (item.isDirectory) {
      return <IconFolder style={{ width: 20, height: 20, color: "#3b82f6", flexShrink: 0 }} />
    }
    const ext = `.${item.name.split(".").pop()?.toLowerCase()}`
    if ([".json", ".toml", ".yaml", ".yml", ".cfg", ".properties", ".txt"].includes(ext)) {
      return <IconFileText style={{ width: 20, height: 20, color: "#10b981", flexShrink: 0 }} />
    }
    if (ext === ".jar") {
      return <span style={{ fontSize: "18px", flexShrink: 0 }}>📦</span>
    }
    if ([".png", ".jpg", ".jpeg"].includes(ext)) {
      return <span style={{ fontSize: "18px", flexShrink: 0 }}>🖼️</span>
    }
    if (ext === ".zip") {
      return <span style={{ fontSize: "18px", flexShrink: 0 }}>🗜️</span>
    }
    return <IconFile style={{ width: 20, height: 20, color: "#94a3b8", flexShrink: 0 }} />
  }

  const breadcrumbSegments = currentPath.split("/").filter(Boolean)

  return (
    <div
      ref={explorerContainerRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: isDark ? "#0f172a" : "#ffffff",
        border: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)",
      }}
    >
      {/* Hidden file & folder inputs */}
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
        multiple
        {...({ webkitdirectory: "", directory: "" } as any)}
        style={{ display: "none" }}
        onChange={(e) => handleUploadFiles(e.target.files, true)}
      />

      {/* Read-Only Published Banner */}
      {!isDraft && (
        <div
          style={{
            padding: "12px 20px",
            backgroundColor: isDark ? "rgba(59, 130, 246, 0.12)" : "#eff6ff",
            borderBottom: `1px solid ${isDark ? "#1e3a8a" : "#bfdbfe"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px" }}>🔒</span>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "600", color: isDark ? "#93c5fd" : "#1d4ed8" }}>
                Modo Solo Lectura (Versión Publicada)
              </div>
              <div style={{ fontSize: "12px", color: isDark ? "#60a5fa" : "#3b82f6" }}>
                Para realizar modificaciones, crear carpetas o subir archivos, prepara una nueva actualización.
              </div>
            </div>
          </div>
          {onPrepareDraft && (
            <button
              type="button"
              onClick={onPrepareDraft}
              style={{
                padding: "8px 16px",
                backgroundColor: "#3b82f6",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>🛠️ Preparar Actualización</span>
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
          backgroundColor: isDark ? "#0b1120" : "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        {/* Left Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {isDraft && (
            <>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  backgroundColor: isDark ? "#1e293b" : "#ffffff",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  borderRadius: "8px",
                  color: isDark ? "#f8fafc" : "#0f172a",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                <IconFolder style={{ width: 15, height: 15, color: "#3b82f6" }} />
                <span>Nueva Carpeta</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setEditorModal({
                    isOpen: true,
                    isNew: true,
                    initialPath: currentPath ? `${currentPath}/nuevo_archivo.txt` : "nuevo_archivo.txt",
                  })
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  backgroundColor: isDark ? "#1e293b" : "#ffffff",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  borderRadius: "8px",
                  color: isDark ? "#f8fafc" : "#0f172a",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                <IconFileText style={{ width: 15, height: 15, color: "#10b981" }} />
                <span>Nuevo Archivo</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  backgroundColor: "#3b82f6",
                  border: "none",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: isUploading ? "not-allowed" : "pointer",
                }}
              >
                <IconUpload style={{ width: 15, height: 15 }} />
                <span>Subir Archivos</span>
              </button>

              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isUploading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  backgroundColor: isDark ? "#1e293b" : "#ffffff",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  borderRadius: "8px",
                  color: isDark ? "#f8fafc" : "#0f172a",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: isUploading ? "not-allowed" : "pointer",
                }}
              >
                <IconFolder style={{ width: 15, height: 15, color: "#f59e0b" }} />
                <span>Subir Carpeta</span>
              </button>
            </>
          )}

          {selectedPaths.size > 0 && isDraft && (
            <>
              <div style={{ width: "1px", height: "24px", backgroundColor: isDark ? "#334155" : "#cbd5e1", margin: "0 4px" }} />
              <button
                type="button"
                onClick={handleDeleteSelected}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid #ef4444",
                  borderRadius: "8px",
                  color: "#ef4444",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                <IconTrash style={{ width: 15, height: 15 }} />
                <span>Eliminar ({selectedPaths.size})</span>
              </button>
            </>
          )}
        </div>

        {/* Right Search & Refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ position: "relative" }}>
            <IconSearch
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "14px",
                height: "14px",
                color: isDark ? "#64748b" : "#94a3b8",
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar en esta carpeta..."
              style={{
                padding: "6px 12px 6px 32px",
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                borderRadius: "8px",
                color: isDark ? "#f8fafc" : "#0f172a",
                fontSize: "13px",
                width: "220px",
                outline: "none",
              }}
            />
          </div>

          <button
            type="button"
            onClick={async () => {
              setIsRefreshing(true)
              await onRefresh()
              setIsRefreshing(false)
            }}
            disabled={isRefreshing}
            style={{
              padding: "7px 10px",
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
              borderRadius: "8px",
              color: isDark ? "#cbd5e1" : "#475569",
              cursor: isRefreshing ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
            }}
            title="Refrescar vista"
          >
            {isRefreshing ? <IconSpinner style={{ width: 16, height: 16 }} /> : <IconRefresh style={{ width: 16, height: 16 }} />}
          </button>
        </div>
      </div>

      {/* Breadcrumbs Navigation Bar */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
          backgroundColor: isDark ? "#0f172a" : "#ffffff",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          overflowX: "auto",
        }}
      >
        <button
          type="button"
          onClick={handleGoUp}
          disabled={!currentPath}
          style={{
            background: "transparent",
            border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
            borderRadius: "6px",
            padding: "4px 8px",
            color: !currentPath ? (isDark ? "#475569" : "#cbd5e1") : isDark ? "#cbd5e1" : "#475569",
            cursor: !currentPath ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "600",
          }}
          title="Subir un nivel"
        >
          ⬆️
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
          <button
            type="button"
            onClick={() => handleNavigateBreadcrumb(-1)}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 8px",
              borderRadius: "4px",
              color: !currentPath ? (isDark ? "#f8fafc" : "#0f172a") : "#3b82f6",
              fontWeight: !currentPath ? "700" : "500",
              cursor: "pointer",
            }}
          >
            🏠 Raíz
          </button>

          {breadcrumbSegments.map((seg, idx) => {
            const isLast = idx === breadcrumbSegments.length - 1
            return (
              <React.Fragment key={idx}>
                <span style={{ color: isDark ? "#475569" : "#94a3b8" }}>/</span>
                <button
                  type="button"
                  onClick={() => handleNavigateBreadcrumb(idx)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    color: isLast ? (isDark ? "#f8fafc" : "#0f172a") : "#3b82f6",
                    fontWeight: isLast ? "700" : "500",
                    cursor: isLast ? "default" : "pointer",
                  }}
                >
                  {seg}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Upload progress banner */}
      {isUploading && uploadProgress && (
        <div
          style={{
            padding: "10px 20px",
            backgroundColor: isDark ? "rgba(59, 130, 246, 0.15)" : "#eff6ff",
            borderBottom: "1px solid #3b82f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "13px",
            color: isDark ? "#93c5fd" : "#1d4ed8",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <IconSpinner style={{ width: 16, height: 16 }} />
            <span>
              Subiendo ({uploadProgress.current}/{uploadProgress.total}): <strong>{uploadProgress.filename}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Explorer Content Body */}
      <div
        onContextMenu={(e) => handleContextMenu(e, null)}
        style={{
          minHeight: "420px",
          maxHeight: "600px",
          overflowY: "auto",
          padding: "8px",
          backgroundColor: isDark ? "#0a0f1d" : "#f8fafc",
        }}
      >
        {currentItems.length === 0 ? (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
              color: isDark ? "#64748b" : "#94a3b8",
            }}
          >
            <IconFolder style={{ width: 48, height: 48, margin: "0 auto 12px auto", opacity: 0.4 }} />
            <div style={{ fontSize: "15px", fontWeight: "600", marginBottom: "4px" }}>
              Esta carpeta está vacía
            </div>
            <div style={{ fontSize: "13px" }}>
              {isDraft
                ? "Arrastra y suelta archivos aquí o usa los botones de la barra superior."
                : "No hay archivos en este directorio para la versión seleccionada."}
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`, color: isDark ? "#64748b" : "#94a3b8" }}>
                <th style={{ padding: "8px 12px", width: "36px" }}>
                  <input
                    type="checkbox"
                    checked={selectedPaths.size === currentItems.length && currentItems.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) handleSelectAll()
                      else handleClearSelection()
                    }}
                  />
                </th>
                <th style={{ padding: "8px 12px" }}>Nombre</th>
                <th style={{ padding: "8px 12px", width: "120px" }}>Tamaño</th>
                <th style={{ padding: "8px 12px", width: "160px" }}>Sincronización</th>
                <th style={{ padding: "8px 12px", width: "130px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((item) => {
                const isSelected = selectedPaths.has(item.logicalPath)
                return (
                  <tr
                    key={item.logicalPath}
                    onClick={(e) => handleItemClick(e, item)}
                    onDoubleClick={() => handleItemDoubleClick(item)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    style={{
                      cursor: "pointer",
                      userSelect: "none",
                      backgroundColor: isSelected
                        ? isDark
                          ? "rgba(59, 130, 246, 0.2)"
                          : "#dbeafe"
                        : "transparent",
                      borderBottom: `1px solid ${isDark ? "#141c2e" : "#f1f5f9"}`,
                      transition: "background-color 0.1s ease",
                    }}
                  >
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>

                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {getItemIcon(item)}
                        <span
                          style={{
                            fontWeight: item.isDirectory ? "600" : "400",
                            color: isDark ? "#f8fafc" : "#0f172a",
                          }}
                        >
                          {item.name}
                        </span>
                      </div>
                    </td>

                    <td style={{ padding: "10px 12px", color: isDark ? "#94a3b8" : "#64748b", fontFamily: "monospace" }}>
                      {item.isDirectory ? "—" : formatBytesToHuman(item.sizeBytes)}
                    </td>

                    <td style={{ padding: "10px 12px" }}>
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isDraft) setPolicyTarget(item)
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "500",
                          backgroundColor:
                            item.effectivePolicy === "NO_MODIFICABLE"
                              ? isDark
                                ? "rgba(239, 68, 68, 0.15)"
                                : "#fee2e2"
                              : isDark
                              ? "rgba(16, 185, 129, 0.15)"
                              : "#d1fae5",
                          color:
                            item.effectivePolicy === "NO_MODIFICABLE"
                              ? isDark
                                ? "#f87171"
                                : "#dc2626"
                              : isDark
                              ? "#34d399"
                              : "#059669",
                          cursor: isDraft ? "pointer" : "default",
                        }}
                        title={
                          item.explicitPolicy
                            ? `Override explícito: ${item.effectivePolicy}`
                            : `Heredado de la jerarquía: ${item.effectivePolicy}`
                        }
                      >
                        <span>{item.effectivePolicy === "NO_MODIFICABLE" ? "🔒 Protegido" : "✏️ Personalizable"}</span>
                        {item.explicitPolicy && (
                          <span style={{ fontSize: "10px", opacity: 0.75 }}>★</span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: "10px 12px" }}>
                      {item.changeStatus && item.changeStatus !== "UNCHANGED" ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: "600",
                            backgroundColor:
                              item.changeStatus === "ADDED"
                                ? isDark
                                  ? "rgba(34, 197, 94, 0.2)"
                                  : "#dcfce7"
                                : item.changeStatus === "UPDATED"
                                ? isDark
                                  ? "rgba(59, 130, 246, 0.2)"
                                  : "#dbeafe"
                                : isDark
                                ? "rgba(239, 68, 68, 0.2)"
                                : "#fee2e2",
                            color:
                              item.changeStatus === "ADDED"
                                ? "#22c55e"
                                : item.changeStatus === "UPDATED"
                                ? "#3b82f6"
                                : "#ef4444",
                          }}
                        >
                          {item.changeStatus === "ADDED"
                            ? "Nuevo"
                            : item.changeStatus === "UPDATED"
                            ? "Modificado"
                            : "Eliminado"}
                        </span>
                      ) : (
                        <span style={{ color: isDark ? "#475569" : "#cbd5e1" }}>—</span>
                      )}
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
          padding: "8px 16px",
          borderTop: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
          backgroundColor: isDark ? "#0b1120" : "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12px",
          color: isDark ? "#64748b" : "#64748b",
        }}
      >
        <div>
          {currentItems.length} elemento(s) en esta carpeta
          {selectedPaths.size > 0 && ` | ${selectedPaths.size} seleccionado(s)`}
        </div>
        <div>
          {clipboard && (
            <span style={{ color: "#3b82f6", fontWeight: "500" }}>
              Portapapeles: {clipboard.sources.length} elemento(s) para {clipboard.action === "copy" ? "copiar" : "mover"}
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
            backgroundColor: isDark ? "#0f172a" : "#ffffff",
            border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
            borderRadius: "10px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
            padding: "6px",
            zIndex: 10000,
            minWidth: "180px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.target ? (
            <>
              {contextMenu.target.isDirectory ? (
                <button
                  type="button"
                  onClick={() => {
                    handleOpenFolder(contextMenu.target!.logicalPath)
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconFolder style={{ width: 14, height: 14 }} />
                  <span>Abrir Carpeta</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (contextMenu.target?.rawFile) {
                      setEditorModal({
                        isOpen: true,
                        file: contextMenu.target.rawFile,
                        logicalPath: contextMenu.target.logicalPath,
                      })
                    }
                    setContextMenu(null)
                  }}
                  style={contextMenuItemStyle(isDark)}
                >
                  <IconFileText style={{ width: 14, height: 14 }} />
                  <span>Editar Archivo</span>
                </button>
              )}

              {isDraft && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPolicyTarget(contextMenu.target)
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <span>🛡️</span>
                    <span>Cambiar Política...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRenameTarget(contextMenu.target)
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
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
                    <span>📋 Copiar (Ctrl+C)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleCut()
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <span>✂️ Cortar (Ctrl+X)</span>
                  </button>

                  <div style={{ height: "1px", backgroundColor: isDark ? "#1e293b" : "#e2e8f0", margin: "4px 0" }} />

                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTargets([contextMenu.target!.logicalPath])
                      setContextMenu(null)
                    }}
                    style={{ ...contextMenuItemStyle(isDark), color: "#ef4444" }}
                  >
                    <IconTrash style={{ width: 14, height: 14 }} />
                    <span>Eliminar (Supr)</span>
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {isDraft && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewFolderOpen(true)
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconFolder style={{ width: 14, height: 14, color: "#3b82f6" }} />
                    <span>Nueva Carpeta</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditorModal({
                        isOpen: true,
                        isNew: true,
                        initialPath: currentPath ? `${currentPath}/nuevo_archivo.txt` : "nuevo_archivo.txt",
                      })
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconFileText style={{ width: 14, height: 14, color: "#10b981" }} />
                    <span>Nuevo Archivo</span>
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
                      <span>📋 Pegar ({clipboard.sources.length})</span>
                    </button>
                  )}

                  <div style={{ height: "1px", backgroundColor: isDark ? "#1e293b" : "#e2e8f0", margin: "4px 0" }} />

                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click()
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconUpload style={{ width: 14, height: 14 }} />
                    <span>Subir Archivos</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={async () => {
                  setContextMenu(null)
                  setIsRefreshing(true)
                  await onRefresh()
                  setIsRefreshing(false)
                }}
                style={contextMenuItemStyle(isDark)}
              >
                <IconRefresh style={{ width: 14, height: 14 }} />
                <span>Actualizar Vista</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Sub-Modals */}
      {editorModal?.isOpen && (
        <TextFileEditorModal
          theme={theme}
          fileId={editorModal.file?.id}
          logicalPath={editorModal.file?.logicalPath || editorModal.initialPath || "archivo.txt"}
          isNew={editorModal.isNew}
          readOnly={!isDraft}
          onClose={() => setEditorModal(null)}
          onSaveSuccess={async () => {
            setEditorModal(null)
            await onRefresh()
          }}
          onToast={onToast}
        />
      )}

      {isNewFolderOpen && (
        <NewFolderModal
          theme={theme}
          currentPath={currentPath}
          onClose={() => setIsNewFolderOpen(false)}
          onSubmit={async (folderName) => {
            const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
            await gameApi.createGameFolder(folderPath)
            onToast("Carpeta creada correctamente.", "success")
            await onRefresh()
          }}
        />
      )}

      {renameTarget && (
        <RenameModal
          theme={theme}
          oldName={renameTarget.name}
          isDirectory={renameTarget.isDirectory}
          onClose={() => setRenameTarget(null)}
          onSubmit={async (newName) => {
            const parentDir = renameTarget.logicalPath.includes("/")
              ? renameTarget.logicalPath.slice(0, renameTarget.logicalPath.lastIndexOf("/"))
              : ""
            const newPath = parentDir ? `${parentDir}/${newName}` : newName
            await gameApi.renameGamePath(renameTarget.logicalPath, newPath)
            onToast("Elemento renombrado correctamente.", "success")
            await onRefresh()
          }}
        />
      )}

      {policyTarget && (
        <PolicyModal
          theme={theme}
          path={policyTarget.logicalPath}
          isDirectory={policyTarget.isDirectory}
          currentExplicitPolicy={policyTarget.explicitPolicy}
          currentEffectivePolicy={policyTarget.effectivePolicy}
          onClose={() => setPolicyTarget(null)}
          onSubmit={async (policy) => {
            await gameApi.setGamePathPolicy(policyTarget.logicalPath, policy)
            onToast("Política actualizada correctamente.", "success")
            await onRefresh()
          }}
        />
      )}

      {deleteTargets && (
        <ConfirmDeleteModal
          theme={theme}
          paths={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onConfirm={async () => {
            await gameApi.deleteGamePaths(deleteTargets)
            setSelectedPaths(new Set())
            onToast("Elemento(s) eliminado(s) correctamente.", "success")
            await onRefresh()
          }}
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
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "6px",
    color: isDark ? "#e2e8f0" : "#1e293b",
    fontSize: "13px",
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
  }
}
