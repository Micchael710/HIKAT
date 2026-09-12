import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { isNull, eq } from "drizzle-orm"
import {
  getServerReleaseSyncPlan,
  applyServerReleaseSync,
  generateOfficialServerIntegrityManifest,
} from "./serverReleaseSyncService"
import { prepareGameDraft, publishGameRelease } from "../game/releaseService"
import { updateAdminSettings } from "../settingsService"

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
      listDirectory: vi.fn().mockResolvedValue({
        data: [
          { attributes: { name: "ferritecore.jar", is_file: true } },
          { attributes: { name: "voicechat-v1.jar", is_file: true } },
          { attributes: { name: "oldmod.jar", is_file: true } },
        ],
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
    expect(createBackupSpy).toHaveBeenCalledTimes(1)
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

  // Test 4: Real Backup Timeout with Fake Timers
  it("applyServerReleaseSync aborts immediately when backup times out after SERVER_RELEASE_SYNC_BACKUP_TIMEOUT_MS with fake timers", async () => {
    vi.useFakeTimers()
    try {
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

      const mockPendingBackupClient = {
        getServerResources: vi.fn().mockResolvedValue({
          attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
        }),
        getServerDetails: vi.fn().mockResolvedValue({
          attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
        }),
        createBackup: vi.fn().mockResolvedValue({ id: "bk-pending", attributes: { uuid: "bk-pending" } }),
        // Always pending (completed_at: null)
        getBackup: vi.fn().mockResolvedValue({
          object: "backup",
          attributes: { uuid: "bk-pending", completed_at: null, is_successful: null },
        }),
        createFolder: vi.fn(),
        writeFile: writeFileSpy,
        deleteFiles: deleteFilesSpy,
        listDirectory: vi.fn().mockResolvedValue({ data: [] }),
      }

      const syncPromise = applyServerReleaseSync(db, env, "admin-1", true, mockPendingBackupClient as any)
      const assertion = expect(syncPromise).rejects.toThrow("Timeout al esperar la finalización del backup")

      // Advance timers past the 180s (3 minute) timeout
      await vi.advanceTimersByTimeAsync(190000)

      await assertion

      // Verify no filesystem writes occurred
      expect(writeFileSpy).not.toHaveBeenCalled()
      expect(deleteFilesSpy).not.toHaveBeenCalled()

      // Verify D1 status recorded as FAILED
      const syncLogs = await db.select().from(schema.serverReleaseSyncs)
      expect(syncLogs).toHaveLength(1)
      expect(syncLogs[0]?.status).toBe("FAILED")
    } finally {
      vi.useRealTimers()
    }
  })

  // Test 4b: Backup Failure (is_successful: false) Aborts Execution
  it("applyServerReleaseSync aborts immediately without filesystem mutation if backup fails (is_successful: false)", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-fail",
      version: "3.1.0",
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
      id: "grf-fail",
      releaseId: "rel-pub-fail",
      name: "fail-mod.jar",
      logicalPath: "mods/fail-mod.jar",
      category: "MOD",
      sha256: testHash,
      sizeBytes: testBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-fail/mods/fail-mod.jar",
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

    // Mock Wings returning manual file in /mods with different size
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createFolder: vi.fn(),
      listDirectory: vi.fn().mockResolvedValue({
        data: [{ attributes: { name: "manual-colliding.jar", size: 99999, is_file: true } }],
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
    expect(plan.blockReason).toBe("El servidor no está disponible.")
  })

  // Test 8: Physical Drift Detection in Plan and Restoration on Apply
  it("Shard 8D: Physical drift flags missing physical files as INSTALL and repairs them on apply", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-drift",
      version: "7.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const testBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x0b])
    const hashBuf = await crypto.subtle.digest("SHA-256", testBytes)
    const testSha256 = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-drift-1",
      releaseId: "rel-pub-drift",
      name: "drifted-mod.jar",
      logicalPath: "mods/drifted-mod.jar",
      category: "MOD",
      sha256: testSha256,
      sizeBytes: testBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-drift/mods/drifted-mod.jar",
      createdAt: nowIso,
    })

    // D1 has the record, but Wings filesystem will NOT have the file
    await db.insert(schema.serverManagedContent).values({
      id: "smc-drift-1",
      managementSource: "GAME_RELEASE",
      targetPath: "mods/drifted-mod.jar",
      sha256: testSha256,
      sizeBytes: testBytes.length,
      name: "drifted-mod.jar",
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const physicalFiles: string[] = [] // Empty filesystem (drift!)

    const mockDriftClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      listDirectory: vi.fn().mockImplementation(() =>
        Promise.resolve({ data: physicalFiles.map((name) => ({ attributes: { name, is_file: true } })) }),
      ),
      createFolder: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockImplementation((path: string) => {
        physicalFiles.push(path.split("/").pop()!)
        return Promise.resolve(undefined)
      }),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    env.ASSETS.get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(testBytes.buffer),
    })

    // 1. Initial Plan should detect physical drift and report INSTALL (isPending = true)
    const initialPlan = await getServerReleaseSyncPlan(db, env, mockDriftClient as any)
    expect(initialPlan.isPending).toBe(true)
    expect(initialPlan.summary.toInstall).toBe(1)
    expect(initialPlan.summary.toKeep).toBe(0)

    // 2. Apply should restore the physical file
    const applyRes = await applyServerReleaseSync(db, env, "admin-1", false, mockDriftClient as any)
    expect(applyRes.success).toBe(true)
    expect(mockDriftClient.writeFile).toHaveBeenCalledWith("/mods/drifted-mod.jar", expect.any(Uint8Array))

    // 3. Subsequent plan should report KEEP (isPending = false)
    const subsequentPlan = await getServerReleaseSyncPlan(db, env, mockDriftClient as any)
    expect(subsequentPlan.isPending).toBe(false)
    expect(subsequentPlan.summary.toKeep).toBe(1)
    expect(subsequentPlan.summary.toInstall).toBe(0)
  })

  // Test 9: Fail-closed Preflight when Directory Listing Fails on Apply
  it("Shard 8D: applyServerReleaseSync fails closed without changes if directory listing throws network error", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-err",
      version: "8.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const writeFileSpy = vi.fn()
    const deleteFilesSpy = vi.fn()

    const mockFailingListingClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      listDirectory: vi.fn().mockRejectedValue(new Error("Wings 502 Bad Gateway")),
      writeFile: writeFileSpy,
      deleteFiles: deleteFilesSpy,
    }

    await expect(
      applyServerReleaseSync(db, env, "admin-1", false, mockFailingListingClient as any),
    ).rejects.toThrow("No se pudo verificar de forma segura el contenido actual del servidor. No se realizaron cambios.")

    expect(writeFileSpy).not.toHaveBeenCalled()
    expect(deleteFilesSpy).not.toHaveBeenCalled()
  })

  // Test 10: Retry Recovery on Matching Untracked File with exact SHA-256
  it("Shard 8D: applyServerReleaseSync allows recovery without CONFLICT when physical file matches desired size AND exact SHA-256", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-retry",
      version: "9.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const testBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0x88])
    const hashBuf = await crypto.subtle.digest("SHA-256", testBytes)
    const testSha256 = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-retry",
      releaseId: "rel-pub-retry",
      name: "retry-mod.jar",
      logicalPath: "mods/retry-mod.jar",
      category: "MOD",
      sha256: testSha256,
      sizeBytes: testBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-retry/mods/retry-mod.jar",
      createdAt: nowIso,
    })

    env.ASSETS.get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(testBytes.buffer),
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(testBytes, { status: 200 }),
    )

    // Physical file already exists on Wings with exact expected size and exact SHA-256
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      listDirectory: vi.fn().mockResolvedValue({
        data: [{ attributes: { name: "retry-mod.jar", size: testBytes.length, is_file: true } }],
      }),
      getFileDownload: vi.fn().mockResolvedValue({
        attributes: { url: "https://wings.hikat.net/signed-download/retry-mod.jar" },
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const result = await applyServerReleaseSync(db, env, "admin-1", false, mockClient as any)
    expect(result.success).toBe(true)

    // D1 record should now be created
    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.targetPath).toBe("mods/retry-mod.jar")

    fetchSpy.mockRestore()
  })

  // Test 11: Untracked Physical File with Same Size but DIFFERENT SHA-256 is Rejected
  it("Shard 8D: applyServerReleaseSync rejects untracked physical file when SHA-256 differs even if size matches", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-diff-sha",
      version: "10.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const expectedBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])
    const hashBuf = await crypto.subtle.digest("SHA-256", expectedBytes)
    const expectedSha256 = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const manualBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0x99]) // Same length (6), different content

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-diff-sha",
      releaseId: "rel-pub-diff-sha",
      name: "diff-sha-mod.jar",
      logicalPath: "mods/diff-sha-mod.jar",
      category: "MOD",
      sha256: expectedSha256,
      sizeBytes: expectedBytes.length,
      policy: "NO_MODIFICABLE",
      effectivePolicy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-pub-diff-sha/mods/diff-sha-mod.jar",
      createdAt: nowIso,
    })

    env.ASSETS.get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(expectedBytes.buffer),
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(manualBytes, { status: 200 }),
    )

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      listDirectory: vi.fn().mockResolvedValue({
        data: [{ attributes: { name: "diff-sha-mod.jar", size: expectedBytes.length, is_file: true } }],
      }),
      getFileDownload: vi.fn().mockResolvedValue({
        attributes: { url: "https://wings.hikat.net/signed-download/diff-sha-mod.jar" },
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    await expect(
      applyServerReleaseSync(db, env, "admin-1", false, mockClient as any),
    ).rejects.toThrow("Ya existe un archivo manual en esta ruta (mods/diff-sha-mod.jar). HiKAT no lo reemplazará automáticamente.")

    fetchSpy.mockRestore()
  })

  // Test 12: Disconnected Pterodactyl computes logical plan accurately without false physical drift (KEEP, INSTALL, UPDATE, REMOVE) and sets canApply = false
  it("Shard 8D: Disconnected Pterodactyl computes logical plan accurately without false physical drift and sets canApply = false", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-disconn",
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleaseFiles).values([
      // 1. Identical to D1 (Logical KEEP, should NOT become INSTALL even though physical check is unavailable)
      {
        id: "grf-d1-keep",
        releaseId: "rel-pub-disconn",
        name: "keep-mod.jar",
        logicalPath: "mods/keep-mod.jar",
        category: "MOD",
        sha256: "hash-keep",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "keep-id",
        objectKey: "releases/rel-pub-disconn/mods/keep-mod.jar",
        createdAt: nowIso,
      },
      // 2. New desired mod (Logical INSTALL)
      {
        id: "grf-d1-new",
        releaseId: "rel-pub-disconn",
        name: "new-mod.jar",
        logicalPath: "mods/new-mod.jar",
        category: "MOD",
        sha256: "hash-new",
        sizeBytes: 2000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "new-id",
        objectKey: "releases/rel-pub-disconn/mods/new-mod.jar",
        createdAt: nowIso,
      },
      // 3. Changed desired mod (Logical UPDATE)
      {
        id: "grf-d1-update",
        releaseId: "rel-pub-disconn",
        name: "update-v2.jar",
        logicalPath: "mods/update-v2.jar",
        category: "MOD",
        sha256: "hash-v2",
        sizeBytes: 3000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "update-id",
        objectKey: "releases/rel-pub-disconn/mods/update-v2.jar",
        createdAt: nowIso,
      },
    ])

    // Current D1 records
    await db.insert(schema.serverManagedContent).values([
      {
        id: "smc-keep",
        managementSource: "GAME_RELEASE",
        projectId: "keep-id",
        targetPath: "mods/keep-mod.jar",
        sha256: "hash-keep",
        sizeBytes: 1000,
        name: "keep-mod.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "smc-update",
        managementSource: "GAME_RELEASE",
        projectId: "update-id",
        targetPath: "mods/update-v1.jar",
        sha256: "hash-v1",
        sizeBytes: 2500,
        name: "update-v1.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      // 4. Removed mod (Logical REMOVE)
      {
        id: "smc-remove",
        managementSource: "GAME_RELEASE",
        projectId: "removed-id",
        targetPath: "mods/removed-mod.jar",
        sha256: "hash-removed",
        sizeBytes: 4000,
        name: "removed-mod.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])

    // Mock client throws on getServerResources (DISCONNECTED)
    const mockClient = {
      getServerResources: vi.fn().mockRejectedValue(new Error("Connection refused (Wings down)")),
    }

    const plan = await getServerReleaseSyncPlan(db, env, mockClient as any)

    expect(plan.serverStatus).toBe("DISCONNECTED")
    expect(plan.canApply).toBe(false)
    expect(plan.blockReason).toBe("El servidor no está disponible.")
    expect(plan.isPending).toBe(true)

    expect(plan.summary.toKeep).toBe(1) // keep-mod.jar is KEEP, NOT false INSTALL
    expect(plan.summary.toInstall).toBe(1) // new-mod.jar is INSTALL
    expect(plan.summary.toUpdate).toBe(1) // update-v2.jar is UPDATE
    expect(plan.summary.toRemove).toBe(1) // removed-mod.jar is REMOVE

    const keepItem = plan.items.find((i) => i.filename === "keep-mod.jar")
    expect(keepItem?.action).toBe("KEEP")

    const installItem = plan.items.find((i) => i.filename === "new-mod.jar")
    expect(installItem?.action).toBe("INSTALL")

    const updateItem = plan.items.find((i) => i.filename === "update-v2.jar")
    expect(updateItem?.action).toBe("UPDATE")

    const removeItem = plan.items.find((i) => i.filename === "removed-mod.jar")
    expect(removeItem?.action).toBe("REMOVE")
  })

  // Test 13: Online / Offline server with physical file missing performs physical drift repair (INSTALL)
  it("Shard 8D: Connected server detects missing physical file on disk and marks as INSTALL (physical drift repair)", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-drift",
      version: "3.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleaseFiles).values([
      {
        id: "grf-drift-1",
        releaseId: "rel-pub-drift",
        name: "drift-mod.jar",
        logicalPath: "mods/drift-mod.jar",
        category: "MOD",
        sha256: "hash-drift",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        effectivePolicy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        sourceProjectId: "drift-id",
        objectKey: "releases/rel-pub-drift/mods/drift-mod.jar",
        createdAt: nowIso,
      },
    ])

    // D1 says it's already managed and identical
    await db.insert(schema.serverManagedContent).values([
      {
        id: "smc-drift-1",
        managementSource: "GAME_RELEASE",
        projectId: "drift-id",
        targetPath: "mods/drift-mod.jar",
        sha256: "hash-drift",
        sizeBytes: 1000,
        name: "drift-mod.jar",
        contentType: "MOD",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])

    // Wings is connected (offline), but /mods directory does NOT contain drift-mod.jar
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      listDirectory: vi.fn().mockResolvedValue({
        data: [], // empty filesystem!
      }),
    }

    const plan = await getServerReleaseSyncPlan(db, env, mockClient as any)

    expect(plan.serverStatus).toBe("OFFLINE")
    expect(plan.canApply).toBe(true)
    expect(plan.summary.toInstall).toBe(1) // Physical drift repair detected: marked as INSTALL!
    expect(plan.items[0]?.action).toBe("INSTALL")
  })

  // Test 14: Server offline but listDirectory fails sets canApply = false and descriptive blockReason
  it("Shard 8D: Server offline but listDirectory fails sets canApply = false and blockReason", async () => {
    const nowIso = new Date().toISOString()

    await db.insert(schema.gameReleases).values({
      id: "rel-pub-list-fail",
      version: "4.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      listDirectory: vi.fn().mockRejectedValue(new Error("Wings daemon IO error")),
    }

    const plan = await getServerReleaseSyncPlan(db, env, mockClient as any)

    expect(plan.serverStatus).toBe("OFFLINE")
    expect(plan.canApply).toBe(false)
    expect(plan.blockReason).toBe("No se pudieron verificar los archivos del servidor.")
  })
})

describe("Mandatory Regression Tests: Release Sync Scoping & Self-Heal (A-G)", () => {
  let db: any
  let d1: any
  let r2Store: Map<string, Uint8Array>
  const env: any = {
    PTERODACTYL_BASE_URL: "https://panel.hikat.net",
    PTERODACTYL_API_KEY: "secret-key",
    PTERODACTYL_SERVER_ID: "srv-mc-01",
  }

  async function createValidJarBuffer(name: string): Promise<{ buffer: Uint8Array; sha256: string }> {
    const header = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00])
    const nameBytes = new TextEncoder().encode(name)
    const full = new Uint8Array(header.byteLength + nameBytes.byteLength + 64)
    full.set(header, 0)
    full.set(nameBytes, header.byteLength)
    const shaBuf = await crypto.subtle.digest("SHA-256", full.buffer)
    const sha256 = Array.from(new Uint8Array(shaBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    return { buffer: full, sha256 }
  }

  function createMockWingsClient() {
    const fileStore = new Map<string, Uint8Array>()
    return {
      fileStore,
      client: {
        getServerResources: vi.fn().mockResolvedValue({
          attributes: {
            current_state: "offline",
            resources: { memory_bytes: 1024, cpu_absolute: 0, disk_bytes: 1024, uptime: 0 },
          },
        }),
        getServerDetails: vi.fn().mockResolvedValue({
          attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
        }),
        createBackup: vi.fn().mockResolvedValue({ id: "bk-1", attributes: { uuid: "bk-1" } }),
        getBackup: vi.fn().mockResolvedValue({
          object: "backup",
          attributes: { uuid: "bk-1", completed_at: new Date().toISOString(), is_successful: true },
        }),
        createFolder: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockImplementation(async (path: string, content: Uint8Array) => {
          const normalized = path.replace(/^\/+/, "")
          fileStore.set(normalized, new Uint8Array(content))
        }),
        deleteFiles: vi.fn().mockImplementation(async (path: string, files: string[]) => {
          for (const f of files) {
            const full = (path.replace(/^\/+/, "") + "/" + f).replace(/^\/+/, "")
            fileStore.delete(full)
          }
        }),
        listDirectory: vi.fn().mockImplementation(async (path: string) => {
          const prefix = path.replace(/^\/+/, "").replace(/\/+$/, "")
          const items: any[] = []
          for (const [filePath, content] of fileStore.entries()) {
            const normalized = filePath.replace(/^\/+/, "")
            const parts = normalized.split("/")
            if (prefix === "" || normalized.startsWith(prefix + "/")) {
              const name = prefix === "" ? parts[0] : parts[parts.length - 1]
              items.push({
                attributes: {
                  name,
                  is_file: true,
                  size: content.byteLength,
                  modified_at: new Date().toISOString(),
                },
              })
            }
          }
          return { data: items }
        }),
      } as any,
    }
  }

  beforeEach(async () => {
    const mock = createMockD1()
    db = mock.db
    d1 = mock.d1
    r2Store = new Map<string, Uint8Array>()

    env.STORAGE_BUCKET = {
      get: vi.fn().mockImplementation(async (key: string) => {
        const data = r2Store.get(key)
        if (!data) return null
        return {
          arrayBuffer: async () => data.buffer,
          body: data,
          size: data.byteLength,
        }
      }),
      head: vi.fn().mockImplementation(async (key: string) => {
        const data = r2Store.get(key)
        if (!data) return null
        return { size: data.byteLength }
      }),
      put: vi.fn().mockImplementation(async (key: string, data: any) => {
        r2Store.set(key, new Uint8Array(data))
      }),
    }
    env.ASSETS = env.STORAGE_BUCKET

    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
  })

  // A. INSERT SCOPED
  it("A. INSERT SCOPED: applying Warria release sets serverId === 'warria-id' in serverManagedContent", async () => {
    const nowIso = new Date().toISOString()
    await db.insert(schema.servers).values({
      id: "warria-id",
      name: "Warria",
      pterodactylIdentifier: "srv-warria",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleases).values({
      id: "rel-warria-1",
      version: "1.0.0",
      status: "PUBLISHED",
      serverId: "warria-id",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const jar = await createValidJarBuffer("warria-mod.jar")
    r2Store.set("releases/rel-warria-1/mods/warria-mod.jar", jar.buffer)

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-w1",
      releaseId: "rel-warria-1",
      name: "warria-mod.jar",
      logicalPath: "mods/warria-mod.jar",
      category: "MOD",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-warria-1/mods/warria-mod.jar",
      createdAt: nowIso,
    })

    const { client } = createMockWingsClient()
    const result = await applyServerReleaseSync(db, env, "admin-1", false, "warria-id", client)
    expect(result.success).toBe(true)

    const managed = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.serverId, "warria-id"))
      .all()
    expect(managed).toHaveLength(1)
    expect(managed[0]?.serverId).toBe("warria-id")
    expect(managed[0]?.gameReleaseId).toBe("rel-warria-1")
    expect(managed[0]?.managementSource).toBe("GAME_RELEASE")
  })

  // B. PLAN POST-APPLY
  it("B. PLAN POST-APPLY: before apply shows 3 INSTALL; after apply shows 0 INSTALL, 3 KEEP, isPending = false", async () => {
    const nowIso = new Date().toISOString()
    await db.insert(schema.servers).values({
      id: "warria-id",
      name: "Warria",
      pterodactylIdentifier: "srv-warria",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleases).values({
      id: "rel-warria-b",
      version: "1.0.0",
      status: "PUBLISHED",
      serverId: "warria-id",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const files = ["mod-1.jar", "mod-2.jar", "mod-3.jar"]
    for (let i = 0; i < files.length; i++) {
      const name = files[i]!
      const jar = await createValidJarBuffer(name)
      r2Store.set(`releases/rel-warria-b/mods/${name}`, jar.buffer)
      await db.insert(schema.gameReleaseFiles).values({
        id: `grf-b-${i}`,
        releaseId: "rel-warria-b",
        name,
        logicalPath: `mods/${name}`,
        category: "MOD",
        sha256: jar.sha256,
        sizeBytes: jar.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        objectKey: `releases/rel-warria-b/mods/${name}`,
        createdAt: nowIso,
      })
    }

    const { client } = createMockWingsClient()

    // 1. Plan before apply: 3 INSTALL, isPending === true
    const planBefore = await getServerReleaseSyncPlan(db, env, "warria-id", client)
    expect(planBefore.summary.toInstall).toBe(3)
    expect(planBefore.summary.toKeep).toBe(0)
    expect(planBefore.isPending).toBe(true)

    // 2. Apply release
    const syncResult = await applyServerReleaseSync(db, env, "admin-1", false, "warria-id", client)
    expect(syncResult.success).toBe(true)

    // 3. Plan after apply: 0 INSTALL, 0 UPDATE, 0 REMOVE, 3 KEEP, isPending === false
    const planAfter = await getServerReleaseSyncPlan(db, env, "warria-id", client)
    expect(planAfter.summary.toInstall).toBe(0)
    expect(planAfter.summary.toUpdate).toBe(0)
    expect(planAfter.summary.toRemove).toBe(0)
    expect(planAfter.summary.toKeep).toBe(3)
    expect(planAfter.isPending).toBe(false)
  })

  // C. MULTISERVER
  it("C. MULTISERVER: applying Warria release does NOT modify records belonging to Server B", async () => {
    const nowIso = new Date().toISOString()
    await db.insert(schema.servers).values([
      { id: "warria-id", name: "Warria", pterodactylIdentifier: "srv-warria", createdAt: nowIso, updatedAt: nowIso },
      { id: "server-b-id", name: "Server B", pterodactylIdentifier: "srv-b", createdAt: nowIso, updatedAt: nowIso },
    ])

    // Server B has pre-existing managed content
    await db.insert(schema.serverManagedContent).values({
      id: "smc-server-b",
      serverId: "server-b-id",
      managementSource: "GAME_RELEASE",
      targetPath: "mods/server-b-mod.jar",
      sha256: "hash-server-b",
      sizeBytes: 500,
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Warria has a published release
    await db.insert(schema.gameReleases).values({
      id: "rel-warria-c",
      version: "1.0.0",
      status: "PUBLISHED",
      serverId: "warria-id",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const jar = await createValidJarBuffer("warria-mod.jar")
    r2Store.set("releases/rel-warria-c/mods/warria-mod.jar", jar.buffer)

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-wc",
      releaseId: "rel-warria-c",
      name: "warria-mod.jar",
      logicalPath: "mods/warria-mod.jar",
      category: "MOD",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-warria-c/mods/warria-mod.jar",
      createdAt: nowIso,
    })

    const { client } = createMockWingsClient()
    await applyServerReleaseSync(db, env, "admin-1", false, "warria-id", client)

    // Verify Server B's record is completely unchanged
    const bRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.serverId, "server-b-id"))
      .all()
    expect(bRecords).toHaveLength(1)
    expect(bRecords[0]?.id).toBe("smc-server-b")
    expect(bRecords[0]?.targetPath).toBe("mods/server-b-mod.jar")
    expect(bRecords[0]?.sha256).toBe("hash-server-b")

    // Verify Warria record is created with warria-id
    const wRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.serverId, "warria-id"))
      .all()
    expect(wRecords).toHaveLength(1)
    expect(wRecords[0]?.serverId).toBe("warria-id")
    expect(wRecords[0]?.targetPath).toBe("mods/warria-mod.jar")
  })

  // D. NULL SELF-HEAL
  it("D. NULL SELF-HEAL: reuses and repairs orphan record with server_id = null for matching release without creating duplicate", async () => {
    const nowIso = new Date().toISOString()
    await db.insert(schema.servers).values({
      id: "warria-id",
      name: "Warria",
      pterodactylIdentifier: "srv-warria",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleases).values({
      id: "rel-warria-d",
      version: "1.0.0",
      status: "PUBLISHED",
      serverId: "warria-id",
      publishedAt: nowIso,
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const jar = await createValidJarBuffer("heal-mod.jar")
    r2Store.set("releases/rel-warria-d/mods/heal-mod.jar", jar.buffer)

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-heal",
      releaseId: "rel-warria-d",
      name: "heal-mod.jar",
      logicalPath: "mods/heal-mod.jar",
      category: "MOD",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-warria-d/mods/heal-mod.jar",
      createdAt: nowIso,
    })

    // Pre-existing broken orphan record generated by the bug (server_id = null)
    await db.insert(schema.serverManagedContent).values({
      id: "smc-broken-orphan",
      serverId: null,
      managementSource: "GAME_RELEASE",
      gameReleaseId: "rel-warria-d",
      gameReleaseFileId: "grf-heal",
      targetPath: "mods/heal-mod.jar",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Pre-existing orphan for a DIFFERENT release (must NOT be touched)
    await db.insert(schema.gameReleases).values({
      id: "rel-other-diff",
      version: "9.9.9",
      status: "ARCHIVED",
      serverId: "warria-id",
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-other",
      releaseId: "rel-other-diff",
      name: "other-mod.jar",
      logicalPath: "mods/other-mod.jar",
      category: "MOD",
      sha256: "hash-other",
      sizeBytes: 100,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: "releases/rel-other-diff/mods/other-mod.jar",
      createdAt: nowIso,
    })

    await db.insert(schema.serverManagedContent).values({
      id: "smc-other-release-orphan",
      serverId: null,
      managementSource: "GAME_RELEASE",
      gameReleaseId: "rel-other-diff",
      gameReleaseFileId: "grf-other",
      targetPath: "mods/other-mod.jar",
      sha256: "hash-other",
      sizeBytes: 100,
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const { client } = createMockWingsClient()
    const result = await applyServerReleaseSync(db, env, "admin-1", false, "warria-id", client)
    expect(result.success).toBe(true)

    // Verify: repaired and no duplicates created for Warria
    const warriaManaged = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.serverId, "warria-id"))
      .all()
    expect(warriaManaged).toHaveLength(1)
    expect(warriaManaged[0]?.id).toBe("smc-broken-orphan")
    expect(warriaManaged[0]?.serverId).toBe("warria-id")
    expect(warriaManaged[0]?.gameReleaseId).toBe("rel-warria-d")

    // Verify: orphan from different release was NOT touched or adopted
    const otherOrphan = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.id, "smc-other-release-orphan"))
      .get()
    expect(otherOrphan?.serverId).toBeNull()
    expect(otherOrphan?.gameReleaseId).toBe("rel-other-diff")
  })

  // E. PLAYERS_FIRST
  it("E. PLAYERS_FIRST: publishing sets launcherActiveReleaseId BEFORE applying server sync; server pending does not block launcher", async () => {
    const nowIso = new Date().toISOString()
    await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, "admin-1")

    await db.insert(schema.servers).values({
      id: "warria-id",
      name: "Warria",
      pterodactylIdentifier: "srv-warria",
      launcherActiveReleaseId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // 1. Prepare draft for warria-id
    const draft = await prepareGameDraft(db, "admin-1", null, env, undefined, "warria-id")

    // Add a BOTH mod (which requires server sync)
    const jar = await createValidJarBuffer("mod-pf.jar")
    r2Store.set(`releases/${draft.id}/mods/mod-pf.jar`, jar.buffer)
    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-pf",
      releaseId: draft.id,
      name: "mod-pf.jar",
      logicalPath: "mods/mod-pf.jar",
      category: "MOD",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: `releases/${draft.id}/mods/mod-pf.jar`,
      createdAt: nowIso,
    })

    // 2. Publish release
    const published = await publishGameRelease(db, env, { version: "1.1.0" }, "admin-1", undefined, "warria-id")
    expect(published.status).toBe("PUBLISHED")

    // 3. Under PLAYERS_FIRST, launcherActiveReleaseId is set immediately BEFORE server apply
    const serverRow = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, "warria-id"))
      .get()
    expect(serverRow?.launcherActiveReleaseId).toBe(published.id)

    // 4. Server changes remain pending without blocking launcher visibility
    const { client } = createMockWingsClient()
    const plan = await getServerReleaseSyncPlan(db, env, "warria-id", client)
    expect(plan.isPending).toBe(true)
  })

  // F. SERVER_FIRST
  it("F. SERVER_FIRST: publishing with pending BOTH changes does NOT activate yet; activates only after successful apply", async () => {
    const nowIso = new Date().toISOString()
    await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, "admin-1")

    await db.insert(schema.servers).values({
      id: "warria-id",
      name: "Warria",
      pterodactylIdentifier: "srv-warria",
      launcherActiveReleaseId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // 1. Prepare draft
    const draft = await prepareGameDraft(db, "admin-1", null, env, undefined, "warria-id")

    // Add a BOTH mod
    const jar = await createValidJarBuffer("mod-sf.jar")
    r2Store.set(`releases/${draft.id}/mods/mod-sf.jar`, jar.buffer)
    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-sf",
      releaseId: draft.id,
      name: "mod-sf.jar",
      logicalPath: "mods/mod-sf.jar",
      category: "MOD",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "BOTH",
      objectKey: `releases/${draft.id}/mods/mod-sf.jar`,
      createdAt: nowIso,
    })

    // 2. Publish release
    const published = await publishGameRelease(db, env, { version: "1.2.0" }, "admin-1", undefined, "warria-id")
    expect(published.status).toBe("PUBLISHED")

    // Verify: launcherActiveReleaseId is STILL null (not activated yet)
    const serverBefore = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, "warria-id"))
      .get()
    expect(serverBefore?.launcherActiveReleaseId).toBeNull()

    const { client } = createMockWingsClient()
    const planBefore = await getServerReleaseSyncPlan(db, env, "warria-id", client)
    expect(planBefore.isPending).toBe(true)

    // 3. Apply server sync
    const syncRes = await applyServerReleaseSync(db, env, "admin-1", false, "warria-id", client)
    expect(syncRes.success).toBe(true)

    // Verify: launcherActiveReleaseId is NOW updated to published.id
    const serverAfter = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, "warria-id"))
      .get()
    expect(serverAfter?.launcherActiveReleaseId).toBe(published.id)
  })

  // G. SERVER_FIRST SIN CAMBIOS
  it("G. SERVER_FIRST SIN CAMBIOS: release with 0 server-relevant changes activates immediately upon publish", async () => {
    const nowIso = new Date().toISOString()
    await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, "admin-1")

    await db.insert(schema.servers).values({
      id: "warria-id",
      name: "Warria",
      pterodactylIdentifier: "srv-warria",
      launcherActiveReleaseId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // 1. Prepare draft
    const draft = await prepareGameDraft(db, "admin-1", null, env, undefined, "warria-id")

    // Add only a CLIENT-only mod (0 server-relevant changes)
    const jar = await createValidJarBuffer("mod-client-only.jar")
    r2Store.set(`releases/${draft.id}/mods/mod-client-only.jar`, jar.buffer)
    await db.insert(schema.gameReleaseFiles).values({
      id: "grf-client-only",
      releaseId: draft.id,
      name: "mod-client-only.jar",
      logicalPath: "mods/mod-client-only.jar",
      category: "MOD",
      sha256: jar.sha256,
      sizeBytes: jar.buffer.byteLength,
      policy: "NO_MODIFICABLE",
      isDirectory: false,
      sourceEnvironment: "CLIENT",
      objectKey: `releases/${draft.id}/mods/mod-client-only.jar`,
      createdAt: nowIso,
    })

    // 2. Publish release
    const published = await publishGameRelease(db, env, { version: "1.3.0" }, "admin-1", undefined, "warria-id")
    expect(published.status).toBe("PUBLISHED")

    // Verify: launcherActiveReleaseId is activated IMMEDIATELY because 0 server changes required
    const serverRow = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, "warria-id"))
      .get()
    expect(serverRow?.launcherActiveReleaseId).toBe(published.id)
  })

  it("H. Generates deterministic official client integrity manifest and writes to hikat/integrity.json", async () => {
    const nowIso = new Date().toISOString()
    const relId = "rel-integrity-test"
    await db.insert(schema.gameReleases).values({
      id: relId,
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      status: "PUBLISHED",
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Directory policies: config is MODIFICABLE, mods is NO_MODIFICABLE
    await db.insert(schema.gameReleaseFiles).values([
      {
        id: "dir-mods",
        releaseId: relId,
        name: "mods",
        logicalPath: "mods",
        category: "MOD",
        sha256: "",
        sizeBytes: 0,
        policy: "NO_MODIFICABLE",
        isDirectory: true,
        createdAt: nowIso,
      },
      {
        id: "dir-config",
        releaseId: relId,
        name: "config",
        logicalPath: "config",
        category: "CONFIG",
        sha256: "",
        sizeBytes: 0,
        policy: "MODIFICABLE",
        isDirectory: true,
        createdAt: nowIso,
      },
      // Client-expected NO_MODIFICABLE file 1
      {
        id: "file-mod-b",
        releaseId: relId,
        name: "b-mod.jar",
        logicalPath: "mods/b-mod.jar",
        category: "MOD",
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        sizeBytes: 200,
        policy: null, // inherits NO_MODIFICABLE
        isDirectory: false,
        sourceEnvironment: "BOTH",
        createdAt: nowIso,
      },
      // Client-expected NO_MODIFICABLE file 2
      {
        id: "file-mod-a",
        releaseId: relId,
        name: "a-mod.jar",
        logicalPath: "mods/a-mod.jar",
        category: "MOD",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sizeBytes: 100,
        policy: null, // inherits NO_MODIFICABLE
        isDirectory: false,
        sourceEnvironment: "CLIENT",
        createdAt: nowIso,
      },
      // Server-only mod (MUST NOT participate in client integrity manifest)
      {
        id: "file-server-only",
        releaseId: relId,
        name: "server-only.jar",
        logicalPath: "mods/server-only.jar",
        category: "MOD",
        sha256: "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss",
        sizeBytes: 500,
        policy: "NO_MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "SERVER",
        createdAt: nowIso,
      },
      // MODIFICABLE config file (MUST NOT participate in client integrity manifest)
      {
        id: "file-config",
        releaseId: relId,
        name: "options.toml",
        logicalPath: "config/options.toml",
        category: "CONFIG",
        sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        sizeBytes: 50,
        policy: "MODIFICABLE",
        isDirectory: false,
        sourceEnvironment: "BOTH",
        createdAt: nowIso,
      },
    ])

    const rel = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, relId)).get()
    const manifest = await generateOfficialServerIntegrityManifest(db, rel)

    expect(manifest.version).toBe("2.0.0")
    expect(manifest.releaseId).toBe(relId)
    expect(manifest.files).toHaveLength(2)
    // Sorted alphabetically: a-mod.jar then b-mod.jar
    expect(manifest.files[0].path).toBe("mods/a-mod.jar")
    expect(manifest.files[1].path).toBe("mods/b-mod.jar")
    expect(manifest.officialFingerprint).toBeDefined()
    expect(manifest.officialFingerprint.length).toBe(64) // SHA-256 hex string

    // Test writing to pterodactyl client
    const writeFileSpy = vi.fn().mockResolvedValue(undefined)
    const createFolderSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = {
      createFolder: createFolderSpy,
      writeFile: writeFileSpy,
    } as any

    await mockClient.createFolder("/", "hikat")
    await mockClient.writeFile("hikat/integrity.json", JSON.stringify(manifest, null, 2))

    expect(createFolderSpy).toHaveBeenCalledWith("/", "hikat")
    expect(writeFileSpy).toHaveBeenCalledWith("hikat/integrity.json", expect.stringContaining("2.0.0"))
  })
})
