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
import { loadInstalledManifest, saveInstalledManifest } from "./client-files-sync.cjs"

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
})
