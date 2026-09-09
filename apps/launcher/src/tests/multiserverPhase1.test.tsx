// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { LanguageProvider } from "../context/LanguageContext"
import LauncherSidebar from "../components/layout/LauncherSidebar"
import SettingsView from "../views/SettingsView"
import { serverService, LauncherServer } from "../services/serverService"
import { newsService } from "../services/newsService"
import { gameService, ReleaseActivatedEvent } from "../services/gameService"
import * as apiClientModule from "../services/apiClient"
import { useServerAccent } from "../utils/dynamicAccent"

const mockServerA: LauncherServer = {
  id: "server-alpha",
  name: "Server Alpha",
  accentColor: "#ff5500",
  minecraftVersion: "1.21.1",
  modLoader: "NEOFORGE",
  modLoaderVersion: "21.1.65",
  launcherActiveReleaseId: "rel-1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mainLogo: {
    id: "logo-a",
    url: "/assets/alpha.png",
  },
  sidebarLogo: {
    id: "logo-a-sub",
    url: "/assets/alpha-sub.png",
  },
}

const mockServerB: LauncherServer = {
  id: "server-beta",
  name: "Server Beta",
  accentColor: null,
  minecraftVersion: "1.20.1",
  modLoader: "FABRIC",
  modLoaderVersion: "0.15.0",
  launcherActiveReleaseId: "rel-2",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mainLogo: null,
  sidebarLogo: null,
}

describe("HiKAT Launcher Multi-Server Phase 1 Verification Suite", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(async () => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  it("1. launcherServers query hydrates catalog and caches to hikat_launcher_servers", async () => {
    const querySpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: { launcherServers: [mockServerA, mockServerB] },
    } as any)

    const servers = await serverService.getLauncherServers()
    expect(querySpy).toHaveBeenCalledTimes(1)
    expect(servers).toHaveLength(2)
    expect(servers[0].id).toBe("server-alpha")
    expect(servers[1].id).toBe("server-beta")

    // Cache verification
    const cached = localStorage.getItem("hikat_launcher_servers")
    expect(cached).not.toBeNull()
    const parsed = JSON.parse(cached!)
    expect(parsed[0].name).toBe("Server Alpha")
  })

  it("2. serverStatus queries status scoped to serverId and isolates cache", async () => {
    const querySpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: {
        serverStatus: {
          status: "ONLINE",
          cpuPercent: 12.5,
          memoryUsedBytes: 1024 * 1024 * 512,
          diskUsedBytes: 1024 * 1024 * 1024,
          uptimeMs: 120000,
          isSuspended: false,
        },
      },
    } as any)

    const status = await serverService.getServerStatus("server-alpha")
    expect(querySpy).toHaveBeenCalledWith(expect.any(String), { serverId: "server-alpha" })
    expect(status?.online).toBe(true)

    // Verify isolated cache
    const cacheAlpha = localStorage.getItem("hikat_cached_server_status_server-alpha")
    expect(cacheAlpha).not.toBeNull()
    const parsed = JSON.parse(cacheAlpha!)
    expect(parsed.online).toBe(true)

    // Verify no collision with other servers or global key
    expect(localStorage.getItem("hikat_cached_server_status_server-beta")).toBeNull()
    expect(localStorage.getItem("hikat_cached_server_status")).toBeNull()
  })

  it("3. newsFeed queries articles scoped to serverId and isolates cache", async () => {
    const querySpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: {
        newsFeed: {
          items: [
            {
              id: "news-1",
              title: "Alpha Update Released",
              summary: "Version 1.1 is live",
              content: "Full notes",
              publishedAt: "2026-02-01",
              authorName: "Admin",
              category: "UPDATE",
            },
          ],
          totalCount: 1,
        },
      },
    } as any)

    const res = await newsService.getNewsArticles("en", "server-alpha")
    expect(querySpy).toHaveBeenCalledWith(expect.any(String), { first: 20, serverId: "server-alpha" })
    expect(res.items).toHaveLength(1)
    expect(res.items[0].title).toBe("Alpha Update Released")

    // Verify isolated cache
    const cacheAlpha = localStorage.getItem("hikat_cached_news_server-alpha")
    expect(cacheAlpha).not.toBeNull()
    expect(localStorage.getItem("hikat_cached_news_server-beta")).toBeNull()
    expect(localStorage.getItem("hikat_cached_news")).toBeNull()
  })

  it("4. publishedModpack queries manifest scoped to serverId and isolates cache", async () => {
    const querySpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: {
        publishedModpack: {
          version: "1.2.0",
          formatVersion: 1,
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          clientFiles: [],
          createdAt: "2026-01-01",
        },
      },
    } as any)

    const manifest = await gameService.getPublishedModpack("server-alpha")
    expect(querySpy).toHaveBeenCalledWith(expect.any(String), { serverId: "server-alpha" })
    expect(manifest?.version).toBe("1.2.0")

    // Check game manifest caching isolation
    querySpy.mockResolvedValueOnce({
      success: true,
      data: {
        publishedModpack: {
          version: "1.2.0",
          formatVersion: 1,
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          clientFiles: [],
          createdAt: "2026-01-01",
        },
      },
    } as any)
    await gameService.checkGameManifest("server-alpha")
    const cacheAlpha = localStorage.getItem("hikat_game_manifest_server-alpha")
    expect(cacheAlpha).not.toBeNull()
    expect(localStorage.getItem("hikat_game_manifest_server-beta")).toBeNull()
  })

  it("5. checkGameManifest isolates local checkSyncPlan to default/legacy server only", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({
      success: true,
      action: "NO_OP",
      actions: [],
      stats: { downloadBytes: 0, deleteCount: 0, reuseCount: 0, totalFiles: 0 },
    })

    ;(window as any).electronAPI = {
      checkSyncPlan: checkSyncPlanMock,
    }

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "2.0.0",
          formatVersion: 1,
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          clientFiles: [
            {
              path: "mods/test.jar",
              sha256: "abc",
              sizeBytes: 1024,
              downloadUrl: "http://example.com/test.jar",
              policy: "MANAGED",
            },
          ],
        },
      },
    } as any)

    // When running checkGameManifest for server-beta (non-default in Phase 1):
    // checkSyncPlan MUST NOT be executed because multi-game filesystem belongs to Phase 2!
    await gameService.checkGameManifest("server-beta")
    expect(checkSyncPlanMock).not.toHaveBeenCalled()

    // When running checkGameManifest for default / apparatia / legacy server:
    await gameService.checkGameManifest("apparatia")
    expect(checkSyncPlanMock).toHaveBeenCalled()
  })

  it("6. LauncherSidebar maintains strictly 3 nav items: Home, Skins, Settings (no server buttons added)", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    act(() => {
      root.render(
        <LanguageProvider>
          <LauncherSidebar
            view="home"
            setView={() => {}}
            s={1}
            theme="dark"
            activeSkinAccent={{ r: 62, g: 196, b: 192, css: "rgb(62, 196, 192)" }}
          />
        </LanguageProvider>
      )
    })

    // Confirm navigation items are exactly 3
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(3)
  })

  it("7. useServerAccent enforces exact priority: admin accentColor > logo extracted > fallback", () => {
    let capturedResult1: any = null
    let capturedResult2: any = null

    function TestComp1() {
      capturedResult1 = useServerAccent("#ff5500", "http://example.com/logo.png", "#3ec4c0")
      return null
    }

    function TestComp2() {
      capturedResult2 = useServerAccent(null, null, "#3ec4c0")
      return null
    }

    const container = document.createElement("div")
    const root = createRoot(container)
    act(() => {
      root.render(
        <>
          <TestComp1 />
          <TestComp2 />
        </>
      )
    })

    expect(capturedResult1.hex.toLowerCase()).toBe("#ff5500")
    expect(capturedResult2.hex.toLowerCase()).toBe("#3ec4c0")
    root.unmount()
  })

  it("8. SettingsView replaces hardcoded GAMES with catalog and hides inner menu when 1 server", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockServerA]}
            selectedGameId="server-alpha"
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    // Switch to game tab
    const tabButtons = container.querySelectorAll(".launcher-tab-btn")
    await act(async () => {
      ;(tabButtons[1] as HTMLElement)?.click()
    })

    // When there is only 1 server, inner game sidebar should NOT be rendered
    const gameSidebarItems = container.querySelectorAll(".game-selector-item")
    expect(gameSidebarItems.length).toBe(0)
  })

  it("9. SettingsView displays internal game selector when games.length > 1 and switches selectedGameId", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    const setSelectedGameIdMock = vi.fn()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockServerA, mockServerB]}
            selectedGameId="server-alpha"
            onSelectGameId={setSelectedGameIdMock}
          />
        </LanguageProvider>
      )
    })

    // Switch to game tab
    const tabButtons = container.querySelectorAll(".launcher-tab-btn")
    await act(async () => {
      ;(tabButtons[1] as HTMLElement)?.click()
    })

    // Both servers should appear in Settings > Juego selector
    const gameSidebarItems = container.querySelectorAll(".game-selector-item")
    expect(gameSidebarItems.length).toBe(2)
    expect(container.textContent).toContain("Server Alpha")
    expect(container.textContent).toContain("Server Beta")

    // Clicking Server Beta triggers onSelectGameId
    await act(async () => {
      ;(gameSidebarItems[1] as HTMLElement)?.click()
    })
    expect(setSelectedGameIdMock).toHaveBeenCalledWith("server-beta")
  })

  it("10. WebSocket RELEASE_ACTIVATED refreshes only matching serverId", async () => {
    let wsCallback: ((ev: ReleaseActivatedEvent) => void) | null = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      wsCallback = cb
      return () => {}
    })

    const checkManifestSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)

    // Mount SettingsView with server-alpha selected
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockServerA, mockServerB]}
            selectedGameId="server-alpha"
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    checkManifestSpy.mockClear()

    // Trigger event for server-beta: should be IGNORED by server-alpha view
    await act(async () => {
      wsCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "2.0.0",
        minecraftVersion: "1.20.1",
        serverId: "server-beta",
      })
    })
    expect(checkManifestSpy).not.toHaveBeenCalled()

    // Trigger event for server-alpha: should trigger refresh
    await act(async () => {
      wsCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.3.0",
        minecraftVersion: "1.21.1",
        serverId: "server-alpha",
      })
    })
    expect(checkManifestSpy).toHaveBeenCalledWith("server-alpha")
  })
})
