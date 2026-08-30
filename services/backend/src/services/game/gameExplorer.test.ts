import { describe, it, expect, beforeEach, vi } from "vitest"
import { eq } from "drizzle-orm"
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
  resolveReleaseEffectivePolicies,
  computeDraftChanges,
  validateDraftReadiness,
} from "./releaseService"
import {
  getAdminGameFiles,
  createGameFileUploadToken,
  addGameFile,
  updateGameFile,
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
import { handleGameFileDownload, handleGameFileUpload } from "./gameStorageService"
import type { Env, BackendGraphQLContext } from "../../types"

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

    // 2. Add a real downloadable file and set valid version -> readiness passes
    await saveGameFileContent(db, { logicalPath: "config/main.toml", content: "enabled = true" }, adminId, env)
    await updateGameDraftMetadata(db, env, { version: "1.0.0" }, adminId)

    const updatedDraft = (await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.id, draft.id))
      .get())!

    files = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    readiness = await validateDraftReadiness(env, updatedDraft, files, db)
    expect(readiness.isReady).toBe(true)
    expect(readiness.validVersion).toBe(true)
    expect(readiness.uniqueVersion).toBe(true)
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

  it("handles atomic rollback on batch execution failure (simulated D1 batch error)", async () => {
    await prepareGameDraft(db, adminId)
    await createGameFolder(db, "atomic_src", adminId)
    await saveGameFileContent(db, { logicalPath: "atomic_src/f1.txt", content: "f1" }, adminId, env)
    await saveGameFileContent(db, { logicalPath: "atomic_src/f2.txt", content: "f2" }, adminId, env)

    // Mock db.batch to throw during execution
    const originalBatch = (db as any).batch
    ;(db as any).batch = vi.fn().mockRejectedValue(new Error("SIMULATED_D1_BATCH_ERROR"))

    await expect(
      moveGamePaths(db, ["atomic_src/f1.txt", "atomic_src/f2.txt"], "atomic_dest", adminId),
    ).rejects.toThrow("SIMULATED_D1_BATCH_ERROR")

    // Restore original batch
    ;(db as any).batch = originalBatch

    // Verify 0 changes occurred: both files still exist in atomic_src/ and NOT in atomic_dest/
    const files = await getAdminGameFiles(db)
    const paths = files.map((f) => f.logicalPath)
    expect(paths).toContain("atomic_src/f1.txt")
    expect(paths).toContain("atomic_src/f2.txt")
    expect(paths).not.toContain("atomic_dest/f1.txt")
    expect(paths).not.toContain("atomic_dest/f2.txt")
  })

  it("rejects planned duplicate copy targets before executing any inserts", async () => {
    await prepareGameDraft(db, adminId)
    await createGameFolder(db, "dir_a", adminId)
    await createGameFolder(db, "dir_b", adminId)
    await createGameFolder(db, "dest_dir", adminId)

    await saveGameFileContent(db, { logicalPath: "dir_a/foo.txt", content: "from a" }, adminId, env)
    await saveGameFileContent(db, { logicalPath: "dir_b/foo.txt", content: "from b" }, adminId, env)

    // Copying dir_a/foo.txt and dir_b/foo.txt into dest_dir would both target dest_dir/foo.txt
    await expect(
      copyGamePaths(db, ["dir_a/foo.txt", "dir_b/foo.txt"], "dest_dir", adminId),
    ).rejects.toThrow(/múltiples elementos intentan ocupar la misma ruta de destino/i)

    // Verify 0 inserts occurred in dest_dir
    const files = await getAdminGameFiles(db)
    expect(files.some((f) => f.logicalPath.startsWith("dest_dir/"))).toBe(false)
  })

  it("supports UTF-8 text in extensionless files and custom extensions, while rejecting binaries", async () => {
    await prepareGameDraft(db, adminId)

    // 1. Extensionless file containing valid UTF-8
    const extless = await saveGameFileContent(
      db,
      { logicalPath: "custom_conf", content: "key=value\nmode=strict" },
      adminId,
      env,
    )
    expect(extless.logicalPath).toBe("custom_conf")

    const extlessRead = await readGameFileContent(db, extless.id, env)
    expect(extlessRead).toBe("key=value\nmode=strict")

    // 2. Custom extension file (.customconfig) containing UTF-8
    const customExt = await saveGameFileContent(
      db,
      { logicalPath: "config/settings.customconfig", content: "{\"custom\": 123}" },
      adminId,
      env,
    )
    expect(customExt.logicalPath).toBe("config/settings.customconfig")

    const customRead = await readGameFileContent(db, customExt.id, env)
    expect(customRead).toBe("{\"custom\": 123}")

    // 3. Binary payload uploaded with unknown extension -> reading as text must fail
    const binBytes = new Uint8Array([0x00, 0xff, 0xfe, 0x00, 0x12, 0x34])
    await mockR2.put("game-files/binary-unknown-1", binBytes)
    const binFile = await addGameFile(
      db,
      { name: "data.unknown_bin", logicalPath: "data.unknown_bin", tokenHash: "token-bin-1" },
      adminId,
      env,
      {
        sha256: "binhash123",
        sizeBytes: binBytes.length,
        objectKey: "game-files/binary-unknown-1",
        originalFilename: "data.unknown_bin",
      },
    )

    await expect(readGameFileContent(db, binFile.id, env)).rejects.toThrow(
      /contiene datos binarios no editables/i,
    )

    // 4. .jar file is rejected immediately on save and read
    await expect(
      saveGameFileContent(db, { logicalPath: "mods/example.jar", content: "not a jar" }, adminId, env),
    ).rejects.toThrow(/binario/i)
  })

  it("compensates and cleans up unassociated R2 uploads if addGameFile or updateGameFile fails", async () => {
    await prepareGameDraft(db, adminId)
    await saveGameFileContent(db, { logicalPath: "config/config.txt", content: "existing" }, adminId, env)

    // 1. Put unassociated object in R2
    const orphanKey = "game-files/unassociated-upload-1"
    await mockR2.put(orphanKey, new TextEncoder().encode("orphan payload"))
    expect(await mockR2.get(orphanKey)).toBeDefined()

    // 2. Call addGameFile with tree hierarchy violation (creating a child inside a file config.txt/child.txt)
    await expect(
      addGameFile(
        db,
        { name: "child.txt", logicalPath: "config/config.txt/child.txt", tokenHash: "orphan-tok" },
        adminId,
        env,
        {
          sha256: "somehash",
          sizeBytes: 20,
          objectKey: orphanKey,
          originalFilename: "child.txt",
        },
      ),
    ).rejects.toThrow(/no puede contener/i)

    // 3. Verify compensation cleaned up the orphan object from R2!
    expect(await mockR2.get(orphanKey)).toBeNull()

    // 4. If the objectKey is already referenced by a published release, compensation must NEVER delete it
    const sharedKey = "game-files/shared-published-key"
    await mockR2.put(sharedKey, new TextEncoder().encode("shared payload"))
    const published = await publishGameRelease(db, env, { version: "1.1.0" }, adminId)
    await db.insert(schema.gameReleaseFiles).values({
      id: crypto.randomUUID(),
      releaseId: published.id,
      name: "shared.txt",
      logicalPath: "shared.txt",
      category: "CONFIG",
      sha256: "sharedhash",
      sizeBytes: 30,
      isDirectory: 0,
      objectKey: sharedKey,
      createdAt: new Date().toISOString(),
    })

    // Now attempt addGameFile in new draft using sharedKey with tree collision
    await prepareGameDraft(db, adminId)
    await expect(
      addGameFile(
        db,
        { name: "bad.txt", logicalPath: "config/config.txt/bad.txt", tokenHash: "shared-tok" },
        adminId,
        env,
        {
          sha256: "sharedhash",
          sizeBytes: 30,
          objectKey: sharedKey,
          originalFilename: "bad.txt",
        },
      ),
    ).rejects.toThrow(/no puede contener/i)

    // Shared object must still exist in R2!
    expect(await mockR2.get(sharedKey)).toBeDefined()
  })

  it("handles token lifecycle: consuming on success and forbidding reuse (Requirement A & B)", async () => {
    await prepareGameDraft(db, adminId)

    // 1. Create token and perform R2 upload
    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "mymod.jar", sizeBytes: 100, logicalPath: "mods/mymod.jar" },
      adminId,
    )

    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: {
          userId: adminId,
          role: "ADMIN",
          sessionId: "sess-1",
          displayName: "Admin",
          tokenPayload: {} as any,
        },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: {
        "X-Upload-Token": ticket.uploadToken,
        "Content-Type": "application/java-archive",
      },
      body: jarContent,
    })

    const uploadRes = await handleGameFileUpload(uploadReq, env, db, context)
    expect(uploadRes.status).toBe(200)

    // 2. Attach successfully to draft
    const added = await addGameFile(
      db,
      { name: "mymod.jar", logicalPath: "mods/mymod.jar", tokenHash },
      adminId,
      env,
    )
    expect(added.logicalPath).toBe("mods/mymod.jar")

    // 3. Attempting to reuse the same tokenHash must fail because token was consumed
    await expect(
      addGameFile(
        db,
        { name: "reused.jar", logicalPath: "mods/reused.jar", tokenHash },
        adminId,
        env,
      ),
    ).rejects.toThrow(/token es inválido|ya fue utilizado/i)

    // Verify token row was deleted from D1
    const tokenInDb = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get()
    expect(tokenInDb).toBeUndefined()
  })

  it("handles token lifecycle: PUT completed then addGameFile with invalid name purges R2, invalidates token and creates no file (Requirement A)", async () => {
    await prepareGameDraft(db, adminId)

    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "badname.jar", sizeBytes: 100, logicalPath: "mods/badname.jar", category: "MOD" },
      adminId,
    )
    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: { userId: adminId, role: "ADMIN", sessionId: "sess-a", displayName: "Admin", tokenPayload: {} as any },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent,
    })
    await handleGameFileUpload(uploadReq, env, db, context)

    const tokenRec = (await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get())!
    const objectKey = tokenRec.objectKey!
    expect(await mockR2.get(objectKey)).toBeDefined()

    // Call addGameFile with invalid empty name
    await expect(
      addGameFile(
        db,
        { name: "   ", logicalPath: "mods/badname.jar", tokenHash },
        adminId,
        env,
      ),
    ).rejects.toThrow(/nombre.*obligatorio/i)

    // 1. R2 object is compensated / purged
    expect(await mockR2.get(objectKey)).toBeNull()

    // 2. Token is deleted / inutilized
    const tokenAfter = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get()
    expect(tokenAfter).toBeUndefined()

    // 3. No new game_release_file created
    const files = await getAdminGameFiles(db)
    expect(files.some((f) => f.logicalPath === "mods/badname.jar")).toBe(false)
  })

  it("handles token lifecycle: failed addGameFile purges R2 and invalidates token (Requirements A & B)", async () => {
    await prepareGameDraft(db, adminId)
    await saveGameFileContent(db, { logicalPath: "config/settings.txt", content: "conf" }, adminId, env)

    // 1. Create upload ticket and complete PUT
    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "failmod.jar", sizeBytes: 100, logicalPath: "mods/failmod.jar", category: "MOD" },
      adminId,
    )

    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: {
          userId: adminId,
          role: "ADMIN",
          sessionId: "sess-2",
          displayName: "Admin",
          tokenPayload: {} as any,
        },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: {
        "X-Upload-Token": ticket.uploadToken,
        "Content-Type": "application/java-archive",
      },
      body: jarContent,
    })

    const uploadRes = await handleGameFileUpload(uploadReq, env, db, context)
    expect(uploadRes.status).toBe(200)

    const tokenRecordBefore = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get()
    const objectKey = tokenRecordBefore!.objectKey!
    expect(await mockR2.get(objectKey)).toBeDefined()

    // 2. Call addGameFile with tree collision (putting a file inside a file path: config/settings.txt/sub.jar)
    await expect(
      addGameFile(
        db,
        { name: "sub.jar", logicalPath: "config/settings.txt/sub.jar", tokenHash },
        adminId,
        env,
      ),
    ).rejects.toThrow(/no puede contener/i)

    // 3. Verify compensation: R2 object purged AND token invalidated/deleted
    expect(await mockR2.get(objectKey)).toBeNull()
    const tokenRecordAfter = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get()
    expect(tokenRecordAfter).toBeUndefined()

    // 4. Reusing tokenHash must fail and never create a game_release_file
    await expect(
      addGameFile(
        db,
        { name: "retry.jar", logicalPath: "mods/retry.jar", tokenHash },
        adminId,
        env,
      ),
    ).rejects.toThrow(/token es inválido|ya fue utilizado/i)

    const files = await getAdminGameFiles(db)
    expect(files.some((f) => f.logicalPath === "mods/retry.jar")).toBe(false)
  })

  it("fails addGameFile if token cannot be claimed and never creates file or returns success (Requirement B)", async () => {
    await prepareGameDraft(db, adminId)

    // 1. Non-existent / already used tokenHash
    await expect(
      addGameFile(
        db,
        { name: "unclaimed.jar", logicalPath: "mods/unclaimed.jar", tokenHash: "non-existent-hash" },
        adminId,
        env,
      ),
    ).rejects.toThrow(/token es inválido|ya fue utilizado/i)

    // 2. Token exists in D1 but was never uploaded (usedAt IS NULL)
    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "unused.jar", sizeBytes: 100, logicalPath: "mods/unused.jar", category: "MOD" },
      adminId,
    )
    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const unusedHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    await expect(
      addGameFile(
        db,
        { name: "unused.jar", logicalPath: "mods/unused.jar", tokenHash: unusedHash },
        adminId,
        env,
      ),
    ).rejects.toThrow(/token es inválido|ya fue utilizado/i)

    const files = await getAdminGameFiles(db)
    expect(files.some((f) => f.logicalPath === "mods/unclaimed.jar" || f.logicalPath === "mods/unused.jar")).toBe(false)
  })

  it("handles token lifecycle: failed updateGameFile purges new R2 and preserves previous file (Requirement C)", async () => {
    await prepareGameDraft(db, adminId)
    // Create initial file
    const initialFile = await saveGameFileContent(
      db,
      { logicalPath: "config/test.txt", content: "initial content" },
      adminId,
      env,
    )
    const oldObjectKey = (await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, initialFile.id))
      .get())!.objectKey

    // Upload new binary with token
    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "test.jar", sizeBytes: 100, logicalPath: "mods/test.jar", category: "MOD" },
      adminId,
    )
    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: { userId: adminId, role: "ADMIN", sessionId: "sess-c", displayName: "Admin", tokenPayload: {} as any },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent,
    })
    await handleGameFileUpload(uploadReq, env, db, context)

    const tokenRec = (await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get())!
    const newObjectKey = tokenRec.objectKey!
    expect(await mockR2.get(newObjectKey)).toBeDefined()

    // updateGameFile with invalid empty name
    await expect(
      updateGameFile(
        db,
        initialFile.id,
        { name: "   ", tokenHash },
        env,
      ),
    ).rejects.toThrow(/nombre no puede estar vacío/i)

    // New R2 object must be purged
    expect(await mockR2.get(newObjectKey)).toBeNull()
    // Old R2 object must remain untouched!
    expect(await mockR2.get(oldObjectKey)).toBeDefined()

    // File in draft remains intact pointing to oldObjectKey
    const fileAfter = (await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, initialFile.id))
      .get())!
    expect(fileAfter.objectKey).toBe(oldObjectKey)
  })

  it("compensates R2 upload if D1 token update fails during handleGameFileUpload (Requirement C & I)", async () => {
    // 1. Create upload ticket
    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "broken.jar", sizeBytes: 100, logicalPath: "mods/broken.jar", category: "MOD" },
      adminId,
    )

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: {
          userId: adminId,
          role: "ADMIN",
          sessionId: "sess-3",
          displayName: "Admin",
          tokenPayload: {} as any,
        },
      },
    }

    // Intercept mockR2.put to capture the exact generated objectKey
    let createdObjectKey: string | undefined
    const originalPut = mockR2.put.bind(mockR2)
    vi.spyOn(mockR2, "put").mockImplementation(async (key, value, options) => {
      createdObjectKey = key
      return originalPut(key, value, options)
    })

    // Mock db.update on gameFileUploadTokens to simulate a sudden D1 failure
    const originalUpdate = db.update.bind(db)
    const updateSpy = vi.spyOn(db, "update").mockImplementation((table: any) => {
      if (table === schema.gameFileUploadTokens) {
        return {
          set: () => ({
            where: () => ({
              returning: () => ({
                get: () => Promise.reject(new Error("Simulated D1 token update failure")),
              }),
            }),
          }),
        } as any
      }
      return originalUpdate(table)
    })

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: {
        "X-Upload-Token": ticket.uploadToken,
        "Content-Type": "application/java-archive",
      },
      body: jarContent,
    })

    await expect(handleGameFileUpload(uploadReq, env, db, context)).rejects.toThrow(
      /Simulated D1 token update failure/i,
    )

    updateSpy.mockRestore()

    // Verify exact objectKey was purged by compensation
    expect(createdObjectKey).toBeDefined()
    expect(await mockR2.get(createdObjectKey!)).toBeNull()
  })

  it("handles D1 insert failure in addGameFile by purging R2, invalidating token and verifying logicalPath is absent (Requirement F & D)", async () => {
    await prepareGameDraft(db, adminId)

    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "insert_fail.jar", sizeBytes: 100, logicalPath: "mods/insert_fail.jar", category: "MOD" },
      adminId,
    )
    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: { userId: adminId, role: "ADMIN", sessionId: "sess-d", displayName: "Admin", tokenPayload: {} as any },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent,
    })
    await handleGameFileUpload(uploadReq, env, db, context)

    const tokenRec = (await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get())!
    const objectKey = tokenRec.objectKey!
    expect(await mockR2.get(objectKey)).toBeDefined()

    // Simulate D1 insert failure on gameReleaseFiles
    const origInsert = db.insert.bind(db)
    const insertSpy = vi.spyOn(db, "insert").mockImplementation((table: any) => {
      if (table === schema.gameReleaseFiles) {
        return {
          values: () => Promise.reject(new Error("Simulated D1 release file insert failure")),
        } as any
      }
      return origInsert(table)
    })

    await expect(
      addGameFile(
        db,
        { name: "insert_fail.jar", logicalPath: "mods/insert_fail.jar", tokenHash },
        adminId,
        env,
      ),
    ).rejects.toThrow(/Simulated D1 release file insert failure/i)

    insertSpy.mockRestore()

    // R2 object must be purged
    expect(await mockR2.get(objectKey)).toBeNull()

    // Token must be gone
    const tokenAfter = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get()
    expect(tokenAfter).toBeUndefined()

    // Logical path must NOT exist in game_release_files
    const allFiles = await db.select().from(schema.gameReleaseFiles).all()
    expect(allFiles.some((f) => f.logicalPath === "mods/insert_fail.jar")).toBe(false)
  })

  it("handles D1 update failure in updateGameFile by purging new R2 and preserving existing file untouched (Requirement E)", async () => {
    await prepareGameDraft(db, adminId)
    const initial = await saveGameFileContent(db, { logicalPath: "config/stay.txt", content: "old content" }, adminId, env)
    const originalRecord = (await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.id, initial.id)).get())!

    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "stay.jar", sizeBytes: 100, logicalPath: "mods/stay.jar", category: "MOD" },
      adminId,
    )
    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: { userId: adminId, role: "ADMIN", sessionId: "sess-e", displayName: "Admin", tokenPayload: {} as any },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent,
    })
    await handleGameFileUpload(uploadReq, env, db, context)

    const tokenRec = (await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get())!
    const newObjectKey = tokenRec.objectKey!

    // Simulate D1 update failure on gameReleaseFiles
    const origUpdate = db.update.bind(db)
    const updateSpy = vi.spyOn(db, "update").mockImplementation((table: any) => {
      if (table === schema.gameReleaseFiles) {
        return {
          set: () => ({
            where: () => Promise.reject(new Error("Simulated D1 update failure on gameReleaseFiles")),
          }),
        } as any
      }
      return origUpdate(table)
    })

    await expect(
      updateGameFile(
        db,
        initial.id,
        { name: "stay.txt", tokenHash },
        env,
      ),
    ).rejects.toThrow(/Simulated D1 update failure/i)

    updateSpy.mockRestore()

    // New object purged, old object preserved
    expect(await mockR2.get(newObjectKey)).toBeNull()
    expect(await mockR2.get(originalRecord.objectKey)).toBeDefined()

    // Reread file record: sha256/size/path/objectKey/name must be completely untouched
    const fileAfter = (await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, initial.id))
      .get())!
    expect(fileAfter.objectKey).toBe(originalRecord.objectKey)
    expect(fileAfter.sha256).toBe(originalRecord.sha256)
    expect(fileAfter.sizeBytes).toBe(originalRecord.sizeBytes)
    expect(fileAfter.name).toBe(originalRecord.name)
    expect(fileAfter.logicalPath).toBe(originalRecord.logicalPath)
  })

  it("handles concurrent attachment race: exactly one request claims token and exactly one file exists (Requirement D & F)", async () => {
    await prepareGameDraft(db, adminId)

    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "race.jar", sizeBytes: 100, logicalPath: "mods/race.jar", category: "MOD" },
      adminId,
    )
    const rawTokenBytes = new Uint8Array(
      ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    )
    const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const jarContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: { userId: adminId, role: "ADMIN", sessionId: "sess-f", displayName: "Admin", tokenPayload: {} as any },
      },
    }

    const uploadReq = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent,
    })
    await handleGameFileUpload(uploadReq, env, db, context)

    // Run 2 concurrent addGameFile calls with identical tokenHash
    const results = await Promise.allSettled([
      addGameFile(db, { name: "race1.jar", logicalPath: "mods/race1.jar", tokenHash }, adminId, env),
      addGameFile(db, { name: "race2.jar", logicalPath: "mods/race2.jar", tokenHash }, adminId, env),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")

    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/token es inválido|ya fue utilizado/i)

    // Exactly one game_release_file exists of the two candidates
    const files = await getAdminGameFiles(db)
    const race1Exists = files.some((f) => f.logicalPath === "mods/race1.jar")
    const race2Exists = files.some((f) => f.logicalPath === "mods/race2.jar")
    expect(Number(race1Exists) + Number(race2Exists)).toBe(1)

    // Token no longer exists in D1
    const tokenAfter = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
      .get()
    expect(tokenAfter).toBeUndefined()
  })

  it("handles concurrent PUT race: exactly one PUT claims token, loser is 409 and loser R2 object is purged (Requirement C & G)", async () => {
    const ticket = await createGameFileUploadToken(
      db,
      { originalFilename: "put_race.jar", sizeBytes: 100, logicalPath: "mods/put_race.jar", category: "MOD" },
      adminId,
    )

    const jarContent1 = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x00, 0x00, 0x00])
    const jarContent2 = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x02, 0x00, 0x00, 0x00])

    const context: BackendGraphQLContext = {
      env,
      db,
      request: new Request("https://api.hikat.local"),
      auth: {
        status: "authenticated",
        identity: { userId: adminId, role: "ADMIN", sessionId: "sess-g", displayName: "Admin", tokenPayload: {} as any },
      },
    }

    // Capture both generated objectKeys
    const createdKeys: string[] = []
    const origPut = mockR2.put.bind(mockR2)
    vi.spyOn(mockR2, "put").mockImplementation(async (key, value, options) => {
      createdKeys.push(key)
      return origPut(key, value, options)
    })

    const req1 = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent1,
    })
    const req2 = new Request("https://api.hikat.local/game/files/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": ticket.uploadToken, "Content-Type": "application/java-archive" },
      body: jarContent2,
    })

    const [res1, res2] = await Promise.all([
      handleGameFileUpload(req1, env, db, context),
      handleGameFileUpload(req2, env, db, context),
    ])

    const statuses = [res1.status, res2.status].sort()
    expect(statuses).toEqual([200, 409])
    expect(createdKeys.length).toBe(2)

    // Fetch the winning token record in D1
    const allTokens = await db.select().from(schema.gameFileUploadTokens).all()
    const tokenRec = (await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.id, allTokens[0]!.id))
      .get())!

    const winnerKey = tokenRec.objectKey!
    const loserKey = createdKeys.find((k) => k !== winnerKey)!

    // Winner object MUST exist in R2
    expect(await mockR2.get(winnerKey)).toBeDefined()
    // Loser object MUST be purged from R2
    expect(await mockR2.get(loserKey)).toBeNull()
  })

  it("rolls back publishGameRelease atomically if second statement fails (Requirement 1 & J)", async () => {
    await prepareGameDraft(db, adminId)
    await saveGameFileContent(db, { logicalPath: "config/init.txt", content: "init" }, adminId, env)

    // 1. Publish initial release 1.0.0
    const rel1 = await publishGameRelease(db, env, { version: "1.0.0" }, adminId)
    expect(rel1.status).toBe("PUBLISHED")

    // 2. Prepare new draft for 1.1.0
    const draft2 = await prepareGameDraft(db, adminId)
    await saveGameFileContent(db, { logicalPath: "config/update.txt", content: "update" }, adminId, env)

    // 3. Spy on db.batch to inject a colliding release version directly into SQLite right before executing the batch
    // This allows publishGameRelease's preflight check to pass, but when db.batch executes:
    // - Statement 1 (archive rel1 to ARCHIVED) succeeds in SQLite
    // - Statement 2 (set draft2 version to '1.1.0') fails in SQLite due to UNIQUE constraint on game_releases.version
    // - D1 batch catches the SQLite constraint error, executes ROLLBACK, and throws
    const origBatch = db.batch.bind(db)
    const batchSpy = vi.spyOn(db, "batch").mockImplementation(async (statements) => {
      testD1._sqlite.exec(
        `INSERT INTO game_releases (id, version, status, created_by, created_at, updated_at) VALUES ('colliding-version-id', '1.1.0', 'ARCHIVED', '${adminId}', '${new Date().toISOString()}', '${new Date().toISOString()}');`,
      )
      return origBatch(statements)
    })

    await expect(
      publishGameRelease(db, env, { version: "1.1.0" }, adminId),
    ).rejects.toThrow(/constraint failed|UNIQUE/i)

    batchSpy.mockRestore()

    // 4. Observable proof of rollback:
    // Statement 1 would have changed rel1 to ARCHIVED if not rolled back.
    // Because of atomic rollback, rel1 is STILL 'PUBLISHED'!
    const rel1After = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, rel1.id)).get()
    expect(rel1After!.status).toBe("PUBLISHED")

    // Draft 2 is STILL 'DRAFT' and was NOT published!
    const draft2After = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft2.id)).get()
    expect(draft2After!.status).toBe("DRAFT")
  })

  it("createGameFileUploadToken supports all 8 categories including GENERAL, CONFIG and DATA_PACK", async () => {
    await prepareGameDraft(db, adminId)

    const categories = [
      "MOD",
      "RESOURCE_PACK",
      "DATA_PACK",
      "SHADER_PACK",
      "KUBEJS",
      "SCRIPT",
      "CONFIG",
      "GENERAL",
    ] as const

    for (const category of categories) {
      const ticket = await createGameFileUploadToken(
        db,
        {
          originalFilename: `test-${category.toLowerCase()}.dat`,
          sizeBytes: 1024,
          category,
          logicalPath: category === "GENERAL" ? "server.properties" : undefined,
        },
        adminId,
      )

      expect(ticket).toBeDefined()
      expect(ticket.uploadUrl).toBe("/game/files/upload")
      expect(ticket.uploadToken).toBeDefined()
      expect(ticket.expectedCategory).toBe(category)

      // Verify token in database
      const rawTokenBytes = new Uint8Array(
        ticket.uploadToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
      )
      const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")

      const tokenInDb = await db
        .select()
        .from(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
        .get()

      expect(tokenInDb).toBeDefined()
      expect(tokenInDb!.category).toBe(category)
      expect(tokenInDb!.expectedSizeBytes).toBe(1024)
      expect(tokenInDb!.createdBy).toBe(adminId)
    }
  })
})


