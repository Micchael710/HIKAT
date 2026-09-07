import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  createServer,
  getServers,
  getServerById,
  deleteServer,
  formatServerGql,
} from "./serverService"
import { handleGameFileDownload } from "./game/gameStorageService"
import type { IPterodactylClient } from "./pterodactyl/types"
import type { Env } from "../types"
import { eq } from "drizzle-orm"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AUTH_SECRET: "test-auth-secret",
    ENVIRONMENT: "test",
    PTERODACTYL_BASE_URL: "https://panel.example.com",
    PTERODACTYL_APP_API_KEY: "ptla_test_app_key",
    PTERODACTYL_API_KEY: "ptlc_test_client_key",
    PTERODACTYL_SERVER_ID: "fallback-pterodactyl-id",
    PTERODACTYL_DEFAULT_OWNER_ID: "1",
    PTERODACTYL_DEFAULT_EGG_ID: "1",
    PTERODACTYL_DEFAULT_LOCATION_ID: "1",
    ...overrides,
  } as Env
}

describe("ServerService & Multi-Server Provisioning", () => {
  let mockDb: ReturnType<typeof createDatabase>
  let mockEnv: Env
  let mockClient: IPterodactylClient
  let createdServersInPterodactyl: any[]
  let deletedServersInPterodactyl: (number | string)[]

  beforeEach(async () => {
    const { db } = createMockD1()
    mockDb = db
    mockEnv = createMockEnv()
    createdServersInPterodactyl = []
    deletedServersInPterodactyl = []

    await mockDb.insert(schema.users).values({
      id: "user-1",
      displayName: "User 1",
      role: "ADMIN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await mockDb.insert(schema.users).values({
      id: "user-test",
      displayName: "User Test",
      role: "ADMIN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    mockClient = {
      createApplicationServer: vi.fn(async (payload) => {
        const id = createdServersInPterodactyl.length + 100
        const record = {
          attributes: {
            id,
            identifier: `ptero_${id}`,
            name: payload.name,
            docker_image: payload.docker_image,
            external_id: payload.external_id,
          },
        }
        createdServersInPterodactyl.push({ payload, record })
        return record
      }),
      deleteApplicationServer: vi.fn(async (id) => {
        deletedServersInPterodactyl.push(id)
        return true
      }),
      getServerDetails: vi.fn(),
      setPowerState: vi.fn(),
      getUtilization: vi.fn(),
      getBackup: vi.fn(),
    } as unknown as IPterodactylClient
  })

  describe("Server Provisioning & Java/Docker Resolution", () => {
    it("provisions Minecraft 1.20.5+ with Java 21 docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Survival 1.20.6",
          minecraftVersion: "1.20.6",
          modLoader: "VANILLA",
          cpu: 250,
          memoryMb: 8192,
          diskMb: 20480,
          accentColor: "#3b82f6",
        },
        "user-1",
        mockClient,
      )

      expect(server.name).toBe("Survival 1.20.6")
      expect(server.provisioningStatus).toBe("READY")
      expect(server.cpu).toBe(250)
      expect(server.memoryMb).toBe(8192)
      expect(server.diskMb).toBe(20480)

      // Verify Pterodactyl payload
      expect(mockClient.createApplicationServer).toHaveBeenCalledTimes(1)
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_21")
      expect(call.name).toBe("Survival 1.20.6")
      expect(call.limits.memory).toBe(8192)
      expect(call.limits.cpu).toBe(250)
      expect(call.limits.disk).toBe(20480)
      expect(call.external_id).toBe(server.id)

      // Verify GraphQL representation does NOT expose Pterodactyl internal IDs
      expect((server as any).pterodactylServerId).toBeUndefined()
      expect((server as any).pterodactylIdentifier).toBeUndefined()
    })

    it("provisions Minecraft 1.18.2 with Java 17 docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Modpack 1.18.2",
          minecraftVersion: "1.18.2",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("READY")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_17")
    })

    it("provisions Minecraft 1.17.1 with Java 16 docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Server 1.17.1",
          minecraftVersion: "1.17.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("READY")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_16")
    })

    it("provisions Minecraft 1.16.5 with Java 8 docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Classic 1.16.5",
          minecraftVersion: "1.16.5",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("READY")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_8")
    })
  })

  describe("Validation & Constraints", () => {
    it("rejects invalid Windows folder names", async () => {
      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "Server:Invalid/Name",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("caracteres no permitidos")
    })

    it("rejects duplicate server names (case-insensitive)", async () => {
      await createServer(
        mockDb,
        mockEnv,
        {
          name: "Main Survival",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "main survival",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow('Ya existe un servidor con el nombre "main survival"')
    })

    it("validates and normalizes accent colors", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Color Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          accentColor: "#a855f7",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.accentColor).toBe("#A855F7")
    })
  })

  describe("Failure & Compensation Handling", () => {
    it("marks server as FAILED if Pterodactyl provisioning throws", async () => {
      const failingClient = {
        createApplicationServer: vi.fn(async () => {
          throw new Error("Pterodactyl Node Unavailable")
        }),
      } as unknown as IPterodactylClient

      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "Failing Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          failingClient,
        ),
      ).rejects.toThrow("Pterodactyl Node Unavailable")

      const inDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.name, "Failing Server"))
        .get()

      expect(inDb).toBeDefined()
      expect(inDb?.provisioningStatus).toBe("FAILED")
    })

    it("executes compensation deletion on Pterodactyl if final D1 update fails", async () => {
      // Mock db.update to fail on the second update
      let updateCount = 0
      const originalUpdate = mockDb.update.bind(mockDb)
      vi.spyOn(mockDb, "update").mockImplementation((table: any) => {
        updateCount++
        if (updateCount === 1 && table === schema.servers) {
          throw new Error("D1 Disk Full Error")
        }
        return originalUpdate(table)
      })

      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "Compensation Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("D1 Disk Full Error")

      // Upstream Pterodactyl server must have been deleted via compensation
      expect(mockClient.deleteApplicationServer).toHaveBeenCalledWith(100)
    })
  })

  describe("Server Query & Deletion", () => {
    it("lists servers and gets server by ID", async () => {
      const s1 = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Server A",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )
      const s2 = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Server B",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      const all = await getServers(mockDb, mockEnv)
      expect(all.length).toBe(2)
      expect(all.map((s) => s.name)).toEqual(["Server A", "Server B"])

      const single = await getServerById(mockDb, mockEnv, s1.id)
      expect(single?.name).toBe("Server A")

      const notFound = await getServerById(mockDb, mockEnv, "non-existent-id")
      expect(notFound).toBeNull()
    })

    it("deletes server from Pterodactyl and cascades D1 record", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Server To Delete",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      const result = await deleteServer(mockDb, mockEnv, server.id, mockClient)
      expect(result).toBe(true)

      expect(mockClient.deleteApplicationServer).toHaveBeenCalled()

      const check = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()

      expect(check).toBeUndefined()
    })
  })

  describe("Download Endpoint Authorization against servers.launcherActiveReleaseId", () => {
    it("allows download if file belongs to active release of the server", async () => {
      // 1. Create server
      const serverId = "srv-test-1"
      const releaseId = "rel-test-1"
      const fileId = "file-test-1"

      await mockDb.insert(schema.servers).values({
        id: serverId,
        name: "Test Server",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        launcherActiveReleaseId: releaseId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // 2. Insert release with serverId
      await mockDb.insert(schema.gameReleases).values({
        id: releaseId,
        serverId,
        version: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        status: "PUBLISHED",
        createdBy: "user-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // 3. Insert file
      await mockDb.insert(schema.gameReleaseFiles).values({
        id: fileId,
        releaseId,
        name: "example.jar",
        logicalPath: "mods/example.jar",
        isDirectory: 0,
        category: "MOD",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 1024,
        objectKey: "games/srv-test-1/files/mod.jar",
        createdAt: new Date().toISOString(),
      })

      // Mock R2 ASSETS binding
      const mockAssets = {
        get: vi.fn(async () => ({
          body: new ReadableStream(),
          size: 1024,
          httpMetadata: {},
          customMetadata: {},
          writeHttpMetadata: vi.fn(),
        })),
        head: vi.fn(async () => ({
          size: 1024,
          httpMetadata: {},
          customMetadata: {},
          writeHttpMetadata: vi.fn(),
        })),
      }

      const envWithAssets = {
        ...mockEnv,
        ASSETS: mockAssets,
      } as unknown as Env

      const req = new Request(`https://api.example.com/game/download/${fileId}`)
      const res = await handleGameFileDownload(req, envWithAssets, mockDb, fileId)

      expect(res.status).toBe(200)
    })

    it("rejects download if file belongs to a release that is NOT launcherActiveReleaseId for the server", async () => {
      const serverId = "srv-test-2"
      const activeReleaseId = "rel-active"
      const oldReleaseId = "rel-old"
      const fileId = "file-old-1"

      await mockDb.insert(schema.servers).values({
        id: serverId,
        name: "Test Server 2",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        launcherActiveReleaseId: activeReleaseId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.gameReleases).values({
        id: oldReleaseId,
        serverId,
        version: "0.9.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        status: "PUBLISHED",
        createdBy: "user-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.gameReleaseFiles).values({
        id: fileId,
        releaseId: oldReleaseId,
        name: "old-mod.jar",
        logicalPath: "mods/old-mod.jar",
        isDirectory: 0,
        category: "MOD",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 1024,
        objectKey: "games/srv-test-2/files/old-mod.jar",
        createdAt: new Date().toISOString(),
      })

      const mockAssets = {
        get: vi.fn(),
        head: vi.fn(),
      }

      const envWithAssets = {
        ...mockEnv,
        ASSETS: mockAssets,
      } as unknown as Env

      const req = new Request(`https://api.example.com/game/download/${fileId}`)
      const res = await handleGameFileDownload(req, envWithAssets, mockDb, fileId)

      expect(res.status).toBe(404)
      const data = await res.json()
      expect((data as any).error).toContain("no disponible públicamente")
    })
  })
})
