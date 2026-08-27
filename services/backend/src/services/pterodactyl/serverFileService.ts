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
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { ServerInfrastructureError } from "./pterodactylClient"
import { createPterodactylClient } from "./serverAdministrationService"
import { detectActiveWorldName } from "./serverWorldService"

export interface ServerFileItemData {
  name: string
  isFile: boolean
  sizeBytes: number
  mimeType?: string | null
  modifiedAt: string
}

export interface ServerFileContentData {
  content: string
  sizeBytes: number
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
  if (!check.valid || !check.fullPath) {
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

  return res.data.map((item) => ({
    name: item.attributes.name,
    isFile: item.attributes.is_file,
    sizeBytes: item.attributes.size ?? 0,
    mimeType: item.attributes.mimetype || null,
    modifiedAt: item.attributes.modified_at || item.attributes.created_at || new Date().toISOString(),
  }))
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
  const segments = fullPath.split("/")
  const oldName = segments.pop() || ""
  const parentPath = segments.join("/") || "/"

  await client.renameFile(parentPath, oldName, cleanNewName)
  return true
}

/**
 * Deletes a file or directory within a sandboxed virtual root.
 */
export async function deleteServerFile(
  env: Env,
  root: ServerFileRoot,
  relativePath: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)
  const fullPath = await resolveSafePath(env, root, relativePath, client)

  const segments = fullPath.split("/")
  const fileName = segments.pop() || ""
  const parentPath = segments.join("/") || "/"

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
  const res = await client.getFileDownload(fullPath)
  return { url: res.attributes.url }
}
