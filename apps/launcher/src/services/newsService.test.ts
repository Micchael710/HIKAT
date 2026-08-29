// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { newsService } from "./newsService"
import * as apiClientModule from "./apiClient"

describe("Launcher News Service (GraphQL newsFeed & Offline Caching)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    ;(import.meta.env as any).DEV = true
  })

  it("1. Successfully queries GraphQL newsFeed, normalizes entity fields, and caches results", async () => {
    const mockNewsFeed = {
      items: [
        {
          id: "news-1",
          title: "Nueva Actualización 1.1.0",
          content: "Detalles completos de la versión 1.1.0 con nuevos mods y optimizaciones.",
          type: "UPDATE",
          image: {
            url: "/media/content/news-banner-1.png",
          },
          publishedAt: "2026-08-29T12:00:00.000Z",
          createdAt: "2026-08-29T11:00:00.000Z",
        },
        {
          id: "news-2",
          title: "Mantenimiento Programado",
          content: "El servidor estará en mantenimiento durante 30 minutos.",
          type: "MAINTENANCE",
          image: null,
          publishedAt: "2026-08-28T10:00:00.000Z",
          createdAt: "2026-08-28T09:00:00.000Z",
        },
      ],
      totalCount: 2,
    }

    const gqlSpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: { newsFeed: mockNewsFeed },
    })

    const result = await newsService.getNewsArticles("es")

    expect(gqlSpy).toHaveBeenCalledTimes(1)
    expect(result.isCached).toBe(false)
    expect(result.error).toBeUndefined()
    expect(result.items.length).toBe(2)

    // Verify entity field mappings
    const item1 = result.items[0]
    expect(item1.id).toBe("news-1")
    expect(item1.title).toBe("Nueva Actualización 1.1.0")
    expect(item1.img).toBe("http://127.0.0.1:8787/media/content/news-banner-1.png")
    expect(item1.accentColor).toBe("#3ec4c0") // UPDATE accent color
    expect(item1.content).toContain("Detalles completos")
    expect(item1.date).toBe("2026-08-29T12:00:00.000Z")

    const item2 = result.items[1]
    expect(item2.id).toBe("news-2")
    expect(item2.img).toBe("")
    expect(item2.accentColor).toBe("#ef4444") // MAINTENANCE accent color

    // Verify localStorage cache was populated
    const cached = window.localStorage.getItem("hikat_cached_news")
    expect(cached).not.toBeNull()
    const parsed = JSON.parse(cached!)
    expect(parsed.length).toBe(2)
    expect(parsed[0].id).toBe("news-1")
  })

  it("2. Empty feed (0 published articles) returns empty list with isCached: false and no fake news", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: { newsFeed: { items: [], totalCount: 0 } },
    })

    const result = await newsService.getNewsArticles("es")

    expect(result.items).toEqual([])
    expect(result.isCached).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it("3. Network/API failure with existing cache falls back to cached news with isCached: true", async () => {
    // Seed previous cached news
    const existingCache = [
      {
        id: "news-cached-1",
        img: "http://127.0.0.1:8787/media/content/cached.png",
        title: "Noticia en Cache",
        desc: "Descripción en cache",
        content: "Contenido",
        accentColor: "#10b981",
        date: "2026-08-27T00:00:00.000Z",
      },
    ]
    window.localStorage.setItem("hikat_cached_news", JSON.stringify(existingCache))

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Failed to fetch (Network error)",
    })

    const result = await newsService.getNewsArticles("es")

    expect(result.items.length).toBe(1)
    expect(result.items[0].id).toBe("news-cached-1")
    expect(result.isCached).toBe(true)
  })

  it("4. Network/API failure without previous cache returns empty list with error: true", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Failed to fetch (Offline)",
    })

    const result = await newsService.getNewsArticles("es")

    expect(result.items).toEqual([])
    expect(result.error).toBe(true)
  })
})
