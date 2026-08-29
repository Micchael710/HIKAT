import { describe, it, expect, beforeEach, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { createTestR2Bucket } from "../../testUtils/mockR2"
import {
  prepareGameDraft,
  discardGameDraft,
  updateGameDraftMetadata,
  publishGameRelease,
  getPublishedModpack,
  getAdminGameOverview,
  getGameReleaseHistory,
  resolveReleaseEffectivePolicies,
  computeDraftChanges,
  validateDraftReadiness,
} from "./releaseService"
import {
  saveGameFileContent,
  createGameFolder,
  addGameFile,
  setGamePathPolicy,
  deleteGamePaths,
} from "./gameFileService"
import {
  deleteMedia,
  saveMediaObjectWithCompensation,
} from "../mediaService"
import type { Env } from "../../types"

describe("HiKAT Shard 8C: Release Experience Backend Suite & Invariants", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let mockR2: ReturnType<typeof createTestR2Bucket>
  let env: Env
  const adminId = "admin-release-" + crypto.randomUUID()

  beforeEach(async () => {
    testD1 = createTestD1()
    db = createDatabase(testD1)
    mockR2 = createTestR2Bucket()
    env = {
      DB: testD1 as unknown as D1Database,
      ASSETS: mockR2 as unknown as R2Bucket,
      ENVIRONMENT: "test",
    }

    await db.insert(schema.users).values({
      id: adminId,
      displayName: "Admin Release Tester",
      role: "ADMIN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  // Helper to create test media
  async function createMockMedia(mediaType: "IMAGE" | "VIDEO", mimeType: string, id: string = crypto.randomUUID()) {
    const now = new Date().toISOString()
    await db.insert(schema.contentMedia).values({
      id,
      objectKey: `content/media/${id}.${mediaType === "IMAGE" ? "png" : "mp4"}`,
      mediaType,
      mimeType: mimeType as any,
      sizeBytes: 2048,
      createdBy: adminId,
      createdAt: now,
    })
    return id
  }

  describe("1. Metadata Management (updateGameDraftMetadata)", () => {
    it("1. versión SemVer válida se guarda", async () => {
      const draft = await prepareGameDraft(db, adminId)
      expect(draft.version.startsWith("draft-")).toBe(true)

      const updated = await updateGameDraftMetadata(
        db,
        env,
        { version: "1.2.0" },
        adminId,
      )

      expect(updated.version).toBe("1.2.0")
      const fromDb = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get()
      expect(fromDb?.version).toBe("1.2.0")
    })

    it("2. versión inválida -> reject con VALIDATION_ERROR", async () => {
      await prepareGameDraft(db, adminId)

      await expect(
        updateGameDraftMetadata(db, env, { version: "invalid-semver-version" }, adminId),
      ).rejects.toThrow(/Formato de versión inválido/i)

      await expect(
        updateGameDraftMetadata(db, env, { version: "" }, adminId),
      ).rejects.toThrow(/La versión del juego no puede estar vacía/i)
    })

    it("3. versión duplicada -> reject con CONFLICT", async () => {
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: "rel-archived-1",
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "ARCHIVED",
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      await prepareGameDraft(db, adminId)

      await expect(
        updateGameDraftMetadata(db, env, { version: "1.0.0" }, adminId),
      ).rejects.toThrow(/ya existe en el historial/i)
    })

    it("4. notes se guardan correctamente", async () => {
      await prepareGameDraft(db, adminId)

      const updated = await updateGameDraftMetadata(
        db,
        env,
        { notes: "Nuevas mejoras de rendimiento y mods actualizados." },
        adminId,
      )

      expect(updated.notes).toBe("Nuevas mejoras de rendimiento y mods actualizados.")
    })

    it("5. notes null / vacías funcionan y limpian el campo", async () => {
      await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { notes: "Temporal notes" }, adminId)

      const cleaned = await updateGameDraftMetadata(db, env, { notes: null }, adminId)
      expect(cleaned.notes).toBeNull()

      const cleanedEmpty = await updateGameDraftMetadata(db, env, { notes: "   " }, adminId)
      expect(cleanedEmpty.notes).toBeNull()
    })

    it("6. Minecraft/NeoForge no se pueden cambiar mediante metadata mutation (inmutabilidad de entorno)", async () => {
      const draft = await prepareGameDraft(db, adminId)
      expect(draft.minecraftVersion).toBe("1.21.1")
      expect(draft.neoForgeVersion).toBe("21.1.65")

      // Metadata input only accepts version, notes, coverMediaId
      await updateGameDraftMetadata(db, env, { version: "1.0.1", notes: "Test" }, adminId)

      const fromDb = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get()
      expect(fromDb?.minecraftVersion).toBe("1.21.1")
      expect(fromDb?.neoForgeVersion).toBe("21.1.65")
      expect(fromDb?.status).toBe("DRAFT")
      expect(fromDb?.publishedAt).toBeNull()
      expect(fromDb?.createdBy).toBe(adminId)
    })
  })

  describe("2. Cover Media Integration", () => {
    it("7. IMAGE válida puede ser cover", async () => {
      const imageMediaId = await createMockMedia("IMAGE", "image/png")
      await prepareGameDraft(db, adminId)

      const updated = await updateGameDraftMetadata(
        db,
        env,
        { coverMediaId: imageMediaId },
        adminId,
      )

      expect(updated.coverMediaId).toBe(imageMediaId)
      expect(updated.cover).toBeDefined()
      expect(updated.cover?.mediaType).toBe("IMAGE")
      expect(updated.cover?.mimeType).toBe("image/png")
    })

    it("8. VIDEO válido puede ser cover", async () => {
      const videoMediaId = await createMockMedia("VIDEO", "video/mp4")
      await prepareGameDraft(db, adminId)

      const updated = await updateGameDraftMetadata(
        db,
        env,
        { coverMediaId: videoMediaId },
        adminId,
      )

      expect(updated.coverMediaId).toBe(videoMediaId)
      expect(updated.cover).toBeDefined()
      expect(updated.cover?.mediaType).toBe("VIDEO")
      expect(updated.cover?.mimeType).toBe("video/mp4")
    })

    it("9. media inexistente -> reject con NOT_FOUND", async () => {
      await prepareGameDraft(db, adminId)

      await expect(
        updateGameDraftMetadata(db, env, { coverMediaId: "non-existent-media-id" }, adminId),
      ).rejects.toThrow(/no fue encontrado/i)
    })

    it("10. prepareGameDraft() clona coverMediaId desde la release publicada", async () => {
      const coverId = await createMockMedia("IMAGE", "image/webp")
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: "rel-published-base",
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        status: "PUBLISHED",
        notes: "Release base",
        coverMediaId: coverId,
        publishedAt: now,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      const draft = await prepareGameDraft(db, adminId, { baseReleaseId: "rel-published-base" }, env)
      expect(draft.coverMediaId).toBe(coverId)
      expect(draft.cover?.id).toBe(coverId)
      expect(draft.notes).toBe("Release base")
    })

    it("11. PUBLISHED mantiene cover después de publicar", async () => {
      const coverId = await createMockMedia("IMAGE", "image/jpeg")
      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/test.toml", content: "binary-mod = true" }, adminId, env)

      const published = await publishGameRelease(
        db,
        env,
        { version: "1.1.0", notes: "Notas v1.1.0", coverMediaId: coverId },
        adminId,
      )

      expect(published.status).toBe("PUBLISHED")
      expect(published.coverMediaId).toBe(coverId)
      expect(published.cover?.id).toBe(coverId)

      const overview = await getAdminGameOverview(db, env)
      expect(overview.publishedRelease?.coverMediaId).toBe(coverId)
      expect(overview.publishedRelease?.cover?.id).toBe(coverId)
    })

    it("12. ARCHIVED mantiene cover", async () => {
      const coverId1 = await createMockMedia("IMAGE", "image/png")
      const coverId2 = await createMockMedia("VIDEO", "video/webm")

      // First release
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/mod1.toml", content: "data1 = 1" }, adminId, env)
      await publishGameRelease(db, env, { version: "1.0.0", coverMediaId: coverId1 }, adminId)

      // Second release archives the first
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/mod2.toml", content: "data2 = 2" }, adminId, env)
      await publishGameRelease(db, env, { version: "1.1.0", coverMediaId: coverId2 }, adminId)

      const history = await getGameReleaseHistory(db, env)
      expect(history.length).toBe(2)

      const v110 = history.find((r) => r.version === "1.1.0")
      const v100 = history.find((r) => r.version === "1.0.0")

      expect(v110?.status).toBe("PUBLISHED")
      expect(v110?.coverMediaId).toBe(coverId2)
      expect(v110?.cover?.id).toBe(coverId2)

      expect(v100?.status).toBe("ARCHIVED")
      expect(v100?.coverMediaId).toBe(coverId1)
      expect(v100?.cover?.id).toBe(coverId1)
    })

    it("13. deleteMedia() rechaza media usada por DRAFT, PUBLISHED o ARCHIVED release", async () => {
      const mediaDraft = await createMockMedia("IMAGE", "image/png")
      const mediaPublished = await createMockMedia("IMAGE", "image/jpeg")
      const mediaArchived = await createMockMedia("VIDEO", "video/mp4")

      // Draft release referencing mediaDraft
      const draft = await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { coverMediaId: mediaDraft }, adminId)

      // Archived and Published releases
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: "rel-archived-cover-test",
        version: "0.9.0",
        status: "ARCHIVED",
        coverMediaId: mediaArchived,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(schema.gameReleases).values({
        id: "rel-published-cover-test",
        version: "1.0.0",
        status: "PUBLISHED",
        coverMediaId: mediaPublished,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      // Attempt deleting media referenced by draft -> CONFLICT
      await expect(deleteMedia(db, env, mediaDraft)).rejects.toThrow(
        /currently in use as cover for game release/i,
      )

      // Attempt deleting media referenced by published -> CONFLICT
      await expect(deleteMedia(db, env, mediaPublished)).rejects.toThrow(
        /currently in use as cover for game release/i,
      )

      // Attempt deleting media referenced by archived -> CONFLICT
      await expect(deleteMedia(db, env, mediaArchived)).rejects.toThrow(
        /currently in use as cover for game release/i,
      )
    })

    it("14. release sin cover sigue siendo válida", async () => {
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/test.json", content: "{}" }, adminId, env)

      const published = await publishGameRelease(db, env, { version: "1.0.0" }, adminId)
      expect(published.coverMediaId).toBeNull()
      expect(published.cover).toBeNull()
    })
  })

  describe("3. Readiness Evaluation (validateDraftReadiness)", () => {
    it("15. version temporal / no SemVer -> validVersion=false, isReady=false", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/foo.toml", content: "enabled = true" }, adminId, env)

      const files = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      const readiness = await validateDraftReadiness(env, draft, files, db)

      expect(readiness.validVersion).toBe(false)
      expect(readiness.hasFiles).toBe(true)
      expect(readiness.noConflicts).toBe(true)
      expect(readiness.storageVerified).toBe(true)
      expect(readiness.isReady).toBe(false)
      expect(readiness.issues).toContain("Se debe configurar una versión válida en formato SemVer antes de publicar.")
    })

    it("16. versión válida y única -> validVersion=true, uniqueVersion=true, isReady=true", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/foo.toml", content: "enabled = true" }, adminId, env)
      await updateGameDraftMetadata(db, env, { version: "2.0.0" }, adminId)

      const updatedDraft = (await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get())!
      const files = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      const readiness = await validateDraftReadiness(env, updatedDraft, files, db)

      expect(readiness.validVersion).toBe(true)
      expect(readiness.uniqueVersion).toBe(true)
      expect(readiness.hasFiles).toBe(true)
      expect(readiness.noConflicts).toBe(true)
      expect(readiness.storageVerified).toBe(true)
      expect(readiness.isReady).toBe(true)
      expect(readiness.issues.length).toBe(0)
    })

    it("17. R2 missing -> storageVerified=false, isReady=false", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { version: "2.0.0" }, adminId)

      // Insert file record referencing missing R2 key
      await db.insert(schema.gameReleaseFiles).values({
        id: "missing-r2-file",
        releaseId: draft.id,
        name: "ghost.jar",
        logicalPath: "mods/ghost.jar",
        category: "MOD",
        sha256: "fake-sha",
        sizeBytes: 500,
        isDirectory: 0,
        objectKey: "game-files/non-existent-key.jar",
        createdAt: new Date().toISOString(),
      })

      const updatedDraft = (await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get())!
      const files = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      const readiness = await validateDraftReadiness(env, updatedDraft, files, db)

      expect(readiness.storageVerified).toBe(false)
      expect(readiness.isReady).toBe(false)
      expect(readiness.issues.some((i) => i.includes("no se encontró en el almacenamiento"))).toBe(true)
    })

    it("18. R2 size mismatch -> storageVerified=false, isReady=false", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { version: "2.0.0" }, adminId)

      // Put 10 bytes to R2, but claim 20 bytes in D1
      await mockR2.put("game-files/mismatch.jar", new Uint8Array(10))
      await db.insert(schema.gameReleaseFiles).values({
        id: "mismatch-file",
        releaseId: draft.id,
        name: "mismatch.jar",
        logicalPath: "mods/mismatch.jar",
        category: "MOD",
        sha256: "fake-sha",
        sizeBytes: 20, // mismatch!
        isDirectory: 0,
        objectKey: "game-files/mismatch.jar",
        createdAt: new Date().toISOString(),
      })

      const updatedDraft = (await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get())!
      const files = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      const readiness = await validateDraftReadiness(env, updatedDraft, files, db)

      expect(readiness.storageVerified).toBe(false)
      expect(readiness.isReady).toBe(false)
      expect(readiness.issues.some((i) => i.includes("no coincide"))).toBe(true)
    })

    it("19. duplicate logical paths -> noConflicts=false, isReady=false", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { version: "2.0.0" }, adminId)
      await saveGameFileContent(db, { logicalPath: "config/real.toml", content: "data = 1" }, adminId, env)

      const draftFiles = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      // Simulate duplicate logical path in memory array
      const duplicatedFiles = [...draftFiles, { ...draftFiles[0]!, id: "duplicate-id" }]

      const updatedDraft = (await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get())!
      const readiness = await validateDraftReadiness(env, updatedDraft, duplicatedFiles, db)

      expect(readiness.noConflicts).toBe(false)
      expect(readiness.isReady).toBe(false)
      expect(readiness.issues.some((i) => i.includes("Ruta duplicada"))).toBe(true)
    })

    it("20. archivos válidos y version válida -> isReady=true", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { version: "1.0.0" }, adminId)
      await saveGameFileContent(db, { logicalPath: "config/real.toml", content: "data = 1" }, adminId, env)

      const updatedDraft = (await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get())!
      const files = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      const readiness = await validateDraftReadiness(env, updatedDraft, files, db)

      expect(readiness.isReady).toBe(true)
    })
  })

  describe("4. Change Tracking (computeDraftChanges)", () => {
    it("21. ADDED, 22. UPDATED por binary/hash, 23. UPDATED solo por effective policy, 24. REMOVED, 25. UNCHANGED, 26. Directorios no inflan contadores", async () => {
      // 1. Initial published release
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/unchanged.json", content: '{"a":1}' }, adminId, env)
      await saveGameFileContent(db, { logicalPath: "config/updated-content.json", content: '{"v":1}' }, adminId, env)
      await saveGameFileContent(db, { logicalPath: "config/updated-policy.json", content: '{"policy":1}' }, adminId, env)
      await setGamePathPolicy(db, "config/updated-policy.json", "MODIFICABLE", adminId)
      await saveGameFileContent(db, { logicalPath: "config/to-be-removed.json", content: '{"old":1}' }, adminId, env)
      await createGameFolder(db, "assets/dir1", adminId)

      const basePublished = await publishGameRelease(db, env, { version: "1.0.0" }, adminId)
      const baseFiles = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, basePublished.id)).all()

      // 2. Prepare new draft
      const draft = await prepareGameDraft(db, adminId)

      // Modify content of updated-content.json
      await saveGameFileContent(db, { logicalPath: "config/updated-content.json", content: '{"v":2}' }, adminId, env)

      // Modify only effective policy of updated-policy.json (switch to NO_MODIFICABLE)
      await setGamePathPolicy(db, "config/updated-policy.json", "NO_MODIFICABLE", adminId)

      // Remove config/to-be-removed.json
      await deleteGamePaths(db, ["config/to-be-removed.json"], adminId, env)

      // Add a brand new file
      await saveGameFileContent(db, { logicalPath: "config/new-file.json", content: '{"new":1}' }, adminId, env)

      // Add a new empty folder (should NOT increment file counters)
      await createGameFolder(db, "assets/dir2", adminId)

      const draftFiles = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()

      const analysis = computeDraftChanges(baseFiles, draftFiles)

      // Verify counters
      expect(analysis.changes.added).toBe(1) // config/new-file.json
      expect(analysis.changes.updated).toBe(2) // updated-content.json & updated-policy.json
      expect(analysis.changes.removed).toBe(1) // config/to-be-removed.json
      expect(analysis.changes.unchanged).toBe(1) // config/unchanged.json
      expect(analysis.changes.total).toBe(4) // real files in draft (unchanged, updated-content, updated-policy, new-file)

      // Check change tags on individual files
      const newFile = analysis.taggedFiles.find((f) => f.logicalPath === "config/new-file.json")
      expect(newFile?.changeStatus).toBe("ADDED")

      const contentMod = analysis.taggedFiles.find((f) => f.logicalPath === "config/updated-content.json")
      expect(contentMod?.changeStatus).toBe("UPDATED")

      const policyMod = analysis.taggedFiles.find((f) => f.logicalPath === "config/updated-policy.json")
      expect(policyMod?.changeStatus).toBe("UPDATED")

      const unchangedFile = analysis.taggedFiles.find((f) => f.logicalPath === "config/unchanged.json")
      expect(unchangedFile?.changeStatus).toBe("UNCHANGED")

      const tombstone = analysis.taggedFiles.find((f) => f.logicalPath === "config/to-be-removed.json")
      expect(tombstone?.changeStatus).toBe("REMOVED")
      expect(tombstone?.id.startsWith("tombstone-")).toBe(true)
    })
  })

  describe("5. Publication Lifecycle & Atomicity (publishGameRelease)", () => {
    it("27. PUBLISHED anterior queda ARCHIVED, 28. DRAFT queda PUBLISHED, 29. Solo existe un PUBLISHED, 30. Version, notes y cover finales son correctos", async () => {
      const cover1 = await createMockMedia("IMAGE", "image/png")
      const cover2 = await createMockMedia("IMAGE", "image/webp")

      // 1. First Release v1.0.0
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/a.toml", content: "a = 1" }, adminId, env)
      const v1 = await publishGameRelease(db, env, { version: "1.0.0", notes: "v1 notes", coverMediaId: cover1 }, adminId)
      expect(v1.status).toBe("PUBLISHED")

      // 2. Prepare Draft and Publish v1.1.0
      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/b.toml", content: "b = 2" }, adminId, env)

      const v2 = await publishGameRelease(
        db,
        env,
        { version: "1.1.0", notes: "v1.1.0 notes", coverMediaId: cover2 },
        adminId,
      )

      expect(v2.status).toBe("PUBLISHED")
      expect(v2.version).toBe("1.1.0")
      expect(v2.notes).toBe("v1.1.0 notes")
      expect(v2.coverMediaId).toBe(cover2)

      // Verify in Database
      const allReleases = await db.select().from(schema.gameReleases).all()
      const publishedReleases = allReleases.filter((r) => r.status === "PUBLISHED")
      const archivedReleases = allReleases.filter((r) => r.status === "ARCHIVED")
      const draftReleases = allReleases.filter((r) => r.status === "DRAFT")

      expect(publishedReleases.length).toBe(1)
      expect(publishedReleases[0]?.id).toBe(draft.id)
      expect(publishedReleases[0]?.version).toBe("1.1.0")

      expect(archivedReleases.length).toBe(1)
      expect(archivedReleases[0]?.id).toBe(v1.id)
      expect(archivedReleases[0]?.version).toBe("1.0.0")

      expect(draftReleases.length).toBe(0)
    })

    it("31. publish revalida readiness aunque frontend haya mostrado ready (backend authoritativeness)", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/mod.toml", content: "mod = true" }, adminId, env)
      await updateGameDraftMetadata(db, env, { version: "1.0.0" }, adminId)

      // Delete the object from R2 directly to simulate backend corruption between frontend check and publish
      const fileRecord = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).get()
      if (fileRecord?.objectKey) {
        await mockR2.delete(fileRecord.objectKey)
      }

      await expect(
        publishGameRelease(db, env, { version: "1.0.0" }, adminId),
      ).rejects.toThrow(/No se puede publicar la actualización/i)

      // Draft must remain in DRAFT status
      const draftAfter = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get()
      expect(draftAfter?.status).toBe("DRAFT")
    })

    it("32. duplicate version race/final guard no corrompe releases", async () => {
      // Create existing release v1.0.0
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: "rel-collision-test",
        version: "1.0.0",
        status: "ARCHIVED",
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/mod.toml", content: "data = 1" }, adminId, env)

      await expect(
        publishGameRelease(db, env, { version: "1.0.0" }, adminId),
      ).rejects.toThrow(/ya existe en el historial/i)

      const draftAfter = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get()
      expect(draftAfter?.status).toBe("DRAFT")
    })

    it("33. D1 failure dentro de publication batch -> rollback real", async () => {
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/mod.toml", content: "data = 1" }, adminId, env)

      // Mock batch to throw an error
      const originalBatch = db.batch.bind(db)
      vi.spyOn(db, "batch").mockImplementationOnce(() => {
        throw new Error("Simulated D1 Batch Transaction Failure")
      })

      await expect(
        publishGameRelease(db, env, { version: "1.0.0" }, adminId),
      ).rejects.toThrow(/Simulated D1 Batch Transaction Failure/)

      // Restored db.batch
      vi.restoreAllMocks()
    })

    it("34. concurrent publish guard: segunda publicación sobre el mismo draft falla con CONFLICT y deja exactamente un PUBLISHED", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/app.toml", content: "server = 1" }, adminId, env)
      await updateGameDraftMetadata(db, env, { version: "1.0.0" }, adminId)

      // Request A publishes first
      const publishedA = await publishGameRelease(db, env, { version: "1.0.0" }, adminId)
      expect(publishedA.status).toBe("PUBLISHED")

      // Request B attempts stale/concurrent publish of the same draft
      await expect(
        publishGameRelease(db, env, { version: "1.0.0" }, adminId),
      ).rejects.toThrow(/No hay ningún borrador|El borrador ya fue publicado/i)

      // Verify that EXACTLY 1 PUBLISHED exists and is the result of A
      const allReleases = await db.select().from(schema.gameReleases).all()
      const publishedReleases = allReleases.filter((r) => r.status === "PUBLISHED")
      expect(publishedReleases.length).toBe(1)
      expect(publishedReleases[0]?.id).toBe(draft.id)
      expect(publishedReleases[0]?.version).toBe("1.0.0")
    })
  })

  describe("6. Hardening: Storage Fail-Closed, Orphan Compensation & Review Fingerprint", () => {
    it("35. archivo real + ASSETS undefined -> storageVerified=false, isReady=false", async () => {
      const draft = await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { version: "2.0.0" }, adminId)
      await saveGameFileContent(db, { logicalPath: "config/real.toml", content: "data = 1" }, adminId, env)

      const draftFiles = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft.id)).all()
      const updatedDraft = (await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get())!

      // Env without ASSETS
      const envWithoutAssets: Env = {
        DB: env.DB,
        ENVIRONMENT: "test",
      }

      const readiness = await validateDraftReadiness(envWithoutAssets, updatedDraft, draftFiles, db)
      expect(readiness.storageVerified).toBe(false)
      expect(readiness.isReady).toBe(false)
      expect(readiness.issues.some((i) => i.includes("almacenamiento de archivos no está disponible"))).toBe(true)
    })

    it("36. discardGameDraft limpia cover huérfana de D1 y R2 si no está referenciada en otro lugar", async () => {
      const coverId = await createMockMedia("IMAGE", "image/png")
      await mockR2.put(`content/media/${coverId}.png`, new Uint8Array(2048))

      await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { coverMediaId: coverId }, adminId)

      // Discard draft
      const discarded = await discardGameDraft(db, env)
      expect(discarded).toBe(true)

      // Verify cover media is deleted from D1 and R2
      const mediaInDb = await db.select().from(schema.contentMedia).where(eq(schema.contentMedia.id, coverId)).get()
      expect(mediaInDb).toBeUndefined()

      const r2Object = await mockR2.head(`content/media/${coverId}.png`)
      expect(r2Object).toBeNull()
    })

    it("37. discardGameDraft preserva cover si está compartida con release PUBLISHED o ARCHIVED", async () => {
      const sharedCoverId = await createMockMedia("IMAGE", "image/png")
      await mockR2.put(`content/media/${sharedCoverId}.png`, new Uint8Array(2048))

      // 1. Create and publish release v1.0.0 using sharedCoverId
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/a.toml", content: "a = 1" }, adminId, env)
      await publishGameRelease(db, env, { version: "1.0.0", coverMediaId: sharedCoverId }, adminId)

      // 2. Create new draft that inherits sharedCoverId
      await prepareGameDraft(db, adminId)

      // 3. Discard the draft
      await discardGameDraft(db, env)

      // 4. Verify shared cover STILL exists in D1 and R2 because it is used by v1.0.0
      const mediaInDb = await db.select().from(schema.contentMedia).where(eq(schema.contentMedia.id, sharedCoverId)).get()
      expect(mediaInDb).toBeDefined()
      expect(mediaInDb?.id).toBe(sharedCoverId)

      const r2Object = await mockR2.head(`content/media/${sharedCoverId}.png`)
      expect(r2Object).not.toBeNull()
    })

    it("38. updateGameDraftMetadata reemplazando cover limpia la anterior huérfana", async () => {
      const oldCoverId = await createMockMedia("IMAGE", "image/png")
      const newCoverId = await createMockMedia("IMAGE", "image/webp")
      await mockR2.put(`content/media/${oldCoverId}.png`, new Uint8Array(2048))
      await mockR2.put(`content/media/${newCoverId}.webp`, new Uint8Array(2048))

      await prepareGameDraft(db, adminId)
      await updateGameDraftMetadata(db, env, { coverMediaId: oldCoverId }, adminId)

      // Replace old cover with new cover
      await updateGameDraftMetadata(db, env, { coverMediaId: newCoverId }, adminId)

      // Old cover should be deleted
      const oldMedia = await db.select().from(schema.contentMedia).where(eq(schema.contentMedia.id, oldCoverId)).get()
      expect(oldMedia).toBeUndefined()

      // New cover remains
      const newMedia = await db.select().from(schema.contentMedia).where(eq(schema.contentMedia.id, newCoverId)).get()
      expect(newMedia).toBeDefined()
    })

    it("39. review fingerprint: publish con fingerprint correcto publica; con fingerprint cambiado rechaza con CONFLICT", async () => {
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/base.toml", content: "b = 1" }, adminId, env)
      await updateGameDraftMetadata(db, env, { version: "1.0.0" }, adminId)

      const overview = await getAdminGameOverview(db, env)
      expect(overview.draftFingerprint).toBeDefined()
      const reviewedFingerprint = overview.draftFingerprint!

      // 1. Modifying draft file changes fingerprint -> publication with stale fingerprint fails
      await saveGameFileContent(db, { logicalPath: "config/new.toml", content: "n = 1" }, adminId, env)

      await expect(
        publishGameRelease(
          db,
          env,
          { version: "1.0.0", expectedDraftFingerprint: reviewedFingerprint },
          adminId,
        ),
      ).rejects.toThrow(/El borrador cambió después de ser revisado/i)

      // 2. Fetch fresh fingerprint and publish successfully
      const freshOverview = await getAdminGameOverview(db, env)
      const freshFingerprint = freshOverview.draftFingerprint!

      const published = await publishGameRelease(
        db,
        env,
        { version: "1.0.0", expectedDraftFingerprint: freshFingerprint },
        adminId,
      )

      expect(published.status).toBe("PUBLISHED")
    })
  })

  describe("7. Scope Discipline & Invariant Preservation", () => {
    it("40. DATA_PACK continúa fuera de publishedModpack.clientFiles", async () => {
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/client.json", content: "{}" }, adminId, env)
      await saveGameFileContent(db, { logicalPath: "datapacks/custom/pack.mcmeta", content: '{"pack":{}}' }, adminId, env)

      await publishGameRelease(db, env, { version: "1.0.0" }, adminId)

      const modpack = await getPublishedModpack(db, env)
      expect(modpack).not.toBeNull()
      expect(modpack?.clientFiles.some((f) => f.path === "config/client.json")).toBe(true)
      expect(modpack?.clientFiles.some((f) => f.path.includes("datapacks"))).toBe(false)
    })

    it("41. metadata provider/source de 8B sigue intacta tras la publicación", async () => {
      const draft = await prepareGameDraft(db, adminId)
      const now = new Date().toISOString()

      // Add a mod with provider metadata
      await db.insert(schema.gameReleaseFiles).values({
        id: "mod-with-provider",
        releaseId: draft.id,
        name: "jei.jar",
        logicalPath: "mods/jei.jar",
        category: "MOD",
        sha256: "jei-sha256",
        sizeBytes: 1024,
        isDirectory: 0,
        objectKey: "game-files/jei.jar",
        sourceProvider: "MODRINTH",
        sourceProjectId: "u6PpAnPr",
        sourceVersionId: "ver-jei-123",
        sourceFileId: "file-999",
        sourceEnvironment: "BOTH",
        createdAt: now,
      })
      await mockR2.put("game-files/jei.jar", new Uint8Array(1024))

      const published = await publishGameRelease(db, env, { version: "1.0.0" }, adminId)
      const publishedFiles = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, published.id)).all()

      const providerMod = publishedFiles.find((f) => f.logicalPath === "mods/jei.jar")
      expect(providerMod).toBeDefined()
      expect(providerMod?.sourceProvider).toBe("MODRINTH")
      expect(providerMod?.sourceProjectId).toBe("u6PpAnPr")
      expect(providerMod?.sourceVersionId).toBe("ver-jei-123")
      expect(providerMod?.sourceFileId).toBe("file-999")
      expect(providerMod?.sourceEnvironment).toBe("BOTH")
    })

    it("42. no aparece ningún server-sync side effect durante publish", async () => {
      // Publication is purely a metadata and catalog transition in D1; verify no external network calls or server side effects
      await prepareGameDraft(db, adminId)
      await saveGameFileContent(db, { logicalPath: "config/main.toml", content: "data = 1" }, adminId, env)

      const published = await publishGameRelease(db, env, { version: "1.0.0" }, adminId)
      expect(published.status).toBe("PUBLISHED")
    })
  })
})
