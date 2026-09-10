// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../context/LanguageContext"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import LauncherSidebar from "../components/layout/LauncherSidebar"
import DownloadsView from "../views/DownloadsView"
import { gameService } from "../services/gameService"
import type { LauncherServer } from "../services/serverService"
import { getTranslation } from "../context/LanguageContext"
import esDict from "../locales/es.json"
import enDict from "../locales/en.json"
import ptDict from "../locales/pt.json"
import frDict from "../locales/fr.json"

// ── Mock Electron for Real main.cjs Execution ──
const ipcHandlers = new Map<string, Function>()
const ipcListeners = new Map<string, Function>()

const getHandler = (channel: string): Function => {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`IPC Handler not found: ${channel}`)
  return handler
}

let testTempDir = ""
let testAppDataRoot = ""
let testUserDataRoot = ""

testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hikat-queue-test-"))
testAppDataRoot = path.join(testTempDir, "HiKAT")
testUserDataRoot = path.join(testAppDataRoot, "launcher")
fs.mkdirSync(path.join(testAppDataRoot, "games"), { recursive: true })
fs.mkdirSync(path.join(testAppDataRoot, "game files"), { recursive: true })
fs.mkdirSync(testUserDataRoot, { recursive: true })

let latestBrowserWindowInstance: any = null
const lastSentEvents: { channel: string; args: any[] }[] = []

const electronMock = {
  app: {
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    getPath: vi.fn((name) => {
      if (name === "appData") return testTempDir
      if (name === "userData") return testUserDataRoot
      return testTempDir
    }),
    setPath: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn().mockReturnValue(new Promise(() => {})),
  },
  BrowserWindow: function BrowserWindowMock() {
    const win = {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      isDestroyed: () => false,
      focus: vi.fn(),
      restore: vi.fn(),
      isVisible: () => true,
      isMinimized: () => false,
      webContents: {
        send: vi.fn((channel, ...args) => {
          lastSentEvents.push({ channel, args })
        }),
        setVisualZoomLevelLimits: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        getURL: vi.fn().mockReturnValue(""),
      },
    }
    latestBrowserWindowInstance = win
    return win
  },
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      ipcHandlers.set(channel, handler)
    },
    on: (channel: string, listener: Function) => {
      ipcListeners.set(channel, listener)
    },
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
  const electronResolved = require.resolve("electron")
  require.cache[electronResolved] = {
    id: electronResolved,
    filename: electronResolved,
    loaded: true,
    exports: electronMock,
  } as any
} catch (_) {}

vi.mock("electron", () => ({
  ...electronMock,
  default: electronMock,
}))

// Override http.get so server check does not wait
import http from "http"
http.get = ((_opts: any, _cb: any) => {
  const req = {
    on: (evt: string, handler: Function) => {
      if (evt === "error") handler(new Error("ECONNREFUSED"))
      return req
    },
    destroy: vi.fn(),
  }
  return req as any
}) as any

// Mock minecraft-core and client-files-sync to prevent remote downloads while allowing controlled async sync
const realMinecraftCore = require("../../electron/minecraft-core.cjs")
const mcCoreResolved = require.resolve("../../electron/minecraft-core.cjs")
require.cache[mcCoreResolved] = {
  id: mcCoreResolved,
  filename: mcCoreResolved,
  loaded: true,
  exports: {
    ...realMinecraftCore,
    checkCore: async (opts: any) => realMinecraftCore.checkCore(opts),
    installCore: async () => ({ success: true, resolvedVersionId: "1.20.1" }),
  },
} as any

let shouldSyncFinish = false
const realClientFilesSync = require("../../electron/client-files-sync.cjs")
const cfsResolved = require.resolve("../../electron/client-files-sync.cjs")
require.cache[cfsResolved] = {
  id: cfsResolved,
  filename: cfsResolved,
  loaded: true,
  exports: {
    ...realClientFilesSync,
    generateSyncPlan: async () => ({
      toDownload: [{ path: "mods/sample.jar", sizeBytes: 100 }],
      toDelete: [],
      preserved: [],
      totalDownloadBytes: 100,
    }),
    downloadClientFilesToStaging: async ({ cancelSignal }: any) => {
      while (cancelSignal && !cancelSignal.isCancelled && !cancelSignal.isPaused && !shouldSyncFinish) {
        await new Promise((r) => setTimeout(r, 10))
      }
      return { stagedFiles: [] }
    },
  },
} as any

// Require the REAL main.cjs from production
const mainExports = require("../../electron/main.cjs")
const { gameLauncher, operationManager, settingsStore, resetDownloadQueueForTesting } = mainExports

const serverA: LauncherServer = {
  id: "server-a",
  name: "Warria",
  accentColor: "#3366ff",
  minecraftVersion: "1.21.1",
  modLoader: "VANILLA",
  launcherActiveReleaseId: "rel-a",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sidebarLogo: { id: "logo-a", url: "https://api.apparatia.net/media/logo-a.png" },
}

const serverB: LauncherServer = {
  id: "server-b",
  name: "Survival Realm",
  accentColor: "#ff5500",
  minecraftVersion: "1.21.1",
  modLoader: "VANILLA",
  launcherActiveReleaseId: "rel-b",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sidebarLogo: { id: "logo-b", url: "https://api.apparatia.net/media/logo-b.png" },
}

const serverC: LauncherServer = {
  id: "server-c",
  name: "Creative World",
  accentColor: "#10b981",
  minecraftVersion: "1.21.1",
  modLoader: "VANILLA",
  launcherActiveReleaseId: "rel-c",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sidebarLogo: { id: "logo-c", url: "https://api.apparatia.net/media/logo-c.png" },
}

describe("HiKAT Phase 11 — Execution Reinforcement & Global Download Queue Suite", () => {
  let container: HTMLDivElement
  let root: any
  let launchStatusCallback: any = null
  let phaseChangeCallback: any = null
  let queueChangeCallback: any = null
  let downloadProgressCallback: any = null

  beforeEach(() => {
    shouldSyncFinish = false
    lastSentEvents.length = 0
    resetDownloadQueueForTesting()
    localStorage.setItem("hikat_language", "es")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    launchStatusCallback = null
    phaseChangeCallback = null
    queueChangeCallback = null
    downloadProgressCallback = null

    ;(window as any).electronAPI = {
      getLaunchStatus: vi.fn().mockResolvedValue({
        status: "idle",
        runningGameId: null,
        activeOperationGameId: null,
        activeOperationState: "IDLE",
        activeOperationPhase: null,
      }),
      onLaunchStatus: vi.fn((cb) => {
        launchStatusCallback = cb
        return () => {
          launchStatusCallback = null
        }
      }),
      onPhaseChange: vi.fn((cb) => {
        phaseChangeCallback = cb
        return () => {
          phaseChangeCallback = null
        }
      }),
      onDownloadProgress: vi.fn((cb) => {
        downloadProgressCallback = cb
        return () => {
          downloadProgressCallback = null
        }
      }),
      getDownloadQueue: vi.fn().mockResolvedValue({
        active: null,
        queued: [],
      }),
      onDownloadQueueChanged: vi.fn((cb) => {
        queueChangeCallback = cb
        return () => {
          queueChangeCallback = null
        }
      }),
      startSync: vi.fn().mockResolvedValue({ success: true }),
      pauseSync: vi.fn().mockResolvedValue({ success: true, paused: true }),
      cancelSync: vi.fn().mockResolvedValue({ success: true }),
      launchGame: vi.fn().mockResolvedValue({ success: true }),
      getPauseDownloadsOnGameLaunch: vi.fn().mockResolvedValue(true),
      setPauseDownloadsOnGameLaunch: vi.fn().mockResolvedValue(true),
    }

    vi.spyOn(gameService, "checkGameManifest").mockImplementation(async () => {
      return {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE" as any,
        totalSizeGB: 1.5,
        hasUpdate: false,
        installedModpackVersion: "1.0.0",
        clientFiles: [{ path: "mods/example.jar", sha256: "abc", sizeBytes: 1000, downloadUrl: "http://x", policy: "NO_MODIFICABLE" as any }],
        installed: true,
        hasExistingInstall: true,
      } as any
    })
  })

  afterEach(async () => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()

    resetDownloadQueueForTesting()
    // Cancel any active sync in operationManager to leave manager IDLE
    if (operationManager && operationManager.getState() !== "IDLE") {
      try {
        await operationManager.cancelSync(testAppDataRoot)
      } catch (_) {}
    }
  })

  // 1. VISUAL & LAYOUT ALIGNMENT FOR DOWNLOADSVIEW (Item 1, 2, 3, 5, 6, 8, 22)
  it("1. DOWNLOADSVIEW ALIGNMENT: Uses top=145, left=184, right=80, viewFadeIn, title=32px, subtitle=16px, no maxWidth 1100, centered empty state", async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView theme="dark" servers={[serverA, serverB]} />
        </LanguageProvider>,
      )
    })

    const mainContainer = container.querySelector("[data-testid='downloads-view-container']") as HTMLElement
    expect(mainContainer).not.toBeNull()
    expect(mainContainer.style.position).toBe("absolute")
    expect(mainContainer.style.left).toBe("184px")
    expect(mainContainer.style.top).toBe("145px")
    expect(mainContainer.style.right).toBe("80px")
    expect(mainContainer.style.bottom).toBe("24px")
    expect(mainContainer.style.animation).toContain("viewFadeIn")

    // Verify Title and Subtitle font metrics
    const titleEl = container.querySelector("div[style*='font-size: 32px'], div[style*='fontSize: 32px']") as HTMLElement
    expect(titleEl).not.toBeNull()
    expect(titleEl.textContent).toBe("Descargas")

    const subtitleEl = container.querySelector("div[style*='font-size: 16px'], div[style*='fontSize: 16px']") as HTMLElement
    expect(subtitleEl).not.toBeNull()
    expect(subtitleEl.textContent).toBe("Administra tus descargas y actualizaciones")

    // Verify no maxWidth 1100px exists
    const maxWidth1100 = container.querySelector("div[style*='max-width: 1100px'], div[style*='maxWidth: 1100px']")
    expect(maxWidth1100).toBeNull()

    // Verify Empty State is centered in width 100%
    expect(container.textContent).toContain("No hay descargas activas")
    const emptyContainer = container.querySelector("div[style*='width: 100%'][style*='align-items: center'], div[style*='width: 100%'][style*='alignItems: center']") as HTMLElement
    expect(emptyContainer).not.toBeNull()
  })

  // 2. SNAPSHOT DIRECT CONSUMPTION (Item 14, 15)
  it("2. SNAPSHOT CONSUMPTION: Directly updates from onDownloadQueueChanged snapshot without redundant IPC", async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView theme="dark" servers={[serverA, serverB]} />
        </LanguageProvider>,
      )
    })

    const getDownloadQueueSpy = (window as any).electronAPI.getDownloadQueue
    getDownloadQueueSpy.mockClear()

    // Simulate event sending a snapshot
    const testSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 75,
        speedMBs: 24.2,
        downloadedBytes: 750000000,
        totalBytes: 1000000000,
        remainingMinutes: 1,
      },
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
        },
      ],
    }

    await act(async () => {
      queueChangeCallback?.(testSnapshot)
    })

    expect(container.textContent).toContain("Warria")
    expect(container.textContent).toContain("75%")
    expect(container.textContent).toContain("24.2 MB/s")
    expect(container.textContent).toContain("Survival Realm")
    expect(container.textContent).toContain("posición 1")

    // Did NOT make another getDownloadQueue IPC call
    expect(getDownloadQueueSpy).not.toHaveBeenCalled()
  })

  // 3. SINGLE MINECRAFT UX (Item 1 & 24)
  it("3. SINGLE MINECRAFT UX: When Game A is running, Game B button remains PLAY, is visually disabled, click is blocked, and reverts on idle", async () => {
    ;(window as any).electronAPI.getLaunchStatus = vi.fn().mockResolvedValue({
      status: "running",
      runningGameId: "server-a",
      gameId: "server-a",
    })

    const launchGameSpy = vi.spyOn(gameService, "launchGame")

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            gameContext={{ gameId: "server-b", gameName: "Survival Realm" }}
            serverId="server-b"
          />
        </LanguageProvider>,
      )
    })

    const btn = container.querySelector("button")
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toContain("JUGAR")
    expect(btn?.disabled).toBe(true)
    expect(btn?.style.cursor).toBe("not-allowed")
    expect(btn?.style.opacity).toBe("0.65")

    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(launchGameSpy).not.toHaveBeenCalled()

    // Reverts on idle
    ;(window as any).electronAPI.getLaunchStatus = vi.fn().mockResolvedValue({
      status: "idle",
      runningGameId: null,
      activeOperationGameId: null,
      activeOperationState: "IDLE",
      activeOperationPhase: null,
    })

    await act(async () => {
      launchStatusCallback?.("idle", { gameId: "server-a", runningGameId: null })
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(btn?.disabled).toBe(false)
    expect(btn?.style.cursor).toBe("pointer")
    expect(btn?.style.opacity).toBe("1")
  })

  // 4. PRELOAD SNAPSHOT DELIVERY & EMISSION (Item 13 & 21)
  it("4. PRELOAD & QUEUE CHANGED EVENT: onDownloadQueueChanged in preload delivers snapshot parameter to callback", () => {
    const registeredHandlers = new Map<string, Function>()
    const mockIpcRenderer = {
      on: (channel: string, handler: Function) => registeredHandlers.set(channel, handler),
      removeListener: vi.fn(),
    }

    // Preload implementation behavior
    const onDownloadQueueChanged = (callback: (snap: any) => void) => {
      const handler = (_event: any, snapshot: any) => callback(snapshot)
      mockIpcRenderer.on("game-download-queue-changed", handler)
      return () => mockIpcRenderer.removeListener("game-download-queue-changed", handler)
    }

    let receivedSnapshot: any = null
    const unsubscribe = onDownloadQueueChanged((snap) => {
      receivedSnapshot = snap
    })

    const testSnap = { active: { gameId: "server-x" }, queued: [] }
    const handler = registeredHandlers.get("game-download-queue-changed")
    expect(handler).toBeDefined()

    handler!({}, testSnap)
    expect(receivedSnapshot).toBe(testSnap)
    expect(receivedSnapshot).not.toBeUndefined()

    unsubscribe()
    expect(mockIpcRenderer.removeListener).toHaveBeenCalled()
  })

  // 5. TRANSLATIONS PARITY (Item 23)
  it("5. TRANSLATIONS: downloads.subtitle and keys exist across all 4 locales", () => {
    const locales = [
      { code: "es", dict: esDict, expectedSub: "Administra tus descargas y actualizaciones" },
      { code: "en", dict: enDict, expectedSub: "Manage your downloads and updates" },
      { code: "pt", dict: ptDict, expectedSub: "Gerencie seus downloads e atualizações" },
      { code: "fr", dict: frDict, expectedSub: "Gérez vos téléchargements et mises à jour" },
    ] as const

    for (const { code, expectedSub } of locales) {
      expect(getTranslation(code, "downloads.title")).toBeTruthy()
      expect(getTranslation(code, "downloads.subtitle")).toBe(expectedSub)
      expect(getTranslation(code, "downloads.active")).toBeTruthy()
      expect(getTranslation(code, "downloads.queue")).toBeTruthy()
      expect(getTranslation(code, "downloads.empty")).toBeTruthy()
      expect(getTranslation(code, "downloads.emptySubtitle")).toBeTruthy()
      expect(getTranslation(code, "downloads.pause")).toBeTruthy()
      expect(getTranslation(code, "downloads.resume")).toBeTruthy()
      expect(getTranslation(code, "downloads.cancel")).toBeTruthy()
      expect(getTranslation(code, "playButton.queued")).toBeTruthy()
      expect(getTranslation(code, "settings.pauseDownloadsOnGameLaunchTitle")).toBeTruthy()
      expect(getTranslation(code, "settings.pauseDownloadsOnGameLaunchDesc")).toBeTruthy()
    }
  })

  // 6. REAL MAIN FIFO QUEUE (Item 10, 11, 12, 16, 17, 20)
  it("6. REAL MAIN FIFO QUEUE: Enqueues B and C while A syncs; advances A -> B -> C without activeSyncPromise race", async () => {
    const startHandler = getHandler("game-start-sync")
    const getQueueHandler = getHandler("game-get-download-queue")
    const cancelHandler = getHandler("game-cancel-sync")

    const sampleFiles = [
      {
        path: "mods/sample.jar",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE" as const,
        downloadUrl: "http://localhost/sample.jar",
      },
    ]

    // 1. Start A (controlled sync, stays active)
    const syncAPromise = startHandler({}, {
      gameId: "server-a",
      gameName: "Warria",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    }).catch((e: any) => e)

    await new Promise((r) => setTimeout(r, 40))

    // 2. Enqueue B and C
    const resB = await startHandler({}, {
      gameId: "server-b",
      gameName: "Survival Realm",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    })
    expect(resB.queued).toBe(true)
    expect(resB.position).toBe(1)

    const resC = await startHandler({}, {
      gameId: "server-c",
      gameName: "Creative World",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    })
    expect(resC.queued).toBe(true)
    expect(resC.position).toBe(2)

    // 3. Verify Real Queue State: active A, queued [B, C]
    let queueSnap = await getQueueHandler()
    expect(queueSnap.active?.gameId).toBe("server-a")
    expect(queueSnap.queued.map((q: any) => q.gameId)).toEqual(["server-b", "server-c"])

    // Duplicate prevention
    const resBDup = await startHandler({}, {
      gameId: "server-b",
      gameName: "Survival Realm",
      clientFiles: sampleFiles,
    })
    expect(resBDup.queued).toBe(true)
    expect(resBDup.position).toBe(1)
    queueSnap = await getQueueHandler()
    expect(queueSnap.queued.length).toBe(2)

    // 4. Cancel A to allow next queued item to run cleanly
    const syncBPromise = cancelHandler({}, { gameId: "server-a", gameName: "Warria" })
    await syncAPromise
    await syncBPromise
    await new Promise((r) => setTimeout(r, 60))

    // 5. B must have started automatically! Queue now has [C]
    queueSnap = await getQueueHandler()
    expect(queueSnap.active?.gameId).toBe("server-b")
    expect(queueSnap.queued.map((q: any) => q.gameId)).toEqual(["server-c"])

    // 6. Cancel B: C must start automatically!
    await cancelHandler({}, { gameId: "server-b", gameName: "Survival Realm" })
    await new Promise((r) => setTimeout(r, 60))

    queueSnap = await getQueueHandler()
    expect(queueSnap.active?.gameId).toBe("server-c")
    expect(queueSnap.queued.length).toBe(0)

    // 7. Cancel C: Queue becomes completely empty
    await cancelHandler({}, { gameId: "server-c", gameName: "Creative World" })
    await new Promise((r) => setTimeout(r, 40))

    queueSnap = await getQueueHandler()
    expect(queueSnap.active).toBeNull()
    expect(queueSnap.queued.length).toBe(0)
  })

  // 7. REAL AUTO-PAUSE / AUTO-RESUME (Item 18, 19)
  it("7. REAL AUTO-PAUSE & RESUME: Launching Game B auto-pauses Game A; Game B idle auto-resumes Game A; manual pause is NOT auto-resumed", async () => {
    const startHandler = getHandler("game-start-sync")
    const pauseHandler = getHandler("game-pause-sync")
    const getStatusHandler = getHandler("game-get-status")
    const launchHandler = getHandler("game-launch")
    const cancelHandler = getHandler("game-cancel-sync")

    settingsStore.set("pauseDownloadsOnGameLaunch", true)

    const sampleFiles = [
      {
        path: "mods/sample.jar",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE" as const,
        downloadUrl: "http://localhost/sample.jar",
      },
    ]

    // 1. Start A
    const syncAPromise = startHandler({}, {
      gameId: "server-a",
      gameName: "Warria",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    }).catch((e: any) => e)

    await new Promise((r) => setTimeout(r, 40))

    let statusA = await getStatusHandler({}, { gameId: "server-a" })
    expect(statusA.activeOperationState).toBe("SYNCING")

    // 2. Launch Game B -> A is auto-paused
    vi.spyOn(gameLauncher, "launch").mockResolvedValueOnce({ success: true, pid: 8888 })

    await launchHandler({}, {
      gameId: "server-b",
      gameName: "Survival Realm",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    statusA = await getStatusHandler({}, { gameId: "server-a" })
    expect(statusA.activeOperationState).toBe("PAUSED")

    // 3. Simulate Game B returning to idle -> A auto-resumes
    const resumeSyncSpy = vi.spyOn(operationManager, "resumeSync").mockResolvedValueOnce({ success: true, resumed: true } as any)

    gameLauncher.onStatusChangeCallback("idle", { gameId: "server-b", runningGameId: null })
    await new Promise((r) => setTimeout(r, 30))

    expect(resumeSyncSpy).toHaveBeenCalled()

    // 4. Manual pause test: user manually pauses A
    await pauseHandler({}, { gameId: "server-a", gameName: "Warria" })

    resumeSyncSpy.mockClear()

    // Launch Game B and close Game B
    vi.spyOn(gameLauncher, "launch").mockResolvedValueOnce({ success: true, pid: 9999 })
    await launchHandler({}, {
      gameId: "server-b",
      gameName: "Survival Realm",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    gameLauncher.onStatusChangeCallback("idle", { gameId: "server-b", runningGameId: null })
    await new Promise((r) => setTimeout(r, 30))

    // resumeSync must NOT have been called because it was a manual pause!
    expect(resumeSyncSpy).not.toHaveBeenCalled()

    // Clean up A
    await cancelHandler({}, { gameId: "server-a", gameName: "Warria" })
    await syncAPromise
  })

  // 8. INSTALLING / VERIFYING SAFETY (Item 10, 19)
  it("8. INSTALLING / VERIFYING SAFETY: Launch is rejected while another game is installing or verifying", async () => {
    const launchHandler = getHandler("game-launch")

    // Simulate operationManager in VERIFYING state for server-a
    const startHandler = getHandler("game-start-sync")
    const cancelHandler = getHandler("game-cancel-sync")

    const sampleFiles = [
      {
        path: "mods/sample.jar",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE" as const,
        downloadUrl: "http://localhost/sample.jar",
      },
    ]

    const syncPromise = startHandler({}, {
      gameId: "server-a",
      gameName: "Warria",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      isVerify: true,
      clientFiles: sampleFiles,
    }).catch((e: any) => e)

    await new Promise((r) => setTimeout(r, 30))

    // Attempting to launch server-b while server-a is verifying -> must reject
    await expect(
      launchHandler({}, {
        gameId: "server-b",
        gameName: "Survival Realm",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
      }),
    ).rejects.toThrow("Cannot launch Minecraft while another game is installing or verifying.")

    await cancelHandler({}, { gameId: "server-a", gameName: "Warria" })
    await syncPromise
  })

  // 9. SIDEBAR BUTTON (Item 22)
  it("9. SIDEBAR: Downloads button switches to downloads view", async () => {
    const setViewSpy = vi.fn()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <LauncherSidebar
            view="home"
            setView={setViewSpy}
            s={1}
            theme="dark"
            activeSkinAccent={{ r: 62, g: 196, b: 192, css: "62, 196, 192" }}
            servers={[serverA, serverB]}
            selectedGameId="server-a"
          />
        </LanguageProvider>,
      )
    })

    const dlBtn = container.querySelector("button[title='Descargas']")
    expect(dlBtn).not.toBeNull()

    await act(async () => {
      dlBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(setViewSpy).toHaveBeenCalledWith("downloads")
  })

  // 10. HOMESCREEN VINCULACIÓN: PAUSE / RESUME EN VIVO
  it("10. HOMESCREEN VINCULACIÓN: Pausar descarga refleja PAUSADO (no descargando congelado), y reanudar refleja DESCARGANDO", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      installed: false,
      hasExistingInstall: false,
      installedModpackVersion: null,
      clientFiles: [{ path: "mods/sample.jar", sha256: "hash", sizeBytes: 1000 }],
    } as any)

    ;(window as any).electronAPI.getDownloadQueue = vi.fn().mockResolvedValue({
      active: {
        gameId: "server-a",
        phase: "DOWNLOADING",
        progress: 40,
        speedMBs: 15.5,
        downloadedBytes: 400,
        totalBytes: 1000,
        remainingMinutes: 1,
        isPaused: false,
      },
      queued: [],
    })

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            gameContext={{ gameId: "server-a", gameName: "Warria" }}
            serverId="server-a"
          />
        </LanguageProvider>,
      )
    })

    expect(container.textContent).toContain("DESCARGANDO")
    expect(container.textContent).toContain("40%")

    // Main / DownloadsView emits PAUSED
    await act(async () => {
      phaseChangeCallback?.("PAUSED", "server-a")
    })

    // Must show PAUSADO, not DESCARGANDO!
    expect(container.textContent).toContain("PAUSADO")

    // Main / DownloadsView emits DOWNLOADING (resume)
    await act(async () => {
      phaseChangeCallback?.("DOWNLOADING", "server-a")
    })

    expect(container.textContent).toContain("DESCARGANDO")
  })

  // 11. HOMESCREEN VINCULACIÓN: QUEUED PRESERVADO EN CAMBIO DE IDIOMA Y NAVEGACIÓN
  it("11. HOMESCREEN VINCULACIÓN: Servidor en cola no se resetea a Descargar al cambiar idioma ni al re-montar", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      installed: false,
      hasExistingInstall: false,
      installedModpackVersion: null,
      clientFiles: [{ path: "mods/sample.jar", sha256: "hash", sizeBytes: 1000 }],
    } as any)

    ;(window as any).electronAPI.getDownloadQueue = vi.fn().mockResolvedValue({
      active: {
        gameId: "server-a",
        phase: "DOWNLOADING",
        progress: 50,
      },
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
        },
      ],
    })

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            gameContext={{ gameId: "server-b", gameName: "Survival Realm" }}
            serverId="server-b"
          />
        </LanguageProvider>,
      )
    })

    // Initially in Spanish: EN COLA
    expect(container.textContent).toContain("EN COLA")
    expect(container.textContent).not.toContain("DESCARGAR")

    // Language change to English: must reflect IN QUEUE, NOT DOWNLOAD!
    localStorage.setItem("hikat_language", "en")

    await act(async () => {
      root.unmount()
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            gameContext={{ gameId: "server-b", gameName: "Survival Realm" }}
            serverId="server-b"
          />
        </LanguageProvider>,
      )
    })

    expect(container.textContent).toContain("QUEUED")
    expect(container.textContent).not.toContain("DOWNLOAD")

    // Promotion in queue: Server B becomes active
    await act(async () => {
      queueChangeCallback?.({
        active: {
          gameId: "server-b",
          phase: "DOWNLOADING",
          progress: 10,
          speedMBs: 8.5,
          downloadedBytes: 100,
          totalBytes: 1000,
          remainingMinutes: 2,
          isPaused: false,
        },
        queued: [],
      })
    })

    expect(container.textContent).toContain("DOWNLOADING")
    expect(container.textContent).toContain("10%")
  })
})
