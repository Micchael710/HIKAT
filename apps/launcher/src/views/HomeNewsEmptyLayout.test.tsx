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
import type { LauncherServer } from "../services/serverService"

describe("HomeView News Section Dynamic Visibility & Layout Suite (Empty, Loading, Content, Error)", () => {
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

  it("1, 2, 15. LOADING: NO aparece 'Últimas Novedades', NO aparece tarjeta offline, layout estable 1410/2460", async () => {
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
    // 1. NO aparece "Últimas Novedades"
    expect(textDuringLoading).not.toContain("Últimas Novedades")
    expect(textDuringLoading).not.toContain("Latest News")

    // 2. NO aparece la tarjeta offline ni Reintentar
    expect(textDuringLoading).not.toContain("Sin conexión con las novedades")
    expect(textDuringLoading).not.toContain("Reintentar")

    // 15. Loading inicial: wrapper no visible
    const elements = Array.from(container?.querySelectorAll("div") || [])
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper?.style.display).toBe("none")

    // Mantiene layout normal (1410px) y altura 2460 durante carga
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")
    expect(reportedHeight).toBe(2460)

    // Cleanup promise
    await act(async () => {
      resolvePromise?.({ items: [], isCached: false })
      await Promise.resolve()
    })
  })

  it("3, 4, 5, 6. EMPTY: nunca aparece 'Últimas Novedades', Stats usa 1120, Cut usa 1020, Canvas usa 2170", async () => {
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
    // 3. NUNCA muestra "Últimas Novedades" ni error
    expect(text).not.toContain("Últimas Novedades")
    expect(text).not.toContain("Sin conexión con las novedades")

    const elements = Array.from(container?.querySelectorAll("div") || [])
    // Wrapper de NewsCarousel oculto (display: none)
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper?.style.display).toBe("none")

    // 4. Stats usa top = 1120
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1120px")

    // 5. Angular Cut usa top = 1020 (1310 - 290 = 1020)
    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1020px")

    // 6. Canvas Home usa altura = 2170 (2460 - 290 = 2170)
    expect(reportedHeight).toBe(2170)
    const rootHome = container?.querySelector("[data-home-canvas-height]")
    expect(rootHome?.getAttribute("data-home-canvas-height")).toBe("2170")
  })

  it("7, 8, 9, 10. CONTENT: título visible, Stats = 1410, Cut = 1310, Canvas = 2460", async () => {
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
    // 7. Título de noticias visible
    expect(text).toContain("Últimas Novedades")
    expect(text).toContain("Nueva Gran Actualización")

    const elements = Array.from(container?.querySelectorAll("div") || [])
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper?.style.display).toBe("block")

    // 8. Stats = 1410
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    // 9. Cut = 1310
    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")

    // 10. Canvas = 2460
    expect(reportedHeight).toBe(2460)
    const rootHome = container?.querySelector("[data-home-canvas-height]")
    expect(rootHome?.getAttribute("data-home-canvas-height")).toBe("2460")
  })

  it("11 & 12. ERROR: muestra 'Sin conexión con las novedades' y Reintentar, mantiene Stats = 1410 y Canvas = 2460", async () => {
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
    // 11. Muestra tarjeta offline y botón Reintentar
    expect(text).toContain("Sin conexión con las novedades")
    expect(text).toContain("Reintentar")

    // 12. Mantiene Stats = 1410, Cut = 1310 y Canvas = 2460
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

  it("13 & 14. Cambio entre servidores: empty -> content actualiza layout y altura, y content -> empty vuelve a compacto sin leaks", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockImplementation(async (_lang, sId) => {
      if (sId === "server-b") {
        return { items: [mockNewsItem], isCached: false }
      }
      return { items: [], isCached: false }
    })

    let reportedHeight: number | null = null

    // 1. Montar Servidor A (sin noticias) -> compacto (1120 / 1020 / 2170)
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

    let elements = Array.from(container?.querySelectorAll("div") || [])
    let stats = elements.find((el) => el.style.paddingBottom === "90px" && el.style.display === "flex")
    expect(stats?.style.top).toBe("1120px")
    expect(reportedHeight).toBe(2170)
    expect(container?.textContent).not.toContain("Últimas Novedades")

    // 2. Cambiar a Servidor B (con noticias) -> normal (1410 / 1310 / 2460)
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

    elements = Array.from(container?.querySelectorAll("div") || [])
    stats = elements.find((el) => el.style.paddingBottom === "90px" && el.style.display === "flex")
    expect(stats?.style.top).toBe("1410px")
    expect(reportedHeight).toBe(2460)
    expect(container?.textContent).toContain("Últimas Novedades")
    expect(container?.textContent).toContain("Nueva Gran Actualización")

    // 3. Volver a Servidor A (sin noticias) -> vuelve a compacto (1120 / 1020 / 2170) sin contenido viejo
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

    elements = Array.from(container?.querySelectorAll("div") || [])
    stats = elements.find((el) => el.style.paddingBottom === "90px" && el.style.display === "flex")
    expect(stats?.style.top).toBe("1120px")
    expect(reportedHeight).toBe(2170)
    expect(container?.textContent).not.toContain("Últimas Novedades")
    expect(container?.textContent).not.toContain("Nueva Gran Actualización")
  })
})
