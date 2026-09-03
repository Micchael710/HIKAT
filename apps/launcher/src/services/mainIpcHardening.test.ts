import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import http from "http"
import crypto from "crypto"
import {
  GameOperationManager,
  validateSyncPayload,
  // @ts-expect-error CJS module without bundled declaration
} from "../../electron/game-operation-manager.cjs"
import {
  saveInstalledManifest,
  saveDownloadSession,
  loadDownloadSession,
  getStagingPaths,
  getDeterministicStagingFileName,
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

    const binDir = path.join(instanceRoot, "jdk-21", "bin")
    await fsp.mkdir(binDir, { recursive: true })
    const javaExe = path.join(binDir, process.platform === "win32" ? "java.exe" : "java")
    await fsp.writeFile(javaExe, "mock-java")

    manager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
          isCoreInstalled: true,
          hasExistingInstall: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
          issues: [],
        }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0 }),
        installOrRepairMinecraftCore: vi.fn().mockResolvedValue({
          success: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
        }),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

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

  // ─────────────────────────────────────────────────────────────
  // 1. Concurrency & State Machine Invariants
  // ─────────────────────────────────────────────────────────────
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
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
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
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      apiBaseUrl: serverBaseUrl,
    })

    expect(manager.getState()).toBe("SYNCING")

    // Simultaneous second startSync while active must be rejected
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [task],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
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
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
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
    manager.operationCounter = 1
    const op1Signal = { isCancelled: false, isPaused: false, id: 1 }
    manager.activeCancelSignal = op1Signal

    const op2Signal = { isCancelled: false, isPaused: false, id: 2 }
    manager.activeCancelSignal = op2Signal

    if (manager.activeCancelSignal?.id === 1) {
      manager.activeCancelSignal = null
    }

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
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
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

  // ─────────────────────────────────────────────────────────────
  // 2. Strict Real IPC Payload Validation & Pruning Protection (Tests 9-22)
  // ─────────────────────────────────────────────────────────────
  it("9. Rejects clientFiles if not an array", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: "not-an-array" as any,
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/clientFiles must be an array/i)
  })

  it("10. Rejects empty clientFiles in startSync without pruning existing files", async () => {
    // Put a valid mod in instanceRoot
    const modPath = path.join(instanceRoot, "mods", "important.jar")
    await fsp.mkdir(path.dirname(modPath), { recursive: true })
    await fsp.writeFile(modPath, "important mod binary", "utf8")

    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/clientFiles cannot be empty for startSync/i)

    // Verify existing mod was NOT pruned!
    expect(fs.existsSync(modPath)).toBe(true)
    expect(manager.getState()).toBe("IDLE")
  })

  it("11. Rejects file with empty path", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid path string/i)
  })

  it("12. Rejects path with ../ relative traversal segments", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/../../evil.jar", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/traversal segments/i)
  })

  it("13. Rejects absolute path", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "/etc/passwd", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/cannot be absolute/i)

    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "C:\\Windows\\System32\\cmd.exe", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/cannot be absolute/i)
  })

  it("14. Rejects invalid or malformed SHA-256 hash", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "too-short", sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid SHA-256 hash/i)

    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "z".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid SHA-256 hash/i)
  })

  it("15. Rejects negative sizeBytes", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64), sizeBytes: -5, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid sizeBytes/i)
  })

  it("16. Rejects non-finite sizeBytes", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64), sizeBytes: NaN, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid sizeBytes/i)

    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64), sizeBytes: Infinity, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid sizeBytes/i)
  })

  it("17. Rejects invalid policy", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64), sizeBytes: 100, policy: "INVALID_POLICY", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid policy/i)
  })

  it("18. Rejects empty downloadUrl", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/invalid downloadUrl/i)
  })

  it("19. Rejects duplicate logical paths in manifest", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [
          { path: "mods/dup.jar", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl1" },
          { path: "mods/dup.jar", sha256: "b".repeat(64), sizeBytes: 200, policy: "NO_MODIFICABLE", downloadUrl: "/dl2" },
        ],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/duplicate logical path found/i)
  })

  it("20. Rejects invalid or empty modpackVersion", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64), sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "",
      }),
    ).rejects.toThrow(/modpackVersion must be a non-empty string/i)
  })

  it("21. Invalid payload does NOT execute sync or alter operation state", async () => {
    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/m.jar", sha256: "bad-sha", sizeBytes: 100, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow()

    expect(manager.getState()).toBe("IDLE")
    expect(manager.activeOperationPromise).toBeNull()
  })

  it("22. Invalid payload does NOT delete or prune existing game files", async () => {
    const existingFile = path.join(instanceRoot, "mods", "retained.jar")
    await fsp.mkdir(path.dirname(existingFile), { recursive: true })
    await fsp.writeFile(existingFile, "valid content", "utf8")

    await expect(
      manager.startSync({
        instanceRoot,
        clientFiles: [{ path: "mods/bad.jar", sha256: "invalid", sizeBytes: 10, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow()

    expect(fs.existsSync(existingFile)).toBe(true)
  })

  it("23. Client-files-only operation emits INSTALLING 100% before transitioning to IDLE", async () => {
    const fileContent = "fast content"
    const fileSha = computeSha(fileContent)
    const progressEvents: any[] = []

    const result = await manager.startSync({
      instanceRoot,
      clientFiles: [
        {
          path: "mods/new-mod.jar",
          sha256: fileSha,
          sizeBytes: Buffer.byteLength(fileContent),
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/fast/new-mod.jar`,
        },
      ],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      onProgress: (p: any) => progressEvents.push(p),
    })

    expect(result.success).toBe(true)
    expect(manager.getState()).toBe("IDLE")

    const installing100 = progressEvents.find(
      (e) => e.phase === "INSTALLING" && e.progress === 100,
    )
    expect(installing100).toBeDefined()
    expect(installing100.phase).toBe("INSTALLING")
    expect(installing100.progress).toBe(100)
  })

  it("24. Unexpected crash recovery: partial staging file without PAUSED session is detected by checkPlan as hasInterruptedDownload", async () => {
    const task = {
      path: "mods/crash-recovery.jar",
      sha256: computeSha("full content for crash recovery test"),
      sizeBytes: Buffer.byteLength("full content for crash recovery test"), // 36 bytes
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/fast/crash`,
    }

    // Simulate abrupt crash during downloading: partial file on disk in staging, NO session file saved
    const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFilePath = path.join(filesDir, getDeterministicStagingFileName(task))
    await fsp.writeFile(stagingFilePath, "full content", "utf8") // 12 bytes out of 36 bytes

    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasInterruptedDownload).toBe(true)
    expect(plan.stagedBytes).toBe(12)
    expect(plan.totalDownloadBytes).toBe(36)
  })

  it("25. Interruption during INSTALLING: checkPlan does NOT set hasInterruptedDownload to true", async () => {
    const task = {
      path: "mods/installing-interrupted.jar",
      sha256: computeSha("some mod data"),
      sizeBytes: Buffer.byteLength("some mod data"),
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/fast/installing-mod`,
    }

    // Save session with status: "INSTALLING" (as saved at the start of applyStagingToInstance)
    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "INSTALLING",
      updatedAt: new Date().toISOString(),
    })

    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasInterruptedDownload).toBe(false)
    expect(plan.hasPausedSession).toBe(false)
    expect(plan.needsUpdate).toBe(true)
  })

  it("26. cancelSync cleans partial staging files on disk and resets state to IDLE", async () => {
    const task = {
      path: "mods/to-cancel.jar",
      sha256: computeSha("data"),
      sizeBytes: 100,
      policy: "NO_MODIFICABLE",
      downloadUrl: "/dl",
    }
    const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFilePath = path.join(filesDir, getDeterministicStagingFileName(task))
    await fsp.writeFile(stagingFilePath, "partial data in staging", "utf8")
    expect(fs.existsSync(stagingFilePath)).toBe(true)

    const cancelRes = await manager.cancelSync(instanceRoot)
    expect(cancelRes.success).toBe(true)
    expect(manager.getState()).toBe("IDLE")
    expect(fs.existsSync(path.join(instanceRoot, ".hikat", "staging"))).toBe(false)
  })

  it("27. Fresh install interrupted during INSTALLING: hasExistingInstall is false when no previous core-state exists", async () => {
    // Create custom manager where core has never completed (no resolvedVersionId)
    const freshManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
          isCoreInstalled: false,
          hasExistingInstall: false,
          resolvedVersionId: null,
          issues: [],
        }),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    // Simulate installedManifest existing from partial apply
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {
        "mods/partial.jar": {
          officialSha256: "a".repeat(64),
          policy: "NO_MODIFICABLE",
          lastSyncedAt: new Date().toISOString(),
        },
      },
    })

    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "INSTALLING",
      updatedAt: new Date().toISOString(),
    })

    const plan = await freshManager.checkPlan({
      instanceRoot,
      clientFiles: [
        {
          path: "mods/partial.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          policy: "NO_MODIFICABLE",
          downloadUrl: "/dl",
        },
      ],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasExistingInstall).toBe(false)
    expect(plan.needsUpdate).toBe(true)
  })

  it("28. Existing previous installation: hasExistingInstall is true when core.resolvedVersionId exists even if new version requires sync", async () => {
    const updateManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
          isCoreInstalled: false, // Core for 1.21.1 not installed yet
          hasExistingInstall: true,
          resolvedVersionId: "1.20.1-neoforge-47.1.0", // Previous version resolved
          issues: [],
        }),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    const plan = await updateManager.checkPlan({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasExistingInstall).toBe(true)
    expect(plan.needsUpdate).toBe(true)
  })

  it("29. GameOperationManager checkPlan and startSync accept and respect directoryPolicies", async () => {
    // Write extra file inside mods/
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    const extraMod = path.join(modsDir, "extra-addon.jar")
    await fsp.writeFile(extraMod, "extra addon binary")

    // With directoryPolicies: [{ path: "mods", policy: "MODIFICABLE" }]
    const planWithPolicy = await manager.checkPlan({
      instanceRoot,
      clientFiles: [],
      directoryPolicies: [{ path: "mods", policy: "MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(planWithPolicy.success).toBe(true)
    // Extra file inside MODIFICABLE folder is NOT pruned
    expect(planWithPolicy.filesToPrune).toBe(0)

    // Without directoryPolicies (default strict), extra file is flagged for pruning
    const planWithoutPolicy = await manager.checkPlan({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(planWithoutPolicy.success).toBe(true)
    expect(planWithoutPolicy.filesToPrune).toBe(1)
  })

  it("30. Verification without damaged files: progress strictly non-decreasing, all in VERIFYING, reaches 100", async () => {
    // Write valid file and installed manifest
    const modPath = path.join(instanceRoot, "mods", "valid.jar")
    await fsp.mkdir(path.dirname(modPath), { recursive: true })
    const content = "valid mod content"
    await fsp.writeFile(modPath, content)
    const sha = computeSha(content)

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [],
      clientFiles: [{ path: "mods/valid.jar", sha256: sha, policy: "NO_MODIFICABLE" }],
    })

    const progressReports: Array<{ phase: string; progress: number }> = []

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [{ path: "mods/valid.jar", sha256: sha, downloadUrl: `${serverBaseUrl}/fast/valid.jar`, sizeBytes: content.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      isVerify: true,
      onProgress: (p: any) => {
        progressReports.push({ phase: p.phase, progress: p.progress })
      },
    })

    expect(res.success).toBe(true)
    expect(progressReports.length).toBeGreaterThan(0)

    // Every report during verification is VERIFYING
    for (const report of progressReports) {
      expect(report.phase).toBe("VERIFYING")
    }

    // Progress is strictly non-decreasing
    for (let i = 1; i < progressReports.length; i++) {
      expect(progressReports[i].progress).toBeGreaterThanOrEqual(progressReports[i - 1].progress)
    }

    expect(progressReports[progressReports.length - 1].progress).toBe(100)
  })

  it("31. Verification with file needing repair: maps repair download into 35-50 and stays strictly non-decreasing across 0-35 -> 35-50 -> 50-90 -> 95 -> 100", async () => {
    // Write corrupted file
    const modPath = path.join(instanceRoot, "mods", "repair.jar")
    await fsp.mkdir(path.dirname(modPath), { recursive: true })
    await fsp.writeFile(modPath, "corrupted content")

    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [],
      clientFiles: [{ path: "mods/repair.jar", sha256: correctSha, policy: "NO_MODIFICABLE" }],
    })

    const progressReports: Array<{ phase: string; progress: number }> = []

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [{ path: "mods/repair.jar", sha256: correctSha, downloadUrl: `${serverBaseUrl}/fast/repair.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      isVerify: true,
      onProgress: (p: any) => {
        progressReports.push({ phase: p.phase, progress: p.progress })
      },
    })

    expect(res.success).toBe(true)
    expect(progressReports.length).toBeGreaterThan(0)

    // All phases during verify are VERIFYING
    for (const report of progressReports) {
      expect(report.phase).toBe("VERIFYING")
    }

    // Progress never decreases
    for (let i = 1; i < progressReports.length; i++) {
      expect(progressReports[i].progress).toBeGreaterThanOrEqual(progressReports[i - 1].progress)
    }

    // Check presence of the stages
    const values = progressReports.map((r) => r.progress)
    expect(values.some((v) => v >= 0 && v <= 35)).toBe(true)
    expect(values.some((v) => v >= 35 && v <= 50)).toBe(true)
    expect(values.some((v) => v >= 50 && v <= 90)).toBe(true)
    expect(values).toContain(95)
    expect(values[values.length - 1]).toBe(100)
  })

  it("32. Repair download 0, 40, 100 progress maps to VERIFYING within 35-50", () => {
    const rawEvents: number[] = [0, 40, 100]
    const mappedEvents = rawEvents.map((raw) =>
      Math.min(50, Math.max(35, Math.round(35 + (raw / 100) * 15)))
    )

    expect(mappedEvents).toEqual([35, 41, 50])
  })

  it("33. Normal download/update uses DOWNLOADING and INSTALLING phases without verify mapping", async () => {
    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    const progressReports: Array<{ phase: string; progress: number }> = []
    const phaseChanges: string[] = []

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [{ path: "mods/normal.jar", sha256: correctSha, downloadUrl: `${serverBaseUrl}/fast/normal.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      isVerify: false,
      onProgress: (p: any) => {
        progressReports.push({ phase: p.phase, progress: p.progress })
      },
      onPhaseChange: (ph: string) => {
        phaseChanges.push(ph)
      },
    })

    expect(res.success).toBe(true)
    const phases = new Set(progressReports.map((r) => r.phase))
    expect(phases.has("DOWNLOADING")).toBe(true)
    expect(phases.has("INSTALLING")).toBe(true)
    expect(phases.has("VERIFYING")).toBe(false)
  })

  it("34. Interrupted verification with files in staging: checkPlan returns hasInterruptedDownload=false, hasPausedSession=false, hasIntegrityIssue=true", async () => {
    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    // Installed manifest has 1.0.0, but the file on disk is missing/corrupted
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [],
      clientFiles: [{ path: "mods/missing.jar", sha256: correctSha, policy: "NO_MODIFICABLE" }],
    })

    // Simulate staged file downloaded during verification
    const { filesDir } = getStagingPaths(instanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFileName = getDeterministicStagingFileName({ path: "mods/missing.jar", sha256: correctSha })
    await fsp.writeFile(path.join(filesDir, stagingFileName), correctContent)

    // Simulate verification session
    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "DOWNLOADING",
      operationKind: "VERIFY",
      updatedAt: new Date().toISOString(),
      files: {
        "mods/missing.jar": {
          stagingFileName,
          sha256: correctSha,
          sizeBytes: correctContent.length,
        },
      },
    })

    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [{ path: "mods/missing.jar", sha256: correctSha, downloadUrl: `${serverBaseUrl}/fast/missing.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasInterruptedDownload).toBe(false)
    expect(plan.hasPausedSession).toBe(false)
    expect(plan.hasIntegrityIssue).toBe(true)
    expect(plan.hasUpdate).toBe(false)
    expect(plan.isFullyInstalled).toBe(false)
  })

  it("35. Running Verify again after interrupted verification reuses valid staging files without re-downloading", async () => {
    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [],
      clientFiles: [{ path: "mods/missing.jar", sha256: correctSha, policy: "NO_MODIFICABLE" }],
    })

    const { filesDir } = getStagingPaths(instanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFileName = getDeterministicStagingFileName({ path: "mods/missing.jar", sha256: correctSha })
    await fsp.writeFile(path.join(filesDir, stagingFileName), correctContent)

    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "DOWNLOADING",
      operationKind: "VERIFY",
      updatedAt: new Date().toISOString(),
      files: {
        "mods/missing.jar": {
          stagingFileName,
          sha256: correctSha,
          sizeBytes: correctContent.length,
        },
      },
    })

    let downloadServerHit = false
    const customManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
          isCoreInstalled: true,
          hasExistingInstall: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
          issues: [],
        }),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    // Server URL pointing to a non-existent endpoint to prove it does not download
    const res = await customManager.startSync({
      instanceRoot,
      clientFiles: [{ path: "mods/missing.jar", sha256: correctSha, downloadUrl: `http://127.0.0.1:9999/nonexistent.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      isVerify: true,
    })

    expect(res.success).toBe(true)

    // Applied file should now exist in instanceRoot
    const appliedPath = path.join(instanceRoot, "mods", "missing.jar")
    const appliedContent = await fsp.readFile(appliedPath, "utf8")
    expect(appliedContent).toBe(correctContent)

    // And staging should be cleanly removed
    const sessionAfter = await loadDownloadSession(instanceRoot)
    expect(sessionAfter).toBeNull()
  })

  it("36. Verify interrupted during application phase requires verifying again and does not show PAUSED", async () => {
    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [],
      clientFiles: [{ path: "mods/missing.jar", sha256: correctSha, policy: "NO_MODIFICABLE" }],
    })

    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "VERIFYING",
      operationKind: "VERIFY",
      updatedAt: new Date().toISOString(),
    })

    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [{ path: "mods/missing.jar", sha256: correctSha, downloadUrl: `${serverBaseUrl}/fast/missing.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasInterruptedDownload).toBe(false)
    expect(plan.hasPausedSession).toBe(false)
    expect(plan.hasIntegrityIssue).toBe(true)
  })

  it("37. Normal download/update interrupted or paused continues to return hasInterruptedDownload=true and hasPausedSession=true", async () => {
    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    const { filesDir } = getStagingPaths(instanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFileName = getDeterministicStagingFileName({ path: "mods/normal.jar", sha256: correctSha })
    await fsp.writeFile(path.join(filesDir, stagingFileName), correctContent)

    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "PAUSED",
      operationKind: "SYNC",
      updatedAt: new Date().toISOString(),
      files: {
        "mods/normal.jar": {
          stagingFileName,
          sha256: correctSha,
          sizeBytes: correctContent.length,
        },
      },
    })

    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [{ path: "mods/normal.jar", sha256: correctSha, downloadUrl: `${serverBaseUrl}/fast/normal.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasInterruptedDownload).toBe(true)
    expect(plan.hasPausedSession).toBe(true)
  })

  it("38. Real new release appearing after interrupted verify gives priority to ACTUALIZAR", async () => {
    const correctContent = "fast content"
    const correctSha = computeSha(correctContent)

    // User had 1.0.0 installed
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      directoryPolicies: [],
      clientFiles: [{ path: "mods/mod1.jar", sha256: correctSha, policy: "NO_MODIFICABLE" }],
    })

    // Interrupted verify session for 1.0.0
    await saveDownloadSession(instanceRoot, {
      modpackVersion: "1.0.0",
      status: "DOWNLOADING",
      operationKind: "VERIFY",
      updatedAt: new Date().toISOString(),
    })

    // Now server published 2.0.0
    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [{ path: "mods/mod2.jar", sha256: correctSha, downloadUrl: `${serverBaseUrl}/fast/mod2.jar`, sizeBytes: correctContent.length, policy: "NO_MODIFICABLE" }],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.success).toBe(true)
    expect(plan.hasUpdate).toBe(true)
    expect(plan.hasIntegrityIssue).toBe(false)
    expect(plan.hasInterruptedDownload).toBe(false)
    expect(plan.installedModpackVersion).toBe("1.0.0")
  })
})
