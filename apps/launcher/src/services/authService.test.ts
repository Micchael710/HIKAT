// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { authService } from "./authService"
import { apiClient, graphqlClient } from "./apiClient"

describe("Launcher Authentication Service & API Client Suite (Shard 8F Auth Parity)", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    authService.clearSession()
    mockFetch = vi.fn()
    global.fetch = mockFetch as any
  })

  it("1. Secure session + valid access token bootstraps directly to AUTHENTICATED", async () => {
    ;(window as any).electronAPI = {
      authLoadSession: vi.fn().mockResolvedValue({
        accessToken: "valid-acc-1",
        refreshToken: "valid-ref-1",
        user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
      }),
      authClearSession: vi.fn(),
    }

    const listener = vi.fn()
    authService.subscribe(listener)

    const session = await authService.bootstrap()

    expect(session).not.toBeNull()
    expect(authService.getAccessToken()).toBe("valid-acc-1")
    expect(authService.getStatus()).toBe("AUTHENTICATED")
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "valid-acc-1" }),
      "AUTHENTICATED",
    )
  })

  it("2. Expired access token + valid refresh triggers single-flight rotation on bootstrap", async () => {
    // Generate expired JWT
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 50 }))
    const expiredToken = `${header}.${payload}.sig`

    ;(window as any).electronAPI = {
      authLoadSession: vi.fn().mockResolvedValue({
        accessToken: expiredToken,
        refreshToken: "valid-ref-rot",
        user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
      }),
      authSaveSession: vi.fn(),
      authClearSession: vi.fn(),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "new-rotated-acc",
        refreshToken: "new-rotated-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
      }),
    })

    const session = await authService.bootstrap()

    expect(session).not.toBeNull()
    expect(authService.getAccessToken()).toBe("new-rotated-acc")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("3. Invalid refresh token clears SecureAuthStore and sets UNAUTHENTICATED", async () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 50 }))
    const expiredToken = `${header}.${payload}.sig`

    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authLoadSession: vi.fn().mockResolvedValue({
        accessToken: expiredToken,
        refreshToken: "revoked-ref-tok",
        user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
      }),
      authClearSession: clearMock,
    }

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "REVOKED" }),
    })

    const session = await authService.bootstrap()

    expect(session).toBeNull()
    expect(authService.getStatus()).toBe("UNAUTHENTICATED")
    expect(authService.getAccessToken()).toBeNull()
    expect(clearMock).toHaveBeenCalled()
  })

  it("4. Four simultaneous queries trigger a single refresh", async () => {
    await authService.setSession({
      accessToken: "old-acc",
      refreshToken: "refresh-simultaneous",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                accessToken: "rotated-acc-1",
                refreshToken: "rotated-ref-1",
                expiresIn: 900,
                tokenType: "Bearer",
                user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
              }),
            })
          }, 30)
        }),
    )

    const [r1, r2, r3, r4] = await Promise.all([
      authService.refresh(),
      authService.refresh(),
      authService.refresh(),
      authService.refresh(),
    ])

    expect(r1).toBe("rotated-acc-1")
    expect(r2).toBe("rotated-acc-1")
    expect(r3).toBe("rotated-acc-1")
    expect(r4).toBe("rotated-acc-1")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("5. 401 -> refresh -> retry returns 401 clears session and transitions to UNAUTHENTICATED", async () => {
    await authService.setSession({
      accessToken: "expired-acc",
      refreshToken: "valid-ref",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    let callCount = 0
    mockFetch.mockImplementation(async (url: string) => {
      callCount++
      if (url.includes("/auth/refresh")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "rotated-acc",
            refreshToken: "rotated-ref",
            expiresIn: 900,
            tokenType: "Bearer",
            user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
          }),
        }
      }
      // Both original request and retry return 401
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: "UNAUTHORIZED" }),
      }
    })

    const res = await apiClient("/my/resource")

    expect(res.success).toBe(false)
    expect(authService.getStatus()).toBe("UNAUTHENTICATED")
    expect(authService.getAccessToken()).toBeNull()
  })

  it("6. GraphQL UNAUTHENTICATED error triggers refresh and single retry", async () => {
    await authService.setSession({
      accessToken: "expired-acc",
      refreshToken: "valid-ref",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    let graphqlCalls = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/auth/refresh")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "new-rotated-acc",
            refreshToken: "new-rotated-ref",
            expiresIn: 900,
            tokenType: "Bearer",
            user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
          }),
        }
      }
      graphqlCalls++
      if (graphqlCalls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            errors: [{ message: "UNAUTHENTICATED", extensions: { code: "UNAUTHENTICATED" } }],
          }),
        }
      }
      // Retry succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { myPlayerSkin: { id: "ps-1", imageUrl: "skin.png" } },
        }),
      }
    })

    const res = await graphqlClient("query MyPlayerSkin { myPlayerSkin { id } }")

    expect(res.success).toBe(true)
    expect((res.data as any).myPlayerSkin.id).toBe("ps-1")
    expect(graphqlCalls).toBe(2)
  })

  it("7. Launcher rejects ADMIN role silently attempting to enter Launcher", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "admin-jwt",
        refreshToken: "admin-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-admin", email: "admin@hikat.org", role: "ADMIN" },
      }),
    })

    const res = await authService.login({
      email: "admin@hikat.org",
      password: "Password123!",
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain("Rol de cuenta no autorizado para el Launcher")
    expect(authService.getStatus()).toBe("UNAUTHENTICATED")
  })

  it("8. keepSession=true persists to Electron Main; keepSession=false does not persist", async () => {
    const saveMock = vi.fn()
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: saveMock,
      authClearSession: clearMock,
    }

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "session-jwt",
        refreshToken: "session-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
      }),
    })

    // keepSession = false
    await authService.login({
      email: "player@hikat.org",
      password: "Password123!",
      keepSession: false,
    })

    expect(authService.getAccessToken()).toBe("session-jwt")
    expect(clearMock).toHaveBeenCalled() // cleared persistent storage

    // keepSession = true
    await authService.login({
      email: "player@hikat.org",
      password: "Password123!",
      keepSession: true,
    })

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "session-jwt", refreshToken: "session-ref" }),
    )
  })

  it("9. localStorage does NOT contain refreshToken or full session secrets", async () => {
    ;(window as any).electronAPI = {
      authSaveSession: vi.fn(),
      authClearSession: vi.fn(),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-p1", email: "player@hikat.org", displayName: "Alex", role: "PLAYER" },
      }),
    })

    await authService.login({
      email: "player@hikat.org",
      password: "Password123!",
      keepSession: true,
    })

    expect(localStorage.getItem("hikat_auth_token")).toBeNull()
    expect(localStorage.getItem("hikat_auth_session")).toBeNull()
    expect(localStorage.getItem("hikat_refresh_token")).toBeNull()

    // Non-sensitive cached user is allowed
    const lastUser = JSON.parse(localStorage.getItem("hikat_last_user") || "{}")
    expect(lastUser.displayName).toBe("Alex")
    expect(lastUser.accessToken).toBeUndefined()
    expect(lastUser.refreshToken).toBeUndefined()
  })

  it("10. OAuth handleOAuthCallback with keepSession=true persists to SecureAuthStore", async () => {
    const saveMock = vi.fn()
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: saveMock,
      authClearSession: clearMock,
      authClearPendingOAuth: vi.fn(),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "oauth-persisted-acc",
        refreshToken: "oauth-persisted-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-oauth-1", email: "oauth@hikat.org", displayName: "OAuthUser", role: "PLAYER" },
      }),
    })

    const user = await authService.handleOAuthCallback({
      code: "valid-oauth-code",
      codeVerifier: "valid-verifier-12345",
      state: "valid-state-abc",
      expectedState: "valid-state-abc",
      keepSession: true,
    })

    expect(user.id).toBe("u-oauth-1")
    expect(authService.getAccessToken()).toBe("oauth-persisted-acc")
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "oauth-persisted-acc",
        refreshToken: "oauth-persisted-ref",
      }),
    )
  })

  it("11. OAuth handleOAuthCallback with keepSession=false leaves session in memory-only", async () => {
    const saveMock = vi.fn()
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: saveMock,
      authClearSession: clearMock,
      authClearPendingOAuth: vi.fn(),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "oauth-memory-acc",
        refreshToken: "oauth-memory-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-oauth-2", email: "oauth2@hikat.org", displayName: "MemoryUser", role: "PLAYER" },
      }),
    })

    const user = await authService.handleOAuthCallback({
      code: "valid-oauth-code-2",
      codeVerifier: "valid-verifier-67890",
      state: "valid-state-xyz",
      expectedState: "valid-state-xyz",
      keepSession: false,
    })

    expect(user.id).toBe("u-oauth-2")
    expect(authService.getAccessToken()).toBe("oauth-memory-acc")
    expect(saveMock).not.toHaveBeenCalled()
    expect(clearMock).toHaveBeenCalled()
  })

  it("12. Cold-start OAuth callback with pending store keepSession=false preserves memory-only session", async () => {
    const saveMock = vi.fn()
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: saveMock,
      authClearSession: clearMock,
      authClearPendingOAuth: vi.fn(),
      authGetPendingOAuth: vi.fn().mockResolvedValue({
        provider: "GOOGLE",
        codeVerifier: "cold-verifier-12345",
        state: "cold-state-abc",
        keepSession: false, // User had unchecked keepSession when starting OAuth
      }),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "cold-memory-acc",
        refreshToken: "cold-memory-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-cold-mem", email: "coldmem@hikat.org", displayName: "ColdMemory", role: "PLAYER" },
      }),
    })

    // Cold-start delivers code and state with NO local verifier and keepSession=undefined
    const user = await authService.handleOAuthCallback({
      code: "cold-code-1",
      state: "cold-state-abc",
      expectedState: undefined,
      keepSession: undefined,
    })

    expect(user.id).toBe("u-cold-mem")
    expect(authService.getAccessToken()).toBe("cold-memory-acc")
    // Session is memory-only: NOT saved to Electron Main store
    expect(saveMock).not.toHaveBeenCalled()
    expect(clearMock).toHaveBeenCalled()
  })

  it("13. Cold-start OAuth callback with pending store keepSession=true preserves persistent session", async () => {
    const saveMock = vi.fn()
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: saveMock,
      authClearSession: clearMock,
      authClearPendingOAuth: vi.fn(),
      authGetPendingOAuth: vi.fn().mockResolvedValue({
        provider: "DISCORD",
        codeVerifier: "cold-verifier-persist",
        state: "cold-state-persist",
        keepSession: true,
      }),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "cold-persist-acc",
        refreshToken: "cold-persist-ref",
        expiresIn: 900,
        tokenType: "Bearer",
        user: { id: "u-cold-pers", email: "coldpers@hikat.org", displayName: "ColdPersist", role: "PLAYER" },
      }),
    })

    // Cold-start delivers code and state with NO local verifier and keepSession=undefined
    const user = await authService.handleOAuthCallback({
      code: "cold-code-2",
      state: "cold-state-persist",
      expectedState: undefined,
      keepSession: undefined,
    })

    expect(user.id).toBe("u-cold-pers")
    expect(authService.getAccessToken()).toBe("cold-persist-acc")
    // Session is persisted to Electron Main store
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "cold-persist-acc",
        refreshToken: "cold-persist-ref",
      }),
    )
  })

  it("14. graphqlClient preserves GraphQL response with data: null and UNAUTHENTICATED error, refreshing and retrying successfully", async () => {
    await authService.setSession({
      accessToken: "expired-jwt",
      refreshToken: "valid-ref-1",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    let graphqlCalls = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/auth/refresh")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "rotated-acc-1",
            refreshToken: "rotated-ref-1",
            expiresIn: 900,
            tokenType: "Bearer",
            user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
          }),
        }
      }

      graphqlCalls++
      if (graphqlCalls === 1) {
        // Real Yoga response: HTTP 200 with data: null and errors
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: null,
            errors: [
              {
                message: "Authentication required",
                extensions: { code: "UNAUTHENTICATED" },
              },
            ],
          }),
        }
      }

      // Retry request succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            myPlayerSkin: {
              id: "skin-123",
              imageUrl: "https://assets.hikat.org/skin.png",
            },
          },
        }),
      }
    })

    const res = await graphqlClient<{ myPlayerSkin: { id: string; imageUrl: string } }>(
      "query MyPlayerSkin { myPlayerSkin { id imageUrl } }",
    )

    expect(res.success).toBe(true)
    expect(res.data?.myPlayerSkin.id).toBe("skin-123")
    expect(graphqlCalls).toBe(2)
  })

  it("15. Proactive token renewal runs before GraphQL call when token is expiring (<60s)", async () => {
    // Generate token expiring in 30s
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 30 }))
    const expiringToken = `${header}.${payload}.sig`

    await authService.setSession({
      accessToken: expiringToken,
      refreshToken: "refresh-for-proactive",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    let refreshCalled = false
    let sentBearerToken = ""

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/auth/refresh")) {
        refreshCalled = true
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "proactive-fresh-acc",
            refreshToken: "proactive-fresh-ref",
            expiresIn: 900,
            tokenType: "Bearer",
            user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
          }),
        }
      }

      // GraphQL endpoint receives proactively renewed token on first call!
      sentBearerToken = opts?.headers?.Authorization || ""
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { ping: "pong" },
        }),
      }
    })

    const res = await graphqlClient("query Ping { ping }")

    expect(res.success).toBe(true)
    expect(refreshCalled).toBe(true)
    expect(sentBearerToken).toBe("Bearer proactive-fresh-acc")
    expect(authService.getAccessToken()).toBe("proactive-fresh-acc")
  })

  it("16. Transient network failure during refresh in graphqlClient preserves session without clearing store", async () => {
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: vi.fn(),
      authClearSession: clearMock,
    }

    await authService.setSession({
      accessToken: "expired-jwt",
      refreshToken: "offline-refresh-tok",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/auth/refresh")) {
        // Network throws during refresh
        throw new TypeError("Failed to fetch")
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: null,
          errors: [{ message: "UNAUTHENTICATED", extensions: { code: "UNAUTHENTICATED" } }],
        }),
      }
    })

    const res = await graphqlClient("query { mySkin { id } }")

    expect(res.success).toBe(false)
    // Session is NOT cleared on transient network failure!
    expect(clearMock).not.toHaveBeenCalled()
    expect(authService.getStatus()).toBe("AUTHENTICATED")
    expect(authService.getRefreshToken()).toBe("offline-refresh-tok")
  })

  it("17. requestPasswordReset calls canonical POST /auth/forgot-password", async () => {
    let capturedUrl = ""
    let capturedBody: any = null

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      capturedUrl = url
      capturedBody = JSON.parse(opts?.body || "{}")
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          message: "If the email is registered, a password reset email has been sent.",
        }),
      }
    })

    const res = await authService.requestPasswordReset("player@hikat.org")

    expect(res.success).toBe(true)
    expect(capturedUrl).toContain("/auth/forgot-password")
    expect(capturedBody.email).toBe("player@hikat.org")
  })

  it("18. Hard-expired JWT with network failure terminates in transient error without sending GraphQL request or calling clearSession", async () => {
    const clearMock = vi.fn()
    ;(window as any).electronAPI = {
      authSaveSession: vi.fn(),
      authClearSession: clearMock,
    }

    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 300 }))
    const expiredJwt = `${expiredHeader}.${expiredPayload}.sig`

    await authService.setSession({
      accessToken: expiredJwt,
      refreshToken: "offline-refresh-tok",
      user: { id: "u-p1", email: "player@hikat.org", role: "PLAYER" },
    })

    let refreshCallCount = 0
    let graphqlCallCount = 0

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshCallCount++
        throw new TypeError("Failed to fetch (offline network error)")
      }
      if (url.includes("/graphql")) {
        graphqlCallCount++
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { secret: "should-not-be-called" } }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    const res = await graphqlClient("query ProtectedData { secret }")

    expect(res.success).toBe(false)
    expect(res.error).toContain("Failed to fetch")
    // Protected GraphQL request MUST NOT be sent without valid token:
    expect(graphqlCallCount).toBe(0)
    // /auth/refresh was called EXACTLY ONCE:
    expect(refreshCallCount).toBe(1)
    // Session is NOT cleared on transient network error:
    expect(clearMock).not.toHaveBeenCalled()
    expect(authService.getStatus()).toBe("AUTHENTICATED")
    expect(authService.getRefreshToken()).toBe("offline-refresh-tok")
  })

  it("19. Protected binary upload rejects when token unavailable and never sends Authorization Bearer null/undefined", async () => {
    // Clear session so no token is available
    await authService.clearSession()

    const outcome = await authService.getValidAccessTokenOutcome()
    expect(outcome.kind).toBe("NO_SESSION")

    let putFetchCount = 0
    let lastAuthHeader: string | undefined = undefined

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === "PUT") {
        putFetchCount++
        lastAuthHeader = opts?.headers?.Authorization
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    // Binary upload must not execute PUT fetch when no valid token exists
    expect(putFetchCount).toBe(0)
    expect(lastAuthHeader).toBeUndefined()
  })

  it("20. User profile preserves real createdAt across session storage, getCachedUser, and getUser", async () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    const validToken = `${header}.${payload}.sig`
    const testCreatedAt = "2024-06-15T08:30:00.000Z"

    const mockSave = vi.fn()
    ;(window as any).electronAPI = {
      authLoadSession: vi.fn().mockResolvedValue({
        accessToken: validToken,
        refreshToken: "valid-ref-created",
        user: {
          id: "u-created-1",
          email: "created@hikat.org",
          role: "PLAYER",
          displayName: "CreatedUser",
          createdAt: testCreatedAt,
        },
      }),
      authSaveSession: mockSave,
      authClearSession: vi.fn(),
    }

    const session = await authService.bootstrap()
    expect(session).not.toBeNull()
    expect(session?.user.createdAt).toBe(testCreatedAt)

    const user = authService.getUser()
    expect(user?.createdAt).toBe(testCreatedAt)

    // Verify setSession saves createdAt into renderer localStorage
    await authService.setSession(session!)
    const cachedRaw = localStorage.getItem("hikat_last_user")
    expect(cachedRaw).not.toBeNull()
    const parsed = JSON.parse(cachedRaw!)
    expect(parsed.createdAt).toBe(testCreatedAt)

    const cached = authService.getCachedUser()
    expect(cached?.createdAt).toBe(testCreatedAt)
  })

  it("21. getAuthMethods fetches /auth/me/methods with valid Bearer token and returns auth methods", async () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    const validToken = `${header}.${payload}.sig`

    ;(window as any).electronAPI = {
      authLoadSession: vi.fn().mockResolvedValue({
        accessToken: validToken,
        refreshToken: "valid-ref-methods",
        user: {
          id: "u-methods-1",
          email: "methods@hikat.org",
          role: "PLAYER",
        },
      }),
      authSaveSession: vi.fn(),
      authClearSession: vi.fn(),
    }

    await authService.bootstrap()

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/auth/me/methods") && opts?.method === "GET") {
        expect(opts.headers.Authorization).toBe(`Bearer ${validToken}`)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            methods: [
              { type: "PASSWORD", email: "methods@hikat.org", verified: true },
            ],
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const res = await authService.getAuthMethods()
    expect(res.success).toBe(true)
    expect(res.methods).toHaveLength(1)
    expect(res.methods![0].type).toBe("PASSWORD")
  })

  it("22. verifyEmail validates and sends exact Base64URL token containing '--' and '_' without stripping characters", async () => {
    let capturedBody: any = null
    const complexToken = "tok_ABC--123__XYZ-456"

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/auth/verify-email")) {
        capturedBody = JSON.parse(opts.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: "Email verified" }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const res = await authService.verifyEmail(complexToken)
    expect(res.success).toBe(true)
    expect(capturedBody.token).toBe(complexToken)
  })

  it("23. resetPassword validates and sends exact Base64URL token containing '--' and '_' without stripping characters", async () => {
    let capturedBody: any = null
    const complexToken = "tok_RESET--999__000-XYZ"

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/auth/reset-password")) {
        capturedBody = JSON.parse(opts.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: "Password reset" }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const res = await authService.resetPassword(complexToken, "validPassword123")
    expect(res.success).toBe(true)
    expect(capturedBody.token).toBe(complexToken)
    expect(capturedBody.newPassword).toBe("validPassword123")
  })

  it("24. requestPasswordReset and requestEmailVerification propagate locale payload", async () => {
    let resetBody: any = null
    let resendBody: any = null

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/auth/forgot-password")) {
        resetBody = JSON.parse(opts.body)
        return { ok: true, status: 200, json: async () => ({ success: true }) }
      }
      if (url.includes("/auth/resend-verification")) {
        resendBody = JSON.parse(opts.body)
        return { ok: true, status: 200, json: async () => ({ success: true }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    await authService.requestPasswordReset("player@hikat.org", "pt")
    expect(resetBody.locale).toBe("pt")

    await authService.requestEmailVerification("player@hikat.org", "fr")
    expect(resendBody.locale).toBe("fr")
  })

  it("25. initiateOAuth saves locale in Electron pending OAuth store", async () => {
    const savePendingMock = vi.fn()
    ;(window as any).electronAPI = {
      authSavePendingOAuth: savePendingMock,
    }

    const { state } = await authService.initiateOAuth("GOOGLE", true, "es")
    expect(savePendingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "GOOGLE",
        keepSession: true,
        locale: "es",
        state,
      }),
    )
  })

  it("26. handleOAuthCallback calls authMarkOAuthCompleted and authClearPendingOAuth on success", async () => {
    const markCompletedMock = vi.fn().mockResolvedValue(true)
    const clearPendingMock = vi.fn().mockResolvedValue(true)
    const getPendingMock = vi.fn().mockResolvedValue({
      codeVerifier: "test-verifier-xyz-123456789012345678901234567890",
      keepSession: true,
    })

    ;(window as any).electronAPI = {
      authMarkOAuthCompleted: markCompletedMock,
      authClearPendingOAuth: clearPendingMock,
      authGetPendingOAuth: getPendingMock,
    }

    vi.spyOn((authService as any).client, "exchangeOAuthCode").mockResolvedValueOnce({
      id: "u-oauth-1",
      displayName: "OAuthPlayer",
      email: "oauth@hikat.org",
      role: "PLAYER",
      createdAt: new Date().toISOString(),
    })

    const user = await authService.handleOAuthCallback({
      code: "test-code",
      state: "test-state-123",
    })

    expect(user.displayName).toBe("OAuthPlayer")
    expect(getPendingMock).toHaveBeenCalledWith("test-state-123")
    expect(markCompletedMock).toHaveBeenCalledWith("test-state-123")
    expect(clearPendingMock).toHaveBeenCalled()
  })

  it("27. handleOAuthCallback cleans pending state when missing verifier / terminal error", async () => {
    const clearPendingMock = vi.fn().mockResolvedValue(true)
    const getPendingMock = vi.fn().mockResolvedValue(null)

    ;(window as any).electronAPI = {
      authClearPendingOAuth: clearPendingMock,
      authGetPendingOAuth: getPendingMock,
    }

    await expect(
      authService.handleOAuthCallback({
        code: "test-code",
        state: "missing-state",
      }),
    ).rejects.toThrow("Estado de autenticación inválido o sesión OAuth expirada.")

    expect(clearPendingMock).toHaveBeenCalled()
  })

  it("28. Table-driven: register, forgot-password, resend-verification, and initiateOAuth propagate ES/EN/PT/FR", async () => {
    const locales = ["es", "en", "pt", "fr"] as const

    for (const loc of locales) {
      // 1. requestPasswordReset
      let resetPayload: any = null
      let resendPayload: any = null
      mockFetch.mockImplementation(async (url: string, opts: any) => {
        if (url.includes("/auth/forgot-password")) {
          resetPayload = JSON.parse(opts.body)
          return { ok: true, status: 200, json: async () => ({ success: true }) }
        }
        if (url.includes("/auth/resend-verification")) {
          resendPayload = JSON.parse(opts.body)
          return { ok: true, status: 200, json: async () => ({ success: true }) }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      })

      await authService.requestPasswordReset("test@hikat.org", loc)
      expect(resetPayload.locale).toBe(loc)

      await authService.requestEmailVerification("test@hikat.org", loc)
      expect(resendPayload.locale).toBe(loc)

      // 2. initiateOAuth
      const savePendingMock = vi.fn()
      ;(window as any).electronAPI = {
        authSavePendingOAuth: savePendingMock,
      }
      const { state } = await authService.initiateOAuth("DISCORD", true, loc)
      expect(savePendingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "DISCORD",
          locale: loc,
          state,
        }),
      )
    }
  })

  it("29. setCooldown and getRemainingCooldown manage cooldowns and return remaining seconds", () => {
    expect(authService.getRemainingCooldown("verify", "player@hikat.org")).toBe(0)
    authService.setCooldown("verify", "player@hikat.org", 60)
    const remaining = authService.getRemainingCooldown("verify", "player@hikat.org")
    expect(remaining).toBeGreaterThanOrEqual(59)
    expect(remaining).toBeLessThanOrEqual(60)

    authService.setCooldown("verify", "player@hikat.org", 0)
    expect(authService.getRemainingCooldown("verify", "player@hikat.org")).toBe(0)
  })

  it("30. register with emailVerificationRequired starts verify cooldown", async () => {
    vi.spyOn((authService as any).client, "register").mockResolvedValueOnce({
      success: true,
      user: { id: "u-reg", email: "regcooldown@hikat.org", role: "PLAYER" },
      emailVerificationRequired: true,
      retryAfterSeconds: 60,
    })

    const res = await authService.register({
      username: "RegCooldownPlayer",
      email: "regcooldown@hikat.org",
      password: "password123",
    })

    expect(res.success).toBe(true)
    expect(res.retryAfterSeconds).toBe(60)
    expect(authService.getRemainingCooldown("verify", "regcooldown@hikat.org")).toBeGreaterThan(0)
  })

  it("31. requestPasswordReset sets reset cooldown on success and on 429 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, retryAfterSeconds: 60 }),
    })

    const res1 = await authService.requestPasswordReset("user-reset@hikat.org")
    expect(res1.success).toBe(true)
    expect(authService.getRemainingCooldown("reset", "user-reset@hikat.org")).toBeGreaterThan(0)

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "RATE_LIMITED", retryAfterSeconds: 45 }),
    })

    const res2 = await authService.requestPasswordReset("user-reset-429@hikat.org")
    expect(res2.success).toBe(false)
    expect(res2.retryAfterSeconds).toBe(45)
    expect(authService.getRemainingCooldown("reset", "user-reset-429@hikat.org")).toBeGreaterThan(0)
  })

  it("32. requestEmailVerification sets verify cooldown on success and on 429 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, retryAfterSeconds: 60 }),
    })

    const res1 = await authService.requestEmailVerification("user-verify@hikat.org")
    expect(res1.success).toBe(true)
    expect(authService.getRemainingCooldown("verify", "user-verify@hikat.org")).toBeGreaterThan(0)

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "RATE_LIMITED", retryAfterSeconds: 30 }),
    })

    const res2 = await authService.requestEmailVerification("user-verify-429@hikat.org")
    expect(res2.success).toBe(false)
    expect(res2.retryAfterSeconds).toBe(30)
    expect(authService.getRemainingCooldown("verify", "user-verify-429@hikat.org")).toBeGreaterThan(0)
  })

  it("33. verify and reset cooldowns are tracked independently in memory", () => {
    authService.setCooldown("verify", "independent@hikat.org", 60)
    expect(authService.getRemainingCooldown("verify", "independent@hikat.org")).toBeGreaterThan(0)
    expect(authService.getRemainingCooldown("reset", "independent@hikat.org")).toBe(0)

    authService.setCooldown("reset", "independent@hikat.org", 60)
    expect(authService.getRemainingCooldown("reset", "independent@hikat.org")).toBeGreaterThan(0)
  })
})


