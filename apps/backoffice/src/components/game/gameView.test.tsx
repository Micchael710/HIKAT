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
    expect(screen.getByText("Modo Solo Lectura (Versión Publicada)")).toBeDefined()
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
})
