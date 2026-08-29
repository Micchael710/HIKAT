// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import NewsCarousel from "./NewsCarousel"
import { LanguageProvider } from "../../context/LanguageContext"
import { newsService } from "../../services/newsService"

describe("NewsCarousel Component Lifecycle & Remount Verification (Shard 8F)", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    localStorage.clear()
    vi.restoreAllMocks()
  })

  async function mountCarousel() {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <NewsCarousel canvasLeft={0} canvasWidth={1920} theme="dark" />
        </LanguageProvider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    const unmount = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    unmountCurrent = unmount

    return { container, unmount }
  }

  it("1. Mounting NewsCarousel queries newsService.getNewsArticles()", async () => {
    const newsSpy = vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [
        {
          id: "news-test-1",
          img: "/media/banner-1.png",
          title: "Noticia de Prueba",
          desc: "Descripción de prueba",
          content: "Contenido",
          accentColor: "#3ec4c0",
          date: "2026-08-29T12:00:00Z",
        },
      ],
      isCached: false,
    })

    const { container } = await mountCarousel()

    expect(newsSpy).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Noticia de Prueba")
  })

  it("2. Remounting NewsCarousel (e.g. Navigating away and returning to Home) triggers a fresh query to newsService.getNewsArticles()", async () => {
    const newsSpy = vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({
      items: [
        {
          id: "news-test-2",
          img: "/media/banner-2.png",
          title: "Segunda Noticia",
          desc: "Descripción",
          content: "Contenido",
          accentColor: "#e8a840",
          date: "2026-08-29T13:00:00Z",
        },
      ],
      isCached: false,
    })


    // User is on Home: 1st mount
    const { unmount } = await mountCarousel()
    expect(newsSpy).toHaveBeenCalledTimes(1)

    // User leaves Home
    unmount()

    // User returns to Home: 2nd mount
    const { unmount: unmount2 } = await mountCarousel()
    expect(newsSpy).toHaveBeenCalledTimes(2)

    unmount2()
  })
})
