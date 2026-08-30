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

  it("queries live server status via GraphQL serverStatus query and caches result in localStorage", async () => {
    const graphqlSpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        serverStatus: {
          status: "ONLINE",
          cpuPercent: 12.5,
          memoryUsedBytes: 1024 * 1024 * 512,
          diskUsedBytes: 1024 * 1024 * 1024,
          uptimeMs: 3600000,
          isSuspended: false,
        },
      },
    })

    const apiSpy = vi.spyOn(apiClientModule, "apiClient")

    const result = await serverService.getServerStatus()

    expect(result).toBeDefined()
    expect(result?.online).toBe(true)
    expect(result?.playersOnline).toBe(1)
    expect(result?.maxPlayers).toBe(20)

    // Verify GraphQL query was executed
    expect(graphqlSpy).toHaveBeenCalledTimes(1)
    expect(graphqlSpy.mock.calls[0][0]).toContain("serverStatus")

    // CRITICAL: Verify REST /server/status was NEVER called
    expect(apiSpy).not.toHaveBeenCalledWith("/server/status")

    // Verify cached in localStorage
    const cached = window.localStorage.getItem("hikat_cached_server_status")
    expect(cached).toBeDefined()
    expect(JSON.parse(cached!).online).toBe(true)
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

    const apiSpy = vi.spyOn(apiClientModule, "apiClient")

    const result = await serverService.getServerStatus()

    expect(result).toEqual(cachedPayload)
    expect(apiSpy).not.toHaveBeenCalledWith("/server/status")
  })

  it("returns null when GraphQL fails and no cache exists in localStorage", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Server unavailable",
    })

    const apiSpy = vi.spyOn(apiClientModule, "apiClient")

    const result = await serverService.getServerStatus()

    expect(result).toBeNull()
    expect(apiSpy).not.toHaveBeenCalledWith("/server/status")
  })
})
