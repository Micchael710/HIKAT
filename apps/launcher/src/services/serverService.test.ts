// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { serverService } from "./serverService"
import * as apiClientModule from "./apiClient"

describe("Launcher serverService (GraphQL serverStatus Query & Caching)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it("does not call admin GraphQL serverStatus query and returns null when no cache exists", async () => {
    const graphqlSpy = vi.spyOn(apiClientModule, "graphqlClient")

    const result = await serverService.getServerStatus()

    expect(graphqlSpy).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it("falls back to localStorage cache when GraphQL request fails", async () => {
    // Pre-seed cached status
    const cachedPayload = {
      online: true,
      playersOnline: 5,
      maxPlayers: 20,
      latencyMs: 42,
      version: "1.21.1",
    }
    window.localStorage.setItem("hikat_cached_server_status", JSON.stringify(cachedPayload))

    // Mock GraphQL failure
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Network offline",
    })

    const result = await serverService.getServerStatus()

    expect(result).toEqual(cachedPayload)
  })

  it("returns null when GraphQL fails and no cache exists in localStorage", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Server unavailable",
    })

    const result = await serverService.getServerStatus()

    expect(result).toBeNull()
  })

  it("does not expose legacy REST getPlayerStats method", () => {
    expect((serverService as any).getPlayerStats).toBeUndefined()
  })
})

