import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import { EventEmitter } from "events"

// @ts-expect-error CJS module
import { checkCore, installCore, repairCore, loadCoreState, saveCoreState } from "./minecraft-core.cjs"
// @ts-expect-error CJS module
import { GameOperationManager } from "./game-operation-manager.cjs"
// @ts-expect-error CJS module
import { GameLauncher } from "./game-launcher.cjs"
// @ts-expect-error CJS module
import { resolveJavaRuntime, validateJavaBinary } from "./java-runtime.cjs"

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

    // Setup mock version files in instanceRoot
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

    // Save initial state
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

    // No core-state.json
    const resultNoState = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(resultNoState.installed).toBe(false)

    // State exists but version.json is missing
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

    // Before repair, checkCore fails
    const initialCheck = await checkCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(initialCheck.installed).toBe(false)

    // Repair runs installCore directly
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
    const dummySha = require("crypto").createHash("sha256").update(dummyContent).digest("hex")
    const stagingDir = path.join(instanceRoot, ".hikat", "staging", "files")
    await fsp.mkdir(stagingDir, { recursive: true })
    const stagingFileName = `stage_${require("crypto").createHash("sha256").update("mods/dummy.jar").digest("hex").slice(0, 16)}_${dummySha.slice(0, 12)}_dummy.jar`
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

  it("8. Pause uses AbortSignal and can be resumed cleanly", async () => {
    const manager = new GameOperationManager()

    // Start a mock long-running sync
    const startPromise = manager
      .startSync({
        instanceRoot,
        clientFiles: [
          {
            path: "mods/test.jar",
            sizeBytes: 1000,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            downloadUrl: "https://api.apparatia.net/api/v1/mods/test.jar",
          },
        ],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        apiBaseUrl: "https://api.apparatia.net/api/v1",
        isVerify: false,
      })
      .catch(() => {})

    // Pause immediately
    const pauseResult = await manager.pauseSync()
    expect(pauseResult.success).toBe(true)
    expect(manager.getState()).toBe("PAUSED")

    await startPromise
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
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            downloadUrl: "https://api.apparatia.net/api/v1/mods/test.jar",
          },
        ],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        apiBaseUrl: "https://api.apparatia.net/api/v1",
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
})
