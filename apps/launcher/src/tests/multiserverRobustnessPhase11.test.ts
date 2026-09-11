import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import http from "http"
import crypto from "crypto"
import { gameService } from "../services/gameService"
import {
  GameOperationManager,
  validateSyncPayload,
  // @ts-expect-error CJS module without declaration
} from "../../electron/game-operation-manager.cjs"
import {
  saveInstalledManifest,
  loadInstalledManifest,
  saveDownloadSession,
  loadDownloadSession,
  cleanStaging,
  cleanFreshInstall,
  applyStagingToInstance,
  getStagingPaths,
  getDeterministicStagingFileName,
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
    createFromPath: () => ({}),
  },
  shell: {
    openExternal: vi.fn(),
  },
  Tray: vi.fn().mockImplementation(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    isDestroyed: () => false,
    destroy: vi.fn(),
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
const mainExports = require("../../electron/main.cjs") as any

function computeSha(content: Buffer | string): string {
  return crypto
    .createHash("sha256")
    .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
    .digest("hex")
    .toLowerCase()
}

describe("HiKAT Phase 11 Real Core Operations & Concurrency Suite (Items 1-14, 18-19)", () => {
  let tempDir: string
  let instanceRootA: string
  let instanceRootB: string
  let userDataDir: string
  let server: http.Server
  let serverPort: number
  let serverBaseUrl: string
  let requestedRanges: string[] = []

  let fileStore = new Map<string, Buffer>()
  let urlDelays = new Map<string, number>()

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-p11-core-"))
    userDataDir = path.join(tempDir, "userData")
    activeAppDataDir = tempDir
    activeUserDataDir = userDataDir

    const gamesDir = path.join(tempDir, "HiKAT", "games")
    instanceRootA = path.join(gamesDir, "Server Alpha")
    instanceRootB = path.join(gamesDir, "Server Beta")
    const instanceRootC = path.join(gamesDir, "Server Gamma")

    await fsp.mkdir(instanceRootA, { recursive: true })
    await fsp.mkdir(instanceRootB, { recursive: true })
    await fsp.mkdir(instanceRootC, { recursive: true })
    await fsp.mkdir(userDataDir, { recursive: true })

    mainExports.resetDownloadQueueForTesting()
    lastSentEvents.length = 0
    const mockWin = new (electronMock.BrowserWindow as any)()
    mainExports.setMainWindowForTesting(mockWin)

    requestedRanges = []
    fileStore = new Map<string, Buffer>()
    urlDelays = new Map<string, number>()

    server = http.createServer((req, res) => {
      const url = req.url || ""
      const rangeHeader = req.headers["range"]
      if (rangeHeader) {
        requestedRanges.push(rangeHeader)
      }

      const content = fileStore.get(url) || Buffer.alloc(1000, "X")
      const delayMs = urlDelays.get(url) || 0

      const sendResponse = () => {
        if (res.writableEnded || res.destroyed) return
        if (rangeHeader && rangeHeader.startsWith("bytes=")) {
          const parts = rangeHeader.replace("bytes=", "").split("-")
          const start = parseInt(parts[0], 10) || 0
          const end = parts[1] ? parseInt(parts[1], 10) : content.length - 1
          const slice = content.subarray(start, end + 1)
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${content.length}`,
            "Accept-Ranges": "bytes",
            "Content-Length": slice.length,
            "Content-Type": "application/octet-stream",
          })
          res.end(slice)
          return
        }

        res.writeHead(200, {
          "Content-Length": content.length,
          "Accept-Ranges": "bytes",
          "Content-Type": "application/octet-stream",
        })
        res.end(content)
      }

      if (delayMs > 0) {
        const timer = setTimeout(sendResponse, delayMs)
        req.on("close", () => clearTimeout(timer))
      } else {
        sendResponse()
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any
        serverPort = addr.port
        serverBaseUrl = `http://127.0.0.1:${serverPort}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    mainExports.resetDownloadQueueForTesting()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    vi.restoreAllMocks()
  })

  // 1. Descarga -> pause -> resume usando staging/Range
  it("1. Descarga -> pause -> resume usando staging y HTTP Range", async () => {
    const fullContent = Buffer.alloc(1000, "X")
    const hash = computeSha(fullContent)
    fileStore.set("/file/item.jar", fullContent)

    const sampleFile = {
      path: "mods/item.jar",
      sha256: hash,
      sizeBytes: 1000,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/item.jar`,
    }

    const { filesDir } = getStagingPaths(instanceRootA)
    await fsp.mkdir(filesDir, { recursive: true })

    const stagingFileName = getDeterministicStagingFileName(sampleFile)
    const stagingFilePath = path.join(filesDir, stagingFileName)
    await fsp.writeFile(stagingFilePath, fullContent.subarray(0, 400))

    await saveDownloadSession(instanceRootA, {
      modpackVersion: "1.0.0",
      status: "PAUSED",
      phase: "DOWNLOADING",
      progress: 40,
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    const result = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [sampleFile],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    expect(result.success).toBe(true)
    expect(requestedRanges.some((r) => r.includes("bytes=400-"))).toBe(true)

    const finalFile = path.join(instanceRootA, "mods", "item.jar")
    const stat = await fsp.stat(finalFile)
    expect(stat.size).toBe(1000)
  })

  // 2. Descarga -> cancel -> instalación anterior intacta
  it("2. Descarga -> cancel -> instalación anterior intacta", async () => {
    await fsp.mkdir(path.join(instanceRootA, "mods"), { recursive: true })
    await fsp.writeFile(path.join(instanceRootA, "mods", "stable.jar"), "stable-1.0")
    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.0.0",
      clientFiles: [{ path: "mods/stable.jar", sha256: computeSha("stable-1.0"), sizeBytes: 10, policy: "NO_MODIFICABLE" }],
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    let pauseTriggered = false
    const progressListener = (data: any) => {
      if (data?.phase === "DOWNLOADING" && !pauseTriggered) {
        pauseTriggered = true
        manager.cancelSync(instanceRootA).catch(() => {})
      }
    }

    const cancelPromise = manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/new.jar",
        sha256: computeSha("new-2.0"),
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/new.jar`,
      }],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      onProgress: progressListener,
    }).catch((e: any) => e)

    await cancelPromise

    const manifest = await loadInstalledManifest(instanceRootA)
    expect(manifest?.modpackVersion).toBe("1.0.0")
    const stableContent = await fsp.readFile(path.join(instanceRootA, "mods", "stable.jar"), "utf8")
    expect(stableContent).toBe("stable-1.0")

    const { stagingDir } = getStagingPaths(instanceRootA)
    const stagingExists = fs.existsSync(stagingDir)
    if (stagingExists) {
      const files = await fsp.readdir(stagingDir)
      expect(files.length).toBe(0)
    }
  })

  // 3. Update con Core ya instalado -> Cancel antes de commit deja versión anterior intacta
  it("3. Update con Core ya instalado -> Cancel antes de commit deja versión anterior intacta", async () => {
    fileStore.set("/file/v13.jar", Buffer.from("v13-content", "utf8"))
    await fsp.mkdir(path.join(instanceRootA, "mods"), { recursive: true })
    await fsp.writeFile(path.join(instanceRootA, "mods", "v12.jar"), "v12-content")
    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.2.0",
      clientFiles: [{ path: "mods/v12.jar", sha256: computeSha("v12-content"), sizeBytes: 11, policy: "NO_MODIFICABLE" }],
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    let cancelTriggered = false
    const progressListener = (data: any) => {
      if (data?.phase === "DOWNLOADING" && !cancelTriggered) {
        cancelTriggered = true
        manager.cancelSync(instanceRootA).catch(() => {})
      }
    }

    const cancelPromise = manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/v13.jar",
        sha256: computeSha("v13-content"),
        sizeBytes: 11,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/v13.jar`,
      }],
      modpackVersion: "1.3.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      onProgress: progressListener,
    }).catch((e: any) => e)

    await cancelPromise

    expect(manager.getState()).toBe("IDLE")

    const manifest = await loadInstalledManifest(instanceRootA)
    expect(manifest?.modpackVersion).toBe("1.2.0")
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v12.jar"))).toBe(true)
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v13.jar"))).toBe(false)
  })

  // 4. Update que necesita Core/Loader -> una vez comienzan escrituras reales queda no cancelable y termina consistente
  it("4. Update que necesita Core/Loader -> una vez comienzan escrituras reales queda no cancelable y termina consistente", async () => {
    fileStore.set("/file/v13.jar", Buffer.from("v13-content", "utf8"))
    await fsp.mkdir(path.join(instanceRootA, "mods"), { recursive: true })
    await fsp.writeFile(path.join(instanceRootA, "mods", "v12.jar"), "v12-content")
    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.2.0",
      clientFiles: [{ path: "mods/v12.jar", sha256: computeSha("v12-content"), sizeBytes: 11, policy: "NO_MODIFICABLE" }],
    })

    let verifiedNonCancellable = false

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: false }),
      coreInstaller: async () => {
        verifiedNonCancellable = true
        expect(manager.isCommitting).toBe(true)
        await expect(manager.pauseSync()).rejects.toThrow("Cannot pause")
        await expect(manager.cancelSync(instanceRootA)).rejects.toThrow("Cannot cancel")
        return { success: true }
      },
    })

    const res = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/v13.jar",
        sha256: computeSha("v13-content"),
        sizeBytes: 11,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/v13.jar`,
      }],
      modpackVersion: "1.3.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    expect(res.success).toBe(true)
    expect(verifiedNonCancellable).toBe(true)
    expect(manager.getState()).toBe("IDLE")

    const manifest = await loadInstalledManifest(instanceRootA)
    expect(manifest?.modpackVersion).toBe("1.3.0")
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v13.jar"))).toBe(true)
  })

  // 4b. DOWNLOADING 100 -> INSTALLING progreso real menor de 100 en GameOperationManager real
  it("4b. DOWNLOADING 100 -> INSTALLING progreso real menor de 100 en GameOperationManager real", async () => {
    const fullContent = Buffer.alloc(500, "X")
    const hash = computeSha(fullContent)
    fileStore.set("/file/item.jar", fullContent)

    const recordedProgress: { phase: string; progress: number }[] = []

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: false }),
      coreInstaller: async ({ onProgress }: any) => {
        onProgress?.({ progress: 10 })
        return { success: true }
      },
    })

    const res = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/item.jar",
        sha256: hash,
        sizeBytes: 500,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/item.jar`,
      }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      onProgress: (p: any) => {
        if (p?.phase && typeof p?.progress === "number") {
          recordedProgress.push({ phase: p.phase, progress: p.progress })
        }
      },
    })

    expect(res.success).toBe(true)

    // DOWNLOADING reached 100
    const downloadEntries = recordedProgress.filter((p) => p.phase === "DOWNLOADING")
    expect(downloadEntries.some((p) => p.progress === 100)).toBe(true)

    // First INSTALLING entry must be strictly < 100 (monotonicity reset per phase)
    const firstInstalling = recordedProgress.find((p) => p.phase === "INSTALLING")
    expect(firstInstalling).toBeDefined()
    expect(firstInstalling!.progress).toBeLessThan(100)
    expect(firstInstalling!.progress).toBe(30)
  })

  // 5. Resume de INSTALLING termina correctamente en 1.3
  it("5. Resume de INSTALLING termina correctamente en 1.3", async () => {
    const fullContent = Buffer.alloc(1000, "X")
    const hash = computeSha(fullContent)

    const { stagingDir } = getStagingPaths(instanceRootA)
    await fsp.mkdir(stagingDir, { recursive: true })
    const stagingFilePath = path.join(stagingDir, "mods", "v13.jar")
    await fsp.mkdir(path.dirname(stagingFilePath), { recursive: true })
    await fsp.writeFile(stagingFilePath, fullContent)

    await saveDownloadSession(instanceRootA, {
      modpackVersion: "1.3.0",
      status: "PAUSED",
      phase: "INSTALLING",
      progress: 60,
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    const res = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/v13.jar",
        sha256: hash,
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/v13.jar`,
      }],
      modpackVersion: "1.3.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    expect(res.success).toBe(true)
    expect(manager.getState()).toBe("IDLE")

    const manifest = await loadInstalledManifest(instanceRootA)
    expect(manifest?.modpackVersion).toBe("1.3.0")
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v13.jar"))).toBe(true)
  })

  // 6. Durante commit final canPause=false y canCancel=false
  it("6. Durante commit final canPause=false y canCancel=false y no se interrumpe", async () => {
    const fullContent = Buffer.alloc(1000, "X")
    const hash = computeSha(fullContent)

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    let checkedCommitFlags = false
    const progressListener = async () => {
      if (manager.isCommitting && !checkedCommitFlags) {
        checkedCommitFlags = true
        await expect(manager.pauseSync()).rejects.toThrow("Cannot pause synchronization while finalizing installation.")
        await expect(manager.cancelSync(instanceRootA)).rejects.toThrow("Cannot cancel while finalizing installation.")
      }
    }

    const res = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/v13.jar",
        sha256: hash,
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/v13.jar`,
      }],
      modpackVersion: "1.3.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      onProgress: progressListener,
    })

    expect(res.success).toBe(true)
    expect(checkedCommitFlags).toBe(true)
  })

  // 7. Commit exitoso cambia manifest a 1.3 solamente al final
  it("7. Commit exitoso cambia manifest a 1.3 solamente al final", async () => {
    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.2.0",
      clientFiles: [],
    })

    const fullContent = Buffer.alloc(1000, "X")
    const hash = computeSha(fullContent)

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    let checkedDuringDownload = false
    const progressListener = async (data: any) => {
      if (data?.phase === "DOWNLOADING" && !checkedDuringDownload) {
        checkedDuringDownload = true
        const manifest = await loadInstalledManifest(instanceRootA)
        expect(manifest?.modpackVersion).toBe("1.2.0")
      }
    }

    const res = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/v13.jar",
        sha256: hash,
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/v13.jar`,
      }],
      modpackVersion: "1.3.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      onProgress: progressListener,
    })

    expect(res.success).toBe(true)
    const finalManifest = await loadInstalledManifest(instanceRootA)
    expect(finalManifest?.modpackVersion).toBe("1.3.0")
  })

  // 8-11. FIFO Queue: Orden secuencial, avance determinista usando lógica productiva de main.cjs
  it("8-11. FIFO Queue: Orden secuencial A -> B -> C, cancel A inicia B, cancel B mueve C a primero usando main.cjs real", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!
    const cancelHandler = ipcHandlers.get("game-cancel-sync")!
    const getQueueHandler = ipcHandlers.get("game-get-download-queue")!

    fileStore.set("/file/fileA.jar", Buffer.from("data-a"))
    fileStore.set("/file/fileB.jar", Buffer.from("data-b"))
    fileStore.set("/file/fileC.jar", Buffer.from("data-c"))
    urlDelays.set("/file/fileA.jar", 800)
    urlDelays.set("/file/fileC.jar", 800)

    const sampleFileA = [{
      path: "mods/fileA.jar",
      sha256: computeSha("data-a"),
      sizeBytes: 6,
      policy: "NO_MODIFICABLE" as const,
      downloadUrl: `${serverBaseUrl}/file/fileA.jar`,
    }]
    const sampleFileB = [{
      path: "mods/fileB.jar",
      sha256: computeSha("data-b"),
      sizeBytes: 6,
      policy: "NO_MODIFICABLE" as const,
      downloadUrl: `${serverBaseUrl}/file/fileB.jar`,
    }]
    const sampleFileC = [{
      path: "mods/fileC.jar",
      sha256: computeSha("data-c"),
      sizeBytes: 6,
      policy: "NO_MODIFICABLE" as const,
      downloadUrl: `${serverBaseUrl}/file/fileC.jar`,
    }]

    // 1. Iniciar A (permanece activo)
    const syncAPromise = startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFileA,
    }).catch((e: any) => e)

    await new Promise((r) => setTimeout(r, 40))

    // 2. Encolar B y C
    const resB = await startHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      instanceRoot: instanceRootB,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFileB,
    })
    expect(resB.queued).toBe(true)
    expect(resB.position).toBe(1)

    const resC = await startHandler({}, {
      gameId: "server-c",
      gameName: "Server Gamma",
      instanceRoot: path.join(tempDir, "HiKAT", "games", "Server Gamma"),
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFileC,
    })
    expect(resC.queued).toBe(true)
    expect(resC.position).toBe(2)

    // Snapshot real: A activo, B #1, C #2
    let snap = await getQueueHandler()
    expect(snap.active?.gameId).toBe("server-a")
    expect(snap.queued.map((q: any) => q.gameId)).toEqual(["server-b", "server-c"])

    // Mismo gameId enqueued actualiza payload sin duplicar
    const resBDup = await startHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta Updated",
      instanceRoot: instanceRootB,
      modpackVersion: "1.0.1",
      clientFiles: sampleFileB,
    })
    expect(resBDup.queued).toBe(true)
    expect(resBDup.position).toBe(1)
    snap = await getQueueHandler()
    expect(snap.queued.length).toBe(2)
    expect(snap.queued[0].gameName).toBe("Server Beta Updated")

    // Cancelar B encolado -> C pasa a posición 1
    const cancelBRes = await cancelHandler({}, { gameId: "server-b", gameName: "Server Beta" })
    expect(cancelBRes.queuedRemoved).toBe(true)
    snap = await getQueueHandler()
    expect(snap.active?.gameId).toBe("server-a")
    expect(snap.queued.map((q: any) => q.gameId)).toEqual(["server-c"])
    expect(snap.queued[0].position).toBe(1)

    // Cancelar A -> C inicia automáticamente (exactamente una vez)
    await cancelHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    await syncAPromise
    await new Promise((r) => setTimeout(r, 60))

    snap = await getQueueHandler()
    expect(snap.active?.gameId).toBe("server-c")
    expect(snap.queued.length).toBe(0)

    // Cancelar C para limpiar
    await cancelHandler({}, { gameId: "server-c", gameName: "Server Gamma" })
    await new Promise((r) => setTimeout(r, 40))
  })

  // 12. Cierre/reinicio restaura A/B/C y su orden
  it("12. Persistencia y reinicio de cola en download-queue.json usando la lógica productiva de main.cjs", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!
    const getQueueHandler = ipcHandlers.get("game-get-download-queue")!
    const cancelHandler = ipcHandlers.get("game-cancel-sync")!

    fileStore.set("/file/fileP.jar", Buffer.from("persist-data"))

    const sampleFiles = [{
      path: "mods/fileP.jar",
      sha256: computeSha("persist-data"),
      sizeBytes: 12,
      policy: "NO_MODIFICABLE" as const,
      downloadUrl: `${serverBaseUrl}/file/fileP.jar`,
    }]

    // 1. Iniciar activo A y encolar B y C
    const syncPromiseA = startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    }).catch((e: any) => e)

    await new Promise((r) => setTimeout(r, 30))

    await startHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      instanceRoot: instanceRootB,
      modpackVersion: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    })

    await startHandler({}, {
      gameId: "server-c",
      gameName: "Server Gamma",
      instanceRoot: path.join(tempDir, "HiKAT", "games", "Server Gamma"),
      modpackVersion: "3.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: sampleFiles,
    })

    // savePersistentDownloadQueue se llama automáticamente en main.cjs, comprobamos el archivo real
    const queueFilePath = path.join(userDataDir, "download-queue.json")
    expect(fs.existsSync(queueFilePath)).toBe(true)

    // Simulamos reinicio: reset in-memory queue
    mainExports.resetDownloadQueueForTesting()
    const snapAfterReset = await getQueueHandler()
    expect(snapAfterReset.active).toBeNull()
    expect(snapAfterReset.queued.length).toBe(0)

    // Ejecutamos loadPersistentDownloadQueue productivo
    mainExports.loadPersistentDownloadQueue()

    const restoredSnap = await getQueueHandler()
    // La operación activa previa y la cola se restauran en orden FIFO
    expect(restoredSnap.queued.length).toBe(3)
    expect(restoredSnap.queued[0].gameId).toBe("server-a")
    expect(restoredSnap.queued[1].gameId).toBe("server-b")
    expect(restoredSnap.queued[2].gameId).toBe("server-c")

    // Limpieza
    try {
      await mainExports.operationManager?.cancelSync()
    } catch (_) {}
    await cancelHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    await syncPromiseA
  })

  // 12b. Un queued que pasa a activo y falla emite game-phase-changed ERROR y no desaparece silenciosamente
  it("12b. Un queued que pasa a activo y falla emite game-phase-changed ERROR y no desaparece silenciosamente", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!
    const cancelHandler = ipcHandlers.get("game-cancel-sync")!

    fileStore.set("/file/fileOk.jar", Buffer.from("ok-data"))
    urlDelays.set("/file/fileOk.jar", 800)

    // Iniciar A
    const syncPromiseA = startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [{
        path: "mods/fileOk.jar",
        sha256: computeSha("ok-data"),
        sizeBytes: 7,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/fileOk.jar`,
      }],
    }).catch((e: any) => e)

    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 80))

    // Encolar B con URL que fallará con error
    await startHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      instanceRoot: instanceRootB,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [{
        path: "mods/fail.jar",
        sha256: "invalidsha",
        sizeBytes: 100,
        policy: "NO_MODIFICABLE",
        downloadUrl: "http://127.0.0.1:1/nonexistent.jar",
      }],
    })

    // Cancelar A -> B pasa a activo y fallará
    lastSentEvents.length = 0
    await cancelHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    await syncPromiseA

    await new Promise((r) => setTimeout(r, 100))

    // Comprobar que se emitió "game-phase-changed" con "ERROR" para server-b
    const errorEvent = lastSentEvents.find(
      (e) => e.channel === "game-phase-changed" && e.args[0] === "ERROR" && e.args[1] === "server-b"
    )
    expect(errorEvent).toBeDefined()
  })

  // 13. La operación restaurada reutiliza staging existente
  it("13. La operación restaurada reutiliza staging existente sin reiniciar desde cero", async () => {
    const fullContent = Buffer.alloc(1000, "X")
    const hash = computeSha(fullContent)
    fileStore.set("/file/item.jar", fullContent)

    const sampleFile = {
      path: "mods/item.jar",
      sha256: hash,
      sizeBytes: 1000,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/item.jar`,
    }

    const { filesDir } = getStagingPaths(instanceRootA)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFileName = getDeterministicStagingFileName(sampleFile)
    const stagingFilePath = path.join(filesDir, stagingFileName)
    await fsp.writeFile(stagingFilePath, fullContent.subarray(0, 600))

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    const result = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [sampleFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    expect(result.success).toBe(true)
    expect(requestedRanges.some((r) => r.includes("bytes=600-"))).toBe(true)
  })

  // 14. Dos servidores distintos usan exclusivamente su propio contexto/instanceRoot
  it("14. Dos servidores distintos usan exclusivamente su propio contexto/instanceRoot", async () => {
    const contentA = Buffer.alloc(500, "A")
    const contentB = Buffer.alloc(500, "B")
    fileStore.set("/file/fileA.jar", contentA)
    fileStore.set("/file/fileB.jar", contentB)

    const managerA = new GameOperationManager({ coreChecker: async () => ({ installed: true }) })
    const managerB = new GameOperationManager({ coreChecker: async () => ({ installed: true }) })

    await managerA.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/fileA.jar",
        sha256: computeSha(contentA),
        sizeBytes: 500,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/fileA.jar`,
      }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    await managerB.startSync({
      instanceRoot: instanceRootB,
      clientFiles: [{
        path: "mods/fileB.jar",
        sha256: computeSha(contentB),
        sizeBytes: 500,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/fileB.jar`,
      }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    expect(fs.existsSync(path.join(instanceRootA, "mods", "fileA.jar"))).toBe(true)
    expect(fs.existsSync(path.join(instanceRootA, "mods", "fileB.jar"))).toBe(false)

    expect(fs.existsSync(path.join(instanceRootB, "mods", "fileB.jar"))).toBe(true)
    expect(fs.existsSync(path.join(instanceRootB, "mods", "fileA.jar"))).toBe(false)
  })

  // 18. Verify y Uninstall mantienen integridad y funcionalidad completa
  it("18. Verify y Uninstall mantienen integridad y funcionalidad completa", async () => {
    fileStore.set("/file/mod.jar", Buffer.from("original-content", "utf8"))
    const sampleFile = path.join(instanceRootA, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "original-content")
    const hash = computeSha("original-content")

    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.0.0",
      clientFiles: [{ path: "mods/mod.jar", sha256: hash, sizeBytes: 16, policy: "NO_MODIFICABLE" }],
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true }),
    })

    // Corrupt file
    await fsp.writeFile(sampleFile, "corrupted-content")

    const verifyRes = await manager.startSync({
      instanceRoot: instanceRootA,
      clientFiles: [{
        path: "mods/mod.jar",
        sha256: hash,
        sizeBytes: 16,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/mod.jar`,
      }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      isVerify: true,
    })

    expect(verifyRes.success).toBe(true)

    const uninstallRes = await manager.uninstallGame(instanceRootA, tempDir)
    expect(uninstallRes.success).toBe(true)
    expect(fs.existsSync(sampleFile)).toBe(false)
  })

  // 19. Un WebSocket viejo no puede destruir/cerrar el nuevo socket singleton
  it("19. Un WebSocket viejo no puede destruir ni cerrar el nuevo socket singleton", async () => {
    let oldSocketCloseHandler: any = null
    let oldSocketErrorHandler: any = null

    const oldMockSocket = {
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === "close") oldSocketCloseHandler = handler
        if (event === "error") oldSocketErrorHandler = handler
      }),
      removeEventListener: vi.fn(),
    }

    const newMockSocket = {
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    ;(globalThis as any).WebSocket = vi.fn().mockImplementation(() => oldMockSocket)
    const unsub1 = gameService.subscribeReleaseEvents(() => {})

    ;(globalThis as any).WebSocket = vi.fn().mockImplementation(() => newMockSocket)
    const unsub2 = gameService.subscribeReleaseEvents(() => {})

    if (oldSocketCloseHandler) {
      oldSocketCloseHandler({ wasClean: false, code: 1006 })
    }
    if (oldSocketErrorHandler) {
      oldSocketErrorHandler(new Error("Old socket error"))
    }

    expect(newMockSocket.close).not.toHaveBeenCalled()

    unsub1()
    unsub2()
  })

  // 20. gameService.resumeSync() no envía clientFiles ni versiones dummy
  it("20. gameService.resumeSync() no envía clientFiles ni versiones dummy", async () => {
    const mockStartSync = vi.fn().mockResolvedValue({ success: true })
    ;(globalThis as any).window = {
      electronAPI: {
        startSync: mockStartSync,
      },
    }

    await gameService.resumeSync({ gameId: "server-a", gameName: "Server Alpha" })

    expect(mockStartSync).toHaveBeenCalledTimes(1)
    const callArg = mockStartSync.mock.calls[0][0]
    expect(callArg).toEqual({
      gameId: "server-a",
      gameName: "Server Alpha",
      resume: true,
    })
    expect(callArg.clientFiles).toBeUndefined()
    expect(callArg.modpackVersion).toBeUndefined()
    expect(callArg.minecraftVersion).toBeUndefined()
  })

  // 21. Main mantiene visualmente el progreso al reanudar (progress floor) sin cruzar cambios de fase
  it("21. Main mantiene visualmente el progreso al reanudar sin cruzar cambios de fase y actualiza con múltiples pausas", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!
    const pauseHandler = ipcHandlers.get("game-pause-sync")!

    let capturedOnProgress: any = null
    let capturedOnPhaseChange: any = null
    let resolveSyncPromise: any = null

    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (opts: any) => {
      capturedOnProgress = opts.onProgress
      capturedOnPhaseChange = opts.onPhaseChange
      mainExports.operationManager.state = "INSTALLING"
      mainExports.operationManager.lastPayload = opts
      return new Promise((r) => {
        resolveSyncPromise = r
      })
    })
    vi.spyOn(mainExports.operationManager, "pauseSync").mockImplementation(async () => {
      mainExports.operationManager.state = "PAUSED"
      mainExports.operationManager.lastPausedPhase = "INSTALLING"
      if (capturedOnPhaseChange) capturedOnPhaseChange("PAUSED", "INSTALLING")
      return { success: true, paused: true, state: "PAUSED" }
    })
    vi.spyOn(mainExports.operationManager, "resumeSync").mockImplementation(async () => {
      mainExports.operationManager.state = "INSTALLING"
      if (capturedOnPhaseChange) capturedOnPhaseChange("INSTALLING")
      return new Promise((r) => {
        resolveSyncPromise = r
      })
    })

    // Iniciar sync para server-a
    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [],
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(capturedOnProgress).toBeDefined()

    // 1. Progresa hasta 82% en INSTALLING
    capturedOnProgress({ phase: "INSTALLING", progress: 82 })
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(82)

    // 2. Pausar
    await pauseHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    expect(mainExports.getDownloadQueueSnapshot().active.state).toBe("PAUSED")
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(82)

    // 3. Reanudar
    lastSentEvents.length = 0
    startHandler({}, { gameId: "server-a", gameName: "Server Alpha", resume: true })
    await new Promise((r) => setTimeout(r, 20))

    // El trabajo interno emite raw 30 -> UI recibe 82
    capturedOnProgress({ phase: "INSTALLING", progress: 30 })
    const ev30 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(ev30?.args[0]?.progress).toBe(82)
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(82)

    // raw 50 -> UI recibe 82
    capturedOnProgress({ phase: "INSTALLING", progress: 50 })
    const ev50 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(ev50?.args[0]?.progress).toBe(82)

    // raw 81 -> UI recibe 82
    capturedOnProgress({ phase: "INSTALLING", progress: 81 })
    const ev81 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(ev81?.args[0]?.progress).toBe(82)

    // raw 82 -> UI recibe 82 (floor eliminado)
    capturedOnProgress({ phase: "INSTALLING", progress: 82 })
    const ev82 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(ev82?.args[0]?.progress).toBe(82)

    // raw 83 -> UI recibe 83
    capturedOnProgress({ phase: "INSTALLING", progress: 83 })
    const ev83 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(ev83?.args[0]?.progress).toBe(83)
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(83)

    // 4. Pausar y reanudar nuevamente a 85 actualiza el floor
    capturedOnProgress({ phase: "INSTALLING", progress: 85 })
    await pauseHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(85)

    startHandler({}, { gameId: "server-a", gameName: "Server Alpha", resume: true })
    await new Promise((r) => setTimeout(r, 20))

    capturedOnProgress({ phase: "INSTALLING", progress: 30 })
    const evFloor85 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(evFloor85?.args[0]?.progress).toBe(85)

    // raw 86 supera 85 -> floor eliminado
    capturedOnProgress({ phase: "INSTALLING", progress: 86 })
    const ev86 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(ev86?.args[0]?.progress).toBe(86)
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(86)

    // 5. Transición normal de una operación nueva: DOWNLOADING 100 -> INSTALLING 30 muestra 30
    capturedOnPhaseChange("IDLE")
    mainExports.operationManager.state = "IDLE"
    mainExports.operationManager.activeSyncPromise = null
    expect(mainExports.getResumeProgressFloor()).toBeNull()

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [],
    })
    await new Promise((r) => setTimeout(r, 20))

    capturedOnPhaseChange("DOWNLOADING")
    capturedOnProgress({ phase: "DOWNLOADING", progress: 100 })
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(100)

    capturedOnPhaseChange("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 30 })
    const evPhaseChange = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    expect(evPhaseChange?.args[0]?.progress).toBe(30)
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(30)

    if (resolveSyncPromise) resolveSyncPromise({ success: true })
    vi.restoreAllMocks()
  })

  // 24. Resume desde INSTALLING 47 absorbe evento interno DOWNLOADING y mantiene floor hasta superar 47
  it("24. Resume desde INSTALLING 47 absorbe evento interno DOWNLOADING y mantiene floor hasta superar 47", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!
    const pauseHandler = ipcHandlers.get("game-pause-sync")!

    let capturedOnProgress: any = null
    let capturedOnPhaseChange: any = null
    let resolveSyncPromise: any = null

    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (opts: any) => {
      capturedOnProgress = opts.onProgress
      capturedOnPhaseChange = opts.onPhaseChange
      mainExports.operationManager.state = "INSTALLING"
      mainExports.operationManager.lastPayload = opts
      return new Promise((r) => {
        resolveSyncPromise = r
      })
    })
    vi.spyOn(mainExports.operationManager, "pauseSync").mockImplementation(async () => {
      mainExports.operationManager.state = "PAUSED"
      mainExports.operationManager.lastPausedPhase = "INSTALLING"
      if (capturedOnPhaseChange) capturedOnPhaseChange("PAUSED", "INSTALLING")
      return { success: true, paused: true, state: "PAUSED" }
    })
    vi.spyOn(mainExports.operationManager, "resumeSync").mockImplementation(async () => {
      mainExports.operationManager.state = "INSTALLING"
      return new Promise((r) => {
        resolveSyncPromise = r
      })
    })

    // 1. Iniciar sync para server-a y progresar hasta INSTALLING 47
    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [],
    })

    await new Promise((r) => setTimeout(r, 20))
    capturedOnPhaseChange("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 47 })
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(47)
    expect(mainExports.getDownloadQueueSnapshot().active.phase).toBe("INSTALLING")

    // 2. Pause en INSTALLING 47
    await pauseHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    expect(mainExports.getDownloadQueueSnapshot().active.state).toBe("PAUSED")
    expect(mainExports.getDownloadQueueSnapshot().active.progress).toBe(47)
    expect(mainExports.getDownloadQueueSnapshot().active.phase).toBe("INSTALLING")

    // 3. Resume
    lastSentEvents.length = 0
    startHandler({}, { gameId: "server-a", gameName: "Server Alpha", resume: true })
    await new Promise((r) => setTimeout(r, 20))

    const emittedSnapshots: { phase: string; progress: number }[] = []

    // 4. Evento interno DOWNLOADING durante la reconciliación del pipeline
    capturedOnPhaseChange("DOWNLOADING")
    capturedOnProgress({ phase: "DOWNLOADING", progress: 20 })
    const evDl = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    const snapDl = mainExports.getDownloadQueueSnapshot().active
    expect(evDl?.args[0]?.phase).toBe("INSTALLING")
    expect(evDl?.args[0]?.progress).toBe(47)
    expect(snapDl.phase).toBe("INSTALLING")
    expect(snapDl.progress).toBe(47)
    emittedSnapshots.push({ phase: evDl!.args[0].phase, progress: evDl!.args[0].progress })

    // 5. Evento INSTALLING 30
    capturedOnPhaseChange("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 30 })
    const ev30 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    const snap30 = mainExports.getDownloadQueueSnapshot().active
    expect(ev30?.args[0]?.phase).toBe("INSTALLING")
    expect(ev30?.args[0]?.progress).toBe(47)
    expect(snap30.phase).toBe("INSTALLING")
    expect(snap30.progress).toBe(47)
    emittedSnapshots.push({ phase: ev30!.args[0].phase, progress: ev30!.args[0].progress })

    // 6. Evento INSTALLING 40
    capturedOnProgress({ phase: "INSTALLING", progress: 40 })
    const ev40 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    const snap40 = mainExports.getDownloadQueueSnapshot().active
    expect(ev40?.args[0]?.phase).toBe("INSTALLING")
    expect(ev40?.args[0]?.progress).toBe(47)
    expect(snap40.phase).toBe("INSTALLING")
    expect(snap40.progress).toBe(47)
    emittedSnapshots.push({ phase: ev40!.args[0].phase, progress: ev40!.args[0].progress })

    // 7. Evento INSTALLING 46
    capturedOnProgress({ phase: "INSTALLING", progress: 46 })
    const ev46 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    const snap46 = mainExports.getDownloadQueueSnapshot().active
    expect(ev46?.args[0]?.phase).toBe("INSTALLING")
    expect(ev46?.args[0]?.progress).toBe(47)
    expect(snap46.phase).toBe("INSTALLING")
    expect(snap46.progress).toBe(47)
    emittedSnapshots.push({ phase: ev46!.args[0].phase, progress: ev46!.args[0].progress })

    // 8. Evento INSTALLING 47
    capturedOnProgress({ phase: "INSTALLING", progress: 47 })
    const ev47 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    const snap47 = mainExports.getDownloadQueueSnapshot().active
    expect(ev47?.args[0]?.phase).toBe("INSTALLING")
    expect(ev47?.args[0]?.progress).toBe(47)
    expect(snap47.phase).toBe("INSTALLING")
    expect(snap47.progress).toBe(47)
    emittedSnapshots.push({ phase: ev47!.args[0].phase, progress: ev47!.args[0].progress })

    // 9. Evento INSTALLING 48
    capturedOnProgress({ phase: "INSTALLING", progress: 48 })
    const ev48 = lastSentEvents.filter((e) => e.channel === "game-download-progress").pop()
    const snap48 = mainExports.getDownloadQueueSnapshot().active
    expect(ev48?.args[0]?.phase).toBe("INSTALLING")
    expect(ev48?.args[0]?.progress).toBe(48)
    expect(snap48.phase).toBe("INSTALLING")
    expect(snap48.progress).toBe(48)
    emittedSnapshots.push({ phase: ev48!.args[0].phase, progress: ev48!.args[0].progress })

    // Verificar la secuencia exacta requerida emitida a Home/Downloads
    expect(emittedSnapshots).toEqual([
      { phase: "INSTALLING", progress: 47 },
      { phase: "INSTALLING", progress: 47 },
      { phase: "INSTALLING", progress: 47 },
      { phase: "INSTALLING", progress: 47 },
      { phase: "INSTALLING", progress: 47 },
      { phase: "INSTALLING", progress: 48 },
    ])

    if (resolveSyncPromise) resolveSyncPromise({ success: true })
    vi.restoreAllMocks()
  })

  // 22. Recuperación después de reinicio usa el payload persistido completo y no lo pisa con strings vacíos/undefined
  it("22. Recuperación después de reinicio usa el payload persistido completo y no lo pisa con strings vacíos/undefined", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!

    const fileContent = Buffer.alloc(500, "Z")
    const hash = computeSha(fileContent)
    fileStore.set("/file/persistentMod.jar", fileContent)

    const sampleFile = {
      path: "mods/persistentMod.jar",
      sha256: hash,
      sizeBytes: 500,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/persistentMod.jar`,
    }

    const targetInstanceRoot = path.join(tempDir, "HiKAT", "games", "Server Alpha")
    await fsp.mkdir(targetInstanceRoot, { recursive: true })

    mainExports.operationManager.coreChecker = async () => ({ installed: true })
    mainExports.operationManager.coreInstaller = async () => ({ success: true })

    // Staging parcial (200 bytes)
    const { filesDir } = getStagingPaths(targetInstanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingName = getDeterministicStagingFileName(sampleFile)
    await fsp.writeFile(path.join(filesDir, stagingName), fileContent.subarray(0, 200))

    await saveDownloadSession(targetInstanceRoot, {
      modpackVersion: "1.0.0",
      status: "PAUSED",
      phase: "DOWNLOADING",
      progress: 40,
    })

    // Simular que antes de cerrar la app había una descarga activa guardada en download-queue.json
    const queueFilePath = path.join(userDataDir, "download-queue.json")
    const queueData = {
      active: {
        gameId: "server-a",
        gameName: "Server Alpha",
        payload: {
          instanceRoot: targetInstanceRoot,
          modpackVersion: "1.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          clientFiles: [sampleFile],
        },
        queuedAt: Date.now() - 5000,
        phase: "DOWNLOADING",
        progress: 40,
      },
      queue: [],
    }
    fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2), "utf8")

    // Cargar cola persistente
    mainExports.loadPersistentDownloadQueue()
    expect(mainExports.getDownloadQueue().length).toBe(1)
    expect(mainExports.getDownloadQueue()[0].gameId).toBe("server-a")

    // Llamar a resume enviando strings vacíos/undefined y clientFiles=[]
    requestedRanges = []
    const result = await startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      resume: true,
      clientFiles: [],
      modpackVersion: "",
      minecraftVersion: undefined,
    })

    expect(result.success).toBe(true)
    // Se reutilizó staging mediante HTTP Range (200-499)
    expect(requestedRanges.some((r) => r.includes("bytes=200-"))).toBe(true)

    // El archivo final fue instalado en la instancia
    const finalFile = path.join(targetInstanceRoot, "mods", "persistentMod.jar")
    expect(fs.existsSync(finalFile)).toBe(true)
    const stats = await fsp.stat(finalFile)
    expect(stats.size).toBe(500)

    // El manifest instalado tiene la versión completa persistida
    const installed = await loadInstalledManifest(targetInstanceRoot)
    expect(installed?.modpackVersion).toBe("1.0.0")

    // La cola persistente se limpió al completar
    expect(mainExports.getDownloadQueue().length).toBe(0)
  })

  // 25. resolveGameContext no acepta un instanceRoot arbitrario desde Renderer y deriva desde gamesRoot / validatedGameName
  it("25. resolveGameContext no acepta un instanceRoot arbitrario desde Renderer y deriva desde gamesRoot / validatedGameName", () => {
    const malicious = "C:\\evil\\directory\\escape"
    const ctx = mainExports.resolveGameContext({
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: malicious,
    })
    expect(ctx.instanceRoot).not.toBe(malicious)
    expect(ctx.instanceRoot).toBe(instanceRootA)

    // Legacy no acepta instanceRoot arbitrario tampoco
    const legacyCtx = mainExports.resolveGameContext({
      instanceRoot: malicious,
    })
    expect(legacyCtx.instanceRoot).not.toBe(malicious)
    expect(legacyCtx.instanceRoot).toBe(mainExports.getLegacyInstanceRoot())
  })

  // 26. Setting ON: lanzar B mientras A está DOWNLOADING pausa A, y al cerrar B reanuda A
  it("26. Setting ON: lanzar B mientras A está DOWNLOADING pausa A, y al cerrar B reanuda A", async () => {
    mainExports.settingsStore.set("pauseDownloadsOnGameLaunch", true)
    const launchSpy = vi.spyOn(mainExports.gameLauncher, "launch").mockImplementation(async (opts: any) => {
      mainExports.gameLauncher.runningGameId = opts.gameId || null
      mainExports.gameLauncher.setStatus("running", { gameId: opts.gameId })
      return { success: true, pid: 12345 }
    })

    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    fileStore.set("/file/big.jar", Buffer.alloc(1000, "Z"))
    urlDelays.set("/file/big.jar", 1000)

    // Iniciar A
    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [{
        path: "mods/big.jar",
        sha256: computeSha(Buffer.alloc(1000, "Z")),
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/big.jar`,
      }],
    }).catch(() => {})

    await new Promise((r) => setTimeout(r, 40))
    expect(mainExports.operationManager.state).toBe("SYNCING")

    // Lanzar B (Aparatia)
    const launchRes = await launchHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      minecraftVersion: "1.20.1",
    })
    expect(launchRes.success).toBe(true)
    expect(launchSpy).toHaveBeenCalled()

    // A fue auto-pausado
    expect(mainExports.operationManager.state).toBe("PAUSED")
    expect(mainExports.getDownloadQueueSnapshot().active?.state).toBe("PAUSED")

    // Al cerrar B, A se auto-reanuda
    mainExports.gameLauncher.setStatus("idle")
    await new Promise((r) => setTimeout(r, 40))
    expect(mainExports.operationManager.state).toBe("SYNCING")

    launchSpy.mockRestore()
  })

  // 27. Setting OFF: lanzar B mientras A está DOWNLOADING lanza B y A sigue DOWNLOADING
  it("27. Setting OFF: lanzar B mientras A está DOWNLOADING lanza B y A sigue DOWNLOADING", async () => {
    mainExports.settingsStore.set("pauseDownloadsOnGameLaunch", false)
    const launchSpy = vi.spyOn(mainExports.gameLauncher, "launch").mockImplementation(async (opts: any) => {
      mainExports.gameLauncher.runningGameId = opts.gameId || null
      mainExports.gameLauncher.setStatus("running", { gameId: opts.gameId })
      return { success: true, pid: 12345 }
    })

    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    fileStore.set("/file/big2.jar", Buffer.alloc(1000, "Y"))
    urlDelays.set("/file/big2.jar", 1000)

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      clientFiles: [{
        path: "mods/big2.jar",
        sha256: computeSha(Buffer.alloc(1000, "Y")),
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/big2.jar`,
      }],
    }).catch(() => {})

    await new Promise((r) => setTimeout(r, 40))
    expect(mainExports.operationManager.state).toBe("SYNCING")

    // Lanzar B
    await launchHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      minecraftVersion: "1.20.1",
    })

    // A sigue DOWNLOADING / SYNCING, no se pausó
    expect(mainExports.operationManager.state).toBe("SYNCING")
    expect(mainExports.getDownloadQueueSnapshot().active?.state).toBe("SYNCING")

    mainExports.gameLauncher.setStatus("idle")
    launchSpy.mockRestore()
  })

  // 28. A INSTALLING pausable + setting ON: lanzar B pausa A, lanza B y luego reanuda A conservando progress floor
  it("28. A INSTALLING pausable + setting ON: lanzar B pausa A, lanza B y luego reanuda A conservando progress floor", async () => {
    mainExports.settingsStore.set("pauseDownloadsOnGameLaunch", true)
    const launchSpy = vi.spyOn(mainExports.gameLauncher, "launch").mockImplementation(async (opts: any) => {
      mainExports.gameLauncher.runningGameId = opts.gameId || null
      mainExports.gameLauncher.setStatus("running", { gameId: opts.gameId })
      return { success: true, pid: 12345 }
    })

    let capturedOnProgress: any
    let capturedOnPhaseChange: any
    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (payload: any) => {
      capturedOnProgress = payload.onProgress
      capturedOnPhaseChange = payload.onPhaseChange
      mainExports.operationManager.state = "INSTALLING"
      mainExports.operationManager.lastPayload = payload
      mainExports.operationManager.lastPausedPhase = "INSTALLING"
      return new Promise(() => {})
    })

    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    await new Promise((r) => setTimeout(r, 20))
    capturedOnPhaseChange("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 47 })

    expect(mainExports.getDownloadQueueSnapshot().active?.phase).toBe("INSTALLING")
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(47)

    // Lanzar B mientras A está en INSTALLING 47%
    await launchHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      minecraftVersion: "1.20.1",
    })

    // A se pausó
    expect(mainExports.operationManager.state).toBe("PAUSED")
    const floor = mainExports.getResumeProgressFloor()
    expect(floor?.targetPhase).toBe("INSTALLING")
    expect(floor?.floor).toBe(47)
    expect(floor?.isResume).toBe(true)

    // Al cerrar B, A se auto-reanuda
    mainExports.gameLauncher.setStatus("idle")
    await new Promise((r) => setTimeout(r, 20))

    // Simular replay interno DOWNLOADING 20%
    capturedOnPhaseChange("DOWNLOADING")
    capturedOnProgress({ phase: "DOWNLOADING", progress: 20 })
    expect(mainExports.getDownloadQueueSnapshot().active?.phase).toBe("INSTALLING")
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(47)

    // Simular INSTALLING 30% -> mantiene floor 47%
    capturedOnPhaseChange("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 30 })
    expect(mainExports.getDownloadQueueSnapshot().active?.phase).toBe("INSTALLING")
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(47)

    // Simular INSTALLING 48% -> supera floor
    capturedOnProgress({ phase: "INSTALLING", progress: 48 })
    expect(mainExports.getDownloadQueueSnapshot().active?.phase).toBe("INSTALLING")
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(48)

    launchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // 29. A INSTALLING + setting OFF: lanzar B lanza B y A sigue instalándose
  it("29. A INSTALLING + setting OFF: lanzar B lanza B y A sigue instalándose", async () => {
    mainExports.settingsStore.set("pauseDownloadsOnGameLaunch", false)
    const launchSpy = vi.spyOn(mainExports.gameLauncher, "launch").mockImplementation(async (opts: any) => {
      mainExports.gameLauncher.runningGameId = opts.gameId || null
      mainExports.gameLauncher.setStatus("running", { gameId: opts.gameId })
      return { success: true, pid: 12345 }
    })

    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (payload: any) => {
      mainExports.operationManager.state = "INSTALLING"
      payload.onPhaseChange("INSTALLING")
      payload.onProgress({ phase: "INSTALLING", progress: 60 })
      return new Promise(() => {})
    })

    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(mainExports.operationManager.state).toBe("INSTALLING")

    // Lanzar B
    await launchHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      minecraftVersion: "1.20.1",
    })

    // A sigue instalándose, no se pausó
    expect(mainExports.operationManager.state).toBe("INSTALLING")
    expect(mainExports.getDownloadQueueSnapshot().active?.state).toBe("INSTALLING")

    mainExports.gameLauncher.setStatus("idle")
    launchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // 30. A INSTALLING con isCommitting=true: B sigue pudiendo lanzarse y NO se intenta pausar A
  it("30. A INSTALLING con isCommitting=true: B sigue pudiendo lanzarse y NO se intenta pausar A", async () => {
    mainExports.settingsStore.set("pauseDownloadsOnGameLaunch", true)
    const launchSpy = vi.spyOn(mainExports.gameLauncher, "launch").mockImplementation(async (opts: any) => {
      mainExports.gameLauncher.runningGameId = opts.gameId || null
      mainExports.gameLauncher.setStatus("running", { gameId: opts.gameId })
      return { success: true, pid: 12345 }
    })

    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (payload: any) => {
      mainExports.operationManager.state = "INSTALLING"
      mainExports.operationManager.isCommitting = true
      payload.onPhaseChange("INSTALLING")
      payload.onProgress({ phase: "INSTALLING", progress: 96, isCommitting: true })
      return new Promise(() => {})
    })

    const pauseSpy = vi.spyOn(mainExports.operationManager, "pauseSync")
    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    await new Promise((r) => setTimeout(r, 20))

    // Lanzar B mientras A está haciendo commit
    const launchRes = await launchHandler({}, {
      gameId: "server-b",
      gameName: "Server Beta",
      minecraftVersion: "1.20.1",
    })

    expect(launchRes.success).toBe(true)
    // NO intentó pausar A porque isCommitting=true
    expect(pauseSpy).not.toHaveBeenCalled()
    expect(mainExports.operationManager.state).toBe("INSTALLING")

    mainExports.gameLauncher.setStatus("idle")
    launchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // 31. Otro Minecraft realmente ejecutándose sigue bloqueando lanzar uno segundo
  it("31. Otro Minecraft realmente ejecutándose sigue bloqueando lanzar uno segundo", async () => {
    mainExports.gameLauncher.setStatus("running", { gameId: "server-b" })
    const launchHandler = ipcHandlers.get("game-launch")!

    await expect(
      launchHandler({}, {
        gameId: "server-a",
        gameName: "Server Alpha",
        minecraftVersion: "1.20.1",
      })
    ).rejects.toThrow("Game is already running or launching.")

    mainExports.gameLauncher.setStatus("idle")
  })

  // 32. El mismo servidor que está sincronizándose o instalándose no puede lanzarse
  it("32. El mismo servidor que está sincronizándose o instalándose no puede lanzarse", async () => {
    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (payload: any) => {
      mainExports.operationManager.state = "INSTALLING"
      payload.onPhaseChange("INSTALLING")
      return new Promise(() => {})
    })

    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    await new Promise((r) => setTimeout(r, 20))

    await expect(
      launchHandler({}, {
        gameId: "server-a",
        gameName: "Server Alpha",
        minecraftVersion: "1.20.1",
      })
    ).rejects.toThrow("Cannot launch Minecraft while this game is updating or installing.")

    vi.restoreAllMocks()
  })

  // 33. VERIFYING continúa bloqueando el lanzamiento de otro juego
  it("33. VERIFYING continúa bloqueando el lanzamiento de otro juego", async () => {
    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (payload: any) => {
      mainExports.operationManager.state = "VERIFYING"
      payload.onPhaseChange("VERIFYING")
      return new Promise(() => {})
    })

    const startHandler = ipcHandlers.get("game-start-sync")!
    const launchHandler = ipcHandlers.get("game-launch")!

    startHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
      isVerify: true,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
    })

    await new Promise((r) => setTimeout(r, 20))

    await expect(
      launchHandler({}, {
        gameId: "server-b",
        gameName: "Server Beta",
        minecraftVersion: "1.20.1",
      })
    ).rejects.toThrow("Cannot launch Minecraft while another game is verifying.")

    vi.restoreAllMocks()
  })

  // 34. Restauración automática tras reinicio en INSTALLING 47% conserva 47% durante replay interno y avanza a 48%
  it("34. Restauración automática tras reinicio en INSTALLING 47% conserva 47% durante replay interno y avanza a 48%", async () => {
    const queueFilePath = path.join(userDataDir, "download-queue.json")
    const queueData = {
      active: {
        gameId: "server-a",
        gameName: "Server Alpha",
        payload: {
          gameId: "server-a",
          gameName: "Server Alpha",
          modpackVersion: "1.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
        },
        queuedAt: Date.now() - 3000,
        phase: "INSTALLING",
        progress: 47,
      },
      queue: [],
    }
    fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2), "utf8")

    let capturedOnProgress: any
    let capturedOnPhaseChange: any
    vi.spyOn(mainExports.operationManager, "startSync").mockImplementation(async (payload: any) => {
      capturedOnProgress = payload.onProgress
      capturedOnPhaseChange = payload.onPhaseChange
      mainExports.operationManager.state = "INSTALLING"
      return new Promise(() => {})
    })

    mainExports.loadPersistentDownloadQueue()
    expect(mainExports.getDownloadQueue().length).toBe(1)

    // Al procesar la cola restaurada
    mainExports.processNextQueuedSync()
    await new Promise((r) => setTimeout(r, 20))

    // Snapshot activo inicial retiene 47% INSTALLING
    const snapInit = mainExports.getDownloadQueueSnapshot().active
    expect(snapInit?.phase).toBe("INSTALLING")
    expect(snapInit?.progress).toBe(47)

    // Replay interno de DOWNLOADING
    capturedOnPhaseChange("DOWNLOADING")
    capturedOnProgress({ phase: "DOWNLOADING", progress: 20 })
    expect(mainExports.getDownloadQueueSnapshot().active?.phase).toBe("INSTALLING")
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(47)

    // Catch-up 30, 40, 46, 47 -> mantiene 47%
    capturedOnPhaseChange("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 30 })
    expect(mainExports.getDownloadQueueSnapshot().active?.phase).toBe("INSTALLING")
    capturedOnProgress({ phase: "INSTALLING", progress: 46 })
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(47)
    capturedOnProgress({ phase: "INSTALLING", progress: 47 })
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(47)

    // Supera el floor -> 48%
    capturedOnProgress({ phase: "INSTALLING", progress: 48 })
    expect(mainExports.getDownloadQueueSnapshot().active?.progress).toBe(48)

    vi.restoreAllMocks()
  })

  // 35. game-get-installed-state lee manifest e inicializa el watcher para detectar alteraciones
  it("35. game-get-installed-state lee manifest e inicializa el watcher para detectar alteraciones", async () => {
    const getInstalledStateHandler = ipcHandlers.get("game-get-installed-state")!
    expect(getInstalledStateHandler).toBeDefined()

    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "VANILLA",
      files: {
        "mods/important.jar": {
          sha256: computeSha("original"),
          sizeBytes: 8,
          policy: "NO_MODIFICABLE",
        },
      },
    })

    const state = await getInstalledStateHandler({}, {
      gameId: "server-a",
      gameName: "Server Alpha",
      instanceRoot: instanceRootA,
    })

    expect(state.installedModpackVersion).toBe("1.0.0")

    // El watcher debe haberse activado y detectar modificación en archivo NO_MODIFICABLE
    lastSentEvents.length = 0
    const testFilePath = path.join(instanceRootA, "mods", "important.jar")
    await fsp.mkdir(path.dirname(testFilePath), { recursive: true })
    await fsp.writeFile(testFilePath, "tampered-content")

    await new Promise((r) => setTimeout(r, 120))

    const integrityEvt = lastSentEvents.find(
      (e) => e.channel === "game-file-integrity-changed" && e.args[0]?.gameId === "server-a"
    )
    expect(integrityEvt).toBeDefined()
  })
})

