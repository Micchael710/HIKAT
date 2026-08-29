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
  startServerOperationHeartbeat,
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
  const separator = res.attributes.url.includes("?") ? "&" : "?"
  return { url: `${res.attributes.url}${separator}directory=/` }
}

/**
 * Helper to wait for pre-backup completion using client.getBackup(uuid).
 * Polls until completed_at != null.
 */
export async function waitForBackupCompletion(
  client: IPterodactylClient,
  uuid: string,
  options: {
    maxAttempts?: number
    intervalMs?: number
  } = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 60
  const intervalMs = options.intervalMs ?? 1000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const backupRes = await client.getBackup(uuid)
    const attr = backupRes.attributes

    if (attr.completed_at !== null && attr.completed_at !== undefined) {
      if (attr.is_successful === true) {
        return // Backup finished successfully!
      }
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "No se pudo completar la copia de seguridad previa. El mundo no fue modificado.",
        `Backup ${uuid} finished with is_successful = false`,
      )
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  throw new ServerInfrastructureError(
    SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    "No se pudo completar la copia de seguridad previa (tiempo de espera agotado). El mundo no fue modificado.",
    `Backup ${uuid} timed out after ${maxAttempts} attempts`,
  )
}

/**
 * Safely replaces the server world with a multi-stage validation and rollback process.
 *
 * Flujo conservador:
 * 1. Exige estado strictly OFFLINE.
 * 2. Adquiere lock de operación D1 (REPLACE_WORLD).
 * 3. Detecta el nombre del mundo activo real (vía server.properties).
 * 4. Valida que el archivo ZIP subido exista físicamente en la raíz del servidor.
 * 5. Crea una copia de seguridad previa (pre-backup) y espera a que finalice completamente.
 * 6. Crea un directorio de staging con nombre impredecible dentro del contenedor.
 * 7. Traslada el ZIP a staging y lo extrae ÚNICAMENTE dentro de staging.
 * 8. Analiza la estructura del staging (level.dat en raíz o en carpeta contenedora única).
 * 9. Reemplaza el mundo activo mediante Pterodactyl Files API (no tolera errores en borrado activo).
 * 10. Si ocurre un fallo en la fase de reemplazo del mundo activo, ejecuta un intento de rollback restaurando el pre-backup.
 * 11. Limpia directorio de staging y archivo ZIP subido en el bloque finally.
 * 12. Libera el lock de operación D1 en el bloque finally.
 */
export async function replaceServerWorld(
  env: Env,
  db: ReturnType<typeof createDatabase>,
  userId: string,
  uploadedFileName: string,
  clientOverride?: IPterodactylClient,
  backupOptions?: { maxAttempts?: number; intervalMs?: number },
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  if (!uploadedFileName || typeof uploadedFileName !== "string" || !uploadedFileName.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El nombre del archivo subido es requerido.",
    )
  }

  const cleanFileName = uploadedFileName.trim().split("/").pop() || ""

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
  const heartbeat = startServerOperationHeartbeat(db, lockKey, userId)

  // Unpredictable staging directory name
  const stagingDirName = `_staging_world_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  let preBackupUuid: string | null = null
  let stagingCreated = false
  let zipMovedToStaging = false

  try {
    // 4. Validate that uploaded ZIP file exists in root directory (fail closed)
    let rootFiles: Awaited<ReturnType<IPterodactylClient["listDirectory"]>>
    try {
      rootFiles = await client.listDirectory("/")
    } catch (listErr: unknown) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "No se pudo consultar el directorio raíz del servidor para verificar el archivo subido.",
        `listDirectory(/) failed: ${listErr instanceof Error ? listErr.message : String(listErr)}`,
      )
    }

    if (!rootFiles || !rootFiles.data) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "La respuesta del servidor no contiene una lista de archivos válida.",
      )
    }

    const fileExists = rootFiles.data.some((f: { attributes: { name: string } }) => f.attributes.name === cleanFileName)
    if (!fileExists) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        `El archivo subido "${cleanFileName}" no fue encontrado en el servidor.`,
      )
    }

    // 5. Create automatic pre-backup
    try {
      const backupRes = await client.createBackup(`Copia previa a reemplazo de mundo (${activeWorldName})`)
      preBackupUuid = backupRes.attributes.uuid
    } catch (backupErr: unknown) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "No se pudo crear la copia de seguridad previa al reemplazo del mundo. Operación abortada por seguridad.",
        `Pre-backup failed: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
      )
    }

    // 5b. Wait for pre-backup to finish completely before touching world or creating staging
    await waitForBackupCompletion(client, preBackupUuid, backupOptions)

    // 6. Create unpredictable staging directory inside container
    await client.createFolder("/", stagingDirName)
    stagingCreated = true

    // Move uploaded ZIP file from / into /stagingDirName/cleanFileName so decompress receives root where ZIP exists
    await client.renameFile("/", cleanFileName, `${stagingDirName}/${cleanFileName}`)
    zipMovedToStaging = true

    // 7. Extract uploaded ZIP inside staging directory (root = /stagingDirName, file = cleanFileName)
    try {
      await client.decompressFile(`/${stagingDirName}`, cleanFileName)
    } catch (decompressErr: unknown) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "Fallo al descomprimir el archivo ZIP en el directorio de pruebas (staging). El mundo actual no fue modificado.",
        `Decompress failed: ${decompressErr instanceof Error ? decompressErr.message : String(decompressErr)}`,
      )
    }

    // 8. Inspect and validate staging directory contents
    const stagingFiles = await client.listDirectory(`/${stagingDirName}`).catch(() => null)
    if (!stagingFiles || !stagingFiles.data || stagingFiles.data.length === 0) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "El archivo ZIP extraído en staging está vacío. Operación cancelada sin modificar el mundo actual.",
      )
    }

    // Filter out the ZIP archive itself when validating world files
    const extractedItems = stagingFiles.data.filter((item) => item.attributes.name !== cleanFileName)

    let hasLevelDat = false
    let innerWorldFolder: string | null = null

    // Check Case A: level.dat directly in root of staging
    const directLevelDat = extractedItems.some(
      (item) => item.attributes.name.toLowerCase() === "level.dat",
    )

    if (directLevelDat) {
      hasLevelDat = true
    } else {
      // Check Case B: single container directory containing level.dat
      const directories = extractedItems.filter(
        (item) => !item.attributes.is_file || item.attributes.mimetype === "directory",
      )

      if (directories.length === 1 && directories[0]?.attributes?.name) {
        const subDirName = directories[0].attributes.name
        const subDirFiles = await client.listDirectory(`/${stagingDirName}/${subDirName}`).catch(() => null)

        if (subDirFiles?.data) {
          const subLevelDat = subDirFiles.data.some(
            (item) => item.attributes.name.toLowerCase() === "level.dat",
          )
          if (subLevelDat) {
            hasLevelDat = true
            innerWorldFolder = subDirName
          }
        }
      }
    }

    // Reject Case C: No level.dat found or ambiguous folder structure
    if (!hasLevelDat) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "El archivo ZIP no contiene una estructura de mundo de Minecraft válida (falta level.dat en la raíz o en una carpeta contenedora única). Operación cancelada sin modificar el mundo actual.",
      )
    }

    // 9. Execute world replacement phase (active world touched ONLY after staging is fully validated)
    try {
      // Delete zip inside staging before moving/renaming world
      await client.deleteFiles(`/${stagingDirName}`, [cleanFileName]).catch(() => {})

      // Delete existing active world directory at root / (MUST NOT SWALLOW ERRORS)
      await client.deleteFiles("/", [activeWorldName])

      if (innerWorldFolder) {
        // Case B: Move/Rename inner world directory from /stagingDirName/innerWorldFolder to /activeWorldName
        await client.renameFile("/", `${stagingDirName}/${innerWorldFolder}`, activeWorldName)
      } else {
        // Case A: Rename entire staging directory /stagingDirName to /activeWorldName
        await client.renameFile("/", stagingDirName, activeWorldName)
        stagingCreated = false // Staging directory was renamed to activeWorldName
      }
    } catch (swapErr: unknown) {
      // 10. Attempt conservative rollback if swap phase fails
      if (preBackupUuid) {
        try {
          await client.restoreBackup(preBackupUuid)
        } catch {
          // Ignore secondary restore error and report primary failure
        }
      }
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "Error al reemplazar el mundo activo en el sistema de archivos. Se ejecutó un intento de restauración automática de la copia de seguridad previa.",
        `Swap failed: ${swapErr instanceof Error ? swapErr.message : String(swapErr)}`,
      )
    }

    return true
  } finally {
    // 11. Clean up uploaded ZIP archive if it wasn't moved
    if (!zipMovedToStaging) {
      await client.deleteFiles("/", [cleanFileName]).catch(() => {})
    }
    // Clean up staging directory if it still exists
    if (stagingCreated) {
      await client.deleteFiles("/", [stagingDirName]).catch(() => {})
    }

    // 12. Always release distributed operation lock and stop heartbeat
    heartbeat.stop()
    await releaseServerOperationLock(db, lockKey)
  }
}
