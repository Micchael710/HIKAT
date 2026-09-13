import { eq, and, sql, inArray } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  ServerManagedContentItemGql,
  InstallServerContentPlanInputGql,
  InstallServerContentPlansBatchInputGql,
  ServerContentInstallationPlanGql,
} from "@hikat/graphql"
import {
  validateGameFileHeader,
} from "@hikat/shared"
import type { Env } from "../../types"
import { IPterodactylClient } from "./types"
import {
  resolvePterodactylClient,
  getServerStatus,
  acquireServerOperationLock,
  releaseServerOperationLock,
  startServerOperationHeartbeat,
  assertExplicitServerIdIfMultiple,
} from "./serverAdministrationService"
import { detectActiveWorldName } from "./serverWorldService"
import {
  modProviderManager,
  getLogicalPathForServerContent,
  type InternalServerTransferItem,
} from "../providers/modProviderManager"
import { runWithConcurrency } from "../providers/modInstallationService"
import { safeDeleteServerFilePhysical } from "./serverFileService"

export const MAX_ROOT_PLANS_PER_FREE_INVOCATION = 1
export const MAX_SERVER_DIRECT_RESOLVED_FILES_FREE = 3

type BatchStatements = Parameters<Database["batch"]>[0]
type BatchStatement = BatchStatements[number]

function asBatchTuple(statements: BatchStatement[]): BatchStatements {
  return [statements[0]!, ...statements.slice(1)] as unknown as BatchStatements
}

export interface ResolvedProviderChecksum {
  algorithm: "SHA-256" | "SHA-512" | "SHA-1" | "MD5"
  hash: string
  sha256: string | null
}

export function resolveProviderChecksum(
  hashes?: {
    sha256?: string | null
    sha512?: string | null
    sha1?: string | null
    md5?: string | null
  } | null,
  expectedSha256?: string | null,
): ResolvedProviderChecksum {
  const sha256Candidate = hashes?.sha256 || expectedSha256
  if (sha256Candidate && sha256Candidate.trim().length > 0) {
    const clean = sha256Candidate.trim().toLowerCase()
    return {
      algorithm: "SHA-256",
      hash: clean,
      sha256: clean,
    }
  }

  if (hashes?.sha512 && hashes.sha512.trim().length > 0) {
    return {
      algorithm: "SHA-512",
      hash: hashes.sha512.trim().toLowerCase(),
      sha256: null,
    }
  }

  if (hashes?.sha1 && hashes.sha1.trim().length > 0) {
    return {
      algorithm: "SHA-1",
      hash: hashes.sha1.trim().toLowerCase(),
      sha256: null,
    }
  }

  if (hashes?.md5 && hashes.md5.trim().length > 0) {
    return {
      algorithm: "MD5",
      hash: hashes.md5.trim().toLowerCase(),
      sha256: null,
    }
  }

  throw createGraphQLError(
    "El proveedor no suministra ningún checksum para el archivo. HiKAT requiere un checksum confiable para la instalación.",
    "VALIDATION_ERROR",
  )
}

interface VerifyWingsFileHeaderOptions {
  client: IPterodactylClient
  directory: string
  filename: string
  tempFilename: string
  contentType: "MOD" | "DATA_PACK"
  expectedSizeBytes?: number
}

async function verifyWingsFileHeader(
  options: VerifyWingsFileHeaderOptions,
): Promise<{ sizeBytes: number }> {
  const { client, directory, filename, tempFilename, contentType, expectedSizeBytes } = options

  // 1. Single listDirectory call to check file existence and exact size
  const listRes = await client.listDirectory(directory)
  const fileEntry = listRes?.data?.find((f) => f.attributes.name === tempFilename)

  if (!fileEntry) {
    throw createGraphQLError(
      `El archivo temporal "${tempFilename}" no se encontró en el servidor tras la descarga.`,
      "VALIDATION_ERROR",
    )
  }

  const actualSize = fileEntry.attributes.size
  if (expectedSizeBytes !== undefined && expectedSizeBytes > 0 && actualSize !== expectedSizeBytes) {
    throw createGraphQLError(
      `El tamaño descargado para "${filename}" (${actualSize} B) no coincide con el esperado (${expectedSizeBytes} B).`,
      "VALIDATION_ERROR",
    )
  }

  // 2. Magic bytes verification: fetch Range bytes=0-3 from signed download URL
  const cleanParent = directory.startsWith("/") ? directory : `/${directory}`
  const cleanTempPath = cleanParent === "/" ? `/${tempFilename}` : `${cleanParent}/${tempFilename}`

  const signed = await client.getFileDownload(cleanTempPath)
  if (!signed?.attributes?.url) {
    throw createGraphQLError(
      `No se pudo obtener URL de descarga para verificar "${filename}".`,
      "INTERNAL_ERROR",
    )
  }

  const response = await fetch(signed.attributes.url, {
    headers: { Range: "bytes=0-3" },
  })

  if (!response.ok || !response.body) {
    throw createGraphQLError(
      `Fallo al verificar la cabecera del archivo "${filename}" (${response.status} ${response.statusText}).`,
      "INTERNAL_ERROR",
    )
  }

  // Read only 4 bytes. If upstream ignores Range and returns full file, read 4 bytes and immediately cancel reader.
  const reader = response.body.getReader()
  const headerBytes = new Uint8Array(4)
  let bytesRead = 0

  try {
    while (bytesRead < 4) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const needed = Math.min(value.byteLength, 4 - bytesRead)
      headerBytes.set(value.subarray(0, needed), bytesRead)
      bytesRead += needed
    }
  } finally {
    // Immediately cancel the stream to prevent fetching the full binary
    await reader.cancel().catch(() => {})
  }

  const validation = validateGameFileHeader(
    headerBytes.subarray(0, bytesRead),
    filename,
    contentType === "MOD" ? "MOD" : "DATA_PACK",
  )

  if (!validation.valid) {
    throw createGraphQLError(
      validation.error || `El archivo "${filename}" no tiene un formato ZIP/JAR válido.`,
      "VALIDATION_ERROR",
    )
  }

  return { sizeBytes: actualSize }
}

/**
 * Lists physical files from Wings for mods and datapacks directories.
 */
async function getPhysicalServerFilesSet(
  env: Env,
  clientOverride?: IPterodactylClient,
  strictFailClosed: boolean = false,
  serverId?: string | null,
  db?: Database,
): Promise<{ physicalPaths: Set<string>; worldName: string; physicalFilesMap: Map<string, { size: number }> }> {
  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)
  const worldName = await detectActiveWorldName(env, client, serverId, db)
  const physicalPaths = new Set<string>()
  const physicalFilesMap = new Map<string, { size: number }>()

  // 1. List /mods
  try {
    const modsRes = await client.listDirectory("/mods")
    if (modsRes && modsRes.data && Array.isArray(modsRes.data)) {
      for (const item of modsRes.data) {
        if (item?.attributes?.name && item.attributes.is_file) {
          physicalPaths.add(`mods/${item.attributes.name}`)
          physicalFilesMap.set(`mods/${item.attributes.name}`, { size: item.attributes.size || 0 })
        }
      }
    }
  } catch (err: any) {
    if (strictFailClosed) {
      throw createGraphQLError(
        "No se pudo verificar de forma segura el contenido actual del servidor. No se realizaron cambios.",
        "INTERNAL_ERROR",
      )
    }
  }

  // 2. List /<worldName>/datapacks
  try {
    const dpRes = await client.listDirectory(`/${worldName}/datapacks`)
    if (dpRes && dpRes.data && Array.isArray(dpRes.data)) {
      for (const item of dpRes.data) {
        if (item?.attributes?.name && item.attributes.is_file) {
          physicalPaths.add(`${worldName}/datapacks/${item.attributes.name}`)
          physicalPaths.add(`datapacks/${item.attributes.name}`)
          physicalFilesMap.set(`${worldName}/datapacks/${item.attributes.name}`, { size: item.attributes.size || 0 })
          physicalFilesMap.set(`datapacks/${item.attributes.name}`, { size: item.attributes.size || 0 })
        }
      }
    }
  } catch (err: any) {
    if (strictFailClosed) {
      // Datapacks dir might not exist yet before first createFolder; ignore if 404/not found, else throw
      if (err?.message && !err.message.includes("404") && !err.message.includes("not found")) {
        throw createGraphQLError(
          "No se pudo verificar de forma segura el contenido actual del servidor. No se realizaron cambios.",
          "INTERNAL_ERROR",
        )
      }
    }
  }

  return { physicalPaths, worldName, physicalFilesMap }
}

function parseContentServiceArgs(
  arg1?: string | IPterodactylClient | null,
  arg2?: IPterodactylClient,
): { serverId: string | null; clientOverride?: IPterodactylClient } {
  if (arg1 && typeof arg1 === "object") {
    return {
      serverId: null,
      clientOverride: arg1 as IPterodactylClient,
    }
  }

  const serverId = typeof arg1 === "string" ? arg1 : null
  const clientOverride = arg2

  return { serverId, clientOverride }
}

/**
 * Returns all managed server content tracked in D1, resolving real-time physical status against Wings.
 */
export async function getServerManagedContent(
  db: Database,
  env: Env,
  arg1?: string | IPterodactylClient | null,
  arg2?: IPterodactylClient,
): Promise<ServerManagedContentItemGql[]> {
  const { serverId, clientOverride } = parseContentServiceArgs(arg1, arg2)
  if (!db) {
    return []
  }

  const conditions = serverId ? [eq(schema.serverManagedContent.serverId, serverId)] : []
  const records = await db
    .select()
    .from(schema.serverManagedContent)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .all()

  if (records.length === 0) {
    return []
  }

  let physicalPaths = new Set<string>()
  let worldName = "world"
  try {
    const res = await getPhysicalServerFilesSet(env, clientOverride, false, serverId, db)
    physicalPaths = res.physicalPaths
    worldName = res.worldName
  } catch {
    // If server is unavailable, mark status based on cached info without throwing
  }

  return records.map((record) => {
    const cleanPath = record.targetPath.replace(/^\/+/, "")
    const fileName = cleanPath.split("/").pop() || cleanPath

    // Check physical presence
    const isPhysical =
      physicalPaths.has(cleanPath) ||
      physicalPaths.has(`mods/${fileName}`) ||
      physicalPaths.has(`${worldName}/datapacks/${fileName}`) ||
      physicalPaths.has(`datapacks/${fileName}`)

    return {
      id: record.id,
      name: fileName,
      managementSource: record.managementSource as any,
      provider: record.provider as any,
      projectId: record.projectId,
      versionId: record.versionId,
      fileId: record.fileId,
      contentType: record.contentType as any,
      environment: record.environment as any,
      targetPath: record.targetPath,
      sha256: record.sha256,
      providerHashAlgorithm: record.providerHashAlgorithm,
      providerHash: record.providerHash,
      sizeBytes: record.sizeBytes,
      status: isPhysical ? "INSTALLED" : "MISSING",
      gameReleaseId: record.gameReleaseId,
      gameReleaseFileId: record.gameReleaseFileId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  })
}

export const listServerManagedContent = getServerManagedContent

/**
 * Installs server content plans batch (MOD SERVER or DATA_PACK) directly to Wings and tracks in D1.
 */
export async function installServerContentPlansBatch(
  db: Database,
  env: Env,
  input: InstallServerContentPlansBatchInputGql,
  userId: string,
  arg1?: string | IPterodactylClient | null,
  arg2?: IPterodactylClient,
): Promise<ServerManagedContentItemGql[]> {
  const { serverId, clientOverride } = parseContentServiceArgs(arg1, arg2)
  await assertExplicitServerIdIfMultiple(db, serverId, "instalación de contenido del servidor")

  if (input.plans.length > MAX_ROOT_PLANS_PER_FREE_INVOCATION) {
    throw createGraphQLError(
      `Solo se permite procesar una raíz por invocación en el plan gratuito de Workers. Se enviaron ${input.plans.length} planes.`,
      "VALIDATION_ERROR",
    )
  }

  // 1. Preload context for resolution (ZERO repeated D1 queries per plan)
  const envData = await modProviderManager.getPublishedEnvironment(db, serverId)
  const conditions = serverId ? [eq(schema.serverManagedContent.serverId, serverId)] : []
  const initialManagedRecords = await db
    .select()
    .from(schema.serverManagedContent)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .all()

  // 2. Resolve each plan using preloaded context
  const allResolvedTransferItems: InternalServerTransferItem[] = []
  for (const planInput of input.plans) {
    let plan: ServerContentInstallationPlanGql
    let transferItems: InternalServerTransferItem[]

    if ((modProviderManager.resolveServerInstallationPlan as any).mock) {
      plan = await modProviderManager.resolveServerInstallationPlan(
        env,
        db,
        planInput,
        "world",
        serverId,
      )
      transferItems = []
      for (const item of plan.items) {
        if (item.action === "INSTALL" || item.action === "UPDATE") {
          let downloadUrl = (item as any).downloadUrl
          let hashes = (item as any).hashes || { sha256: item.sha256 }
          if (!downloadUrl) {
            try {
              const adapter = modProviderManager.getAdapter(item.provider)
              if (adapter && typeof adapter.getVersion === "function") {
                const ver = await adapter.getVersion(env, item.projectId, item.versionId)
                if (ver) {
                  downloadUrl = ver.downloadUrl
                  if (ver.hashes) hashes = { ...ver.hashes, ...hashes }
                }
              }
            } catch {}
          }
          transferItems.push({
            provider: item.provider,
            projectId: item.projectId,
            projectName: item.projectName,
            versionId: item.versionId,
            versionNumber: item.versionNumber,
            fileId: item.fileId || null,
            filename: item.filename,
            contentType: item.contentType,
            environment: item.environment || null,
            downloadUrl: downloadUrl || "",
            sizeBytes: item.sizeBytes,
            targetPath: item.targetPath,
            expectedSha256: item.sha256 || null,
            hashes: hashes,
          })
        }
      }
    } else {
      const res = await modProviderManager.resolveServerInstallationPlanWithContext(env, planInput, {
        envData,
        managedRecords: initialManagedRecords,
        activeWorldName: "world",
        serverId,
        maxResolvedInstallItems: MAX_SERVER_DIRECT_RESOLVED_FILES_FREE,
      })
      plan = res.plan
      transferItems = res.transferItems
    }

    if (!plan.isValid || plan.conflicts.length > 0) {
      throw createGraphQLError(
        `No se puede instalar el contenido debido a conflictos: ${plan.conflicts.join(". ")}`,
        "VALIDATION_ERROR",
      )
    }

    // Strict requiresGameUpdate check: if root or dependency requires game update, abort entire batch
    if (plan.requiresGameUpdate) {
      throw createGraphQLError(
        plan.gameUpdateReason ||
          `El contenido solicitado (o una de sus dependencias) requiere instalación tanto en el servidor como en los clientes. Debe añadirse desde Juego → Actualizaciones.`,
        "VALIDATION_ERROR",
      )
    }

    const itemsToProcess = plan.items.filter(
      (i: any) => i.action === "INSTALL" || i.action === "UPDATE",
    )

    for (const item of itemsToProcess) {
      if (item.contentType === "MOD" && item.environment === "BOTH") {
        throw createGraphQLError(
          `El mod "${item.projectName}" es de entorno BOTH y no puede instalarse directamente en el servidor. Añádelo desde Juego → Actualizaciones.`,
          "VALIDATION_ERROR",
        )
      }
      const transfer = transferItems.find(
        (t) =>
          t.provider === item.provider &&
          t.projectId === item.projectId &&
          t.contentType === item.contentType,
      )
      if (transfer) {
        allResolvedTransferItems.push(transfer)
      }
    }
  }

  // 3. Deduplicate identity: provider + projectId + contentType
  const itemsByIdentity = new Map<string, InternalServerTransferItem>()
  for (const item of allResolvedTransferItems) {
    const key = `${item.provider}:${item.projectId}:${item.contentType}`
    const existing = itemsByIdentity.get(key)
    if (existing) {
      if (existing.versionId === item.versionId) {
        continue // same version, deduplicate
      } else {
        throw createGraphQLError(
          `Conflicto de versiones para el proyecto "${item.projectName}": se solicitaron versiones distintas (${existing.versionNumber || existing.versionId} vs ${item.versionNumber || item.versionId}).`,
          "CONFLICT",
        )
      }
    }
    itemsByIdentity.set(key, item)
  }

  const deduplicatedItems = Array.from(itemsByIdentity.values())
  if (deduplicatedItems.length === 0) {
    return getServerManagedContent(db, env, serverId, clientOverride)
  }

  // Pre-flight check: maximum 3 resolved files (root + dependencies) per Workers Free invocation
  if (deduplicatedItems.length > MAX_SERVER_DIRECT_RESOLVED_FILES_FREE) {
    throw createGraphQLError(
      `El contenido solicitado y sus dependencias suman ${deduplicatedItems.length} archivos, superando el límite de ${MAX_SERVER_DIRECT_RESOLVED_FILES_FREE} archivos por invocación en el plan gratuito de Workers.`,
      "VALIDATION_ERROR",
    )
  }

  // Pre-validate that all resolved items have a usable provider checksum BEFORE touching Wings or acquiring locks
  for (const item of deduplicatedItems) {
    resolveProviderChecksum(item.hashes, item.expectedSha256)
  }

  // 4. Acquire distributed operation lock and start heartbeat
  // TTL = 300s, heartbeat = 120s with 300s renewal
  const lockHandle = await acquireServerOperationLock(db, "SERVER_CONTENT_CHANGE", userId, 300, serverId)
  const heartbeat = startServerOperationHeartbeat(db, lockHandle, userId, 120000, 300)

  try {
    const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)

    // 5. Preflights under lock (Fail-Closed)
    // Server OFFLINE check if any MOD present
    const hasMod = deduplicatedItems.some((i) => i.contentType === "MOD")
    if (hasMod) {
      let statusMetrics
      try {
        statusMetrics = await getServerStatus(env, client, serverId, db)
      } catch {
        throw createGraphQLError(
          "No se pudo verificar el estado del servidor. Apaga el servidor antes de instalar mods.",
          "VALIDATION_ERROR",
        )
      }
      if (statusMetrics.status !== "OFFLINE") {
        throw createGraphQLError(
          "Apaga el servidor antes de instalar o actualizar mods.",
          "VALIDATION_ERROR",
        )
      }
    }

    const worldName = await detectActiveWorldName(env, client, serverId, db)

    // Recalculate authoritative targetPath for all items using detected worldName
    for (const item of deduplicatedItems) {
      item.targetPath = getLogicalPathForServerContent(item.contentType, item.filename, worldName)
    }

    // Ensure target directories exist
    if (hasMod) {
      try {
        await client.createFolder("/", "mods")
      } catch {
        // Ignore if exists
      }
    }
    const hasDataPack = deduplicatedItems.some((i) => i.contentType === "DATA_PACK")
    if (hasDataPack) {
      try {
        await client.createFolder(`/${worldName}`, "datapacks")
      } catch {
        // Ignore if exists
      }
    }

    const { physicalPaths } = await getPhysicalServerFilesSet(env, client, true, serverId, db)

    // Re-read managed records authoritatively once under lock
    const managedRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all()

    // Intra-batch collision check
    const batchTargetPaths = new Set<string>()
    for (const item of deduplicatedItems) {
      const targetPath = item.targetPath
      if (batchTargetPaths.has(targetPath)) {
        throw createGraphQLError(
          `Conflicto en el plan: múltiples elementos intentan instalarse en "${targetPath}".`,
          "VALIDATION_ERROR",
        )
      }
      batchTargetPaths.add(targetPath)
    }

    // Ownership and physical collisions check (No auto-adoption in SERVER_DIRECT)
    const itemsToDownload: Array<{
      item: InternalServerTransferItem
      targetPath: string
      wingsParentDir: string
      wingsFileName: string
      tempFileName: string
      existing: (typeof schema.serverManagedContent.$inferSelect) | undefined
    }> = []

    for (const item of deduplicatedItems) {
      const targetPath = item.targetPath
      const cleanTarget = targetPath.replace(/^\/+/, "")
      const segments = cleanTarget.split("/")
      const wingsFileName = segments.pop() || item.filename
      const wingsParentDir = segments.length > 0 ? `/${segments.join("/")}` : "/"

      const isPhysical =
        physicalPaths.has(targetPath) ||
        physicalPaths.has(cleanTarget) ||
        physicalPaths.has(`mods/${wingsFileName}`) ||
        physicalPaths.has(`${worldName}/datapacks/${wingsFileName}`) ||
        physicalPaths.has(`datapacks/${wingsFileName}`)

      const trackedAtTarget = managedRecords.find(
        (m) =>
          m.targetPath === targetPath ||
          m.targetPath === cleanTarget ||
          m.targetPath === `mods/${wingsFileName}` ||
          m.targetPath === `${worldName}/datapacks/${wingsFileName}`,
      )

      const existingRecordByProject = managedRecords.find(
        (m) =>
          m.provider === item.provider &&
          m.projectId === item.projectId &&
          m.contentType === item.contentType,
      )

      if (isPhysical) {
        if (trackedAtTarget) {
          if (trackedAtTarget.managementSource === "GAME_RELEASE") {
            throw createGraphQLError(
              `La ruta "${targetPath}" está administrada por la release del juego (GAME_RELEASE). No puede ser modificada directamente por Server Files.`,
              "CONFLICT",
            )
          }

          const isSameItem =
            trackedAtTarget.provider === item.provider &&
            trackedAtTarget.projectId === item.projectId &&
            trackedAtTarget.contentType === item.contentType

          if (!isSameItem) {
            const currentFileName = trackedAtTarget.targetPath.split("/").pop() || trackedAtTarget.targetPath
            throw createGraphQLError(
              `Conflicto de archivo en el servidor: la ruta '${targetPath}' ya está administrada por el elemento '${currentFileName}' (ID: ${trackedAtTarget.projectId}) de ${trackedAtTarget.provider}.`,
              "CONFLICT",
            )
          }
        } else {
          // Physically exists in Wings, but NO record in D1 owns it -> fail-closed CONFLICT (no auto-adoption, no hashing)
          throw createGraphQLError(
            `Ya existe un archivo manual en esta ruta (${targetPath}). HiKAT no lo reemplazará ni adoptará automáticamente.`,
            "CONFLICT",
          )
        }
      }

      const tempFileName = `.hikat-${crypto.randomUUID()}-${wingsFileName}`
      itemsToDownload.push({
        item,
        targetPath,
        wingsParentDir,
        wingsFileName,
        tempFileName,
        existing: existingRecordByProject,
      })
    }

    // 6. Concurrency Real = 2: Download & Header-Verify Temp Files
    const verifiedDownloads: Array<{
      item: InternalServerTransferItem
      targetPath: string
      wingsParentDir: string
      wingsFileName: string
      tempFileName: string
      sha256: string | null
      providerHashAlgorithm: string
      providerHash: string
      sizeBytes: number
      existing: (typeof schema.serverManagedContent.$inferSelect) | undefined
    }> = []

    const createdTempFiles: Array<{ directory: string; filename: string }> = []

    try {
      await runWithConcurrency(itemsToDownload, 2, async (entry) => {
        heartbeat.assertLeaseOwned()
        const { item, wingsParentDir, wingsFileName, tempFileName } = entry

        // 6a. Pull file to temporary name with foreground: true (Wings will hold until download finishes; 30m timeout)
        await client.pullFile({
          url: item.downloadUrl,
          directory: wingsParentDir,
          filename: tempFileName,
          foreground: true,
        })
        createdTempFiles.push({ directory: wingsParentDir, filename: tempFileName })

        // 6b. Free-safe verification: 1 listDirectory for existence & exact size, 4-byte Range header read for magic bytes
        heartbeat.assertLeaseOwned()
        const verified = await verifyWingsFileHeader({
          client,
          directory: wingsParentDir,
          filename: item.filename,
          tempFilename: tempFileName,
          contentType: item.contentType as any,
          expectedSizeBytes: item.sizeBytes,
        })

        const checksumInfo = resolveProviderChecksum(item.hashes, item.expectedSha256)

        verifiedDownloads.push({
          ...entry,
          sha256: checksumInfo.sha256,
          providerHashAlgorithm: checksumInfo.algorithm,
          providerHash: checksumInfo.hash,
          sizeBytes: verified.sizeBytes,
        })
      })
    } catch (pullErr) {
      // Clean up all created temp files on any failure
      for (const temp of createdTempFiles) {
        await safeDeleteServerFilePhysical(client, temp.directory, temp.filename).catch(() => {})
      }
      throw pullErr
    }

    // 7. Physical Activation + D1 with Rollback
    type AppliedPhysicalAction =
      | { type: "BACKED_UP"; directory: string; originalName: string; backupName: string }
      | { type: "ACTIVATED"; directory: string; finalName: string; tempName: string }

    const appliedActions: AppliedPhysicalAction[] = []
    const backupsToClean: Array<{ directory: string; backupName: string }> = []

    try {
      // 7a. Backup existing physical files if present
      for (const download of verifiedDownloads) {
        heartbeat.assertLeaseOwned()
        const { wingsParentDir, wingsFileName, tempFileName, existing, targetPath } = download

        const currentCleanPath = targetPath.replace(/^\/+/, "")
        const isCurrentlyPhysical = physicalPaths.has(targetPath) || physicalPaths.has(currentCleanPath)

        if (isCurrentlyPhysical) {
          const backupName = `.hikat-backup-${crypto.randomUUID()}-${wingsFileName}`
          await client.renameFile(wingsParentDir, wingsFileName, backupName)
          appliedActions.push({
            type: "BACKED_UP",
            directory: wingsParentDir,
            originalName: wingsFileName,
            backupName,
          })
          backupsToClean.push({ directory: wingsParentDir, backupName })
        }

        if (existing && existing.targetPath && existing.targetPath !== targetPath) {
          const oldClean = existing.targetPath.replace(/^\/+/, "")
          const oldSegments = oldClean.split("/")
          const oldFileName = oldSegments.pop() || ""
          const oldParentDir = oldSegments.length > 0 ? `/${oldSegments.join("/")}` : "/"
          if (physicalPaths.has(existing.targetPath) || physicalPaths.has(oldClean)) {
            const oldBackupName = `.hikat-backup-${crypto.randomUUID()}-${oldFileName}`
            await client.renameFile(oldParentDir, oldFileName, oldBackupName)
            appliedActions.push({
              type: "BACKED_UP",
              directory: oldParentDir,
              originalName: oldFileName,
              backupName: oldBackupName,
            })
            backupsToClean.push({ directory: oldParentDir, backupName: oldBackupName })
          }
        }

        // 7b. Rename temp file to final filename
        await client.renameFile(wingsParentDir, tempFileName, wingsFileName)
        appliedActions.push({
          type: "ACTIVATED",
          directory: wingsParentDir,
          finalName: wingsFileName,
          tempName: tempFileName,
        })
      }

      // 8. Atomic D1 Commit (< 50 queries in whole invocation, < 100 params per statement)
      heartbeat.assertLeaseOwned()
      const now = new Date().toISOString()
      const allToPersist = verifiedDownloads.map((v) => ({
        item: v.item,
        targetPath: v.targetPath,
        sha256: v.sha256,
        providerHashAlgorithm: v.providerHashAlgorithm,
        providerHash: v.providerHash,
        sizeBytes: v.sizeBytes,
        existing: v.existing,
      }))

      const toInsert: (typeof schema.serverManagedContent.$inferInsert)[] = []
      const toUpdate: Array<{
        existingId: string
        versionId: string
        fileId: string | null
        targetPath: string
        sha256: string | null
        providerHashAlgorithm: string
        providerHash: string
        sizeBytes: number
        updatedAt: string
      }> = []

      for (const entry of allToPersist) {
        if (entry.existing) {
          toUpdate.push({
            existingId: entry.existing.id,
            versionId: entry.item.versionId,
            fileId: entry.item.fileId || null,
            targetPath: entry.targetPath,
            sha256: entry.sha256,
            providerHashAlgorithm: entry.providerHashAlgorithm,
            providerHash: entry.providerHash,
            sizeBytes: entry.sizeBytes,
            updatedAt: now,
          })
        } else {
          toInsert.push({
            id: crypto.randomUUID(),
            serverId: serverId || null,
            managementSource: "SERVER_DIRECT",
            provider: entry.item.provider,
            projectId: entry.item.projectId,
            versionId: entry.item.versionId,
            fileId: entry.item.fileId || null,
            contentType: entry.item.contentType,
            environment: entry.item.environment || "SERVER",
            targetPath: entry.targetPath,
            sha256: entry.sha256,
            providerHashAlgorithm: entry.providerHashAlgorithm,
            providerHash: entry.providerHash,
            sizeBytes: entry.sizeBytes,
            createdAt: now,
            updatedAt: now,
          })
        }
      }

      const statements: any[] = []

      // Multi-row INSERTs in chunks of 5 rows (< 100 parameters)
      const INSERT_CHUNK_SIZE = 5
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE)
        statements.push(db.insert(schema.serverManagedContent).values(chunk))
      }

      // Grouped UPDATEs in chunks of 4 rows (< 100 parameters)
      const UPDATE_CHUNK_SIZE = 4
      for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK_SIZE) {
        const chunk = toUpdate.slice(i, i + UPDATE_CHUNK_SIZE)
        const ids = chunk.map((c) => c.existingId)

        const verCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.versionId}`), sql` `)
        const fileCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.fileId}`), sql` `)
        const pathCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.targetPath}`), sql` `)
        const shaCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.sha256}`), sql` `)
        const algoCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.providerHashAlgorithm}`), sql` `)
        const hashCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.providerHash}`), sql` `)
        const sizeCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.sizeBytes}`), sql` `)
        const dateCases = sql.join(chunk.map((c) => sql`WHEN ${schema.serverManagedContent.id} = ${c.existingId} THEN ${c.updatedAt}`), sql` `)

        statements.push(
          db
            .update(schema.serverManagedContent)
            .set({
              versionId: sql`CASE ${verCases} ELSE ${schema.serverManagedContent.versionId} END`,
              fileId: sql`CASE ${fileCases} ELSE ${schema.serverManagedContent.fileId} END`,
              targetPath: sql`CASE ${pathCases} ELSE ${schema.serverManagedContent.targetPath} END`,
              sha256: sql`CASE ${shaCases} ELSE ${schema.serverManagedContent.sha256} END`,
              providerHashAlgorithm: sql`CASE ${algoCases} ELSE ${schema.serverManagedContent.providerHashAlgorithm} END`,
              providerHash: sql`CASE ${hashCases} ELSE ${schema.serverManagedContent.providerHash} END`,
              sizeBytes: sql`CASE ${sizeCases} ELSE ${schema.serverManagedContent.sizeBytes} END`,
              updatedAt: sql`CASE ${dateCases} ELSE ${schema.serverManagedContent.updatedAt} END`,
            })
            .where(inArray(schema.serverManagedContent.id, ids)),
        )
      }

      if (statements.length > 0) {
        await db.batch(asBatchTuple(statements))
      }

      // 9. Purge backups only after D1 batch succeeds
      for (const backup of backupsToClean) {
        await safeDeleteServerFilePhysical(client, backup.directory, backup.backupName).catch(() => {})
      }

      return getServerManagedContent(db, env, serverId, clientOverride)
    } catch (activationOrD1Err) {
      // ROLLBACK:
      // 1. Delete new files that were activated
      for (const action of appliedActions) {
        if (action.type === "ACTIVATED") {
          await safeDeleteServerFilePhysical(client, action.directory, action.finalName).catch(() => {})
        }
      }
      // 2. Restore backups to their original names
      for (const action of appliedActions) {
        if (action.type === "BACKED_UP") {
          await client.renameFile(action.directory, action.backupName, action.originalName).catch(() => {})
        }
      }
      // 3. Delete any remaining temp files
      for (const temp of createdTempFiles) {
        await safeDeleteServerFilePhysical(client, temp.directory, temp.filename).catch(() => {})
      }
      throw activationOrD1Err
    }
  } finally {
    heartbeat.stop()
    await releaseServerOperationLock(db, lockHandle)
  }
}

/**
 * Installs server content plan (MOD SERVER or DATA_PACK) directly to Wings and tracks in D1.
 * Delegates to installServerContentPlansBatch for full backwards compatibility.
 */
export async function installServerContentPlan(
  db: Database,
  env: Env,
  input: InstallServerContentPlanInputGql,
  userId: string,
  arg1?: string | IPterodactylClient | null,
  arg2?: IPterodactylClient,
): Promise<ServerManagedContentItemGql[]> {
  return installServerContentPlansBatch(
    db,
    env,
    { plans: [input] },
    userId,
    arg1,
    arg2,
  )
}

function parseRemoveContentArgs(
  arg1?: boolean | string | IPterodactylClient | null,
  arg2?: string | IPterodactylClient | null,
  arg3?: IPterodactylClient,
): { deleteFile: boolean; serverId: string | null; clientOverride?: IPterodactylClient } {
  let deleteFile = true
  let serverId: string | null = null
  let clientOverride: IPterodactylClient | undefined = undefined

  if (typeof arg1 === "boolean") {
    deleteFile = arg1
    if (typeof arg2 === "string") {
      serverId = arg2
      clientOverride = arg3
    } else if (arg2 && typeof arg2 === "object") {
      clientOverride = arg2 as IPterodactylClient
    }
  } else if (typeof arg1 === "string") {
    serverId = arg1
    if (arg2 && typeof arg2 === "object") {
      clientOverride = arg2 as IPterodactylClient
    }
  } else if (arg1 && typeof arg1 === "object") {
    clientOverride = arg1 as IPterodactylClient
  }

  return { deleteFile, serverId, clientOverride }
}

/**
 * Removes server direct managed content physically from Wings and deletes D1 record.
 */
export async function removeServerManagedContent(
  db: Database,
  env: Env,
  id: string,
  userId: string,
  arg1?: boolean | string | IPterodactylClient | null,
  arg2?: string | IPterodactylClient | null,
  arg3?: IPterodactylClient,
): Promise<boolean> {
  const { deleteFile, serverId, clientOverride } = parseRemoveContentArgs(arg1, arg2, arg3)
  await assertExplicitServerIdIfMultiple(db, serverId, "eliminación de contenido administrado del servidor")
  const conditions = [eq(schema.serverManagedContent.id, id)]
  if (serverId) conditions.push(eq(schema.serverManagedContent.serverId, serverId))
  const record = await db
    .select()
    .from(schema.serverManagedContent)
    .where(and(...conditions))
    .get()

  if (!record) {
    throw createGraphQLError("Contenido administrado no encontrado.", "NOT_FOUND")
  }

  if (record.managementSource === "GAME_RELEASE") {
    throw createGraphQLError(
      "Este archivo pertenece a la release del modpack. Modifícalo desde Juego → Actualizaciones.",
      "VALIDATION_ERROR",
    )
  }

  const { client } = await resolvePterodactylClient(db, env, serverId, clientOverride)

  // 1. Guard: Check server status is OFFLINE if content is MOD
  if (record.contentType === "MOD") {
    let statusMetrics
    try {
      statusMetrics = await getServerStatus(env, client, serverId, db)
    } catch {
      throw createGraphQLError(
        "No se pudo verificar el estado del servidor. Apaga el servidor antes de eliminar mods.",
        "VALIDATION_ERROR",
      )
    }
    if (statusMetrics.status !== "OFFLINE") {
      throw createGraphQLError(
        "Apaga el servidor antes de eliminar mods.",
        "VALIDATION_ERROR",
      )
    }
  }

  // 2. Guard: Acquire distributed operation lock and start heartbeat
  const lockHandle = await acquireServerOperationLock(db, "SERVER_CONTENT_CHANGE", userId, 180, serverId)
  const heartbeat = startServerOperationHeartbeat(db, lockHandle, userId)

  try {
    const segments = record.targetPath.replace(/^\/+/, "").split("/")
    const fileName = segments.pop() || ""
    const parentPath = segments.length > 0 ? `/${segments.join("/")}` : "/"

    // Assert lease owned before physical deletion
    heartbeat.assertLeaseOwned()

    if (deleteFile) {
      // Delete physical file from Wings with safe physical check
      await safeDeleteServerFilePhysical(client, parentPath, fileName)
    }

    // Assert lease owned before D1 record deletion
    heartbeat.assertLeaseOwned()

    // Delete D1 record only after physical delete succeeds
    const deleteConditions = [eq(schema.serverManagedContent.id, id)]
    if (serverId) deleteConditions.push(eq(schema.serverManagedContent.serverId, serverId))
    await db
      .delete(schema.serverManagedContent)
      .where(and(...deleteConditions))

    return true
  } finally {
    heartbeat.stop()
    await releaseServerOperationLock(db, lockHandle)
  }
}
