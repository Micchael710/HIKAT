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

type BatchStatements = Parameters<Database["batch"]>[0]
type BatchStatement = BatchStatements[number]

function asBatchTuple(statements: BatchStatement[]): BatchStatements {
  return [statements[0]!, ...statements.slice(1)] as unknown as BatchStatements
}

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

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 45000)

        let buffer: Uint8Array
        try {
          // Binary download MUST NOT receive CurseForge API Key (external CDN security boundary)
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

        // Verify provider checksum if provided (SHA-512 -> SHA-1 -> MD5 fallback)
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
