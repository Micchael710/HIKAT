import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  AuthClientCore,
  createMemoryStorageAdapter,
  createWebSessionStorageAdapter,
} from "./authClientCore"
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateRandomState,
} from "./pkce"

describe("Unified AuthClientCore Test Suite (Shard 8F Auth Parity)", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  it("1. Valid login establishes session and notifies subscribers", async () => {
    const userPayload = {
      id: "u-1",
      email: "player@hikat.org",
      displayName: "PlayerOne",
      role: "PLAYER" as const,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresIn: 900,
        tokenType: "Bearer",
        user: userPayload,
      }),
    })

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    const listener = vi.fn()
    client.subscribe(listener)

    const user = await client.login("player@hikat.org", "Password123!")

    expect(user.id).toBe("u-1")
    expect(client.getAccessToken()).toBe("access-1")
    expect(client.getRefreshToken()).toBe("refresh-1")
    expect(client.getStatus()).toBe("AUTHENTICATED")
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-1", user: userPayload }),
      "AUTHENTICATED",
    )
  })

  it("2. Wrong role for Launcher is strictly rejected and session is revoked", async () => {
    const adminUser = {
      id: "u-admin",
      email: "admin@hikat.org",
      displayName: "AdminUser",
      role: "ADMIN" as const,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "admin-access",
        refreshToken: "admin-refresh",
        expiresIn: 900,
        tokenType: "Bearer",
        user: adminUser,
      }),
    })

    // Mock logout revocation fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })

    const launcherClient = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    await expect(launcherClient.login("admin@hikat.org", "Pass123!")).rejects.toThrow(
      /Rol de cuenta no autorizado para el Launcher/,
    )

    expect(launcherClient.getStatus()).toBe("UNAUTHENTICATED")
    expect(launcherClient.getAccessToken()).toBeNull()
    // Verifies remote revocation was triggered
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("3. Wrong role for Backoffice (PLAYER) is rejected and session revoked", async () => {
    const playerUser = {
      id: "u-player",
      email: "player@hikat.org",
      displayName: "PlayerUser",
      role: "PLAYER" as const,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "player-access",
        refreshToken: "player-refresh",
        expiresIn: 900,
        tokenType: "Bearer",
        user: playerUser,
      }),
    })

    // Mock logout revocation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })

    const backofficeClient = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "ADMIN",
      fetcher: mockFetch,
    })

    await expect(backofficeClient.login("player@hikat.org", "Pass123!")).rejects.toThrow(
      /Se requiere cuenta con permisos de Administrador/,
    )

    expect(backofficeClient.getStatus()).toBe("UNAUTHENTICATED")
    expect(backofficeClient.getAccessToken()).toBeNull()
  })

  it("4. Refresh rotates tokens and replaces session atomically", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const newAccessToken = await client.refresh()

    expect(newAccessToken).toBe("access-2")
    expect(client.getAccessToken()).toBe("access-2")
    expect(client.getRefreshToken()).toBe("refresh-2")
    expect(storage.loadSession()).toEqual(
      expect.objectContaining({ accessToken: "access-2", refreshToken: "refresh-2" }),
    )
  })

  it("5. Concurrent requests trigger single-flight refresh (only 1 HTTP request)", async () => {
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                accessToken: "access-rotated",
                refreshToken: "refresh-rotated",
                expiresIn: 900,
                tokenType: "Bearer",
                user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
              }),
            })
          }, 20)
        }),
    )

    // Trigger 4 concurrent refresh requests (like simultaneous skin/cape calls)
    const [t1, t2, t3, t4] = await Promise.all([
      client.refresh(),
      client.refresh(),
      client.refresh(),
      client.refresh(),
    ])

    expect(t1).toBe("access-rotated")
    expect(t2).toBe("access-rotated")
    expect(t3).toBe("access-rotated")
    expect(t4).toBe("access-rotated")

    // Exactly 1 network request was sent!
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("6. Refresh failure clears session and sets UNAUTHENTICATED", async () => {
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-1",
      refreshToken: "refresh-revoked",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "TOKEN_EXPIRED", message: "Token has expired" }),
    })

    const token = await client.refresh()

    expect(token).toBeNull()
    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(client.getAccessToken()).toBeNull()
    expect(client.getSession()).toBeNull()
  })

  it("7. Logout clears local session and calls remote revocation (resilient to network failure)", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    // Network error on remote logout
    mockFetch.mockRejectedValueOnce(new Error("Network disconnect"))

    await client.logout()

    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(client.getSession()).toBeNull()
    expect(storage.loadSession()).toBeNull()
  })

  it("8. Bootstrap restores valid stored session", async () => {
    const storage = createMemoryStorageAdapter()
    storage.saveSession({
      accessToken: "saved-access",
      refreshToken: "saved-refresh",
      user: { id: "u-saved", email: "saved@hikat.org", role: "ADMIN" },
    })

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "ADMIN",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    const restored = await client.bootstrap()

    expect(restored).not.toBeNull()
    expect(restored?.user.id).toBe("u-saved")
    expect(client.getStatus()).toBe("AUTHENTICATED")
    expect(client.getAccessToken()).toBe("saved-access")
  })

  it("9. Bootstrap rejects stored session with mismatched role", async () => {
    const storage = createMemoryStorageAdapter()
    storage.saveSession({
      accessToken: "saved-access",
      refreshToken: "saved-refresh",
      user: { id: "u-saved", email: "saved@hikat.org", role: "PLAYER" }, // PLAYER in ADMIN app
    })

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "ADMIN",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    const restored = await client.bootstrap()

    expect(restored).toBeNull()
    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(client.getSession()).toBeNull()
    expect(storage.loadSession()).toBeNull()
  })

  it("10. Exchange OAuth code successfully establishes session with role validation", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "oauth-access",
        refreshToken: "oauth-refresh",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-oauth", email: "oauth@hikat.org", role: "PLAYER" },
      }),
    })

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    const user = await client.exchangeOAuthCode({
      code: "hikat-code-123",
      codeVerifier: "verifier-abc",
      redirectUri: "hikat://auth/callback",
    })

    expect(user.id).toBe("u-oauth")
    expect(client.getAccessToken()).toBe("oauth-access")
    expect(client.getStatus()).toBe("AUTHENTICATED")
  })

  it("11. PKCE cryptographic helpers generate valid verifiers, challenges, and random states", async () => {
    const verifier = generateCodeVerifier(64)
    expect(verifier.length).toBe(64)

    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toBeTruthy()
    expect(typeof challenge).toBe("string")
    expect(challenge.length).toBeGreaterThan(30)

    const state = generateRandomState(32)
    expect(state.length).toBe(32)
  })
})
