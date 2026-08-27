/**
 * Minecraft Server Configuration Service (Shard 07)
 * Safe non-destructive parsing and allowlist-only updating of server.properties.
 */

import {
  extractMinecraftSettings,
  serializeServerProperties,
  type MinecraftServerSettingsData,
} from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { createPterodactylClient } from "./serverAdministrationService"

/**
 * Reads and parses Minecraft server configuration.
 */
export async function getMinecraftServerSettings(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<MinecraftServerSettingsData> {
  const client = clientOverride || createPterodactylClient(env)
  try {
    const content = await client.getFileContents("server.properties")
    return extractMinecraftSettings(content)
  } catch {
    return extractMinecraftSettings("")
  }
}

/**
 * Updates allowlisted properties and preserves all unknown properties and comments.
 */
export async function updateMinecraftServerSettings(
  env: Env,
  input: Partial<MinecraftServerSettingsData>,
  clientOverride?: IPterodactylClient,
): Promise<MinecraftServerSettingsData> {
  const client = clientOverride || createPterodactylClient(env)

  let originalContent = ""
  try {
    originalContent = await client.getFileContents("server.properties")
  } catch {}

  const updatedContent = serializeServerProperties(originalContent, input)
  await client.writeFile("server.properties", updatedContent)

  return extractMinecraftSettings(updatedContent)
}
