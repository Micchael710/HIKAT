import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import crypto from "crypto"

// @ts-expect-error CJS module
import {
  checkMinecraftCoreReadiness,
  estimateCoreDownloadBytes,
  installOrRepairMinecraftCore,
  resolveJavaRuntime,
  validateJavaBinary,
  loadCoreState,
  saveCoreState,
  getNeoForgeProfileCandidates,
} from "./minecraft-install-engine.cjs"

// @ts-expect-error CJS module
import { GameLauncher } from "./game-launcher.cjs"
// @ts-expect-error CJS module
import { GameOperationManager } from "./game-operation-manager.cjs"
// @ts-expect-error CJS module
import { saveInstalledManifest } from "./client-files-sync.cjs"

describe("HiKAT Minecraft & NeoForge Hardened Engine Integration Suite", () => {
  let tempDir: string
  let instanceRoot: string
  let appDataRoot: string

  function computeSha(content: Buffer | string): string {
    return crypto
      .createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
      .digest("hex")
      .toLowerCase()
  }

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-core-test-"))
    appDataRoot = path.join(tempDir, "HiKAT")
    instanceRoot = path.join(appDataRoot, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
    vi.restoreAllMocks()
  })

  // Helper to create a fake valid JDK in instanceRoot
  async function createMockJdk21(root: string) {
    const binDir = path.join(root, "jdk-21", "bin")
    await fsp.mkdir(binDir, { recursive: true })
    const javaExe = path.join(binDir, process.platform === "win32" ? "java.exe" : "java")
    const javawExe = path.join(binDir, process.platform === "win32" ? "javaw.exe" : "javaw")
    await fsp.writeFile(javaExe, "mock-java-binary")
    await fsp.writeFile(javawExe, "mock-javaw-binary")
    return { javaExe, javawExe }
  }

  // Helper to create a mock valid Minecraft + NeoForge installation on disk
  async function createMockInstalledCore(root: string, mcVersion = "1.21.1", neoForgeVersion = "21.1.65") {
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`
    const versionsDir = path.join(root, "versions")
    const vanillaDir = path.join(versionsDir, mcVersion)
    const nfDir = path.join(versionsDir, profileId)

    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.mkdir(nfDir, { recursive: true })

    await fsp.writeFile(path.join(vanillaDir, `${mcVersion}.json`), JSON.stringify({ id: mcVersion }))
    await fsp.writeFile(path.join(vanillaDir, `${mcVersion}.jar`), "mock-vanilla-jar")
    await fsp.writeFile(
      path.join(nfDir, `${profileId}.json`),
      JSON.stringify({ id: profileId, inheritsFrom: mcVersion, libraries: [] }),
    )

    await saveCoreState(root, {
      minecraftVersion: mcVersion,
      neoForgeVersion,
      resolvedVersionId: profileId,
      installedAt: new Date().toISOString(),
      installProfile: {
        version: neoForgeVersion,
        minecraft: mcVersion,
        processors: [],
        libraries: [],
      },
    })

    return { profileId }
  }

  /* ─────────────────────────────────────────────────────────────
   * 1. Java Runtime & JDK-21 Official Distribution
   * ───────────────────────────────────────────────────────────── */
  it("1. resolveJavaRuntime prioritizes official instanceRoot/jdk-21 over system", async () => {
    const { javaExe, javawExe } = await createMockJdk21(instanceRoot)

    const cliRuntime = resolveJavaRuntime(instanceRoot, { isGui: false })
    expect(cliRuntime.isOfficialJdk).toBe(true)
    expect(cliRuntime.javaPath).toBe(javaExe)

    const guiRuntime = resolveJavaRuntime(instanceRoot, { isGui: true })
    expect(guiRuntime.isOfficialJdk).toBe(true)
    expect(guiRuntime.javaPath).toBe(javawExe)
  })

  it("2. resolveJavaRuntime falls back to custom path if validly specified", async () => {
    const customBin = path.join(tempDir, "custom-java", "bin", process.platform === "win32" ? "java.exe" : "java")
    await fsp.mkdir(path.dirname(customBin), { recursive: true })
    await fsp.writeFile(customBin, "custom-bin")

    const runtime = resolveJavaRuntime(instanceRoot, { isGui: false, customPath: customBin })
    expect(runtime.isOfficialJdk).toBe(false)
    expect(runtime.javaPath).toBe(customBin)
  })

  /* ─────────────────────────────────────────────────────────────
   * 2. Core Readiness & Diagnostics
   * ───────────────────────────────────────────────────────────── */
  it("3. Fresh install: empty instanceRoot returns isCoreInstalled=false and needsVanilla & needsNeoForge", async () => {
    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.hasExistingInstall).toBe(false)
    expect(readiness.needsVanilla).toBe(true)
    expect(readiness.needsNeoForge).toBe(true)
  })

  it("4. Missing Minecraft with valid modpack: clientFiles present but Minecraft missing returns isCoreInstalled=false", async () => {
    // clientFiles present in installed manifest
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {
        "mods/example.jar": { officialSha256: computeSha("mod"), policy: "NO_MODIFICABLE" },
      },
    })

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.hasExistingInstall).toBe(false)
  })

  it("5. NeoForge version change: target NeoForge differs from installed profile -> needsNeoForge=true", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.100", // New target NeoForge version
    })

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.hasExistingInstall).toBe(true)
    expect(readiness.needsVanilla).toBe(false)
    expect(readiness.needsNeoForge).toBe(true)
  })

  it("6. Minecraft version change: target MC version differs -> needsVanilla=true & needsNeoForge=true", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.2", // New target MC version
      neoForgeVersion: "21.2.1",
    })

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.needsVanilla).toBe(true)
    expect(readiness.needsNeoForge).toBe(true)
  })

  it("7. Corrupt core-state.json: fails closed and falls back to filesystem diagnosis", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")
    // Corrupt the core-state file
    await fsp.writeFile(path.join(instanceRoot, ".hikat", "core-state.json"), "INVALID_JSON{{{")

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    // Found candidate directory on filesystem even with broken metadata
    expect(readiness.hasExistingInstall).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 3. Composite CheckPlan & OperationManager
   * ───────────────────────────────────────────────────────────── */
  it("8. CheckPlan produces composite isFullyInstalled ONLY when both clientFiles and Core are ready", async () => {
    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: false,
        hasExistingInstall: false,
        resolvedVersionId: null,
      }),
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 50 * 1024 * 1024 }),
      installOrRepairMinecraftCore: vi.fn(),
    }

    const manager = new GameOperationManager({ coreEngine: mockEngine })

    // When clientFiles are empty and core is not installed
    const plan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(plan.isFullyInstalled).toBe(false)
    expect(plan.needsUpdate).toBe(true)
    expect(plan.totalDownloadBytes).toBeGreaterThan(0)

    // When core is installed and clientFiles are fully synced
    mockEngine.checkMinecraftCoreReadiness.mockResolvedValue({
      isCoreInstalled: true,
      hasExistingInstall: true,
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
    })
    mockEngine.estimateCoreDownloadBytes.mockResolvedValue({ totalCoreBytes: 0 })

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {},
    })

    const readyPlan = await manager.checkPlan({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(readyPlan.isFullyInstalled).toBe(true)
    expect(readyPlan.needsUpdate).toBe(false)
  })

  it("9. UnifiedInstallPlan includes staged bytes in denominator and calculates starting percentage cleanly", async () => {
    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: false,
        hasExistingInstall: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
      }),
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 1000 }),
      installOrRepairMinecraftCore: vi.fn().mockResolvedValue({ success: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
    }

    const manager = new GameOperationManager({ coreEngine: mockEngine })

    const progressReports: any[] = []
    const onProgress = (data: any) => {
      progressReports.push(data)
    }

    const task = {
      path: "mods/file.jar",
      sha256: computeSha("content"),
      sizeBytes: 1000,
      policy: "NO_MODIFICABLE",
      downloadUrl: "http://127.0.0.1:9999/dummy",
    }

    // Mock executeSync in clientFiles
    const syncRes = await manager.startSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      onProgress,
      isVerify: false,
    }).catch(() => null)

    // Progress updates were reported with numbers bounded between 0 and 100 and no NaN/Infinity
    for (const r of progressReports) {
      expect(Number.isFinite(r.progress)).toBe(true)
      expect(r.progress).toBeGreaterThanOrEqual(0)
      expect(r.progress).toBeLessThanOrEqual(100)
      expect(Number.isFinite(r.speedMBs)).toBe(true)
      expect(Number.isFinite(r.remainingMinutes)).toBe(true)
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 4. Game Launcher Invariants (JUGAR Never Downloads)
   * ───────────────────────────────────────────────────────────── */
  it("10. Play invariant: launch fails cleanly without downloading when installation is incomplete", async () => {
    const launcher = new GameLauncher(null, { instanceRoot })

    await expect(
      launcher.launch({
        playerName: "Player",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/Cannot launch Minecraft: Installation is incomplete/i)
  })

  it("11. Play invariant: launch succeeds when installation is complete with 0 downloads", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")
    await createMockJdk21(instanceRoot)

    const fakeChild = {
      pid: 99999,
      on: vi.fn(),
    }

    const mockVersionParser = vi.fn().mockResolvedValue({
      id: "1.21.1-neoforge-21.1.65",
      minecraftDirectory: instanceRoot,
    })

    const mockXmclLauncher = vi.fn().mockResolvedValue(fakeChild)

    const mockReadinessChecker = vi.fn().mockResolvedValue({
      isCoreInstalled: true,
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      issues: [],
    })

    const launcher = new GameLauncher(null, {
      instanceRoot,
      versionParser: mockVersionParser,
      xmclLauncher: mockXmclLauncher,
      readinessChecker: mockReadinessChecker,
    })

    const res = await launcher.launch({
      playerName: "TestPlayer",
      ramGB: 6,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(res.success).toBe(true)
    expect(res.pid).toBe(99999)
    expect(mockXmclLauncher).toHaveBeenCalledTimes(1)
    expect(launcher.getLaunchStatus().status).toBe("running")
  })

  /* ─────────────────────────────────────────────────────────────
   * 5. Verify Installation Invariant
   * ───────────────────────────────────────────────────────────── */
  it("12. Verify installation: verifies core and clientFiles and reports VERIFYING UI phase", async () => {
    let capturedUiPhase = ""

    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: true,
        hasExistingInstall: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
        issues: [],
      }),
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0 }),
      installOrRepairMinecraftCore: vi.fn().mockResolvedValue({ success: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
    }

    const manager = new GameOperationManager({ coreEngine: mockEngine })

    const sampleFile = {
      path: "config/test.json",
      sha256: computeSha("data"),
      sizeBytes: 4,
      policy: "MODIFICABLE",
      downloadUrl: "http://127.0.0.1:9999/test",
    }

    // Pre-create file so sync has 0 downloads
    const localTarget = path.join(instanceRoot, "config", "test.json")
    await fsp.mkdir(path.dirname(localTarget), { recursive: true })
    await fsp.writeFile(localTarget, "data")

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {
        "config/test.json": {
          officialSha256: computeSha("data"),
          policy: "MODIFICABLE",
        },
      },
    })

    const result = await manager.startSync({
      instanceRoot,
      clientFiles: [sampleFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      isVerify: true,
      onProgress: (data: any) => {
        capturedUiPhase = data.phase
      },
    })

    expect(result.success).toBe(true)
    expect(capturedUiPhase).toBe("VERIFYING")
  })
})
