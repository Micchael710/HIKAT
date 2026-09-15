import crypto from "node:crypto"
import { GraphQLError } from "graphql"
import { sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { resolvePterodactylClient, getServerStatus } from "./serverAdministrationService"
import type { ServerWhitelistGql } from "@hikat/graphql"

/**
 * Computes an offline-mode UUID for a player name according to standard Minecraft specification (UUID v3 MD5).
 */
export function computeOfflineUuid(name: string): string {
  const hash = crypto.createHash("md5").update("OfflinePlayer:" + name).digest()
  const bytes = new Uint8Array(hash)
  bytes[6] = (bytes[6]! & 0x0f) | 0x30 // version 3
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // IETF variant
  const hex = Buffer.from(bytes).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Resolves a player name to UUID using Mojang's public profile API, falling back to offline UUID.
 */
export async function resolveMinecraftUuid(name: string): Promise<{ uuid: string; name: string }> {
  try {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`)
    if (res.ok) {
      const data: any = await res.json()
      if (data?.id) {
        const raw = data.id.replace(/-/g, "")
        const formatted = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`
        return { uuid: formatted, name: data.name || name }
      }
    }
  } catch (_) {}
  return { uuid: computeOfflineUuid(name), name }
}

/**
 * Detects if the HiKAT mod is installed on the server by checking for a hikat*.jar in /mods.
 */
export async function isHiKatModInstalled(client: IPterodactylClient): Promise<boolean> {
  try {
    const res = await client.listDirectory("/mods")
    const files = res?.data || []
    return files.some((f) => {
      const name = f.attributes.name.toLowerCase()
      return name.startsWith("hikat") && name.endsWith(".jar")
    })
  } catch (_) {
    return false
  }
}

/**
 * Reads server whitelist state and entries.
 */
export async function getServerWhitelist(
  db: Database,
  env: Env,
  serverId?: string | null,
  clientOverride?: IPterodactylClient,
): Promise<ServerWhitelistGql> {
  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const isHikat = await isHiKatModInstalled(client)

  if (isHikat) {
    try {
      const content = await client.getFileContents("/hikat/whitelist.json")
      const parsed = JSON.parse(content)
      const entries = Array.isArray(parsed?.entries)
        ? parsed.entries.map((e: any) => ({
            name: String(e.displayName || e.userId || ""),
            addedAt: e.addedAt ? String(e.addedAt) : null,
          }))
        : []
      return {
        enabled: Boolean(parsed?.enabled),
        mode: "HIKAT",
        entries,
      }
    } catch (_) {
      return {
        enabled: false,
        mode: "HIKAT",
        entries: [],
      }
    }
  } else {
    // Native Minecraft mode
    let enabled = false
    try {
      const props = await client.getFileContents("server.properties")
      const match = props.match(/^white-list\s*=\s*(true|false)/m)
      if (match && match[1] === "true") {
        enabled = true
      }
    } catch (_) {}

    let entries: { name: string; addedAt: string | null }[] = []
    try {
      const content = await client.getFileContents("whitelist.json")
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        entries = parsed.map((e: any) => ({
          name: String(e.name || e.uuid || ""),
          addedAt: null,
        }))
      }
    } catch (_) {}

    return {
      enabled,
      mode: "MINECRAFT_NATIVE",
      entries,
    }
  }
}

/**
 * Toggles server whitelist on or off.
 */
export async function setServerWhitelistEnabled(
  db: Database,
  env: Env,
  enabled: boolean,
  serverId?: string | null,
  clientOverride?: IPterodactylClient,
): Promise<ServerWhitelistGql> {
  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const isHikat = await isHiKatModInstalled(client)
  const statusMetrics = await getServerStatus(env, client, serverId, db)
  const isOnline = statusMetrics.status === "ONLINE"

  if (isOnline) {
    if (isHikat) {
      await client.sendCommand(`hikat whitelist ${enabled ? "on" : "off"}`)
    } else {
      await client.sendCommand(`whitelist ${enabled ? "on" : "off"}`)
    }
  } else {
    if (isHikat) {
      let parsed: any = { enabled: false, entries: [] }
      try {
        const content = await client.getFileContents("/hikat/whitelist.json")
        parsed = JSON.parse(content) || parsed
      } catch (_) {}
      parsed.enabled = enabled
      if (!Array.isArray(parsed.entries)) parsed.entries = []
      try {
        await client.createFolder("/", "hikat")
      } catch (_) {}
      await client.writeFile("/hikat/whitelist.json", JSON.stringify(parsed, null, 2))
    } else {
      let props = ""
      try {
        props = await client.getFileContents("server.properties")
      } catch (_) {}

      const regex = /^white-list\s*=\s*(true|false)/m
      if (regex.test(props)) {
        props = props.replace(regex, `white-list=${enabled ? "true" : "false"}`)
      } else {
        props = props ? `${props}\nwhite-list=${enabled ? "true" : "false"}\n` : `white-list=${enabled ? "true" : "false"}\n`
      }
      await client.writeFile("server.properties", props)
    }
  }

  const result = await getServerWhitelist(db, env, serverId, clientOverride)
  return {
    ...result,
    enabled,
  }
}

/**
 * Adds a player to the server whitelist by name.
 */
export async function addServerWhitelistPlayer(
  db: Database,
  env: Env,
  name: string,
  serverId?: string | null,
  clientOverride?: IPterodactylClient,
): Promise<ServerWhitelistGql> {
  const cleanName = name?.trim()
  if (!cleanName) {
    throw new GraphQLError("El nombre de jugador no puede estar vacío.", {
      extensions: { code: "BAD_USER_INPUT" },
    })
  }

  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const isHikat = await isHiKatModInstalled(client)
  const statusMetrics = await getServerStatus(env, client, serverId, db)
  const isOnline = statusMetrics.status === "ONLINE"

  let addedName = cleanName

  if (isHikat) {
    // Validate / canonicalize name in D1
    const user = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.displayName}) = lower(${cleanName})`)
      .get()

    if (!user || !user.displayName) {
      throw new GraphQLError(`El jugador "${cleanName}" no existe en HiKAT. Debe registrarse primero.`, {
        extensions: { code: "NOT_FOUND" },
      })
    }
    const canonicalName = user.displayName
    addedName = canonicalName

    if (isOnline) {
      await client.sendCommand(`hikat whitelist add "${canonicalName}"`)
    } else {
      let parsed: any = { enabled: false, entries: [] }
      try {
        const content = await client.getFileContents("/hikat/whitelist.json")
        parsed = JSON.parse(content) || parsed
      } catch (_) {}
      if (!Array.isArray(parsed.entries)) parsed.entries = []

      const exists = parsed.entries.some((e: any) =>
        (e.displayName && e.displayName.toLowerCase() === canonicalName.toLowerCase()) ||
        (e.userId && e.userId === user.id)
      )
      if (!exists) {
        parsed.entries.push({
          userId: user.id,
          displayName: canonicalName,
          addedAt: new Date().toISOString(),
        })
        try {
          await client.createFolder("/", "hikat")
        } catch (_) {}
        await client.writeFile("/hikat/whitelist.json", JSON.stringify(parsed, null, 2))
      }
    }
  } else {
    // Native Minecraft mode
    if (isOnline) {
      await client.sendCommand(`whitelist add ${cleanName}`)
    } else {
      const { uuid, name: resolvedName } = await resolveMinecraftUuid(cleanName)
      addedName = resolvedName
      let entries: any[] = []
      try {
        const content = await client.getFileContents("whitelist.json")
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) entries = parsed
      } catch (_) {}

      const exists = entries.some((e: any) =>
        (e.name && e.name.toLowerCase() === resolvedName.toLowerCase()) ||
        (e.uuid && e.uuid.toLowerCase() === uuid.toLowerCase())
      )
      if (!exists) {
        entries.push({ uuid, name: resolvedName })
        await client.writeFile("whitelist.json", JSON.stringify(entries, null, 2))
      }
    }
  }

  const result = await getServerWhitelist(db, env, serverId, clientOverride)
  // Ensure the added entry is in the returned list (handles async console command execution)
  const alreadyInList = result.entries.some((e) => e.name.toLowerCase() === addedName.toLowerCase())
  if (!alreadyInList) {
    return {
      ...result,
      entries: [...result.entries, { name: addedName, addedAt: new Date().toISOString() }],
    }
  }
  return result
}

/**
 * Removes a player from the server whitelist by name.
 */
export async function removeServerWhitelistPlayer(
  db: Database,
  env: Env,
  name: string,
  serverId?: string | null,
  clientOverride?: IPterodactylClient,
): Promise<ServerWhitelistGql> {
  const cleanName = name?.trim()
  if (!cleanName) {
    throw new GraphQLError("El nombre de jugador no puede estar vacío.", {
      extensions: { code: "BAD_USER_INPUT" },
    })
  }

  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const isHikat = await isHiKatModInstalled(client)
  const statusMetrics = await getServerStatus(env, client, serverId, db)
  const isOnline = statusMetrics.status === "ONLINE"

  if (isHikat) {
    if (isOnline) {
      await client.sendCommand(`hikat whitelist remove "${cleanName}"`)
    } else {
      try {
        const content = await client.getFileContents("/hikat/whitelist.json")
        const parsed = JSON.parse(content)
        if (parsed && Array.isArray(parsed.entries)) {
          parsed.entries = parsed.entries.filter((e: any) => {
            const matchName = e.displayName && e.displayName.toLowerCase() === cleanName.toLowerCase()
            const matchId = e.userId && e.userId === cleanName
            return !matchName && !matchId
          })
          await client.writeFile("/hikat/whitelist.json", JSON.stringify(parsed, null, 2))
        }
      } catch (_) {}
    }
  } else {
    // Native Minecraft mode
    if (isOnline) {
      await client.sendCommand(`whitelist remove ${cleanName}`)
    } else {
      try {
        const content = await client.getFileContents("whitelist.json")
        let parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          parsed = parsed.filter((e: any) => {
            const matchName = e.name && e.name.toLowerCase() === cleanName.toLowerCase()
            const matchUuid = e.uuid && e.uuid.toLowerCase() === cleanName.toLowerCase()
            return !matchName && !matchUuid
          })
          await client.writeFile("whitelist.json", JSON.stringify(parsed, null, 2))
        }
      } catch (_) {}
    }
  }

  const result = await getServerWhitelist(db, env, serverId, clientOverride)
  // Ensure the removed entry is purged in returned list
  return {
    ...result,
    entries: result.entries.filter((e) => e.name.toLowerCase() !== cleanName.toLowerCase()),
  }
}
