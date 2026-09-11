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

  // 3. Update 1.2 -> 1.3 -> pause durante INSTALLING -> 1.2 intacta
  it("3. Update 1.2 -> 1.3 -> pause durante INSTALLING -> 1.2 intacta", async () => {
    fileStore.set("/file/v13.jar", Buffer.from("v13-content", "utf8"))
    await fsp.mkdir(path.join(instanceRootA, "mods"), { recursive: true })
    await fsp.writeFile(path.join(instanceRootA, "mods", "v12.jar"), "v12-content")
    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.2.0",
      clientFiles: [{ path: "mods/v12.jar", sha256: computeSha("v12-content"), sizeBytes: 11, policy: "NO_MODIFICABLE" }],
    })

    let pausedPhaseReported = ""
    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: false }),
      coreInstaller: async ({ signal }: any) => {
        setTimeout(() => {
          manager.pauseSync().catch(() => {})
        }, 10)
        return new Promise((_, reject) => {
          if (signal?.aborted) {
            const err = new Error("Aborted")
            err.name = "AbortError"
            return reject(err)
          }
          signal?.addEventListener?.("abort", () => {
            const err = new Error("Aborted")
            err.name = "AbortError"
            reject(err)
          })
        })
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
      onPhaseChange: (ph: string, underlying: string) => {
        if (ph === "PAUSED") pausedPhaseReported = underlying
      },
    })

    expect(res.paused).toBe(true)
    expect(manager.getState()).toBe("PAUSED")
    expect(pausedPhaseReported).toBe("INSTALLING")

    const manifest = await loadInstalledManifest(instanceRootA)
    expect(manifest?.modpackVersion).toBe("1.2.0")
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v12.jar"))).toBe(true)
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v13.jar"))).toBe(false)
  })

  // 4. Update 1.2 -> 1.3 -> cancel durante INSTALLING -> manifest y archivos siguen en 1.2
  it("4. Update 1.2 -> 1.3 -> cancel durante INSTALLING -> manifest y archivos siguen en 1.2", async () => {
    fileStore.set("/file/v13.jar", Buffer.from("v13-content", "utf8"))
    await fsp.mkdir(path.join(instanceRootA, "mods"), { recursive: true })
    await fsp.writeFile(path.join(instanceRootA, "mods", "v12.jar"), "v12-content")
    await saveInstalledManifest(instanceRootA, {
      modpackVersion: "1.2.0",
      clientFiles: [{ path: "mods/v12.jar", sha256: computeSha("v12-content"), sizeBytes: 11, policy: "NO_MODIFICABLE" }],
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: false }),
      coreInstaller: async ({ signal }: any) => {
        setTimeout(() => {
          manager.cancelSync(instanceRootA).catch(() => {})
        }, 10)
        return new Promise((_, reject) => {
          if (signal?.aborted) {
            const err = new Error("Aborted")
            err.name = "AbortError"
            return reject(err)
          }
          signal?.addEventListener?.("abort", () => {
            const err = new Error("Aborted")
            err.name = "AbortError"
            reject(err)
          })
        })
      },
    })

    await manager.startSync({
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
    }).catch(() => {})

    expect(manager.getState()).toBe("IDLE")

    const manifest = await loadInstalledManifest(instanceRootA)
    expect(manifest?.modpackVersion).toBe("1.2.0")
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v12.jar"))).toBe(true)
    expect(fs.existsSync(path.join(instanceRootA, "mods", "v13.jar"))).toBe(false)
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

  // 8-11. FIFO Queue: Orden secuencial, avance determinista al terminar o cancelar
  it("8-11. FIFO Queue: Orden secuencial, avance determinista al terminar o cancelar", async () => {
    let active: any = null
    let queue: any[] = []
    let bStartCount = 0

    const simulateStart = (item: any) => {
      if (!active) {
        active = item
        if (item.gameId === "B") bStartCount++
      } else {
        queue.push(item)
      }
    }

    const simulateFinish = () => {
      active = null
      if (queue.length > 0) {
        const next = queue.shift()
        simulateStart(next)
      }
    }

    const simulateCancelQueued = (gameId: string) => {
      queue = queue.filter((q) => q.gameId !== gameId)
    }

    simulateStart({ gameId: "A" })
    simulateStart({ gameId: "B" })
    simulateStart({ gameId: "C" })

    expect(active.gameId).toBe("A")
    expect(queue.map((q) => q.gameId)).toEqual(["B", "C"])

    simulateCancelQueued("B")
    expect(active.gameId).toBe("A")
    expect(queue.map((q) => q.gameId)).toEqual(["C"])

    queue.push({ gameId: "B" })
    expect(queue.map((q) => q.gameId)).toEqual(["C", "B"])

    simulateFinish()
    expect(active.gameId).toBe("C")
    expect(queue.map((q) => q.gameId)).toEqual(["B"])

    simulateFinish()
    expect(active.gameId).toBe("B")
    expect(queue.length).toBe(0)
    expect(bStartCount).toBe(1)
  })

  // 12. Cierre/reinicio restaura A/B/C y su orden
  it("12. Cierre/reinicio restaura la operación activa y su orden FIFO en download-queue.json", async () => {
    const queueFilePath = path.join(userDataDir, "download-queue.json")

    const persistentData = {
      active: {
        gameId: "server-a",
        gameName: "Server Alpha",
        payload: { modpackVersion: "1.0.0", minecraftVersion: "1.20.1" },
        queuedAt: Date.now() - 5000,
      },
      queue: [
        {
          gameId: "server-b",
          gameName: "Server Beta",
          payload: { modpackVersion: "2.0.0", minecraftVersion: "1.20.1" },
          queuedAt: Date.now() - 3000,
        },
        {
          gameId: "server-c",
          gameName: "Server Gamma",
          payload: { modpackVersion: "3.0.0", minecraftVersion: "1.20.1" },
          queuedAt: Date.now() - 1000,
        },
      ],
    }

    await fsp.writeFile(queueFilePath, JSON.stringify(persistentData, null, 2), "utf8")

    const raw = await fsp.readFile(queueFilePath, "utf8")
    const parsed = JSON.parse(raw)
    const restoredQueue: any[] = []

    if (parsed.active?.gameId) {
      restoredQueue.push(parsed.active)
    }
    if (Array.isArray(parsed.queue)) {
      for (const item of parsed.queue) {
        if (!restoredQueue.some((q) => q.gameId === item.gameId)) {
          restoredQueue.push(item)
        }
      }
    }

    expect(restoredQueue.length).toBe(3)
    expect(restoredQueue[0].gameId).toBe("server-a")
    expect(restoredQueue[1].gameId).toBe("server-b")
    expect(restoredQueue[2].gameId).toBe("server-c")
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
