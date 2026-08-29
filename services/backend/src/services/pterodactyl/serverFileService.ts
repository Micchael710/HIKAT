/**
 * Server File Sandbox Service (Shard 07)
 * Strictly sandboxed file operations across virtual categories (WORLD, CONFIG, MODS, LOGS)
 * with robust path traversal protection, size limits, and text editing allowlist.
 */

import {
  sanitizeVirtualPath,
  isAllowlistedTextFile,
  MAX_TEXT_FILE_SIZE_BYTES,
  SERVER_ERROR_CODES,
  type ServerFileRoot,
} from "@hikat/shared"
import { eq } from "drizzle-orm"
import { schema, type Database } from "@hikat/database"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { ServerInfrastructureError } from "./pterodactylClient"
import { createPterodactylClient } from "./serverAdministrationService"
import { detectActiveWorldName } from "./serverWorldService"

export interface ServerFileItemData {
  name: string
  isFile: boolean
  isSymlink: boolean
  sizeBytes: number
  mimeType?: string | null
  modifiedAt: string
}

export interface ServerFileContentData {
  content: string
  sizeBytes: number
}

/**
 * Helper to verify that a target path exists and is not a symlink.
 * Fail-closed: If listDirectory fails, response structure is invalid, item is not found,
 * or target is a symlink, throws a human ServerInfrastructureError.
 */
async function verifyNotSymlink(
  client: IPterodactylClient,
  fullPath: string,
): Promise<void> {
  const segments = fullPath.split("/").filter(Boolean)
  if (segments.length === 0) return
  const fileName = segments.pop() || ""
  const parentPath = segments.length > 0 ? `/${segments.join("/")}` : "/"

  let res
  try {
    res = await client.listDirectory(parentPath)
  } catch (err: unknown) {
    if (err instanceof ServerInfrastructureError) throw err
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.",
      `Symlink safety check failed while listing parent directory=${parentPath} for fullPath=${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!res || !res.data || !Array.isArray(res.data)) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.",
      `Invalid directory response structure during symlink verification for fullPath=${fullPath}`,
    )
  }

  const item = res.data.find((i) => i && i.attributes && i.attributes.name === fileName)

  if (!item) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "No se pudo verificar este archivo de forma segura. Inténtalo de nuevo.",
      `Target file=${fileName} not found in parent directory=${parentPath} for fullPath=${fullPath}`,
    )
  }

  if (item.attributes.is_symlink || item.attributes.mimetype === "symlink") {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "No se puede abrir este enlace desde HiKAT por seguridad.",
      `Access blocked for symlink target at fullPath=${fullPath}`,
    )
  }
}

/**
 * Resolves a safe sandboxed path for Pterodactyl.
 */
async function resolveSafePath(
  env: Env,
  root: ServerFileRoot,
  relativePath?: string | null,
  client?: IPterodactylClient,
): Promise<string> {
  const worldName = root === "WORLD" ? await detectActiveWorldName(env, client) : "world"
  const check = sanitizeVirtualPath(root, relativePath, worldName)
  if (!check.valid || check.fullPath === undefined) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      check.error || "Ruta de archivo no permitida.",
      `Virtual path validation failed for root=${root}, relativePath=${relativePath}`,
    )
  }
  return check.fullPath
}

/**
 * Lists files and directories in a sandboxed virtual root.
 */
export async function listServerFiles(
  env: Env,
  root: ServerFileRoot,
  relativePath?: string | null,
  clientOverride?: IPterodactylClient,
): Promise<ServerFileItemData[]> {
  const client = clientOverride || createPterodactylClient(env)
  const fullPath = await resolveSafePath(env, root, relativePath, client)

  const res = await client.listDirectory(fullPath)
  if (!res || !res.data || !Array.isArray(res.data)) {
    return []
  }

  return res.data.map((item) => {
    const isSymlink = Boolean(item.attributes.is_symlink || item.attributes.mimetype === "symlink")
    // Fail closed for symlinks: if it's a symlink, treat as file so client cannot navigate into it as a directory
    const isFile = item.attributes.is_file || isSymlink
    return {
      name: item.attributes.name,
      isFile,
      isSymlink,
      sizeBytes: item.attributes.size ?? 0,
      mimeType: item.attributes.mimetype || null,
      modifiedAt: item.attributes.modified_at || item.attributes.created_at || new Date().toISOString(),
    }
  })
}

/**
 * Reads a text file within a sandboxed virtual root.
 */
export async function readServerTextFile(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  clientOverride?: IPterodactylClient,
): Promise<ServerFileContentData> {
  const client = clientOverride || createPterodactylClient(env)

  if (!isAllowlistedTextFile(relativePath)) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El tipo de archivo no está permitido para edición o lectura de texto.",
    )
  }

  const fullPath = await resolveSafePath(env, root, relativePath, client)
  await verifyNotSymlink(client, fullPath)
  const content = await client.getFileContents(fullPath)

  const encoder = new TextEncoder()
  const bytes = encoder.encode(content).length

  if (bytes > MAX_TEXT_FILE_SIZE_BYTES) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El archivo excede el tamaño máximo permitido para edición (256 KB).",
    )
  }

  return {
    content,
    sizeBytes: bytes,
  }
}

/**
 * Writes content to a text file within a sandboxed virtual root.
 */
export async function writeServerTextFile(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  content: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  if (!isAllowlistedTextFile(relativePath)) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El tipo de archivo no está permitido para edición.",
    )
  }

  const encoder = new TextEncoder()
  const bytes = encoder.encode(content || "").length

  if (bytes > MAX_TEXT_FILE_SIZE_BYTES) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El contenido excede el tamaño máximo permitido (256 KB).",
    )
  }

  const fullPath = await resolveSafePath(env, root, relativePath, client)
  await verifyNotSymlink(client, fullPath)
  await client.writeFile(fullPath, content || "")
  return true
}

/**
 * Creates a folder within a sandboxed virtual root.
 */
export async function createServerFolder(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  folderName: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  const cleanFolderName = folderName.trim().replace(/[/\\:*?"<>|\x00-\x1F]/g, "").replace(/\.\.+/g, "")
  if (!cleanFolderName) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Nombre de carpeta no válido.",
    )
  }

  const fullPath = await resolveSafePath(env, root, relativePath, client)
  await client.createFolder(fullPath, cleanFolderName)
  return true
}

/**
 * Renames a file or folder within a sandboxed virtual root.
 */
export async function renameServerFile(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  newName: string,
  clientOverride?: IPterodactylClient,
  db?: Database,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)

  const cleanNewName = newName.trim().replace(/[/\\:*?"<>|\x00-\x1F]/g, "").replace(/\.\.+/g, "")
  if (!cleanNewName) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El nuevo nombre no es válido.",
    )
  }

  const fullPath = await resolveSafePath(env, root, relativePath, client)
  const segments = fullPath.split("/").filter(Boolean)
  const oldName = segments.pop() || ""
  const parentPath = segments.length > 0 ? `/${segments.join("/")}` : "/"

  // Block renaming managed content
  if (db) {
    const cleanRelative = relativePath.replace(/^\/+/, "")
    const fileName = cleanRelative.split("/").pop() || cleanRelative
    const managed = await db
      .select()
      .from(schema.serverManagedContent)
      .all()

    const match = managed.find(
      (m) =>
        m.targetPath === cleanRelative ||
        m.targetPath === `mods/${cleanRelative}` ||
        m.targetPath.endsWith(`/${fileName}`) ||
        m.targetPath === fileName ||
        m.targetPath === `mods/${fileName}`,
    )

    if (match) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "No se pueden renombrar archivos administrados por HiKAT.",
      )
    }
  }

  await client.renameFile(parentPath, oldName, cleanNewName)
  return true
}

/**
 * Safely deletes a file from Wings while strictly verifying physical existence.
 * Returns { success: true, wasMissing: boolean }.
 * If the file was confirmed missing in parent directory listing -> wasMissing: true, success: true.
 * If file was found and deleted successfully -> wasMissing: false, success: true.
 * If listing or deletion fails with network/server error -> throws ServerInfrastructureError (fail-closed).
 */
export async function safeDeleteServerFilePhysical(
  client: IPterodactylClient,
  parentPath: string,
  fileName: string,
): Promise<{ success: boolean; wasMissing: boolean }> {
  if (typeof client.listDirectory === "function") {
    let listRes
    try {
      listRes = await client.listDirectory(parentPath)
    } catch (err: unknown) {
      if (err instanceof ServerInfrastructureError) throw err
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        `No se pudo verificar el directorio ${parentPath} antes de eliminar ${fileName}.`,
        `Safe delete directory check failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const items = listRes?.data || []
    const item = items.find((i) => i && i.attributes && i.attributes.name === fileName)

    if (!item) {
      // Confirmed physically absent
      return { success: true, wasMissing: true }
    }
  }

  // File exists physically (or listDirectory is not provided) -> delete
  try {
    await client.deleteFiles(parentPath, [fileName])
  } catch (err: unknown) {
    if (err instanceof ServerInfrastructureError) throw err
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      `Error al eliminar físicamente ${fileName} de ${parentPath}.`,
      `Safe delete execution failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return { success: true, wasMissing: false }
}

/**
 * Safely downloads a file from Wings via signed download URL and computes its SHA-256 hash.
 * Returns lowercase hex SHA-256 string, or null if download/verification fails.
 */
export async function getPhysicalFileSha256(
  client: IPterodactylClient,
  filePath: string,
): Promise<string | null> {
  try {
    const cleanPath = filePath.startsWith("/") ? filePath : `/${filePath}`
    const signedUrlRes = await client.getFileDownload(cleanPath)
    if (!signedUrlRes?.attributes?.url) return null
    const response = await fetch(signedUrlRes.attributes.url)
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    const hashBuf = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase()
  } catch {
    return null
  }
}

/**
 * Deletes a file or directory within a sandboxed virtual root.
 */
export async function deleteServerFile(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  clientOverride?: IPterodactylClient,
  db?: Database,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)
  const fullPath = await resolveSafePath(env, root, relativePath, client)

  const segments = fullPath.split("/").filter(Boolean)
  const fileName = segments.pop() || ""
  const parentPath = segments.length > 0 ? `/${segments.join("/")}` : "/"

  if (db) {
    const cleanRelative = relativePath.replace(/^\/+/, "")
    const simpleFileName = cleanRelative.split("/").pop() || cleanRelative
    const managed = await db
      .select()
      .from(schema.serverManagedContent)
      .all()

    const match = managed.find(
      (m) =>
        m.targetPath === cleanRelative ||
        m.targetPath === `mods/${cleanRelative}` ||
        m.targetPath.endsWith(`/${simpleFileName}`) ||
        m.targetPath === simpleFileName ||
        m.targetPath === `mods/${simpleFileName}`,
    )

    if (match) {
      if (match.managementSource === "GAME_RELEASE") {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          "Este archivo pertenece a la release del modpack. Modifícalo desde Juego → Actualizaciones.",
        )
      }

      // If SERVER_DIRECT: proceed with safe physical deletion and cascade remove D1 record only on success
      await safeDeleteServerFilePhysical(client, parentPath, fileName)
      await db
        .delete(schema.serverManagedContent)
        .where(eq(schema.serverManagedContent.id, match.id))
      return true
    }
  }

  await client.deleteFiles(parentPath, [fileName])
  return true
}

/**
 * Prepares a signed upload URL for a sandboxed virtual root.
 */
export async function prepareServerFileUploadUrl(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  clientOverride?: IPterodactylClient,
): Promise<{ url: string }> {
  const client = clientOverride || createPterodactylClient(env)
  // Ensure path is valid and resolved within virtual sandbox (blocks traversal ../)
  const fullPath = await resolveSafePath(env, root, relativePath, client)
  const res = await client.getFileUploadUrl()
  const separator = res.attributes.url.includes("?") ? "&" : "?"
  return { url: `${res.attributes.url}${separator}directory=${encodeURIComponent(fullPath)}` }
}

/**
 * Generates a signed download URL for a file in a sandboxed virtual root.
 */
export async function createServerFileDownloadUrl(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  clientOverride?: IPterodactylClient,
): Promise<{ url: string }> {
  const client = clientOverride || createPterodactylClient(env)
  const fullPath = await resolveSafePath(env, root, relativePath, client)
  await verifyNotSymlink(client, fullPath)
  const res = await client.getFileDownload(fullPath)
  return { url: res.attributes.url }
}
