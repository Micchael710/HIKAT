import { eq, and } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  AdminGameFileGql,
  InstallModPlanInputGql,
} from "@hikat/graphql"
import {
  MAX_GAME_FILE_SIZE_BYTES,
  validateGameFileBuffer,
  sanitizeGamePath,
} from "@hikat/shared"
import type { Env } from "../../types"
import { modProviderManager } from "./modProviderManager"
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
    draft.minecraftVersion || "1.21.1",
    draft.neoForgeVersion || "21.1.65",
  )

  if (!plan.isValid || plan.conflicts.length > 0) {
    throw createGraphQLError(
      `No se puede instalar el mod debido a conflictos: ${plan.conflicts.join(". ")}`,
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

  const createdR2Keys: string[] = []
  const oldKeysToClean: string[] = []

  try {
    // 3. Download and upload each binary in parallel
    const downloadedItems = await Promise.all(
      itemsToProcess.map(async (item) => {
        const adapter = modProviderManager.getAdapter(item.provider)
        const versionObj = await adapter.getVersion(env, item.versionId, item.projectId)
        const downloadUrl = versionObj?.downloadUrl
        const filename = versionObj?.filename || item.filename

        if (!downloadUrl) {
          throw createGraphQLError(
            `No se encontró URL de descarga directa para "${item.projectName}".`,
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

        // Validate jar format / magic bytes
        const validation = validateGameFileBuffer(buffer.buffer as ArrayBuffer, filename, "MOD")
        if (!validation.valid) {
          throw createGraphQLError(
            `El archivo descargado para "${item.projectName}" no tiene formato .jar válido.`,
            "VALIDATION_ERROR",
          )
        }

        // Compute local SHA-256
        const shaBuffer = await crypto.subtle.digest("SHA-256", buffer.buffer as ArrayBuffer)
        const sha256 = Array.from(new Uint8Array(shaBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .toLowerCase()

        // Generate R2 key and store
        const fileId = crypto.randomUUID()
        const objectKey = `game-files/${fileId}-${sha256.slice(0, 16)}`

        if (env.ASSETS) {
          await env.ASSETS.put(objectKey, buffer, {
            httpMetadata: {
              contentType: "application/java-archive",
            },
            customMetadata: {
              sha256,
              category: "MOD",
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
        }
      }),
    )

    // 4. Apply all mutations to D1
    const draftFiles = await db
      .select()
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
      .all()

    const now = new Date().toISOString()

    for (const downloaded of downloadedItems) {
      const { item, filename, sizeBytes, sha256, objectKey } = downloaded
      const logicalPath = sanitizeGamePath(`mods/${filename}`)

      const existingByProvider = draftFiles.find(
        (f) => f.sourceProvider === item.provider && f.sourceProjectId === item.projectId,
      )

      if (existingByProvider) {
        // UPDATE existing mod
        if (existingByProvider.objectKey && existingByProvider.objectKey !== objectKey) {
          oldKeysToClean.push(existingByProvider.objectKey)
        }

        await db
          .update(schema.gameReleaseFiles)
          .set({
            name: filename,
            logicalPath,
            category: "MOD",
            sha256,
            sizeBytes,
            isDirectory: 0,
            objectKey,
            sourceProvider: item.provider,
            sourceProjectId: item.projectId,
            sourceVersionId: item.versionId,
            sourceFileId: item.fileId,
          })
          .where(eq(schema.gameReleaseFiles.id, existingByProvider.id))
      } else {
        // Check collision on logicalPath with any manual file
        const existingByPath = draftFiles.find((f) => f.logicalPath === logicalPath)
        if (existingByPath) {
          if (existingByPath.objectKey && existingByPath.objectKey !== objectKey) {
            oldKeysToClean.push(existingByPath.objectKey)
          }
          await db
            .update(schema.gameReleaseFiles)
            .set({
              name: filename,
              category: "MOD",
              sha256,
              sizeBytes,
              isDirectory: 0,
              objectKey,
              sourceProvider: item.provider,
              sourceProjectId: item.projectId,
              sourceVersionId: item.versionId,
              sourceFileId: item.fileId,
            })
            .where(eq(schema.gameReleaseFiles.id, existingByPath.id))
        } else {
          // INSERT new file
          await db.insert(schema.gameReleaseFiles).values({
            id: crypto.randomUUID(),
            releaseId: draft.id,
            name: filename,
            logicalPath,
            category: "MOD",
            sha256,
            sizeBytes,
            policy: null,
            isDirectory: 0,
            objectKey,
            sourceProvider: item.provider,
            sourceProjectId: item.projectId,
            sourceVersionId: item.versionId,
            sourceFileId: item.fileId,
            createdAt: now,
          })
        }
      }
    }

    // Clean up old unreferenced R2 objects
    for (const oldKey of oldKeysToClean) {
      await deleteR2ObjectIfUnreferenced(env, db, oldKey)
    }

    // 5. Return updated draft files with effective policies
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
