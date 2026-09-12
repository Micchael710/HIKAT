import { describe, it, expect, beforeEach, vi } from "vitest"
import { graphql } from "graphql"
import { getBaseSchema } from "@hikat/graphql"
import { resolvers } from "../resolvers"
import {
  setPingImplementationForTesting,
  clearPingCacheForTesting,
} from "./minecraftPing"
import {
  _clearServerAddressCacheForTesting,
  _setServerAddressOverrideForTesting,
} from "./serverService"
import {
  _resetServerStatusWatchersForTesting,
  ensureServerStatusWatcher,
} from "./pterodactyl/serverStatusWatcher"
import type { BackendGraphQLContext } from "../types"

describe("launcherServerPing GraphQL query and ServerStatusWatcher", () => {
  beforeEach(() => {
    clearPingCacheForTesting()
    _clearServerAddressCacheForTesting()
    _resetServerStatusWatchersForTesting()
    setPingImplementationForTesting(null)
    vi.restoreAllMocks()
  })

  it("resolves launcherServerPing query returning latencyMs, playersOnline, and maxPlayers", async () => {
    _setServerAddressOverrideForTesting("srv-test-1", "127.0.0.1", 25565)

    let pingCount = 0
    setPingImplementationForTesting(async () => {
      pingCount++
      return {
        latencyMs: 28,
        playersOnline: 12,
        maxPlayers: 100,
      }
    })

    const mockDb: any = {
      select: vi.fn(),
    }

    const context = {
      db: mockDb,
      env: {},
    } as unknown as BackendGraphQLContext

    const res = await (resolvers.Query as any).launcherServerPing(
      {},
      { serverId: "srv-test-1" },
      context,
    )

    expect(res).toEqual({
      latencyMs: 28,
      playersOnline: 12,
      maxPlayers: 100,
    })
    expect(pingCount).toBe(1)

    // Second query within TTL uses cache
    const res2 = await (resolvers.Query as any).launcherServerPing(
      {},
      { serverId: "srv-test-1" },
      context,
    )
    expect(res2).toEqual({
      latencyMs: 28,
      playersOnline: 12,
      maxPlayers: 100,
    })
    expect(pingCount).toBe(1)
  })

  it("returns null safely when server cannot be reached without throwing unhandled error", async () => {
    _setServerAddressOverrideForTesting("srv-offline", "127.0.0.1", 25565)

    setPingImplementationForTesting(async () => {
      throw new Error("Connection refused: 127.0.0.1:25565")
    })

    const mockDb: any = { select: vi.fn() }
    const context = { db: mockDb, env: {} } as unknown as BackendGraphQLContext

    const res = await (resolvers.Query as any).launcherServerPing(
      {},
      { serverId: "srv-offline" },
      context,
    )

    expect(res).toBeNull()
  })


  it("ensureServerStatusWatcher gets initial status and broadcasts SERVER_STATUS_CHANGED via shared DO", async () => {
    let broadcastPayload: any = null
    const mockStub: any = {
      fetch: vi.fn(async (_url: string, opts: any) => {
        broadcastPayload = JSON.parse(opts.body)
        return new Response(null, { status: 204 })
      }),
    }

    const mockNamespace: any = {
      idFromName: vi.fn(() => "global-id"),
      get: vi.fn(() => mockStub),
    }

    const env: any = {
      RELEASE_EVENTS: mockNamespace,
    }

    const mockClient: any = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "running",
          is_suspended: false,
          resources: { cpu_absolute: 15, memory_bytes: 1024, disk_bytes: 2048 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: {
          is_suspended: false,
          limits: { cpu: 200, memory: 4096 },
        },
      }),
      getWebsocketCredentials: vi.fn().mockRejectedValue(new Error("No wings in unit test")),
    }

    const status = await ensureServerStatusWatcher(env, "srv-live", undefined, mockClient)

    expect(status).toBe("ONLINE")
    expect(broadcastPayload).toEqual({
      type: "SERVER_STATUS_CHANGED",
      serverId: "srv-live",
      status: "ONLINE",
    })
  })
})
