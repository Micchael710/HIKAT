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
})
