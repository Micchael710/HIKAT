import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq } from "drizzle-orm"
import type { Env } from "../../types"
import { ModrinthAdapter } from "./modrinthAdapter"
import { CurseForgeAdapter } from "./curseforgeAdapter"
import { ModProviderManager } from "./modProviderManager"
import { installModPlan } from "./modInstallationService"
import { prepareGameDraft } from "../game/releaseService"
import { saveGameFileContent } from "../game/gameFileService"

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

describe("Shard 8B — Mod Providers & Dependency Resolution Suite", () => {
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

  describe("1. Modrinth Adapter", () => {
    it("searches Modrinth with automatic Minecraft 1.21.1 and NeoForge filters", async () => {
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
            },
          ],
          total_hits: 1,
        }),
      })

      const result = await adapter.searchMods(env, "create", "1.21.1", "NeoForge", 20, 0)
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.provider).toBe("MODRINTH")
      expect(result.items[0]!.projectId).toBe("LNytGWDc")
      expect(result.items[0]!.name).toBe("Create")

      // Verify request url contained facets for 1.21.1 and neoforge
      const calledUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(calledUrl).toContain("versions%3A1.21.1")
      expect(calledUrl).toContain("categories%3Aneoforge")
      expect(calledUrl).toContain("project_type%3Amod")
    })

    it("fetches compatible versions for Modrinth filtered by loaders and game versions", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-create-606",
            project_id: "LNytGWDc",
            name: "Create 6.0.6",
            version_number: "6.0.6",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            version_type: "release",
            date_published: "2024-08-20T10:00:00.000Z",
            downloads: 25000,
            files: [
              {
                hashes: { sha256: "sha256-create-606" },
                url: "https://cdn.modrinth.com/create-6.0.6.jar",
                filename: "create-1.21.1-6.0.6.jar",
                primary: true,
                size: 15000000,
              },
            ],
            dependencies: [
              {
                project_id: "P7dR8mSH",
                version_id: null,
                dependency_type: "required",
              },
            ],
          },
        ],
      })

      const versions = await adapter.getCompatibleVersions(env, "LNytGWDc", "1.21.1", "NeoForge")
      expect(versions.length).toBe(1)
      expect(versions[0]!.versionNumber).toBe("6.0.6")
      expect(versions[0]!.releaseType).toBe("RELEASE")
      expect(versions[0]!.dependencies.length).toBe(1)
      expect(versions[0]!.dependencies[0]!.projectId).toBe("P7dR8mSH")
      expect(versions[0]!.dependencies[0]!.dependencyType).toBe("REQUIRED")
    })
  })

  describe("2. CurseForge Adapter & Protected API Key", () => {
    it("sends x-api-key header exclusively from backend env and searches with NeoForge loader type 6", async () => {
      const adapter = new CurseForgeAdapter()
      expect(adapter.isConfigured(env)).toBe(true)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 238222,
              name: "Just Enough Items (JEI)",
              slug: "jei",
              summary: "View Items and Recipes",
              authors: [{ name: "mezz" }],
              logo: { url: "https://media.forgecdn.net/jei.png" },
              downloadCount: 300000000,
              categories: [{ name: "Utility" }],
              dateCreated: "2015-10-15T00:00:00.000Z",
            },
          ],
          pagination: { totalCount: 1 },
        }),
      })

      const result = await adapter.searchMods(env, "jei", "1.21.1", "NeoForge", 20, 0)
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.provider).toBe("CURSEFORGE")
      expect(result.items[0]!.projectId).toBe("238222")
      expect(result.items[0]!.name).toBe("Just Enough Items (JEI)")

      const [calledUrl, options] = (mockFetch.mock.calls[0] as any) || []
      expect(calledUrl).toContain("gameId=432")
      expect(calledUrl).toContain("classId=6")
      expect(calledUrl).toContain("modLoaderType=6")
      expect(calledUrl).toContain("gameVersion=1.21.1")
      expect(options.headers["x-api-key"]).toBe("test-curseforge-api-key-12345")
    })

    it("returns available: false gracefully when CURSEFORGE_API_KEY is not configured without crashing", async () => {
      const unconfiguredEnv: Env = { ENVIRONMENT: "test" }
      const adapter = new CurseForgeAdapter()
      expect(adapter.isConfigured(unconfiguredEnv)).toBe(false)

      const result = await adapter.searchMods(unconfiguredEnv, "jei", "1.21.1", "NeoForge", 20, 0)
      expect(result.items).toEqual([])
      expect(result.totalCount).toBe(0)
    })
  })

  describe("3. Parallel Multi-Provider Search & Partial Degradation", () => {
    it("searches ALL providers in parallel and interleaves results", async () => {
      // Modrinth fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "modrinth-1",
              title: "Create (Modrinth)",
              description: "Create mod",
              author: "simibubi",
              categories: ["neoforge"],
              downloads: 100,
            },
          ],
          total_hits: 1,
        }),
      })
      // CurseForge fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 238222,
              name: "JEI (CurseForge)",
              summary: "JEI mod",
              authors: [{ name: "mezz" }],
              downloadCount: 200,
            },
          ],
          pagination: { totalCount: 1 },
        }),
      })

      const payload = await manager.searchMods(env, "mod", null, 20, 0)
      expect(payload.items.length).toBe(2)
      expect(payload.items[0]!.provider).toBe("MODRINTH")
      expect(payload.items[1]!.provider).toBe("CURSEFORGE")
      expect(payload.providersStatus.every((s) => s.available)).toBe(true)
    })

    it("handles partial failure: if CurseForge fails or is not configured, Modrinth results still return with partial status", async () => {
      // Modrinth succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "modrinth-only",
              title: "JourneyMap",
              description: "Mapping mod",
              author: "techbrew",
              categories: ["neoforge"],
              downloads: 50000,
            },
          ],
          total_hits: 1,
        }),
      })
      // CurseForge throws 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const payload = await manager.searchMods(env, "map", null, 20, 0)
      expect(payload.items.length).toBe(1)
      expect(payload.items[0]!.name).toBe("JourneyMap")

      const modrinthStatus = payload.providersStatus.find((s) => s.provider === "MODRINTH")
      const curseStatus = payload.providersStatus.find((s) => s.provider === "CURSEFORGE")
      expect(modrinthStatus?.available).toBe(true)
      expect(curseStatus?.available).toBe(false)
      expect(curseStatus?.error).toBeDefined()
    })
  })

  describe("4. Dependency Resolver Engine", () => {
    it("resolves mod with 0 dependencies cleanly", async () => {
      // getCompatibleVersions for root mod
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-appleskin-1",
            name: "AppleSkin 3.0.0",
            version_number: "3.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-01T00:00:00Z",
            files: [{ filename: "appleskin-1.21.1-3.0.0.jar", size: 50000, url: "https://cdn.modrinth.com/appleskin.jar" }],
            dependencies: [],
          },
        ],
      })
      // getProject for root mod
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "appleskin-id", title: "AppleSkin", description: "Food HUD info", categories: [] }),
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "appleskin-id", versionId: "ver-appleskin-1" },
        "1.21.1",
        "NeoForge",
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(1)
      expect(plan.items[0]!.isRoot).toBe(true)
      expect(plan.items[0]!.action).toBe("INSTALL")
      expect(plan.conflicts.length).toBe(0)
    })

    it("resolves transitive dependencies (A -> B -> C) and deduplicates repeated dependencies (A -> B, C and B -> C)", async () => {
      // 1. Root mod A (Create)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-a",
            name: "Create 6.0.6",
            version_number: "6.0.6",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-20T00:00:00Z",
            files: [{ filename: "create-6.0.6.jar", size: 100000, url: "https://cdn/create.jar" }],
            dependencies: [
              { project_id: "proj-b", dependency_type: "required" },
              { project_id: "proj-c", dependency_type: "required" },
            ],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "proj-a", title: "Create", description: "Create", categories: [] }),
      })

      // 2. Dependency B (Flywheel) -> depends on C (Registrate)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-b",
            name: "Flywheel 1.0.0",
            version_number: "1.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-15T00:00:00Z",
            files: [{ filename: "flywheel-1.0.0.jar", size: 50000, url: "https://cdn/flywheel.jar" }],
            dependencies: [{ project_id: "proj-c", dependency_type: "required" }],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "proj-b", title: "Flywheel", description: "Flywheel", categories: [] }),
      })

      // 3. Dependency C (Registrate)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-c",
            name: "Registrate 1.3.0",
            version_number: "1.3.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-10T00:00:00Z",
            files: [{ filename: "registrate-1.3.0.jar", size: 40000, url: "https://cdn/registrate.jar" }],
            dependencies: [],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "proj-c", title: "Registrate", description: "Registrate", categories: [] }),
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "proj-a", versionId: "ver-a" },
        "1.21.1",
        "NeoForge",
      )

      expect(plan.isValid).toBe(true)
      // Exactly 3 items: A, B, C (C was deduplicated across branches)
      expect(plan.items.length).toBe(3)
      const projectIds = plan.items.map((i) => i.projectId)
      expect(projectIds).toEqual(["proj-a", "proj-b", "proj-c"])
    })

    it("prevents infinite loops when dependency graph contains cycles (A -> B -> A)", async () => {
      // Mod A depends on B
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-cycle-a",
            name: "Mod A",
            version_number: "1.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-01T00:00:00Z",
            files: [{ filename: "mod-a.jar", size: 1000, url: "https://cdn/a.jar" }],
            dependencies: [{ project_id: "proj-cycle-b", dependency_type: "required" }],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "proj-cycle-a", title: "Mod A", description: "", categories: [] }),
      })

      // Mod B depends on A
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-cycle-b",
            name: "Mod B",
            version_number: "1.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-01T00:00:00Z",
            files: [{ filename: "mod-b.jar", size: 1000, url: "https://cdn/b.jar" }],
            dependencies: [{ project_id: "proj-cycle-a", dependency_type: "required" }],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "proj-cycle-b", title: "Mod B", description: "", categories: [] }),
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "proj-cycle-a", versionId: "ver-cycle-a" },
        "1.21.1",
        "NeoForge",
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items.map((i) => i.projectId)).toEqual(["proj-cycle-a", "proj-cycle-b"])
    })

    it("flags INCOMPATIBLE dependencies as conflicts and does not add OPTIONAL dependencies to auto install", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-incompat-test",
            name: "Mod With Incompat",
            version_number: "1.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-01T00:00:00Z",
            files: [{ filename: "test.jar", size: 1000, url: "https://cdn/test.jar" }],
            dependencies: [
              { project_id: "opt-proj", dependency_type: "optional" },
              { project_id: "bad-proj", dependency_type: "incompatible", project_name: "Incompatible Mod" },
            ],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "root-incompat", title: "Root Mod", description: "", categories: [] }),
      })
      // optional project metadata fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "opt-proj", title: "Optional Mod", description: "", categories: [] }),
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-incompat", versionId: "ver-incompat-test" },
        "1.21.1",
        "NeoForge",
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBeGreaterThan(0)
      expect(plan.conflicts[0]).toContain("Incompatible Mod")
      expect(plan.optionalDependencies.length).toBe(1)
      expect(plan.optionalDependencies[0]!.projectId).toBe("opt-proj")
    })

    it("respects manual overrides when selecting dependency versions", async () => {
      // Root mod
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-root",
            name: "Root Mod",
            version_number: "1.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-01T00:00:00Z",
            files: [{ filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
            dependencies: [{ project_id: "dep-proj", dependency_type: "required" }],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "root-mod", title: "Root Mod", description: "", categories: [] }),
      })

      // Dep has two versions: latest release 2.0.0 and older manual choice 1.5.0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-dep-200",
            name: "Dep 2.0.0",
            version_number: "2.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-20T00:00:00Z",
            files: [{ filename: "dep-2.0.0.jar", size: 2000, url: "https://cdn/dep-200.jar" }],
            dependencies: [],
          },
          {
            id: "ver-dep-150",
            name: "Dep 1.5.0",
            version_number: "1.5.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-07-01T00:00:00Z",
            files: [{ filename: "dep-1.5.0.jar", size: 1500, url: "https://cdn/dep-150.jar" }],
            dependencies: [],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "dep-proj", title: "Dep Mod", description: "", categories: [] }),
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        {
          provider: "MODRINTH",
          projectId: "root-mod",
          versionId: "ver-root",
          manualOverrides: [{ provider: "MODRINTH", projectId: "dep-proj", versionId: "ver-dep-150" }],
        },
        "1.21.1",
        "NeoForge",
      )

      expect(plan.isValid).toBe(true)
      const depItem = plan.items.find((i) => i.projectId === "dep-proj")
      expect(depItem?.versionId).toBe("ver-dep-150")
      expect(depItem?.versionNumber).toBe("1.5.0")
    })

    it("correctly flags ALREADY_INSTALLED vs UPDATE when comparing against active draft files", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      // Insert existing mod in draft: JEI version 1.0.0
      await db.insert(schema.gameReleaseFiles).values({
        id: "existing-jei-file",
        releaseId: draft.id,
        name: "jei-1.0.0.jar",
        logicalPath: "mods/jei-1.0.0.jar",
        category: "MOD",
        sha256: "sha256-old-jei",
        sizeBytes: 1000,
        objectKey: "game-files/old-jei",
        sourceProvider: "MODRINTH",
        sourceProjectId: "jei-proj-id",
        sourceVersionId: "ver-jei-100",
        createdAt: new Date().toISOString(),
      })

      // Query plan for JEI version 2.0.0 (should be UPDATE)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-jei-200",
            name: "JEI 2.0.0",
            version_number: "2.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-08-20T00:00:00Z",
            files: [{ filename: "jei-2.0.0.jar", size: 2000, url: "https://cdn/jei-200.jar" }],
            dependencies: [],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "jei-proj-id", title: "JEI", description: "", categories: [] }),
      })

      const planUpdate = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "jei-proj-id", versionId: "ver-jei-200" },
        "1.21.1",
        "NeoForge",
      )

      expect(planUpdate.items[0]!.action).toBe("UPDATE")
      expect(planUpdate.items[0]!.isInstalled).toBe(true)
      expect(planUpdate.items[0]!.installedFileId).toBe("existing-jei-file")

      // Query plan for JEI version 1.0.0 (should be ALREADY_INSTALLED)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "ver-jei-100",
            name: "JEI 1.0.0",
            version_number: "1.0.0",
            version_type: "release",
            game_versions: ["1.21.1"],
            loaders: ["neoforge"],
            date_published: "2024-07-01T00:00:00Z",
            files: [{ filename: "jei-1.0.0.jar", size: 1000, url: "https://cdn/jei-100.jar" }],
            dependencies: [],
          },
        ],
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "jei-proj-id", title: "JEI", description: "", categories: [] }),
      })

      const planSame = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "jei-proj-id", versionId: "ver-jei-100" },
        "1.21.1",
        "NeoForge",
      )

      expect(planSame.items[0]!.action).toBe("ALREADY_INSTALLED")
    })
  })

  describe("5. Mod Installation & Atomic Compensation", () => {
    it("downloads and installs mod and required dependency atomically into draft with source metadata", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes("/version?")) {
          if (urlStr.includes("proj-create")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-create-root",
                  name: "Create 6.0.6",
                  version_number: "6.0.6",
                  version_type: "release",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  date_published: "2024-08-20T00:00:00Z",
                  files: [{ filename: "create-1.21.1-6.0.6.jar", size: 5000, url: "https://cdn/create.jar" }],
                  dependencies: [{ project_id: "dep-flywheel", dependency_type: "required" }],
                },
              ],
            }
          }
          if (urlStr.includes("dep-flywheel")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-flywheel",
                  name: "Flywheel 1.0.0",
                  version_number: "1.0.0",
                  version_type: "release",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  date_published: "2024-08-15T00:00:00Z",
                  files: [{ filename: "flywheel-1.0.0.jar", size: 3000, url: "https://cdn/flywheel.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
        }
        if (urlStr.includes("/version/ver-create-root")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-create-root",
              name: "Create 6.0.6",
              version_number: "6.0.6",
              version_type: "release",
              files: [{ filename: "create-1.21.1-6.0.6.jar", size: 5000, url: "https://cdn/create.jar" }],
            }),
          }
        }
        if (urlStr.includes("/version/ver-flywheel")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-flywheel",
              name: "Flywheel 1.0.0",
              version_number: "1.0.0",
              version_type: "release",
              files: [{ filename: "flywheel-1.0.0.jar", size: 3000, url: "https://cdn/flywheel.jar" }],
            }),
          }
        }
        if (urlStr.includes("/project/proj-create")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "proj-create", title: "Create", description: "", categories: [] }),
          }
        }
        if (urlStr.includes("/project/dep-flywheel")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "dep-flywheel", title: "Flywheel", description: "", categories: [] }),
          }
        }
        if (urlStr.includes("create.jar")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => createSampleJarBuffer("create jar binary content").buffer,
          }
        }
        if (urlStr.includes("flywheel.jar")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => createSampleJarBuffer("flywheel jar binary content").buffer,
          }
        }
        return { ok: false, status: 404 }
      })

      const result = await installModPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "proj-create", versionId: "ver-create-root" },
        adminUserId,
      )

      expect(result.length).toBe(2)
      const createRecord = result.find((f) => f.logicalPath === "mods/create-1.21.1-6.0.6.jar")
      const flywheelRecord = result.find((f) => f.logicalPath === "mods/flywheel-1.0.0.jar")

      expect(createRecord).toBeDefined()
      expect(createRecord?.sourceProvider).toBe("MODRINTH")
      expect(createRecord?.sourceProjectId).toBe("proj-create")
      expect(createRecord?.sourceVersionId).toBe("ver-create-root")
      expect(createRecord?.category).toBe("MOD")

      expect(flywheelRecord).toBeDefined()
      expect(flywheelRecord?.sourceProvider).toBe("MODRINTH")
      expect(flywheelRecord?.sourceProjectId).toBe("dep-flywheel")
      expect(flywheelRecord?.sourceVersionId).toBe("ver-flywheel")
      expect(flywheelRecord?.category).toBe("MOD")

      // Check R2 storage
      expect(r2._store.size).toBe(2)
    })

    it("compensates and purges all new R2 objects if download or validation of any dependency fails", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes("/version?")) {
          if (urlStr.includes("proj-root-comp")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-root-comp",
                  name: "Root Mod",
                  version_number: "1.0.0",
                  version_type: "release",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  date_published: "2024-08-20T00:00:00Z",
                  files: [{ filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
                  dependencies: [{ project_id: "dep-failing", dependency_type: "required" }],
                },
              ],
            }
          }
          if (urlStr.includes("dep-failing")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-dep-fail",
                  name: "Failing Dep",
                  version_number: "1.0.0",
                  version_type: "release",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  date_published: "2024-08-20T00:00:00Z",
                  files: [{ filename: "dep.jar", size: 1000, url: "https://cdn/dep.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
        }
        if (urlStr.includes("/version/ver-root-comp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-root-comp",
              files: [{ filename: "root.jar", url: "https://cdn/root.jar" }],
            }),
          }
        }
        if (urlStr.includes("/version/ver-dep-fail")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-dep-fail",
              files: [{ filename: "dep.jar", url: "https://cdn/dep.jar" }],
            }),
          }
        }
        if (urlStr.includes("/project/proj-root-comp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "proj-root-comp", title: "Root", description: "", categories: [] }),
          }
        }
        if (urlStr.includes("/project/dep-failing")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "dep-failing", title: "Fail", description: "", categories: [] }),
          }
        }
        if (urlStr.includes("root.jar")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => createSampleJarBuffer("valid root jar").buffer,
          }
        }
        if (urlStr.includes("dep.jar")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new Uint8Array([0x00, 0x00, 0x00, 0x00]).buffer, // Corrupt magic bytes
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        installModPlan(
          db,
          env,
          { provider: "MODRINTH", projectId: "proj-root-comp", versionId: "ver-root-comp" },
          adminUserId,
        ),
      ).rejects.toThrow(/formato \.jar válido/)

      // Ensure R2 was compensated and no files remain in R2 or D1
      expect(r2._store.size).toBe(0)

      const draftFiles = await db.select().from(schema.gameReleaseFiles).all()
      expect(draftFiles.length).toBe(0)
    })

    it("clears sourceProvider metadata when a provider-installed mod is manually overwritten with text or custom upload", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      // 1. Mod installed with provider metadata
      const modFileId = "mod-with-metadata"
      await db.insert(schema.gameReleaseFiles).values({
        id: modFileId,
        releaseId: draft.id,
        name: "config.json",
        logicalPath: "config/config.json",
        category: "CONFIG",
        sha256: "sha256-orig",
        sizeBytes: 100,
        objectKey: "game-files/orig",
        sourceProvider: "MODRINTH",
        sourceProjectId: "config-mod-id",
        sourceVersionId: "ver-cfg-1",
        createdAt: new Date().toISOString(),
      })

      // 2. Save text content manually over the file
      await saveGameFileContent(
        db,
        { logicalPath: "config/config.json", content: '{"custom": true}' },
        adminUserId,
        env,
      )

      const updated = await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(eq(schema.gameReleaseFiles.id, modFileId))
        .get()

      expect(updated).toBeDefined()
      expect(updated?.sourceProvider).toBeNull()
      expect(updated?.sourceProjectId).toBeNull()
      expect(updated?.sourceVersionId).toBeNull()
    })
  })
})
