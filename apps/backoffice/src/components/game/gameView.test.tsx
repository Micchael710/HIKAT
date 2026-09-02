// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import GameView from "./GameView"
import GameFilesExplorer from "./GameFilesExplorer"
import TextFileEditorModal from "./TextFileEditorModal"
import PublishReleaseModal from "./PublishReleaseModal"
import { gameApi, serverApi, serverContentApi, graphqlClient } from "../../services/graphqlClient"
import * as mediaUploadService from "../../services/mediaUploadService"
import * as gameFileUploadService from "../../services/gameFileUploadService"
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
       modLoader: "NEOFORGE",
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
    expect(screen.getByText("Preparar actualización")).toBeDefined()

    // Virtual root directory shows top-level folder 'config'
    expect(screen.getByText("config")).toBeDefined()
  })

  it("permite configurar el entorno del draft desde el explorador", async () => {
    const onRefresh =
      vi.fn().mockResolvedValue(undefined)

    const onToast = vi.fn()

    const updateSpy =
      vi
        .spyOn(
          gameApi,
          "updateGameDraftMetadata",
        )
        .mockResolvedValue({
          id: "draft-env-test",
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.209",
          modLoader: "NEOFORGE",
          status: "DRAFT",
          notes: null,
          files: [],
          createdAt:
            new Date().toISOString(),
          updatedAt:
            new Date().toISOString(),
        })

    vi.spyOn(gameApi, "getGameEnvironmentCatalog").mockResolvedValue({
      minecraftVersions: ["1.21.1", "1.20.1"],
      loaders: ["VANILLA", "NEOFORGE", "FORGE", "FABRIC", "QUILT"],
    })
    vi.spyOn(gameApi, "getGameLoaderVersions").mockResolvedValue([
      { version: "21.1.65", stable: true },
      { version: "21.1.209", stable: true },
    ])

    render(
      <GameFilesExplorer
        theme="dark"
        files={[]}
        isDraft={true}
        minecraftVersion="1.21.1"
        modLoader="NEOFORGE"
        modLoaderVersion="21.1.65"
        onRefresh={onRefresh}
        onToast={onToast}
      />,
    )

    const button =
      screen.getByTestId(
        "button-configure-game-environment",
      )

    expect(
      button.textContent,
    ).toContain("Configurar entorno")

    await act(async () => {
      fireEvent.click(button)
    })

    expect(
      screen.getByTestId(
        "game-environment-modal",
      ),
    ).toBeDefined()

    const neoForgeInput =
      await screen.findByTestId(
        "environment-neoforge-version",
      )

    await act(async () => {
      fireEvent.change(
        neoForgeInput,
        {
          target: {
            value: "21.1.209",
          },
        },
      )
    })

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          "button-save-game-environment",
        ),
      )
    })

    expect(
      updateSpy,
    ).toHaveBeenCalledWith({
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.209",
    })

    expect(
      onRefresh,
    ).toHaveBeenCalled()

    expect(
      onToast,
    ).toHaveBeenCalledWith(
      "Entorno actualizado: Minecraft 1.21.1 · NeoForge 21.1.209.",
      "success",
    )
  })


  it("renders active draft with explorer actions and allows navigating into folders", async () => {
    const mockOverview: import("../../types").AdminGameOverview = {
      publishedRelease: {
        id: "rel-1",
        version: "1.4.2",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
       modLoader: "NEOFORGE",
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
       modLoader: "NEOFORGE",
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
        uniqueVersion: true,
        hasFiles: true,
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
    expect(screen.getByText("Revisar y publicar")).toBeDefined()
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
    expect(screen.getByText("Personalizable")).toBeDefined()
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
       modLoader: "NEOFORGE",
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
    const expandBtn = screen.getByText("Abrir explorador")
    await act(async () => {
      fireEvent.click(expandBtn)
    })

    expect(screen.getByText("Ocultar explorador")).toBeDefined()
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
    const restoreBtn = screen.getByText("Restaurar")
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
      uploadToken: "tok-1",
      expiresAt: new Date().toISOString(),
      maxSizeBytes: 1000000,
      expectedCategory: "MOD",
      objectKey: "game-files/1",
      bucket: "hikat-r2",
      endpoint: "https://r2.test",
      credentials: { accessKeyId: "k", secretAccessKey: "s", sessionToken: "t" },
    })
    const uploadDirectSpy = vi.spyOn(gameFileUploadService, "uploadGameFileDirect").mockResolvedValue({
      sha256: "test-sha",
      sizeBytes: 10,
    })
    const completeUploadSpy = vi.spyOn(gameApi, "completeGameFileUpload").mockResolvedValue({
      tokenHash: "hash-tok",
      sizeBytes: 10,
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
    expect(uploadDirectSpy).toHaveBeenCalledTimes(2)
    expect(completeUploadSpy).toHaveBeenCalledTimes(2)
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
      uploadToken: "tok-2",
      expiresAt: new Date().toISOString(),
      maxSizeBytes: 1000000,
      expectedCategory: "MOD",
      objectKey: "game-files/2",
      bucket: "hikat-r2",
      endpoint: "https://r2.test",
      credentials: { accessKeyId: "k", secretAccessKey: "s", sessionToken: "t" },
    })
    vi.spyOn(gameFileUploadService, "uploadGameFileDirect").mockResolvedValue({
      sha256: "test-sha",
      sizeBytes: 10,
    })
    vi.spyOn(gameApi, "completeGameFileUpload").mockResolvedValue({
      tokenHash: "hash-tok",
      sizeBytes: 10,
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
      modLoader: "NEOFORGE",
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

      // 4. Verify content type tabs and provider tabs (Shard 08D: Game updates has MOD, RESOURCE_PACK, SHADER; DATA_PACK is in Server)
      expect(screen.getByTestId("tab-content-mod")).toBeDefined()
      expect(screen.getByTestId("tab-content-resource_pack")).toBeDefined()
      expect(screen.queryByTestId("tab-content-data_pack")).toBeNull()
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
      modLoader: "NEOFORGE",
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
      modLoader: "NEOFORGE",
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
      try {
        const searchSpy = vi.spyOn(graphqlClient, "searchMods").mockImplementation(async (query, contentType, provider, limit, offset) => {
          return {
            items: [],
            totalCount: 0,
            minecraftVersion: "1.21.1",
            neoForgeVersion: "21.1.65",
           modLoader: "NEOFORGE",
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

        // 2. Immediately switch to Resource Packs tab before debounce timer fires
        await act(async () => {
          fireEvent.click(screen.getByTestId("tab-content-resource_pack"))
        })

        // 3. Advance fake timers
        await act(async () => {
          vi.advanceTimersByTime(500)
        })

        // 4. Verify the search request executed for RESOURCE_PACK and not for old MOD
        expect(searchSpy).toHaveBeenCalledWith("test query", "RESOURCE_PACK", null, 20, 0)
      } finally {
        vi.useRealTimers()
      }
    })

    it("renders optional dependencies section with explicit notice and does not count them in install button", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined)
      const onToast = vi.fn()

      vi.spyOn(graphqlClient, "searchMods").mockResolvedValue({
        items: [
          {
            provider: "MODRINTH",
            projectId: "opt-mod-id",
            name: "OptMod",
            summary: "Mod with optional dep",
            author: "author",
            downloads: 100,
            categories: [],
            contentType: "MOD",
            environment: "BOTH",
          },
        ],
        totalCount: 1,
        providersStatus: [{ provider: "MODRINTH", available: true }],
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      })

      vi.spyOn(graphqlClient, "getModProjectDetail").mockResolvedValue({
        provider: "MODRINTH",
        projectId: "opt-mod-id",
        name: "OptMod",
        summary: "Mod with optional dep",
        author: "author",
        downloads: 100,
        contentType: "MOD",
        environment: "BOTH",
        isInstalled: false,
        compatibleVersions: [
          {
            id: "ver-opt-1",
            versionNumber: "1.0.0",
            name: "1.0.0",
            releaseType: "RELEASE",
            gameVersions: ["1.21.1"],
            loaders: ["neoforge"],
            publishedAt: "2024-08-20T00:00:00Z",
            downloads: 100,
            filename: "opt-1.0.0.jar",
            sizeBytes: 50000,
            dependencies: [],
          },
        ],
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      })

      vi.spyOn(graphqlClient, "resolveModInstallationPlan").mockResolvedValue({
        items: [
          {
            provider: "MODRINTH",
            projectId: "opt-mod-id",
            projectName: "OptMod",
            versionId: "ver-opt-1",
            versionNumber: "1.0.0",
            filename: "opt-1.0.0.jar",
            sizeBytes: 50000,
            contentType: "MOD",
            environment: "BOTH",
            logicalPath: "mods/opt-1.0.0.jar",
            isRoot: true,
            isDependency: false,
            isRequired: true,
            isInstalled: false,
            action: "INSTALL",
            availableCompatibleVersions: [],
          },
        ],
        totalDownloadSizeBytes: 50000,
        conflicts: [],
        optionalDependencies: [
          {
            provider: "MODRINTH",
            projectId: "opt-dep-id",
            projectName: "Optional JEI Integration",
            versionId: "ver-jei-opt",
            versionNumber: "15.0.0",
            filename: "optional.jar",
            sizeBytes: 0,
            contentType: "MOD",
            logicalPath: "mods/optional.jar",
            isRoot: false,
            isDependency: true,
            isRequired: false,
            isInstalled: false,
            action: "ALREADY_INSTALLED",
            availableCompatibleVersions: [],
          },
        ],
        isValid: true,
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

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-open-mod-providers"))
      })

      await waitFor(() => {
        expect(screen.getByTestId("mod-card-modrinth-opt-mod-id")).toBeDefined()
      })

      await act(async () => {
        fireEvent.click(screen.getByTestId("mod-card-modrinth-opt-mod-id"))
      })

      await waitFor(() => {
        expect(screen.getByTestId("mod-detail-modal")).toBeDefined()
        expect(screen.getByTestId("optional-dependencies-section")).toBeDefined()
      })

      expect(screen.getByText("Dependencias opcionales")).toBeDefined()
      expect(screen.getByText("No se instalará automáticamente")).toBeDefined()
      expect(screen.getByText("Optional JEI Integration")).toBeDefined()
      expect(screen.getByText("No instalada (Opcional)")).toBeDefined()

      // The install button must only count 1 item (the root mod), NOT the optional dependency
      const installBtn = screen.getByTestId("button-confirm-install")
      expect(installBtn.textContent).toBe("Añadir a la actualización")
    })

    it("CurseForge Mod with UNKNOWN environment shows environment selector and resolves plan once selected", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined)
      const onToast = vi.fn()

      vi.spyOn(graphqlClient, "searchMods").mockResolvedValue({
        items: [
          {
            provider: "CURSEFORGE",
            projectId: "cf-unknown-1",
            name: "CF Unknown Environment Mod",
            summary: "Unknown environment",
            author: "authorCF",
            downloads: 50000,
            categories: ["utility"],
            contentType: "MOD",
            environment: "UNKNOWN",
          },
        ],
        totalCount: 1,
        providersStatus: [{ provider: "CURSEFORGE", available: true, error: null }],
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
      })

      vi.spyOn(graphqlClient, "getModProjectDetail").mockResolvedValue({
        provider: "CURSEFORGE",
        projectId: "cf-unknown-1",
        name: "CF Unknown Environment Mod",
        summary: "Unknown environment",
        description: "Description",
        author: "authorCF",
        downloads: 50000,
        contentType: "MOD",
        environment: "UNKNOWN",
        compatibleVersions: [
          {
            id: "cf-ver-100",
            name: "1.0.0",
            versionNumber: "1.0.0",
            releaseType: "RELEASE",
            gameVersions: ["1.21.1"],
            loaders: ["neoforge"],
            publishedAt: new Date().toISOString(),
            downloads: 50000,
            filename: "cf-mod.jar",
            sizeBytes: 80000,
            dependencies: [],
          },
        ],
        isInstalled: false,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
      })

      const resolvePlanSpy = vi.spyOn(graphqlClient, "resolveModInstallationPlan").mockResolvedValue({
        items: [
          {
            provider: "CURSEFORGE",
            projectId: "cf-unknown-1",
            projectName: "CF Unknown Environment Mod",
            versionId: "cf-ver-100",
            fileId: "cf-ver-100",
            versionNumber: "1.0.0",
            filename: "cf-mod.jar",
            sizeBytes: 80000,
            sha256: "hash100",
            contentType: "MOD",
            environment: "CLIENT",
            logicalPath: "mods/cf-mod.jar",
            isRoot: true,
            isDependency: false,
            isRequired: true,
            isInstalled: false,
            action: "INSTALL",
            installedFileId: null,
            installedVersionNumber: null,
            availableCompatibleVersions: [],
          },
        ],
        totalDownloadSizeBytes: 80000,
        conflicts: [],
        optionalDependencies: [],
        isValid: true,
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

      // 1. Open search modal
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-open-mod-providers"))
      })

      // 2. Select mod
      const card = await screen.findByTestId("mod-card-curseforge-cf-unknown-1")
      await act(async () => {
        fireEvent.click(card)
      })

      // 3. ModDetailModal opened
      await waitFor(() => {
        expect(screen.getByTestId("mod-detail-modal")).toBeDefined()
      })

      // Verify that resolvePlan was NOT called initially because environment is unknown
      expect(resolvePlanSpy).not.toHaveBeenCalled()

      // Verify environment selector is rendered
      const envSelector = await screen.findByTestId("curseforge-environment-selector")
      expect(envSelector).toBeDefined()
      expect(screen.getByTestId("option-env-client")).toBeDefined()
      expect(screen.getByTestId("option-env-both")).toBeDefined()

      // Select CLIENT option
      const clientOption = screen.getByTestId("option-env-client")
      await act(async () => {
        fireEvent.click(clientOption)
      })

      // Now resolvePlan is called with environmentOverride: "CLIENT"
      await waitFor(() => {
        expect(resolvePlanSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: "CURSEFORGE",
            projectId: "cf-unknown-1",
            versionId: "cf-ver-100",
            environmentOverride: "CLIENT",
          }),
        )
      })

      // Install button is enabled and shows 1 item
      const installBtn = screen.getByTestId("button-confirm-install")
      expect(installBtn.hasAttribute("disabled")).toBe(false)
    })

    it("GameView processes server handoff and directly opens ModDetailModal with BOTH override preselected", async () => {
      const onClearHandoff = vi.fn()

      vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        draftRelease: {
          id: "draft-test",
          version: "draft-123",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          modLoader: "NEOFORGE",
          status: "DRAFT",
          notes: null,
          publishedAt: null,
          coverMediaId: null,
          cover: null,
          files: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        publishedRelease: null,
        pendingChangesCount: 0,
        readiness: {
          isReady: true,
          validVersion: true,
          uniqueVersion: true,
          hasFiles: true,
          noConflicts: true,
          storageVerified: true,
          issues: [],
        },
      })

      vi.spyOn(graphqlClient, "getModProjectDetail").mockResolvedValue({
        provider: "CURSEFORGE",
        projectId: "cf-mod-both",
        name: "CF Both Mod",
        summary: "Both environment mod",
        description: "Description",
        author: "authorCF",
        downloads: 50000,
        contentType: "MOD",
        environment: "UNKNOWN",
        compatibleVersions: [
          {
            id: "ver-both-99",
            name: "1.0.0",
            versionNumber: "1.0.0",
            releaseType: "RELEASE",
            gameVersions: ["1.21.1"],
            loaders: ["neoforge"],
            publishedAt: new Date().toISOString(),
            downloads: 50000,
            filename: "cf-both.jar",
            sizeBytes: 60000,
            dependencies: [],
          },
        ],
        isInstalled: false,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
      })

      const resolvePlanSpy = vi.spyOn(graphqlClient, "resolveModInstallationPlan").mockResolvedValue({
        items: [
          {
            provider: "CURSEFORGE",
            projectId: "cf-mod-both",
            projectName: "CF Both Mod",
            versionId: "ver-both-99",
            fileId: "ver-both-99",
            versionNumber: "1.0.0",
            filename: "cf-both.jar",
            sizeBytes: 60000,
            sha256: "hash99",
            contentType: "MOD",
            environment: "BOTH",
            logicalPath: "mods/cf-both.jar",
            isRoot: true,
            isDependency: false,
            isRequired: true,
            isInstalled: false,
            action: "INSTALL",
            installedFileId: null,
            installedVersionNumber: null,
            availableCompatibleVersions: [],
          },
        ],
        totalDownloadSizeBytes: 60000,
        conflicts: [],
        optionalDependencies: [],
        isValid: true,
      })

      render(
        <GameView
          theme="dark"
          handoff={{
            provider: "CURSEFORGE",
            projectId: "cf-mod-both",
            versionId: "ver-both-99",
            contentType: "MOD",
            environmentOverride: "BOTH",
          }}
          onClearHandoff={onClearHandoff}
        />,
      )

      // ModDetailModal should automatically open with BOTH override and version preselected
      await waitFor(() => {
        expect(screen.getByTestId("mod-detail-modal")).toBeDefined()
      })

      expect(onClearHandoff).toHaveBeenCalled()

      // Verify resolveModInstallationPlan was called with environmentOverride: "BOTH" and versionId: "ver-both-99"
      await waitFor(() => {
        expect(resolvePlanSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: "CURSEFORGE",
            projectId: "cf-mod-both",
            versionId: "ver-both-99",
            environmentOverride: "BOTH",
          }),
        )
      })
    })

    it("GameView with non-existent initialVersionId in handoff does not silently switch versions and blocks install", async () => {
      const onClearHandoff = vi.fn()

      vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        draftRelease: {
          id: "draft-test",
          version: "draft-123",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          modLoader: "NEOFORGE",
          status: "DRAFT",
          notes: null,
          publishedAt: null,
          coverMediaId: null,
          cover: null,
          files: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        publishedRelease: null,
        pendingChangesCount: 0,
        readiness: {
          isReady: true,
          validVersion: true,
          uniqueVersion: true,
          hasFiles: true,
          noConflicts: true,
          storageVerified: true,
          issues: [],
        },
      })

      vi.spyOn(graphqlClient, "getModProjectDetail").mockResolvedValue({
        provider: "CURSEFORGE",
        projectId: "cf-mod-both",
        name: "CF Both Mod",
        summary: "Both environment mod",
        description: "Description",
        author: "authorCF",
        downloads: 50000,
        contentType: "MOD",
        environment: "UNKNOWN",
        compatibleVersions: [
          {
            id: "different-ver-1",
            name: "1.0.0",
            versionNumber: "1.0.0",
            releaseType: "RELEASE",
            gameVersions: ["1.21.1"],
            loaders: ["neoforge"],
            publishedAt: new Date().toISOString(),
            downloads: 50000,
            filename: "cf-both.jar",
            sizeBytes: 60000,
            dependencies: [],
          },
        ],
        isInstalled: false,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
      })

      const resolvePlanSpy = vi.spyOn(graphqlClient, "resolveModInstallationPlan")

      render(
        <GameView
          theme="dark"
          handoff={{
            provider: "CURSEFORGE",
            projectId: "cf-mod-both",
            versionId: "obsolete-server-ver-888",
            contentType: "MOD",
            environmentOverride: "BOTH",
          }}
          onClearHandoff={onClearHandoff}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId("mod-detail-modal")).toBeDefined()
      })

      // Error message is displayed explaining the version is no longer compatible
      const errorNotice = await screen.findByTestId("mod-detail-error")
      expect(errorNotice.textContent).toContain("La versión seleccionada desde Servidor ya no está disponible")

      // resolveModInstallationPlan is NEVER called with a silent fallback version
      expect(resolvePlanSpy).not.toHaveBeenCalled()

      // Install button is disabled
      const installBtn = screen.getByTestId("button-confirm-install")
      expect(installBtn.hasAttribute("disabled")).toBe(true)
    })
  })

  describe("HiKAT Shard 8C: Release Experience & Publication Suite (React & Wizards)", () => {
    const mockDraftRelease: import("../../types").GameRelease = {
      id: "rel-draft-8c",
      version: "draft-1700000000",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
     modLoader: "NEOFORGE",
      status: "DRAFT",
      notes: "Notas iniciales del borrador",
      publishedAt: null,
      coverMediaId: null,
      cover: null,
      files: [
        {
          id: "f-added",
          name: "jei.jar",
          logicalPath: "mods/jei.jar",
          category: "MOD",
          sha256: "hash-jei",
          sizeBytes: 250000,
          policy: "NO_MODIFICABLE",
          explicitPolicy: null,
          effectivePolicy: "NO_MODIFICABLE",
          isInherited: true,
          isDirectory: false,
          changeStatus: "ADDED",
          sourceProvider: "MODRINTH",
          createdAt: new Date().toISOString(),
        },
        {
          id: "f-updated",
          name: "config.toml",
          logicalPath: "config/config.toml",
          category: "CONFIG",
          sha256: "hash-cfg-new",
          sizeBytes: 1500,
          policy: "MODIFICABLE",
          explicitPolicy: null,
          effectivePolicy: "MODIFICABLE",
          isInherited: true,
          isDirectory: false,
          changeStatus: "UPDATED",
          createdAt: new Date().toISOString(),
        },
        {
          id: "tombstone-f-removed",
          name: "old-mod.jar",
          logicalPath: "mods/old-mod.jar",
          category: "MOD",
          sha256: "hash-old",
          sizeBytes: 10000,
          policy: "NO_MODIFICABLE",
          explicitPolicy: null,
          effectivePolicy: "NO_MODIFICABLE",
          isInherited: true,
          isDirectory: false,
          changeStatus: "REMOVED",
          createdAt: new Date().toISOString(),
        },
        {
          id: "f-unchanged",
          name: "unchanged.json",
          logicalPath: "config/unchanged.json",
          category: "CONFIG",
          sha256: "hash-unchanged",
          sizeBytes: 800,
          policy: "MODIFICABLE",
          explicitPolicy: null,
          effectivePolicy: "MODIFICABLE",
          isInherited: true,
          isDirectory: false,
          changeStatus: "UNCHANGED",
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const mockPublishedRelease: import("../../types").GameRelease = {
      id: "rel-pub-8c",
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
     modLoader: "NEOFORGE",
      status: "PUBLISHED",
      notes: "Release 1.0.0",
      publishedAt: "2026-08-20T10:00:00Z",
      coverMediaId: "cover-img-1",
      cover: {
        id: "cover-img-1",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 10240,
        url: "http://localhost/media/content/cover-img-1",
        createdAt: "2026-08-20T10:00:00Z",
      },
      files: [],
      createdAt: "2026-08-20T10:00:00Z",
      updatedAt: "2026-08-20T10:00:00Z",
    }

    const mockChanges: import("../../types").GameDraftChanges = {
      added: 1,
      updated: 1,
      removed: 1,
      unchanged: 1,
      total: 3,
    }

    const mockReadiness: import("../../types").GameDraftReadiness = {
      isReady: true,
      validVersion: true,
      uniqueVersion: true,
      hasFiles: true,
      noConflicts: true,
      storageVerified: true,
      issues: [],
    }

    beforeEach(() => {
      vi.restoreAllMocks()
    })

    afterEach(() => {
      cleanup()
    })

    it("1. versión SemVer inicial sugerida / prellenada (suggestNextPatchVersion)", async () => {
      const onClose = vi.fn()
      const onPublished = vi.fn()

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={onPublished}
        />,
      )

      const versionInput = screen.getByPlaceholderText("Ej. 1.0.1") as HTMLInputElement
      expect(versionInput.value).toBe("1.0.1") // Suggested next patch from 1.0.0
    })

    it("2. versión inválida bloquea avanzar al paso 2 y muestra mensaje de error", async () => {
      const onClose = vi.fn()
      const onPublished = vi.fn()

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={onPublished}
        />,
      )

      const versionInput = screen.getByPlaceholderText("Ej. 1.0.1")
      fireEvent.change(versionInput, { target: { value: "invalid-semver" } })

      const nextBtn = screen.getByText("Siguiente: Revisar cambios →")
      await act(async () => {
        fireEvent.click(nextBtn)
      })

      expect(screen.getByText(/Formato de versión inválido/i)).toBeDefined()
      // Step 2 must NOT be rendered
      expect(screen.queryByText("Resumen de cambios a publicar")).toBeNull()
    })

    it("3. notes se pueden escribir en textarea", async () => {
      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      const notesTextarea = screen.getByPlaceholderText(/Describe los cambios, novedades/i) as HTMLTextAreaElement
      fireEvent.change(notesTextarea, { target: { value: "Nuevas correcciones y shaders." } })
      expect(notesTextarea.value).toBe("Nuevas correcciones y shaders.")
    })

    it("4. Minecraft y NeoForge se muestran en modo solo lectura", async () => {
      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      expect(screen.getByText("1.21.1")).toBeDefined()
      expect(screen.getByText("21.1.65")).toBeDefined()
    })

    it("5. uploader de cover acepta imagen y 7. preview de cover renderiza <img>", async () => {
      const mockImageUpload: import("../../types").ContentMedia = {
        id: "media-img-99",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 2048,
        url: "http://localhost/media/content/media-img-99",
        createdAt: new Date().toISOString(),
      }

      vi.spyOn(mediaUploadService, "uploadMediaFile").mockResolvedValue(mockImageUpload)

      const { container } = render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeDefined()

      const file = new File(["fake-image-bytes"], "cover.png", { type: "image/png" })
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Image preview rendered
      await waitFor(() => {
        const img = screen.getByAltText("Portada de actualización") as HTMLImageElement
        expect(img).toBeDefined()
        expect(img.src).toContain("media-img-99")
        expect(screen.getByText("Reemplazar")).toBeDefined()
        expect(screen.getByText("Quitar")).toBeDefined()
      })
    })

    it("6. uploader de cover acepta video y 7. preview de cover renderiza <video>", async () => {
      const mockVideoUpload: import("../../types").ContentMedia = {
        id: "media-vid-99",
        mediaType: "VIDEO",
        mimeType: "video/mp4",
        sizeBytes: 1048576,
        url: "http://localhost/media/content/media-vid-99",
        createdAt: new Date().toISOString(),
      }

      vi.spyOn(mediaUploadService, "uploadMediaFile").mockResolvedValue(mockVideoUpload)

      const { container } = render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(["fake-video-bytes"], "trailer.mp4", { type: "video/mp4" })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      await waitFor(() => {
        expect(container.querySelector("video")).toBeDefined()
        expect(screen.getByText(/VIDEO \(video\/mp4\)/i)).toBeDefined()
      })
    })

    it("8. botón quitar cover limpia selección", async () => {
      const draftWithCover: import("../../types").GameRelease = {
        ...mockDraftRelease,
        coverMediaId: "cov-1",
        cover: {
          id: "cov-1",
          mediaType: "IMAGE",
          mimeType: "image/webp",
          sizeBytes: 500,
          url: "http://localhost/media/cov-1",
          createdAt: new Date().toISOString(),
        },
      }

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={draftWithCover}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      expect(screen.getByAltText("Portada de actualización")).toBeDefined()
      const removeBtn = screen.getByText("Quitar")
      await act(async () => {
        fireEvent.click(removeBtn)
      })

      expect(screen.queryByAltText("Portada de actualización")).toBeNull()
      expect(screen.getByText(/Arrastra o haz clic para seleccionar imagen o video/i)).toBeDefined()
    })

    it("9. upload en progreso deshabilita botones y muestra spinner", async () => {
      let resolveUpload: (val: any) => void
      const uploadPromise = new Promise((res) => {
        resolveUpload = res
      })
      vi.spyOn(mediaUploadService, "uploadMediaFile").mockReturnValue(uploadPromise as any)

      const { container } = render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(["bytes"], "cover.png", { type: "image/png" })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      expect(screen.getByText(/Subiendo portada a Cloudflare R2.../i)).toBeDefined()
      const nextBtn = screen.getByText("Siguiente: Revisar cambios →") as HTMLButtonElement
      expect(nextBtn.disabled).toBe(true)

      // Resolve upload
      await act(async () => {
        resolveUpload!({
          id: "cov-done",
          mediaType: "IMAGE",
          mimeType: "image/png",
          sizeBytes: 100,
          url: "http://localhost/media/cov-done",
          createdAt: new Date().toISOString(),
        })
      })

      await waitFor(() => {
        expect(nextBtn.disabled).toBe(false)
      })
    })

    it("10. error de upload se muestra sin resetear campos del formulario", async () => {
      vi.spyOn(mediaUploadService, "uploadMediaFile").mockRejectedValue(new Error("Storage limit exceeded"))

      const { container } = render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      const versionInput = screen.getByPlaceholderText("Ej. 1.0.1") as HTMLInputElement
      fireEvent.change(versionInput, { target: { value: "1.0.5" } })

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(["bytes"], "cover.png", { type: "image/png" })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      await waitFor(() => {
        expect(screen.getByText("Storage limit exceeded")).toBeDefined()
      })
      // Form input preserved
      expect(versionInput.value).toBe("1.0.5")
    })

    it("11. Step 2 counters, 12. lista de cambios con tags, 13. tombstones como REMOVED y 14. filtro de cambios", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({
        ...mockDraftRelease,
        version: "1.0.1",
      })
      vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      // Advance to Step 2
      const nextBtn = screen.getByText("Siguiente: Revisar cambios →")
      await act(async () => {
        fireEvent.click(nextBtn)
      })

      // 11. Counters
      expect(screen.getByText("+1 añadidos")).toBeDefined()
      expect(screen.getByText("↑ 1 actualizados")).toBeDefined()
      expect(screen.getByText("− 1 eliminados")).toBeDefined()
      expect(screen.getByText("= 1 sin cambios")).toBeDefined()

      // 12. Tags & 13. Tombstones
      expect(screen.getByText("AÑADIDO")).toBeDefined()
      expect(screen.getByText("ACTUALIZADO")).toBeDefined()
      expect(screen.getByText("ELIMINADO")).toBeDefined()
      expect(screen.getByText("old-mod.jar")).toBeDefined()

      // 14. Change filters
      const addedFilter = screen.getByText("Añadidos (+1)")
      await act(async () => {
        fireEvent.click(addedFilter)
      })

      expect(screen.getByText("jei.jar")).toBeDefined()
      expect(screen.queryByText("old-mod.jar")).toBeNull()

      const removedFilter = screen.getByText("Eliminados (−1)")
      await act(async () => {
        fireEvent.click(removedFilter)
      })

      expect(screen.getByText("old-mod.jar")).toBeDefined()
      expect(screen.queryByText("jei.jar")).toBeNull()
    })

    it("15. Step 3 resumen, 16. readiness checklist, 17. sin checkbox de backup en publicación", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({
        ...mockDraftRelease,
        version: "1.0.1",
      })
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview")
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: { ...mockPublishedRelease, version: "1.0.1" },
        draftRelease: null,
        pendingChangesCount: 0,
      })
      const publishSpy = vi.spyOn(gameApi, "publishGameRelease").mockResolvedValue({
        ...mockDraftRelease,
        status: "PUBLISHED",
        version: "1.0.1",
      })
      vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockResolvedValue({
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: false,
        items: [],
        summary: { toInstall: 0, toUpdate: 0, toRemove: 0, toKeep: 4 },
        serverStatus: "OFFLINE",
        canApply: true,
      })

      const onClose = vi.fn()
      const onPublished = vi.fn()

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={onPublished}
        />,
      )

      // Step 1 -> Step 2
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })

      // Step 2 -> Step 3
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })

      // 15. Summary
      expect(screen.getByText("v1.0.1")).toBeDefined()
      expect(screen.getByText(/MC 1.21.1 • NeoForge 21.1.65/i)).toBeDefined()

      // 16. NO backup checkbox in publish modal
      expect(screen.queryByRole("checkbox")).toBeNull()

      // Publish
      const publishBtn = screen.getByRole("button", { name: /Publicar actualización oficial/i })
      await act(async () => {
        fireEvent.click(publishBtn)
      })

      expect(publishSpy).toHaveBeenCalledWith({
        version: "1.0.1",
        notes: "Notas iniciales del borrador",
        coverMediaId: null,
      })
      expect(onPublished).toHaveBeenCalledWith("1.0.1", 4)
      expect(screen.getByRole("heading", { name: "Actualización publicada", level: 2 })).toBeDefined()
    })

    it("18. publicación exitosa con servidor desconectado: publica correctamente y muestra aviso de servidor no disponible", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({ ...mockDraftRelease, version: "1.0.1" })
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview")
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: { ...mockPublishedRelease, version: "1.0.1" },
        draftRelease: null,
        pendingChangesCount: 0,
      })

      const publishSpy = vi.spyOn(gameApi, "publishGameRelease").mockResolvedValue({
        ...mockDraftRelease,
        status: "PUBLISHED",
        version: "1.0.1",
      })

      // Server is disconnected / plan throws error
      vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockRejectedValue(
        new Error("Pterodactyl offline / disconnected"),
      )

      const onClose = vi.fn()
      const onPublished = vi.fn()

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={onPublished}
        />,
      )

      // Step 1 -> Step 2 -> Step 3
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })

      // Publish
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Publicar actualización oficial/i }))
      })

      expect(publishSpy).toHaveBeenCalled()
      expect(onPublished).toHaveBeenCalledWith("1.0.1", 4)
      expect(screen.getByRole("heading", { name: "Actualización publicada", level: 2 })).toBeDefined()
      expect(screen.getByText(/No se pudo comprobar el estado del servidor en este momento/i)).toBeDefined()
    })

    it("19. post-publish card con servidor OFFLINE: muestra cambios pendientes y clic en revisar llama onReviewServerChanges", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({ ...mockDraftRelease, version: "1.0.1" })
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview")
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: { ...mockPublishedRelease, version: "1.0.1" },
        draftRelease: null,
        pendingChangesCount: 0,
      })

      vi.spyOn(gameApi, "publishGameRelease").mockResolvedValue({
        ...mockDraftRelease,
        status: "PUBLISHED",
        version: "1.0.1",
      })

      const mockPlan = {
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: true,
        items: [
          { action: "INSTALL" as const, filename: "new-mod.jar", targetPath: "mods/new-mod.jar", sizeBytes: 1024, sha256: "h1" },
        ],
        summary: { toInstall: 1, toUpdate: 0, toRemove: 0, toKeep: 3 },
        serverStatus: "OFFLINE" as const,
        canApply: true,
      }

      vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockResolvedValue(mockPlan)

      const onClose = vi.fn()
      const onPublished = vi.fn()
      const onReviewServerChanges = vi.fn()

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={onPublished}
          onReviewServerChanges={onReviewServerChanges}
        />,
      )

      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Publicar actualización oficial/i }))
      })

      // Post publish card is visible
      expect(screen.getByTestId("post-publish-server-changes-card")).toBeDefined()
      expect(screen.getByText(/Servidor apagado y listo/i)).toBeDefined()

      const reviewBtn = screen.getByTestId("button-post-publish-review-server")
      expect(reviewBtn.textContent).toContain("Revisar cambios del servidor")

      await act(async () => {
        fireEvent.click(reviewBtn)
      })

      expect(onReviewServerChanges).toHaveBeenCalledWith(mockPlan)
    })

    it("21. History View: muestra cover, versión, status, fecha, notas y visor de archivos de solo lectura", async () => {
      vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: null,
        pendingChangesCount: 0,
      })
      vi.spyOn(gameApi, "getGameReleaseHistory").mockResolvedValue([
        {
          id: "rel-hist-v100",
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
         modLoader: "NEOFORGE",
          status: "PUBLISHED",
          notes: "Novedades de la versión 1.0.0 con portada e integración total.",
          publishedAt: "2026-08-20T10:00:00Z",
          coverMediaId: "cover-100",
          cover: {
            id: "cover-100",
            mediaType: "IMAGE",
            mimeType: "image/png",
            sizeBytes: 5000,
            url: "http://localhost/media/content/cover-100",
            createdAt: "2026-08-20T10:00:00Z",
          },
          files: [
            {
              id: "hf-1",
              name: "server.properties",
              logicalPath: "server.properties",
              category: "CONFIG",
              sha256: "prop-sha",
              sizeBytes: 500,
              policy: "NO_MODIFICABLE",
              explicitPolicy: null,
              effectivePolicy: "NO_MODIFICABLE",
              isInherited: true,
              isDirectory: false,
              createdAt: "2026-08-20T10:00:00Z",
            },
          ],
          createdAt: "2026-08-20T10:00:00Z",
          updatedAt: "2026-08-20T10:00:00Z",
        },
      ])

      render(<GameView theme="dark" />)

      // Switch to history tab
      const historyTab = screen.getByText("Historial de versiones")
      await act(async () => {
        fireEvent.click(historyTab)
      })

      // Cover, version, status, files, date
      expect(screen.getByAltText("Portada v1.0.0")).toBeDefined()
      expect(screen.getByText("v1.0.0")).toBeDefined()
      expect(screen.getByText("Publicada (Activa)")).toBeDefined()
      expect(screen.getByText(/1 archivos/i)).toBeDefined()

      // Expand to view notes and read-only explorer
      const expandBtn = screen.getByText("Abrir explorador")
      await act(async () => {
        fireEvent.click(expandBtn)
      })

      expect(screen.getByText(/Novedades de la versión 1.0.0 con portada/i)).toBeDefined()
      expect(screen.getByText("server.properties")).toBeDefined()
    })

    it("22. failed metadata cleanup: upload cover A -> falla updateGameDraftMetadata -> deleteContentMedia se llama para A", async () => {
      const deleteMediaSpy = vi.spyOn(graphqlClient, "deleteContentMedia").mockResolvedValue(true)
      vi.spyOn(mediaUploadService, "uploadMediaFile").mockResolvedValue({
        id: "cover-transient-1",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 4096,
        url: "http://localhost/media/content/cover-transient-1",
        createdAt: new Date().toISOString(),
      })
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockRejectedValueOnce(new Error("Database write error"))

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      // Upload Cover A
      const file = new File(["dummy"], "coverA.png", { type: "image/png" })
      const dropzone = screen.getByText(/Arrastra o haz clic para seleccionar imagen o video/i)
      await act(async () => {
        fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })
      })

      expect(screen.getByAltText("Portada de actualización")).toBeDefined()

      // Attempt to advance to Step 2 -> fails
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })

      // Verification: deleteContentMedia was called on cover-transient-1
      expect(deleteMediaSpy).toHaveBeenCalledWith("cover-transient-1")
      expect(screen.getByText(/Database write error/i)).toBeDefined()
      expect(screen.queryByAltText("Portada de actualización")).toBeNull()
    })

    it("23. replace transient cover: upload A -> upload B -> deleteContentMedia se llama para A", async () => {
      const deleteMediaSpy = vi.spyOn(graphqlClient, "deleteContentMedia").mockResolvedValue(true)
      const uploadSpy = vi.spyOn(mediaUploadService, "uploadMediaFile")

      uploadSpy.mockResolvedValueOnce({
        id: "cover-transient-A",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 4096,
        url: "http://localhost/media/content/cover-transient-A",
        createdAt: new Date().toISOString(),
      })

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      // 1. Upload Cover A
      const fileA = new File(["dummyA"], "coverA.png", { type: "image/png" })
      const dropzone = screen.getByText(/Arrastra o haz clic para seleccionar imagen o video/i)
      await act(async () => {
        fireEvent.drop(dropzone, { dataTransfer: { files: [fileA] } })
      })

      expect(screen.getByAltText("Portada de actualización")).toBeDefined()

      // 2. Upload Cover B (replace)
      uploadSpy.mockResolvedValueOnce({
        id: "cover-transient-B",
        mediaType: "IMAGE",
        mimeType: "image/webp",
        sizeBytes: 2048,
        url: "http://localhost/media/content/cover-transient-B",
        createdAt: new Date().toISOString(),
      })

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const fileB = new File(["dummyB"], "coverB.webp", { type: "image/webp" })
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [fileB] } })
      })

      // Verification: Cover A was deleted
      expect(deleteMediaSpy).toHaveBeenCalledWith("cover-transient-A")
    })

    it("24. remove transient cover: upload A -> Quitar -> deleteContentMedia se llama para A", async () => {
      const deleteMediaSpy = vi.spyOn(graphqlClient, "deleteContentMedia").mockResolvedValue(true)
      vi.spyOn(mediaUploadService, "uploadMediaFile").mockResolvedValue({
        id: "cover-transient-to-remove",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 4096,
        url: "http://localhost/media/content/cover-transient-to-remove",
        createdAt: new Date().toISOString(),
      })

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      // Upload Cover
      const file = new File(["dummy"], "cover.png", { type: "image/png" })
      const dropzone = screen.getByText(/Arrastra o haz clic para seleccionar imagen o video/i)
      await act(async () => {
        fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })
      })

      // Click Quitar
      const removeBtn = screen.getByText("Quitar")
      await act(async () => {
        fireEvent.click(removeBtn)
      })

      expect(deleteMediaSpy).toHaveBeenCalledWith("cover-transient-to-remove")
      expect(screen.queryByAltText("Portada de actualización")).toBeNull()
    })

    it("25. close modal transient cleanup: upload A -> cerrar modal -> deleteContentMedia se llama para A", async () => {
      const deleteMediaSpy = vi.spyOn(graphqlClient, "deleteContentMedia").mockResolvedValue(true)
      vi.spyOn(mediaUploadService, "uploadMediaFile").mockResolvedValue({
        id: "cover-transient-on-close",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 4096,
        url: "http://localhost/media/content/cover-transient-on-close",
        createdAt: new Date().toISOString(),
      })

      const onClose = vi.fn()
      const { unmount } = render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={vi.fn()}
        />,
      )

      // Upload Cover
      const file = new File(["dummy"], "cover.png", { type: "image/png" })
      const dropzone = screen.getByText(/Arrastra o haz clic para seleccionar imagen o video/i)
      await act(async () => {
        fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })
      })

      // Cancel button
      const cancelBtn = screen.getByText("Cancelar")
      await act(async () => {
        fireEvent.click(cancelBtn)
      })

      expect(onClose).toHaveBeenCalled()
      expect(deleteMediaSpy).toHaveBeenCalledWith("cover-transient-on-close")

      unmount()
    })

    it("26. review freshness: Step 2 y Step 3 cargan overview fresco y muestran datos en vivo", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({
        ...mockDraftRelease,
        version: "1.0.1",
      })
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: {
          ...mockDraftRelease,
          version: "1.0.1",
          files: [
            ...mockDraftRelease.files,
            {
              id: "fresh-live-file",
              name: "fresh-mod.jar",
              logicalPath: "mods/fresh-mod.jar",
              category: "MOD",
              sha256: "fresh-sha",
              sizeBytes: 1234,
              policy: "MODIFICABLE",
              explicitPolicy: null,
              effectivePolicy: "MODIFICABLE",
              isInherited: true,
              isDirectory: false,
              changeStatus: "ADDED",
              sourceProvider: "MODRINTH",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        changes: {
          added: 2,
          updated: 1,
          removed: 1,
          unchanged: 1,
          total: 5,
        },
        readiness: mockReadiness,
        draftFingerprint: "fingerprint-fresh-123",
        pendingChangesCount: 4,
      })

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      // Step 1 -> Step 2
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })

      // Verify overview was refreshed and fresh data rendered in Step 2
      expect(overviewSpy).toHaveBeenCalled()
      expect(screen.getByText("+2 añadidos")).toBeDefined()
      expect(screen.getByText("fresh-mod.jar")).toBeDefined()
    })

    it("27. failure to refresh overview in Step 3 blocks advance and displays error without silent catch", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({ ...mockDraftRelease, version: "1.0.1" })
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview")

      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={vi.fn()}
          onPublished={vi.fn()}
        />,
      )

      // Step 1 -> Step 2
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })

      // Simulate overview failure when attempting Step 2 -> Step 3
      overviewSpy.mockRejectedValueOnce(new Error("Network disconnect on overview"))

      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })

      // Should remain on Step 2 and show error message
      expect(screen.getByText(/Network disconnect on overview/i)).toBeDefined()
      expect(screen.queryByText("Versión oficial definitiva")).toBeNull()
    })

    it("28. post-publication verification failure: si overview post-publish no coincide o falla, muestra error para recargar y NO re-publica", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({ ...mockDraftRelease, version: "1.0.1" })
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview")

      // Step 1 -> Step 2
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })

      // Step 2 -> Step 3
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease,
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        changes: mockChanges,
        readiness: mockReadiness,
        pendingChangesCount: 2,
      })

      const publishSpy = vi.spyOn(gameApi, "publishGameRelease").mockResolvedValue({
        ...mockDraftRelease,
        status: "PUBLISHED",
        version: "1.0.1",
      })

      // Post-publish verification returns mismatch / stale version
      overviewSpy.mockResolvedValueOnce({
        publishedRelease: mockPublishedRelease, // still "1.0.0"
        draftRelease: { ...mockDraftRelease, version: "1.0.1" },
        pendingChangesCount: 2,
      })

      const onClose = vi.fn()
      const onPublished = vi.fn()

      render(
        <PublishReleaseModal
          theme="dark"
          draftRelease={mockDraftRelease}
          publishedRelease={mockPublishedRelease}
          changes={mockChanges}
          readiness={mockReadiness}
          onClose={onClose}
          onPublished={onPublished}
        />,
      )

      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })

      // Click Publish
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Publicar actualización oficial/i }))
      })

      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(
        screen.getByText(/La publicación fue procesada, pero no pudo verificarse el estado activo/i),
      ).toBeDefined()
      expect(onClose).not.toHaveBeenCalled()
      expect(onPublished).not.toHaveBeenCalled()
    })

    it("30. GameView integracion: publicacion de release -> DRAFT desaparece en backend -> modal permanece visible mostrando pantalla de exito y cambia limpiamente a ServerReleaseSyncModal al pulsar Revisar cambios del servidor", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({ ...mockDraftRelease, version: "1.0.1" })

      // 1. Initial state has a draft release
      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: mockDraftRelease,
        pendingChangesCount: 2,
        changes: mockChanges,
        readiness: mockReadiness,
      })

      const publishSpy = vi.spyOn(gameApi, "publishGameRelease").mockResolvedValue({
        ...mockDraftRelease,
        status: "PUBLISHED",
        version: "1.0.1",
      })

      const pendingPlan = {
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: true,
        items: [
          { action: "INSTALL" as const, filename: "both-mod.jar", targetPath: "mods/both-mod.jar", sizeBytes: 2048, sha256: "h1" },
        ],
        summary: { toInstall: 1, toUpdate: 0, toRemove: 0, toKeep: 2 },
        serverStatus: "OFFLINE" as const,
        canApply: true,
        blockReason: null,
      }

      vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockResolvedValue(pendingPlan)

      render(<GameView theme="dark" />)

      // Click "Revisar y publicar" button in GameView
      const openPublishBtn = await screen.findByRole("button", { name: /Revisar y publicar/i })
      await act(async () => {
        fireEvent.click(openPublishBtn)
      })

      // Wizard modal is open
      expect(screen.getByTestId("publish-release-modal")).toBeDefined()

      // Advance wizard
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })

      // When publish finishes, backend overview will now return draftRelease: null
      overviewSpy.mockResolvedValue({
        publishedRelease: { ...mockDraftRelease, status: "PUBLISHED", version: "1.0.1" },
        draftRelease: null,
        pendingChangesCount: 0,
      })

      // Click Publish button
      const publishBtn = screen.getByRole("button", { name: /Publicar actualización oficial/i })
      await act(async () => {
        fireEvent.click(publishBtn)
      })

      expect(publishSpy).toHaveBeenCalledTimes(1)

      // Post-publish success screen MUST remain visible (NOT unmounted when draft became null)
      expect(screen.getByTestId("publish-release-modal")).toBeDefined()
      expect(screen.getAllByText("Actualización publicada").length).toBeGreaterThan(0)
      expect(screen.getByTestId("post-publish-server-changes-card")).toBeDefined()
      expect(screen.getAllByText("Cambios pendientes en el servidor").length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Servidor apagado y listo/i).length).toBeGreaterThan(0)

      // Click "Revisar cambios del servidor"
      const reviewServerBtn = screen.getByTestId("button-post-publish-review-server")
      await act(async () => {
        fireEvent.click(reviewServerBtn)
      })

      // Publish modal must be closed and ServerReleaseSyncModal must be open (no double overlays)
      expect(screen.queryByTestId("publish-release-modal")).toBeNull()
      expect(screen.getByTestId("server-release-sync-modal")).toBeDefined()
      expect(screen.getByRole("heading", { name: "Aplicar cambios al servidor" })).toBeDefined()
    })

    it("31. GameView integracion: pulsar Cerrar en pantalla post-publicacion cierra PublishReleaseModal y refresca GameView", async () => {
      vi.spyOn(gameApi, "updateGameDraftMetadata").mockResolvedValue({ ...mockDraftRelease, version: "1.0.1" })

      const overviewSpy = vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: mockDraftRelease,
        pendingChangesCount: 2,
        changes: mockChanges,
        readiness: mockReadiness,
      })

      vi.spyOn(gameApi, "publishGameRelease").mockResolvedValue({
        ...mockDraftRelease,
        status: "PUBLISHED",
        version: "1.0.1",
      })

      vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockResolvedValue({
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: false,
        items: [],
        summary: { toInstall: 0, toUpdate: 0, toRemove: 0, toKeep: 2 },
        serverStatus: "OFFLINE" as const,
        canApply: true,
        blockReason: null,
      })

      render(<GameView theme="dark" />)

      const openPublishBtn = await screen.findByRole("button", { name: /Revisar y publicar/i })
      await act(async () => {
        fireEvent.click(openPublishBtn)
      })

      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Revisar cambios →"))
      })
      await act(async () => {
        fireEvent.click(screen.getByText("Siguiente: Confirmación →"))
      })

      overviewSpy.mockResolvedValue({
        publishedRelease: { ...mockDraftRelease, status: "PUBLISHED", version: "1.0.1" },
        draftRelease: null,
        pendingChangesCount: 0,
      })

      const publishBtn = screen.getByRole("button", { name: /Publicar actualización oficial/i })
      await act(async () => {
        fireEvent.click(publishBtn)
      })

      // Success screen visible
      expect(screen.getAllByText("Actualización publicada").length).toBeGreaterThan(0)

      // Click "Cerrar"
      const closeBtn = screen.getByTestId("button-post-publish-close")
      await act(async () => {
        fireEvent.click(closeBtn)
      })

      // Modal is closed
      expect(screen.queryByTestId("publish-release-modal")).toBeNull()
      expect(screen.queryByTestId("server-release-sync-modal")).toBeNull()

      // Overview was refreshed to official version
      expect(screen.getByText("v1.0.1")).toBeDefined()
    })

    it("32. canApply authority: OFFLINE con canApply=false muestra blockReason en post-publish card y banner (no dice listo)", async () => {
      const fsBlockedPlan = {
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: true,
        items: [
          { action: "INSTALL" as const, filename: "mod.jar", targetPath: "mods/mod.jar", sizeBytes: 100, sha256: "h" },
        ],
        summary: { toInstall: 1, toUpdate: 0, toRemove: 0, toKeep: 0 },
        serverStatus: "OFFLINE" as const,
        canApply: false,
        blockReason: "No se pudieron verificar los archivos del servidor.",
      }

      vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: null,
        pendingChangesCount: 0,
      })

      vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockResolvedValue(fsBlockedPlan)

      render(<GameView theme="dark" />)

      const banner = await screen.findByTestId("game-pending-server-changes-banner")
      expect(banner).toBeDefined()
      expect(screen.getByText(/No se pudieron verificar los archivos del servidor/i)).toBeDefined()
      expect(screen.queryByText(/Servidor apagado y listo/i)).toBeNull()
    })

    it("33. canApply authority: ONLINE y DISCONNECTED en GameView banner muestran mensajes amigables", async () => {
      vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
        publishedRelease: mockPublishedRelease,
        draftRelease: null,
        pendingChangesCount: 0,
      })

      const onlinePlan = {
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: true,
        items: [],
        summary: { toInstall: 1, toUpdate: 0, toRemove: 0, toKeep: 0 },
        serverStatus: "ONLINE" as const,
        canApply: false,
        blockReason: "Apaga el servidor antes de aplicar cambios de mods.",
      }

      const syncSpy = vi.spyOn(serverContentApi, "getServerReleaseSyncPlan").mockResolvedValue(onlinePlan)

      const { unmount } = render(<GameView theme="dark" />)

      const bannerOnline = await screen.findByTestId("game-pending-server-changes-banner")
      expect(bannerOnline).toBeDefined()
      expect(screen.getByText(/Apaga el servidor antes de aplicar/i)).toBeDefined()

      unmount()

      const disconnectedPlan = {
        releaseId: "rel-1",
        releaseVersion: "1.0.1",
        isPending: true,
        items: [],
        summary: { toInstall: 1, toUpdate: 0, toRemove: 0, toKeep: 0 },
        serverStatus: "DISCONNECTED" as const,
        canApply: false,
        blockReason: "El servidor no está disponible.",
      }

      syncSpy.mockResolvedValue(disconnectedPlan)

      render(<GameView theme="dark" />)

      const bannerDisc = await screen.findByTestId("game-pending-server-changes-banner")
      expect(bannerDisc).toBeDefined()
      expect(screen.getByText(/El servidor no está disponible/i)).toBeDefined()
    })

    it("34. Silent refresh keeps GameFilesExplorer mounted and preserves currentPath", async () => {
      const initialOverview: import("../../types").AdminGameOverview = {
        publishedRelease: null,
        draftRelease: {
          id: "rel-draft",
          version: "1.5.0-draft",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
         modLoader: "NEOFORGE",
          status: "DRAFT",
          notes: null,
          publishedAt: null,
          files: [
            {
              id: "dir-config",
              name: "config",
              logicalPath: "config",
              category: "CONFIG",
              sha256: "",
              sizeBytes: 0,
              policy: "MODIFICABLE",
              explicitPolicy: null,
              effectivePolicy: "MODIFICABLE",
              isInherited: false,
              isDirectory: true,
              createdAt: new Date().toISOString(),
            },
            {
              id: "file-cfg",
              name: "server.toml",
              logicalPath: "config/server.toml",
              category: "CONFIG",
              sha256: "aabb1122",
              sizeBytes: 256,
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
        pendingChangesCount: 0,
      }

      const getOverviewSpy = vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue(initialOverview)

      render(<GameView theme="dark" />)

      // Wait for initial load
      await screen.findByText("config")

      // Navigate into "config" folder
      const folderItem = screen.getByText("config")
      fireEvent.doubleClick(folderItem)

      // Now inside "config", "server.toml" should be visible
      expect(await screen.findByText("server.toml")).toBeDefined()

      // When overview is refetched silently with updated data
      const updatedOverview = JSON.parse(JSON.stringify(initialOverview))
      getOverviewSpy.mockResolvedValueOnce(updatedOverview)

      // Trigger a silent refresh via gameApi
      await act(async () => {
        const refreshBtn = screen.getByTitle(/Recargar archivos/i)
        fireEvent.click(refreshBtn)
      })

      // The user remains in "config" and still sees "server.toml"
      expect(screen.getByText("server.toml")).toBeDefined()
    })
  })
})



