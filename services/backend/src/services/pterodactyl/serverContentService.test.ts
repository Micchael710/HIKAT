import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  getServerManagedContent,
  installServerContentPlan,
  installServerContentPlansBatch,
  removeServerManagedContent,
  MAX_ROOT_PLANS_PER_FREE_INVOCATION,
  MAX_SERVER_DIRECT_RESOLVED_FILES_FREE,
  resolveProviderChecksum,
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

    const pullFileSpy = vi.fn().mockResolvedValue(undefined)
    const renameFileSpy = vi.fn().mockResolvedValue(undefined)
    let pulledTempFile = ""

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=survival_2026"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (pulledTempFile) {
          return Promise.resolve({
            data: [
              {
                attributes: {
                  name: pulledTempFile,
                  size: jarBytes.length,
                  is_file: true,
                },
              },
            ],
          })
        }
        return Promise.resolve({ data: [] })
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      pullFile: pullFileSpy.mockImplementation((params: any) => {
        pulledTempFile = params.filename
        return Promise.resolve(undefined)
      }),
      getFileDownload: vi.fn().mockResolvedValue({ attributes: { url: "https://signed.wings.download/file" } }),
      renameFile: renameFileSpy,
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

    // Global fetch mock for signed download URL verification
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

    // Check that pullFile was called with remote URL to temp filename, and renameFile was called
    expect(pullFileSpy).toHaveBeenCalledWith({
      url: "https://cdn.modrinth.com/data/spark/spark.jar",
      directory: "/mods",
      filename: expect.stringMatching(/^\.hikat-[a-f0-9-]+-spark-1\.10\.53-neoforge\.jar$/),
      foreground: true,
    })
    expect(renameFileSpy).toHaveBeenCalledWith(
      "/mods",
      expect.stringMatching(/^\.hikat-[a-f0-9-]+-spark-1\.10\.53-neoforge\.jar$/),
      "spark-1.10.53-neoforge.jar",
    )

    // Verify D1 tracking
    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.projectId).toBe("spark-id")
    expect(tracked[0]?.targetPath).toBe("mods/spark-1.10.53-neoforge.jar")
    expect(tracked[0]?.sha256).toBe(realSha256)
    expect(tracked[0]?.providerHashAlgorithm).toBe("SHA-256")
    expect(tracked[0]?.providerHash).toBe(realSha256)

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
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22])
    const hashBuffer = await crypto.subtle.digest("SHA-256", jarBytes)
    const realSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("")

    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "spark-id",
          projectName: "spark",
          versionId: "ver-1",
          versionNumber: "1.0.0",
          filename: "spark.jar",
          sizeBytes: jarBytes.length,
          sha256: realSha256,
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
      totalDownloadSizeBytes: jarBytes.length,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    const mockAdapter = {
      getVersion: vi.fn().mockResolvedValue({
        id: "ver-1",
        filename: "spark.jar",
        downloadUrl: "https://cdn.modrinth.com/data/spark/spark.jar",
        hashes: {},
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(jarBytes.slice(0), { status: 200, headers: { "Content-Type": "application/java-archive" } })
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

    fetchSpy.mockRestore()
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
    let pulledCompTempFile = ""
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      pullFile: vi.fn().mockImplementation((params: any) => {
        pulledCompTempFile = params.filename
        return Promise.resolve(undefined)
      }),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        const files: Array<{ attributes: { name: string; size: number; is_file: boolean } }> = []
        if (pulledCompTempFile) {
          files.push({ attributes: { name: pulledCompTempFile, size: jarBytes.length, is_file: true } })
        }
        for (const f of physicalFiles) {
          files.push({ attributes: { name: f, size: jarBytes.length, is_file: true } })
        }
        return Promise.resolve({ data: files })
      }),
      getFileDownload: vi.fn().mockResolvedValue({ attributes: { url: "https://signed.wings.download/file" } }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn().mockImplementation((_dir: string, from: string, to: string) => {
        physicalFiles.add(to)
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

    // Force D1 batch commit to fail
    vi.spyOn(db, "batch").mockRejectedValue(new Error("D1 constraint violation or network timeout"))

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

  // Test 8: installServerContentPlan rejects when unmanaged physical file has different SHA-256
  it("Shard 8D: installServerContentPlan rejects installation with CONFLICT when unmanaged file has different SHA-256", async () => {
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22])
    const hashBuffer = await crypto.subtle.digest("SHA-256", jarBytes)
    const realSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("")

    const manualBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0x99])

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
            data: [{ attributes: { name: "manual-mod.jar", is_file: true } }],
          })
        }
        return Promise.resolve({ data: [] })
      }),
      getFileDownload: vi.fn().mockResolvedValue({
        attributes: { url: "https://wings.hikat.net/signed-download/mods/manual-mod.jar" },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "manual-mod-id",
          projectName: "manual-mod",
          versionId: "ver-manual-1",
          versionNumber: "1.0.0",
          filename: "manual-mod.jar",
          sizeBytes: jarBytes.length,
          sha256: realSha256,
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/manual-mod.jar",
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
        id: "ver-manual-1",
        filename: "manual-mod.jar",
        downloadUrl: "https://cdn.modrinth.com/data/manual/manual-mod.jar",
        hashes: {},
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    // Download for version returns jarBytes, while download for physical file returns manualBytes
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      if (String(url).includes("signed-download")) {
        return new Response(manualBytes, { status: 200 })
      }
      return new Response(jarBytes, { status: 200, headers: { "Content-Type": "application/java-archive" } })
    })

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "manual-mod-id", versionId: "ver-manual-1", contentType: "MOD" },
        "admin-1",
        mockClient as any,
      ),
    ).rejects.toThrow("Ya existe un archivo manual en esta ruta (mods/manual-mod.jar). HiKAT no lo reemplazará ni adoptará automáticamente.")

    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // Test 9: installServerContentPlan rejects with CONFLICT even when unmanaged physical file matches exact SHA-256 (No auto-adoption)
  it("Shard 8D: installServerContentPlan rejects with CONFLICT even when unmanaged physical file matches exact SHA-256 (No auto-adoption)", async () => {
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x33, 0x44])
    const hashBuffer = await crypto.subtle.digest("SHA-256", jarBytes)
    const realSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("")

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
            data: [{ attributes: { name: "matching-mod.jar", is_file: true } }],
          })
        }
        return Promise.resolve({ data: [] })
      }),
      getFileDownload: vi.fn().mockResolvedValue({
        attributes: { url: "https://wings.hikat.net/signed-download/mods/matching-mod.jar" },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "matching-mod-id",
          projectName: "matching-mod",
          versionId: "ver-match-1",
          versionNumber: "1.0.0",
          filename: "matching-mod.jar",
          sizeBytes: jarBytes.length,
          sha256: realSha256,
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/matching-mod.jar",
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
        id: "ver-match-1",
        filename: "matching-mod.jar",
        downloadUrl: "https://cdn.modrinth.com/data/matching/matching-mod.jar",
        hashes: {},
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(jarBytes.slice(0), { status: 200, headers: { "Content-Type": "application/java-archive" } })
    })

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "matching-mod-id", versionId: "ver-match-1", contentType: "MOD" },
        "admin-1",
        mockClient as any,
      ),
    ).rejects.toThrow("Ya existe un archivo manual en esta ruta (mods/matching-mod.jar). HiKAT no lo reemplazará ni adoptará automáticamente.")

    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(0)

    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // Test 10: resolveProviderChecksum prioritizes hashes correctly and throws if none
  describe("resolveProviderChecksum", () => {
    it("prioritizes SHA-256 and sets sha256 to the real hash", () => {
      const res = resolveProviderChecksum({
        sha256: "RealSha256Hash",
        sha512: "sha512hash",
        sha1: "sha1hash",
        md5: "md5hash",
      })
      expect(res.algorithm).toBe("SHA-256")
      expect(res.hash).toBe("realsha256hash")
      expect(res.sha256).toBe("realsha256hash")
    })

    it("falls back to SHA-512 and sets sha256 to null", () => {
      const res = resolveProviderChecksum({
        sha512: "SHA512HASH",
        sha1: "sha1hash",
      })
      expect(res.algorithm).toBe("SHA-512")
      expect(res.hash).toBe("sha512hash")
      expect(res.sha256).toBeNull()
    })

    it("falls back to SHA-1 and sets sha256 to null", () => {
      const res = resolveProviderChecksum({
        sha1: "SHA1HASH",
        md5: "md5hash",
      })
      expect(res.algorithm).toBe("SHA-1")
      expect(res.hash).toBe("sha1hash")
      expect(res.sha256).toBeNull()
    })

    it("falls back to MD5 and sets sha256 to null", () => {
      const res = resolveProviderChecksum({
        md5: "MD5HASH",
      })
      expect(res.algorithm).toBe("MD5")
      expect(res.hash).toBe("md5hash")
      expect(res.sha256).toBeNull()
    })

    it("throws VALIDATION_ERROR when no checksum is provided", () => {
      expect(() => resolveProviderChecksum({}, null)).toThrow(
        "El proveedor no suministra ningún checksum para el archivo.",
      )
    })
  })

  // Test 11: Free limit: batch with > 1 root throws VALIDATION_ERROR
  it("installServerContentPlansBatch rejects input with > 1 root plan in Workers Free", async () => {
    await expect(
      installServerContentPlansBatch(
        db,
        env,
        {
          plans: [
            { provider: "MODRINTH", projectId: "mod-1", versionId: "v1", contentType: "MOD" },
            { provider: "MODRINTH", projectId: "mod-2", versionId: "v2", contentType: "MOD" },
          ],
        },
        "admin-1",
      ),
    ).rejects.toThrow("Solo se permite procesar una raíz por invocación en el plan gratuito de Workers. Se enviaron 2 planes.")
  })

  // Test 12: Free limit: root with > 3 resolved files throws VALIDATION_ERROR
  it("installServerContentPlansBatch rejects plan when resolved items exceed MAX_SERVER_DIRECT_RESOLVED_FILES_FREE (3)", async () => {
    const { modProviderManager } = await import("../providers/modProviderManager")
    const mockPlanItems = Array.from({ length: 4 }, (_, i) => ({
      provider: "MODRINTH" as const,
      projectId: `mod-${i}`,
      projectName: `mod-${i}`,
      versionId: `ver-${i}`,
      versionNumber: "1.0.0",
      filename: `mod-${i}.jar`,
      sizeBytes: 1000,
      sha256: `hash-${i}`,
      contentType: "MOD" as const,
      environment: "SERVER" as const,
      targetPath: `mods/mod-${i}.jar`,
      action: "INSTALL" as const,
      isRoot: i === 0,
      isDependency: i > 0,
      isRequired: true,
      isInstalled: false,
      availableCompatibleVersions: [],
    }))

    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: mockPlanItems,
      totalDownloadSizeBytes: 4000,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    const mockAdapter = {
      getVersion: vi.fn().mockImplementation((_env, projectId, versionId) => Promise.resolve({
        id: versionId,
        filename: `${projectId}.jar`,
        downloadUrl: `https://cdn.example.com/${projectId}.jar`,
        hashes: { sha256: `hash-${projectId}` },
      })),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "mod-0", versionId: "ver-0", contentType: "MOD" },
        "admin-1",
      ),
    ).rejects.toThrow("superando el límite de 3 archivos por invocación en el plan gratuito de Workers.")

    vi.restoreAllMocks()
  })

  // Test 13: Data Pack recalculates authoritative targetPath with real worldName
  it("installServerContentPlan recalculates targetPath with real level-name for Data Packs", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const hashBuffer = await crypto.subtle.digest("SHA-256", zipBytes)
    const realSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("")

    const pullFileSpy = vi.fn().mockResolvedValue(undefined)
    const renameFileSpy = vi.fn().mockResolvedValue(undefined)
    const createFolderSpy = vi.fn().mockResolvedValue(undefined)
    let pulledTemp = ""

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=survival_2026\nmotd=A Minecraft Server"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (pulledTemp && dir.includes("survival_2026/datapacks")) {
          return Promise.resolve({
            data: [{ attributes: { name: pulledTemp, size: zipBytes.length, is_file: true } }],
          })
        }
        return Promise.resolve({ data: [] })
      }),
      createFolder: createFolderSpy,
      pullFile: pullFileSpy.mockImplementation((p: any) => {
        pulledTemp = p.filename
        return Promise.resolve(undefined)
      }),
      getFileDownload: vi.fn().mockResolvedValue({ attributes: { url: "https://wings.download/datapack" } }),
      renameFile: renameFileSpy,
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "terralith-id",
          projectName: "terralith",
          versionId: "ver-t-1",
          versionNumber: "2.5.4",
          filename: "terralith.zip",
          sizeBytes: zipBytes.length,
          sha256: realSha256,
          contentType: "DATA_PACK",
          environment: "SERVER",
          // Plan originally resolved with default "world/datapacks/terralith.zip"
          targetPath: "world/datapacks/terralith.zip",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: zipBytes.length,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    const mockAdapter = {
      getVersion: vi.fn().mockResolvedValue({
        id: "ver-t-1",
        filename: "terralith.zip",
        downloadUrl: "https://cdn.example.com/terralith.zip",
        hashes: { sha256: realSha256 },
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      // Verify Range: bytes=0-3 is requested
      expect(init?.headers).toEqual({ Range: "bytes=0-3" })
      return new Response(zipBytes.slice(0, 4), { status: 200 })
    })

    const result = await installServerContentPlan(
      db,
      env,
      { provider: "MODRINTH", projectId: "terralith-id", versionId: "ver-t-1", contentType: "DATA_PACK" },
      "admin-1",
      mockClient as any,
    )

    // Verify folder created for survival_2026/datapacks (never world/datapacks)
    expect(createFolderSpy).toHaveBeenCalledWith("/survival_2026", "datapacks")

    // Verify pullFile used /survival_2026/datapacks with foreground: true
    expect(pullFileSpy).toHaveBeenCalledWith({
      url: "https://cdn.example.com/terralith.zip",
      directory: "/survival_2026/datapacks",
      filename: expect.stringMatching(/^\.hikat-[a-f0-9-]+-terralith\.zip$/),
      foreground: true,
    })

    // Verify renameFile in /survival_2026/datapacks
    expect(renameFileSpy).toHaveBeenCalledWith(
      "/survival_2026/datapacks",
      expect.stringMatching(/^\.hikat-[a-f0-9-]+-terralith\.zip$/),
      "terralith.zip",
    )

    // Verify D1 record has survival_2026/datapacks/terralith.zip
    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.targetPath).toBe("survival_2026/datapacks/terralith.zip")
    expect(tracked[0]?.targetPath).not.toContain("world/datapacks")

    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // Test 14: Provider with SHA-512 only results in sha256 = null, providerHashAlgorithm = SHA-512, providerHash persisted
  it("installServerContentPlan persists provider SHA-512 and sets sha256 to null when provider has no SHA-256", async () => {
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x12, 0x34])
    const sha512Hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"

    const pullFileSpy = vi.fn().mockResolvedValue(undefined)
    let pulledTemp = ""

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (pulledTemp && dir.includes("mods")) {
          return Promise.resolve({
            data: [{ attributes: { name: pulledTemp, size: jarBytes.length, is_file: true } }],
          })
        }
        return Promise.resolve({ data: [] })
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      pullFile: pullFileSpy.mockImplementation((p: any) => {
        pulledTemp = p.filename
        return Promise.resolve(undefined)
      }),
      getFileDownload: vi.fn().mockResolvedValue({ attributes: { url: "https://wings.download/sha512mod" } }),
      renameFile: vi.fn().mockResolvedValue(undefined),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "sha512-mod",
          projectName: "sha512-mod",
          versionId: "ver-512",
          versionNumber: "1.0",
          filename: "sha512-mod.jar",
          sizeBytes: jarBytes.length,
          sha256: null,
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/sha512-mod.jar",
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
        id: "ver-512",
        filename: "sha512-mod.jar",
        downloadUrl: "https://cdn.example.com/sha512-mod.jar",
        hashes: { sha512: sha512Hash },
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(jarBytes.slice(0, 4), { status: 200 }),
    )

    const result = await installServerContentPlan(
      db,
      env,
      { provider: "MODRINTH", projectId: "sha512-mod", versionId: "ver-512", contentType: "MOD" },
      "admin-1",
      mockClient as any,
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.sha256).toBeNull()
    expect(result[0]?.providerHashAlgorithm).toBe("SHA-512")
    expect(result[0]?.providerHash).toBe(sha512Hash)

    // Verify persisted record in D1
    const tracked = await db.select().from(schema.serverManagedContent)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]?.sha256).toBeNull()
    expect(tracked[0]?.providerHashAlgorithm).toBe("SHA-512")
    expect(tracked[0]?.providerHash).toBe(sha512Hash)

    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // Test 15: Single listDirectory check and cancel reader immediately on header verification
  it("installServerContentPlan calls listDirectory only once after pull (no polling) and cancels stream reader after reading 4 bytes", async () => {
    const jarBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x55, 0x66, 0x77, 0x88])
    let pulledTemp = ""
    let callsBetweenPullAndRename = 0
    let isBetweenPullAndRename = false

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (isBetweenPullAndRename) {
          callsBetweenPullAndRename++
        }
        if (pulledTemp && dir.includes("mods")) {
          return Promise.resolve({
            data: [{ attributes: { name: pulledTemp, size: jarBytes.length, is_file: true } }],
          })
        }
        return Promise.resolve({ data: [] })
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      pullFile: vi.fn().mockImplementation((p: any) => {
        pulledTemp = p.filename
        isBetweenPullAndRename = true
        return Promise.resolve(undefined)
      }),
      getFileDownload: vi.fn().mockResolvedValue({ attributes: { url: "https://wings.download/mod" } }),
      renameFile: vi.fn().mockImplementation(() => {
        isBetweenPullAndRename = false
        return Promise.resolve(undefined)
      }),
    }

    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "single-list-mod",
          projectName: "single-list-mod",
          versionId: "ver-single",
          versionNumber: "1.0",
          filename: "single-mod.jar",
          sizeBytes: jarBytes.length,
          sha256: null,
          contentType: "MOD",
          environment: "SERVER",
          targetPath: "mods/single-mod.jar",
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
        id: "ver-single",
        filename: "single-mod.jar",
        downloadUrl: "https://cdn.example.com/single-mod.jar",
        hashes: { md5: "abcdef0123456789abcdef0123456789" },
      }),
    }
    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    let streamCancelled = false
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(jarBytes)
        // Stream remains open with remaining data so reader.cancel() actively cancels the stream
      },
      cancel() {
        streamCancelled = true
      },
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(mockStream, { status: 200 }),
    )

    await installServerContentPlan(
      db,
      env,
      { provider: "MODRINTH", projectId: "single-list-mod", versionId: "ver-single", contentType: "MOD" },
      "admin-1",
      mockClient as any,
    )

    // Exactly 1 listDirectory call for verifying the downloaded temp file (no polling loop!)
    expect(callsBetweenPullAndRename).toBe(1)
    // Stream cancel was called to avoid downloading the remaining binary
    expect(streamCancelled).toBe(true)

    fetchSpy.mockRestore()
    vi.restoreAllMocks()
  })

  // Test 16: MOD with environment BOTH is rejected and instructed to use Juego → Actualizaciones
  it("installServerContentPlan rejects MOD with environment BOTH", async () => {
    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "voicechat",
          projectName: "Simple Voice Chat",
          versionId: "ver-vc",
          versionNumber: "1.0",
          filename: "voicechat.jar",
          sizeBytes: 1000,
          sha256: "hashvc",
          contentType: "MOD",
          environment: "BOTH",
          targetPath: "mods/voicechat.jar",
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
        { provider: "MODRINTH", projectId: "voicechat", versionId: "ver-vc", contentType: "MOD" },
        "admin-1",
      ),
    ).rejects.toThrow("es de entorno BOTH y no puede instalarse directamente en el servidor. Añádelo desde Juego → Actualizaciones.")

    vi.restoreAllMocks()
  })

  // Test 16B: DATA_PACK with environment BOTH is NOT rejected by serverContentService
  it("installServerContentPlan does NOT reject DATA_PACK with environment BOTH", async () => {
    const { modProviderManager } = await import("../providers/modProviderManager")
    vi.spyOn(modProviderManager, "resolveServerInstallationPlan").mockResolvedValue({
      items: [
        {
          provider: "MODRINTH",
          projectId: "terralith-dp",
          projectName: "Terralith",
          versionId: "ver-dp",
          versionNumber: "2.5",
          filename: "terralith.zip",
          sizeBytes: 2000,
          sha256: "hashdp",
          contentType: "DATA_PACK",
          environment: "BOTH",
          targetPath: "world/datapacks/terralith.zip",
          action: "INSTALL",
          isRoot: true,
          isDependency: false,
          isRequired: true,
          isInstalled: false,
          availableCompatibleVersions: [],
        },
      ],
      totalDownloadSizeBytes: 2000,
      conflicts: [],
      optionalDependencies: [],
      isValid: true,
      requiresGameUpdate: false,
    })

    const mockOfflineClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockResolvedValue([]),
      writeFile: vi.fn().mockResolvedValue(undefined),
      pullFile: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn().mockResolvedValue(undefined),
    }

    // It should proceed past the BOTH validation check without throwing VALIDATION_ERROR for BOTH
    try {
      await installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "terralith-dp", versionId: "ver-dp", contentType: "DATA_PACK" },
        "admin-1",
        mockOfflineClient as any,
      )
    } catch (err: any) {
      // Must NOT fail with the BOTH validation error
      expect(err.message).not.toContain("es de entorno BOTH y no puede instalarse directamente en el servidor")
    }

    vi.restoreAllMocks()
  })

  // Test 17: Real dependency resolution aborts at limit 3, stops querying provider for further dependencies, never touches Wings, never writes D1
  it("aborts dependency resolution at limit 3, stops provider queries for further dependencies, never touches Wings, and writes no D1 records", async () => {
    const { modProviderManager } = await import("../providers/modProviderManager")

    const nowIso = new Date().toISOString()
    await db.insert(schema.gameReleases).values({
      id: "rel-pub-test17",
      version: "1.0.0-test17",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      createdBy: "admin-1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const rootProject: any = {
      id: "root-mod",
      name: "Root Mod",
      environment: "SERVER",
      contentType: "MOD",
    }
    const rootVersion: any = {
      id: "ver-root",
      projectId: "root-mod",
      versionNumber: "1.0.0",
      name: "Root Mod 1.0.0",
      releaseType: "RELEASE",
      gameVersions: ["1.21.1"],
      loaders: ["neoforge"],
      publishedAt: nowIso,
      downloads: 100,
      filename: "root-mod.jar",
      sizeBytes: 1000,
      downloadUrl: "https://example.com/root.jar",
      contentType: "MOD",
      environment: "SERVER",
      dependencies: [
        { projectId: "dep-1", dependencyType: "REQUIRED" },
        { projectId: "dep-2", dependencyType: "REQUIRED" },
        { projectId: "dep-3", dependencyType: "REQUIRED" },
        { projectId: "dep-4", dependencyType: "REQUIRED" },
      ],
    }

    const dep1Project: any = { id: "dep-1", name: "Dep One", environment: "SERVER", contentType: "MOD" }
    const dep1Version: any = {
      id: "ver-dep-1",
      projectId: "dep-1",
      versionNumber: "1.0.0",
      name: "Dep One 1.0.0",
      releaseType: "RELEASE",
      gameVersions: ["1.21.1"],
      loaders: ["neoforge"],
      publishedAt: nowIso,
      downloads: 50,
      filename: "dep-1.jar",
      sizeBytes: 1000,
      downloadUrl: "https://example.com/dep-1.jar",
      contentType: "MOD",
      environment: "SERVER",
      dependencies: [],
    }

    const dep2Project: any = { id: "dep-2", name: "Dep Two", environment: "SERVER", contentType: "MOD" }
    const dep2Version: any = {
      id: "ver-dep-2",
      projectId: "dep-2",
      versionNumber: "1.0.0",
      name: "Dep Two 1.0.0",
      releaseType: "RELEASE",
      gameVersions: ["1.21.1"],
      loaders: ["neoforge"],
      publishedAt: nowIso,
      downloads: 50,
      filename: "dep-2.jar",
      sizeBytes: 1000,
      downloadUrl: "https://example.com/dep-2.jar",
      contentType: "MOD",
      environment: "SERVER",
      dependencies: [],
    }

    const getProjectSpy = vi.fn().mockImplementation((_env, projectId) => {
      if (projectId === "root-mod") return Promise.resolve(rootProject)
      if (projectId === "dep-1") return Promise.resolve(dep1Project)
      if (projectId === "dep-2") return Promise.resolve(dep2Project)
      return Promise.resolve(null)
    })

    const getCompatibleVersionsSpy = vi.fn().mockImplementation((_env, projectId) => {
      if (projectId === "root-mod") return Promise.resolve([rootVersion])
      if (projectId === "dep-1") return Promise.resolve([dep1Version])
      if (projectId === "dep-2") return Promise.resolve([dep2Version])
      return Promise.resolve([])
    })

    const getVersionSpy = vi.fn().mockImplementation((_env, versionId, projectId) => {
      if (projectId === "root-mod" || versionId === "ver-root") return Promise.resolve(rootVersion)
      if (projectId === "dep-1" || versionId === "ver-dep-1") return Promise.resolve(dep1Version)
      if (projectId === "dep-2" || versionId === "ver-dep-2") return Promise.resolve(dep2Version)
      return Promise.resolve(null)
    })

    const mockAdapter = {
      isConfigured: () => true,
      getProject: getProjectSpy,
      getCompatibleVersions: getCompatibleVersionsSpy,
      getVersion: getVersionSpy,
      getSupportedContentTypes: () => Promise.resolve(["MOD"]),
    }

    vi.spyOn(modProviderManager, "getAdapter").mockReturnValue(mockAdapter as any)

    const pullFileSpy = vi.fn().mockResolvedValue(undefined)
    const listDirectorySpy = vi.fn().mockResolvedValue({ data: [] })
    const mockWingsClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: listDirectorySpy,
      pullFile: pullFileSpy,
    }

    await expect(
      installServerContentPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "root-mod", versionId: "ver-root", contentType: "MOD" },
        "admin-1",
        mockWingsClient as any,
      ),
    ).rejects.toThrow("El contenido solicitado requiere demasiadas dependencias para el plan gratuito de Workers (máximo 3 archivos).")

    // 1. Verify root, dep-1, dep-2 were resolved
    expect(getProjectSpy).toHaveBeenCalledWith(expect.anything(), "root-mod", "MOD")
    expect(getProjectSpy).toHaveBeenCalledWith(expect.anything(), "dep-1", "MOD")
    expect(getProjectSpy).toHaveBeenCalledWith(expect.anything(), "dep-2", "MOD")

    // 2. CRITICAL: Verify dep-3 and dep-4 were NEVER queried from provider
    expect(getProjectSpy).not.toHaveBeenCalledWith(expect.anything(), "dep-3", expect.anything())
    expect(getProjectSpy).not.toHaveBeenCalledWith(expect.anything(), "dep-4", expect.anything())
    expect(getCompatibleVersionsSpy).not.toHaveBeenCalledWith(expect.anything(), "dep-3", expect.anything(), expect.anything(), expect.anything())
    expect(getCompatibleVersionsSpy).not.toHaveBeenCalledWith(expect.anything(), "dep-4", expect.anything(), expect.anything(), expect.anything())

    // 3. CRITICAL: Verify Wings was NEVER touched
    expect(pullFileSpy).not.toHaveBeenCalled()
    expect(listDirectorySpy).not.toHaveBeenCalled()

    // 4. CRITICAL: Verify D1 was NEVER written (0 records in serverManagedContent)
    const records = await db.select().from(schema.serverManagedContent).all()
    expect(records).toHaveLength(0)

    vi.restoreAllMocks()
  })
})
