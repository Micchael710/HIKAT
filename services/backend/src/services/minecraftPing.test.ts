import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  encodeVarInt,
  readVarInt,
  createHandshakePacket,
  createRequestPacket,
  getCachedServerPing,
  clearPingCacheForTesting,
  setPingImplementationForTesting,
  PING_CACHE_TTL_MS,
} from "./minecraftPing"

describe("Minecraft Ping Service & Caching / Dedupe", () => {
  beforeEach(() => {
    clearPingCacheForTesting()
    setPingImplementationForTesting(null)
    vi.restoreAllMocks()
  })

  it("encodes and decodes VarInt correctly for small and large values", () => {
    const testValues = [0, 1, 127, 128, 255, 25565, 767, 2097151]
    for (const val of testValues) {
      const encoded = encodeVarInt(val)
      const { value, bytesRead } = readVarInt(encoded, 0)
      expect(value).toBe(val)
      expect(bytesRead).toBe(encoded.length)
    }
  })

  it("creates valid handshake and request packets with correct length framing", () => {
    const handshake = createHandshakePacket("play.example.com", 25565)
    expect(handshake.length).toBeGreaterThan(0)
    const { value: packetLen, bytesRead } = readVarInt(handshake, 0)
    expect(handshake.length).toBe(bytesRead + packetLen)

    const request = createRequestPacket()
    expect(request.length).toBe(2)
    expect(request[0]).toBe(0x01) // length 1
    expect(request[1]).toBe(0x00) // packet id 0
  })

  it("getCachedServerPing caches responses within TTL and avoids repeated pings", async () => {
    let pingCount = 0
    setPingImplementationForTesting(async () => {
      pingCount++
      return {
        latencyMs: 42,
        playersOnline: 7,
        maxPlayers: 50,
      }
    })

    const res1 = await getCachedServerPing("srv-1", "127.0.0.1", 25565)
    expect(res1).toEqual({ latencyMs: 42, playersOnline: 7, maxPlayers: 50 })
    expect(pingCount).toBe(1)

    // Second call immediately uses cache
    const res2 = await getCachedServerPing("srv-1", "127.0.0.1", 25565)
    expect(res2).toEqual(res1)
    expect(pingCount).toBe(1)

    // Different serverId triggers separate ping
    const res3 = await getCachedServerPing("srv-2", "127.0.0.1", 25566)
    expect(res3).toEqual({ latencyMs: 42, playersOnline: 7, maxPlayers: 50 })
    expect(pingCount).toBe(2)
  })

  it("deduplicates concurrent in-flight ping requests for the same serverId", async () => {
    let pingCount = 0
    let resolvePing: (val: any) => void = () => {}

    setPingImplementationForTesting(async () => {
      pingCount++
      return new Promise((resolve) => {
        resolvePing = resolve
      })
    })

    const p1 = getCachedServerPing("srv-dedupe", "127.0.0.1", 25565)
    const p2 = getCachedServerPing("srv-dedupe", "127.0.0.1", 25565)
    const p3 = getCachedServerPing("srv-dedupe", "127.0.0.1", 25565)

    expect(pingCount).toBe(1) // Only one ping started

    resolvePing({
      latencyMs: 15,
      playersOnline: 3,
      maxPlayers: 20,
    })

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1).toEqual({ latencyMs: 15, playersOnline: 3, maxPlayers: 20 })
    expect(r2).toEqual(r1)
    expect(r3).toEqual(r1)
    expect(pingCount).toBe(1)
  })

  it("cleans up in-flight promise if ping fails and allows subsequent retry", async () => {
    let attempt = 0
    setPingImplementationForTesting(async () => {
      attempt++
      if (attempt === 1) {
        throw new Error("Connection refused")
      }
      return {
        latencyMs: 20,
        playersOnline: 1,
        maxPlayers: 10,
      }
    })

    await expect(
      getCachedServerPing("srv-retry", "127.0.0.1", 25565),
    ).rejects.toThrow("Connection refused")

    // Subsequent call retries because failed promise is not cached
    const res = await getCachedServerPing("srv-retry", "127.0.0.1", 25565)
    expect(res).toEqual({ latencyMs: 20, playersOnline: 1, maxPlayers: 10 })
    expect(attempt).toBe(2)
  })
})
