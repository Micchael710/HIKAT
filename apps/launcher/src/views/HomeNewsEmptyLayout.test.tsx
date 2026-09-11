// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import HomeView from "./HomeView"
import NewsCarousel, { type NewsContentState } from "../components/news/NewsCarousel"
import { LanguageProvider } from "../context/LanguageContext"
import { newsService } from "../services/newsService"
import { serverService } from "../services/serverService"
import { gameService } from "../services/gameService"
import * as apiClientModule from "../services/apiClient"
import type { LauncherServer } from "../services/serverService"

describe("HomeView News Section & Cache Lifecycle Suite", () => {
  let container: HTMLDivElement | null = null
  let root: ReturnType<typeof createRoot> | null = null

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
    vi.restoreAllMocks()

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
      online: true,
      playersOnline: 10,
      maxPlayers: 50,
      latencyMs: 15,
    })
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(null)
  })

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount()
      })
      container.remove()
      container = null
      root = null
    }
    localStorage.clear()
    vi.restoreAllMocks()
  })

  const serverA: LauncherServer = {
    id: "server-a",
    name: "Servidor A",
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    launcherActiveReleaseId: "rel-a",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const serverB: LauncherServer = {
    id: "server-b",
    name: "Servidor B",
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    launcherActiveReleaseId: "rel-b",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockNewsItem = {
    id: "news-1",
    img: "/img/news.png",
    title: "Nueva Gran Actualización",
    desc: "Notas del parche",
    content: "Detalles completos de la actualización",
    accentColor: "#38bdf8",
    date: "2026-09-10T12:00:00Z",
  }

  const oldCachedItem = {
    id: "news-old",
    img: "/img/old.png",
    title: "Noticia Antigua Borrada",
    desc: "Esta noticia fue eliminada",
    content: "Contenido viejo",
    accentColor: "#f43f5e",
    date: "2026-08-01T00:00:00Z",
  }

  it("1. LOADING: NO aparece 'Últimas Novedades', NO aparece tarjeta offline, layout estable 1410/2460", async () => {
    let resolvePromise: ((val: any) => void) | null = null
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve
    })
    vi.spyOn(newsService, "getNewsArticles").mockReturnValue(pendingPromise as any)

    let reportedHeight: number | null = null

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverA}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })

    const textDuringLoading = container?.textContent || ""
    expect(textDuringLoading).not.toContain("Últimas Novedades")
    expect(textDuringLoading).not.toContain("Latest News")
    expect(textDuringLoading).not.toContain("Sin conexión con las novedades")
    expect(textDuringLoading).not.toContain("Reintentar")

    const elements = Array.from(container?.querySelectorAll("div") || [])
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper?.style.display).toBe("none")

    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")
    expect(reportedHeight).toBe(2460)

    await act(async () => {
      resolvePromise?.({ items: [], isCached: false })
      await Promise.resolve()
    })
  })

  it("2. EMPTY: nunca aparece 'Últimas Novedades', Stats usa 1130, Cut usa 1030, Canvas usa 2180", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [],
      isCached: false,
    })

    let reportedHeight: number | null = null

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverA}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = container?.textContent || ""
    expect(text).not.toContain("Últimas Novedades")
    expect(text).not.toContain("Sin conexión con las novedades")

    const elements = Array.from(container?.querySelectorAll("div") || [])
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper?.style.display).toBe("none")

    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1130px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1030px")

    expect(reportedHeight).toBe(2180)
    const rootHome = container?.querySelector("[data-home-canvas-height]")
    expect(rootHome?.getAttribute("data-home-canvas-height")).toBe("2180")
  })

  it("3. CONTENT: título visible, Stats = 1410, Cut = 1310, Canvas = 2460", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [mockNewsItem],
      isCached: false,
    })

    let reportedHeight: number | null = null

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverB}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = container?.textContent || ""
    expect(text).toContain("Últimas Novedades")
    expect(text).toContain("Nueva Gran Actualización")

    const elements = Array.from(container?.querySelectorAll("div") || [])
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper?.style.display).toBe("block")

    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")

    expect(reportedHeight).toBe(2460)
    const rootHome = container?.querySelector("[data-home-canvas-height]")
    expect(rootHome?.getAttribute("data-home-canvas-height")).toBe("2460")
  })

  it("4. ERROR: muestra 'Sin conexión con las novedades' y Reintentar, mantiene Stats = 1410 y Canvas = 2460", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [],
      error: true,
    })

    let reportedHeight: number | null = null

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverA}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = container?.textContent || ""
    expect(text).toContain("Sin conexión con las novedades")
    expect(text).toContain("Reintentar")

    const elements = Array.from(container?.querySelectorAll("div") || [])
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")

    expect(reportedHeight).toBe(2460)
    const rootHome = container?.querySelector("[data-home-canvas-height]")
    expect(rootHome?.getAttribute("data-home-canvas-height")).toBe("2460")
  })

  it("5. Existe noticia en cache, pero backend responde []: la noticia vieja NUNCA aparece, estado = empty y cache eliminado", async () => {
    // 1. Pre-cargar noticia vieja en localStorage
    localStorage.setItem("hikat_cached_news_server-a", JSON.stringify([oldCachedItem]))

    // 2. Simular respuesta exitosa GraphQL con items vacíos
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: { newsFeed: { items: [], totalCount: 0 } },
    })

    let reportedHeight: number | null = null

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverA}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })

    // Durante loading inicial: la noticia vieja NUNCA se muestra
    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")
    expect(container?.textContent).not.toContain("Últimas Novedades")

    await act(async () => {
      await Promise.resolve()
    })

    // Al resolver: la noticia vieja NUNCA apareció y el estado es empty
    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")
    expect(container?.textContent).not.toContain("Últimas Novedades")
    expect(reportedHeight).toBe(2180)

    // Cache viejo eliminado de localStorage
    expect(localStorage.getItem("hikat_cached_news_server-a")).toBeNull()
  })

  it("6. Existe noticia en cache, backend responde con noticias nuevas: durante loading no aparece noticia vieja, luego aparecen nuevas y se reemplaza cache", async () => {
    localStorage.setItem("hikat_cached_news_server-a", JSON.stringify([oldCachedItem]))

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        newsFeed: {
          items: [
            {
              id: "news-new",
              title: "Nueva Gran Actualización",
              content: "Detalles",
              type: "UPDATE",
              createdAt: "2026-09-11T00:00:00Z",
            },
          ],
          totalCount: 1,
        },
      },
    })

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })

    // En ningún momento aparece la noticia vieja
    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")

    await act(async () => {
      await Promise.resolve()
    })

    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")
    expect(container?.textContent).toContain("Nueva Gran Actualización")

    // Cache reemplazado
    const updatedCache = JSON.parse(localStorage.getItem("hikat_cached_news_server-a") || "[]")
    expect(updatedCache.length).toBe(1)
    expect(updatedCache[0].id).toBe("news-new")
  })

  it("7. Existe noticia en cache, backend falla: primero loading, luego aparecen noticias cacheadas (fallback offline)", async () => {
    localStorage.setItem("hikat_cached_news_server-a", JSON.stringify([oldCachedItem]))

    let rejectPromise: (() => void) | null = null
    const pendingQuery = new Promise((_, reject) => {
      rejectPromise = () => reject(new Error("Network offline"))
    })
    vi.spyOn(apiClientModule, "graphqlClient").mockReturnValue(pendingQuery as any)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })

    // Durante loading: NADA visible (no se hidrata antes de consultar)
    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")
    expect(container?.textContent).not.toContain("Últimas Novedades")

    // Ahora la red falla
    await act(async () => {
      rejectPromise?.()
      await Promise.resolve()
    })

    // Ahora SÍ aparece como fallback offline
    expect(container?.textContent).toContain("Noticia Antigua Borrada")
    expect(container?.textContent).toContain("Últimas Novedades")
  })

  it("8. HomeView & NewsCarousel: nunca inicializan content leyendo localStorage directamente", async () => {
    localStorage.setItem("hikat_cached_news_server-a", JSON.stringify([oldCachedItem]))

    // Retardamos la respuesta para verificar el estado de mount sincrónico
    let resolveNews: any = null
    vi.spyOn(newsService, "getNewsArticles").mockReturnValue(
      new Promise((res) => {
        resolveNews = res
      }),
    )

    let capturedState: NewsContentState | null = null

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <NewsCarousel
            canvasLeft={184}
            canvasWidth={1920}
            theme="dark"
            serverId="server-a"
            onContentStateChange={(s) => {
              capturedState = s
            }}
          />
        </LanguageProvider>,
      )
    })

    // NewsCarousel no se hidrata desde localStorage: estado inicial es loading, contenedor vacío
    expect(capturedState).toBe("loading")
    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")

    await act(async () => {
      resolveNews?.({ items: [], isCached: false })
      await Promise.resolve()
    })

    expect(capturedState).toBe("empty")
  })

  it("9. Cambio entre servidores: A (cache viejo pero ahora 0 noticias) -> B (con noticias) -> A", async () => {
    localStorage.setItem("hikat_cached_news_server-a", JSON.stringify([oldCachedItem]))

    vi.spyOn(apiClientModule, "graphqlClient").mockImplementation(async (_query, vars) => {
      if (vars?.serverId === "server-b") {
        return {
          success: true,
          data: {
            newsFeed: {
              items: [
                {
                  id: "news-b",
                  title: "Servidor B Noticias",
                  content: "Contenido B",
                  type: "UPDATE",
                  createdAt: "2026-09-11T00:00:00Z",
                },
              ],
              totalCount: 1,
            },
          },
        }
      }
      return {
        success: true,
        data: { newsFeed: { items: [], totalCount: 0 } },
      }
    })

    let reportedHeight: number | null = null

    // 1. Montar en Servidor A:
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverA}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")
    expect(container?.textContent).not.toContain("Últimas Novedades")
    expect(reportedHeight).toBe(2180)
    expect(localStorage.getItem("hikat_cached_news_server-a")).toBeNull()

    // 2. Cambiar a Servidor B:
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverB}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container?.textContent).toContain("Servidor B Noticias")
    expect(container?.textContent).toContain("Últimas Novedades")
    expect(reportedHeight).toBe(2460)

    // 3. Volver a Servidor A:
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={serverA}
            onContentHeightChange={(h) => {
              reportedHeight = h
            }}
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container?.textContent).not.toContain("Servidor B Noticias")
    expect(container?.textContent).not.toContain("Noticia Antigua Borrada")
    expect(container?.textContent).not.toContain("Últimas Novedades")
    expect(reportedHeight).toBe(2180)
  })
})
