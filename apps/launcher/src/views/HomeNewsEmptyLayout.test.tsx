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

describe("HomeView News Section Dynamic Visibility & Layout Suite", () => {
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

  it("1. Respuesta exitosa con items = [] -> estado EMPTY en NewsCarousel", async () => {
    let capturedState: NewsContentState | null = null
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [],
      isCached: false,
    })

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
    await act(async () => {
      await Promise.resolve()
    })

    expect(capturedState).toBe("empty")
  })

  it("2, 3, 4, 5, 6. EMPTY: NO muestra título, NO muestra offline, NO renderiza wrapper, sube Stats a 860 y Cut a 760", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [],
      isCached: false,
    })

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = container?.textContent || ""

    // 2. NO muestra "Últimas Novedades"
    expect(text).not.toContain("Últimas Novedades")

    // 3. NO muestra "Sin conexión con las novedades" ni "Reintentar"
    expect(text).not.toContain("Sin conexión con las novedades")
    expect(text).not.toContain("Reintentar")

    // 4. NO renderiza el wrapper visual del NewsCarousel (top: 908px, height: 420px)
    const elements = Array.from(container?.querySelectorAll("div") || [])
    const newsWrapper = elements.find(
      (el) => el.style.top === "908px" && el.style.height === "420px",
    )
    expect(newsWrapper).toBeUndefined()

    // 5. Server Stats & Community Hub sube a top: 860px (antigua posición de novedades)
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer).toBeDefined()
    expect(statsContainer?.style.top).toBe("860px")

    // 6. Angular Geometric Section Cut se desplaza por el mismo delta (1310 - 550 = 760px)
    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement).toBeDefined()
    expect(cutElement?.style.top).toBe("760px")
  })

  it("7. Noticias disponibles (CONTENT): mantiene título, carrusel y posiciones originales (Stats a 1410, Cut a 1310)", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [mockNewsItem],
      isCached: false,
    })

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverB} />
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
    expect(newsWrapper).toBeDefined()

    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")
  })

  it("8 & 9. Error real de conexión: mantiene 'Sin conexión con las novedades' y 'Reintentar', y NO sube ServerStatsGrid", async () => {
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [],
      error: true,
    })

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = container?.textContent || ""
    // 8. Mantiene tarjeta offline
    expect(text).toContain("Sin conexión con las novedades")
    expect(text).toContain("Reintentar")

    // 9. NO desplaza ServerStatsGrid hacia arriba (mantiene 1410px y cut en 1310px)
    const elements = Array.from(container?.querySelectorAll("div") || [])
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    const cutElement = elements.find(
      (el) => el.style.clipPath && el.style.clipPath.includes("polygon"),
    )
    expect(cutElement?.style.top).toBe("1310px")
  })

  it("10. Loading: NO muestra falsamente el estado offline mientras resuelve", async () => {
    let resolveNewsPromise: ((val: any) => void) | null = null
    const pendingPromise = new Promise((res) => {
      resolveNewsPromise = res
    })
    vi.spyOn(newsService, "getNewsArticles").mockReturnValue(pendingPromise as any)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })

    const textDuringLoading = container?.textContent || ""
    // No debe mostrar offline durante loading
    expect(textDuringLoading).not.toContain("Sin conexión con las novedades")
    expect(textDuringLoading).not.toContain("Reintentar")

    // Disposición estable: no salta a 860 mientras carga
    const elements = Array.from(container?.querySelectorAll("div") || [])
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")

    // Resuelve como vacío
    await act(async () => {
      resolveNewsPromise?.({ items: [], isCached: false })
      await Promise.resolve()
    })

    // Ahora sí cambia a vacío
    expect(statsContainer?.style.top).toBe("860px")
  })

  it("11 & 12. Cambio entre servidores: A (sin noticias) -> B (con noticias) -> A (sin noticias)", async () => {
    const newsSpy = vi.spyOn(newsService, "getNewsArticles").mockImplementation(async (_lang, sId) => {
      if (sId === "server-b") {
        return { items: [mockNewsItem], isCached: false }
      }
      return { items: [], isCached: false }
    })

    // 1. Montar en Servidor A (0 noticias)
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(newsSpy).toHaveBeenCalledWith(expect.anything(), "server-a")
    let elements = Array.from(container?.querySelectorAll("div") || [])
    let stats = elements.find((el) => el.style.paddingBottom === "90px" && el.style.display === "flex")
    expect(stats?.style.top).toBe("860px")
    expect(container?.textContent).not.toContain("Últimas Novedades")

    // 2. Cambiar a Servidor B (con noticias)
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverB} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(newsSpy).toHaveBeenCalledWith(expect.anything(), "server-b")
    elements = Array.from(container?.querySelectorAll("div") || [])
    stats = elements.find((el) => el.style.paddingBottom === "90px" && el.style.display === "flex")
    expect(stats?.style.top).toBe("1410px")
    expect(container?.textContent).toContain("Últimas Novedades")
    expect(container?.textContent).toContain("Nueva Gran Actualización")

    // 3. Volver a Servidor A (sin noticias)
    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    elements = Array.from(container?.querySelectorAll("div") || [])
    stats = elements.find((el) => el.style.paddingBottom === "90px" && el.style.display === "flex")
    expect(stats?.style.top).toBe("860px")
    expect(container?.textContent).not.toContain("Últimas Novedades")
  })

  it("13. Contenido cacheado: se inicializa y muestra como CONTENT de inmediato", async () => {
    localStorage.setItem("hikat_cached_news_server-a", JSON.stringify([mockNewsItem]))

    // Even if network fails, cache provides content
    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [mockNewsItem],
      isCached: true,
    })

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={serverA} />
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
    const statsContainer = elements.find(
      (el) => el.style.paddingBottom === "90px" && el.style.display === "flex",
    )
    expect(statsContainer?.style.top).toBe("1410px")
  })
})
