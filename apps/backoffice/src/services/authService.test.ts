import { describe, it, expect, beforeEach, vi } from "vitest"
import { authService } from "./authService"

describe("Back Office AuthService", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("successfully authenticates an ADMIN user and keeps tokens in memory", async () => {
    const mockUser = {
      id: "admin-1",
      displayName: "Admin User",
      role: "ADMIN" as const,
      minecraftUsername: "admin_mc",
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "admin-jwt-token",
        refreshToken: "admin-refresh-token",
        expiresIn: 900,
        tokenType: "Bearer",
        user: mockUser,
      }),
    } as Response)

    const user = await authService.login("admin@hikat.org", "AdminPass123!")

    expect(user).toEqual(mockUser)
    expect(authService.getAccessToken()).toBe("admin-jwt-token")
    expect(authService.getUser()).toEqual(mockUser)
  })

  it("rejects login if user role is not ADMIN", async () => {
    const mockPlayerUser = {
      id: "player-1",
      displayName: "Player User",
      role: "PLAYER" as const,
      minecraftUsername: "player_mc",
    }

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: "player-jwt-token",
          refreshToken: "player-refresh-token",
          expiresIn: 900,
          tokenType: "Bearer",
          user: mockPlayerUser,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response)

    await expect(
      authService.login("player@hikat.org", "PlayerPass123!"),
    ).rejects.toThrow("Acceso denegado: Se requiere cuenta con permisos de Administrador")

    expect(authService.getAccessToken()).toBeNull()
    expect(authService.getUser()).toBeNull()
  })

  it("handles token refresh with rotation and notifies subscribers", async () => {
    const mockUser = {
      id: "admin-1",
      displayName: "Admin User",
      role: "ADMIN" as const,
    }

    const listener = vi.fn()
    const unsubscribe = authService.subscribe(listener)

    authService.setSession("old-jwt", "refresh-tok-1", mockUser)
    expect(listener).toHaveBeenCalledWith(mockUser)

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "new-jwt-token",
        refreshToken: "new-refresh-token-rotated",
        expiresIn: 900,
        tokenType: "Bearer",
        user: mockUser,
      }),
    } as Response)

    const newToken = await authService.refresh()
    expect(newToken).toBe("new-jwt-token")
    expect(authService.getAccessToken()).toBe("new-jwt-token")

    unsubscribe()
  })

  it("clears memory and notifies subscribers on failed refresh", async () => {
    const mockUser = {
      id: "admin-1",
      displayName: "Admin User",
      role: "ADMIN" as const,
    }

    const listener = vi.fn()
    authService.subscribe(listener)
    authService.setSession("old-jwt", "expired-refresh-tok", mockUser)

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "TOKEN_EXPIRED" }),
    } as Response)

    const result = await authService.refresh()
    expect(result).toBeNull()
    expect(authService.getAccessToken()).toBeNull()
    expect(authService.getUser()).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it("clears memory on logout", async () => {
    const mockUser = {
      id: "admin-1",
      displayName: "Admin User",
      role: "ADMIN" as const,
    }

    authService.setSession("token-to-clear", "refresh-to-clear", mockUser)

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response)

    await authService.logout()

    expect(authService.getAccessToken()).toBeNull()
    expect(authService.getUser()).toBeNull()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({
        method: "POST",
      }),
    )
  })
})
