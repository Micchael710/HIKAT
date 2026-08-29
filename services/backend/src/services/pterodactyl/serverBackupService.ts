/**
 * Server Backup Service (Shard 07)
 * Handles backup lifecycle, lock protection, safe downloads, and offline-guarded restores
 * with distributed operation locking.
 */

import { createDatabase } from "@hikat/database"
import { SERVER_ERROR_CODES, SERVER_PUBLIC_MESSAGES } from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient, PterodactylBackupResponse } from "./types"
import { ServerInfrastructureError } from "./pterodactylClient"
import {
  createPterodactylClient,
  getServerStatus,
  acquireServerOperationLock,
  releaseServerOperationLock,
  startServerOperationHeartbeat,
} from "./serverAdministrationService"

export interface ServerBackupItemData {
  id: string
  name: string
  bytes: number
  createdAt: string
  completedAt?: string | null
  isSuccessful: boolean
  isLocked: boolean
}

function mapBackupToItem(res: PterodactylBackupResponse): ServerBackupItemData {
  const attr = res.attributes
  return {
    id: attr.uuid,
    name: attr.name || "Copia de seguridad",
    bytes: attr.bytes ?? 0,
    createdAt: attr.created_at,
    completedAt: attr.completed_at,
    isSuccessful: attr.is_successful,
    isLocked: attr.is_locked,
  }
}

/**
 * Lists all server backups.
 */
export async function listServerBackups(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerBackupItemData[]> {
  const client = clientOverride || createPterodactylClient(env)
  const res = await client.listBackups()
  if (!res || !res.data || !Array.isArray(res.data)) {
    return []
  }
  return res.data.map(mapBackupToItem)
}

/**
 * Creates a new server backup with an optional human name.
 */
export async function createServerBackup(
  env: Env,
  name?: string | null,
  clientOverride?: IPterodactylClient,
): Promise<ServerBackupItemData> {
  const client = clientOverride || createPterodactylClient(env)
  const safeName = name && name.trim() ? name.trim().slice(0, 100) : undefined
  const res = await client.createBackup(safeName)
  return mapBackupToItem(res)
}

/**
 * Restores a server backup. Requires server to be OFFLINE and acquires an operation lock.
 */
export async function restoreServerBackup(
  env: Env,
  db: ReturnType<typeof createDatabase>,
  userId: string,
  backupId: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  if (!backupId || typeof backupId !== "string" || !backupId.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Identificador de copia de seguridad no válido.",
    )
  }

  // 1. Guard: Check server is OFFLINE
  const status = await getServerStatus(env, client)
  if (status.status !== "OFFLINE") {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_BUSY,
      "Para restaurar una copia de seguridad el servidor debe estar completamente apagado.",
      `Server state is ${status.status}, expected OFFLINE`,
    )
  }

  // 2. Guard: Acquire distributed operation lock
  const lockHandle = await acquireServerOperationLock(db, "RESTORE_BACKUP", userId)
  const heartbeat = startServerOperationHeartbeat(db, lockHandle, userId)

  try {
    heartbeat.assertLeaseOwned()
    await client.restoreBackup(backupId.trim(), true)
    return true
  } finally {
    heartbeat.stop()
    await releaseServerOperationLock(db, lockHandle)
  }
}

/**
 * Deletes a server backup. Guard against locked backups.
 */
export async function deleteServerBackup(
  env: Env,
  backupId: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  if (!backupId || typeof backupId !== "string" || !backupId.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Identificador de copia de seguridad no válido.",
    )
  }

  // Verify backup exists and is not locked
  const backup = await client.getBackup(backupId.trim())
  if (backup.attributes.is_locked) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "No se puede eliminar una copia de seguridad protegida. Desprotégela primero.",
    )
  }

  await client.deleteBackup(backupId.trim())
  return true
}

/**
 * Toggles lock protection on a backup.
 */
export async function toggleServerBackupLock(
  env: Env,
  backupId: string,
  clientOverride?: IPterodactylClient,
): Promise<ServerBackupItemData> {
  const client = clientOverride || createPterodactylClient(env)

  if (!backupId || typeof backupId !== "string" || !backupId.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Identificador de copia de seguridad no válido.",
    )
  }

  const res = await client.toggleBackupLock(backupId.trim())
  return mapBackupToItem(res)
}

/**
 * Generates a signed download URL for a backup.
 */
export async function getServerBackupDownloadUrl(
  env: Env,
  backupId: string,
  clientOverride?: IPterodactylClient,
): Promise<{ url: string }> {
  const client = clientOverride || createPterodactylClient(env)

  if (!backupId || typeof backupId !== "string" || !backupId.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Identificador de copia de seguridad no válido.",
    )
  }

  const res = await client.getBackupDownload(backupId.trim())
  return { url: res.attributes.url }
}
