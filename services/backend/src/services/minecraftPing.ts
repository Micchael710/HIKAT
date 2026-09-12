import net from "node:net"
import type { LauncherServerPingGql } from "@hikat/graphql"

export type MinecraftPingResult = LauncherServerPingGql

export const PING_CACHE_TTL_MS = 7000 // 7 seconds (5-10s requirement)

interface CachedPing {
  result: MinecraftPingResult
  timestamp: number
}

const pingCache = new Map<string, CachedPing>()
const inFlightPings = new Map<string, Promise<MinecraftPingResult>>()

let customPingImplementation:
  | ((host: string, port: number, timeoutMs?: number) => Promise<MinecraftPingResult>)
  | null = null

export function setPingImplementationForTesting(
  fn: ((host: string, port: number, timeoutMs?: number) => Promise<MinecraftPingResult>) | null,
) {
  customPingImplementation = fn
}

export function clearPingCacheForTesting() {
  pingCache.clear()
  inFlightPings.clear()
}

export function encodeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let v = value >>> 0
  do {
    let temp = v & 0x7f
    v >>>= 7
    if (v !== 0) {
      temp |= 0x80
    }
    bytes.push(temp)
  } while (v !== 0)
  return Buffer.from(bytes)
}

export function readVarInt(
  buffer: Buffer,
  offset: number,
): { value: number; bytesRead: number } {
  let value = 0
  let bytesRead = 0
  let b = 0
  do {
    const byte = buffer[offset + bytesRead]
    if (byte === undefined) {
      throw new Error("Buffer underflow reading VarInt")
    }
    b = byte
    value |= (b & 0x7f) << (7 * bytesRead)
    bytesRead++
    if (bytesRead > 5) {
      throw new Error("VarInt is too big")
    }
  } while ((b & 0x80) !== 0)
  return { value, bytesRead }
}

export function createHandshakePacket(host: string, port: number, protocolVersion = 767): Buffer {
  const packetId = encodeVarInt(0x00)
  const proto = encodeVarInt(protocolVersion)
  const hostBuf = Buffer.from(host, "utf-8")
  const hostLen = encodeVarInt(hostBuf.length)
  const portBuf = Buffer.alloc(2)
  portBuf.writeUInt16BE(port, 0)
  const nextState = encodeVarInt(1) // 1 for status

  const body = Buffer.concat([packetId, proto, hostLen, hostBuf, portBuf, nextState])
  const length = encodeVarInt(body.length)
  return Buffer.concat([length, body])
}

export function createRequestPacket(): Buffer {
  // Length: 1, Packet ID: 0x00
  return Buffer.from([0x01, 0x00])
}

export async function pingMinecraftServer(
  host: string,
  port: number,
  timeoutMs = 3500,
): Promise<MinecraftPingResult> {
  if (customPingImplementation) {
    return customPingImplementation(host, port, timeoutMs)
  }

  return new Promise((resolve, reject) => {
    let socket: net.Socket | null = null
    let resolved = false
    const startTime = Date.now()
    const chunks: Buffer[] = []
    let totalLength = 0

    const cleanup = () => {
      if (socket) {
        try {
          socket.removeAllListeners()
          socket.destroy()
        } catch {}
        socket = null
      }
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error(`Minecraft ping timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    try {
      socket = net.connect({ host, port }, () => {
        if (resolved || !socket) return
        try {
          socket.write(createHandshakePacket(host, port))
          socket.write(createRequestPacket())
        } catch (err) {
          if (!resolved) {
            resolved = true
            clearTimeout(timer)
            cleanup()
            reject(err)
          }
        }
      })

      socket.on("data", (chunk: Buffer) => {
        if (resolved) return
        chunks.push(chunk)
        totalLength += chunk.length

        const fullBuffer = Buffer.concat(chunks, totalLength)

        try {
          let offset = 0
          const { value: packetLength, bytesRead: lenBytes } = readVarInt(fullBuffer, offset)
          offset += lenBytes

          if (fullBuffer.length < offset + packetLength) {
            // Need more data
            return
          }

          const { value: packetId, bytesRead: idBytes } = readVarInt(fullBuffer, offset)
          offset += idBytes

          if (packetId !== 0x00) {
            throw new Error(`Unexpected packet ID: ${packetId}`)
          }

          const { value: jsonLen, bytesRead: strLenBytes } = readVarInt(fullBuffer, offset)
          offset += strLenBytes

          if (fullBuffer.length < offset + jsonLen) {
            // Need more data for full string
            return
          }

          const latencyMs = Math.max(1, Date.now() - startTime)
          const jsonString = fullBuffer.toString("utf-8", offset, offset + jsonLen)
          const parsed = JSON.parse(jsonString)

          resolved = true
          clearTimeout(timer)
          cleanup()

          const playersOnline = Number(parsed?.players?.online ?? 0)
          const maxPlayers = Number(parsed?.players?.max ?? 0)

          resolve({
            latencyMs,
            playersOnline,
            maxPlayers,
          })
        } catch (parseErr) {
          // If VarInt underflowed, wait for more chunks
          if (
            parseErr instanceof Error &&
            parseErr.message.includes("Buffer underflow")
          ) {
            return
          }
          resolved = true
          clearTimeout(timer)
          cleanup()
          reject(parseErr)
        }
      })

      socket.on("error", (err) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          cleanup()
          reject(err)
        }
      })

      socket.on("close", () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          cleanup()
          reject(new Error("Connection closed before response received"))
        }
      })
    } catch (err) {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        cleanup()
        reject(err)
      }
    }
  })
}

export async function getCachedServerPing(
  serverId: string,
  host: string,
  port: number,
  timeoutMs = 3500,
): Promise<MinecraftPingResult> {
  const now = Date.now()
  const cached = pingCache.get(serverId)
  if (cached && now - cached.timestamp < PING_CACHE_TTL_MS) {
    return cached.result
  }

  const existingInFlight = inFlightPings.get(serverId)
  if (existingInFlight) {
    return existingInFlight
  }

  const pingPromise = (async () => {
    try {
      const result = await pingMinecraftServer(host, port, timeoutMs)
      pingCache.set(serverId, {
        result,
        timestamp: Date.now(),
      })
      return result
    } finally {
      inFlightPings.delete(serverId)
    }
  })()

  inFlightPings.set(serverId, pingPromise)
  return pingPromise
}
