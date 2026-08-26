import { describe, it, expect, beforeEach, vi } from "vitest"
import { newsApi, serverApi } from "./graphqlClient"
import { authService } from "./authService"


describe("Back Office GraphQL News Client", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("fetches admin news list with filters and attaches Bearer token", async () => {
    authService.setSession("test-bearer-token", "refresh-tok", {
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
          Authorization: "Bearer test-bearer-token",
        }),
      }),
    )
  })

  it("automatically refreshes token and retries once on HTTP 401", async () => {
    authService.setSession("expired-token", "valid-refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

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
          accessToken: "new-fresh-token",
          refreshToken: "new-rotated-refresh-tok",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { id: "admin-1", role: "ADMIN" },
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
    expect(authService.getAccessToken()).toBe("new-fresh-token")
  })

  it("automatically refreshes token and retries once when GraphQL returns UNAUTHENTICATED error", async () => {
    authService.setSession("expired-jwt", "valid-refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

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
          accessToken: "refreshed-jwt",
          refreshToken: "refreshed-refresh-tok",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { id: "admin-1", role: "ADMIN" },
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
    expect(authService.getAccessToken()).toBe("refreshed-jwt")
  })

  it("prevents infinite loops: clears session if retry also fails with UNAUTHENTICATED", async () => {
    authService.setSession("bad-token", "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

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
          accessToken: "new-token-that-is-still-rejected",
          refreshToken: "new-refresh-tok",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { id: "admin-1", role: "ADMIN" },
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
    authService.setSession("test-bearer-token", "refresh-tok", {
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
})

describe("Back Office GraphQL Server Client (Shard 06)", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("fetches serverStatus metrics and limits", async () => {
    authService.setSession("test-bearer-token", "refresh-tok", {
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
    authService.setSession("test-bearer-token", "refresh-tok", {
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
    authService.setSession("test-bearer-token", "refresh-tok", {
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
})

