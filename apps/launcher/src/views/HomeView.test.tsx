// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import HomeView from "./HomeView"
import { LanguageProvider } from "../context/LanguageContext"
import { gameService, type ReleaseActivatedEvent } from "../services/gameService"
import { newsService } from "../services/newsService"
import { serverService } from "../services/serverService"
import { heroHomeBg } from "../assets"
import type { PublishedModpack } from "../vite-env"

describe("HomeView Active Release Cover & Notes Suite", () => {
  let container: HTMLDivElement | null = null
  let root: ReturnType<typeof createRoot> | null = null
  let releaseSubscriber: ((event: ReleaseActivatedEvent) => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    releaseSubscriber = null

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({ items: [], isCached: false })
    vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
      online: true,
      playersOnline: 5,
      maxPlayers: 20,
      latencyMs: 12,
    })
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseSubscriber = cb
      return () => {
        releaseSubscriber = null
      }
    })
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
  })

  it("1. cover IMAGE -> HomeView renders img with cover.url as background", async () => {
    const mockModpack: PublishedModpack = {
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      clientFiles: [],
      notes: "Release 2.0 Notes",
      cover: {
        id: "media-img-1",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 2048,
        url: "http://127.0.0.1:8787/media/content/media-img-1",
        createdAt: new Date().toISOString(),
      },
    }

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(mockModpack)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" />
        </LanguageProvider>,
      )
    })

    const imgs = container?.querySelectorAll("img")
    const coverImg = Array.from(imgs || []).find((img) => img.src === mockModpack.cover?.url)
    expect(coverImg).toBeDefined()
    expect(coverImg?.style.objectFit).toBe("cover")

    // Verify notes text
    expect(container?.textContent).toContain("Release 2.0 Notes")
  })

  it("2. cover VIDEO -> HomeView renders video with autoPlay, muted, loop, playsInline and no controls", async () => {
    const mockModpack: PublishedModpack = {
      version: "2.1.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      clientFiles: [],
      notes: "Video Showcase Notes",
      cover: {
        id: "media-vid-1",
        mediaType: "VIDEO",
        mimeType: "video/mp4",
        sizeBytes: 10485760,
        url: "http://127.0.0.1:8787/media/content/media-vid-1",
        createdAt: new Date().toISOString(),
      },
    }

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(mockModpack)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" />
        </LanguageProvider>,
      )
    })

    const video = container?.querySelector("video")
    expect(video).toBeDefined()
    expect(video?.src).toBe(mockModpack.cover?.url)
    expect(video?.autoplay).toBe(true)
    expect(video?.muted).toBe(true)
    expect(video?.loop).toBe(true)
    expect(video?.playsInline).toBe(true)
    expect(video?.preload).toBe("metadata")
    expect(video?.controls).toBe(false)
    expect(video?.style.objectFit).toBe("cover")

    expect(container?.textContent).toContain("Video Showcase Notes")
  })

  it("3. Without cover -> renders fallback heroHomeBg", async () => {
    const mockModpack: PublishedModpack = {
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      clientFiles: [],
      notes: "No cover release notes",
      cover: null,
    }

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(mockModpack)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" />
        </LanguageProvider>,
      )
    })

    const video = container?.querySelector("video")
    expect(video).toBeNull()

    const imgs = container?.querySelectorAll("img")
    const bgImg = Array.from(imgs || []).find((img) => img.src.includes(heroHomeBg) || img.getAttribute("src") === heroHomeBg)
    expect(bgImg).toBeDefined()
  })

  it("4. Without notes -> renders heroSubtitle fallback", async () => {
    const mockModpack: PublishedModpack = {
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      clientFiles: [],
      notes: null,
      cover: null,
    }

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(mockModpack)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" />
        </LanguageProvider>,
      )
    })

    // Default translation contains Apparatia description
    expect(container?.textContent).toContain("Apparatia")
  })

  it("5. RELEASE_ACTIVATED event refreshes publishedModpack cover and notes dynamically", async () => {
    const initialModpack: PublishedModpack = {
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      clientFiles: [],
      notes: "Initial v1.0 Notes",
      cover: null,
    }

    const updatedModpack: PublishedModpack = {
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      clientFiles: [],
      notes: "Updated v2.0 Release Notes Live",
      cover: {
        id: "media-new-cover",
        mediaType: "IMAGE",
        mimeType: "image/webp",
        sizeBytes: 4096,
        url: "http://127.0.0.1:8787/media/content/media-new-cover",
        createdAt: new Date().toISOString(),
      },
    }

    const getPublishedSpy = vi
      .spyOn(gameService, "getPublishedModpack")
      .mockResolvedValueOnce(initialModpack)
      .mockResolvedValueOnce(updatedModpack)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" />
        </LanguageProvider>,
      )
    })

    expect(container?.textContent).toContain("Initial v1.0 Notes")

    // Dispatch WebSocket RELEASE_ACTIVATED event
    await act(async () => {
      releaseSubscriber?.({
        type: "RELEASE_ACTIVATED",
        version: "2.0.0",
        minecraftVersion: "1.21.1",
      })
    })

    expect(getPublishedSpy).toHaveBeenCalledTimes(2)
    expect(container?.textContent).toContain("Updated v2.0 Release Notes Live")

    const imgs = container?.querySelectorAll("img")
    const newCoverImg = Array.from(imgs || []).find((img) => img.src === updatedModpack.cover?.url)
    expect(newCoverImg).toBeDefined()
  })
})
