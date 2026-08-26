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
  PublishGameReleaseInputGql,
  PrepareGameDraftInputGql,
} from "@hikat/graphql"
import { validateSemVer, normalizeIsoDateTime } from "@hikat/shared"
import type { Env } from "../../types"

export function formatAdminGameFile(file: schema.GameReleaseFile): AdminGameFileGql {
  return {
    id: file.id,
    name: file.name,
    logicalPath: file.logicalPath,
    category: file.category as any,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    policy: file.policy as any,
    createdAt: normalizeIsoDateTime(file.createdAt),
  }
}

export function formatGameRelease(
  release: schema.GameRelease,
  files: schema.GameReleaseFile[],
  taggedFiles?: AdminGameFileGql[],
): GameReleaseGql {
  return {
    id: release.id,
    version: release.version,
    minecraftVersion: release.minecraftVersion,
    neoForgeVersion: release.neoForgeVersion,
    status: release.status as any,
    notes: release.notes,
    publishedAt: release.publishedAt ? normalizeIsoDateTime(release.publishedAt) : null,
    files: taggedFiles || files.map(formatAdminGameFile),
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
    let changeStatus: GameDraftChangeStatusGql = "UNCHANGED"

    if (!base) {
      changeStatus = "ADDED"
      added++
    } else if (base.sha256 !== df.sha256 || base.sizeBytes !== df.sizeBytes) {
      changeStatus = "UPDATED"
      updated++
    } else {
      changeStatus = "UNCHANGED"
      unchanged++
    }

    taggedFiles.push({
      ...formatAdminGameFile(df),
      changeStatus,
    })
  }

  let removed = 0
  for (const pf of publishedFiles) {
    if (!draftPaths.has(pf.logicalPath)) {
      removed++
      taggedFiles.push({
        ...formatAdminGameFile(pf),
        id: `tombstone-${pf.id}`,
        changeStatus: "REMOVED",
      })
    }
  }

  return {
    changes: {
      added,
      updated,
      removed,
      unchanged,
      total: draftFiles.length,
    },
    taggedFiles,
  }
}


export async function validateDraftReadiness(
  env: Env,
  draft: schema.GameRelease,
  draftFiles: schema.GameReleaseFile[],
): Promise<GameDraftReadinessGql> {
  const issues: string[] = []
  let noConflicts = true
  let storageVerified = true
  const validVersion = true

  if (draftFiles.length === 0) {
    issues.push("El borrador no contiene ningún archivo o mod.")
  }

  // Check unique logical paths
  const pathSet = new Set<string>()
  for (const f of draftFiles) {
    if (pathSet.has(f.logicalPath)) {
      noConflicts = false
      issues.push(`Ruta duplicada en el borrador: ${f.name}`)
    }
    pathSet.add(f.logicalPath)
  }

  // Verify object existence in R2
  if (env.ASSETS) {
    for (const f of draftFiles) {
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

  const isReady = validVersion && noConflicts && storageVerified && draftFiles.length > 0

  return {
    isReady,
    validVersion,
    noConflicts,
    storageVerified,
    issues,
  }
}

export async function getPublishedModpack(
  db: Database,
  env: Env,
): Promise<PublishedModpackGql | null> {
  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "PUBLISHED"))
    .get()

  if (!published) return null

  const files = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, published.id))
    .all()

  const clientFiles: ClientFileGql[] = files.map((file) => ({
    path: file.logicalPath,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    downloadUrl: `/game/download/${file.id}`,
    policy: file.policy as any,
  }))

  return {
    version: published.version,
    minecraftVersion: published.minecraftVersion,
    neoForgeVersion: published.neoForgeVersion,
    mandatory: true,
    clientFiles,
  }
}

export async function getAdminGameOverview(
  db: Database,
  env: Env,
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

  let publishedGql: GameReleaseGql | null = null
  let publishedFiles: schema.GameReleaseFile[] = []
  if (published) {
    publishedFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, published.id))
      .all()
    publishedGql = formatGameRelease(published, publishedFiles)
  }

  let draftGql: GameReleaseGql | null = null
  let pendingChangesCount = 0
  let changes: GameDraftChangesGql | null = null
  let readiness: GameDraftReadinessGql | null = null

  if (draft) {
    const draftFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    const changeAnalysis = computeDraftChanges(publishedFiles, draftFiles)
    changes = changeAnalysis.changes
    readiness = await validateDraftReadiness(env, draft, draftFiles)

    draftGql = formatGameRelease(draft, draftFiles, changeAnalysis.taggedFiles)
    pendingChangesCount = changes.added + changes.updated + changes.removed
  }

  return {
    publishedRelease: publishedGql,
    draftRelease: draftGql,
    pendingChangesCount,
    changes,
    readiness,
  }
}

export async function getGameReleaseHistory(
  db: Database,
): Promise<GameReleaseGql[]> {
  const releases = await db
    .select()
    .from(schema.gameReleases)
    .where(inArray(schema.gameReleases.status, ["PUBLISHED", "ARCHIVED"]))
    .orderBy(desc(schema.gameReleases.publishedAt), desc(schema.gameReleases.createdAt))
    .all()

  const result: GameReleaseGql[] = []
  for (const rel of releases) {
    const files = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, rel.id))
      .all()
    result.push(formatGameRelease(rel, files))
  }
  return result
}

export async function prepareGameDraft(
  db: Database,
  userId: string,
  input?: PrepareGameDraftInputGql | null,
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
    return formatGameRelease(existingDraft, files)
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
        objectKey: bf.objectKey, // Immutable reference to identical R2 object
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

  return formatGameRelease(draftRelease, clonedFiles)
}

export async function discardGameDraft(db: Database): Promise<boolean> {
  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) return true

  // Cascade delete removes gameReleaseFiles belonging to the draft
  await db.delete(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id))
  return true
}

export async function publishGameRelease(
  db: Database,
  env: Env,
  input: PublishGameReleaseInputGql,
  userId: string,
): Promise<GameReleaseGql> {
  const version = String(input.version || "").trim()
  if (!version) {
    throw createGraphQLError("La versión del juego es obligatoria.", "VALIDATION_ERROR")
  }
  if (!validateSemVer(version)) {
    throw createGraphQLError(
      "Formato de versión inválido. Debe seguir el formato SemVer (ejemplo: 1.4.3).",
      "VALIDATION_ERROR",
    )
  }

  // 1. Locate active draft
  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) {
    throw createGraphQLError("No hay ningún borrador de actualización pendiente para publicar.", "NOT_FOUND")
  }

  // 2. Fetch draft files
  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  if (draftFiles.length === 0) {
    throw createGraphQLError("No puedes publicar una versión sin archivos o mods.", "VALIDATION_ERROR")
  }

  // 3. Pre-publication Readiness Verification
  const readiness = await validateDraftReadiness(env, draft, draftFiles)
  if (!readiness.isReady) {
    const errorMsg = readiness.issues.length > 0 ? readiness.issues.join(". ") : "El borrador no está listo para publicar."
    throw createGraphQLError(`No se puede publicar la actualización: ${errorMsg}`, "VALIDATION_ERROR")
  }

  // 4. Check for existing version collision
  const existingVersion = await db
    .select()
    .from(schema.gameReleases)
    .where(and(eq(schema.gameReleases.version, version), sql`${schema.gameReleases.id} != ${draft.id}`))
    .get()

  if (existingVersion) {
    throw createGraphQLError(`La versión ${version} ya existe en el historial.`, "CONFLICT")
  }

  const now = new Date().toISOString()

  // 5. ATOMIC PUBLICATION:
  // Execute both queries atomically in a single D1 batch
  if (typeof (db as any).batch === "function") {
    await (db as any).batch([
      db
        .update(schema.gameReleases)
        .set({
          status: "ARCHIVED",
          updatedAt: now,
        })
        .where(eq(schema.gameReleases.status, "PUBLISHED")),
      db
        .update(schema.gameReleases)
        .set({
          version,
          status: "PUBLISHED",
          notes: input.notes?.trim() || null,
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.gameReleases.id, draft.id)),
    ])
  } else {
    // Fallback for test environments without batch support
    await db
      .update(schema.gameReleases)
      .set({
        status: "ARCHIVED",
        updatedAt: now,
      })
      .where(eq(schema.gameReleases.status, "PUBLISHED"))

    await db
      .update(schema.gameReleases)
      .set({
        version,
        status: "PUBLISHED",
        notes: input.notes?.trim() || null,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.gameReleases.id, draft.id))
  }


  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.id, draft.id))
    .get()

  if (!published) {
    throw createGraphQLError("Error al publicar la actualización.", "INTERNAL_ERROR")
  }

  return formatGameRelease(published, draftFiles)
}
