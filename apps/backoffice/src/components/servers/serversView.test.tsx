// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import ServersView from "./ServersView"
import DeleteServerModal from "./DeleteServerModal"
import CreateServerModal from "./CreateServerModal"
import ServerSettingsView from "./ServerSettingsView"
import { serverApi, gameApi } from "../../services/graphqlClient"
import * as mediaUploadService from "../../services/mediaUploadService"
import type { ServerItem } from "../../types"

const mockServers: ServerItem[] = [
  {
    id: "srv-1",
    name: "HiKAT Survival",
    minecraftVersion: "1.20.1",
    modLoader: "FABRIC",
    modLoaderVersion: "0.15.11",
    cpu: 200,
    memoryMb: 4096,
    diskMb: 10240,
    accentColor: "#3ec4c0",
    provisioningStatus: "READY",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "srv-2",
    name: "HiKAT RPG",
    minecraftVersion: "1.20.1",
    modLoader: "FORGE",
    modLoaderVersion: "47.2.0",
    cpu: 400,
    memoryMb: 8192,
    diskMb: 20480,
    accentColor: "#f5a623",
    provisioningStatus: "PROVISIONING",
    createdAt: "2026-08-02T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
  },
  {
    id: "srv-3",
    name: "HiKAT Minijuegos",
    minecraftVersion: "1.19.4",
    modLoader: "VANILLA",
    cpu: 100,
    memoryMb: 2048,
    diskMb: 5120,
    accentColor: "#ef4444",
    provisioningStatus: "FAILED",
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
  },
]

describe("Multiserver Backoffice - ServersView", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(serverApi, "getServers").mockResolvedValue(mockServers)
  })

  afterEach(() => {
    cleanup()
  })

  it("renders server list with badges and responds to search filter", async () => {
    const onSelectServer = vi.fn()

    await act(async () => {
      render(
        <ServersView
          theme="dark"
          onSelectServer={onSelectServer}
        />,
      )
    })

    expect(screen.getByText("HiKAT Survival")).toBeDefined()
    expect(screen.getByText("HiKAT RPG")).toBeDefined()
    expect(screen.getByText("HiKAT Minijuegos")).toBeDefined()
    expect(screen.getByText("Listo")).toBeDefined()
    expect(screen.getByText("Aprovisionando")).toBeDefined()
    expect(screen.getByText("Error")).toBeDefined()

    // Test search filter
    const searchInput = screen.getByPlaceholderText("Buscar servidor...")
    fireEvent.change(searchInput, { target: { value: "Survival" } })

    expect(screen.queryByText("HiKAT RPG")).toBeNull()
    expect(screen.getByText("HiKAT Survival")).toBeDefined()

    // Click server workspace button
    const enterBtn = screen.getByText("Gestionar servidor")
    fireEvent.click(enterBtn)
    expect(onSelectServer).toHaveBeenCalledWith(mockServers[0])
  })

  it("opens create server modal when clicking Create Server button", async () => {
    await act(async () => {
      render(
        <ServersView
          theme="dark"
          onSelectServer={vi.fn()}
        />,
      )
    })

    const createBtn = screen.getByText("Crear Servidor")
    fireEvent.click(createBtn)

    expect(screen.getByText("Crear nuevo servidor")).toBeDefined()
    expect(screen.getByText("1. General")).toBeDefined()
  })
})

describe("Multiserver Backoffice - DeleteServerModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders both deletion choices and executes onConfirm with deletePterodactyl: false", async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <DeleteServerModal
        isOpen={true}
        server={mockServers[0]}
        isLoading={false}
        onConfirm={onConfirm}
        onClose={onClose}
        theme="dark"
      />,
    )

    expect(screen.getByText("Eliminar servidor")).toBeDefined()
    expect(screen.getByText("Eliminar solo de HiKAT")).toBeDefined()
    expect(screen.getByText("Eliminar también de Pterodactyl")).toBeDefined()

    // By default deletePterodactyl is false
    const confirmBtn = screen.getByText("Confirmar Eliminación")
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it("executes onConfirm with deletePterodactyl: true when full deletion radio is selected", async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <DeleteServerModal
        isOpen={true}
        server={mockServers[0]}
        isLoading={false}
        onConfirm={onConfirm}
        onClose={onClose}
        theme="dark"
      />,
    )

    // Select second radio option
    const pterodactylRadio = screen.getByText("Eliminar también de Pterodactyl")
    fireEvent.click(pterodactylRadio)

    expect(screen.getByText(/Atención: Los datos del servidor en Pterodactyl se perderán definitivamente/i)).toBeDefined()

    const confirmBtn = screen.getByText("Confirmar Eliminación")
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    expect(onConfirm).toHaveBeenCalledWith(true)
  })
})

describe("Multiserver Backoffice - CreateServerModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(gameApi, "getGameEnvironmentCatalog").mockResolvedValue({
      minecraftVersions: ["1.20.1", "1.19.4"],
      loaders: ["FABRIC", "FORGE", "NEOFORGE", "QUILT", "VANILLA"],
    })
    vi.spyOn(gameApi, "getGameLoaderVersions").mockResolvedValue([
      { version: "0.15.11", stable: true },
      { version: "0.15.10", stable: false },
    ])
  })

  afterEach(() => {
    cleanup()
  })

  it("completes 5-step creation wizard with manual accent color and creates server", async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const createSpy = vi.spyOn(serverApi, "createServer").mockResolvedValue({
      id: "srv-new",
      name: "Servidor Test",
      minecraftVersion: "1.20.1",
      modLoader: "FABRIC",
      modLoaderVersion: "0.15.11",
      cpu: 200,
      memoryMb: 4096,
      diskMb: 10240,
      accentColor: "#3ec4c0",
      provisioningStatus: "PROVISIONING",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    })

    await act(async () => {
      render(
        <CreateServerModal
          isOpen={true}
          onClose={onClose}
          onCreated={onCreated}
          theme="dark"
        />,
      )
    })

    // Step 1: General
    expect(screen.getByText("Nombre del servidor")).toBeDefined()
    const nameInput = screen.getByPlaceholderText("Ej. HiKAT Survival, HiKAT RPG...")
    fireEvent.change(nameInput, { target: { value: "Servidor Test" } })

    // Next to Step 2
    fireEvent.click(screen.getByText("Siguiente: Entorno"))

    // Step 2: Environment
    expect(screen.getByText("Mod Loader")).toBeDefined()
    fireEvent.click(screen.getByText("Siguiente: Recursos"))

    // Step 3: Resources
    expect(screen.getByText("Límite de CPU (%)")).toBeDefined()
    fireEvent.click(screen.getByText("Siguiente: Apariencia"))

    // Step 4: Appearance (Manual Color Picker + HEX)
    expect(screen.getByText("Color de Acento del Servidor")).toBeDefined()
    expect(screen.getByText("Vista previa de acento")).toBeDefined()
    fireEvent.click(screen.getByText("Siguiente: Resumen"))

    // Step 5: Summary & Confirmation
    expect(screen.getByText("Resumen de Configuración")).toBeDefined()
    expect(screen.getByText("Servidor Test")).toBeDefined()
    expect(screen.getByText("HiKAT/games/Servidor Test")).toBeDefined()
    expect(screen.queryByText(/Versión de Java/i)).toBeNull()
    expect(screen.queryByText(/Descripción/i)).toBeNull()
    expect(screen.queryByText(/Servidor por defecto/i)).toBeNull()

    // Submit
    const submitBtn = screen.getByText("Crear Servidor")
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    expect(createSpy).toHaveBeenCalledWith({
      name: "Servidor Test",
      minecraftVersion: "1.20.1",
      modLoader: "FABRIC",
      modLoaderVersion: "0.15.11",
      cpu: 200,
      memoryMb: 4096,
      diskMb: 10240,
      mainLogoMediaId: undefined,
      sidebarLogoMediaId: undefined,
      accentColor: "#3ec4c0",
    })

    expect(onCreated).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("displays catalog error and retry button without manual version inputs on catalog load failure", async () => {
    vi.spyOn(gameApi, "getGameEnvironmentCatalog").mockRejectedValue(new Error("Error de red"))

    await act(async () => {
      render(
        <CreateServerModal
          isOpen={true}
          onClose={vi.fn()}
          onCreated={vi.fn()}
          theme="dark"
        />,
      )
    })

    // Advance to Step 2
    const nameInput = screen.getByPlaceholderText("Ej. HiKAT Survival, HiKAT RPG...")
    fireEvent.change(nameInput, { target: { value: "Servidor Test" } })
    fireEvent.click(screen.getByText("Siguiente: Entorno"))

    expect(screen.getByText(/No se pudo cargar el catálogo de versiones/i)).toBeDefined()
    expect(screen.getByText("Reintentar cargar catálogo")).toBeDefined()
    expect(screen.queryByPlaceholderText("1.21.1")).toBeNull()
  })

  it("rejects server name with leading or trailing whitespace and does not advance or call createServer", async () => {
    const createSpy = vi.spyOn(serverApi, "createServer")

    await act(async () => {
      render(
        <CreateServerModal
          isOpen={true}
          onClose={vi.fn()}
          onCreated={vi.fn()}
          theme="dark"
        />,
      )
    })

    const nameInput = screen.getByPlaceholderText("Ej. HiKAT Survival, HiKAT RPG...")
    fireEvent.change(nameInput, { target: { value: " Servidor Con Espacios " } })
    fireEvent.click(screen.getByText("Siguiente: Entorno"))

    expect(screen.getByText("El nombre del servidor no puede empezar ni terminar con espacios.")).toBeDefined()
    expect(screen.queryByText("Mod Loader")).toBeNull()
    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe("Multiserver Backoffice - ServerSettingsView", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders server hardware, environment, local folder and branding specs", () => {
    render(
      <ServerSettingsView
        theme="dark"
        server={mockServers[0]}
      />,
    )

    expect(screen.getByText("Ajustes del Servidor")).toBeDefined()
    expect(screen.getByText("HiKAT/games/HiKAT Survival")).toBeDefined()
    expect(screen.getByText("srv-1")).toBeDefined()
    expect(screen.getByText("Minecraft 1.20.1")).toBeDefined()
    expect(screen.getByText("FABRIC (0.15.11)")).toBeDefined()
    expect(screen.getByText("200%")).toBeDefined()
    expect(screen.getByText("4 GB")).toBeDefined()
    expect(screen.getByText("10 GB")).toBeDefined()
    expect(screen.getByPlaceholderText("#3ec4c0")).toBeDefined()
  })

  it("D1. guardar sin cambiar un logo -> conserva su media ID", async () => {
    const updateSpy = vi.spyOn(serverApi, "updateServerBranding").mockResolvedValue({
      ...mockServers[0],
      accentColor: "#112233",
    })
    const onUpdatedSpy = vi.fn()

    const serverWithLogos = {
      ...mockServers[0],
      mainLogo: { id: "main-media-id", url: "https://example.com/main.png" } as any,
      sidebarLogo: { id: "side-media-id", url: "https://example.com/side.png" } as any,
    }

    render(
      <ServerSettingsView
        theme="dark"
        server={serverWithLogos}
        onServerUpdated={onUpdatedSpy}
      />,
    )

    const accentInput = screen.getByPlaceholderText("#3ec4c0")
    fireEvent.change(accentInput, { target: { value: "#112233" } })

    const saveBtn = screen.getByText("Guardar Branding")
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(updateSpy).toHaveBeenCalledWith("srv-1", {
      mainLogoMediaId: "main-media-id",
      sidebarLogoMediaId: "side-media-id",
      accentColor: "#112233",
    })
    expect(onUpdatedSpy).toHaveBeenCalled()
  })

  it("D2. cambiar logo principal -> uploadMediaFile solo para ese archivo", async () => {
    const uploadSpy = vi.spyOn(mediaUploadService, "uploadMediaFile").mockResolvedValue({
      id: "new-main-id",
      url: "https://example.com/new-main.png",
    } as any)
    const updateSpy = vi.spyOn(serverApi, "updateServerBranding").mockResolvedValue({
      ...mockServers[0],
    })

    const serverWithLogos = {
      ...mockServers[0],
      mainLogo: { id: "old-main-id", url: "https://example.com/old.png" } as any,
      sidebarLogo: { id: "keep-side-id", url: "https://example.com/side.png" } as any,
    }

    const { container } = render(
      <ServerSettingsView
        theme="dark"
        server={serverWithLogos}
      />,
    )

    const fileInputs = container.querySelectorAll('input[type="file"]')
    const mainFileInput = fileInputs[0]
    const dummyFile = new File(["dummy"], "logo.png", { type: "image/png" })

    await act(async () => {
      fireEvent.change(mainFileInput, { target: { files: [dummyFile] } })
    })

    const saveBtn = screen.getByText("Guardar Branding")
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(uploadSpy).toHaveBeenCalledWith(dummyFile, "IMAGE")

    expect(updateSpy).toHaveBeenCalledWith("srv-1", {
      mainLogoMediaId: "new-main-id",
      sidebarLogoMediaId: "keep-side-id",
      accentColor: "#3ec4c0",
    })
  })
})
