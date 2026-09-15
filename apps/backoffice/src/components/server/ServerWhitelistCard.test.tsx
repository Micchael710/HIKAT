// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import ServerWhitelistCard from "./ServerWhitelistCard"
import { serverWhitelistApi } from "../../services/graphqlClient"

vi.mock("../../services/graphqlClient", () => ({
  resolveMediaUrl: vi.fn((url?: string | null) => (url ? (url.startsWith("http") ? url : `http://127.0.0.1:8787${url}`) : "")),
  serverWhitelistApi: {
    getServerWhitelist: vi.fn(),
    setServerWhitelistEnabled: vi.fn(),
    addServerWhitelistPlayer: vi.fn(),
    removeServerWhitelistPlayer: vi.fn(),
    getHikatWhitelistCandidates: vi.fn(),
  },
}))

describe("ServerWhitelistCard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(serverWhitelistApi.getHikatWhitelistCandidates).mockResolvedValue([])
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

  it("suggests registered candidates in autocomplete dropdown and selects one on click", async () => {
    vi.mocked(serverWhitelistApi.getServerWhitelist).mockResolvedValue({
      enabled: true,
      mode: "HIKAT",
      entries: [{ name: "Alex", addedAt: null }],
    })
    vi.mocked(serverWhitelistApi.getHikatWhitelistCandidates).mockResolvedValue([
      { displayName: "Alex", skinImageUrl: "/media/alex.png" },
      { displayName: "vBrayan06", skinImageUrl: "/media/custom.png" },
      { displayName: "Steve", skinImageUrl: null },
    ])

    render(<ServerWhitelistCard theme="dark" serverId="srv-1" />)

    await waitFor(() => {
      expect(screen.getByText("Alex")).toBeDefined()
    })

    const input = screen.getByPlaceholderText("Nombre del jugador...")
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "vB" } })

    await waitFor(() => {
      expect(screen.getByTestId("candidates-dropdown")).toBeDefined()
      // "Alex" is already in whitelist, so only "vBrayan06" matches "vB" and is not in entries
      expect(screen.getByText("vBrayan06")).toBeDefined()
    })

    // Click candidate suggestion
    const candidateBtn = screen.getByText("vBrayan06")
    fireEvent.mouseDown(candidateBtn)

    expect((input as HTMLInputElement).value).toBe("vBrayan06")
  })

  it("limits autocomplete suggestions to a maximum of 8 candidates", async () => {
    vi.mocked(serverWhitelistApi.getServerWhitelist).mockResolvedValue({
      enabled: true,
      mode: "HIKAT",
      entries: [],
    })
    const mockCandidates = Array.from({ length: 15 }, (_, i) => ({
      displayName: `Player_${i + 1}`,
      skinImageUrl: i % 2 === 0 ? `/media/skin_${i + 1}.png` : null,
    }))
    vi.mocked(serverWhitelistApi.getHikatWhitelistCandidates).mockResolvedValue(mockCandidates)

    render(<ServerWhitelistCard theme="dark" serverId="srv-1" />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Nombre del jugador...")).toBeDefined()
    })

    const input = screen.getByPlaceholderText("Nombre del jugador...")
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "Player_" } })

    await waitFor(() => {
      const dropdown = screen.getByTestId("candidates-dropdown")
      expect(dropdown).toBeDefined()
      // Exactly 8 suggestion buttons should be rendered
      const buttons = dropdown.querySelectorAll("button")
      expect(buttons.length).toBe(8)
    })
  })
})
