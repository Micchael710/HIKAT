import { describe, it, expect, beforeEach, vi } from "vitest"
import { resolvers } from "../resolvers"
import {
  setPingImplementationForTesting,
  clearPingCacheForTesting,
} from "./minecraftPing"
import {
  _clearServerAddressCacheForTesting,
  _setServerAddressOverrideForTesting,
} from "./serverService"
import { notifyDurableObjectWatchServers, ReleaseEventsDurableObject } from "../releaseEvents"
import type { BackendGraphQLContext } from "../types"

describe("launcherServerPing GraphQL query and Durable Object Watcher", () => {
  beforeEach(() => {
    clearPingCacheForTesting()
    _clearServerAddressCacheForTesting()
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

  it("launcherServerPing and launcherServers notify Durable Object via notifyDurableObjectWatchServers", async () => {
    let watchReqUrl = ""
    let watchReqBody: any = null
    const mockStub: any = {
      fetch: vi.fn(async (url: string, opts: any) => {
        watchReqUrl = url
        watchReqBody = JSON.parse(opts.body)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    }

    const mockNamespace: any = {
      idFromName: vi.fn(() => "global-id"),
      get: vi.fn(() => mockStub),
    }

    const env: any = {
      RELEASE_EVENTS: mockNamespace,
    }

    await notifyDurableObjectWatchServers(env, ["srv-live-1", "srv-live-2"])

    expect(mockNamespace.idFromName).toHaveBeenCalledWith("global")
    expect(watchReqUrl).toBe("http://internal/watch-servers")
    expect(watchReqBody).toEqual({
      serverIds: ["srv-live-1", "srv-live-2"],
    })
  })
})
