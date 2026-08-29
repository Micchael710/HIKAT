import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  renameServerFile,
  deleteServerFile,
} from "./serverFileService"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

describe("Shard 08D: Server File Explorer Managed Content Protections Tests", () => {
  let db: any
  let d1: any
  const env: any = {
    PTERODACTYL_BASE_URL: "https://panel.hikat.net",
    PTERODACTYL_API_KEY: "secret-key",
    PTERODACTYL_SERVER_ID: "srv-mc-01",
  }

  beforeEach(async () => {
    const mock = createMockD1()
    db = mock.db
    d1 = mock.d1

    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
  })

  // Test 1: Rename is blocked on GAME_RELEASE and SERVER_DIRECT managed content
  it("renameServerFile blocks renaming any managed content", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverManagedContent).values([
      {
        id: "smc-rel-1",
        managementSource: "GAME_RELEASE",
        targetPath: "mods/release-mod.jar",
        sha256: "hash1",
        sizeBytes: 1000,
        name: "release-mod.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "smc-dir-1",
        managementSource: "SERVER_DIRECT",
        targetPath: "mods/direct-mod.jar",
        sha256: "hash2",
        sizeBytes: 2000,
        name: "direct-mod.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])

    const renameSpy = vi.fn()
    const mockClient = { renameFile: renameSpy }

    // Rename GAME_RELEASE -> blocked
    await expect(
      renameServerFile(env, "SERVER", "mods/release-mod.jar", "new-name.jar", mockClient as any, db),
    ).rejects.toThrow("No se pueden renombrar archivos administrados por HiKAT.")

    // Rename SERVER_DIRECT -> blocked
    await expect(
      renameServerFile(env, "SERVER", "mods/direct-mod.jar", "new-name.jar", mockClient as any, db),
    ).rejects.toThrow("No se pueden renombrar archivos administrados por HiKAT.")

    expect(renameSpy).not.toHaveBeenCalled()
  })

  // Test 2: Delete is blocked on GAME_RELEASE content
  it("deleteServerFile blocks manual deletion of GAME_RELEASE content", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverManagedContent).values({
      id: "smc-rel-2",
      managementSource: "GAME_RELEASE",
      targetPath: "mods/release-mod.jar",
      sha256: "hash1",
      sizeBytes: 1000,
      name: "release-mod.jar",
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const deleteFilesSpy = vi.fn()
    const mockClient = { deleteFiles: deleteFilesSpy }

    await expect(
      deleteServerFile(env, "SERVER", "mods/release-mod.jar", mockClient as any, db),
    ).rejects.toThrow("Este archivo pertenece a la release del modpack. Modifícalo desde Juego → Actualizaciones.")

    expect(deleteFilesSpy).not.toHaveBeenCalled()
  })

  // Test 3: Delete on SERVER_DIRECT cascades D1 record deletion
  it("deleteServerFile deletes physical file and cascades D1 record for SERVER_DIRECT content", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverManagedContent).values({
      id: "smc-dir-3",
      managementSource: "SERVER_DIRECT",
      targetPath: "mods/direct-mod.jar",
      sha256: "hash3",
      sizeBytes: 3000,
      name: "direct-mod.jar",
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const deleteFilesSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = { deleteFiles: deleteFilesSpy }

    const success = await deleteServerFile(env, "SERVER", "mods/direct-mod.jar", mockClient as any, db)
    expect(success).toBe(true)
    expect(deleteFilesSpy).toHaveBeenCalledWith("/mods", ["direct-mod.jar"])

    // Record removed from D1
    const records = await db.select().from(schema.serverManagedContent)
    expect(records).toHaveLength(0)
  })
})
