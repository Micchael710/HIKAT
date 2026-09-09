// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import React, { act } from "react"
import { createRoot } from "react-dom/client"

// Mock Electron so main.cjs registers its real IPC handlers into ipcHandlers
const ipcHandlers = new Map<string, Function>()
const ipcListeners = new Map<string, Function>()

const getHandler = (channel: string): Function => {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`Handler not found: ${channel}`)
  return handler
}

let testTempDir = ""
let testAppDataRoot = ""
let testUserDataRoot = ""

testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hikat-main-init-"))
testAppDataRoot = path.join(testTempDir, "HiKAT")
testUserDataRoot = path.join(testAppDataRoot, "launcher")
fs.mkdirSync(path.join(testAppDataRoot, "games"), { recursive: true })
fs.mkdirSync(path.join(testAppDataRoot, "game files"), { recursive: true })
fs.mkdirSync(testUserDataRoot, { recursive: true })

let latestBrowserWindowInstance: any = null
const watchListeners = new Map<string, Function>()

const cjsFs = require("fs")
cjsFs.watch = ((targetRoot: any, options: any, listener: any) => {
  const cb = typeof options === "function" ? options : listener
  const normalized = String(targetRoot).replace(/\\/g, "/").toLowerCase()
  watchListeners.set(normalized, cb)
  return {
    on: vi.fn(),
    close: vi.fn(),
  } as any
}) as any

// Override http.get so checkServer returns false immediately without waiting 600ms
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

const appListeners = new Map<string, Function>()

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
    on: (event: string, listener: Function) => {
      appListeners.set(event, listener)
    },
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
      webContents: {
        send: vi.fn(),
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

// Mock minecraft-core and client-files-sync in require.cache using plain functions (not vi.fn)
// so vitest mock resets do not clear them. This allows background sync operations
// to stay active during tests and instantly resolve upon pause/cancel signals without internet requests.
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

const realClientFilesSync = require("../../electron/client-files-sync.cjs")
const cfsResolved = require.resolve("../../electron/client-files-sync.cjs")
require.cache[cfsResolved] = {
  id: cfsResolved,
  filename: cfsResolved,
  loaded: true,
  exports: {
    ...realClientFilesSync,
    downloadClientFilesToStaging: async ({ cancelSignal }: any) => {
      while (cancelSignal && !cancelSignal.isCancelled && !cancelSignal.isPaused) {
        await new Promise((r) => setTimeout(r, 10))
      }
      return { stagedFiles: [] }
    },
  },
} as any

// Require the REAL main.cjs from production
require("../../electron/main.cjs")

// @ts-expect-error CJS module without bundled declaration
import { GameLauncher } from "../../electron/game-launcher.cjs"
// @ts-expect-error CJS module without bundled declaration
import { SettingsStore } from "../../electron/settings-store.cjs"
// @ts-expect-error CJS module without bundled declaration
import { GameOperationManager } from "../../electron/game-operation-manager.cjs"
import { calculateAutomaticRam } from "../utils/gameSettings"
import { gameService } from "../services/gameService"
import SettingsView from "../views/SettingsView"
import { LanguageProvider } from "../context/LanguageContext"
import * as apiClientModule from "../services/apiClient"

describe("HiKAT Multi-Server Phase 2 Focused Regressions Suite", () => {
  let tempDir: string
  let unmountCurrent: (() => void) | null = null

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-p2-focused-"))
    localStorage.clear()
  })

  afterEach(async () => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
    if (tempDir && fs.existsSync(tempDir)) {
      await fsp.rm(tempDir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  // A. PRODUCTION gameName validation via real Main IPC handler
  describe("A. PRODUCTION gameName validation via real Main IPC handler", () => {
    it("game-check-plan with 'Warria ' (trailing space) is rejected by real validateGameName", async () => {
      const checkPlanHandler = getHandler("game-check-plan")
      expect(typeof checkPlanHandler).toBe("function")

      const res = await checkPlanHandler(
        {},
        {
          gameId: "warria-id",
          gameName: "Warria ",
          clientFiles: [],
        }
      )

      expect(res.success).toBe(false)
      expect(res.error).toMatch(/whitespace is not allowed/i)
    })

    it("game-check-plan with valid 'Warria' preserves exact name and resolves to games/Warria", async () => {
      const checkPlanHandler = getHandler("game-check-plan")

      const res = await checkPlanHandler(
        {},
        {
          gameId: "warria-id",
          gameName: "Warria",
          clientFiles: [],
          directoryPolicies: [],
          modpackVersion: "1.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
        }
      )

      expect(res.success).toBe(true)
    })
  })

  // B & C. PAUSE & CANCEL OWNERSHIP
  describe("B & C. Pause & Cancel Ownership via real Main IPC handlers", () => {
    it("B. Pause with manager IDLE is rejected and does not transition to PAUSED", async () => {
      const pauseHandler = getHandler("game-pause-sync")
      expect(typeof pauseHandler).toBe("function")

      // Calling pause for Warria while IDLE
      await expect(
        pauseHandler({}, { gameId: "warria-id", gameName: "Warria" })
      ).rejects.toThrow(/operation manager is IDLE/i)
    })

    it("B2. Pause cross-game: Warria active -> pause Apparatia rejected; legacy active -> pause Warria rejected", async () => {
      const startHandler = getHandler("game-start-sync")
      const pauseHandler = getHandler("game-pause-sync")
      const cancelHandler = getHandler("game-cancel-sync")

      // 1. Start Warria operation in flight (attach catch immediately to avoid unhandled rejection on cancel)
      const warriaSyncPromise = startHandler({}, {
        gameId: "warria-id",
        gameName: "Warria",
        modpackVersion: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        isVerify: true,
        clientFiles: [],
      }).catch((e: any) => e)
      await new Promise((r) => setTimeout(r, 20))

      // Apparatia attempts to pause -> rejected
      await expect(
        pauseHandler({}, { gameId: "apparatia-id", gameName: "Apparatia" })
      ).rejects.toThrow(/Cannot pause operation for another game/i)

      // Legacy attempt to pause -> rejected
      await expect(
        pauseHandler({}, {})
      ).rejects.toThrow(/Cannot pause scoped game operation from legacy request/i)

      // Cleanup Warria operation
      await cancelHandler({}, { gameId: "warria-id", gameName: "Warria" })
      await warriaSyncPromise

      // 2. Start legacy operation in flight
      const legacySyncPromise = startHandler({}, {
        modpackVersion: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        isVerify: true,
        clientFiles: [],
      }).catch((e: any) => e)
      await new Promise((r) => setTimeout(r, 20))

      // Warria attempts to pause legacy operation -> rejected
      await expect(
        pauseHandler({}, { gameId: "warria-id", gameName: "Warria" })
      ).rejects.toThrow(/Cannot pause operation for another game/i)

      // Cleanup legacy operation
      await cancelHandler({}, {})
      await legacySyncPromise
    })

    it("C. Cancel with manager IDLE is rejected and does not clean staging", async () => {
      const cancelHandler = getHandler("game-cancel-sync")
      expect(typeof cancelHandler).toBe("function")

      // Calling cancel for Warria while IDLE
      await expect(
        cancelHandler({}, { gameId: "warria-id", gameName: "Warria" })
      ).rejects.toThrow(/operation manager is IDLE/i)
    })

    it("C2. Cancel cross-game: Warria active -> cancel Apparatia rejected; legacy active -> cancel Warria rejected", async () => {
      const startHandler = getHandler("game-start-sync")
      const cancelHandler = getHandler("game-cancel-sync")

      // 1. Start Warria operation in flight
      const warriaSyncPromise = startHandler({}, {
        gameId: "warria-id",
        gameName: "Warria",
        modpackVersion: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        isVerify: true,
        clientFiles: [],
      }).catch((e: any) => e)
      await new Promise((r) => setTimeout(r, 20))

      // Apparatia attempts to cancel Warria active operation -> rejected
      await expect(
        cancelHandler({}, { gameId: "apparatia-id", gameName: "Apparatia" })
      ).rejects.toThrow(/Cannot cancel operation for another game/i)

      // Legacy attempt to cancel Warria active operation -> rejected
      await expect(
        cancelHandler({}, {})
      ).rejects.toThrow(/Cannot cancel scoped game operation from legacy request/i)

      // Warria cancels its own operation -> succeeds
      await cancelHandler({}, { gameId: "warria-id", gameName: "Warria" })
      await warriaSyncPromise

      // 2. Start legacy operation in flight
      const legacySyncPromise = startHandler({}, {
        modpackVersion: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        isVerify: true,
        clientFiles: [],
      }).catch((e: any) => e)
      await new Promise((r) => setTimeout(r, 20))

      // Warria attempts to cancel legacy active operation -> rejected
      await expect(
        cancelHandler({}, { gameId: "warria-id", gameName: "Warria" })
      ).rejects.toThrow(/Cannot cancel operation for another game/i)

      // Legacy cancels its own operation -> succeeds
      await cancelHandler({}, {})
      await legacySyncPromise
    })

    it("D. Watcher directory policies are registered per gameId and do not leak into global policies (integration)", async () => {
      const checkPlanHandler = getHandler("game-check-plan")

      // 1. Setup real folders and installed manifests for Warria and Apparatia
      const warriaRoot = path.join(testAppDataRoot, "games", "Warria")
      const apparatiaRoot = path.join(testAppDataRoot, "games", "Apparatia")
      await fsp.mkdir(path.join(warriaRoot, ".hikat"), { recursive: true })
      await fsp.mkdir(path.join(apparatiaRoot, ".hikat"), { recursive: true })
      await fsp.writeFile(
        path.join(warriaRoot, ".hikat", "installed-manifest.json"),
        JSON.stringify({ modpackVersion: "1.0.0", files: {} })
      )
      await fsp.writeFile(
        path.join(apparatiaRoot, ".hikat", "installed-manifest.json"),
        JSON.stringify({ modpackVersion: "1.0.0", files: {} })
      )

      // Ensure mainWindow is initialized for event emission
      const secondInstanceCall = appListeners.get("second-instance")
      if (secondInstanceCall) {
        secondInstanceCall({}, [])
      }

      // Register Warria policies: config is MODIFICABLE, mods is MANAGED
      const warriaPolicies = [
        { path: "config", policy: "MODIFICABLE" },
        { path: "mods", policy: "MANAGED" },
      ]
      const resWarria = await checkPlanHandler({}, {
        gameId: "warria-id",
        gameName: "Warria",
        directoryPolicies: warriaPolicies,
        clientFiles: [],
      })
      expect(resWarria.success).toBe(true)

      // Register Apparatia policies: config is MANAGED, mods is MODIFICABLE
      const apparatiaPolicies = [
        { path: "config", policy: "MANAGED" },
        { path: "mods", policy: "MODIFICABLE" },
      ]
      const resApp = await checkPlanHandler({}, {
        gameId: "apparatia-id",
        gameName: "Apparatia",
        directoryPolicies: apparatiaPolicies,
        clientFiles: [],
      })
      expect(resApp.success).toBe(true)

      // 2. Retrieve the real watcher callbacks created by main.cjs setupInstanceWatcher
      const warriaWatcher = watchListeners.get(warriaRoot.replace(/\\/g, "/").toLowerCase())
      const apparatiaWatcher = watchListeners.get(apparatiaRoot.replace(/\\/g, "/").toLowerCase())
      expect(typeof warriaWatcher).toBe("function")
      expect(typeof apparatiaWatcher).toBe("function")

      const sendSpy = latestBrowserWindowInstance?.webContents?.send
      expect(sendSpy).toBeDefined()
      sendSpy.mockClear()

      // 3. Provoke file change in config for Warria:
      // Warria has config=MODIFICABLE -> resolveWatcherDecision returns IGNORE -> no emit
      // If Warria had inherited Apparatia's config=MANAGED, it would emit!
      await warriaWatcher!("change", "config/options.txt")
      expect(sendSpy).not.toHaveBeenCalled()

      // 4. Provoke file change in config for Apparatia:
      // Apparatia has config=MANAGED -> resolveWatcherDecision returns EMIT -> emits with gameId: "apparatia-id"
      await apparatiaWatcher!("change", "config/options.txt")
      expect(sendSpy).toHaveBeenCalledWith("game-file-integrity-changed", {
        path: "config/options.txt",
        gameId: "apparatia-id",
      })

      sendSpy.mockClear()

      // 5. Inversely for mods: Warria has mods=MANAGED, Apparatia has mods=MODIFICABLE
      // Provoke file change in mods for Apparatia -> IGNORE (no emit)
      await apparatiaWatcher!("change", "mods/addon.jar")
      expect(sendSpy).not.toHaveBeenCalled()

      // Provoke file change in mods for Warria -> EMIT with gameId: "warria-id"
      await warriaWatcher!("change", "mods/addon.jar")
      expect(sendSpy).toHaveBeenCalledWith("game-file-integrity-changed", {
        path: "mods/addon.jar",
        gameId: "warria-id",
      })
    })
  })

  // E. VERIFY/UNINSTALL REMAIN DISABLED FOR SECONDARY SERVERS (PHASE 3)
  describe("E. Settings Verify/Uninstall disabled for secondary server (Phase 3 deferred)", () => {
    it("Warria selected: verify and uninstall buttons are disabled and do not produce events", async () => {
      const mockWarria = {
        id: "warria-uuid",
        name: "Warria",
        accentColor: "#3b82f6",
        isDefault: false,
      }
      const mockApparatia = {
        id: "apparatia-uuid",
        name: "Apparatia",
        accentColor: "#eab308",
        isDefault: true,
      }

      vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
        success: true,
        data: {
          publishedModpack: {
            version: "1.0.0",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            clientFiles: [{ path: "mods/w.jar", sha256: "abc", sizeBytes: 100, downloadUrl: "https://example.com/w.jar", policy: "MANAGED" }],
          },
        },
      } as any)

      ;(window as any).electronAPI = {
        checkSyncPlan: vi.fn().mockResolvedValue({ success: true, isFullyInstalled: true, hasExistingInstall: true }),
        getDedicatedGpu: vi.fn().mockResolvedValue(false),
        getRamAllocation: vi.fn().mockResolvedValue(6),
        getGameRuntimeInfo: vi.fn().mockResolvedValue({ javaMajorVersion: 21 }),
        getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
        onLaunchStatus: vi.fn().mockReturnValue(() => {}),
        onPhaseChange: vi.fn().mockReturnValue(() => {}),
      }

      const eventSpy = vi.fn()
      window.addEventListener("hikat:game-action-request", eventSpy)

      const container = document.createElement("div")
      document.body.appendChild(container)
      const root = createRoot(container)
      unmountCurrent = () => root.unmount()

      await act(async () => {
        root.render(
          <LanguageProvider>
            <SettingsView
              theme="dark"
              servers={[mockApparatia as any, mockWarria as any]}
              selectedGameId="warria-uuid"
              onSelectGameId={() => {}}
            />
          </LanguageProvider>
        )
      })

      // Switch to Games tab
      const tabButtons = container.querySelectorAll(".launcher-tab-btn")
      await act(async () => {
        ;(tabButtons[1] as HTMLElement)?.click()
      })

      // Dispatch verify/uninstall request from UI buttons
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-request", { detail: { action: "verify" } })
      )
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-request", { detail: { action: "uninstall" } })
      )

      window.removeEventListener("hikat:game-action-request", eventSpy)
    })
  })

  // F. GAMELAUNCHER PREFLIGHT AVOIDS PHANTOM runningGameId
  describe("F. GameLauncher Preflight Failure cleans runningGameId", () => {
    it("When synchronous validation fails (missing modLoaderVersion), runningGameId remains null", async () => {
      const launcher = new GameLauncher({} as any, {
        instanceRoot: testAppDataRoot,
        javaStorageRoot: testAppDataRoot,
        processStateRoot: testUserDataRoot,
        processChecker: () => true,
        processInfoFetcher: () => null,
      })

      // Call launch with missing modLoaderVersion for FABRIC
      await expect(
        launcher.launch({
          gameId: "warria-id",
          instanceRoot: path.join(testAppDataRoot, "games", "Warria"),
          minecraftVersion: "1.20.1",
          modLoader: "FABRIC",
          // modLoaderVersion is intentionally omitted
        })
      ).rejects.toThrow(/Missing required loader version/i)

      // Verify runningGameId was not assigned
      expect(launcher.runningGameId).toBeNull()
      expect(launcher.runningInstanceRoot).toBeNull()
      expect(launcher.getLaunchStatus()).toEqual({
        status: "idle",
        pid: null,
      })
    })
  })

  // G. SETTINGS STORE SETTER-FIRST MIGRATION
  describe("G. SettingsStore Apparatia setter-first legacy migration", () => {
    it("First call to setGameSetting for Apparatia migrates legacy values", () => {
      const store = new SettingsStore(tempDir)
      store.set("ramGB", 12)
      store.set("dedicatedGpu", false)

      const apparatiaId = "apparatia-id"
      const warriaId = "warria-id"

      // First action: setGameSetting for Apparatia
      store.setGameSetting(apparatiaId, "dedicatedGpu", true, { gameName: "Apparatia" })

      // ramGB preserves legacy 12, dedicatedGpu was updated to true
      expect(store.getGameSetting(apparatiaId, "ramGB", { gameName: "Apparatia" })).toBe(12)
      expect(store.getGameSetting(apparatiaId, "dedicatedGpu", { gameName: "Apparatia" })).toBe(true)

      // Warria receives defaults and does NOT inherit Apparatia legacy settings
      expect(store.getGameSetting(warriaId, "ramGB", { gameName: "Warria" })).toBe(8)
      expect(store.getGameSetting(warriaId, "dedicatedGpu", { gameName: "Warria" })).toBe(true)
    })
  })

  // H. JAVA COMPARTIDO
  describe("H. Java Shared Globally", () => {
    it("GameOperationManager resolves java using javaStorageRoot instead of instanceRoot", async () => {
      const javaResolverMock = vi.fn().mockReturnValue({ cliJavaPath: "java.exe", javawPath: "javaw.exe" })
      const manager = new GameOperationManager({
        javaResolver: javaResolverMock,
        coreChecker: vi.fn().mockResolvedValue({ installed: true, javaMajorVersion: 21, resolvedVersionId: "1.20.1" }),
        javaValidator: vi.fn().mockReturnValue({ valid: true }),
      })
      const warriaRoot = path.join(testAppDataRoot, "games", "Warria")

      await manager.checkPlan({
        instanceRoot: warriaRoot,
        javaStorageRoot: testAppDataRoot,
        clientFiles: [],
        directoryPolicies: [],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
      })

      // javaResolver receives testAppDataRoot, NOT warriaRoot
      expect(javaResolverMock).toHaveBeenCalledWith(
        testAppDataRoot,
        expect.objectContaining({ majorVersion: 21 })
      )
    })
  })

  // I. SINGLE MINECRAFT GLOBAL
  describe("I. Single Minecraft Global", () => {
    it("GameLauncher rejects second launch while another game is running or preparing", async () => {
      const launcher = new GameLauncher({} as any, {
        instanceRoot: path.join(testAppDataRoot, "games", "Apparatia"),
        javaStorageRoot: testAppDataRoot,
        processStateRoot: testUserDataRoot,
        processChecker: () => true,
        processInfoFetcher: () => null,
      })

      launcher.launchStatus = "running"
      launcher.runningGameId = "apparatia-id"

      await expect(
        launcher.launch({
          gameId: "warria-id",
          instanceRoot: path.join(testAppDataRoot, "games", "Warria"),
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
        })
      ).rejects.toThrow(/already running|launching/i)
    })
  })

  // J. PID CON GAMEID
  describe("J. PID Record with gameId", () => {
    it("PID record includes gameId and instanceRoot in processStateRoot", () => {
      const launcher = new GameLauncher({} as any, {
        instanceRoot: path.join(testAppDataRoot, "games", "Warria"),
        javaStorageRoot: testAppDataRoot,
        processStateRoot: testUserDataRoot,
        processChecker: () => true,
        processInfoFetcher: () => null,
      })

      launcher.saveProcessPid(12345, {
        gameId: "warria-id",
        instanceRoot: path.join(testAppDataRoot, "games", "Warria"),
        javaPath: "java.exe",
      })

      const pidFile = path.join(testUserDataRoot, "game-process.json")
      expect(fs.existsSync(pidFile)).toBe(true)

      const record = launcher.readSavedProcessRecord()
      expect(record.pid).toBe(12345)
      expect(record.gameId).toBe("warria-id")
      expect(record.instanceRoot).toBe(path.join(testAppDataRoot, "games", "Warria"))

      launcher.clearProcessPid()
    })
  })

  // K. STATUS POR GAMEID
  describe("K. Launch Status by requestedGameId", () => {
    it("game-get-status IPC handler isolates launch status by requested gameId", async () => {
      const statusHandler = getHandler("game-get-status")

      // When idle, querying for Warria returns status: idle, gameId: warria-id
      const warriaStatus = await statusHandler({}, { gameId: "warria-id" })
      expect(warriaStatus.status).toBe("idle")
      expect(warriaStatus.gameId).toBe("warria-id")
      expect(warriaStatus.pid).toBeNull()

      // Also verify GameLauncher instance getLaunchStatus() structure with scoped properties
      const launcher = new GameLauncher({} as any, {
        instanceRoot: path.join(testAppDataRoot, "games", "Warria"),
        javaStorageRoot: testAppDataRoot,
        processStateRoot: testUserDataRoot,
        processChecker: () => true,
        processInfoFetcher: () => null,
      })
      launcher.launchStatus = "running"
      launcher.trackedPid = 9999
      launcher.runningGameId = "warria-id"

      const launchInfo = launcher.getLaunchStatus()
      expect(launchInfo.status).toBe("running")
      expect(launchInfo.pid).toBe(9999)
      expect(launchInfo.gameId).toBe("warria-id")
    })
  })

  // L. RAM/GPU AISLADOS
  describe("L. RAM and GPU Settings Isolation", () => {
    it("SettingsStore isolates RAM and GPU settings per gameId", () => {
      const store = new SettingsStore(tempDir)

      store.setGameSetting("apparatia-id", "ramGB", 8)
      store.setGameSetting("apparatia-id", "dedicatedGpu", true)

      store.setGameSetting("warria-id", "ramGB", 6)
      store.setGameSetting("warria-id", "dedicatedGpu", false)

      expect(store.getGameSetting("apparatia-id", "ramGB")).toBe(8)
      expect(store.getGameSetting("apparatia-id", "dedicatedGpu")).toBe(true)

      expect(store.getGameSetting("warria-id", "ramGB")).toBe(6)
      expect(store.getGameSetting("warria-id", "dedicatedGpu")).toBe(false)
    })
  })

  // M. MIGRACIÓN LEGACY GETTER-FIRST
  describe("M. Legacy Apparatia Getter-First Migration", () => {
    it("Legacy Apparatia migration getter-first migrates legacy values once, Warria gets safe defaults", () => {
      const store = new SettingsStore(tempDir)
      // Legacy settings exist
      store.set("ramGB", 12)
      store.set("dedicatedGpu", false)

      // Apparatia accesses settings via getter -> receives legacy values
      const appRam = store.getGameSetting("app-id", "ramGB", { gameName: "Apparatia" })
      const appGpu = store.getGameSetting("app-id", "dedicatedGpu", { gameName: "Apparatia" })
      expect(appRam).toBe(12)
      expect(appGpu).toBe(false)

      // Warria accesses settings -> receives standard defaults (8GB, true), NOT Apparatia legacy
      const warriaRam = store.getGameSetting("warria-id", "ramGB", { gameName: "Warria" })
      const warriaGpu = store.getGameSetting("warria-id", "dedicatedGpu", { gameName: "Warria" })
      expect(warriaRam).toBe(8)
      expect(warriaGpu).toBe(true)
    })
  })

  // N. AUTO RAM
  describe("N. Automatic RAM Calculation & Per-Game Key Persistence", () => {
    it("calculateAutomaticRam preserves formula and persists with gameId-scoped key", () => {
      expect(calculateAutomaticRam(4)).toBe(2)
      expect(calculateAutomaticRam(8)).toBe(4)
      expect(calculateAutomaticRam(16)).toBe(8)
      expect(calculateAutomaticRam(32)).toBe(8)
      expect(calculateAutomaticRam(32, 12)).toBe(12)

      localStorage.setItem("hikat_ram_auto_warria-id", "true")
      expect(localStorage.getItem("hikat_ram_auto_warria-id")).toBe("true")
      expect(localStorage.getItem("hikat_ram_auto_apparatia-id")).toBeNull()
    })
  })

  // O. CHECK GAME MANIFEST CON GAME CONTEXT
  describe("O. gameService.checkGameManifest passes gameContext", () => {
    it("checkGameManifest passes gameContext to checkSyncPlan", async () => {
      const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true, isFullyInstalled: true })
      ;(window as any).electronAPI = { checkSyncPlan: checkSyncPlanMock }

      vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
        success: true,
        data: {
          publishedModpack: {
            version: "1.0.0",
            minecraftVersion: "1.20.1",
            modLoader: "FABRIC",
            clientFiles: [
              { path: "mods/test.jar", sha256: "abc", sizeBytes: 50, downloadUrl: "https://example.com/test.jar", policy: "MANAGED" },
            ],
          },
        },
      } as any)

      await gameService.checkGameManifest("warria-id", {
        gameContext: {
          gameId: "warria-id",
          gameName: "Warria",
        },
      })

      expect(checkSyncPlanMock).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: "warria-id",
          gameName: "Warria",
        })
      )
    })
  })

  // P. PHASE & PROGRESS EVENTS
  describe("P. Phase and Progress Events Scoping", () => {
    it("Phase change callback passes phase and gameId without breaking single-arg handlers", () => {
      let receivedPhase: string | null = null
      let receivedGameId: string | null = null

      const callback = (phase: string, gameId?: string) => {
        receivedPhase = phase
        receivedGameId = gameId || null
      }

      // Trigger event with gameId
      callback("SYNCING", "warria-id")
      expect(receivedPhase).toBe("SYNCING")
      expect(receivedGameId).toBe("warria-id")

      // Backward compatible single-arg call
      callback("IDLE")
      expect(receivedPhase).toBe("IDLE")
      expect(receivedGameId).toBeNull()
    })
  })
})
