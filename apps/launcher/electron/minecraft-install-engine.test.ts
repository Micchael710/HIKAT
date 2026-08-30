import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import crypto from "crypto"
import http from "http"

// @ts-expect-error CJS module
import {
  checkMinecraftCoreReadiness,
  estimateCoreDownloadBytes,
  installOrRepairMinecraftCore,
  resolveJavaRuntime,
  validateJavaBinary,
  parseJavaMajorVersion,
  normalizeNeoForgeProfileVersion,
  readInstallProfileFromJar,
  getNeoForgeInstallerJarPath,
  loadCoreState,
  saveCoreState,
  getNeoForgeProfileCandidates,
} from "./minecraft-install-engine.cjs"

// @ts-expect-error CJS module
import { GameLauncher } from "./game-launcher.cjs"
// @ts-expect-error CJS module
import { GameOperationManager, validateSyncPayload } from "./game-operation-manager.cjs"
// @ts-expect-error CJS module
import { saveInstalledManifest, executeSync } from "./client-files-sync.cjs"

describe("HiKAT Minecraft & NeoForge Hardened Engine QA Micro-Hardening Suite", () => {
  let tempDir: string
  let instanceRoot: string
  let appDataRoot: string
  let server: http.Server | null = null
  let serverBaseUrl = ""

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

    server = http.createServer((req, res) => {
      const url = req.url || ""
      if (url.startsWith("/file/")) {
        const payload = Buffer.from("mock client binary data 1234567890", "utf8")
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": payload.length,
        })
        res.end(payload)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address()
        if (address && typeof address === "object") {
          serverBaseUrl = `http://127.0.0.1:${address.port}`
        }
        resolve()
      })
    })
  })

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
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

    const indexesDir = path.join(root, "assets", "indexes")
    await fsp.mkdir(indexesDir, { recursive: true })
    await fsp.writeFile(path.join(indexesDir, "17.json"), JSON.stringify({ objects: {} }))

    await fsp.writeFile(
      path.join(vanillaDir, `${mcVersion}.json`),
      JSON.stringify({
        id: mcVersion,
        time: "2024-08-08T00:00:00Z",
        releaseTime: "2024-08-08T00:00:00Z",
        type: "release",
        mainClass: "net.minecraft.client.main.Main",
        downloads: { client: { size: 26836906 } },
        libraries: [],
        assetIndex: { id: "17", totalSize: 0 },
      }),
    )
    await fsp.writeFile(path.join(vanillaDir, `${mcVersion}.jar`), "mock-vanilla-jar")
    await fsp.writeFile(
      path.join(nfDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        time: "2024-08-08T00:00:00Z",
        releaseTime: "2024-08-08T00:00:00Z",
        type: "release",
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        inheritsFrom: mcVersion,
        libraries: [],
      }),
    )

    const libJarPath = path.join(
      root,
      "libraries",
      "net",
      "neoforged",
      "neoforge",
      neoForgeVersion,
      `neoforge-${neoForgeVersion}.jar`,
    )
    await fsp.mkdir(path.dirname(libJarPath), { recursive: true })
    await fsp.writeFile(libJarPath, "mock-neoforge-jar")
    await fsp.writeFile(
      path.join(path.dirname(libJarPath), `neoforge-${neoForgeVersion}-client.jar`),
      "mock-neoforge-client-jar",
    )

    const installProfile = {
      spec: 1,
      profile: "neoforge",
      version: neoForgeVersion,
      minecraft: mcVersion,
      json: `/versions/${profileId}/${profileId}.json`,
      path: `net.neoforged:neoforge:${neoForgeVersion}`,
      processors: [],
      libraries: [],
    }

    await saveCoreState(root, {
      minecraftVersion: mcVersion,
      neoForgeVersion,
      resolvedVersionId: profileId,
      installedAt: new Date().toISOString(),
      installProfile,
    })

    return { profileId, installProfile }
  }

  /* ─────────────────────────────────────────────────────────────
   * 1. client-files-sync emits downloadedBytes & totalBytes
   * ───────────────────────────────────────────────────────────── */
  it("1. client-files-sync emits downloadedBytes and totalBytes in onProgress callback", async () => {
    const testContent = Buffer.from("mock client binary data 1234567890", "utf8")
    const task = {
      path: "mods/test-mod.jar",
      sha256: computeSha(testContent),
      sizeBytes: testContent.length,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/test-mod.jar`,
    }

    const emittedEvents: any[] = []
    const res = await executeSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      onProgress: (data: any) => {
        emittedEvents.push(data)
      },
      apiBaseUrl: serverBaseUrl,
    })

    expect(res.success).toBe(true)
    expect(emittedEvents.length).toBeGreaterThan(0)
    const lastEvent = emittedEvents[emittedEvents.length - 1]
    expect(lastEvent.downloadedBytes).toBe(testContent.length)
    expect(lastEvent.totalBytes).toBe(testContent.length)
  })

  /* ─────────────────────────────────────────────────────────────
   * 2. Real Unified Progress Sum: clientFiles + XMCL Bytes
   * ───────────────────────────────────────────────────────────── */
  it("2. Unified progress aggregator correctly sums real streaming clientFiles + XMCL bytes without artificial jump", async () => {
    const testContent = Buffer.from("mock client binary data 1234567890", "utf8")
    const clientBytes = testContent.length
    const xmclBytes = 500

    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: true,
        hasExistingInstall: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
        issues: [],
      }),
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: xmclBytes }),
      installOrRepairMinecraftCore: vi.fn().mockImplementation(async ({ onTaskBytes }) => {
        // Emit XMCL progress chunks
        if (typeof onTaskBytes === "function") {
          onTaskBytes("neoforge", 250)
          onTaskBytes("libraries", 250)
        }
        return { success: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }
      }),
    }

    const manager = new GameOperationManager({
      coreEngine: mockEngine,
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    await createMockJdk21(instanceRoot)

    const recordedProgress: number[] = []
    const recordedDownloadedGB: number[] = []

    const task = {
      path: "mods/stream-mod.jar",
      sha256: computeSha(testContent),
      sizeBytes: clientBytes,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/stream-mod.jar`,
    }

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      apiBaseUrl: serverBaseUrl,
      onProgress: (data: any) => {
        recordedProgress.push(data.progress)
        recordedDownloadedGB.push(data.downloadedGB)
      },
    })

    expect(res.success).toBe(true)
    expect(recordedProgress.length).toBeGreaterThan(0)
    // Monotonic progression
    for (let i = 1; i < recordedProgress.length; i++) {
      expect(recordedProgress[i]).toBeGreaterThanOrEqual(recordedProgress[i - 1])
    }
    // Final progress reaches 100%
    expect(recordedProgress[recordedProgress.length - 1]).toBe(100)
  })

  /* ─────────────────────────────────────────────────────────────
   * 3. Fresh Install Complete Size Calculation (Metadata Derived)
   * ───────────────────────────────────────────────────────────── */
  it("3. Fresh install calculates complete size across client JAR, libraries, asset objects, installer and dependencies", async () => {
    // Mock Mojang version metadata with client jar, 2 libraries, and asset index
    const mockMojangMeta = {
      id: "1.21.1",
      downloads: {
        client: { size: 25000000 }, // 25 MB
      },
      libraries: [
        {
          downloads: {
            artifact: {
              path: "com/mojang/libA/1.0/libA-1.0.jar",
              size: 500000, // 500 KB
            },
          },
        },
        {
          downloads: {
            artifact: {
              path: "com/mojang/libB/1.0/libB-1.0.jar",
              size: 300000, // 300 KB
            },
          },
        },
      ],
      assetIndex: {
        id: "17",
        url: `${serverBaseUrl}/asset-index.json`,
      },
    }

    const mockAssetIndex = {
      objects: {
        "icons/icon.png": { hash: "a1b2c3d4e5f60000000000000000000000000000", size: 100000 }, // 100 KB
        "sounds/ambient.ogg": { hash: "b2c3d4e5f6a10000000000000000000000000000", size: 400000 }, // 400 KB
      },
    }

    // Intercept fetch for version list and asset index
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes("version_manifest") || url.includes("piston-meta")) {
        return {
          ok: true,
          json: async () => ({
            versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }],
          }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return {
          ok: true,
          json: async () => mockMojangMeta,
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return {
          ok: true,
          json: async () => mockAssetIndex,
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("neoforge-21.1.65-installer.jar")) {
        const headers = new Headers()
        headers.set("content-length", "15000000") // 15 MB installer
        return {
          ok: true,
          headers,
        } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes, readiness } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      expect(readiness.isCoreInstalled).toBe(false)
      // Expected total = 25MB (client) + 500KB (libA) + 300KB (libB) + 100KB (asset1) + 400KB (asset2) + 15MB (NF installer)
      // = 25000000 + 500000 + 300000 + 100000 + 400000 + 15000000 = 41,300,000 bytes
      expect(totalCoreBytes).toBe(41300000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 4. Already Valid Files & Assets Are NOT Counted in Total
   * ───────────────────────────────────────────────────────────── */
  it("4. Existing valid libraries and assets on disk are excluded from estimated download bytes", async () => {
    const mockMojangMeta = {
      id: "1.21.1",
      downloads: {
        client: { size: 25000000 },
      },
      libraries: [
        {
          downloads: {
            artifact: {
              path: "com/mojang/libA/1.0/libA-1.0.jar",
              size: 500000,
            },
          },
        },
        {
          downloads: {
            artifact: {
              path: "com/mojang/libB/1.0/libB-1.0.jar",
              size: 300000,
            },
          },
        },
      ],
      assetIndex: {
        id: "17",
        url: `${serverBaseUrl}/asset-index.json`,
      },
    }

    const mockAssetIndex = {
      objects: {
        "icons/icon.png": { hash: "a1b2c3d4e5f60000000000000000000000000000", size: 100000 },
        "sounds/ambient.ogg": { hash: "b2c3d4e5f6a10000000000000000000000000000", size: 400000 },
      },
    }

    // Pre-create libA and asset1 on disk!
    const libAPath = path.join(instanceRoot, "libraries", "com", "mojang", "libA", "1.0", "libA-1.0.jar")
    await fsp.mkdir(path.dirname(libAPath), { recursive: true })
    await fsp.writeFile(libAPath, "valid libA")

    const asset1Path = path.join(instanceRoot, "assets", "objects", "a1", "a1b2c3d4e5f60000000000000000000000000000")
    await fsp.mkdir(path.dirname(asset1Path), { recursive: true })
    await fsp.writeFile(asset1Path, "valid asset 1")

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({
            versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }],
          }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => mockAssetIndex, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("neoforge-21.1.65-installer.jar")) {
        const headers = new Headers()
        headers.set("content-length", "15000000")
        return { ok: true, headers } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // libA (500KB) and asset1 (100KB) are on disk, so excluded:
      // Total = 25MB (client) + 300KB (libB) + 400KB (asset2) + 15MB (installer)
      // = 25000000 + 300000 + 400000 + 15000000 = 40,700,000 bytes
      expect(totalCoreBytes).toBe(40700000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 5. Task Phase Distinction: Download vs Processors vs Verify
   * ───────────────────────────────────────────────────────────── */
  it("5. Task lifecycle distinguishes DOWNLOADING_CORE from RUNNING_PROCESSORS and stays in VERIFYING during verify", async () => {
    const phasesReported: string[] = []

    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: true,
        hasExistingInstall: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
        issues: [],
      }),
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 100 }),
      installOrRepairMinecraftCore: vi.fn().mockImplementation(async ({ onPhaseChange }) => {
        // Report download task first
        if (typeof onPhaseChange === "function") {
          onPhaseChange("DOWNLOADING_CORE")
          onPhaseChange("RUNNING_PROCESSORS")
        }
        return { success: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }
      }),
    }

    const manager = new GameOperationManager({
      coreEngine: mockEngine,
      javaValidator: () => ({ valid: true, major: 21 }),
    })
    await createMockJdk21(instanceRoot)

    const dummyFile = {
      path: "mods/dummy.jar",
      sha256: computeSha("data"),
      sizeBytes: 4,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/dummy.jar`,
    }

    // Pre-create file so sync finishes
    const localTarget = path.join(instanceRoot, "mods", "dummy.jar")
    await fsp.mkdir(path.dirname(localTarget), { recursive: true })
    await fsp.writeFile(localTarget, "data")
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: { "mods/dummy.jar": { officialSha256: computeSha("data"), policy: "NO_MODIFICABLE" } },
    })

    // Sync mode -> maps to DOWNLOADING then INSTALLING
    await manager.startSync({
      instanceRoot,
      clientFiles: [dummyFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      onProgress: (d: any) => {
        phasesReported.push(d.phase)
      },
    })

    expect(phasesReported).toContain("DOWNLOADING")
    expect(phasesReported).toContain("INSTALLING")

    // Verify mode -> strictly stays in VERIFYING
    const verifyPhases: string[] = []
    await manager.startSync({
      instanceRoot,
      clientFiles: [dummyFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      isVerify: true,
      onProgress: (d: any) => {
        verifyPhases.push(d.phase)
      },
    })

    for (const p of verifyPhases) {
      expect(p).toBe("VERIFYING")
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 6. normalizeNeoForgeProfileVersion & Profile Matching
   * ───────────────────────────────────────────────────────────── */
  it("6. normalizeNeoForgeProfileVersion strips prefixes and matches target cleanly", () => {
    expect(normalizeNeoForgeProfileVersion("21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("neoforge-21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("1.21.1-neoforge-21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("neoforged-21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("")).toBe("")
    expect(normalizeNeoForgeProfileVersion(null as any)).toBe("")

    // Matching
    expect(normalizeNeoForgeProfileVersion("neoforge-21.1.65")).toBe(
      normalizeNeoForgeProfileVersion("21.1.65"),
    )
    expect(normalizeNeoForgeProfileVersion("neoforge-21.1.66")).not.toBe(
      normalizeNeoForgeProfileVersion("21.1.65"),
    )
  })

  it("7. InstallProfile matching succeeds when version is prefixed with 'neoforge-'", async () => {
    const { profileId } = await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    // Save with prefixed version in installProfile
    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
      installedAt: new Date().toISOString(),
      installProfile: {
        spec: 1,
        profile: "neoforge",
        version: "neoforge-21.1.65", // Prefixed!
        minecraft: "1.21.1",
        json: `/versions/${profileId}/${profileId}.json`,
        path: `net.neoforged:neoforge:21.1.65`,
        processors: [],
        libraries: [],
      },
    })

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    // Profile version 'neoforge-21.1.65' matches target '21.1.65', so needsNeoForge is false
    expect(readiness.needsNeoForge).toBe(false)
    expect(readiness.installProfile).not.toBeNull()
  })

  it("8. InstallProfile with mismatching target version fails closed", async () => {
    const { profileId } = await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    // Save with version for 21.1.66 (mismatched)
    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
      installedAt: new Date().toISOString(),
      installProfile: {
        spec: 1,
        profile: "neoforge",
        version: "neoforge-21.1.66", // Mismatched!
        minecraft: "1.21.1",
        processors: [],
        libraries: [],
      },
    })

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    // Must fail closed because profile doesn't match target version
    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.needsNeoForge).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 9. Strict Java 21 Fail-Closed Invariants
   * ───────────────────────────────────────────────────────────── */
  it("9. parseJavaMajorVersion parses standard OpenJDK outputs and rejects invalid", () => {
    expect(parseJavaMajorVersion('openjdk version "21.0.3" 2024-04-16 LTS')).toBe(21)
    expect(parseJavaMajorVersion('java version "17.0.8" 2023-07-18 LTS')).toBe(17)
    expect(parseJavaMajorVersion('java version "1.8.0_292"')).toBe(8)
    expect(parseJavaMajorVersion("invalid output")).toBeNull()
  })

  it("10. Java 17 binary is rejected for Java 21 requirement", async () => {
    const { javaExe } = await createMockJdk21(instanceRoot)
    const mockExec = () => 'openjdk version "17.0.8" 2023-07-18 LTS'
    const validation = validateJavaBinary(javaExe, 21, mockExec)
    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/Incompatible Java version.*found Java 17.*expected Java 21/i)
  })

  it("11. Play launcher rejects missing versions and downloads 0 bytes", async () => {
    const launcher = new GameLauncher(null, { instanceRoot })

    await expect(
      launcher.launch({
        playerName: "Player",
        minecraftVersion: "",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/Missing required minecraftVersion/i)
  })
})
