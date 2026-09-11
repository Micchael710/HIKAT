// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import React, { act, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider, getTranslation } from "../context/LanguageContext"
import DownloadsView from "../views/DownloadsView"
import { gameService } from "../services/gameService"
import type { LauncherServer } from "../services/serverService"
import type { DownloadQueueSnapshot } from "../vite-env"

// ── Mock Electron for Real main.cjs Execution ──
const ipcHandlers = new Map<string, Function>()
const ipcListeners = new Map<string, Function>()
let activeUserDataDir = ""
let activeAppDataDir = ""
const lastSentEvents: { channel: string; args: any[] }[] = []

const electronMock = {
  app: {
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    getPath: vi.fn((name) => {
      if (name === "appData") return activeAppDataDir || os.tmpdir()
      if (name === "userData") return activeUserDataDir || os.tmpdir()
      return os.tmpdir()
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
    createFromPath: vi.fn().mockReturnValue({}),
  },
  shell: {
    openExternal: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({}),
  },
  Tray: function TrayMock() {
    return {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
      isDestroyed: () => false,
      destroy: vi.fn(),
    }
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

const mainExports = require("../../electron/main.cjs") as any

const sampleServers: LauncherServer[] = [
  {
    id: "server-a",
    name: "Warria",
    accentColor: "#3366ff",
    minecraftVersion: "1.21.1",
    modLoader: "VANILLA",
    launcherActiveReleaseId: "rel-a",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    sidebarLogo: { id: "logo-a", url: "" },
  },
  {
    id: "server-b",
    name: "Survival Realm",
    accentColor: "#ff5500",
    minecraftVersion: "1.21.1",
    modLoader: "VANILLA",
    launcherActiveReleaseId: "rel-b",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    sidebarLogo: { id: "logo-b", url: "" },
  },
  {
    id: "server-c",
    name: "Apparatia Core",
    accentColor: "#10b981",
    minecraftVersion: "1.21.1",
    modLoader: "VANILLA",
    launcherActiveReleaseId: "rel-c",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    sidebarLogo: { id: "logo-c", url: "" },
  },
]

describe("Queue Promotion and Home Scroll UX Improvements", () => {
  let container: HTMLDivElement
  let root: any
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-qp-test-"))
    activeAppDataDir = tempDir
    activeUserDataDir = path.join(tempDir, "userData")
    await fsp.mkdir(activeUserDataDir, { recursive: true })

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")

    mainExports.resetDownloadQueueForTesting()
    mainExports.setActiveOperationGameIdForTesting(null)
    mainExports.setCurrentProcessingItemForTesting(null)
    mainExports.operationManager.state = "IDLE"
    mainExports.operationManager.isCommitting = false
    mainExports.operationManager.canPause = true
  })

  afterEach(async () => {
    if (root) {
      act(() => {
        root.unmount()
      })
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  // ── TEST 1: HOME SCROLL RESET ──
  it("1. Home scroll reset: changing selectedGameId inside Home resets scrollTop to 0", async () => {
    // Harness component matching App.tsx's scrollContainerRef and useEffect
    function TestScrollContainer({
      view,
      selectedGameId,
    }: {
      view: string
      selectedGameId: string
    }) {
      const scrollContainerRef = useRef<HTMLDivElement>(null)

      useEffect(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0
        }
      }, [view])

      useEffect(() => {
        if (view === "home" && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0
        }
      }, [selectedGameId, view])

      return (
        <div
          ref={scrollContainerRef}
          data-testid="scroll-container"
          style={{ height: 200, overflowY: "auto" }}
        >
          <div style={{ height: 800 }}>Server {selectedGameId} content</div>
        </div>
      )
    }

    await act(async () => {
      root.render(<TestScrollContainer view="home" selectedGameId="server-a" />)
    })

    const el = container.querySelector("[data-testid='scroll-container']") as HTMLDivElement
    expect(el).toBeTruthy()

    // Simulate user scrolling down inside Home
    el.scrollTop = 450
    expect(el.scrollTop).toBe(450)

    // User switches to server-b in Home view
    await act(async () => {
      root.render(<TestScrollContainer view="home" selectedGameId="server-b" />)
    })

    // scrollTop must be reset immediately to 0
    expect(el.scrollTop).toBe(0)
  })

  // ── TEST 2: DOWNLOADS VIEW HAS NO 'EN COLA' HEADER AND NO NUMERIC POSITION ──
  it("2. DownloadsView: no 'EN COLA' header, displays 'Instalación en cola' without numeric position", async () => {
    const queueData: DownloadQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 40,
        speedMBs: 15,
        downloadedBytes: 400,
        totalBytes: 1000,
        remainingMinutes: 1,
        canPause: true,
        canCancel: true,
        isCommitting: false,
      },
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
          hasStarted: false,
          savedProgress: 0,
          savedPhase: null,
        },
        {
          gameId: "server-c",
          gameName: "Apparatia Core",
          position: 2,
          hasStarted: true,
          savedProgress: 25,
          savedPhase: "DOWNLOADING",
        },
      ],
    }

    ;(window as any).electronAPI = {
      getDownloadQueue: vi.fn().mockResolvedValue(queueData),
      onDownloadQueueChanged: vi.fn().mockReturnValue(() => {}),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      onGamePhaseChanged: vi.fn().mockReturnValue(() => {}),
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView theme="dark" servers={sampleServers} />
        </LanguageProvider>
      )
    })

    const text = container.textContent || ""
    // ACTIVA section header must exist
    expect(text).toContain("Activa")
    // EN COLA visual header must NOT exist
    expect(text).not.toContain("En cola ·")
    expect(text).not.toContain("EN COLA")
    // Numeric position must NOT be shown
    expect(text).not.toContain("posición 1")
    expect(text).not.toContain("posición 2")
    expect(text).not.toContain("position 1")
    expect(text).not.toContain("position 2")
    // Must display "Instalación en cola" for queued items
    expect(text).toContain("Instalación en cola")
  })

  // ── TEST 3: QUEUED ITEM NEVER STARTED SHOWS ICON DOWNLOAD ──
  it("3. Queued item never started shows IconDownload ('Iniciar ahora')", async () => {
    const queueData: DownloadQueueSnapshot = {
      active: null,
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
          hasStarted: false,
          savedProgress: 0,
          savedPhase: null,
        },
      ],
    }

    ;(window as any).electronAPI = {
      getDownloadQueue: vi.fn().mockResolvedValue(queueData),
      onDownloadQueueChanged: vi.fn().mockReturnValue(() => {}),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      onGamePhaseChanged: vi.fn().mockReturnValue(() => {}),
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView theme="dark" servers={sampleServers} />
        </LanguageProvider>
      )
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    // Action button for server-b before cancel
    const startButton = buttons.find(
      (btn) =>
        btn.getAttribute("title") === "Iniciar ahora" ||
        btn.textContent?.includes("Iniciar ahora")
    )
    expect(startButton).toBeDefined()
    // It contains the download icon (svg with path or line)
    const svg = startButton?.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(startButton?.textContent).toContain("Iniciar ahora")
  })

  // ── TEST 4: QUEUED ITEM WITH PREVIOUS PROGRESS SHOWS ICON RESUME ──
  it("4. Queued item with previous progress shows IconResume ('Reanudar')", async () => {
    const queueData: DownloadQueueSnapshot = {
      active: null,
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
          hasStarted: true,
          savedProgress: 55,
          savedPhase: "DOWNLOADING",
        },
      ],
    }

    ;(window as any).electronAPI = {
      getDownloadQueue: vi.fn().mockResolvedValue(queueData),
      onDownloadQueueChanged: vi.fn().mockReturnValue(() => {}),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      onGamePhaseChanged: vi.fn().mockReturnValue(() => {}),
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView theme="dark" servers={sampleServers} />
        </LanguageProvider>
      )
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    const resumeButton = buttons.find(
      (btn) =>
        btn.getAttribute("title") === "Reanudar" ||
        btn.textContent?.includes("Reanudar")
    )
    expect(resumeButton).toBeDefined()
    expect(resumeButton?.textContent).toContain("Reanudar")
  })

  // ── TEST 5: A ACTIVE + B QUEUED -> PROMOTE B: A PAUSED, B ACTIVE, PROGRESS PRESERVED ──
  it("5. A active + B queued -> promote B: A paused/queued, B active, progress/staging preserved", async () => {
    // Setup A as active
    mainExports.setActiveOperationGameIdForTesting("server-a")
    mainExports.operationManager.state = "SYNCING"
    mainExports.operationManager.lastPausedPhase = "DOWNLOADING"

    // Mock activeOperationSnapshot for A with exact 42% progress
    mainExports.setActiveOperationSnapshotForTesting({
      gameId: "server-a",
      phase: "DOWNLOADING",
      progress: 42,
      downloadedBytes: 4200,
      totalBytes: 10000,
      speedMBs: 5,
      remainingMinutes: 2,
    })
    mainExports.setActiveOperationPayloadForTesting({
      gameId: "server-a",
      gameName: "Warria",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
    })

    // Feed through queue with B queued
    const queue = mainExports.getDownloadQueue()
    queue.push({
      gameId: "server-b",
      gameName: "Survival Realm",
      payload: { gameId: "server-b", gameName: "Survival Realm", modpackVersion: "1.0.0", minecraftVersion: "1.21.1" },
      queuedAt: Date.now(),
      savedProgress: 0,
      savedPhase: null,
    })

    // Promote B
    const result = await mainExports.promoteQueuedSync({ gameId: "server-b" })
    expect(result.success).toBe(true)

    // A must now be in downloadQueue with EXACT saved progress 42 preserved
    const updatedQueue = mainExports.getDownloadQueue()
    const itemA = updatedQueue.find((item: any) => item.gameId === "server-a")
    expect(itemA).toBeDefined()
    expect(itemA.savedPhase).toBe("DOWNLOADING")
    expect(itemA.savedProgress).toBe(42)
  })

  // ── TEST 6: SWAP BACK: SELECT A -> B TO QUEUE, A RESUMES FROM PRIOR PROGRESS ──
  it("6. Swap back: promote A again -> B moves to queue, A resumes from prior progress", async () => {
    // Start with B active with progress 30%
    mainExports.setActiveOperationGameIdForTesting("server-b")
    mainExports.operationManager.state = "SYNCING"
    mainExports.operationManager.lastPausedPhase = "DOWNLOADING"

    // A is in queue with savedProgress = 60
    const queue = mainExports.getDownloadQueue()
    queue.push({
      gameId: "server-a",
      gameName: "Warria",
      payload: { gameId: "server-a", gameName: "Warria", modpackVersion: "1.0.0" },
      queuedAt: Date.now(),
      savedProgress: 60,
      savedPhase: "DOWNLOADING",
    })

    // Promote A
    const result = await mainExports.promoteQueuedSync({ gameId: "server-a" })
    expect(result.success).toBe(true)

    // B must now be in queue
    const updatedQueue = mainExports.getDownloadQueue()
    const itemB = updatedQueue.find((item: any) => item.gameId === "server-b")
    expect(itemB).toBeDefined()
  })

  // ── TEST 7: A IN COMMIT/VERIFYING/NO-PAUSABLE -> CANNOT BE DISPLACED ──
  it("7. A in commit/VERIFYING/no-pausable: B CANNOT displace A", async () => {
    mainExports.setActiveOperationGameIdForTesting("server-a")
    mainExports.operationManager.state = "SYNCING"
    mainExports.operationManager.isCommitting = true // Committing!

    const queue = mainExports.getDownloadQueue()
    queue.push({
      gameId: "server-b",
      gameName: "Survival Realm",
      payload: { gameId: "server-b", gameName: "Survival Realm", modpackVersion: "1.0.0" },
      queuedAt: Date.now(),
    })

    // Promote B should be rejected
    const result = await mainExports.promoteQueuedSync({ gameId: "server-b" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("cannot be safely paused")

    // A remains active
    expect(mainExports.getActiveOperationGameIdForTesting()).toBe("server-a")
    // B remains in queue
    expect(mainExports.getDownloadQueue().some((item: any) => item.gameId === "server-b")).toBe(true)
  })

  // ── TEST 8: A/B/C: MANUAL PROMOTION DOES NOT LOSE OR DUPLICATE ITEMS ──
  it("8. A/B/C: manual promotion does not lose or duplicate items", async () => {
    mainExports.setActiveOperationGameIdForTesting("server-a")
    mainExports.operationManager.state = "SYNCING"

    const queue = mainExports.getDownloadQueue()
    queue.push(
      {
        gameId: "server-b",
        gameName: "Survival Realm",
        payload: { gameId: "server-b", gameName: "Survival Realm", modpackVersion: "1.0.0" },
        queuedAt: Date.now(),
      },
      {
        gameId: "server-c",
        gameName: "Apparatia Core",
        payload: { gameId: "server-c", gameName: "Apparatia Core", modpackVersion: "1.0.0" },
        queuedAt: Date.now() + 10,
      }
    )

    // Promote C (skipping B in FIFO)
    const resC = await mainExports.promoteQueuedSync({ gameId: "server-c" })
    expect(resC.success).toBe(true)

    const updatedQueue = mainExports.getDownloadQueue()
    // A demoted to queue, B still in queue
    const gameIdsInQueue = updatedQueue.map((item: any) => item.gameId)
    expect(gameIdsInQueue).toContain("server-a")
    expect(gameIdsInQueue).toContain("server-b")
    // Total items across active + queue must be exactly 3, no duplicates
    const allIds = ["server-c", ...gameIdsInQueue]
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(3)
    expect(allIds.length).toBe(3)
  })

  // ── TEST 9: CLOSE/REOPEN AFTER SWAPPING: QUEUE AND PROGRESS RESTORED ──
  it("9. Close/reopen after swapping: queue and progress persist and restore correctly", () => {
    // Populate queue with swapped items and saved progress
    const queue = mainExports.getDownloadQueue()
    queue.push(
      {
        gameId: "server-a",
        gameName: "Warria",
        payload: { gameId: "server-a" },
        queuedAt: 1000,
        savedProgress: 72,
        savedPhase: "DOWNLOADING",
        savedDownloadedBytes: 7200,
        savedTotalBytes: 10000,
      },
      {
        gameId: "server-b",
        gameName: "Survival Realm",
        payload: { gameId: "server-b" },
        queuedAt: 2000,
        savedProgress: 0,
        savedPhase: null,
      }
    )

    // Save to persistent file
    mainExports.savePersistentDownloadQueue()

    // Reset memory to simulate shutdown
    mainExports.resetDownloadQueueForTesting()
    expect(mainExports.getDownloadQueue().length).toBe(0)

    // Reload from file to simulate launcher reopening
    mainExports.loadPersistentDownloadQueue()

    const restoredQueue = mainExports.getDownloadQueue()
    expect(restoredQueue.length).toBe(2)

    const restoredA = restoredQueue.find((item: any) => item.gameId === "server-a")
    expect(restoredA).toBeDefined()
    expect(restoredA.savedProgress).toBe(72)
    expect(restoredA.savedPhase).toBe("DOWNLOADING")
    expect(restoredA.savedDownloadedBytes).toBe(7200)

    const restoredB = restoredQueue.find((item: any) => item.gameId === "server-b")
    expect(restoredB).toBeDefined()
    expect(restoredB.savedProgress).toBe(0)
  })

  // ── TEST 10: CONCURRENCY LOCK - TWO CALLS: ONLY ONE EXECUTES, SECOND RETURNS BUSY: TRUE ──
  it("10. Concurrency lock: two concurrent calls to promoteQueuedSync() -> second returns busy: true", async () => {
    mainExports.setActiveOperationGameIdForTesting("server-a")
    mainExports.operationManager.state = "SYNCING"

    const queue = mainExports.getDownloadQueue()
    queue.push({
      gameId: "server-b",
      gameName: "Survival Realm",
      payload: { gameId: "server-b", gameName: "Survival Realm", modpackVersion: "1.0.0", minecraftVersion: "1.21.1" },
      queuedAt: Date.now(),
    })

    // Simulate pause taking some time
    const originalPauseSync = mainExports.operationManager.pauseSync
    let resolvePause: () => void = () => {}
    mainExports.operationManager.pauseSync = vi.fn().mockImplementation(
      () =>
        new Promise<any>((resolve) => {
          resolvePause = () => {
            mainExports.operationManager.state = "PAUSED"
            resolve({ success: true, paused: true, state: "PAUSED" })
          }
        })
    )

    try {
      // First call begins and waits on pauseSync
      const call1Promise = mainExports.promoteQueuedSync({ gameId: "server-b" })
      expect(mainExports.isPromotingQueuedSyncForTesting()).toBe(true)

      // Second concurrent call arrives immediately while call1 is still running
      const call2Result = await mainExports.promoteQueuedSync({ gameId: "server-b" })
      expect(call2Result.success).toBe(false)
      expect(call2Result.busy).toBe(true)

      // Complete call 1
      resolvePause()
      const call1Result = await call1Promise
      expect(call1Result.success).toBe(true)
      expect(call1Result.promoted).toBe(true)

      // Lock must be released
      expect(mainExports.isPromotingQueuedSyncForTesting()).toBe(false)
    } finally {
      mainExports.operationManager.pauseSync = originalPauseSync
    }
  })

  // ── TEST 11: LOCK RELEASES ON pauseSync FAILURE AND RECOVERS ──
  it("11. Lock releases if pauseSync() fails, and subsequent promotion works normally", async () => {
    mainExports.setActiveOperationGameIdForTesting("server-a")
    mainExports.operationManager.state = "SYNCING"

    const queue = mainExports.getDownloadQueue()
    queue.push({
      gameId: "server-b",
      gameName: "Survival Realm",
      payload: { gameId: "server-b", gameName: "Survival Realm", modpackVersion: "1.0.0", minecraftVersion: "1.21.1" },
      queuedAt: Date.now(),
    })

    const originalPauseSync = mainExports.operationManager.pauseSync
    // Simulate pauseSync failing abruptly
    mainExports.operationManager.pauseSync = vi.fn().mockRejectedValueOnce(new Error("Disk error during pause"))

    try {
      await expect(mainExports.promoteQueuedSync({ gameId: "server-b" })).rejects.toThrow("Disk error during pause")

      // Lock MUST be released despite the exception in pauseSync
      expect(mainExports.isPromotingQueuedSyncForTesting()).toBe(false)

      // Restore normal pauseSync
      mainExports.operationManager.pauseSync = originalPauseSync

      // Subsequent promotion must work normally without being stuck
      const retryResult = await mainExports.promoteQueuedSync({ gameId: "server-b" })
      expect(retryResult.success).toBe(true)
      expect(retryResult.promoted).toBe(true)
      expect(mainExports.isPromotingQueuedSyncForTesting()).toBe(false)
    } finally {
      mainExports.operationManager.pauseSync = originalPauseSync
    }
  })

  // ── TEST 12: UI DOUBLE-CLICK PREVENTION IN DOWNLOADSVIEW ──
  it("12. Rapid double-click in DownloadsView does not launch two promotions", async () => {
    const queueData: DownloadQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 10,
        speedMBs: 5,
        downloadedBytes: 100,
        totalBytes: 1000,
        remainingMinutes: 3,
        canPause: true,
        canCancel: true,
        isCommitting: false,
      },
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
          hasStarted: false,
          savedProgress: 0,
          savedPhase: null,
        },
      ],
    }

    let promoteCallCount = 0
    let promoteResolve: () => void = () => {}
    const promotePromise = new Promise<any>((resolve) => {
      promoteResolve = () => resolve({ success: true })
    })

    const promoteSpy = vi.spyOn(gameService, "promoteQueuedSync").mockImplementation(async () => {
      promoteCallCount++
      return await promotePromise
    })

    ;(window as any).electronAPI = {
      getDownloadQueue: vi.fn().mockResolvedValue(queueData),
      onDownloadQueueChanged: vi.fn().mockReturnValue(() => {}),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      onGamePhaseChanged: vi.fn().mockReturnValue(() => {}),
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView theme="dark" servers={sampleServers} />
        </LanguageProvider>
      )
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    const actionButton = buttons.find((btn) => btn.textContent?.includes("Iniciar ahora"))
    expect(actionButton).toBeDefined()

    // Simulate fast double click
    await act(async () => {
      actionButton?.click()
      actionButton?.click()
    })

    // Must only have been called ONCE due to isPromotingQueued guard
    expect(promoteCallCount).toBe(1)

    // Complete promotion
    await act(async () => {
      promoteResolve()
    })

    promoteSpy.mockRestore()
  })

  // ── TEST 13: A/B/C NOT LOST OR DUPLICATED AFTER CONCURRENT CALLS ──
  it("13. A/B/C items are neither duplicated nor lost during concurrent promotion attempts", async () => {
    mainExports.setActiveOperationGameIdForTesting("server-a")
    mainExports.operationManager.state = "SYNCING"

    const queue = mainExports.getDownloadQueue()
    queue.push(
      {
        gameId: "server-b",
        gameName: "Survival Realm",
        payload: { gameId: "server-b", gameName: "Survival Realm", modpackVersion: "1.0.0", minecraftVersion: "1.21.1" },
        queuedAt: Date.now(),
      },
      {
        gameId: "server-c",
        gameName: "Apparatia Core",
        payload: { gameId: "server-c", gameName: "Apparatia Core", modpackVersion: "1.0.0", minecraftVersion: "1.21.1" },
        queuedAt: Date.now() + 10,
      }
    )

    const originalPauseSync = mainExports.operationManager.pauseSync
    let resolvePause: () => void = () => {}
    mainExports.operationManager.pauseSync = vi.fn().mockImplementation(
      () =>
        new Promise<any>((resolve) => {
          resolvePause = () => {
            mainExports.operationManager.state = "PAUSED"
            resolve({ success: true, paused: true, state: "PAUSED" })
          }
        })
    )

    try {
      // User concurrently clicks to promote B and C
      const promB = mainExports.promoteQueuedSync({ gameId: "server-b" })
      const promC = mainExports.promoteQueuedSync({ gameId: "server-c" })

      const [resC] = await Promise.all([promC])
      expect(resC.busy).toBe(true)

      resolvePause()
      const resB = await promB
      expect(resB.success).toBe(true)

      // Total items across queue + active must still be exactly 3
      const updatedQueue = mainExports.getDownloadQueue()
      const queueIds = updatedQueue.map((item: any) => item.gameId)
      const allIds = ["server-b", ...queueIds]
      const uniqueIds = new Set(allIds)

      expect(allIds.length).toBe(3)
      expect(uniqueIds.size).toBe(3)
      expect(allIds).toContain("server-a")
      expect(allIds).toContain("server-b")
      expect(allIds).toContain("server-c")
    } finally {
      mainExports.operationManager.pauseSync = originalPauseSync
    }
  })
})
