import { describe, it, expect, beforeEach, vi } from "vitest"
import { newsApi, serverApi, gameApi } from "./graphqlClient"
import { authService } from "./authService"

function createMockAdminJwt(expiresInSeconds = 900): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = btoa(
    JSON.stringify({
      sub: "admin-1",
      role: "ADMIN",
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  )
  return `${header}.${payload}.mock-sig`
}

describe("Back Office GraphQL News Client", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("fetches admin news list with filters and attaches Bearer token", async () => {
    const validJwt = createMockAdminJwt(600)
    authService.setSession(validJwt, "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    const mockResponseData = {
      data: {
        adminNews: {
          items: [
            {
              id: "news-1",
              title: "Nueva actualización 1.0",
              content: "Detalles del parche...",
              type: "UPDATE",
              status: "PUBLISHED",
              publishedAt: "2026-08-26T10:00:00Z",
              createdAt: "2026-08-26T09:00:00Z",
              updatedAt: "2026-08-26T10:00:00Z",
            },
          ],
          totalCount: 1,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      },
    }

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    } as Response)

    const result = await newsApi.getAdminNews({
      type: "UPDATE",
      status: "PUBLISHED",
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe("Nueva actualización 1.0")
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/graphql"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${validJwt}`,
        }),
      }),
    )
  })

  it("automatically refreshes token and retries once on HTTP 401", async () => {
    const validJwt = createMockAdminJwt(600)
    authService.setSession(validJwt, "valid-refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    const newJwt = createMockAdminJwt(900)

    vi.spyOn(global, "fetch")
      // 1. Initial GraphQL call returns 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response)
      // 2. Auth refresh call succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: newJwt,
          refreshToken: "new-rotated-refresh-tok",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { id: "admin-1", email: "admin@hikat.org", role: "ADMIN" },
        }),
      } as Response)
      // 3. Retried GraphQL call succeeds with new token
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            adminNews: {
              items: [],
              totalCount: 0,
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
            },
          },
        }),
      } as Response)

    const result = await newsApi.getAdminNews()
    expect(result.items).toEqual([])
    expect(authService.getAccessToken()).toBe(newJwt)
  })

  it("automatically refreshes token and retries once when GraphQL returns UNAUTHENTICATED error", async () => {
    const validJwt = createMockAdminJwt(600)
    authService.setSession(validJwt, "valid-refresh-tok", {
      id: "admin-1",
      email: "admin@hikat.org",
      role: "ADMIN",
    })

    const newJwt = createMockAdminJwt(900)

    vi.spyOn(global, "fetch")
      // 1. Initial GraphQL returns 200 with UNAUTHENTICATED error
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [
            {
              message: "Authentication required",
              extensions: { code: "UNAUTHENTICATED" },
            },
          ],
        }),
      } as Response)
      // 2. Auth refresh call succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: newJwt,
          refreshToken: "refreshed-refresh-tok",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { id: "admin-1", email: "admin@hikat.org", role: "ADMIN" },
        }),
      } as Response)
      // 3. Retried GraphQL call succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            deleteNews: true,
          },
        }),
      } as Response)

    const result = await newsApi.deleteNews("news-123")
    expect(result).toBe(true)
    expect(authService.getAccessToken()).toBe(newJwt)
  })

  it("prevents infinite loops: clears session if retry also fails with UNAUTHENTICATED", async () => {
    const validJwt = createMockAdminJwt(600)
    authService.setSession(validJwt, "refresh-tok", {
      id: "admin-1",
      email: "admin@hikat.org",
      role: "ADMIN",
    })

    const stillRejectedJwt = createMockAdminJwt(900)

    vi.spyOn(global, "fetch")
      // 1. Initial GraphQL returns 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response)
      // 2. Auth refresh call succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: stillRejectedJwt,
          refreshToken: "new-refresh-tok",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { id: "admin-1", email: "admin@hikat.org", role: "ADMIN" },
        }),
      } as Response)
      // 3. Retried GraphQL returns 401 again
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response)

    await expect(newsApi.getAdminNews()).rejects.toThrow(
      "Su sesión ha expirado. Por favor inicie sesión nuevamente.",
    )
    expect(authService.getAccessToken()).toBeNull()
    expect(authService.getUser()).toBeNull()
  })

  it("handles and formats GraphQL validation errors gracefully", async () => {
    authService.setSession(createMockAdminJwt(600), "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        errors: [
          {
            message: "Title must be between 3 and 200 characters",
            extensions: { code: "VALIDATION_ERROR" },
          },
        ],
      }),
    } as Response)

    await expect(
      newsApi.createNews({
        title: "Hi",
        content: "Content",
        type: "NEWS",
      }),
    ).rejects.toThrow("Title must be between 3 and 200 characters")
  })

  it("proactively renews access token before GraphQL call when expiring (<60s)", async () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 30 }))
    const expiringJwt = `${header}.${payload}.sig`

    authService.setSession(expiringJwt, "valid-refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    let refreshCalled = false
    let sentBearer = ""

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url)
      if (urlStr.includes("/auth/refresh")) {
        refreshCalled = true
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "proactively-renewed-admin-jwt",
            refreshToken: "rotated-ref",
            expiresIn: 900,
            tokenType: "Bearer",
            user: { id: "admin-1", email: "admin@hikat.org", role: "ADMIN" },
          }),
        } as Response
      }

      sentBearer = opts?.headers?.Authorization || ""
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            adminNews: { items: [], totalCount: 0, pageInfo: { hasNextPage: false, hasPreviousPage: false } },
          },
        }),
      } as Response
    })

    await newsApi.getAdminNews()

    expect(refreshCalled).toBe(true)
    expect(sentBearer).toBe("Bearer proactively-renewed-admin-jwt")
    expect(authService.getAccessToken()).toBe("proactively-renewed-admin-jwt")
  })

  it("transient network failure during refresh preserves session and throws error without clearing session", async () => {
    authService.setSession("expired-jwt", "valid-refresh-tok", {
      id: "admin-1",
      email: "admin@hikat.org",
      role: "ADMIN",
    })

    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url)
      if (urlStr.includes("/auth/refresh")) {
        throw new TypeError("Failed to fetch")
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: "UNAUTHORIZED" }),
      } as Response
    })

    await expect(newsApi.getAdminNews()).rejects.toThrow(/Failed to fetch|Error temporal/)
    // Session is PRESERVED!
    expect(authService.getAccessToken()).toBe("expired-jwt")
    expect(authService.getUser()?.id).toBe("admin-1")
  })
})

describe("Back Office GraphQL Server Client (Shard 06)", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("fetches serverStatus metrics and limits", async () => {
    authService.setSession(createMockAdminJwt(600), "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    const mockResponseData = {
      data: {
        serverStatus: {
          status: "ONLINE",
          cpuPercent: 32.5,
          cpuLimitPercent: 200,
          memoryUsedBytes: 5767168000,
          memoryLimitBytes: 8589934592,
          diskUsedBytes: 19327352832,
          diskLimitBytes: 53687091200,
          uptimeMs: 3600000,
          isSuspended: false,
        },
      },
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    } as Response)

    const status = await serverApi.getServerStatus()

    expect(status.status).toBe("ONLINE")
    expect(status.cpuPercent).toBe(32.5)
    expect(status.memoryUsedBytes).toBe(5767168000)
    expect(status.memoryLimitBytes).toBe(8589934592)
    expect(status.uptimeMs).toBe(3600000)
  })

  it("executes power actions (start, restart, stop)", async () => {
    authService.setSession(createMockAdminJwt(600), "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    // Start
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          startServer: { success: true, status: "STARTING", message: "Iniciando servidor..." },
        },
      }),
    } as Response)

    const startRes = await serverApi.startServer()
    expect(startRes.success).toBe(true)
    expect(startRes.status).toBe("STARTING")

    // Restart
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          restartServer: { success: true, status: "STARTING", message: "Reiniciando servidor..." },
        },
      }),
    } as Response)

    const restartRes = await serverApi.restartServer()
    expect(restartRes.success).toBe(true)
    expect(restartRes.status).toBe("STARTING")

    // Stop
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          stopServer: { success: true, status: "STOPPING", message: "Apagando servidor..." },
        },
      }),
    } as Response)

    const stopRes = await serverApi.stopServer()
    expect(stopRes.success).toBe(true)
    expect(stopRes.status).toBe("STOPPING")
  })

  it("sends server console commands", async () => {
    authService.setSession(createMockAdminJwt(600), "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          sendServerCommand: { success: true, message: "Comando enviado correctamente." },
        },
      }),
    } as Response)

    const res = await serverApi.sendServerCommand("say Hola mundo")
    expect(res.success).toBe(true)
    expect(res.message).toBe("Comando enviado correctamente.")
  })

  it("terminates in transient error without sending GraphQL query when hard-expired JWT refresh encounters network failure", async () => {
    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 300 }))
    const expiredJwt = `${expiredHeader}.${expiredPayload}.sig`

    authService.setSession(expiredJwt, "offline-refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    let refreshCalled = 0
    let graphqlCalled = 0

    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url)
      if (urlStr.includes("/auth/refresh")) {
        refreshCalled++
        throw new TypeError("Failed to fetch (offline network error)")
      }
      if (urlStr.includes("/graphql")) {
        graphqlCalled++
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { adminNews: { items: [], totalCount: 0 } } }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })

    await expect(newsApi.getAdminNews()).rejects.toThrow(
      "Failed to fetch (offline network error)",
    )

    // GraphQL request must NOT be sent
    expect(graphqlCalled).toBe(0)
    // /auth/refresh was called EXACTLY ONCE
    expect(refreshCalled).toBe(1)
    // Session is PRESERVED, not cleared
    expect(authService.getRefreshToken()).toBe("offline-refresh-tok")
    expect(authService.getUser()).not.toBeNull()
  })
})

describe("Back Office Game Binary Upload Suite", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("1. NO_SESSION: uploadGameBinary rejects and calls fetch PUT exactly 0 times", async () => {
    authService.clearSession()

    let putFetchCount = 0
    vi.spyOn(global, "fetch").mockImplementation(async (_url: any, opts: any) => {
      if (opts?.method === "PUT") {
        putFetchCount++
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })

    const testFile = new File(["mods-bytes"], "sodium.jar", { type: "application/java-archive" })

    await expect(
      gameApi.uploadGameBinary(testFile, "/game/upload/binary", "ticket-tok-123"),
    ).rejects.toThrow("No hay una sesión activa para subir el archivo de juego.")

    expect(putFetchCount).toBe(0)
  })

  it("2. hard-expired access token + refresh TRANSIENT_FAILURE: calls fetch PUT exactly 0 times, /auth/refresh exactly 1 time, and preserves session", async () => {
    const expiredHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const expiredPayload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 300 }))
    const expiredJwt = `${expiredHeader}.${expiredPayload}.sig`

    authService.setSession(expiredJwt, "offline-ref-game", {
      id: "admin-1",
      email: "admin@hikat.org",
      role: "ADMIN",
    })

    let refreshCalled = 0
    let putCalled = 0

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url)
      if (urlStr.includes("/auth/refresh")) {
        refreshCalled++
        throw new TypeError("Network offline during game upload refresh")
      }
      if (opts?.method === "PUT") {
        putCalled++
        return {
          ok: true,
          status: 200,
          json: async () => ({ tokenHash: "hash123" }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })

    const testFile = new File(["bytes"], "iris.jar", { type: "application/java-archive" })

    await expect(
      gameApi.uploadGameBinary(testFile, "/game/upload/binary", "ticket-tok-123"),
    ).rejects.toThrow("Network offline during game upload refresh")

    expect(putCalled).toBe(0)
    expect(refreshCalled).toBe(1)
    expect(authService.getStatus()).toBe("AUTHENTICATED")
    expect(authService.getRefreshToken()).toBe("offline-ref-game")
  })

  it("3. READY: calls fetch PUT exactly 1 time with valid Authorization Bearer header", async () => {
    const validJwt = createMockAdminJwt(600)
    authService.setSession(validJwt, "ref-tok", {
      id: "admin-1",
      email: "admin@hikat.org",
      role: "ADMIN",
    })

    let putCalled = 0
    let capturedAuth: string | undefined
    let capturedUploadToken: string | undefined

    vi.spyOn(global, "fetch").mockImplementation(async (_url: any, opts: any) => {
      if (opts?.method === "PUT") {
        putCalled++
        capturedAuth = opts?.headers?.Authorization
        capturedUploadToken = opts?.headers?.["X-Upload-Token"]
        return {
          ok: true,
          status: 200,
          json: async () => ({ tokenHash: "sha256-hash-game", originalFilename: "sodium.jar", sizeBytes: 1024 }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })

    const testFile = new File(["jar-bytes"], "sodium.jar", { type: "application/java-archive" })
    const res = await gameApi.uploadGameBinary(testFile, "/game/upload/binary", "ticket-tok-456")

    expect(res.tokenHash).toBe("sha256-hash-game")
    expect(putCalled).toBe(1)
    expect(capturedAuth).toBe(`Bearer ${validJwt}`)
    expect(capturedUploadToken).toBe("ticket-tok-456")
  })

  it("4. Explicitly verifies that Authorization header is never 'Bearer null' or 'Bearer undefined'", async () => {
    authService.clearSession()

    const capturedAuthHeaders: (string | undefined)[] = []

    vi.spyOn(global, "fetch").mockImplementation(async (_url: any, opts: any) => {
      capturedAuthHeaders.push(opts?.headers?.Authorization)
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })

    const testFile = new File(["bytes"], "config.json", { type: "application/json" })

    await expect(
      gameApi.uploadGameBinary(testFile, "/game/upload/binary", "ticket-tok-789"),
    ).rejects.toThrow()

    expect(capturedAuthHeaders).toHaveLength(0)
    for (const h of capturedAuthHeaders) {
      expect(h).not.toBe("Bearer null")
      expect(h).not.toBe("Bearer undefined")
    }
  })
})

