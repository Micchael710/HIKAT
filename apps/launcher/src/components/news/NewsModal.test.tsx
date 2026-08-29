// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import NewsModal from "./NewsModal"
import { LanguageProvider } from "../../context/LanguageContext"
import { NewsCardItem } from "../../types"

describe("NewsModal Component — Rich Media & YouTube Embed Suite", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
  })

  afterEach(() => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
  })

  async function renderComponent(ui: React.ReactElement) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(ui)
    })
    unmountCurrent = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    return container
  }

  const sampleYouTubeCard: NewsCardItem = {
    id: "news-yt-1",
    img: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    title: "Gran Actualización & Trailer Oficial",
    desc: "Mira todas las novedades presentadas en el nuevo trailer.",
    content: "Contenido extendido del parche 2.0.",
    type: "UPDATE",
    accentColor: "#38bdf8",
    youtubeVideoId: "dQw4w9WgXcQ",
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    date: "2026-08-29T12:00:00Z",
  }

  const sampleNativeVideoCard: NewsCardItem = {
    id: "news-vid-1",
    img: "http://127.0.0.1:8787/media/content/cover.png",
    title: "Video Subido Directamente",
    desc: "Demostración en video subida al servidor.",
    content: "Texto del video.",
    type: "NEWS",
    accentColor: "#10b981",
    videoUrl: "http://127.0.0.1:8787/media/content/demo.mp4",
    videoMimeType: "video/mp4",
  }

  it("1. YouTube news displays preview and play button initially, clicking play embeds official YouTube iframe", async () => {
    const container = await renderComponent(
      <LanguageProvider>
        <NewsModal card={sampleYouTubeCard} onClose={vi.fn()} />
      </LanguageProvider>,
    )

    // Initially shows preview image and formal play button
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img?.src).toContain("hqdefault.jpg")

    const playBtn = container.querySelector("button")
    expect(playBtn?.textContent).toContain("Reproducir video")

    // No iframe initially
    expect(container.querySelector("iframe")).toBeNull()

    // Click play button
    await act(async () => {
      playBtn?.click()
    })

    // Now iframe should be present with official YouTube embed URL
    const iframe = container.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.src).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0",
    )
    expect(iframe?.allowFullscreen).toBe(true)
    expect(iframe?.getAttribute("allow")).toContain("autoplay")
  })

  it("2. Uploaded video news renders native HTML5 video with controls", async () => {
    const container = await renderComponent(
      <LanguageProvider>
        <NewsModal card={sampleNativeVideoCard} onClose={vi.fn()} />
      </LanguageProvider>,
    )

    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    expect(video?.src).toBe("http://127.0.0.1:8787/media/content/demo.mp4")
    expect(video?.controls).toBe(true)
  })

  it("3. Displays localized type badge and closes on close button click", async () => {
    const onClose = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <NewsModal card={sampleYouTubeCard} onClose={onClose} />
      </LanguageProvider>,
    )

    // Localized type badge in Spanish
    expect(container.textContent).toContain("Actualización")

    // Click close button
    const closeBtn = container.querySelector('button[aria-label="Cerrar"]')
    expect(closeBtn).not.toBeNull()

    await act(async () => {
      ;(closeBtn as HTMLButtonElement)?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
