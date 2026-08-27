// @vitest-environment jsdom

import React from "react"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"

import SkinsView from "./SkinsView"

import SkinViewer3D from "./SkinViewer3D"

import { skinsApi } from "../../services/graphqlClient"

// Mock skinview3d for JSDOM

vi.mock("skinview3d", () => {
  return {
    SkinViewer: vi.fn().mockImplementation(() => ({
      camera: { position: { set: vi.fn() }, lookAt: vi.fn() },

      controls: { target: { set: vi.fn() }, update: vi.fn(), reset: vi.fn() },

      loadSkin: vi.fn().mockResolvedValue(undefined),

      adjustCameraDistance: vi.fn(),

      render: vi.fn(),

      dispose: vi.fn(),
    })),

    IdleAnimation: vi.fn().mockImplementation(() => ({ speed: 1 })),

    WalkingAnimation: vi.fn().mockImplementation(() => ({ speed: 1 })),

    RunningAnimation: vi.fn().mockImplementation(() => ({ speed: 1 })),
  }
})

describe("Back Office Skins Components (Shard 06.5A)", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    HTMLCanvasElement.prototype.getContext = (vi.fn().mockReturnValue({
      clearRect: vi.fn(),

      drawImage: vi.fn(),
    }) as any)
  })

  afterEach(() => {
    cleanup()
  })

  it("renders empty state when no skins are returned", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [],

      totalCount: 0,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    expect(screen.getByText("No hay skins registradas")).toBeDefined()

    expect(screen.getByText("Subir primera skin")).toBeDefined()
  })

  it("renders list of skins with badges, model type, and actions", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [
        {
          id: "skin-1",

          name: "Steve Clásico",

          model: "CLASSIC",

          imageUrl: "/media/content/steve.png",

          status: "AVAILABLE",

          createdAt: new Date().toISOString(),

          updatedAt: new Date().toISOString(),
        },

        {
          id: "skin-2",

          name: "Alex Aventurera",

          model: "SLIM",

          imageUrl: "/media/content/alex.png",

          status: "UNAVAILABLE",

          createdAt: new Date().toISOString(),

          updatedAt: new Date().toISOString(),
        },
      ],

      totalCount: 2,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    expect(screen.getByText("Steve Clásico")).toBeDefined()

    expect(screen.getByText("Alex Aventurera")).toBeDefined()

    expect(screen.getByText("Clásico (4px)")).toBeDefined()

    expect(screen.getByText("Delgado (3px)")).toBeDefined()

    expect(screen.getByText("Disponible")).toBeDefined()

    expect(screen.getByText("Oculto")).toBeDefined()
  })

  it("opens create skin modal on Nueva Skin button click", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [],

      totalCount: 0,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    const newBtn = screen.getByText("Nueva Skin")

    fireEvent.click(newBtn)

    expect(screen.getByText("Nombre de la Skin")).toBeDefined()

    expect(screen.getByText("Modelo detectado")).toBeDefined()
  })

  it("mounts and disposes 3D skin viewer cleanly", async () => {
    let unmountFn: () => void = () => {}

    await act(async () => {
      const { unmount } = render(
        <SkinViewer3D
          skinUrl="http://localhost:8787/media/content/test.png"
          model="CLASSIC"
          theme="dark"
        />,
      )

      unmountFn = unmount
    })

    expect(screen.getByTitle("Cambiar animación")).toBeDefined()

    expect(screen.getByTitle("Rotación automática")).toBeDefined()

    unmountFn()
  })

  it("switches to Skins de jugadores tab, searches, and opens player skin modal", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [],

      totalCount: 0,
    })

    const mockPlayerSkins = [
      {
        id: "pskin-1",

        userId: "user-123",

        userDisplayName: "SteveMiner",

        model: "CLASSIC" as const,

        imageUrl: "/media/content/player-skin-1.png",

        createdAt: new Date().toISOString(),

        updatedAt: new Date().toISOString(),
      },
    ]

    const getPlayerSkinsSpy = vi
      .spyOn(skinsApi, "getAdminPlayerSkins")
      .mockResolvedValue({
        items: mockPlayerSkins,

        totalCount: 1,
      })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    // Click on Skins de jugadores tab

    const playersTabBtn = screen.getByText("Skins de jugadores")

    await act(async () => {
      fireEvent.click(playersTabBtn)
    })

    expect(getPlayerSkinsSpy).toHaveBeenCalled()

    expect(screen.getByText("SteveMiner")).toBeDefined()

    expect(screen.getByPlaceholderText("Buscar por jugador...")).toBeDefined()

    // Test search filter

    const searchInput = screen.getByPlaceholderText("Buscar por jugador...")

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "Steve" } })
    })

    expect(getPlayerSkinsSpy).toHaveBeenCalledWith({ search: "Steve" })

    // Open view modal

    const viewBtn = screen.getByText("Ver")

    await act(async () => {
      fireEvent.click(viewBtn)
    })

    expect(screen.getByText("Skin de SteveMiner")).toBeDefined()
  })
})
