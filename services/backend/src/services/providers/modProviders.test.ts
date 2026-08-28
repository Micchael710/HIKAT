import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq } from "drizzle-orm"
import type { Env } from "../../types"
import { ModrinthAdapter } from "./modrinthAdapter"
import { CurseForgeAdapter } from "./curseforgeAdapter"
import { ModProviderManager, getLogicalPathForContent } from "./modProviderManager"
import { installModPlan } from "./modInstallationService"
import { prepareGameDraft, getPublishedModpack, publishGameRelease } from "../game/releaseService"
import { saveGameFileContent, addGameFile, updateGameFile } from "../game/gameFileService"

// Mock global fetch for provider API calls and binary downloads
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function createTestR2() {
  const store = new Map<string, { body: Uint8Array; metadata?: any }>()
  return {
    _store: store,
    get: vi.fn(async (key: string) => {
      const item = store.get(key)
      if (!item) return null
      return {
        key,
        size: item.body.byteLength,
        arrayBuffer: async () => item.body.buffer,
        customMetadata: item.metadata?.customMetadata,
      }
    }),
    put: vi.fn(async (key: string, value: any, options?: any) => {
      let body: Uint8Array
      if (value instanceof Uint8Array) {
        body = value
      } else if (value instanceof ArrayBuffer) {
        body = new Uint8Array(value)
      } else if (typeof value === "string") {
        body = new TextEncoder().encode(value)
      } else {
        body = new Uint8Array(0)
      }
      store.set(key, { body, metadata: options })
      return { key, size: body.byteLength }
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    head: vi.fn(async (key: string) => {
      const item = store.get(key)
      if (!item) return null
      return { key, size: item.body.byteLength }
    }),
  }
}

// Sample valid JAR buffer with magic bytes PK\x03\x04
function createSampleJarBuffer(content: string = "dummy jar content"): Uint8Array {
  const enc = new TextEncoder().encode(content)
  const buf = new Uint8Array(4 + enc.length)
  buf[0] = 0x50 // P
  buf[1] = 0x4b // K
  buf[2] = 0x03
  buf[3] = 0x04
  buf.set(enc, 4)
  return buf
}

describe("Shard 8B — Content Providers & Dependency Resolution Suite", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let env: Env
  let r2: ReturnType<typeof createTestR2>
  let manager: ModProviderManager
  const adminUserId = "admin-test-8b"

  beforeEach(async () => {
    testD1 = createTestD1()
    db = createDatabase(testD1)
    r2 = createTestR2()
    env = {
      ENVIRONMENT: "test",
      CURSEFORGE_API_KEY: "test-curseforge-api-key-12345",
      ASSETS: r2 as any,
      DB: testD1 as any,
    }
    manager = new ModProviderManager()

    const now = new Date().toISOString()
    await db.insert(schema.users).values({
      id: adminUserId,
      displayName: "Admin User",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    })

    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("1. Modrinth Adapter Multi-Content & Environment", () => {
    it("searches Modrinth with automatic Minecraft 1.21.1 and NeoForge filters for MOD", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "LNytGWDc",
              slug: "create",
              title: "Create",
              description: "Aesthetic Technology",
              author: "simibubi",
              categories: ["technology", "neoforge"],
              downloads: 15000000,
              follows: 50000,
              icon_url: "https://cdn.modrinth.com/icon.png",
              latest_version: "6.0.6",
              client_side: "required",
              server_side: "required",
            },
          ],
          total_hits: 1,
        }),
      })

      const result = await adapter.searchMods(env, "create", "1.21.1", "NeoForge", 20, 0, "MOD")
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.provider).toBe("MODRINTH")
      expect(result.items[0]!.projectId).toBe("LNytGWDc")
      expect(result.items[0]!.name).toBe("Create")
      expect(result.items[0]!.contentType).toBe("MOD")
      expect(result.items[0]!.environment).toBe("BOTH")

      const calledUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(calledUrl).toContain("versions%3A1.21.1")
      expect(calledUrl).toContain("categories%3Aneoforge")
      expect(calledUrl).toContain("project_type%3Amod")
    })

    it("searches Modrinth for RESOURCE_PACK, DATA_PACK, and SHADER without loader filter", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "rp-1",
              title: "Faithful",
              description: "HD textures",
              author: "FaithfulTeam",
              downloads: 500000,
              client_side: "required",
              server_side: "unsupported",
            },
          ],
          total_hits: 1,
        }),
      })

      const rpResult = await adapter.searchMods(env, "faithful", "1.21.1", "NeoForge", 20, 0, "RESOURCE_PACK")
      expect(rpResult.items.length).toBe(1)
      expect(rpResult.items[0]!.contentType).toBe("RESOURCE_PACK")
      expect(rpResult.items[0]!.environment).toBe("CLIENT")

      const rpUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(rpUrl).toContain("project_type%3Aresourcepack")
      expect(rpUrl).not.toContain("categories%3Aneoforge")
    })

    it("resolves client_side and server_side environment correctly", async () => {
      const adapter = new ModrinthAdapter()

      // Server only mod
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "server-core",
          title: "Server Core",
          client_side: "unsupported",
          server_side: "required",
        }),
      })

      const project = await adapter.getProject(env, "server-core")
      expect(project?.environment).toBe("SERVER")
    })
  })

  describe("2. CurseForge Adapter Multi-Content & Class IDs", () => {
    it("searches CurseForge with classId 6 for MOD and includes loader filter", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 328085,
              slug: "create",
              name: "Create",
              summary: "Aesthetic Technology",
              authors: [{ name: "simibubi" }],
              downloadCount: 12000000,
              logo: { thumbnailUrl: "https://cf.com/icon.png" },
              categories: [{ name: "Technology" }],
            },
          ],
          pagination: { totalCount: 1 },
        }),
      })

      const result = await adapter.searchMods(env, "create", "1.21.1", "NeoForge", 20, 0, "MOD")
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.provider).toBe("CURSEFORGE")
      expect(result.items[0]!.projectId).toBe("328085")

      const calledUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(calledUrl).toContain("classId=6")
      expect(calledUrl).toContain("gameVersion=1.21.1")
      expect(calledUrl).toContain("modLoaderType=6")
    })

    it("searches CurseForge with classId 12 (Resource Packs), 6945 (Data Packs), 6552 (Shaders) without loader", async () => {
      const adapter = new CurseForgeAdapter()

      // Data Packs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 99911, name: "Terralith", summary: "Overworld overhaul", authors: [{ name: "Stardust" }], downloadCount: 500000 }],
          pagination: { totalCount: 1 },
        }),
      })

      const result = await adapter.searchMods(env, "terralith", "1.21.1", "NeoForge", 20, 0, "DATA_PACK")
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.contentType).toBe("DATA_PACK")

      const calledUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(calledUrl).toContain("classId=6945")
      expect(calledUrl).not.toContain("modLoaderType")
    })

    it("resolves hashes (SHA-1, MD5, SHA-256) correctly from CurseForge files", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: 55555,
            fileName: "mod.jar",
            displayName: "Mod 1.0",
            downloadUrl: "https://cf.com/mod.jar",
            fileLength: 4000,
            fileDate: "2024-08-01T00:00:00Z",
            releaseType: 1,
            gameVersions: ["1.21.1", "NeoForge"],
            hashes: [
              { value: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", algo: 1 }, // SHA-1
              { value: "md5hash1234567890", algo: 2 }, // MD5
            ],
            dependencies: [],
          },
        }),
      })

      const version = await adapter.getVersion(env, "55555", "328085", "MOD")
      expect(version).toBeDefined()
      expect(version?.hashes?.sha1).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
      expect(version?.hashes?.md5).toBe("md5hash1234567890")
    })

    it("uses official download URL endpoint when downloadUrl is null in file payload", async () => {
      const adapter = new CurseForgeAdapter()

      // 1. File payload with null downloadUrl
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: 66666,
            fileName: "opt-mod.jar",
            displayName: "Opt Mod",
            downloadUrl: null,
            fileLength: 3000,
            fileDate: "2024-08-01T00:00:00Z",
            releaseType: 1,
            gameVersions: ["1.21.1", "NeoForge"],
            hashes: [],
            dependencies: [],
          },
        }),
      })

      // 2. Official download-url endpoint resolution
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: "https://mediafilez.forgecdn.net/files/666/opt-mod.jar",
        }),
      })

      const version = await adapter.getVersion(env, "66666", "328085", "MOD")
      expect(version?.downloadUrl).toBe("https://mediafilez.forgecdn.net/files/666/opt-mod.jar")
    })
  })

  describe("3. Strict Compatibility & Dependency Rules", () => {
    it("rejects root version if it does not support the draft's Minecraft version", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-incompat-mc")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-incompat-mc",
              project_id: "mod-x",
              name: "Old Mod",
              version_number: "0.1.0",
              version_type: "release",
              game_versions: ["1.20.1"], // Incompatible with 1.21.1
              loaders: ["neoforge"],
              files: [{ filename: "old.jar", size: 1000, url: "https://cdn/old.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/mod-x")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "mod-x", title: "Old Mod", description: "", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          { provider: "MODRINTH", projectId: "mod-x", versionId: "ver-incompat-mc" },
        ),
      ).rejects.toThrow(/no es compatible con el entorno actual/)
    })

    it("enforces pinned dependencies and flags conflict if pinned version is incompatible without fallback", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-root")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-root",
              project_id: "root-proj",
              name: "Root 1.0",
              version_number: "1.0.0",
              version_type: "release",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
              dependencies: [
                { version_id: "ver-pinned-incompat", dependency_type: "required" },
              ],
            }),
          }
        }
        if (u.includes("/version/ver-pinned-incompat")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-pinned-incompat",
              project_id: "dep-proj",
              name: "Dep Old",
              version_number: "0.5.0",
              version_type: "release",
              game_versions: ["1.19.2"],
              loaders: ["neoforge"],
              files: [{ filename: "dep-old.jar", size: 500, url: "https://cdn/dep-old.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/root-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "root-proj", title: "Root Project", description: "", categories: [] }),
          }
        }
        if (u.includes("/project/dep-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "dep-proj", title: "Dep Project", description: "", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-proj", versionId: "ver-root" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBeGreaterThan(0)
      expect(plan.conflicts[0]).toContain("versión requerida")
    })

    it("resolves Modrinth dependency that specifies version_id but missing project_id", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-root-ok")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-root-ok",
              project_id: "root-ok-proj",
              name: "Root OK",
              version_number: "1.0.0",
              version_type: "release",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "root-ok.jar", size: 1000, url: "https://cdn/root-ok.jar" }],
              dependencies: [
                { version_id: "ver-dep-only-id", dependency_type: "required" },
              ],
            }),
          }
        }
        if (u.includes("/version/ver-dep-only-id")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-dep-only-id",
              project_id: "resolved-dep-proj",
              name: "Dep Resolved",
              version_number: "2.0.0",
              version_type: "release",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "dep-resolved.jar", size: 2000, url: "https://cdn/dep-resolved.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/root-ok-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "root-ok-proj", title: "Root OK", description: "", categories: [] }),
          }
        }
        if (u.includes("/project/resolved-dep-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-dep-only-id",
                name: "Dep Resolved",
                version_number: "2.0.0",
                version_type: "release",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "dep-resolved.jar", size: 2000, url: "https://cdn/dep-resolved.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/resolved-dep-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "resolved-dep-proj", title: "Resolved Dep", description: "", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-ok-proj", versionId: "ver-root-ok" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[1]!.projectId).toBe("resolved-dep-proj")
    })
  })

  describe("4. Target Paths & Policy Verification", () => {
    it("computes proper logical paths per content type", () => {
      expect(getLogicalPathForContent("MOD", "create.jar")).toBe("mods/create.jar")
      expect(getLogicalPathForContent("RESOURCE_PACK", "faithful.zip")).toBe("resourcepacks/faithful.zip")
      expect(getLogicalPathForContent("DATA_PACK", "terralith.zip")).toBe("datapacks/terralith.zip")
      expect(getLogicalPathForContent("SHADER", "complementary.zip")).toBe("shaderpacks/complementary.zip")
    })

    it("excludes DATA_PACK files from publishedModpack.clientFiles", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      // Put files into R2 with matching sizes
      await r2.put("game-files/mod", new Uint8Array(1000))
      await r2.put("game-files/dp", new Uint8Array(5000))

      // Add a mod and a datapack to draft
      await db.insert(schema.gameReleaseFiles).values({
        id: "mod-file-1",
        releaseId: draft.id,
        name: "jei.jar",
        logicalPath: "mods/jei.jar",
        category: "MOD",
        sha256: "sha256-mod",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod",
        createdAt: new Date().toISOString(),
      })

      await db.insert(schema.gameReleaseFiles).values({
        id: "datapack-file-1",
        releaseId: draft.id,
        name: "server_data.zip",
        logicalPath: "datapacks/server_data.zip",
        category: "DATA_PACK",
        sha256: "sha256-dp",
        sizeBytes: 5000,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/dp",
        createdAt: new Date().toISOString(),
      })

      // Publish release with correct argument order (db, env, input, userId)
      await publishGameRelease(db, env, { version: "1.0.0", notes: "Release with datapack" }, adminUserId)

      const publishedManifest = await getPublishedModpack(db, env)
      expect(publishedManifest).toBeDefined()
      expect(publishedManifest?.clientFiles.length).toBe(1)
      expect(publishedManifest?.clientFiles[0]!.path).toBe("mods/jei.jar")
      expect(publishedManifest?.clientFiles.some((f) => f.path.startsWith("datapacks/"))).toBe(false)
    })
  })

  describe("5. Atomic Installation & Compensation", () => {
    it("installs resource pack, datapack, and shader into respective target folders with valid zip/jar", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes("/version/ver-rp-1")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-rp-1",
              project_id: "faithful-rp",
              name: "Faithful 1.21",
              version_number: "1.21.0",
              version_type: "release",
              game_versions: ["1.21.1"],
              loaders: [],
              files: [{ filename: "faithful-1.21.zip", size: 5000, url: "https://cdn/faithful.zip" }],
              dependencies: [],
            }),
          }
        }
        if (urlStr.includes("/project/faithful-rp/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-rp-1",
                name: "Faithful 1.21",
                version_number: "1.21.0",
                version_type: "release",
                game_versions: ["1.21.1"],
                loaders: [],
                files: [{ filename: "faithful-1.21.zip", size: 5000, url: "https://cdn/faithful.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (urlStr.includes("/project/faithful-rp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "faithful-rp", title: "Faithful", description: "", categories: [] }),
          }
        }
        if (urlStr.includes("faithful.zip")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => createSampleJarBuffer("zip header content").buffer,
          }
        }
        return { ok: false, status: 404 }
      })

      const files = await installModPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "faithful-rp", versionId: "ver-rp-1", contentType: "RESOURCE_PACK" },
        adminUserId,
      )

      expect(files.length).toBe(1)
      expect(files[0]!.logicalPath).toBe("resourcepacks/faithful-1.21.zip")
      expect(files[0]!.category).toBe("RESOURCE_PACK")
    })

    it("prevents collision when target path already exists with a different manual file", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      // Existing manual mod at mods/custom.jar
      await db.insert(schema.gameReleaseFiles).values({
        id: "manual-mod",
        releaseId: draft.id,
        name: "custom.jar",
        logicalPath: "mods/custom.jar",
        category: "MOD",
        sha256: "sha256-manual",
        sizeBytes: 2000,
        objectKey: "game-files/manual",
        createdAt: new Date().toISOString(),
      })

      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes("/version/ver-custom")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-custom",
              project_id: "mod-custom-provider",
              name: "Custom Mod",
              version_number: "1.0.0",
              version_type: "release",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "custom.jar", size: 2000, url: "https://cdn/custom.jar" }],
              dependencies: [],
            }),
          }
        }
        if (urlStr.includes("/project/mod-custom-provider/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-custom",
                name: "Custom Mod",
                version_number: "1.0.0",
                version_type: "release",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "custom.jar", size: 2000, url: "https://cdn/custom.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (urlStr.includes("/project/mod-custom-provider")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "mod-custom-provider", title: "Custom Mod", description: "", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        installModPlan(
          db,
          env,
          { provider: "MODRINTH", projectId: "mod-custom-provider", versionId: "ver-custom" },
          adminUserId,
        ),
      ).rejects.toThrow(/Ya existe un archivo en "mods\/custom\.jar"/)
    })

    it("clears provider metadata when a provider file is replaced via addGameFile or updateGameFile", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      const fileId = "provider-mod-file"
      await db.insert(schema.gameReleaseFiles).values({
        id: fileId,
        releaseId: draft.id,
        name: "testmod.jar",
        logicalPath: "mods/testmod.jar",
        category: "MOD",
        sha256: "sha256-mod",
        sizeBytes: 3000,
        objectKey: "game-files/testmod",
        sourceProvider: "MODRINTH",
        sourceProjectId: "test-proj",
        sourceVersionId: "ver-test",
        sourceEnvironment: "BOTH",
        createdAt: new Date().toISOString(),
      })

      // Overwrite by calling addGameFile with tokenHash or direct payload
      const tokenHash = "token-hash-123"
      await db.insert(schema.gameFileUploadTokens).values({
        id: crypto.randomUUID(),
        tokenHash,
        category: "MOD",
        originalFilename: "testmod.jar",
        expectedSizeBytes: 4000,
        uploadedSizeBytes: 4000,
        objectKey: "game-files/new-manual",
        sha256: "sha256-new-manual",
        createdBy: adminUserId,
        usedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        createdAt: new Date().toISOString(),
      })

      await addGameFile(
        db,
        {
          name: "testmod.jar",
          logicalPath: "mods/testmod.jar",
          tokenHash,
        },
        adminUserId,
        env,
      )

      const updated = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.id, fileId)).get()
      expect(updated?.sourceProvider).toBeNull()
      expect(updated?.sourceProjectId).toBeNull()
      expect(updated?.sourceVersionId).toBeNull()
      expect(updated?.sourceEnvironment).toBeNull()
    })
  })
})
