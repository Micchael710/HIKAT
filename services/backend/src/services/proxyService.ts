import { timingSafeEqual } from "node:crypto"
import { eq } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { serverNameToProxySlug } from "@hikat/shared"
import type { Env } from "../types"
import {
  createPterodactylApplicationClient,
  resolvePterodactylClient,
  getServerStatus,
} from "./pterodactyl/serverAdministrationService"
import type { IPterodactylClient, PterodactylApplicationServerResponse } from "./pterodactyl/types"

export const PROXY_HOSTNAME_REGEX = /^play-([a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?)\.hikat\.org$/

export function validateProxyAuth(request: Request, env: Env): boolean {
  const expectedSecret = env.INTERNAL_PROXY_SECRET
  if (!expectedSecret || typeof expectedSecret !== "string" || expectedSecret.trim() === "") {
    return false
  }

  const authHeader = request.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return false
  }

  const providedSecret = authHeader.slice(7).trim()
  const expectedBuf = Buffer.from(expectedSecret)
  const providedBuf = Buffer.from(providedSecret)

  if (expectedBuf.length !== providedBuf.length) {
    return false
  }

  return timingSafeEqual(expectedBuf, providedBuf)
}

export function parseAndValidateProxyHostname(rawHostname?: string | null): string | null {
  if (!rawHostname || typeof rawHostname !== "string") {
    return null
  }

  const normalized = rawHostname.toLowerCase().trim().replace(/\.$/, "")
  const match = normalized.match(PROXY_HOSTNAME_REGEX)
  if (!match || !match[1]) {
    return null
  }

  return match[1]
}

export interface ProxyConnectRequestBody {
  hostname?: string
  intent?: "LOGIN" | "STATUS"
}

export interface ProxyConnectResponse {
  status: "STARTED" | "STARTING" | "ONLINE" | "OFFLINE" | "UNAVAILABLE"
  targetHost?: string
  targetPort?: number
}

export interface ProxyRouteItem {
  serverId: string
  publicPort: number
  targetHost: string
  targetPort: number
}

export async function handleProxyConnect(
  request: Request,
  env: Env,
  db?: Database,
  clientOverride?: IPterodactylClient,
): Promise<Response> {
  if (!validateProxyAuth(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: ProxyConnectRequestBody
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const intent = body.intent
  if (intent !== "LOGIN" && intent !== "STATUS") {
    return new Response(JSON.stringify({ error: "INVALID_INTENT" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const slug = parseAndValidateProxyHostname(body.hostname)
  if (!slug) {
    return new Response(JSON.stringify({ error: "INVALID_HOSTNAME" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!db) {
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const allServers = await db.select().from(schema.servers).all()
  const server = allServers.find((s) => serverNameToProxySlug(s.name) === slug)

  if (!server) {
    return new Response(JSON.stringify({ error: "SERVER_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (server.provisioningStatus !== "READY" || !server.pterodactylServerId) {
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const appClient = clientOverride || ((env as any).pterodactylClient as IPterodactylClient) || createPterodactylApplicationClient(env)
  let pServer: PterodactylApplicationServerResponse | undefined

  try {
    pServer = await appClient.getApplicationServer(server.pterodactylServerId)
  } catch (err) {
    console.error("[ProxyService] Failed querying Pterodactyl application server:", err)
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!pServer?.attributes) {
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Dynamically resolve targetHost from node FQDN
  const nodeId = pServer.attributes.node
  let targetHost: string | undefined
  try {
    const nodeRes = await appClient.getApplicationNode(nodeId)
    targetHost = nodeRes?.attributes?.fqdn
  } catch (err) {
    console.error("[ProxyService] Failed querying Pterodactyl node FQDN:", err)
  }

  if (!targetHost) {
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Resolve primary allocation targetPort
  const primaryAllocationId = pServer.attributes.allocation
  const allocations = pServer.attributes.relationships?.allocations?.data || []
  const matchedAlloc = allocations.find((a) => a.attributes.id === primaryAllocationId)

  if (!matchedAlloc?.attributes?.port) {
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const targetPort = matchedAlloc.attributes.port

  // 1. Resolve the specific Pterodactyl client for this server (avoids legacy fallback)
  let pteroClient: IPterodactylClient
  try {
    const resolved = await resolvePterodactylClient(db, env, server.id, clientOverride)
    pteroClient = resolved.client
  } catch (err) {
    console.warn("[ProxyService] Failed resolving Pterodactyl client for server:", err)
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const queryStatus = async (): Promise<string | null> => {
    try {
      const statusData = await getServerStatus(env, pteroClient)
      return statusData.status
    } catch (err) {
      console.warn("[ProxyService] Failed checking server power status:", err)
      return null
    }
  }

  // 2. Query real server status using resolved client
  const currentStatus = await queryStatus()
  if (!currentStatus) {
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (intent === "STATUS") {
    if (currentStatus === "ONLINE") {
      return new Response(JSON.stringify({ status: "ONLINE", targetHost, targetPort }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (currentStatus === "OFFLINE") {
      return new Response(JSON.stringify({ status: "OFFLINE" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (currentStatus === "STARTING") {
      return new Response(JSON.stringify({ status: "STARTING" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // intent === "LOGIN"
  if (currentStatus === "ONLINE") {
    return new Response(JSON.stringify({ status: "ONLINE", targetHost, targetPort }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (currentStatus === "STARTING") {
    return new Response(JSON.stringify({ status: "STARTING" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (currentStatus === "OFFLINE") {
    try {
      await pteroClient.sendPowerAction("start")
      return new Response(JSON.stringify({ status: "STARTED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    } catch (wakeErr) {
      console.info("[ProxyService] Power action failed, rechecking server status:", wakeErr)
      // Re-query status exactly once to handle race condition where another request started the server
      const recheckedStatus = await queryStatus()
      if (recheckedStatus === "STARTING") {
        return new Response(JSON.stringify({ status: "STARTING" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (recheckedStatus === "ONLINE") {
        return new Response(JSON.stringify({ status: "ONLINE", targetHost, targetPort }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      // If still OFFLINE or recheck failed, return UNAVAILABLE
      return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  return new Response(JSON.stringify({ status: "UNAVAILABLE" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

export async function handleProxyRoutes(
  request: Request,
  env: Env,
  db?: Database,
  clientOverride?: IPterodactylClient,
): Promise<Response> {
  if (!validateProxyAuth(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!db) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const readyServers = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.provisioningStatus, "READY"))
    .all()

  const appClient = clientOverride || ((env as any).pterodactylClient as IPterodactylClient) || createPterodactylApplicationClient(env)
  const routes: ProxyRouteItem[] = []

  for (const server of readyServers) {
    if (!server.pterodactylServerId) continue

    try {
      const pServer = await appClient.getApplicationServer(server.pterodactylServerId)
      if (!pServer?.attributes) continue

      const nodeId = pServer.attributes.node
      const nodeRes = await appClient.getApplicationNode(nodeId)
      const targetHost = nodeRes?.attributes?.fqdn
      if (!targetHost) continue

      const primaryAllocationId = pServer.attributes.allocation
      const allocations = pServer.attributes.relationships?.allocations?.data || []

      for (const alloc of allocations) {
        // Exclude primary allocation
        if (alloc.attributes.id === primaryAllocationId) continue
        if (alloc.attributes.port) {
          routes.push({
            serverId: server.id,
            publicPort: alloc.attributes.port,
            targetHost,
            targetPort: alloc.attributes.port,
          })
        }
      }
    } catch (err) {
      console.warn(`[ProxyService] Failed resolving routes for server ${server.id}:`, err)
    }
  }

  return new Response(JSON.stringify(routes), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
