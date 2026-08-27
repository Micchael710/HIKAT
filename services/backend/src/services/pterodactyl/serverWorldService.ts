/**
 * Server World Service (Shard 07)
 * Safe world detection from server.properties, compressed export downloads,
 * and offline-guarded world replacement with automatic pre-backup.
 */

import { createDatabase } from "@hikat/database"
import {
  SERVER_ERROR_CODES,
  SERVER_PUBLIC_MESSAGES,
  parseServerProperties,
  sanitizeWorldName,
} from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { ServerInfrastructureError } from "./pterodactylClient"
import {
  createPterodactylClient,
  getServerStatus,
  acquireServerOperationLock,
  releaseServerOperationLock,
} from "./serverAdministrationService"

export interface ServerWorldInfoData {
  name: string
  sizeBytes?: number | null
  lastModified?: string | null
}

/**
 * Detects the active world name by reading server.properties.
 *
 * FAIL-SAFE: If server.properties is successfully read but does not contain
 * `level-name`, returns the Minecraft default "world".
 * If reading server.properties FAILS (network, timeout, auth, infrastructure),
 * the error is PROPAGATED — we never act on a potentially wrong directory.
 */
export async function detectActiveWorldName(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<string> {
  const client = clientOverride || createPterodactylClient(env)
  // Let infrastructure errors propagate — do NOT catch them
  const content = await client.getFileContents("server.properties")
  const props = parseServerProperties(content)
  const rawLevelName = props.get("level-name")
  return sanitizeWorldName(rawLevelName)
}

/**
 * Retrieves information on the currently active world.
 */
export async function getServerWorldInfo(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerWorldInfoData> {
  const client = clientOverride || createPterodactylClient(env)
  const worldName = await detectActiveWorldName(env, client)

  // Try to inspect the world directory metadata
  try {
    const listRes = await client.listDirectory("/")
    const worldFileObj = listRes.data.find(
      (f) => f.attributes.name.toLowerCase() === worldName.toLowerCase(),
    )

    return {
      name: worldName,
      sizeBytes: worldFileObj?.attributes?.size ?? null,
      lastModified: worldFileObj?.attributes?.modified_at ?? null,
    }
  } catch {
    return {
      name: worldName,
      sizeBytes: null,
      lastModified: null,
    }
  }
}

/**
 * Compresses the active world directory and generates a signed download URL.
 */
export async function createServerWorldDownloadUrl(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<{ url: string }> {
  const client = clientOverride || createPterodactylClient(env)
  const worldName = await detectActiveWorldName(env, client)

  // Compress world directory
  const compressRes = await client.compressFiles("/", [worldName])
  const archiveName = compressRes.attributes.name

  // Retrieve download signed URL
  const downloadRes = await client.getFileDownload(archiveName)
  return { url: downloadRes.attributes.url }
}

/**
 * Prepares a signed upload URL for world archives.
 */
export async function prepareServerWorldUpload(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<{ url: string }> {
  const client = clientOverride || createPterodactylClient(env)
  const res = await client.getFileUploadUrl()
  return { url: res.attributes.url }
}

/**
 * Safely replaces the server world.
 * Requires server to be strictly OFFLINE (rejects ONLINE, STARTING, STOPPING, UNKNOWN, DISCONNECTED),
 * detects active world name, creates an automatic pre-backup, acquires a distributed operation lock,
 * and extracts the uploaded world archive.
 *
 * NOTE ON ATOMICITY: Pterodactyl Panel / Wings API does not guarantee atomic filesystem swaps.
 * We create an automatic pre-backup before extracting the world archive so administrators
 * can restore if a failure occurs during extraction.
 */
export async function replaceServerWorld(
  env: Env,
  db: ReturnType<typeof createDatabase>,
  userId: string,
  uploadedFileName: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  if (!uploadedFileName || typeof uploadedFileName !== "string" || !uploadedFileName.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El nombre del archivo subido es requerido.",
    )
  }

  // 1. Guard: Check server is strictly OFFLINE
  const status = await getServerStatus(env, client)
  if (status.status !== "OFFLINE") {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_BUSY,
      "Para reemplazar el mundo el servidor debe estar completamente apagado (OFFLINE).",
      `Server state is ${status.status}, expected OFFLINE`,
    )
  }

  // 2. Detect active world name before operation
  const activeWorldName = await detectActiveWorldName(env, client)

  // 3. Guard: Acquire distributed operation lock
  const lockKey = await acquireServerOperationLock(db, "REPLACE_WORLD", userId)

  try {
    // 4. Step: Create automatic pre-backup
    try {
      await client.createBackup(`Copia previa a reemplazo de mundo (${activeWorldName})`)
    } catch (backupErr: unknown) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "No se pudo crear la copia de seguridad previa al reemplazo del mundo. Operación abortada por seguridad.",
        `Pre-backup failed: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
      )
    }

    // 5. Step: Decompress / extract uploaded world into server root
    const cleanFileName = uploadedFileName.trim().replace(/^[/\\.]+/g, "")
    await client.decompressFile("/", cleanFileName)

    return true
  } finally {
    await releaseServerOperationLock(db, lockKey)
  }
}
