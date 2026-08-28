// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import GameView from "./GameView"
import GameFilesExplorer from "./GameFilesExplorer"
import TextFileEditorModal from "./TextFileEditorModal"
import { gameApi, graphqlClient } from "../../services/graphqlClient"
import { ModSearchModal } from "./providers/ModSearchModal"

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

  describe("Shard 8B — Content Providers UI Integration", () => {
    it("renders 'Añadir Contenido' button in draft toolbar and opens unified ModSearchModal with content tabs", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined)
      const onToast = vi.fn()

      const searchSpy = vi.spyOn(graphqlClient, "searchMods").mockResolvedValue({
        items: [
          {
            provider: "MODRINTH",
            projectId: "create-id",
            name: "Create",
            summary: "Building Tools and Aesthetic Technology",
            author: "simibubi",
            downloads: 12000000,
            categories: ["technology"],
            contentType: "MOD",
            environment: "BOTH",
          },
          {
            provider: "CURSEFORGE",
            projectId: "238222",
            name: "Just Enough Items",
            summary: "View Items and Recipes",
            author: "mezz",
            downloads: 250000000,
            categories: ["utility"],
            contentType: "MOD",
            environment: "BOTH",
          },
        ],
        totalCount: 2,
        providersStatus: [
          { provider: "MODRINTH", available: true, error: null },
          { provider: "CURSEFORGE", available: true, error: null },
        ],
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      render(
        <GameFilesExplorer
          theme="dark"
          files={[]}
          isDraft={true}
          onRefresh={onRefresh}
          onToast={onToast}
        />,
      )

      // 1. Verify "Añadir Contenido" button is present
      const addContentBtn = screen.getByTestId("button-open-mod-providers")
      expect(addContentBtn).toBeDefined()
      expect(addContentBtn.textContent).toContain("Añadir Contenido")

      // 2. Click button to open modal
      await act(async () => {
        fireEvent.click(addContentBtn)
      })

      // 3. Verify modal opened with environment indicator and search input
      expect(screen.getByTestId("mod-search-modal")).toBeDefined()
      expect(screen.getByTestId("compatible-env-indicator").textContent).toContain("Minecraft 1.21.1")
      expect(screen.getByTestId("compatible-env-indicator").textContent).toContain("NeoForge")

      // 4. Verify content type tabs and provider tabs
      expect(screen.getByTestId("tab-content-mod")).toBeDefined()
      expect(screen.getByTestId("tab-content-resource_pack")).toBeDefined()
      expect(screen.getByTestId("tab-content-data_pack")).toBeDefined()
      expect(screen.getByTestId("tab-content-shader")).toBeDefined()

      expect(screen.getByTestId("tab-provider-all")).toBeDefined()
      expect(screen.getByTestId("tab-provider-modrinth")).toBeDefined()
      expect(screen.getByTestId("tab-provider-curseforge")).toBeDefined()

      // 5. Verify cards rendered for both providers
      await waitFor(() => {
        expect(screen.getByTestId("mod-card-modrinth-create-id")).toBeDefined()
        expect(screen.getByTestId("mod-card-curseforge-238222")).toBeDefined()
      })

      expect(screen.getByTestId("badge-provider-modrinth").textContent).toBe("Modrinth")
      expect(screen.getByTestId("badge-provider-curseforge").textContent).toBe("CurseForge")
    })

    it("opens ModDetailModal, displays compatible versions and dependency preview, and calls installModPlan", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined)
      const onToast = vi.fn()

      vi.spyOn(graphqlClient, "searchMods").mockResolvedValue({
        items: [
          {
            provider: "MODRINTH",
            projectId: "create-id",
            name: "Create",
            summary: "Building Tools and Aesthetic Technology",
            author: "simibubi",
            downloads: 12000000,
            categories: ["technology"],
            contentType: "MOD",
            environment: "BOTH",
          },
        ],
        totalCount: 1,
        providersStatus: [{ provider: "MODRINTH", available: true }],
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      const getDetailSpy = vi.spyOn(graphqlClient, "getModProjectDetail").mockResolvedValue({
        provider: "MODRINTH",
        projectId: "create-id",
        name: "Create",
        summary: "Building Tools and Aesthetic Technology",
        author: "simibubi",
        downloads: 12000000,
        contentType: "MOD",
        environment: "BOTH",
        isInstalled: false,
        compatibleVersions: [
          {
            id: "ver-create-606",
            versionNumber: "6.0.6",
            name: "Create 6.0.6",
            releaseType: "RELEASE",
            gameVersions: ["1.21.1"],
            loaders: ["neoforge"],
            publishedAt: "2024-08-20T00:00:00Z",
            downloads: 1000,
            filename: "create-1.21.1-6.0.6.jar",
            sizeBytes: 15000000,
            dependencies: [{ projectId: "flywheel-id", dependencyType: "REQUIRED" }],
          },
          {
            id: "ver-create-605",
            versionNumber: "6.0.5",
            name: "Create 6.0.5",
            releaseType: "BETA",
            gameVersions: ["1.21.1"],
            loaders: ["neoforge"],
            publishedAt: "2024-08-15T00:00:00Z",
            downloads: 800,
            filename: "create-1.21.1-6.0.5.jar",
            sizeBytes: 14000000,
            dependencies: [],
          },
        ],
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      const resolvePlanSpy = vi.spyOn(graphqlClient, "resolveModInstallationPlan").mockResolvedValue({
        items: [
          {
            provider: "MODRINTH",
            projectId: "create-id",
            projectName: "Create",
            versionId: "ver-create-606",
            versionNumber: "6.0.6",
            filename: "create-1.21.1-6.0.6.jar",
            sizeBytes: 15000000,
            contentType: "MOD",
            environment: "BOTH",
            logicalPath: "mods/create-1.21.1-6.0.6.jar",
            isRoot: true,
            isDependency: false,
            isRequired: true,
            isInstalled: false,
            action: "INSTALL",
            availableCompatibleVersions: [],
          },
          {
            provider: "MODRINTH",
            projectId: "flywheel-id",
            projectName: "Flywheel",
            versionId: "ver-flywheel-100",
            versionNumber: "1.0.0",
            filename: "flywheel-1.21.1-1.0.0.jar",
            sizeBytes: 3000000,
            contentType: "MOD",
            environment: "BOTH",
            logicalPath: "mods/flywheel-1.21.1-1.0.0.jar",
            isRoot: false,
            isDependency: true,
            isRequired: true,
            isInstalled: false,
            action: "INSTALL",
            availableCompatibleVersions: [
              {
                id: "ver-flywheel-100",
                versionNumber: "1.0.0",
                name: "Flywheel 1.0.0",
                releaseType: "RELEASE",
                gameVersions: ["1.21.1"],
                loaders: ["neoforge"],
                publishedAt: "2024-08-10T00:00:00Z",
                downloads: 500,
                filename: "flywheel.jar",
                sizeBytes: 3000000,
                dependencies: [],
              },
            ],
          },
        ],
        totalDownloadSizeBytes: 18000000,
        conflicts: [],
        optionalDependencies: [],
        isValid: true,
      })

      const installSpy = vi.spyOn(graphqlClient, "installModPlan").mockResolvedValue([
        {
          id: "file-created-1",
          name: "create-1.21.1-6.0.6.jar",
          logicalPath: "mods/create-1.21.1-6.0.6.jar",
          category: "MOD",
          sha256: "sha256create",
          sizeBytes: 15000000,
          policy: "NO_MODIFICABLE",
          effectivePolicy: "NO_MODIFICABLE",
          isInherited: true,
          isDirectory: false,
          sourceProvider: "MODRINTH",
          sourceProjectId: "create-id",
          sourceVersionId: "ver-create-606",
          sourceEnvironment: "BOTH",
          createdAt: new Date().toISOString(),
        },
      ])

      render(
        <GameFilesExplorer
          theme="dark"
          files={[]}
          isDraft={true}
          onRefresh={onRefresh}
          onToast={onToast}
        />,
      )

      // 1. Open search modal
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-open-mod-providers"))
      })

      // 2. Click Create mod card
      await waitFor(() => {
        expect(screen.getByTestId("mod-card-modrinth-create-id")).toBeDefined()
      })

      await act(async () => {
        fireEvent.click(screen.getByTestId("mod-card-modrinth-create-id"))
      })

      // 3. Verify detail modal opened
      await waitFor(() => {
        expect(screen.getByTestId("mod-detail-modal")).toBeDefined()
      })

      expect(getDetailSpy).toHaveBeenCalledWith("MODRINTH", "create-id", "MOD")
      expect(resolvePlanSpy).toHaveBeenCalled()

      // 4. Verify version selector preselected with latest release
      const versionSelect = screen.getByTestId("select-mod-version") as HTMLSelectElement
      expect(versionSelect.value).toBe("ver-create-606")

      // 5. Verify dependency listed
      await waitFor(() => {
        expect(screen.getByTestId("dependency-item-flywheel-id")).toBeDefined()
        expect(screen.getByText("Flywheel")).toBeDefined()
      })

      // 6. Click Install Button
      const installBtn = screen.getByTestId("button-confirm-install")
      expect(installBtn.textContent).toContain("Añadir 2 elementos")

      await act(async () => {
        fireEvent.click(installBtn)
      })

      expect(installSpy).toHaveBeenCalledWith({
        provider: "MODRINTH",
        projectId: "create-id",
        versionId: "ver-create-606",
        contentType: "MOD",
        manualOverrides: null,
      })

      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalled()
      })
    })

    it("cancels pending debounce and invalidates in-flight requests when switching content type tab", async () => {
      vi.useFakeTimers()
      const searchSpy = vi.spyOn(graphqlClient, "searchMods").mockImplementation(async (query, contentType, provider, limit, offset) => {
        return {
          items: [],
          totalCount: 0,
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          providersStatus: [],
        }
      })

      render(
        <ModSearchModal
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      // 1. Type in search input to trigger debounce
      const searchInput = screen.getByTestId("input-mod-search")
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "test query" } })
      })

      // 2. Immediately switch to Data Packs tab before debounce timer fires
      await act(async () => {
        fireEvent.click(screen.getByTestId("tab-content-data_pack"))
      })

      // 3. Advance fake timers
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // 4. Verify the search request executed for DATA_PACK and not for old MOD
      expect(searchSpy).toHaveBeenCalledWith("test query", "DATA_PACK", null, 20, 0)
      vi.useRealTimers()
    })
  })
})


