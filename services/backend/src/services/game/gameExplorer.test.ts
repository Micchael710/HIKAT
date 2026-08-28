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
} from "./gameFileService"
import { handleGameFileDownload } from "./gameStorageService"
import type { Env } from "../../types"

describe("HiKAT Shard 8A: Game Files Explorer Backend Suite", () => {
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
    await deleteGamePaths(db, ["renamed_folder"], adminId)
    files = await getAdminGameFiles(db)
    expect(files.filter((f) => f.logicalPath.startsWith("renamed_folder")).length).toBe(0)
  })

  it("correctly resolves 3-tier policy inheritance and marks policy diffs as UPDATED", async () => {
    await prepareGameDraft(db, adminId)

    // 1. Create folder and children
    await createGameFolder(db, "config/mod_settings", adminId)
    await saveGameFileContent(
      db,
      { logicalPath: "config/mod_settings/default.toml", content: "foo = 1" },
      adminId,
      env,
    )
    await saveGameFileContent(
      db,
      {
        logicalPath: "config/mod_settings/locked.toml",
        content: "bar = 2",
        explicitPolicy: "NO_MODIFICABLE",
      },
      adminId,
      env,
    )

    let files = await getAdminGameFiles(db)
    const defaultFile = files.find((f) => f.logicalPath === "config/mod_settings/default.toml")!
    const lockedFile = files.find((f) => f.logicalPath === "config/mod_settings/locked.toml")!

    expect(defaultFile.explicitPolicy).toBeNull()
    expect(defaultFile.effectivePolicy).toBe("MODIFICABLE") // Inherits from config/ default
    expect(defaultFile.isInherited).toBe(true)

    expect(lockedFile.explicitPolicy).toBe("NO_MODIFICABLE")
    expect(lockedFile.effectivePolicy).toBe("NO_MODIFICABLE")
    expect(lockedFile.isInherited).toBe(false)

    // 2. Set explicit policy on parent folder to NO_MODIFICABLE
    await setGamePathPolicy(db, "config/mod_settings", "NO_MODIFICABLE", adminId)

    files = await getAdminGameFiles(db)
    const updatedFolder = files.find((f) => f.logicalPath === "config/mod_settings")!
    const updatedDefault = files.find((f) => f.logicalPath === "config/mod_settings/default.toml")!

    expect(updatedFolder.explicitPolicy).toBe("NO_MODIFICABLE")
    expect(updatedDefault.explicitPolicy).toBeNull()
    expect(updatedDefault.effectivePolicy).toBe("NO_MODIFICABLE") // Inherited from parent folder override!
    expect(updatedDefault.isInherited).toBe(true)
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
    expect(modpack!.clientFiles.some((f) => f.path === "assets/custom")).toBe(false) // No directory records in manifest!

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
    expect(folderRes.status).toBe(404) // Directory records cannot be downloaded

    const fileReq = new Request(`http://localhost/game/download/${fileRecord.id}`)
    const fileRes = await handleGameFileDownload(fileReq, env, db, fileRecord.id)
    expect(fileRes.status).toBe(200)
    const text = await fileRes.text()
    expect(text).toBe("Hello HiKAT")
  })

  it("diff tracking detects policy modification even when content hash is unchanged", async () => {
    const publishedFiles = [
      {
        id: "f1",
        releaseId: "rel-1",
        name: "test.toml",
        logicalPath: "config/test.toml",
        category: "CONFIG",
        sha256: "hash123",
        sizeBytes: 100,
        policy: "MODIFICABLE",
        isDirectory: 0,
        objectKey: "key1",
        createdAt: new Date().toISOString(),
      },
    ]

    const draftFiles = [
      {
        id: "f2",
        releaseId: "rel-2",
        name: "test.toml",
        logicalPath: "config/test.toml",
        category: "CONFIG",
        sha256: "hash123", // Same hash and size!
        sizeBytes: 100,
        policy: "NO_MODIFICABLE", // Changed explicit policy!
        isDirectory: 0,
        objectKey: "key1",
        createdAt: new Date().toISOString(),
      },
    ]

    const diff = computeDraftChanges(publishedFiles as any, draftFiles as any)
    expect(diff.changes.updated).toBe(1)
    expect(diff.changes.unchanged).toBe(0)
    expect(diff.taggedFiles[0]!.changeStatus).toBe("UPDATED")
  })
})
