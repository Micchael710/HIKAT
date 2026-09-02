import { createHash } from "node:crypto"
import { eq, and } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  AdminGameFileGql,
  InstallModPlanInputGql,
  GameFileCategoryGql,
  SyncPolicyGql,
  ModInstallationPlanItemGql,
} from "@hikat/graphql"
import {
  MAX_GAME_FILE_SIZE_BYTES,
  validateGameFileHeader,
  sanitizeGamePath,
} from "@hikat/shared"
import type { Env } from "../../types"
import { modProviderManager, getLogicalPathForContent } from "./modProviderManager"
import {
  prepareGameDraft,
  formatAdminGameFile,
  resolveReleaseEffectivePolicies,
} from "../game/releaseService"
import { deleteR2ObjectIfUnreferenced } from "../game/gameFileService"

type BatchStatements = Parameters<Database["batch"]>[0]
type BatchStatement = BatchStatements[number]

function asBatchTuple(statements: BatchStatement[]): BatchStatements {
  return [statements[0]!, ...statements.slice(1)] as unknown as BatchStatements
}

const PROVIDER_MIN_PART_SIZE_BYTES = 8 * 1024 * 1024
const PROVIDER_MAX_PARTS = 10_000
const PROVIDER_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

type ProviderChecksum = {
  algorithm: "sha512" | "sha1" | "md5"
  expected: string
  label: "SHA-512" | "SHA-1" | "MD5"
}

function resolveProviderChecksum(
  hashes:
    | {
      sha1?: string
      sha512?: string
      md5?: string
    }
    | undefined,
): ProviderChecksum | null {
  if (hashes?.sha512) {
    return {
      algorithm: "sha512",
      expected: hashes.sha512.toLowerCase(),
      label: "SHA-512",
    }
  }

  if (hashes?.sha1) {
    return {
      algorithm: "sha1",
      expected: hashes.sha1.toLowerCase(),
      label: "SHA-1",
    }
  }

  if (hashes?.md5) {
    return {
      algorithm: "md5",
      expected: hashes.md5.toLowerCase(),
      label: "MD5",
    }
  }

  return null
}

function resolveProviderPartSize(sizeBytes: number): number {
  const oneMiB = 1024 * 1024

  const requiredPartSize =
    sizeBytes > 0
      ? Math.ceil(sizeBytes / PROVIDER_MAX_PARTS)
      : PROVIDER_MIN_PART_SIZE_BYTES

  return Math.max(
    PROVIDER_MIN_PART_SIZE_BYTES,
    Math.ceil(requiredPartSize / oneMiB) * oneMiB,
  )
}

async function uploadProviderBinaryToR2(options: {
  bucket: R2Bucket
  response: Response
  objectKey: string
  filename: string
  category: GameFileCategoryGql
  provider: string
  projectId: string
  versionId: string
  expectedSizeBytes: number
  hashes?: {
    sha1?: string
    sha512?: string
    md5?: string
  }
}): Promise<{
  sha256: string
  sizeBytes: number
}> {
  const {
    bucket,
    response,
    objectKey,
    filename,
    category,
    provider,
    projectId,
    versionId,
    expectedSizeBytes,
    hashes,
  } = options

  if (!response.body) {
    throw createGraphQLError(
      `No se pudo obtener el flujo de descarga para "${filename}".`,
      "INTERNAL_ERROR",
    )
  }

  if (
    expectedSizeBytes > 0 &&
    expectedSizeBytes > MAX_GAME_FILE_SIZE_BYTES
  ) {
    throw createGraphQLError(
      `El archivo "${filename}" supera el tamaño máximo permitido.`,
      "VALIDATION_ERROR",
    )
  }

  const contentLength = Number(
    response.headers.get("content-length") || 0,
  )

  if (
    expectedSizeBytes > 0 &&
    contentLength > 0 &&
    expectedSizeBytes !== contentLength
  ) {
    throw createGraphQLError(
      `El tamaño reportado por el proveedor para "${filename}" no coincide con la descarga.`,
      "VALIDATION_ERROR",
    )
  }

  const declaredSize =
    expectedSizeBytes > 0
      ? expectedSizeBytes
      : contentLength

  if (
    !Number.isSafeInteger(declaredSize) ||
    declaredSize <= 0
  ) {
    throw createGraphQLError(
      `No se pudo determinar el tamaño de "${filename}" antes de subirlo a R2.`,
      "VALIDATION_ERROR",
    )
  }

  const partSize =
    resolveProviderPartSize(declaredSize)

  const sha256Hasher =
    createHash("sha256")

  const providerChecksum =
    resolveProviderChecksum(hashes)

  const providerHasher =
    providerChecksum
      ? createHash(providerChecksum.algorithm)
      : null

  const multipart =
    await bucket.createMultipartUpload(
      objectKey,
      {
        httpMetadata: {
          contentType:
            category === "MOD"
              ? "application/java-archive"
              : "application/zip",
        },
        customMetadata: {
          category,
          filename,
          provider,
          projectId,
          versionId,
        },
      },
    )

  const reader =
    response.body.getReader()

  const uploadedParts: R2UploadedPart[] = []

  let pendingChunk: Uint8Array | null = null
  let totalBytes = 0

  async function nextChunk(): Promise<Uint8Array | null> {
    if (
      pendingChunk &&
      pendingChunk.byteLength > 0
    ) {
      const chunk = pendingChunk
      pendingChunk = null
      return chunk
    }

    const result =
      await reader.read()

    if (result.done) {
      return null
    }

    return result.value instanceof Uint8Array
      ? result.value
      : new Uint8Array(result.value)
  }

  try {
    let partNumber = 1

    while (totalBytes < declaredSize) {
      if (partNumber > PROVIDER_MAX_PARTS) {
        throw createGraphQLError(
          `El archivo "${filename}" requiere demasiadas partes para R2.`,
          "VALIDATION_ERROR",
        )
      }

      const targetPartLength =
        Math.min(
          partSize,
          declaredSize - totalBytes,
        )

      const fixedLengthStream =
        new FixedLengthStream(
          targetPartLength,
        )

      const writer =
        fixedLengthStream.writable.getWriter()

      /*
     * Start R2 reading the fixed-length stream
     * before we begin writing provider chunks into it.
     */
      const uploadPromise =
        multipart.uploadPart(
          partNumber,
          fixedLengthStream.readable,
        )

      let writtenToPart = 0

      try {
        while (
          writtenToPart <
          targetPartLength
        ) {
          const sourceChunk =
            await nextChunk()

          if (!sourceChunk) {
            throw createGraphQLError(
              `La descarga de "${filename}" terminó antes del tamaño esperado.`,
              "VALIDATION_ERROR",
            )
          }

          const remaining =
            targetPartLength -
            writtenToPart

          const bytesToWrite =
            sourceChunk.byteLength <=
              remaining
              ? sourceChunk
              : sourceChunk.subarray(
                0,
                remaining,
              )

          if (
            sourceChunk.byteLength >
            remaining
          ) {
            pendingChunk =
              sourceChunk.subarray(
                remaining,
              )
          }

          sha256Hasher.update(
            bytesToWrite,
          )

          providerHasher?.update(
            bytesToWrite,
          )

          await writer.write(
            bytesToWrite,
          )

          writtenToPart +=
            bytesToWrite.byteLength

          totalBytes +=
            bytesToWrite.byteLength
        }

        await writer.close()

        const uploadedPart =
          await uploadPromise

        uploadedParts.push(
          uploadedPart,
        )

        partNumber += 1
      } catch (err) {
        try {
          await writer.abort(err)
        } catch (_) { }

        try {
          await uploadPromise
        } catch (_) { }

        throw err
      }
    }

    /*
     * We already consumed exactly declaredSize bytes.
     * There must not be any extra bytes left in the
     * provider response.
     */
    if (
      pendingChunk &&
      pendingChunk.byteLength > 0
    ) {
      throw createGraphQLError(
        `La descarga de "${filename}" contiene más bytes de los indicados por el proveedor.`,
        "VALIDATION_ERROR",
      )
    }

    const extra =
      await reader.read()

    if (
      !extra.done &&
      extra.value &&
      extra.value.byteLength > 0
    ) {
      throw createGraphQLError(
        `La descarga de "${filename}" contiene más bytes de los indicados por el proveedor.`,
        "VALIDATION_ERROR",
      )
    }

    if (totalBytes === 0) {
      throw createGraphQLError(
        `El archivo descargado "${filename}" está vacío.`,
        "VALIDATION_ERROR",
      )
    }

    if (
      expectedSizeBytes > 0 &&
      totalBytes !== expectedSizeBytes
    ) {
      throw createGraphQLError(
        `El tamaño descargado para "${filename}" no coincide con el tamaño indicado por el proveedor.`,
        "VALIDATION_ERROR",
      )
    }

    const completedObject =
      await multipart.complete(
        uploadedParts,
      )

    if (
      completedObject.size !== totalBytes
    ) {
      throw createGraphQLError(
        `El tamaño almacenado en R2 para "${filename}" no coincide con la descarga.`,
        "VALIDATION_ERROR",
      )
    }

    const sha256 =
      sha256Hasher
        .digest("hex")
        .toLowerCase()

    if (
      providerChecksum &&
      providerHasher
    ) {
      const providerDigest =
        providerHasher
          .digest("hex")
          .toLowerCase()

      if (
        providerDigest !==
        providerChecksum.expected
      ) {
        await bucket.delete(objectKey)

        throw createGraphQLError(
          `Error de integridad: el hash ${providerChecksum.label} descargado para "${filename}" no coincide con el proveedor.`,
          "VALIDATION_ERROR",
        )
      }
    }

    const headerObject =
      await bucket.get(
        objectKey,
        {
          range: {
            offset: 0,
            length: 4,
          },
        },
      )

    if (!headerObject) {
      await bucket.delete(objectKey)

      throw createGraphQLError(
        `No se pudo verificar "${filename}" después de almacenarlo.`,
        "INTERNAL_ERROR",
      )
    }

    const headerBytes =
      new Uint8Array(
        await headerObject.arrayBuffer(),
      )

    const validation =
      validateGameFileHeader(
        headerBytes,
        filename,
        category as any,
      )

    if (!validation.valid) {
      await bucket.delete(objectKey)

      throw createGraphQLError(
        validation.error ||
        `El archivo "${filename}" no tiene un formato válido.`,
        "VALIDATION_ERROR",
      )
    }

    return {
      sha256,
      sizeBytes: totalBytes,
    }
  } catch (err) {
    try {
      await multipart.abort()
    } catch (_) { }

    try {
      await bucket.delete(
        objectKey,
      )
    } catch (_) { }

    throw err
  } finally {
    try {
      reader.releaseLock()
    } catch (_) { }
  }
}

export async function installModPlan(
  db: Database,
  env: Env,
  input: InstallModPlanInputGql,
  userId: string,
): Promise<AdminGameFileGql[]> {
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

  // 2. Resolve complete installation plan and validate compatibility
  const plan = await modProviderManager.resolveInstallationPlan(
    env,
    db,
    input,
  )

  if (!plan.isValid || plan.conflicts.length > 0) {
    throw createGraphQLError(
      `No se puede instalar el contenido debido a conflictos: ${plan.conflicts.join(". ")}`,
      "VALIDATION_ERROR",
    )
  }

  const itemsToProcess = plan.items.filter(
    (i) => i.action === "INSTALL" || i.action === "UPDATE",
  )

  for (const item of itemsToProcess) {
    if (
      item.contentType === "MOD" &&
      item.provider === "CURSEFORGE" &&
      (!item.environment || item.environment === "UNKNOWN")
    ) {
      throw createGraphQLError(
        `Se requiere especificar el entorno de ejecución (Solo cliente o Cliente y servidor) para "${item.projectName}".`,
        "VALIDATION_ERROR",
      )
    }
  }

  if (itemsToProcess.length === 0) {
    const allFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()
    const effMap = resolveReleaseEffectivePolicies(allFiles)
    return allFiles.map((f) => formatAdminGameFile(f, effMap.get(f.id)))
  }

  // 3. Preflight check: path collisions & duplicates within plan
  const planPaths = new Set<string>()
  for (const item of itemsToProcess) {
    const targetPath = item.logicalPath || getLogicalPathForContent(item.contentType, item.filename)
    if (planPaths.has(targetPath)) {
      throw createGraphQLError(
        `Conflicto en el plan: múltiples elementos intentan instalarse en "${targetPath}".`,
        "VALIDATION_ERROR",
      )
    }
    planPaths.add(targetPath)
  }

  const draftFiles = await db
    .select()
    .from(schema.gameReleaseFiles)
    .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
    .all()

  for (const item of itemsToProcess) {
    const targetPath = sanitizeGamePath(
      item.logicalPath || getLogicalPathForContent(item.contentType, item.filename),
    )
    const existingByPath = draftFiles.find((f) => f.logicalPath === targetPath)

    if (existingByPath) {
      const isSameProject =
        existingByPath.sourceProvider === item.provider &&
        existingByPath.sourceProjectId === item.projectId

      if (!isSameProject) {
        throw createGraphQLError(
          `Ya existe un archivo en "${targetPath}" que no corresponde al proyecto ${item.projectName}.`,
          "CONFLICT",
        )
      }
    }
  }

  const createdR2Keys: string[] = []
  const oldKeysToClean: string[] = []

  if (!env.ASSETS) {
    throw createGraphQLError(
      "Almacenamiento R2 no disponible.",
      "INTERNAL_ERROR",
    )
  }

  try {
    // 4. Stream provider binaries directly into R2 multipart.
    // Process sequentially to avoid holding several large provider/R2
    // connections simultaneously inside the Worker.
    const downloadedItems: Array<{
      item: ModInstallationPlanItemGql
      filename: string
      sizeBytes: number
      sha256: string
      objectKey: string
      category: GameFileCategoryGql
    }> = []

    for (const item of itemsToProcess) {
      const adapter =
        modProviderManager.getAdapter(
          item.provider,
        )

      const versionObj =
        await adapter.getVersion(
          env,
          item.versionId,
          item.projectId,
          item.contentType,
        )

      const downloadUrl =
        versionObj?.downloadUrl || ""

      const filename =
        versionObj?.filename ||
        item.filename

      if (!downloadUrl) {
        throw createGraphQLError(
          `El autor de este archivo en ${item.provider} ha deshabilitado la descarga directa de terceros.`,
          "VALIDATION_ERROR",
        )
      }

      const validationCategory:
        GameFileCategoryGql =
        item.contentType === "SHADER"
          ? "SHADER_PACK"
          : item.contentType === "RESOURCE_PACK"
            ? "RESOURCE_PACK"
            : item.contentType === "DATA_PACK"
              ? "DATA_PACK"
              : "MOD"

      const objectKey =
        `game-files/${crypto.randomUUID()}`

      const controller =
        new AbortController()

      const timeoutId =
        setTimeout(
          () => controller.abort(),
          PROVIDER_DOWNLOAD_TIMEOUT_MS,
        )

      try {
        // Binary CDN fetch MUST NOT receive
        // the CurseForge API key.
        const response =
          await fetch(
            downloadUrl,
            {
              headers: {
                "User-Agent":
                  "HiKAT/0.1.0 (contact@hikat.local)",
              },
              signal:
                controller.signal,
            },
          )

        if (!response.ok) {
          throw createGraphQLError(
            `Error ${response.status} al descargar "${item.projectName}" desde ${item.provider}.`,
            "VALIDATION_ERROR",
          )
        }

        const uploaded =
          await uploadProviderBinaryToR2({
            bucket: env.ASSETS,
            response,
            objectKey,
            filename,
            category:
              validationCategory,
            provider:
              item.provider,
            projectId:
              item.projectId,
            versionId:
              item.versionId,
            expectedSizeBytes:
              Number(
                versionObj?.sizeBytes,
              ) || 0,
            hashes:
              versionObj?.hashes,
          })

        createdR2Keys.push(
          objectKey,
        )

        downloadedItems.push({
          item,
          filename,
          sizeBytes:
            uploaded.sizeBytes,
          sha256:
            uploaded.sha256,
          objectKey,
          category:
            validationCategory,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    }

    // 5. Construct ALL D1 statements into a single atomic batch
    const now = new Date().toISOString()
    const statements: BatchStatement[] = []

    for (const downloaded of downloadedItems) {
      const { item, filename, sizeBytes, sha256, objectKey, category } = downloaded
      const logicalPath = sanitizeGamePath(
        item.logicalPath || getLogicalPathForContent(item.contentType, filename),
      )

      const existingByProvider = draftFiles.find(
        (f) =>
          f.sourceProvider === item.provider &&
          f.sourceProjectId === item.projectId &&
          f.category === category,
      )

      const defaultPolicy: SyncPolicyGql | null =
        category === "DATA_PACK" ? "NO_MODIFICABLE" : null

      if (existingByProvider) {
        // UPDATE existing provider record
        if (existingByProvider.objectKey && existingByProvider.objectKey !== objectKey) {
          oldKeysToClean.push(existingByProvider.objectKey)
        }

        statements.push(
          db
            .update(schema.gameReleaseFiles)
            .set({
              name: filename,
              logicalPath,
              category,
              sha256,
              sizeBytes,
              policy: existingByProvider.policy || defaultPolicy,
              isDirectory: 0,
              objectKey,
              sourceProvider: item.provider,
              sourceProjectId: item.projectId,
              sourceVersionId: item.versionId,
              sourceFileId: item.fileId || null,
              sourceEnvironment: item.environment || null,
            })
            .where(eq(schema.gameReleaseFiles.id, existingByProvider.id)),
        )
      } else {
        // INSERT new file
        statements.push(
          db.insert(schema.gameReleaseFiles).values({
            id: crypto.randomUUID(),
            releaseId: draft.id,
            name: filename,
            logicalPath,
            category,
            sha256,
            sizeBytes,
            policy: defaultPolicy,
            isDirectory: 0,
            objectKey,
            sourceProvider: item.provider,
            sourceProjectId: item.projectId,
            sourceVersionId: item.versionId,
            sourceFileId: item.fileId || null,
            sourceEnvironment: item.environment || null,
            createdAt: now,
          }),
        )
      }
    }

    // 6. Execute atomic D1 batch!
    if (statements.length > 0) {
      await db.batch(asBatchTuple(statements))
    }

    // 7. Clean up old unreferenced R2 objects ONLY after D1 batch succeeds
    for (const oldKey of oldKeysToClean) {
      await deleteR2ObjectIfUnreferenced(env, db, oldKey)
    }

    // 8. Return updated draft files with effective policies
    const updatedFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    const effectiveMap = resolveReleaseEffectivePolicies(updatedFiles)
    return updatedFiles.map((f) => formatAdminGameFile(f, effectiveMap.get(f.id)))
  } catch (err) {
    // COMPENSATE: purge all newly created R2 objects
    if (env.ASSETS) {
      for (const key of createdR2Keys) {
        await deleteR2ObjectIfUnreferenced(env, db, key)
      }
    }
    throw err
  }
}
