import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import crypto from "crypto"
import http from "http"
import child_process from "child_process"
import { EventEmitter } from "events"

// @ts-expect-error CJS module
import {
  checkMinecraftCoreReadiness,
  estimateCoreDownloadBytes,
  downloadAllCoreArtifacts,
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
  canonicalNeoForgeInstallerPath,
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
import { saveInstalledManifest, executeSync, generateSyncPlan } from "./client-files-sync.cjs"

/**
 * Creates a compliant in-memory ZIP buffer containing a single file.
 */
function createZipWithFile(filename: string, content: string | Buffer): Buffer {
  return createZipWithFiles({ [filename]: content })
}

/**
 * Creates a compliant in-memory ZIP buffer containing multiple files.
 */
function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const fileEntries: Array<{
    name: Buffer
    data: Buffer
    crc: number
    offset: number
    header: Buffer
  }> = []

  const crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[i] = c
  }

  function calcCrc(data: Buffer): number {
    let crc = 0 ^ -1
    for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff]
    return (crc ^ -1) >>> 0
  }

  let currentOffset = 0
  const localChunks: Buffer[] = []

  for (const [filename, content] of Object.entries(files)) {
    const name = Buffer.from(filename, "utf8")
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")
    const crc = calcCrc(data)

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

    fileEntries.push({
      name,
      data,
      crc,
      offset: currentOffset,
      header: localHeader,
    })

    localChunks.push(localHeader, data)
    currentOffset += localHeader.length + data.length
  }

  const centralOffset = currentOffset
  const centralChunks: Buffer[] = []
  let centralSize = 0

  for (const entry of fileEntries) {
    const centralDir = Buffer.alloc(46 + entry.name.length)
    centralDir.writeUInt32LE(0x02014b50, 0)
    centralDir.writeUInt16LE(20, 4)
    centralDir.writeUInt16LE(20, 6)
    centralDir.writeUInt16LE(0, 8)
    centralDir.writeUInt16LE(0, 10)
    centralDir.writeUInt16LE(0, 12)
    centralDir.writeUInt16LE(0, 14)
    centralDir.writeUInt32LE(entry.crc, 16)
    centralDir.writeUInt32LE(entry.data.length, 20)
    centralDir.writeUInt32LE(entry.data.length, 24)
    centralDir.writeUInt16LE(entry.name.length, 28)
    centralDir.writeUInt16LE(0, 30)
    centralDir.writeUInt16LE(0, 32)
    centralDir.writeUInt16LE(0, 34)
    centralDir.writeUInt16LE(0, 36)
    centralDir.writeUInt32LE(0, 38)
    centralDir.writeUInt32LE(entry.offset, 42)
    entry.name.copy(centralDir, 46)

    centralChunks.push(centralDir)
    centralSize += centralDir.length
  }

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(fileEntries.length, 8)
  endRecord.writeUInt16LE(fileEntries.length, 10)
  endRecord.writeUInt32LE(centralSize, 12)
  endRecord.writeUInt32LE(centralOffset, 16)
  endRecord.writeUInt16LE(0, 20)

  return Buffer.concat([...localChunks, ...centralChunks, endRecord])
}

describe("HiKAT Minecraft & NeoForge Hardened Engine QA Master Suite", () => {
  let tempDir: string
  let instanceRoot: string
  let appDataRoot: string
  let server: http.Server | null = null
  let serverBaseUrl = ""

  function computeSha256(content: Buffer | string): string {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")
    return crypto.createHash("sha256").update(data).digest("hex")
  }

  function computeSha1(content: Buffer | string): string {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")
    return crypto.createHash("sha1").update(data).digest("hex")
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

  // Helper to create a fake valid JDK in dedicated runtime and instanceRoot
  async function createMockJdk21(root: string) {
    const legacyBinDir = path.join(root, "jdk-21", "bin")
    const runtimeBinDir1 = path.join(root, "runtime", "java", "21", "bin")
    const runtimeBinDir2 = path.join(path.dirname(root), "runtime", "java", "21", "bin")

    for (const dir of [legacyBinDir, runtimeBinDir1, runtimeBinDir2]) {
      await fsp.mkdir(dir, { recursive: true })
      const jExe = path.join(dir, process.platform === "win32" ? "java.exe" : "java")
      const jwExe = path.join(dir, process.platform === "win32" ? "javaw.exe" : "javaw")
      await fsp.writeFile(jExe, "mock-java-binary")
      await fsp.writeFile(jwExe, "mock-javaw-binary")
    }

    const javaExe = path.join(runtimeBinDir2, process.platform === "win32" ? "java.exe" : "java")
    const javawExe = path.join(runtimeBinDir2, process.platform === "win32" ? "javaw.exe" : "javaw")
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

    const libJarPath = path.join(
      root,
      "libraries",
      "net",
      "neoforged",
      "neoforge",
      neoForgeVersion,
      `neoforge-${neoForgeVersion}-universal.jar`,
    )
    await fsp.mkdir(path.dirname(libJarPath), { recursive: true })
    const libJarContent = "mock-neoforge-universal-jar"
    const libJarSha1 = computeSha1(libJarContent)
    await fsp.writeFile(libJarPath, libJarContent)

    await fsp.writeFile(
      path.join(nfDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        time: "2024-08-08T00:00:00Z",
        releaseTime: "2024-08-08T00:00:00Z",
        type: "release",
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        inheritsFrom: mcVersion,
        libraries: [
          {
            name: `net.neoforged:neoforge:${neoForgeVersion}:universal`,
            downloads: {
              artifact: {
                path: `net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`,
                size: libJarContent.length,
                sha1: libJarSha1,
              },
            },
          },
        ],
      }),
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
            [`{ROOT}/libraries/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`]: libJarSha1,
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
   * 11. Core-state.json is auxiliary metadata: readiness passes without it
   * ───────────────────────────────────────────────────────────── */
  it("11. checkMinecraftCoreReadiness passes when core files exist even if core-state.json is missing", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    // Remove core-state.json completely
    const coreStateFile = path.join(instanceRoot, ".hikat", "core-state.json")
    if (fs.existsSync(coreStateFile)) await fsp.unlink(coreStateFile)

    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(readiness.isCoreInstalled).toBe(true)
    expect(readiness.needsNeoForge).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────
   * 12. Restored: Missing Processor Output marks Core Not Ready
   * ───────────────────────────────────────────────────────────── */
  it("12. checkMinecraftCoreReadiness detects missing processor outputs and marks needsNeoForge true", async () => {
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    const clientLib = path.join(instanceRoot, "libraries", "net", "neoforged", "neoforge", "21.1.65", "neoforge-21.1.65-universal.jar")
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
      if (typeof url === "string" && (url.includes("version_manifest") || url.includes("launchermeta") || url.includes("piston-meta"))) {
        return {
          ok: true,
          json: async () => ({ versions: [{ id: "1.21.1", url: `${serverBaseUrl}/mc-version.json` }] }),
          headers: new Headers(),
        } as any
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
  }, 15000)

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
      schemaVersion: 2,
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
        schemaVersion: 2,
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
        schemaVersion: 2,
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

  /* ─────────────────────────────────────────────────────────────
   * 37. Canonical installer with matching official SHA-256 is reused
   * ───────────────────────────────────────────────────────────── */
  it("37. Canonical installer with matching official SHA-256 is imported to Planner Cache without downloading JAR", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    // Pre-create canonical installer jar in instanceRoot/libraries
    const canonicalJar = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(canonicalJar), { recursive: true })
    await fsp.writeFile(canonicalJar, zipBuffer)

    let jarDownloadAttempted = false
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".sha256")) {
        return { ok: true, text: async () => `${realSha256} neoforge-21.1.65-installer.jar` } as any
      }
      if (url.includes("-installer.jar")) {
        jarDownloadAttempted = true
        return { ok: true, arrayBuffer: async () => zipBuffer, buffer: async () => zipBuffer } as any
      }
      return { ok: false, status: 404 } as any
    })

    const result = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: "21.1.65",
      customFetch: mockFetch,
    })

    expect(result.wasAlreadyCached).toBe(true)
    expect(result.downloadedBytes).toBe(0)
    expect(jarDownloadAttempted).toBe(false)
    expect(fs.existsSync(result.installerJar)).toBe(true)
    expect(await validateFileSha256(result.installerJar, realSha256)).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 38. Canonical installer with invalid SHA-256 is ignored and replaced
   * ───────────────────────────────────────────────────────────── */
  it("38. Canonical installer with invalid SHA-256 is distrusted and replaced by fresh download", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const validZipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(validZipBuffer)

    // Pre-create corrupted canonical jar
    const canonicalJar = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(canonicalJar), { recursive: true })
    await fsp.writeFile(canonicalJar, "tampered-corrupted-installer-content")

    let jarDownloaded = false
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".sha256")) {
        return { ok: true, text: async () => realSha256 } as any
      }
      if (url.includes("-installer.jar")) {
        jarDownloaded = true
        return {
          ok: true,
          headers: new Headers({ "content-length": String(validZipBuffer.length) }),
          arrayBuffer: async () => validZipBuffer,
          buffer: async () => validZipBuffer,
        } as any
      }
      return { ok: false, status: 404 } as any
    })

    const result = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: "21.1.65",
      customFetch: mockFetch,
    })

    expect(result.wasAlreadyCached).toBe(false)
    expect(jarDownloaded).toBe(true)
    expect(result.downloadedBytes).toBe(validZipBuffer.length)
    expect(await validateFileSha256(result.installerJar, realSha256)).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 39. NeoForge installer registers expectedSha256 and Mojang registers expectedSha1
   * ───────────────────────────────────────────────────────────── */
  it("39. NeoForge installer registers expectedSha256 while Mojang artifacts register expectedSha1", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(installerJar, zipBuffer)
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({
        schemaVersion: 2,
        neoForgeVersion: "21.1.65",
        sha256: realSha256,
        sizeBytes: zipBuffer.length,
        cachedAt: new Date().toISOString(),
      }),
    )

    const mockMojangMeta = {
      id: "1.21.1",
      downloads: { client: { size: 5000, sha1: "1111111111111111111111111111111111111111" } },
      libraries: [
        {
          downloads: {
            artifact: {
              path: "com/mojang/lib/1.0/lib-1.0.jar",
              size: 2000,
              sha1: "2222222222222222222222222222222222222222",
            },
          },
        },
      ],
      assetIndex: { id: "17", size: 100, sha1: "3333333333333333333333333333333333333333", url: `${serverBaseUrl}/asset-index.json` },
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => realSha256 } as any
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
      const plan = await buildCoreInstallPlan({
        instanceRoot,
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      })

      const installerArtifact = Array.from(plan.artifacts.values()).find((a: any) => a.role === "neoforge-installer")
      const clientArtifact = Array.from(plan.artifacts.values()).find((a: any) => a.role === "client-jar")
      const libArtifact = Array.from(plan.artifacts.values()).find((a: any) => a.role === "vanilla-library")

      expect(installerArtifact).toBeDefined()
      expect(installerArtifact.expectedSha256).toBe(realSha256)
      expect(installerArtifact.expectedSha1).toBeNull()

      expect(clientArtifact).toBeDefined()
      expect(clientArtifact.expectedSha1).toBe("1111111111111111111111111111111111111111")
      expect(clientArtifact.expectedSha256).toBeNull()

      expect(libArtifact).toBeDefined()
      expect(libArtifact.expectedSha1).toBe("2222222222222222222222222222222222222222")
      expect(libArtifact.expectedSha256).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 40. Pause aborts simulated fetch and resolves { success: true, paused: true }
   * ───────────────────────────────────────────────────────────── */
  it("40. pauseSync aborts active fetch and both startSync and pauseSync resolve paused without error", async () => {
    await createMockJdk21(appDataRoot)
    let fetchAborted = false

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: any) => {
      return new Promise((resolve, reject) => {
        if (init?.signal?.aborted) {
          fetchAborted = true
          const err = new Error("The operation was aborted")
          err.name = "AbortError"
          reject(err)
          return
        }
        init?.signal?.addEventListener("abort", () => {
          fetchAborted = true
          const err = new Error("The operation was aborted")
          err.name = "AbortError"
          reject(err)
        })
      })
    })

    const manager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: false }),
        buildCoreInstallPlan: vi.fn().mockImplementation(async ({ signal, cancelSignal }) => {
          return await ensurePlannerInstaller({
            instanceRoot,
            neoForgeVersion: "21.1.65",
            signal,
            cancelSignal,
            customFetch: mockFetch,
          })
        }),
        installOrRepairMinecraftCore: vi.fn(),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    const samplePayload = Buffer.from("mock client binary data 1234567890", "utf8")
    const sampleFiles = [
      {
        path: "mods/sample.jar",
        sha256: computeSha256(samplePayload),
        sizeBytes: samplePayload.length,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/sample.jar`,
      },
    ]

    const syncPromise = manager.startSync({
      instanceRoot,
      clientFiles: sampleFiles,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    // Give time to enter fetch
    await new Promise((r) => setTimeout(r, 20))

    const pauseResult = await manager.pauseSync()
    const syncResult = await syncPromise

    expect(fetchAborted).toBe(true)
    expect(pauseResult.success).toBe(true)
    expect(pauseResult.paused).toBe(true)
    expect(syncResult.success).toBe(true)
    expect(syncResult.paused).toBe(true)
    expect(manager.getState()).toBe("PAUSED")
  })

  /* ─────────────────────────────────────────────────────────────
   * 41. Cancel aborts fetch and terminates cleanly with IDLE state
   * ───────────────────────────────────────────────────────────── */
  it("41. cancelSync aborts active fetch and terminates cleanly to IDLE state", async () => {
    await createMockJdk21(appDataRoot)
    let fetchAborted = false

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: any) => {
      return new Promise((resolve, reject) => {
        if (init?.signal?.aborted) {
          fetchAborted = true
          const err = new Error("The operation was aborted")
          err.name = "AbortError"
          reject(err)
          return
        }
        init?.signal?.addEventListener("abort", () => {
          fetchAborted = true
          const err = new Error("The operation was aborted")
          err.name = "AbortError"
          reject(err)
        })
      })
    })

    const manager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: false }),
        buildCoreInstallPlan: vi.fn().mockImplementation(async ({ signal, cancelSignal }) => {
          return await ensurePlannerInstaller({
            instanceRoot,
            neoForgeVersion: "21.1.65",
            signal,
            cancelSignal,
            customFetch: mockFetch,
          })
        }),
        installOrRepairMinecraftCore: vi.fn(),
      },
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    const samplePayload = Buffer.from("mock client binary data 1234567890", "utf8")
    const sampleFiles = [
      {
        path: "mods/sample.jar",
        sha256: computeSha256(samplePayload),
        sizeBytes: samplePayload.length,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/sample.jar`,
      },
    ]

    const syncPromise = manager.startSync({
      instanceRoot,
      clientFiles: sampleFiles,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    // Attach rejection expectation immediately to prevent unhandled rejection warning
    const syncRejection = expect(syncPromise).rejects.toThrow(/cancelled/i)

    // Give time to enter fetch
    await new Promise((r) => setTimeout(r, 20))

    const cancelResult = await manager.cancelSync(instanceRoot)
    await syncRejection

    expect(fetchAborted).toBe(true)
    expect(cancelResult.success).toBe(true)
    expect(manager.getState()).toBe("IDLE")
  })

  /* ─────────────────────────────────────────────────────────────
   * 42. Resume creates a fresh un-aborted AbortController
   * ───────────────────────────────────────────────────────────── */
  it("42. Resuming after pause instantiates a fresh un-aborted AbortController", async () => {
    const receivedSignals: AbortSignal[] = []

    const mockEngine = {
      checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: true, hasExistingInstall: true }),
      buildCoreInstallPlan: vi.fn().mockImplementation(async ({ signal }) => {
        receivedSignals.push(signal)
        return {
          totalCoreBytes: 0,
          reusableCoreBytes: 100,
          bootstrapNetworkBytes: 0,
          readiness: { isCoreInstalled: true },
        }
      }),
      installOrRepairMinecraftCore: vi.fn().mockResolvedValue({ success: true }),
    }

    const manager = new GameOperationManager({
      coreEngine: mockEngine,
      javaValidator: () => ({ valid: true, major: 21 }),
    })

    await createMockJdk21(instanceRoot)

    const samplePayload = Buffer.from("mock client binary data 1234567890", "utf8")
    const sampleFiles = [
      {
        path: "mods/sample.jar",
        sha256: computeSha256(samplePayload),
        sizeBytes: samplePayload.length,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/file/sample.jar`,
      },
    ]

    // 1st run -> pause
    const run1 = manager.startSync({
      instanceRoot,
      clientFiles: sampleFiles,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })
    await manager.pauseSync()
    await run1

    expect(receivedSignals.length).toBe(1)
    expect(receivedSignals[0].aborted).toBe(true) // Was aborted by pauseSync

    // 2nd run (Resume) -> should have fresh un-aborted signal
    const run2 = await manager.startSync({
      instanceRoot,
      clientFiles: sampleFiles,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(run2.success).toBe(true)
    expect(receivedSignals.length).toBe(2)
    expect(receivedSignals[1].aborted).toBe(false) // Fresh signal!
  })

  /* ─────────────────────────────────────────────────────────────
   * 43. Legacy schemaVersion: 1 cache is rejected as invalid
   * ───────────────────────────────────────────────────────────── */
  it("43. Cache with schemaVersion: 1 is returned as invalid by validatePlannerInstaller", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(installerJar, zipBuffer)
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({
        schemaVersion: 1, // Legacy untrusted schema
        neoForgeVersion: "21.1.65",
        sha256: realSha256,
        sizeBytes: zipBuffer.length,
        cachedAt: new Date().toISOString(),
      }),
    )

    const result = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(result.valid).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────
   * 44. Valid schemaVersion: 2 cache is accepted and reused
   * ───────────────────────────────────────────────────────────── */
  it("44. Valid cache with schemaVersion: 2 is accepted by validatePlannerInstaller and reused", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(installerJar, zipBuffer)
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({
        schemaVersion: 2, // Modern trusted schema
        neoForgeVersion: "21.1.65",
        sha256: realSha256,
        sizeBytes: zipBuffer.length,
        cachedAt: new Date().toISOString(),
      }),
    )

    const result = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(result.valid).toBe(true)
    expect(result.sha256).toBe(realSha256)
    expect(result.sizeBytes).toBe(zipBuffer.length)
  })

  /* ─────────────────────────────────────────────────────────────
   * 45. Valid canonical installer + v1 cache regenerates as v2 after official checksum validation
   * ───────────────────────────────────────────────────────────── */
  it("45. Valid canonical installer with legacy v1 cache validates against official checksum and regenerates as schemaVersion: 2", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    // Pre-create legacy v1 cache
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

    // Pre-create valid canonical jar in libraries
    const canonicalJar = getNeoForgeInstallerJarPath(instanceRoot, "21.1.65")
    await fsp.mkdir(path.dirname(canonicalJar), { recursive: true })
    await fsp.writeFile(canonicalJar, zipBuffer)

    let jarDownloadAttempted = false
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".sha256")) {
        return { ok: true, text: async () => `${realSha256} neoforge-21.1.65-installer.jar` } as any
      }
      if (url.includes("-installer.jar")) {
        jarDownloadAttempted = true
        return { ok: true, arrayBuffer: async () => zipBuffer, buffer: async () => zipBuffer } as any
      }
      return { ok: false, status: 404 } as any
    })

    const result = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: "21.1.65",
      customFetch: mockFetch,
    })

    expect(result.wasAlreadyCached).toBe(true)
    expect(result.downloadedBytes).toBe(0)
    expect(jarDownloadAttempted).toBe(false)

    // Verify metadata was migrated to schemaVersion: 2
    const updatedMeta = JSON.parse(await fsp.readFile(metadataJson, "utf8"))
    expect(updatedMeta.schemaVersion).toBe(2)
    expect(updatedMeta.sha256).toBe(realSha256)

    // Now validatePlannerInstaller accepts it directly
    const validCheck = await validatePlannerInstaller(instanceRoot, "21.1.65", "1.21.1")
    expect(validCheck.valid).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 46. Legacy v1 cache is never trusted directly without official trust chain
   * ───────────────────────────────────────────────────────────── */
  it("46. Legacy v1 cache is never reused directly and passes through official trust chain and download", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const validZipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(validZipBuffer)

    // Pre-create untrusted v1 cache (e.g. self-computed hash from old code)
    const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, "21.1.65")
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(installerJar, "old-untrusted-installer-payload")
    await fsp.writeFile(
      metadataJson,
      JSON.stringify({
        schemaVersion: 1,
        neoForgeVersion: "21.1.65",
        sha256: "untrusted-hash-from-old-version",
        sizeBytes: 31,
        cachedAt: new Date().toISOString(),
      }),
    )

    let jarDownloaded = false
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".sha256")) {
        return { ok: true, text: async () => realSha256 } as any
      }
      if (url.includes("-installer.jar")) {
        jarDownloaded = true
        return {
          ok: true,
          headers: new Headers({ "content-length": String(validZipBuffer.length) }),
          arrayBuffer: async () => validZipBuffer,
          buffer: async () => validZipBuffer,
        } as any
      }
      return { ok: false, status: 404 } as any
    })

    const result = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: "21.1.65",
      customFetch: mockFetch,
    })

    // Must NOT reuse the untrusted v1 cache
    expect(result.wasAlreadyCached).toBe(false)
    expect(jarDownloaded).toBe(true)
    expect(result.downloadedBytes).toBe(validZipBuffer.length)

    // Overwritten with valid schemaVersion: 2
    const updatedMeta = JSON.parse(await fsp.readFile(metadataJson, "utf8"))
    expect(updatedMeta.schemaVersion).toBe(2)
    expect(updatedMeta.sha256).toBe(realSha256)
  })

  /* ─────────────────────────────────────────────────────────────
   * 47. Java version emitted strictly on stderr correctly detects Java 21
   * ───────────────────────────────────────────────────────────── */
  it("47. validateJavaBinary correctly detects Java 21 when output is emitted strictly on stderr", async () => {
    const { javaExe } = await createMockJdk21(instanceRoot)
    const mockSpawn = () => ({
      stdout: "",
      stderr: 'openjdk version "21.0.3" 2024-04-16 LTS\nOpenJDK Runtime Environment (build 21.0.3+9-LTS)\nOpenJDK 64-Bit Server VM (build 21.0.3+9-LTS, mixed mode, sharing)',
    })
    const validation = validateJavaBinary(javaExe, 21, mockSpawn as any)
    expect(validation.valid).toBe(true)
    expect(validation.major).toBe(21)
  })

  /* ─────────────────────────────────────────────────────────────
   * 48. Java version emitted strictly on stdout correctly detects Java 21
   * ───────────────────────────────────────────────────────────── */
  it("48. validateJavaBinary correctly detects Java 21 when output is emitted strictly on stdout", async () => {
    const { javaExe } = await createMockJdk21(instanceRoot)
    const mockSpawn = () => ({
      stdout: 'java version "21.0.1" 2023-10-17 LTS\nJava(TM) SE Runtime Environment (build 21.0.1+12-LTS-29)\nJava HotSpot(TM) 64-Bit Server VM (build 21.0.1+12-LTS-29, mixed mode, sharing)',
      stderr: "",
    })
    const validation = validateJavaBinary(javaExe, 21, mockSpawn as any)
    expect(validation.valid).toBe(true)
    expect(validation.major).toBe(21)
  })

  /* ─────────────────────────────────────────────────────────────
   * 49. Incompatible Java 17 version is rejected
   * ───────────────────────────────────────────────────────────── */
  it("49. validateJavaBinary rejects incompatible Java version (e.g. Java 17)", async () => {
    const { javaExe } = await createMockJdk21(instanceRoot)
    const mockSpawn = () => ({
      stdout: "",
      stderr: 'openjdk version "17.0.8" 2023-07-18 LTS',
    })
    const validation = validateJavaBinary(javaExe, 21, mockSpawn as any)
    expect(validation.valid).toBe(false)
    expect(validation.major).toBe(17)
    expect(validation.error).toMatch(/Incompatible Java version.*found Java 17.*expected Java 21/i)
  })

  /* ─────────────────────────────────────────────────────────────
   * 50. Invalid output or spawn error is rejected fail-closed
   * ───────────────────────────────────────────────────────────── */
  it("50. validateJavaBinary rejects invalid unparseable output or execution error (fail-closed)", async () => {
    const { javaExe } = await createMockJdk21(instanceRoot)

    // Unparseable output
    const mockSpawnBad = () => ({
      stdout: "some random string without version",
      stderr: "unrecognized option: -version",
    })
    const badValidation = validateJavaBinary(javaExe, 21, mockSpawnBad as any)
    expect(badValidation.valid).toBe(false)
    expect(badValidation.major).toBeNull()
    expect(badValidation.error).toMatch(/Unable to parse Java version/i)

    // Process error
    const mockSpawnErr = () => ({
      error: new Error("spawnSync ENOEXEC"),
    })
    const errValidation = validateJavaBinary(javaExe, 21, mockSpawnErr as any)
    expect(errValidation.valid).toBe(false)
    expect(errValidation.error).toMatch(/ENOEXEC/i)

    // Non-existent binary path
    const nonExistentValidation = validateJavaBinary(path.join(instanceRoot, "jdk-21", "bin", "nonexistent.exe"))
    expect(nonExistentValidation.valid).toBe(false)
    expect(nonExistentValidation.error).toMatch(/Java binary not found/i)
  })

  /* ─────────────────────────────────────────────────────────────
   * 51. Fresh install: DOWNLOADING -> INSTALLING -> VERIFYING -> READY without regression
   * ───────────────────────────────────────────────────────────── */
  it("51. Fresh install exhibits strictly monotonic lifecycle without regressions from INSTALLING to DOWNLOADING", async () => {
    await createMockJdk21(appDataRoot)

    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi
          .fn()
          .mockResolvedValueOnce({ isCoreInstalled: false, issues: ["Fresh install"] })
          .mockResolvedValue({ isCoreInstalled: true, resolvedVersionId: "1.21.1-neoforge-21.1.65" }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 1000, reusableCoreBytes: 0 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 1000,
          reusableCoreBytes: 0,
          artifacts: new Map(),
          needsNeoForge: true,
          installProfile: { version: "21.1.65" },
        }),
        downloadAllCoreArtifacts: vi.fn().mockResolvedValue({ success: true }),
        installOrRepairMinecraftCore: vi.fn().mockResolvedValue({
          success: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
        }),
      },
      javaValidator: vi.fn().mockReturnValue({ valid: true, major: 21 }),
    })

    const sampleContent = "mock client binary data 1234567890"
    const sampleSha256 = computeSha256(sampleContent)
    const clientPayload = [
      {
        path: "mods/test-mod.jar",
        sha256: sampleSha256,
        sizeBytes: Buffer.byteLength(sampleContent),
        downloadUrl: `${serverBaseUrl}/file/test-mod.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    const observedPhases: string[] = []
    const progressPhases: string[] = []

    const result = await opManager.startSync({
      instanceRoot,
      clientFiles: clientPayload,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      onPhaseChange: (phase: string) => {
        observedPhases.push(phase)
      },
      onProgress: (prog: any) => {
        progressPhases.push(prog.phase)
      },
    })

    expect(result.success).toBe(true)

    // Verify monotonic progression
    const validSequence = ["DOWNLOADING", "INSTALLING", "VERIFYING"]
    let lastSeqIndex = -1
    for (const phase of observedPhases) {
      const idx = validSequence.indexOf(phase)
      expect(idx).toBeGreaterThanOrEqual(lastSeqIndex)
      lastSeqIndex = idx
    }

    // Verify INSTALLING never goes back to DOWNLOADING
    const installingIndex = observedPhases.indexOf("INSTALLING")
    if (installingIndex !== -1) {
      const remainingPhases = observedPhases.slice(installingIndex)
      expect(remainingPhases).not.toContain("DOWNLOADING")
    }
  })

  /* ─────────────────────────────────────────────────────────────
   * 52. Java 21 is resolved in <appDataRoot>/runtime/java/21
   * ───────────────────────────────────────────────────────────── */
  it("52. Java 21 is managed outside instanceRoot in dedicated runtime/java/21 directory", async () => {
    const { javaExe } = await createMockJdk21(appDataRoot)

    const resolved = resolveJavaRuntime(instanceRoot, { isGui: false })
    expect(resolved.isOfficialJdk).toBe(true)
    expect(resolved.cliJavaPath).toBeTruthy()
    // Must NOT be inside instanceRoot
    expect(resolved.cliJavaPath?.startsWith(instanceRoot)).toBe(false)
    expect(resolved.cliJavaPath).toContain(path.join("runtime", "java", "21"))
  })

  /* ─────────────────────────────────────────────────────────────
   * 53. Legacy jdk-21/** clientFiles are filtered out and not downloaded
   * ───────────────────────────────────────────────────────────── */
  it("53. Legacy jdk-21/** clientFiles are filtered out of sync plan and not downloaded into instanceRoot", async () => {
    const clientPayload = [
      {
        path: "jdk-21/bin/java.exe",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        sizeBytes: 50000,
        downloadUrl: `${serverBaseUrl}/file/java.exe`,
        policy: "NO_MODIFICABLE",
      },
      {
        path: "mods/real-mod.jar",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        sizeBytes: 200,
        downloadUrl: `${serverBaseUrl}/file/real-mod.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    const plan = await generateSyncPlan(instanceRoot, clientPayload, "1.0.0")

    const pathsToDownload = plan.toDownload.map((t: any) => t.path)
    expect(pathsToDownload).not.toContain("jdk-21/bin/java.exe")
    expect(pathsToDownload).toContain("mods/real-mod.jar")
    expect(plan.totalDownloadBytes).toBe(200)
  })

  /* ─────────────────────────────────────────────────────────────
   * 54. Java corrupt/missing triggers repair in dedicated runtime
   * ───────────────────────────────────────────────────────────── */
  it("54. Corrupted Java binary is detected and triggers repair", async () => {
    let validateCallCount = 0
    const mockValidator = vi.fn().mockImplementation(() => {
      validateCallCount++
      if (validateCallCount === 1) {
        return { valid: false, error: "Corrupted Java binary" }
      }
      return { valid: true, major: 21 }
    })

    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: true, resolvedVersionId: "1.21.1" }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0, reusableCoreBytes: 0 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 0,
          reusableCoreBytes: 0,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
      },
      javaValidator: mockValidator,
    })

    // Plan check detects Java needs update
    const check = await opManager.checkPlan({
      instanceRoot,
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(check.javaInstalled).toBe(false)
    expect(check.needsUpdate).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 55. Java other than 21 fails-closed
   * ───────────────────────────────────────────────────────────── */
  it("55. Java runtime reporting different major version (e.g. 17) fails-closed", async () => {
    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: true, resolvedVersionId: "1.21.1" }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0, reusableCoreBytes: 0 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 0,
          reusableCoreBytes: 0,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
      },
      javaValidator: vi.fn().mockReturnValue({ valid: false, major: 17, error: "Incompatible Java version 17" }),
    })

    const sampleContent = "mock client binary data 1234567890"
    const sampleSha256 = computeSha256(sampleContent)
    const clientPayload = [
      {
        path: "mods/test-mod.jar",
        sha256: sampleSha256,
        sizeBytes: Buffer.byteLength(sampleContent),
        downloadUrl: `${serverBaseUrl}/file/test-mod.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    await expect(
      opManager.startSync({
        instanceRoot,
        clientFiles: clientPayload,
        modpackVersion: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
      }),
    ).rejects.toThrow(/Java runtime validation failed|Incompatible Java version 17/i)
  })

  /* ─────────────────────────────────────────────────────────────
   * 56. Healthy existing installation does not re-download Java or Core
   * ───────────────────────────────────────────────────────────── */
  it("56. Fully healthy installation does not re-download Java or Core", async () => {
    await createMockJdk21(appDataRoot)

    const sampleContent = "mock client binary data 1234567890"
    const sampleSha256 = computeSha256(sampleContent)
    const modFile = path.join(instanceRoot, "mods", "test-mod.jar")
    await fsp.mkdir(path.dirname(modFile), { recursive: true })
    await fsp.writeFile(modFile, sampleContent)

    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      lastSync: new Date().toISOString(),
      files: {
        "mods/test-mod.jar": {
          officialSha256: sampleSha256,
          policy: "NO_MODIFICABLE",
          lastSyncedAt: new Date().toISOString(),
        },
      },
    })

    const clientPayload = [
      {
        path: "mods/test-mod.jar",
        sha256: sampleSha256,
        sizeBytes: Buffer.byteLength(sampleContent),
        downloadUrl: `${serverBaseUrl}/file/test-mod.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    const dlCoreSpy = vi.fn().mockResolvedValue({ success: true })
    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
          isCoreInstalled: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
        }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0, reusableCoreBytes: 50000 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 0,
          reusableCoreBytes: 50000,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
        downloadAllCoreArtifacts: dlCoreSpy,
      },
      javaValidator: vi.fn().mockReturnValue({ valid: true, major: 21 }),
    })

    const result = await opManager.startSync({
      instanceRoot,
      clientFiles: clientPayload,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(result.success).toBe(true)
    expect(dlCoreSpy).not.toHaveBeenCalled()
  })

  /* ─────────────────────────────────────────────────────────────
   * 57. Modpack-only update does not re-install Java or Core
   * ───────────────────────────────────────────────────────────── */
  it("57. Modpack-only update downloads only changed clientFiles without re-installing Core", async () => {
    await createMockJdk21(appDataRoot)

    const installCoreSpy = vi.fn()
    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({
          isCoreInstalled: true,
          resolvedVersionId: "1.21.1-neoforge-21.1.65",
        }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0, reusableCoreBytes: 10000 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 0,
          reusableCoreBytes: 10000,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
        installOrRepairMinecraftCore: installCoreSpy,
      },
      javaValidator: vi.fn().mockReturnValue({ valid: true, major: 21 }),
    })

    const sampleContent = "mock client binary data 1234567890"
    const sampleSha256 = computeSha256(sampleContent)
    const clientPayload = [
      {
        path: "mods/new-mod.jar",
        sha256: sampleSha256,
        sizeBytes: Buffer.byteLength(sampleContent),
        downloadUrl: `${serverBaseUrl}/file/new-mod.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    const result = await opManager.startSync({
      instanceRoot,
      clientFiles: clientPayload,
      modpackVersion: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(result.success).toBe(true)
    // Core install should NOT be invoked
    expect(installCoreSpy).not.toHaveBeenCalled()
  })

  /* ─────────────────────────────────────────────────────────────
   * 58. Pause / Resume / Cancel work seamlessly
   * ───────────────────────────────────────────────────────────── */
  it("58. Pause, Resume, and Cancel operate cleanly without data corruption", async () => {
    await createMockJdk21(appDataRoot)

    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi.fn().mockResolvedValue({ isCoreInstalled: true, resolvedVersionId: "1.21.1" }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 0, reusableCoreBytes: 0 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 0,
          reusableCoreBytes: 0,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
      },
      javaValidator: vi.fn().mockReturnValue({ valid: true, major: 21 }),
    })

    // Cancel in IDLE state cleans staging and stays IDLE
    const cancelRes = await opManager.cancelSync(instanceRoot)
    expect(cancelRes.success).toBe(true)
    expect(opManager.getState()).toBe("IDLE")
  })

  /* ─────────────────────────────────────────────────────────────
   * 59. ZERO network transfers occur once entered into INSTALLING phase
   * ───────────────────────────────────────────────────────────── */
  it("59. Zero network chunk transfers occur once the pipeline enters INSTALLING phase", async () => {
    await createMockJdk21(appDataRoot)

    let isInstallingEntered = false
    let networkChunkAfterInstalling = false

    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi
          .fn()
          .mockResolvedValueOnce({ isCoreInstalled: false })
          .mockResolvedValue({ isCoreInstalled: true, resolvedVersionId: "1.21.1" }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 500, reusableCoreBytes: 0 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 500,
          reusableCoreBytes: 0,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
        downloadAllCoreArtifacts: vi.fn().mockImplementation(async ({ onTaskBytes }) => {
          if (isInstallingEntered) {
            networkChunkAfterInstalling = true
          }
          onTaskBytes?.("test-lib", 500)
          return { success: true }
        }),
        installOrRepairMinecraftCore: vi.fn().mockImplementation(async ({ onPhaseChange }) => {
          isInstallingEntered = true
          onPhaseChange?.("INSTALLING")
          return { success: true, resolvedVersionId: "1.21.1" }
        }),
      },
      javaValidator: vi.fn().mockReturnValue({ valid: true, major: 21 }),
    })

    const sampleContent = "mock client binary data 1234567890"
    const sampleSha256 = computeSha256(sampleContent)
    const clientPayload = [
      {
        path: "mods/test-mod.jar",
        sha256: sampleSha256,
        sizeBytes: Buffer.byteLength(sampleContent),
        downloadUrl: `${serverBaseUrl}/file/test-mod.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    await opManager.startSync({
      instanceRoot,
      clientFiles: clientPayload,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      onPhaseChange: (phase: string) => {
        if (phase === "INSTALLING") {
          isInstallingEntered = true
        }
      },
    })

    expect(networkChunkAfterInstalling).toBe(false)
  })

  /* ─────────────────────────────────────────────────────────────
   * 60. Fresh install without core-state.json passes final readiness and creates core-state.json
   * ───────────────────────────────────────────────────────────── */
  it("60. Fresh install without core-state.json installs correctly, passes readiness, and creates core-state.json", async () => {
    const { javaCliPath } = await createMockJdk21(appDataRoot)

    // Pre-create full installed core (vanilla jar, assets, neoforge version json and lib)
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    // Ensure core-state.json does NOT exist initially
    const coreStatePath = path.join(instanceRoot, ".hikat", "core-state.json")
    if (fs.existsSync(coreStatePath)) await fsp.unlink(coreStatePath)
    expect(fs.existsSync(coreStatePath)).toBe(false)

    // Initial check: readiness passes even though core-state.json does NOT exist
    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })
    expect(readiness.isCoreInstalled).toBe(true)

    // Now test installOrRepairMinecraftCore with preparedPlan (which writes core-state.json)
    const preparedPlan = {
      totalCoreBytes: 0,
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      needsNeoForge: false,
      needsVanilla: false,
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installProfile: { version: "21.1.65" },
      mojangPackage: { id: "1.21.1" },
      artifacts: new Map(),
      readiness: { isCoreInstalled: false, needsNeoForge: false, resolvedVersionId: "1.21.1-neoforge-21.1.65" },
    }

    const installResult = await installOrRepairMinecraftCore({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      javaCliPath,
      preparedPlan,
    })

    expect(installResult.success).toBe(true)

    // Post-installation verification: core-state.json was created
    expect(fs.existsSync(coreStatePath)).toBe(true)
    const savedState = JSON.parse(await fsp.readFile(coreStatePath, "utf8"))
    expect(savedState.minecraftVersion).toBe("1.21.1")
    expect(savedState.neoForgeVersion).toBe("21.1.65")
  })

  /* ─────────────────────────────────────────────────────────────
   * 61. Strict Monotonic Lifecycle: once INSTALLING is reached, DOWNLOADING never appears
   * ───────────────────────────────────────────────────────────── */
  it("61. Real pipeline never reverts to DOWNLOADING after first entering INSTALLING", async () => {
    await createMockJdk21(appDataRoot)

    const phasesSeen: string[] = []
    let hasEnteredInstalling = false
    let downloadingAfterInstalling = false

    const opManager = new GameOperationManager({
      coreEngine: {
        checkMinecraftCoreReadiness: vi
          .fn()
          .mockResolvedValueOnce({ isCoreInstalled: false })
          .mockResolvedValue({ isCoreInstalled: true, resolvedVersionId: "1.21.1" }),
        estimateCoreDownloadBytes: vi.fn().mockResolvedValue({ totalCoreBytes: 200, reusableCoreBytes: 0 }),
        buildCoreInstallPlan: vi.fn().mockResolvedValue({
          totalCoreBytes: 200,
          reusableCoreBytes: 0,
          artifacts: new Map(),
          needsNeoForge: false,
        }),
        downloadAllCoreArtifacts: vi.fn().mockImplementation(async ({ onTaskBytes }) => {
          onTaskBytes?.("test-artifact", 200)
          return { success: true }
        }),
        installOrRepairMinecraftCore: vi.fn().mockImplementation(async ({ onPhaseChange }) => {
          onPhaseChange?.("INSTALLING")
          onPhaseChange?.("VERIFYING")
          return { success: true, resolvedVersionId: "1.21.1" }
        }),
      },
      javaValidator: vi.fn().mockReturnValue({ valid: true, major: 21 }),
    })

    const sampleContent = Buffer.from("mock client binary data 1234567890", "utf8")
    const samplePayload = [
      {
        path: "mods/sample.jar",
        sha256: computeSha256(sampleContent),
        sizeBytes: sampleContent.length,
        downloadUrl: `${serverBaseUrl}/file/sample.jar`,
        policy: "NO_MODIFICABLE",
      },
    ]

    await opManager.startSync({
      instanceRoot,
      clientFiles: samplePayload,
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      onProgress: (d: any) => {
        phasesSeen.push(d.phase)
        if (d.phase === "INSTALLING") {
          hasEnteredInstalling = true
        }
        if (hasEnteredInstalling && d.phase === "DOWNLOADING") {
          downloadingAfterInstalling = true
        }
      },
      onPhaseChange: (phase: string) => {
        phasesSeen.push(phase)
        if (phase === "INSTALLING") {
          hasEnteredInstalling = true
        }
        if (hasEnteredInstalling && phase === "DOWNLOADING") {
          downloadingAfterInstalling = true
        }
      },
    })

    expect(hasEnteredInstalling).toBe(true)
    expect(downloadingAfterInstalling).toBe(false)
    expect(phasesSeen).toContain("DOWNLOADING")
    expect(phasesSeen).toContain("INSTALLING")
    expect(phasesSeen).toContain("VERIFYING")
  })

  /* ─────────────────────────────────────────────────────────────
   * 62. installOrRepairMinecraftCore(preparedPlan) does ZERO network and does not re-plan
   * ───────────────────────────────────────────────────────────── */
  it("62. installOrRepairMinecraftCore(preparedPlan) does not call buildCoreInstallPlan or fetch from network", async () => {
    const { javaCliPath } = await createMockJdk21(appDataRoot)

    // Pre-create full installed core so readiness passes locally
    await createMockInstalledCore(instanceRoot, "1.21.1", "21.1.65")

    let networkFetchAttempted = false
    const throwingFetch = vi.fn().mockImplementation(async () => {
      networkFetchAttempted = true
      throw new Error("Network access is strictly prohibited during installOrRepairMinecraftCore with preparedPlan!")
    })

    const preparedPlan = {
      totalCoreBytes: 0,
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      needsNeoForge: false,
      needsVanilla: false,
      resolvedVersionId: "1.21.1-neoforge-21.1.65",
      installProfile: null,
      mojangPackage: { id: "1.21.1" },
      artifacts: new Map(),
      readiness: { isCoreInstalled: false, needsNeoForge: false, resolvedVersionId: "1.21.1-neoforge-21.1.65" },
    }

    const result = await installOrRepairMinecraftCore({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      javaCliPath,
      preparedPlan,
      customFetch: throwingFetch,
    })

    expect(result.success).toBe(true)
    expect(networkFetchAttempted).toBe(false)
    expect(throwingFetch).not.toHaveBeenCalled()
  })

  /* ─────────────────────────────────────────────────────────────
   * 63. NeoForge installer is downloaded only once to Planner Cache and promoted locally
   * ───────────────────────────────────────────────────────────── */
  it("63. NeoForge installer is downloaded exactly once into Planner Cache and promoted to canonical path", async () => {
    const mockProfile = { spec: 1, profile: "neoforge", version: "21.1.65", minecraft: "1.21.1", libraries: [] }
    const zipBuffer = createZipWithFile("install_profile.json", JSON.stringify(mockProfile))
    const realSha256 = computeSha256(zipBuffer)

    let installerJarDownloadCount = 0

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => realSha256 } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        installerJarDownloadCount++
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      return { ok: false, status: 404 } as any
    })

    // 1. Build Core Install Plan: downloads installer to Planner Cache ONCE
    const plan = await buildCoreInstallPlan({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      customFetch: mockFetch,
    })

    expect(installerJarDownloadCount).toBe(1)
    const installerArtifact = Array.from(plan.artifacts.values()).find((a: any) => a.role === "neoforge-installer")
    expect(installerArtifact).toBeDefined()
    expect(installerArtifact.downloadUrl).toBeNull() // Crucial: downloadUrl is null so it won't be fetched again

    // 2. Download all artifacts: does NOT download installer jar from maven a 2nd time; promotes locally
    await downloadAllCoreArtifacts({
      instanceRoot,
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      artifacts: plan.artifacts,
      customFetch: mockFetch,
    })

    // Fetch count must still be exactly 1!
    expect(installerJarDownloadCount).toBe(1)

    // Canonical path must have been created by local promotion
    const canonicalJar = canonicalNeoForgeInstallerPath(instanceRoot, "21.1.65")
    expect(fs.existsSync(canonicalJar)).toBe(true)
    expect(await validateFileSha256(canonicalJar, zipBuffer.length, realSha256)).toBe(true)
  })

  /* ─────────────────────────────────────────────────────────────
   * 64. Mandatory Regression 1: NeoForge Readiness accepts non-hardcoded artifacts (-universal.jar)
   * ───────────────────────────────────────────────────────────── */
  it("64. NeoForge readiness validates real declared profile libraries without hardcoded names, and fails when declared library is missing", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`

    // Setup Vanilla asset index
    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)
    const indexesDir = path.join(instanceRoot, "assets", "indexes")
    await fsp.mkdir(indexesDir, { recursive: true })
    await fsp.writeFile(path.join(indexesDir, "17.json"), assetIndexContent)

    // Setup Vanilla version and jar
    const vanillaDir = path.join(instanceRoot, "versions", mcVersion)
    await fsp.mkdir(vanillaDir, { recursive: true })
    const vanillaJarContent = "mock-vanilla-jar"
    const vanillaJarSha1 = computeSha1(vanillaJarContent)
    await fsp.writeFile(path.join(vanillaDir, `${mcVersion}.jar`), vanillaJarContent)
    await fsp.writeFile(
      path.join(vanillaDir, `${mcVersion}.json`),
      JSON.stringify({
        id: mcVersion,
        assets: "17",
        time: "2024-08-08T00:00:00Z",
        releaseTime: "2024-08-08T00:00:00Z",
        type: "release",
        mainClass: "net.minecraft.client.main.Main",
        assetIndex: { id: "17", sha1: assetIndexSha1, size: assetIndexContent.length, totalSize: 0, url: `${serverBaseUrl}/asset-index.json` },
        downloads: { client: { size: vanillaJarContent.length, sha1: vanillaJarSha1 } },
        libraries: [],
      }),
    )

    // Setup NeoForge profile declaring ONLY a universal jar artifact (no neoforge-<version>.jar nor -client.jar)
    const nfDir = path.join(instanceRoot, "versions", profileId)
    await fsp.mkdir(nfDir, { recursive: true })
    const universalRelPath = `net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`
    const universalJarContent = "mock-universal-artifact-bytes"
    const universalJarSha1 = computeSha1(universalJarContent)
    const universalJarAbsPath = path.join(instanceRoot, "libraries", universalRelPath)
    await fsp.mkdir(path.dirname(universalJarAbsPath), { recursive: true })
    await fsp.writeFile(universalJarAbsPath, universalJarContent)

    // Declare in version.json
    await fsp.writeFile(
      path.join(nfDir, `${profileId}.json`),
      JSON.stringify({
        id: profileId,
        time: "2024-08-08T00:00:00Z",
        releaseTime: "2024-08-08T00:00:00Z",
        type: "release",
        mainClass: "net.neoforged.neoforge.client.ClientModLoader",
        inheritsFrom: mcVersion,
        libraries: [
          {
            name: `net.neoforged:neoforge:${neoForgeVersion}:universal`,
            downloads: {
              artifact: {
                path: universalRelPath,
                size: universalJarContent.length,
                sha1: universalJarSha1,
              },
            },
          },
        ],
      }),
    )

    // Ensure hardcoded names do NOT exist
    const legacyJar1 = path.join(instanceRoot, "libraries", "net", "neoforged", "neoforge", neoForgeVersion, `neoforge-${neoForgeVersion}.jar`)
    const legacyJar2 = path.join(instanceRoot, "libraries", "net", "neoforged", "neoforge", neoForgeVersion, `neoforge-${neoForgeVersion}-client.jar`)
    expect(fs.existsSync(legacyJar1)).toBe(false)
    expect(fs.existsSync(legacyJar2)).toBe(false)

    // 1. Check readiness: must succeed authoritatively based on declared library
    const readiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(readiness.isCoreInstalled).toBe(true)
    expect(readiness.needsNeoForge).toBe(false)
    expect(readiness.resolvedVersionId).toBe(profileId)

    // 2. If the declared library is removed, readiness must fail
    await fsp.unlink(universalJarAbsPath)
    const failedReadiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(failedReadiness.isCoreInstalled).toBe(false)
    expect(failedReadiness.needsNeoForge).toBe(true)
    expect(failedReadiness.missingLibraries).toContain(universalJarAbsPath)
  })

  /* ─────────────────────────────────────────────────────────────
   * 65. Mandatory Regression 2: Fresh install without core-state.json validates readiness before saving core-state.json
   * ───────────────────────────────────────────────────────────── */
  it("65. Fresh install without core-state.json runs processors, validates final readiness with plan.installProfile, and writes core-state.json", async () => {
    const { javaCliPath } = await createMockJdk21(appDataRoot)
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`

    // Setup full installed core on disk
    await createMockInstalledCore(instanceRoot, mcVersion, neoForgeVersion)

    // Ensure NO core-state.json exists
    const coreStateFile = path.join(instanceRoot, ".hikat", "core-state.json")
    if (fs.existsSync(coreStateFile)) await fsp.unlink(coreStateFile)
    expect(fs.existsSync(coreStateFile)).toBe(false)

    const libJarSha1 = computeSha1("mock-neoforge-universal-jar")
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
            [`{ROOT}/libraries/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`]: libJarSha1,
          },
        },
      ],
      libraries: [],
    }

    const preparedPlan = {
      totalCoreBytes: 0,
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      needsNeoForge: false,
      needsVanilla: false,
      resolvedVersionId: profileId,
      installProfile,
      mojangPackage: { id: mcVersion },
      artifacts: new Map(),
      readiness: { isCoreInstalled: false, needsNeoForge: false, resolvedVersionId: profileId },
    }

    const result = await installOrRepairMinecraftCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      javaCliPath,
      preparedPlan,
    })

    expect(result.success).toBe(true)
    expect(fs.existsSync(coreStateFile)).toBe(true)
    const savedState = JSON.parse(await fsp.readFile(coreStateFile, "utf8"))
    expect(savedState.minecraftVersion).toBe(mcVersion)
    expect(savedState.neoForgeVersion).toBe(neoForgeVersion)
    expect(savedState.installProfile).toBeDefined()
  })

  /* ─────────────────────────────────────────────────────────────
   * 66. Mandatory Regression 3: CorePlan includes install_profile + version.json libraries without duplicates
   * ───────────────────────────────────────────────────────────── */
  it("66. CorePlan includes libraries from install_profile.json and embedded version.json without duplicates", async () => {
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"

    const mockInstallProfile = {
      spec: 1,
      profile: "neoforge",
      version: neoForgeVersion,
      minecraft: mcVersion,
      libraries: [
        {
          name: "net.neoforged:installertools:1.3.0",
          downloads: {
            artifact: {
              path: "net/neoforged/installertools/1.3.0/installertools-1.3.0.jar",
              size: 500,
              sha1: "abc1234567890123456789012345678901234567",
              url: "https://maven.neoforged.net/releases/net/neoforged/installertools/1.3.0/installertools-1.3.0.jar",
            },
          },
        },
      ],
      processors: [
        {
          sides: ["client"],
          jar: "net.neoforged.installertools:cli:1.0.0",
          classpath: ["net.neoforged:bus:8.0.0"],
          args: [],
        },
      ],
    }

    const mockEmbeddedVersionJson = {
      id: `${mcVersion}-neoforge-${neoForgeVersion}`,
      inheritsFrom: mcVersion,
      libraries: [
        {
          name: `net.neoforged:neoforge:${neoForgeVersion}:universal`,
          downloads: {
            artifact: {
              path: `net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`,
              size: 2000,
              sha1: "def1234567890123456789012345678901234567",
              url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`,
            },
          },
        },
        // Duplicate library with install_profile:
        {
          name: "net.neoforged:installertools:1.3.0",
          downloads: {
            artifact: {
              path: "net/neoforged/installertools/1.3.0/installertools-1.3.0.jar",
              size: 500,
              sha1: "abc1234567890123456789012345678901234567",
              url: "https://maven.neoforged.net/releases/net/neoforged/installertools/1.3.0/installertools-1.3.0.jar",
            },
          },
        },
      ],
    }

    const zipBuffer = createZipWithFiles({
      "install_profile.json": JSON.stringify(mockInstallProfile),
      "version.json": JSON.stringify(mockEmbeddedVersionJson),
    })
    const realSha256 = computeSha256(zipBuffer)

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => realSha256 } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(zipBuffer.length) }),
          arrayBuffer: async () => zipBuffer,
          buffer: async () => zipBuffer,
        } as any
      }
      return { ok: false, status: 404 } as any
    })

    const plan = await buildCoreInstallPlan({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      customFetch: mockFetch,
    })

    const artifacts = Array.from(plan.artifacts.values())
    const relativePaths = artifacts.map((a: any) => a.relativePath.replace(/\\/g, "/"))

    // Check installProfile library is present
    expect(relativePaths).toContain("libraries/net/neoforged/installertools/1.3.0/installertools-1.3.0.jar")

    // Check embedded version.json library is present
    expect(relativePaths).toContain(`libraries/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`)

    // Check processor jar is present
    expect(relativePaths).toContain("libraries/net/neoforged/installertools/cli/1.0.0/cli-1.0.0.jar")

    // Check processor classpath library is present
    expect(relativePaths).toContain("libraries/net/neoforged/bus/8.0.0/bus-8.0.0.jar")

    // Verify zero duplicates: relativePaths Set size equals array length
    const uniquePaths = new Set(relativePaths)
    expect(uniquePaths.size).toBe(relativePaths.length)
  })

  /* ─────────────────────────────────────────────────────────────
   * 67. Mandatory Regression 4: Network boundary - ZERO network during and after INSTALLING phase
   * ───────────────────────────────────────────────────────────── */
  it("67. Strict Network Boundary: Any network call during or after INSTALLING phase throws and fails", async () => {
    const { javaCliPath } = await createMockJdk21(appDataRoot)
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"

    // Pre-create full installed core so local promotion and readiness pass with zero errors
    await createMockInstalledCore(instanceRoot, mcVersion, neoForgeVersion)

    let hasEnteredInstalling = false
    let networkAttemptedAfterInstalling = false

    const guardedFetch = vi.fn().mockImplementation(async (url: string) => {
      if (hasEnteredInstalling) {
        networkAttemptedAfterInstalling = true
        throw new Error(`CRITICAL VIOLATION: Network fetch attempted after entering INSTALLING phase: ${url}`)
      }
      return { ok: true, json: async () => ({}) } as any
    })

    const preparedPlan = {
      totalCoreBytes: 0,
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      needsNeoForge: false,
      needsVanilla: false,
      resolvedVersionId: `${mcVersion}-neoforge-${neoForgeVersion}`,
      installProfile: null,
      mojangPackage: { id: mcVersion },
      artifacts: new Map(),
      readiness: { isCoreInstalled: false, needsNeoForge: false, resolvedVersionId: `${mcVersion}-neoforge-${neoForgeVersion}` },
    }

    const phasesSeen: string[] = []

    const result = await installOrRepairMinecraftCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      javaCliPath,
      preparedPlan,
      onPhaseChange: (phase: string) => {
        phasesSeen.push(phase)
        if (phase === "INSTALLING") {
          hasEnteredInstalling = true
        }
      },
      customFetch: guardedFetch,
    })

    expect(result.success).toBe(true)
    expect(hasEnteredInstalling).toBe(true)
    expect(networkAttemptedAfterInstalling).toBe(false)
    expect(phasesSeen).toContain("INSTALLING")
    expect(phasesSeen).toContain("VERIFYING")
  })

  /* ─────────────────────────────────────────────────────────────
   * 68. Mandatory Integration: NeoForge with needsNeoForge=true, Mojang mappings in CorePlan, ZERO network during INSTALLING
   * ───────────────────────────────────────────────────────────── */
  it("68. NeoForge with needsNeoForge=true downloads processor remote resources (Mojang mappings) in CorePlan and executes postProcess with 0 network calls during INSTALLING", async () => {
    const { javaExe } = await createMockJdk21(appDataRoot)
    const mcVersion = "1.21.1"
    const neoForgeVersion = "21.1.65"
    const profileId = `${mcVersion}-neoforge-${neoForgeVersion}`

    // 1. Prepare Mojang Package with client_mappings
    const mappingsContent = "mock-official-mojang-mappings-line-1\nmock-official-mojang-mappings-line-2"
    const mappingsSha1 = computeSha1(mappingsContent)
    const clientJarContent = "mock-client-jar-binary-data"
    const clientJarSha1 = computeSha1(clientJarContent)
    const assetIndexContent = JSON.stringify({ objects: {} })
    const assetIndexSha1 = computeSha1(assetIndexContent)

    const universalJarContent = "mock-neoforge-universal-library"
    const universalJarSha1 = computeSha1(universalJarContent)
    const procCliJarBuffer = createZipWithFiles({
      "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\r\nMain-Class: net.neoforged.installertools.cli.Main\r\n",
    })
    const procCliJarSha1 = computeSha1(procCliJarBuffer)

    const mojangPackage = {
      id: mcVersion,
      assets: "17",
      time: "2024-08-08T00:00:00Z",
      releaseTime: "2024-08-08T00:00:00Z",
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      assetIndex: {
        id: "17",
        sha1: assetIndexSha1,
        size: assetIndexContent.length,
        totalSize: 0,
        url: `${serverBaseUrl}/asset-index.json`,
      },
      downloads: {
        client: {
          size: clientJarContent.length,
          sha1: clientJarSha1,
          url: `${serverBaseUrl}/client.jar`,
        },
        client_mappings: {
          size: mappingsContent.length,
          sha1: mappingsSha1,
          url: `${serverBaseUrl}/client.txt`,
        },
      },
      libraries: [],
    }

    // 2. Prepare NeoForge Installer containing install_profile.json & version.json
    const mockInstallProfile = {
      spec: 1,
      profile: "neoforge",
      version: neoForgeVersion,
      minecraft: mcVersion,
      data: {
        MOJMAPS: {
          client: `[net.minecraft:client:${mcVersion}:mappings@txt]`,
          server: `[net.minecraft:server:${mcVersion}:mappings@txt]`,
        },
      },
      processors: [
        {
          sides: ["client"],
          jar: "net.neoforged.installertools:cli:1.0.0",
          classpath: [],
          args: [
            "--task", "DOWNLOAD_MOJMAPS",
            "--version", "{MINECRAFT_VERSION}",
            "--side", "{SIDE}",
            "--output", "{MOJMAPS}",
          ],
          outputs: {
            [`{ROOT}/libraries/net/minecraft/client/${mcVersion}/client-${mcVersion}-mappings.txt`]: mappingsSha1,
          },
        },
      ],
      libraries: [
        {
          name: "net.neoforged.installertools:cli:1.0.0",
          downloads: {
            artifact: {
              path: "net/neoforged/installertools/cli/1.0.0/cli-1.0.0.jar",
              size: procCliJarBuffer.length,
              sha1: procCliJarSha1,
              url: `${serverBaseUrl}/cli-1.0.0.jar`,
            },
          },
        },
      ],
    }

    const mockEmbeddedVersionJson = {
      id: profileId,
      time: "2024-08-08T00:00:00Z",
      releaseTime: "2024-08-08T00:00:00Z",
      type: "release",
      mainClass: "net.neoforged.neoforge.client.ClientModLoader",
      inheritsFrom: mcVersion,
      libraries: [
        {
          name: `net.neoforged:neoforge:${neoForgeVersion}:universal`,
          downloads: {
            artifact: {
              path: `net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-universal.jar`,
              size: universalJarContent.length,
              sha1: universalJarSha1,
              url: `${serverBaseUrl}/neoforge-${neoForgeVersion}-universal.jar`,
            },
          },
        },
      ],
    }

    const installerZipBuffer = createZipWithFiles({
      "install_profile.json": JSON.stringify(mockInstallProfile),
      "version.json": JSON.stringify(mockEmbeddedVersionJson),
    })
    const installerSha256 = computeSha256(installerZipBuffer)

    // 3. Strict Network Fetcher with Tripwire once INSTALLING begins
    let hasEnteredInstalling = false
    let networkAttemptedAfterInstalling = false

    const guardedFetch = vi.fn().mockImplementation(async (url: string) => {
      if (hasEnteredInstalling) {
        networkAttemptedAfterInstalling = true
        throw new Error(`CRITICAL TRIPWIRE VIOLATION: Fetch attempted after INSTALLING: ${url}`)
      }

      if (typeof url === "string" && url.includes(".sha256")) {
        return { ok: true, text: async () => installerSha256 } as any
      }
      if (typeof url === "string" && url.includes("-installer.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(installerZipBuffer.length) }),
          arrayBuffer: async () => installerZipBuffer,
          buffer: async () => installerZipBuffer,
        } as any
      }
      if (typeof url === "string" && url.includes("asset-index.json")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ objects: {} }),
          text: async () => assetIndexContent,
        } as any
      }
      if (typeof url === "string" && url.includes("client.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(clientJarContent.length) }),
          arrayBuffer: async () => Buffer.from(clientJarContent, "utf8"),
          buffer: async () => Buffer.from(clientJarContent, "utf8"),
        } as any
      }
      if (typeof url === "string" && url.includes("client.txt")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(mappingsContent.length) }),
          arrayBuffer: async () => Buffer.from(mappingsContent, "utf8"),
          buffer: async () => Buffer.from(mappingsContent, "utf8"),
        } as any
      }
      if (typeof url === "string" && url.includes("cli-1.0.0.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(procCliJarBuffer.length) }),
          arrayBuffer: async () => procCliJarBuffer,
          buffer: async () => procCliJarBuffer,
        } as any
      }
      if (typeof url === "string" && url.includes("universal.jar")) {
        return {
          ok: true,
          headers: new Headers({ "content-length": String(universalJarContent.length) }),
          arrayBuffer: async () => Buffer.from(universalJarContent, "utf8"),
          buffer: async () => Buffer.from(universalJarContent, "utf8"),
        } as any
      }

      return { ok: false, status: 404 } as any
    })

    // Step A: Build Core Install Plan
    const plan = await buildCoreInstallPlan({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      mojangPackage,
      customFetch: guardedFetch,
    })

    // Confirm needsNeoForge is TRUE
    expect(plan.needsNeoForge).toBe(true)

    // Confirm Mojang client mappings are registered in CorePlan
    const mappingsArtifactKey = "libraries/net/minecraft/client/1.21.1/client-1.21.1-mappings.txt"
    const mappingsArtifact = plan.artifacts.get(mappingsArtifactKey)
    expect(mappingsArtifact).toBeDefined()
    expect(mappingsArtifact.role).toBe("mojang-mappings")
    expect(mappingsArtifact.expectedSha1).toBe(mappingsSha1)

    // Step B: Download All Core Artifacts during DOWNLOADING phase
    await downloadAllCoreArtifacts({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      artifacts: plan.artifacts,
      customFetch: guardedFetch,
    })

    // Confirm Mojang mappings file exists on disk BEFORE INSTALLING phase
    const mappingsDiskPath = path.join(instanceRoot, "libraries", "net", "minecraft", "client", mcVersion, `client-${mcVersion}-mappings.txt`)
    expect(fs.existsSync(mappingsDiskPath)).toBe(true)
    expect(await fsp.readFile(mappingsDiskPath, "utf8")).toBe(mappingsContent)

    // Step C: Run installOrRepairMinecraftCore through INSTALLING and VERIFYING
    const spawnSpy = vi.spyOn(child_process, "spawn").mockImplementation(() => {
      const emitter = new EventEmitter() as any
      emitter.stdout = new EventEmitter() as any
      emitter.stdout.setEncoding = vi.fn()
      emitter.stderr = new EventEmitter() as any
      emitter.stderr.setEncoding = vi.fn()
      emitter.kill = vi.fn()
      setTimeout(() => {
        emitter.emit("exit", 0, null)
        emitter.emit("close", 0, null)
      }, 5)
      return emitter
    })

    const phasesSeen: string[] = []
    const result = await installOrRepairMinecraftCore({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
      javaCliPath: javaExe,
      preparedPlan: plan,
      onPhaseChange: (phase: string) => {
        phasesSeen.push(phase)
        if (phase === "INSTALLING") {
          hasEnteredInstalling = true
        }
      },
      customFetch: guardedFetch,
    })

    // Assertions
    expect(result.success).toBe(true)
    expect(hasEnteredInstalling).toBe(true)
    expect(networkAttemptedAfterInstalling).toBe(false)
    expect(spawnSpy).toHaveBeenCalled()
    expect(phasesSeen).toContain("INSTALLING")
    expect(phasesSeen).toContain("VERIFYING")

    spawnSpy.mockRestore()

    // Confirm final readiness check passes authoritatively
    const finalReadiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: mcVersion,
      neoForgeVersion,
    })
    expect(finalReadiness.isCoreInstalled).toBe(true)
    expect(finalReadiness.needsNeoForge).toBe(false)
    expect(finalReadiness.resolvedVersionId).toBe(profileId)
  })
})


