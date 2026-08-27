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
 *
 * FAIL-SAFE: If server.properties cannot be read (network, auth, infra down),
 * the error is PROPAGATED. We never return fake defaults.
 */
export async function getMinecraftServerSettings(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<MinecraftServerSettingsData> {
  const client = clientOverride || createPterodactylClient(env)
  // Let infrastructure errors propagate — do NOT return extractMinecraftSettings("")
  const content = await client.getFileContents("server.properties")
  return extractMinecraftSettings(content)
}

/**
 * Updates allowlisted properties and preserves all unknown properties and comments.
 *
 * FAIL-SAFE: If reading server.properties fails, the update is REFUSED.
 * We never write from scratch — that would clobber existing configuration.
 */
export async function updateMinecraftServerSettings(
  env: Env,
  input: Partial<MinecraftServerSettingsData>,
  clientOverride?: IPterodactylClient,
): Promise<MinecraftServerSettingsData> {
  const client = clientOverride || createPterodactylClient(env)

  // Read existing content — let errors propagate (do NOT catch and use "")
  const originalContent = await client.getFileContents("server.properties")

  const updatedContent = serializeServerProperties(originalContent, input)
  await client.writeFile("server.properties", updatedContent)

  return extractMinecraftSettings(updatedContent)
}

