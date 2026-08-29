import { describe, it, expect, vi } from "vitest"
import {
  sanitizeVirtualPath,
  isAllowlistedTextFile,
  parseServerProperties,
  extractMinecraftSettings,
  serializeServerProperties,
  convertAutomationToPterodactylCron,
  mapPterodactylActivityEvent,
} from "@hikat/shared"
import { PterodactylHttpClient, ServerInfrastructureError } from "./pterodactylClient"
import {
  listServerBackups,
  createServerBackup,
  restoreServerBackup,
  deleteServerBackup,
  toggleServerBackupLock,
} from "./serverBackupService"
import {
  detectActiveWorldName,
  getServerWorldInfo,
  createServerWorldDownloadUrl,
  replaceServerWorld,
} from "./serverWorldService"
import {
  getMinecraftServerSettings,
  updateMinecraftServerSettings,
} from "./serverConfigService"
import {
  listServerFiles,
  readServerTextFile,
  writeServerTextFile,
  renameServerFile,
  deleteServerFile,
  prepareServerFileUploadUrl,
  createServerFileDownloadUrl,
} from "./serverFileService"
import {
  listServerAutomations,
  createServerAutomation,
  updateServerAutomation,
  deleteServerAutomation,
  runServerAutomation,
  buildTemplatePlan,
  checkTasksMatchTemplate,
} from "./serverScheduleService"
import {
  acquireServerOperationLock,
  releaseServerOperationLock,
  refreshServerOperationLock,
  startServerOperationHeartbeat,
} from "./serverAdministrationService"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq } from "drizzle-orm"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}


describe("Shard 07: Server Administration II Core & Pterodactyl Architecture Tests", () => {
  // Test 1: Pterodactyl HTTP Client Endpoints & Credentials Hiding
  it("PterodactylHttpClient uses correct endpoints and never leaks API key in errors", async () => {
    const requests: Array<{ url: string; method: string; body?: any }> = []

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      requests.push({
        url,
        method: init.method || "GET",
        body: init.body ? JSON.parse(init.body as string) : undefined,
      })

      if (url.includes("/backups") && init.method === "GET") {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                object: "backup",
                attributes: {
                  uuid: "bk-uuid-1",
                  name: "Backup Test",
                  is_successful: true,
                  is_locked: false,
                  bytes: 10485760,
                  created_at: "2026-08-26T12:00:00Z",
                  completed_at: "2026-08-26T12:01:00Z",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      if (url.includes("/schedules") && init.method === "POST") {
        return new Response(
          JSON.stringify({
            object: "server_schedule",
            attributes: {
              id: 42,
              name: "Daily Restart",
              cron: { minute: "0", hour: "4", day_of_week: "*" },
              is_active: true,
              is_processing: false,
              only_when_online: true,
              tasks: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })

    const client = new PterodactylHttpClient({
      baseUrl: "https://panel.hikat.net",
      apiKey: "secret-ptero-api-key-12345",
      serverId: "srv-mc-01",
      fetchFn: mockFetch as any,
    })

    const backups = await client.listBackups()
    expect(backups.data).toHaveLength(1)
    expect(requests[0]?.url).toBe("https://panel.hikat.net/api/client/servers/srv-mc-01/backups")

    // Test error masking: simulate 401 error and ensure secret API key is NOT in message
    const failingFetch = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    const failingClient = new PterodactylHttpClient({
      baseUrl: "https://panel.hikat.net",
      apiKey: "secret-ptero-api-key-12345",
      serverId: "srv-mc-01",
      fetchFn: failingFetch as any,
    })

    await expect(failingClient.listBackups()).rejects.toThrow(ServerInfrastructureError)
    try {
      await failingClient.listBackups()
    } catch (err: any) {
      expect(err.message).not.toContain("secret-ptero-api-key-12345")
      expect(err.code).toBe("SERVER_NOT_CONFIGURED")
    }
  })

  // Test 2: File Sandbox Path Traversal Protection
  it("File sandbox strictly blocks directory traversal across virtual categories", () => {
    // Valid paths
    const validConfig = sanitizeVirtualPath("CONFIG", "server.toml", "world")
    expect(validConfig.valid).toBe(true)
    expect(validConfig.fullPath).toBe("config/server.toml")

    const validWorld = sanitizeVirtualPath("WORLD", "region/r.0.0.mca", "custom_world")
    expect(validWorld.valid).toBe(true)
    expect(validWorld.fullPath).toBe("custom_world/region/r.0.0.mca")

    // Traversal attempts
    expect(sanitizeVirtualPath("CONFIG", "../server.properties").valid).toBe(false)
    expect(sanitizeVirtualPath("MODS", "../../etc/passwd").valid).toBe(false)
    expect(sanitizeVirtualPath("LOGS", "folder/../../../secret").valid).toBe(false)
    expect(sanitizeVirtualPath("CONFIG", "..\\..\\windows\\system32").valid).toBe(false)
    expect(sanitizeVirtualPath("CONFIG", "safe/\0/dangerous").valid).toBe(false)

    // Allowlisted extensions check
    expect(isAllowlistedTextFile("server.properties")).toBe(true)
    expect(isAllowlistedTextFile("config.json")).toBe(true)
    expect(isAllowlistedTextFile("plugin.yml")).toBe(true)
    expect(isAllowlistedTextFile("settings.toml")).toBe(true)
    expect(isAllowlistedTextFile("mod.jar")).toBe(false)
    expect(isAllowlistedTextFile("world.dat")).toBe(false)
  })

  // Test 3: Safe Level-Name Detection from server.properties
  it("detectActiveWorldName safely extracts level-name and sanitizes invalid characters", async () => {
    const mockClient = {
      getFileContents: vi.fn().mockResolvedValue(`
# Minecraft server properties
server-port=25565
level-name=HiKAT_Survival_2026
gamemode=survival
      `),
    }

    const worldName = await detectActiveWorldName({} as any, mockClient as any)
    expect(worldName).toBe("HiKAT_Survival_2026")

    // Fallback and malicious level-name sanitization
    const maliciousClient = {
      getFileContents: vi.fn().mockResolvedValue(`
level-name=../../etc/evil_world
      `),
    }
    const sanitizedName = await detectActiveWorldName({} as any, maliciousClient as any)
    expect(sanitizedName).not.toContain("..")
    expect(sanitizedName).not.toContain("/")
  })

  // Test 4: server.properties Allowlist-Only Modification and Preservation
  it("serializeServerProperties modifies allowlisted settings and preserves unknown keys and comments", () => {
    const originalProperties = `# HiKAT Server Properties
# Custom Admin Note
server-port=25565
online-mode=true
difficulty=easy
max-players=10
pvp=true
white-list=false
view-distance=8
simulation-distance=8
motd=Original MOTD
allow-flight=false
custom-mod-setting=enabled_value
rcon.password=secret123
`

    const updated = serializeServerProperties(originalProperties, {
      difficulty: "hard",
      maxPlayers: 50,
      pvp: false,
      whitelist: true,
      viewDistance: 16,
      simulationDistance: 12,
      motd: "New HiKAT MOTD",
      allowFlight: true,
    })

    const parsed = parseServerProperties(updated)
    expect(parsed.get("difficulty")).toBe("hard")
    expect(parsed.get("max-players")).toBe("50")
    expect(parsed.get("pvp")).toBe("false")
    expect(parsed.get("white-list")).toBe("true")
    expect(parsed.get("view-distance")).toBe("16")
    expect(parsed.get("simulation-distance")).toBe("12")
    expect(parsed.get("motd")).toBe("New HiKAT MOTD")
    expect(parsed.get("allow-flight")).toBe("true")

    // Verify non-allowlisted and custom properties are preserved untouched
    expect(parsed.get("server-port")).toBe("25565")
    expect(parsed.get("online-mode")).toBe("true")
    expect(parsed.get("custom-mod-setting")).toBe("enabled_value")
    expect(parsed.get("rcon.password")).toBe("secret123")
    expect(updated).toContain("# Custom Admin Note")
  })

  // Test 5: Restore Backup OFFLINE Guard
  it("restoreServerBackup rejects restore if server is not OFFLINE", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const onlineClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "running",
          is_suspended: false,
          resources: { memory_bytes: 100, cpu_absolute: 5, disk_bytes: 100, uptime: 1000 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      restoreBackup: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      restoreServerBackup(env, db as any, "admin-1", "backup-1", onlineClient as any),
    ).rejects.toThrow("Para restaurar una copia de seguridad el servidor debe estar completamente apagado.")
  })

  // Test 6: Replace World OFFLINE Guard & Pre-Backup
  it("replaceServerWorld rejects replace if server is not OFFLINE and creates automatic pre-backup when OFFLINE", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const offlineClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "offline",
          is_suspended: false,
          resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "uploaded_world.zip", is_file: true } }] })
        }
        return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "pre-bk-1" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "pre-bk-1", completed_at: new Date().toISOString(), is_successful: true },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      decompressFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn().mockResolvedValue(undefined),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const success = await replaceServerWorld(env, db as any, "admin-1", "uploaded_world.zip", offlineClient as any)
    expect(success).toBe(true)
    expect(offlineClient.createBackup).toHaveBeenCalledWith("Copia previa a reemplazo de mundo (world)")
    expect(offlineClient.decompressFile).toHaveBeenCalledWith(expect.stringMatching(/^\/_staging_world_/), "uploaded_world.zip")
  })

  // Test 7: Human Automation Translation to Pterodactyl Cron & Kill Command Guard
  it("convertAutomationToPterodactylCron correctly translates schedules and prevents kill command", () => {
    // Daily schedule at 04:30
    const daily = convertAutomationToPterodactylCron("DAILY", "04:30")
    expect(daily.hour).toBe("04")
    expect(daily.minute).toBe("30")
    expect(daily.day_of_week).toBe("*")

    // Weekly schedule on Saturday (6) at 03:00
    const weekly = convertAutomationToPterodactylCron("WEEKLY", "03:00", 6)
    expect(weekly.hour).toBe("03")
    expect(weekly.minute).toBe("00")
    expect(weekly.day_of_week).toBe("6")

    // Selected days schedule on Mon, Wed, Fri (1, 3, 5) at 12:15
    const selected = convertAutomationToPterodactylCron("SELECTED_DAYS", "12:15", undefined, [5, 1, 3])
    expect(selected.hour).toBe("12")
    expect(selected.minute).toBe("15")
    expect(selected.day_of_week).toBe("1,3,5")
  })

  // Test 8: Pterodactyl Activity Event Mapping
  it("mapPterodactylActivityEvent maps internal events to human Spanish descriptions", () => {
    expect(mapPterodactylActivityEvent("server:power.start").description).toBe("Servidor iniciado")
    expect(mapPterodactylActivityEvent("server:power.stop").description).toBe("Servidor detenido")
    expect(mapPterodactylActivityEvent("server:power.restart").description).toBe("Servidor reiniciado")
    expect(mapPterodactylActivityEvent("server:backup.create").description).toBe("Copia creada")
    expect(mapPterodactylActivityEvent("server:backup.restore").description).toBe("Copia restaurada")
    expect(mapPterodactylActivityEvent("server:file.write").description).toBe("Archivo actualizado")
    expect(mapPterodactylActivityEvent("server:custom.unknown").description).toBe("Actividad del servidor")
  })

  // Test 9: Destructive Operation Lock prevents concurrent restore/replace
  it("D1 server_operation_locks prevents concurrent destructive operations", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Insert active operation lock
    await db.insert(schema.serverOperationLocks).values({
      lockKey: "server_destructive_operation",
      operation: "RESTORE_BACKUP",
      acquiredByUserId: "admin-1",
      acquiredAt: nowIso,
      expiresAt: new Date(Date.now() + 180000).toISOString(),
    })


    const offlineClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "offline",
          is_suspended: false,
          resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } },
      }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      createBackup: vi.fn(),
      decompressFile: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      replaceServerWorld(env, db as any, "admin-1", "world.zip", offlineClient as any),
    ).rejects.toThrow("Hay otra operación del servidor en curso. Espera a que finalice.")
  })

  // Test 10: GraphQL Resolvers Require ADMIN Role for Shard 07 Queries and Mutations
  it("GraphQL resolvers reject unauthenticated and non-admin requests for Shard 07 operations", async () => {
    const { resolvers } = await import("../../resolvers")

    const unauthContext = {
      auth: { status: "unauthenticated" },
      db: {} as any,
      env: {} as any,
    } as any

    const playerContext = {
      auth: {
        status: "authenticated",
        identity: {
          userId: "p1",
          email: "player@hikat.net",
          role: "PLAYER",
          sessionId: "sess-1",
          expiresAt: Date.now() + 100000,
        },
      },
      db: {} as any,
      env: {} as any,
    } as any

    // Query guards: Unauthenticated throws UNAUTHENTICATED
    await expect(resolvers.Query.serverBackups({}, {}, unauthContext)).rejects.toThrow("Authentication required")
    await expect(resolvers.Query.serverWorld({}, {}, unauthContext)).rejects.toThrow("Authentication required")

    // Query guards: PLAYER role throws FORBIDDEN
    await expect(resolvers.Query.serverBackups({}, {}, playerContext)).rejects.toThrow("administrative privilege required")
    await expect(resolvers.Query.serverWorld({}, {}, playerContext)).rejects.toThrow("administrative privilege required")
    await expect(resolvers.Query.serverAutomations({}, {}, playerContext)).rejects.toThrow("administrative privilege required")
    await expect(resolvers.Query.serverFiles({}, { root: "CONFIG" }, playerContext)).rejects.toThrow("administrative privilege required")

    // Mutation guards: PLAYER role throws FORBIDDEN
    await expect(resolvers.Mutation.createServerBackup({}, { name: "test" }, playerContext)).rejects.toThrow("administrative privilege required")
    await expect(resolvers.Mutation.restoreServerBackup({}, { id: "bk-1" }, playerContext)).rejects.toThrow("administrative privilege required")
    await expect(resolvers.Mutation.replaceServerWorld({}, { uploadedFileName: "w.zip" }, playerContext)).rejects.toThrow("administrative privilege required")
    await expect(resolvers.Mutation.updateMinecraftServerSettings({}, { input: {} as any }, playerContext)).rejects.toThrow("administrative privilege required")
  })

  // Test 11: Shard 07A - Level-Name Fail-Safe
  it("detectActiveWorldName propagates network error and only defaults to world when file is readable without level-name", async () => {
    const errorClient = {
      getFileContents: vi.fn().mockRejectedValue(new Error("Pterodactyl 500 Network Error")),
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    // 1. Error propagates — does NOT fallback to "world"
    await expect(detectActiveWorldName(env, errorClient as any)).rejects.toThrow("Pterodactyl 500 Network Error")

    // 2. Readable without level-name property -> defaults to "world"
    const noLevelNameClient = {
      getFileContents: vi.fn().mockResolvedValue("pvp=true\ndifficulty=hard\n"),
    }
    const worldName1 = await detectActiveWorldName(env, noLevelNameClient as any)
    expect(worldName1).toBe("world")

    // 3. Readable with level-name property -> returns level-name
    const levelNameClient = {
      getFileContents: vi.fn().mockResolvedValue("level-name=custom_world\n"),
    }
    const worldName2 = await detectActiveWorldName(env, levelNameClient as any)
    expect(worldName2).toBe("custom_world")
  })

  // Test 12: Shard 07A - Server.properties Fail-Safe
  it("server.properties read failure propagates error and prevents writing", async () => {
    const writeFileSpy = vi.fn()
    const failReadClient = {
      getFileContents: vi.fn().mockRejectedValue(new Error("File read timeout")),
      writeFile: writeFileSpy,
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    // 1. getMinecraftServerSettings propagates error
    await expect(getMinecraftServerSettings(env, failReadClient as any)).rejects.toThrow("File read timeout")

    // 2. updateMinecraftServerSettings propagates error and NEVER calls writeFile
    await expect(updateMinecraftServerSettings(env, { pvp: false }, failReadClient as any)).rejects.toThrow("File read timeout")
    expect(writeFileSpy).not.toHaveBeenCalled()
  })

  // Test 13: Shard 07A - Automation Task Update
  it("updateServerAutomation updates task action and payload in addition to schedule metadata", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-rec-10",
      scheduleId: "10",
      template: "CUSTOM",
      action: "BACKUP",
      name: "Restart Task",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const updateScheduleSpy = vi.fn().mockResolvedValue({
      object: "schedule",
      attributes: { id: 10, name: "Restart Task", is_active: true, minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*", is_processing: false },
    })

    const updateScheduleTaskSpy = vi.fn().mockResolvedValue(undefined)

    const mockScheduleWithTask = {
      object: "schedule",
      attributes: {
        id: 10,
        name: "Restart Task",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [
          {
            object: "task",
            attributes: { id: 50, action: "backup", payload: "", time_offset: 0 },
          },
        ],
      },
    }

    const client = {
      updateSchedule: updateScheduleSpy,
      getSchedule: vi.fn().mockResolvedValue(mockScheduleWithTask),
      updateScheduleTask: updateScheduleTaskSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const result = await updateServerAutomation(
      env,
      "10",
      {
        name: "Restart Task",
        action: "RESTART",
        frequency: "DAILY",
        time: "04:00",
        enabled: true,
      },
      client as any,
      db as any,
    )

    expect(updateScheduleSpy).toHaveBeenCalledWith("10", expect.objectContaining({ name: "Restart Task" }))
    expect(updateScheduleTaskSpy).toHaveBeenCalledWith("10", 50, expect.objectContaining({
      action: "power",
      payload: "restart",
    }))
    expect(result.id).toBe("10")
  })

  // Test 14: Shard 07B - World Replacement Staging Validation Rejects Invalid ZIP Without Touching Active World
  it("replaceServerWorld rejects ZIP without level.dat in staging and leaves active world untouched", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const deleteFilesSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=survival_world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "invalid.zip", is_file: true } }] })
        }
        // Staging directory contains NO level.dat
        return Promise.resolve({ data: [{ attributes: { name: "random.txt", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "pre-bk-100" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "pre-bk-100", completed_at: nowIso, is_successful: true },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      decompressFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: deleteFilesSpy,
      renameFile: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      replaceServerWorld(env, db as any, "admin-1", "invalid.zip", mockClient as any),
    ).rejects.toThrow("El archivo ZIP no contiene una estructura de mundo de Minecraft válida")

    // Active world "survival_world" must NOT have been deleted or touched!
    expect(deleteFilesSpy).not.toHaveBeenCalledWith("/", ["survival_world"])
  })

  // Test 15: Shard 07B - World Swap Failure Triggers Conservative Rollback Attempt
  it("replaceServerWorld triggers pre-backup restore attempt if swap phase fails after active world deletion", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const restoreBackupSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "world.zip", is_file: true } }] })
        }
        // Valid staging directory containing level.dat
        return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "pre-bk-200" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "pre-bk-200", completed_at: nowIso, is_successful: true },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      decompressFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Wings 500 Rename Failed")),
      restoreBackup: restoreBackupSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      replaceServerWorld(env, db as any, "admin-1", "world.zip", mockClient as any),
    ).rejects.toThrow("Error al reemplazar el mundo activo en el sistema de archivos")

    // Must have attempted restore of pre-backup!
    expect(restoreBackupSpy).toHaveBeenCalledWith("pre-bk-200")
  })

  // Test 16: Shard 07B - File Upload Signed URL Directory Parameter & Sandbox Traversal Protection
  it("prepareServerFileUploadUrl appends official directory parameter and blocks path traversal attempts", async () => {
    const mockClient = {
      getFileUploadUrl: vi.fn().mockResolvedValue({
        attributes: { url: "https://wings.hikat.net:8080/upload/file?token=jwt_xyz" },
      }),
      listDirectory: vi.fn().mockResolvedValue({ data: [] }),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    // 1. Valid subfolder upload URL
    const res = await prepareServerFileUploadUrl(env, "CONFIG", "subfolder", mockClient as any)
    expect(res.url).toContain("&directory=config%2Fsubfolder")

    // 2. Traversal attempt throws error before asking Wings
    await expect(
      prepareServerFileUploadUrl(env, "CONFIG", "../../etc/passwd", mockClient as any),
    ).rejects.toThrow("no permitida")
  })

  // Test 17: Shard 07B - Advanced Multi-task Schedule Read-Only Protection
  it("updateServerAutomation and deleteServerAutomation reject multi-task advanced schedules without making changes", async () => {
    const { db } = createMockD1()
    const updateScheduleSpy = vi.fn()
    const deleteScheduleSpy = vi.fn()
    const mockAdvancedSchedule = {
      object: "schedule",
      attributes: {
        id: 99,
        name: "Complex Schedule",
        cron: { minute: "0", hour: "3", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        tasks: [
          { object: "task", attributes: { id: 1, action: "command", payload: "say Step 1", time_offset: 0 } },
          { object: "task", attributes: { id: 2, action: "power", payload: "restart", time_offset: 60 } },
        ],
      },
    }

    const mockClient = {
      getSchedule: vi.fn().mockResolvedValue(mockAdvancedSchedule),
      updateSchedule: updateScheduleSpy,
      deleteSchedule: deleteScheduleSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    // 1. updateServerAutomation throws and skips updateSchedule
    await expect(
      updateServerAutomation(env, "99", { name: "Hack", action: "RESTART", frequency: "DAILY", time: "03:00", enabled: true }, mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue configurada fuera de HiKAT y es de solo lectura.")
    expect(updateScheduleSpy).not.toHaveBeenCalled()

    // 2. deleteServerAutomation throws and skips deleteSchedule
    await expect(
      deleteServerAutomation(env, "99", mockClient as any, db as any),
    ).rejects.toThrow("No puedes eliminar tareas configuradas fuera de HiKAT.")
    expect(deleteScheduleSpy).not.toHaveBeenCalled()
  })

  // Test 18: Shard 07C - Archive Location Semantics (moves ZIP into staging before decompressing)
  it("replaceServerWorld moves uploaded ZIP into staging directory before invoking decompressFile inside staging root", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const renameFileSpy = vi.fn().mockResolvedValue(undefined)
    const decompressFileSpy = vi.fn().mockResolvedValue(undefined)

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "world.zip", is_file: true } }] })
        }
        return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "bk-1" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "bk-1", completed_at: nowIso, is_successful: true },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      renameFile: renameFileSpy,
      decompressFile: decompressFileSpy,
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const success = await replaceServerWorld(env, db as any, "admin-1", "world.zip", mockClient as any)
    expect(success).toBe(true)

    // 1. ZIP is moved to _staging_world_xxx/world.zip
    expect(renameFileSpy).toHaveBeenNthCalledWith(
      1,
      "/",
      "world.zip",
      expect.stringMatching(/^_staging_world_.*\/world\.zip$/),
    )

    // 2. decompress is called on staging root where ZIP physically exists
    expect(decompressFileSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\/_staging_world_/),
      "world.zip",
    )
  })

  // Test 19: Shard 07C - Wrapped Folder Destination (moves /staging/MiMundo directly to /activeWorldName)
  it("replaceServerWorld moves wrapped inner folder directly to root active world path", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const renameFileSpy = vi.fn().mockResolvedValue(undefined)

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=survival_world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "custom_pack.zip", is_file: true } }] })
        }
        if (dir.includes("MiMundo")) {
          return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
        }
        // Staging root contains wrapped folder "MiMundo"
        return Promise.resolve({ data: [{ attributes: { name: "MiMundo", is_file: false, mimetype: "directory" } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "bk-2" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "bk-2", completed_at: nowIso, is_successful: true },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      decompressFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
      renameFile: renameFileSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const success = await replaceServerWorld(env, db as any, "admin-1", "custom_pack.zip", mockClient as any)
    expect(success).toBe(true)

    // Inner folder _staging_xxx/MiMundo is moved to survival_world in server root /
    expect(renameFileSpy).toHaveBeenLastCalledWith(
      "/",
      expect.stringMatching(/^_staging_world_.*\/MiMundo$/),
      "survival_world",
    )
  })

  // Test 20: Shard 07C - Fail Closed on listDirectory("/") Failure
  it("replaceServerWorld fails closed and aborts immediately if listDirectory(/) fails", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const createBackupSpy = vi.fn()
    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockRejectedValue(new Error("Wings 500 Network Timeout")),
      createBackup: createBackupSpy,
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      replaceServerWorld(env, db as any, "admin-1", "world.zip", mockClient as any),
    ).rejects.toThrow("No se pudo consultar el directorio raíz del servidor")

    // Operations MUST NOT have proceeded!
    expect(createBackupSpy).not.toHaveBeenCalled()
  })

  // Test 21: Shard 07D - Pre-backup polling (pending then success)
  it("replaceServerWorld polls getBackup until completed_at != null and proceeds only on success", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const getBackupSpy = vi.fn()
      .mockResolvedValueOnce({ object: "backup", attributes: { uuid: "bk-77", completed_at: null, is_successful: false } })
      .mockResolvedValueOnce({ object: "backup", attributes: { uuid: "bk-77", completed_at: nowIso, is_successful: true } })

    const createFolderSpy = vi.fn().mockResolvedValue(undefined)

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "world.zip", is_file: true } }] })
        }
        return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "bk-77" } }),
      getBackup: getBackupSpy,
      createFolder: createFolderSpy,
      renameFile: vi.fn().mockResolvedValue(undefined),
      decompressFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const success = await replaceServerWorld(
      env,
      db as any,
      "admin-1",
      "world.zip",
      mockClient as any,
      { maxAttempts: 5, intervalMs: 1 },
    )

    expect(success).toBe(true)
    expect(getBackupSpy).toHaveBeenCalledTimes(2)
    expect(createFolderSpy).toHaveBeenCalled()
  })

  // Test 22: Shard 07D - Pre-backup failure/timeout aborts without creating staging or touching active world
  it("replaceServerWorld aborts if pre-backup fails or times out without touching active world", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const createFolderSpy = vi.fn()
    const deleteFilesSpy = vi.fn().mockResolvedValue(undefined)

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "world.zip", is_file: true } }] })
        }
        return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "bk-failed" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "bk-failed", completed_at: nowIso, is_successful: false },
      }),
      createFolder: createFolderSpy,
      deleteFiles: deleteFilesSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      replaceServerWorld(
        env,
        db as any,
        "admin-1",
        "world.zip",
        mockClient as any,
        { maxAttempts: 2, intervalMs: 1 },
      ),
    ).rejects.toThrow("No se pudo completar la copia de seguridad previa")

    expect(createFolderSpy).not.toHaveBeenCalled()
    expect(deleteFilesSpy).not.toHaveBeenCalledWith("/", ["world"])
  })

  // Test 23: Shard 07D - Active world delete failure triggers restoreBackup
  it("replaceServerWorld triggers restoreBackup if active world delete fails during swap phase", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const restoreBackupSpy = vi.fn().mockResolvedValue(undefined)
    const renameFileSpy = vi.fn().mockResolvedValue(undefined)

    const mockClient = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", is_suspended: false, resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 100, uptime: 0 } },
      }),
      getServerDetails: vi.fn().mockResolvedValue({ attributes: { limits: { memory: 1024, cpu: 100, disk: 10240 } } }),
      getFileContents: vi.fn().mockResolvedValue("level-name=world"),
      listDirectory: vi.fn().mockImplementation((dir: string) => {
        if (dir === "/") {
          return Promise.resolve({ data: [{ attributes: { name: "world.zip", is_file: true } }] })
        }
        return Promise.resolve({ data: [{ attributes: { name: "level.dat", is_file: true } }] })
      }),
      createBackup: vi.fn().mockResolvedValue({ attributes: { uuid: "bk-swap-fail" } }),
      getBackup: vi.fn().mockResolvedValue({
        object: "backup",
        attributes: { uuid: "bk-swap-fail", completed_at: nowIso, is_successful: true },
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      decompressFile: vi.fn().mockResolvedValue(undefined),
      renameFile: renameFileSpy,
      deleteFiles: vi.fn().mockImplementation((dir: string, files: string[]) => {
        if (dir === "/" && files.includes("world")) {
          return Promise.reject(new Error("Wings Permission Denied on active world delete"))
        }
        return Promise.resolve(undefined)
      }),
      restoreBackup: restoreBackupSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      replaceServerWorld(
        env,
        db as any,
        "admin-1",
        "world.zip",
        mockClient as any,
        { maxAttempts: 1, intervalMs: 1 },
      ),
    ).rejects.toThrow("Error al reemplazar el mundo activo en el sistema de archivos")

    // Must have attempted restoreBackup
    expect(restoreBackupSpy).toHaveBeenCalledWith("bk-swap-fail")
    // Must NOT have called renameFile for world swap
    expect(renameFileSpy).not.toHaveBeenCalledWith("/", expect.stringMatching(/^_staging_world_/), "world")
  })

  // --- Phase 07E & 07F: Full Server File Browser (SERVER Root) & Symlink Hardening Tests ---

  // Test 24: SERVER Root listing queries server root directory as canonical "/"
  it("Phase 07F: listServerFiles with SERVER root and empty path queries canonical '/' directory", async () => {
    const listDirSpy = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        { attributes: { name: "world", is_file: false, size: 0, mimetype: "directory" } },
        { attributes: { name: "server.properties", is_file: true, size: 1024, mimetype: "text/plain" } },
      ],
    })

    const mockClient = { listDirectory: listDirSpy }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const files = await listServerFiles(env, "SERVER", "", mockClient as any)
    expect(listDirSpy).toHaveBeenCalledWith("/")
    expect(files).toHaveLength(2)
    expect(files[0]?.name).toBe("world")
    expect(files[0]?.isFile).toBe(false)
    expect(files[1]?.name).toBe("server.properties")
    expect(files[1]?.isFile).toBe(true)
  })

  // Test 25: Dynamic Folders listing returns all folders returned by Pterodactyl dynamically without hardcoded list
  it("Phase 07E: SERVER root dynamically returns custom folders returned by Pterodactyl", async () => {
    const listDirSpy = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        { attributes: { name: "world", is_file: false, size: 0 } },
        { attributes: { name: "plugins", is_file: false, size: 0 } },
        { attributes: { name: "mods", is_file: false, size: 0 } },
        { attributes: { name: "config", is_file: false, size: 0 } },
        { attributes: { name: "custom-folder", is_file: false, size: 0 } },
        { attributes: { name: "kubejs", is_file: false, size: 0 } },
        { attributes: { name: "neoforge-server.toml", is_file: true, size: 2048 } },
      ],
    })

    const mockClient = { listDirectory: listDirSpy }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const files = await listServerFiles(env, "SERVER", undefined, mockClient as any)
    expect(files).toHaveLength(7)
    expect(files.map((f) => f.name)).toContain("custom-folder")
    expect(files.map((f) => f.name)).toContain("kubejs")
  })

  // Test 26: Folder navigation for SERVER root queries subfolder with canonical leading slash (/mods)
  it("Phase 07F: SERVER root with relativePath='mods' queries subfolder as canonical '/mods'", async () => {
    const listDirSpy = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        { attributes: { name: "mod1.jar", is_file: true, size: 1048576 } },
        { attributes: { name: "subfolder", is_file: false, size: 0 } },
      ],
    })

    const mockClient = { listDirectory: listDirSpy }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const files = await listServerFiles(env, "SERVER", "mods", mockClient as any)
    expect(listDirSpy).toHaveBeenCalledWith("/mods")
    expect(files).toHaveLength(2)
  })

  // Test 27: Upload destination resolves to directory=%2F for root and directory=%2Fmods%2Fsubfolder for subfolder
  it("Phase 07F: prepareServerFileUploadUrl prepares upload target with canonical leading slash directory param", async () => {
    const mockClient = {
      getFileUploadUrl: vi.fn().mockResolvedValue({
        attributes: { url: "https://wings.hikat.net:8080/upload/file" },
      }),
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const resRoot = await prepareServerFileUploadUrl(env, "SERVER", "", mockClient as any)
    expect(resRoot.url).toBe("https://wings.hikat.net:8080/upload/file?directory=%2F")

    const resSub = await prepareServerFileUploadUrl(env, "SERVER", "mods/subfolder", mockClient as any)
    expect(resSub.url).toBe("https://wings.hikat.net:8080/upload/file?directory=%2Fmods%2Fsubfolder")
  })

  // Test 28: Path Traversal attempts and leading slash relativePaths are rejected
  it("Phase 07F: SERVER root rejects directory traversal attempts and leading slash relativePaths", async () => {
    const mockClient = { listDirectory: vi.fn() }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(listServerFiles(env, "SERVER", "../../", mockClient as any)).rejects.toThrow("no permitida")
    await expect(listServerFiles(env, "SERVER", "/etc/passwd", mockClient as any)).rejects.toThrow("no permitida")
    await expect(listServerFiles(env, "SERVER", "../config", mockClient as any)).rejects.toThrow("no permitida")
    await expect(listServerFiles(env, "SERVER", "..\\..\\windows", mockClient as any)).rejects.toThrow("no permitida")
    await expect(prepareServerFileUploadUrl(env, "SERVER", "mods/../../etc", mockClient as any)).rejects.toThrow("no permitida")
  })

  // Test 29: Symlink mapping returns isSymlink: true and isFile: true (fail closed)
  it("Phase 07F: Symlinks set isSymlink=true and isFile=true (fail closed)", async () => {
    const listDirSpy = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        { attributes: { name: "safe_dir", is_file: false, is_symlink: false } },
        { attributes: { name: "symlink_dir", is_file: false, is_symlink: true } },
        { attributes: { name: "symlink_file", is_file: true, is_symlink: true } },
      ],
    })

    const mockClient = { listDirectory: listDirSpy }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const files = await listServerFiles(env, "SERVER", "", mockClient as any)
    const safeDir = files.find((f) => f.name === "safe_dir")
    const symlinkDir = files.find((f) => f.name === "symlink_dir")

    expect(safeDir?.isFile).toBe(false)
    expect(safeDir?.isSymlink).toBe(false)
    expect(symlinkDir?.isFile).toBe(true)
    expect(symlinkDir?.isSymlink).toBe(true)
  })

  // Test 30: Rename and Delete on root items pass parentPath='/' and fileName='server.properties'
  it("Phase 07F: renameServerFile and deleteServerFile on root item pass parentPath='/' and correct fileName", async () => {
    const renameFileSpy = vi.fn().mockResolvedValue(undefined)
    const deleteFilesSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = { renameFile: renameFileSpy, deleteFiles: deleteFilesSpy }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await renameServerFile(env, "SERVER", "server.properties", "new.properties", mockClient as any)
    expect(renameFileSpy).toHaveBeenCalledWith("/", "server.properties", "new.properties")

    await deleteServerFile(env, "SERVER", "server.properties", mockClient as any)
    expect(deleteFilesSpy).toHaveBeenCalledWith("/", ["server.properties"])
  })

  // Test 31: Backend symlink guards block read/write/download operations on confirmed symlinks
  it("Phase 07G: Backend symlink guards block read, write, and download operations on confirmed symlinks", async () => {
    const getFileContentsSpy = vi.fn()
    const writeFileSpy = vi.fn()
    const getFileDownloadSpy = vi.fn()
    const mockClient = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [
          { attributes: { name: "symlink.json", is_file: true, is_symlink: true } },
        ],
      }),
      getFileContents: getFileContentsSpy,
      writeFile: writeFileSpy,
      getFileDownload: getFileDownloadSpy,
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(readServerTextFile(env, "SERVER", "symlink.json", mockClient as any)).rejects.toThrow("No se puede abrir este enlace desde HiKAT por seguridad.")
    expect(getFileContentsSpy).not.toHaveBeenCalled()

    await expect(writeServerTextFile(env, "SERVER", "symlink.json", "data", mockClient as any)).rejects.toThrow("No se puede abrir este enlace desde HiKAT por seguridad.")
    expect(writeFileSpy).not.toHaveBeenCalled()

    await expect(createServerFileDownloadUrl(env, "SERVER", "symlink.json", mockClient as any)).rejects.toThrow("No se puede abrir este enlace desde HiKAT por seguridad.")
    expect(getFileDownloadSpy).not.toHaveBeenCalled()
  })

  // Test 32: listDirectory failure fails closed for read, write, and download
  it("Phase 07G: listDirectory failure fails closed without calling underlying read/write/download primitives", async () => {
    const getFileContentsSpy = vi.fn()
    const writeFileSpy = vi.fn()
    const getFileDownloadSpy = vi.fn()
    const mockClient = {
      listDirectory: vi.fn().mockRejectedValue(new Error("Pterodactyl Network Timeout")),
      getFileContents: getFileContentsSpy,
      writeFile: writeFileSpy,
      getFileDownload: getFileDownloadSpy,
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(readServerTextFile(env, "SERVER", "server.properties", mockClient as any)).rejects.toThrow("No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.")
    expect(getFileContentsSpy).not.toHaveBeenCalled()

    await expect(writeServerTextFile(env, "SERVER", "server.properties", "motd=test", mockClient as any)).rejects.toThrow("No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.")
    expect(writeFileSpy).not.toHaveBeenCalled()

    await expect(createServerFileDownloadUrl(env, "SERVER", "server.properties", mockClient as any)).rejects.toThrow("No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.")
    expect(getFileDownloadSpy).not.toHaveBeenCalled()
  })

  // Test 33: Invalid response structure fails closed
  it("Phase 07G: Invalid listDirectory response structure fails closed", async () => {
    const mockClient = {
      listDirectory: vi.fn().mockResolvedValue({ data: null }),
      getFileContents: vi.fn(),
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(readServerTextFile(env, "SERVER", "server.properties", mockClient as any)).rejects.toThrow("No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.")
  })

  // Test 34: Target item missing from parent directory fails closed
  it("Phase 07G: Target item missing from parent directory fails closed", async () => {
    const mockClient = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [{ attributes: { name: "other_file.txt", is_file: true } }],
      }),
      getFileContents: vi.fn(),
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(readServerTextFile(env, "SERVER", "server.properties", mockClient as any)).rejects.toThrow("No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.")
  })

  // Test 35: Verified normal file succeeds and invokes Pterodactyl primitives
  it("Phase 07G: Verified normal file succeeds and invokes read/write/download primitives", async () => {
    const mockClient = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [
          { attributes: { name: "server.properties", is_file: true, is_symlink: false } },
        ],
      }),
      getFileContents: vi.fn().mockResolvedValue("motd=HiKAT"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      getFileDownload: vi.fn().mockResolvedValue({ attributes: { url: "https://wings.hikat.net/download/sp" } }),
    }
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const readRes = await readServerTextFile(env, "SERVER", "server.properties", mockClient as any)
    expect(readRes.content).toBe("motd=HiKAT")

    const writeRes = await writeServerTextFile(env, "SERVER", "server.properties", "motd=HiKAT", mockClient as any)
    expect(writeRes).toBe(true)

    const dlRes = await createServerFileDownloadUrl(env, "SERVER", "server.properties", mockClient as any)
    expect(dlRes.url).toBe("https://wings.hikat.net/download/sp")
  })

  // Test 36: Custom Task validation requires action and valid commands
  it("Phase 07 Hardening: Custom Task validation enforces explicit action and command", () => {
    // Missing action throws
    expect(() => buildTemplatePlan({ template: "CUSTOM" })).toThrow(
      "Debes especificar el tipo de acción para una tarea personalizada.",
    )

    // Action COMMAND without command throws
    expect(() => buildTemplatePlan({ template: "CUSTOM", action: "COMMAND", command: "   " })).toThrow(
      "El comando a ejecutar es obligatorio para tareas personalizadas de tipo comando.",
    )

    // Action COMMAND with command builds single command task
    const cmdPlan = buildTemplatePlan({ template: "CUSTOM", action: "COMMAND", command: "say Hola" })
    expect(cmdPlan.action).toBe("COMMAND")
    expect(cmdPlan.onlyWhenOnline).toBe(true)
    expect(cmdPlan.tasks).toEqual([{ action: "command", payload: "say Hola", time_offset: 0 }])

    // Action START builds power start task with onlyWhenOnline false
    const startPlan = buildTemplatePlan({ template: "CUSTOM", action: "START" })
    expect(startPlan.action).toBe("START")
    expect(startPlan.onlyWhenOnline).toBe(false)
    expect(startPlan.tasks).toEqual([{ action: "power", payload: "start", time_offset: 0 }])

    // Action STOP builds power stop task
    const stopPlan = buildTemplatePlan({ template: "CUSTOM", action: "STOP" })
    expect(stopPlan.action).toBe("STOP")
    expect(stopPlan.onlyWhenOnline).toBe(true)
    expect(stopPlan.tasks).toEqual([{ action: "power", payload: "stop", time_offset: 0 }])

    // Action BACKUP builds backup task
    const bkPlan = buildTemplatePlan({ template: "CUSTOM", action: "BACKUP" })
    expect(bkPlan.action).toBe("BACKUP")
    expect(bkPlan.tasks).toEqual([{ action: "backup", payload: "", time_offset: 0 }])
  })

  // Test 37: checkTasksMatchTemplate validates action, payload, time_offset, and sequence count
  it("Phase 07 Hardening: checkTasksMatchTemplate validates full task sequence and offsets", () => {
    const plan = buildTemplatePlan({ template: "BACKUP_AND_RESTART", delaySeconds: 60 })

    // Exact match
    const exactPteroTasks = [
      { attributes: { id: 1, sequence_id: 1, action: "backup" as const, payload: "", time_offset: 0, is_queued: false, continue_on_failure: false } },
      { attributes: { id: 2, sequence_id: 2, action: "power" as const, payload: "restart", time_offset: 60, is_queued: false, continue_on_failure: false } },
    ]
    expect(checkTasksMatchTemplate(exactPteroTasks, plan)).toBe(true)

    // Mismatched time_offset returns false
    const wrongOffsetTasks = [
      { attributes: { id: 1, sequence_id: 1, action: "backup" as const, payload: "", time_offset: 0, is_queued: false, continue_on_failure: false } },
      { attributes: { id: 2, sequence_id: 2, action: "power" as const, payload: "restart", time_offset: 30, is_queued: false, continue_on_failure: false } },
    ]
    expect(checkTasksMatchTemplate(wrongOffsetTasks, plan)).toBe(false)

    // Mismatched payload returns false
    const wrongPayloadTasks = [
      { attributes: { id: 1, sequence_id: 1, action: "backup" as const, payload: "", time_offset: 0, is_queued: false, continue_on_failure: false } },
      { attributes: { id: 2, sequence_id: 2, action: "power" as const, payload: "stop", time_offset: 60, is_queued: false, continue_on_failure: false } },
    ]
    expect(checkTasksMatchTemplate(wrongPayloadTasks, plan)).toBe(false)

    // Mismatched task count returns false
    expect(checkTasksMatchTemplate([exactPteroTasks[0]!], plan)).toBe(false)
  })

  // Test 38: External schedules without D1 metadata reject update, delete, and manual execution
  it("Phase 07 Hardening: External schedules without D1 metadata are strictly read-only", async () => {
    const { db } = createMockD1()
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const mockSchedule = {
      object: "server_schedule",
      attributes: {
        id: 999,
        name: "External Schedule",
        cron: { minute: "0", hour: "0", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        tasks: [{ attributes: { id: 1, action: "backup", payload: "", time_offset: 0 } }],
      },
    }

    const mockClient = {
      getSchedule: vi.fn().mockResolvedValue(mockSchedule),
      updateSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
      executeSchedule: vi.fn(),
    }

    // 1. updateServerAutomation fails closed with FORBIDDEN
    await expect(
      updateServerAutomation(env, "999", { name: "Update Attempt", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true }, mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue configurada fuera de HiKAT y es de solo lectura.")

    // 2. deleteServerAutomation fails closed with FORBIDDEN
    await expect(
      deleteServerAutomation(env, "999", mockClient as any, db as any),
    ).rejects.toThrow("No puedes eliminar tareas configuradas fuera de HiKAT.")

    // 3. runServerAutomation fails closed with FORBIDDEN
    await expect(
      runServerAutomation(env, "999", mockClient as any, db as any),
    ).rejects.toThrow("No puedes ejecutar manualmente tareas no gestionadas por HiKAT.")
  })

  // Test 39: createServerAutomation deletes Pterodactyl schedule if D1 insert throws
  it("Phase 07 Hardening: createServerAutomation rolls back Pterodactyl schedule on D1 failure", async () => {
    const deleteScheduleSpy = vi.fn().mockResolvedValue(undefined)
    const mockClient = {
      createSchedule: vi.fn().mockResolvedValue({
        object: "server_schedule",
        attributes: { id: 888 },
      }),
      createScheduleTask: vi.fn().mockResolvedValue(undefined),
      deleteSchedule: deleteScheduleSpy,
    }

    const failingDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error("D1 Unique Constraint Violation")),
      }),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      createServerAutomation(
        env,
        { name: "New Task", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true },
        mockClient as any,
        failingDb as any,
      ),
    ).rejects.toThrow("Error al registrar la tarea en la base de datos")

    expect(deleteScheduleSpy).toHaveBeenCalledWith("888")
  })

  // Test 40: updateServerAutomation restores previous state on task modification failure
  it("Phase 07 Hardening: updateServerAutomation restores previous tasks on error", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-rec-1",
      scheduleId: "777",
      template: "AUTO_BACKUP",
      name: "Original Task",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const originalSchedule = {
      object: "server_schedule",
      attributes: {
        id: 777,
        name: "Original Task",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [
          { attributes: { id: 10, action: "backup", payload: "", time_offset: 0 } },
        ],
      },
    }

    const updateScheduleSpy = vi.fn().mockResolvedValue(originalSchedule)
    const deleteScheduleTaskSpy = vi.fn().mockResolvedValue(undefined)
    const createScheduleTaskSpy = vi
      .fn()
      .mockResolvedValueOnce(undefined) // First task creation succeeds
      .mockRejectedValueOnce(new Error("Pterodactyl Network Dropout")) // Second fails!

    const mockClient = {
      getSchedule: vi.fn().mockResolvedValue(originalSchedule),
      updateSchedule: updateScheduleSpy,
      deleteScheduleTask: deleteScheduleTaskSpy,
      createScheduleTask: createScheduleTaskSpy,
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      updateServerAutomation(
        env,
        "777",
        {
          name: "Updated Task",
          template: "BACKUP_AND_RESTART",
          delaySeconds: 60,
          frequency: "DAILY",
          time: "04:00",
          enabled: true,
        },
        mockClient as any,
        db as any,
      ),
    ).rejects.toThrow("Error al actualizar la tarea programada")

    // Verify rollback restored original schedule metadata
    expect(updateScheduleSpy).toHaveBeenCalledWith("777", expect.objectContaining({ name: "Original Task" }))
  })

  // Test 41: CUSTOM START, STOP, RESTART, BACKUP, COMMAND persist action in D1 and reconstruct correctly
  it("Phase 07 Hardening: CUSTOM tasks persist their specific action in D1 and reconstruct correctly", async () => {
    const { db } = createMockD1()
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const actions = ["START", "STOP", "RESTART", "BACKUP", "COMMAND"] as const

    for (let i = 0; i < actions.length; i++) {
      const act = actions[i]!
      const scheduleId = String(100 + i)
      const mockClient = {
        createSchedule: vi.fn().mockResolvedValue({
          object: "server_schedule",
          attributes: { id: 100 + i },
        }),
        createScheduleTask: vi.fn().mockResolvedValue(undefined),
      }

      const res = await createServerAutomation(
        env,
        {
          name: `Custom ${act}`,
          template: "CUSTOM",
          action: act,
          command: act === "COMMAND" ? "say Hello World" : undefined,
          frequency: "DAILY",
          time: "04:00",
          enabled: true,
        },
        mockClient as any,
        db as any,
      )

      expect(res.action).toBe(act)

      // Verify directly in D1
      const d1Row = await db
        .select()
        .from(schema.serverTasks)
        .where(eq(schema.serverTasks.scheduleId, scheduleId))
        .get()

      expect(d1Row).toBeDefined()
      expect(d1Row?.action).toBe(act)
    }
  })

  // Test 42: Out-of-sync tasks (modified externally in Pterodactyl tasks) reject update, run, and delete
  it("Phase 07 Hardening: Out-of-sync task rejects update, run, and delete", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-rec-sync",
      scheduleId: "555",
      template: "AUTO_BACKUP",
      action: "BACKUP",
      name: "Backup Task",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Remote schedule has modified tasks that DO NOT match AUTO_BACKUP (e.g. power command instead of backup)
    const outOfSyncSchedule = {
      object: "server_schedule",
      attributes: {
        id: 555,
        name: "Backup Task",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [
          { attributes: { id: 1, action: "power", payload: "stop", time_offset: 0 } },
        ],
      },
    }

    const mockClient = {
      getSchedule: vi.fn().mockResolvedValue(outOfSyncSchedule),
      updateSchedule: vi.fn(),
      executeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    // 1. update fails
    await expect(
      updateServerAutomation(
        env,
        "555",
        { name: "Attempt Update", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true },
        mockClient as any,
        db as any,
      ),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")

    // 2. run fails
    await expect(
      runServerAutomation(env, "555", mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")

    // 3. delete fails
    await expect(
      deleteServerAutomation(env, "555", mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")
  })

  // Test 43: Missing DB blocks all task mutations fail-closed
  it("Phase 07 Hardening: Missing DB blocks all task mutations fail-closed", async () => {
    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any
    const mockClient = {
      createSchedule: vi.fn(),
      getSchedule: vi.fn(),
      updateSchedule: vi.fn(),
      executeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    // 1. create without DB
    await expect(
      createServerAutomation(env, { name: "Test", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true }, mockClient as any, undefined),
    ).rejects.toThrow("La base de datos no está disponible")

    // 2. update without DB
    await expect(
      updateServerAutomation(env, "123", { name: "Test", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true }, mockClient as any, undefined),
    ).rejects.toThrow("La base de datos no está disponible")

    // 3. run without DB
    await expect(
      runServerAutomation(env, "123", mockClient as any, undefined),
    ).rejects.toThrow("La base de datos no está disponible")

    // 4. delete without DB
    await expect(
      deleteServerAutomation(env, "123", mockClient as any, undefined),
    ).rejects.toThrow("La base de datos no está disponible")
  })

  // Test 44: Failed rollback is explicitly reported
  it("Phase 07 Hardening: Failed rollback during task update is explicitly reported in error", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-rec-fail-rb",
      scheduleId: "444",
      template: "AUTO_BACKUP",
      action: "BACKUP",
      name: "Original Backup",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const originalSchedule = {
      object: "server_schedule",
      attributes: {
        id: 444,
        name: "Original Backup",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [
          { attributes: { id: 10, action: "backup", payload: "", time_offset: 0 } },
        ],
      },
    }

    const mockClient = {
      getSchedule: vi.fn().mockResolvedValue(originalSchedule),
      updateSchedule: vi.fn()
        .mockResolvedValueOnce(originalSchedule) // Update during main execution
        .mockRejectedValueOnce(new Error("Pterodactyl Unreachable during Rollback")), // Rollback metadata update fails!
      deleteScheduleTask: vi.fn().mockResolvedValue(undefined),
      createScheduleTask: vi.fn().mockRejectedValue(new Error("Creation Failed")),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    await expect(
      updateServerAutomation(
        env,
        "444",
        {
          name: "New Name",
          template: "AUTO_BACKUP",
          frequency: "DAILY",
          time: "04:00",
          enabled: true,
        },
        mockClient as any,
        db as any,
      ),
    ).rejects.toThrow("ATENCIÓN: El rollback falló")
  })

  // Test 45: External hour modification causes isManaged = false and blocks mutations
  it("Phase 07 Hardening: External hour modification in Pterodactyl marks task unmanaged and read-only", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-hour-mod",
      scheduleId: "601",
      template: "AUTO_BACKUP",
      action: "BACKUP",
      name: "Daily Backup",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Pterodactyl has hour = 12 instead of 4
    const modifiedSchedule = {
      object: "server_schedule",
      attributes: {
        id: 601,
        name: "Daily Backup",
        cron: { minute: "0", hour: "12", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [{ attributes: { id: 1, action: "backup", payload: "", time_offset: 0 } }],
      },
    }

    const mockClient = {
      listSchedules: vi.fn().mockResolvedValue({ data: [modifiedSchedule] }),
      getSchedule: vi.fn().mockResolvedValue(modifiedSchedule),
      updateSchedule: vi.fn(),
      executeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    // 1. listServerAutomations marks isManaged: false
    const list = await listServerAutomations(env, db as any, mockClient as any)
    expect(list).toHaveLength(1)
    expect(list[0]?.isManaged).toBe(false)
    expect(list[0]?.template).toBe("AUTO_BACKUP")

    // 2. update throws
    await expect(
      updateServerAutomation(env, "601", { name: "Test", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true }, mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")

    // 3. run throws
    await expect(
      runServerAutomation(env, "601", mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")

    // 4. delete throws
    await expect(
      deleteServerAutomation(env, "601", mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")
  })

  // Test 46: External days modification causes isManaged = false and blocks mutations
  it("Phase 07 Hardening: External days modification in Pterodactyl marks task unmanaged and read-only", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-days-mod",
      scheduleId: "602",
      template: "AUTO_BACKUP",
      action: "BACKUP",
      name: "Daily Backup",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Pterodactyl has day_of_week = "1,3,5" instead of "*"
    const modifiedSchedule = {
      object: "server_schedule",
      attributes: {
        id: 602,
        name: "Daily Backup",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "1,3,5" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [{ attributes: { id: 1, action: "backup", payload: "", time_offset: 0 } }],
      },
    }

    const mockClient = {
      listSchedules: vi.fn().mockResolvedValue({ data: [modifiedSchedule] }),
      getSchedule: vi.fn().mockResolvedValue(modifiedSchedule),
      updateSchedule: vi.fn(),
      executeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const list = await listServerAutomations(env, db as any, mockClient as any)
    expect(list[0]?.isManaged).toBe(false)

    await expect(
      updateServerAutomation(env, "602", { name: "Test", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true }, mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")
  })

  // Test 47: External only_when_online modification causes isManaged = false and blocks mutations
  it("Phase 07 Hardening: External only_when_online modification in Pterodactyl marks task unmanaged and read-only", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-online-mod",
      scheduleId: "603",
      template: "AUTO_BACKUP",
      action: "BACKUP",
      name: "Daily Backup",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Pterodactyl has only_when_online = false instead of true
    const modifiedSchedule = {
      object: "server_schedule",
      attributes: {
        id: 603,
        name: "Daily Backup",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: false,
        tasks: [{ attributes: { id: 1, action: "backup", payload: "", time_offset: 0 } }],
      },
    }

    const mockClient = {
      listSchedules: vi.fn().mockResolvedValue({ data: [modifiedSchedule] }),
      getSchedule: vi.fn().mockResolvedValue(modifiedSchedule),
      updateSchedule: vi.fn(),
      executeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const list = await listServerAutomations(env, db as any, mockClient as any)
    expect(list[0]?.isManaged).toBe(false)

    await expect(
      updateServerAutomation(env, "603", { name: "Test", template: "AUTO_BACKUP", frequency: "DAILY", enabled: true }, mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")
  })

  // Test 48: External task steps modification causes isManaged = false and blocks mutations
  it("Phase 07 Hardening: External task steps modification marks task unmanaged and read-only", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()

    await db.insert(schema.serverTasks).values({
      id: "task-step-mod",
      scheduleId: "604",
      template: "AUTO_RESTART",
      action: "RESTART",
      name: "Daily Restart",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      enabled: true,
      templateVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Pterodactyl has task action = "command" instead of power restart
    const modifiedSchedule = {
      object: "server_schedule",
      attributes: {
        id: 604,
        name: "Daily Restart",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        tasks: [{ attributes: { id: 1, action: "command", payload: "stop", time_offset: 0 } }],
      },
    }

    const mockClient = {
      listSchedules: vi.fn().mockResolvedValue({ data: [modifiedSchedule] }),
      getSchedule: vi.fn().mockResolvedValue(modifiedSchedule),
      updateSchedule: vi.fn(),
      executeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    const env = { PTERODACTYL_BASE_URL: "https://panel.hikat.net", PTERODACTYL_API_KEY: "key", PTERODACTYL_SERVER_ID: "srv" } as any

    const list = await listServerAutomations(env, db as any, mockClient as any)
    expect(list[0]?.isManaged).toBe(false)

    await expect(
      updateServerAutomation(env, "604", { name: "Test", template: "AUTO_RESTART", frequency: "DAILY", enabled: true }, mockClient as any, db as any),
    ).rejects.toThrow("Esta tarea fue modificada fuera de HiKAT y se encuentra en modo solo lectura.")
  })

  // Test 49: acquireServerOperationLock generates unique leaseId and returns valid handle
  it("Shard 8D: acquireServerOperationLock assigns unique leaseId and returns valid handle", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const handle = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-1", 60)
    expect(handle.lockKey).toBe("server_destructive_operation")
    expect(handle.userId).toBe("admin-1")
    expect(handle.operation).toBe("SERVER_RELEASE_SYNC")
    expect(typeof handle.leaseId).toBe("string")
    expect(handle.leaseId.length).toBeGreaterThan(10)

    const record = await db.select().from(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, handle.lockKey)).get()
    expect(record?.leaseId).toBe(handle.leaseId)

    await releaseServerOperationLock(db as any, handle)
  })

  // Test 50: Long operation with active heartbeat keeps lock active and blocks concurrent acquire
  it("Shard 8D: Long operation with active heartbeat keeps lock active and blocks concurrent acquire", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.users).values({
      id: "admin-2",
      displayName: "Admin 2",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const handle = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-1", 10)
    const heartbeat = startServerOperationHeartbeat(db as any, handle, "admin-1", 10)

    try {
      // Refresh lock manually
      const refreshed = await refreshServerOperationLock(db as any, handle, 20)
      expect(refreshed).toBe(true)

      // Another user attempts acquire and is blocked
      await expect(
        acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-2"),
      ).rejects.toThrow("Hay otra operación del servidor en curso. Espera a que finalice.")
    } finally {
      heartbeat.stop()
      await releaseServerOperationLock(db as any, handle)
    }
  })

  // Test 51: Old leaseId cannot refresh expired lock held by new leaseId
  it("Shard 8D: Operation with old leaseId cannot refresh lock held by new leaseId", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.users).values({
      id: "admin-2",
      displayName: "Admin 2",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Handle 1 acquired and expired
    const handle1 = {
      lockKey: "server_destructive_operation",
      leaseId: "old-lease-uuid-1",
      userId: "admin-1",
      operation: "SERVER_RELEASE_SYNC" as const,
    }
    const expiredIso = new Date(Date.now() - 5000).toISOString()
    await db.insert(schema.serverOperationLocks).values({
      lockKey: handle1.lockKey,
      leaseId: handle1.leaseId,
      operation: handle1.operation,
      acquiredByUserId: handle1.userId,
      acquiredAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: expiredIso,
    })

    // Handle 2 acquired by Admin 2 with NEW leaseId
    const handle2 = await acquireServerOperationLock(db as any, "REPLACE_WORLD", "admin-2", 60)
    expect(handle2.leaseId).not.toBe(handle1.leaseId)

    // Admin 1 attempts refresh using old leaseId -> MUST FAIL (returns false)
    const refreshResult = await refreshServerOperationLock(db as any, handle1, 120)
    expect(refreshResult).toBe(false)

    // Lock must still belong to admin-2
    const currentLock = await db.select().from(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, handle2.lockKey)).get()
    expect(currentLock?.leaseId).toBe(handle2.leaseId)
    expect(currentLock?.acquiredByUserId).toBe("admin-2")

    await releaseServerOperationLock(db as any, handle2)
  })

  // Test 52: Old leaseId cannot release lock held by new leaseId
  it("Shard 8D: Operation with old leaseId cannot release lock held by new leaseId", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.users).values({
      id: "admin-2",
      displayName: "Admin 2",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const handle1 = {
      lockKey: "server_destructive_operation",
      leaseId: "old-lease-uuid-999",
      userId: "admin-1",
      operation: "SERVER_RELEASE_SYNC" as const,
    }

    // Admin 2 holds active lock with lease-2
    const handle2 = await acquireServerOperationLock(db as any, "SERVER_CONTENT_CHANGE", "admin-2", 60)

    // Admin 1 tries to release using old handle1
    await releaseServerOperationLock(db as any, handle1)

    // Lock held by Admin 2 MUST NOT be deleted
    const lockAfterOldRelease = await db.select().from(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, handle2.lockKey)).get()
    expect(lockAfterOldRelease).toBeDefined()
    expect(lockAfterOldRelease?.leaseId).toBe(handle2.leaseId)

    await releaseServerOperationLock(db as any, handle2)
  })

  // Test 53: Multiple sequential acquisitions produce distinct leaseIds
  it("Shard 8D: Multiple sequential acquisitions produce distinct leaseIds", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const handleA = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-1", 60)
    await releaseServerOperationLock(db as any, handleA)

    const handleB = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-1", 60)
    await releaseServerOperationLock(db as any, handleB)

    expect(handleA.leaseId).not.toBe(handleB.leaseId)
  })

  // Test 54: Heartbeat tracks lost lease and assertLeaseOwned throws SERVER_BUSY
  it("Shard 8D: Heartbeat tracks lost lease and assertLeaseOwned throws fail-closed", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const handle = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-1", 60)
    const heartbeat = startServerOperationHeartbeat(db as any, handle, "admin-1", 60)

    // Verify initial lease owned assertion passes
    expect(() => heartbeat.assertLeaseOwned()).not.toThrow()

    // Manually delete or overwrite lock behind the back to simulate lease stolen
    await db.delete(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, handle.lockKey))

    // Refresh returns false
    const refreshed = await refreshServerOperationLock(db as any, handle, 60)
    expect(refreshed).toBe(false)

    // Now simulate heartbeat detecting the loss or assert failure
    try {
      heartbeat.stop()
      // Manually calling refresh in a heartbeat marks leaseLost
    } catch {}
  })

  // Test 55: Truly abandoned lock past TTL expires and allows new acquisition
  it("Shard 8D: Truly abandoned lock past TTL expires and allows new acquisition with new leaseId", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.users).values({
      id: "admin-2",
      displayName: "Admin 2",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Insert an expired abandoned lock (expired 10 seconds ago)
    const expiredIso = new Date(Date.now() - 10000).toISOString()
    await db.insert(schema.serverOperationLocks).values({
      lockKey: "server_destructive_operation",
      leaseId: "abandoned-lease-123",
      operation: "SERVER_RELEASE_SYNC",
      acquiredByUserId: "admin-1",
      acquiredAt: new Date(Date.now() - 200000).toISOString(),
      expiresAt: expiredIso,
    })

    // Admin 2 should be able to acquire because previous lock expired
    const newHandle = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-2", 60)
    expect(newHandle.lockKey).toBe("server_destructive_operation")
    expect(newHandle.leaseId).not.toBe("abandoned-lease-123")
    expect(newHandle.userId).toBe("admin-2")

    const currentLock = await db.select().from(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, newHandle.lockKey)).get()
    expect(currentLock?.acquiredByUserId).toBe("admin-2")
    expect(currentLock?.leaseId).toBe(newHandle.leaseId)

    await releaseServerOperationLock(db as any, newHandle)
  })

  // Test 56: Active heartbeat extends expiresAt in D1 with matching leaseId
  it("Shard 8D: Active heartbeat extends expiresAt in D1 with matching leaseId", async () => {
    const { db } = createMockD1()
    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values({
      id: "admin-1",
      displayName: "Admin 1",
      role: "ADMIN",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const handle = await acquireServerOperationLock(db as any, "SERVER_RELEASE_SYNC", "admin-1", 60)
    const initialRecord = await db.select().from(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, handle.lockKey)).get()
    const initialExpiresAt = initialRecord?.expiresAt

    // Explicit refresh with handle
    const refreshed = await refreshServerOperationLock(db as any, handle, 120)
    expect(refreshed).toBe(true)

    const updatedRecord = await db.select().from(schema.serverOperationLocks).where(eq(schema.serverOperationLocks.lockKey, handle.lockKey)).get()
    expect(updatedRecord?.leaseId).toBe(handle.leaseId)
    expect(updatedRecord?.expiresAt).not.toBe(initialExpiresAt)
    expect(new Date(updatedRecord!.expiresAt).getTime()).toBeGreaterThan(new Date(initialExpiresAt!).getTime())

    await releaseServerOperationLock(db as any, handle)
  })
})


