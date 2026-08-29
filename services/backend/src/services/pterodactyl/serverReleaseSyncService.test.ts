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
    expect(plan.blockReason).toBe("No se pudo confirmar que el servidor esté apagado.")
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
})
