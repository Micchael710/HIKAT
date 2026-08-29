import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  getServerReleaseSyncPlan,
  applyServerReleaseSync,
} from "./serverReleaseSyncService"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

describe("Shard 08D: Server Release Sync Service Tests", () => {
  let db: any
  let d1: any
  const env: any = {
    PTERODACTYL_BASE_URL: "https://panel.hikat.net",
    PTERODACTYL_API_KEY: "secret-key",
    PTERODACTYL_SERVER_ID: "srv-mc-01",
    STORAGE_BUCKET: {
      get: vi.fn(),
    },
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

    env.ASSETS = env.STORAGE_BUCKET
  })

  // Test 1: Plan Calculation for INSTALL, UPDATE, REMOVE, KEEP
  it("getServerReleaseSyncPlan accurately computes INSTALL, UPDATE, REMOVE, KEEP actions for BOTH mods", async () => {
    const nowIso = new Date().toISOString()

    // 1. Create a PUBLISHED release with 3 BOTH mods
    await db.insert(schema.gameReleases).values({
      id: "rel-pub-1",
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleaseFiles).values([
      // Mod 1: Identical (KEEP)
      {
        id: "grf-1",
        releaseId: "rel-pub-1",
        name: "ferritecore.jar",
        logicalPath: "mods/ferritecore.jar",
        category: "MOD",
        sha256: "hash-ferrite",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "ferrite-id",
        objectKey: "releases/rel-pub-1/mods/ferritecore.jar",
        createdAt: nowIso,
      },
      // Mod 2: Updated version (UPDATE)
      {
        id: "grf-2",
        releaseId: "rel-pub-1",
        name: "voicechat-v2.jar",
        logicalPath: "mods/voicechat-v2.jar",
        category: "MOD",
        sha256: "hash-voice-v2",
        sizeBytes: 2000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "voicechat-id",
        objectKey: "releases/rel-pub-1/mods/voicechat-v2.jar",
        createdAt: nowIso,
      },
      // Mod 3: New mod in release (INSTALL)
      {
        id: "grf-3",
        releaseId: "rel-pub-1",
        name: "jei.jar",
        logicalPath: "mods/jei.jar",
        category: "MOD",
        sha256: "hash-jei",
        sizeBytes: 3000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "jei-id",
        objectKey: "releases/rel-pub-1/mods/jei.jar",
        createdAt: nowIso,
      },
      // Mod 4: CLIENT-only mod (MUST BE EXCLUDED from server sync plan)
      {
        id: "grf-4",
        releaseId: "rel-pub-1",
        name: "sodium-ui.jar",
        logicalPath: "mods/sodium-ui.jar",
        category: "MOD",
        sha256: "hash-sodium",
        sizeBytes: 4000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "CLIENT",
        sourceProjectId: "sodium-id",
        objectKey: "releases/rel-pub-1/mods/sodium-ui.jar",
        createdAt: nowIso,
      },
    ])

    // 2. Insert current server records:
    // - ferritecore.jar (KEEP)
    // - voicechat-v1.jar (UPDATE -> voicechat-v2.jar)
    // - oldmod.jar (REMOVE -> no longer in release)
    await db.insert(schema.serverManagedContent).values([
      {
        id: "smc-1",
        managementSource: "GAME_RELEASE",
        projectId: "ferrite-id",
        targetPath: "mods/ferritecore.jar",
        sha256: "hash-ferrite",
        sizeBytes: 1000,
        name: "ferritecore.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "smc-2",
        managementSource: "GAME_RELEASE",
        projectId: "voicechat-id",
        targetPath: "mods/voicechat-v1.jar",
        sha256: "hash-voice-v1",
        sizeBytes: 1500,
        name: "voicechat-v1.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "smc-3",
        managementSource: "GAME_RELEASE",
        projectId: "oldmod-id",
        targetPath: "mods/oldmod.jar",
        sha256: "hash-old",
        sizeBytes: 500,
        name: "oldmod.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "offline",
          resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
    }

    const plan = await getServerReleaseSyncPlan(db, env, mockClient as any)

    expect(plan.isPending).toBe(true)
    expect(plan.summary.toKeep).toBe(1)
    expect(plan.summary.toUpdate).toBe(1)
    expect(plan.summary.toInstall).toBe(1)
    expect(plan.summary.toRemove).toBe(1)

    const keepItem = plan.items.find((i) => i.action === "KEEP")
    const updateItem = plan.items.find((i) => i.action === "UPDATE")
    const installItem = plan.items.find((i) => i.action === "INSTALL")
    const removeItem = plan.items.find((i) => i.action === "REMOVE")

    expect(keepItem?.filename).toBe("ferritecore.jar")
    expect(updateItem?.filename).toBe("voicechat-v2.jar")
    expect(installItem?.filename).toBe("jei.jar")
    expect(removeItem?.filename).toBe("oldmod.jar")
  })

  // Test 2: Server OFFLINE Precondition Enforcement
  it("applyServerReleaseSync rejects execution if server is not OFFLINE", async () => {
    const mockOnlineClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "running",
          resources: { memory_bytes: 500, cpu_absolute: 10, disk_bytes: 500, uptime: 1000 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
    }

    await expect(
      applyServerReleaseSync(db, env, "admin-1", false, mockOnlineClient as any),
    ).rejects.toThrow("Apaga el servidor antes de aplicar cambios de mods.")
  })

  // Test 3: Pre-Sync Backup and Binary Streaming from R2 to Wings
  it("applyServerReleaseSync creates pre-sync backup, streams R2 binaries to Wings, updates D1, and logs sync", async () => {
    const nowIso = new Date().toISOString()

    // Setup published release
    await db.insert(schema.gameReleases).values({
      id: "rel-pub-2",
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const testBinaryBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03])
    const hashBuffer = await crypto.subtle.digest("SHA-256", testBinaryBytes)
    const testSha256 = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-new",
      releaseId: "rel-pub-2",
      name: "new-server-mod.jar",
      logicalPath: "mods/new-server-mod.jar",
      category: "MOD",
      sha256: testSha256,
      sizeBytes: testBinaryBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-2/mods/new-server-mod.jar",
      createdAt: nowIso,
    })

    // Mock R2 get
    env.ASSETS.get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(testBinaryBytes.buffer),
    })

    const writeFileSpy = vi.fn().mockResolvedValue(undefined)
    const deleteFilesSpy = vi.fn().mockResolvedValue(undefined)
    const createBackupSpy = vi.fn().mockResolvedValue({ id: "bk-sync-1", attributes: { uuid: "bk-sync-1" } })
    const getBackupSpy = vi.fn().mockResolvedValue({
      object: "backup",
      attributes: { uuid: "bk-sync-1", completed_at: nowIso, is_successful: true },
    })

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "offline",
          resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createBackup: createBackupSpy,
      getBackup: getBackupSpy,
      createFolder: vi.fn().mockResolvedValue(undefined),
      writeFile: writeFileSpy,
      deleteFiles: deleteFilesSpy,
      listDirectory: vi.fn().mockResolvedValue({ data: [] }),
    }

    const result = await applyServerReleaseSync(
      db,
      env,
      "admin-1",
      true, // createBackup
      mockClient as any,
    )

    expect(result.success).toBe(true)
    expect(createBackupSpy).toHaveBeenCalledWith("Pre-Release Sync Backup")
    expect(env.ASSETS.get).toHaveBeenCalledWith("releases/rel-pub-2/mods/new-server-mod.jar")
    expect(writeFileSpy).toHaveBeenCalledWith("/mods/new-server-mod.jar", expect.any(Uint8Array))

    // Verify D1 records
    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.targetPath).toBe("mods/new-server-mod.jar")
    expect(tracked[0]?.managementSource).toBe("GAME_RELEASE")

    // Verify audit log in server_release_syncs
    const syncLogs = await db.select().from(schema.serverReleaseSyncs)
    expect(syncLogs).toHaveLength(1)
    expect(syncLogs[0]?.status).toBe("APPLIED")
    expect(syncLogs[0]?.releaseId).toBe("rel-pub-2")
  })

  // Test 4: Backup Timeout and Failure Abort Semantics
  it("applyServerReleaseSync aborts immediately without filesystem mutation if backup times out or fails", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-timeout",
      version: "3.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const testBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20])
    const hashBuf = await crypto.subtle.digest("SHA-256", testBytes)
    const testHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-timeout",
      releaseId: "rel-pub-timeout",
      name: "timeout-mod.jar",
      logicalPath: "mods/timeout-mod.jar",
      category: "MOD",
      sha256: testHash,
      sizeBytes: testBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-timeout/mods/timeout-mod.jar",
      createdAt: nowIso,
    })

    const writeFileSpy = vi.fn()
    const deleteFilesSpy = vi.fn()

    const mockFailedBackupClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createBackup: vi.fn().mockResolvedValue({ id: "bk-fail", attributes: { uuid: "bk-fail" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "bk-fail", completed_at: nowIso, is_successful: false },
      }),
      createFolder: vi.fn(),
      writeFile: writeFileSpy,
      deleteFiles: deleteFilesSpy,
      listDirectory: vi.fn().mockResolvedValue({ data: [] }),
    }

    await expect(
      applyServerReleaseSync(db, env, "admin-1", true, mockFailedBackupClient as any),
    ).rejects.toThrow("El backup previo a la sincronización no se completó exitosamente")

    // Verify no filesystem writes occurred
    expect(writeFileSpy).not.toHaveBeenCalled()
    expect(deleteFilesSpy).not.toHaveBeenCalled()

    // Verify D1 status recorded as FAILED
    const syncLogs = await db.select().from(schema.serverReleaseSyncs)
    expect(syncLogs).toHaveLength(1)
    expect(syncLogs[0]?.status).toBe("FAILED")
  })

  // Test 5: R2 Preflight Integrity Validation (size, SHA-256, magic bytes)
  it("applyServerReleaseSync validates R2 binary existence, size, SHA-256 and magic bytes before mutating Wings", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-r2",
      version: "4.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-r2",
      releaseId: "rel-pub-r2",
      name: "corrupt-mod.jar",
      logicalPath: "mods/corrupt-mod.jar",
      category: "MOD",
      sha256: "expected-sha256-hash",
      sizeBytes: 10,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-r2/mods/corrupt-mod.jar",
      createdAt: nowIso,
    })

    // Return invalid content (non-ZIP header, wrong size)
    env.ASSETS.get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x00, 0x00]).buffer),
    })

    const writeFileSpy = vi.fn()
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createFolder: vi.fn(),
      writeFile: writeFileSpy,
      deleteFiles: vi.fn(),
      listDirectory: vi.fn().mockResolvedValue({ data: [] }),
    }

    await expect(
      applyServerReleaseSync(db, env, "admin-1", false, mockClient as any),
    ).rejects.toThrow("Discrepancia de tamaño en R2")

    expect(writeFileSpy).not.toHaveBeenCalled()
  })

  // Test 6: Manual and Server Direct File Collision Protection
  it("applyServerReleaseSync rejects overwrite on untracked manual file collision", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-col",
      version: "5.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const testBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])
    const hashBuf = await crypto.subtle.digest("SHA-256", testBytes)
    const testHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-col",
      releaseId: "rel-pub-col",
      name: "manual-colliding.jar",
      logicalPath: "mods/manual-colliding.jar",
      category: "MOD",
      sha256: testHash,
      sizeBytes: testBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-col/mods/manual-colliding.jar",
      createdAt: nowIso,
    })

    env.ASSETS.get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(testBytes.buffer),
    })

    // Mock Wings returning manual file in /mods
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createFolder: vi.fn(),
      listDirectory: vi.fn().mockResolvedValue({
        data: [{ attributes: { name: "manual-colliding.jar", is_file: true } }],
      }),
      writeFile: vi.fn(),
      deleteFiles: vi.fn(),
    }

    await expect(
      applyServerReleaseSync(db, env, "admin-1", false, mockClient as any),
    ).rejects.toThrow("Ya existe un archivo manual en esta ruta (mods/manual-colliding.jar)")
  })

  // Test 7: Fail-closed Server Status in Release Sync Plan
  it("getServerReleaseSyncPlan fails closed when server status is inaccessible", async () => {
    const nowIso = new Date().toISOString()
    await db.insert(schema.gameReleases).values({
      id: "rel-pub-status",
      version: "6.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const mockFailingClient = {
      getServerResources: vi.fn().mockRejectedValue(new Error("Network timeout")),
      getServerDetails: vi.fn().mockRejectedValue(new Error("Network timeout")),
    }

    const plan = await getServerReleaseSyncPlan(db, env, mockFailingClient as any)
    expect(plan.serverStatus).toBe("DISCONNECTED")
    expect(plan.canApply).toBe(false)
    expect(plan.blockReason).toBe("No se pudo confirmar que el servidor esté apagado.")
  })
})
