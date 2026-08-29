import { eq, and, desc } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import { validateGameFileBuffer } from "@hikat/shared"
import type {
  ServerReleaseSyncPlanGql,
  ServerReleaseSyncStatusGql,
  ServerReleaseSyncResultGql,
  ServerReleaseSyncPlanItemGql,
  ServerReleaseSyncSummaryGql,
  ServerStatusGql,
  ServerReleaseSyncStatusEnumGql,
} from "@hikat/graphql"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import {
  createPterodactylClient,
  getServerStatus,
  acquireServerOperationLock,
  releaseServerOperationLock,
  startServerOperationHeartbeat,
} from "./serverAdministrationService"
import { createServerBackup } from "./serverBackupService"
import { safeDeleteServerFilePhysical, getPhysicalFileSha256 } from "./serverFileService"

// ... imports remain ...

export const SERVER_RELEASE_SYNC_BACKUP_POLL_INTERVAL_MS = 2000
export const SERVER_RELEASE_SYNC_BACKUP_TIMEOUT_MS = 180000 // 3 minutes

/**
 * Computes the Server Release Sync Plan by comparing the published game release's
 * BOTH mods with the server's GAME_RELEASE managed content and physical files on Wings.
 */
export async function getServerReleaseSyncPlan(
  db: Database,
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerReleaseSyncPlanGql> {
  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "PUBLISHED"))
    .get()

  const client = clientOverride || createPterodactylClient(env)

  // 1. Check server status for preconditions (fail closed)
  let serverStatus: ServerStatusGql = "UNKNOWN"
  try {
    const statusMetrics = await getServerStatus(env, client)
    serverStatus = statusMetrics.status as ServerStatusGql
  } catch {
    serverStatus = "DISCONNECTED"
  }

  // 2. Fetch physical files on Wings /mods
  let physicalFilesAvailable = false
  const physicalMods = new Set<string>()
  if (serverStatus !== "DISCONNECTED") {
    try {
      const modsListRes = await client.listDirectory("/mods")
      if (modsListRes && modsListRes.data && Array.isArray(modsListRes.data)) {
        for (const item of modsListRes.data) {
          if (item?.attributes?.name && item.attributes.is_file) {
            physicalMods.add(item.attributes.name)
          }
        }
        physicalFilesAvailable = true
      }
    } catch {
      // If server unreachable or error listing /mods, keep physicalFilesAvailable = false
    }
  }

  if (!published) {
    const canApply = serverStatus === "OFFLINE" && physicalFilesAvailable
    let blockReason: string | null = null
    if (!canApply) {
      if (serverStatus === "DISCONNECTED" || serverStatus === "UNKNOWN") {
        blockReason = "El servidor no está disponible."
      } else if (serverStatus !== "OFFLINE") {
        blockReason = "Apaga el servidor antes de aplicar cambios de mods."
      } else if (!physicalFilesAvailable) {
        blockReason = "No se pudieron verificar los archivos del servidor."
      }
    }

    return {
      releaseId: null,
      releaseVersion: null,
      isPending: false,
      items: [],
      summary: {
        toInstall: 0,
        toUpdate: 0,
        toRemove: 0,
        toKeep: 0,
      },
      serverStatus,
      canApply,
      blockReason,
    }
  }

  // 3. Fetch desired state: Game release files with category === "MOD" and sourceEnvironment === "BOTH"
  const desiredFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(
      and(
        eq(schema.gameReleaseFiles.releaseId, published.id),
        eq(schema.gameReleaseFiles.category, "MOD"),
        eq(schema.gameReleaseFiles.sourceEnvironment, "BOTH"),
      ),
    )
    .all()

  // 4. Fetch current state: server_managed_content with managementSource === "GAME_RELEASE"
  const currentRecords = await db
    .select()
    .from(schema.serverManagedContent)
    .where(eq(schema.serverManagedContent.managementSource, "GAME_RELEASE"))
    .all()

  const items: ServerReleaseSyncPlanItemGql[] = []
  const matchedCurrentIds = new Set<string>()

  // 5. Compare desired against current and physical filesystem state
  for (const desired of desiredFiles) {
    const matchedCurrent = currentRecords.find(
      (c) =>
        c.gameReleaseFileId === desired.id ||
        (c.provider === desired.sourceProvider && c.projectId === desired.sourceProjectId) ||
        c.targetPath === `mods/${desired.name}`,
    )

    const physicalExists = physicalMods.has(desired.name)

    if (!matchedCurrent) {
      // Item needs to be INSTALLED
      items.push({
        action: "INSTALL",
        filename: desired.name,
        targetPath: `mods/${desired.name}`,
        sizeBytes: desired.sizeBytes,
        sha256: desired.sha256,
        sourceProvider: (desired.sourceProvider as any) || null,
        sourceProjectId: desired.sourceProjectId || null,
        sourceVersionId: desired.sourceVersionId || null,
        sourceFileId: desired.sourceFileId || null,
        gameReleaseFileId: desired.id,
        managedContentId: null,
        currentVersionNumber: null,
        desiredVersionNumber: desired.name,
      })
    } else {
      matchedCurrentIds.add(matchedCurrent.id)
      const currentFileName = matchedCurrent.targetPath.split("/").pop() || matchedCurrent.targetPath
      const isIdentical =
        matchedCurrent.sha256 === desired.sha256 &&
        matchedCurrent.targetPath === `mods/${desired.name}`

      if (isIdentical) {
        if (!physicalFilesAvailable || physicalExists) {
          // Tracked in D1 AND present on Wings filesystem (or logical plan when filesystem is unavailable)
          items.push({
            action: "KEEP",
            filename: desired.name,
            targetPath: `mods/${desired.name}`,
            sizeBytes: desired.sizeBytes,
            sha256: desired.sha256,
            sourceProvider: (desired.sourceProvider as any) || (matchedCurrent.provider as any) || null,
            sourceProjectId: desired.sourceProjectId || matchedCurrent.projectId || null,
            sourceVersionId: desired.sourceVersionId || matchedCurrent.versionId || null,
            sourceFileId: desired.sourceFileId || matchedCurrent.fileId || null,
            gameReleaseFileId: desired.id,
            managedContentId: matchedCurrent.id,
            currentVersionNumber: currentFileName,
            desiredVersionNumber: desired.name,
          })
        } else {
          // Physical drift: Filesystem is available, tracked in D1, but physically missing from Wings filesystem!
          items.push({
            action: "INSTALL",
            filename: desired.name,
            targetPath: `mods/${desired.name}`,
            sizeBytes: desired.sizeBytes,
            sha256: desired.sha256,
            sourceProvider: (desired.sourceProvider as any) || (matchedCurrent.provider as any) || null,
            sourceProjectId: desired.sourceProjectId || matchedCurrent.projectId || null,
            sourceVersionId: desired.sourceVersionId || matchedCurrent.versionId || null,
            sourceFileId: desired.sourceFileId || matchedCurrent.fileId || null,
            gameReleaseFileId: desired.id,
            managedContentId: matchedCurrent.id,
            currentVersionNumber: currentFileName,
            desiredVersionNumber: desired.name,
          })
        }
      } else {
        items.push({
          action: "UPDATE",
          filename: desired.name,
          targetPath: `mods/${desired.name}`,
          sizeBytes: desired.sizeBytes,
          sha256: desired.sha256,
          sourceProvider: (desired.sourceProvider as any) || (matchedCurrent.provider as any) || null,
          sourceProjectId: desired.sourceProjectId || matchedCurrent.projectId || null,
          sourceVersionId: desired.sourceVersionId || matchedCurrent.versionId || null,
          sourceFileId: desired.sourceFileId || matchedCurrent.fileId || null,
          gameReleaseFileId: desired.id,
          managedContentId: matchedCurrent.id,
          currentVersionNumber: currentFileName,
          desiredVersionNumber: desired.name,
        })
      }
    }
  }

  // 6. Identify unreferenced current records to REMOVE
  for (const current of currentRecords) {
    if (!matchedCurrentIds.has(current.id)) {
      const currentFileName = current.targetPath.split("/").pop() || current.targetPath
      items.push({
        action: "REMOVE",
        filename: currentFileName,
        targetPath: current.targetPath,
        sizeBytes: current.sizeBytes,
        sha256: current.sha256,
        sourceProvider: (current.provider as any) || null,
        sourceProjectId: current.projectId || null,
        sourceVersionId: current.versionId || null,
        sourceFileId: current.fileId || null,
        gameReleaseFileId: current.gameReleaseFileId || null,
        managedContentId: current.id,
        currentVersionNumber: currentFileName,
        desiredVersionNumber: null,
      })
    }
  }

  // 7. Compute summary
  const summary: ServerReleaseSyncSummaryGql = {
    toInstall: items.filter((i) => i.action === "INSTALL").length,
    toUpdate: items.filter((i) => i.action === "UPDATE").length,
    toRemove: items.filter((i) => i.action === "REMOVE").length,
    toKeep: items.filter((i) => i.action === "KEEP").length,
  }

  const isPending = summary.toInstall > 0 || summary.toUpdate > 0 || summary.toRemove > 0
  const canApply = serverStatus === "OFFLINE" && physicalFilesAvailable
  let blockReason: string | null = null
  if (!canApply) {
    if (serverStatus === "DISCONNECTED" || serverStatus === "UNKNOWN") {
      blockReason = "El servidor no está disponible."
    } else if (serverStatus !== "OFFLINE") {
      blockReason = "Apaga el servidor antes de aplicar cambios de mods."
    } else if (!physicalFilesAvailable) {
      blockReason = "No se pudieron verificar los archivos del servidor."
    }
  }

  return {
    releaseId: published.id,
    releaseVersion: published.version,
    isPending,
    items,
    summary,
    serverStatus,
    canApply,
    blockReason,
  }
}

/**
 * Returns the latest release sync execution status.
 */
export async function getServerReleaseSyncStatus(
  db: Database,
): Promise<ServerReleaseSyncStatusGql | null> {
  const latest = await db
    .select()
    .from(schema.serverReleaseSyncs)
    .orderBy(desc(schema.serverReleaseSyncs.createdAt))
    .limit(1)
    .get()

  if (!latest) {
    return null
  }

  return {
    releaseId: latest.releaseId,
    status: latest.status as ServerReleaseSyncStatusEnumGql,
    appliedAt: latest.appliedAt,
    details: latest.details,
  }
}

/**
 * Applies the release sync to the server:
 * 1. Checks server is OFFLINE.
 * 2. Acquires distributed operation lock.
 * 3. Records APPLYING status in D1.
 * 4. Creates pre-sync backup if requested and waits for completion (aborts on timeout/fail).
 * 5. Preflights and authoritatively validates all R2 release binaries.
 * 6. Checks physical collisions on Wings.
 * 7. Writes binaries to Wings /mods/ with clean old-file cleanup on filename updates.
 * 8. Reconciles D1 and marks APPLIED.
 */
export async function applyServerReleaseSync(
  db: Database,
  env: Env,
  userId: string,
  createBackup: boolean = false,
  clientOverride?: IPterodactylClient,
): Promise<ServerReleaseSyncResultGql> {
  const client = clientOverride || createPterodactylClient(env)

  // 1. Guard: Check server status is OFFLINE (fail-closed)
  let statusMetrics
  try {
    statusMetrics = await getServerStatus(env, client)
  } catch {
    throw createGraphQLError(
      "No se pudo confirmar el estado del servidor. Inténtalo de nuevo cuando el servidor esté accesible y apagado.",
      "VALIDATION_ERROR",
    )
  }

  if (statusMetrics.status !== "OFFLINE") {
    throw createGraphQLError(
      "Apaga el servidor antes de aplicar cambios de mods.",
      "VALIDATION_ERROR",
    )
  }

  // 2. Guard: Acquire distributed operation lock
  const lockHandle = await acquireServerOperationLock(db, "SERVER_RELEASE_SYNC", userId)
  const heartbeat = startServerOperationHeartbeat(db, lockHandle, userId)

  const syncId = crypto.randomUUID()
  const nowStart = new Date().toISOString()

  try {
    // 3. Fetch published release
    const published = await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()

    if (!published) {
      throw createGraphQLError("No hay ninguna release publicada para sincronizar.", "VALIDATION_ERROR")
    }

    // Record APPLYING status in D1
    await db.insert(schema.serverReleaseSyncs).values({
      id: syncId,
      releaseId: published.id,
      status: "APPLYING",
      details: JSON.stringify({ step: "INITIALIZING", createBackup }),
      createdAt: nowStart,
      updatedAt: nowStart,
    })

    const desiredFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(
        and(
          eq(schema.gameReleaseFiles.releaseId, published.id),
          eq(schema.gameReleaseFiles.category, "MOD"),
          eq(schema.gameReleaseFiles.sourceEnvironment, "BOTH"),
        ),
      )
      .all()

    const allManagedRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .all()

    const currentRecords = allManagedRecords.filter((m) => m.managementSource === "GAME_RELEASE")

    // 4. Pre-sync backup with strict timeout and failure abort semantics
    if (createBackup) {
      heartbeat.assertLeaseOwned()
      let backupId: string | null = null
      try {
        const backupItem = await createServerBackup(env, "Pre-Release Sync Backup", client)
        if (!backupItem || !backupItem.id) {
          throw new Error("No se pudo iniciar el backup de Pterodactyl.")
        }
        backupId = backupItem.id

        let isDone = false
        const startTime = Date.now()

        while (!isDone && Date.now() - startTime < SERVER_RELEASE_SYNC_BACKUP_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, SERVER_RELEASE_SYNC_BACKUP_POLL_INTERVAL_MS))
          const check = await client.getBackup(backupId)
          if (check && check.attributes) {
            if (check.attributes.completed_at) {
              if (!check.attributes.is_successful) {
                throw new Error("El backup de Pterodactyl finalizó con error.")
              }
              isDone = true
              break
            }
          }
        }

        if (!isDone) {
          throw new Error(`Timeout al esperar la finalización del backup (${SERVER_RELEASE_SYNC_BACKUP_TIMEOUT_MS / 1000}s).`)
        }
      } catch (backupErr: any) {
        const now = new Date().toISOString()
        await db
          .update(schema.serverReleaseSyncs)
          .set({
            status: "FAILED",
            details: JSON.stringify({
              error: backupErr?.message || "Error al crear backup",
              backupId,
              failedAt: now,
            }),
            updatedAt: now,
          })
          .where(eq(schema.serverReleaseSyncs.id, syncId))

        throw createGraphQLError(
          `El backup previo a la sincronización no se completó exitosamente (${backupErr?.message || "Error"}). Operación cancelada.`,
          "INTERNAL_ERROR",
        )
      }
    }

    // 5. Check physical directory and manual collisions on Wings (fail closed)
    try {
      await client.createFolder("/", "mods")
    } catch {
      // Ignore if folder exists
    }

    let modsListRes
    try {
      modsListRes = await client.listDirectory("/mods")
    } catch (listErr: any) {
      throw createGraphQLError(
        "No se pudo verificar de forma segura el contenido actual del servidor. No se realizaron cambios.",
        "INTERNAL_ERROR",
      )
    }

    const physicalMods = new Set<string>()
    if (modsListRes && modsListRes.data && Array.isArray(modsListRes.data)) {
      for (const item of modsListRes.data) {
        if (item?.attributes?.name && item.attributes.is_file) {
          physicalMods.add(item.attributes.name)
        }
      }
    }

    for (const desired of desiredFiles) {
      if (physicalMods.has(desired.name)) {
        const recordAtTargetPath = allManagedRecords.find(
          (m) => m.targetPath === `mods/${desired.name}`,
        )

        if (recordAtTargetPath) {
          if (recordAtTargetPath.managementSource === "SERVER_DIRECT") {
            throw createGraphQLError(
              `La ruta mods/${desired.name} está en conflicto con un mod administrado directamente desde el Servidor.`,
              "CONFLICT",
            )
          }
          // If GAME_RELEASE: OK
        } else {
          // Physical file exists without any D1 tracking!
          // Check if it's the expected binary for this desired release item:
          const physicalItem = modsListRes.data.find((item) => item?.attributes?.name === desired.name)
          const sizeMatches = physicalItem?.attributes?.size === desired.sizeBytes
          if (!sizeMatches) {
            throw createGraphQLError(
              `Ya existe un archivo manual en esta ruta (mods/${desired.name}). HiKAT no lo reemplazará automáticamente.`,
              "CONFLICT",
            )
          }

          // Authoritatively verify physical file SHA-256
          const physicalSha = await getPhysicalFileSha256(client, `mods/${desired.name}`)
          if (!physicalSha || physicalSha.toLowerCase() !== desired.sha256.toLowerCase()) {
            throw createGraphQLError(
              `Ya existe un archivo manual en esta ruta (mods/${desired.name}). HiKAT no lo reemplazará automáticamente.`,
              "CONFLICT",
            )
          }
        }
      }
    }

    // 6. Authoritative R2 Preflight Validation
    if (!env.ASSETS) {
      throw createGraphQLError("El almacenamiento R2 no está configurado.", "INTERNAL_ERROR")
    }

    const stagedBinaries = new Map<string, Uint8Array>()
    for (const desired of desiredFiles) {
      const isIdentical = currentRecords.some(
        (c) =>
          (c.gameReleaseFileId === desired.id ||
            (c.provider === desired.sourceProvider && c.projectId === desired.sourceProjectId)) &&
          c.sha256 === desired.sha256 &&
          c.targetPath === `mods/${desired.name}`,
      )

      if (isIdentical && physicalMods.has(desired.name)) {
        continue // KEEP, already matched and physically present on Wings
      }

      // Download and validate from R2
      const r2Obj = await env.ASSETS.get(desired.objectKey)
      if (!r2Obj) {
        throw createGraphQLError(
          `El archivo binario para "${desired.name}" (${desired.objectKey}) no existe en R2.`,
          "INTERNAL_ERROR",
        )
      }

      const arrayBuffer = await r2Obj.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)

      if (buffer.byteLength === 0) {
        throw createGraphQLError(
          `El archivo binario en R2 para "${desired.name}" está vacío (0 bytes).`,
          "INTERNAL_ERROR",
        )
      }

      if (buffer.byteLength !== desired.sizeBytes) {
        throw createGraphQLError(
          `Discrepancia de tamaño en R2 para "${desired.name}": esperado ${desired.sizeBytes} B, recibido ${buffer.byteLength} B.`,
          "INTERNAL_ERROR",
        )
      }

      const shaBuffer = await crypto.subtle.digest("SHA-256", buffer.buffer as ArrayBuffer)
      const computedSha256 = Array.from(new Uint8Array(shaBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase()

      if (computedSha256 !== desired.sha256.toLowerCase()) {
        throw createGraphQLError(
          `Discrepancia de hash SHA-256 en R2 para "${desired.name}": esperado ${desired.sha256}, calculado ${computedSha256}.`,
          "INTERNAL_ERROR",
        )
      }

      const formatValidation = validateGameFileBuffer(buffer.buffer as ArrayBuffer, desired.name, "MOD")
      if (!formatValidation.valid) {
        throw createGraphQLError(
          `El archivo binario en R2 para "${desired.name}" no tiene un formato JAR/ZIP válido.`,
          "INTERNAL_ERROR",
        )
      }

      stagedBinaries.set(desired.id, buffer)
    }

    // 7. Apply Physical Writes and D1 Reconciliations
    heartbeat.assertLeaseOwned()
    let installedCount = 0
    let updatedCount = 0
    let removedCount = 0
    let keptCount = 0

    const matchedCurrentIds = new Set<string>()

    for (const desired of desiredFiles) {
      heartbeat.assertLeaseOwned()
      const matchedCurrent = currentRecords.find(
        (c) =>
          c.gameReleaseFileId === desired.id ||
          (c.provider === desired.sourceProvider && c.projectId === desired.sourceProjectId) ||
          c.targetPath === `mods/${desired.name}`,
      )

      if (matchedCurrent) {
        matchedCurrentIds.add(matchedCurrent.id)
        const isIdentical =
          matchedCurrent.sha256 === desired.sha256 &&
          matchedCurrent.targetPath === `mods/${desired.name}`

        if (isIdentical && physicalMods.has(desired.name)) {
          keptCount++
          continue
        }
      }

      const buffer = stagedBinaries.get(desired.id)
      if (!buffer) {
        throw createGraphQLError(`Falta el binario preparado para "${desired.name}".`, "INTERNAL_ERROR")
      }

      // Step A: Write new binary to Wings
      await client.writeFile(`/mods/${desired.name}`, buffer)

      // Step B: If UPDATE had a filename change (old target != new target), delete old file physically
      if (matchedCurrent && matchedCurrent.targetPath !== `mods/${desired.name}`) {
        const oldFileName = matchedCurrent.targetPath.split("/").pop() || ""
        if (oldFileName && oldFileName !== desired.name) {
          try {
            await safeDeleteServerFilePhysical(client, "/mods", oldFileName)
          } catch (deleteErr: any) {
            // Attempt compensation of newly written file
            await client.deleteFiles("/mods", [desired.name]).catch(() => {})
            throw createGraphQLError(
              `No se pudo eliminar el archivo anterior (${oldFileName}) al actualizar a ${desired.name}: ${deleteErr.message}`,
              "INTERNAL_ERROR",
            )
          }
        }
      }

      // Step C: Update D1 record (with compensation if new install fails)
      const now = new Date().toISOString()
      try {
        if (matchedCurrent) {
          await db
            .update(schema.serverManagedContent)
            .set({
              managementSource: "GAME_RELEASE",
              provider: desired.sourceProvider,
              projectId: desired.sourceProjectId,
              versionId: desired.sourceVersionId,
              fileId: desired.sourceFileId || null,
              contentType: "MOD",
              environment: "BOTH",
              targetPath: `mods/${desired.name}`,
              sha256: desired.sha256,
              sizeBytes: desired.sizeBytes,
              gameReleaseId: published.id,
              gameReleaseFileId: desired.id,
              updatedAt: now,
            })
            .where(eq(schema.serverManagedContent.id, matchedCurrent.id))
          updatedCount++
        } else {
          await db.insert(schema.serverManagedContent).values({
            id: crypto.randomUUID(),
            managementSource: "GAME_RELEASE",
            provider: desired.sourceProvider,
            projectId: desired.sourceProjectId,
            versionId: desired.sourceVersionId,
            fileId: desired.sourceFileId || null,
            contentType: "MOD",
            environment: "BOTH",
            targetPath: `mods/${desired.name}`,
            sha256: desired.sha256,
            sizeBytes: desired.sizeBytes,
            gameReleaseId: published.id,
            gameReleaseFileId: desired.id,
            createdAt: now,
            updatedAt: now,
          })
          installedCount++
        }
      } catch (d1Err: any) {
        // Attempt compensation for new install
        if (!matchedCurrent) {
          await safeDeleteServerFilePhysical(client, "/mods", desired.name).catch(() => {})
        }
        throw d1Err
      }
    }

    // Step D: Apply REMOVE for unreferenced GAME_RELEASE items
    heartbeat.assertLeaseOwned()
    for (const current of currentRecords) {
      if (!matchedCurrentIds.has(current.id)) {
        heartbeat.assertLeaseOwned()
        const fileName = current.targetPath.split("/").pop() || current.targetPath
        // Safe physical delete
        await safeDeleteServerFilePhysical(client, "/mods", fileName)

        // Delete from D1
        await db
          .delete(schema.serverManagedContent)
          .where(eq(schema.serverManagedContent.id, current.id))

        removedCount++
      }
    }

    // 8. Record APPLIED in server_release_syncs table and ACTIVATE release for launcher in D1
    const nowEnd = new Date().toISOString()
    const finalSummary: ServerReleaseSyncSummaryGql = {
      toInstall: installedCount,
      toUpdate: updatedCount,
      toRemove: removedCount,
      toKeep: keptCount,
    }

    await db.batch([
      db
        .update(schema.serverReleaseSyncs)
        .set({
          status: "APPLIED",
          appliedAt: nowEnd,
          details: JSON.stringify(finalSummary),
          updatedAt: nowEnd,
        })
        .where(eq(schema.serverReleaseSyncs.id, syncId)),
      db
        .update(schema.projectSettings)
        .set({
          launcherActiveReleaseId: published.id,
          updatedAt: nowEnd,
        })
        .where(eq(schema.projectSettings.id, "main")),
    ])

    return {
      success: true,
      message: "Sincronización de release completada con éxito.",
      syncedCount: installedCount + updatedCount + removedCount,
      status: "APPLIED",
    }

  } catch (err: any) {
    // If sync failed at any point, record FAILED in D1
    const now = new Date().toISOString()
    try {
      await db
        .update(schema.serverReleaseSyncs)
        .set({
          status: "FAILED",
          details: JSON.stringify({ error: err?.message || String(err), failedAt: now }),
          updatedAt: now,
        })
        .where(eq(schema.serverReleaseSyncs.id, syncId))
    } catch {
      // Ignore fallback log error
    }
    throw err
  } finally {
    // 9. Release distributed operation lock and stop heartbeat
    heartbeat.stop()
    await releaseServerOperationLock(db, lockHandle)
  }
}
