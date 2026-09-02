import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { ModProviderManager } from "./modProviderManager"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

describe("Shard 08D: Server Content Authority & Provider Separation Tests", () => {
  let db: any
  let d1: any
  let manager: ModProviderManager
  const mockEnv: any = {
    MODRINTH_API_TOKEN: "mock_mr_token",
    CURSEFORGE_API_KEY: "mock_cf_token",
  }

  beforeEach(async () => {
    const mock = createMockD1()
    db = mock.db
    d1 = mock.d1
    manager = new ModProviderManager()

    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
  })

  // Test 1: getPublishedEnvironment Authority
  it("getPublishedEnvironment uses fallback 1.21.1 / 21.1.65 when no PUBLISHED release exists, even if DRAFT exists", async () => {
    const nowIso = new Date().toISOString()

    // 1. Completely empty database
    const envEmpty = await manager.getPublishedEnvironment(db)
    expect(envEmpty.minecraftVersion).toBe("1.21.1")
    expect(envEmpty.neoForgeVersion).toBe("21.1.65")
    expect(envEmpty.releaseId).toBeFalsy()
    expect(envEmpty.isPublished).toBe(false)

    // 2. Insert only a DRAFT release (e.g. 1.20.1)
    await db.insert(schema.gameReleases).values({
      id: "rel-draft-1",
      version: "1.0.0-draft",
      minecraftVersion: "1.20.1",
      neoForgeVersion: "20.1.50",
      status: "DRAFT",
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const envWithDraft = await manager.getPublishedEnvironment(db)
    // Must IGNORE draft and still return fallback!
    expect(envWithDraft.minecraftVersion).toBe("1.21.1")
    expect(envWithDraft.neoForgeVersion).toBe("21.1.65")
    expect(envWithDraft.releaseId).toBeFalsy()
    expect(envWithDraft.isPublished).toBe(false)

    // 3. Insert a PUBLISHED release (e.g. 1.21.1 with specific custom forge)
    await db.insert(schema.gameReleases).values({
      id: "rel-published-1",
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.70",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const envWithPublished = await manager.getPublishedEnvironment(db)
    expect(envWithPublished.minecraftVersion).toBe("1.21.1")
    expect(envWithPublished.neoForgeVersion).toBe("21.1.70")
    expect(envWithPublished.releaseId).toBe("rel-published-1")
    expect(envWithPublished.isPublished).toBe(true)
  })

  // Test 2: Logical Destination Routing
  it("getLogicalPathForServerContent routes MOD to /mods and DATA_PACK to /<activeWorld>/datapacks", () => {
    const modPath = manager.getLogicalPathForServerContent("MOD", "chunky.jar", "custom_world")
    expect(modPath).toBe("mods/chunky.jar")

    const dataPackPath = manager.getLogicalPathForServerContent("DATA_PACK", "terralith.zip", "survival_2026")
    expect(dataPackPath).toBe("survival_2026/datapacks/terralith.zip")

    const dataPackDefault = manager.getLogicalPathForServerContent("DATA_PACK", "terralith.zip")
    expect(dataPackDefault).toBe("world/datapacks/terralith.zip")
  })

  // Test 3: BOTH Mod Rejection in Server Plan
  it("resolveServerInstallationPlan flags BOTH mod with requiresGameUpdate: true and explanatory reason", async () => {
    const mockBothModProject = {
      provider: "MODRINTH" as const,
      projectId: "both-mod-id",
      name: "FerriteCore",
      summary: "Memory optimization mod",
      description: "Optimizes memory",
      author: "malte0811",
      downloads: 1000000,
      contentType: "MOD" as const,
      environment: "BOTH" as const,
    }

    const mockBothModVersion = {
      id: "ver-both-1",
      versionNumber: "6.0.1",
      name: "FerriteCore 6.0.1",
      releaseType: "RELEASE" as const,
      gameVersions: ["1.21.1"],
      loaders: ["neoforge"],
      publishedAt: new Date().toISOString(),
      downloads: 50000,
      filename: "ferritecore-6.0.1-neoforge.jar",
      sizeBytes: 250000,
      sha256: "abc123sha256",
      contentType: "MOD" as const,
      environment: "BOTH" as const,
      dependencies: [],
    }

    const mockAdapter = {
      isConfigured: () => true,
      getSupportedContentTypes: vi.fn().mockResolvedValue(["MOD"]),
      getProject: vi.fn().mockResolvedValue(mockBothModProject),
      getCompatibleVersions: vi.fn().mockResolvedValue([mockBothModVersion]),
      getVersion: vi.fn().mockResolvedValue(mockBothModVersion),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)

    const plan = await manager.resolveServerInstallationPlan(
      mockEnv,
      db,
      {
        provider: "MODRINTH",
        projectId: "both-mod-id",
        versionId: "ver-both-1",
        contentType: "MOD",
      },
    )

    expect(plan.isValid).toBe(false)
    expect(plan.requiresGameUpdate).toBe(true)
    expect(plan.gameUpdateReason).toContain("Juego → Actualizaciones")
    expect(plan.conflicts.length).toBeGreaterThan(0)
  })

  // Test 4: SERVER Mod and DATA_PACK Acceptance in Server Plan
  it("resolveServerInstallationPlan successfully validates SERVER-only mod and DATA_PACK", async () => {
    // 1. Server-only mod
    const mockServerModProject = {
      provider: "MODRINTH" as const,
      projectId: "server-mod-id",
      name: "Chunky",
      summary: "Pre-generates chunks",
      description: "Chunk pregeneration mod",
      author: "pop4959",
      downloads: 500000,
      contentType: "MOD" as const,
      environment: "SERVER" as const,
    }

    const mockServerModVersion = {
      id: "ver-chunky-1",
      versionNumber: "1.3.146",
      name: "Chunky 1.3.146",
      releaseType: "RELEASE" as const,
      gameVersions: ["1.21.1"],
      loaders: ["neoforge"],
      publishedAt: new Date().toISOString(),
      downloads: 25000,
      filename: "Chunky-1.3.146.jar",
      sizeBytes: 150000,
      sha256: "chunky123sha256",
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      dependencies: [],
    }

    // 2. Data pack
    const mockDataPackProject = {
      provider: "MODRINTH" as const,
      projectId: "datapack-id",
      name: "Terralith",
      summary: "Worldgen overhaul",
      description: "Overhauls overworld",
      author: "Starmute",
      downloads: 800000,
      contentType: "DATA_PACK" as const,
      environment: "SERVER" as const,
    }

    const mockDataPackVersion = {
      id: "ver-terralith-1",
      versionNumber: "2.5.4",
      name: "Terralith v2.5.4",
      releaseType: "RELEASE" as const,
      gameVersions: ["1.21.1"],
      loaders: ["datapack"],
      publishedAt: new Date().toISOString(),
      downloads: 40000,
      filename: "Terralith_1.21_v2.5.4.zip",
      sizeBytes: 500000,
      sha256: "terralith123sha256",
      contentType: "DATA_PACK" as const,
      environment: "SERVER" as const,
      dependencies: [],
    }

    const mockAdapter = {
      isConfigured: () => true,
      getSupportedContentTypes: vi.fn().mockImplementation(async (_env, id, _v) => {
        if (id === "server-mod-id") return ["MOD"]
        if (id === "datapack-id") return ["DATA_PACK"]
        return []
      }),
      getProject: vi.fn().mockImplementation(async (_env, id, _ct) => {
        if (id === "server-mod-id") return mockServerModProject
        if (id === "datapack-id") return mockDataPackProject
        return null
      }),
      getCompatibleVersions: vi.fn().mockImplementation(async (_env, id, _v, _l, ct) => {
        if (id === "server-mod-id" && ct === "MOD") return [mockServerModVersion]
        if (id === "datapack-id" && ct === "DATA_PACK") return [mockDataPackVersion]
        return []
      }),
      getVersion: vi.fn().mockImplementation(async (_env, id, _p, _ct) => {
        if (id === "ver-chunky-1") return mockServerModVersion
        if (id === "ver-terralith-1") return mockDataPackVersion
        return null
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)

    const serverModPlan = await manager.resolveServerInstallationPlan(
      mockEnv,
      db,
      {
        provider: "MODRINTH",
        projectId: "server-mod-id",
        versionId: "ver-chunky-1",
        contentType: "MOD",
      },
    )

    expect(serverModPlan.isValid).toBe(true)
    expect(serverModPlan.requiresGameUpdate).toBe(false)
    expect(serverModPlan.items).toHaveLength(1)
    expect(serverModPlan.items[0]?.targetPath).toBe("mods/Chunky-1.3.146.jar")

    const dataPackPlan = await manager.resolveServerInstallationPlan(
      mockEnv,
      db,
      {
        provider: "MODRINTH",
        projectId: "datapack-id",
        versionId: "ver-terralith-1",
        contentType: "DATA_PACK",
      },
      "survival_world",
    )

    expect(dataPackPlan.isValid).toBe(true)
    expect(dataPackPlan.requiresGameUpdate).toBe(false)
    expect(dataPackPlan.items).toHaveLength(1)
    expect(dataPackPlan.items[0]?.targetPath).toBe("survival_world/datapacks/Terralith_1.21_v2.5.4.zip")
  })

  // Test 5: Game Flow rejects DATA_PACK and SERVER mods
  it("resolveInstallationPlan for Game / Updates rejects DATA_PACK and SERVER mods", async () => {
    // 1. Attempting to add DATA_PACK in Game updates flow throws immediately
    await expect(
      manager.resolveInstallationPlan(
        mockEnv,
        db,
        {
          provider: "MODRINTH",
          projectId: "datapack-id",
          versionId: "ver-dp-1",
          contentType: "DATA_PACK",
        },
      ),
    ).rejects.toThrow("Los Data Packs se administran exclusivamente desde Servidor → Archivos.")

    // 2. Attempting to add SERVER-only mod in Game updates flow
    const mockServerOnlyProject = {
      provider: "MODRINTH" as const,
      projectId: "server-only-id",
      name: "ServerOnlyMod",
      summary: "Server mod",
      description: "Server mod",
      author: "Author",
      downloads: 1000,
      contentType: "MOD" as const,
      environment: "SERVER" as const,
    }

    const mockServerOnlyVersion = {
      id: "ver-srv-1",
      versionNumber: "1.0.0",
      name: "v1.0.0",
      releaseType: "RELEASE" as const,
      gameVersions: ["1.21.1"],
      loaders: ["neoforge"],
      publishedAt: new Date().toISOString(),
      downloads: 100,
      filename: "servermod.jar",
      sizeBytes: 1000,
      sha256: "srvhash",
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      dependencies: [],
    }

    const mockAdapter = {
      isConfigured: () => true,
      getSupportedContentTypes: vi.fn().mockResolvedValue(["MOD"]),
      getProject: vi.fn().mockResolvedValue(mockServerOnlyProject),
      getCompatibleVersions: vi.fn().mockResolvedValue([mockServerOnlyVersion]),
      getVersion: vi.fn().mockResolvedValue(mockServerOnlyVersion),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)

    await expect(
      manager.resolveInstallationPlan(
        mockEnv,
        db,
        {
          provider: "MODRINTH",
          projectId: "server-only-id",
          versionId: "ver-srv-1",
          contentType: "MOD",
        },
      ),
    ).rejects.toThrow("Los mods exclusivos de servidor (SERVER) no corresponden al cliente")
  })

  // Test 6: Dependency Resolution Cycle Protection in Server Plan
  it("resolveServerInstallationPlan resolves diamond dependencies without duplicate items and handles cycles", async () => {
    const mockModA = {
      id: "mod-a",
      name: "Mod A",
      environment: "SERVER" as const,
      contentType: "MOD" as const,
    }
    const mockVerA = {
      id: "ver-a",
      name: "Mod A",
      versionNumber: "1.0",
      filename: "mod-a.jar",
      sizeBytes: 1000,
      sha256: "hash-a",
      loaders: ["neoforge"],
      gameVersions: ["1.21.1"],
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      dependencies: [
        { projectId: "mod-b", versionId: "ver-b", dependencyType: "REQUIRED" as const, projectName: "Mod B" },
        { projectId: "mod-c", versionId: "ver-c", dependencyType: "REQUIRED" as const, projectName: "Mod C" },
      ],
    }

    const mockModB = {
      id: "mod-b",
      name: "Mod B",
      environment: "SERVER" as const,
      contentType: "MOD" as const,
    }
    const mockVerB = {
      id: "ver-b",
      name: "Mod B",
      versionNumber: "1.0",
      filename: "mod-b.jar",
      sizeBytes: 1000,
      sha256: "hash-b",
      loaders: ["neoforge"],
      gameVersions: ["1.21.1"],
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      dependencies: [
        { projectId: "mod-d", versionId: "ver-d", dependencyType: "REQUIRED" as const, projectName: "Mod D" },
      ],
    }

    const mockModC = {
      id: "mod-c",
      name: "Mod C",
      environment: "SERVER" as const,
      contentType: "MOD" as const,
    }
    const mockVerC = {
      id: "ver-c",
      name: "Mod C",
      versionNumber: "1.0",
      filename: "mod-c.jar",
      sizeBytes: 1000,
      sha256: "hash-c",
      loaders: ["neoforge"],
      gameVersions: ["1.21.1"],
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      dependencies: [
        { projectId: "mod-d", versionId: "ver-d", dependencyType: "REQUIRED" as const, projectName: "Mod D" },
      ],
    }

    const mockModD = {
      id: "mod-d",
      name: "Mod D",
      environment: "SERVER" as const,
      contentType: "MOD" as const,
    }
    const mockVerD = {
      id: "ver-d",
      name: "Mod D",
      versionNumber: "1.0",
      filename: "mod-d.jar",
      sizeBytes: 1000,
      sha256: "hash-d",
      loaders: ["neoforge"],
      gameVersions: ["1.21.1"],
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      dependencies: [],
    }

    const projectsMap: any = { "mod-a": mockModA, "mod-b": mockModB, "mod-c": mockModC, "mod-d": mockModD }
    const versionsMap: any = { "ver-a": mockVerA, "ver-b": mockVerB, "ver-c": mockVerC, "ver-d": mockVerD }

    const mockAdapter = {
      isConfigured: () => true,
      getSupportedContentTypes: vi.fn().mockResolvedValue(["MOD"]),
      getProject: vi.fn().mockImplementation(async (_env, id) => projectsMap[id] || null),
      getCompatibleVersions: vi.fn().mockImplementation(async (_env, id) => {
        const verId = id.replace("mod-", "ver-")
        return versionsMap[verId] ? [versionsMap[verId]] : []
      }),
      getVersion: vi.fn().mockImplementation(async (_env, id) => versionsMap[id] || null),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)

    const diamondPlan = await manager.resolveServerInstallationPlan(
      mockEnv,
      db,
      {
        provider: "MODRINTH",
        projectId: "mod-a",
        versionId: "ver-a",
        contentType: "MOD",
      },
    )

    expect(diamondPlan.isValid).toBe(true)
    // 4 distinct items: A, B, C, D (D should only appear ONCE despite being required by both B and C)
    expect(diamondPlan.items).toHaveLength(4)
    const projectIds = diamondPlan.items.map((i) => i.projectId)
    expect(new Set(projectIds).size).toBe(4)
    expect(projectIds).toContain("mod-a")
    expect(projectIds).toContain("mod-b")
    expect(projectIds).toContain("mod-c")
    expect(projectIds).toContain("mod-d")
  })

  // Test 7: searchServerMods filters and returns SERVER and BOTH mods for Modrinth (excludes CLIENT)
  it("searchServerMods excludes CLIENT mods, returning SERVER and BOTH mods for Modrinth", async () => {
    const mockProjects = [
      { projectId: "srv-mod-1", name: "Chunky", environment: "SERVER", contentType: "MOD", provider: "MODRINTH" },
      { projectId: "client-mod-1", name: "Sodium", environment: "CLIENT", contentType: "MOD", provider: "MODRINTH" },
      { projectId: "both-mod-1", name: "FerriteCore", environment: "BOTH", contentType: "MOD", provider: "MODRINTH" },
      { projectId: "srv-mod-2", name: "Spark", environment: "SERVER", contentType: "MOD", provider: "MODRINTH" },
    ]

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockResolvedValue({
        items: mockProjects,
        totalCount: 4,
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    const results = await manager.searchServerMods(
      mockEnv,
      db,
      "test",
      "MODRINTH",
      10,
      0,
      "MOD",
    )

    expect(results.items).toHaveLength(3)
    expect(results.items.map((i) => i.projectId)).toEqual(["srv-mod-1", "both-mod-1", "srv-mod-2"])
  })

  // Test 8: searchMods excludes SERVER mods in Game Updates flow
  it("searchMods excludes SERVER mods in Game Updates flow", async () => {
    const mockProjects = [
      { projectId: "srv-mod-1", name: "Chunky", environment: "SERVER", contentType: "MOD" },
      { projectId: "client-mod-1", name: "Sodium", environment: "CLIENT", contentType: "MOD" },
      { projectId: "both-mod-1", name: "FerriteCore", environment: "BOTH", contentType: "MOD" },
    ]

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockResolvedValue({
        items: mockProjects,
        totalCount: 3,
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    const results = await manager.searchMods(
      mockEnv,
      db,
      "test",
      "MODRINTH",
      10,
      0,
      "MOD",
    )

    expect(results.items).toHaveLength(2)
    expect(results.items.map((i) => i.projectId)).toEqual(["client-mod-1", "both-mod-1"])
  })

  // Test 9: Filtered pagination fetches through chunks and returns items with accurate hasMore
  it("Shard 8D: searchServerMods fetches chunks across provider pages without premature termination and computes hasMore", async () => {
    // Page 1 from provider: 20 items, ALL BOTH environment (0 SERVER)
    const providerPage1 = Array.from({ length: 20 }, (_, i) => ({
      projectId: `both-mod-${i + 1}`,
      name: `Both Mod ${i + 1}`,
      environment: "BOTH",
      contentType: "MOD",
    }))

    // Page 2 from provider: 5 SERVER items
    const providerPage2 = Array.from({ length: 5 }, (_, i) => ({
      projectId: `server-mod-${i + 1}`,
      name: `Server Mod ${i + 1}`,
      environment: "SERVER",
      contentType: "MOD",
    }))

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockImplementation(async (_env, _query, _limit, offset) => {
        if (offset === 0) {
          return { items: providerPage1, totalCount: 25 }
        } else {
          return { items: providerPage2, totalCount: 25 }
        }
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    const results = await manager.searchServerMods(
      mockEnv,
      db,
      "test",
      "MODRINTH",
      10,
      0,
      "MOD",
    )

    // Should have advanced to page 2 to find the 5 SERVER mods
    expect(results.items).toHaveLength(5)
    expect(results.items[0]?.projectId).toBe("server-mod-1")
    expect(results.hasMore).toBe(false)
  })

  // Test 10: Deduplication across pagination loads
  it("Shard 8D: searchServerMods deduplicates items and sets hasMore = false on last page", async () => {
    const providerItems = [
      { projectId: "srv-dup-1", name: "Srv 1", environment: "SERVER", contentType: "MOD" },
      { projectId: "srv-dup-2", name: "Srv 2", environment: "SERVER", contentType: "MOD" },
      { projectId: "srv-dup-1", name: "Srv 1 Duplicate", environment: "SERVER", contentType: "MOD" },
    ]

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockResolvedValue({
        items: providerItems,
        totalCount: 3,
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    const results = await manager.searchServerMods(
      mockEnv,
      db,
      "test",
      "MODRINTH",
      10,
      0,
      "MOD",
    )

    expect(results.items).toHaveLength(2)
    expect(results.hasMore).toBe(false)
  })

  // Test 11: Partial provider failure returns available results gracefully
  it("Shard 8D: searchServerMods handles partial provider failure gracefully", async () => {
    const mockMrAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockResolvedValue({
        items: [{ projectId: "mr-srv-1", name: "MR Server Mod", environment: "SERVER", contentType: "MOD" }],
        totalCount: 1,
      }),
    }

    const mockCfAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockRejectedValue(new Error("CurseForge 503 Service Unavailable")),
    }

    vi.spyOn(manager, "getAdapter").mockImplementation((p: string) => {
      if (p === "CURSEFORGE") return mockCfAdapter as any
      return mockMrAdapter as any
    })
    ;(manager as any).modrinth = mockMrAdapter
    ;(manager as any).curseforge = mockCfAdapter

    const results = await manager.searchServerMods(
      mockEnv,
      db,
      "test",
      null,
      10,
      0,
      "MOD",
    )

    // Should return results from Modrinth without throwing
    expect(results.items).toHaveLength(1)
    expect(results.items[0]?.projectId).toBe("mr-srv-1")
    expect(results.providersStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "MODRINTH", available: true }),
        expect.objectContaining({ provider: "CURSEFORGE", available: false }),
      ]),
    )
  })

  // Test 12: Single Provider — 50 consecutive SERVER items with limit 20 produces exactly 3 pages without skips or duplicates
  it("Shard 8D: Single Provider — 50 consecutive SERVER items with limit 20 produces exactly Page 1 (0..19), Page 2 (20..39), Page 3 (40..49)", async () => {
    const all50Items = Array.from({ length: 50 }, (_, i) => ({
      projectId: `srv-item-${i}`,
      name: `Server Item ${i}`,
      environment: "SERVER",
      contentType: "MOD",
    }))

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockImplementation(async (_env, _query, _mc, _l, limit, offset) => {
        const slice = all50Items.slice(offset, offset + limit)
        return { items: slice, totalCount: 50 }
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    // Page 1 (limit 20)
    const page1 = await manager.searchServerMods(
      mockEnv,
      db,
      "server-mod",
      "MODRINTH",
      20,
      0,
      "MOD",
      null,
    )

    expect(page1.items).toHaveLength(20)
    expect(page1.items.map((i) => i.projectId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `srv-item-${i}`),
    )
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).not.toBeNull()

    // Page 2 (limit 20 using cursor)
    const page2 = await manager.searchServerMods(
      mockEnv,
      db,
      "server-mod",
      "MODRINTH",
      20,
      0,
      "MOD",
      page1.nextCursor,
    )

    expect(page2.items).toHaveLength(20)
    expect(page2.items.map((i) => i.projectId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `srv-item-${i + 20}`),
    )
    expect(page2.hasMore).toBe(true)
    expect(page2.nextCursor).not.toBeNull()

    // Page 3 (limit 20 using cursor)
    const page3 = await manager.searchServerMods(
      mockEnv,
      db,
      "server-mod",
      "MODRINTH",
      20,
      0,
      "MOD",
      page2.nextCursor,
    )

    expect(page3.items).toHaveLength(10)
    expect(page3.items.map((i) => i.projectId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `srv-item-${i + 40}`),
    )
    expect(page3.hasMore).toBe(false)
    expect(page3.nextCursor).toBeNull()

    // Verify 0 duplicates across all 3 pages
    const combinedIds = [
      ...page1.items.map((i) => i.projectId),
      ...page2.items.map((i) => i.projectId),
      ...page3.items.map((i) => i.projectId),
    ]
    expect(new Set(combinedIds).size).toBe(50)
  })

  // Test 13: Cursor-based pagination scans past raw 300 items across multiple pages with 0 duplicates
  it("Shard 8D: Cursor-based pagination seamlessly scans past raw index 300 without infinite loop or duplicates", async () => {
    const allProviderItems = Array.from({ length: 1000 }, (_, i) => ({
      projectId: `mod-${i}`,
      name: `Mod ${i}`,
      environment: i % 2 === 1 ? "SERVER" : "BOTH",
      contentType: "MOD",
    }))

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockImplementation(async (_env, _query, _mc, _l, limit, offset) => {
        const slice = allProviderItems.slice(offset, offset + limit)
        return { items: slice, totalCount: allProviderItems.length }
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    const seenProjectIds = new Set<string>()
    let currentCursor: string | null = null
    let pageCount = 0
    let totalCollected = 0

    // Fetch page 1 (limit 20)
    const page1 = await manager.searchServerMods(
      mockEnv,
      db,
      "test",
      "MODRINTH",
      20,
      0,
      "MOD",
      currentCursor,
    )

    expect(page1.items.length).toBe(20)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).not.toBeNull()

    for (const item of page1.items) {
      expect(seenProjectIds.has(item.projectId)).toBe(false)
      seenProjectIds.add(item.projectId)
    }
    totalCollected += page1.items.length
    currentCursor = page1.nextCursor || null

    // Paginating 15 consecutive times to go way past raw index 300 (reaching raw 600+)
    while (currentCursor && pageCount < 15) {
      pageCount++
      const nextPage = await manager.searchServerMods(
        mockEnv,
        db,
        "test",
        "MODRINTH",
        20,
        0,
        "MOD",
        currentCursor,
      )

      for (const item of nextPage.items) {
        expect(seenProjectIds.has(item.projectId)).toBe(false) // 0 duplicates across cursor pages
        seenProjectIds.add(item.projectId)
      }
      totalCollected += nextPage.items.length
      currentCursor = nextPage.nextCursor || null
    }

    expect(pageCount).toBe(15)
    expect(totalCollected).toBeGreaterThan(300)
  })

  // Test 14: Sparse provider results preserve leftovers in next page
  it("Shard 8D: Sparse provider results (raw 0..199 CLIENT, raw 200..224 SERVER) preserve leftovers in next page", async () => {
    // 0..199 = CLIENT, 200..224 = SERVER (25 items), 225..299 = CLIENT
    const allProviderItems = Array.from({ length: 300 }, (_, i) => ({
      projectId: `sparse-mod-${i}`,
      name: `Sparse Mod ${i}`,
      environment: i >= 200 && i < 225 ? "SERVER" : "CLIENT",
      contentType: "MOD",
      provider: "MODRINTH",
    }))

    const mockAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockImplementation(async (_env, _query, _mc, _l, limit, offset) => {
        const slice = allProviderItems.slice(offset, offset + limit)
        return { items: slice, totalCount: allProviderItems.length }
      }),
    }

    vi.spyOn(manager, "getAdapter").mockReturnValue(mockAdapter as any)
    ;(manager as any).modrinth = mockAdapter

    // Page 1: returns items 200..219 (20 items)
    const page1 = await manager.searchServerMods(
      mockEnv,
      db,
      "sparse-search",
      "MODRINTH",
      20,
      0,
      "MOD",
      null,
    )

    expect(page1.items).toHaveLength(20)
    expect(page1.items[0]?.projectId).toBe("sparse-mod-200")
    expect(page1.items[19]?.projectId).toBe("sparse-mod-219")
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).not.toBeNull()

    // Page 2: returns leftover items 220..224 (5 items)
    const page2 = await manager.searchServerMods(
      mockEnv,
      db,
      "sparse-search",
      "MODRINTH",
      20,
      0,
      "MOD",
      page1.nextCursor,
    )

    expect(page2.items).toHaveLength(5)
    expect(page2.items.map((i) => i.projectId)).toEqual([
      "sparse-mod-220",
      "sparse-mod-221",
      "sparse-mod-222",
      "sparse-mod-223",
      "sparse-mod-224",
    ])
    expect(page2.hasMore).toBe(false)
    expect(page2.nextCursor).toBeNull()
  })

  // Test 15: ALL providers preserves leftovers across pages with zero skips and zero duplicates
  it("Shard 8D: ALL providers with 20 MR SERVER and 20 CF SERVER preserves leftovers across pages", async () => {
    const mrItems = Array.from({ length: 20 }, (_, i) => ({
      projectId: `mr-srv-${i}`,
      name: `MR Srv ${i}`,
      environment: "SERVER",
      contentType: "MOD",
    }))

    const cfItems = Array.from({ length: 20 }, (_, i) => ({
      projectId: `cf-srv-${i}`,
      name: `CF Srv ${i}`,
      environment: "SERVER",
      contentType: "MOD",
    }))

    const mockMrAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockImplementation(async (_env, _query, _mc, _l, limit, offset) => {
        const slice = mrItems.slice(offset, offset + limit)
        return { items: slice, totalCount: 20 }
      }),
    }

    const mockCfAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockImplementation(async (_env, _query, _mc, _l, limit, offset) => {
        const slice = cfItems.slice(offset, offset + limit)
        return { items: slice, totalCount: 20 }
      }),
    }

    vi.spyOn(manager, "getAdapter").mockImplementation((p: string) => {
      if (p === "CURSEFORGE") return mockCfAdapter as any
      return mockMrAdapter as any
    })
    ;(manager as any).modrinth = mockMrAdapter
    ;(manager as any).curseforge = mockCfAdapter

    // Page 1 (limit 20: 10 MR + 10 CF interleaved)
    const page1 = await manager.searchServerMods(
      mockEnv,
      db,
      "all-interleave",
      null,
      20,
      0,
      "MOD",
      null,
    )

    expect(page1.items).toHaveLength(20)
    // Deterministic interleaving: mr-0, cf-0, mr-1, cf-1 ...
    expect(page1.items[0]?.projectId).toBe("mr-srv-0")
    expect(page1.items[1]?.projectId).toBe("cf-srv-0")
    expect(page1.items[18]?.projectId).toBe("mr-srv-9")
    expect(page1.items[19]?.projectId).toBe("cf-srv-9")
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).not.toBeNull()

    // Page 2 (limit 20: remaining 10 MR + 10 CF)
    const page2 = await manager.searchServerMods(
      mockEnv,
      db,
      "all-interleave",
      null,
      20,
      0,
      "MOD",
      page1.nextCursor,
    )

    expect(page2.items).toHaveLength(20)
    expect(page2.items[0]?.projectId).toBe("mr-srv-10")
    expect(page2.items[1]?.projectId).toBe("cf-srv-10")
    expect(page2.items[18]?.projectId).toBe("mr-srv-19")
    expect(page2.items[19]?.projectId).toBe("cf-srv-19")
    expect(page2.hasMore).toBe(false)
    expect(page2.nextCursor).toBeNull()

    // All 40 items present, 0 duplicates
    const allProjectIds = [
      ...page1.items.map((i) => i.projectId),
      ...page2.items.map((i) => i.projectId),
    ]
    expect(new Set(allProjectIds).size).toBe(40)
  })

  // Test 16: Cursor validation — Modrinth cursor used in CurseForge throws VALIDATION_ERROR
  it("Shard 8D: Cursor generated for MODRINTH throws VALIDATION_ERROR when reused in CURSEFORGE", async () => {
    const mockMrAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockResolvedValue({
        items: [{ projectId: "mr-1", name: "MR 1", environment: "SERVER", contentType: "MOD" }],
        totalCount: 10,
      }),
    }
    vi.spyOn(manager, "getAdapter").mockReturnValue(mockMrAdapter as any)
    ;(manager as any).modrinth = mockMrAdapter

    const mrPage = await manager.searchServerMods(
      mockEnv,
      db,
      "test-query",
      "MODRINTH",
      1,
      0,
      "MOD",
      null,
    )
    expect(mrPage.nextCursor).not.toBeNull()

    // Try using mrCursor in CURSEFORGE search
    await expect(
      manager.searchServerMods(
        mockEnv,
        db,
        "test-query",
        "CURSEFORGE",
        1,
        0,
        "MOD",
        mrPage.nextCursor,
      ),
    ).rejects.toThrow("El cursor de paginación no coincide con la consulta, tipo de contenido o proveedor solicitados.")
  })

  // Test 17: Cursor validation — mismatched query or contentType throws VALIDATION_ERROR
  it("Shard 8D: Cursor with mismatched query or contentType throws VALIDATION_ERROR", async () => {
    const mockMrAdapter = {
      isConfigured: () => true,
      searchMods: vi.fn().mockResolvedValue({
        items: [{ projectId: "mr-1", name: "MR 1", environment: "SERVER", contentType: "MOD" }],
        totalCount: 10,
      }),
    }
    vi.spyOn(manager, "getAdapter").mockReturnValue(mockMrAdapter as any)
    ;(manager as any).modrinth = mockMrAdapter

    const mrPage = await manager.searchServerMods(
      mockEnv,
      db,
      "query-a",
      "MODRINTH",
      1,
      0,
      "MOD",
      null,
    )
    expect(mrPage.nextCursor).not.toBeNull()

    // Different query
    await expect(
      manager.searchServerMods(
        mockEnv,
        db,
        "query-b",
        "MODRINTH",
        1,
        0,
        "MOD",
        mrPage.nextCursor,
      ),
    ).rejects.toThrow("El cursor de paginación no coincide con la consulta, tipo de contenido o proveedor solicitados.")

    // Different contentType
    await expect(
      manager.searchServerMods(
        mockEnv,
        db,
        "query-a",
        "MODRINTH",
        1,
        0,
        "DATA_PACK",
        mrPage.nextCursor,
      ),
    ).rejects.toThrow("El cursor de paginación no coincide con la consulta, tipo de contenido o proveedor solicitados.")

    // Corrupted cursor string
    await expect(
      manager.searchServerMods(
        mockEnv,
        db,
        "query-a",
        "MODRINTH",
        1,
        0,
        "MOD",
        "invalid-non-base64-json!@@@",
      ),
    ).rejects.toThrow("Cursor de paginación inválido o corrupto.")
  })
})
