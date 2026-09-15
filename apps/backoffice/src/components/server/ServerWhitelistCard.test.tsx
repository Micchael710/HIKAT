// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import ServerWhitelistCard from "./ServerWhitelistCard"
import { serverWhitelistApi } from "../../services/graphqlClient"

vi.mock("../../services/graphqlClient", () => ({
  serverWhitelistApi: {
    getServerWhitelist: vi.fn(),
    setServerWhitelistEnabled: vi.fn(),
    addServerWhitelistPlayer: vi.fn(),
    removeServerWhitelistPlayer: vi.fn(),
  },
}))

describe("ServerWhitelistCard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("loads and displays HiKAT whitelist state and players", async () => {
    vi.mocked(serverWhitelistApi.getServerWhitelist).mockResolvedValue({
      enabled: true,
      mode: "HIKAT",
      entries: [
        { name: "vBrayan06", addedAt: "2026-01-01" },
        { name: "Steve", addedAt: "2026-01-02" },
      ],
    })

    render(<ServerWhitelistCard theme="dark" serverId="srv-1" />)

    expect(screen.getByText(/Cargando whitelist.../i)).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText("Whitelist (2)")).toBeDefined()
      expect(screen.getByText("Whitelist de HiKAT")).toBeDefined()
      expect(screen.getByText("Activada")).toBeDefined()
      expect(screen.getByText("vBrayan06")).toBeDefined()
      expect(screen.getByText("Steve")).toBeDefined()
    })
  })

  it("toggles whitelist enabled state when button clicked", async () => {
    vi.mocked(serverWhitelistApi.getServerWhitelist).mockResolvedValue({
      enabled: false,
      mode: "MINECRAFT_NATIVE",
      entries: [],
    })
    vi.mocked(serverWhitelistApi.setServerWhitelistEnabled).mockResolvedValue({
      enabled: true,
      mode: "MINECRAFT_NATIVE",
      entries: [],
    })

    const onToast = vi.fn()
    render(<ServerWhitelistCard theme="dark" serverId="srv-1" onToast={onToast} />)

    await waitFor(() => {
      expect(screen.getByText("Desactivada")).toBeDefined()
    })

    fireEvent.click(screen.getByText("Desactivada"))

    await waitFor(() => {
      expect(serverWhitelistApi.setServerWhitelistEnabled).toHaveBeenCalledWith("srv-1", true)
      expect(onToast).toHaveBeenCalledWith("Whitelist activada correctamente", "success")
      expect(screen.getByText("Activada")).toBeDefined()
    })
  })

  it("adds player through input form and removes player on trash click", async () => {
    vi.mocked(serverWhitelistApi.getServerWhitelist).mockResolvedValue({
      enabled: true,
      mode: "HIKAT",
      entries: [{ name: "Alex", addedAt: null }],
    })
    vi.mocked(serverWhitelistApi.addServerWhitelistPlayer).mockResolvedValue({
      enabled: true,
      mode: "HIKAT",
      entries: [
        { name: "Alex", addedAt: null },
        { name: "vBrayan06", addedAt: null },
      ],
    })
    vi.mocked(serverWhitelistApi.removeServerWhitelistPlayer).mockResolvedValue({
      enabled: true,
      mode: "HIKAT",
      entries: [{ name: "vBrayan06", addedAt: null }],
    })

    render(<ServerWhitelistCard theme="dark" serverId="srv-1" />)

    await waitFor(() => {
      expect(screen.getByText("Alex")).toBeDefined()
    })

    // Add player
    const input = screen.getByPlaceholderText("Nombre del jugador...")
    fireEvent.change(input, { target: { value: "vBrayan06" } })
    fireEvent.click(screen.getByText("Añadir"))

    await waitFor(() => {
      expect(serverWhitelistApi.addServerWhitelistPlayer).toHaveBeenCalledWith("srv-1", "vBrayan06")
      expect(screen.getByText("vBrayan06")).toBeDefined()
    })

    // Remove player
    const removeAlexBtn = screen.getByTitle("Eliminar Alex")
    fireEvent.click(removeAlexBtn)

    await waitFor(() => {
      expect(serverWhitelistApi.removeServerWhitelistPlayer).toHaveBeenCalledWith("srv-1", "Alex")
    })
  })
})
