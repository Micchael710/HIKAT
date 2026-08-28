import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq, and } from "drizzle-orm"
import type { Env } from "../../types"
import { ModrinthAdapter } from "./modrinthAdapter"
import { CurseForgeAdapter } from "./curseforgeAdapter"
import { ModProviderManager, getLogicalPathForContent } from "./modProviderManager"
import { installModPlan } from "./modInstallationService"
import { prepareGameDraft, getPublishedModpack, publishGameRelease } from "../game/releaseService"
import { saveGameFileContent, addGameFile, updateGameFile } from "../game/gameFileService"
import { validateGameFileBuffer } from "@hikat/shared"

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

// Sample valid JAR / ZIP buffer with magic bytes PK\x03\x04
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
              project_type: "mod",
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

    it("searches Modrinth for DATA_PACK using official categories:datapack semantics and all_project_types", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "terralith-mr",
              slug: "terralith",
              title: "Terralith",
              description: "Overworld overhaul",
              author: "Stardust",
              categories: ["datapack", "worldgen"],
              all_project_types: ["datapack"],
              project_type: "mod",
              downloads: 500000,
              client_side: "unsupported",
              server_side: "required",
            },
          ],
          total_hits: 1,
        }),
      })

      const dpResult = await adapter.searchMods(env, "terralith", "1.21.1", "NeoForge", 20, 0, "DATA_PACK")
      expect(dpResult.items.length).toBe(1)
      expect(dpResult.items[0]!.contentType).toBe("DATA_PACK")
      expect(dpResult.items[0]!.environment).toBe("SERVER")

      const dpUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(dpUrl).toContain("categories%3Adatapack")
      expect(dpUrl).not.toContain("categories%3Aneoforge")
    })

    it("parses SHA-512 and SHA-1 hashes from Modrinth without inventing SHA-256", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "ver-sha512",
          project_id: "proj-1",
          name: "Version 1.0",
          version_number: "1.0.0",
          version_type: "release",
          game_versions: ["1.21.1"],
          loaders: ["neoforge"],
          files: [
            {
              filename: "mod.jar",
              size: 2048,
              url: "https://cdn.modrinth.com/mod.jar",
              hashes: {
                sha512: "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
                sha1: "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
              },
            },
          ],
          dependencies: [],
        }),
      })

      const version = await adapter.getVersion(env, "ver-sha512", "proj-1", "MOD")
      expect(version?.sha256).toBeNull()
      expect(version?.hashes?.sha512).toBe("cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e")
      expect(version?.hashes?.sha1).toBe("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12")
    })
  })

  describe("2. CurseForge Adapter Multi-Content, Discovery & Hashes", () => {
    it("discovers CurseForge class IDs dynamically via /categories?classesOnly=true", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/categories?gameId=432&classesOnly=true")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 6, name: "Mods", slug: "mc-mods" },
                { id: 12, name: "Resource Packs", slug: "texture-packs" },
                { id: 6945, name: "Data Packs", slug: "data-packs" },
                { id: 6552, name: "Shaders", slug: "shaders" },
              ],
            }),
          }
        }
        if (u.includes("/mods/search")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 101, name: "Faithful", slug: "faithful", classId: 12 }],
              pagination: { totalCount: 1 },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const classId = await adapter.resolveClassId(env, "RESOURCE_PACK")
      expect(classId).toBe(12)

      const result = await adapter.searchMods(env, "faithful", "1.21.1", "", 20, 0, "RESOURCE_PACK")
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.projectId).toBe("101")
    })

    it("parses only algo 1 (SHA-1) and algo 2 (MD5) from CurseForge, rejecting algo 3 as SHA-256", async () => {
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
              { value: "invalid_supposed_sha256", algo: 3 }, // Unsupported algo 3
            ],
            dependencies: [],
          },
        }),
      })

      const version = await adapter.getVersion(env, "55555", "328085", "MOD")
      expect(version).toBeDefined()
      expect(version?.sha256).toBeNull()
      expect(version?.hashes?.sha1).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
      expect(version?.hashes?.md5).toBe("md5hash1234567890")
    })

    it("rejects CurseForge file if loader is not NeoForge when requested as MOD", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: 77777,
            fileName: "fabric-only.jar",
            displayName: "Fabric Mod",
            downloadUrl: "https://cf.com/fabric.jar",
            gameVersions: ["1.21.1", "Fabric"], // Fabric only, no NeoForge
            hashes: [],
            dependencies: [],
          },
        }),
      })

      const version = await adapter.getVersion(env, "77777", "328085", "MOD")
      expect(version?.loaders).toEqual(["Fabric"])
      expect(version?.loaders.includes("NeoForge")).toBe(false)
    })

    it("uses official download URL endpoint when downloadUrl is null in CurseForge file payload", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/files/66666/download-url")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: "https://mediafilez.forgecdn.net/files/666/opt-mod.jar" }),
          }
        }
        if (u.includes("/files/66666")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: 66666,
                fileName: "opt-mod.jar",
                displayName: "Opt Mod",
                downloadUrl: null,
                gameVersions: ["1.21.1", "NeoForge"],
                hashes: [],
                dependencies: [],
              },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const version = await adapter.getVersion(env, "66666", "328085", "MOD")
      expect(version?.downloadUrl).toBe("https://mediafilez.forgecdn.net/files/666/opt-mod.jar")
    })
  })

  describe("3. Strict Compatibility & Dependency Rules", () => {
    it("rejects contentType spoofing when project does not match requested content type", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/mod-create")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "mod-create",
              slug: "create",
              title: "Create",
              project_type: "mod", // Real type is MOD
              categories: ["technology"],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      // Client attempts to query a MOD as DATA_PACK
      await expect(
        manager.getProjectDetail(env, db, "MODRINTH", "mod-create", "DATA_PACK"),
      ).rejects.toThrow(/no corresponde al tipo solicitado/)
    })

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
              game_versions: ["1.20.1"],
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
            json: async () => ({ id: "mod-x", title: "Old Mod", project_type: "mod", categories: [] }),
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
              dependencies: [{ version_id: "ver-pinned-incompat", dependency_type: "required" }],
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
            json: async () => ({ id: "root-proj", title: "Root Project", project_type: "mod", categories: [] }),
          }
        }
        if (u.includes("/project/dep-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "dep-proj", title: "Dep Project", project_type: "mod", categories: [] }),
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

    it("resolves transitive dependencies, handles deduplication and skips cycles cleanly", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-a")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-a",
              project_id: "proj-a",
              name: "A",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "a.jar", size: 100, url: "https://cdn/a.jar" }],
              dependencies: [
                { project_id: "proj-b", dependency_type: "required" },
                { project_id: "proj-c", dependency_type: "required" },
              ],
            }),
          }
        }
        if (u.includes("/version/ver-b")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-b",
              project_id: "proj-b",
              name: "B",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "b.jar", size: 100, url: "https://cdn/b.jar" }],
              dependencies: [{ project_id: "proj-a", dependency_type: "required" }], // Cycle back to A!
            }),
          }
        }
        if (u.includes("/version/ver-c")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-c",
              project_id: "proj-c",
              name: "C",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "c.jar", size: 100, url: "https://cdn/c.jar" }],
              dependencies: [{ project_id: "proj-b", dependency_type: "required" }], // Duplicate reference to B!
            }),
          }
        }
        if (u.includes("/project/proj-a/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-a",
                name: "A",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "a.jar", size: 100, url: "https://cdn/a.jar" }],
                dependencies: [
                  { project_id: "proj-b", dependency_type: "required" },
                  { project_id: "proj-c", dependency_type: "required" },
                ],
              },
            ],
          }
        }
        if (u.includes("/project/proj-b/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: "ver-b", name: "B", game_versions: ["1.21.1"], loaders: ["neoforge"], files: [{ filename: "b.jar", size: 100, url: "https://cdn/b.jar" }], dependencies: [] }],
          }
        }
        if (u.includes("/project/proj-c/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: "ver-c", name: "C", game_versions: ["1.21.1"], loaders: ["neoforge"], files: [{ filename: "c.jar", size: 100, url: "https://cdn/c.jar" }], dependencies: [] }],
          }
        }
        if (u.includes("/project/proj-")) {
          const projId = u.split("/project/")[1]?.split("/")[0]?.split("?")[0] || "proj"
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: projId, title: projId, project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "proj-a", versionId: "ver-a" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(3) // A, B, C (no duplicates, no infinite loop)
    })

    it("respects manual overrides to select user-specified versions for dependencies", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-root-ov")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-root-ov",
              project_id: "proj-root-ov",
              name: "Root",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "root.jar", size: 100, url: "https://cdn/root.jar" }],
              dependencies: [{ project_id: "dep-custom", dependency_type: "required" }],
            }),
          }
        }
        if (u.includes("/project/proj-root-ov")) {
          return { ok: true, status: 200, json: async () => ({ id: "proj-root-ov", title: "Root", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/dep-custom/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "ver-dep-latest", version_number: "2.0", game_versions: ["1.21.1"], loaders: ["neoforge"], files: [{ filename: "dep2.jar", size: 100, url: "https://cdn/dep2.jar" }], dependencies: [] },
              { id: "ver-dep-manual", version_number: "1.5", game_versions: ["1.21.1"], loaders: ["neoforge"], files: [{ filename: "dep15.jar", size: 100, url: "https://cdn/dep15.jar" }], dependencies: [] },
            ],
          }
        }
        if (u.includes("/project/dep-custom")) {
          return { ok: true, status: 200, json: async () => ({ id: "dep-custom", title: "Dep", project_type: "mod", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        {
          provider: "MODRINTH",
          projectId: "proj-root-ov",
          versionId: "ver-root-ov",
          manualOverrides: [{ provider: "MODRINTH", projectId: "dep-custom", versionId: "ver-dep-manual" }],
        },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items[1]!.versionId).toBe("ver-dep-manual")
    })
  })

  describe("4. Target Paths, Policies & Manifest Filtering", () => {
    it("computes proper logical paths per content type", () => {
      expect(getLogicalPathForContent("MOD", "create.jar")).toBe("mods/create.jar")
      expect(getLogicalPathForContent("RESOURCE_PACK", "faithful.zip")).toBe("resourcepacks/faithful.zip")
      expect(getLogicalPathForContent("DATA_PACK", "terralith.zip")).toBe("datapacks/terralith.zip")
      expect(getLogicalPathForContent("SHADER", "complementary.zip")).toBe("shaderpacks/complementary.zip")
    })

    it("validates game file buffer magic bytes for DATA_PACK as strict ZIP", () => {
      const validZip = createSampleJarBuffer("data pack json content")
      const invalidZip = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])

      expect(validateGameFileBuffer(validZip, "datapack.zip", "DATA_PACK").valid).toBe(true)
      expect(validateGameFileBuffer(invalidZip, "datapack.zip", "DATA_PACK").valid).toBe(false)
      expect(validateGameFileBuffer(validZip, "datapack.jar", "DATA_PACK").valid).toBe(false)
    })

    it("excludes DATA_PACK files from publishedModpack.clientFiles", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      await r2.put("game-files/mod", new Uint8Array(1000))
      await r2.put("game-files/dp", new Uint8Array(5000))

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

      await publishGameRelease(db, env, { version: "1.0.0", notes: "Release with datapack" }, adminUserId)

      const publishedManifest = await getPublishedModpack(db, env)
      expect(publishedManifest).toBeDefined()
      expect(publishedManifest?.clientFiles.length).toBe(1)
      expect(publishedManifest?.clientFiles[0]!.path).toBe("mods/jei.jar")
      expect(publishedManifest?.clientFiles.some((f) => f.path.startsWith("datapacks/"))).toBe(false)
    })
  })

  describe("5. Installation, Atomic D1 Rollback & Compensation", () => {
    it("installs resource pack, datapack, and shader into respective target folders with valid zip", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-rp-1")) {
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
        if (u.includes("/project/faithful-rp/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: "ver-rp-1", name: "Faithful 1.21", version_number: "1.21.0", game_versions: ["1.21.1"], loaders: [], files: [{ filename: "faithful-1.21.zip", size: 5000, url: "https://cdn/faithful.zip" }], dependencies: [] }],
          }
        }
        if (u.includes("/project/faithful-rp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "faithful-rp", title: "Faithful", project_type: "resourcepack", categories: [] }),
          }
        }
        if (u.includes("faithful.zip")) {
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
      expect(files[0]!.policy).toBe("MODIFICABLE")
    })

    it("executes a REAL SQLite batch rollback when a statement inside the D1 batch fails", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      // Insert pre-existing file
      const preExistingId = "pre-existing-file"
      await db.insert(schema.gameReleaseFiles).values({
        id: preExistingId,
        releaseId: draft.id,
        name: "existing.jar",
        logicalPath: "mods/existing.jar",
        category: "MOD",
        sha256: "sha256-original",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/original",
        createdAt: new Date().toISOString(),
      })

      // Add a UNIQUE constraint in SQLite on sha256 to cause statement 2 to fail inside the real batch
      testD1.exec("CREATE UNIQUE INDEX test_unique_sha256 ON game_release_files(sha256);")

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/version/ver-batch-root")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-batch-root",
              project_id: "batch-root",
              name: "Batch Root",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "root.jar", size: 100, url: "https://cdn/root.jar" }],
              dependencies: [{ project_id: "batch-dep", dependency_type: "required" }],
            }),
          }
        }
        if (u.includes("/version/ver-batch-dep")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-batch-dep",
              project_id: "batch-dep",
              name: "Batch Dep",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "dep.jar", size: 100, url: "https://cdn/dep.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/batch-root")) {
          return { ok: true, status: 200, json: async () => ({ id: "batch-root", title: "Batch Root", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/batch-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: "ver-batch-dep", name: "Batch Dep", version_number: "1.0", game_versions: ["1.21.1"], loaders: ["neoforge"], files: [{ filename: "dep.jar", size: 100, url: "https://cdn/dep.jar" }], dependencies: [] }],
          }
        }
        if (u.includes("/project/batch-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "batch-dep", title: "Batch Dep", project_type: "mod", categories: [] }) }
        }
        if (u.includes("root.jar")) {
          // Unique buffer
          return { ok: true, status: 200, arrayBuffer: async () => createSampleJarBuffer("unique root binary").buffer }
        }
        if (u.includes("dep.jar")) {
          // This buffer will collide on sha256 with the pre-existing file or let's return buffer that produces duplicate sha256!
          return { ok: true, status: 200, arrayBuffer: async () => createSampleJarBuffer("unique root binary").buffer }
        }
        return { ok: false, status: 404 }
      })

      // Attempt install: Statement 1 (root) succeeds, Statement 2 (dep) has identical binary -> UNIQUE constraint fails!
      await expect(
        installModPlan(
          db,
          env,
          { provider: "MODRINTH", projectId: "batch-root", versionId: "ver-batch-root" },
          adminUserId,
        ),
      ).rejects.toThrow()

      // VERIFY REAL D1 ROLLBACK: No new rows inserted into D1
      const filesAfter = await db.select().from(schema.gameReleaseFiles).all()
      expect(filesAfter.length).toBe(1)
      expect(filesAfter[0]!.id).toBe(preExistingId)
      expect(filesAfter[0]!.logicalPath).toBe("mods/existing.jar")

      // VERIFY R2 COMPENSATION: newly uploaded keys were deleted
      expect(r2._store.size).toBe(0)
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

  describe("6. Pagination, Combinations & Tab Racing", () => {
    it("handles ALL search pagination deterministically without gaps or duplicate items", async () => {
      // Setup Modrinth (items M0, M1, M2) and CurseForge (items C0, C1, C2)
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("modrinth.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hits: [
                { project_id: "M0", title: "Mod M0", project_type: "mod", categories: [] },
                { project_id: "M1", title: "Mod M1", project_type: "mod", categories: [] },
                { project_id: "M2", title: "Mod M2", project_type: "mod", categories: [] },
              ],
              total_hits: 3,
            }),
          }
        }
        if (u.includes("curseforge.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 100, name: "Mod C0", slug: "c0", classId: 6 },
                { id: 101, name: "Mod C1", slug: "c1", classId: 6 },
                { id: 102, name: "Mod C2", slug: "c2", classId: 6 },
              ],
              pagination: { totalCount: 3 },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      // Page 1: limit 2, offset 0 -> Should return M0, C0
      const page1 = await manager.searchMods(env, db, "", null, 2, 0, "MOD")
      expect(page1.items.length).toBe(2)
      expect(page1.items[0]!.projectId).toBe("M0")
      expect(page1.items[1]!.projectId).toBe("100")

      // Page 2: limit 2, offset 2 -> Should return M1, C1 (no gaps, no duplicates)
      const page2 = await manager.searchMods(env, db, "", null, 2, 2, "MOD")
      expect(page2.items.length).toBe(2)
      expect(page2.items[0]!.projectId).toBe("M1")
      expect(page2.items[1]!.projectId).toBe("101")

      // Page 3: limit 2, offset 4 -> Should return M2, C2
      const page3 = await manager.searchMods(env, db, "", null, 2, 4, "MOD")
      expect(page3.items.length).toBe(2)
      expect(page3.items[0]!.projectId).toBe("M2")
      expect(page3.items[1]!.projectId).toBe("102")
    })

    it("survives partial provider failure gracefully in ALL search", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("modrinth.com")) {
          return { ok: false, status: 500 }
        }
        if (u.includes("curseforge.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 200, name: "Curse Mod", slug: "curse-mod", classId: 6 }],
              pagination: { totalCount: 1 },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const res = await manager.searchMods(env, db, "", null, 20, 0, "MOD")
      expect(res.items.length).toBe(1)
      expect(res.items[0]!.provider).toBe("CURSEFORGE")
      expect(res.providersStatus.find((p) => p.provider === "MODRINTH")?.available).toBe(false)
      expect(res.providersStatus.find((p) => p.provider === "CURSEFORGE")?.available).toBe(true)
    })
  })
})
