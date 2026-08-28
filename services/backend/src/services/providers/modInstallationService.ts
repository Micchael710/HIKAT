import { eq, and } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  AdminGameFileGql,
  InstallModPlanInputGql,
  GameFileCategoryGql,
  SyncPolicyGql,
} from "@hikat/graphql"
import {
  MAX_GAME_FILE_SIZE_BYTES,
  validateGameFileBuffer,
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

  try {
    // 4. Download and validate each binary in parallel
    const downloadedItems = await Promise.all(
      itemsToProcess.map(async (item) => {
        const adapter = modProviderManager.getAdapter(item.provider)
        const versionObj = await adapter.getVersion(
          env,
          item.versionId,
          item.projectId,
          item.contentType,
        )
        const downloadUrl = versionObj?.downloadUrl || ""
        const filename = versionObj?.filename || item.filename

        if (!downloadUrl) {
          throw createGraphQLError(
            `El autor de este archivo en ${item.provider} ha deshabilitado la descarga directa de terceros.`,
            "VALIDATION_ERROR",
          )
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 45000)

        let buffer: Uint8Array
        try {
          const res = await fetch(downloadUrl, {
            headers: {
              "User-Agent": "HiKAT/0.1.0 (contact@hikat.local)",
              ...(item.provider === "CURSEFORGE" && env.CURSEFORGE_API_KEY
                ? { "x-api-key": env.CURSEFORGE_API_KEY.trim() }
                : {}),
            },
            signal: controller.signal,
          })

          if (!res.ok) {
            throw new Error(`Error ${res.status} al descargar "${item.projectName}" desde ${item.provider}`)
          }

          const arrayBuffer = await res.arrayBuffer()
          buffer = new Uint8Array(arrayBuffer)
        } finally {
          clearTimeout(timeoutId)
        }

        if (buffer.byteLength === 0) {
          throw createGraphQLError(`El archivo descargado para "${item.projectName}" está vacío.`, "VALIDATION_ERROR")
        }

        if (buffer.byteLength > MAX_GAME_FILE_SIZE_BYTES) {
          throw createGraphQLError(
            `El archivo descargado para "${item.projectName}" supera el tamaño máximo permitido (100 MB).`,
            "VALIDATION_ERROR",
          )
        }

        // Validate jar/zip format / magic bytes
        const validationCategory =
          item.contentType === "SHADER"
            ? "SHADER_PACK"
            : item.contentType === "RESOURCE_PACK"
            ? "RESOURCE_PACK"
            : item.contentType === "DATA_PACK"
            ? "DATA_PACK"
            : "MOD"

        const validation = validateGameFileBuffer(
          buffer.buffer as ArrayBuffer,
          filename,
          validationCategory as any,
        )
        if (!validation.valid) {
          throw createGraphQLError(
            `El archivo descargado para "${item.projectName}" no tiene un formato binario válido.`,
            "VALIDATION_ERROR",
          )
        }

        // Compute local SHA-256
        const shaBuffer = await crypto.subtle.digest("SHA-256", buffer.buffer as ArrayBuffer)
        const sha256 = Array.from(new Uint8Array(shaBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .toLowerCase()

        // Verify provider checksum if provided
        if (versionObj?.hashes?.sha256 && versionObj.hashes.sha256.toLowerCase() !== sha256) {
          throw createGraphQLError(
            `Error de integridad: el hash SHA-256 descargado para "${item.projectName}" no coincide con el proveedor.`,
            "VALIDATION_ERROR",
          )
        }

        if (versionObj?.hashes?.sha1) {
          const sha1Buffer = await crypto.subtle.digest("SHA-1", buffer.buffer as ArrayBuffer)
          const computedSha1 = Array.from(new Uint8Array(sha1Buffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toLowerCase()
          if (computedSha1 !== versionObj.hashes.sha1.toLowerCase()) {
            throw createGraphQLError(
              `Error de integridad: el hash SHA-1 descargado para "${item.projectName}" no coincide con el proveedor.`,
              "VALIDATION_ERROR",
            )
          }
        }

        // Generate R2 key and upload
        const fileId = crypto.randomUUID()
        const objectKey = `game-files/${fileId}-${sha256.slice(0, 16)}`

        if (env.ASSETS) {
          await env.ASSETS.put(objectKey, buffer, {
            httpMetadata: {
              contentType:
                item.contentType === "MOD"
                  ? "application/java-archive"
                  : "application/zip",
            },
            customMetadata: {
              sha256,
              category: validationCategory,
              filename,
              provider: item.provider,
              projectId: item.projectId,
              versionId: item.versionId,
            },
          })
          createdR2Keys.push(objectKey)
        }

        return {
          item,
          filename,
          sizeBytes: buffer.byteLength,
          sha256,
          objectKey,
          category: validationCategory as GameFileCategoryGql,
        }
      }),
    )

    // 5. Construct ALL D1 statements into a single atomic batch
    const now = new Date().toISOString()
    const statements: any[] = []

    for (const downloaded of downloadedItems) {
      const { item, filename, sizeBytes, sha256, objectKey, category } = downloaded
      const logicalPath = sanitizeGamePath(
        item.logicalPath || getLogicalPathForContent(item.contentType, filename),
      )

      const existingByProvider = draftFiles.find(
        (f) => f.sourceProvider === item.provider && f.sourceProjectId === item.projectId,
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
      await db.batch(statements as any)
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
