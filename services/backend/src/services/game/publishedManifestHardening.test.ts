import { describe, it, expect, beforeEach } from "vitest"
import { eq } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { createTestR2Bucket } from "../../testUtils/mockR2"
import { getPublishedModpack, isClientGameReleaseFile } from "./releaseService"
import { handleGameFileDownload } from "./gameStorageService"
import type { Env } from "../../types"

describe("Shard 8E: Authoritative Client Manifest & Backend Security Suite", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let mockR2: ReturnType<typeof createTestR2Bucket>
  let env: Env
  let releaseId: string
  let adminId: string

  beforeEach(async () => {
    testD1 = createTestD1()
    db = createDatabase(testD1)
    mockR2 = createTestR2Bucket()
    env = {
      DB: testD1 as unknown as D1Database,
      ASSETS: mockR2 as unknown as R2Bucket,
      ENVIRONMENT: "test",
    }

    releaseId = crypto.randomUUID()
    const now = new Date().toISOString()
    adminId = crypto.randomUUID()

    await db.insert(schema.users).values({
      id: adminId,
      displayName: "Admin Release Tester",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    })

    // Create a published release
    await db.insert(schema.gameReleases).values({
      id: releaseId,
      version: "1.5.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: now,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    })

    // Set launcher active release pointer for the fixture
    await db
      .update(schema.projectSettings)
      .set({ launcherActiveReleaseId: releaseId })
      .where(eq(schema.projectSettings.id, "main"))
  })


  it("1. includes CLIENT mod in publishedModpack.clientFiles", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "sodium.jar",
      logicalPath: "mods/sodium.jar",
      category: "MOD",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
      sourceProvider: "MODRINTH",
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    expect(modpack).not.toBeNull()
    const found = modpack?.clientFiles.find((f) => f.path === "mods/sodium.jar")
    expect(found).toBeDefined()
    expect(found?.sha256).toBe("a".repeat(64))
  })

  it("2. includes BOTH mod in publishedModpack.clientFiles", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "create.jar",
      logicalPath: "mods/create.jar",
      category: "MOD",
      sha256: "b".repeat(64),
      sizeBytes: 2048,
      sourceProvider: "CURSEFORGE",
      sourceEnvironment: "BOTH",
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "mods/create.jar")
    expect(found).toBeDefined()
    expect(found?.sha256).toBe("b".repeat(64))
  })

  it("3. strictly excludes SERVER mod from publishedModpack.clientFiles", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "server-essentials.jar",
      logicalPath: "mods/server-essentials.jar",
      category: "MOD",
      sha256: "c".repeat(64),
      sizeBytes: 512,
      sourceProvider: "MODRINTH",
      sourceEnvironment: "SERVER",
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "mods/server-essentials.jar")
    expect(found).toBeUndefined()
  })

  it("4. strictly excludes DATA_PACK from publishedModpack.clientFiles", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "custom-recipes.zip",
      logicalPath: "datapacks/custom-recipes.zip",
      category: "DATA_PACK",
      sha256: "d".repeat(64),
      sizeBytes: 4096,
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "datapacks/custom-recipes.zip")
    expect(found).toBeUndefined()
  })

  it("5. includes RESOURCE_PACK in publishedModpack.clientFiles", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "faithful.zip",
      logicalPath: "resourcepacks/faithful.zip",
      category: "RESOURCE_PACK",
      sha256: "e".repeat(64),
      sizeBytes: 8192,
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "resourcepacks/faithful.zip")
    expect(found).toBeDefined()
  })

  it("6. includes SHADER_PACK in publishedModpack.clientFiles", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "complimentary.zip",
      logicalPath: "shaderpacks/complimentary.zip",
      category: "SHADER_PACK",
      sha256: "f".repeat(64),
      sizeBytes: 8192,
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "shaderpacks/complimentary.zip")
    expect(found).toBeDefined()
  })

  it("7. retains config, KubeJS, scripts, and general legitimate client content", async () => {
    const id1 = crypto.randomUUID()
    const id2 = crypto.randomUUID()
    const id3 = crypto.randomUUID()

    await db.insert(schema.gameReleaseFiles).values({
      id: id1,
      releaseId,
      name: "options.txt",
      logicalPath: "options.txt",
      category: "GENERAL",
      sha256: "1".repeat(64),
      sizeBytes: 100,
      policy: "MODIFICABLE",
      isDirectory: 0,
      objectKey: "game-files/" + id1,
      createdAt: new Date().toISOString(),
    })

    await db.insert(schema.gameReleaseFiles).values({
      id: id2,
      releaseId,
      name: "jei.toml",
      logicalPath: "config/jei.toml",
      category: "CONFIG",
      sha256: "2".repeat(64),
      sizeBytes: 200,
      policy: "NO_MODIFICABLE",
      isDirectory: 0,
      objectKey: "game-files/" + id2,
      createdAt: new Date().toISOString(),
    })

    await db.insert(schema.gameReleaseFiles).values({
      id: id3,
      releaseId,
      name: "init.js",
      logicalPath: "kubejs/startup_scripts/init.js",
      category: "KUBEJS",
      sha256: "3".repeat(64),
      sizeBytes: 300,
      policy: "NO_MODIFICABLE",
      isDirectory: 0,
      objectKey: "game-files/" + id3,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    expect(modpack?.clientFiles.find((f) => f.path === "options.txt")).toBeDefined()
    expect(modpack?.clientFiles.find((f) => f.path === "config/jei.toml")).toBeDefined()
    expect(modpack?.clientFiles.find((f) => f.path === "kubejs/startup_scripts/init.js")).toBeDefined()
  })

  it("8. fail-closed: excludes provider-managed mod with UNKNOWN / null environment", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "unverified-provider.jar",
      logicalPath: "mods/unverified-provider.jar",
      category: "MOD",
      sha256: "4".repeat(64),
      sizeBytes: 1024,
      sourceProvider: "MODRINTH",
      sourceEnvironment: null, // Unknown/null environment on provider mod
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "mods/unverified-provider.jar")
    expect(found).toBeUndefined()
  })

  it("9. includes custom uploaded mod without provider if not SERVER", async () => {
    const fileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "custom-client-mod.jar",
      logicalPath: "mods/custom-client-mod.jar",
      category: "MOD",
      sha256: "5".repeat(64),
      sizeBytes: 1024,
      sourceProvider: null,
      sourceEnvironment: null,
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    const found = modpack?.clientFiles.find((f) => f.path === "mods/custom-client-mod.jar")
    expect(found).toBeDefined()
  })

  it("10. backend bypass protection: /game/download/:fileId rejects SERVER content and DATA_PACK", async () => {
    const serverModId = crypto.randomUUID()
    const serverModKey = "game-files/" + serverModId
    await mockR2.put(serverModKey, new Uint8Array([1, 2, 3, 4]))

    await db.insert(schema.gameReleaseFiles).values({
      id: serverModId,
      releaseId,
      name: "server-only.jar",
      logicalPath: "mods/server-only.jar",
      category: "MOD",
      sha256: "6".repeat(64),
      sizeBytes: 4,
      sourceProvider: "MODRINTH",
      sourceEnvironment: "SERVER",
      isDirectory: 0,
      objectKey: serverModKey,
      createdAt: new Date().toISOString(),
    })

    const req = new Request(`http://localhost/game/download/${serverModId}`)
    const res = await handleGameFileDownload(req, env, db, serverModId)
    expect(res.status).toBe(404)

    const dataPackId = crypto.randomUUID()
    const dataPackKey = "game-files/" + dataPackId
    await mockR2.put(dataPackKey, new Uint8Array([5, 6, 7, 8]))

    await db.insert(schema.gameReleaseFiles).values({
      id: dataPackId,
      releaseId,
      name: "recipes.zip",
      logicalPath: "datapacks/recipes.zip",
      category: "DATA_PACK",
      sha256: "7".repeat(64),
      sizeBytes: 4,
      isDirectory: 0,
      objectKey: dataPackKey,
      createdAt: new Date().toISOString(),
    })

    const dataPackReq = new Request(`http://localhost/game/download/${dataPackId}`)
    const dataPackRes = await handleGameFileDownload(dataPackReq, env, db, dataPackId)
    expect(dataPackRes.status).toBe(404)
  })

  it("11. /game/download/:fileId successfully downloads CLIENT and BOTH files", async () => {
    const clientModId = crypto.randomUUID()
    const clientModKey = "game-files/" + clientModId
    const content = new Uint8Array([10, 20, 30, 40])
    await mockR2.put(clientModKey, content)

    await db.insert(schema.gameReleaseFiles).values({
      id: clientModId,
      releaseId,
      name: "client-mod.jar",
      logicalPath: "mods/client-mod.jar",
      category: "MOD",
      sha256: "8".repeat(64),
      sizeBytes: content.length,
      sourceProvider: "MODRINTH",
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: clientModKey,
      createdAt: new Date().toISOString(),
    })

    const req = new Request(`http://localhost/game/download/${clientModId}`)
    const res = await handleGameFileDownload(req, env, db, clientModId)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/java-archive")
    expect(res.headers.get("Accept-Ranges")).toBe("bytes")
    expect(res.headers.get("Content-Length")).toBe("4")
    expect(res.headers.get("ETag")).toBe(`"${"8".repeat(64)}"`)
  })

  it("12. /game/download/:fileId responds with 206 Partial Content for valid Range request", async () => {
    const modId = crypto.randomUUID()
    const modKey = "game-files/" + modId
    const content = new Uint8Array([10, 20, 30, 40, 50, 60])
    await mockR2.put(modKey, content)

    await db.insert(schema.gameReleaseFiles).values({
      id: modId,
      releaseId,
      name: "range-mod.jar",
      logicalPath: "mods/range-mod.jar",
      category: "MOD",
      sha256: "9".repeat(64),
      sizeBytes: content.length,
      sourceProvider: "MODRINTH",
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: modKey,
      createdAt: new Date().toISOString(),
    })

    // Range: bytes=2- (offset 2 to end, i.e. bytes 2-5 -> length 4)
    const req = new Request(`http://localhost/game/download/${modId}`, {
      headers: { Range: "bytes=2-" },
    })
    const res = await handleGameFileDownload(req, env, db, modId)
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/6")
    expect(res.headers.get("Content-Length")).toBe("4")
    expect(res.headers.get("Accept-Ranges")).toBe("bytes")
    expect(res.headers.get("ETag")).toBe(`"${"9".repeat(64)}"`)

    const bodyBuffer = new Uint8Array(await res.arrayBuffer())
    expect(bodyBuffer).toEqual(new Uint8Array([30, 40, 50, 60]))
  })

  it("13. /game/download/:fileId responds with 416 for invalid or out of bounds Range", async () => {
    const modId = crypto.randomUUID()
    const modKey = "game-files/" + modId
    const content = new Uint8Array([1, 2, 3, 4])
    await mockR2.put(modKey, content)

    await db.insert(schema.gameReleaseFiles).values({
      id: modId,
      releaseId,
      name: "bounds-mod.jar",
      logicalPath: "mods/bounds-mod.jar",
      category: "MOD",
      sha256: "c".repeat(64),
      sizeBytes: content.length,
      sourceProvider: "MODRINTH",
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: modKey,
      createdAt: new Date().toISOString(),
    })

    // Out of bounds start >= total size
    const outOfBoundsReq = new Request(`http://localhost/game/download/${modId}`, {
      headers: { Range: "bytes=10-" },
    })
    const outRes = await handleGameFileDownload(outOfBoundsReq, env, db, modId)
    expect(outRes.status).toBe(416)
    expect(outRes.headers.get("Content-Range")).toBe("bytes */4")
    expect(outRes.headers.get("Accept-Ranges")).toBe("bytes")

    // Malformed syntax
    const malformedReq = new Request(`http://localhost/game/download/${modId}`, {
      headers: { Range: "invalid-range" },
    })
    const malformedRes = await handleGameFileDownload(malformedReq, env, db, modId)
    expect(malformedRes.status).toBe(416)
  })

  it("14. getPublishedModpack returns notes and cover (IMAGE / VIDEO) when configured in active release", async () => {
    const coverMediaId = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.insert(schema.contentMedia).values({
      id: coverMediaId,
      objectKey: `content/media/${coverMediaId}.png`,
      mediaType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: 1024,
      createdBy: adminId,
      createdAt: now,
    })

    await db
      .update(schema.gameReleases)
      .set({
        notes: "Changelog v1.5.0: Added sodium and performance patches",
        coverMediaId,
      })
      .where(eq(schema.gameReleases.id, releaseId))

    const modpack = await getPublishedModpack(db, env)
    expect(modpack).toBeDefined()
    expect(modpack?.notes).toBe("Changelog v1.5.0: Added sodium and performance patches")
    expect(modpack?.cover).toBeDefined()
    expect(modpack?.cover?.id).toBe(coverMediaId)
    expect(modpack?.cover?.mediaType).toBe("IMAGE")
    expect(modpack?.cover?.url).toContain(`/media/content/${coverMediaId}`)
  })

  it("15. getPublishedModpack includes directoryPolicies and excludes directory records from clientFiles", async () => {
    const dirId = crypto.randomUUID()
    const fileId = crypto.randomUUID()

    // Directory record with MODIFICABLE policy
    await db.insert(schema.gameReleaseFiles).values({
      id: dirId,
      releaseId,
      name: "mods",
      logicalPath: "mods",
      category: "MOD",
      sha256: "",
      sizeBytes: 0,
      isDirectory: 1,
      policy: "MODIFICABLE",
      createdAt: new Date().toISOString(),
    })

    // File record inside mods inheriting MODIFICABLE
    await db.insert(schema.gameReleaseFiles).values({
      id: fileId,
      releaseId,
      name: "inherited.jar",
      logicalPath: "mods/inherited.jar",
      category: "MOD",
      sha256: "c".repeat(64),
      sizeBytes: 4096,
      sourceEnvironment: "BOTH",
      isDirectory: 0,
      objectKey: "game-files/" + fileId,
      createdAt: new Date().toISOString(),
    })

    const modpack = await getPublishedModpack(db, env)
    expect(modpack).toBeDefined()

    // clientFiles must contain only real files, NOT directory record
    expect(modpack?.clientFiles.find((f) => f.path === "mods")).toBeUndefined()
    const inheritedFile = modpack?.clientFiles.find((f) => f.path === "mods/inherited.jar")
    expect(inheritedFile).toBeDefined()
    expect(inheritedFile?.policy).toBe("MODIFICABLE")

    // directoryPolicies must contain the directory policy
    expect(modpack?.directoryPolicies).toBeDefined()
    const modsDirPolicy = modpack?.directoryPolicies?.find((dp) => dp.path === "mods")
    expect(modsDirPolicy).toBeDefined()
    expect(modsDirPolicy?.policy).toBe("MODIFICABLE")
  })

  it("16. /game/download/:fileId allows downloading client files of ARCHIVED releases while another release is active", async () => {
    // Create an archived release (e.g. 1.0.0)
    const archivedReleaseId = crypto.randomUUID()
    await db.insert(schema.gameReleases).values({
      id: archivedReleaseId,
      createdBy: adminId,
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      status: "ARCHIVED",
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const archivedFileId = crypto.randomUUID()
    const archivedKey = "game-files/" + archivedFileId
    const content = new Uint8Array([1, 2, 3, 4, 5])
    await mockR2.put(archivedKey, content)

    await db.insert(schema.gameReleaseFiles).values({
      id: archivedFileId,
      releaseId: archivedReleaseId,
      name: "archived-mod.jar",
      logicalPath: "mods/archived-mod.jar",
      category: "MOD",
      sha256: "1".repeat(64),
      sizeBytes: content.length,
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: archivedKey,
      createdAt: new Date().toISOString(),
    })

    // Active release in settings is `releaseId` (1.5.0), but file is from ARCHIVED (1.0.0)
    const req = new Request(`http://localhost/game/download/${archivedFileId}`)
    const res = await handleGameFileDownload(req, env, db, archivedFileId)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Length")).toBe("5")
  })

  it("17. /game/download/:fileId rejects files belonging to DRAFT releases", async () => {
    const draftReleaseId = crypto.randomUUID()
    await db.insert(schema.gameReleases).values({
      id: draftReleaseId,
      createdBy: adminId,
      version: "1.6.0-draft",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const draftFileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: draftFileId,
      releaseId: draftReleaseId,
      name: "draft-mod.jar",
      logicalPath: "mods/draft-mod.jar",
      category: "MOD",
      sha256: "2".repeat(64),
      sizeBytes: 100,
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: "game-files/" + draftFileId,
      createdAt: new Date().toISOString(),
    })

    const req = new Request(`http://localhost/game/download/${draftFileId}`)
    const res = await handleGameFileDownload(req, env, db, draftFileId)
    expect(res.status).toBe(404)
  })

  it("18. /game/download/:fileId rejects files of PUBLISHED releases that are NOT launcherActiveReleaseId", async () => {
    // Current release is PUBLISHED (`releaseId`), but launcherActiveReleaseId points to another release
    const otherReleaseId = crypto.randomUUID()
    await db.insert(schema.gameReleases).values({
      id: otherReleaseId,
      createdBy: adminId,
      version: "0.9.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      status: "ARCHIVED",
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await db.update(schema.projectSettings).set({
      launcherActiveReleaseId: otherReleaseId,
    }).run()

    const pendingFileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: pendingFileId,
      releaseId,
      name: "pending-mod.jar",
      logicalPath: "mods/pending-mod.jar",
      category: "MOD",
      sha256: "3".repeat(64),
      sizeBytes: 100,
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: "game-files/" + pendingFileId,
      createdAt: new Date().toISOString(),
    })

    const req = new Request(`http://localhost/game/download/${pendingFileId}`)
    const res = await handleGameFileDownload(req, env, db, pendingFileId)
    expect(res.status).toBe(404)
  })

  it("19. /game/download/:fileId rejects SERVER-only files even from an ARCHIVED release", async () => {
    const archivedReleaseId = crypto.randomUUID()
    await db.insert(schema.gameReleases).values({
      id: archivedReleaseId,
      createdBy: adminId,
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      status: "ARCHIVED",
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const serverOnlyFileId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: serverOnlyFileId,
      releaseId: archivedReleaseId,
      name: "server-only.jar",
      logicalPath: "mods/server-only.jar",
      category: "MOD",
      sha256: "4".repeat(64),
      sizeBytes: 100,
      sourceEnvironment: "SERVER",
      isDirectory: 0,
      objectKey: "game-files/" + serverOnlyFileId,
      createdAt: new Date().toISOString(),
    })

    const req = new Request(`http://localhost/game/download/${serverOnlyFileId}`)
    const res = await handleGameFileDownload(req, env, db, serverOnlyFileId)
    expect(res.status).toBe(404)
  })

  it("20. /game/download/:fileId handles 206 Partial Content Range requests on ARCHIVED release files", async () => {
    const archivedReleaseId = crypto.randomUUID()
    await db.insert(schema.gameReleases).values({
      id: archivedReleaseId,
      createdBy: adminId,
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      status: "ARCHIVED",
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const archivedRangeFileId = crypto.randomUUID()
    const key = "game-files/" + archivedRangeFileId
    const content = new Uint8Array([100, 101, 102, 103, 104, 105])
    await mockR2.put(key, content)

    await db.insert(schema.gameReleaseFiles).values({
      id: archivedRangeFileId,
      releaseId: archivedReleaseId,
      name: "archived-range.jar",
      logicalPath: "mods/archived-range.jar",
      category: "MOD",
      sha256: "5".repeat(64),
      sizeBytes: content.length,
      sourceEnvironment: "CLIENT",
      isDirectory: 0,
      objectKey: key,
      createdAt: new Date().toISOString(),
    })

    const req = new Request(`http://localhost/game/download/${archivedRangeFileId}`, {
      headers: { Range: "bytes=1-3" },
    })
    const res = await handleGameFileDownload(req, env, db, archivedRangeFileId)
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 1-3/6")
    expect(res.headers.get("Content-Length")).toBe("3")
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body).toEqual(new Uint8Array([101, 102, 103]))
  })
})
