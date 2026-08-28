import { describe, it, expect, beforeEach } from "vitest"
import { eq } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { createTestR2Bucket } from "../../testUtils/mockR2"
import {
  prepareGameDraft,
  discardGameDraft,
  publishGameRelease,
  getPublishedModpack,
  getAdminGameOverview,
  resolveReleaseEffectivePolicies,
  computeDraftChanges,
  validateDraftReadiness,
} from "./releaseService"
import {
  getAdminGameFiles,
  createGameFileUploadToken,
  addGameFile,
  saveGameFileContent,
  readGameFileContent,
  createGameFolder,
  renameGamePath,
  moveGamePaths,
  copyGamePaths,
  deleteGamePaths,
  setGamePathPolicy,
  restoreGameFile,
  removeGameFile,
} from "./gameFileService"
import { handleGameFileDownload } from "./gameStorageService"
import type { Env } from "../../types"

describe("HiKAT Shard 8A: Game Files Explorer Backend Suite & Hardening", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let mockR2: ReturnType<typeof createTestR2Bucket>
  let env: Env
  const adminId = "admin-test-" + crypto.randomUUID()

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
      displayName: "Admin Explorer Test",
      role: "ADMIN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  it("creates, retrieves, and handles folder records without requiring R2 objects", async () => {
    const draft = await prepareGameDraft(db, adminId)
    expect(draft.status).toBe("DRAFT")

    const folder = await createGameFolder(db, "config/custom_pack", adminId)
    expect(folder.isDirectory).toBe(true)
    expect(folder.logicalPath).toBe("config/custom_pack")
    expect(folder.name).toBe("custom_pack")
    expect(folder.sizeBytes).toBe(0)
    expect(folder.explicitPolicy).toBeNull()
    expect(folder.effectivePolicy).toBe("MODIFICABLE") // Inherits from config/ default
    expect(folder.isInherited).toBe(true)

    // Folder creation is idempotent
    const duplicateFolder = await createGameFolder(db, "config/custom_pack", adminId)
    expect(duplicateFolder.id).toBe(folder.id)

    const allFiles = await getAdminGameFiles(db, draft.id)
    expect(allFiles.some((f) => f.logicalPath === "config/custom_pack" && f.isDirectory)).toBe(true)
  })

  it("saves, validates JSON, and reads text files with 1MB limit", async () => {
    await prepareGameDraft(db, adminId)

    // 1. Save valid JSON config file
    const validJsonContent = JSON.stringify({ key: "value", nested: { num: 42 } }, null, 2)
    const savedJson = await saveGameFileContent(
      db,
      {
        logicalPath: "config/test.json",
        content: validJsonContent,
        explicitPolicy: "MODIFICABLE",
      },
      adminId,
      env,
    )

    expect(savedJson.logicalPath).toBe("config/test.json")
    expect(savedJson.isDirectory).toBe(false)
    expect(savedJson.category).toBe("CONFIG")
    expect(savedJson.explicitPolicy).toBe("MODIFICABLE")
    expect(savedJson.effectivePolicy).toBe("MODIFICABLE")
    expect(savedJson.isInherited).toBe(false)

    // Read back content
    const readContent = await readGameFileContent(db, savedJson.id, env)
    expect(readContent).toBe(validJsonContent)

    // 2. Reject invalid JSON for .json extensions
    await expect(
      saveGameFileContent(
        db,
        {
          logicalPath: "config/broken.json",
          content: "{\n  \"invalid\": true,\n}", // trailing comma syntax error
        },
        adminId,
        env,
      ),
    ).rejects.toThrow(/JSON/)

    // 3. Reject reading directory records as text
    const folder = await createGameFolder(db, "custom_dir", adminId)
    await expect(readGameFileContent(db, folder.id, env)).rejects.toThrow(
      "No se puede leer el contenido de un directorio como texto.",
    )

    // 4. Reject files exceeding 1 MB limit
    const hugeContent = "A".repeat(1024 * 1024 + 5)
    await expect(
      saveGameFileContent(
        db,
        {
          logicalPath: "config/huge.txt",
          content: hugeContent,
        },
        adminId,
        env,
      ),
    ).rejects.toThrow("El archivo de texto excede el límite máximo de edición (1 MB).")
  })

  it("strictly rejects saving text into binary files or overwriting existing binaries", async () => {
    const draft = await prepareGameDraft(db, adminId)

    // 1. Rejects saveGameFileContent on mods/create.jar (0 DB records created, 0 R2 objects persisted)
    await expect(
      saveGameFileContent(
        db,
        {
          logicalPath: "mods/create.jar",
          content: "hello",
        },
        adminId,
        env,
      ),
    ).rejects.toThrow(/binario/i)

    const files = await getAdminGameFiles(db, draft.id)
    expect(files.some((f) => f.logicalPath === "mods/create.jar")).toBe(false)

    // 2. Upload a real jar binary
    await addGameFile(
      db,
      {
        name: "jei.jar",
        logicalPath: "mods/jei.jar",
        category: "MOD",
        tokenHash: "dummy-token",
      },
      adminId,
      env,
      {
        sha256: "aabbccdd11223344",
        sizeBytes: 50000,
        objectKey: "game-files/jei-bin-1",
        originalFilename: "jei.jar",
      },
    )

    // Attempting to overwrite existing jar with text save must fail
    await expect(
      saveGameFileContent(
        db,
        {
          logicalPath: "mods/jei.jar",
          content: "corrupted text",
        },
        adminId,
        env,
      ),
    ).rejects.toThrow(/binario/i)
  })

  it("enforces filesystem tree invariants: file as ancestor and type collisions", async () => {
    await prepareGameDraft(db, adminId)

    // 1. Create a file 'config/settings.txt'
    await saveGameFileContent(
      db,
      { logicalPath: "config/settings.txt", content: "theme=dark" },
      adminId,
      env,
    )

    // 2. Attempting to create a file inside 'config/settings.txt/child.txt' must fail
    await expect(
      saveGameFileContent(
        db,
        { logicalPath: "config/settings.txt/child.txt", content: "bad" },
        adminId,
        env,
      ),
    ).rejects.toThrow(/no puede contener/i)

    // 3. Attempting to create a folder over existing file must fail
    await expect(createGameFolder(db, "config/settings.txt", adminId)).rejects.toThrow(/ya existe un archivo/i)

    // 4. Create directory 'config/extra_folder.txt'
    await createGameFolder(db, "config/extra_folder.txt", adminId)

    // 5. Attempting to save a text file with exact same path as folder must fail
    await expect(
      saveGameFileContent(
        db,
        { logicalPath: "config/extra_folder.txt", content: "not a folder" },
        adminId,
        env,
      ),
    ).rejects.toThrow(/sobre una carpeta/i)
  })

  it("executes move, rename, and copy all-or-nothing without partial mutations on collision", async () => {
    await prepareGameDraft(db, adminId)

    await createGameFolder(db, "src_folder", adminId)
    await saveGameFileContent(db, { logicalPath: "src_folder/f1.txt", content: "1" }, adminId, env)
    await saveGameFileContent(db, { logicalPath: "src_folder/f2.txt", content: "2" }, adminId, env)

    await createGameFolder(db, "dest_folder", adminId)
    await saveGameFileContent(db, { logicalPath: "dest_folder/f2.txt", content: "existing" }, adminId, env)

    // Moving src_folder/f1.txt and src_folder/f2.txt into dest_folder should detect collision with f2.txt and fail
    await expect(
      moveGamePaths(db, ["src_folder/f1.txt", "src_folder/f2.txt"], "dest_folder", adminId),
    ).rejects.toThrow(/Ya existe un elemento en la ruta de destino/i)

    // Verify 0 changes occurred (f1.txt was NOT partially moved!)
    const files = await getAdminGameFiles(db)
    expect(files.some((f) => f.logicalPath === "src_folder/f1.txt")).toBe(true)
    expect(files.some((f) => f.logicalPath === "dest_folder/f1.txt")).toBe(false)

    // Cannot move or copy a folder inside itself or its subfolders
    await expect(moveGamePaths(db, ["src_folder"], "src_folder/sub", adminId)).rejects.toThrow(
      /dentro de sí misma/i,
    )
    await expect(copyGamePaths(db, ["src_folder"], "src_folder", adminId)).rejects.toThrow(
      /dentro de sí misma/i,
    )
  })

  it("handles path rename, recursive child rename, move, copy, and deletion", async () => {
    await prepareGameDraft(db, adminId)

    // Create a tree: folder/file1.txt and folder/sub/file2.txt
    await createGameFolder(db, "folder", adminId)
    await saveGameFileContent(db, { logicalPath: "folder/file1.txt", content: "file 1" }, adminId, env)
    await saveGameFileContent(db, { logicalPath: "folder/sub/file2.txt", content: "file 2" }, adminId, env)

    // Rename folder -> renamed_folder
    await renameGamePath(db, "folder", "renamed_folder", adminId)

    let files = await getAdminGameFiles(db)
    const paths = files.map((f) => f.logicalPath)
    expect(paths).toContain("renamed_folder")
    expect(paths).toContain("renamed_folder/file1.txt")
    expect(paths).toContain("renamed_folder/sub/file2.txt")
    expect(paths).not.toContain("folder")
    expect(paths).not.toContain("folder/file1.txt")

    // Copy file
    await copyGamePaths(db, ["renamed_folder/file1.txt"], "renamed_folder", adminId)
    files = await getAdminGameFiles(db)
    expect(files.map((f) => f.logicalPath)).toContain("renamed_folder/file1-copia.txt")

    // Move file into subfolder
    await moveGamePaths(db, ["renamed_folder/file1-copia.txt"], "renamed_folder/sub", adminId)
    files = await getAdminGameFiles(db)
    expect(files.map((f) => f.logicalPath)).toContain("renamed_folder/sub/file1-copia.txt")

    // Delete folder tree
    await deleteGamePaths(db, ["renamed_folder"], adminId, env)
    files = await getAdminGameFiles(db)
    expect(files.filter((f) => f.logicalPath.startsWith("renamed_folder")).length).toBe(0)
  })

  it("ensures mutation return consistency for effective policy across the release tree", async () => {
    await prepareGameDraft(db, adminId)

    // Set explicit NO_MODIFICABLE on config/protected folder
    await createGameFolder(db, "config/protected", adminId)
    await setGamePathPolicy(db, "config/protected", "NO_MODIFICABLE", adminId)

    // Save a new text file inside config/protected/test.toml with null policy
    const result = await saveGameFileContent(
      db,
      {
        logicalPath: "config/protected/test.toml",
        content: "key = true",
      },
      adminId,
      env,
    )

    // Response must return effective policy resolved from tree
    expect(result.explicitPolicy).toBeNull()
    expect(result.effectivePolicy).toBe("NO_MODIFICABLE")
    expect(result.isInherited).toBe(true)
  })

  it("handles tombstones and recursive folder restoration", async () => {
    // 1. Publish v1 with a folder and multiple files
    await prepareGameDraft(db, adminId)
    await createGameFolder(db, "scripts/utils", adminId)
    await saveGameFileContent(db, { logicalPath: "scripts/utils/a.js", content: "console.log('a')" }, adminId, env)
    await saveGameFileContent(db, { logicalPath: "scripts/utils/b.js", content: "console.log('b')" }, adminId, env)

    const published = await publishGameRelease(
      db,
      env,
      { version: "1.0.0", notes: "Release 1" },
      adminId,
    )
    expect(published.status).toBe("PUBLISHED")

    // 2. Prepare new draft and delete scripts/utils
    await prepareGameDraft(db, adminId)
    await deleteGamePaths(db, ["scripts/utils"], adminId, env)

    const overview = await getAdminGameOverview(db, env)
    expect(overview.pendingChangesCount).toBeGreaterThanOrEqual(2)

    // Setting policy on a removed path must fail
    await expect(setGamePathPolicy(db, "scripts/utils/a.js", "MODIFICABLE", adminId)).rejects.toThrow(
      /eliminado/i,
    )

    // 3. Restore the folder 'scripts/utils' -> restores the folder AND all its published children!
    const publishedFolder = (await getAdminGameFiles(db, published.id)).find((f) => f.logicalPath === "scripts/utils")!
    const restored = await restoreGameFile(db, `tombstone-${publishedFolder.id}`, adminId)
    expect(restored.logicalPath).toBe("scripts/utils")

    const draftFiles = await getAdminGameFiles(db)
    const draftPaths = draftFiles.map((f) => f.logicalPath)
    expect(draftPaths).toContain("scripts/utils")
    expect(draftPaths).toContain("scripts/utils/a.js")
    expect(draftPaths).toContain("scripts/utils/b.js")
  })

  it("safely cleans up draft-exclusive R2 orphans while preserving published objects", async () => {
    // 1. Publish v1 with a file
    await prepareGameDraft(db, adminId)
    const pubFile = await saveGameFileContent(
      db,
      { logicalPath: "config/initial.toml", content: "version = 1" },
      adminId,
      env,
    )
    await publishGameRelease(db, env, { version: "1.0.0" }, adminId)

    // Get the objectKey of the published file
    const pubRecord = (await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.logicalPath, "config/initial.toml")).all())[0]!
    const pubObjectKey = pubRecord.objectKey
    expect(await mockR2.get(pubObjectKey)).toBeDefined()

    // 2. In new draft, replace config/initial.toml
    await prepareGameDraft(db, adminId)
    const updatedDraftFile = await saveGameFileContent(
      db,
      { logicalPath: "config/initial.toml", content: "version = 2" },
      adminId,
      env,
    )
    const draftObjectKey = (await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.id, updatedDraftFile.id)).get())!.objectKey

    // The published object MUST NOT be deleted because v1.0.0 still references it!
    expect(await mockR2.get(pubObjectKey)).toBeDefined()
    expect(await mockR2.get(draftObjectKey)).toBeDefined()

    // 3. Edit text repeatedly in draft: draftObjectKey should be replaced and cleaned up
    const finalDraftFile = await saveGameFileContent(
      db,
      { logicalPath: "config/initial.toml", content: "version = 3" },
      adminId,
      env,
    )
    const finalObjectKey = (await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.id, finalDraftFile.id)).get())!.objectKey

    // draftObjectKey was exclusive to the draft and replaced -> must be deleted from R2
    expect(await mockR2.get(draftObjectKey)).toBeNull()
    expect(await mockR2.get(finalObjectKey)).toBeDefined()

    // 4. Discard draft -> finalObjectKey (exclusive to draft) must be deleted; pubObjectKey must stay intact!
    await discardGameDraft(db, env)
    expect(await mockR2.get(finalObjectKey)).toBeNull()
    expect(await mockR2.get(pubObjectKey)).toBeDefined()
  })

  it("validates readiness: empty folders without R2 do not block readiness, but only-folders fail", async () => {
    const draft = await prepareGameDraft(db, adminId)

    // 1. Draft with ONLY a folder -> readiness must fail
    await createGameFolder(db, "empty_dir", adminId)
    let files = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    let readiness = await validateDraftReadiness(env, draft, files)
    expect(readiness.isReady).toBe(false)
    expect(readiness.issues).toContain("El borrador no contiene ningún archivo o mod descargable.")

    // 2. Add a real downloadable file -> readiness passes without checking R2 for the empty folder
    await saveGameFileContent(db, { logicalPath: "config/main.toml", content: "enabled = true" }, adminId, env)

    files = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    readiness = await validateDraftReadiness(env, draft, files)
    expect(readiness.isReady).toBe(true)
    expect(readiness.storageVerified).toBe(true)
    expect(readiness.issues.length).toBe(0)
  })

  it("manifest contract: publishedModpack strictly excludes directory records and download route rejects folders", async () => {
    await prepareGameDraft(db, adminId)
    await createGameFolder(db, "assets/custom", adminId)
    await saveGameFileContent(db, { logicalPath: "assets/custom/readme.txt", content: "Hello HiKAT" }, adminId, env)

    // Publish release v1.0.0
    const published = await publishGameRelease(
      db,
      env,
      { version: "1.0.0", notes: "Initial Release" },
      adminId,
    )
    expect(published.status).toBe("PUBLISHED")

    // Check published modpack
    const modpack = await getPublishedModpack(db, env)
    expect(modpack).not.toBeNull()
    expect(modpack!.clientFiles.length).toBe(1)
    expect(modpack!.clientFiles[0]!.path).toBe("assets/custom/readme.txt")
    expect(modpack!.clientFiles.some((f) => f.path === "assets/custom")).toBe(false)

    // Verify download endpoint rejects directory record
    const allPublishedFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, published.id))
      .all()

    const folderRecord = allPublishedFiles.find((f) => f.isDirectory)!
    const fileRecord = allPublishedFiles.find((f) => !f.isDirectory)!

    const folderReq = new Request(`http://localhost/game/download/${folderRecord.id}`)
    const folderRes = await handleGameFileDownload(folderReq, env, db, folderRecord.id)
    expect(folderRes.status).toBe(404)

    const fileReq = new Request(`http://localhost/game/download/${fileRecord.id}`)
    const fileRes = await handleGameFileDownload(fileReq, env, db, fileRecord.id)
    expect(fileRes.status).toBe(200)
    const text = await fileRes.text()
    expect(text).toBe("Hello HiKAT")
  })
})
