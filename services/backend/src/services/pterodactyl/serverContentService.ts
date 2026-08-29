import { eq, and } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  ServerManagedContentItemGql,
  InstallServerContentPlanInputGql,
} from "@hikat/graphql"
import {
  MAX_GAME_FILE_SIZE_BYTES,
  validateGameFileBuffer,
} from "@hikat/shared"
import type { Env } from "../../types"
import { IPterodactylClient } from "./types"
import { createPterodactylClient } from "./serverAdministrationService"
import { detectActiveWorldName } from "./serverWorldService"
import { modProviderManager, getLogicalPathForServerContent } from "../providers/modProviderManager"

function computeMd5Hex(data: Uint8Array): string {
  function md5cycle(x: Int32Array, k: Int32Array) {
    let a = x[0]!, b = x[1]!, c = x[2]!, d = x[3]!
    a = ff(a, b, c, d, k[0]!, 7, -680876936); d = ff(d, a, b, c, k[1]!, 12, -389564586); c = ff(c, d, a, b, k[2]!, 17, 606105819); b = ff(b, c, d, a, k[3]!, 22, -1044525330)
    a = ff(a, b, c, d, k[4]!, 7, -176418897); d = ff(d, a, b, c, k[5]!, 12, 1200080426); c = ff(c, d, a, b, k[6]!, 17, -1473231341); b = ff(b, c, d, a, k[7]!, 22, -45705983)
    a = ff(a, b, c, d, k[8]!, 7, 1770035416); d = ff(d, a, b, c, k[9]!, 12, -1958414417); c = ff(c, d, a, b, k[10]!, 17, -42063); b = ff(b, c, d, a, k[11]!, 22, -1990404162)
    a = ff(a, b, c, d, k[12]!, 7, 1804603682); d = ff(d, a, b, c, k[13]!, 12, -40341101); c = ff(c, d, a, b, k[14]!, 17, -1502002290); b = ff(b, c, d, a, k[15]!, 22, 1236535329)
    a = gg(a, b, c, d, k[1]!, 5, -165796510); d = gg(d, a, b, c, k[6]!, 9, -1069501632); c = gg(c, d, a, b, k[11]!, 14, 643717713); b = gg(b, c, d, a, k[0]!, 20, -373897302)
    a = gg(a, b, c, d, k[5]!, 5, -701558691); d = gg(d, a, b, c, k[10]!, 9, 38016083); c = gg(c, d, a, b, k[15]!, 14, -660478335); b = gg(b, c, d, a, k[4]!, 20, -405537848)
    a = gg(a, b, c, d, k[9]!, 5, 568446438); d = gg(d, a, b, c, k[14]!, 9, -1019803690); c = gg(c, d, a, b, k[3]!, 14, -187363961); b = gg(b, c, d, a, k[8]!, 20, 1163531501)
    a = gg(a, b, c, d, k[13]!, 5, -1444681467); d = gg(d, a, b, c, k[2]!, 9, -51403784); c = gg(c, d, a, b, k[7]!, 14, 1735328473); b = gg(b, c, d, a, k[12]!, 20, -1926607734)
    a = hh(a, b, c, d, k[5]!, 4, -378558); d = hh(d, a, b, c, k[8]!, 11, -2022574463); c = hh(c, d, a, b, k[11]!, 16, 1839030562); b = hh(b, c, d, a, k[14]!, 23, -35309556)
    a = hh(a, b, c, d, k[1]!, 4, -1530992060); d = hh(d, a, b, c, k[4]!, 11, 1272893353); c = hh(c, d, a, b, k[7]!, 16, -155497632); b = hh(b, c, d, a, k[10]!, 23, -1094730640)
    a = hh(a, b, c, d, k[13]!, 4, 681279174); d = hh(d, a, b, c, k[0]!, 11, -358537222); c = hh(c, d, a, b, k[3]!, 16, -722521979); b = hh(b, c, d, a, k[6]!, 23, 76029189)
    a = hh(a, b, c, d, k[9]!, 4, -640364487); d = hh(d, a, b, c, k[12]!, 11, -421815835); c = hh(c, d, a, b, k[15]!, 16, 530742520); b = hh(b, c, d, a, k[2]!, 23, -995338651)
    a = ii(a, b, c, d, k[0]!, 6, -198630844); d = ii(d, a, b, c, k[7]!, 10, 1126891415); c = ii(c, d, a, b, k[14]!, 15, -1416354905); b = ii(b, c, d, a, k[5]!, 21, -57434055)
    a = ii(a, b, c, d, k[12]!, 6, 1700485571); d = ii(d, a, b, c, k[3]!, 10, -1894986606); c = ii(c, d, a, b, k[10]!, 15, -1051523); b = ii(b, c, d, a, k[1]!, 21, -2054922799)
    a = ii(a, b, c, d, k[8]!, 6, 1873313359); d = ii(d, a, b, c, k[15]!, 10, -30611744); c = ii(c, d, a, b, k[6]!, 15, -1560198380); b = ii(b, c, d, a, k[13]!, 21, 1309151649)
    a = ii(a, b, c, d, k[4]!, 6, -145523070); d = ii(d, a, b, c, k[11]!, 10, -1120210379); c = ii(c, d, a, b, k[2]!, 15, 718787259); b = ii(b, c, d, a, k[9]!, 21, -343485551)
    x[0] = add32(a, x[0]!); x[1] = add32(b, x[1]!); x[2] = add32(c, x[2]!); x[3] = add32(d, x[3]!)
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t))
    return add32((a << s) | (a >>> (32 - s)), b)
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | ((~b) & d), a, b, x, s, t) }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & (~d)), a, b, x, s, t) }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t) }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | (~d)), a, b, x, s, t) }
  function add32(a: number, b: number) { return (a + b) & 0xFFFFFFFF }

  const n = data.length
  const state = new Int32Array([1732584193, -271733879, -1732584194, 271733878])
  const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  let i = 0
  for (; i + 64 <= n; i += 64) {
    const block = new Int32Array(16)
    for (let j = 0; j < 16; j++) {
      const idx = i + j * 4
      block[j] = data[idx]! | (data[idx + 1]! << 8) | (data[idx + 2]! << 16) | (data[idx + 3]! << 24)
    }
    md5cycle(state, block)
  }
  for (let j = 0; i < n; i++, j++) {
    tail[j >> 2] = (tail[j >> 2] || 0) | (data[i]! << ((j % 4) << 3))
  }
  const j = n - (i - (n % 64))
  tail[j >> 2] = (tail[j >> 2] || 0) | (0x80 << ((j % 4) << 3))
  if (j > 55) {
    md5cycle(state, new Int32Array(tail))
    for (let k = 0; k < 16; k++) tail[k] = 0
  }
  tail[14] = (n * 8) & 0xFFFFFFFF
  tail[15] = Math.floor((n * 8) / 0x100000000)
  md5cycle(state, new Int32Array(tail))

  let hex = ""
  for (let k = 0; k < 4; k++) {
    for (let b = 0; b < 4; b++) {
      hex += ((state[k]! >> (b * 8)) & 0xFF).toString(16).padStart(2, "0")
    }
  }
  return hex.toLowerCase()
}

/**
 * Lists physical files from Wings for mods and datapacks directories.
 */
async function getPhysicalServerFilesSet(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<{ physicalPaths: Set<string>; worldName: string }> {
  const client = clientOverride || createPterodactylClient(env)
  const worldName = await detectActiveWorldName(env, client)
  const physicalPaths = new Set<string>()

  // 1. List /mods
  try {
    const modsRes = await client.listDirectory("/mods")
    if (modsRes && modsRes.data && Array.isArray(modsRes.data)) {
      for (const item of modsRes.data) {
        if (item?.attributes?.name && item.attributes.is_file) {
          physicalPaths.add(`mods/${item.attributes.name}`)
        }
      }
    }
  } catch {
    // If /mods directory does not exist or fails to list, ignore
  }

  // 2. List /<worldName>/datapacks
  try {
    const dpRes = await client.listDirectory(`/${worldName}/datapacks`)
    if (dpRes && dpRes.data && Array.isArray(dpRes.data)) {
      for (const item of dpRes.data) {
        if (item?.attributes?.name && item.attributes.is_file) {
          physicalPaths.add(`${worldName}/datapacks/${item.attributes.name}`)
          // Also record normalized datapacks/<name> for robust matching
          physicalPaths.add(`datapacks/${item.attributes.name}`)
        }
      }
    }
  } catch {
    // If datapacks directory does not exist, ignore
  }

  return { physicalPaths, worldName }
}

/**
 * Returns all server managed content items with drift detection (INSTALLED vs MISSING).
 */
export async function getServerManagedContent(
  db: Database,
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerManagedContentItemGql[]> {
  const records = await db
    .select()
    .from(schema.serverManagedContent)
    .all()

  if (records.length === 0) {
    return []
  }

  let physicalPaths = new Set<string>()
  let worldName = "world"
  try {
    const res = await getPhysicalServerFilesSet(env, clientOverride)
    physicalPaths = res.physicalPaths
    worldName = res.worldName
  } catch {
    // If server is unavailable, mark status as INSTALLED or MISSING based on cached info without throwing
  }

  return records.map((record) => {
    const cleanPath = record.targetPath.replace(/^\/+/, "")
    const fileName = cleanPath.split("/").pop() || cleanPath

    // Check physical presence
    const isPhysical =
      physicalPaths.has(cleanPath) ||
      physicalPaths.has(`mods/${fileName}`) ||
      physicalPaths.has(`${worldName}/datapacks/${fileName}`) ||
      physicalPaths.has(`datapacks/${fileName}`)

    return {
      id: record.id,
      name: fileName,
      managementSource: record.managementSource as any,
      provider: record.provider as any,
      projectId: record.projectId,
      versionId: record.versionId,
      fileId: record.fileId,
      contentType: record.contentType as any,
      environment: record.environment as any,
      targetPath: record.targetPath,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes,
      status: isPhysical ? "INSTALLED" : "MISSING",
      gameReleaseId: record.gameReleaseId,
      gameReleaseFileId: record.gameReleaseFileId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  })
}

/**
 * Installs server content plan (MOD SERVER or DATA_PACK) directly to Wings and tracks in D1.
 */
export async function installServerContentPlan(
  db: Database,
  env: Env,
  input: InstallServerContentPlanInputGql,
  userId: string,
  clientOverride?: IPterodactylClient,
): Promise<ServerManagedContentItemGql[]> {
  const plan = await modProviderManager.resolveServerInstallationPlan(env, db, input)

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
    return getServerManagedContent(db, env, clientOverride)
  }

  const client = clientOverride || createPterodactylClient(env)
  const worldName = await detectActiveWorldName(env, client)
  const { physicalPaths } = await getPhysicalServerFilesSet(env, client)

  const managedRecords = await db
    .select()
    .from(schema.serverManagedContent)
    .all()

  // Preflight check: path collisions
  for (const item of itemsToProcess) {
    const targetPath = item.targetPath || getLogicalPathForServerContent(item.contentType, item.filename, worldName)
    const fileName = targetPath.split("/").pop() || item.filename

    const isPhysical =
      physicalPaths.has(targetPath) ||
      physicalPaths.has(`mods/${fileName}`) ||
      physicalPaths.has(`${worldName}/datapacks/${fileName}`) ||
      physicalPaths.has(`datapacks/${fileName}`)

    if (isPhysical) {
      const tracked = managedRecords.find(
        (m) =>
          m.provider === item.provider &&
          m.projectId === item.projectId &&
          m.contentType === item.contentType,
      )

      if (!tracked) {
        throw createGraphQLError(
          `Ya existe un archivo manual en esta ruta (${targetPath}). HiKAT no lo reemplazará automáticamente.`,
          "CONFLICT",
        )
      }
    }
  }

  // Download, validate and write each item to Wings
  for (const item of itemsToProcess) {
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

    // Format & magic bytes validation
    const validationCategory = item.contentType === "DATA_PACK" ? "DATA_PACK" : "MOD"
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

    // SHA-256
    const shaBuffer = await crypto.subtle.digest("SHA-256", buffer.buffer as ArrayBuffer)
    const sha256 = Array.from(new Uint8Array(shaBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase()

    // Checksum verification
    if (versionObj?.hashes?.sha512) {
      const sha512Buffer = await crypto.subtle.digest("SHA-512", buffer.buffer as ArrayBuffer)
      const computedSha512 = Array.from(new Uint8Array(sha512Buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase()
      if (computedSha512 !== versionObj.hashes.sha512.toLowerCase()) {
        throw createGraphQLError(
          `Error de integridad: el hash SHA-512 descargado para "${item.projectName}" no coincide con el proveedor.`,
          "VALIDATION_ERROR",
        )
      }
    } else if (versionObj?.hashes?.sha1) {
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
    } else if (versionObj?.hashes?.md5) {
      const computedMd5 = computeMd5Hex(buffer)
      if (computedMd5 !== versionObj.hashes.md5.toLowerCase()) {
        throw createGraphQLError(
          `Error de integridad: el hash MD5 descargado para "${item.projectName}" no coincide con el proveedor.`,
          "VALIDATION_ERROR",
        )
      }
    }

    // Determine target full path on Wings
    const logicalTargetPath = getLogicalPathForServerContent(item.contentType, filename, worldName)
    const wingsFullPath = `/${logicalTargetPath}`

    // Ensure parent directory exists
    if (item.contentType === "DATA_PACK") {
      try {
        await client.createFolder(`/${worldName}`, "datapacks")
      } catch {
        // Directory may already exist
      }
    } else {
      try {
        await client.createFolder("/", "mods")
      } catch {
        // Directory may already exist
      }
    }

    // Write binary to Wings
    await client.writeFile(wingsFullPath, buffer)

    // Persist / update record in D1 ONLY AFTER physical write succeeds
    const now = new Date().toISOString()
    const existing = managedRecords.find(
      (m) =>
        m.provider === item.provider &&
        m.projectId === item.projectId &&
        m.contentType === item.contentType,
    )

    if (existing) {
      await db
        .update(schema.serverManagedContent)
        .set({
          versionId: item.versionId,
          fileId: item.fileId || null,
          targetPath: logicalTargetPath,
          sha256,
          sizeBytes: buffer.byteLength,
          updatedAt: now,
        })
        .where(eq(schema.serverManagedContent.id, existing.id))
    } else {
      await db.insert(schema.serverManagedContent).values({
        id: crypto.randomUUID(),
        managementSource: "SERVER_DIRECT",
        provider: item.provider,
        projectId: item.projectId,
        versionId: item.versionId,
        fileId: item.fileId || null,
        contentType: item.contentType,
        environment: item.environment || "SERVER",
        targetPath: logicalTargetPath,
        sha256,
        sizeBytes: buffer.byteLength,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return getServerManagedContent(db, env, clientOverride)
}

/**
 * Removes server direct managed content physically from Wings and deletes D1 record.
 */
export async function removeServerManagedContent(
  db: Database,
  env: Env,
  id: string,
  userId: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const record = await db
    .select()
    .from(schema.serverManagedContent)
    .where(eq(schema.serverManagedContent.id, id))
    .get()

  if (!record) {
    throw createGraphQLError("Contenido administrado no encontrado.", "NOT_FOUND")
  }

  if (record.managementSource === "GAME_RELEASE") {
    throw createGraphQLError(
      "Este archivo pertenece a la release del modpack. Modifícalo desde Juego → Actualizaciones.",
      "VALIDATION_ERROR",
    )
  }

  const client = clientOverride || createPterodactylClient(env)
  const segments = record.targetPath.replace(/^\/+/, "").split("/")
  const fileName = segments.pop() || ""
  const parentPath = segments.length > 0 ? `/${segments.join("/")}` : "/"

  // Delete physical file from Wings
  try {
    await client.deleteFiles(parentPath, [fileName])
  } catch {
    // If physical file is already gone, proceed with D1 cleanup
  }

  // Delete D1 record
  await db
    .delete(schema.serverManagedContent)
    .where(eq(schema.serverManagedContent.id, id))

  return true
}
