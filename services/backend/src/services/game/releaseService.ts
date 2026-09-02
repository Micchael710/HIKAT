import { eq, desc, and, sql, inArray } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  PublishedModpackGql,
  ClientFileGql,
  GameReleaseGql,
  AdminGameOverviewGql,
  AdminGameFileGql,
  GameDraftChangesGql,
  GameDraftReadinessGql,
  GameDraftChangeStatusGql,
  SyncPolicyGql,
  PublishGameReleaseInputGql,
  PrepareGameDraftInputGql,
  UpdateGameDraftMetadataInputGql,
  GameModLoaderGql,
} from "@hikat/graphql"
import {
  validateSemVer,
  normalizeIsoDateTime,
  resolveEffectiveGamePolicy,
  type SyncPolicy,
} from "@hikat/shared"
import {
  getContentMediaById,
  getContentMediaByIds,
  formatMediaGql,
  deleteMedia,
} from "../mediaService"
import { ensureSettingsRecord } from "../settingsService"
import { broadcastReleaseActivated } from "../../releaseEvents"
import { validateGameEnvironment } from "./gameEnvironmentService"
import type { Env } from "../../types"


/**
 * Deterministically computes SHA-256 fingerprint representing the current draft state and its files.
 */
export async function computeDraftFingerprint(
  draft: schema.GameRelease,
  files: schema.GameReleaseFile[],
): Promise<string> {
  const sortedFiles = [...files].sort((a, b) => a.logicalPath.localeCompare(b.logicalPath))
  const serializedFiles = sortedFiles
    .map((f) =>
      [
        f.id,
        f.logicalPath,
        f.sha256,
        f.sizeBytes,
        f.policy || "",
        f.category,
        f.isDirectory ? "1" : "0",
        f.sourceProvider || "",
        f.sourceProjectId || "",
        f.sourceVersionId || "",
        f.sourceFileId || "",
        f.sourceEnvironment || "",
      ].join(":"),
    )
    .join("|")

  const raw = [
    draft.id,
    draft.version,
    draft.notes || "",
    draft.coverMediaId || "",
    draft.minecraftVersion,
    draft.modLoader || draft.neoForgeVersion || "",
    draft.modLoaderVersion || "",
    serializedFiles,
  ].join("#")

  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Builds a directory explicit policy map from release records and computes effective policy for each record.
 */
export function resolveReleaseEffectivePolicies(
  records: schema.GameReleaseFile[],
): Map<string, SyncPolicyGql> {
  const directoryPolicies = new Map<string, string | null>()

  for (const r of records) {
    if (r.isDirectory) {
      directoryPolicies.set(r.logicalPath, r.policy)
    }
  }

  const effectiveMap = new Map<string, SyncPolicyGql>()
  for (const r of records) {
    const effective = resolveEffectiveGamePolicy(
      r.logicalPath,
      r.policy,
      directoryPolicies,
    ) as SyncPolicyGql
    effectiveMap.set(r.id, effective)
  }

  return effectiveMap
}

export function formatAdminGameFile(
  file: schema.GameReleaseFile,
  effectivePolicy?: SyncPolicyGql,
): AdminGameFileGql {
  const effective =
    effectivePolicy ||
    (file.policy as SyncPolicyGql) ||
    (resolveEffectiveGamePolicy(file.logicalPath, file.policy as SyncPolicy) as SyncPolicyGql)
  return {
    id: file.id,
    name: file.name,
    logicalPath: file.logicalPath,
    category: file.category as any,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    policy: effective,
    explicitPolicy: file.policy ? (file.policy as SyncPolicyGql) : null,
    effectivePolicy: effective,
    isInherited: !file.policy,
    isDirectory: Boolean(file.isDirectory),
    changeStatus: null,
    sourceProvider: file.sourceProvider ? (file.sourceProvider as any) : null,
    sourceProjectId: file.sourceProjectId || null,
    sourceVersionId: file.sourceVersionId || null,
    sourceFileId: file.sourceFileId || null,
    sourceEnvironment: file.sourceEnvironment ? (file.sourceEnvironment as any) : null,
    createdAt: normalizeIsoDateTime(file.createdAt),
  }
}

export function formatGameRelease(
  release: schema.GameRelease,
  files: schema.GameReleaseFile[],
  taggedFiles?: AdminGameFileGql[],
  coverMedia?: schema.ContentMedia | null,
  env?: Env,
  request?: Request,
): GameReleaseGql {
  const effectiveMap = resolveReleaseEffectivePolicies(files)
  return {
    id: release.id,
    version: release.version,
    minecraftVersion: release.minecraftVersion,
    modLoader: (release.modLoader || "NEOFORGE") as GameModLoaderGql,
    modLoaderVersion: release.modLoaderVersion || null,
    neoForgeVersion: release.neoForgeVersion || null,
    status: release.status as any,
    notes: release.notes || null,
    coverMediaId: release.coverMediaId || null,
    cover: coverMedia && env ? formatMediaGql(coverMedia, env, request) : null,
    publishedAt: release.publishedAt ? normalizeIsoDateTime(release.publishedAt) : null,
    files: taggedFiles || files.map((f) => formatAdminGameFile(f, effectiveMap.get(f.id))),
    createdAt: normalizeIsoDateTime(release.createdAt),
    updatedAt: normalizeIsoDateTime(release.updatedAt),
  }
}

export function computeDraftChanges(
  publishedFiles: schema.GameReleaseFile[],
  draftFiles: schema.GameReleaseFile[],
): {
  changes: GameDraftChangesGql
  taggedFiles: AdminGameFileGql[]
} {
  const publishedEffectiveMap = resolveReleaseEffectivePolicies(publishedFiles)
  const draftEffectiveMap = resolveReleaseEffectivePolicies(draftFiles)

  const publishedMap = new Map<string, schema.GameReleaseFile>()
  for (const pf of publishedFiles) {
    publishedMap.set(pf.logicalPath, pf)
  }

  let added = 0
  let updated = 0
  let unchanged = 0

  const draftPaths = new Set<string>()
  const taggedFiles: AdminGameFileGql[] = []

  for (const df of draftFiles) {
    draftPaths.add(df.logicalPath)
    const base = publishedMap.get(df.logicalPath)
    const draftEffective = draftEffectiveMap.get(df.id) || "NO_MODIFICABLE"
    let changeStatus: GameDraftChangeStatusGql = "UNCHANGED"

    if (!base) {
      changeStatus = "ADDED"
      if (!df.isDirectory) added++
    } else {
      const baseEffective = publishedEffectiveMap.get(base.id) || "NO_MODIFICABLE"
      const contentChanged = base.sha256 !== df.sha256 || base.sizeBytes !== df.sizeBytes
      const policyChanged = baseEffective !== draftEffective || base.policy !== df.policy

      if (contentChanged || policyChanged) {
        changeStatus = "UPDATED"
        if (!df.isDirectory) updated++
      } else {
        changeStatus = "UNCHANGED"
        if (!df.isDirectory) unchanged++
      }
    }

    taggedFiles.push({
      ...formatAdminGameFile(df, draftEffective),
      changeStatus,
    })
  }

  let removed = 0
  for (const pf of publishedFiles) {
    if (!draftPaths.has(pf.logicalPath)) {
      if (!pf.isDirectory) removed++
      const baseEffective = publishedEffectiveMap.get(pf.id) || "NO_MODIFICABLE"
      taggedFiles.push({
        ...formatAdminGameFile(pf, baseEffective),
        id: `tombstone-${pf.id}`,
        changeStatus: "REMOVED",
      })
    }
  }

  const realDraftFilesCount = draftFiles.filter((f) => !f.isDirectory).length

  return {
    changes: {
      added,
      updated,
      removed,
      unchanged,
      total: realDraftFilesCount,
    },
    taggedFiles,
  }
}

export async function validateDraftReadiness(
  env: Env,
  draft: { id?: string; version: string; minecraftVersion?: string | null; neoForgeVersion?: string | null },
  draftFiles: schema.GameReleaseFile[],
  db?: Database,
  targetVersion?: string,
): Promise<GameDraftReadinessGql> {
  const issues: string[] = []
  let noConflicts = true
  let storageVerified = true

  const realFiles = draftFiles.filter((f) => !f.isDirectory)
  const hasFiles = realFiles.length > 0

  if (!hasFiles) {
    issues.push("El borrador no contiene ningún archivo o mod descargable.")
  }

  // 1. Version SemVer evaluation
  const versionToValidate = String(targetVersion || draft.version || "").trim()
  let validVersion = false
  let uniqueVersion = false

  if (!versionToValidate || versionToValidate.startsWith("draft-") || !validateSemVer(versionToValidate)) {
    validVersion = false
    issues.push("Se debe configurar una versión válida en formato SemVer antes de publicar.")
  } else {
    validVersion = true
    if (db) {
      const collision = await db
        .select()
        .from(schema.gameReleases)
        .where(
          and(
            eq(schema.gameReleases.version, versionToValidate),
            draft.id ? sql`${schema.gameReleases.id} != ${draft.id}` : sql`1=1`,
          ),
        )
        .get()
      if (collision) {
        uniqueVersion = false
        issues.push(`La versión "${versionToValidate}" ya existe en el historial.`)
      } else {
        uniqueVersion = true
      }
    } else {
      uniqueVersion = true
    }
  }

  // 2. Check unique logical paths
  const pathSet = new Set<string>()
  for (const f of draftFiles) {
    if (pathSet.has(f.logicalPath)) {
      noConflicts = false
      issues.push(`Ruta duplicada en el borrador: ${f.name}`)
    }
    pathSet.add(f.logicalPath)
  }

  // 3. Verify object existence in R2 strictly for real files (skipping directory records)
  if (realFiles.length > 0) {
    if (!env.ASSETS) {
      storageVerified = false
      issues.push("El almacenamiento de archivos no está disponible.")
    } else {
      for (const f of realFiles) {
        try {
          const head = await env.ASSETS.head(f.objectKey)
          if (!head) {
            storageVerified = false
            issues.push(`El archivo "${f.name}" no se encontró en el almacenamiento.`)
          } else if (head.size !== f.sizeBytes) {
            storageVerified = false
            issues.push(`El tamaño en almacenamiento de "${f.name}" no coincide.`)
          }
        } catch {
          storageVerified = false
          issues.push(`Error al verificar almacenamiento de "${f.name}".`)
        }
      }
    }
  }

  const isReady = validVersion && uniqueVersion && hasFiles && noConflicts && storageVerified

  return {
    isReady,
    validVersion,
    uniqueVersion,
    hasFiles,
    noConflicts,
    storageVerified,
    issues,
  }
}

/**
 * Determines whether a game release file belongs to the client launcher.
 * - Directories are never client files.
 * - DATA_PACK is strictly server-only.
 * - MOD:
 *   - CLIENT -> include
 *   - BOTH -> include
 *   - SERVER -> exclude
 *   - Provider-managed with UNKNOWN/null -> fail-closed (exclude)
 *   - Custom mod without provider -> include if not SERVER
 * - RESOURCE_PACK, SHADER_PACK, CONFIG, KUBEJS, SCRIPT, GENERAL, etc. -> include
 */
export function isClientGameReleaseFile(file: {
  isDirectory: number | boolean
  category: string
  sourceEnvironment?: string | null
  sourceProvider?: string | null
}): boolean {
  if (file.isDirectory) return false
  if (file.category === "DATA_PACK") return false
  if (file.category === "MOD") {
    if (file.sourceEnvironment === "SERVER") return false
    if (file.sourceEnvironment === "CLIENT" || file.sourceEnvironment === "BOTH") return true
    if (file.sourceProvider) {
      // Provider-managed mod with UNKNOWN/null environment -> fail closed
      return false
    }
    // Custom uploaded mod without provider: include if not explicitly SERVER
    return true
  }
  return true // RESOURCE_PACK, SHADER_PACK, CONFIG, KUBEJS, SCRIPT, GENERAL, etc.
}

/**
 * Checks if a release has any changes that must be physically applied to the server
 * compared to the current server managed content state.
 * Server-relevant files are MOD with sourceEnvironment === "BOTH".
 */
export async function hasServerRelevantChanges(
  db: Database,
  draftFiles: schema.GameReleaseFile[],
): Promise<boolean> {
  const desiredBothMods = draftFiles.filter(
    (f) => !f.isDirectory && f.category === "MOD" && f.sourceEnvironment === "BOTH",
  )

  const currentServerManaged = await db
    .select()
    .from(schema.serverManagedContent)
    .where(eq(schema.serverManagedContent.managementSource, "GAME_RELEASE"))
    .all()

  // 1. Check if any desired mod is new or has changed hash/path
  for (const desired of desiredBothMods) {
    const matched = currentServerManaged.find(
      (c) =>
        c.gameReleaseFileId === desired.id ||
        (c.provider === desired.sourceProvider && c.projectId === desired.sourceProjectId) ||
        c.targetPath === `mods/${desired.name}`,
    )
    if (!matched) {
      return true // New mod to install on server
    }
    if (matched.sha256 !== desired.sha256 || matched.targetPath !== `mods/${desired.name}`) {
      return true // Mod updated on server
    }
  }

  // 2. Check if any current server managed mod is removed from the release
  for (const current of currentServerManaged) {
    const matchedDesired = desiredBothMods.find(
      (d) =>
        d.id === current.gameReleaseFileId ||
        (d.sourceProvider === current.provider && d.sourceProjectId === current.projectId) ||
        `mods/${d.name}` === current.targetPath,
    )
    if (!matchedDesired) {
      return true // Mod removed on server
    }
  }

  return false
}

export async function getPublishedModpack(
  db: Database,
  env: Env,
): Promise<PublishedModpackGql | null> {
  const settings = await ensureSettingsRecord(db)
  if (!settings.launcherActiveReleaseId) {
    return null
  }

  const activeRelease = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.id, settings.launcherActiveReleaseId))
    .get()

  if (!activeRelease) return null

  const allRecords = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, activeRelease.id))
    .all()

  // 1. Resolve effective policies across the entire release tree
  const effectiveMap = resolveReleaseEffectivePolicies(allRecords)

  // 2. Filter strictly for client-appropriate files
  const realFiles = allRecords.filter(isClientGameReleaseFile)


  const clientFiles: ClientFileGql[] = realFiles.map((file) => ({
    path: file.logicalPath,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    downloadUrl: `/game/download/${file.id}`,
    policy: effectiveMap.get(file.id) || "NO_MODIFICABLE",
  }))

  return {
    version: activeRelease.version,
    minecraftVersion: activeRelease.minecraftVersion,
    modLoader: (activeRelease.modLoader || "NEOFORGE") as GameModLoaderGql,
    modLoaderVersion: activeRelease.modLoaderVersion || null,
    neoForgeVersion: activeRelease.neoForgeVersion || null,
    mandatory: true,
    clientFiles,
  }
}


export async function getAdminGameOverview(
  db: Database,
  env: Env,
  request?: Request,
): Promise<AdminGameOverviewGql> {
  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "PUBLISHED"))
    .get()

  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  // Fetch cover media for published and draft in batch
  const coverIds: string[] = []
  if (published?.coverMediaId) coverIds.push(published.coverMediaId)
  if (draft?.coverMediaId) coverIds.push(draft.coverMediaId)
  const coverMediaMap = await getContentMediaByIds(db, coverIds)

  let publishedGql: GameReleaseGql | null = null
  let publishedFiles: schema.GameReleaseFile[] = []
  if (published) {
    publishedFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, published.id))
      .all()
    const publishedCover = published.coverMediaId ? coverMediaMap.get(published.coverMediaId) : null
    publishedGql = formatGameRelease(published, publishedFiles, undefined, publishedCover, env, request)
  }

  let draftGql: GameReleaseGql | null = null
  let pendingChangesCount = 0
  let changes: GameDraftChangesGql | null = null
  let readiness: GameDraftReadinessGql | null = null
  let draftFingerprint: string | null = null

  if (draft) {
    const draftFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    const changeAnalysis = computeDraftChanges(publishedFiles, draftFiles)
    changes = changeAnalysis.changes
    readiness = await validateDraftReadiness(env, draft, draftFiles, db)
    draftFingerprint = await computeDraftFingerprint(draft, draftFiles)

    const draftCover = draft.coverMediaId ? coverMediaMap.get(draft.coverMediaId) : null
    draftGql = formatGameRelease(draft, draftFiles, changeAnalysis.taggedFiles, draftCover, env, request)
    pendingChangesCount = changes.added + changes.updated + changes.removed
  }

  return {
    publishedRelease: publishedGql,
    draftRelease: draftGql,
    pendingChangesCount,
    changes,
    readiness,
    draftFingerprint,
  }
}

export async function getGameReleaseHistory(
  db: Database,
  env?: Env,
  request?: Request,
): Promise<GameReleaseGql[]> {
  const releases = await db
    .select()
    .from(schema.gameReleases)
    .where(inArray(schema.gameReleases.status, ["PUBLISHED", "ARCHIVED"]))
    .orderBy(desc(schema.gameReleases.publishedAt), desc(schema.gameReleases.createdAt))
    .all()

  const coverIds = releases
    .map((r) => r.coverMediaId)
    .filter((id): id is string => Boolean(id))
  const coverMediaMap = await getContentMediaByIds(db, coverIds)

  const result: GameReleaseGql[] = []
  for (const rel of releases) {
    const files = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, rel.id))
      .all()
    const coverMedia = rel.coverMediaId ? coverMediaMap.get(rel.coverMediaId) : null
    result.push(formatGameRelease(rel, files, undefined, coverMedia, env, request))
  }
  return result
}

export async function prepareGameDraft(
  db: Database,
  userId: string,
  input?: PrepareGameDraftInputGql | null,
  env?: Env,
  request?: Request,
): Promise<GameReleaseGql> {
  // 1. Check if a draft already exists
  const existingDraft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (existingDraft) {
    const files = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, existingDraft.id))
      .all()
    let coverMedia: schema.ContentMedia | undefined
    if (existingDraft.coverMediaId) {
      coverMedia = await getContentMediaById(db, existingDraft.coverMediaId)
    }
    return formatGameRelease(existingDraft, files, undefined, coverMedia, env, request)
  }

  // 2. Locate base release (provided baseReleaseId or currently published)
  let baseRelease: schema.GameRelease | undefined
  if (input?.baseReleaseId) {
    baseRelease = await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.id, input.baseReleaseId))
      .get()
  } else {
    baseRelease = await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()
  }

  const now = new Date().toISOString()
  const draftId = crypto.randomUUID()
  const tempVersion = `draft-${Date.now()}`

  await db.insert(schema.gameReleases).values({
    id: draftId,
    version: tempVersion,
    minecraftVersion: baseRelease?.minecraftVersion || "1.21.1",
    neoForgeVersion: baseRelease?.neoForgeVersion || "21.1.65",
    status: "DRAFT",
    notes: baseRelease?.notes || null,
    coverMediaId: baseRelease?.coverMediaId || null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  // 3. Clone all files from base release into draft snapshot
  const clonedFiles: schema.GameReleaseFile[] = []
  if (baseRelease) {
    const baseFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, baseRelease.id))
      .all()

    for (const bf of baseFiles) {
      const newFileId = crypto.randomUUID()
      const newFile = {
        id: newFileId,
        releaseId: draftId,
        name: bf.name,
        logicalPath: bf.logicalPath,
        category: bf.category,
        sha256: bf.sha256,
        sizeBytes: bf.sizeBytes,
        policy: bf.policy,
        isDirectory: bf.isDirectory ?? 0,
        objectKey: bf.objectKey, // Immutable reference to identical R2 object
        sourceProvider: bf.sourceProvider || null,
        sourceProjectId: bf.sourceProjectId || null,
        sourceVersionId: bf.sourceVersionId || null,
        sourceFileId: bf.sourceFileId || null,
        sourceEnvironment: bf.sourceEnvironment || null,
        createdAt: now,
      }
      await db.insert(schema.gameReleaseFiles).values(newFile)
      clonedFiles.push(newFile)
    }
  }

  const draftRelease = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.id, draftId))
    .get()

  if (!draftRelease) {
    throw createGraphQLError("No se pudo crear el borrador de actualización.", "INTERNAL_ERROR")
  }

  let clonedCover: schema.ContentMedia | undefined
  if (draftRelease.coverMediaId) {
    clonedCover = await getContentMediaById(db, draftRelease.coverMediaId)
  }

  return formatGameRelease(draftRelease, clonedFiles, undefined, clonedCover, env, request)
}

export async function updateGameDraftMetadata(
  db: Database,
  env: Env,
  input: UpdateGameDraftMetadataInputGql,
  _userId: string,
  request?: Request,
): Promise<GameReleaseGql> {
  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) {
    throw createGraphQLError("No hay ningún borrador de actualización pendiente para modificar.", "NOT_FOUND")
  }

  const updates: Partial<schema.GameRelease> = {
    updatedAt: new Date().toISOString(),
  }

  // 1. Version validation & uniqueness
  if (input.version !== undefined && input.version !== null) {
    const trimmed = input.version.trim()
    if (!trimmed) {
      throw createGraphQLError("La versión del juego no puede estar vacía.", "VALIDATION_ERROR")
    }
    if (!validateSemVer(trimmed)) {
      throw createGraphQLError(
        "Formato de versión inválido. Debe seguir el formato SemVer (ejemplo: 1.0.1).",
        "VALIDATION_ERROR",
      )
    }

    const collision = await db
      .select()
      .from(schema.gameReleases)
      .where(
        and(
          eq(schema.gameReleases.version, trimmed),
          sql`${schema.gameReleases.id} != ${draft.id}`,
        ),
      )
      .get()

    if (collision) {
      throw createGraphQLError(`La versión ${trimmed} ya existe en el historial.`, "CONFLICT")
    }

    updates.version = trimmed
  }

  // 2. Minecraft environment validation
  if (
    input.minecraftVersion !== undefined &&
    input.minecraftVersion !== null
  ) {
    const minecraftVersion =
      input.minecraftVersion.trim()

    if (!minecraftVersion) {
      throw createGraphQLError(
        "La versión de Minecraft no puede estar vacía.",
        "VALIDATION_ERROR",
      )
    }

    if (
      minecraftVersion.length > 32 ||
      !/^[0-9A-Za-z._+-]+$/.test(minecraftVersion)
    ) {
      throw createGraphQLError(
        "La versión de Minecraft tiene un formato inválido.",
        "VALIDATION_ERROR",
      )
    }

    updates.minecraftVersion =
      minecraftVersion
  }

  // 3. Generic mod loader environment validation
  const hasModLoaderInput = input.modLoader !== undefined && input.modLoader !== null
  const hasModLoaderVersionInput = input.modLoaderVersion !== undefined
  const hasNeoForgeInput = input.neoForgeVersion !== undefined && input.neoForgeVersion !== null

  if (hasModLoaderInput || hasModLoaderVersionInput) {
    // New generic path: modLoader + modLoaderVersion
    const modLoader = input.modLoader || (draft.modLoader as GameModLoaderGql) || "NEOFORGE"
    const minecraftVersion = updates.minecraftVersion || draft.minecraftVersion
    const modLoaderVersion = hasModLoaderVersionInput
      ? (input.modLoaderVersion ?? null)
      : (draft.modLoaderVersion ?? null)

    await validateGameEnvironment(minecraftVersion, modLoader, modLoaderVersion)

    updates.modLoader = modLoader
    updates.modLoaderVersion = modLoaderVersion
    // Keep neoForgeVersion in sync for NEOFORGE (backwards compat)
    if (modLoader === "NEOFORGE" && modLoaderVersion) {
      updates.neoForgeVersion = modLoaderVersion
    }
  } else if (hasNeoForgeInput) {
    // Legacy path: neoForgeVersion only
    const neoForgeVersion = (input.neoForgeVersion as string).trim()
    if (!neoForgeVersion) {
      throw createGraphQLError("La versión de NeoForge no puede estar vacía.", "VALIDATION_ERROR")
    }
    if (neoForgeVersion.length > 64 || !/^[0-9A-Za-z._+-]+$/.test(neoForgeVersion)) {
      throw createGraphQLError("La versión de NeoForge tiene un formato inválido.", "VALIDATION_ERROR")
    }
    const minecraftVersion = updates.minecraftVersion || draft.minecraftVersion
    await validateGameEnvironment(minecraftVersion, "NEOFORGE", neoForgeVersion)
    updates.neoForgeVersion = neoForgeVersion
    updates.modLoader = "NEOFORGE"
    updates.modLoaderVersion = neoForgeVersion
  }

  // 4. Notes validation
  if (input.notes !== undefined) {
    if (input.notes !== null && input.notes.length > 5000) {
      throw createGraphQLError("Las notas de la versión no pueden superar los 5000 caracteres.", "VALIDATION_ERROR")
    }
    updates.notes = input.notes ? input.notes.trim() || null : null
  }

  // 5. Cover media validation
  let targetCover: schema.ContentMedia | null = null
  if (input.coverMediaId !== undefined) {
    if (input.coverMediaId === null || input.coverMediaId.trim() === "") {
      updates.coverMediaId = null
    } else {
      const media = await getContentMediaById(db, input.coverMediaId.trim())
      if (!media) {
        throw createGraphQLError(`El recurso multimedia '${input.coverMediaId}' no fue encontrado.`, "NOT_FOUND")
      }
      if (media.mediaType !== "IMAGE" && media.mediaType !== "VIDEO") {
        throw createGraphQLError("La portada de la versión debe ser una imagen o un video.", "VALIDATION_ERROR")
      }
      updates.coverMediaId = media.id
      targetCover = media
    }
  } else if (draft.coverMediaId) {
    targetCover = (await getContentMediaById(db, draft.coverMediaId)) || null
  }

  const previousCoverMediaId = draft.coverMediaId

  await db
    .update(schema.gameReleases)
    .set(updates)
    .where(eq(schema.gameReleases.id, draft.id))

  // Clean up previous cover media if replaced and no longer referenced
  if (
    previousCoverMediaId &&
    updates.coverMediaId !== undefined &&
    updates.coverMediaId !== previousCoverMediaId
  ) {
    try {
      await deleteMedia(db, env, previousCoverMediaId)
    } catch {
      // Media is still in use by other entities, which is expected
    }
  }

  const updatedDraft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.id, draft.id))
    .get()

  if (!updatedDraft) {
    throw createGraphQLError("Error al actualizar la metadata del borrador.", "INTERNAL_ERROR")
  }

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  return formatGameRelease(updatedDraft, draftFiles, undefined, targetCover, env, request)
}

export async function discardGameDraft(db: Database, env?: Env): Promise<boolean> {
  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) return true

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  const oldCoverMediaId = draft.coverMediaId

  // Cascade delete removes gameReleaseFiles belonging to the draft
  await db.delete(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id))

  // Clean up R2 objects exclusive to the draft
  if (env?.ASSETS) {
    for (const f of draftFiles) {
      if (f.objectKey) {
        try {
          const refs = await db
            .select({ count: sql<number>`count(*)` })
            .from(schema.gameReleaseFiles)
            .where(eq(schema.gameReleaseFiles.objectKey, f.objectKey))
            .get()
          if (!refs || Number(refs.count) === 0) {
            await env.ASSETS.delete(f.objectKey)
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  // Safely clean up orphaned cover media if not referenced elsewhere
  if (oldCoverMediaId && env) {
    try {
      await deleteMedia(db, env, oldCoverMediaId)
    } catch {
      // Media is still in use by other releases / entities, preserve it
    }
  }

  return true
}

export async function publishGameRelease(
  db: Database,
  env: Env,
  input: PublishGameReleaseInputGql,
  _userId: string,
  request?: Request,
): Promise<GameReleaseGql> {
  // 1. Locate active draft
  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) {
    throw createGraphQLError("No hay ningún borrador de actualización pendiente para publicar.", "NOT_FOUND")
  }

  // 2. Resolve target version
  const rawVersion = input.version !== undefined && input.version !== null ? input.version : draft.version
  const targetVersion = String(rawVersion || "").trim()

  if (!targetVersion || targetVersion.startsWith("draft-")) {
    throw createGraphQLError("La versión del juego es obligatoria y debe ser SemVer.", "VALIDATION_ERROR")
  }
  if (!validateSemVer(targetVersion)) {
    throw createGraphQLError(
      "Formato de versión inválido. Debe seguir el formato SemVer (ejemplo: 1.4.3).",
      "VALIDATION_ERROR",
    )
  }

  // 3. Resolve target notes
  let targetNotes: string | null = draft.notes || null
  if (input.notes !== undefined) {
    if (input.notes !== null && input.notes.length > 5000) {
      throw createGraphQLError("Las notas de la versión no pueden superar los 5000 caracteres.", "VALIDATION_ERROR")
    }
    targetNotes = input.notes ? input.notes.trim() || null : null
  }

  // 4. Resolve target coverMediaId
  let targetCoverMediaId: string | null = draft.coverMediaId || null
  let targetCoverMedia: schema.ContentMedia | null = null
  if (input.coverMediaId !== undefined) {
    if (input.coverMediaId === null || input.coverMediaId.trim() === "") {
      targetCoverMediaId = null
    } else {
      const media = await getContentMediaById(db, input.coverMediaId.trim())
      if (!media) {
        throw createGraphQLError(`El recurso multimedia '${input.coverMediaId}' no fue encontrado.`, "NOT_FOUND")
      }
      if (media.mediaType !== "IMAGE" && media.mediaType !== "VIDEO") {
        throw createGraphQLError("La portada de la versión debe ser una imagen o un video.", "VALIDATION_ERROR")
      }
      targetCoverMediaId = media.id
      targetCoverMedia = media
    }
  } else if (draft.coverMediaId) {
    targetCoverMedia = (await getContentMediaById(db, draft.coverMediaId)) || null
  }

  // 5. Fetch draft files
  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  // 6. Authoritative Pre-publication Readiness Verification
  const readiness = await validateDraftReadiness(env, draft, draftFiles, db, targetVersion)
  if (!readiness.isReady) {
    const errorMsg = readiness.issues.length > 0 ? readiness.issues.join(". ") : "El borrador no está listo para publicar."
    throw createGraphQLError(`No se puede publicar la actualización: ${errorMsg}`, "VALIDATION_ERROR")
  }

  // 7. Authoritative Review Fingerprint Validation
  if (input.expectedDraftFingerprint) {
    const currentFingerprint = await computeDraftFingerprint(draft, draftFiles)
    if (input.expectedDraftFingerprint !== currentFingerprint) {
      throw createGraphQLError(
        "El borrador cambió después de ser revisado. Revisa los cambios nuevamente antes de publicar.",
        "CONFLICT",
      )
    }
  }

  // 8. Check for existing version collision
  const existingVersion = await db
    .select()
    .from(schema.gameReleases)
    .where(and(eq(schema.gameReleases.version, targetVersion), sql`${schema.gameReleases.id} != ${draft.id}`))
    .get()

  if (existingVersion) {
    throw createGraphQLError(`La versión ${targetVersion} ya existe en el historial.`, "CONFLICT")
  }

  const now = new Date().toISOString()

  // 9. ATOMIC CONCURRENT PUBLICATION & ACTIVATION ENGINE:
  const settings = await ensureSettingsRecord(db)
  const hasServerChanges = await hasServerRelevantChanges(db, draftFiles)

  let shouldActivate = false
  if (settings.updateDeploymentOrder === "PLAYERS_FIRST") {
    shouldActivate = true
  } else if (settings.updateDeploymentOrder === "SERVER_FIRST") {
    if (!hasServerChanges) {
      // 0 server-relevant changes -> activate immediately without waiting for server apply
      shouldActivate = true
    } else {
      // Server-relevant changes present -> remains pending until explicit server apply
      shouldActivate = false
    }
  }


  const archiveQuery = db
    .update(schema.gameReleases)
    .set({
      status: "ARCHIVED",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.gameReleases.status, "PUBLISHED"),
        sql`EXISTS (SELECT 1 FROM game_releases WHERE id = ${draft.id} AND status = 'DRAFT')`,
      ),
    )

  const publishQuery = db
    .update(schema.gameReleases)
    .set({
      version: targetVersion,
      status: "PUBLISHED",
      notes: targetNotes,
      coverMediaId: targetCoverMediaId,
      publishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.gameReleases.id, draft.id),
        eq(schema.gameReleases.status, "DRAFT"),
      ),
    )

  if (shouldActivate) {
    const activateQuery = db
      .update(schema.projectSettings)
      .set({
        launcherActiveReleaseId: draft.id,
        updatedAt: now,
      })
      .where(eq(schema.projectSettings.id, "main"))

    await db.batch([archiveQuery, publishQuery, activateQuery])
  } else {
    await db.batch([archiveQuery, publishQuery])
  }



  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(
      and(
        eq(schema.gameReleases.id, draft.id),
        eq(schema.gameReleases.status, "PUBLISHED"),
        eq(schema.gameReleases.publishedAt, now),
      ),
    )
    .get()

  if (!published) {
    throw createGraphQLError(
      "El borrador ya fue publicado o procesado por otra solicitud.",
      "CONFLICT",
    )
  }

  if (shouldActivate) {
    await broadcastReleaseActivated(env, {
      version: published.version,
      minecraftVersion: published.minecraftVersion,
      modLoader: published.modLoader || "NEOFORGE",
      modLoaderVersion: published.modLoaderVersion || null,
      neoForgeVersion: published.neoForgeVersion,
      mandatory: true,
    }).catch((err) => {
      console.warn("[ReleaseEvents] Broadcast failed:", err)
    })
  }

  return formatGameRelease(published, draftFiles, undefined, targetCoverMedia, env, request)
}
