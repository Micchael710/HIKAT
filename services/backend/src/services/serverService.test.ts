import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  createServer,
  getServers,
  getServerById,
  deleteServer,
  formatServerGql,
  getServerNodeCapacity,
  bootstrapServerPostInstall,
  updateServerPropertiesBootstrap,
  updateEulaBootstrap,
  resolveServerAllocationPort,
  syncServerProvisioningStatus,
} from "./serverService"
import { handleGameFileDownload } from "./game/gameStorageService"
import {
  createPterodactylApplicationClient,
  resolvePterodactylClient,
} from "./pterodactyl/serverAdministrationService"
import { prepareGameDraft, getPublishedModpack } from "./game/releaseService"
import { modProviderManager } from "./providers/modProviderManager"
import { replaceServerWorld, createServerWorldDownloadUrl } from "./pterodactyl/serverWorldService"
import { PterodactylHttpClient, ServerInfrastructureError } from "./pterodactyl/pterodactylClient"
import { restoreServerBackup } from "./pterodactyl/serverBackupService"
import { installServerContentPlan, removeServerManagedContent } from "./pterodactyl/serverContentService"
import { applyServerReleaseSync } from "./pterodactyl/serverReleaseSyncService"
import { createNews, updateNews, publishNews, unpublishNews, deleteNews } from "./newsService"
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
    PTERODACTYL_DEFAULT_LOCATION_ID: "1",
    PTERODACTYL_EGG_VANILLA_ID: "3",
    PTERODACTYL_EGG_FORGE_ID: "1",
    PTERODACTYL_EGG_NEOFORGE_ID: "15",
    PTERODACTYL_EGG_FABRIC_ID: "16",
    PTERODACTYL_EGG_QUILT_ID: "18",
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
      listApplicationNodes: vi.fn(async () => ({
        object: "list",
        data: [
          {
            object: "node",
            attributes: {
              id: 1,
              name: "Node-1",
              location_id: 1,
              memory: 32768,
              memory_overallocate: 0,
              disk: 102400,
              disk_overallocate: 0,
              allocated_resources: {
                memory: 4096,
                disk: 10240,
              },
            },
          },
        ],
      })),
      listApplicationNodeAllocations: vi.fn(async () => ({
        object: "list",
        data: [
          {
            object: "allocation",
            attributes: {
              id: 10,
              ip: "127.0.0.1",
              port: 25565,
              assigned: false,
            },
          },
          {
            object: "allocation",
            attributes: {
              id: 11,
              ip: "127.0.0.1",
              port: 25566,
              assigned: true,
            },
          },
        ],
      })),
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
      expect(server.provisioningStatus).toBe("PROVISIONING")
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

      expect(server.provisioningStatus).toBe("PROVISIONING")
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

      expect(server.provisioningStatus).toBe("PROVISIONING")
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

      expect(server.provisioningStatus).toBe("PROVISIONING")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_8")
    })

    it("provisions VANILLA server with correct Egg (3), environment, startup, and Java docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Vanilla Server",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.egg).toBe(3)
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_21")
      expect(call.startup).toBe("java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}")
      expect(call.environment).toEqual({
        SERVER_JARFILE: "server.jar",
        VANILLA_VERSION: "1.21.1",
      })
    })

    it("provisions FORGE server with correct Egg (1), environment, startup, and Java docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Forge Server",
          minecraftVersion: "1.20.1",
          modLoader: "FORGE",
          modLoaderVersion: "47.2.0",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.egg).toBe(1)
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_17")
      expect(call.startup).toBe(
        'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true $( [[  ! -f unix_args.txt ]] && printf %s "-jar {{SERVER_JARFILE}}" || printf %s "@unix_args.txt" )',
      )
      expect(call.environment).toEqual({
        SERVER_JARFILE: "server.jar",
        MC_VERSION: "1.20.1",
        BUILD_TYPE: "recommended",
        FORGE_VERSION: "1.20.1-47.2.0",
      })
    })

    it("provisions NEOFORGE server with correct Egg (15), environment, startup, and Java docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "NeoForge Server",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          modLoaderVersion: "21.1.65",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.egg).toBe(15)
      expect(call.docker_image).toBe("ghcr.io/pterodactyl/yolks:java_21")
      expect(call.startup).toBe(
        "java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true @unix_args.txt",
      )
      expect(call.environment).toEqual({
        MC_VERSION: "1.21.1",
        NEOFORGE_VERSION: "21.1.65",
      })
    })

    it("provisions FABRIC server with correct Egg (16), environment, startup, and ptero-eggs Java docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Fabric Server",
          minecraftVersion: "1.20.1",
          modLoader: "FABRIC",
          modLoaderVersion: "0.15.11",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.egg).toBe(16)
      expect(call.docker_image).toBe("ghcr.io/ptero-eggs/yolks:java_17")
      expect(call.startup).toBe("java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}")
      expect(call.environment).toEqual({
        SERVER_JARFILE: "server.jar",
        MC_VERSION: "1.20.1",
        FABRIC_VERSION: "latest",
        LOADER_VERSION: "0.15.11",
      })
    })

    it("provisions QUILT server with correct Egg (18), environment, startup, and ptero-eggs Java docker image", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Quilt Server",
          minecraftVersion: "1.20.1",
          modLoader: "QUILT",
          modLoaderVersion: "0.25.0",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")
      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.egg).toBe(18)
      expect(call.docker_image).toBe("ghcr.io/ptero-eggs/yolks:java_17")
      expect(call.startup).toBe("java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}} nogui")
      expect(call.environment).toEqual({
        SERVER_JARFILE: "server.jar",
        MC_VERSION: "1.20.1",
        QUILT_LOADER_VERSION: "0.25.0",
      })
    })

    it("rejects server creation when modLoader egg ID environment variable is missing", async () => {
      const invalidEnv = createMockEnv({
        PTERODACTYL_EGG_FABRIC_ID: undefined,
      })

      await expect(
        createServer(
          mockDb,
          invalidEnv,
          {
            name: "Missing Fabric Egg Server",
            minecraftVersion: "1.20.1",
            modLoader: "FABRIC",
            modLoaderVersion: "0.15.11",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("PTERODACTYL_EGG_FABRIC_ID")
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

    it("rejects CPU assignment below 50% or exceeding SERVER_MAX_CPU_PERCENT (1200%)", async () => {
      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "Low CPU Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 40,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("La asignación de CPU debe ser un número entero entre 50% y 1200%")

      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "High CPU Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 1250,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("La asignación de CPU debe ser un número entero entre 50% y 1200%")
    })

    it("rejects server creation when requested RAM exceeds Node capacity", async () => {
      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "Excessive RAM Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 65536, // Node has 32768
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("no puede superar la capacidad máxima del nodo (32768 MB)")
    })

    it("rejects server creation when requested disk exceeds available disk on Node", async () => {
      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "Excessive Disk Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 150000, // Available is 102400 - 10240 = 92160
          },
          "user-1",
          mockClient,
        ),
      ).rejects.toThrow("supera el espacio disponible en el nodo")
    })

    it("rejects server creation when Node has no unassigned allocations", async () => {
      const fullAllocationClient = {
        ...mockClient,
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "allocation",
              attributes: {
                id: 10,
                ip: "127.0.0.1",
                port: 25565,
                assigned: true,
              },
            },
          ],
        })),
      } as unknown as IPterodactylClient

      await expect(
        createServer(
          mockDb,
          mockEnv,
          {
            name: "No Port Server",
            minecraftVersion: "1.20.1",
            modLoader: "VANILLA",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          fullAllocationClient,
        ),
      ).rejects.toThrow("No hay puertos/allocations disponibles en el nodo de Pterodactyl")
    })

    it("uses explicit Node allocation and does not use deploy.locations", async () => {
      await createServer(
        mockDb,
        mockEnv,
        {
          name: "Allocation Test Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      const call = (mockClient.createApplicationServer as any).mock.calls[0][0]
      expect(call.allocation).toEqual({ default: 10 })
      expect(call.deploy).toBeUndefined()
    })
    it("creates server with custom accent color", async () => {
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
        listApplicationNodes: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "node",
              attributes: {
                id: 1,
                name: "Node-1",
                location_id: 1,
                memory: 16384,
                memory_overallocate: 0,
                disk: 102400,
                disk_overallocate: 0,
                allocated_resources: { memory: 4096, disk: 10240 },
              },
            },
          ],
        })),
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "allocation",
              attributes: {
                id: 10,
                ip: "127.0.0.1",
                port: 25565,
                assigned: false,
              },
            },
          ],
        })),
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

    it("logs complete provisioning failure details without leaking secrets and returns safe INTERNAL_ERROR", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const mockError = new ServerInfrastructureError(
        "SERVER_UNAVAILABLE",
        "El servidor de juego no se encuentra disponible en este momento.",
        'Pterodactyl Application API returned HTTP error 422: {"errors":[{"code":"ValidationException","detail":"No allocation available"}]}',
      )

      const failingClient = {
        listApplicationNodes: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "node",
              attributes: {
                id: 1,
                name: "Node-1",
                location_id: 1,
                memory: 16384,
                memory_overallocate: 0,
                disk: 102400,
                disk_overallocate: 0,
                allocated_resources: { memory: 4096, disk: 10240 },
              },
            },
          ],
        })),
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "allocation",
              attributes: {
                id: 10,
                ip: "127.0.0.1",
                port: 25565,
                assigned: false,
              },
            },
          ],
        })),
        createApplicationServer: vi.fn(async () => {
          throw mockError
        }),
      } as unknown as IPterodactylClient

      let caughtErr: any
      try {
        await createServer(
          mockDb,
          mockEnv,
          {
            name: "Logging Test Server",
            minecraftVersion: "1.21.1",
            modLoader: "VANILLA",
            cpu: 250,
            memoryMb: 8192,
            diskMb: 20480,
          },
          "user-1",
          failingClient,
        )
      } catch (err) {
        caughtErr = err
      }

      expect(caughtErr).toBeDefined()
      // GraphQL error code should be INTERNAL_ERROR and safe message
      expect(caughtErr.extensions?.code).toBe("INTERNAL_ERROR")
      expect(caughtErr.message).toBe("El servidor de juego no se encuentra disponible en este momento.")

      // Verify console.error was called with [Pterodactyl Provisioning Error] and all fields
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Pterodactyl Provisioning Error]",
        expect.objectContaining({
          serverName: "Logging Test Server",
          modLoader: "VANILLA",
          minecraftVersion: "1.21.1",
          eggId: 3,
          locationId: 1,
          memoryMb: 8192,
          cpu: 250,
          diskMb: 20480,
          errorName: "ServerInfrastructureError",
          errorMessage: "El servidor de juego no se encuentra disponible en este momento.",
          internalMessage: expect.stringContaining("No allocation available"),
        }),
      )

      // Ensure no secrets appear in the log arguments
      const allCalls = consoleErrorSpy.mock.calls
      const serializedLogs = JSON.stringify(allCalls)
      expect(serializedLogs).not.toContain("ptla_test_app_key")
      expect(serializedLogs).not.toContain("ptlc_test_client_key")
      expect(serializedLogs).not.toContain("test-auth-secret")
      expect(serializedLogs).not.toContain("Bearer")

      consoleErrorSpy.mockRestore()
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

      const result = await deleteServer(mockDb, mockEnv, server.id, true, mockClient)
      expect(result).toBe(true)

      expect(mockClient.deleteApplicationServer).toHaveBeenCalled()

      const check = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()

      expect(check).toBeUndefined()
    })

    it("syncs provisioning status from PROVISIONING to READY when Pterodactyl indicates installation completed", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Provisioning Sync Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")

      const writtenFiles: Record<string, string> = {}
      const syncClient = {
        getApplicationServer: vi.fn(async () => ({
          object: "server",
          attributes: {
            id: 100,
            identifier: "ptero_100",
            allocation: 10,
            node: 1,
            status: null,
            container: { installed: 1 },
          },
        })),
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "allocation",
              attributes: {
                id: 10,
                ip: "127.0.0.1",
                port: 25565,
                assigned: true,
              },
            },
          ],
        })),
        listDirectory: vi.fn(async () => ({
          object: "list",
          data: [],
        })),
        getFileContents: vi.fn(async (file: string) => {
          if (writtenFiles[file]) return writtenFiles[file]
          throw new Error("404 File not found")
        }),
        writeFile: vi.fn(async (file: string, content: string) => {
          writtenFiles[file] = content
        }),
      } as unknown as IPterodactylClient

      const list = await getServers(mockDb, mockEnv, undefined, syncClient)
      const found = list.find((s) => s.id === server.id)
      expect(found?.provisioningStatus).toBe("READY")

      // Verify D1 record updated to READY
      const inDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()
      expect(inDb?.provisioningStatus).toBe("READY")

      // Verify post-install bootstrap wrote eula.txt and server.properties
      expect(writtenFiles["eula.txt"]).toContain("eula=true")
      expect(writtenFiles["server.properties"]).toContain("server-ip=0.0.0.0")
      expect(writtenFiles["server.properties"]).toContain("server-port=25565")
      expect(writtenFiles["server.properties"]).toContain("query.port=25565")
    })

    it("syncs provisioning status from PROVISIONING to FAILED when Pterodactyl indicates installation failed", async () => {
      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Failed Install Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")

      const syncClient = {
        getApplicationServer: vi.fn(async () => ({
          object: "server",
          attributes: {
            id: 100,
            identifier: "ptero_100",
            status: "install_failed",
            container: { installed: 2 },
          },
        })),
      } as unknown as IPterodactylClient

      const single = await getServerById(mockDb, mockEnv, server.id, undefined, syncClient)
      expect(single?.provisioningStatus).toBe("FAILED")

      // Verify D1 record updated to FAILED
      const inDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()
      expect(inDb?.provisioningStatus).toBe("FAILED")
    })

    it("calculates real Node capacity with RAM available as total node memory and cumulative disk", async () => {
      const nodeClient = {
        listApplicationNodes: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "node",
              attributes: {
                id: 1,
                name: "Node-EU-1",
                location_id: 1,
                memory: 32768,
                memory_overallocate: 20,
                disk: 102400,
                disk_overallocate: 10, // 102400 * 1.1 = 112640 MB
                allocated_resources: {
                  memory: 8192,
                  disk: 20480,
                },
              },
            },
          ],
        })),
      } as unknown as IPterodactylClient

      const capacity = await getServerNodeCapacity(mockEnv, nodeClient)
      expect(capacity.totalMemoryMb).toBe(32768)
      expect(capacity.allocatedMemoryMb).toBe(8192)
      expect(capacity.availableMemoryMb).toBe(32768) // RAM is max per server, not subtracted

      expect(capacity.totalDiskMb).toBe(112640)
      expect(capacity.allocatedDiskMb).toBe(20480)
      expect(capacity.availableDiskMb).toBe(112640 - 20480)
    })

    it("handles -1 overallocate (unlimited) properly using base node capacity without negative values", async () => {
      const unlimitedClient = {
        listApplicationNodes: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "node",
              attributes: {
                id: 1,
                name: "Node-Unlimited",
                location_id: 1,
                memory: 16384,
                memory_overallocate: -1, // Unlimited
                disk: 51200,
                disk_overallocate: -1, // Unlimited
                allocated_resources: {
                  memory: 20480, // Even if allocated > memory
                  disk: 10240,
                },
              },
            },
          ],
        })),
      } as unknown as IPterodactylClient

      const capacity = await getServerNodeCapacity(mockEnv, unlimitedClient)
      expect(capacity.totalMemoryMb).toBe(16384)
      expect(capacity.availableMemoryMb).toBe(16384)
      expect(capacity.totalDiskMb).toBe(51200)
      expect(capacity.availableDiskMb).toBe(51200 - 10240)
    })

    it("throws controlled SERVICE_UNAVAILABLE error when node capacity cannot be obtained", async () => {
      const emptyNodeClient = {
        listApplicationNodes: vi.fn(async () => ({
          object: "list",
          data: [],
        })),
      } as unknown as IPterodactylClient

      await expect(getServerNodeCapacity(mockEnv, emptyNodeClient)).rejects.toThrow(
        "No se pudo obtener la información de capacidad del nodo de Pterodactyl",
      )
    })
  })

  describe("Post-Install Bootstrap", () => {
    it("updateServerPropertiesBootstrap generates minimum properties for empty file", () => {
      const result = updateServerPropertiesBootstrap("", 25575)
      expect(result).toContain("server-ip=0.0.0.0")
      expect(result).toContain("server-port=25575")
      expect(result).toContain("query.port=25575")
    })

    it("updateServerPropertiesBootstrap preserves comments and existing custom properties", () => {
      const original = [
        "# Minecraft server properties",
        "# Sun Mar 08 2026",
        "motd=HiKAT Epic Realm",
        "difficulty=hard",
        "pvp=false",
        "server-port=12345",
        "max-players=50",
      ].join("\n")

      const result = updateServerPropertiesBootstrap(original, 25580)
      expect(result).toContain("# Minecraft server properties")
      expect(result).toContain("motd=HiKAT Epic Realm")
      expect(result).toContain("difficulty=hard")
      expect(result).toContain("pvp=false")
      expect(result).toContain("max-players=50")
      expect(result).toContain("server-port=25580")
      expect(result).not.toContain("server-port=12345")
      expect(result).toContain("query.port=25580")
      expect(result).toContain("server-ip=0.0.0.0")
    })

    it("updateEulaBootstrap creates eula=true when empty and updates eula=false when existing", () => {
      expect(updateEulaBootstrap("")).toBe("eula=true\n")
      expect(updateEulaBootstrap("# comment\neula=false\n")).toBe("# comment\neula=true\n")
      expect(updateEulaBootstrap("eula=true\n")).toBe("eula=true\n")
    })

    it("resolveServerAllocationPort resolves port from relationships, node allocations, and does not fallback to first allocation", async () => {
      const mockPtero = {
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [
            {
              object: "allocation",
              attributes: { id: 77, port: 25590, assigned: true },
            },
            {
              object: "allocation",
              attributes: { id: 88, port: 25595, assigned: true },
            },
          ],
        })),
      } as unknown as IPterodactylClient

      // 1. From relationships matching allocation id
      const portFromRel = await resolveServerAllocationPort(mockPtero, {
        id: 1,
        allocation: 10,
        relationships: {
          allocations: {
            object: "list",
            data: [
              {
                object: "allocation",
                attributes: { id: 10, ip: "0.0.0.0", port: 25566, assigned: true, alias: null, notes: null },
              },
            ],
          },
        },
      } as any)
      expect(portFromRel).toBe(25566)

      // 2. Multiple relationships allocations, none matching: must NOT use relAllocations[0] and must continue to node lookup
      const portContinuedToNode = await resolveServerAllocationPort(mockPtero, {
        id: 2,
        node: 1,
        allocation: 88,
        relationships: {
          allocations: {
            object: "list",
            data: [
              {
                object: "allocation",
                attributes: { id: 1, ip: "0.0.0.0", port: 25501, assigned: true, is_default: false },
              },
              {
                object: "allocation",
                attributes: { id: 2, ip: "0.0.0.0", port: 25502, assigned: true, is_default: false },
              },
            ],
          },
        },
      } as any)
      expect(portContinuedToNode).toBe(25595)
      expect(portContinuedToNode).not.toBe(25501)

      // 3. From node allocations when relationships is absent
      const portFromNode = await resolveServerAllocationPort(mockPtero, {
        id: 3,
        node: 1,
        allocation: 77,
      } as any)
      expect(portFromNode).toBe(25590)

      // 4. Throws controlled error when real allocation cannot be resolved
      await expect(
        resolveServerAllocationPort({} as any, {
          id: 4,
          allocation: 999,
        } as any),
      ).rejects.toThrow("No se pudo resolver el puerto real de la allocation (999) para el servidor.")
    })

    it("createServer always initializes status to PROVISIONING even if Pterodactyl indicates installed", async () => {
      const installedClient = {
        ...mockClient,
        createApplicationServer: vi.fn(async (payload) => ({
          attributes: {
            id: 150,
            identifier: "ptero_installed",
            name: payload.name,
            docker_image: payload.docker_image,
            external_id: payload.external_id,
            status: null,
            container: { installed: 1 },
          },
        })),
      } as unknown as IPterodactylClient

      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Installed Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        installedClient,
      )

      expect(server.provisioningStatus).toBe("PROVISIONING")

      const inDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()

      expect(inDb?.provisioningStatus).toBe("PROVISIONING")
    })

    it("executes bootstrap across all 5 loaders (VANILLA, FORGE, NEOFORGE, FABRIC, QUILT) without touching loader internal files", async () => {
      const loaders = [
        { loader: "VANILLA" as const, mc: "1.20.1", version: undefined },
        { loader: "FORGE" as const, mc: "1.20.1", version: "47.2.0" },
        { loader: "NEOFORGE" as const, mc: "1.21.1", version: "21.1.65" },
        { loader: "FABRIC" as const, mc: "1.20.1", version: "0.15.7" },
        { loader: "QUILT" as const, mc: "1.20.1", version: "0.25.0" },
      ]

      for (const [i, entry] of loaders.entries()) {
        const { loader, mc, version } = entry
        const server = await createServer(
          mockDb,
          mockEnv,
          {
            name: `${loader} Bootstrap Server`,
            minecraftVersion: mc,
            modLoader: loader,
            modLoaderVersion: version,
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "user-1",
          mockClient,
        )

        expect(server.provisioningStatus).toBe("PROVISIONING")

        const writtenFiles: Record<string, string> = {}
        const syncClient = {
          getApplicationServer: vi.fn(async () => ({
            object: "server",
            attributes: {
              id: 200 + i,
              identifier: `ptero_${200 + i}`,
              allocation: 20 + i,
              node: 1,
              status: null,
              container: { installed: 1 },
            },
          })),
          listApplicationNodeAllocations: vi.fn(async () => ({
            object: "list",
            data: [
              {
                object: "allocation",
                attributes: {
                  id: 20 + i,
                  ip: "127.0.0.1",
                  port: 25570 + i,
                  assigned: true,
                },
              },
            ],
          })),
          listDirectory: vi.fn(async () => ({
            object: "list",
            data: [],
          })),
          getFileContents: vi.fn(async (file: string) => {
            if (writtenFiles[file]) return writtenFiles[file]
            throw new Error("404 File not found")
          }),
          writeFile: vi.fn(async (file: string, content: string) => {
            writtenFiles[file] = content
          }),
        } as unknown as IPterodactylClient

        const list = await getServers(mockDb, mockEnv, undefined, syncClient)
        const found = list.find((s) => s.id === server.id)
        expect(found?.provisioningStatus).toBe("READY")

        // Invariants for each loader:
        // 1. eula=true
        expect(writtenFiles["eula.txt"]).toBe("eula=true\n")
        // 2. server-ip=0.0.0.0
        expect(writtenFiles["server.properties"]).toContain("server-ip=0.0.0.0")
        // 3. server-port uses real allocation
        expect(writtenFiles["server.properties"]).toContain(`server-port=${25570 + i}`)
        // 4. query.port uses same allocation
        expect(writtenFiles["server.properties"]).toContain(`query.port=${25570 + i}`)

        // 5. Must NOT touch internal loader files
        expect(writtenFiles["unix_args.txt"]).toBeUndefined()
        expect(writtenFiles["run.sh"]).toBeUndefined()
        expect(writtenFiles["server.jar"]).toBeUndefined()
        expect(writtenFiles["libraries"]).toBeUndefined()
      }
    })

    it("fails without marking server READY and does not hide error when file writing fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "Write Fail Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      const serverInDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()

      expect(serverInDb).toBeDefined()
      expect(serverInDb?.pterodactylServerId).toBeDefined()

      const failingWriteClient = {
        getApplicationServer: vi.fn(async () => ({
          object: "server",
          attributes: {
            id: Number(serverInDb?.pterodactylServerId),
            identifier: "ptero_fail",
            allocation: 10,
            node: 1,
            status: null,
            container: { installed: 1 },
          },
        })),
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [{ object: "allocation", attributes: { id: 10, port: 25565, assigned: true } }],
        })),
        listDirectory: vi.fn(async () => ({
          object: "list",
          data: [],
        })),
        getFileContents: vi.fn(async () => ""),
        writeFile: vi.fn(async () => {
          throw new ServerInfrastructureError(
            "SERVER_UNAVAILABLE",
            "Fallo de disco en Wings al escribir archivo.",
            "Wings HTTP 500: Disk quota exceeded",
          )
        }),
      } as unknown as IPterodactylClient

      // Direct sync call should throw and log
      await expect(
        syncServerProvisioningStatus(serverInDb!, mockDb, mockEnv, failingWriteClient),
      ).rejects.toThrow("Fallo de disco en Wings al escribir archivo.")

      // Error was logged with diagnostic details
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Pterodactyl Server Bootstrap Error]",
        expect.objectContaining({
          serverId: server.id,
          pterodactylServerId: serverInDb?.pterodactylServerId,
          errorMessage: "Fallo de disco en Wings al escribir archivo.",
        }),
      )

      // Server in D1 was NOT marked READY (remains PROVISIONING)
      const inDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()
      expect(inDb?.provisioningStatus).toBe("PROVISIONING")

      consoleErrorSpy.mockRestore()
    })

    it("bootstrapServerPostInstall creates server.properties and eula.txt without attempting to read them when missing from root", async () => {
      const getFileContentsSpy = vi.fn(async () => {
        throw new Error("openat2: file does not exist")
      })
      const writtenFiles: Record<string, string> = {}
      const writeFileSpy = vi.fn(async (path: string, content: string) => {
        writtenFiles[path] = content
      })
      const listDirectorySpy = vi.fn(async () => ({
        object: "list" as const,
        data: [
          {
            object: "file_object" as const,
            attributes: {
              name: "logs",
              mode: "drwxr-xr-x",
              mode_bits: "0755",
              size: 4096,
              is_file: false,
              is_symlink: false,
              mimetype: "inode/directory",
              created_at: new Date().toISOString(),
              modified_at: new Date().toISOString(),
            },
          },
        ],
      }))

      const mockAppClient = {
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [{ object: "allocation", attributes: { id: 10, port: 25565, assigned: true } }],
        })),
      } as unknown as IPterodactylClient

      const mockFileClient = {
        listDirectory: listDirectorySpy,
        getFileContents: getFileContentsSpy,
        writeFile: writeFileSpy,
      } as unknown as IPterodactylClient

      await bootstrapServerPostInstall(
        { id: "srv-missing-files" } as schema.Server,
        { id: 100, allocation: 10, node: 1 } as any,
        mockAppClient,
        mockFileClient,
      )

      // 1. listDirectory was called on root "/"
      expect(listDirectorySpy).toHaveBeenCalledWith("/")
      // 2. getFileContents was NEVER called (avoiding Wings 500 openat2 file does not exist)
      expect(getFileContentsSpy).not.toHaveBeenCalled()
      // 3. Both files were created directly with required configurations
      expect(writtenFiles["eula.txt"]).toBe("eula=true\n")
      expect(writtenFiles["server.properties"]).toContain("server-ip=0.0.0.0")
      expect(writtenFiles["server.properties"]).toContain("server-port=25565")
      expect(writtenFiles["server.properties"]).toContain("query.port=25565")
    })

    it("bootstrapServerPostInstall reads and preserves existing server.properties and eula.txt when present in root", async () => {
      const getFileContentsSpy = vi.fn(async (file: string) => {
        if (file === "server.properties") {
          return "motd=Custom HiKAT Server\nview-distance=16\nserver-port=12345\n"
        }
        if (file === "eula.txt") {
          return "eula=false\n# Agreement from installer\n"
        }
        throw new Error("unexpected file read")
      })
      const writtenFiles: Record<string, string> = {}
      const writeFileSpy = vi.fn(async (path: string, content: string) => {
        writtenFiles[path] = content
      })
      const listDirectorySpy = vi.fn(async () => ({
        object: "list" as const,
        data: [
          {
            object: "file_object" as const,
            attributes: {
              name: "server.properties",
              mode: "-rw-r--r--",
              mode_bits: "0644",
              size: 50,
              is_file: true,
              is_symlink: false,
              mimetype: "text/plain",
              created_at: new Date().toISOString(),
              modified_at: new Date().toISOString(),
            },
          },
          {
            object: "file_object" as const,
            attributes: {
              name: "eula.txt",
              mode: "-rw-r--r--",
              mode_bits: "0644",
              size: 20,
              is_file: true,
              is_symlink: false,
              mimetype: "text/plain",
              created_at: new Date().toISOString(),
              modified_at: new Date().toISOString(),
            },
          },
        ],
      }))

      const mockAppClient = {
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [{ object: "allocation", attributes: { id: 10, port: 25565, assigned: true } }],
        })),
      } as unknown as IPterodactylClient

      const mockFileClient = {
        listDirectory: listDirectorySpy,
        getFileContents: getFileContentsSpy,
        writeFile: writeFileSpy,
      } as unknown as IPterodactylClient

      await bootstrapServerPostInstall(
        { id: "srv-existing-files" } as schema.Server,
        { id: 100, allocation: 10, node: 1 } as any,
        mockAppClient,
        mockFileClient,
      )

      // 1. Both existing files were read
      expect(getFileContentsSpy).toHaveBeenCalledWith("server.properties")
      expect(getFileContentsSpy).toHaveBeenCalledWith("eula.txt")
      // 2. server.properties preserved existing non-default properties and updated required ones
      expect(writtenFiles["server.properties"]).toContain("motd=Custom HiKAT Server")
      expect(writtenFiles["server.properties"]).toContain("view-distance=16")
      expect(writtenFiles["server.properties"]).toContain("server-ip=0.0.0.0")
      expect(writtenFiles["server.properties"]).toContain("server-port=25565")
      expect(writtenFiles["server.properties"]).toContain("query.port=25565")
      expect(writtenFiles["server.properties"]).not.toContain("server-port=12345")
      // 3. eula.txt preserved existing comment lines and updated eula=true
      expect(writtenFiles["eula.txt"]).toContain("eula=true")
      expect(writtenFiles["eula.txt"]).toContain("# Agreement from installer")
    })

    it("fails without marking server READY and keeps PROVISIONING when listDirectory fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const server = await createServer(
        mockDb,
        mockEnv,
        {
          name: "ListDir Fail Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      const serverInDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()

      const failingListClient = {
        getApplicationServer: vi.fn(async () => ({
          object: "server",
          attributes: {
            id: Number(serverInDb?.pterodactylServerId),
            identifier: "ptero_fail_listdir",
            allocation: 10,
            node: 1,
            status: null,
            container: { installed: 1 },
          },
        })),
        listApplicationNodeAllocations: vi.fn(async () => ({
          object: "list",
          data: [{ object: "allocation", attributes: { id: 10, port: 25565, assigned: true } }],
        })),
        listDirectory: vi.fn(async () => {
          throw new ServerInfrastructureError(
            "SERVER_UNAVAILABLE",
            "Fallo de conexión en Wings al listar archivos.",
            "Wings HTTP 500: DaemonConnectionException",
          )
        }),
      } as unknown as IPterodactylClient

      // Direct sync call should throw and log
      await expect(
        syncServerProvisioningStatus(serverInDb!, mockDb, mockEnv, failingListClient),
      ).rejects.toThrow("Fallo de conexión en Wings al listar archivos.")

      // Error logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Pterodactyl Server Bootstrap Error]",
        expect.objectContaining({
          serverId: server.id,
          pterodactylServerId: serverInDb?.pterodactylServerId,
          errorMessage: "Fallo de conexión en Wings al listar archivos.",
        }),
      )

      // Server in D1 was NOT marked READY (remains PROVISIONING)
      const inDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, server.id))
        .get()
      expect(inDb?.provisioningStatus).toBe("PROVISIONING")

      consoleErrorSpy.mockRestore()
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

  describe("Phase 1 Regression Protections", () => {
    it("1. con dos servidores, una mutación server-specific sin serverId falla", async () => {
      await mockDb.insert(schema.servers).values({
        id: "srv-a",
        name: "Server A",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.servers).values({
        id: "srv-b",
        name: "Server B",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Attempting a server-specific mutation without serverId when multiple exist must fail-closed
      await expect(
        prepareGameDraft(mockDb, "user-1", null, mockEnv, undefined, null),
      ).rejects.toThrow(/Se debe especificar el servidor para esta preparación de borrador de juego/)
    })

    it("2. una release con serverId NULL no puede usarse desde un serverId explícito", async () => {
      const srvExplicit = "srv-explicit-1"
      await mockDb.insert(schema.servers).values({
        id: srvExplicit,
        name: "Explicit Server",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const nullReleaseId = "rel-null-server"
      await mockDb.insert(schema.gameReleases).values({
        id: nullReleaseId,
        serverId: null,
        version: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        status: "PUBLISHED",
        createdBy: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // prepareGameDraft with explicit serverId must reject base release with serverId=null
      await expect(
        prepareGameDraft(mockDb, "user-1", { baseReleaseId: nullReleaseId }, mockEnv, undefined, srvExplicit),
      ).rejects.toThrow("La release base pertenece a otro servidor.")

      // getPublishedModpack with explicit serverId must return null if server's active release is serverId=null
      await mockDb
        .update(schema.servers)
        .set({ launcherActiveReleaseId: nullReleaseId })
        .where(eq(schema.servers.id, srvExplicit))

      const modpack = await getPublishedModpack(mockDb, mockEnv, undefined, srvExplicit)
      expect(modpack).toBeNull()
    })

    it("3. baseReleaseId de otro servidor sigue siendo rechazado", async () => {
      const srv1 = "srv-rel-1"
      const srv2 = "srv-rel-2"
      const releaseId = "rel-of-srv-1"

      await mockDb.insert(schema.servers).values({
        id: srv1,
        name: "Server 1",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.servers).values({
        id: srv2,
        name: "Server 2",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.gameReleases).values({
        id: releaseId,
        serverId: srv1,
        version: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        status: "PUBLISHED",
        createdBy: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await expect(
        prepareGameDraft(mockDb, "user-1", { baseReleaseId: releaseId }, mockEnv, undefined, srv2),
      ).rejects.toThrow("La release base pertenece a otro servidor.")
    })

    it("4. máximo un DRAFT por servidor (enforced by D1 index)", async () => {
      const srvDraft = "srv-draft-test"
      await mockDb.insert(schema.servers).values({
        id: srvDraft,
        name: "Draft Test Server",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.gameReleases).values({
        id: "draft-1",
        serverId: srvDraft,
        version: "draft-v1",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        status: "DRAFT",
        createdBy: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Attempting to insert a 2nd DRAFT on the same server must violate unique index
      await expect(
        mockDb.insert(schema.gameReleases).values({
          id: "draft-2",
          serverId: srvDraft,
          version: "draft-v2",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          status: "DRAFT",
          createdBy: "user-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow()
    })

    it("5. servidores distintos pueden tener cada uno su propio DRAFT", async () => {
      const srvA = "srv-draft-a"
      const srvB = "srv-draft-b"

      await mockDb.insert(schema.servers).values({
        id: srvA,
        name: "Server Draft A",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await mockDb.insert(schema.servers).values({
        id: srvB,
        name: "Server Draft B",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const draftA = await prepareGameDraft(mockDb, "user-1", null, mockEnv, undefined, srvA)
      const draftB = await prepareGameDraft(mockDb, "user-1", null, mockEnv, undefined, srvB)

      expect(draftA).toBeDefined()
      expect(draftB).toBeDefined()
      expect(draftA.id).not.toBe(draftB.id)
    })

    it("6. serverId inexistente en getActiveEnvironment y getPublishedEnvironment da NOT_FOUND", async () => {
      await expect(
        modProviderManager.getActiveEnvironment(mockDb, "non-existent-server-id"),
      ).rejects.toThrow("Servidor no encontrado.")

      await expect(
        modProviderManager.getPublishedEnvironment(mockDb, "non-existent-server-id"),
      ).rejects.toThrow("Servidor no encontrado.")
    })

    it("7. .env normal sin PTERODACTYL_DEFAULT_DOCKER_IMAGE usa Java derivado de Mojang", async () => {
      const normalEnv = createMockEnv({
        PTERODACTYL_DEFAULT_DOCKER_IMAGE: undefined,
      })

      const server120 = await createServer(
        mockDb,
        normalEnv,
        {
          name: "Mojang Java 17 Server",
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(mockClient.createApplicationServer).toHaveBeenCalledWith(
        expect.objectContaining({
          docker_image: "ghcr.io/pterodactyl/yolks:java_17",
        }),
      )

      const server121 = await createServer(
        mockDb,
        normalEnv,
        {
          name: "Mojang Java 21 Server",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          cpu: 200,
          memoryMb: 4096,
          diskMb: 10240,
        },
        "user-1",
        mockClient,
      )

      expect(mockClient.createApplicationServer).toHaveBeenCalledWith(
        expect.objectContaining({
          docker_image: "ghcr.io/pterodactyl/yolks:java_21",
        }),
      )
    })

    it("8. deleteServer(..., false) NO llama deleteApplicationServer y elimina solo D1", async () => {
      const serverId = "srv-keep-ptero"
      await mockDb.insert(schema.servers).values({
        id: serverId,
        name: "Keep Ptero Server",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        pterodactylServerId: "8888",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const deleteClient = {
        deleteApplicationServer: vi.fn(),
      } as unknown as IPterodactylClient

      const res = await deleteServer(mockDb, mockEnv, serverId, false, deleteClient)
      expect(res).toBe(true)
      expect(deleteClient.deleteApplicationServer).not.toHaveBeenCalled()

      const check = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, serverId))
        .get()
      expect(check).toBeUndefined()
    })

    it("9. deleteServer(..., true) sí elimina Pterodactyl antes de D1", async () => {
      const serverId = "srv-del-ptero"
      await mockDb.insert(schema.servers).values({
        id: serverId,
        name: "Delete Ptero Server",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        pterodactylServerId: "7777",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const deleteClient = {
        deleteApplicationServer: vi.fn(async () => {}),
      } as unknown as IPterodactylClient

      const res = await deleteServer(mockDb, mockEnv, serverId, true, deleteClient)
      expect(res).toBe(true)
      expect(deleteClient.deleteApplicationServer).toHaveBeenCalledWith("7777")

      const check = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, serverId))
        .get()
      expect(check).toBeUndefined()
    })

    it("10. si deletePterodactyl=true y Pterodactyl falla, D1 se conserva", async () => {
      const serverId = "srv-failing-delete-10"
      await mockDb.insert(schema.servers).values({
        id: serverId,
        name: "Server Failing Delete 10",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
        pterodactylServerId: "9999",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const failingDeleteClient = {
        deleteApplicationServer: vi.fn(async () => {
          throw new Error("Pterodactyl Upstream 500 Failure")
        }),
      } as unknown as IPterodactylClient

      await expect(
        deleteServer(mockDb, mockEnv, serverId, true, failingDeleteClient),
      ).rejects.toThrow("Error al eliminar el servidor en Pterodactyl")

      // Verify row is still in D1 for retry
      const rowInDb = await mockDb
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, serverId))
        .get()

      expect(rowInDb).toBeDefined()
      expect(rowInDb?.id).toBe(serverId)
    })

    it("11. con 2 servidores, replaceServerWorld sin serverId falla antes de tocar Pterodactyl", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-world-1",
          name: "World Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-world-2",
          name: "World Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      await expect(
        replaceServerWorld(mockEnv, mockDb, "user-1", "world.zip"),
      ).rejects.toThrow("Se debe especificar el servidor para esta reemplazo de mundo")
    })

    it("12. con 2 servidores, restoreServerBackup sin serverId falla", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-bk-1",
          name: "Backup Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-bk-2",
          name: "Backup Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      await expect(
        restoreServerBackup(mockEnv, mockDb, "user-1", "backup-uuid-123"),
      ).rejects.toThrow("Se debe especificar el servidor para esta restauración de copia de seguridad")
    })

    it("13. con 2 servidores, installServerContentPlan sin serverId falla", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-content-1",
          name: "Content Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-content-2",
          name: "Content Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      await expect(
        installServerContentPlan(
          mockDb,
          mockEnv,
          { provider: "MODRINTH", projectId: "test-proj", versionId: "test-ver" },
          "user-1",
        ),
      ).rejects.toThrow("Se debe especificar el servidor para esta instalación de contenido del servidor")
    })

    it("14. con 2 servidores, removeServerManagedContent sin serverId falla", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-rm-1",
          name: "Remove Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-rm-2",
          name: "Remove Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      await expect(
        removeServerManagedContent(mockDb, mockEnv, "content-id-1", "user-1"),
      ).rejects.toThrow("Se debe especificar el servidor para esta eliminación de contenido administrado del servidor")
    })

    it("15. con 2 servidores, applyServerReleaseSync sin serverId falla", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-sync-1",
          name: "Sync Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-sync-2",
          name: "Sync Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      await expect(
        applyServerReleaseSync(mockDb, mockEnv, "user-1"),
      ).rejects.toThrow("Se debe especificar el servidor para esta sincronización de release en el servidor")
    })

    it("16. con 2 servidores, createNews sin serverId falla", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-news-1",
          name: "News Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-news-2",
          name: "News Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      await expect(
        createNews(mockDb, mockEnv, "user-1", {
          title: "Test News Title",
          content: "This is test news content of valid length",
          type: "NEWS",
          serverId: null,
        }),
      ).rejects.toThrow("Se debe especificar el servidor para esta creación de noticia")
    })

    it("17. update/publish/unpublish/delete de una noticia usando serverId de otro servidor se rechaza", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-alpha",
          name: "Server Alpha",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-beta",
          name: "Server Beta",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      const newsA = await mockDb
        .insert(schema.news)
        .values({
          id: "news-srv-a",
          serverId: "srv-alpha",
          title: "News Alpha",
          content: "Content for Server Alpha",
          type: "NEWS",
          status: "DRAFT",
          createdBy: "user-1",
          updatedBy: "user-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .returning()
        .get()

      // Update with different serverId
      await expect(
        updateNews(
          mockDb,
          mockEnv,
          "user-1",
          newsA.id,
          { title: "Updated Alpha Title" },
          undefined,
          "srv-beta",
        ),
      ).rejects.toThrow("La noticia pertenece a otro servidor.")

      // Publish with different serverId
      await expect(
        publishNews(mockDb, mockEnv, "user-1", newsA.id, undefined, "srv-beta"),
      ).rejects.toThrow("La noticia pertenece a otro servidor.")

      // Unpublish with different serverId
      await expect(
        unpublishNews(mockDb, mockEnv, "user-1", newsA.id, undefined, "srv-beta"),
      ).rejects.toThrow("La noticia pertenece a otro servidor.")

      // Delete with different serverId
      await expect(
        deleteNews(mockDb, newsA.id, "srv-beta"),
      ).rejects.toThrow("La noticia pertenece a otro servidor.")
    })

    it("18. con 2 servidores, createServerWorldDownloadUrl sin serverId falla antes de llamar compressFiles", async () => {
      await mockDb.insert(schema.servers).values([
        {
          id: "srv-wdl-1",
          name: "World DL Server 1",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "srv-wdl-2",
          name: "World DL Server 2",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          provisioningStatus: "READY",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      const compressFiles = vi.fn()
      const mockClient = { compressFiles } as unknown as IPterodactylClient

      await expect(
        createServerWorldDownloadUrl(mockEnv, undefined, null, mockClient, mockDb),
      ).rejects.toThrow("Se debe especificar el servidor para esta descarga de mundo")

      expect(compressFiles).not.toHaveBeenCalled()
    })

    it("19. deleteApplicationServer con 404 es idempotente: deleteServer retorna true y elimina D1", async () => {
      const serverId = "srv-del-404"
      await mockDb.insert(schema.servers).values({
        id: serverId,
        name: "Server Del 404",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
        pterodactylServerId: "ptero-404-id",
        provisioningStatus: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Real PterodactylHttpClient with a fetch mock that returns 404 for DELETE
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ code: "NotFound" }] }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      )
      const realClient = new PterodactylHttpClient({
        baseUrl: mockEnv.PTERODACTYL_BASE_URL as string,
        appApiKey: mockEnv.PTERODACTYL_APP_API_KEY as string,
        fetchFn: mockFetch,
      })

      // deleteServer with deletePterodactyl=true; 404 from Pterodactyl must be treated as success
      const result = await deleteServer(mockDb, mockEnv, serverId, true, realClient as unknown as IPterodactylClient)
      expect(result).toBe(true)

      // D1 row must be gone
      const row = await mockDb.select().from(schema.servers).where(eq(schema.servers.id, serverId)).get()
      expect(row).toBeUndefined()
    })
  })
})
