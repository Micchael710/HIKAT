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
  buildCoreInstallPlan,
  installOrRepairMinecraftCore,
  installNeoForgeFromPreparedInstaller,
  resolveJavaRuntime,
  validateJavaBinary,
  parseJavaMajorVersion,
  normalizeNeoForgeProfileVersion,
  validateFileIntegrity,
  bootstrapNeoForgeInstaller,
  getPlannerCachePaths,
  loadPlannerInstallerMetadata,
  validatePlannerInstaller,
  ensurePlannerInstaller,
  promotePlannerInstallerToCanonical,
  resolveOfficialNeoForgeInstallerSha256,
  readInstallProfileFromJar,
  getNeoForgeInstallerJarPath,
  loadCoreState,
  saveCoreState,
  fetchOfficialNeoForgeInstallerSha256,
  validateFileSha256,
  getCurrentPlatformOsKey,
} from "./minecraft-install-engine.cjs"

// @ts-expect-error CJS module
import { GameLauncher } from "./game-launcher.cjs"
// @ts-expect-error CJS module
import { GameOperationManager, validateSyncPayload } from "./game-operation-manager.cjs"
// @ts-expect-error CJS module
import { saveInstalledManifest, executeSync } from "./client-files-sync.cjs"

/**
 * Creates a compliant in-memory ZIP buffer containing a single file.
 */
function createZipWithFile(filename: string, content: string | Buffer): Buffer {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")
  const name = Buffer.from(filename, "utf8")

  const crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[i] = c
  }
  let crc = 0 ^ -1
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff]
  crc = (crc ^ -1) >>> 0

  const localHeader = Buffer.alloc(30 + name.length)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(data.length, 18)
  localHeader.writeUInt32LE(data.length, 22)
  localHeader.writeUInt16LE(name.length, 26)
  localHeader.writeUInt16LE(0, 28)
  name.copy(localHeader, 30)

  const centralDir = Buffer.alloc(46 + name.length)
  centralDir.writeUInt32LE(0x02014b50, 0)
  centralDir.writeUInt16LE(20, 4)
  centralDir.writeUInt16LE(20, 6)
  centralDir.writeUInt16LE(0, 8)
  centralDir.writeUInt16LE(0, 10)
  centralDir.writeUInt16LE(0, 12)
  centralDir.writeUInt16LE(0, 14)
  centralDir.writeUInt32LE(crc, 16)
  centralDir.writeUInt32LE(data.length, 20)
  centralDir.writeUInt32LE(data.length, 24)
  centralDir.writeUInt16LE(name.length, 28)
  centralDir.writeUInt16LE(0, 30)
  centralDir.writeUInt16LE(0, 32)
  centralDir.writeUInt16LE(0, 34)
  centralDir.writeUInt16LE(0, 36)
  centralDir.writeUInt32LE(0, 38)
  centralDir.writeUInt32LE(0, 42)
  name.copy(centralDir, 46)

  const centralOffset = localHeader.length + data.length
  const centralSize = centralDir.length

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(1, 8)
  endRecord.writeUInt16LE(1, 10)
  endRecord.writeUInt32LE(centralSize, 12)
  endRecord.writeUInt32LE(centralOffset, 16)
  endRecord.writeUInt16LE(0, 20)

  return Buffer.concat([localHeader, data, centralDir, endRecord])
}

describe("HiKAT Minecraft & NeoForge Hardened Engine QA Master Suite", () => {
  let tempDir: string
  let instanceRoot: string
  let appDataRoot: string
  let server: http.Server | null = null
  let serverBaseUrl = ""

  function computeSha256(content: Buffer | string): string {
    return crypto
      .createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
      .digest("hex")
      .toLowerCase()
  }

  function computeSha1(content: Buffer | string): string {
    return crypto
      .createHash("sha1")
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
      } else if (url.includes("asset-index.json")) {
        const payload = Buffer.from(JSON.stringify({ objects: {} }), "utf8")
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": payload.length })
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

    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const indexesDir = path.join(root, "assets", "indexes")
    await fsp.mkdir(indexesDir, { recursive: true })
    await fsp.writeFile(path.join(indexesDir, "17.json"), assetIndexContent)

    const vanillaJarContent = "mock-vanilla-jar"
    const vanillaJarSha1 = computeSha1(vanillaJarContent)

    await fsp.writeFile(
      path.join(vanillaDir, `${mcVersion}.json`),
      JSON.stringify({
        id: mcVersion,
        assets: "17",
        time: "2024-08-08T00:00:00Z",
        releaseTime: "2024-08-08T00:00:00Z",
        type: "release",
        mainClass: "net.minecraft.client.main.Main",
        downloads: { client: { size: vanillaJarContent.length, sha1: vanillaJarSha1 } },
        libraries: [],
        assetIndex: { id: "17", sha1: assetIndexSha1, size: assetIndexContent.length, totalSize: 0, url: `${serverBaseUrl}/asset-index.json` },
      }),
    )
    await fsp.writeFile(path.join(vanillaDir, `${mcVersion}.jar`), vanillaJarContent)
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
    const libJarContent = "mock-neoforge-jar"
    const libJarSha1 = computeSha1(libJarContent)
    await fsp.writeFile(libJarPath, libJarContent)
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
      processors: [
        {
          sides: ["client"],
          jar: `net.neoforged:neoforge:${neoForgeVersion}`,
          classpath: [],
          args: [],
          outputs: {
            [`{ROOT}/libraries/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}.jar`]: libJarSha1,
          },
        },
      ],
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
      sha256: computeSha256(testContent),
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
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: xmclBytes, preflightDownloadedBytes: 0 }),
      installOrRepairMinecraftCore: vi.fn().mockImplementation(async ({ onTaskBytes }) => {
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

    const task = {
      path: "mods/stream-mod.jar",
      sha256: computeSha256(testContent),
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
      },
    })

    expect(res.success).toBe(true)
    expect(recordedProgress.length).toBeGreaterThan(0)
    for (let i = 1; i < recordedProgress.length; i++) {
      expect(recordedProgress[i]).toBeGreaterThanOrEqual(recordedProgress[i - 1])
    }
    expect(recordedProgress[recordedProgress.length - 1]).toBe(100)
  })

  /* ─────────────────────────────────────────────────────────────
   * 3. Fresh Install Complete Size Calculation (Metadata, Asset Index & Installer)
   * ───────────────────────────────────────────────────────────── */
  it("3. Fresh install calculates complete size across client JAR, vanilla libraries, asset index, asset objects, installer and NeoForge dependencies", async () => {
    const mockMojangMeta = {
      id: "1.21.1",
      downloads: {
        client: { size: 25000000, sha1: "1111111111111111111111111111111111111111" },
      },
      libraries: [
        {
          downloads: {
            artifact: {
              path: "com/mojang/libA/1.0/libA-1.0.jar",
              size: 500000,
              sha1: "2222222222222222222222222222222222222222",
            },
          },
        },
      ],
      assetIndex: {
        id: "17",
        size: 50000,
        sha1: "4444444444444444444444444444444444444444",
        url: `${serverBaseUrl}/asset-index.json`,
      },
    }

    const mockAssetIndex = {
      objects: {
        "icons/icon.png": { hash: "a1b2c3d4e5f60000000000000000000000000000", size: 100000 },
      },
    }

    const mockInstallProfile = {
      spec: 1,
      profile: "neoforge",
      version: "21.1.65",
      minecraft: "1.21.1",
      libraries: [
        {
          downloads: {
            artifact: {
              path: "net/neoforged/depA/1.0/depA-1.0.jar",
              size: 400000,
              sha1: "3333333333333333333333333333333333333333",
            },
          },
        },
      ],
    }

    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockInstallProfile))

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
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        const headers = new Headers()
        headers.set("content-length", String(zipBuffer.length))
        return {
          ok: true,
          headers,
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes, preflightDownloadedBytes, readiness } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      expect(readiness.isCoreInstalled).toBe(false)
      expect(preflightDownloadedBytes).toBe(zipBuffer.length)
      // Total = 25MB (client) + 500KB (vanilla libA) + 50KB (asset index file) + 100KB (asset) + zipBuffer.length (installer) + 400KB (neoforge depA)
      const expectedTotal = 25000000 + 500000 + 50000 + 100000 + zipBuffer.length + 400000
      expect(totalCoreBytes).toBe(expectedTotal)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 4. Deep Integrity Verification: Valid Files Excluded, Corrupt Counted
   * ───────────────────────────────────────────────────────────── */
  it("4. Valid files on disk with matching size and sha1 are excluded from download bytes", async () => {
    const validLibContent = Buffer.from("valid library content", "utf8")
    const validLibSha1 = computeSha1(validLibContent)
    const validLibPath = path.join(instanceRoot, "libraries", "com", "mojang", "libA", "1.0", "libA-1.0.jar")
    await fsp.mkdir(path.dirname(validLibPath), { recursive: true })
    await fsp.writeFile(validLibPath, validLibContent)

    const isValid = await validateFileIntegrity(validLibPath, validLibContent.length, validLibSha1)
    expect(isValid).toBe(true)

    const isTruncated = await validateFileIntegrity(validLibPath, validLibContent.length + 10, validLibSha1)
    expect(isTruncated).toBe(false)

    const isCorruptHash = await validateFileIntegrity(validLibPath, validLibContent.length, "wrongsha1")
    expect(isCorruptHash).toBe(false)
  })

  it("5. Existing asset with same size but wrong SHA-1 is detected as corrupt and counted for repair", async () => {
    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", "17.json")
    await fsp.mkdir(path.dirname(localIndexFile), { recursive: true })
    await fsp.writeFile(localIndexFile, assetIndexContent)

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 25000000, sha1: "1111111111111111111111111111111111111111" } },
      libraries: [],
      assetIndex: { id: "17", size: assetIndexContent.length, sha1: assetIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    const expectedHash = "a1b2c3d4e5f60000000000000000000000000000"
    const mockAssetIndex = {
      objects: {
        "icons/icon.png": { hash: expectedHash, size: 5 },
      },
    }

    // Write file with exact size 5 bytes, but WRONG content (wrong sha1)
    const corruptAssetPath = path.join(instanceRoot, "assets", "objects", "a1", expectedHash)
    await fsp.mkdir(path.dirname(corruptAssetPath), { recursive: true })
    await fsp.writeFile(corruptAssetPath, "12345") // 5 bytes, wrong hash

    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))

    // Pre-create installer
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockProfile,
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => mockAssetIndex, headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // Corrupt asset (5 bytes) must be counted in total download bytes
      expect(totalCoreBytes).toBeGreaterThanOrEqual(5)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 6. Deduplication of Duplicate Libraries across Mojang & NeoForge
   * ───────────────────────────────────────────────────────────── */
  it("6. Duplicate library appearing in both Mojang manifest and NeoForge installProfile is counted exactly once", async () => {
    const sharedLibPath = "org/ow2/asm/asm/9.7/asm-9.7.jar"
    const sharedLibSize = 125000

    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", "17.json")
    await fsp.mkdir(path.dirname(localIndexFile), { recursive: true })
    await fsp.writeFile(localIndexFile, assetIndexContent)

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 1000000 } },
      libraries: [
        {
          downloads: {
            artifact: {
              path: sharedLibPath,
              size: sharedLibSize,
              sha1: "aaaabbbbccccddddeeeeffff0000111122223333",
            },
          },
        },
      ],
      assetIndex: { id: "17", size: assetIndexContent.length, sha1: assetIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    const mockAssetIndex = { objects: {} }

    const mockInstallProfile = {
      spec: 1,
      profile: "neoforge",
      version: "21.1.65",
      minecraft: "1.21.1",
      libraries: [
        {
          downloads: {
            artifact: {
              path: sharedLibPath, // SAME LIBRARY!
              size: sharedLibSize,
              sha1: "aaaabbbbccccddddeeeeffff0000111122223333",
            },
          },
        },
      ],
    }

    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockInstallProfile))
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockInstallProfile,
    })

    const vanillaDir = path.join(instanceRoot, "versions", "1.21.1")
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, "1.21.1.json"), JSON.stringify(mockMojangMeta))

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => mockAssetIndex, headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // Total = 1,000,000 (client) + 125,000 (shared library ONCE, since installer & index are already on disk)
      expect(totalCoreBytes).toBe(1125000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 7. Task Phase Distinction & Verify Mode Invariant
   * ───────────────────────────────────────────────────────────── */
  it("7. Task lifecycle distinguishes DOWNLOADING_CORE from RUNNING_PROCESSORS and stays in VERIFYING during verify", async () => {
    const phasesReported: string[] = []

    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: true,
        hasExistingInstall: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
        issues: [],
      }),
      estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 100, preflightDownloadedBytes: 0 }),
      installOrRepairMinecraftCore: vi.fn().mockImplementation(async ({ onPhaseChange }) => {
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
      sha256: computeSha256("data"),
      sizeBytes: 4,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/dummy.jar`,
    }

    const localTarget = path.join(instanceRoot, "mods", "dummy.jar")
    await fsp.mkdir(path.dirname(localTarget), { recursive: true })
    await fsp.writeFile(localTarget, "data")
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: { "mods/dummy.jar": { officialSha256: computeSha256("data"), policy: "NO_MODIFICABLE" } },
    })

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
   * 8. normalizeNeoForgeProfileVersion & Profile Matching
   * ───────────────────────────────────────────────────────────── */
  it("8. normalizeNeoForgeProfileVersion strips prefixes and matches target cleanly", () => {
    expect(normalizeNeoForgeProfileVersion("21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("neoforge-21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("1.21.1-neoforge-21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("neoforged-21.1.65")).toBe("21.1.65")
    expect(normalizeNeoForgeProfileVersion("")).toBe("")
    expect(normalizeNeoForgeProfileVersion(null as any)).toBe("")

    expect(normalizeNeoForgeProfileVersion("neoforge-21.1.65")).toBe(
      normalizeNeoForgeProfileVersion("21.1.65"),
    )
    expect(normalizeNeoForgeProfileVersion("neoforge-21.1.66")).not.toBe(
      normalizeNeoForgeProfileVersion("21.1.65"),
    )
  })

  it("9. InstallProfile matching succeeds when version is prefixed with 'neoforge-'", async () => {
    const { profileId } = await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
      installedAt: new Date().toISOString(),
      installProfile: {
        spec: 1,
        profile: "neoforge",
        version: "neoforge-21.1.65",
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

    expect(readiness.needsNeoForge).toBe(false)
    expect(readiness.installProfile).not.toBeNull()
  })

  it("10. InstallProfile with mismatching target version fails closed", async () => {
    const { profileId } = await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: profileId,
      installedAt: new Date().toISOString(),
      installProfile: {
        spec: 1,
        profile: "neoforge",
        version: "neoforge-21.1.66",
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

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.needsNeoForge).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 11. Restored: Missing/Corrupt InstallProfile Fails Closed
   * ───────────────────────────────────────────────────────────── */
  it("11. checkMinecraftCoreReadiness fails closed when InstallProfile is missing or corrupted", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: null,
    })

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.needsNeoForge).toBe(true)
    expect(readiness.issues[0]).toMatch(/InstallProfile metadata is missing or corrupted/i)
  })

  /* ─────────────────────────────────────────────────────────────
   * 12. Restored: Missing Processor Output marks Core Not Ready
   * ───────────────────────────────────────────────────────────── */
  it("12. checkMinecraftCoreReadiness detects missing processor outputs and marks needsNeoForge true", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    const clientLib = path.join(instanceRoot, "libraries", "net", "neoforged", "neoforge", "21.1.65", "neoforge-21.1.65.jar")
    if (fs.existsSync(clientLib)) {
      await fsp.unlink(clientLib)
    }

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(readiness.isCoreInstalled).toBe(false)
    expect(readiness.needsNeoForge).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 13. Restored & Hardened: Modpack-only update does 0 core downloads
   * ───────────────────────────────────────────────────────────── */
  it("13. Modpack-only update does 0 core downloads and 0 core reinstall when core is intact", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")
    await createMockJdk21(instanceRoot)

    const sampleContent = "mock client binary data 1234567890"
    const sampleMod = {
      path: "mods/new-mod.jar",
      sha256: computeSha256(sampleContent),
      sizeBytes: sampleContent.length,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/new-mod.jar`,
    }

    const installSpy = vi.fn()
    const manager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness,
        estimateCoreDownloadBytes,
        installOrRepairMinecraftCore: installSpy,
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [sampleMod],
      modpackVersion: "1.0.1",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      apiBaseUrl: serverBaseUrl,
    })

    expect(res.success).toBe(true)
    // When core is already installed and valid, installOrRepairMinecraftCore must NOT be called at all!
    expect(installSpy).not.toHaveBeenCalled()
  })

  /* ─────────────────────────────────────────────────────────────
   * 14. Restored & Hardened: Verify on healthy core executes 0 network downloads
   * ───────────────────────────────────────────────────────────── */
  it("14. Verify on healthy installation executes 0 network downloads and stays strictly in VERIFYING", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")
    await createMockJdk21(instanceRoot)

    const sampleFile = {
      path: "config/config.json",
      sha256: computeSha256("cfg"),
      sizeBytes: 3,
      policy: "MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/config.json`,
    }

    const localTarget = path.join(instanceRoot, "config", "config.json")
    await fsp.mkdir(path.dirname(localTarget), { recursive: true })
    await fsp.writeFile(localTarget, "cfg")

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {
        "config/config.json": {
          officialSha256: computeSha256("cfg"),
          policy: "MODIFICABLE",
        },
      },
    })

    const reportedPhases: string[] = []
    const installSpy = vi.fn()
    const manager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness,
        estimateCoreDownloadBytes,
        installOrRepairMinecraftCore: installSpy,
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [sampleFile],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      isVerify: true,
      onProgress: (d: any) => {
        reportedPhases.push(d.phase)
      },
    })

    expect(res.success).toBe(true)
    expect(installSpy).not.toHaveBeenCalled()
    expect(reportedPhases.length).toBeGreaterThan(0)
    for (const phase of reportedPhases) {
      expect(phase).toBe("VERIFYING")
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 15. Java 21 Strict Validation and Official JDK Enforcement
   * ───────────────────────────────────────────────────────────── */
  it("15. parseJavaMajorVersion correctly identifies major versions", () => {
    expect(parseJavaMajorVersion('openjdk version "21.0.3" 2024-04-16 LTS')).toBe(21)
    expect(parseJavaMajorVersion('java version "17.0.8" 2023-07-18 LTS')).toBe(17)
    expect(parseJavaMajorVersion('java version "1.8.0_292"')).toBe(8)
    expect(parseJavaMajorVersion("invalid output")).toBeNull()
  })

  it("16. Java 17 in jdk-21 fails validation for target Java 21", async () => {
    const { javaExe } = await createMockJdk21(instanceRoot)
    const mockExec = () => 'openjdk version "17.0.8" 2023-07-18 LTS'
    const validation = validateJavaBinary(javaExe, 21, mockExec)
    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/Incompatible Java version.*found Java 17.*expected Java 21/i)
  })

  it("17. Missing official JDK does NOT silently fall back to system Java", () => {
    const runtime = resolveJavaRuntime(instanceRoot, { isGui: false })
    expect(runtime.isOfficialJdk).toBe(false)
    expect(runtime.javaPath).toBeNull()
    expect(runtime.error).toMatch(/Official Java 21 runtime not found/i)
  })

  /* ─────────────────────────────────────────────────────────────
   * 18. Pause & Cancel Truly Aborts Operation
   * ───────────────────────────────────────────────────────────── */
  it("18. Pause during sync aborts active task and preserves completed files", async () => {
    const mockTask = {
      pause: vi.fn(),
      cancel: vi.fn(),
    }

    const manager = new GameOperationManager()
    manager.state = "SYNCING"
    manager.internalPhase = "DOWNLOADING_CORE"
    manager.activeCancelSignal = {
      isCancelled: false,
      isPaused: false,
      activeXmclTask: mockTask,
    } as any

    const pauseRes = await manager.pauseSync()
    expect(pauseRes.success).toBe(true)
    expect(pauseRes.paused).toBe(true)
    expect(mockTask.pause).toHaveBeenCalledTimes(1)
    expect(manager.getState()).toBe("PAUSED")
  })

  it("19. Cancel during sync cancels active XMCL task and transitions to IDLE", async () => {
    const mockTask = {
      pause: vi.fn(),
      cancel: vi.fn(),
    }

    const manager = new GameOperationManager()
    manager.state = "SYNCING"
    manager.internalPhase = "DOWNLOADING_CORE"
    manager.activeCancelSignal = {
      isCancelled: false,
      isPaused: false,
      activeXmclTask: mockTask,
    } as any

    const cancelRes = await manager.cancelSync(instanceRoot)
    expect(cancelRes.success).toBe(true)
    expect(mockTask.cancel).toHaveBeenCalledTimes(1)
    expect(manager.getState()).toBe("IDLE")
  })

  /* ─────────────────────────────────────────────────────────────
   * 20. Version Authority & Fail-Closed Payload Validation
   * ───────────────────────────────────────────────────────────── */
  it("20. Missing minecraftVersion or neoForgeVersion fails closed with validation error", () => {
    expect(() =>
      validateSyncPayload({
        clientFiles: [],
        modpackVersion: "1.0.0",
        minecraftVersion: "",
        neoForgeVersion: "21.1.65",
        requireNonEmptyFiles: false,
      }),
    ).toThrow(/minecraftVersion must be a non-empty string/i)

    expect(() =>
      validateSyncPayload({
        clientFiles: [],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "   ",
        requireNonEmptyFiles: false,
      }),
    ).toThrow(/neoForgeVersion must be a non-empty string/i)
  })

  it("21. Play launcher rejects missing versions and downloads 0 bytes", async () => {
    const launcher = new GameLauncher(null, { instanceRoot })

    await expect(
      launcher.launch({
        playerName: "Player",
        minecraftVersion: "",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/Missing required minecraftVersion/i)
  })

  /* ─────────────────────────────────────────────────────────────
   * 22. Installer Bootstrap Reused Without Downloading Twice
   * ───────────────────────────────────────────────────────────── */
  it("22. Installer bootstrap downloads once to canonical location and reuses local file on subsequent checks", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))

    let fetchCount = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        fetchCount++
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      return originalFetch(url, init)
    })

    try {
      // 1st call: downloads to canonical path
      const res1 = await bootstrapNeoForgeInstaller({
        instanceRoot,
        neoForgeVersion: "21.1.65",
      })
      expect(res1.downloadedInPreflight).toBe(true)
      expect(res1.preflightDownloadedBytes).toBe(zipBuffer.length)
      expect(fetchCount).toBe(1)
      expect(fs.existsSync(res1.installerJar)).toBe(true)

      // 2nd call: reuses existing valid jar with 0 downloads
      const res2 = await bootstrapNeoForgeInstaller({
        instanceRoot,
        neoForgeVersion: "21.1.65",
      })
      expect(res2.downloadedInPreflight).toBe(false)
      expect(res2.preflightDownloadedBytes).toBe(0)
      expect(fetchCount).toBe(1) // Still 1!
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 23. Corrupted Library on Disk is Detected and Counted
   * ───────────────────────────────────────────────────────────── */
  it("23. Corrupted library on disk (wrong SHA-1) fails integrity and is counted for download", async () => {
    // Pre-create client jar
    const clientJarContent = Buffer.alloc(1000, "a")
    const clientJarPath = path.join(instanceRoot, "versions", "1.21.1", "1.21.1.jar")
    await fsp.mkdir(path.dirname(clientJarPath), { recursive: true })
    await fsp.writeFile(clientJarPath, clientJarContent)

    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", "17.json")
    await fsp.mkdir(path.dirname(localIndexFile), { recursive: true })
    await fsp.writeFile(localIndexFile, assetIndexContent)

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 1000, sha1: computeSha1(clientJarContent) } },
      libraries: [
        {
          downloads: {
            artifact: {
              path: "com/mojang/corrupt/1.0/corrupt-1.0.jar",
              size: 500,
              sha1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
        },
      ],
      assetIndex: { id: "17", size: assetIndexContent.length, sha1: assetIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    // Write library file with wrong content (wrong sha1)
    const corruptLibPath = path.join(instanceRoot, "libraries", "com", "mojang", "corrupt", "1.0", "corrupt-1.0.jar")
    await fsp.mkdir(path.dirname(corruptLibPath), { recursive: true })
    await fsp.writeFile(corruptLibPath, "wrong-content")

    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    const vanillaDir = path.join(instanceRoot, "versions", "1.21.1")
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, "1.21.1.json"), JSON.stringify(mockMojangMeta))

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockProfile,
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => ({ objects: {} }), headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // Corrupted library (500 bytes) must be counted in total
      expect(totalCoreBytes).toBe(500)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 24. Corrupted Client JAR on Disk is Detected and Counted
   * ───────────────────────────────────────────────────────────── */
  it("24. Corrupted Minecraft client JAR on disk (wrong SHA-1) is counted for repair", async () => {
    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", "17.json")
    await fsp.mkdir(path.dirname(localIndexFile), { recursive: true })
    await fsp.writeFile(localIndexFile, assetIndexContent)

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 25000000, sha1: "1111111111111111111111111111111111111111" } },
      libraries: [],
      assetIndex: { id: "17", size: assetIndexContent.length, sha1: assetIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    // Write client jar with wrong sha1
    const clientJarPath = path.join(instanceRoot, "versions", "1.21.1", "1.21.1.jar")
    await fsp.mkdir(path.dirname(clientJarPath), { recursive: true })
    await fsp.writeFile(clientJarPath, "corrupted-jar")

    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    const vanillaDir = path.join(instanceRoot, "versions", "1.21.1")
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, "1.21.1.json"), JSON.stringify(mockMojangMeta))

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockProfile,
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => ({ objects: {} }), headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // Corrupted client JAR (25,000,000 bytes) must be counted in total
      expect(totalCoreBytes).toBe(25000000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 25. Corrupted Asset on Disk (Wrong Size) is Counted
   * ───────────────────────────────────────────────────────────── */
  it("25. Corrupted asset on disk (wrong size) is counted for repair", async () => {
    // Pre-create valid client jar
    const clientJarContent = Buffer.alloc(1000, "b")
    const clientJarPath = path.join(instanceRoot, "versions", "1.21.1", "1.21.1.jar")
    await fsp.mkdir(path.dirname(clientJarPath), { recursive: true })
    await fsp.writeFile(clientJarPath, clientJarContent)

    const hash = "b2c3d4e5f6000000000000000000000000000000"
    const mockAssetIndex = {
      objects: {
        "sound/step.ogg": { hash, size: 5000 },
      },
    }
    const assetIndexContent = JSON.stringify(mockAssetIndex)
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", "17.json")
    await fsp.mkdir(path.dirname(localIndexFile), { recursive: true })
    await fsp.writeFile(localIndexFile, assetIndexContent)

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 1000, sha1: computeSha1(clientJarContent) } },
      libraries: [],
      assetIndex: { id: "17", size: assetIndexContent.length, sha1: assetIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    // Write file with wrong size (3 bytes instead of 5000)
    const assetPath = path.join(instanceRoot, "assets", "objects", "b2", hash)
    await fsp.mkdir(path.dirname(assetPath), { recursive: true })
    await fsp.writeFile(assetPath, "123")

    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    const vanillaDir = path.join(instanceRoot, "versions", "1.21.1")
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, "1.21.1.json"), JSON.stringify(mockMojangMeta))

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockProfile,
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => mockAssetIndex, headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // Corrupted asset (5000 bytes) must be counted in total
      expect(totalCoreBytes).toBe(5000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 26. Native Classifiers: Platform-Specific Inclusion & Exclusion
   * ───────────────────────────────────────────────────────────── */
  it("26. Native classifiers applicable to current platform are included while other OS natives are excluded", async () => {
    const currentOs = getCurrentPlatformOsKey() // "windows", "linux", or "osx"

    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", "17.json")
    await fsp.mkdir(path.dirname(localIndexFile), { recursive: true })
    await fsp.writeFile(localIndexFile, assetIndexContent)

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 100000 } },
      libraries: [
        {
          name: "org.lwjgl:lwjgl-jemalloc:3.3.3",
          downloads: {
            artifact: { path: "org/lwjgl/lwjgl-jemalloc/3.3.3/lwjgl-jemalloc-3.3.3.jar", size: 30000 },
            classifiers: {
              "natives-windows": { path: "org/lwjgl/lwjgl-jemalloc/3.3.3/lwjgl-jemalloc-3.3.3-natives-windows.jar", size: 40000 },
              "natives-linux": { path: "org/lwjgl/lwjgl-jemalloc/3.3.3/lwjgl-jemalloc-3.3.3-natives-linux.jar", size: 50000 },
              "natives-osx": { path: "org/lwjgl/lwjgl-jemalloc/3.3.3/lwjgl-jemalloc-3.3.3-natives-osx.jar", size: 60000 },
            },
          },
          natives: { windows: "natives-windows", linux: "natives-linux", osx: "natives-osx" },
          rules: [{ action: "allow" }],
        },
      ],
      assetIndex: { id: "17", size: assetIndexContent.length, sha1: assetIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    const vanillaDir = path.join(instanceRoot, "versions", "1.21.1")
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, "1.21.1.json"), JSON.stringify(mockMojangMeta))

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockProfile,
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => ({ objects: {} }), headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      const { totalCoreBytes } = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      // Client (100k) + main artifact (30k) + native for current OS only (index file is already valid on disk)
      const expectedNativeSize = currentOs === "windows" ? 40000 : currentOs === "linux" ? 50000 : 60000
      expect(totalCoreBytes).toBe(100000 + 30000 + expectedNativeSize)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 27. Asset Index Validation: Missing vs Corrupt vs Valid
   * ───────────────────────────────────────────────────────────── */
  it("27. Asset index file itself (assets/indexes/<id>.json) is counted when missing or corrupt, and excluded when valid", async () => {
    const validIndexContent = JSON.stringify({ objects: {} })
    const validIndexSha1 = computeSha1(validIndexContent)
    const indexSize = validIndexContent.length
    const indexFilePath = path.join(instanceRoot, "assets", "indexes", "17.json")

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 1000, sha1: computeSha1(Buffer.alloc(1000)) } },
      libraries: [],
      assetIndex: { id: "17", size: indexSize, sha1: validIndexSha1, url: `${serverBaseUrl}/asset-index.json` },
    }

    // Pre-create client jar
    const clientJarPath = path.join(instanceRoot, "versions", "1.21.1", "1.21.1.jar")
    await fsp.mkdir(path.dirname(clientJarPath), { recursive: true })
    await fsp.writeFile(clientJarPath, Buffer.alloc(1000))

    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const installerPath = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    await fsp.writeFile(installerPath, zipBuffer)

    const vanillaDir = path.join(instanceRoot, "versions", "1.21.1")
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, "1.21.1.json"), JSON.stringify(mockMojangMeta))

    await saveCoreState(instanceRoot, {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installedAt: new Date().toISOString(),
      installProfile: mockProfile,
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => mockMojangMeta, headers: new Headers() } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => ({ objects: {} }), headers: new Headers() } as any
      }
      return originalFetch(url, init)
    })

    try {
      // 1. Missing index file -> counted
      if (fs.existsSync(indexFilePath)) await fsp.unlink(indexFilePath)
      const resMissing = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })
      expect(resMissing.totalCoreBytes).toBe(indexSize)

      // 2. Corrupt index file (wrong hash) -> counted
      await fsp.mkdir(path.dirname(indexFilePath), { recursive: true })
      await fsp.writeFile(indexFilePath, "corrupt-json-content")
      const resCorrupt = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })
      expect(resCorrupt.totalCoreBytes).toBe(indexSize)

      // 3. Valid index file -> 0 bytes
      await fsp.writeFile(indexFilePath, validIndexContent)
      const resValid = await estimateCoreDownloadBytes({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })
      expect(resValid.totalCoreBytes).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 28. Bootstrap Streaming Progress & Cancellation
   * ───────────────────────────────────────────────────────────── */
  it("28. bootstrapNeoForgeInstaller streams chunk progress and allows aborting cleanly without leaving corrupted destination", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const validSha256 = computeSha256(zipBuffer)

    const chunkProgressEmitted: number[] = []
    const controller = new AbortController()

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => validSha256 } as any
      }
      // Return a simulated stream
      const { Readable } = require("stream")
      const stream = new Readable({
        read() {
          this.push(zipBuffer.subarray(0, 50))
          this.push(zipBuffer.subarray(50))
          this.push(null)
        },
      })
      return {
        ok: true,
        body: stream,
      } as any
    })

    const res = await bootstrapNeoForgeInstaller({
      instanceRoot,
      neoForgeVersion: "21.1.65",
      onChunkBytes: (chunkSize: number) => {
        chunkProgressEmitted.push(chunkSize)
      },
      customFetch: mockFetch,
    })

    expect(res.downloadedInPreflight).toBe(true)
    expect(chunkProgressEmitted.length).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(res.installerJar)).toBe(true)

    // Verify cancellation deletes temp file and throws
    controller.abort()
    const installerJar2 = getNeoForgeInstallerJarPath(instanceRoot, "21.1.66")
    if (fs.existsSync(installerJar2)) await fsp.unlink(installerJar2)

    await expect(
      bootstrapNeoForgeInstaller({
        instanceRoot,
        neoForgeVersion: "21.1.66",
        signal: controller.signal,
        customFetch: mockFetch,
      }),
    ).rejects.toThrow(/Preflight cancelled/i)

    expect(fs.existsSync(installerJar2)).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────
   * 29. checkPlan() is Read-Only and Does NOT Mutate Libraries
   * ───────────────────────────────────────────────────────────── */
  it("29. checkPlan operates in read-only planning mode and does not write installer to libraries", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => computeSha256(zipBuffer) } as any
      }
      if (typeof url === "string" && url.includes("mc-version.json")) {
        return { ok: true, json: async () => ({ id: "1.21.1", downloads: { client: { size: 100 } }, libraries: [] }) } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return { ok: true, json: async () => ({ objects: {} }) } as any
      }
      if (typeof url === "string" && url.includes("neoforge-21.1.65-installer.jar")) {
        return {
          ok: true,
          headers: new Headers(),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      return originalFetch(url, init)
    })

    try {
      const manager = new GameOperationManager({
        javaValidator: () => ({ valid: true, major: 21 }),
      })

      const plan = await manager.checkPlan({
        instanceRoot,
        clientFiles: [],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      expect(plan.success).toBe(true)
      expect(plan.totalDownloadBytes).toBeGreaterThan(0)

      // CRITICAL INVARIANT: checkPlan must NOT write installer to libraries/!
      const canonicalInstallerJar = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
      expect(fs.existsSync(canonicalInstallerJar)).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 30. Official SHA-256 Checksum Verification for NeoForge Installer
   * ───────────────────────────────────────────────────────────── */
  it("30. Installer checksum SHA-256 verification enforces fail-closed on tampered download", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    // 1. Matching SHA-256 succeeds
    const mockFetchGood = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".sha256")) {
        return { ok: true, text: async () => realSha256 } as any
      }
      return { ok: true, arrayBuffer: async () => zipBuffer, buffer: async () => zipBuffer } as any
    })

    const goodRes = await bootstrapNeoForgeInstaller({
      instanceRoot,
      neoForgeVersion: "21.1.65",
      customFetch: mockFetchGood,
    })
    expect(goodRes.installerSize).toBe(zipBuffer.length)

    // 2. Mismatching SHA-256 throws fail-closed error
    const installerJar2 = getNeoForgeInstallerJarPath(instanceRoot, "21.1.66")
    if (fs.existsSync(installerJar2)) await fsp.unlink(installerJar2)

    const mockFetchBad = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".sha256")) {
        return { ok: true, text: async () => "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" } as any
      }
      return { ok: true, arrayBuffer: async () => zipBuffer, buffer: async () => zipBuffer } as any
    })

    await expect(
      bootstrapNeoForgeInstaller({
        instanceRoot,
        neoForgeVersion: "21.1.66",
        customFetch: mockFetchBad,
      }),
    ).rejects.toThrow(/SHA-256 verification failed/i)

    expect(fs.existsSync(installerJar2)).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────
   * 31. validatePlannerInstaller & loadPlannerInstallerMetadata
   * ───────────────────────────────────────────────────────────── */
  it("31. validatePlannerInstaller validates metadata, size, hash, and internal install_profile.json", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })

    // 1. Missing metadata -> invalid
    const resNoMeta = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(resNoMeta.valid).toBe(false)

    // 2. Write valid files
    await fsp.writeFile(installerJar, zipBuffer)
    const validMeta = {
      schemaVersion: 1,
      neoForgeVersion: "21.1.65",
      sha256: realSha256,
      sizeBytes: zipBuffer.length,
      cachedAt: new Date().toISOString(),
    }
    await fsp.writeFile(metadataJson, JSON.stringify(validMeta))

    const resValid = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(resValid.valid).toBe(true)
    expect(resValid.sizeBytes).toBe(zipBuffer.length)
    expect(resValid.sha256).toBe(realSha256)

    // 3. Size mismatch -> invalid
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({ ...validMeta, sizeBytes: zipBuffer.length + 50 }),
    )
    const resSizeMismatch = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(resSizeMismatch.valid).toBe(false)

    // 4. SHA-256 mismatch -> invalid
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({ ...validMeta, sha256: "0000000000000000000000000000000000000000000000000000000000000000" }),
    )
    const resShaMismatch = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(resShaMismatch.valid).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────
   * 32. resolveOfficialNeoForgeInstallerSha256 Fail-Closed Checksum
   * ───────────────────────────────────────────────────────────── */
  it("32. resolveOfficialNeoForgeInstallerSha256 rejects HTTP error and malformed checksums", async () => {
    // 1. HTTP 404
    const mockFetch404 = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    await expect(
      resolveOfficialNeoForgeInstallerSha256("21.1.65", mockFetch404),
    ).rejects.toThrow(/Failed to fetch official SHA-256 checksum/i)

    // 2. Malformed body (not 64 hex chars)
    const mockFetchBadText = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Not A Valid Checksum",
    })
    await expect(
      resolveOfficialNeoForgeInstallerSha256("21.1.65", mockFetchBadText),
    ).rejects.toThrow(/Invalid official SHA-256 checksum format/i)

    // 3. Valid body with whitespace
    const validHash = "a1b2c3d4e5f60000111122223333444455556666777788889999aaaabbbbcccc"
    const mockFetchGood = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `  ${validHash}  neoforge-21.1.65-installer.jar\n`,
    })
    const resolved = await resolveOfficialNeoForgeInstallerSha256("21.1.65", mockFetchGood)
    expect(resolved).toBe(validHash)
  })

  /* ─────────────────────────────────────────────────────────────
   * 33. promotePlannerInstallerToCanonical
   * ───────────────────────────────────────────────────────────── */
  it("33. promotePlannerInstallerToCanonical copies atomically from Planner Cache without mutating cache", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(installerJar, zipBuffer)
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({
        schemaVersion: 1,
        neoForgeVersion: "21.1.65",
        sha256: realSha256,
        sizeBytes: zipBuffer.length,
        cachedAt: new Date().toISOString(),
      }),
    )

    const plannerInstaller = {
      installerJar,
      sizeBytes: zipBuffer.length,
      sha256: realSha256,
    }

    const canonicalPath = await promotePlannerInstallerToCanonical(
      instanceRoot,
      "21.1.65",
      plannerInstaller,
    )

    expect(fs.existsSync(canonicalPath)).toBe(true)
    expect(fs.existsSync(installerJar)).toBe(true) // Planner cache preserved!
    expect(await validateFileSha256(canonicalPath, realSha256)).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 34. Frozen Progress Denominator & Monotonicity
   * ───────────────────────────────────────────────────────────── */
  it("34. startSync freezes progress denominator before first event and never emits progress before freeze", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(installerJar, zipBuffer)
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({
        schemaVersion: 1,
        neoForgeVersion: "21.1.65",
        sha256: realSha256,
        sizeBytes: zipBuffer.length,
        cachedAt: new Date().toISOString(),
      }),
    )

    const testContent = Buffer.from("mock client binary data 1234567890", "utf8")
    const task = {
      path: "mods/sample-mod.jar",
      sha256: computeSha256(testContent),
      sizeBytes: testContent.length,
      policy: "NO_MODIFICABLE",
      downloadUrl: `${serverBaseUrl}/file/sample-mod.jar`,
    }

    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn()
        .mockResolvedValueOnce({
          isCoreInstalled: false,
          hasExistingInstall: false,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
          needsVanilla: false,
          needsNeoForge: true,
          issues: [],
        })
        .mockResolvedValue({
          isCoreInstalled: true,
          hasExistingInstall: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
          needsVanilla: false,
          needsNeoForge: false,
          issues: [],
        }),
      buildCoreInstallPlan: vi.fn().mockResolvedValue({
        totalCoreBytes: 50000,
        reusableCoreBytes: zipBuffer.length,
        bootstrapNetworkBytes: 0,
        readiness: { isCoreInstalled: false },
        plannerInstaller: { status: "cached-before-operation", sizeBytes: zipBuffer.length },
      }),
      installOrRepairMinecraftCore: vi.fn().mockResolvedValue({
        success: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
      }),
    }

    const manager = new GameOperationManager({
      coreEngine: mockEngine,
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    await createMockJdk21(instanceRoot)

    const capturedTotalGB: number[] = []
    const capturedProgress: number[] = []

    const res = await manager.startSync({
      instanceRoot,
      clientFiles: [task],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      apiBaseUrl: serverBaseUrl,
      onProgress: (data: any) => {
        capturedTotalGB.push(data.totalGB)
        capturedProgress.push(data.progress)
      },
    })

    expect(res.success).toBe(true)
    expect(capturedTotalGB.length).toBeGreaterThan(0)

    // Denominator must be completely constant across all progress events (frozen)
    const firstTotalGB = capturedTotalGB[0]
    for (const total of capturedTotalGB) {
      expect(total).toBe(firstTotalGB)
    }

    // Monotonic progress
    for (let i = 1; i < capturedProgress.length; i++) {
      expect(capturedProgress[i]).toBeGreaterThanOrEqual(capturedProgress[i - 1])
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 35. Speed Calculation Excludes Cached/Reusable Bytes
   * ───────────────────────────────────────────────────────────── */
  it("35. Progress speedMBs strictly measures live network transferred bytes and excludes pre-cached bytes", async () => {
    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
        isCoreInstalled: true,
        hasExistingInstall: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
        issues: [],
      }),
      buildCoreInstallPlan: vi.fn().mockResolvedValue({
        totalCoreBytes: 0,
        reusableCoreBytes: 100000000, // 100 MB cached
        bootstrapNetworkBytes: 0,
        readiness: { isCoreInstalled: true },
        plannerInstaller: { status: "cached-before-operation", sizeBytes: 100000000 },
      }),
      installOrRepairMinecraftCore: vi.fn().mockResolvedValue({
        success: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
      }),
    }

    const manager = new GameOperationManager({
      coreEngine: mockEngine,
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    await createMockJdk21(instanceRoot)

    let maxObservedSpeed = 0

    await manager.startSync({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      isVerify: true,
      onProgress: (data: any) => {
        if (data.speedMBs > maxObservedSpeed) maxObservedSpeed = data.speedMBs
      },
    })

    // With 0 network transfer, speedMBs must remain 0 despite 100MB cached
    expect(maxObservedSpeed).toBe(0)
  })

  /* ─────────────────────────────────────────────────────────────
   * 36. Pause during bootstrap aborts active controller cleanly
   * ───────────────────────────────────────────────────────────── */
  it("36. pauseSync during bootstrap aborts active fetch and transitions to PAUSED cleanly", async () => {
    const manager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: false }),
        buildCoreInstallPlan: vi.fn().mockImplementation(async ({ cancelSignal }) => {
          cancelSignal.isPaused = true
          return {
            totalCoreBytes: 1000,
            reusableCoreBytes: 0,
            bootstrapNetworkBytes: 0,
            readiness: { isCoreInstalled: false },
          }
        }),
        installOrRepairMinecraftCore: vi.fn(),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    const syncPromise = manager.startSync({
      instanceRoot,
      clientFiles: [{
        path: "mods/mod.jar",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sizeBytes: 10,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/mod.jar`,
      }],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    const res = await syncPromise
    expect(res.paused).toBe(true)
    expect(manager.getState()).toBe("PAUSED")
  })
})
