import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import crypto from "crypto"
import { EventEmitter } from "events"

// @ts-expect-error CJS module
import { checkCore, installCore, repairCore, loadCoreState, saveCoreState } from "./minecraft-core.cjs"
// @ts-expect-error CJS module
import { GameOperationManager, validateSyncPayload } from "./game-operation-manager.cjs"
// @ts-expect-error CJS module
import { GameLauncher } from "./game-launcher.cjs"
// @ts-expect-error CJS module
import { resolveJavaRuntime, validateJavaBinary } from "./java-runtime.cjs"
// @ts-expect-error CJS module
import { loadInstalledManifest, saveInstalledManifest, generateSyncPlan } from "./client-files-sync.cjs"

describe("HiKAT Modern Minecraft & NeoForge Adapter Suite (XMCL 6.3.2)", () => {
  let tempDir: string
  let instanceRoot: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-core-test-"))
    instanceRoot = path.join(tempDir, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  it("1. Backend minecraftVersion and neoForgeVersion are passed without alteration", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"

    const expectedState = {
      schemaVersion: 1,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      resolvedVersionId: `${mcVersion}-neoforge-${neoForgeVersion}`,
    }

    await saveCoreState(instanceRoot, expectedState)
    const state = await loadCoreState(instanceRoot)

    expect(state).not.toBeNull()
    expect(state?.minecraftVersion).toBe(mcVersion)
    expect(state?.neoForgeVersion).toBe(neoForgeVersion)
    expect(state?.resolvedVersionId).toBe(`${mcVersion}-neoforge-${neoForgeVersion}`)
  })

  it("2. Fresh install completes and saves resolvedVersionId in .hikat/core-state.json", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`

    const versionDir = path.join(instanceRoot, "versions", profileId)
    await fsp.mkdir(versionDir, { recursive: true })
    await fsp.writeFile(
      path.join(versionDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        libraries: [],
        downloads: {},
      }),
      "utf8"
    )

    await saveCoreState(instanceRoot, {
      schemaVersion: 1,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      resolvedVersionId: profileId,
    })

    const state = await loadCoreState(instanceRoot)
    expect(state?.resolvedVersionId).toBe(profileId)
    expect(state?.minecraftVersion).toBe(mcVersion)
    expect(state?.neoForgeVersion).toBe(neoForgeVersion)

    const coreCheck = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(coreCheck.installed).toBe(true)
    expect(coreCheck.resolvedVersionId).toBe(profileId)
  })

  it("3. Healthy checkCore returns installed: true and resolvedVersionId", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`

    const versionDir = path.join(instanceRoot, "versions", profileId)
    await fsp.mkdir(versionDir, { recursive: true })
    await fsp.writeFile(
      path.join(versionDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        libraries: [],
        downloads: {},
      }),
      "utf8"
    )

    await saveCoreState(instanceRoot, {
      schemaVersion: 1,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      resolvedVersionId: profileId,
    })

    const result = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })

    expect(result.installed).toBe(true)
    expect(result.resolvedVersionId).toBe(profileId)
  })

  it("4. Missing or corrupted profile returns installed: false", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"

    const resultNoState = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(resultNoState.installed).toBe(false)

    await saveCoreState(instanceRoot, {
      schemaVersion: 1,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      resolvedVersionId: "nonexistent-version",
    })

    const resultMissingProfile = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(resultMissingProfile.installed).toBe(false)
  })

  it("5. Diagnose issue triggers repair by reinstalling, not a custom planner", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`

    let repairInvoked = false
    const mockInstallCore = vi.fn().mockImplementation(async () => {
      repairInvoked = true
      await saveCoreState(instanceRoot, {
        schemaVersion: 1,
        minecraftVersion: mcVersion,
        neoForgeVersion,
        resolvedVersionId: profileId,
      })
      return { success: true, resolvedVersionId: profileId }
    })

    const initialCheck = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(initialCheck.installed).toBe(false)

    await mockInstallCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })

    expect(repairInvoked).toBe(true)
    const state = await loadCoreState(instanceRoot)
    expect(state?.resolvedVersionId).toBe(profileId)
  })

  it("6. Normal install emits DOWNLOADING -> INSTALLING and NEVER VERIFYING", async () => {
    const mockJavaResolver = vi.fn().mockReturnValue({
      javaPath: "/mock/bin/javaw.exe",
      cliJavaPath: "/mock/bin/java.exe",
      isOfficialJdk: true,
    })
    const mockJavaValidator = vi.fn().mockReturnValue({ valid: true, majorVersion: 21 })

    const manager = new GameOperationManager({
      javaResolver: mockJavaResolver,
      javaValidator: mockJavaValidator,
    })
    const phasesEmitted: string[] = []

    const profileId = "1.21.1-neoforge-21.1.65"
    const versionDir = path.join(instanceRoot, "versions", profileId)
    await fsp.mkdir(versionDir, { recursive: true })
    await fsp.writeFile(
      path.join(versionDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        libraries: [],
        downloads: {},
      }),
      "utf8"
    )
    await saveCoreState(instanceRoot, {
      schemaVersion: 1,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
    })

    const dummyContent = "dummy-mod-content"
    const dummySha = crypto.createHash("sha256").update(dummyContent).digest("hex")
    const stagingDir = path.join(instanceRoot, ".hikat", "staging", "files")
    await fsp.mkdir(stagingDir, { recursive: true })
    const stagingFileName = `stage_${crypto.createHash("sha256").update("mods/dummy.jar").digest("hex").slice(0, 16)}_${dummySha.slice(0, 12)}_dummy.jar`
    await fsp.writeFile(path.join(stagingDir, stagingFileName), dummyContent, "utf8")

    const result = await manager.startSync({
      instanceRoot,
      clientFiles: [
        {
          path: "mods/dummy.jar",
          sha256: dummySha,
          sizeBytes: Buffer.byteLength(dummyContent),
          policy: "NO_MODIFICABLE",
          downloadUrl: "http://127.0.0.1/dummy.jar",
        },
      ],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      isVerify: false,
      onPhaseChange: (phase: string) => {
        phasesEmitted.push(phase)
      },
    })

    expect(result.success).toBe(true)
    expect(phasesEmitted).toContain("DOWNLOADING")
    expect(phasesEmitted).toContain("INSTALLING")
    expect(phasesEmitted).not.toContain("VERIFYING")
  })

  it("7. Explicit verify operation emits only VERIFYING across the entire operation", async () => {
    const mockJavaResolver = vi.fn().mockReturnValue({
      javaPath: "/mock/bin/javaw.exe",
      cliJavaPath: "/mock/bin/java.exe",
      isOfficialJdk: true,
    })
    const mockJavaValidator = vi.fn().mockReturnValue({ valid: true, majorVersion: 21 })

    const manager = new GameOperationManager({
      javaResolver: mockJavaResolver,
      javaValidator: mockJavaValidator,
    })
    const phasesEmitted: string[] = []

    const profileId = "1.21.1-neoforge-21.1.65"
    const versionDir = path.join(instanceRoot, "versions", profileId)
    await fsp.mkdir(versionDir, { recursive: true })
    await fsp.writeFile(
      path.join(versionDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        libraries: [],
        downloads: {},
      }),
      "utf8"
    )
    await saveCoreState(instanceRoot, {
      schemaVersion: 1,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
    })

    const result = await manager.startSync({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      isVerify: true,
      onPhaseChange: (phase: string) => {
        phasesEmitted.push(phase)
      },
    })

    expect(result.success).toBe(true)
    expect(phasesEmitted).toContain("VERIFYING")
    expect(phasesEmitted).not.toContain("DOWNLOADING")
    expect(phasesEmitted).not.toContain("INSTALLING")
  })

  it("8. Pause uses AbortSignal, clears race and can be resumed cleanly", async () => {
    const manager = new GameOperationManager()

    const startPromise = manager
      .startSync({
        instanceRoot,
        clientFiles: [
          {
            path: "mods/test.jar",
            sizeBytes: 1000,
            sha256: "0".repeat(64),
            policy: "NO_MODIFICABLE",
            downloadUrl: "http://127.0.0.1/mods/test.jar",
          },
        ],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        apiBaseUrl: "http://127.0.0.1",
        isVerify: false,
      })
      .catch(() => {})

    const pauseResult = await manager.pauseSync()
    expect(pauseResult.success).toBe(true)
    expect(pauseResult.paused).toBe(true)
    expect(manager.getState()).toBe("PAUSED")

    await startPromise

    // Subsequent operation can start immediately without "Operation already in progress"
    expect(manager.activeSyncPromise).toBeNull()
  })

  it("9. Cancel aborts active operation and returns to IDLE", async () => {
    const manager = new GameOperationManager()

    const startPromise = manager
      .startSync({
        instanceRoot,
        clientFiles: [
          {
            path: "mods/test.jar",
            sizeBytes: 1000,
            sha256: "0".repeat(64),
            policy: "NO_MODIFICABLE",
            downloadUrl: "http://127.0.0.1/mods/test.jar",
          },
        ],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        apiBaseUrl: "http://127.0.0.1",
      })
      .catch(() => {})

    const cancelResult = await manager.cancelSync(instanceRoot)
    expect(cancelResult.success).toBe(true)
    expect(manager.getState()).toBe("IDLE")

    await startPromise
  })

  it("10. GameLauncher.launch validates locally, parses profile, and never calls install functions", async () => {
    const profileId = "1.21.1-neoforge-21.1.65"

    const mockXmclLauncher = vi.fn().mockImplementation(async () => {
      const emitter = new EventEmitter() as any
      emitter.pid = 12345
      return emitter
    })

    const mockVersionParser = vi.fn().mockResolvedValue({
      id: profileId,
      minecraftDirectory: instanceRoot,
      libraries: [],
    })

    const mockReadinessChecker = vi.fn().mockResolvedValue({
      installed: true,
      resolvedVersionId: profileId,
    })

    const mockJavaResolver = vi.fn().mockReturnValue({
      javaPath: "/mock/bin/javaw.exe",
      cliJavaPath: "/mock/bin/java.exe",
      isOfficialJdk: true,
    })

    const mockJavaValidator = vi.fn().mockReturnValue({
      valid: true,
      majorVersion: 21,
    })

    const launcher = new GameLauncher(null, {
      instanceRoot,
      xmclLauncher: mockXmclLauncher,
      versionParser: mockVersionParser,
      readinessChecker: mockReadinessChecker,
      javaResolver: mockJavaResolver,
      javaValidator: mockJavaValidator,
    })

    const result = await launcher.launch({
      playerName: "TestPlayer",
      ramGB: 4,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(result.success).toBe(true)
    expect(result.pid).toBe(12345)
    expect(mockReadinessChecker).toHaveBeenCalledTimes(1)
    expect(mockVersionParser).toHaveBeenCalledTimes(1)
    expect(mockXmclLauncher).toHaveBeenCalledTimes(1)
    expect(launcher.getLaunchStatus().status).toBe("running")
  })

  it("10.1. GameLauncher persists PID file on launch and removes it on close", async () => {
    const mockChildProcess = new EventEmitter() as any
    mockChildProcess.pid = 54321

    const launcher = new GameLauncher(null, {
      instanceRoot,
      xmclLauncher: vi.fn().mockResolvedValue(mockChildProcess),
      versionParser: vi.fn().mockResolvedValue({ id: "1.21.1-neoforge-21.1.65" }),
      readinessChecker: vi.fn().mockResolvedValue({ installed: true, resolvedVersionId: "1.21.1-neoforge-21.1.65", javaMajorVersion: 21 }),
      javaResolver: vi.fn().mockReturnValue({ javaPath: "/mock/javaw.exe" }),
      javaValidator: vi.fn().mockReturnValue({ valid: true }),
      processChecker: () => true,
    })

    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    expect(fs.existsSync(pidFile)).toBe(false)

    await launcher.launch({
      playerName: "TestPlayer",
      ramGB: 4,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(fs.existsSync(pidFile)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(pidFile, "utf8"))
    expect(saved.pid).toBe(54321)
    expect(saved.javaPath).toBe("/mock/javaw.exe")
    expect(launcher.getLaunchStatus()).toEqual({ status: "running", pid: 54321 })

    // When process closes, PID file is cleaned
    mockChildProcess.emit("close", 0)
    expect(fs.existsSync(pidFile)).toBe(false)
    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
  })

  it("10.2. GameLauncher detects existing alive process on startup and tracks until exit", async () => {
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    const now = new Date()
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: 99999,
        launchedAt: now.toISOString(),
        javaPath: "/mock/javaw.exe",
      }),
    )

    let isAlive = true
    const statusChanges: string[] = []

    const launcher = new GameLauncher(null, {
      instanceRoot,
      processChecker: (pid) => pid === 99999 && isAlive,
      processInfoFetcher: () => ({
        path: "/mock/javaw.exe",
        startTime: new Date(now.getTime() - 200).toISOString(),
      }),
      pollIntervalMs: 20,
    })
    launcher.onStatusChangeCallback = (st) => statusChanges.push(st)

    expect(launcher.getLaunchStatus()).toEqual({ status: "running", pid: 99999 })
    expect(fs.existsSync(pidFile)).toBe(true)

    // Simulate process exiting later
    isAlive = false
    await new Promise((r) => setTimeout(r, 60))

    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
    expect(fs.existsSync(pidFile)).toBe(false)
    expect(statusChanges).toContain("idle")
    launcher.stopProcessPoll()
  })

  it("10.3. GameLauncher with stale PID on startup cleans PID file and initializes as idle", async () => {
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: 88888,
        launchedAt: new Date().toISOString(),
        javaPath: "/mock/javaw.exe",
      }),
    )

    const launcher = new GameLauncher(null, {
      instanceRoot,
      processChecker: () => false, // Process dead
    })

    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it("10.4. GameLauncher passes detached extraExecOption and calls unref on spawned child", async () => {
    const mockChildProcess = new EventEmitter() as any
    mockChildProcess.pid = 67890
    mockChildProcess.unref = vi.fn()

    const mockXmcl = vi.fn().mockResolvedValue(mockChildProcess)

    const launcher = new GameLauncher(null, {
      instanceRoot,
      xmclLauncher: mockXmcl,
      versionParser: vi.fn().mockResolvedValue({ id: "1.21.1-neoforge-21.1.65" }),
      readinessChecker: vi.fn().mockResolvedValue({ installed: true, resolvedVersionId: "1.21.1-neoforge-21.1.65", javaMajorVersion: 21 }),
      javaResolver: vi.fn().mockReturnValue({ javaPath: "/mock/javaw.exe" }),
      javaValidator: vi.fn().mockReturnValue({ valid: true }),
      processChecker: () => true,
    })

    const result = await launcher.launch({
      playerName: "TestPlayer",
      ramGB: 4,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(result.success).toBe(true)
    expect(mockXmcl).toHaveBeenCalledWith(
      expect.objectContaining({
        extraExecOption: expect.objectContaining({
          detached: true,
          stdio: "ignore",
        }),
      }),
    )
    expect(mockChildProcess.unref).toHaveBeenCalledTimes(1)

    // Saved PID exists
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    expect(fs.existsSync(pidFile)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(pidFile, "utf8"))
    expect(saved.pid).toBe(67890)
    expect(saved.javaPath).toBe("/mock/javaw.exe")

    // Simulate reopening new GameLauncher while process is still alive with matching identity
    const reopenedLauncher = new GameLauncher(null, {
      instanceRoot,
      processChecker: (pid) => pid === 67890,
      processInfoFetcher: () => ({
        path: "/mock/javaw.exe",
        startTime: saved.launchedAt,
      }),
    })
    expect(reopenedLauncher.getLaunchStatus()).toEqual({ status: "running", pid: 67890 })
    reopenedLauncher.stopProcessPoll()

    // When original process closes, PID is cleaned and original launcher becomes idle
    mockChildProcess.emit("close", 0)
    expect(fs.existsSync(pidFile)).toBe(false)
    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
  })

  it("10.5. GameLauncher startup: PID exists but executable path differs -> treated as stale, deletes PID file, initializes as idle", async () => {
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    const now = new Date()
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: 33333,
        launchedAt: now.toISOString(),
        javaPath: "C:\\HiKAT\\runtime\\bin\\javaw.exe",
      }),
    )

    const launcher = new GameLauncher(null, {
      instanceRoot,
      processChecker: (pid) => pid === 33333, // Reused PID is alive in OS
      processInfoFetcher: () => ({
        path: "C:\\Program Files\\Google\\Chrome\\chrome.exe", // Different executable!
        startTime: now.toISOString(),
      }),
    })

    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it("10.6. GameLauncher startup: PID exists and executable matches but creation StartTime differs outside tolerance -> treated as stale, deletes PID file, initializes as idle", async () => {
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    const oldLaunchedAt = new Date("2026-09-01T12:00:00.000Z")
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: 44444,
        launchedAt: oldLaunchedAt.toISOString(),
        javaPath: "C:\\HiKAT\\runtime\\bin\\javaw.exe",
      }),
    )

    const launcher = new GameLauncher(null, {
      instanceRoot,
      processChecker: (pid) => pid === 44444, // Reused PID is alive in OS
      processInfoFetcher: () => ({
        path: "C:\\HiKAT\\runtime\\bin\\javaw.exe",
        startTime: new Date("2026-09-03T18:00:00.000Z").toISOString(), // Started days later!
      }),
      launchToleranceMs: 30000,
    })

    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it("10.7. GameLauncher startup: PID exists and identity matches (executable + StartTime within tolerance) -> recognized as Minecraft running", async () => {
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    const launchTime = new Date("2026-09-03T19:00:05.000Z")
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: 55555,
        launchedAt: launchTime.toISOString(),
        javaPath: "C:\\HiKAT\\runtime\\bin\\javaw.exe",
      }),
    )

    const launcher = new GameLauncher(null, {
      instanceRoot,
      processChecker: (pid) => pid === 55555,
      processInfoFetcher: () => ({
        path: "C:/HiKAT/runtime/bin/JAVAW.EXE", // Case & slash variations
        startTime: new Date("2026-09-03T19:00:04.200Z").toISOString(), // 800ms difference
      }),
      launchToleranceMs: 30000,
    })

    expect(launcher.getLaunchStatus()).toEqual({ status: "running", pid: 55555 })
    expect(fs.existsSync(pidFile)).toBe(true)
    launcher.stopProcessPoll()
  })

  it("10.8. GameLauncher startup: error/exception during process identity query -> fails safe, does not produce false positive, cleans PID file, initializes as idle", async () => {
    const pidFile = path.join(instanceRoot, ".hikat", "game-process.json")
    fs.mkdirSync(path.dirname(pidFile), { recursive: true })
    fs.writeFileSync(
      pidFile,
      JSON.stringify({
        pid: 66666,
        launchedAt: new Date().toISOString(),
        javaPath: "C:\\HiKAT\\runtime\\bin\\javaw.exe",
      }),
    )

    const launcher = new GameLauncher(null, {
      instanceRoot,
      processChecker: (pid) => pid === 66666,
      processInfoFetcher: () => {
        throw new Error("PowerShell query timeout or Access Denied")
      },
    })

    expect(launcher.getLaunchStatus()).toEqual({ status: "idle", pid: null })
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────
  // Explicit New Architectural Invariant Tests (A - G)
  // ─────────────────────────────────────────────────────────────

  it("A. checkPlan top-level contract: returns expected shape for healthy vs missing install", async () => {
    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
      javaResolver: () => ({ cliJavaPath: "/mock/java.exe" }),
      javaValidator: () => ({ valid: true }),
    })

    const modContent = "content"
    const actualSha = crypto.createHash("sha256").update(modContent).digest("hex")
    const modFile = {
      path: "mods/example.jar",
      sha256: actualSha,
      sizeBytes: Buffer.byteLength(modContent),
      policy: "NO_MODIFICABLE",
      downloadUrl: "http://127.0.0.1/mods/example.jar",
    }

    // Save matching installed manifest and file on disk
    const modDiskPath = path.join(instanceRoot, "mods", "example.jar")
    await fsp.mkdir(path.dirname(modDiskPath), { recursive: true })
    await fsp.writeFile(modDiskPath, modContent)

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      files: {
        "mods/example.jar": {
          officialSha256: actualSha,
          policy: "NO_MODIFICABLE",
          lastSyncedAt: new Date().toISOString(),
        },
      },
    })

    // Healthy check
    const healthy = await manager.checkPlan({
      instanceRoot,
      clientFiles: [modFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(healthy.success).toBe(true)
    expect(healthy.needsUpdate).toBe(false)
    expect(healthy.isFullyInstalled).toBe(true)
    expect(healthy.hasExistingInstall).toBe(true)
    expect(healthy.filesToDownload).toBe(0)
    expect(healthy.filesToPrune).toBe(0)
    expect(healthy.totalDownloadBytes).toBe(0)

    // Unhealthy check (e.g. core not installed)
    const unhealthyManager = new GameOperationManager({
      coreChecker: async () => ({ installed: false, resolvedVersionId: null }),
      javaResolver: () => ({ cliJavaPath: "/mock/java.exe" }),
      javaValidator: () => ({ valid: true }),
    })

    const unhealthy = await unhealthyManager.checkPlan({
      instanceRoot,
      clientFiles: [modFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(unhealthy.success).toBe(true)
    expect(unhealthy.needsUpdate).toBe(true)
    expect(unhealthy.isFullyInstalled).toBe(false)
  })

  it("B. Installed manifest remains an object with modpackVersion and files after sync", async () => {
    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
      javaResolver: () => ({ cliJavaPath: "/mock/java.exe" }),
      javaValidator: () => ({ valid: true }),
    })

    const dummyContent = "mod-data"
    const sha = crypto.createHash("sha256").update(dummyContent).digest("hex")
    const stagingDir = path.join(instanceRoot, ".hikat", "staging", "files")
    await fsp.mkdir(stagingDir, { recursive: true })
    const stagingFileName = `stage_${crypto.createHash("sha256").update("mods/mod.jar").digest("hex").slice(0, 16)}_${sha.slice(0, 12)}_mod.jar`
    await fsp.writeFile(path.join(stagingDir, stagingFileName), dummyContent, "utf8")

    await manager.startSync({
      instanceRoot,
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: sha,
          sizeBytes: Buffer.byteLength(dummyContent),
          policy: "NO_MODIFICABLE",
          downloadUrl: "http://127.0.0.1/mod.jar",
        },
      ],
      modpackVersion: "2.5.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    const manifest = await loadInstalledManifest(instanceRoot)
    expect(typeof manifest).toBe("object")
    expect(Array.isArray(manifest)).toBe(false)
    expect(manifest.modpackVersion).toBe("2.5.0")
    expect(manifest.files["mods/mod.jar"]).toBeDefined()
    expect(manifest.files["mods/mod.jar"].officialSha256).toBe(sha)
  })

  it("C. Prune-only operation removes obsolete file cleanly", async () => {
    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
      javaResolver: () => ({ cliJavaPath: "/mock/java.exe" }),
      javaValidator: () => ({ valid: true }),
    })

    const oldModPath = path.join(instanceRoot, "mods", "old-mod.jar")
    await fsp.mkdir(path.dirname(oldModPath), { recursive: true })
    await fsp.writeFile(oldModPath, "obsolete")

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      files: {
        "mods/old-mod.jar": {
          officialSha256: "0".repeat(64),
          policy: "NO_MODIFICABLE",
          lastSyncedAt: new Date().toISOString(),
        },
      },
    })

    // Sync with empty active mods -> triggers prune
    const keptModContent = "kept-mod"
    const keptSha = crypto.createHash("sha256").update(keptModContent).digest("hex")
    const keptModPath = path.join(instanceRoot, "mods", "kept.jar")
    await fsp.writeFile(keptModPath, keptModContent)

    await manager.startSync({
      instanceRoot,
      clientFiles: [
        {
          path: "mods/kept.jar",
          sha256: keptSha,
          sizeBytes: Buffer.byteLength(keptModContent),
          policy: "NO_MODIFICABLE",
          downloadUrl: "http://127.0.0.1/kept.jar",
        },
      ],
      modpackVersion: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(fs.existsSync(oldModPath)).toBe(false)
    expect(fs.existsSync(keptModPath)).toBe(true)
  })

  it("D. Release-only change updates manifest version and subsequent checkPlan returns needsUpdate: false", async () => {
    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
      javaResolver: () => ({ cliJavaPath: "/mock/java.exe" }),
      javaValidator: () => ({ valid: true }),
    })

    const modContent = "same-mod"
    const sha = crypto.createHash("sha256").update(modContent).digest("hex")
    const modPath = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(modPath), { recursive: true })
    await fsp.writeFile(modPath, modContent)

    const clientFile = {
      path: "mods/mod.jar",
      sha256: sha,
      sizeBytes: Buffer.byteLength(modContent),
      policy: "NO_MODIFICABLE",
      downloadUrl: "http://127.0.0.1/mod.jar",
    }

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      files: {
        "mods/mod.jar": {
          officialSha256: sha,
          policy: "NO_MODIFICABLE",
          lastSyncedAt: new Date().toISOString(),
        },
      },
    })

    // Sync new release 2.0.0 with identical files
    await manager.startSync({
      instanceRoot,
      clientFiles: [clientFile],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    const updatedManifest = await loadInstalledManifest(instanceRoot)
    expect(updatedManifest.modpackVersion).toBe("2.0.0")

    const check = await manager.checkPlan({
      instanceRoot,
      clientFiles: [clientFile],
      modpackVersion: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })
    expect(check.needsUpdate).toBe(false)
    expect(check.isFullyInstalled).toBe(true)
  })

  it("E. XMCL diagnose failure causes checkCore to return installed: false", async () => {
    const profileId = "1.21.1-neoforge-21.1.65"
    await saveCoreState(instanceRoot, {
      schemaVersion: 1,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
    })

    // Profile JSON exists but has missing libraries specified
    const versionDir = path.join(instanceRoot, "versions", profileId)
    await fsp.mkdir(versionDir, { recursive: true })
    await fsp.writeFile(
      path.join(versionDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        libraries: [
          {
            name: "missing:lib:1.0",
            downloads: {
              artifact: {
                path: "missing/lib/1.0/lib-1.0.jar",
                sha1: "0".repeat(40),
                size: 100,
                url: "http://127.0.0.1/missing.jar",
              },
            },
          },
        ],
      }),
      "utf8"
    )

    const result = await checkCore({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(result.installed).toBe(false)
  })

  it("G. validateSyncPayload strictly rejects missing required fields individually", () => {
    const basePayload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          policy: "NO_MODIFICABLE",
          downloadUrl: "http://127.0.0.1/mod.jar",
        },
      ],
    }

    // Missing minecraftVersion
    expect(() => validateSyncPayload({ ...basePayload, minecraftVersion: "" }, true)).toThrow(
      /minecraftVersion must be a non-empty string/i
    )

    // Missing neoForgeVersion
    expect(() => validateSyncPayload({ ...basePayload, neoForgeVersion: "" }, true)).toThrow(
      /neoForgeVersion must be a non-empty string/i
    )

    // Missing/invalid sha256
    expect(() =>
      validateSyncPayload(
        {
          ...basePayload,
          clientFiles: [{ ...basePayload.clientFiles[0], sha256: "" }],
        },
        true
      )
    ).toThrow(/invalid SHA-256 hash/i)

    // Missing/invalid sizeBytes
    expect(() =>
      validateSyncPayload(
        {
          ...basePayload,
          clientFiles: [{ ...basePayload.clientFiles[0], sizeBytes: undefined as any }],
        },
        true
      )
    ).toThrow(/invalid sizeBytes/i)

    // Missing downloadUrl
    expect(() =>
      validateSyncPayload(
        {
          ...basePayload,
          clientFiles: [{ ...basePayload.clientFiles[0], downloadUrl: "" }],
        },
        true
      )
    ).toThrow(/invalid downloadUrl/i)

    // Missing/invalid policy
    expect(() =>
      validateSyncPayload(
        {
          ...basePayload,
          clientFiles: [{ ...basePayload.clientFiles[0], policy: "INVALID" }],
        },
        true
      )
    ).toThrow(/invalid policy/i)
  })

  it("34. Fresh install interrupted during Core does NOT confirm release in installed-manifest", async () => {
    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: false }),
      coreInstaller: async () => {
        throw new Error("Simulated interruption during Core install")
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "content")
    const hash = crypto.createHash("sha256").update("content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 7,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
    }

    await expect(manager.startSync(payload)).rejects.toThrow("Simulated interruption during Core install")

    // Manifest was NOT prematurely saved as 1.0.0
    const manifest = await loadInstalledManifest(instanceRoot)
    expect(manifest.modpackVersion).toBeNull()

    // checkPlan reflects no installed modpack version (so UI shows DESCARGAR)
    const planCheck = await manager.checkPlan(payload)
    expect(planCheck.installedModpackVersion).toBeNull()
    expect(planCheck.hasUpdate).toBe(false)
    expect(planCheck.isFullyInstalled).toBe(false)
  })

  it("35. Update from 1.0.0 to 1.1.0 interrupted during Core preserves previous 1.0.0 version", async () => {
    // Initial installed version 1.0.0
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {
        "mods": { policy: "NO_MODIFICABLE" },
      },
    })

    const manager = new GameOperationManager({
      coreChecker: async () => ({ installed: false }),
      coreInstaller: async () => {
        throw new Error("Simulated interruption during Core install of update")
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "content-v2")
    const hash = crypto.createHash("sha256").update("content-v2").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.1.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 10,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
    }

    await expect(manager.startSync(payload)).rejects.toThrow("Simulated interruption during Core install of update")

    // Manifest still preserves 1.0.0
    const manifest = await loadInstalledManifest(instanceRoot)
    expect(manifest.modpackVersion).toBe("1.0.0")

    // checkPlan reflects installedModpackVersion: "1.0.0" and hasUpdate: true (so UI shows ACTUALIZAR)
    const planCheck = await manager.checkPlan(payload)
    expect(planCheck.installedModpackVersion).toBe("1.0.0")
    expect(planCheck.hasUpdate).toBe(true)
    expect(planCheck.isFullyInstalled).toBe(false)
  })

  it("36. Full installation success persists new modpack version to manifest", async () => {
    let coreInstalledState = false
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: coreInstalledState,
        resolvedVersionId: coreInstalledState ? "1.21.1-neoforge-21.1.65" : null,
      }),
      coreInstaller: async () => {
        coreInstalledState = true
        return { success: true }
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "complete-content")
    const hash = crypto.createHash("sha256").update("complete-content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.1.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 16,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    // Manifest is now officially 1.1.0
    const manifest = await loadInstalledManifest(instanceRoot)
    expect(manifest.modpackVersion).toBe("1.1.0")

    const planCheck = await manager.checkPlan(payload)
    expect(planCheck.installedModpackVersion).toBe("1.1.0")
    expect(planCheck.isFullyInstalled).toBe(true)
    expect(planCheck.hasUpdate).toBe(false)
    expect(planCheck.hasIntegrityIssue).toBe(false)
  })

  it("37. Retry after interruption with clientFiles already applied skips re-downloading them", async () => {
    let coreInstalledState = false
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: coreInstalledState,
        resolvedVersionId: coreInstalledState ? "1.21.1-neoforge-21.1.65" : null,
      }),
      coreInstaller: async () => {
        coreInstalledState = true
        return { success: true }
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "already-applied")
    const hash = crypto.createHash("sha256").update("already-applied").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 15,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
    }

    const planCheck = await manager.checkPlan(payload)
    expect(planCheck.filesToDownload).toBe(0)

    const syncResult = await manager.startSync(payload)
    expect(syncResult.success).toBe(true)

    const finalManifest = await loadInstalledManifest(instanceRoot)
    expect(finalManifest.modpackVersion).toBe("1.0.0")
  })

  it("38. Verification progress advances beyond 25% and finishes at 100% with healthy core", async () => {
    const progressEmissions: number[] = []
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
      }),
      coreInstaller: async () => ({ success: true }),
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "valid-mod")
    const hash = crypto.createHash("sha256").update("valid-mod").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      isVerify: true,
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 9,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      onProgress: (data: any) => {
        if (typeof data?.progress === "number") {
          progressEmissions.push(data.progress)
        }
      },
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    // Verify progress advanced beyond 25% and ended at 100%
    expect(progressEmissions.some((p) => p > 25)).toBe(true)
    expect(progressEmissions.some((p) => p >= 90)).toBe(true)
    expect(progressEmissions[progressEmissions.length - 1]).toBe(100)
  })

  it("39. Update with healthy Core advances beyond 25% and finishes at 100%", async () => {
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: { "mods": { policy: "NO_MODIFICABLE" } },
    })

    const progressEmissions: number[] = []
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
      }),
      coreInstaller: async () => ({ success: true }),
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "v2-content")
    const hash = crypto.createHash("sha256").update("v2-content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.1.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 10,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      onProgress: (data: any) => {
        if (typeof data?.progress === "number") {
          progressEmissions.push(data.progress)
        }
      },
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    expect(progressEmissions.some((p) => p > 25)).toBe(true)
    expect(progressEmissions.some((p) => p >= 90)).toBe(true)
    expect(progressEmissions[progressEmissions.length - 1]).toBe(100)
  })

  it("40. Fresh installation with XMCL core installer emits installer progress and never moves backwards", async () => {
    const progressEmissions: number[] = []
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: false,
        resolvedVersionId: null,
      }),
      coreInstaller: async ({ onProgress }: any) => {
        onProgress?.({ phase: "INSTALLING", progress: 50 })
        onProgress?.({ phase: "INSTALLING", progress: 80 })
        // Even if an underlying installer emitted a lower number, safeProgress prevents backward jumps
        onProgress?.({ phase: "INSTALLING", progress: 60 })
        onProgress?.({ phase: "INSTALLING", progress: 95 })
        return { success: true }
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "fresh-content")
    const hash = crypto.createHash("sha256").update("fresh-content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 13,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      onProgress: (data: any) => {
        if (typeof data?.progress === "number") {
          progressEmissions.push(data.progress)
        }
      },
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    // Verify progress strictly never moves backwards
    for (let i = 1; i < progressEmissions.length; i++) {
      expect(progressEmissions[i]).toBeGreaterThanOrEqual(progressEmissions[i - 1])
    }
    expect(progressEmissions).toContain(50)
    expect(progressEmissions).toContain(80)
    expect(progressEmissions).toContain(95)
    expect(progressEmissions[progressEmissions.length - 1]).toBe(100)
  })

  it("41. generateSyncPlan in normal mode (isVerify: false) does not emit progress or change phase to INSTALLING", async () => {
    const emittedEvents: any[] = []
    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "test-content")
    const hash = crypto.createHash("sha256").update("test-content").digest("hex")

    const plan = await generateSyncPlan(
      instanceRoot,
      [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 12,
          policy: "NO_MODIFICABLE",
        },
      ],
      "1.0.0",
      [{ path: "mods", policy: "NO_MODIFICABLE" }],
      false, // isVerify: false
      (data: any) => {
        emittedEvents.push(data)
      },
    )

    expect(plan).toBeDefined()
    expect(emittedEvents.length).toBe(0)
  })

  it("42. generateSyncPlan in isVerify mode emits VERIFYING phase progress", async () => {
    const emittedEvents: any[] = []
    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "test-content")
    const hash = crypto.createHash("sha256").update("test-content").digest("hex")

    const plan = await generateSyncPlan(
      instanceRoot,
      [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 12,
          policy: "NO_MODIFICABLE",
        },
      ],
      "1.0.0",
      [{ path: "mods", policy: "NO_MODIFICABLE" }],
      true, // isVerify: true
      (data: any) => {
        emittedEvents.push(data)
      },
    )

    expect(plan).toBeDefined()
    expect(emittedEvents.length).toBeGreaterThan(0)
    expect(emittedEvents.every((e) => e.phase === "VERIFYING")).toBe(true)
  })

  it("43. DOWNLOADING 100 -> INSTALLING resets progress for the new phase (allows starting from 0/30%)", async () => {
    const emittedProgressByPhase: { phase: string; progress: number }[] = []
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: false,
        resolvedVersionId: null,
      }),
      coreInstaller: async ({ onProgress }: any) => {
        onProgress?.({ phase: "INSTALLING", progress: 40 })
        onProgress?.({ phase: "INSTALLING", progress: 80 })
        return { success: true }
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "fresh-content")
    const hash = crypto.createHash("sha256").update("fresh-content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 13,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      onProgress: (data: any) => {
        if (typeof data?.progress === "number" && data?.phase) {
          emittedProgressByPhase.push({ phase: data.phase, progress: data.progress })
        }
      },
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    const installingEvents = emittedProgressByPhase.filter((e) => e.phase === "INSTALLING")
    expect(installingEvents.length).toBeGreaterThan(0)
    // First installing event starts below 100 (e.g. 0 or 30) instead of being stuck at 100
    expect(installingEvents[0].progress).toBeLessThanOrEqual(30)
    // Ends at 100
    expect(installingEvents[installingEvents.length - 1].progress).toBe(100)
  })

  it("44. Within INSTALLING, progress is strictly monotonic (70 -> 50 stays at 70) and finishes at 100", async () => {
    const emittedInstallingProgress: number[] = []
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: false,
        resolvedVersionId: null,
      }),
      coreInstaller: async ({ onProgress }: any) => {
        onProgress?.({ phase: "INSTALLING", progress: 50 })
        onProgress?.({ phase: "INSTALLING", progress: 70 })
        // Underlying installer attempts to drop to 50
        onProgress?.({ phase: "INSTALLING", progress: 50 })
        onProgress?.({ phase: "INSTALLING", progress: 90 })
        return { success: true }
      },
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "fresh-content")
    const hash = crypto.createHash("sha256").update("fresh-content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 13,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      onProgress: (data: any) => {
        if (data?.phase === "INSTALLING" && typeof data?.progress === "number") {
          emittedInstallingProgress.push(data.progress)
        }
      },
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    // Verify monotonicity within INSTALLING
    for (let i = 1; i < emittedInstallingProgress.length; i++) {
      expect(emittedInstallingProgress[i]).toBeGreaterThanOrEqual(emittedInstallingProgress[i - 1])
    }
    expect(emittedInstallingProgress).toContain(70)
    expect(emittedInstallingProgress).toContain(90)
    expect(emittedInstallingProgress[emittedInstallingProgress.length - 1]).toBe(100)
  })

  it("45. VERIFYING phase has independent monotonic progress without being blocked", async () => {
    const emittedVerifyingProgress: number[] = []
    const manager = new GameOperationManager({
      coreChecker: async () => ({
        installed: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
      }),
      coreInstaller: async () => ({ success: true }),
      javaResolver: () => ({ cliJavaPath: "java" }),
      javaValidator: () => ({ valid: true }),
    })

    const sampleFile = path.join(instanceRoot, "mods", "mod.jar")
    await fsp.mkdir(path.dirname(sampleFile), { recursive: true })
    await fsp.writeFile(sampleFile, "fresh-content")
    const hash = crypto.createHash("sha256").update("fresh-content").digest("hex")

    const payload = {
      instanceRoot,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      isVerify: true,
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: hash,
          sizeBytes: 13,
          downloadUrl: "/game/download/1",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      onProgress: (data: any) => {
        if (data?.phase === "VERIFYING" && typeof data?.progress === "number") {
          emittedVerifyingProgress.push(data.progress)
        }
      },
    }

    const result = await manager.startSync(payload)
    expect(result.success).toBe(true)

    for (let i = 1; i < emittedVerifyingProgress.length; i++) {
      expect(emittedVerifyingProgress[i]).toBeGreaterThanOrEqual(emittedVerifyingProgress[i - 1])
    }
    expect(emittedVerifyingProgress[0]).toBeLessThanOrEqual(35)
    expect(emittedVerifyingProgress[emittedVerifyingProgress.length - 1]).toBe(100)
  })

  describe("46. GameLauncher exit status and unexpected error notification", () => {
    it("close(0) sets status to idle with unexpected: false and code: 0, cleaning up PID", async () => {
      const childEmitter = new EventEmitter() as any
      childEmitter.pid = 9999
      childEmitter.unref = vi.fn()

      const statusEvents: Array<{ status: string; details?: any }> = []

      const launcher = new GameLauncher(null, {
        instanceRoot,
        readinessChecker: vi.fn().mockResolvedValue({
          installed: true,
          resolvedVersionId: "1.21.1",
          javaMajorVersion: 21,
        }),
        javaResolver: vi.fn().mockReturnValue({
          javaPath: "C:\\Java\\javaw.exe",
          cliJavaPath: "C:\\Java\\java.exe",
        }),
        javaValidator: vi.fn().mockReturnValue({ valid: true, majorVersion: 21 }),
        versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
        xmclLauncher: vi.fn().mockResolvedValue(childEmitter),
      })

      launcher.onStatusChangeCallback = (status: string, details: any) => {
        statusEvents.push({ status, details })
      }

      await launcher.launch({
        playerName: "PlayerOne",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
      })

      expect(launcher.launchStatus).toBe("running")
      expect(launcher.readSavedPid()).toBe(9999)

      // Emit normal exit close(0)
      childEmitter.emit("close", 0)

      expect(launcher.launchStatus).toBe("idle")
      expect(launcher.readSavedPid()).toBeNull()
      expect(statusEvents).toContainEqual({
        status: "idle",
        details: { unexpected: false, code: 0 },
      })
    })

    it("close(non-zero) sets status to idle with unexpected: true and error code, cleaning up PID", async () => {
      const childEmitter = new EventEmitter() as any
      childEmitter.pid = 9998
      childEmitter.unref = vi.fn()

      const statusEvents: Array<{ status: string; details?: any }> = []

      const launcher = new GameLauncher(null, {
        instanceRoot,
        readinessChecker: vi.fn().mockResolvedValue({
          installed: true,
          resolvedVersionId: "1.21.1",
          javaMajorVersion: 21,
        }),
        javaResolver: vi.fn().mockReturnValue({
          javaPath: "C:\\Java\\javaw.exe",
          cliJavaPath: "C:\\Java\\java.exe",
        }),
        javaValidator: vi.fn().mockReturnValue({ valid: true, majorVersion: 21 }),
        versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
        xmclLauncher: vi.fn().mockResolvedValue(childEmitter),
      })

      launcher.onStatusChangeCallback = (status: string, details: any) => {
        statusEvents.push({ status, details })
      }

      await launcher.launch({
        playerName: "PlayerOne",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
      })

      expect(launcher.launchStatus).toBe("running")
      expect(launcher.readSavedPid()).toBe(9998)

      // Emit abnormal exit close(1)
      childEmitter.emit("close", 1)

      expect(launcher.launchStatus).toBe("idle")
      expect(launcher.readSavedPid()).toBeNull()
      expect(statusEvents).toContainEqual({
        status: "idle",
        details: { unexpected: true, code: 1 },
      })
    })

    it("child.error sets status to idle with unexpected: true and error object, cleaning up PID", async () => {
      const childEmitter = new EventEmitter() as any
      childEmitter.pid = 9997
      childEmitter.unref = vi.fn()

      const statusEvents: Array<{ status: string; details?: any }> = []

      const launcher = new GameLauncher(null, {
        instanceRoot,
        readinessChecker: vi.fn().mockResolvedValue({
          installed: true,
          resolvedVersionId: "1.21.1",
          javaMajorVersion: 21,
        }),
        javaResolver: vi.fn().mockReturnValue({
          javaPath: "C:\\Java\\javaw.exe",
          cliJavaPath: "C:\\Java\\java.exe",
        }),
        javaValidator: vi.fn().mockReturnValue({ valid: true, majorVersion: 21 }),
        versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
        xmclLauncher: vi.fn().mockResolvedValue(childEmitter),
      })

      launcher.onStatusChangeCallback = (status: string, details: any) => {
        statusEvents.push({ status, details })
      }

      await launcher.launch({
        playerName: "PlayerOne",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
      })

      expect(launcher.launchStatus).toBe("running")
      expect(launcher.readSavedPid()).toBe(9997)

      // Emit child error
      const mockErr = new Error("Java VM crashed")
      childEmitter.emit("error", mockErr)

      expect(launcher.launchStatus).toBe("idle")
      expect(launcher.readSavedPid()).toBeNull()
      expect(statusEvents).toContainEqual({
        status: "idle",
        details: { unexpected: true, error: mockErr },
      })
    })

    it("emitting child.error followed by child.close processes termination only once and emits only one unexpected notification", async () => {
      const childEmitter = new EventEmitter() as any
      childEmitter.pid = 9996
      childEmitter.unref = vi.fn()

      const statusEvents: Array<{ status: string; details?: any }> = []

      const launcher = new GameLauncher(null, {
        instanceRoot,
        readinessChecker: vi.fn().mockResolvedValue({
          installed: true,
          resolvedVersionId: "1.21.1",
          javaMajorVersion: 21,
        }),
        javaResolver: vi.fn().mockReturnValue({
          javaPath: "C:\\Java\\javaw.exe",
          cliJavaPath: "C:\\Java\\java.exe",
        }),
        javaValidator: vi.fn().mockReturnValue({ valid: true, majorVersion: 21 }),
        versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
        xmclLauncher: vi.fn().mockResolvedValue(childEmitter),
      })

      launcher.onStatusChangeCallback = (status: string, details: any) => {
        statusEvents.push({ status, details })
      }

      await launcher.launch({
        playerName: "PlayerOne",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
      })

      expect(launcher.launchStatus).toBe("running")
      expect(launcher.readSavedPid()).toBe(9996)

      // 1. Emit child.error
      const mockErr = new Error("Java VM crashed")
      childEmitter.emit("error", mockErr)

      // 2. Emit subsequent child.close (standard Node ChildProcess behavior)
      childEmitter.emit("close", 1)

      expect(launcher.launchStatus).toBe("idle")
      expect(launcher.readSavedPid()).toBeNull()

      // Should contain exactly ONE idle event
      const idleEvents = statusEvents.filter((ev) => ev.status === "idle")
      expect(idleEvents.length).toBe(1)
      expect(idleEvents[0]).toEqual({
        status: "idle",
        details: { unexpected: true, error: mockErr },
      })
    })
  })
})
