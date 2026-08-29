import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  getServerManagedContent,
  installServerContentPlan,
  removeServerManagedContent,
} from "./serverContentService"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

describe("Shard 08D: Server Content Service & Direct Content Management Tests", () => {
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

  // Test 1: Drift Detection in getServerManagedContent
  it("getServerManagedContent performs drift detection, marking INSTALLED or MISSING according to Wings file system", async () => {
    const nowIso = new Date().toISOString()

    // Insert two tracked records in D1
    await db.insert(schema.serverManagedContent).values([
      {
        id: "smc-1",
        managementSource: "SERVER_DIRECT",
        provider: "MODRINTH",
        projectId: "chunky-id",
        contentType: "MOD",
        environment: "SERVER",
        targetPath: "mods/chunky.jar",
        sha256: "chunkyhash",
        sizeBytes: 50000,
        name: "chunky.jar",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "smc-2",
        managementSource: "GAME_RELEASE",
        provider: "MODRINTH",
        projectId: "voicechat-id",
        contentType: "MOD",
        environment: "BOTH",
        targetPath: "mods/simple-voice-chat.jar",
        sha256: "voicechathash",
        sizeBytes: 100000,
        name: "simple-voice-chat.jar",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])

    // Mock Wings client: "chunky.jar" exists on disk, but "simple-voice-chat.jar" was manually deleted outside
    const mockClient = {
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir.includes("mods")) {
          return Promise.resolve({
            data: [
              { attributes: { name: "chunky.jar", is_file: true } },
            ],
          })
        }
        return Promise.resolve({ data: [] })
      }),
    }

    const items = await getServerManagedContent(db, env, mockClient as any)

    expect(items).toHaveLength(2)
    const chunkyItem = items.find((i) => i.id === "smc-1")
    const voiceItem = items.find((i) => i.id === "smc-2")

    expect(chunkyItem?.status).toBe("INSTALLED")
    expect(voiceItem?.status).toBe("MISSING")
  })

  // Test 2: Direct Server Content Installation with Checksum and Magic Bytes
  it("installServerContentPlan validates magic bytes and checksum, writes to Wings, and tracks in D1", async () => {
    // Create valid ZIP/JAR bytes (PK\x03\x04 header)
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00])

    // Compute real SHA-256 for jarBytes
    const hashBuffer = await crypto.subtle.digest("SHA-256", jarBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const realSha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")

    const writeFileSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=survival_2026"),
      listDirectory: vi.fn().mockResolvedValue({ data: [] }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      writeFile: writeFileSpy,
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "spark-id",
          projectName: "spark",
          versionId: "ver-spark-1",
          versionNumber: "1.10.53",
          filename: "spark-1.10.53-neoforge.jar",
          sizeBytes: jarBytes.length,
          sha256: realSha256,
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/spark-1.10.53-neoforge.jar",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: jarBytes.length,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    const mockAdapter = {
      getVersion: vi.fn().mockResolvedValue({
        id: "ver-spark-1",
        filename: "spark-1.10.53-neoforge.jar",
        downloadUrl: "https://cdn.modrinth.com/data/spark/spark.jar",
        hashes: {},
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    // Global fetch mock for provider download
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(jarBytes, {
        status: 200,
        headers: { "Content-Type": "application/java-archive" },
      }),
    )

    const result = await installServerContentPlan(
      db,
      env,
      {
        provider: "MODRINTH",
        projectId: "spark-id",
        versionId: "ver-spark-1",
        contentType: "MOD",
      },
      "admin-1",
      mockClient as any,
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("spark-1.10.53-neoforge.jar")
    expect(result[0]?.managementSource).toBe("SERVER_DIRECT")

    // Check that writeFile was called with binary bytes to /mods/spark-1.10.53-neoforge.jar
    expect(writeFileSpy).toHaveBeenCalledWith("/mods/spark-1.10.53-neoforge.jar", expect.any(Uint8Array))

    // Verify D1 tracking
    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.projectId).toBe("spark-id")
    expect(tracked[0]?.targetPath).toBe("mods/spark-1.10.53-neoforge.jar")

    fetchSpy.mockRestore()
  })

  // Test 3: Untracked Physical File Collision Rejection
  it("installServerContentPlan detects and blocks untracked physical file collisions with CONFLICT", async () => {
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir.includes("mods")) {
          // Untracked physical file exists
          return Promise.resolve({
            data: [{ attributes: { name: "spark.jar", is_file: true } }],
          })
        }
        return Promise.resolve({ data: [] })
      }),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "spark-id",
          projectName: "spark",
          versionId: "ver-1",
          versionNumber: "1.0.0",
          filename: "spark.jar",
          sizeBytes: 1000,
          sha256: "hash123",
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/spark.jar",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: 1000,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    await expect(
      installServerContentPlan(
        db,
        env,
        {
          provider: "MODRINTH",
          projectId: "spark-id",
          versionId: "ver-1",
          contentType: "MOD",
        },
        "admin-1",
        mockClient as any,
      ),
    ).rejects.toThrow("Ya existe un archivo manual en esta ruta")
  })

  // Test 4: Removal Protection for GAME_RELEASE and Safe Deletion for SERVER_DIRECT
  it("removeServerManagedContent blocks removing GAME_RELEASE and deletes SERVER_DIRECT with D1 cascade", async () => {
    const nowIso = new Date().toISOString()

    // 1. Insert GAME_RELEASE record
    await db.insert(schema.serverManagedContent).values({
      id: "smc-release-1",
      managementSource: "GAME_RELEASE",
      targetPath: "mods/release-mod.jar",
      sha256: "relhash",
      sizeBytes: 1000,
      name: "release-mod.jar",
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // 2. Insert SERVER_DIRECT record
    await db.insert(schema.serverManagedContent).values({
      id: "smc-direct-1",
      managementSource: "SERVER_DIRECT",
      targetPath: "mods/direct-mod.jar",
      sha256: "dirhash",
      sizeBytes: 2000,
      name: "direct-mod.jar",
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const deleteFilesSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      deleteFiles: deleteFilesSpy,
      listDirectory: vi.fn().mockResolvedValue({
        data: [{ attributes: { name: "direct-mod.jar", is_file: true } }],
      }),
    }

    // Attempting to remove GAME_RELEASE throws
    await expect(
      removeServerManagedContent(db, env, "smc-release-1", "admin-1", mockClient as any),
    ).rejects.toThrow("Este archivo pertenece a la release del modpack. Modifícalo desde Juego → Actualizaciones.")

    expect(deleteFilesSpy).not.toHaveBeenCalled()

    // Removing SERVER_DIRECT succeeds, calls deleteFiles on parent dir, and deletes from D1
    const success = await removeServerManagedContent(db, env, "smc-direct-1", "admin-1", mockClient as any)
    expect(success).toBe(true)
    expect(deleteFilesSpy).toHaveBeenCalledWith("/mods", ["direct-mod.jar"])

    const remaining = await db.select().from(schema.serverManagedContent)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe("smc-release-1")
  })

  // Test 5: MOD Operations Require Server OFFLINE Status
  it("installServerContentPlan and removeServerManagedContent require server to be OFFLINE for MOD content", async () => {
    const nowIso = new Date().toISOString()
    await db.insert(schema.serverManagedContent).values({
      id: "smc-online-mod",
      managementSource: "SERVER_DIRECT",
      targetPath: "mods/online-mod.jar",
      sha256: "hashmod",
      sizeBytes: 1000,
      name: "online-mod.jar",
      contentType: "MOD",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const mockRunningClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "running", resources: { memory_bytes: 500, cpu_absolute: 10, disk_bytes: 500, uptime: 100 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "spark-id",
          projectName: "spark",
          versionId: "ver-1",
          versionNumber: "1.0.0",
          filename: "spark.jar",
          sizeBytes: 1000,
          sha256: "hash123",
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/spark.jar",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: 1000,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "spark-id", versionId: "ver-1", contentType: "MOD" },
        "admin-1",
        mockRunningClient as any,
      ),
    ).rejects.toThrow("Apaga el servidor antes de instalar o actualizar mods.")

    await expect(
      removeServerManagedContent(db, env, "smc-online-mod", "admin-1", mockRunningClient as any),
    ).rejects.toThrow("Apaga el servidor antes de eliminar mods.")
  })

  // Test 6: Fail-closed when Directory Listing Fails on installServerContentPlan
  it("Shard 8D: installServerContentPlan fails closed without mutating filesystem if directory listing fails", async () => {
    const writeFileSpy = vi.fn()
    const mockFailingClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockRejectedValue(new Error("Wings 500 Network Error")),
      writeFile: writeFileSpy,
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "spark-id",
          projectName: "spark",
          versionId: "ver-1",
          versionNumber: "1.0.0",
          filename: "spark.jar",
          sizeBytes: 1000,
          sha256: "hash123",
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/spark.jar",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: 1000,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "spark-id", versionId: "ver-1", contentType: "MOD" },
        "admin-1",
        mockFailingClient as any,
      ),
    ).rejects.toThrow("No se pudo verificar de forma segura el contenido actual del servidor. No se realizaron cambios.")

    expect(writeFileSpy).not.toHaveBeenCalled()
  })

  // Test 7: D1 Error Compensation after Write
  it("Shard 8D: installServerContentPlan attempts compensation deletion if D1 insert fails after physical write", async () => {
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00])
    const hashBuffer = await crypto.subtle.digest("SHA-256", jarBytes)
    const realSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("")

    const deleteFilesSpy = vi.fn()
    const physicalFiles = new Set<string>()
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir.includes("mods")) {
          return Promise.resolve({
            data: Array.from(physicalFiles).map((name) => ({ attributes: { name, is_file: true } })),
          })
        }
        return Promise.resolve({ data: [] })
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockImplementation((path: string) => {
        physicalFiles.add(path.split("/").pop()!)
        return Promise.resolve(undefined)
      }),
      deleteFiles: deleteFilesSpy.mockImplementation((_dir: string, files: string[]) => {
        for (const f of files) physicalFiles.delete(f)
        return Promise.resolve(undefined)
      }),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "spark-comp-id",
          projectName: "spark-comp",
          versionId: "ver-comp-1",
          versionNumber: "1.0.0",
          filename: "spark-comp.jar",
          sizeBytes: jarBytes.length,
          sha256: realSha256,
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/spark-comp.jar",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: jarBytes.length,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    const mockAdapter = {
      getVersion: vi.fn().mockResolvedValue({
        id: "ver-comp-1",
        filename: "spark-comp.jar",
        downloadUrl: "https://cdn.modrinth.com/data/spark/spark-comp.jar",
        hashes: {},
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(jarBytes, { status: 200, headers: { "Content-Type": "application/java-archive" } }),
    )

    // Force D1 insert to fail only for serverManagedContent
    const originalInsert = db.insert.bind(db)
    vi.spyOn(db, "insert").mockImplementation((table: any) => {
      if (table === schema.serverManagedContent) {
        return {
          values: () => {
            throw new Error("D1 constraint violation or network timeout")
          },
        } as any
      }
      return originalInsert(table)
    })

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "spark-comp-id", versionId: "ver-comp-1", contentType: "MOD" },
        "admin-1",
        mockClient as any,
      ),
    ).rejects.toThrow("D1 constraint violation or network timeout")

    // Compensation delete must have been called
    expect(deleteFilesSpy).toHaveBeenCalledWith("/mods", ["spark-comp.jar"])

    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })
})
