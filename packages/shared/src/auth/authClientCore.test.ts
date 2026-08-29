import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  AuthClientCore,
  createMemoryStorageAdapter,
  createWebSessionStorageAdapter,
  isJwtExpired,
  parseJwtPayload,
} from "./authClientCore"
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateRandomState,
} from "./pkce"

describe("Unified AuthClientCore Test Suite (Shard 8F Auth Parity & Hardening)", () => {
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
    expect(user.email).toBe("player@hikat.org")
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

  it("4. Refresh rotates tokens and replaces session atomically (double rotation A -> B -> C)", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-A",
      refreshToken: "refresh-A",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    // 1st Rotation: A -> B
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "access-B",
        refreshToken: "refresh-B",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const tokenB = await client.refresh()
    expect(tokenB).toBe("access-B")
    expect(client.getAccessToken()).toBe("access-B")
    expect(client.getRefreshToken()).toBe("refresh-B")
    expect(await storage.loadSession()).toEqual(
      expect.objectContaining({ accessToken: "access-B", refreshToken: "refresh-B" }),
    )

    // 2nd Rotation: B -> C
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "access-C",
        refreshToken: "refresh-C",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const tokenC = await client.refresh()
    expect(tokenC).toBe("access-C")
    expect(client.getAccessToken()).toBe("access-C")
    expect(client.getRefreshToken()).toBe("refresh-C")
    expect(await storage.loadSession()).toEqual(
      expect.objectContaining({ accessToken: "access-C", refreshToken: "refresh-C" }),
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

  it("6. Terminal failure (401 / TOKEN_EXPIRED) clears session and sets UNAUTHENTICATED", async () => {
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

    const outcome = await client.refreshOutcome()

    expect(outcome.kind).toBe("TERMINAL_FAILURE")
    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(client.getAccessToken()).toBeNull()
    expect(client.getSession()).toBeNull()
  })

  it("7. Transient network failure (fetch throws) does NOT clear session", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    const initialSession = {
      accessToken: "access-1",
      refreshToken: "valid-refresh-offline",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" as const },
    }
    await client.setSession(initialSession)

    // Simulate network error / offline
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch (offline)"))

    const outcome = await client.refreshOutcome()

    expect(outcome.kind).toBe("TRANSIENT_FAILURE")
    // Session is PRESERVED! Not wiped!
    expect(client.getStatus()).toBe("AUTHENTICATED")
    expect(client.getSession()?.refreshToken).toBe("valid-refresh-offline")
    expect((await storage.loadSession())?.refreshToken).toBe("valid-refresh-offline")

    // Subsequent refresh when connection is restored succeeds:
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "access-reconnected",
        refreshToken: "refresh-reconnected",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const token = await client.refresh()
    expect(token).toBe("access-reconnected")
    expect(client.getAccessToken()).toBe("access-reconnected")
  })

  it("8. Transient server errors (500, 502, 503, 429) do NOT clear session", async () => {
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-1",
      refreshToken: "valid-refresh-500",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    // 503 Service Unavailable
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "SERVER_UNAVAILABLE" }),
    })

    const outcome503 = await client.refreshOutcome()
    expect(outcome503.kind).toBe("TRANSIENT_FAILURE")
    expect(client.getSession()?.refreshToken).toBe("valid-refresh-500")

    // 429 Too Many Requests
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "RATE_LIMITED" }),
    })

    const outcome429 = await client.refreshOutcome()
    expect(outcome429.kind).toBe("TRANSIENT_FAILURE")
    expect(client.getSession()?.refreshToken).toBe("valid-refresh-500")
  })

  it("9. Proactive ensureValidAccessToken refreshes if token within buffer (60s) or expired", async () => {
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    // Token expiring in 30 seconds (within 60s buffer)
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 30 }))
    const expiringJwt = `${header}.${payload}.sig`

    await client.setSession({
      accessToken: expiringJwt,
      refreshToken: "refresh-for-proactive",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "fresh-proactive-token",
        refreshToken: "fresh-proactive-refresh",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const validToken = await client.ensureValidAccessToken(60)

    expect(validToken).toBe("fresh-proactive-token")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("10. Proactive ensureValidAccessToken returns current token if far from expiry (>60s)", async () => {
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    // Token valid for 10 more minutes
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }))
    const validJwt = `${header}.${payload}.sig`

    await client.setSession({
      accessToken: validJwt,
      refreshToken: "valid-refresh",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    const token = await client.ensureValidAccessToken(60)

    expect(token).toBe(validJwt)
    // NO network refresh called!
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("11. Malformed or unparseable JWT is treated safely as expired", async () => {
    expect(isJwtExpired("not-a-jwt")).toBe(true)
    expect(isJwtExpired("")).toBe(true)
    expect(isJwtExpired("a.b.c")).toBe(true) // No numeric exp in payload

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "malformed-jwt",
      refreshToken: "refresh-valid",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "valid-new-jwt",
        refreshToken: "valid-new-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const result = await client.ensureValidAccessToken(60)
    expect(result).toBe("valid-new-jwt")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("12. Logout clears local session and calls remote revocation (resilient to network failure)", async () => {
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

  it("13. Bootstrap restores valid stored session", async () => {
    const storage = createMemoryStorageAdapter()
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }))
    const validJwt = `${header}.${payload}.sig`

    storage.saveSession({
      accessToken: validJwt,
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
    expect(client.getAccessToken()).toBe(validJwt)
  })

  it("14. Bootstrap rejects stored session with mismatched role", async () => {
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
    expect(await storage.loadSession()).toBeNull()
  })

  it("15. Exchange OAuth code successfully establishes session with role validation", async () => {
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
    expect(user.email).toBe("oauth@hikat.org")
    expect(client.getAccessToken()).toBe("oauth-access")
    expect(client.getStatus()).toBe("AUTHENTICATED")
  })

  it("16. PKCE cryptographic helpers generate valid verifiers, challenges, and random states", async () => {
    const verifier = generateCodeVerifier(64)
    expect(verifier.length).toBe(64)

    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toBeTruthy()
    expect(typeof challenge).toBe("string")
    expect(challenge.length).toBeGreaterThan(30)

    const state = generateRandomState(32)
    expect(state.length).toBe(32)
  })

  it("17. keepSession=true saves to storage adapter; keepSession=false leaves storage empty", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    const payload = {
      accessToken: "acc-1",
      refreshToken: "ref-1",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" as const },
    }

    // With keepSession = false
    await client.setSession(payload, false)
    expect(client.getAccessToken()).toBe("acc-1")
    expect(await storage.loadSession()).toBeNull() // Not persisted

    // With keepSession = true
    await client.setSession(payload, true)
    expect(await storage.loadSession()).toEqual(payload) // Persisted
  })

  it("18. Bootstrap with expired access token calls refresh and rotates session", async () => {
    const storage = createMemoryStorageAdapter()
    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 100 }))
    const expiredJwt = `${expiredHeader}.${expiredPayload}.signature`

    storage.saveSession({
      accessToken: expiredJwt,
      refreshToken: "valid-refresh-token",
      user: { id: "u-exp", email: "p@hikat.org", role: "PLAYER" },
    })

    // Mock refresh endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "refreshed-jwt",
        refreshToken: "rotated-refresh",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-exp", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    const restored = await client.bootstrap()

    expect(restored).not.toBeNull()
    expect(client.getAccessToken()).toBe("refreshed-jwt")
    expect(client.getRefreshToken()).toBe("rotated-refresh")
    expect(client.getStatus()).toBe("AUTHENTICATED")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("19. Bootstrap with expired access token and terminal refresh failure clears storage", async () => {
    const storage = createMemoryStorageAdapter()
    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 100 }))
    const expiredJwt = `${expiredHeader}.${expiredPayload}.signature`

    storage.saveSession({
      accessToken: expiredJwt,
      refreshToken: "invalid-refresh-token",
      user: { id: "u-exp", email: "p@hikat.org", role: "PLAYER" },
    })

    // Mock failed refresh (401 terminal)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "TOKEN_EXPIRED" }),
    })

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    const restored = await client.bootstrap()

    expect(restored).toBeNull()
    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(await storage.loadSession()).toBeNull()
  })

  it("20. getValidAccessTokenOutcome on hard-expired JWT with network failure returns TRANSIENT_FAILURE and preserves session", async () => {
    const storage = createMemoryStorageAdapter()
    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 500 }))
    const expiredJwt = `${expiredHeader}.${expiredPayload}.sig`

    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: expiredJwt,
      refreshToken: "refresh-offline-test",
      user: { id: "u-1", email: "offline@hikat.org", role: "PLAYER" },
    })

    // Simulate network error on refresh
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch (offline / transport loss)"))

    const outcome = await client.getValidAccessTokenOutcome()

    expect(outcome.kind).toBe("TRANSIENT_FAILURE")
    expect(client.getStatus()).toBe("AUTHENTICATED")
    expect(client.getRefreshToken()).toBe("refresh-offline-test")
    expect((await storage.loadSession())?.refreshToken).toBe("refresh-offline-test")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("21. 200 OK /auth/refresh with missing refreshToken fails closed and does NOT persist partial session", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "old-access",
      refreshToken: "initial-refresh",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    // Server returns 200 with accessToken but MISSING refreshToken
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "new-access-only",
        refreshToken: "", // Empty / absent
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
      }),
    })

    const outcome = await client.refreshOutcome()

    expect(outcome.kind).toBe("TERMINAL_FAILURE")
    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(client.getSession()).toBeNull()
    expect(await storage.loadSession()).toBeNull()
  })

  it("22. 200 OK /auth/refresh with missing user.email fails closed and does NOT persist partial session", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "old-access",
      refreshToken: "initial-refresh",
      user: { id: "u-1", email: "p@hikat.org", role: "PLAYER" },
    })

    // Server returns 200 with missing user email
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", role: "PLAYER" }, // Missing email
      }),
    })

    const outcome = await client.refreshOutcome()

    expect(outcome.kind).toBe("TERMINAL_FAILURE")
    expect(client.getStatus()).toBe("UNAUTHENTICATED")
    expect(client.getSession()).toBeNull()
    expect(await storage.loadSession()).toBeNull()
  })

  it("23. Valid rotation persists full updated session (A/A -> valid B/B)", async () => {
    const storage = createMemoryStorageAdapter()
    const client = new AuthClientCore({
      authServiceUrl: "http://localhost:8788",
      allowedRole: "PLAYER",
      storageAdapter: storage,
      fetcher: mockFetch,
    })

    await client.setSession({
      accessToken: "access-A",
      refreshToken: "refresh-A",
      user: { id: "u-1", email: "a@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "access-B",
        refreshToken: "refresh-B",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-1", email: "a@hikat.org", role: "PLAYER" },
      }),
    })

    const outcome = await client.refreshOutcome()

    expect(outcome.kind).toBe("REFRESHED")
    expect(client.getAccessToken()).toBe("access-B")
    expect(client.getRefreshToken()).toBe("refresh-B")
    const persisted = await storage.loadSession()
    expect(persisted?.accessToken).toBe("access-B")
    expect(persisted?.refreshToken).toBe("refresh-B")
    expect(persisted?.user.email).toBe("a@hikat.org")
  })
})


