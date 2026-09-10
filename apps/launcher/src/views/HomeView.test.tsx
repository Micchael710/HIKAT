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

  const mockServer = {
    id: "test-server-id",
    name: "Test Server",
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    launcherActiveReleaseId: "rel-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

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
          <HomeView theme="dark" selectedServer={mockServer} />
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
          <HomeView theme="dark" selectedServer={mockServer} />
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

  it("3. Without cover -> renders neutral background without heroHomeBg", async () => {
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
          <HomeView theme="dark" selectedServer={mockServer} />
        </LanguageProvider>,
      )
    })

    const video = container?.querySelector("video")
    expect(video).toBeNull()

    const imgs = container?.querySelectorAll("img")
    const bgImg = Array.from(imgs || []).find((img) => img.src.includes(heroHomeBg) || img.getAttribute("src") === heroHomeBg)
    expect(bgImg).toBeUndefined()
  })

  it("4. Empty backend state (no selectedServer) -> no Apparatia, no heroHomeBg, no modpack query", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(null)

    await act(async () => {
      root?.render(
        <LanguageProvider>
          <HomeView theme="dark" selectedServer={null} />
        </LanguageProvider>,
      )
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    const imgs = container?.querySelectorAll("img")
    const bgImg = Array.from(imgs || []).find((img) => img.src.includes(heroHomeBg) || img.getAttribute("src") === heroHomeBg)
    expect(bgImg).toBeUndefined()
    expect(imgs?.length).toBe(0)
    expect(container?.textContent).toContain("UNAVAILABLE")
  })

  it("5. RELEASE_ACTIVATED event refreshes publishedModpack cover and notes dynamically for active server", async () => {
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

    let currentEvent: ReleaseActivatedEvent | null = null

    const renderWithEvent = async (event: ReleaseActivatedEvent | null) => {
      currentEvent = event
      await act(async () => {
        root?.render(
          <LanguageProvider>
            <HomeView theme="dark" selectedServer={mockServer} lastReleaseEvent={currentEvent} />
          </LanguageProvider>,
        )
      })
    }

    await renderWithEvent(null)

    // HomeView itself must NOT create a subscription anymore
    expect(gameService.subscribeReleaseEvents).not.toHaveBeenCalled()
    expect(container?.textContent).toContain("Initial v1.0 Notes")

    // Event for another server -> ignored
    await renderWithEvent({
      type: "RELEASE_ACTIVATED",
      serverId: "other-server-id",
      version: "3.0.0",
      minecraftVersion: "1.21.1",
    })
    expect(getPublishedSpy).toHaveBeenCalledTimes(1)

    // Event without serverId -> ignored
    await renderWithEvent({
      type: "RELEASE_ACTIVATED",
      serverId: undefined as any,
      version: "3.0.0",
      minecraftVersion: "1.21.1",
    })
    expect(getPublishedSpy).toHaveBeenCalledTimes(1)

    // Event for this server -> refreshed
    await renderWithEvent({
      type: "RELEASE_ACTIVATED",
      serverId: "test-server-id",
      version: "2.0.0",
      minecraftVersion: "1.21.1",
    })

    expect(getPublishedSpy).toHaveBeenCalledTimes(2)
    expect(container?.textContent).toContain("Updated v2.0 Release Notes Live")

    const imgs = container?.querySelectorAll("img")
    const newCoverImg = Array.from(imgs || []).find((img) => img.src === updatedModpack.cover?.url)
    expect(newCoverImg).toBeDefined()
  })
})
