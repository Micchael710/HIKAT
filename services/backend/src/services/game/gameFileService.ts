import { eq, and, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  AdminGameFileGql,
  GameFileCategoryGql,
  CreateGameFileUploadInputGql,
  AddGameFileInputGql,
  UpdateGameFileInputGql,
  GameFileUploadPayloadGql,
} from "@hikat/graphql"
import {
  ALLOWED_GAME_CATEGORIES,
  MAX_GAME_FILE_SIZE_BYTES,
  GAME_CATEGORY_DEFAULT_POLICIES,
  sanitizeGameFileName,
  resolveGameLogicalPath,
  type GameFileCategory,
} from "@hikat/shared"
import type { Env } from "../../types"
import { prepareGameDraft, formatAdminGameFile } from "./releaseService"

export async function getAdminGameFiles(
  db: Database,
  releaseId?: string | null,
  category?: GameFileCategoryGql | null,
): Promise<AdminGameFileGql[]> {
  let targetReleaseId = releaseId

  if (!targetReleaseId) {
    // If no releaseId is specified, prefer active draft; fallback to published
    const draft = await db
      .select({ id: schema.gameReleases.id })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
      .get()

    if (draft) {
      targetReleaseId = draft.id
    } else {
      const published = await db
        .select({ id: schema.gameReleases.id })
        .from(schema.gameReleases)
        .where(eq(schema.gameReleases.status, "PUBLISHED"))
        .get()
      if (published) {
        targetReleaseId = published.id
      }
    }
  }

  if (!targetReleaseId) return []

  const conditions = [eq(schema.gameReleaseFiles.releaseId, targetReleaseId)]
  if (category) {
    conditions.push(eq(schema.gameReleaseFiles.category, category))
  }

  const files = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(and(...conditions))
    .all()

  return files.map(formatAdminGameFile)
}

export async function createGameFileUploadToken(
  db: Database,
  input: CreateGameFileUploadInputGql,
  userId: string,
): Promise<GameFileUploadPayloadGql> {
  const category = input.category || "MOD"
  if (!ALLOWED_GAME_CATEGORIES.includes(category as GameFileCategory)) {
    throw createGraphQLError("Categoría de archivo no permitida.", "VALIDATION_ERROR")
  }

  const safeName = sanitizeGameFileName(input.originalFilename)
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_GAME_FILE_SIZE_BYTES) {
    throw createGraphQLError(
      "El tamaño del archivo excede el límite permitido (100 MB).",
      "VALIDATION_ERROR",
    )
  }

  const tokenId = crypto.randomUUID()
  const rawTokenBytes = new Uint8Array(32)
  crypto.getRandomValues(rawTokenBytes)
  const tokenString = Array.from(rawTokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const hashBuffer = await crypto.subtle.digest("SHA-256", rawTokenBytes)
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString() // 15 min TTL

  await db.insert(schema.gameFileUploadTokens).values({
    id: tokenId,
    tokenHash,
    category,
    originalFilename: safeName,
    expectedSizeBytes: input.sizeBytes,
    createdBy: userId,
    expiresAt,
    createdAt: now.toISOString(),
  })

  return {
    uploadUrl: "/game/files/upload",
    uploadToken: tokenString,
    expiresAt,
    maxSizeBytes: MAX_GAME_FILE_SIZE_BYTES,
    expectedCategory: category,
  }
}

export async function addGameFile(
  db: Database,
  input: AddGameFileInputGql,
  userId: string,
  env: Env,
  uploadedMetadata?: {
    sha256: string
    sizeBytes: number
    objectKey: string
    originalFilename: string
  },
): Promise<AdminGameFileGql> {
  const name = String(input.name || "").trim()
  if (!name) {
    throw createGraphQLError("El nombre del archivo o mod es obligatorio.", "VALIDATION_ERROR")
  }

  // 1. Ensure we have an active DRAFT release (creates one cloned from published if needed)
  let draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) {
    await prepareGameDraft(db, userId)
    draft = await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
      .get()
  }

  if (!draft) {
    throw createGraphQLError("No se pudo inicializar el borrador de actualización.", "INTERNAL_ERROR")
  }

  const category = (input.category || "MOD") as GameFileCategory
  const categoryDir = ALLOWED_GAME_CATEGORIES.includes(category) ? category : "MOD"

  // 2. Validate token or supplied uploaded metadata
  const token = await db
    .select()
    .from(schema.gameFileUploadTokens)
    .where(eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash))
    .get()

  if (!token && !uploadedMetadata) {
    throw createGraphQLError("El token de subida no es válido o ya fue utilizado.", "VALIDATION_ERROR")
  }

  const sha256 = uploadedMetadata?.sha256 || token?.sha256 || ""
  const sizeBytes = uploadedMetadata?.sizeBytes || token?.uploadedSizeBytes || token?.expectedSizeBytes || 0
  const objectKey = uploadedMetadata?.objectKey || token?.objectKey || `game-files/${crypto.randomUUID()}`
  const originalFilename = uploadedMetadata?.originalFilename || token?.originalFilename || "mod.jar"


  const safeFilename = sanitizeGameFileName(originalFilename)
  const logicalPath = resolveGameLogicalPath(categoryDir, safeFilename)
  const policy = GAME_CATEGORY_DEFAULT_POLICIES[categoryDir] || "NO_MODIFICABLE"

  // 3. Prevent duplicate path collisions within the draft
  const existingPath = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(
      and(
        eq(schema.gameReleaseFiles.releaseId, draft.id),
        eq(schema.gameReleaseFiles.logicalPath, logicalPath),
      ),
    )
    .get()

  const now = new Date().toISOString()

  if (existingPath) {
    // If updating existing file in draft, update its immutable object reference & metadata
    await db
      .update(schema.gameReleaseFiles)
      .set({
        name,
        category: categoryDir,
        sha256,
        sizeBytes,
        policy,
        objectKey,
      })
      .where(eq(schema.gameReleaseFiles.id, existingPath.id))

    const updated = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, existingPath.id))
      .get()

    return formatAdminGameFile(updated!)
  }

  // 4. Insert new file in active draft
  const fileId = crypto.randomUUID()
  const newFile = {
    id: fileId,
    releaseId: draft.id,
    name,
    logicalPath,
    category: categoryDir,
    sha256,
    sizeBytes,
    policy,
    objectKey,
    createdAt: now,
  }

  await db.insert(schema.gameReleaseFiles).values(newFile)

  return formatAdminGameFile(newFile)
}

export async function updateGameFile(
  db: Database,
  id: string,
  input: UpdateGameFileInputGql,
): Promise<AdminGameFileGql> {
  const existing = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Archivo de juego no encontrado.", "NOT_FOUND")
  }

  const updates: Partial<schema.GameReleaseFile> = {}
  if (input.name !== undefined) {
    const trimmed = String(input.name || "").trim()
    if (!trimmed) {
      throw createGraphQLError("El nombre no puede estar vacío.", "VALIDATION_ERROR")
    }
    updates.name = trimmed
  }

  if (input.category !== undefined && input.category !== null) {
    if (ALLOWED_GAME_CATEGORIES.includes(input.category as GameFileCategory)) {
      updates.category = input.category
      updates.logicalPath = resolveGameLogicalPath(
        input.category as GameFileCategory,
        existing.logicalPath.split("/").pop() || "file.jar",
      )
    }
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.gameReleaseFiles)
      .set(updates)
      .where(eq(schema.gameReleaseFiles.id, id))
  }

  const updated = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, id))
    .get()

  return formatAdminGameFile(updated!)
}

export async function removeGameFile(
  db: Database,
  id: string,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, id))
    .get()

  if (!existing) {
    throw createGraphQLError("Archivo de juego no encontrado.", "NOT_FOUND")
  }

  // Delete from active draft only (underlying R2 object is kept intact for history / published releases)
  await db
    .delete(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, id))

  return true
}
