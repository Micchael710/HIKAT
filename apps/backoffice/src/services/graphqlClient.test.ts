import { describe, it, expect, beforeEach, vi } from "vitest"
import { newsApi } from "./graphqlClient"
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

  it("creates a news article through createNews mutation", async () => {
    authService.setSession("test-bearer-token", "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    const mockCreated = {
      id: "news-new-1",
      title: "Anuncio de Torneo",
      content: "Reglas e inscripciones abiertas",
      type: "ANNOUNCEMENT",
      status: "DRAFT",
      createdAt: "2026-08-26T12:00:00Z",
      updatedAt: "2026-08-26T12:00:00Z",
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          createNews: mockCreated,
        },
      }),
    } as Response)

    const created = await newsApi.createNews({
      title: "Anuncio de Torneo",
      content: "Reglas e inscripciones abiertas",
      type: "ANNOUNCEMENT",
      status: "DRAFT",
    })

    expect(created.id).toBe("news-new-1")
    expect(created.type).toBe("ANNOUNCEMENT")
  })

  it("handles publish, unpublish, and delete mutations", async () => {
    authService.setSession("test-bearer-token", "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    // 1. Publish
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          publishNews: {
            id: "news-1",
            status: "PUBLISHED",
            publishedAt: "2026-08-26T14:00:00Z",
          },
        },
      }),
    } as Response)

    const published = await newsApi.publishNews("news-1")
    expect(published.status).toBe("PUBLISHED")

    // 2. Unpublish
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          unpublishNews: {
            id: "news-1",
            status: "DRAFT",
            publishedAt: null,
          },
        },
      }),
    } as Response)

    const unpublished = await newsApi.unpublishNews("news-1")
    expect(unpublished.status).toBe("DRAFT")

    // 3. Delete
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          deleteNews: true,
        },
      }),
    } as Response)

    const deleted = await newsApi.deleteNews("news-1")
    expect(deleted).toBe(true)
  })

  it("handles and formats GraphQL errors gracefully", async () => {
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
