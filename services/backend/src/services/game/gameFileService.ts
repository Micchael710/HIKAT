import { eq, and, sql, inArray } from "drizzle-orm"
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
  MAX_GAME_FILE_SIZE_BYTES,
  MAX_GAME_TEXT_FILE_SIZE_BYTES,
  sanitizeGameFileName,
  sanitizeGamePath,
  inferGameCategory,
  isUtf8TextBuffer,
  validateJsonContent,
  validateGameTreeInvariants,
  KNOWN_BINARY_EXTENSIONS,
  type GameFileCategory,
} from "@hikat/shared"
import type { Env } from "../../types"
import {
  prepareGameDraft,
  formatAdminGameFile,
  resolveReleaseEffectivePolicies,
} from "./releaseService"

/**
 * Safely deletes an R2 object if and only if NO record in game_release_files references it.
 * This guarantees published and shared objects are never accidentally removed,
 * while draft-exclusive orphans and unassociated uploads are cleanly purged.
 */
export async function deleteR2ObjectIfUnreferenced(
  env: Env,
  db: Database,
  objectKey: string,
): Promise<void> {
  if (!objectKey || !env.ASSETS) return
  try {
    const refs = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.objectKey, objectKey))
      .get()

    if (!refs || Number(refs.count) === 0) {
      await env.ASSETS.delete(objectKey)
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Formats a file record with effective policy resolved from the complete release tree.
 */
async function formatAdminFileWithTree(
  db: Database,
  releaseId: string,
  fileRecord: schema.GameReleaseFile,
): Promise<AdminGameFileGql> {
  const allFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, releaseId))
    .all()

  const effectiveMap = resolveReleaseEffectivePolicies(allFiles)
  const effective = effectiveMap.get(fileRecord.id) || "NO_MODIFICABLE"
  return formatAdminGameFile(fileRecord, effective)
}

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
  const tokenHex = tokenString.map((b) => b.toString(16).padStart(2, "0")).join("")

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
    uploadToken: tokenHex,
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
  let objectKeyToCompensate: string | undefined
  let tokenHashToInvalidate: string | undefined

  try {
    let sha256: string
    let sizeBytes: number
    let objectKey: string
    let originalFilename: string
    let category: GameFileCategory = (input.category as GameFileCategory) || "GENERAL"

    // 1. Early token / metadata lookup
    if (uploadedMetadata) {
      sha256 = uploadedMetadata.sha256
      sizeBytes = uploadedMetadata.sizeBytes
      objectKey = uploadedMetadata.objectKey
      originalFilename = uploadedMetadata.originalFilename
      objectKeyToCompensate = objectKey
    } else {
      if (!input.tokenHash) {
        throw createGraphQLError("Token de subida requerido.", "VALIDATION_ERROR")
      }

      const tokenRecord = await db
        .select()
        .from(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash))
        .get()

      if (!tokenRecord || !tokenRecord.usedAt || !tokenRecord.objectKey || !tokenRecord.sha256) {
        throw createGraphQLError(
          "El archivo aún no se ha subido o el token es inválido.",
          "VALIDATION_ERROR",
        )
      }

      sha256 = tokenRecord.sha256
      sizeBytes = tokenRecord.uploadedSizeBytes || tokenRecord.expectedSizeBytes
      objectKey = tokenRecord.objectKey
      originalFilename = tokenRecord.originalFilename
      objectKeyToCompensate = objectKey
      tokenHashToInvalidate = input.tokenHash

      if (!input.category && tokenRecord.category) {
        category = tokenRecord.category as GameFileCategory
      }
    }

    const name = String(input.name || "").trim()
    if (!name) {
      throw createGraphQLError("El nombre del archivo o mod es obligatorio.", "VALIDATION_ERROR")
    }

    // 2. Ensure active DRAFT release
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

    // Determine default folder prefix if only a filename was provided without subdirectories
    const defaultDir =
      category === "CONFIG"
        ? "config"
        : category === "RESOURCE_PACK"
        ? "resourcepacks"
        : category === "SHADER_PACK"
        ? "shaderpacks"
        : category === "KUBEJS"
        ? "kubejs"
        : category === "SCRIPT"
        ? "scripts"
        : category === "MOD"
        ? "mods"
        : ""

    const logicalPath = input.logicalPath
      ? sanitizeGamePath(input.logicalPath)
      : originalFilename && originalFilename.includes("/")
      ? sanitizeGamePath(originalFilename)
      : originalFilename
      ? sanitizeGamePath(defaultDir ? `${defaultDir}/${sanitizeGameFileName(originalFilename)}` : sanitizeGameFileName(originalFilename))
      : sanitizeGamePath(defaultDir ? `${defaultDir}/${sanitizeGameFileName(name)}` : sanitizeGameFileName(name))

    if (!input.category) {
      category = inferGameCategory(logicalPath)
    }

    const explicitPolicy = input.explicitPolicy || null

    // Fetch all existing files in draft for tree invariant validation
    const draftFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    // Validate tree invariants
    const treeCheck = validateGameTreeInvariants(
      draftFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
      [{ logicalPath, isDirectory: false }],
      {
        ignoredExistingPaths: new Set([logicalPath]),
      },
    )

    if (!treeCheck.valid) {
      throw createGraphQLError(treeCheck.error || "Estructura de árbol de archivos inválida.", "VALIDATION_ERROR")
    }

    const existing = draftFiles.find((f) => f.logicalPath === logicalPath)
    const oldObjectKey = existing?.objectKey
    const now = new Date().toISOString()

    let record: schema.GameReleaseFile

    if (existing) {
      if (existing.isDirectory) {
        throw createGraphQLError("No se puede sobrescribir una carpeta existente con un archivo.", "VALIDATION_ERROR")
      }

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
        .where(eq(schema.gameReleaseFiles.id, existing.id))

      record = (await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(eq(schema.gameReleaseFiles.id, existing.id))
        .get())!

      if (oldObjectKey && oldObjectKey !== objectKey) {
        await deleteR2ObjectIfUnreferenced(env, db, oldObjectKey)
      }
    } else {
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
      record = newFile
    }

    // Permanently consume token on successful attach
    if (input.tokenHash) {
      await db
        .delete(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash))
        .catch(() => {})
    }

    return formatAdminFileWithTree(db, draft.id, record)
  } catch (err) {
    if (env && objectKeyToCompensate) {
      await deleteR2ObjectIfUnreferenced(env, db, objectKeyToCompensate)
    }
    if (tokenHashToInvalidate) {
      await db
        .delete(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHashToInvalidate))
        .catch(() => {})
    }
    throw err
  }
}

export async function updateGameFile(
  db: Database,
  id: string,
  input: UpdateGameFileInputGql,
  env?: Env,
): Promise<AdminGameFileGql> {
  let objectKeyToCompensate: string | undefined
  let tokenHashToInvalidate: string | undefined

  try {
    let tokenUpdates: Partial<schema.GameReleaseFile> = {}

    // Early token lookup
    if (input.tokenHash) {
      const tokenRecord = await db
        .select()
        .from(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash))
        .get()

      if (!tokenRecord || !tokenRecord.usedAt || !tokenRecord.objectKey || !tokenRecord.sha256) {
        throw createGraphQLError("Token de subida inválido o no completado.", "VALIDATION_ERROR")
      }

      objectKeyToCompensate = tokenRecord.objectKey
      tokenHashToInvalidate = input.tokenHash
      tokenUpdates = {
        sha256: tokenRecord.sha256,
        sizeBytes: tokenRecord.uploadedSizeBytes || tokenRecord.expectedSizeBytes,
        objectKey: tokenRecord.objectKey,
      }
    }

    const existing = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, id))
      .get()

    if (!existing) {
      throw createGraphQLError("Archivo de juego no encontrado.", "NOT_FOUND")
    }

    const oldObjectKey = existing.objectKey

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

    const updates: Partial<schema.GameReleaseFile> = { ...tokenUpdates }
    if (input.name !== undefined && input.name !== null) {
      const trimmed = String(input.name || "").trim()
      if (!trimmed) {
        throw createGraphQLError("El nombre no puede estar vacío.", "VALIDATION_ERROR")
      }
      updates.name = trimmed
    }

    if (input.logicalPath !== undefined && input.logicalPath !== null) {
      const newPath = sanitizeGamePath(input.logicalPath)
      if (newPath !== existing.logicalPath) {
        const draftFiles = await db
          .select()
          .from(schema.gameReleaseFiles)
          .where(eq(schema.gameReleaseFiles.releaseId, release.id))
          .all()

        const treeCheck = validateGameTreeInvariants(
          draftFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
          [{ logicalPath: newPath, isDirectory: Boolean(existing.isDirectory) }],
          { ignoredExistingPaths: new Set([existing.logicalPath]) },
        )
        if (!treeCheck.valid) {
          throw createGraphQLError(treeCheck.error || "Estructura de árbol inválida.", "VALIDATION_ERROR")
        }
        updates.logicalPath = newPath
      }
    }

    if (input.category !== undefined && input.category !== null) {
      updates.category = input.category
    }

    if (input.explicitPolicy !== undefined) {
      updates.policy = input.explicitPolicy
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.gameReleaseFiles)
        .set(updates)
        .where(eq(schema.gameReleaseFiles.id, id))
    }

    if (env && oldObjectKey && updates.objectKey && oldObjectKey !== updates.objectKey) {
      await deleteR2ObjectIfUnreferenced(env, db, oldObjectKey)
    }

    // Permanently consume token on successful attach
    if (input.tokenHash) {
      await db
        .delete(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash))
        .catch(() => {})
    }

    const updated = (await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.id, id))
      .get())!

    return formatAdminFileWithTree(db, release.id, updated)
  } catch (err) {
    if (env && objectKeyToCompensate) {
      await deleteR2ObjectIfUnreferenced(env, db, objectKeyToCompensate)
    }
    if (tokenHashToInvalidate) {
      await db
        .delete(schema.gameFileUploadTokens)
        .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHashToInvalidate))
        .catch(() => {})
    }
    throw err
  }
}

export async function saveGameFileContent(
  db: Database,
  input: SaveGameFileContentInputGql,
  userId: string,
  env: Env,
): Promise<AdminGameFileGql> {
  const logicalPath = sanitizeGamePath(input.logicalPath)
  const filename = logicalPath.split("/").pop() || "file.txt"

  // 1. Authoritative Backend Binary Rejection (known binaries are strictly forbidden)
  const lowerPath = logicalPath.toLowerCase()
  if (KNOWN_BINARY_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    throw createGraphQLError(
      "No se puede crear ni guardar contenido de texto en un archivo con formato binario (.jar, .zip, imágenes, audio, etc.).",
      "VALIDATION_ERROR",
    )
  }

  // 2. Validate text size and UTF-8 buffer
  const textEncoder = new TextEncoder()
  const utf8Bytes = textEncoder.encode(input.content)

  if (utf8Bytes.byteLength > MAX_GAME_TEXT_FILE_SIZE_BYTES) {
    throw createGraphQLError(
      "El archivo de texto excede el límite máximo de edición (1 MB).",
      "VALIDATION_ERROR",
    )
  }

  if (!isUtf8TextBuffer(utf8Bytes)) {
    throw createGraphQLError(
      "El contenido contiene caracteres nulos o binarios no permitidos para un archivo de texto.",
      "VALIDATION_ERROR",
    )
  }

  if (filename.toLowerCase().endsWith(".json")) {
    const jsonCheck = validateJsonContent(input.content)
    if (!jsonCheck.valid) {
      throw createGraphQLError(jsonCheck.error || "Error de sintaxis JSON.", "VALIDATION_ERROR")
    }
  }

  // 3. Ensure active draft
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

  // 4. Validate tree invariants against existing files in draft
  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  const existing = draftFiles.find((f) => f.logicalPath === logicalPath)
  if (existing?.isDirectory) {
    throw createGraphQLError(
      "No se puede guardar un archivo de texto sobre una carpeta existente.",
      "VALIDATION_ERROR",
    )
  }

  // Reject if attempting to overwrite an existing binary file
  if (existing && KNOWN_BINARY_EXTENSIONS.some((ext) => existing.name.toLowerCase().endsWith(ext))) {
    throw createGraphQLError(
      "No se puede sobrescribir un archivo binario existente mediante el editor de texto.",
      "VALIDATION_ERROR",
    )
  }

  const treeCheck = validateGameTreeInvariants(
    draftFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
    [{ logicalPath, isDirectory: false }],
    { ignoredExistingPaths: new Set([logicalPath]) },
  )

  if (!treeCheck.valid) {
    throw createGraphQLError(treeCheck.error || "Estructura de árbol inválida.", "VALIDATION_ERROR")
  }

  // 5. Compute SHA-256
  const shaBuffer = await crypto.subtle.digest("SHA-256", utf8Bytes)
  const sha256 = Array.from(new Uint8Array(shaBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase()

  const fileId = crypto.randomUUID()
  const objectKey = `game-files/${fileId}-${sha256.slice(0, 16)}`
  const oldObjectKey = existing?.objectKey

  // 6. Save to R2
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

  const category = inferGameCategory(logicalPath)
  const now = new Date().toISOString()
  let savedRecord: schema.GameReleaseFile

  try {
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

      savedRecord = (await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(eq(schema.gameReleaseFiles.id, existing.id))
        .get())!
    } else {
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
      savedRecord = newRecord
    }
  } catch (err) {
    // If D1 fails after R2 write, compensate by removing the new R2 object
    if (env.ASSETS) {
      await env.ASSETS.delete(objectKey).catch(() => {})
    }
    throw err
  }

  // Cleanup old object if replaced and unreferenced
  if (oldObjectKey && oldObjectKey !== objectKey) {
    await deleteR2ObjectIfUnreferenced(env, db, oldObjectKey)
  }

  return formatAdminFileWithTree(db, draft.id, savedRecord)
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

  const lowerName = record.name.toLowerCase()
  if (KNOWN_BINARY_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    throw createGraphQLError("No se puede abrir un archivo binario en el editor de texto.", "VALIDATION_ERROR")
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

  if (!isUtf8TextBuffer(bytes)) {
    throw createGraphQLError("El archivo seleccionado contiene datos binarios no editables.", "VALIDATION_ERROR")
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

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  const existing = draftFiles.find((f) => f.logicalPath === logicalPath)
  if (existing) {
    if (!existing.isDirectory) {
      throw createGraphQLError("No se puede crear una carpeta donde ya existe un archivo.", "VALIDATION_ERROR")
    }
    return formatAdminFileWithTree(db, draft.id, existing)
  }

  // Validate tree invariants
  const treeCheck = validateGameTreeInvariants(
    draftFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
    [{ logicalPath, isDirectory: true }],
  )

  if (!treeCheck.valid) {
    throw createGraphQLError(treeCheck.error || "Estructura de árbol inválida.", "VALIDATION_ERROR")
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
  return formatAdminFileWithTree(db, draft.id, newFolder)
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

  if (newPath.startsWith(`${oldPath}/`)) {
    throw createGraphQLError(
      "No se puede mover o renombrar una carpeta dentro de sí misma o de sus descendientes.",
      "VALIDATION_ERROR",
    )
  }

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

  const matchingRecords = draftFiles.filter(
    (f) => f.logicalPath === oldPath || f.logicalPath.startsWith(`${oldPath}/`),
  )

  if (matchingRecords.length === 0) {
    throw createGraphQLError(`Elemento no encontrado en el borrador: ${oldPath}`, "NOT_FOUND")
  }

  // Preflight all target paths
  const oldPathSet = new Set(matchingRecords.map((r) => r.logicalPath))
  const remainingFiles = draftFiles.filter((f) => !oldPathSet.has(f.logicalPath))

  const proposedItems: Array<{ id: string; oldPath: string; newPath: string; name: string; isDirectory: boolean }> = []

  for (const f of matchingRecords) {
    let targetPath: string
    let newName: string
    if (f.logicalPath === oldPath) {
      targetPath = newPath
      newName = newPath.split("/").pop() || f.name
    } else {
      const childSub = f.logicalPath.slice(oldPath.length)
      targetPath = `${newPath}${childSub}`
      newName = f.name
    }

    // Check collision against remaining items
    if (remainingFiles.some((r) => r.logicalPath === targetPath)) {
      throw createGraphQLError(
        `Ya existe un elemento en la ruta de destino: "${targetPath}".`,
        "VALIDATION_ERROR",
      )
    }

    proposedItems.push({
      id: f.id,
      oldPath: f.logicalPath,
      newPath: targetPath,
      name: newName,
      isDirectory: Boolean(f.isDirectory),
    })
  }

  // Validate resulting tree invariants
  const treeCheck = validateGameTreeInvariants(
    remainingFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
    proposedItems.map((p) => ({ logicalPath: p.newPath, isDirectory: p.isDirectory })),
  )

  if (!treeCheck.valid) {
    throw createGraphQLError(treeCheck.error || "Estructura de árbol inválida.", "VALIDATION_ERROR")
  }

  // Execute atomic batch
  const statements = proposedItems.map((item) =>
    db
      .update(schema.gameReleaseFiles)
      .set({
        name: item.name,
        logicalPath: item.newPath,
        category: inferGameCategory(item.newPath),
      })
      .where(eq(schema.gameReleaseFiles.id, item.id)),
  )

  if (statements.length > 0) {
    await (db as any).batch(statements)
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

  if (sources.length === 0) return true

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

  // Preflight all sources
  const allMovedIds = new Set<string>()
  const plannedMoves: Array<{ id: string; oldPath: string; newPath: string; name: string; isDirectory: boolean }> = []

  for (const rawSrc of sources) {
    const cleanSrc = sanitizeGamePath(rawSrc)
    const baseName = cleanSrc.split("/").pop() || "file"
    const newRootPath = destFolder ? `${destFolder}/${baseName}` : baseName

    if (cleanSrc === newRootPath) continue

    // Cannot move a folder into itself or its descendants
    if (destFolder === cleanSrc || destFolder.startsWith(`${cleanSrc}/`)) {
      throw createGraphQLError(
        `No se puede mover la carpeta "${cleanSrc}" dentro de sí misma o de sus subcarpetas.`,
        "VALIDATION_ERROR",
      )
    }

    const matching = draftFiles.filter(
      (f) => f.logicalPath === cleanSrc || f.logicalPath.startsWith(`${cleanSrc}/`),
    )

    if (matching.length === 0) {
      throw createGraphQLError(`Elemento a mover no encontrado: ${cleanSrc}`, "NOT_FOUND")
    }

    for (const f of matching) {
      allMovedIds.add(f.id)
      let targetPath: string
      let newName: string
      if (f.logicalPath === cleanSrc) {
        targetPath = newRootPath
        newName = baseName
      } else {
        const sub = f.logicalPath.slice(cleanSrc.length)
        targetPath = `${newRootPath}${sub}`
        newName = f.name
      }

      plannedMoves.push({
        id: f.id,
        oldPath: f.logicalPath,
        newPath: targetPath,
        name: newName,
        isDirectory: Boolean(f.isDirectory),
      })
    }
  }

  // Check collisions among planned moves themselves
  const targetPathSet = new Set<string>()
  for (const m of plannedMoves) {
    if (targetPathSet.has(m.newPath)) {
      throw createGraphQLError(
        `Conflicto en la operación de movimiento: múltiples elementos intentan ocupar "${m.newPath}".`,
        "VALIDATION_ERROR",
      )
    }
    targetPathSet.add(m.newPath)
  }

  // Check collisions against unmoved files
  const unmovedFiles = draftFiles.filter((f) => !allMovedIds.has(f.id))
  for (const m of plannedMoves) {
    if (unmovedFiles.some((r) => r.logicalPath === m.newPath)) {
      throw createGraphQLError(
        `Ya existe un elemento en la ruta de destino: "${m.newPath}".`,
        "VALIDATION_ERROR",
      )
    }
  }

  // Validate resulting tree invariants
  const treeCheck = validateGameTreeInvariants(
    unmovedFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
    plannedMoves.map((p) => ({ logicalPath: p.newPath, isDirectory: p.isDirectory })),
  )

  if (!treeCheck.valid) {
    throw createGraphQLError(treeCheck.error || "Estructura de árbol inválida.", "VALIDATION_ERROR")
  }

  // Execute all updates atomically via D1 batch
  const statements = plannedMoves.map((move) =>
    db
      .update(schema.gameReleaseFiles)
      .set({
        name: move.name,
        logicalPath: move.newPath,
        category: inferGameCategory(move.newPath),
      })
      .where(eq(schema.gameReleaseFiles.id, move.id)),
  )

  if (statements.length > 0) {
    await (db as any).batch(statements)
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

  if (sources.length === 0) return true

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
  const plannedInserts: Array<typeof schema.gameReleaseFiles.$inferInsert> = []

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

    if (destFolder === cleanSrc || destFolder.startsWith(`${cleanSrc}/`)) {
      throw createGraphQLError(
        `No se puede copiar la carpeta "${cleanSrc}" dentro de sí misma o de sus subcarpetas.`,
        "VALIDATION_ERROR",
      )
    }

    const matching = draftFiles.filter(
      (f) => f.logicalPath === cleanSrc || f.logicalPath.startsWith(`${cleanSrc}/`),
    )

    if (matching.length === 0) {
      throw createGraphQLError(`Elemento a copiar no encontrado: ${cleanSrc}`, "NOT_FOUND")
    }

    for (const f of matching) {
      let targetPath: string
      let targetName: string
      if (f.logicalPath === cleanSrc) {
        targetPath = newRootPath
        targetName = newTargetBase
      } else {
        const childSub = f.logicalPath.slice(cleanSrc.length)
        targetPath = `${newRootPath}${childSub}`
        targetName = f.name
      }

      plannedInserts.push({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: targetName,
        logicalPath: targetPath,
        category: inferGameCategory(targetPath),
        sha256: f.sha256,
        sizeBytes: f.sizeBytes,
        policy: f.policy,
        isDirectory: f.isDirectory,
        objectKey: f.objectKey,
        createdAt: now,
      })
    }
  }

  // Check collision within planned inserts themselves (e.g. copying a/foo.txt and b/foo.txt into dest -> both target dest/foo.txt)
  const plannedTargetSet = new Set<string>()
  for (const item of plannedInserts) {
    if (plannedTargetSet.has(item.logicalPath)) {
      throw createGraphQLError(
        `Conflicto en la operación de copia: múltiples elementos intentan ocupar la misma ruta de destino "${item.logicalPath}".`,
        "VALIDATION_ERROR",
      )
    }
    plannedTargetSet.add(item.logicalPath)
  }

  // Check collision with existing files
  for (const item of plannedInserts) {
    if (draftFiles.some((f) => f.logicalPath === item.logicalPath)) {
      throw createGraphQLError(
        `Ya existe un elemento en la ruta de destino: "${item.logicalPath}".`,
        "VALIDATION_ERROR",
      )
    }
  }

  // Validate tree invariants
  const treeCheck = validateGameTreeInvariants(
    draftFiles.map((f) => ({ logicalPath: f.logicalPath, isDirectory: Boolean(f.isDirectory) })),
    plannedInserts.map((p) => ({ logicalPath: p.logicalPath, isDirectory: Boolean(p.isDirectory) })),
  )

  if (!treeCheck.valid) {
    throw createGraphQLError(treeCheck.error || "Estructura de árbol inválida.", "VALIDATION_ERROR")
  }

  // Execute inserts atomically via D1 batch
  const statements = plannedInserts.map((insertItem) =>
    db.insert(schema.gameReleaseFiles).values(insertItem),
  )

  if (statements.length > 0) {
    await (db as any).batch(statements)
  }

  return true
}

export async function deleteGamePaths(
  db: Database,
  paths: string[],
  userId: string,
  env?: Env,
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

  const filesToDelete: schema.GameReleaseFile[] = []

  for (const path of paths) {
    const cleanPath = sanitizeGamePath(path)
    for (const f of draftFiles) {
      if (f.logicalPath === cleanPath || f.logicalPath.startsWith(`${cleanPath}/`)) {
        filesToDelete.push(f)
      }
    }
  }

  if (filesToDelete.length === 0) {
    return true
  }

  const idsToDelete = filesToDelete.map((f) => f.id)
  await db
    .delete(schema.gameReleaseFiles)
    .where(inArray(schema.gameReleaseFiles.id, idsToDelete))

  // Clean up R2 objects if unreferenced across all releases
  if (env?.ASSETS) {
    for (const f of filesToDelete) {
      if (f.objectKey) {
        await deleteR2ObjectIfUnreferenced(env, db, f.objectKey)
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

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  const record = draftFiles.find((f) => f.logicalPath === cleanPath)
  const policyVal = explicitPolicy || null

  if (record) {
    await db
      .update(schema.gameReleaseFiles)
      .set({ policy: policyVal })
      .where(eq(schema.gameReleaseFiles.id, record.id))
    return true
  }

  // If path does not exist in draft, check if it was a file in published (tombstone)
  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "PUBLISHED"))
    .get()

  if (published) {
    const publishedFile = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(
        and(
          eq(schema.gameReleaseFiles.releaseId, published.id),
          eq(schema.gameReleaseFiles.logicalPath, cleanPath),
        ),
      )
      .get()

    if (publishedFile && !publishedFile.isDirectory) {
      throw createGraphQLError(
        "No se puede modificar la política de un archivo eliminado del borrador. Restáuralo primero.",
        "VALIDATION_ERROR",
      )
    }
  }

  // Check if any child item exists with prefix `cleanPath/`
  const hasChildren = draftFiles.some((f) => f.logicalPath.startsWith(`${cleanPath}/`))
  if (!hasChildren) {
    throw createGraphQLError(`Ruta no encontrada en el borrador: ${cleanPath}`, "NOT_FOUND")
  }

  // Create explicit directory record for the folder
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

  return true
}

export async function removeGameFile(
  db: Database,
  id: string,
  env?: Env,
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

  if (env && existing.objectKey) {
    await deleteR2ObjectIfUnreferenced(env, db, existing.objectKey)
  }

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

  const existingInDraft = draftFiles.find((f) => f.logicalPath === originalFile.logicalPath)
  if (existingInDraft) {
    return formatAdminFileWithTree(db, draft.id, existingInDraft)
  }

  const now = new Date().toISOString()
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
    createdAt: now,
  }

  await db.insert(schema.gameReleaseFiles).values(newFile)

  // If restoring a directory, also restore all published descendant files that are currently missing in the draft
  if (originalFile.isDirectory) {
    const publishedFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, originalFile.releaseId))
      .all()

    const prefix = `${originalFile.logicalPath}/`
    const draftPathSet = new Set(draftFiles.map((f) => f.logicalPath))
    draftPathSet.add(newFile.logicalPath)

    for (const pf of publishedFiles) {
      if (pf.logicalPath.startsWith(prefix) && !draftPathSet.has(pf.logicalPath)) {
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: pf.name,
          logicalPath: pf.logicalPath,
          category: pf.category,
          sha256: pf.sha256,
          sizeBytes: pf.sizeBytes,
          policy: pf.policy,
          isDirectory: pf.isDirectory,
          objectKey: pf.objectKey,
          createdAt: now,
        })
        draftPathSet.add(pf.logicalPath)
      }
    }
  }

  return formatAdminFileWithTree(db, draft.id, newFile)
}
