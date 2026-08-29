import { eq, and, desc } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
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
} from "./serverAdministrationService"
import { createServerBackup } from "./serverBackupService"

/**
 * Computes the Server Release Sync Plan by comparing the published game release's
 * BOTH mods with the server's GAME_RELEASE managed content.
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

  if (!published) {
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
      serverStatus: "OFFLINE",
      canApply: true,
      blockReason: null,
    }
  }

  // 1. Fetch desired state: Game release files with category === "MOD" and sourceEnvironment === "BOTH"
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

  // 2. Fetch current state: server_managed_content with managementSource === "GAME_RELEASE"
  const currentRecords = await db
    .select()
    .from(schema.serverManagedContent)
    .where(eq(schema.serverManagedContent.managementSource, "GAME_RELEASE"))
    .all()

  const items: ServerReleaseSyncPlanItemGql[] = []
  const matchedCurrentIds = new Set<string>()

  // 3. Compare desired against current
  for (const desired of desiredFiles) {
    const matchedCurrent = currentRecords.find(
      (c) =>
        c.gameReleaseFileId === desired.id ||
        (c.provider === desired.sourceProvider && c.projectId === desired.sourceProjectId) ||
        c.targetPath === `mods/${desired.name}`,
    )

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

  // 4. Identify unreferenced current records to REMOVE
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

  // 5. Compute summary
  const summary: ServerReleaseSyncSummaryGql = {
    toInstall: items.filter((i) => i.action === "INSTALL").length,
    toUpdate: items.filter((i) => i.action === "UPDATE").length,
    toRemove: items.filter((i) => i.action === "REMOVE").length,
    toKeep: items.filter((i) => i.action === "KEEP").length,
  }

  const isPending = summary.toInstall > 0 || summary.toUpdate > 0 || summary.toRemove > 0

  // 6. Check server status for preconditions
  let serverStatus: ServerStatusGql = "OFFLINE"
  try {
    const statusMetrics = await getServerStatus(env, clientOverride)
    serverStatus = statusMetrics.status as ServerStatusGql
  } catch {
    // If server status is unavailable, leave as OFFLINE
  }

  const canApply = serverStatus === "OFFLINE"
  const blockReason =
    isPending && !canApply
      ? "Apaga el servidor antes de aplicar cambios de mods."
      : null

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
 * 3. Creates pre-sync backup if requested and waits for completion.
 * 4. Downloads binaries from R2 and writes them to Wings /mods/.
 * 5. Updates server_managed_content and records server_release_syncs in D1.
 */
export async function applyServerReleaseSync(
  db: Database,
  env: Env,
  userId: string,
  createBackup: boolean = false,
  clientOverride?: IPterodactylClient,
): Promise<ServerReleaseSyncResultGql> {
  const client = clientOverride || createPterodactylClient(env)

  // 1. Guard: Check server status is OFFLINE
  const statusMetrics = await getServerStatus(env, client)
  if (statusMetrics.status !== "OFFLINE") {
    throw createGraphQLError(
      "Apaga el servidor antes de aplicar cambios de mods.",
      "VALIDATION_ERROR",
    )
  }

  // 2. Guard: Acquire distributed operation lock
  const lockKey = await acquireServerOperationLock(db, "SERVER_RELEASE_SYNC", userId)

  try {
    // 3. Fetch published release and recompute plan
    const published = await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()

    if (!published) {
      throw createGraphQLError("No hay ninguna release publicada para sincronizar.", "VALIDATION_ERROR")
    }

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

    const currentRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.managementSource, "GAME_RELEASE"))
      .all()

    // 4. Optional pre-sync backup with polling
    if (createBackup) {
      try {
        const backupItem = await createServerBackup(env, "Pre-Release Sync Backup", client)
        if (backupItem && backupItem.id) {
          // Poll up to 60s for backup completion
          let isDone = false
          const startTime = Date.now()
          while (!isDone && Date.now() - startTime < 60000) {
            await new Promise((r) => setTimeout(r, 2000))
            const check = await client.getBackup(backupItem.id).catch(() => null)
            if (check && check.attributes && check.attributes.completed_at) {
              if (!check.attributes.is_successful) {
                throw new Error("El backup de Pterodactyl finalizó con error.")
              }
              isDone = true
            }
          }
        }
      } catch (backupErr: any) {
        const now = new Date().toISOString()
        await db.insert(schema.serverReleaseSyncs).values({
          id: crypto.randomUUID(),
          releaseId: published.id,
          status: "FAILED",
          details: JSON.stringify({ error: backupErr?.message || "Error al crear backup" }),
          createdAt: now,
          updatedAt: now,
        })

        throw createGraphQLError(
          "El backup previo a la sincronización no se completó exitosamente. Operación cancelada.",
          "INTERNAL_ERROR",
        )
      }
    }

    // 5. Ensure Wings /mods folder exists
    try {
      await client.createFolder("/", "mods")
    } catch {
      // Ignore if folder exists
    }

    let appliedCount = 0
    const matchedCurrentIds = new Set<string>()

    // Apply INSTALL and UPDATE
    for (const desired of desiredFiles) {
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

        if (isIdentical) {
          // KEEP: already synchronized
          continue
        }
      }

      // Read binary from R2
      if (!env.ASSETS) {
        throw createGraphQLError("El almacenamiento R2 no está configurado.", "INTERNAL_ERROR")
      }

      const r2Obj = await env.ASSETS.get(desired.objectKey)
      if (!r2Obj) {
        const now = new Date().toISOString()
        await db.insert(schema.serverReleaseSyncs).values({
          id: crypto.randomUUID(),
          releaseId: published.id,
          status: "FAILED",
          details: JSON.stringify({ error: `Falta archivo R2 ${desired.objectKey}` }),
          createdAt: now,
          updatedAt: now,
        })
        throw createGraphQLError(
          `El archivo binario para "${desired.name}" no se encuentra en el almacenamiento R2.`,
          "INTERNAL_ERROR",
        )
      }

      const arrayBuffer = await r2Obj.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)

      // Write binary to Wings
      await client.writeFile(`/mods/${desired.name}`, buffer)

      // Update / insert D1 serverManagedContent record
      const now = new Date().toISOString()
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
      }

      appliedCount++
    }

    // Apply REMOVE
    for (const current of currentRecords) {
      if (!matchedCurrentIds.has(current.id)) {
        const fileName = current.targetPath.split("/").pop() || current.targetPath
        try {
          await client.deleteFiles("/mods", [fileName])
        } catch {
          // If physical file already deleted, ignore
        }

        await db
          .delete(schema.serverManagedContent)
          .where(eq(schema.serverManagedContent.id, current.id))

        appliedCount++
      }
    }

    // 6. Record APPLIED in server_release_syncs table
    const now = new Date().toISOString()
    const finalSummary: ServerReleaseSyncSummaryGql = {
      toInstall: desiredFiles.filter((d) => !currentRecords.some((c) => c.targetPath === `mods/${d.name}`)).length,
      toUpdate: 0,
      toRemove: 0,
      toKeep: desiredFiles.length,
    }

    await db.insert(schema.serverReleaseSyncs).values({
      id: crypto.randomUUID(),
      releaseId: published.id,
      status: "APPLIED",
      appliedAt: now,
      details: JSON.stringify(finalSummary),
      createdAt: now,
      updatedAt: now,
    })

    return {
      success: true,
      message: "Sincronización de release completada con éxito.",
      syncedCount: appliedCount,
      status: "APPLIED",
    }
  } finally {
    // 7. Release distributed operation lock
    await releaseServerOperationLock(db, lockKey)
  }
}
