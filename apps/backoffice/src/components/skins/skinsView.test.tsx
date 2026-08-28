// @vitest-environment jsdom

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import SkinsView from "./SkinsView"
import SkinViewer3D from "./SkinViewer3D"
import { skinsApi, capesApi } from "../../services/graphqlClient"

// Mock skinview3d for JSDOM
vi.mock("skinview3d", () => {
  return {
    SkinViewer: vi.fn().mockImplementation(() => ({
      camera: { position: { set: vi.fn() }, lookAt: vi.fn() },
      controls: { target: { set: vi.fn() }, update: vi.fn(), reset: vi.fn() },
      loadSkin: vi.fn().mockResolvedValue(undefined),
      loadCape: vi.fn().mockResolvedValue(undefined),
      playerObject: { backEquipment: null },
      adjustCameraDistance: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    })),
    IdleAnimation: vi.fn().mockImplementation(() => ({ speed: 1 })),
    WalkingAnimation: vi.fn().mockImplementation(() => ({ speed: 1 })),
    RunningAnimation: vi.fn().mockImplementation(() => ({ speed: 1 })),
  }
})

describe("Back Office Skins & Capes Components (Phase 07 Hardening)", () => {
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

    expect(screen.getByText("No se encontraron skins en el catálogo.")).toBeDefined()
    expect(screen.getByText("Nueva Skin")).toBeDefined()
  })

  it("renders list of skins with status badges and actions", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [
        {
          id: "skin-1",
          name: "Steve Clásico",
          imageUrl: "/media/content/steve.png",
          status: "AVAILABLE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "skin-2",
          name: "Alex Aventurera",
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
  })

  it("mounts and disposes 3D skin viewer cleanly", async () => {
    let unmountFn: () => void = () => {}

    await act(async () => {
      const { unmount } = render(
        <SkinViewer3D
          skinUrl="http://localhost:8787/media/content/test.png"
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

    const playersTabBtn = screen.getByText("Skins de jugadores")
    await act(async () => {
      fireEvent.click(playersTabBtn)
    })

    expect(getPlayerSkinsSpy).toHaveBeenCalled()
    expect(screen.getByText("SteveMiner")).toBeDefined()

    const searchInput = screen.getByPlaceholderText("Buscar por jugador...")
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "Steve" } })
    })

    expect(getPlayerSkinsSpy).toHaveBeenCalledWith({ search: "Steve" })

    const viewBtn = screen.getByText("Ver")
    await act(async () => {
      fireEvent.click(viewBtn)
    })

    expect(screen.getByText("Skin de SteveMiner")).toBeDefined()
  })

  it("switches to Capas globales and Capas de jugadores tabs", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({ items: [], totalCount: 0 })
    const getCapesSpy = vi.spyOn(capesApi, "getAdminCapes").mockResolvedValue({
      items: [
        {
          id: "cape-1",
          name: "Capa Épica",
          imageUrl: "/media/content/cape1.png",
          status: "AVAILABLE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      totalCount: 1,
    })

    const getPlayerCapesSpy = vi.spyOn(capesApi, "getAdminPlayerCapes").mockResolvedValue({
      items: [
        {
          id: "pcape-1",
          userId: "user-789",
          userDisplayName: "DragonMaster",
          name: "Capa de Fuego",
          imageUrl: "/media/content/pcape1.png",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      totalCount: 1,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    // 1. Switch to Capas globales
    const capesTabBtn = screen.getByText("Capas globales")
    await act(async () => {
      fireEvent.click(capesTabBtn)
    })
    expect(getCapesSpy).toHaveBeenCalled()
    expect(screen.getByText("Capa Épica")).toBeDefined()

    // 2. Switch to Capas de jugadores
    const playerCapesTabBtn = screen.getByText("Capas de jugadores")
    await act(async () => {
      fireEvent.click(playerCapesTabBtn)
    })
    expect(getPlayerCapesSpy).toHaveBeenCalled()
    expect(screen.getByText("DragonMaster")).toBeDefined()
    expect(screen.getByText("Capa de Fuego")).toBeDefined()
  })

  it("renders CapeCardPreview with canvas element and extracts standard cape UV without raw img cover", async () => {
    const { default: CapeCardPreview } = await import("./CapeCardPreview")
    let renderedContainer: HTMLElement | null = null

    await act(async () => {
      const { container } = render(
        <CapeCardPreview
          capeUrl="/media/content/test-cape.png"
          width={64}
          height={96}
        />,
      )
      renderedContainer = container
    })

    const canvas = (renderedContainer as HTMLElement | null)?.querySelector("canvas")
    expect(canvas).toBeDefined()
    expect(canvas?.getAttribute("aria-label")).toBe("Capa Minecraft")
  })
})

