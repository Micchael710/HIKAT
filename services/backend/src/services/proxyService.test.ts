import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import type { Env } from "../types"
import type { IPterodactylClient } from "./pterodactyl/types"
import {
  validateProxyAuth,
  parseAndValidateProxyHostname,
  handleProxyConnect,
  handleProxyRoutes,
} from "./proxyService"
import { createServer } from "./serverService"
import app from "../index"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    ENVIRONMENT: "test",
    INTERNAL_PROXY_SECRET: "super-secure-proxy-secret-123",
    PTERODACTYL_BASE_URL: "https://panel.example.com",
    PTERODACTYL_APP_API_KEY: "ptla_test_app_key",
    PTERODACTYL_API_KEY: "ptlc_test_client_key",
    PTERODACTYL_SERVER_ID: "fallback-id",
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

describe("Proxy Service & Internal Endpoints Suite (Phase 1)", () => {
  describe("validateProxyAuth", () => {
    const env = createMockEnv()

    it("accepts valid Bearer token matching INTERNAL_PROXY_SECRET", () => {
      const req = new Request("http://localhost/internal/proxy/connect", {
        headers: { Authorization: "Bearer super-secure-proxy-secret-123" },
      })
      expect(validateProxyAuth(req, env)).toBe(true)
    })

    it("rejects when Authorization header is missing or not Bearer", () => {
      const req1 = new Request("http://localhost/internal/proxy/connect")
      expect(validateProxyAuth(req1, env)).toBe(false)

      const req2 = new Request("http://localhost/internal/proxy/connect", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      })
      expect(validateProxyAuth(req2, env)).toBe(false)
    })

    it("rejects token mismatch", () => {
      const req = new Request("http://localhost/internal/proxy/connect", {
        headers: { Authorization: "Bearer wrong-secret" },
      })
      expect(validateProxyAuth(req, env)).toBe(false)
    })

    it("rejects when INTERNAL_PROXY_SECRET is unset or empty", () => {
      const req = new Request("http://localhost/internal/proxy/connect", {
        headers: { Authorization: "Bearer super-secure-proxy-secret-123" },
      })
      expect(validateProxyAuth(req, createMockEnv({ INTERNAL_PROXY_SECRET: "" }))).toBe(false)
      expect(validateProxyAuth(req, createMockEnv({ INTERNAL_PROXY_SECRET: undefined }))).toBe(false)
    })
  })

  describe("parseAndValidateProxyHostname", () => {
    it("parses valid play-<slug>.hikat.org hostname", () => {
      expect(parseAndValidateProxyHostname("play-meliora.hikat.org")).toBe("meliora")
      expect(parseAndValidateProxyHostname("play-island.hikat.org")).toBe("island")
      expect(parseAndValidateProxyHostname("play-mi-servidor.hikat.org")).toBe("mi-servidor")
    })

    it("normalizes uppercase and allows optional trailing dot", () => {
      expect(parseAndValidateProxyHostname("PLAY-MELIORA.HIKAT.ORG")).toBe("meliora")
      expect(parseAndValidateProxyHostname("play-meliora.hikat.org.")).toBe("meliora")
      expect(parseAndValidateProxyHostname("  play-meliora.hikat.org.  ")).toBe("meliora")
    })

    it("rejects invalid hostnames strictly", () => {
      // Missing play- prefix
      expect(parseAndValidateProxyHostname("meliora.hikat.org")).toBeNull()
      // Different domain
      expect(parseAndValidateProxyHostname("play-meliora.other.org")).toBeNull()
      // Invalid characters (underscores not allowed in DNS label)
      expect(parseAndValidateProxyHostname("play-server_name.hikat.org")).toBeNull()
      // Leading or trailing hyphens in slug
      expect(parseAndValidateProxyHostname("play--meliora.hikat.org")).toBeNull()
      expect(parseAndValidateProxyHostname("play-meliora-.hikat.org")).toBeNull()
      // Exceeds 58 chars for slug
      const longSlug = "a".repeat(59)
      expect(parseAndValidateProxyHostname(`play-${longSlug}.hikat.org`)).toBeNull()
      // Valid at 58 chars
      const maxSlug = "a".repeat(58)
      expect(parseAndValidateProxyHostname(`play-${maxSlug}.hikat.org`)).toBe(maxSlug)
      // Empty or null
      expect(parseAndValidateProxyHostname("")).toBeNull()
      expect(parseAndValidateProxyHostname(null)).toBeNull()
      expect(parseAndValidateProxyHostname(undefined)).toBeNull()
    })
  })

  describe("handleProxyConnect", () => {
    let mockClient: IPterodactylClient

    beforeEach(() => {
      mockClient = {
        getApplicationServer: vi.fn(async () => ({
          object: "server" as const,
          attributes: {
            id: 10,
            external_id: "test-server-id",
            uuid: "uuid-10",
            identifier: "ptero-ident",
            name: "Meliora",
            node: 1,
            allocation: 101, // primary allocation ID
            nest: 1,
            egg: 15,
            status: null,
            limits: { memory: 4096, swap: 0, disk: 10240, io: 500, cpu: 200 },
            feature_limits: { databases: 0, allocations: 2, backups: 0 },
            user: 1,
            relationships: {
              allocations: {
                object: "list" as const,
                data: [
                  {
                    object: "allocation" as const,
                    attributes: {
                      id: 101, // matches primary
                      ip: "10.0.0.1",
                      alias: "node.hikat.org",
                      port: 25565,
                      notes: null,
                      assigned: true,
                    },
                  },
                  {
                    object: "allocation" as const,
                    attributes: {
                      id: 102, // secondary
                      ip: "10.0.0.1",
                      alias: "node.hikat.org",
                      port: 24455,
                      notes: null,
                      assigned: true,
                    },
                  },
                ],
              },
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        })),
        getApplicationNode: vi.fn(async () => ({
          object: "node" as const,
          attributes: {
            id: 1,
            name: "Default Node",
            description: null,
            location_id: 1,
            public: true,
            fqdn: "node.hikat.org",
            scheme: "https",
            behind_proxy: false,
            memory: 32768,
            memory_overallocate: 0,
            disk: 102400,
            disk_overallocate: 0,
            daemon_listen: 8080,
            daemon_sftp: 2022,
            daemon_base: "/var/lib/pterodactyl/volumes",
          },
        })),
        getServerResources: vi.fn(async () => ({
          object: "stats" as const,
          attributes: {
            current_state: "offline",
            is_suspended: false,
            resources: {
              memory_bytes: 0,
              cpu_absolute: 0,
              disk_bytes: 0,
              network_rx_bytes: 0,
              network_tx_bytes: 0,
              uptime: 0,
            },
          },
        })),
        getServerDetails: vi.fn(async () => ({
          object: "server" as const,
          attributes: {
            server_owner: true,
            identifier: "ptero-ident",
            uuid: "uuid-10",
            name: "Meliora",
            node: "Default Node",
            is_node_under_maintenance: false,
            sftp_details: { ip: "node.hikat.org", port: 2022 },
            description: "",
            limits: { memory: 4096, swap: 0, disk: 10240, io: 500, cpu: 200 },
            invocation: "java -jar server.jar",
            docker_image: "ghcr.io/pterodactyl/yolks:java_21",
            egg_features: [],
            feature_limits: { databases: 0, allocations: 2, backups: 0 },
            status: null,
            is_suspended: false,
            is_installing: false,
            is_transferring: false,
          },
        })),
        sendPowerAction: vi.fn(async () => {}),
      } as unknown as IPterodactylClient
    })

    it("rejects unauthorized request with 401", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(401)
      const data = (await res.json()) as any
      expect(data.error).toBe("Unauthorized")
    })

    it("rejects invalid intent with 400", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "INVALID" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.error).toBe("INVALID_INTENT")
    })

    it("rejects non-play hostname with 400", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "direct-meliora.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.error).toBe("INVALID_HOSTNAME")
    })

    it("returns 404 when server does not exist in D1", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-inexistente.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(404)
      const data = (await res.json()) as any
      expect(data.error).toBe("SERVER_NOT_FOUND")
    })

    it("returns UNAVAILABLE if server provisioningStatus is not READY", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      // Insert server with PROVISIONING status
      await db.insert(schema.servers).values({
        id: "server-prov-1",
        name: "Meliora",
        provisioningStatus: "PROVISIONING",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe("UNAVAILABLE")
    })

    it("returns UNAVAILABLE if primary allocation is missing in Pterodactyl response", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-ready-1",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      // Client returning allocations without matching primary ID 999
      const brokenClient = {
        ...mockClient,
        getApplicationServer: vi.fn(async () => ({
          object: "server" as const,
          attributes: {
            id: 10,
            node: 1,
            allocation: 999, // not in list
            relationships: {
              allocations: {
                object: "list" as const,
                data: [{ object: "allocation" as const, attributes: { id: 101, port: 25565 } }],
              },
            },
          } as any,
        })),
      } as unknown as IPterodactylClient

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, brokenClient)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe("UNAVAILABLE")
    })

    it("handles intent: 'STATUS' when server is OFFLINE (never calls START)", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-meliora",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "STATUS" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe("OFFLINE")
      expect(mockClient.sendPowerAction).not.toHaveBeenCalled()
    })

    it("handles intent: 'STATUS' when server is ONLINE", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-meliora",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      ;(mockClient.getServerResources as any).mockResolvedValueOnce({
        object: "stats",
        attributes: {
          current_state: "running",
          is_suspended: false,
          resources: { memory_bytes: 1000, cpu_absolute: 50, disk_bytes: 100, network_rx_bytes: 0, network_tx_bytes: 0, uptime: 100 },
        },
      })

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "STATUS" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe("ONLINE")
      expect(data.targetHost).toBe("node.hikat.org")
      expect(data.targetPort).toBe(25565)
      expect(mockClient.sendPowerAction).not.toHaveBeenCalled()
    })

    it("handles intent: 'LOGIN' when server is OFFLINE (calls START best-effort)", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-meliora",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe("STARTED")
      expect(mockClient.sendPowerAction).toHaveBeenCalledWith("start")
    })

    it("handles intent: 'LOGIN' when server is STARTING (does not call START again)", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-meliora",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      ;(mockClient.getServerResources as any).mockResolvedValueOnce({
        object: "stats",
        attributes: {
          current_state: "starting",
          is_suspended: false,
          resources: { memory_bytes: 1000, cpu_absolute: 50, disk_bytes: 100, network_rx_bytes: 0, network_tx_bytes: 0, uptime: 10 },
        },
      })

      const req = new Request("http://localhost/internal/proxy/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secure-proxy-secret-123",
        },
        body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "LOGIN" }),
      })

      const res = await handleProxyConnect(req, env, db, mockClient)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.status).toBe("STARTING")
      expect(mockClient.sendPowerAction).not.toHaveBeenCalled()
    })

    it("supports concurrent wake requests with best-effort idempotent semantics", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-meliora",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
        pterodactylIdentifier: "ptero-ident",
      })

      let callCount = 0
      ;(mockClient.sendPowerAction as any).mockImplementation(async () => {
        callCount++
        if (callCount > 1) {
          // Simulate upstream conflict on second call
          throw new Error("Server already in state starting")
        }
      })

      const makeReq = () =>
        new Request("http://localhost/internal/proxy/connect", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer super-secure-proxy-secret-123",
          },
          body: JSON.stringify({ hostname: "play-meliora.hikat.org", intent: "LOGIN" }),
        })

      // Send 2 concurrent requests
      const [res1, res2] = await Promise.all([
        handleProxyConnect(makeReq(), env, db, mockClient),
        handleProxyConnect(makeReq(), env, db, mockClient),
      ])

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)

      const d1 = (await res1.json()) as any
      const d2 = (await res2.json()) as any

      // Both requests resolve cleanly without failing or crashing
      expect(["STARTED", "STARTING"]).toContain(d1.status)
      expect(["STARTED", "STARTING"]).toContain(d2.status)
    })
  })

  describe("handleProxyRoutes", () => {
    let mockClient: IPterodactylClient

    beforeEach(() => {
      mockClient = {
        getApplicationServer: vi.fn(async () => ({
          object: "server" as const,
          attributes: {
            id: 10,
            node: 1,
            allocation: 101, // primary allocation ID (must be EXCLUDED)
            relationships: {
              allocations: {
                object: "list" as const,
                data: [
                  {
                    object: "allocation" as const,
                    attributes: { id: 101, port: 25565 }, // Primary (excluded)
                  },
                  {
                    object: "allocation" as const,
                    attributes: { id: 102, port: 24455 }, // Secondary (included)
                  },
                  {
                    object: "allocation" as const,
                    attributes: { id: 103, port: 24456 }, // Secondary (included)
                  },
                ],
              },
            },
          } as any,
        })),
        getApplicationNode: vi.fn(async () => ({
          object: "node" as const,
          attributes: { id: 1, fqdn: "node.hikat.org" } as any,
        })),
      } as unknown as IPterodactylClient
    })

    it("rejects unauthorized request with 401", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      const req = new Request("http://localhost/internal/proxy/routes")
      const res = await handleProxyRoutes(req, env, db, mockClient)
      expect(res.status).toBe(401)
    })

    it("returns secondary allocations and excludes primary allocation", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      await db.insert(schema.servers).values({
        id: "server-1",
        name: "Meliora",
        provisioningStatus: "READY",
        pterodactylServerId: "10",
      })

      const req = new Request("http://localhost/internal/proxy/routes", {
        headers: { Authorization: "Bearer super-secure-proxy-secret-123" },
      })

      const res = await handleProxyRoutes(req, env, db, mockClient)
      expect(res.status).toBe(200)
      const routes = (await res.json()) as any

      // Primary allocation port 25565 must NOT be present
      expect(routes.find((r: any) => r.publicPort === 25565)).toBeUndefined()

      // Secondary ports must be present with resolved node FQDN
      expect(routes).toEqual([
        {
          serverId: "server-1",
          publicPort: 24455,
          targetHost: "node.hikat.org",
          targetPort: 24455,
        },
        {
          serverId: "server-1",
          publicPort: 24456,
          targetHost: "node.hikat.org",
          targetPort: 24456,
        },
      ])
    })
  })

  describe("Integration with Worker fetch (index.ts)", () => {
    it("dispatches /internal/proxy/connect and rejects wrong HTTP methods", async () => {
      const env = createMockEnv()

      const getReq = new Request("http://localhost/internal/proxy/connect", {
        method: "GET",
      })
      const res = await app.fetch(getReq, env)
      expect(res.status).toBe(405)
    })

    it("dispatches /internal/proxy/routes and rejects wrong HTTP methods", async () => {
      const env = createMockEnv()

      const postReq = new Request("http://localhost/internal/proxy/routes", {
        method: "POST",
      })
      const res = await app.fetch(postReq, env)
      expect(res.status).toBe(405)
    })
  })

  describe("Slug collision validation in serverService.ts", () => {
    it("rejects creating a server whose name creates a conflicting proxy slug", async () => {
      const { db } = createMockD1()
      const env = createMockEnv()

      // Insert existing server named "Mi Servidor" (slug: "mi-servidor")
      await db.insert(schema.servers).values({
        id: "server-existing",
        name: "Mi Servidor",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        provisioningStatus: "READY",
      })

      // Attempt to create a server named "Mi-Servidor" (same slug: "mi-servidor")
      await expect(
        createServer(
          db,
          env,
          {
            name: "Mi-Servidor",
            minecraftVersion: "1.21.1",
            modLoader: "NEOFORGE" as any,
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
          },
          "admin-user-id",
        ),
      ).rejects.toThrow(/El nombre genera un identificador de conexión en conflicto/)
    })
  })
})
