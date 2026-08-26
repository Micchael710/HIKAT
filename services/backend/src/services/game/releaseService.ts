import { eq, desc, and, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  PublishedModpackGql,
  ClientFileGql,
  GameReleaseGql,
  AdminGameOverviewGql,
  AdminGameFileGql,
  PublishGameReleaseInputGql,
  PrepareGameDraftInputGql,
} from "@hikat/graphql"
import { validateSemVer } from "@hikat/shared"
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
    createdAt: file.createdAt,
  }
}

export function formatGameRelease(
  release: schema.GameRelease,
  files: schema.GameReleaseFile[],
): GameReleaseGql {
  return {
    id: release.id,
    version: release.version,
    minecraftVersion: release.minecraftVersion,
    neoForgeVersion: release.neoForgeVersion,
    status: release.status as any,
    notes: release.notes,
    publishedAt: release.publishedAt,
    files: files.map(formatAdminGameFile),
    createdAt: release.createdAt,
    updatedAt: release.updatedAt,
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
  if (published) {
    const publishedFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, published.id))
      .all()
    publishedGql = formatGameRelease(published, publishedFiles)
  }

  let draftGql: GameReleaseGql | null = null
  let pendingChangesCount = 0

  if (draft) {
    const draftFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()
    draftGql = formatGameRelease(draft, draftFiles)
    pendingChangesCount = draftFiles.length
  }

  return {
    publishedRelease: publishedGql,
    draftRelease: draftGql,
    pendingChangesCount,
  }
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

  // 2. Check that draft has at least 1 file
  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  if (draftFiles.length === 0) {
    throw createGraphQLError("No puedes publicar una versión sin archivos o mods.", "VALIDATION_ERROR")
  }

  // 3. Check for existing version collision
  const existingVersion = await db
    .select()
    .from(schema.gameReleases)
    .where(and(eq(schema.gameReleases.version, version), sql`${schema.gameReleases.id} != ${draft.id}`))
    .get()

  if (existingVersion) {
    throw createGraphQLError(`La versión ${version} ya existe en el historial.`, "CONFLICT")
  }

  const now = new Date().toISOString()

  // 4. ATOMIC PUBLICATION:
  // Step A: Archive currently published release
  await db
    .update(schema.gameReleases)
    .set({
      status: "ARCHIVED",
      updatedAt: now,
    })
    .where(eq(schema.gameReleases.status, "PUBLISHED"))

  // Step B: Mark draft as PUBLISHED
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
