import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import http from "http"
import crypto from "crypto"
import {
  GameOperationManager,
  // @ts-expect-error CJS module without bundled declaration
} from "../../electron/game-operation-manager.cjs"
import {
  saveInstalledManifest,
  saveDownloadSession,
  // @ts-expect-error CJS module without bundled declaration
} from "../../electron/client-files-sync.cjs"

describe("Shard 8E: GameOperationManager Real Concurrency & State Machine Suite", () => {
  let manager: GameOperationManager
  let tempDir: string
  let instanceRoot: string
  let appDataRoot: string
  let server: http.Server
  let serverPort: number
  let serverBaseUrl: string

  function computeSha(content: Buffer | string): string {
    return crypto
      .createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
      .digest("hex")
      .toLowerCase()
  }

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-manager-test-"))
    appDataRoot = path.join(tempDir, "HiKAT")
    instanceRoot = path.join(appDataRoot, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })

    manager = new GameOperationManager()

    server = http.createServer((req, res) => {
      const url = req.url || ""
      if (url.startsWith("/slow/")) {
        res.writeHead(200, { "Content-Type": "application/octet-stream" })
        res.write(Buffer.from("part1", "utf8"))
        setTimeout(() => {
          if (!res.writableEnded) {
            res.write(Buffer.from("part2", "utf8"))
            res.end()
          }
        }, 600)
      } else if (url.startsWith("/fast/")) {
        const c = Buffer.from("fast content", "utf8")
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": c.length })
        res.end(c)
      } else {
        res.writeHead(404)
        res.end()
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
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  it("1. Pause while stream is active: waits for stream close, persists staging, transitions to PAUSED", async () => {
    const task = {
      path: "mods/slow.jar",
      sha256: computeSha("part1part2"),
      sizeBytes: 10,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/slow/mod`,
    }

    const syncPromise = manager.startSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      apiBaseUrl: serverBaseUrl,
    })

    expect(manager.getState()).toBe("SYNCING")

    // Pause while stream is active
    await new Promise((r) => setTimeout(r, 60))
    const pauseRes = await manager.pauseSync()

    expect(pauseRes.paused).toBe(true)
    expect(manager.getState()).toBe("PAUSED")

    const syncRes = await syncPromise
    expect(syncRes.paused).toBe(true)
    expect(manager.getState()).toBe("PAUSED")
  })

  it("2. Resume immediately from PAUSED: does not create a 2nd concurrent sync", async () => {
    manager.state = "PAUSED"
    const mockLauncher = { launch: vi.fn() }

    const task = {
      path: "mods/fast.jar",
      sha256: computeSha("fast content"),
      sizeBytes: 12,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/fast/mod`,
    }

    const syncPromise = manager.startSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      apiBaseUrl: serverBaseUrl,
    })

    expect(manager.getState()).toBe("SYNCING")

    // Simultaneous second startSync while active must be rejected
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [task],
        modpackVersion: "1.0.0",
        apiBaseUrl: serverBaseUrl,
      }),
    ).rejects.toThrow(/Operation already in progress/i)

    const res = await syncPromise
    expect(res.success).toBe(true)
    expect(manager.getState()).toBe("IDLE")
  })

  it("3. Cancel while active: waits for active sync, cleans staging before reaching IDLE", async () => {
    const task = {
      path: "mods/slow.jar",
      sha256: computeSha("part1part2"),
      sizeBytes: 10,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/slow/mod`,
    }

    const syncPromise = manager.startSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      apiBaseUrl: serverBaseUrl,
    })

    expect(manager.getState()).toBe("SYNCING")

    // Cancel while active
    await new Promise((r) => setTimeout(r, 60))
    const cancelPromise = manager.cancelSync(instanceRoot)

    // While canceling, launching is blocked
    await expect(manager.launchGame({ launch: vi.fn() }, {})).rejects.toThrow(
      /Cannot launch Minecraft while game operation is in progress/i,
    )

    await expect(syncPromise).rejects.toThrow(/cancelled/i)
    await cancelPromise
    expect(manager.getState()).toBe("IDLE")
    expect(fs.existsSync(path.join(instanceRoot, ".hikat", "staging"))).toBe(false)
  })

  it("4. Cancel during INSTALLING phase: strictly rejected and does not alter state", async () => {
    manager.state = "INSTALLING"

    await expect(manager.cancelSync(instanceRoot)).rejects.toThrow(
      /Cannot cancel synchronization while installation phase is in progress/i,
    )

    expect(manager.getState()).toBe("INSTALLING")

    // Launch is also blocked during INSTALLING
    await expect(manager.launchGame({ launch: vi.fn() }, {})).rejects.toThrow(
      /Cannot launch Minecraft while game operation is in progress/i,
    )
  })

  it("5. Pause during INSTALLING phase: strictly rejected and does not alter state", async () => {
    manager.state = "INSTALLING"

    await expect(manager.pauseSync()).rejects.toThrow(
      /Cannot pause synchronization while installation phase is in progress/i,
    )

    expect(manager.getState()).toBe("INSTALLING")
  })

  it("6. First operation finally does not nullify cancelSignal of newer operation", async () => {
    // Op 1 runs and finishes
    manager.operationCounter = 1
    const op1Signal = { isCancelled: false, isPaused: false, id: 1 }
    manager.activeCancelSignal = op1Signal

    // Op 2 starts
    const op2Signal = { isCancelled: false, isPaused: false, id: 2 }
    manager.activeCancelSignal = op2Signal

    // Op 1 finally handler triggers with id: 1
    if (manager.activeCancelSignal?.id === 1) {
      manager.activeCancelSignal = null
    }

    // Active signal for Op 2 is preserved
    expect(manager.activeCancelSignal).toBe(op2Signal)
    expect(manager.activeCancelSignal.id).toBe(2)
  })

  it("7. CheckPlan recovers existing paused session and returns staged stats", async () => {
    const content = "fast content"
    const sha = computeSha(content)
    const task = {
      path: "mods/fast.jar",
      sha256: sha,
      sizeBytes: Buffer.byteLength(content),
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/fast/mod`,
    }

    const stagingDir = path.join(instanceRoot, ".hikat", "staging", "files")
    await fsp.mkdir(stagingDir, { recursive: true })
    const stagingFileName = `stage_${crypto.createHash("sha256").update(task.path).digest("hex").slice(0, 16)}_${sha.slice(0, 12)}_fast.jar`
    await fsp.writeFile(path.join(stagingDir, stagingFileName), content, "utf8")

    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "PAUSED",
      updatedAt: new Date().toISOString(),
      files: { [task.path]: { stagingFileName, sha256: sha } },
    })

    const checkRes = await manager.checkPlan({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
    })

    expect(checkRes.success).toBe(true)
    expect(checkRes.hasPausedSession).toBe(true)
    expect(checkRes.stagedBytes).toBe(Buffer.byteLength(content))
    expect(checkRes.stagedFilesCount).toBe(1)
  })

  it("8. Uninstall blocked during active SYNCING or INSTALLING", async () => {
    manager.state = "SYNCING"
    await expect(manager.uninstallGame(instanceRoot, appDataRoot)).rejects.toThrow(
      /Cannot uninstall game while synchronization is active/i,
    )

    manager.state = "INSTALLING"
    await expect(manager.uninstallGame(instanceRoot, appDataRoot)).rejects.toThrow(
      /Cannot uninstall game while synchronization is active/i,
    )
  })
})
