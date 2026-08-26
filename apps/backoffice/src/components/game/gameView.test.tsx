// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import GameView from "./GameView"
import { gameApi } from "../../services/graphqlClient"

describe("Back Office Game & Updates Components (Shard 06.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders published release overview with mods list", async () => {
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
    expect(screen.getByText("Versión Oficial v1.4.2")).toBeDefined()
    expect(screen.getByText("JourneyMap")).toBeDefined()
    expect(screen.getByText("mods/journeymap-1.21.1.jar")).toBeDefined()
    expect(screen.getByText("2.4 MB")).toBeDefined()
    expect(screen.getByText("Preparar actualización")).toBeDefined()
  })

  it("renders active draft banner and allows opening publish modal", async () => {
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
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingChangesCount: 1,
    }

    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue(mockOverview)

    await act(async () => {
      render(<GameView theme="dark" />)
    })

    expect(screen.getByText("Borrador de actualización en curso")).toBeDefined()
    expect(screen.getByText("Publicar actualización")).toBeDefined()
    expect(screen.getByText("Descartar borrador")).toBeDefined()

    const publishBtn = screen.getByText("Publicar actualización")
    fireEvent.click(publishBtn)

    expect(screen.getByText("Número de versión")).toBeDefined()
    expect(screen.getByText("Publicar ahora")).toBeDefined()
  })
})
