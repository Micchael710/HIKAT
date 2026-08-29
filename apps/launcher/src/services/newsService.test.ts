// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { newsService } from "./newsService"
import * as apiClientModule from "./apiClient"

describe("Launcher News Service (GraphQL newsFeed & Multimedia Caching)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    ;(import.meta.env as any).DEV = true
  })

  it("1. Successfully queries GraphQL newsFeed with rich media fields and caches results", async () => {
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
          youtubeVideoId: "dQw4w9WgXcQ",
          youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          video: null,
          publishedAt: "2026-08-29T12:00:00.000Z",
          createdAt: "2026-08-29T11:00:00.000Z",
        },
        {
          id: "news-2",
          title: "Trailer Oficial en YouTube",
          content: "Mira el trailer oficial de la nueva temporada.",
          type: "ANNOUNCEMENT",
          image: null,
          youtubeVideoId: "abc123xyz89",
          youtubeUrl: "https://www.youtube.com/watch?v=abc123xyz89",
          video: null,
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
    expect(gqlSpy.mock.calls[0][0]).toContain("youtubeVideoId")
    expect(gqlSpy.mock.calls[0][0]).toContain("youtubeUrl")
    expect(gqlSpy.mock.calls[0][0]).toContain("video")

    expect(result.isCached).toBe(false)
    expect(result.error).toBeUndefined()
    expect(result.items.length).toBe(2)

    // Verify entity field mappings: Item 1 has explicit image priority
    const item1 = result.items[0]
    expect(item1.id).toBe("news-1")
    expect(item1.title).toBe("Nueva Actualización 1.1.0")
    expect(item1.img).toBe("http://127.0.0.1:8787/media/content/news-banner-1.png")
    expect(item1.youtubeVideoId).toBe("dQw4w9WgXcQ")
    expect(item1.type).toBe("UPDATE")

    // Item 2 has no image but has youtubeVideoId -> resolves YouTube hqdefault thumbnail
    const item2 = result.items[1]
    expect(item2.id).toBe("news-2")
    expect(item2.img).toBe("https://img.youtube.com/vi/abc123xyz89/hqdefault.jpg")
    expect(item2.youtubeVideoId).toBe("abc123xyz89")

    // Verify localStorage cache was populated with rich media properties
    const cached = window.localStorage.getItem("hikat_cached_news")
    expect(cached).not.toBeNull()
    const parsed = JSON.parse(cached!)
    expect(parsed.length).toBe(2)
    expect(parsed[0].id).toBe("news-1")
    expect(parsed[0].youtubeVideoId).toBe("dQw4w9WgXcQ")
    expect(parsed[1].img).toBe("https://img.youtube.com/vi/abc123xyz89/hqdefault.jpg")
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
    const existingCache = [
      {
        id: "news-cached-1",
        img: "http://127.0.0.1:8787/media/content/cached.png",
        title: "Noticia en Cache",
        desc: "Descripción en cache",
        content: "Contenido",
        accentColor: "#38bdf8",
        date: "2026-08-27T00:00:00.000Z",
        type: "NEWS",
        youtubeVideoId: "cachedVideo1",
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
    expect(result.items[0].youtubeVideoId).toBe("cachedVideo1")
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
