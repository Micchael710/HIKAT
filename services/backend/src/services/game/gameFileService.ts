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
  CompleteGameFileUploadInputGql,
  GameFileUploadCompletePayloadGql,
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
  validateGameFileHeader,
  KNOWN_BINARY_EXTENSIONS,
  type GameFileCategory,
} from "@hikat/shared"
import type { Env } from "../../types"
import {
  prepareGameDraft,
  formatAdminGameFile,
  resolveReleaseEffectivePolicies,
} from "./releaseService"

type BatchStatements = Parameters<Database["batch"]>[0]
type BatchStatement = BatchStatements[number]

function asBatchTuple(statements: BatchStatement[]): BatchStatements {
  if (statements.length === 0) {
    throw new Error("Batch statements cannot be empty.")
  }
  return [statements[0], ...statements.slice(1)] as unknown as BatchStatements
}

/**
 * Safely deletes multiple R2 objects in batches if and only if NO record in game_release_files references them.
 * Published and shared objects are preserved across releases, while orphaned objects are removed in bulk.
 */
export async function deleteR2ObjectsIfUnreferenced(
  env: Env,
  db: Database,
  objectKeys: string[],
): Promise<void> {
  if (!objectKeys || objectKeys.length === 0 || !env.ASSETS) return

  const uniqueKeys = Array.from(new Set(objectKeys.filter((k): k is string => Boolean(k))))
  if (uniqueKeys.length === 0) return

  try {
    const stillReferencedKeys = new Set<string>()
    const CHUNK_SIZE = 80

    for (let i = 0; i < uniqueKeys.length; i += CHUNK_SIZE) {
      const keyChunk = uniqueKeys.slice(i, i + CHUNK_SIZE)
      const referencedRows = await db
        .select({ objectKey: schema.gameReleaseFiles.objectKey })
        .from(schema.gameReleaseFiles)
        .where(inArray(schema.gameReleaseFiles.objectKey, keyChunk))
        .all()

      for (const row of referencedRows) {
        if (row.objectKey) {
          stillReferencedKeys.add(row.objectKey)
        }
      }
    }

    const orphanKeys = uniqueKeys.filter((k) => !stillReferencedKeys.has(k))

    if (orphanKeys.length > 0) {
      const R2_CHUNK_SIZE = 500
      for (let i = 0; i < orphanKeys.length; i += R2_CHUNK_SIZE) {
        const r2Batch = orphanKeys.slice(i, i + R2_CHUNK_SIZE)
        await env.ASSETS.delete(r2Batch)
      }
    }
  } catch {
    // Ignore cleanup errors fail-safe
  }
}

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
  await deleteR2ObjectsIfUnreferenced(env, db, [objectKey])
}

/**
 * Sanitizes and normalizes an array of game paths, removing duplicates and redundant subpaths.
 * For example, if both "jdk-21" and "jdk-21/bin" are requested, only "jdk-21" is retained.
 */
export function normalizeDeletePaths(rawPaths: string[]): string[] {
  if (!rawPaths || rawPaths.length === 0) return []

  const cleanPaths = Array.from(
    new Set(
      rawPaths
        .filter((p) => typeof p === "string" && p.trim().length > 0)
        .map((p) => sanitizeGamePath(p))
        .filter((p) => p.length > 0),
    ),
  )

  // Sort by length ascending so shorter parent paths come first
  cleanPaths.sort((a, b) => a.length - b.length)

  const normalizedRoots: string[] = []
  for (const p of cleanPaths) {
    const isSubsumed = normalizedRoots.some(
      (root) => p === root || p.startsWith(`${root}/`),
    )
    if (!isSubsumed) {
      normalizedRoots.push(p)
    }
  }

  return normalizedRoots
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
  env?: Env,
): Promise<GameFileUploadPayloadGql> {
  const safeFilename = sanitizeGameFileName(input.originalFilename)
  const category = (input.category || inferGameCategory(input.logicalPath || safeFilename)) as GameFileCategory

  if (input.sizeBytes <= 0) {
    throw createGraphQLError(
      "El tamaño del archivo debe ser mayor a 0 bytes.",
      "VALIDATION_ERROR",
    )
  }

  if (input.sizeBytes > MAX_GAME_FILE_SIZE_BYTES) {
    throw createGraphQLError(
      "El tamaño del archivo excede el límite permitido.",
      "VALIDATION_ERROR",
    )
  }

  const accountId = env?.CLOUDFLARE_ACCOUNT_ID
  const parentAccessKeyId = env?.R2_PARENT_ACCESS_KEY_ID
  const parentApiToken = env?.R2_PARENT_API_TOKEN
  const bucketName = env?.R2_BUCKET_NAME || "hikat-r2"

  if (!accountId || !parentAccessKeyId || !parentApiToken) {
    throw createGraphQLError(
      "Configuración o credenciales temporales R2 no disponibles.",
      "INTERNAL_ERROR",
    )
  }

  const objectKey = `game-files/${crypto.randomUUID()}`
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
  const UPLOAD_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours TTL
  const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS).toISOString()

  let accessKeyId: string
  let secretAccessKey: string
  let sessionToken: string

  try {
    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/temp-access-credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${parentApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucket: bucketName,
          parentAccessKeyId,
          permission: "object-read-write",
          ttlSeconds: 21600,
          objects: [objectKey],
        }),
      },
    )

    if (!cfRes.ok) {
      throw new Error(`Cloudflare API responded with status ${cfRes.status}`)
    }

    const cfData = (await cfRes.json()) as any
    if (!cfData || !cfData.success || !cfData.result) {
      throw new Error(cfData?.errors?.[0]?.message || "Respuesta inválida de Cloudflare R2")
    }

    accessKeyId = cfData.result.accessKeyId || cfData.result.access_key_id
    secretAccessKey = cfData.result.secretAccessKey || cfData.result.secret_access_key
    sessionToken = cfData.result.sessionToken || cfData.result.session_token

    if (!accessKeyId || !secretAccessKey || !sessionToken) {
      throw new Error("Credenciales temporales incompletas de Cloudflare R2")
    }
  } catch (err: unknown) {
    throw createGraphQLError(
      err instanceof Error ? err.message : "Error al solicitar credenciales temporales R2.",
      "INTERNAL_ERROR",
    )
  }

  await db.insert(schema.gameFileUploadTokens).values({
    id: tokenId,
    tokenHash,
    category,
    originalFilename: input.logicalPath ? sanitizeGamePath(input.logicalPath) : safeFilename,
    expectedSizeBytes: input.sizeBytes,
    objectKey,
    createdBy: userId,
    expiresAt,
    createdAt: now.toISOString(),
  })

  // Best-effort cleanup of expired tokens
  if (env?.ASSETS) {
    try {
      const expiredTokens = await db
        .select({
          id: schema.gameFileUploadTokens.id,
          objectKey: schema.gameFileUploadTokens.objectKey,
        })
        .from(schema.gameFileUploadTokens)
        .where(
          and(
            sql`${schema.gameFileUploadTokens.expiresAt} < ${now.toISOString()}`,
            sql`${schema.gameFileUploadTokens.objectKey} IS NOT NULL`,
          ),
        )
        .limit(10)
        .all()

      for (const expToken of expiredTokens) {
        if (!expToken.objectKey) continue
        await deleteR2ObjectIfUnreferenced(env, db, expToken.objectKey)
        const headObj = await env.ASSETS.head(expToken.objectKey)
        if (!headObj) {
          await db
            .delete(schema.gameFileUploadTokens)
            .where(eq(schema.gameFileUploadTokens.id, expToken.id))
        }
      }
    } catch {
      // Best-effort cleanup fail-safe
    }
  }

  return {
    uploadToken: tokenHex,
    expiresAt,
    maxSizeBytes: MAX_GAME_FILE_SIZE_BYTES,
    expectedCategory: category as any,
    objectKey,
    bucket: bucketName,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
  }
}

export async function completeGameFileUploadToken(
  db: Database,
  input: CompleteGameFileUploadInputGql,
  env: Env,
): Promise<GameFileUploadCompletePayloadGql> {
  if (!env.ASSETS) {
    throw createGraphQLError("Almacenamiento de archivos no disponible.", "INTERNAL_ERROR")
  }

  const rawToken = input.uploadToken?.trim()
  if (!rawToken) {
    throw createGraphQLError("Token de subida requerido.", "VALIDATION_ERROR")
  }

  const tokenBytes = new Uint8Array(
    rawToken.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
  )
  const hashBuffer = await crypto.subtle.digest("SHA-256", tokenBytes)
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const tokenRecord = await db
    .select()
    .from(schema.gameFileUploadTokens)
    .where(eq(schema.gameFileUploadTokens.tokenHash, tokenHash))
    .get()

  if (!tokenRecord || !tokenRecord.objectKey) {
    throw createGraphQLError("Token de subida no válido o desconocido.", "VALIDATION_ERROR")
  }

  if (new Date(tokenRecord.expiresAt) < new Date()) {
    throw createGraphQLError("El token de subida ha expirado.", "VALIDATION_ERROR")
  }

  const rawSha256 = String(input.sha256 || "").trim()
  if (!/^[a-f0-9]{64}$/.test(rawSha256)) {
    throw createGraphQLError("Formato de hash SHA-256 no válido.", "VALIDATION_ERROR")
  }
  const sha256 = rawSha256

  if (input.sizeBytes !== tokenRecord.expectedSizeBytes) {
    throw createGraphQLError("El tamaño del archivo no coincide con el tamaño esperado.", "VALIDATION_ERROR")
  }

  const objHead = await env.ASSETS.head(tokenRecord.objectKey)
  if (!objHead) {
    throw createGraphQLError("El objeto no se encontró en el almacenamiento R2.", "VALIDATION_ERROR")
  }

  if (objHead.size !== tokenRecord.expectedSizeBytes || objHead.size !== input.sizeBytes) {
    throw createGraphQLError("El tamaño del objeto en almacenamiento no coincide con el esperado.", "VALIDATION_ERROR")
  }

  const category = tokenRecord.category as GameFileCategory
  if (category === "MOD" || category === "DATA_PACK" || category === "RESOURCE_PACK" || category === "SHADER_PACK") {
    const headerObj = await env.ASSETS.get(tokenRecord.objectKey, {
      range: { offset: 0, length: 4 },
    })
    if (!headerObj || !headerObj.body) {
      throw createGraphQLError("No se pudo verificar la cabecera del archivo en almacenamiento.", "INTERNAL_ERROR")
    }
    const headerBytes = new Uint8Array(await headerObj.arrayBuffer())
    const validation = validateGameFileHeader(headerBytes, tokenRecord.originalFilename, category)
    if (!validation.valid) {
      throw createGraphQLError(validation.error || "Formato de archivo inválido.", "VALIDATION_ERROR")
    }
  }

  const updated = await db
    .update(schema.gameFileUploadTokens)
    .set({
      usedAt: new Date().toISOString(),
      sha256,
      uploadedSizeBytes: input.sizeBytes,
    })
    .where(
      and(
        eq(schema.gameFileUploadTokens.id, tokenRecord.id),
        sql`${schema.gameFileUploadTokens.usedAt} IS NULL`,
      ),
    )
    .returning()
    .get()

  if (!updated) {
    throw createGraphQLError("El token de subida ya fue utilizado por otra operación.", "CONFLICT")
  }

  return {
    tokenHash,
    sizeBytes: input.sizeBytes,
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

  try {
    let sha256: string
    let sizeBytes: number
    let objectKey: string
    let originalFilename: string
    let category: GameFileCategory = (input.category as GameFileCategory) || "GENERAL"

    // 1. Single-use atomic token claim
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

      // Atomically claim and delete token. Only ONE concurrent request can successfully claim it.
      const claimedToken = await db
        .delete(schema.gameFileUploadTokens)
        .where(
          and(
            eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash),
            sql`${schema.gameFileUploadTokens.usedAt} IS NOT NULL`,
            sql`${schema.gameFileUploadTokens.objectKey} IS NOT NULL`,
            sql`${schema.gameFileUploadTokens.sha256} IS NOT NULL`,
          ),
        )
        .returning()
        .get()

      if (!claimedToken || !claimedToken.objectKey || !claimedToken.sha256) {
        throw createGraphQLError(
          "El archivo aún no se ha subido, el token es inválido o ya fue utilizado por otra operación.",
          "VALIDATION_ERROR",
        )
      }

      sha256 = claimedToken.sha256
      sizeBytes = claimedToken.uploadedSizeBytes || claimedToken.expectedSizeBytes
      objectKey = claimedToken.objectKey
      originalFilename = claimedToken.originalFilename
      objectKeyToCompensate = objectKey

      if (!input.category && claimedToken.category) {
        category = claimedToken.category as GameFileCategory
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
        : category === "DATA_PACK"
        ? "datapacks"
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
          sourceProvider: null,
          sourceProjectId: null,
          sourceVersionId: null,
          sourceFileId: null,
          sourceEnvironment: null,
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
        sourceProvider: null,
        sourceProjectId: null,
        sourceVersionId: null,
        sourceFileId: null,
        sourceEnvironment: null,
        createdAt: now,
      }

      await db.insert(schema.gameReleaseFiles).values(newFile)
      record = newFile
    }

    return formatAdminFileWithTree(db, draft.id, record)
  } catch (err) {
    if (env && objectKeyToCompensate) {
      await deleteR2ObjectIfUnreferenced(env, db, objectKeyToCompensate)
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

  try {
    let tokenUpdates: Partial<schema.GameReleaseFile> = {}

    // 1. Single-use atomic token claim
    if (input.tokenHash) {
      const claimedToken = await db
        .delete(schema.gameFileUploadTokens)
        .where(
          and(
            eq(schema.gameFileUploadTokens.tokenHash, input.tokenHash),
            sql`${schema.gameFileUploadTokens.usedAt} IS NOT NULL`,
            sql`${schema.gameFileUploadTokens.objectKey} IS NOT NULL`,
            sql`${schema.gameFileUploadTokens.sha256} IS NOT NULL`,
          ),
        )
        .returning()
        .get()

      if (!claimedToken || !claimedToken.objectKey || !claimedToken.sha256) {
        throw createGraphQLError(
          "Token de subida inválido, no completado o ya utilizado por otra operación.",
          "VALIDATION_ERROR",
        )
      }

      objectKeyToCompensate = claimedToken.objectKey
      tokenUpdates = {
        sha256: claimedToken.sha256,
        sizeBytes: claimedToken.uploadedSizeBytes || claimedToken.expectedSizeBytes,
        objectKey: claimedToken.objectKey,
        sourceProvider: null,
        sourceProjectId: null,
        sourceVersionId: null,
        sourceFileId: null,
        sourceEnvironment: null,
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
    if (tokenUpdates.objectKey) {
      updates.sourceProvider = null
      updates.sourceProjectId = null
      updates.sourceVersionId = null
      updates.sourceFileId = null
    }
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
      const updatePayload: Partial<typeof schema.gameReleaseFiles.$inferInsert> = {
        name: filename,
        category,
        sha256,
        sizeBytes: utf8Bytes.byteLength,
        objectKey,
        isDirectory: 0,
        sourceProvider: null,
        sourceProjectId: null,
        sourceVersionId: null,
        sourceFileId: null,
        sourceEnvironment: null,
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
        sourceProvider: null,
        sourceProjectId: null,
        sourceVersionId: null,
        sourceFileId: null,
        sourceEnvironment: null,
        createdAt: now,
      }

      await db.insert(schema.gameReleaseFiles).values(newRecord)
      savedRecord = newRecord
    }
  } catch (err) {
    // If D1 fails after R2 write, compensate by removing the new R2 object
    if (env.ASSETS) {
      await env.ASSETS.delete(objectKey)
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
    sourceProvider: null,
    sourceProjectId: null,
    sourceVersionId: null,
    sourceFileId: null,
    sourceEnvironment: null,
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
    await db.batch(asBatchTuple(statements))
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
    await db.batch(asBatchTuple(statements))
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
        sourceProvider: f.sourceProvider || null,
        sourceProjectId: f.sourceProjectId || null,
        sourceVersionId: f.sourceVersionId || null,
        sourceFileId: f.sourceFileId || null,
        sourceEnvironment: f.sourceEnvironment || null,
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
    await db.batch(asBatchTuple(statements))
  }

  return true
}

export async function deleteGamePaths(
  db: Database,
  paths: string[],
  userId: string,
  env?: Env,
): Promise<boolean> {
  const normalizedPaths = normalizeDeletePaths(paths)
  if (normalizedPaths.length === 0) return true

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

  const filesToDeleteMap = new Map<string, schema.GameReleaseFile>()

  for (const rootPath of normalizedPaths) {
    for (const f of draftFiles) {
      if (f.logicalPath === rootPath || f.logicalPath.startsWith(`${rootPath}/`)) {
        filesToDeleteMap.set(f.id, f)
      }
    }
  }

  const filesToDelete = Array.from(filesToDeleteMap.values())

  if (filesToDelete.length === 0) {
    return true
  }

  // 4. Collect candidate unique objectKeys before deletion (ignoring directories / nulls)
  const candidateObjectKeys = Array.from(
    new Set(
      filesToDelete
        .map((f) => f.objectKey)
        .filter((k): k is string => Boolean(k)),
    ),
  )

  // 3. Delete records from D1 in safe chunks (<= 80 IDs per statement) restricted to the active draft
  const idsToDelete = filesToDelete.map((f) => f.id)
  const D1_CHUNK_SIZE = 80

  for (let i = 0; i < idsToDelete.length; i += D1_CHUNK_SIZE) {
    const idChunk = idsToDelete.slice(i, i + D1_CHUNK_SIZE)
    await db
      .delete(schema.gameReleaseFiles)
      .where(
        and(
          eq(schema.gameReleaseFiles.releaseId, draft.id),
          inArray(schema.gameReleaseFiles.id, idChunk),
        ),
      )
  }

  // 5 & 6. Batch determine unreferenced objectKeys and delete from R2 in bulk
  if (env?.ASSETS && candidateObjectKeys.length > 0) {
    await deleteR2ObjectsIfUnreferenced(env, db, candidateObjectKeys)
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
    sourceProvider: originalFile.sourceProvider || null,
    sourceProjectId: originalFile.sourceProjectId || null,
    sourceVersionId: originalFile.sourceVersionId || null,
    sourceFileId: originalFile.sourceFileId || null,
    sourceEnvironment: originalFile.sourceEnvironment || null,
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
          sourceProvider: pf.sourceProvider || null,
          sourceProjectId: pf.sourceProjectId || null,
          sourceVersionId: pf.sourceVersionId || null,
          sourceFileId: pf.sourceFileId || null,
          sourceEnvironment: pf.sourceEnvironment || null,
          createdAt: now,
        })
        draftPathSet.add(pf.logicalPath)
      }
    }
  }

  return formatAdminFileWithTree(db, draft.id, newFile)
}
