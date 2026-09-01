import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { ThemeMode, AdminGameFile, SyncPolicy } from "../../types"
import { gameApi } from "../../services/graphqlClient"
import { uploadGameFileDirect } from "../../services/gameFileUploadService"
import {
  formatBytesToHuman,
  isEditableTextFile,
  inferGameCategory,
  resolveEffectiveGamePolicy,
  GAME_TEXT_FILE_EXTENSIONS,
  KNOWN_BINARY_EXTENSIONS,
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
  IconLock,
  IconArrowDown,
} from "../../theme/icons"
import TextFileEditorModal from "./TextFileEditorModal"
import NewFolderModal from "./NewFolderModal"
import RenameModal from "./RenameModal"
import PolicyModal from "./PolicyModal"
import ConfirmDeleteModal from "./ConfirmDeleteModal"
import { ModSearchModal } from "./providers/ModSearchModal"
import { getThemeTokens } from "../../theme/tokens"

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

async function traverseFileSystemEntry(
  entry: any,
  currentRelPath: string,
  collected: Array<{ file: File; relativePath: string }>,
): Promise<void> {
  if (!entry) return
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file: File) => {
          const relPath = currentRelPath ? `${currentRelPath}/${file.name}` : file.name
          collected.push({ file, relativePath: relPath })
          resolve()
        },
        () => resolve(),
      )
    })
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader()
    const dirPath = currentRelPath ? `${currentRelPath}/${entry.name}` : entry.name
    return new Promise((resolve) => {
      const readNextBatch = () => {
        dirReader.readEntries(
          (entries: any[]) => {
            if (!entries || entries.length === 0) {
              resolve()
              return
            }
            Promise.all(entries.map((child: any) => traverseFileSystemEntry(child, dirPath, collected))).then(() => {
              readNextBatch()
            })
          },
          () => resolve(),
        )
      }
      readNextBatch()
    })
  }
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
  const tokens = getThemeTokens(theme)

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
    initialContent?: string
  } | null>(null)

  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ExplorerItem | null>(null)
  const [policyTarget, setPolicyTarget] = useState<ExplorerItem | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null)
  const [isModSearchOpen, setIsModSearchOpen] = useState(false)

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

  // Build the unified virtual tree for currentPath with accurate policy inheritance
  const currentItems = useMemo(() => {
    const itemMap = new Map<string, ExplorerItem>()
    const normCurrent = currentPath ? `${currentPath}/` : ""

    const ancestorPolicies = new Map<string, string | null | undefined>()
    for (const f of files) {
      if (f.isDirectory) {
        ancestorPolicies.set(f.logicalPath, f.explicitPolicy ?? null)
      }
    }

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
            const effPolicy = resolveEffectiveGamePolicy(topFolder, null, ancestorPolicies)
            itemMap.set(topFolder, {
              id: `virtual-folder-${topFolder}`,
              name: topFolder,
              logicalPath: topFolder,
              isDirectory: true,
              sizeBytes: 0,
              category: inferGameCategory(topFolder),
              sha256: "",
              policy: effPolicy,
              explicitPolicy: null,
              effectivePolicy: effPolicy,
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
              const effPolicy = resolveEffectiveGamePolicy(folderPath, null, ancestorPolicies)
              itemMap.set(folderPath, {
                id: `virtual-folder-${folderPath}`,
                name: folderSegment,
                logicalPath: folderPath,
                isDirectory: true,
                sizeBytes: 0,
                category: inferGameCategory(folderPath),
                sha256: "",
                policy: effPolicy,
                explicitPolicy: null,
                effectivePolicy: effPolicy,
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
  const handleItemDoubleClick = async (item: ExplorerItem) => {
    if (item.changeStatus === "REMOVED") return
    if (item.isDirectory) {
      handleOpenFolder(item.logicalPath)
    } else if (item.rawFile) {
      await handleOpenFileOrInspect(item)
    }
  }

  // Open file editor or inspect unknown text with backend
  const handleOpenFileOrInspect = async (item: ExplorerItem) => {
    if (item.changeStatus === "REMOVED" || item.isDirectory || !item.rawFile) return
    const lowerName = item.name.toLowerCase()
    if (KNOWN_BINARY_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      return
    }

    if (isEditableTextFile(item.name)) {
      setEditorModal({
        isOpen: true,
        file: item.rawFile,
        logicalPath: item.logicalPath,
      })
      return
    }

    // Unknown extension or extensionless file: verify with backend first
    try {
      const content = await gameApi.readGameFileContent(item.rawFile.id)
      setEditorModal({
        isOpen: true,
        file: item.rawFile,
        logicalPath: item.logicalPath,
        initialContent: content,
      })
    } catch (err: unknown) {
      onToast(
        err instanceof Error
          ? err.message
          : "El archivo seleccionado contiene datos binarios no editables.",
        "error",
      )
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

  // Binary upload handler with selected folder root stripping
  const handleUploadFiles = async (
    fileList: FileList | null | Array<File | { file: File; relativePath?: string }>,
    stripFirstFolder = false,
  ) => {
    if (!fileList || fileList.length === 0 || !isDraft) return
    setIsUploading(true)

    const itemsToUpload: Array<{ file: File; relativePath?: string }> = []
    for (let i = 0; i < fileList.length; i++) {
      const item = fileList[i]
      if (item && typeof item === "object" && "file" in item && Boolean((item as any).file)) {
        itemsToUpload.push(item as { file: File; relativePath?: string })
      } else if (item) {
        const fileObj = item as File
        itemsToUpload.push({
          file: fileObj,
          relativePath: (fileObj as any).webkitRelativePath || undefined,
        })
      }
    }

    try {
      for (let i = 0; i < itemsToUpload.length; i++) {
        const item = itemsToUpload[i]
        const file = item.file
        setUploadProgress({
          current: i + 1,
          total: itemsToUpload.length,
          filename: file.name,
        })

        // Determine destination logical path
        let targetLogicalPath: string
        if (item.relativePath) {
          let cleanRel = item.relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
          if (stripFirstFolder) {
            const parts = cleanRel.split("/").filter(Boolean)
            cleanRel = parts.length > 1 ? parts.slice(1).join("/") : parts.join("/")
          }
          targetLogicalPath = currentPath ? `${currentPath}/${cleanRel}` : cleanRel
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

        // 2. Upload directly to R2 via S3 multipart + incremental SHA-256
        const uploaded = await uploadGameFileDirect(file, ticket)

        // 3. Confirm upload on backend
        const completed = await gameApi.completeGameFileUpload({
          uploadToken: ticket.uploadToken,
          sha256: uploaded.sha256,
          sizeBytes: uploaded.sizeBytes,
        })

        // 4. Add game file to active draft
        await gameApi.addGameFile({
          name: file.name,
          category,
          logicalPath: targetLogicalPath,
          tokenHash: completed.tokenHash,
        })
      }

      onToast(`${itemsToUpload.length} archivo(s) subido(s) exitosamente.`, "success")
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

  // Drag and drop handler with recursive directory traversal
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDraft) return

    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      const entries: any[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
        if (entry) {
          entries.push(entry)
        }
      }

      if (entries.length > 0) {
        const collected: Array<{ file: File; relativePath: string }> = []
        for (const entry of entries) {
          await traverseFileSystemEntry(entry, "", collected)
        }

        if (collected.length > 0) {
          const hasSingleTopDirectory = entries.length === 1 && entries[0].isDirectory
          await handleUploadFiles(collected, hasSingleTopDirectory)
          return
        }
      }
    }

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
      return <IconFolder style={{ width: 20, height: 20, color: isDark ? "#3ec4c0" : "#0284c7", flexShrink: 0 }} />
    }
    const ext = `.${item.name.split(".").pop()?.toLowerCase()}`
    if ([".json", ".toml", ".yaml", ".yml", ".cfg", ".properties", ".txt"].includes(ext)) {
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
    <div
      ref={explorerContainerRef}
      onContextMenu={(e) => handleContextMenu(e, null)}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
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
          {isDraft && (
            <>
              <button
                type="button"
                data-testid="button-open-mod-providers"
                onClick={() => setIsModSearchOpen(true)}
                className="launcher-btn-primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "8px 16px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
                title="Buscar e instalar contenido desde Modrinth y CurseForge"
              >
                <IconPlus size={15} />
                <span>Añadir Contenido</span>
              </button>

              <button
                type="button"
                onClick={() => setIsNewFolderOpen(true)}
                className="launcher-btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
                title="Crear una nueva carpeta en el directorio actual"
              >
                <IconFolder size={15} />
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
                className="launcher-btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
                title="Crear un archivo de texto o configuración"
              >
                <IconFileText size={15} />
                <span>Nuevo Archivo</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="launcher-btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
                title="Subir archivos binarios o mods al directorio actual"
              >
                <IconUpload size={15} />
                <span>Subir Archivos</span>
              </button>

              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isUploading}
                className="launcher-btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
                title="Subir una carpeta completa con su estructura interna"
              >
                <IconFolder size={15} />
                <span>Subir Carpeta</span>
              </button>
            </>
          )}

          {/* Hidden inputs */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: isDraft ? "0" : "auto" }}>
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
            onClick={async () => {
              setIsRefreshing(true)
              await onRefresh()
              setIsRefreshing(false)
            }}
            disabled={isRefreshing}
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
            <IconRefresh style={{ width: 16, height: 16, animation: isRefreshing ? "spin 1s linear infinite" : "none" }} />
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

        <div style={{ height: "16px", width: "1px", backgroundColor: tokens.borderSubtle, margin: "0 4px" }} />

        {/* Root item */}
        <span
          onClick={() => handleNavigateBreadcrumb(-1)}
          style={{
            cursor: "pointer",
            fontWeight: breadcrumbs.length === 0 ? "700" : "500",
            color: breadcrumbs.length === 0 ? (isDark ? "#3ec4c0" : "#0c6e6b") : tokens.textSecondary,
            padding: "3px 8px",
            borderRadius: "6px",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <IconFolder size={14} />
          <span>Raíz</span>
        </span>

        {breadcrumbs.map((segment, idx) => (
          <React.Fragment key={idx}>
            <span style={{ color: tokens.textMuted }}>/</span>
            <span
              onClick={() => handleNavigateBreadcrumb(idx)}
              style={{
                cursor: "pointer",
                fontWeight: idx === breadcrumbs.length - 1 ? "700" : "500",
                color: idx === breadcrumbs.length - 1 ? (isDark ? "#3ec4c0" : "#0c6e6b") : tokens.textSecondary,
                padding: "3px 8px",
                borderRadius: "6px",
              }}
            >
              {segment}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Upload progress banner */}
      {isUploading && uploadProgress && (
        <div
          style={{
            padding: "10px 18px",
            backgroundColor: isDark ? "rgba(62, 196, 192, 0.12)" : "#e0f2fe",
            color: isDark ? "#3ec4c0" : "#0284c7",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <IconSpinner style={{ width: 15, height: 15 }} />
            <span>
              Subiendo ({uploadProgress.current}/{uploadProgress.total}): <strong>{uploadProgress.filename}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Main Files Table / Drag & Drop Area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px",
          position: "relative",
        }}
      >
        {currentItems.length === 0 ? (
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
              {isDraft
                ? "Arrastra y suelta archivos aquí o usa los botones de la barra superior."
                : "No hay archivos en este directorio para la versión seleccionada."}
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${tokens.borderSubtle}`, color: tokens.textMuted }}>
                <th style={{ padding: "10px 14px", width: "36px" }}>
                  <input
                    type="checkbox"
                    checked={selectedPaths.size === currentItems.length && currentItems.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) handleSelectAll()
                      else handleClearSelection()
                    }}
                  />
                </th>
                <th style={{ padding: "10px 14px", fontWeight: "600" }}>Nombre</th>
                <th style={{ padding: "10px 14px", width: "120px", fontWeight: "600" }}>Tamaño</th>
                <th style={{ padding: "10px 14px", width: "160px", fontWeight: "600" }}>Sincronización</th>
                <th style={{ padding: "10px 14px", width: "160px", fontWeight: "600" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((item) => {
                const isSelected = selectedPaths.has(item.logicalPath)
                const isRemoved = item.changeStatus === "REMOVED"
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
                          ? "rgba(62, 196, 192, 0.15)"
                          : "#e0f2fe"
                        : "transparent",
                      borderBottom: `1px solid ${tokens.borderSubtle}`,
                      transition: "background-color 0.12s ease",
                      opacity: isRemoved ? 0.6 : 1,
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
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {getItemIcon(item)}
                        <span
                          style={{
                            fontWeight: item.isDirectory ? "600" : "400",
                            color: tokens.textPrimary,
                            textDecoration: isRemoved ? "line-through" : "none",
                          }}
                        >
                          {item.name}
                        </span>
                      </div>
                    </td>

                    <td style={{ padding: "10px 14px", color: tokens.textSecondary, fontFamily: "monospace" }}>
                      {item.isDirectory ? "—" : formatBytesToHuman(item.sizeBytes)}
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isDraft && !isRemoved) setPolicyTarget(item)
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          backgroundColor:
                            item.effectivePolicy === "NO_MODIFICABLE"
                              ? "rgba(239, 68, 68, 0.15)"
                              : "rgba(34, 197, 94, 0.15)",
                          border: `1px solid ${
                            item.effectivePolicy === "NO_MODIFICABLE"
                              ? "rgba(239, 68, 68, 0.25)"
                              : "rgba(34, 197, 94, 0.25)"
                          }`,
                          color:
                            item.effectivePolicy === "NO_MODIFICABLE"
                              ? "#ef4444"
                              : "#22c55e",
                          cursor: isDraft && !isRemoved ? "pointer" : "default",
                        }}
                        title={
                          item.explicitPolicy
                            ? `Override explícito: ${item.effectivePolicy}`
                            : `Heredado de la jerarquía: ${item.effectivePolicy}`
                        }
                      >
                        {item.effectivePolicy === "NO_MODIFICABLE" ? (
                          <>
                            <IconLock size={12} />
                            <span>Protegido</span>
                          </>
                        ) : (
                          <>
                            <IconEdit size={12} />
                            <span>Personalizable</span>
                          </>
                        )}
                        {item.explicitPolicy && (
                          <span style={{ fontSize: "10px", opacity: 0.75 }}>★</span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      {item.changeStatus && item.changeStatus !== "UNCHANGED" ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
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

                          {isRemoved && isDraft && (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  await gameApi.restoreGameFile(item.id)
                                  onToast("Elemento restaurado exitosamente.", "success")
                                  await onRefresh()
                                } catch (err: unknown) {
                                  onToast(err instanceof Error ? err.message : "Error al restaurar.", "error")
                                }
                              }}
                              className="launcher-btn-secondary"
                              style={{
                                padding: "2px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "600",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              title="Restaurar este elemento al borrador activo"
                            >
                              <IconRefresh size={11} />
                              <span>Restaurar</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: tokens.textMuted }}>—</span>
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
          {currentItems.length} elemento(s) en esta carpeta
          {selectedPaths.size > 0 && ` | ${selectedPaths.size} seleccionado(s)`}
        </div>
        <div>
          {clipboard && (
            <span style={{ color: isDark ? "#3ec4c0" : "#0c6e6b", fontWeight: "600" }}>
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
            contextMenu.target.changeStatus === "REMOVED" ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (contextMenu.target?.id) {
                      await gameApi.restoreGameFile(contextMenu.target.id)
                      onToast("Elemento restaurado exitosamente.", "success")
                      await onRefresh()
                    }
                  } catch (err: unknown) {
                    onToast(err instanceof Error ? err.message : "Error al restaurar.", "error")
                  }
                  setContextMenu(null)
                }}
                style={contextMenuItemStyle(isDark)}
              >
                <IconRefresh style={{ width: 14, height: 14 }} />
                <span>Restaurar elemento</span>
              </button>
            ) : (
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
                    <span>Abrir carpeta</span>
                  </button>
                ) : !KNOWN_BINARY_EXTENSIONS.some((ext) => contextMenu.target!.name.toLowerCase().endsWith(ext)) ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (contextMenu.target) {
                        await handleOpenFileOrInspect(contextMenu.target)
                      }
                      setContextMenu(null)
                    }}
                    style={contextMenuItemStyle(isDark)}
                  >
                    <IconFileText style={{ width: 14, height: 14 }} />
                    <span>{isEditableTextFile(contextMenu.target.name) ? "Editar archivo" : "Editar archivo (texto)"}</span>
                  </button>
                ) : null}

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
                      <IconLock style={{ width: 14, height: 14 }} />
                      <span>Cambiar política...</span>
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
            )
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
                    <IconFolder style={{ width: 14, height: 14, color: "#3ec4c0" }} />
                    <span>Nueva carpeta</span>
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
                    <span>Subir Carpeta</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {editorModal?.isOpen && (
        <TextFileEditorModal
          theme={theme}
          fileId={editorModal.file?.id}
          logicalPath={editorModal.initialPath || editorModal.logicalPath || editorModal.file?.logicalPath || "nuevo_archivo.txt"}
          isNew={editorModal.isNew}
          initialContent={editorModal.initialContent}
          onClose={() => setEditorModal(null)}
          onSaveSuccess={async () => {
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
          onSubmit={async (name: string) => {
            const folderPath = currentPath ? `${currentPath}/${name}` : name
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
          onSubmit={async (newName: string) => {
            const parent = renameTarget.logicalPath.includes("/")
              ? renameTarget.logicalPath.slice(0, renameTarget.logicalPath.lastIndexOf("/"))
              : ""
            const newLogical = parent ? `${parent}/${newName}` : newName
            await gameApi.renameGamePath(renameTarget.logicalPath, newLogical)
            onToast("Elemento renombrado exitosamente.", "success")
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
          onSubmit={async (policy: SyncPolicy | null) => {
            await gameApi.setGamePathPolicy(policyTarget.logicalPath, policy)
            onToast("Política de sincronización actualizada.", "success")
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
            onToast(`${deleteTargets.length} elemento(s) eliminado(s).`, "success")
            setSelectedPaths(new Set())
            await onRefresh()
          }}
        />
      )}

      {isModSearchOpen && (
        <ModSearchModal
          theme={theme}
          onClose={() => setIsModSearchOpen(false)}
          onSuccess={async () => {
            onToast("Mods y dependencias instalados exitosamente en el borrador.", "success")
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
