// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import GameView from "./GameView"
import GameFilesExplorer from "./GameFilesExplorer"
import TextFileEditorModal from "./TextFileEditorModal"
import { gameApi } from "../../services/graphqlClient"

describe("Back Office Game Files Explorer Suite (Shard 8A)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders published release overview with Game Files Explorer in read-only mode", async () => {
    const mockOverview: import("../../types").AdminGameOverview = {
      publishedRelease: {
        id: "rel-1",
        version: "1.4.2",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "PUBLISHED",
        notes: "Versión inicial",
        publishedAt: new Date().toISOString(),
        files: [
          {
            id: "file-1",
            name: "create.toml",
            logicalPath: "config/create.toml",
            category: "CONFIG",
            sha256: "abc123456789",
            sizeBytes: 1500,
            policy: "MODIFICABLE",
            explicitPolicy: null,
            effectivePolicy: "MODIFICABLE",
            isInherited: true,
            isDirectory: false,
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      draftRelease: null,
      pendingChangesCount: 0,
    }

    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue(mockOverview)

    await act(async () => {
      render(<GameView theme="dark" />)
    })

    expect(screen.getByText("Explorador de Archivos del Juego")).toBeDefined()
    expect(screen.getByText("v1.4.2")).toBeDefined()
    expect(screen.getByText(/Modo Lectura/i)).toBeDefined()
    expect(screen.getAllByText("Preparar actualización").length).toBeGreaterThan(0)

    // Virtual root directory shows top-level folder 'config'
    expect(screen.getByText("config")).toBeDefined()
  })

  it("renders active draft with explorer actions and allows navigating into folders", async () => {
    const mockOverview: import("../../types").AdminGameOverview = {
      publishedRelease: {
        id: "rel-1",
        version: "1.4.2",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "PUBLISHED",
        notes: null,
        publishedAt: new Date().toISOString(),
        files: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      draftRelease: {
        id: "rel-2",
        version: "1.4.3",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "DRAFT",
        notes: null,
        publishedAt: null,
        files: [
          {
            id: "folder-1",
            name: "config",
            logicalPath: "config",
            category: "CONFIG",
            sha256: "",
            sizeBytes: 0,
            policy: "MODIFICABLE",
            explicitPolicy: null,
            effectivePolicy: "MODIFICABLE",
            isInherited: true,
            isDirectory: true,
            createdAt: new Date().toISOString(),
          },
          {
            id: "file-2",
            name: "create.toml",
            logicalPath: "config/create.toml",
            category: "CONFIG",
            sha256: "def456",
            sizeBytes: 1200,
            policy: "MODIFICABLE",
            explicitPolicy: null,
            effectivePolicy: "MODIFICABLE",
            isInherited: true,
            isDirectory: false,
            changeStatus: "ADDED",
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingChangesCount: 1,
      changes: {
        added: 1,
        updated: 0,
        removed: 0,
        unchanged: 0,
        total: 1,
      },
      readiness: {
        isReady: true,
        validVersion: true,
        noConflicts: true,
        storageVerified: true,
        issues: [],
      },
    }

    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue(mockOverview)

    await act(async () => {
      render(<GameView theme="dark" />)
    })

    expect(screen.getByText("Actualización en preparación (Borrador)")).toBeDefined()
    expect(screen.getByText("Nueva Carpeta")).toBeDefined()
    expect(screen.getByText("Nuevo Archivo")).toBeDefined()
    expect(screen.getByText("Subir Archivos")).toBeDefined()
    expect(screen.getByText("Subir Carpeta")).toBeDefined()
    expect(screen.getByText("Publicar actualización")).toBeDefined()
    expect(screen.getByText("Descartar borrador")).toBeDefined()

    // Double click on folder row 'config' to navigate into it
    const folderRow = screen.getByText("config")
    await act(async () => {
      fireEvent.doubleClick(folderRow)
    })

    // Now inside config/ -> create.toml is visible
    expect(screen.getByText("create.toml")).toBeDefined()
    expect(screen.getByText("1.2 KB")).toBeDefined()
    expect(screen.getByText("Nuevo")).toBeDefined()
    expect(screen.getByText("✏️ Personalizable")).toBeDefined()
  })

  it("opens text editor modal and validates JSON in real-time", async () => {
    const onToast = vi.fn()
    const onSaveSuccess = vi.fn()
    const onClose = vi.fn()

    const saveSpy = vi.spyOn(gameApi, "saveGameFileContent").mockResolvedValue({
      id: "f-saved",
      name: "settings.json",
      logicalPath: "config/settings.json",
      category: "CONFIG",
      sha256: "hash123",
      sizeBytes: 25,
      policy: "MODIFICABLE",
      effectivePolicy: "MODIFICABLE",
      isInherited: true,
      isDirectory: false,
      createdAt: new Date().toISOString(),
    })

    await act(async () => {
      render(
        <TextFileEditorModal
          theme="dark"
          logicalPath="config/settings.json"
          initialContent={'{\n  "valid": true\n}'}
          isNew={false}
          onClose={onClose}
          onSaveSuccess={onSaveSuccess}
          onToast={onToast}
        />,
      )
    })

    expect(screen.getByText("config/settings.json")).toBeDefined()
    expect(screen.getByText("✓ JSON Válido")).toBeDefined()

    // Save valid content
    const saveBtn = screen.getByText("Guardar")
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(saveSpy).toHaveBeenCalledWith({
      logicalPath: "config/settings.json",
      content: "{\n  \"valid\": true\n}",
      explicitPolicy: undefined,
    })
    expect(onSaveSuccess).toHaveBeenCalled()
  })

  it("switches to version history tab and renders historical releases with explorer", async () => {
    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
      publishedRelease: null,
      draftRelease: null,
      pendingChangesCount: 0,
    })

    vi.spyOn(gameApi, "getGameReleaseHistory").mockResolvedValue([
      {
        id: "rel-hist-1",
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "ARCHIVED",
        notes: "Versión histórica",
        publishedAt: "2026-08-20T12:00:00.000Z",
        files: [
          {
            id: "f-old-1",
            name: "old-mod.jar",
            logicalPath: "mods/old-mod.jar",
            category: "MOD",
            sha256: "123",
            sizeBytes: 5000,
            policy: "NO_MODIFICABLE",
            explicitPolicy: null,
            effectivePolicy: "NO_MODIFICABLE",
            isInherited: true,
            isDirectory: false,
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
    ])

    await act(async () => {
      render(<GameView theme="dark" />)
    })

    const historyTabBtn = screen.getByText("Historial de versiones")
    await act(async () => {
      fireEvent.click(historyTabBtn)
    })

    expect(screen.getByText("v1.0.0")).toBeDefined()
    expect(screen.getByText("Histórica")).toBeDefined()

    // Expand historical release
    const expandBtn = screen.getByText("Abrir explorador ▼")
    await act(async () => {
      fireEvent.click(expandBtn)
    })

    expect(screen.getByText("Ocultar explorador ▲")).toBeDefined()
    expect(screen.getByText("mods")).toBeDefined()
  })

  it("does not open editor on double click for binary files, and allows restoring removed items", async () => {
    const mockFiles: import("../../types").AdminGameFile[] = [
      {
        id: "jar-1",
        name: "create.jar",
        logicalPath: "create.jar",
        category: "MOD",
        sha256: "jarhash",
        sizeBytes: 50000,
        policy: "NO_MODIFICABLE",
        explicitPolicy: null,
        effectivePolicy: "NO_MODIFICABLE",
        isInherited: true,
        isDirectory: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "removed-1",
        name: "deleted.toml",
        logicalPath: "deleted.toml",
        category: "CONFIG",
        sha256: "tomhlash",
        sizeBytes: 100,
        policy: "MODIFICABLE",
        explicitPolicy: null,
        effectivePolicy: "MODIFICABLE",
        isInherited: true,
        isDirectory: false,
        changeStatus: "REMOVED",
        createdAt: new Date().toISOString(),
      },
    ]

    const onToast = vi.fn()
    const onRefresh = vi.fn()
    const restoreSpy = vi.spyOn(gameApi, "restoreGameFile").mockResolvedValue({
      id: "restored-1",
      name: "deleted.toml",
      logicalPath: "deleted.toml",
      category: "CONFIG",
      sha256: "tomhlash",
      sizeBytes: 100,
      policy: "MODIFICABLE",
      effectivePolicy: "MODIFICABLE",
      isInherited: true,
      isDirectory: false,
      createdAt: new Date().toISOString(),
    })

    await act(async () => {
      render(
        <GameFilesExplorer
          theme="dark"
          files={mockFiles}
          isDraft={true}
          onRefresh={onRefresh}
          onToast={onToast}
        />,
      )
    })

    // Double clicking create.jar should NOT open the editor modal
    const jarRow = screen.getByText("create.jar")
    await act(async () => {
      fireEvent.doubleClick(jarRow)
    })
    expect(screen.queryByText("Guardar Cambios")).toBeNull()

    // Removed item shows Restore button
    const restoreBtn = screen.getByText("↩️ Restaurar")
    await act(async () => {
      fireEvent.click(restoreBtn)
    })

    expect(restoreSpy).toHaveBeenCalledWith("removed-1")
    expect(onToast).toHaveBeenCalledWith("Elemento restaurado exitosamente.", "success")
    expect(onRefresh).toHaveBeenCalled()
  })

  it("handles folder upload via webkitdirectory and strips common root directory", async () => {
    const onToast = vi.fn()
    const onRefresh = vi.fn()

    const createUploadSpy = vi.spyOn(gameApi, "createGameFileUpload").mockResolvedValue({
      uploadUrl: "/game/upload",
      uploadToken: "tok-1",
      maxSizeBytes: 1000000,
      expectedCategory: "MOD",
    })
    const uploadBinarySpy = vi.spyOn(gameApi, "uploadGameBinary").mockResolvedValue({
      tokenHash: "hash-tok",
    })
    const addFileSpy = vi.spyOn(gameApi, "addGameFile").mockResolvedValue({
      id: "f-new",
      name: "a.jar",
      logicalPath: "mods/a.jar",
      category: "MOD",
      sha256: "h",
      sizeBytes: 10,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isInherited: true,
      isDirectory: false,
      createdAt: new Date().toISOString(),
    })

    const { container } = render(
      <GameFilesExplorer
        theme="dark"
        files={[]}
        isDraft={true}
        onRefresh={onRefresh}
        onToast={onToast}
      />,
    )

    // Find the folder upload input (with webkitdirectory)
    const inputs = container.querySelectorAll("input[type=\"file\"]")
    const folderInput = Array.from(inputs).find((i) => i.hasAttribute("webkitdirectory")) as HTMLInputElement
    expect(folderInput).toBeDefined()

    const fileA = new File(["dummy jar"], "a.jar", { type: "application/java-archive" })
    Object.defineProperty(fileA, "webkitRelativePath", { value: "MiActualizacion/mods/a.jar" })

    const fileB = new File(["dummy toml"], "a.toml", { type: "text/plain" })
    Object.defineProperty(fileB, "webkitRelativePath", { value: "MiActualizacion/config/a.toml" })

    await act(async () => {
      fireEvent.change(folderInput, {
        target: {
          files: [fileA, fileB],
        },
      })
    })

    // Assert that the common root 'MiActualizacion' was stripped!
    expect(createUploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ logicalPath: "mods/a.jar", originalFilename: "a.jar" }),
    )
    expect(createUploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ logicalPath: "config/a.toml", originalFilename: "a.toml" }),
    )
    expect(addFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ logicalPath: "mods/a.jar", name: "a.jar" }),
    )
    expect(addFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ logicalPath: "config/a.toml", name: "a.toml" }),
    )
    expect(onToast).toHaveBeenCalledWith("2 archivo(s) subido(s) exitosamente.", "success")
  })

  it("handles recursive drag and drop of folders with FileSystemEntry and fallback", async () => {
    const onToast = vi.fn()
    const onRefresh = vi.fn()

    vi.spyOn(gameApi, "createGameFileUpload").mockResolvedValue({
      uploadUrl: "/game/upload",
      uploadToken: "tok-2",
      maxSizeBytes: 1000000,
      expectedCategory: "MOD",
    })
    vi.spyOn(gameApi, "uploadGameBinary").mockResolvedValue({
      tokenHash: "hash-tok",
    })
    const addFileSpy = vi.spyOn(gameApi, "addGameFile").mockResolvedValue({
      id: "f-drag",
      name: "a.jar",
      logicalPath: "mods/a.jar",
      category: "MOD",
      sha256: "h",
      sizeBytes: 10,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isInherited: true,
      isDirectory: false,
      createdAt: new Date().toISOString(),
    })

    const { container } = render(
      <GameFilesExplorer
        theme="dark"
        files={[]}
        isDraft={true}
        onRefresh={onRefresh}
        onToast={onToast}
      />,
    )

    const explorerDiv = container.firstChild as HTMLElement

    // Mock FileSystemEntry hierarchy:
    // Root folder 'Pack'
    //   -> mods/a.jar
    //   -> config/sub/a.toml
    const fileA = new File(["jar content"], "a.jar")
    const fileB = new File(["toml content"], "a.toml")

    const fileEntryA = {
      isFile: true,
      isDirectory: false,
      name: "a.jar",
      file: (cb: (f: File) => void) => cb(fileA),
    }

    const fileEntryB = {
      isFile: true,
      isDirectory: false,
      name: "a.toml",
      file: (cb: (f: File) => void) => cb(fileB),
    }

    const subDirEntry = {
      isFile: false,
      isDirectory: true,
      name: "sub",
      createReader: () => {
        let read = false
        return {
          readEntries: (cb: (entries: any[]) => void) => {
            if (!read) {
              read = true
              cb([fileEntryB])
            } else {
              cb([])
            }
          },
        }
      },
    }

    const configDirEntry = {
      isFile: false,
      isDirectory: true,
      name: "config",
      createReader: () => {
        let read = false
        return {
          readEntries: (cb: (entries: any[]) => void) => {
            if (!read) {
              read = true
              cb([subDirEntry])
            } else {
              cb([])
            }
          },
        }
      },
    }

    const modsDirEntry = {
      isFile: false,
      isDirectory: true,
      name: "mods",
      createReader: () => {
        let read = false
        return {
          readEntries: (cb: (entries: any[]) => void) => {
            if (!read) {
              read = true
              cb([fileEntryA])
            } else {
              cb([])
            }
          },
        }
      },
    }

    const topFolderEntry = {
      isFile: false,
      isDirectory: true,
      name: "Pack",
      createReader: () => {
        let read = false
        return {
          readEntries: (cb: (entries: any[]) => void) => {
            if (!read) {
              read = true
              cb([modsDirEntry, configDirEntry])
            } else {
              cb([])
            }
          },
        }
      },
    }

    // Drop folder onto explorer
    await act(async () => {
      fireEvent.drop(explorerDiv, {
        dataTransfer: {
          items: [
            {
              webkitGetAsEntry: () => topFolderEntry,
            },
          ],
          files: [],
        },
      })
    })

    // Top folder 'Pack' is stripped; mods/a.jar and config/sub/a.toml are added
    await vi.waitFor(() => {
      expect(addFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ logicalPath: "mods/a.jar" }),
      )
    })
    await vi.waitFor(() => {
      expect(addFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ logicalPath: "config/sub/a.toml" }),
      )
    })

    // Test fallback when webkitGetAsEntry is not available
    const fallbackFile = new File(["text"], "plain.txt")
    await act(async () => {
      fireEvent.drop(explorerDiv, {
        dataTransfer: {
          items: [],
          files: [fallbackFile],
        },
      })
    })

    await vi.waitFor(() => {
      expect(addFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ logicalPath: "plain.txt" }),
      )
    })
  })

  it("inspects unknown extension files via backend on double click and opens editor if UTF-8", async () => {
    const onToast = vi.fn()
    const onRefresh = vi.fn()

    const mockFiles: import("../../types").AdminGameFile[] = [
      {
        id: "custom-file-1",
        name: "custom_conf",
        logicalPath: "custom_conf",
        category: "GENERAL",
        sha256: "hash123",
        sizeBytes: 15,
        policy: "MODIFICABLE",
        explicitPolicy: null,
        effectivePolicy: "MODIFICABLE",
        isInherited: true,
        isDirectory: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "bin-unknown-1",
        name: "data.bin_raw",
        logicalPath: "data.bin_raw",
        category: "GENERAL",
        sha256: "hashbin",
        sizeBytes: 15,
        policy: "MODIFICABLE",
        explicitPolicy: null,
        effectivePolicy: "MODIFICABLE",
        isInherited: true,
        isDirectory: false,
        createdAt: new Date().toISOString(),
      },
    ]

    const readSpy = vi.spyOn(gameApi, "readGameFileContent").mockImplementation(async (id: string) => {
      if (id === "custom-file-1") {
        return "custom=true\nsetting=1"
      }
      throw new Error("El archivo seleccionado contiene datos binarios no editables.")
    })

    render(
      <GameFilesExplorer
        theme="dark"
        files={mockFiles}
        isDraft={true}
        onRefresh={onRefresh}
        onToast={onToast}
      />,
    )

    // 1. Double clicking custom_conf calls backend and opens modal with content
    const textRow = screen.getByText("custom_conf")
    await act(async () => {
      fireEvent.doubleClick(textRow)
    })

    expect(readSpy).toHaveBeenCalledWith("custom-file-1")
    expect(screen.getByText("Guardar")).toBeDefined()

    // Close modal
    const closeBtn = screen.getByTitle("Cerrar (Esc)")
    await act(async () => {
      fireEvent.click(closeBtn)
    })

    // 2. Double clicking data.bin_raw causes backend to reject -> toast error, no modal
    const binRow = screen.getByText("data.bin_raw")
    await act(async () => {
      fireEvent.doubleClick(binRow)
    })

    expect(readSpy).toHaveBeenCalledWith("bin-unknown-1")
    expect(onToast).toHaveBeenCalledWith("El archivo seleccionado contiene datos binarios no editables.", "error")
    expect(screen.queryByText("Guardar")).toBeNull()
  })
})
