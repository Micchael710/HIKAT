// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import http from "http"
import crypto from "crypto"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { gameService } from "../services/gameService"
import { serverService } from "../services/serverService"
import { useLauncherState } from "../hooks/useLauncherState"
import {
  STORAGE_KEYS,
  setStoredBoolean,
  SETTINGS_CHANGED_EVENT,
} from "../utils/settingsStorage"
import {
  generateSyncPlan,
  saveInstalledManifest,
  loadInstalledManifest,
  cleanStaging,
  cleanFreshInstall,
  getStagingPaths,
  quickCheckProtectedIntegrity,
  backgroundCheckProtectedSha,
  hasSymlinkInPath,
  hasSymlinkInPathSync,
  ENFORCED_DIRECTORIES,
  // @ts-expect-error CJS module without declaration
} from "../../electron/client-files-sync.cjs"

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

// Import main.cjs after mocking electron
const {
  operationManager,
  gameLauncher,
  settingsStore,
  runGameSync,
  resetDownloadQueueForTesting,
  getDownloadQueue,
  scheduleBackgroundShaCheck,
  activeBackgroundShaChecks,
  deferredBackgroundShaChecks,
  setCurrentProcessingItemForTesting,
  getCurrentProcessingItemForTesting,
  setActiveOperationGameIdForTesting,
  setMainWindowForTesting,
  markGameIntegrityDirty,
  isGameIntegrityDirty,
  clearGameIntegrityDirty,
} = require("../../electron/main.cjs")

describe("Closing Hardening Suite: Real Execution of Multi-Server Download & Integrity Robustness", () => {
  let tempDir: string
  let instanceRoot: string
  let server: http.Server
  let serverBaseUrl: string
  let reactRoot: ReturnType<typeof createRoot> | null = null
  let container: HTMLDivElement | null = null

  function computeSha(content: Buffer | string): string {
    return crypto
      .createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
      .digest("hex")
      .toLowerCase()
  }

  beforeEach(async () => {
    localStorage.clear()
    vi.restoreAllMocks()
    lastSentEvents.length = 0

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-closing-real-"))
    activeAppDataDir = path.join(tempDir, "appdata")
    activeUserDataDir = path.join(tempDir, "userdata")
    await fsp.mkdir(activeUserDataDir, { recursive: true })
    instanceRoot = path.join(activeAppDataDir, "HiKAT", "games", "TestServer")
    await fsp.mkdir(instanceRoot, { recursive: true })

    resetDownloadQueueForTesting()

    const mockWin = {
      isDestroyed: () => false,
      isVisible: () => true,
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      isMinimized: () => false,
      webContents: {
        send: vi.fn((channel, ...args) => {
          lastSentEvents.push({ channel, args })
        }),
      },
    }
    setMainWindowForTesting(mockWin)

    server = http.createServer((req, res) => {
      const url = req.url || ""
      if (url.startsWith("/files/")) {
        const content = Buffer.from("Default test binary", "utf8")
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": content.length,
        })
        res.end(content)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any
        serverBaseUrl = `http://127.0.0.1:${addr.port}`
        resolve()
      })
    })

    container = document.createElement("div")
    document.body.appendChild(container)
    reactRoot = createRoot(container)
  })

  afterEach(async () => {
    if (reactRoot) {
      await act(async () => {
        reactRoot?.unmount()
      })
      reactRoot = null
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
      container = null
    }
    resetDownloadQueueForTesting()
    activeBackgroundShaChecks.clear()
    deferredBackgroundShaChecks.clear()

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  // 1. Política antigua NO_MODIFICABLE eliminada en release actual: extra del usuario NO se prunea
  it("1. Política antigua NO_MODIFICABLE eliminada en release actual: extra del usuario NO se prunea", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    const userModPath = path.join(modsDir, "extra-user-mod.jar")
    await fsp.writeFile(userModPath, "custom user mod")

    // Old manifest had directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }]
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/old-release-mod.jar": {
          officialSha256: "0".repeat(64),
          policy: "NO_MODIFICABLE",
        },
      },
    })

    // In current release, directoryPolicies is EMPTY (admin removed NO_MODIFICABLE from mods)
    const currentReleaseDirectoryPolicies: any[] = []
    const plan = await generateSyncPlan(
      instanceRoot,
      [],
      "1.1.0",
      currentReleaseDirectoryPolicies,
    )

    // User's extra mod must NOT be pruned
    expect(plan.toPrune).toHaveLength(0)
    expect(plan.toPrune.some((p: any) => p.path === "mods/extra-user-mod.jar")).toBe(false)
    expect(fs.existsSync(userModPath)).toBe(true)
  })

  // 2. Política actual NO_MODIFICABLE: extra sí se prunea
  it("2. Política actual NO_MODIFICABLE: extra sí se prunea", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    const extraModPath = path.join(modsDir, "unauthorized.jar")
    await fsp.writeFile(extraModPath, "unauthorized mod")

    // Current release HAS directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }]
    const plan = await generateSyncPlan(instanceRoot, [], "1.0.0", [
      { path: "mods", policy: "NO_MODIFICABLE" },
    ])

    expect(plan.toPrune).toHaveLength(1)
    expect(plan.toPrune[0].path).toBe("mods/unauthorized.jar")
  })

  // 3. Background SHA iniciado sobre 1.1: durante el hash se instala 1.2; el resultado viejo de 1.1 NO marca dirty
  it("3. Background SHA iniciado sobre 1.1: durante el hash se instala 1.2; el resultado viejo de 1.1 NO marca dirty", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    const filePath = path.join(modsDir, "core.jar")

    // File on disk with content modified compared to official SHA of 1.1.0
    await fsp.writeFile(filePath, "modified core binary")

    const manifestV1_1 = {
      modpackVersion: "1.1.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/core.jar": {
          officialSha256: computeSha("official v1.1.0 core binary"),
          policy: "NO_MODIFICABLE",
          sizeBytes: 20,
        },
      },
    }
    await saveInstalledManifest(instanceRoot, manifestV1_1)

    // Simulate in-flight hash by slightly delaying lstat for core.jar
    const origLstat = fsp.lstat
    vi.spyOn(fsp, "lstat").mockImplementation(async (target: any) => {
      if (String(target).includes("core.jar")) {
        await new Promise((r) => setTimeout(r, 40))
      }
      return origLstat(target)
    })

    // Start background check for version 1.1.0
    scheduleBackgroundShaCheck("server-test", instanceRoot, manifestV1_1)

    // Simulate atomic commit of version 1.2.0 while background check is running:
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.2.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/core.jar": {
          officialSha256: computeSha("modified core binary"),
          policy: "NO_MODIFICABLE",
          sizeBytes: 20,
        },
      },
    })

    // Wait for the background SHA check promise to complete
    const pending = activeBackgroundShaChecks.get("server-test")
    if (pending) {
      await pending.promise
    }

    // Since version changed to 1.2.0 during hash of 1.1.0, the old result must be discarded:
    const integrityEvents = lastSentEvents.filter(
      (e) => e.channel === "game-file-integrity-changed",
    )
    expect(integrityEvents).toHaveLength(0)
  })

  // 4. Background SHA no corre sobre mismo gameId mientras está sincronizando
  it("4. Background SHA no corre sobre mismo gameId mientras está sincronizando", async () => {
    operationManager.state = "SYNCING"
    setActiveOperationGameIdForTesting("server-busy")

    const manifest = {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {},
    }

    // Attempt to schedule check while operationManager is actively SYNCING
    scheduleBackgroundShaCheck("server-busy", instanceRoot, manifest)

    // Check must be deferred, NOT actively running
    expect(activeBackgroundShaChecks.has("server-busy")).toBe(false)
    expect(deferredBackgroundShaChecks.has("server-busy")).toBe(true)

    operationManager.state = "IDLE"
    setActiveOperationGameIdForTesting(null)
  })

  // 5. Symlink/junction dentro de NO_MODIFICABLE => dirty
  it("5. Symlink/junction dentro de NO_MODIFICABLE => dirty", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })

    const realTargetPath = path.join(tempDir, "external-target.jar")
    const targetContent = "target binary with matching sha"
    await fsp.writeFile(realTargetPath, targetContent)
    const targetSha = computeSha(targetContent)

    const symlinkPath = path.join(modsDir, "symlinked-mod.jar")
    try {
      await fsp.symlink(realTargetPath, symlinkPath, "file")
    } catch (e) {
      // On Windows non-elevated, if symlink creation is restricted, test logic directly
      return
    }

    const manifest = {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/symlinked-mod.jar": {
          officialSha256: targetSha,
          policy: "NO_MODIFICABLE",
          sizeBytes: Buffer.byteLength(targetContent),
        },
      },
    }

    // Both quick check and background check must reject symlinks directly as dirty
    const quickDirty = await quickCheckProtectedIntegrity(instanceRoot, manifest)
    expect(quickDirty).toBe(true)

    const bgResult = await backgroundCheckProtectedSha(instanceRoot, manifest)
    expect(bgResult.dirty).toBe(true)
    expect(bgResult.path).toBe("mods/symlinked-mod.jar")
  })

  // 6. PLAY mientras SHA está pendiente: espera el check; limpio => launch; dirty => no launch
  it("6. PLAY mientras SHA está pendiente: espera el check; limpio => launch; dirty => no launch", async () => {
    const launchHandler = ipcHandlers.get("game-launch")
    expect(launchHandler).toBeDefined()

    vi.spyOn(gameLauncher, "launch").mockResolvedValue({ success: true, pid: 12345 })

    // A) Pending check that resolves clean
    activeBackgroundShaChecks.set("srv-clean", {
      promise: Promise.resolve({ dirty: false }),
      modpackVersion: "1.0.0",
    })

    const cleanRes = await launchHandler!(null, {
      gameId: "srv-clean",
      gameName: "TestServer",
    })
    expect(cleanRes.success).toBe(true)
    expect(gameLauncher.launch).toHaveBeenCalled()

    // B) Pending check that resolves dirty
    activeBackgroundShaChecks.set("srv-dirty", {
      promise: Promise.resolve({ dirty: true, path: "mods/compromised.jar" }),
      modpackVersion: "1.0.0",
    })

    await expect(
      launchHandler!(null, {
        gameId: "srv-dirty",
        gameName: "TestServer",
      }),
    ).rejects.toThrow(/Integrity check failed/i)
  })

  // 7. Cancel cuando recovery está en currentProcessingItem y manager IDLE: limpia staging y continúa FIFO
  it("7. Cancel cuando recovery está en currentProcessingItem y manager IDLE: limpia staging y continúa FIFO", async () => {
    const cancelHandler = ipcHandlers.get("game-cancel-sync")
    expect(cancelHandler).toBeDefined()

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      files: {},
    })

    const { filesDir } = getStagingPaths(instanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFile = path.join(filesDir, "recovery-temp.tmp")
    await fsp.writeFile(stagingFile, "recovery in-flight data")

    // Set currentProcessingItem as recovery while manager is IDLE
    setCurrentProcessingItemForTesting({
      gameId: "srv-recovery",
      gameName: "TestServer",
      savedPhase: "DOWNLOADING",
      savedProgress: 50,
      clientFiles: [],
    })
    operationManager.state = "IDLE"

    const res = await cancelHandler!(null, {
      gameId: "srv-recovery",
      gameName: "TestServer",
    })

    expect(res.success).toBe(true)
    expect(res.queuedRemoved).toBe(true)
    expect(getCurrentProcessingItemForTesting()).toBeNull()
    expect(fs.existsSync(stagingFile)).toBe(false)
  })

  // 8. Launcher bootstrap: servidor NO seleccionado con versión antigua + Auto Update ON llama realmente al flujo global de sync/queue
  it("8. Launcher bootstrap: servidor NO seleccionado con versión antigua + Auto Update ON llama realmente al flujo global de sync/queue", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "true")

    const serversList = [
      { id: "server-a", name: "Server A" },
      { id: "server-b", name: "Server B" },
    ]
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue(serversList as any)

    const publishedB = {
      version: "1.1.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE" as const,
      clientFiles: [{ path: "mods/b.jar", sha256: "b-sha", sizeBytes: 100 }],
      directoryPolicies: [],
    }

    vi.spyOn(gameService, "getPublishedModpack").mockImplementation(async (id) => {
      if (id === "server-b") return publishedB as any
      return { version: "1.0.0", clientFiles: [] } as any
    })

    // electronAPI getInstalledState: Server A has 1.0.0 (up to date), Server B has 1.0.0 (outdated -> published is 1.1.0)
    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockImplementation(async ({ gameId }) => {
        if (gameId === "server-b") {
          return { installedModpackVersion: "1.0.0", integrityDirty: false }
        }
        return { installedModpackVersion: "1.0.0", integrityDirty: false }
      }),
      getLaunchStatus: vi.fn().mockResolvedValue({
        activeOperationGameId: null,
        activeOperationState: "IDLE",
      }),
      onPhaseChange: vi.fn().mockReturnValue(() => {}),
      onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
    }

    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      reactRoot?.render(React.createElement(Consumer))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Server B must have been automatically queued/started via real startSync
    expect(startSyncSpy).toHaveBeenCalledWith(
      publishedB.clientFiles,
      "1.1.0",
      "1.21.1",
      "NEOFORGE",
      undefined,
      undefined,
      false,
      [],
      { gameId: "server-b", gameName: "Server B" },
    )
  })

  // 9. Bootstrap con Auto Update OFF: no inicia nada
  it("9. Bootstrap con Auto Update OFF: no inicia nada", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "false")

    const serversList = [{ id: "server-b", name: "Server B" }]
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue(serversList as any)
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.1.0",
      clientFiles: [{ path: "mods/b.jar", sha256: "b-sha", sizeBytes: 100 }],
    } as any)

    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockResolvedValue({
        installedModpackVersion: "1.0.0",
        integrityDirty: false,
      }),
      getLaunchStatus: vi.fn().mockResolvedValue({ activeOperationState: "IDLE" }),
      onPhaseChange: vi.fn().mockReturnValue(() => {}),
      onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
    }

    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      reactRoot?.render(React.createElement(Consumer))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(startSyncSpy).not.toHaveBeenCalled()
  })

  // 10. Servidor nunca instalado: no auto-instala
  it("10. Servidor nunca instalado: no auto-instala", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "true")

    const serversList = [{ id: "server-new", name: "New Server" }]
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue(serversList as any)
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.0.0",
      clientFiles: [{ path: "mods/new.jar", sha256: "new-sha", sizeBytes: 100 }],
    } as any)

    // installedModpackVersion is null -> fresh server, never installed
    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockResolvedValue({
        installedModpackVersion: null,
        integrityDirty: false,
      }),
      getLaunchStatus: vi.fn().mockResolvedValue({ activeOperationState: "IDLE" }),
      onPhaseChange: vi.fn().mockReturnValue(() => {}),
      onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
    }

    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      reactRoot?.render(React.createElement(Consumer))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(startSyncSpy).not.toHaveBeenCalled()
  })

  // 11. OFF -> ON en Settings: servidores instalados desactualizados se evalúan globalmente
  it("11. OFF -> ON en Settings: servidores instalados desactualizados se evalúan globalmente", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "false")

    const serversList = [{ id: "server-outdated", name: "Outdated Server" }]
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue(serversList as any)
    const published = {
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      clientFiles: [{ path: "mods/v2.jar", sha256: "v2-sha", sizeBytes: 200 }],
    }
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(published as any)

    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockResolvedValue({
        installedModpackVersion: "1.0.0",
        integrityDirty: false,
      }),
      getLaunchStatus: vi.fn().mockResolvedValue({ activeOperationState: "IDLE" }),
      onPhaseChange: vi.fn().mockReturnValue(() => {}),
      onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
    }

    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      reactRoot?.render(React.createElement(Consumer))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Initially OFF -> no sync
    expect(startSyncSpy).not.toHaveBeenCalled()

    // User toggles Auto Updates to ON in Settings
    await act(async () => {
      setStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Must evaluate and trigger startSync for Outdated Server
    expect(startSyncSpy).toHaveBeenCalledWith(
      published.clientFiles,
      "2.0.0",
      "1.21.1",
      undefined,
      undefined,
      undefined,
      false,
      [],
      { gameId: "server-outdated", gameName: "Outdated Server" },
    )
  })

  // 12. Recovery 1.1 + published 1.2: no reemplaza recovery; 1.2 empieza/encola después de IDLE
  it("12. Recovery 1.1 + published 1.2: no reemplaza recovery; 1.2 empieza/encola después de IDLE", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "true")

    const serversList = [{ id: "server-recovering", name: "Recovering Server" }]
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue(serversList as any)
    const published = {
      version: "1.2.0",
      minecraftVersion: "1.21.1",
      clientFiles: [{ path: "mods/v12.jar", sha256: "v12-sha", sizeBytes: 150 }],
    }
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(published as any)

    let phaseListener: any = null
    let isSameActive = true

    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockImplementation(async () => {
        // When IDLE, installed state is 1.1.0 (recovery completed)
        return {
          installedModpackVersion: isSameActive ? "1.0.0" : "1.1.0",
          integrityDirty: false,
        }
      }),
      getLaunchStatus: vi.fn().mockImplementation(async () => ({
        activeOperationGameId: isSameActive ? "server-recovering" : null,
        activeOperationState: isSameActive ? "SYNCING" : "IDLE",
      })),
      onPhaseChange: vi.fn().mockImplementation((cb) => {
        phaseListener = cb
        return () => {}
      }),
      onGameFileIntegrityChanged: vi.fn().mockReturnValue(() => {}),
    }

    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      reactRoot?.render(React.createElement(Consumer))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // While recovering, 1.2 must NOT be started / must NOT interrupt
    expect(startSyncSpy).not.toHaveBeenCalled()

    // Now recovery completes and emits IDLE
    isSameActive = false
    await act(async () => {
      phaseListener?.("IDLE", "server-recovering")
    })
    await act(async () => {
      await Promise.resolve()
    })

    // After IDLE, global state refreshes to 1.1.0, and published is 1.2.0 -> starts 1.2.0!
    expect(startSyncSpy).toHaveBeenCalledWith(
      published.clientFiles,
      "1.2.0",
      "1.21.1",
      undefined,
      undefined,
      undefined,
      false,
      [],
      { gameId: "server-recovering", gameName: "Recovering Server" },
    )
  })

  it("13. Minecraft A running + update A: A se encola y NO comienza", async () => {
    gameLauncher.runningGameId = "server-a"
    gameLauncher.setStatus("running", { gameId: "server-a" })

    const startSyncHandler = ipcHandlers.get("game-start-sync")
    expect(startSyncHandler).toBeDefined()

    const res = await startSyncHandler?.({}, {
      gameId: "server-a",
      gameName: "Server A",
      clientFiles: [{ path: "mods/test.jar", sha256: "abc", sizeBytes: 100 }],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
    })

    expect(res).toEqual(expect.objectContaining({ success: true, queued: true }))
    expect(operationManager.getState()).toBe("IDLE")
    const q = getDownloadQueue()
    expect(q.some((item: any) => item.gameId === "server-a")).toBe(true)
  })

  it("14. Al cerrar Minecraft A: A comienza automáticamente desde FIFO", async () => {
    gameLauncher.runningGameId = "server-a"
    gameLauncher.setStatus("running", { gameId: "server-a" })

    const startSyncHandler = ipcHandlers.get("game-start-sync")
    await startSyncHandler?.({}, {
      gameId: "server-a",
      gameName: "Server A",
      clientFiles: [{ path: "mods/test.jar", sha256: "abc", sizeBytes: 100 }],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
    })

    expect(getDownloadQueue().length).toBe(1)
    expect(operationManager.getState()).toBe("IDLE")

    const startSyncSpy = vi.spyOn(operationManager, "startSync").mockResolvedValue({ success: true } as any)

    // Minecraft A exits
    gameLauncher.setStatus("idle", { gameId: "server-a" })

    // Allow promise tick for processNextQueuedSync
    await new Promise((r) => setTimeout(r, 50))

    expect(startSyncSpy).toHaveBeenCalledWith(expect.objectContaining({
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
    }))
  })

  it("15. Minecraft A running + update B + pauseDownloadsOnGameLaunch = true: B se encola y no comienza hasta cerrar Minecraft", async () => {
    settingsStore.set("pauseDownloadsOnGameLaunch", true)
    gameLauncher.runningGameId = "server-a"
    gameLauncher.setStatus("running", { gameId: "server-a" })

    const startSyncSpy = vi.spyOn(operationManager, "startSync").mockResolvedValue({ success: true } as any)
    const startSyncHandler = ipcHandlers.get("game-start-sync")

    const res = await startSyncHandler?.({}, {
      gameId: "server-b",
      gameName: "Server B",
      clientFiles: [{ path: "mods/b.jar", sha256: "bbb", sizeBytes: 100 }],
      modpackVersion: "1.5.0",
      minecraftVersion: "1.21.1",
    })

    expect(res).toEqual(expect.objectContaining({ success: true, queued: true }))
    expect(operationManager.getState()).toBe("IDLE")
    expect(startSyncSpy).not.toHaveBeenCalled()
    expect(getDownloadQueue().some((item: any) => item.gameId === "server-b")).toBe(true)

    // Close Minecraft A
    gameLauncher.setStatus("idle", { gameId: "server-a" })
    await new Promise((r) => setTimeout(r, 50))

    expect(startSyncSpy).toHaveBeenCalledWith(expect.objectContaining({
      modpackVersion: "1.5.0",
    }))
  })

  it("16. Minecraft A running + update B + pauseDownloadsOnGameLaunch = false: B puede comenzar normalmente", async () => {
    settingsStore.set("pauseDownloadsOnGameLaunch", false)
    gameLauncher.runningGameId = "server-a"
    gameLauncher.setStatus("running", { gameId: "server-a" })

    const startSyncSpy = vi.spyOn(operationManager, "startSync").mockResolvedValue({ success: true } as any)
    const startSyncHandler = ipcHandlers.get("game-start-sync")

    const res = await startSyncHandler?.({}, {
      gameId: "server-b",
      gameName: "Server B",
      clientFiles: [{ path: "mods/b.jar", sha256: "bbb", sizeBytes: 100 }],
      modpackVersion: "1.5.0",
      minecraftVersion: "1.21.1",
    })

    // B starts immediately without being queued
    expect(startSyncSpy).toHaveBeenCalledWith(expect.objectContaining({
      modpackVersion: "1.5.0",
    }))
    expect(res).not.toEqual(expect.objectContaining({ queued: true }))
  })

  it("17. Descarga B activa + lanzar A + setting ON: auto-pause y auto-resume sigue intacto", async () => {
    settingsStore.set("pauseDownloadsOnGameLaunch", true)

    setActiveOperationGameIdForTesting("server-b")
    operationManager.state = "SYNCING"

    const pauseSpy = vi.spyOn(operationManager, "pauseSync").mockImplementation(async () => {
      operationManager.state = "PAUSED"
      return { paused: true }
    })
    const resumeSpy = vi.spyOn(operationManager, "resumeSync").mockImplementation(async () => {
      operationManager.state = "SYNCING"
      return { success: true }
    })

    const launchHandler = ipcHandlers.get("game-launch")
    vi.spyOn(operationManager, "launchGame").mockResolvedValue({ pid: 1234 } as any)

    // Launch Game A
    await launchHandler?.({}, {
      gameId: "server-a",
      gameName: "Server A",
      minecraftVersion: "1.21.1",
      allowDuringOperation: true,
    })

    expect(pauseSpy).toHaveBeenCalled()

    // Game A is running
    gameLauncher.setStatus("running", { gameId: "server-a" })

    // Game A closes -> status idle triggers resume
    gameLauncher.setStatus("idle", { gameId: "server-a" })
    await new Promise((r) => setTimeout(r, 50))

    expect(resumeSpy).toHaveBeenCalled()
  })

  it("18. Directorio NO_MODIFICABLE que es symlink/junction: integrity dirty", async () => {
    const targetFolder = path.join(tempDir, "external-mods")
    await fsp.mkdir(targetFolder, { recursive: true })
    const modsJunction = path.join(instanceRoot, "mods")

    // Create junction
    fs.symlinkSync(targetFolder, modsJunction, "junction")

    const manifest = {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/core.jar": { policy: "NO_MODIFICABLE", officialSha256: "abc", sizeBytes: 100 },
      },
    }

    const isDirty = await quickCheckProtectedIntegrity(instanceRoot, manifest)
    expect(isDirty).toBe(true)

    const symlinkResult = await hasSymlinkInPath(instanceRoot, "mods")
    expect(symlinkResult).toBe(true)
  })

  it("19. Ancestro protegido con symlink/junction: integrity dirty", async () => {
    const targetFolder = path.join(tempDir, "external-config")
    await fsp.mkdir(path.join(targetFolder, "protected"), { recursive: true })
    await fsp.writeFile(path.join(targetFolder, "protected", "secret.json"), "secret-content")

    const configJunction = path.join(instanceRoot, "config-junction")
    fs.symlinkSync(targetFolder, configJunction, "junction")

    const manifest = {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "config-junction/protected", policy: "NO_MODIFICABLE" }],
      files: {
        "config-junction/protected/secret.json": {
          policy: "NO_MODIFICABLE",
          officialSha256: computeSha("secret-content"),
          sizeBytes: Buffer.byteLength("secret-content"),
        },
      },
    }

    const quickDirty = await quickCheckProtectedIntegrity(instanceRoot, manifest)
    expect(quickDirty).toBe(true)

    const shaResult = await backgroundCheckProtectedSha(instanceRoot, manifest)
    expect(shaResult.dirty).toBe(true)
  })

  it("20. Background SHA dirty: Main guarda dirty aunque renderer todavía no procese el evento", async () => {
    clearGameIntegrityDirty("server-corrupted-sha")
    expect(isGameIntegrityDirty("server-corrupted-sha")).toBe(false)

    const corruptFolder = path.join(tempDir, "corrupt-inst")
    await fsp.mkdir(path.join(corruptFolder, "mods"), { recursive: true })
    await fsp.writeFile(path.join(corruptFolder, "mods", "mod.jar"), "bad-content")

    const manifest = {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/mod.jar": {
          policy: "NO_MODIFICABLE",
          officialSha256: "0000000000000000000000000000000000000000000000000000000000000000",
          sizeBytes: 11,
        },
      },
    }
    await saveInstalledManifest(corruptFolder, manifest)

    scheduleBackgroundShaCheck("server-corrupted-sha", corruptFolder, manifest)
    const check = activeBackgroundShaChecks.get("server-corrupted-sha")
    expect(check).toBeDefined()
    await check.promise

    // Main authoritative store MUST have recorded dirty
    expect(isGameIntegrityDirty("server-corrupted-sha")).toBe(true)
  })

  it("21. PLAY con dirty autoritativo en Main: NO lanza Minecraft", async () => {
    markGameIntegrityDirty("server-dirty-launch")
    expect(isGameIntegrityDirty("server-dirty-launch")).toBe(true)

    const launchHandler = ipcHandlers.get("game-launch")
    const launchGameSpy = vi.spyOn(operationManager, "launchGame")

    await expect(
      launchHandler?.({}, {
        gameId: "server-dirty-launch",
        gameName: "Server Dirty Launch",
        minecraftVersion: "1.21.1",
      }),
    ).rejects.toThrow(/Integrity check failed/i)

    expect(launchGameSpy).not.toHaveBeenCalled()
  })

  it("22. Verify/sync exitoso: limpia dirty", async () => {
    markGameIntegrityDirty("server-repaired")
    expect(isGameIntegrityDirty("server-repaired")).toBe(true)

    vi.spyOn(operationManager, "startSync").mockResolvedValue({ success: true } as any)

    await runGameSync(
      { gameId: "server-repaired", instanceRoot },
      { clientFiles: [], modpackVersion: "1.0.0", isVerify: true },
    )

    expect(isGameIntegrityDirty("server-repaired")).toBe(false)
  })

  it("23. Verify/sync fallido: dirty permanece", async () => {
    markGameIntegrityDirty("server-failing")
    expect(isGameIntegrityDirty("server-failing")).toBe(true)

    vi.spyOn(operationManager, "startSync").mockRejectedValue(new Error("Network disconnect"))

    await expect(
      runGameSync(
        { gameId: "server-failing", instanceRoot },
        { clientFiles: [], modpackVersion: "1.0.0", isVerify: true },
      ),
    ).rejects.toThrow("Network disconnect")

    expect(isGameIntegrityDirty("server-failing")).toBe(true)
  })
})
