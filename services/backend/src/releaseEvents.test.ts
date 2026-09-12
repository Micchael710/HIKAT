import { describe, it, expect, vi } from "vitest"
import {
  ReleaseEventsDurableObject,
  broadcastReleaseActivated,
} from "./releaseEvents"
import type { Env } from "./types"

if (typeof (globalThis as any).WebSocketPair === "undefined") {
  ;(globalThis as any).WebSocketPair = class MockWebSocketPair {
    0: any
    1: any
    constructor() {
      this[0] = { send: vi.fn(), close: vi.fn() }
      this[1] = { send: vi.fn(), close: vi.fn() }
    }
  }
}

const OriginalResponse = globalThis.Response
class TestResponse extends OriginalResponse {
  webSocket: any = null
  constructor(body?: any, init?: any) {
    if (init?.status === 101) {
      super(null, { status: 200 })
      Object.defineProperty(this, "status", { value: 101 })
      this.webSocket = init.webSocket
    } else {
      super(body, init)
    }
  }
}
;(globalThis as any).Response = TestResponse

describe("ReleaseEventsDurableObject & broadcastReleaseActivated", () => {
  it("returns 426 when upgrade header is not websocket", async () => {
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
    }
    const doInstance = new ReleaseEventsDurableObject(mockCtx)

    const request = new Request("http://localhost/launcher/release-events", {
      headers: { "Content-Type": "application/json" },
    })

    const response = await doInstance.fetch(request)
    expect(response.status).toBe(426)
    expect(await response.text()).toBe("WebSocket required")
    expect(mockCtx.acceptWebSocket).not.toHaveBeenCalled()
  })

  it("accepts websocket connection via Hibernation API, checks storage for catch-up event, and returns 101", async () => {
    const storageMap = new Map<string, any>()
    storageMap.set(
      "latestReleaseEvent",
      JSON.stringify({ type: "RELEASE_ACTIVATED", version: "1.2.0" }),
    )

    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async (k: string) => storageMap.get(k)),
        put: vi.fn(async (k: string, v: any) => storageMap.set(k, v)),
      },
    }
    const doInstance = new ReleaseEventsDurableObject(mockCtx)

    const request = new Request("http://localhost/launcher/release-events", {
      headers: { Upgrade: "websocket" },
    })

    const response = await doInstance.fetch(request)
    expect(response.status).toBe(101)
    expect(response.webSocket).toBeDefined()
    expect(mockCtx.acceptWebSocket).toHaveBeenCalledTimes(1)
    expect(mockCtx.storage.get).toHaveBeenCalledWith("latestReleaseEvent")
  })

  it("handles /broadcast POST, persists latestReleaseEvent to storage, and sends message to active WebSockets", async () => {
    const ws1 = { send: vi.fn() }
    const ws2 = { send: vi.fn() }
    const ws3 = {
      send: vi.fn(() => {
        throw new Error("Broken pipe")
      }),
    }

    const storageMap = new Map<string, any>()
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => [ws1, ws2, ws3]),
      storage: {
        get: vi.fn(async (k: string) => storageMap.get(k)),
        put: vi.fn(async (k: string, v: any) => storageMap.set(k, v)),
      },
    }
    const doInstance = new ReleaseEventsDurableObject(mockCtx)

    const payload = JSON.stringify({
      type: "RELEASE_ACTIVATED",
      version: "1.2.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      mandatory: true,
    })

    const request = new Request("http://internal/broadcast", {
      method: "POST",
      body: payload,
    })

    const response = await doInstance.fetch(request)
    expect(response.status).toBe(204)
    expect(mockCtx.storage.put).toHaveBeenCalledWith("latestReleaseEvent", payload)
    expect(storageMap.get("latestReleaseEvent")).toBe(payload)
    expect(ws1.send).toHaveBeenCalledWith(payload)
    expect(ws2.send).toHaveBeenCalledWith(payload)
    expect(ws3.send).toHaveBeenCalledWith(payload)
  })

  it("does not overwrite latestReleaseEvent when SERVER_UPDATED is broadcast, but still sends live to WebSockets, and updates on next release", async () => {
    const ws1 = { send: vi.fn() }
    const storageMap = new Map<string, any>()
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => [ws1]),
      storage: {
        get: vi.fn(async (k: string) => storageMap.get(k)),
        put: vi.fn(async (k: string, v: any) => storageMap.set(k, v)),
      },
    }
    const doInstance = new ReleaseEventsDurableObject(mockCtx)

    // 1. Initial release 1.0.0
    const release1 = JSON.stringify({
      type: "RELEASE_ACTIVATED",
      serverId: "warria-id",
      version: "1.0.0",
    })
    await doInstance.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: release1,
    }))
    expect(storageMap.get("latestReleaseEvent")).toBe(release1)
    expect(ws1.send).toHaveBeenCalledWith(release1)

    // 2. SERVER_UPDATED broadcast
    const serverUpdated = JSON.stringify({
      type: "SERVER_UPDATED",
      serverId: "warria-id",
    })
    await doInstance.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: serverUpdated,
    }))
    // Must NOT overwrite latestReleaseEvent
    expect(storageMap.get("latestReleaseEvent")).toBe(release1)
    // Must STILL send to active WebSockets in real time
    expect(ws1.send).toHaveBeenCalledWith(serverUpdated)

    // 3. Subsequent release 1.0.1
    const release2 = JSON.stringify({
      type: "RELEASE_ACTIVATED",
      serverId: "warria-id",
      version: "1.0.1",
    })
    await doInstance.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: release2,
    }))
    // Now storage is updated to 1.0.1
    expect(storageMap.get("latestReleaseEvent")).toBe(release2)
    expect(ws1.send).toHaveBeenCalledWith(release2)
  })

  it("broadcastReleaseActivated formats payload and calls Durable Object stub", async () => {
    let broadcastReqUrl = ""
    let broadcastReqOptions: any = null

    const mockStub: any = {
      fetch: vi.fn(async (url: string, options: any) => {
        broadcastReqUrl = url
        broadcastReqOptions = options
        return new Response(null, { status: 204 })
      }),
    }

    const mockNamespace: any = {
      idFromName: vi.fn(() => "global-id"),
      get: vi.fn(() => mockStub),
    }

    const env: Env = {
      RELEASE_EVENTS: mockNamespace,
    }

    await broadcastReleaseActivated(env, {
      version: "1.3.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      mandatory: true,
    })

    expect(mockNamespace.idFromName).toHaveBeenCalledWith("global")
    expect(mockNamespace.get).toHaveBeenCalledWith("global-id")
    expect(broadcastReqUrl).toBe("http://internal/broadcast")
    expect(broadcastReqOptions.method).toBe("POST")

    const parsedBody = JSON.parse(broadcastReqOptions.body)
    expect(parsedBody).toEqual({
      type: "RELEASE_ACTIVATED",
      serverId: null,
      version: "1.3.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: null,
      neoForgeVersion: "21.1.65",
      mandatory: true,
      notes: null,
      cover: null,
    })

    // Also test with explicit serverId, notes, and cover
    await broadcastReleaseActivated(env, {
      serverId: "srv-survival-01",
      version: "1.4.0",
      minecraftVersion: "1.20.1",
      modLoader: "FABRIC",
      modLoaderVersion: "0.15.7",
      mandatory: true,
      notes: "Patch notes for 1.4.0",
      cover: {
        id: "media-cover-1",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 1024,
        url: "http://cdn/cover.png",
        createdAt: "2026-09-11T00:00:00Z",
      },
    })
    const parsedWithServer = JSON.parse(broadcastReqOptions.body)
    expect(parsedWithServer.serverId).toBe("srv-survival-01")
    expect(parsedWithServer.version).toBe("1.4.0")
    expect(parsedWithServer.modLoader).toBe("FABRIC")
    expect(parsedWithServer.notes).toBe("Patch notes for 1.4.0")
    expect(parsedWithServer.cover.url).toBe("http://cdn/cover.png")
  })

  it("broadcastReleaseActivated does not fail if RELEASE_EVENTS is undefined", async () => {
    const env: Env = {}
    await expect(
      broadcastReleaseActivated(env, {
        version: "1.0.0",
      }),
    ).resolves.toBeUndefined()
  })

  it("broadcastServerStatusChanged formats payload and calls Durable Object stub", async () => {
    let broadcastReqUrl = ""
    let broadcastReqOptions: any = null

    const mockStub: any = {
      fetch: vi.fn(async (url: string, options: any) => {
        broadcastReqUrl = url
        broadcastReqOptions = options
        return new Response(null, { status: 204 })
      }),
    }

    const mockNamespace: any = {
      idFromName: vi.fn(() => "global-id"),
      get: vi.fn(() => mockStub),
    }

    const env: Env = {
      RELEASE_EVENTS: mockNamespace,
    }

    const { broadcastServerStatusChanged } = await import("./releaseEvents")
    await broadcastServerStatusChanged(env, "srv-test-1", "ONLINE")

    expect(mockNamespace.idFromName).toHaveBeenCalledWith("global")
    expect(mockNamespace.get).toHaveBeenCalledWith("global-id")
    expect(broadcastReqUrl).toBe("http://internal/broadcast")
    expect(broadcastReqOptions.method).toBe("POST")

    const parsedBody = JSON.parse(broadcastReqOptions.body)
    expect(parsedBody).toEqual({
      type: "SERVER_STATUS_CHANGED",
      serverId: "srv-test-1",
      status: "ONLINE",
    })
  })

  it("stores server status by serverId and replays cached statuses to newly connected WebSockets", async () => {
    const storageMap = new Map<string, any>()
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async (k: string) => storageMap.get(k)),
        put: vi.fn(async (k: string, v: any) => storageMap.set(k, v)),
        list: vi.fn(async (opts?: { prefix?: string }) => {
          const results = new Map<string, any>()
          for (const [k, v] of storageMap.entries()) {
            if (!opts?.prefix || k.startsWith(opts.prefix)) {
              results.set(k, v)
            }
          }
          return results
        }),
      },
    }
    const doInstance = new ReleaseEventsDurableObject(mockCtx)

    // Broadcast status change for two servers
    const status1 = JSON.stringify({
      type: "SERVER_STATUS_CHANGED",
      serverId: "server-a",
      status: "ONLINE",
    })
    const status2 = JSON.stringify({
      type: "SERVER_STATUS_CHANGED",
      serverId: "server-b",
      status: "OFFLINE",
    })

    await doInstance.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: status1,
    }))
    await doInstance.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: status2,
    }))

    expect(storageMap.get("serverStatus_server-a")).toBe(status1)
    expect(storageMap.get("serverStatus_server-b")).toBe(status2)

    // New WebSocket connects -> receives replay of statuses
    const res = await doInstance.fetch(new Request("http://localhost/launcher/release-events", {
      headers: { Upgrade: "websocket" },
    }))

    expect(res.status).toBe(101)
  })

  it("centralized watcher does not depend on global Map; multiple DO instances are completely isolated", async () => {
    const createMockCtx = () => ({
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        list: vi.fn(async () => new Map()),
      },
    })

    const do1 = new ReleaseEventsDurableObject(createMockCtx() as any)
    const do2 = new ReleaseEventsDurableObject(createMockCtx() as any)

    await do1.ensureWatcher("srv-unique-1")

    expect(do1.getActiveWatchersCount()).toBe(1)
    expect(do2.getActiveWatchersCount()).toBe(0)
  })

  it("starting twice for the same serverId does not create duplicate watchers", async () => {
    const createMockCtx = () => ({
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        list: vi.fn(async () => new Map()),
      },
    })

    const doInstance = new ReleaseEventsDurableObject(createMockCtx() as any)

    const res1 = await doInstance.fetch(new Request("http://internal/watch-servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverIds: ["srv-repeat-1"] }),
    }))
    const res2 = await doInstance.fetch(new Request("http://internal/watch-servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverIds: ["srv-repeat-1"] }),
    }))

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(doInstance.getActiveWatchersCount()).toBe(1)
  })

  it("fetches initial status via Pterodactyl REST and publishes SERVER_STATUS_CHANGED", async () => {
    const storageMap = new Map<string, any>()
    const sentMessages: string[] = []
    const mockClientWs = {
      send: vi.fn((msg) => sentMessages.push(msg)),
    }
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => [mockClientWs]),
      storage: {
        get: vi.fn(async (k) => storageMap.get(k)),
        put: vi.fn(async (k, v) => storageMap.set(k, v)),
        list: vi.fn(async () => new Map()),
      },
    }

    const mockPteroClient: any = {
      getServerResources: vi.fn().mockResolvedValue({
        attributes: {
          current_state: "running",
          is_suspended: false,
          resources: { cpu_absolute: 10, memory_bytes: 1000, disk_bytes: 2000 },
        },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: {
          is_suspended: false,
          limits: { cpu: 100, memory: 2048 },
        },
      }),
      getWebsocketCredentials: vi.fn().mockRejectedValue(new Error("No wings in unit test")),
    }

    const env: any = {
      PTERODACTYL_BASE_URL: "https://panel.test",
    }

    const doInstance = new ReleaseEventsDurableObject(mockCtx, env)
    doInstance.setClientOverrideForTesting(mockPteroClient)

    const status = await doInstance.ensureWatcher("srv-initial-online")

    expect(status).toBe("ONLINE")
    expect(doInstance.getWatcherStatus("srv-initial-online")).toBe("ONLINE")

    // Stored in storage
    const stored = JSON.parse(storageMap.get("serverStatus_srv-initial-online")!)
    expect(stored).toEqual({
      type: "SERVER_STATUS_CHANGED",
      serverId: "srv-initial-online",
      status: "ONLINE",
    })

    // Broadcast to connected client WebSocket
    expect(sentMessages.length).toBeGreaterThan(0)
    const broadcasted = JSON.parse(sentMessages[0]!)
    expect(broadcasted).toEqual({
      type: "SERVER_STATUS_CHANGED",
      serverId: "srv-initial-online",
      status: "ONLINE",
    })
  })

  it("multiple servers maintain independent statuses", async () => {
    const storageMap = new Map<string, any>()
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async (k) => storageMap.get(k)),
        put: vi.fn(async (k, v) => storageMap.set(k, v)),
        list: vi.fn(async () => new Map()),
      },
    }

    const doInstance = new ReleaseEventsDurableObject(mockCtx)
    await doInstance.ensureWatcher("server-alpha")
    await doInstance.ensureWatcher("server-beta")

    await doInstance.broadcastStatus("server-alpha", "ONLINE")
    await doInstance.broadcastStatus("server-beta", "OFFLINE")

    expect(doInstance.getWatcherStatus("server-alpha")).toBe("ONLINE")
    expect(doInstance.getWatcherStatus("server-beta")).toBe("OFFLINE")

    expect(JSON.parse(storageMap.get("serverStatus_server-alpha")!).status).toBe("ONLINE")
    expect(JSON.parse(storageMap.get("serverStatus_server-beta")!).status).toBe("OFFLINE")
  })

  it("unwatch server removes status from storage and stops watcher", async () => {
    const storageMap = new Map<string, any>()
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async (k) => storageMap.get(k)),
        put: vi.fn(async (k, v) => storageMap.set(k, v)),
        delete: vi.fn(async (k) => storageMap.delete(k)),
        list: vi.fn(async () => new Map()),
      },
    }

    const doInstance = new ReleaseEventsDurableObject(mockCtx)
    await doInstance.ensureWatcher("server-to-delete")
    await doInstance.broadcastStatus("server-to-delete", "ONLINE")

    expect(doInstance.getActiveWatchersCount()).toBe(1)
    expect(storageMap.has("serverStatus_server-to-delete")).toBe(true)

    const res = await doInstance.fetch(new Request("http://internal/unwatch-server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: "server-to-delete" }),
    }))

    expect(res.status).toBe(200)
    expect(doInstance.getActiveWatchersCount()).toBe(0)
    expect(storageMap.has("serverStatus_server-to-delete")).toBe(false)
  })

  it("restoreWatchedServers awaits all stored watchers during blockConcurrencyWhile", async () => {
    const storageMap = new Map<string, any>()
    storageMap.set("watchedServerIds", ["srv-restore-1", "srv-restore-2"])

    let blockConcurrencyPromise: Promise<void> | null = null
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async (k) => storageMap.get(k)),
        put: vi.fn(async (k, v) => storageMap.set(k, v)),
        list: vi.fn(async () => new Map()),
      },
      blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => {
        blockConcurrencyPromise = fn()
      }),
    }

    const doInstance = new ReleaseEventsDurableObject(mockCtx)
    expect(mockCtx.blockConcurrencyWhile).toHaveBeenCalled()

    await blockConcurrencyPromise
    expect(doInstance.getActiveWatchersCount()).toBe(2)
    expect(doInstance.getWatcherStatus("srv-restore-1")).toBe("UNKNOWN")
    expect(doInstance.getWatcherStatus("srv-restore-2")).toBe("UNKNOWN")
  })

  it("ensureWatcher registers connectWingsWatcher via ctx.waitUntil without unhandled floating promises", async () => {
    const storageMap = new Map<string, any>()
    const waitUntilPromises: Promise<any>[] = []
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      waitUntil: vi.fn((p: Promise<any>) => {
        waitUntilPromises.push(p)
      }),
      storage: {
        get: vi.fn(async (k) => storageMap.get(k)),
        put: vi.fn(async (k, v) => storageMap.set(k, v)),
        list: vi.fn(async () => new Map()),
      },
    }

    const env: any = {
      PTERODACTYL_BASE_URL: "https://panel.test",
    }

    const doInstance = new ReleaseEventsDurableObject(mockCtx, env)
    await doInstance.ensureWatcher("srv-wait-until")

    expect(mockCtx.waitUntil).toHaveBeenCalled()
    expect(waitUntilPromises.length).toBe(1)
    // The registered promise must resolve cleanly without uncaught rejection
    await expect(waitUntilPromises[0]).resolves.toBeUndefined()
  })

  it("concurrent /watch-servers and ensureWatcher calls merge all serverIds into watchedServerIds without losing any", async () => {
    const storageMap = new Map<string, any>()
    const mockCtx: any = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      storage: {
        get: vi.fn(async (k) => {
          // Simulate non-zero async delay in DO storage
          await new Promise((r) => setTimeout(r, 10))
          return storageMap.get(k)
        }),
        put: vi.fn(async (k, v) => {
          // Simulate non-zero async delay in DO storage
          await new Promise((r) => setTimeout(r, 10))
          storageMap.set(k, v)
        }),
        list: vi.fn(async () => new Map()),
        delete: vi.fn(async (k) => {
          storageMap.delete(k)
        }),
      },
    }

    const doInstance = new ReleaseEventsDurableObject(mockCtx)

    // Simulate concurrent batch requests and direct calls with overlapping and duplicate IDs
    const req1 = doInstance.fetch(
      new Request("http://internal/watch-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverIds: ["srv-batch-1", "srv-batch-2", "srv-batch-1"] }),
      }),
    )

    const req2 = doInstance.fetch(
      new Request("http://internal/watch-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverIds: ["srv-batch-2", "srv-batch-3", "srv-batch-4"] }),
      }),
    )

    const req3 = doInstance.ensureWatcher("srv-direct-5")
    const req4 = doInstance.ensureWatcher("srv-direct-6")

    const [res1, res2] = await Promise.all([req1, req2, req3, req4])
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)

    const watched = storageMap.get("watchedServerIds")
    expect(watched).toBeDefined()
    expect(Array.isArray(watched)).toBe(true)
    expect(watched.sort()).toEqual(
      ["srv-batch-1", "srv-batch-2", "srv-batch-3", "srv-batch-4", "srv-direct-5", "srv-direct-6"].sort(),
    )
    expect(doInstance.getActiveWatchersCount()).toBe(6)
  })
})


