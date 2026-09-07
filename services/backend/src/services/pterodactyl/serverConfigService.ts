/**
 * Minecraft Server Configuration Service (Shard 07)
 * Safe non-destructive parsing and allowlist-only updating of server.properties.
 */

import { Database } from "@hikat/database"
import {
  extractMinecraftSettings,
  serializeServerProperties,
  type MinecraftServerSettingsData,
} from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { resolvePterodactylClient } from "./serverAdministrationService"

/**
 * Reads and parses Minecraft server configuration.
 */
export async function getMinecraftServerSettings(
  env: Env,
  serverId?: string | null,
  clientOverride?: IPterodactylClient,
  db?: Database,
): Promise<MinecraftServerSettingsData> {
  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const content = await client.getFileContents("server.properties")
  return extractMinecraftSettings(content)
}

/**
 * Updates allowlisted properties and preserves all unknown properties and comments.
 */
export async function updateMinecraftServerSettings(
  env: Env,
  input: Partial<MinecraftServerSettingsData>,
  serverId?: string | null,
  clientOverride?: IPterodactylClient,
  db?: Database,
): Promise<MinecraftServerSettingsData> {
  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const originalContent = await client.getFileContents("server.properties")
  const updatedContent = serializeServerProperties(originalContent, input)
  await client.writeFile("server.properties", updatedContent)
  return extractMinecraftSettings(updatedContent)
}
