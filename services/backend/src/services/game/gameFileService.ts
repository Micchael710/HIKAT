import { eq, and, sql, like } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  AdminGameFileGql,
  GameFileCategoryGql,
  CreateGameFileUploadInputGql,
  AddGameFileInputGql,
  UpdateGameFileInputGql,
  SaveGameFileContentInputGql,
  GameFileUploadPayloadGql,
  SyncPolicyGql,
} from "@hikat/graphql"
import {
  ALLOWED_GAME_CATEGORIES,
  MAX_GAME_FILE_SIZE_BYTES,
  MAX_GAME_TEXT_FILE_SIZE_BYTES,
  GAME_CATEGORY_DEFAULT_POLICIES,
  GAME_CATEGORY_DIRECTORIES,
  sanitizeGameFileName,
  sanitizeGamePath,
  inferGameCategory,
  isEditableTextFile,
  validateJsonContent,
  type GameFileCategory,
  type SyncPolicy,
} from "@hikat/shared"
import type { Env } from "../../types"
import {
  prepareGameDraft,
  formatAdminGameFile,
  resolveReleaseEffectivePolicies,
} from "./releaseService"

export async function getAdminGameFiles(
  db: Database,
  releaseId?: string | null,
  category?: GameFileCategoryGql | null,
): Promise<AdminGameFileGql[]> {
  let targetReleaseId = releaseId

  if (!targetReleaseId) {
    // Prefer active draft; fallback to published
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

  const allRecords = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(and(...conditions))
    .all()

  const effectiveMap = resolveReleaseEffectivePolicies(allRecords)
  return allRecords.map((r) => formatAdminGameFile(r, effectiveMap.get(r.id)))
}

export async function createGameFileUploadToken(
  db: Database,
  input: CreateGameFileUploadInputGql,
  userId: string,
): Promise<GameFileUploadPayloadGql> {
  const safeFilename = sanitizeGameFileName(input.originalFilename)
  const category = (input.category || inferGameCategory(input.logicalPath || safeFilename)) as GameFileCategory

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
    originalFilename: input.logicalPath ? sanitizeGamePath(input.logicalPath) : safeFilename,
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
    expectedCategory: category as any,
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

  // 1. Ensure active DRAFT release
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
  const originalFilename = uploadedMetadata?.originalFilename || token?.originalFilename || name

  // Determine canonical logical path
  let logicalPath: string
  if (input.logicalPath) {
    logicalPath = sanitizeGamePath(input.logicalPath)
  } else if (originalFilename.includes("/")) {
    logicalPath = sanitizeGamePath(originalFilename)
  } else {
    const inferredCat = input.category || inferGameCategory(originalFilename)
    const safeBase = sanitizeGameFileName(originalFilename)
    const dir = GAME_CATEGORY_DIRECTORIES[inferredCat as GameFileCategory] || ""
    logicalPath = dir ? `${dir}/${safeBase}` : safeBase
  }

  const category = (input.category || inferGameCategory(logicalPath)) as GameFileCategory
  const explicitPolicy = input.explicitPolicy || null

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
    await db
      .update(schema.gameReleaseFiles)
      .set({
        name,
        category,
        sha256,
        sizeBytes,
        policy: explicitPolicy,
        isDirectory: 0,
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
    category,
    sha256,
    sizeBytes,
    policy: explicitPolicy,
    isDirectory: 0,
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

  const release = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.id, existing.releaseId))
    .get()

  if (!release || release.status !== "DRAFT") {
    throw createGraphQLError(
      "Solo puedes modificar archivos de una actualización en preparación.",
      "VALIDATION_ERROR",
    )
  }

  const updates: Partial<schema.GameReleaseFile> = {}
  if (input.name !== undefined && input.name !== null) {
    const trimmed = String(input.name || "").trim()
    if (!trimmed) {
      throw createGraphQLError("El nombre no puede estar vacío.", "VALIDATION_ERROR")
    }
    updates.name = trimmed
  }

  if (input.logicalPath !== undefined && input.logicalPath !== null) {
    updates.logicalPath = sanitizeGamePath(input.logicalPath)
  }

  if (input.category !== undefined && input.category !== null) {
    updates.category = input.category
  }

  if (input.explicitPolicy !== undefined) {
    updates.policy = input.explicitPolicy
  }

  if (input.tokenHash) {
    const tokenRecord = await db
      .select()
      .from(schema.gameFileUploadTokens)
      .where(eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash))
      .get()

    if (!tokenRecord || !tokenRecord.usedAt || !tokenRecord.objectKey || !tokenRecord.sha256) {
      throw createGraphQLError("Token de subida inválido o no completado.", "VALIDATION_ERROR")
    }

    updates.sha256 = tokenRecord.sha256
    updates.sizeBytes = tokenRecord.uploadedSizeBytes || tokenRecord.expectedSizeBytes
    updates.objectKey = tokenRecord.objectKey
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

export async function saveGameFileContent(
  db: Database,
  input: SaveGameFileContentInputGql,
  userId: string,
  env: Env,
): Promise<AdminGameFileGql> {
  const logicalPath = sanitizeGamePath(input.logicalPath)
  const filename = logicalPath.split("/").pop() || "file.txt"

  // 1. Ensure active draft
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

  // 2. Validate text size and JSON syntax if applicable
  const textEncoder = new TextEncoder()
  const utf8Bytes = textEncoder.encode(input.content)

  if (utf8Bytes.byteLength > MAX_GAME_TEXT_FILE_SIZE_BYTES) {
    throw createGraphQLError(
      "El archivo de texto excede el límite máximo de edición (1 MB).",
      "VALIDATION_ERROR",
    )
  }

  if (filename.toLowerCase().endsWith(".json")) {
    const jsonCheck = validateJsonContent(input.content)
    if (!jsonCheck.valid) {
      throw createGraphQLError(jsonCheck.error || "Error de sintaxis JSON.", "VALIDATION_ERROR")
    }
  }

  // 3. Compute SHA-256
  const shaBuffer = await crypto.subtle.digest("SHA-256", utf8Bytes)
  const sha256 = Array.from(new Uint8Array(shaBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase()

  // 4. Save to R2
  const fileId = crypto.randomUUID()
  const objectKey = `game-files/${fileId}-${sha256.slice(0, 16)}`

  if (env.ASSETS) {
    await env.ASSETS.put(objectKey, utf8Bytes, {
      httpMetadata: {
        contentType: filename.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
      },
      customMetadata: {
        sha256,
        logicalPath,
        filename,
      },
    })
  }

  // 5. Update or insert in active draft
  const existing = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(
      and(
        eq(schema.gameReleaseFiles.releaseId, draft.id),
        eq(schema.gameReleaseFiles.logicalPath, logicalPath),
      ),
    )
    .get()

  const category = inferGameCategory(logicalPath)
  const now = new Date().toISOString()

  if (existing) {
    const updatePayload: Partial<schema.GameReleaseFile> = {
      name: filename,
      category,
      sha256,
      sizeBytes: utf8Bytes.byteLength,
      objectKey,
      isDirectory: 0,
    }
    if (input.explicitPolicy !== undefined) {
      updatePayload.policy = input.explicitPolicy
    }

    await db
      .update(schema.gameReleaseFiles)
      .set(updatePayload)
      .where(eq(schema.gameReleaseFiles.id, existing.id))

    const updated = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, existing.id))
      .get()

    return formatAdminGameFile(updated!)
  }

  const newRecord = {
    id: fileId,
    releaseId: draft.id,
    name: filename,
    logicalPath,
    category,
    sha256,
    sizeBytes: utf8Bytes.byteLength,
    policy: input.explicitPolicy || null,
    isDirectory: 0,
    objectKey,
    createdAt: now,
  }

  await db.insert(schema.gameReleaseFiles).values(newRecord)
  return formatAdminGameFile(newRecord)
}

export async function readGameFileContent(
  db: Database,
  id: string,
  env: Env,
): Promise<string> {
  const record = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, id))
    .get()

  if (!record) {
    throw createGraphQLError("Archivo no encontrado.", "NOT_FOUND")
  }

  if (record.isDirectory) {
    throw createGraphQLError("No se puede leer el contenido de un directorio como texto.", "VALIDATION_ERROR")
  }

  if (record.sizeBytes > MAX_GAME_TEXT_FILE_SIZE_BYTES) {
    throw createGraphQLError("El archivo es demasiado grande para abrirse en el editor de texto (máx 1 MB).", "VALIDATION_ERROR")
  }

  if (!env.ASSETS) {
    return ""
  }

  const r2Object = await env.ASSETS.get(record.objectKey)
  if (!r2Object) {
    throw createGraphQLError("Objeto de archivo no encontrado en el almacenamiento.", "NOT_FOUND")
  }

  const arrayBuffer = await r2Object.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  if (!isEditableTextFile(record.name, bytes)) {
    throw createGraphQLError("El archivo seleccionado no es un archivo de texto editable.", "VALIDATION_ERROR")
  }

  const decoder = new TextDecoder("utf-8")
  return decoder.decode(bytes)
}

export async function createGameFolder(
  db: Database,
  rawLogicalPath: string,
  userId: string,
): Promise<AdminGameFileGql> {
  const logicalPath = sanitizeGamePath(rawLogicalPath)
  const name = logicalPath.split("/").pop() || "folder"

  // Ensure active draft
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

  const existing = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(
      and(
        eq(schema.gameReleaseFiles.releaseId, draft.id),
        eq(schema.gameReleaseFiles.logicalPath, logicalPath),
      ),
    )
    .get()

  if (existing) {
    return formatAdminGameFile(existing)
  }

  const folderId = crypto.randomUUID()
  const newFolder = {
    id: folderId,
    releaseId: draft.id,
    name,
    logicalPath,
    category: inferGameCategory(logicalPath),
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    sizeBytes: 0,
    policy: null,
    isDirectory: 1,
    objectKey: "",
    createdAt: new Date().toISOString(),
  }

  await db.insert(schema.gameReleaseFiles).values(newFolder)
  return formatAdminGameFile(newFolder)
}

export async function renameGamePath(
  db: Database,
  oldPathRaw: string,
  newPathRaw: string,
  userId: string,
): Promise<boolean> {
  const oldPath = sanitizeGamePath(oldPathRaw)
  const newPath = sanitizeGamePath(newPathRaw)

  if (oldPath === newPath) return true

  // Ensure active draft
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
    throw createGraphQLError("No hay borrador activo para renombrar.", "VALIDATION_ERROR")
  }

  // Fetch all draft files
  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  let affectedCount = 0
  for (const f of draftFiles) {
    if (f.logicalPath === oldPath) {
      const newName = newPath.split("/").pop() || f.name
      await db
        .update(schema.gameReleaseFiles)
        .set({
          name: newName,
          logicalPath: newPath,
          category: inferGameCategory(newPath),
        })
        .where(eq(schema.gameReleaseFiles.id, f.id))
      affectedCount++
    } else if (f.logicalPath.startsWith(`${oldPath}/`)) {
      const childSub = f.logicalPath.slice(oldPath.length)
      const updatedChildPath = `${newPath}${childSub}`
      await db
        .update(schema.gameReleaseFiles)
        .set({
          logicalPath: updatedChildPath,
          category: inferGameCategory(updatedChildPath),
        })
        .where(eq(schema.gameReleaseFiles.id, f.id))
      affectedCount++
    }
  }

  if (affectedCount === 0) {
    throw createGraphQLError(`Elemento no encontrado en el borrador: ${oldPath}`, "NOT_FOUND")
  }

  return true
}

export async function moveGamePaths(
  db: Database,
  sources: string[],
  destinationFolderRaw: string,
  userId: string,
): Promise<boolean> {
  const destFolder = destinationFolderRaw ? sanitizeGamePath(destinationFolderRaw) : ""

  for (const src of sources) {
    const cleanSrc = sanitizeGamePath(src)
    const baseName = cleanSrc.split("/").pop() || "file"
    const newLogicalPath = destFolder ? `${destFolder}/${baseName}` : baseName
    await renameGamePath(db, cleanSrc, newLogicalPath, userId)
  }

  return true
}

export async function copyGamePaths(
  db: Database,
  sources: string[],
  destinationFolderRaw: string,
  userId: string,
): Promise<boolean> {
  const destFolder = destinationFolderRaw ? sanitizeGamePath(destinationFolderRaw) : ""

  // Ensure active draft
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
    throw createGraphQLError("No hay borrador activo.", "INTERNAL_ERROR")
  }

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  const now = new Date().toISOString()

  for (const src of sources) {
    const cleanSrc = sanitizeGamePath(src)
    const baseName = cleanSrc.split("/").pop() || "file"
    
    // If copying into same parent folder, append -copia
    const parentFolder = cleanSrc.includes("/") ? cleanSrc.slice(0, cleanSrc.lastIndexOf("/")) : ""
    let newTargetBase: string
    if (parentFolder === destFolder) {
      if (baseName.includes(".")) {
        const parts = baseName.split(".")
        const ext = parts.pop()
        newTargetBase = `${parts.join(".")}-copia.${ext}`
      } else {
        newTargetBase = `${baseName}-copia`
      }
    } else {
      newTargetBase = baseName
    }

    const newRootPath = destFolder ? `${destFolder}/${newTargetBase}` : newTargetBase

    for (const f of draftFiles) {
      if (f.logicalPath === cleanSrc) {
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: newTargetBase,
          logicalPath: newRootPath,
          category: inferGameCategory(newRootPath),
          sha256: f.sha256,
          sizeBytes: f.sizeBytes,
          policy: f.policy,
          isDirectory: f.isDirectory,
          objectKey: f.objectKey,
          createdAt: now,
        })
      } else if (f.logicalPath.startsWith(`${cleanSrc}/`)) {
        const childSub = f.logicalPath.slice(cleanSrc.length)
        const updatedChildPath = `${newRootPath}${childSub}`
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: f.name,
          logicalPath: updatedChildPath,
          category: inferGameCategory(updatedChildPath),
          sha256: f.sha256,
          sizeBytes: f.sizeBytes,
          policy: f.policy,
          isDirectory: f.isDirectory,
          objectKey: f.objectKey,
          createdAt: now,
        })
      }
    }
  }

  return true
}

export async function deleteGamePaths(
  db: Database,
  paths: string[],
  userId: string,
): Promise<boolean> {
  // Ensure active draft
  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) {
    throw createGraphQLError(
      "Solo puedes eliminar elementos de una actualización en preparación.",
      "VALIDATION_ERROR",
    )
  }

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  for (const path of paths) {
    const cleanPath = sanitizeGamePath(path)
    for (const f of draftFiles) {
      if (f.logicalPath === cleanPath || f.logicalPath.startsWith(`${cleanPath}/`)) {
        await db
          .delete(schema.gameReleaseFiles)
          .where(eq(schema.gameReleaseFiles.id, f.id))
      }
    }
  }

  return true
}

export async function setGamePathPolicy(
  db: Database,
  pathRaw: string,
  explicitPolicy: SyncPolicyGql | null | undefined,
  userId: string,
): Promise<boolean> {
  const cleanPath = sanitizeGamePath(pathRaw)

  // Ensure active draft
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
    throw createGraphQLError("No hay borrador activo.", "INTERNAL_ERROR")
  }

  const record = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(
      and(
        eq(schema.gameReleaseFiles.releaseId, draft.id),
        eq(schema.gameReleaseFiles.logicalPath, cleanPath),
      ),
    )
    .get()

  const policyVal = explicitPolicy || null

  if (record) {
    await db
      .update(schema.gameReleaseFiles)
      .set({ policy: policyVal })
      .where(eq(schema.gameReleaseFiles.id, record.id))
  } else {
    // Implicit directory node: create explicit directory entry with this policy
    const folderId = crypto.randomUUID()
    await db.insert(schema.gameReleaseFiles).values({
      id: folderId,
      releaseId: draft.id,
      name: cleanPath.split("/").pop() || "folder",
      logicalPath: cleanPath,
      category: inferGameCategory(cleanPath),
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      sizeBytes: 0,
      policy: policyVal,
      isDirectory: 1,
      objectKey: "",
      createdAt: new Date().toISOString(),
    })
  }

  return true
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

  const release = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.id, existing.releaseId))
    .get()

  if (!release || release.status !== "DRAFT") {
    throw createGraphQLError(
      "Solo puedes modificar archivos de una actualización en preparación.",
      "VALIDATION_ERROR",
    )
  }

  await db
    .delete(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, id))

  return true
}

export async function restoreGameFile(
  db: Database,
  rawId: string,
  userId: string,
): Promise<AdminGameFileGql> {
  const fileId = rawId.replace(/^tombstone-/, "")

  const originalFile = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.id, fileId))
    .get()

  if (!originalFile) {
    throw createGraphQLError("Archivo de juego original no encontrado.", "NOT_FOUND")
  }

  const draft = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  if (!draft) {
    throw createGraphQLError(
      "Solo puedes restaurar archivos en una actualización en preparación.",
      "VALIDATION_ERROR",
    )
  }

  const existingInDraft = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(
      and(
        eq(schema.gameReleaseFiles.releaseId, draft.id),
        eq(schema.gameReleaseFiles.logicalPath, originalFile.logicalPath),
      ),
    )
    .get()

  if (existingInDraft) {
    return formatAdminGameFile(existingInDraft)
  }

  const newFileId = crypto.randomUUID()
  const newFile = {
    id: newFileId,
    releaseId: draft.id,
    name: originalFile.name,
    logicalPath: originalFile.logicalPath,
    category: originalFile.category,
    sha256: originalFile.sha256,
    sizeBytes: originalFile.sizeBytes,
    policy: originalFile.policy,
    isDirectory: originalFile.isDirectory,
    objectKey: originalFile.objectKey,
    createdAt: new Date().toISOString(),
  }

  await db.insert(schema.gameReleaseFiles).values(newFile)
  return formatAdminGameFile(newFile)
}


