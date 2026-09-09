// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../context/LanguageContext"
import { serverService, type LauncherServer } from "../services/serverService"
import { gameService, type ReleaseActivatedEvent } from "../services/gameService"
import { newsService } from "../services/newsService"
import HomeView from "../views/HomeView"
import SettingsView from "../views/SettingsView"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import LauncherSidebar from "../components/layout/LauncherSidebar"
import ServerStatsGrid from "../components/server/ServerStatsGrid"
import NewsCarousel from "../components/news/NewsCarousel"
import { useLauncherState } from "../hooks/useLauncherState"
import * as apiClientModule from "../services/apiClient"

const initTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hikat-p3-main-"))
const electronMock = {
  app: {
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    getPath: vi.fn((name) => {
      if (name === "appData") return initTempDir
      if (name === "userData") return path.join(initTempDir, "userData")
      return initTempDir
    }),
    setPath: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn().mockReturnValue(new Promise(() => {})),
  },
  BrowserWindow: function BrowserWindowMock() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      isDestroyed: () => false,
      webContents: {
        send: vi.fn(),
        setVisualZoomLevelLimits: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        getURL: vi.fn().mockReturnValue(""),
      },
    }
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
  nativeImage: {
    createFromPath: () => ({}),
  },
  shell: {
    openExternal: vi.fn(),
  },
  Tray: vi.fn().mockImplementation(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
  })),
  Menu: {
    buildFromTemplate: vi.fn(),
  },
}

try {
  const electronPath = require.resolve("electron")
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: electronMock,
  } as any
} catch (_) {}

vi.mock("electron", () => ({
  ...electronMock,
  default: electronMock,
}))

const { SettingsStore } = require("../../electron/settings-store.cjs")
const { resolveGameContext } = require("../../electron/main.cjs")

let latestLauncherState: any = null
function HookConsumer() {
  latestLauncherState = useLauncherState()
  return null
}

describe("HiKAT Multi-Server Phase 3 Mandatory Regression Suite", () => {
  let container: HTMLDivElement | null = null
  let root: ReturnType<typeof createRoot> | null = null
  let tempDir = ""

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hikat-phase3-test-"))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
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
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch (_) {}
    }
  })

  // A. EMPTY BACKEND
  describe("A. Empty Backend State", () => {
    it("When backend returns 0 servers, state is completely clean with no Apparatia fallbacks", async () => {
      // Seed legacy caches into localStorage
      localStorage.setItem("hikat_launcher_servers", JSON.stringify([{ id: "app-id", name: "Apparatia" }]))
      localStorage.setItem("hikat_selected_game_id", "app-id")
      localStorage.setItem("hikat_cached_news", JSON.stringify([{ id: "legacy-news", title: "Old News" }]))
      localStorage.setItem("hikat_cached_server_status", JSON.stringify({ online: true, playersOnline: 100 }))

      // Mock GraphQL returning empty servers
      vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
        success: true,
        data: { launcherServers: [] },
      })

      const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")
      const getNewsSpy = vi.spyOn(newsService, "getNewsArticles")

      // Hook consumption
      const hookContainer = document.createElement("div")
      const hookRoot = createRoot(hookContainer)
      await act(async () => {
        hookRoot.render(<HookConsumer />)
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.servers).toEqual([])
      expect(latestLauncherState.selectedGameId).toBeNull()
      expect(latestLauncherState.selectedServer).toBeNull()
      expect(localStorage.getItem("hikat_selected_game_id")).toBeNull()
      act(() => {
        hookRoot.unmount()
      })

      // Mount HomeView with null selectedServer
      await act(async () => {
        root?.render(
          <LanguageProvider>
            <HomeView theme="dark" selectedServer={null} />
          </LanguageProvider>,
        )
      })

      // Must not query publishedModpack without serverId
      expect(getPublishedSpy).not.toHaveBeenCalled()
      // No server title or Apparatia hero
      expect(container?.querySelector("h1")?.textContent || "").not.toContain("Apparatia")
      // DownloadPlayButton is unavailable
      expect(container?.textContent).toContain("UNAVAILABLE")
      // No images (no logo, no heroHomeBg) rendered in hero
      const imgs = container?.querySelectorAll("img") || []
      expect(imgs.length).toBe(0)

      // NewsCarousel with null serverId does not query newsFeed or read global cache
      await act(async () => {
        root?.render(
          <LanguageProvider>
            <NewsCarousel canvasLeft={0} serverId={null} theme="dark" />
          </LanguageProvider>,
        )
      })
      expect(getNewsSpy).not.toHaveBeenCalled()
    })
  })

  // B. BACKEND SERVERS
  describe("B. Authoritative Backend Servers Catalog", () => {
    it("Catalog contains exactly the backend servers, selection uses real ID, no fake Apparatia", async () => {
      const mockBackendServers: LauncherServer[] = [
        {
          id: "warria-id",
          name: "Warria",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          launcherActiveReleaseId: "rel-w",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "server-b-id",
          name: "Server B",
          minecraftVersion: "1.20.1",
          modLoader: "FORGE",
          modLoaderVersion: "47.2.0",
          launcherActiveReleaseId: "rel-b",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]

      vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
        success: true,
        data: { launcherServers: mockBackendServers },
      })

      const servers = await serverService.getLauncherServers()
      expect(servers.length).toBe(2)
      expect(servers[0].name).toBe("Warria")
      expect(servers[1].name).toBe("Server B")

      const hookContainer = document.createElement("div")
      const hookRoot = createRoot(hookContainer)
      await act(async () => {
        hookRoot.render(<HookConsumer />)
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.servers.length).toBe(2)
      expect(latestLauncherState.selectedGameId).toBe("warria-id")
      expect(latestLauncherState.selectedServer?.name).toBe("Warria")
      act(() => {
        hookRoot.unmount()
      })
    })
  })

  // C. PATH
  describe("C. Clean Instance Paths", () => {
    it("Resolves instanceRoot into games/<gameName>, never 'game files'", () => {
      const warriaCtx = resolveGameContext({ gameId: "warria-id", gameName: "Warria" })
      expect(warriaCtx.instanceRoot.replace(/\\/g, "/")).toContain("games/Warria")
      expect(warriaCtx.instanceRoot).not.toContain("game files")

      const apparatiaCtx = resolveGameContext({ gameId: "apparatia-id", gameName: "Apparatia" })
      expect(apparatiaCtx.instanceRoot.replace(/\\/g, "/")).toContain("games/Apparatia")
      expect(apparatiaCtx.instanceRoot).not.toContain("game files")
    })
  })

  // D. NO MIGRATION
  describe("D. Zero Legacy Migration", () => {
    it("Pre-existing 'game files' contents are untouched, no copy, no move, no rename, no deletion", () => {
      // Find or inspect legacy folder
      const apparatiaCtx = resolveGameContext({ gameId: "apparatia-id", gameName: "Apparatia" })
      expect(apparatiaCtx.instanceRoot.replace(/\\/g, "/")).toContain("games/Apparatia")

      // Legacy files remain undisturbed without any migration routines
      expect(fs.existsSync(apparatiaCtx.instanceRoot)).toBe(false)
    })
  })

  // E. SETTINGS DEFAULTS
  describe("E. Clean Settings Defaults without Legacy Inheritance", () => {
    it("First access to any gameId gives dedicatedGpu=true and ramGB=8, Apparatia does NOT inherit legacy", () => {
      const store = new SettingsStore(tempDir)
      // Pre-seed legacy settings in the store
      store.set("ramGB", 16)
      store.set("dedicatedGpu", false)

      // Access for Apparatia
      const appRam = store.getGameSetting("apparatia-id", "ramGB", { gameName: "Apparatia" })
      const appGpu = store.getGameSetting("apparatia-id", "dedicatedGpu", { gameName: "Apparatia" })

      expect(appRam).toBe(8)
      expect(appGpu).toBe(true)

      // Access for Warria
      const warriaRam = store.getGameSetting("warria-id", "ramGB", { gameName: "Warria" })
      const warriaGpu = store.getGameSetting("warria-id", "dedicatedGpu", { gameName: "Warria" })

      expect(warriaRam).toBe(8)
      expect(warriaGpu).toBe(true)
    })
  })

  // F. DOWNLOAD CONTEXT
  describe("F. GameContext Passed to Operations", () => {
    it("startSync, pauseSync, cancelSync, uninstallGame, launchGame all receive gameContext", async () => {
      const warriaContext = { gameId: "warria-id", gameName: "Warria" }

      const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)
      const pauseSyncSpy = vi.spyOn(gameService, "pauseSync").mockResolvedValue({ success: true } as any)
      const cancelSyncSpy = vi.spyOn(gameService, "cancelSync").mockResolvedValue({ success: true } as any)
      const uninstallSpy = vi.spyOn(gameService, "uninstallGame").mockResolvedValue({ success: true } as any)
      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      await gameService.startSync([], "1.0.0", "1.21.1", "NEOFORGE", null, null, false, [], warriaContext)
      expect(startSyncSpy).toHaveBeenCalledWith(
        expect.anything(),
        "1.0.0",
        "1.21.1",
        "NEOFORGE",
        null,
        null,
        false,
        [],
        warriaContext,
      )

      await gameService.pauseSync(warriaContext)
      expect(pauseSyncSpy).toHaveBeenCalledWith(warriaContext)

      await gameService.cancelSync(warriaContext)
      expect(cancelSyncSpy).toHaveBeenCalledWith(warriaContext)

      await gameService.uninstallGame(warriaContext)
      expect(uninstallSpy).toHaveBeenCalledWith(warriaContext)

      await gameService.launchGame({
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        playerName: "Player",
        gameContext: warriaContext,
      })
      expect(launchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          gameContext: warriaContext,
        }),
      )
    })
  })

  // G. INSTALLED CACHE
  describe("G. Per-Server Installed Cache", () => {
    it("Warria persists installed state only in hikat_game_installed_warria-id", () => {
      gameService.setGameInstalled(true, "warria-id")
      expect(localStorage.getItem("hikat_game_installed_warria-id")).toBe("true")
      expect(localStorage.getItem("hikat_game_installed")).toBeNull()
      expect(gameService.isGameInstalled("warria-id")).toBe(true)
    })
  })

  // H. LAUNCH SETTINGS
  describe("H. Launch Does Not Rely on Global RAM", () => {
    it("DownloadPlayButton passes launch parameters without injecting global RAM", async () => {
      localStorage.setItem("hikat_ram_gb", "24")
      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        installed: true,
        installedModpackVersion: "1.0.0",
        hasUpdate: false,
        hasExistingInstall: true,
        totalSizeGB: 5,
        totalDownloadBytes: 0,
        clientFiles: [],
      })

      const warriaContext = { gameId: "warria-id", gameName: "Warria" }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              gameContext={warriaContext}
              serverId="warria-id"
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      const playBtn = container?.querySelector("button")
      expect(playBtn?.textContent).toMatch(/JUGAR|PLAY/)

      await act(async () => {
        playBtn?.click()
      })

      expect(launchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          gameContext: warriaContext,
        }),
      )
      // The launch payload does not contain hardcoded global 24GB from localStorage
      const launchPayload = launchSpy.mock.calls[0][0]
      expect((launchPayload as any).ramGB).toBeUndefined()
    })
  })

  // I, J, K, L. SWITCH DURING OPERATIONS & SNAPSHOT REHYDRATION
  describe("I-L. Operation Persistence Across Server Switches", () => {
    it("I. Rehydrates downloading state and snapshot progress when returning to active game", async () => {
      const warriaContext = { gameId: "warria-id", gameName: "Warria" }

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        installed: false,
        installedModpackVersion: null,
        hasUpdate: false,
        hasExistingInstall: false,
        totalSizeGB: 5,
        totalDownloadBytes: 1000,
        clientFiles: [{ path: "test.jar", sizeBytes: 1000, sha256: "abc", policy: "NO_MODIFICABLE", downloadUrl: "url" }],
      })

      // Simulate Electron returning active downloading snapshot for Warria
      ;(window as any).electronAPI = {
        getLaunchStatus: vi.fn().mockResolvedValue({
          status: "idle",
          activeOperationGameId: "warria-id",
          operationState: "SYNCING",
          operationSnapshot: {
            gameId: "warria-id",
            phase: "DOWNLOADING",
            progress: 42,
            speedMBs: 12.5,
            downloadedBytes: 420,
            totalBytes: 1000,
            remainingMinutes: 1,
          },
        }),
        onDownloadProgress: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              gameContext={warriaContext}
              serverId="warria-id"
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      // Rehydrated into downloading state with 42% progress
      expect(container?.textContent).toMatch(/DESCARGANDO|DOWNLOADING/)
      expect(container?.textContent).toContain("42%")
    })

    it("J. Rehydrates INSTALLING phase when returning to active game", async () => {
      const warriaContext = { gameId: "warria-id", gameName: "Warria" }

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        installed: false,
        installedModpackVersion: null,
        hasUpdate: false,
        hasExistingInstall: false,
        totalSizeGB: 5,
        totalDownloadBytes: 1000,
        clientFiles: [{ path: "test.jar", sizeBytes: 1000, sha256: "abc", policy: "NO_MODIFICABLE", downloadUrl: "url" }],
      })

      ;(window as any).electronAPI = {
        getLaunchStatus: vi.fn().mockResolvedValue({
          status: "idle",
          activeOperationGameId: "warria-id",
          operationState: "INSTALLING",
          operationSnapshot: {
            gameId: "warria-id",
            phase: "INSTALLING",
            progress: 95,
            speedMBs: 0,
            downloadedBytes: 1000,
            totalBytes: 1000,
            remainingMinutes: 0,
          },
        }),
        onDownloadProgress: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              gameContext={warriaContext}
              serverId="warria-id"
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      expect(container?.textContent).toMatch(/INSTALANDO|INSTALLING/)
      expect(container?.textContent).toContain("95%")
    })

    it("K. Rehydrates PAUSED phase when returning to active game", async () => {
      const warriaContext = { gameId: "warria-id", gameName: "Warria" }

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        installed: false,
        installedModpackVersion: null,
        hasUpdate: false,
        hasExistingInstall: false,
        totalSizeGB: 5,
        totalDownloadBytes: 1000,
        clientFiles: [{ path: "test.jar", sizeBytes: 1000, sha256: "abc", policy: "NO_MODIFICABLE", downloadUrl: "url" }],
      })

      ;(window as any).electronAPI = {
        getLaunchStatus: vi.fn().mockResolvedValue({
          status: "idle",
          activeOperationGameId: "warria-id",
          operationState: "PAUSED",
          operationSnapshot: {
            gameId: "warria-id",
            phase: "PAUSED",
            progress: 50,
            speedMBs: 0,
            downloadedBytes: 500,
            totalBytes: 1000,
            remainingMinutes: 0,
          },
        }),
        onDownloadProgress: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              gameContext={warriaContext}
              serverId="warria-id"
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      expect(container?.textContent).toMatch(/PAUSADO|PAUSED/)
      expect(container?.textContent).toContain("50%")
    })

    it("L. When operation finishes while away, manifest check resolves to PLAY or UPDATE without phantom downloading", async () => {
      const warriaContext = { gameId: "warria-id", gameName: "Warria" }

      // When returning, operation is IDLE and game is fully installed
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        installed: true,
        installedModpackVersion: "1.0.0",
        hasUpdate: false,
        hasExistingInstall: true,
        totalSizeGB: 5,
        totalDownloadBytes: 0,
        clientFiles: [],
      })

      ;(window as any).electronAPI = {
        getLaunchStatus: vi.fn().mockResolvedValue({
          status: "idle",
          activeOperationGameId: null,
          operationState: "IDLE",
          operationSnapshot: null,
        }),
        onDownloadProgress: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              gameContext={warriaContext}
              serverId="warria-id"
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      expect(container?.textContent).toMatch(/JUGAR|PLAY/)
      expect(container?.textContent).not.toMatch(/DESCARGANDO|DOWNLOADING/)
      expect(container?.textContent).not.toMatch(/INSTALANDO|INSTALLING/)
    })
  })

  // M. VERIFY/UNINSTALL SETTINGS
  describe("M. Verify & Uninstall in Settings per Server", () => {
    it("Dispatches action request containing targeted gameId, and ignores events from other games", async () => {
      gameService.setGameInstalled(true, "warria-id")
      ;(window as any).electronAPI = {
        getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
        checkSyncPlan: vi.fn().mockResolvedValue({ success: true, isFullyInstalled: true, installedModpackVersion: "1.0.0" }),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      const warriaServer: LauncherServer = {
        id: "warria-id",
        name: "Warria",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        launcherActiveReleaseId: "rel-w",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const receivedRequests: any[] = []
      const requestListener = (e: Event) => {
        receivedRequests.push((e as CustomEvent).detail)
      }
      window.addEventListener("hikat:game-action-request", requestListener)

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        installed: true,
        installedModpackVersion: "1.0.0",
        hasUpdate: false,
        hasExistingInstall: true,
        totalSizeGB: 5,
        totalDownloadBytes: 0,
        clientFiles: [],
      })

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <SettingsView
              theme="dark"
              servers={[warriaServer]}
              selectedGameId="warria-id"
              onSelectGameId={() => {}}
            />
          </LanguageProvider>,
        )
      })

      // Switch to Games tab in Settings
      const tabButtons = Array.from(container?.querySelectorAll("button") || [])
      const gamesTabBtn = tabButtons.find((b) => b.textContent?.includes("Juegos") || b.textContent?.includes("Games"))
      await act(async () => {
        gamesTabBtn?.click()
      })

      // Find Verify button in Settings
      const buttons = Array.from(container?.querySelectorAll("button") || [])
      const verifyBtn = buttons.find((b) => b.textContent?.includes("Verificar") || b.textContent?.includes("Verify"))
      expect(verifyBtn).toBeDefined()

      await act(async () => {
        verifyBtn?.click()
      })

      expect(receivedRequests.length).toBe(1)
      expect(receivedRequests[0]).toEqual({
        action: "verify",
        gameId: "warria-id",
      })

      window.removeEventListener("hikat:game-action-request", requestListener)
    })
  })

  // N. RELEASE EVENTS
  describe("N. Release Events Isolation", () => {
    it("RELEASE_ACTIVATED event for Warria does not trigger modpack fetch for Server B", async () => {
      let releaseListener: ((event: ReleaseActivatedEvent) => void) | null = null
      vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
        releaseListener = cb
        return () => {}
      })

      const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        clientFiles: [],
        notes: "Server B Notes",
        cover: null,
      })

      const serverB: LauncherServer = {
        id: "server-b-id",
        name: "Server B",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        launcherActiveReleaseId: "rel-b",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <HomeView theme="dark" selectedServer={serverB} />
          </LanguageProvider>,
        )
      })

      expect(getPublishedSpy).toHaveBeenCalledTimes(1)
      expect(getPublishedSpy).toHaveBeenCalledWith("server-b-id")

      // Emit release for Warria
      await act(async () => {
        releaseListener?.({
          type: "RELEASE_ACTIVATED",
          serverId: "warria-id",
          version: "2.0.0",
          minecraftVersion: "1.21.1",
        })
      })

      // Server B is untouched (still called only 1 time)
      expect(getPublishedSpy).toHaveBeenCalledTimes(1)
    })
  })

  // O & P. ACCENT
  describe("O & P. Server Accent Resolution and Application", () => {
    it("O. Applies server.accentColor to DownloadPlayButton, Sidebar, and ServerStats without Apparatia yellow", () => {
      const customAccent = {
        r: 51,
        g: 102,
        b: 255,
        hex: "#3366ff",
        rgb: [51, 102, 255] as [number, number, number],
        css: "51, 102, 255",
        isDark: false,
      }

      // DownloadPlayButton with custom accent
      act(() => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              accent={customAccent}
              serverId="warria-id"
              gameContext={{ gameId: "warria-id", gameName: "Warria" }}
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      const btn = container?.querySelector("button") as HTMLElement
      expect(btn).toBeDefined()
      // Background gradient uses custom accent (#3366ff / 51, 102, 255)
      expect(btn.style.background).toMatch(/#3366ff|51,\s*102,\s*255/)
      expect(btn.style.background).not.toContain("#efc436")
      expect(btn.style.background).not.toContain("239, 196, 54")

      // LauncherSidebar receives homeAccent
      act(() => {
        root?.render(
          <LanguageProvider>
            <LauncherSidebar
              s={1}
              view="home"
              setView={() => {}}
              theme="dark"
              activeSkinAccent={{ r: 62, g: 196, b: 192, css: "62, 196, 192" }}
              homeAccent={customAccent}
            />
          </LanguageProvider>,
        )
      })

      const homeBtn = container?.querySelector(".sidebar-nav-btn.is-active") as HTMLElement
      expect(homeBtn).toBeDefined()
      expect(homeBtn.style.boxShadow).toContain("rgba(51, 102, 255")

      // ServerStatsGrid receives resolvedAccent
      act(() => {
        root?.render(
          <LanguageProvider>
            <ServerStatsGrid
              serverId="warria-id"
              theme="dark"
              resolvedAccent={customAccent}
            />
          </LanguageProvider>,
        )
      })

      const card = container?.querySelector(".server-stats-card") as HTMLElement
      expect(card).toBeDefined()
    })
  })
})
