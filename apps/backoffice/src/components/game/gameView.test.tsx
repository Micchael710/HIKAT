// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import GameView from "./GameView"
import { gameApi } from "../../services/graphqlClient"

describe("Back Office Game & Updates Components (Shard 06.5A)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders published release overview with read-only mods list without technical paths", async () => {
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
            name: "JourneyMap",
            logicalPath: "mods/journeymap-1.21.1.jar",
            category: "MOD",
            sha256: "abc123456789",
            sizeBytes: 2500000,
            policy: "NO_MODIFICABLE",
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

    expect(screen.getByText("Juego y Actualizaciones")).toBeDefined()
    expect(screen.getByText("v1.4.2")).toBeDefined()
    expect(screen.getByText("JourneyMap")).toBeDefined()
    expect(screen.getByText("Mod")).toBeDefined()
    expect(screen.getByText("2.38 MB")).toBeDefined()
    expect(screen.getByText("Preparar actualización")).toBeDefined()

    // Ensure technical logical paths are NOT displayed
    expect(screen.queryByText("mods/journeymap-1.21.1.jar")).toBeNull()
  })

  it("renders active draft banner, change badges, and opens publish modal with readiness", async () => {
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
            id: "file-2",
            name: "Sodium",
            logicalPath: "mods/sodium-1.21.1.jar",
            category: "MOD",
            sha256: "def456",
            sizeBytes: 1500000,
            policy: "NO_MODIFICABLE",
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
    expect(screen.getByText("+ Añadido")).toBeDefined()
    expect(screen.getByText("✓ Lista para publicar")).toBeDefined()
    expect(screen.getByText("Publicar actualización")).toBeDefined()
    expect(screen.getByText("Descartar borrador")).toBeDefined()

    const publishBtn = screen.getByText("Publicar actualización")
    fireEvent.click(publishBtn)

    expect(screen.getByText("Publicar actualización oficial")).toBeDefined()
    expect(screen.getByText("+1 añadidos")).toBeDefined()
    expect(screen.getByText("✓ Lista para publicar inmediatamente")).toBeDefined()
  })

  it("switches to version history tab and renders historical releases", async () => {
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
        files: [],
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
    expect(screen.getByText("Anterior")).toBeDefined()
  })

  it("renders tombstones for removed files with Se eliminará badge and allows restore", async () => {
    const mockOverview: import("../../types").AdminGameOverview = {
      publishedRelease: {
        id: "rel-1",
        version: "1.0.0",
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
        id: "rel-draft",
        version: "1.0.1",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "DRAFT",
        notes: null,
        publishedAt: null,
        files: [
          {
            id: "tombstone-file-1",
            name: "Old Mod",
            logicalPath: "mods/old-mod.jar",
            category: "MOD",
            sha256: "12345",
            sizeBytes: 1000,
            policy: "NO_MODIFICABLE",
            changeStatus: "REMOVED",
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingChangesCount: 1,
      changes: {
        added: 0,
        updated: 0,
        removed: 1,
        unchanged: 0,
        total: 0,
      },
    }

    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue(mockOverview)
    const restoreSpy = vi.spyOn(gameApi, "restoreGameFile").mockResolvedValue({
      id: "file-1",
      name: "Old Mod",
      logicalPath: "mods/old-mod.jar",
      category: "MOD",
      sha256: "12345",
      sizeBytes: 1000,
      policy: "NO_MODIFICABLE",
      createdAt: new Date().toISOString(),
    })

    await act(async () => {
      render(<GameView theme="dark" />)
    })

    expect(screen.getByText("Old Mod")).toBeDefined()
    expect(screen.getByText("− Se eliminará")).toBeDefined()

    const undoBtn = screen.getByText("Deshacer")
    await act(async () => {
      fireEvent.click(undoBtn)
    })

    expect(restoreSpy).toHaveBeenCalledWith("tombstone-file-1")
  })
})

