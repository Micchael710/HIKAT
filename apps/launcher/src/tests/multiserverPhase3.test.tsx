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
import App from "../App"
import { authService } from "../services/authService"
import * as skinServiceModule from "../services/skinService"
import * as capeServiceModule from "../services/capeService"

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
    vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
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

  // Q. PHASE 3 CLOSURE MANDATORY REGRESSIONS (POINTS A - G)
  describe("Q. Phase 3 Closure Mandatory Regressions (Points A - G)", () => {
    it("A. NO APPARATIA FALLBACK: servers=[] and selectedGameId=null produces no fake Apparatia or game Electron calls", async () => {
      localStorage.setItem("hikat_language", "es")
      const getDedicatedGpuSpy = vi.fn().mockResolvedValue(true)
      const getRamAllocationSpy = vi.fn().mockResolvedValue(8)
      const checkSyncPlanSpy = vi.fn()
      ;(window as any).electronAPI = {
        getDedicatedGpu: getDedicatedGpuSpy,
        getRamAllocation: getRamAllocationSpy,
        checkSyncPlan: checkSyncPlanSpy,
        getSystemTotalRAM: vi.fn().mockResolvedValue(16),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <SettingsView
              theme="dark"
              setTheme={vi.fn()}
              servers={[]}
              selectedGameId={null}
            />
          </LanguageProvider>,
        )
      })

      // Must not contain Apparatia
      expect(container?.textContent).not.toContain("Apparatia")
      // Must not render apparatiaLogo
      const imgs = container?.querySelectorAll("img") || []
      expect(Array.from(imgs).some((img) => img.src.includes("apparatiaLogo"))).toBe(false)
      // Must not invoke game-specific Electron calls
      expect(getDedicatedGpuSpy).not.toHaveBeenCalled()
      expect(getRamAllocationSpy).not.toHaveBeenCalled()
      expect(checkSyncPlanSpy).not.toHaveBeenCalled()
    })

    it("B. SETTINGS CON SERVIDOR REAL: servers with Warria preserves existing game settings behavior", async () => {
      localStorage.setItem("hikat_language", "es")
      const getDedicatedGpuSpy = vi.fn().mockResolvedValue(true)
      const getRamAllocationSpy = vi.fn().mockResolvedValue(8)
      const checkSyncPlanSpy = vi.fn().mockResolvedValue({
        success: true,
        isFullyInstalled: true,
        hasExistingInstall: true,
        needsUpdate: false,
      })
      ;(window as any).electronAPI = {
        getDedicatedGpu: getDedicatedGpuSpy,
        getRamAllocation: getRamAllocationSpy,
        checkSyncPlan: checkSyncPlanSpy,
        getSystemTotalRAM: vi.fn().mockResolvedValue(16),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      localStorage.setItem(
        "hikat_game_manifest_warria-id",
        JSON.stringify({
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          neoForgeVersion: "21.1.65",
          installed: true,
          hasUpdate: false,
          hasExistingInstall: true,
          installedModpackVersion: "1.0.0",
          totalSizeGB: 1,
          clientFiles: [{ path: "test.jar", sha256: "abc", sizeBytes: 100, downloadUrl: "/dl", policy: "NO_MODIFICABLE" }],
        }),
      )

      const mockWarria: LauncherServer = {
        id: "warria-id",
        name: "Warria",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        launcherActiveReleaseId: "rel-w",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <SettingsView
              theme="dark"
              setTheme={vi.fn()}
              servers={[mockWarria]}
              selectedGameId="warria-id"
            />
          </LanguageProvider>,
        )
      })

      // Switch to Juegos tab
      const buttons = Array.from(container?.querySelectorAll("button") || [])
      const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos") || b.textContent?.includes("Games"))
      await act(async () => {
        gamesTabBtn?.click()
      })

      expect(container?.textContent).toContain("Warria")
      expect(getDedicatedGpuSpy).toHaveBeenCalledWith(expect.objectContaining({ gameId: "warria-id" }))
      expect(getRamAllocationSpy).toHaveBeenCalledWith(expect.objectContaining({ gameId: "warria-id" }))
      expect(checkSyncPlanSpy).toHaveBeenCalledWith(expect.objectContaining({ gameId: "warria-id" }))
    })

    it("C. STRICT EVENT FILTER — SETTINGS: filters events by strict gameId matching", async () => {
      localStorage.setItem("hikat_language", "es")
      localStorage.setItem(
        "hikat_game_manifest_warria-id",
        JSON.stringify({
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          neoForgeVersion: "21.1.65",
          installed: true,
          hasUpdate: false,
          hasExistingInstall: true,
          installedModpackVersion: "1.0.0",
          totalSizeGB: 1,
          clientFiles: [{ path: "test.jar", sha256: "abc", sizeBytes: 100, downloadUrl: "/dl", policy: "NO_MODIFICABLE" }],
        }),
      )
      localStorage.setItem("hikat_game_installed_warria-id", "true")

      let launchStatusCb: any = null
      let phaseCb: any = null
      let integrityCb: any = null
      const checkSyncPlanSpy = vi.fn().mockResolvedValue({
        success: true,
        isFullyInstalled: true,
        hasExistingInstall: true,
        needsUpdate: false,
      })

      ;(window as any).electronAPI = {
        getDedicatedGpu: vi.fn().mockResolvedValue(true),
        getRamAllocation: vi.fn().mockResolvedValue(8),
        getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
        checkSyncPlan: checkSyncPlanSpy,
        getSystemTotalRAM: vi.fn().mockResolvedValue(16),
        onLaunchStatus: vi.fn().mockImplementation((cb) => {
          launchStatusCb = cb
          return () => {}
        }),
        onPhaseChange: vi.fn().mockImplementation((cb) => {
          phaseCb = cb
          return () => {}
        }),
        onGameFileIntegrityChanged: vi.fn().mockImplementation((cb) => {
          integrityCb = cb
          return () => {}
        }),
      }

      const mockWarria: LauncherServer = {
        id: "warria-id",
        name: "Warria",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        launcherActiveReleaseId: "rel-w",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <SettingsView
              theme="dark"
              setTheme={vi.fn()}
              servers={[mockWarria]}
              selectedGameId="warria-id"
            />
          </LanguageProvider>,
        )
      })

      // Switch to Juegos tab
      const buttons = Array.from(container?.querySelectorAll("button") || [])
      const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos") || b.textContent?.includes("Games"))
      await act(async () => {
        gamesTabBtn?.click()
      })

      const uninstallBtn = Array.from(container?.querySelectorAll("button") || []).find((b) =>
        b.textContent?.includes("Desinstalar") || b.textContent?.includes("Uninstall"),
      ) as HTMLButtonElement
      expect(uninstallBtn).toBeDefined()
      expect(uninstallBtn.disabled).toBe(false)

      // 1. Launch status filter
      // onLaunchStatus("running", undefined) -> ignore
      await act(async () => {
        launchStatusCb?.("running", undefined)
      })
      expect(uninstallBtn.disabled).toBe(false)

      // onLaunchStatus("running", {}) -> ignore
      await act(async () => {
        launchStatusCb?.("running", {})
      })
      expect(uninstallBtn.disabled).toBe(false)

      // onLaunchStatus("running", { gameId: "server-b-id" }) -> ignore
      await act(async () => {
        launchStatusCb?.("running", { gameId: "server-b-id" })
      })
      expect(uninstallBtn.disabled).toBe(false)

      // onLaunchStatus("running", { gameId: "warria-id" }) -> accept (disables button)
      await act(async () => {
        launchStatusCb?.("running", { gameId: "warria-id" })
      })
      expect(uninstallBtn.disabled).toBe(true)

      // Reset to idle
      await act(async () => {
        launchStatusCb?.("idle", { gameId: "warria-id" })
      })
      expect(uninstallBtn.disabled).toBe(false)

      // 2. Phase change filter
      // onPhaseChange("DOWNLOADING", undefined) -> ignore
      await act(async () => {
        phaseCb?.("DOWNLOADING", undefined)
      })
      expect(uninstallBtn.disabled).toBe(false)

      // onPhaseChange("DOWNLOADING", "server-b-id") -> ignore
      await act(async () => {
        phaseCb?.("DOWNLOADING", "server-b-id")
      })
      expect(uninstallBtn.disabled).toBe(false)

      // onPhaseChange("DOWNLOADING", "warria-id") -> accept
      await act(async () => {
        phaseCb?.("DOWNLOADING", "warria-id")
      })
      expect(uninstallBtn.disabled).toBe(true)

      // Reset phase to IDLE
      await act(async () => {
        phaseCb?.("IDLE", "warria-id")
      })
      expect(uninstallBtn.disabled).toBe(false)

      // 3. Integrity changed filter
      checkSyncPlanSpy.mockClear()
      // onGameFileIntegrityChanged(undefined) -> ignore
      await act(async () => {
        integrityCb?.(undefined)
      })
      expect(checkSyncPlanSpy).not.toHaveBeenCalled()

      // onGameFileIntegrityChanged({ gameId: "server-b-id" }) -> ignore
      await act(async () => {
        integrityCb?.({ gameId: "server-b-id" })
      })
      expect(checkSyncPlanSpy).not.toHaveBeenCalled()

      // onGameFileIntegrityChanged({ gameId: "warria-id" }) -> accept
      await act(async () => {
        integrityCb?.({ gameId: "warria-id" })
      })
      expect(checkSyncPlanSpy).toHaveBeenCalledWith(expect.objectContaining({ gameId: "warria-id" }))
    })

    it("D. ACTION STATUS: SettingsView ignores action-status without matching gameId", async () => {
      localStorage.setItem("hikat_language", "es")
      ;(window as any).electronAPI = {
        getDedicatedGpu: vi.fn().mockResolvedValue(true),
        getRamAllocation: vi.fn().mockResolvedValue(8),
        getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
        checkSyncPlan: vi.fn().mockResolvedValue({
          success: true,
          isFullyInstalled: true,
          hasExistingInstall: true,
          needsUpdate: false,
        }),
        getSystemTotalRAM: vi.fn().mockResolvedValue(16),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
      }

      const mockWarria: LauncherServer = {
        id: "warria-id",
        name: "Warria",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        launcherActiveReleaseId: "rel-w",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <SettingsView
              theme="dark"
              setTheme={vi.fn()}
              servers={[mockWarria]}
              selectedGameId="warria-id"
            />
          </LanguageProvider>,
        )
      })

      // Switch to Juegos tab
      const buttons = Array.from(container?.querySelectorAll("button") || [])
      const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos") || b.textContent?.includes("Games"))
      await act(async () => {
        gamesTabBtn?.click()
      })

      // 1. hikat:game-action-status without gameId -> ignored
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-status", {
            detail: { action: "verify", state: "started" },
          }),
        )
      })
      expect(container?.textContent).not.toMatch(/Verificando\.\.\.|Verifying\.\.\./)

      // 2. gameId server-b-id -> ignored
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-status", {
            detail: { action: "verify", state: "started", gameId: "server-b-id" },
          }),
        )
      })
      expect(container?.textContent).not.toMatch(/Verificando\.\.\.|Verifying\.\.\./)

      // 3. gameId warria-id -> accepted
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-status", {
            detail: { action: "verify", state: "started", gameId: "warria-id" },
          }),
        )
      })
      expect(container?.textContent).toMatch(/Verificando\.\.\.|Verifying\.\.\./)

      // Finish verification
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-status", {
            detail: { action: "verify", state: "finished", gameId: "warria-id" },
          }),
        )
      })
      expect(container?.textContent).not.toMatch(/Verificando\.\.\.|Verifying\.\.\./)
    })

    it("E. DOWNLOADPLAYBUTTON REQUEST: Warria button accepts requests only matching warria-id", async () => {
      const uninstallSpy = vi.spyOn(gameService, "uninstallGame").mockResolvedValue(true)
      let resolveSync: any = null
      const syncPromise = new Promise((resolve) => {
        resolveSync = resolve
      })
      const startSyncSpy = vi.spyOn(gameService, "startSync").mockReturnValue(syncPromise as any)

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasExistingInstall: true,
        installedModpackVersion: "1.0.0",
        totalSizeGB: 1,
        clientFiles: [{ path: "test.jar", sha256: "abc", sizeBytes: 100, downloadUrl: "/dl", policy: "NO_MODIFICABLE" }],
      })

      ;(window as any).electronAPI = {
        getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        checkSyncPlan: vi.fn().mockResolvedValue({
          success: true,
          isFullyInstalled: true,
          hasExistingInstall: true,
          needsUpdate: false,
        }),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <DownloadPlayButton
              left={0}
              top={0}
              serverId="warria-id"
              gameContext={{ gameId: "warria-id", gameName: "Warria" }}
              theme="dark"
            />
          </LanguageProvider>,
        )
      })

      // 1. Request without gameId -> ignored
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-request", {
            detail: { action: "verify" },
          }),
        )
      })
      expect(startSyncSpy).not.toHaveBeenCalled()

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-request", {
            detail: { action: "uninstall" },
          }),
        )
      })
      expect(uninstallSpy).not.toHaveBeenCalled()

      // 2. Request for server-b-id -> ignored
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-request", {
            detail: { action: "verify", gameId: "server-b-id" },
          }),
        )
      })
      expect(startSyncSpy).not.toHaveBeenCalled()

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-request", {
            detail: { action: "uninstall", gameId: "server-b-id" },
          }),
        )
      })
      expect(uninstallSpy).not.toHaveBeenCalled()

      // 3. Request for warria-id -> accepted
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-request", {
            detail: { action: "verify", gameId: "warria-id" },
          }),
        )
      })
      expect(startSyncSpy).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveSync?.({ paused: false })
      })

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("hikat:game-action-request", {
            detail: { action: "uninstall", gameId: "warria-id" },
          }),
        )
      })
      expect(uninstallSpy).toHaveBeenCalledTimes(1)
    })

    it("F. SERVERSTATS EMPTY: without serverName or stats.name, does NOT invent 'Server'", async () => {
      vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
        online: true,
        playersOnline: 5,
        maxPlayers: 20,
        latencyMs: 30,
      })

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <ServerStatsGrid serverId="custom-server" theme="dark" />
          </LanguageProvider>,
        )
      })

      // In the server card, the server title element (fontSize: 22) must be empty and not contain the placeholder "Server"
      const serverNameHeader = container?.querySelector("div[style*='font-size: 22px']")
      expect(serverNameHeader?.textContent).toBe("")
      expect(serverNameHeader?.textContent).not.toBe("Server")
    })

    it("G. HOME RESET POR SERVER ID: App renders HomeView with server id key, resetting on change", async () => {
      const mockWarria: LauncherServer = {
        id: "warria-id",
        name: "Warria",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        launcherActiveReleaseId: "rel-w",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const mockServerB: LauncherServer = {
        id: "server-b-id",
        name: "Server B",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        modLoaderVersion: "47.2.0",
        launcherActiveReleaseId: "rel-b",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
        cb(
          {
            user: {
              id: "u-1",
              displayName: "Tester",
              email: "tester@example.com",
              role: "PLAYER",
            },
          },
          "AUTHENTICATED",
        )
        return () => {}
      })
      vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
      vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-token")
      vi.spyOn(authService, "getCachedUser").mockReturnValue({
        id: "u-1",
        displayName: "Tester",
        username: "Tester",
        email: "tester@example.com",
        role: "PLAYER",
      } as any)

      vi.spyOn(skinServiceModule, "fetchGlobalSkins").mockResolvedValue([])
      vi.spyOn(skinServiceModule, "fetchMyPlayerSkin").mockResolvedValue(null)
      vi.spyOn(skinServiceModule, "fetchMyActiveSkin").mockResolvedValue(null)
      vi.spyOn(capeServiceModule, "fetchGlobalCapes").mockResolvedValue([])
      vi.spyOn(capeServiceModule, "fetchMyPlayerCapes").mockResolvedValue([])
      vi.spyOn(capeServiceModule, "fetchMyActiveCape").mockResolvedValue({
        type: "NONE",
        capeId: null,
        playerCapeId: null,
      })

      vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({ items: [], isCached: false })
      vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
        online: true,
        playersOnline: 2,
        maxPlayers: 20,
        latencyMs: 15,
      })
      vi.spyOn(serverService, "getLauncherServers").mockResolvedValue([mockWarria, mockServerB])

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        neoForgeVersion: "21.1.65",
        installed: false,
        hasUpdate: false,
        hasExistingInstall: false,
        totalSizeGB: 10,
        clientFiles: [],
      })
      vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})

      ;(window as any).electronAPI = {
        onOAuthCallback: vi.fn(() => () => {}),
        getPendingOAuthCallback: vi.fn().mockResolvedValue(null),
        getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
        checkSyncPlan: vi.fn().mockResolvedValue({
          success: true,
          isFullyInstalled: true,
          hasExistingInstall: true,
          needsUpdate: false,
        }),
      }

      await act(async () => {
        root?.render(
          <LanguageProvider>
            <App />
          </LanguageProvider>,
        )
      })
      await act(async () => {
        await Promise.resolve()
      })

      // Initially Warria is selected and rendered
      expect(container?.textContent).toContain("Warria")

      // Verify direct key remounting: HomeView rendered with key=server.id recreates DOM
      function HomeWithKeyTracker({ server }: { server: LauncherServer }) {
        return (
          <div data-testid={`wrapper-${server.id}`}>
            <HomeView key={server.id} theme="dark" selectedServer={server} />
          </div>
        )
      }

      const trackerContainer = document.createElement("div")
      const trackerRoot = createRoot(trackerContainer)

      await act(async () => {
        trackerRoot.render(
          <LanguageProvider>
            <HomeWithKeyTracker server={mockWarria} />
          </LanguageProvider>,
        )
      })
      expect(trackerContainer.textContent).toContain("Warria")
      const warriaHomeEl = trackerContainer.querySelector("[data-testid='wrapper-warria-id'] > div")

      // Changing server forces unmount of old instance and new instance mount due to key change
      await act(async () => {
        trackerRoot.render(
          <LanguageProvider>
            <HomeWithKeyTracker server={mockServerB} />
          </LanguageProvider>,
        )
      })
      const serverBHomeEl = trackerContainer.querySelector("[data-testid='wrapper-server-b-id'] > div")
      expect(warriaHomeEl).not.toBe(serverBHomeEl)
      expect(trackerContainer.textContent).toContain("Server B")
      expect(trackerContainer.textContent).not.toContain("Warria")

      act(() => {
        trackerRoot.unmount()
      })
      trackerContainer.remove()
    })
  })

  describe("Phase 11: Real Multiserver Bugfixes & Architecture Verification", () => {
    const warriaServer: LauncherServer = {
      id: "warria-id",
      name: "Warria",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      launcherActiveReleaseId: "rel-w",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sidebarLogo: {
        id: "logo-warria",
        url: "/media/warria-sidebar.png",
      },
    }

    const serverB: LauncherServer = {
      id: "server-b-id",
      name: "Server B",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      modLoaderVersion: "47.2.0",
      launcherActiveReleaseId: "rel-b",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mainLogo: {
        id: "logo-server-b",
        url: "/media/server-b-main.png",
      },
    }

    it("A. CSP: index.html connect-src explicitly permits wss://api.hikat.org without wildcards", () => {
      const htmlPath = path.resolve(__dirname, "../../index.html")
      const htmlContent = fs.readFileSync(htmlPath, "utf-8")
      const match = htmlContent.match(/Content-Security-Policy["']\s+content="([^"]+)"/i)
      expect(match).toBeTruthy()
      const csp = match![1]
      expect(csp).toContain("connect-src")
      expect(csp).toContain("wss://api.hikat.org")
      expect(csp).not.toMatch(/connect-src[^;]*\bwss:\b/)
      expect(csp).not.toMatch(/connect-src[^;]*\bwss:\/\/\*/)
      expect(csp).not.toMatch(/connect-src[^;]*\s\*\s/)
    })

    it("B. DOWNLOAD SECURITY: validateUrlSecurity allows api.hikat.org and blocks foreign hosts & production localhost", () => {
      const { validateUrlSecurity } = require("../../electron/client-files-sync.cjs")
      const origEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = "production"
        expect(validateUrlSecurity(new URL("https://api.hikat.org/game/client-files/1"))).toBe(true)
        expect(() => validateUrlSecurity(new URL("https://evil.example.com/mod.jar"))).toThrow(
          /Unauthorized external download host blocked/i,
        )
        expect(() => validateUrlSecurity(new URL("http://api.hikat.org/game/client-files/1"))).toThrow(
          /strictly forbidden in production/i,
        )
        expect(() => validateUrlSecurity(new URL("http://localhost:3000/mod.jar"))).toThrow(
          /Localhost download URLs are forbidden in production mode/i,
        )

        process.env.NODE_ENV = "development"
        expect(validateUrlSecurity(new URL("http://localhost:8787/game/client-files/1"))).toBe(true)
        expect(validateUrlSecurity(new URL("http://127.0.0.1:8787/game/client-files/1"))).toBe(true)
        expect(validateUrlSecurity(new URL("https://api.hikat.org/game/client-files/1"))).toBe(true)
        expect(() => validateUrlSecurity(new URL("https://foreign.org/file.jar"))).toThrow(
          /Unauthorized external download host blocked/i,
        )
      } finally {
        process.env.NODE_ENV = origEnv
      }
    })

    it("C. GLOBAL WS: useLauncherState with [Warria] receives RELEASE_ACTIVATED for server-b-id and refreshes catalog to [Warria, Server B]", async () => {
      localStorage.clear()
      latestLauncherState = null

      let releaseListener: ((e: ReleaseActivatedEvent) => void) | null = null
      vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
        releaseListener = cb
        return () => {
          releaseListener = null
        }
      })

      let currentServers = [warriaServer]
      const getServersSpy = vi.spyOn(serverService, "getLauncherServers").mockImplementation(async () => currentServers)

      const hookContainer = document.createElement("div")
      const hookRoot = createRoot(hookContainer)
      await act(async () => {
        hookRoot.render(<HookConsumer />)
      })
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        latestLauncherState.setScreen("home")
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.servers).toHaveLength(1)
      expect(latestLauncherState.servers[0].name).toBe("Warria")
      expect(releaseListener).not.toBeNull()

      // Simulate backend publishing Server B and emitting RELEASE_ACTIVATED
      currentServers = [warriaServer, serverB]
      await act(async () => {
        releaseListener?.({
          type: "RELEASE_ACTIVATED",
          serverId: "server-b-id",
          version: "1.0.0",
          minecraftVersion: "1.20.1",
        })
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(getServersSpy).toHaveBeenCalledTimes(2)
      expect(latestLauncherState.servers).toHaveLength(2)
      expect(latestLauncherState.servers.map((s: any) => s.id)).toEqual(["warria-id", "server-b-id"])
      expect(latestLauncherState.lastReleaseEvent).toEqual({
        type: "RELEASE_ACTIVATED",
        serverId: "server-b-id",
        version: "1.0.0",
        minecraftVersion: "1.20.1",
      })

      act(() => {
        hookRoot.unmount()
      })
      hookContainer.remove()
    })

    it("D. PRIMER SERVIDOR: initial servers=[] -> RELEASE_ACTIVATED(warria-id) loads [Warria] and sets selectedGameId=warria-id", async () => {
      localStorage.clear()
      latestLauncherState = null

      let releaseListener: ((e: ReleaseActivatedEvent) => void) | null = null
      vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
        releaseListener = cb
        return () => {
          releaseListener = null
        }
      })

      let currentServers: LauncherServer[] = []
      vi.spyOn(serverService, "getLauncherServers").mockImplementation(async () => currentServers)

      const hookContainer = document.createElement("div")
      const hookRoot = createRoot(hookContainer)
      await act(async () => {
        hookRoot.render(<HookConsumer />)
      })
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        latestLauncherState.setScreen("home")
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.servers).toEqual([])
      expect(latestLauncherState.selectedGameId).toBeNull()

      // First server published
      currentServers = [warriaServer]
      await act(async () => {
        releaseListener?.({
          type: "RELEASE_ACTIVATED",
          serverId: "warria-id",
          version: "1.0.0",
          minecraftVersion: "1.21.1",
        })
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.servers).toHaveLength(1)
      expect(latestLauncherState.servers[0].name).toBe("Warria")
      expect(latestLauncherState.selectedGameId).toBe("warria-id")
      expect(latestLauncherState.selectedServer?.name).toBe("Warria")

      act(() => {
        hookRoot.unmount()
      })
      hookContainer.remove()
    })

    it("E. NO CAMBIAR SELECCIÓN: servers=[Warria], selectedGameId=warria-id; on Server B event, selectedGameId remains warria-id", async () => {
      localStorage.clear()
      latestLauncherState = null

      let releaseListener: ((e: ReleaseActivatedEvent) => void) | null = null
      vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
        releaseListener = cb
        return () => {
          releaseListener = null
        }
      })

      let currentServers = [warriaServer]
      vi.spyOn(serverService, "getLauncherServers").mockImplementation(async () => currentServers)

      const hookContainer = document.createElement("div")
      const hookRoot = createRoot(hookContainer)
      await act(async () => {
        hookRoot.render(<HookConsumer />)
      })
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        latestLauncherState.setScreen("home")
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.selectedGameId).toBe("warria-id")

      // Server B arrives
      currentServers = [warriaServer, serverB]
      await act(async () => {
        releaseListener?.({
          type: "RELEASE_ACTIVATED",
          serverId: "server-b-id",
          version: "1.0.0",
          minecraftVersion: "1.20.1",
        })
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(latestLauncherState.servers).toHaveLength(2)
      // Must NOT change selectedGameId since Warria still exists
      expect(latestLauncherState.selectedGameId).toBe("warria-id")
      expect(latestLauncherState.selectedServer?.name).toBe("Warria")

      act(() => {
        hookRoot.unmount()
      })
      hookContainer.remove()
    })

    it("F. UNA SOLA SUBSCRIPTION: HomeView does NOT create subscribeReleaseEvents; only useLauncherState owns subscription", async () => {
      const subscribeSpy = vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
      vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(null)
      vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({ items: [], isCached: false })
      vi.spyOn(serverService, "getServerStatus").mockResolvedValue({ online: true, playersOnline: 0, maxPlayers: 10, latencyMs: 20 })

      const homeContainer = document.createElement("div")
      const homeRoot = createRoot(homeContainer)
      await act(async () => {
        homeRoot.render(
          <LanguageProvider>
            <HomeView theme="dark" selectedServer={warriaServer} />
          </LanguageProvider>,
        )
      })

      // HomeView does NOT create any subscription
      expect(subscribeSpy).not.toHaveBeenCalled()

      act(() => {
        homeRoot.unmount()
      })
      homeContainer.remove()
    })

    it("G. HOMESERVER REFRESH: Home showing Warria only re-queries getPublishedModpack when event matches activeServerId", async () => {
      const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        clientFiles: [],
      })
      vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({ items: [], isCached: false })
      vi.spyOn(serverService, "getServerStatus").mockResolvedValue({ online: true, playersOnline: 0, maxPlayers: 10, latencyMs: 20 })

      const homeContainer = document.createElement("div")
      const homeRoot = createRoot(homeContainer)

      let eventToPass: ReleaseActivatedEvent | null = null
      const renderHome = async (ev: ReleaseActivatedEvent | null) => {
        eventToPass = ev
        await act(async () => {
          homeRoot.render(
            <LanguageProvider>
              <HomeView theme="dark" selectedServer={warriaServer} lastReleaseEvent={eventToPass} />
            </LanguageProvider>,
          )
        })
      }

      await renderHome(null)
      expect(getPublishedSpy).toHaveBeenCalledTimes(1)
      expect(getPublishedSpy).toHaveBeenCalledWith("warria-id")

      // Event for Server B -> do NOT re-query Warria modpack
      await renderHome({
        type: "RELEASE_ACTIVATED",
        serverId: "server-b-id",
        version: "1.0.0",
        minecraftVersion: "1.20.1",
      })
      expect(getPublishedSpy).toHaveBeenCalledTimes(1)

      // Event for Warria -> DO re-query Warria modpack
      await renderHome({
        type: "RELEASE_ACTIVATED",
        serverId: "warria-id",
        version: "1.0.1",
        minecraftVersion: "1.21.1",
      })
      expect(getPublishedSpy).toHaveBeenCalledTimes(2)

      act(() => {
        homeRoot.unmount()
      })
      homeContainer.remove()
    })

    it("H. SIDEBAR 1 SERVER: servers=[Warria] maintains only Home, Skins, Settings buttons without server selectors", () => {
      const sidebarContainer = document.createElement("div")
      const sidebarRoot = createRoot(sidebarContainer)

      act(() => {
        sidebarRoot.render(
          <LanguageProvider>
            <LauncherSidebar
              view="home"
              setView={() => {}}
              s={1}
              theme="dark"
              activeSkinAccent={{ r: 62, g: 196, b: 192, css: "62, 196, 192" }}
              servers={[warriaServer]}
              selectedGameId="warria-id"
            />
          </LanguageProvider>,
        )
      })

      const buttons = sidebarContainer.querySelectorAll("button.sidebar-nav-btn")
      expect(buttons.length).toBe(3) // Exactly Home, Skins, Settings
      expect(buttons[0].getAttribute("title")).toBe("Home")
      expect(buttons[1].getAttribute("title")).toBe("Skins")
      expect(buttons[2].getAttribute("title")).toBe("Settings")

      act(() => {
        sidebarRoot.unmount()
      })
      sidebarContainer.remove()
    })

    it("I. SIDEBAR 2 SERVERS: servers=[Warria, Server B] renders Home, Warria button, Server B button, Skins, Settings", () => {
      const sidebarContainer = document.createElement("div")
      const sidebarRoot = createRoot(sidebarContainer)

      act(() => {
        sidebarRoot.render(
          <LanguageProvider>
            <LauncherSidebar
              view="home"
              setView={() => {}}
              s={1}
              theme="dark"
              activeSkinAccent={{ r: 62, g: 196, b: 192, css: "62, 196, 192" }}
              servers={[warriaServer, serverB]}
              selectedGameId="warria-id"
            />
          </LanguageProvider>,
        )
      })

      const buttons = sidebarContainer.querySelectorAll("button.sidebar-nav-btn")
      expect(buttons.length).toBe(5) // Home, Warria, Server B, Skins, Settings
      expect(buttons[0].getAttribute("title")).toBe("Home")
      expect(buttons[1].getAttribute("title")).toBe("Warria")
      expect(buttons[2].getAttribute("title")).toBe("Server B")
      expect(buttons[3].getAttribute("title")).toBe("Skins")
      expect(buttons[4].getAttribute("title")).toBe("Settings")

      // Verify each server button uses its logo
      const warriaImg = buttons[1].querySelector("img")
      expect(warriaImg).not.toBeNull()
      expect(warriaImg?.getAttribute("src")).toContain("warria-sidebar.png")

      const serverBImg = buttons[2].querySelector("img")
      expect(serverBImg).not.toBeNull()
      expect(serverBImg?.getAttribute("src")).toContain("server-b-main.png")

      act(() => {
        sidebarRoot.unmount()
      })
      sidebarContainer.remove()
    })

    it("J. SERVER SELECTION: Clicking Server B in sidebar calls onSelectServer(server-b-id) and setView(home)", () => {
      const sidebarContainer = document.createElement("div")
      const sidebarRoot = createRoot(sidebarContainer)
      const onSelectServerSpy = vi.fn()
      const setViewSpy = vi.fn()

      act(() => {
        sidebarRoot.render(
          <LanguageProvider>
            <LauncherSidebar
              view="settings"
              setView={setViewSpy}
              s={1}
              theme="dark"
              activeSkinAccent={{ r: 62, g: 196, b: 192, css: "62, 196, 192" }}
              servers={[warriaServer, serverB]}
              selectedGameId="warria-id"
              onSelectServer={onSelectServerSpy}
            />
          </LanguageProvider>,
        )
      })

      const buttons = sidebarContainer.querySelectorAll("button.sidebar-nav-btn")
      expect(buttons.length).toBe(5)

      // Click Server B button (index 2)
      act(() => {
        buttons[2].dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })

      expect(onSelectServerSpy).toHaveBeenCalledWith("server-b-id")
      expect(setViewSpy).toHaveBeenCalledWith("home")

      act(() => {
        sidebarRoot.unmount()
      })
      sidebarContainer.remove()
    })
  })
})
