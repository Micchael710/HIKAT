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
      version: "1.3.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      mandatory: true,
    })
  })

  it("broadcastReleaseActivated does not fail if RELEASE_EVENTS is undefined", async () => {
    const env: Env = {}
    await expect(
      broadcastReleaseActivated(env, {
        version: "1.0.0",
      }),
    ).resolves.toBeUndefined()
  })
})
