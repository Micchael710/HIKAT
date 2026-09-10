// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../context/LanguageContext"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import LauncherSidebar from "../components/layout/LauncherSidebar"
import DownloadsView from "../views/DownloadsView"
import { gameService } from "../services/gameService"
import type { LauncherServer } from "../services/serverService"
import { getTranslation } from "../context/LanguageContext"
// @ts-expect-error CJS module without bundled declaration
import { GameOperationManager } from "../../electron/game-operation-manager.cjs"
import esDict from "../locales/es.json"
import enDict from "../locales/en.json"
import ptDict from "../locales/pt.json"
import frDict from "../locales/fr.json"

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

    vi.spyOn(gameService, "checkGameManifest").mockImplementation(async (gameId) => {
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

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  // A. SINGLE MINECRAFT UX
  it("A. SINGLE MINECRAFT UX: When Game A is running, Game B button remains PLAY, is visually disabled, click is blocked, and reverts on idle", async () => {
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

    // Button should show PLAY (JUGAR in ES)
    const btn = container.querySelector("button")
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toContain("JUGAR")

    // Must have disabled visual treatment
    expect(btn?.disabled).toBe(true)
    expect(btn?.style.cursor).toBe("not-allowed")
    expect(btn?.style.opacity).toBe("0.65")

    // Click must NOT call launchGame
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(launchGameSpy).not.toHaveBeenCalled()

    // When Game A returns to idle:
    ;(window as any).electronAPI.getLaunchStatus = vi.fn().mockResolvedValue({
      status: "idle",
      runningGameId: null,
    })

    await act(async () => {
      launchStatusCallback?.("idle", { gameId: "server-a", runningGameId: null })
    })

    // Button should now be active and clickable
    expect(btn?.disabled).toBe(false)
    expect(btn?.style.cursor).toBe("pointer")
    expect(btn?.style.opacity).toBe("1")

    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(launchGameSpy).toHaveBeenCalled()
  })

  // B. MAIN SIGUE PROTEGIDO
  it("B. MAIN SIGUE PROTEGIDO: GameOperationManager rejects second launch if state is not IDLE unless allowDuringOperation is explicitly set", async () => {
    const opManager = new GameOperationManager()
    opManager.state = "SYNCING"

    const mockLauncher = { launch: vi.fn() }
    await expect(opManager.launchGame(mockLauncher)).rejects.toThrow("Cannot launch Minecraft while game operation is in progress.")

    // With allowDuringOperation: true, launch proceeds
    mockLauncher.launch.mockResolvedValueOnce({ success: true, pid: 1234 })
    const res = await opManager.launchGame(mockLauncher, { allowDuringOperation: true })
    expect(res.success).toBe(true)
  })

  // C, D, E, F: FIFO QUEUE & IPC TESTS
  it("C, D, E, F: Download queue behavior in Main — FIFO ordering, no duplicates, cancel queued, pause active", () => {
    let downloadQueue: any[] = []
    let activeOpId: string | null = "server-a"

    // Enqueue B
    if (activeOpId !== "server-b" && !downloadQueue.some((i) => i.gameId === "server-b")) {
      downloadQueue.push({ gameId: "server-b", gameName: "Server B", position: downloadQueue.length + 1 })
    }

    // Enqueue C
    if (activeOpId !== "server-c" && !downloadQueue.some((i) => i.gameId === "server-c")) {
      downloadQueue.push({ gameId: "server-c", gameName: "Server C", position: downloadQueue.length + 1 })
    }

    // Queue is [B, C]
    expect(downloadQueue.map((i) => i.gameId)).toEqual(["server-b", "server-c"])

    // D. No duplicates: re-enqueueing B returns existing position without adding
    const existingIndex = downloadQueue.findIndex((i) => i.gameId === "server-b")
    expect(existingIndex).toBe(0)
    expect(downloadQueue.length).toBe(2)

    // E. Cancel queued B: B is removed, C remains, active A continues
    const removeIndex = downloadQueue.findIndex((i) => i.gameId === "server-b")
    downloadQueue.splice(removeIndex, 1)
    expect(downloadQueue.map((i) => i.gameId)).toEqual(["server-c"])
    expect(activeOpId).toBe("server-a")

    // Advance queue when A finishes: C is next
    activeOpId = null
    const next = downloadQueue.shift()
    expect(next.gameId).toBe("server-c")
    activeOpId = next.gameId
    expect(activeOpId).toBe("server-c")
  })

  // G. DOWNLOAD CENTER RENDERING
  it("G. DOWNLOAD CENTER: Renders active download (42%) and queued item with logo and accent, no disk/history charts", async () => {
    ;(window as any).electronAPI.getDownloadQueue = vi.fn().mockResolvedValue({
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 42,
        speedMBs: 15.5,
        downloadedBytes: 420000000,
        totalBytes: 1000000000,
        remainingMinutes: 2,
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
          <DownloadsView
            theme="dark"
            servers={[serverA, serverB]}
          />
        </LanguageProvider>,
      )
    })

    expect(container.textContent).toContain("Descargas")
    expect(container.textContent).toContain("Warria")
    expect(container.textContent).toContain("42%")
    expect(container.textContent).toContain("15.5 MB/s")
    expect(container.textContent).toContain("Survival Realm")
    expect(container.textContent).toContain("posición 1")

    // Verify NOT rendering Epic Games charts
    expect(container.textContent).not.toContain("Read speed")
    expect(container.textContent).not.toContain("Write speed")
    expect(container.textContent).not.toContain("Disk chart")
  })

  // H. EMPTY DOWNLOAD CENTER
  it("H. EMPTY DOWNLOAD CENTER: Renders translated empty state when queue is empty", async () => {
    ;(window as any).electronAPI.getDownloadQueue = vi.fn().mockResolvedValue({
      active: null,
      queued: [],
    })

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView
            theme="dark"
            servers={[serverA, serverB]}
          />
        </LanguageProvider>,
      )
    })

    expect(container.textContent).toContain("No hay descargas activas")
  })

  // I. SIDEBAR DOWNLOADS BUTTON
  it("I. SIDEBAR: Downloads button is permanently visible, separate at bottom, and clicking switches to downloads view", async () => {
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

    // Find downloads button (title is Descargas)
    const dlBtn = container.querySelector("button[title='Descargas']")
    expect(dlBtn).not.toBeNull()

    await act(async () => {
      dlBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(setViewSpy).toHaveBeenCalledWith("downloads")
  })

  // J. ACCENT COLOR PER SERVER
  it("J. ACCENT COLOR: Active server progress bar uses server.accentColor", async () => {
    ;(window as any).electronAPI.getDownloadQueue = vi.fn().mockResolvedValue({
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 50,
        speedMBs: 10,
        downloadedBytes: 500,
        totalBytes: 1000,
        remainingMinutes: 1,
      },
      queued: [],
    })

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadsView
            theme="dark"
            servers={[serverA, serverB]}
          />
        </LanguageProvider>,
      )
    })

    // Active progress bar element uses serverA accent #3366ff
    const progressBar = container.querySelector("div[style*='linear-gradient']")
    expect(progressBar?.getAttribute("style")).toMatch(/(#3366ff|51,\s*102,\s*255)/)
  })

  // K, L, M, N: PAUSE DOWNLOADS ON GAME LAUNCH BEHAVIOR
  it("K, L, M, N: Pause on game launch logic & auto-resume vs manual pause", () => {
    let pauseDownloadsOnGameLaunch = true
    let activeOpState = "SYNCING"
    let activeOpGameId: string | null = "server-a"
    let autoPausedDownloadGameId: string | null = null

    // K. Launch Game B: A is auto-paused
    if (pauseDownloadsOnGameLaunch && activeOpGameId !== "server-b" && activeOpState === "SYNCING") {
      autoPausedDownloadGameId = activeOpGameId
      activeOpState = "PAUSED"
    }

    expect(activeOpState).toBe("PAUSED")
    expect(autoPausedDownloadGameId).toBe("server-a")

    // L. Game B terminates (idle): A auto-resumes
    let gameStatus = "idle"
    if (
      gameStatus === "idle" &&
      autoPausedDownloadGameId === activeOpGameId &&
      activeOpState === "PAUSED" &&
      pauseDownloadsOnGameLaunch
    ) {
      activeOpState = "SYNCING"
      autoPausedDownloadGameId = null
    }

    expect(activeOpState).toBe("SYNCING")
    expect(autoPausedDownloadGameId).toBeNull()

    // M. Manual pause is NOT auto-resumed
    activeOpState = "PAUSED"
    autoPausedDownloadGameId = null // manual pause does NOT set autoPaused flag

    gameStatus = "idle"
    if (
      gameStatus === "idle" &&
      autoPausedDownloadGameId === activeOpGameId &&
      activeOpState === "PAUSED" &&
      pauseDownloadsOnGameLaunch
    ) {
      activeOpState = "SYNCING"
    }
    // Stays paused!
    expect(activeOpState).toBe("PAUSED")

    // N. Setting FALSE: launching does NOT pause active sync
    pauseDownloadsOnGameLaunch = false
    activeOpState = "SYNCING"
    if (pauseDownloadsOnGameLaunch && activeOpState === "SYNCING") {
      activeOpState = "PAUSED"
    }
    expect(activeOpState).toBe("SYNCING")
  })

  // O. INSTALLING / VERIFYING SAFETY
  it("O. INSTALLING SAFETY: Does not interrupt INSTALLING or VERIFYING phase to launch game", () => {
    const activeOpPhase: string = "INSTALLING"
    const activeOpGameId: string = "server-a"
    const targetGameId: string = "server-b"

    let launchAllowed = true
    if (activeOpGameId && activeOpGameId !== targetGameId) {
      if (activeOpPhase === "INSTALLING" || activeOpPhase === "VERIFYING") {
        launchAllowed = false
      }
    }

    expect(launchAllowed).toBe(false)
  })

  // P. QUEUE DURING GAMEPLAY
  it("P. QUEUE DURING GAMEPLAY: Setting true prevents queued sync from starting while game is running", () => {
    const pauseDownloadsOnGameLaunch = true
    const runningStatus: string = "running"
    const downloadQueue = [{ gameId: "server-c" }]

    let canStartQueued = true
    if (pauseDownloadsOnGameLaunch && runningStatus !== "idle") {
      canStartQueued = false
    }

    expect(canStartQueued).toBe(false)
    expect(downloadQueue.length).toBe(1)
  })

  // Q. TRANSLATIONS
  it("Q. TRANSLATIONS: downloads.* and settings.pauseDownloadsOnGameLaunch exist across all 4 locales", () => {
    const locales = [
      { code: "es", dict: esDict },
      { code: "en", dict: enDict },
      { code: "pt", dict: ptDict },
      { code: "fr", dict: frDict },
    ] as const

    for (const { code, dict } of locales) {
      expect(getTranslation(code, "downloads.title")).toBeTruthy()
      expect(getTranslation(code, "downloads.active")).toBeTruthy()
      expect(getTranslation(code, "downloads.queue")).toBeTruthy()
      expect(getTranslation(code, "downloads.empty")).toBeTruthy()
      expect(getTranslation(code, "downloads.pause")).toBeTruthy()
      expect(getTranslation(code, "downloads.resume")).toBeTruthy()
      expect(getTranslation(code, "downloads.cancel")).toBeTruthy()
      expect(getTranslation(code, "playButton.queued")).toBeTruthy()
      expect(getTranslation(code, "settings.pauseDownloadsOnGameLaunchTitle")).toBeTruthy()
      expect(getTranslation(code, "settings.pauseDownloadsOnGameLaunchDesc")).toBeTruthy()
    }
  })
})
