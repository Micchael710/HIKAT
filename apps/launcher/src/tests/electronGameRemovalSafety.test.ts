// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"

const ipcHandlers = new Map<string, Function>()
const ipcListeners = new Map<string, Function>()
let activeUserDataDir = ""
let activeAppDataDir = ""
const lastSentEvents: { channel: string; args: any[] }[] = []

const whenReadyCallbacks: Function[] = []

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
    whenReady: vi.fn(() => ({
      then: (cb: Function) => {
        whenReadyCallbacks.push(cb)
        return Promise.resolve()
      },
    })),
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
  resolveGameContext,
  getGamesRoot,
  resetDownloadQueueForTesting,
  getDownloadQueue,
  getPendingGameRemovals,
  processPendingGameRemovals,
  savePersistentDownloadQueue,
  loadPersistentDownloadQueue,
  promoteQueuedSync,
  runGameSync,
  setActiveOperationGameIdForTesting,
} = require("../../electron/main.cjs")

describe("Electron Main Game Removal Safety Suite", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-removal-test-"))
    activeAppDataDir = path.join(tempDir, "appdata")
    activeUserDataDir = path.join(tempDir, "userdata")
    await fsp.mkdir(activeAppDataDir, { recursive: true })
    await fsp.mkdir(activeUserDataDir, { recursive: true })
    resetDownloadQueueForTesting()
    lastSentEvents.length = 0
  })

  afterEach(async () => {
    resetDownloadQueueForTesting()
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  it("1. Servidor eliminado sin operación: carpeta borrada inmediatamente", async () => {
    const ctx = resolveGameContext({ gameId: "server-1", gameName: "Server Alpha" })
    await fsp.mkdir(ctx.instanceRoot, { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "version.json"), '{"version":"1.0"}', "utf8")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    const uninstallHandler = ipcHandlers.get("game-uninstall")
    expect(uninstallHandler).toBeDefined()

    const res = await uninstallHandler!({}, { gameId: "server-1", gameName: "Server Alpha" })
    expect(res).toEqual({ success: true })

    // Instancia borrada completamente
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    // Ya no queda pendiente
    expect(getPendingGameRemovals().has("server-1")).toBe(false)
  })

  it("2. Servidor eliminado durante descarga: operación cancelada genéricamente y carpeta borrada", async () => {
    const ctx = resolveGameContext({ gameId: "server-2", gameName: "Server Beta" })
    await fsp.mkdir(ctx.instanceRoot, { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "mods.jar"), "dummy mod", "utf8")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    // Simular operación activa de descarga
    setActiveOperationGameIdForTesting("server-2")
    operationManager.state = "SYNCING"
    const abortController = new AbortController()
    operationManager.activeAbortController = abortController
    operationManager.activeCancelSignal = { id: 1, isCancelled: false, isPaused: false }
    operationManager.activeSyncPromise = new Promise((resolve) => setTimeout(resolve, 50))

    const uninstallHandler = ipcHandlers.get("game-uninstall")
    const res = await uninstallHandler!({}, { gameId: "server-2", gameName: "Server Beta" })
    expect(res).toEqual({ success: true })

    // Operación fue cancelada
    expect(abortController.signal.aborted).toBe(true)
    expect(operationManager.getState()).toBe("IDLE")
    // Carpeta finalmente borrada
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    expect(getPendingGameRemovals().has("server-2")).toBe(false)
  })

  it("3. Servidor eliminado durante instalación: operación detenida y carpeta finalmente borrada", async () => {
    const ctx = resolveGameContext({ gameId: "server-3", gameName: "Server Gamma" })
    await fsp.mkdir(ctx.instanceRoot, { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "assets.dat"), "test assets", "utf8")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    // Simular operación en estado INSTALLING
    setActiveOperationGameIdForTesting("server-3")
    operationManager.state = "INSTALLING"
    const abortController = new AbortController()
    operationManager.activeAbortController = abortController
    operationManager.activeCancelSignal = { id: 2, isCancelled: false, isPaused: false }
    operationManager.activeSyncPromise = new Promise((resolve) => setTimeout(resolve, 50))

    const uninstallHandler = ipcHandlers.get("game-uninstall")
    const res = await uninstallHandler!({}, { gameId: "server-3", gameName: "Server Gamma" })
    expect(res).toEqual({ success: true })

    expect(abortController.signal.aborted).toBe(true)
    expect(operationManager.getState()).toBe("IDLE")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    expect(getPendingGameRemovals().has("server-3")).toBe(false)
  })

  it("4. Servidor eliminado estando en downloadQueue: desaparece de la cola y carpeta borrada", async () => {
    const ctx = resolveGameContext({ gameId: "server-4", gameName: "Server Delta" })
    await fsp.mkdir(ctx.instanceRoot, { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "config.json"), "{}", "utf8")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    // Meter server-4 en downloadQueue
    const queue = getDownloadQueue()
    queue.push({
      gameId: "server-4",
      gameName: "Server Delta",
      payload: { gameId: "server-4", gameName: "Server Delta" },
    })
    expect(getDownloadQueue().some((q: any) => q.gameId === "server-4")).toBe(true)

    const uninstallHandler = ipcHandlers.get("game-uninstall")
    const res = await uninstallHandler!({}, { gameId: "server-4", gameName: "Server Delta" })
    expect(res).toEqual({ success: true })

    // Desaparece de downloadQueue
    expect(getDownloadQueue().some((q: any) => q.gameId === "server-4")).toBe(false)
    // Carpeta borrada
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    expect(getPendingGameRemovals().has("server-4")).toBe(false)
  })

  it("5. Servidor eliminado y Minecraft abierto: carpeta permanece mientras corre y al pasar a idle se borra", async () => {
    const ctx = resolveGameContext({ gameId: "server-5", gameName: "Server Epsilon" })
    await fsp.mkdir(ctx.instanceRoot, { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "game.jar"), "mc content", "utf8")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    // Simular que Minecraft de server-5 está ejecutándose
    gameLauncher.runningGameId = "server-5"
    gameLauncher.setStatus("running")

    const uninstallHandler = ipcHandlers.get("game-uninstall")
    const res = await uninstallHandler!({}, { gameId: "server-5", gameName: "Server Epsilon" })
    expect(res).toEqual({ success: true })

    // La carpeta NO se borra todavía porque Minecraft está abierto
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)
    expect(getPendingGameRemovals().has("server-5")).toBe(true)

    // El jugador cierra Minecraft: status pasa a idle
    gameLauncher.runningGameId = null
    gameLauncher.setStatus("idle")
    gameLauncher.onStatusChangeCallback("idle", { gameId: "server-5" })

    // Esperar a que processPendingGameRemovals termine
    await new Promise((r) => setTimeout(r, 100))

    // Al pasar a idle, la carpeta se borra automáticamente
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    expect(getPendingGameRemovals().has("server-5")).toBe(false)
  })

  it("6. Servidor eliminado y Launcher reiniciado: pendingRemovals se restaura y carpeta se borra al iniciar si Minecraft no está activo", async () => {
    const ctx = resolveGameContext({ gameId: "server-6", gameName: "Server Zeta" })
    await fsp.mkdir(ctx.instanceRoot, { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "options.txt"), "difficulty=2", "utf8")
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    // 1. Simular archivo persistente previo con server-6 en pendingRemovals
    const queueFile = path.join(activeUserDataDir, "download-queue.json")
    const persistedState = {
      active: null,
      queue: [],
      pendingRemovals: [
        {
          gameId: "server-6",
          gameName: "Server Zeta",
        },
      ],
    }
    await fsp.writeFile(queueFile, JSON.stringify(persistedState, null, 2), "utf8")

    // 2. Al arrancar el Launcher, se restaura el estado persistente
    loadPersistentDownloadQueue()
    expect(getPendingGameRemovals().has("server-6")).toBe(true)
    // Antes de que Electron complete la inicialización, la carpeta todavía existe
    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)

    // 3. Al completar la inicialización de Electron (app.whenReady), se ejecuta automáticamente el procesamiento inicial
    expect(whenReadyCallbacks.length).toBeGreaterThan(0)
    await whenReadyCallbacks[0]()
    // Esperar a que el proceso termine
    await new Promise((r) => setTimeout(r, 100))

    // 4. Carpeta borrada y removido de pendientes sin haber llamado manualmente a processPendingGameRemovals()
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    expect(getPendingGameRemovals().has("server-6")).toBe(false)

    // 5. El archivo de persistencia queda actualizado
    const freshRaw = await fsp.readFile(queueFile, "utf8")
    const freshParsed = JSON.parse(freshRaw)
    expect(freshParsed.pendingRemovals).toEqual([])
  })

  it("7. Si un juego está en pendingGameRemovals, runGameSync() no inicia la operación y devuelve estado cancelado", async () => {
    getPendingGameRemovals().set("server-cancel-barrier", {
      gameId: "server-cancel-barrier",
      gameName: "Barrier Test",
    })

    const ctx = resolveGameContext({ gameId: "server-cancel-barrier", gameName: "Barrier Test" })
    const startSyncSpy = vi.spyOn(operationManager, "startSync")

    const res = await runGameSync(ctx, { gameId: "server-cancel-barrier", gameName: "Barrier Test" })

    expect(res).toEqual({ success: false, cancelled: true })
    expect(startSyncSpy).not.toHaveBeenCalled()
    expect(operationManager.getState()).toBe("IDLE")
  })

  it("8. Si un juego está en pendingGameRemovals, game-launch falla antes de intentar iniciar Minecraft", async () => {
    getPendingGameRemovals().set("server-launch-blocked", {
      gameId: "server-launch-blocked",
      gameName: "Launch Blocked",
    })

    const launchSpy = vi.spyOn(operationManager, "launchGame")
    const launchHandler = ipcHandlers.get("game-launch")
    expect(launchHandler).toBeDefined()

    await expect(
      launchHandler!({}, { gameId: "server-launch-blocked", gameName: "Launch Blocked" })
    ).rejects.toThrow("Cannot launch game: game is marked for removal.")

    expect(launchSpy).not.toHaveBeenCalled()
  })

  it("9. Un juego con pendingRemoval nunca debe volver a iniciar una descarga/sync ni ser promovido", async () => {
    getPendingGameRemovals().set("server-7", {
      gameId: "server-7",
      gameName: "Server Locked",
    })

    const startSyncHandler = ipcHandlers.get("game-start-sync")
    expect(startSyncHandler).toBeDefined()

    // Intentar iniciar sync debe ser rechazado
    await expect(
      startSyncHandler!({}, { gameId: "server-7", gameName: "Server Locked" })
    ).rejects.toThrow(/marked for removal/)

    // Intentar promover debe ser rechazado
    const promoteRes = await promoteQueuedSync({ gameId: "server-7" })
    expect(promoteRes.success).toBe(false)
    expect(promoteRes.error).toMatch(/marked for removal/)
  })

  it("10. Instalación parcial o fallida con archivos incompletos: carpeta se elimina completamente sin requerir manifest válido", async () => {
    const ctx = resolveGameContext({ gameId: "server-partial", gameName: "Partial Server" })
    // Crear carpeta con archivos incompletos / parciales y sin manifest válido
    await fsp.mkdir(path.join(ctx.instanceRoot, "mods"), { recursive: true })
    await fsp.mkdir(path.join(ctx.instanceRoot, "staging"), { recursive: true })
    await fsp.writeFile(path.join(ctx.instanceRoot, "mods", "incomplete.jar.part"), "half-downloaded-bytes", "utf8")
    await fsp.writeFile(path.join(ctx.instanceRoot, "staging", "download.tmp"), "temp-data", "utf8")
    await fsp.writeFile(path.join(ctx.instanceRoot, "options.txt"), "difficulty=1", "utf8")

    expect(fs.existsSync(ctx.instanceRoot)).toBe(true)
    expect(fs.existsSync(path.join(ctx.instanceRoot, "mods", "incomplete.jar.part"))).toBe(true)

    // Servidor eliminado en backend -> se llama a game-uninstall
    const uninstallHandler = ipcHandlers.get("game-uninstall")
    expect(uninstallHandler).toBeDefined()
    const res = await uninstallHandler!({}, { gameId: "server-partial", gameName: "Partial Server" })
    expect(res).toEqual({ success: true })

    // Procesa remociones pendientes
    await new Promise((r) => setTimeout(r, 100))

    // La carpeta queda completamente eliminada a pesar de no tener manifest ni ser instalación completa
    expect(fs.existsSync(ctx.instanceRoot)).toBe(false)
    expect(getPendingGameRemovals().has("server-partial")).toBe(false)
  })
})

