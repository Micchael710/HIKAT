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

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-p11-core-"))
    instanceRootA = path.join(tempDir, "games", "ServerA")
    instanceRootB = path.join(tempDir, "games", "ServerB")
    userDataDir = path.join(tempDir, "userData")
    await fsp.mkdir(instanceRootA, { recursive: true })
    await fsp.mkdir(instanceRootB, { recursive: true })
    await fsp.mkdir(userDataDir, { recursive: true })

    activeAppDataDir = tempDir
    activeUserDataDir = userDataDir
    mainExports.resetDownloadQueueForTesting()
    lastSentEvents.length = 0
    const mockWin = new (electronMock.BrowserWindow as any)()
    mainExports.setMainWindowForTesting(mockWin)

    requestedRanges = []
    fileStore = new Map<string, Buffer>()

    server = http.createServer((req, res) => {
      const url = req.url || ""
      const rangeHeader = req.headers["range"]
      if (rangeHeader) {
        requestedRanges.push(rangeHeader)
      }

      const content = fileStore.get(url) || Buffer.alloc(1000, "X")
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
      instanceRoot: path.join(tempDir, "games", "ServerC"),
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
      instanceRoot: path.join(tempDir, "games", "ServerC"),
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
    await cancelHandler({}, { gameId: "server-a", gameName: "Server Alpha" })
    await syncPromiseA
  })

  // 12b. Un queued que pasa a activo y falla emite game-phase-changed ERROR y no desaparece silenciosamente
  it("12b. Un queued que pasa a activo y falla emite game-phase-changed ERROR y no desaparece silenciosamente", async () => {
    const startHandler = ipcHandlers.get("game-start-sync")!
    const cancelHandler = ipcHandlers.get("game-cancel-sync")!

    fileStore.set("/file/fileOk.jar", Buffer.from("ok-data"))

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

    await new Promise((r) => setTimeout(r, 30))

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
})
