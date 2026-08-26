import { eq, and } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import {
  validateGameFileBuffer,
  sanitizeGameFileName,
  type GameFileCategory,
  MAX_GAME_FILE_SIZE_BYTES,
} from "@hikat/shared"
import type { Env, BackendGraphQLContext } from "../../types"
import { getCorsHeaders } from "../../cors"

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  request: Request,
  env: Env,
): Response {
  const cors = getCorsHeaders(request, env)
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...cors,
    },
  })
}

/**
 * Handles binary game file uploads: PUT /game/files/upload
 * Requires:
 *  - Active ADMIN session Bearer token
 *  - X-Upload-Token header matching valid game_file_upload_tokens row
 */
export async function handleGameFileUpload(
  request: Request,
  env: Env,
  db: Database | undefined,
  context: BackendGraphQLContext,
): Promise<Response> {
  if (!db || !env.ASSETS) {
    return jsonResponse({ error: "Storage or database service unavailable." }, 503, request, env)
  }

  // 1. Authorization guard: ADMIN only
  if (context.auth.status !== "authenticated" || context.auth.identity.role !== "ADMIN") {
    return jsonResponse({ error: "No autorizado para subir archivos de juego." }, 403, request, env)
  }


  // 2. Validate X-Upload-Token header
  const rawToken = request.headers.get("X-Upload-Token")?.trim()
  if (!rawToken) {
    return jsonResponse({ error: "Cabecera X-Upload-Token requerida." }, 400, request, env)
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

  if (!tokenRecord) {
    return jsonResponse({ error: "Token de subida no válido o desconocido." }, 400, request, env)
  }

  if (tokenRecord.usedAt) {
    return jsonResponse({ error: "El token de subida ya fue utilizado." }, 409, request, env)
  }

  if (new Date(tokenRecord.expiresAt) < new Date()) {
    return jsonResponse({ error: "El token de subida ha expirado." }, 410, request, env)
  }

  // 3. Read binary body with limit
  if (!request.body) {
    return jsonResponse({ error: "El cuerpo de la petición está vacío." }, 400, request, env)
  }

  const arrayBuffer = await request.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    return jsonResponse({ error: "El archivo enviado está vacío." }, 400, request, env)
  }
  if (arrayBuffer.byteLength > MAX_GAME_FILE_SIZE_BYTES) {
    return jsonResponse({ error: "El archivo excede el tamaño máximo permitido (100 MB)." }, 413, request, env)
  }

  // 4. Validate binary content format
  const category = tokenRecord.category as GameFileCategory
  const validation = validateGameFileBuffer(arrayBuffer, tokenRecord.originalFilename, category)
  if (!validation.valid) {
    return jsonResponse({ error: validation.error || "Formato de archivo inválido." }, 400, request, env)
  }

  // 5. Compute SHA-256 hash
  const shaBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer)
  const sha256 = Array.from(new Uint8Array(shaBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase()

  // 6. Generate immutable R2 object key
  const fileId = crypto.randomUUID()
  const objectKey = `game-files/${fileId}-${sha256.slice(0, 16)}`

  // 7. Store in R2
  await env.ASSETS.put(objectKey, arrayBuffer, {
    httpMetadata: {
      contentType: category === "MOD" ? "application/java-archive" : "application/zip",
    },
    customMetadata: {
      sha256,
      category,
      originalFilename: tokenRecord.originalFilename,
    },
  })

  // 8. Atomically mark upload token as used and record immutable storage metadata
  await db
    .update(schema.gameFileUploadTokens)
    .set({
      usedAt: new Date().toISOString(),
      sha256,
      objectKey,
      uploadedSizeBytes: arrayBuffer.byteLength,
    })
    .where(eq(schema.gameFileUploadTokens.id, tokenRecord.id))


  const cors = getCorsHeaders(request, env)
  return new Response(
    JSON.stringify({
      id: fileId,
      tokenHash,
      originalFilename: tokenRecord.originalFilename,
      category,
      sizeBytes: arrayBuffer.byteLength,
      sha256,
      objectKey,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...cors,
      },
    },
  )
}

/**
 * Handles binary game file downloads: GET /game/download/:fileId
 * Public endpoint: strictly allows downloading files belonging to a PUBLISHED release.
 */
export async function handleGameFileDownload(
  request: Request,
  env: Env,
  db: Database | undefined,
  fileId: string,
): Promise<Response> {
  const cors = getCorsHeaders(request, env)

  if (!db || !env.ASSETS) {
    return new Response(JSON.stringify({ error: "Storage or database service unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...cors },
    })
  }

  // 1. Verify that fileId belongs to a currently PUBLISHED release
  const fileRecord = await db
    .select({
      file: schema.gameReleaseFiles,
      releaseStatus: schema.gameReleases.status,
    })
    .from(schema.gameReleaseFiles)
    .innerJoin(
      schema.gameReleases,
      eq(schema.gameReleaseFiles.releaseId, schema.gameReleases.id),
    )
    .where(
      and(
        eq(schema.gameReleaseFiles.id, fileId),
        eq(schema.gameReleases.status, "PUBLISHED"),
      ),
    )
    .get()

  if (!fileRecord) {
    return new Response(JSON.stringify({ error: "Archivo de juego no encontrado o no disponible públicamente." }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors },
    })
  }

  // 2. Fetch object from R2
  const r2Object = await env.ASSETS.get(fileRecord.file.objectKey)
  if (!r2Object) {
    return new Response(JSON.stringify({ error: "Objeto de archivo no encontrado en el almacenamiento." }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors },
    })
  }

  const filename = fileRecord.file.logicalPath.split("/").pop() || "game-file.jar"
  const contentType =
    fileRecord.file.category === "MOD"
      ? "application/java-archive"
      : fileRecord.file.category === "RESOURCE_PACK" || fileRecord.file.category === "SHADER_PACK"
      ? "application/zip"
      : "application/octet-stream"

  // 3. Check client If-None-Match header
  const clientEtag = request.headers.get("if-none-match")?.replace(/^W\//, "").replace(/"/g, "")
  if (clientEtag && clientEtag.toLowerCase() === fileRecord.file.sha256.toLowerCase()) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: `"${fileRecord.file.sha256}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...cors,
      },
    })
  }

  const headers = new Headers()
  headers.set("Content-Type", contentType)
  headers.set("Content-Disposition", `attachment; filename="${filename}"`)
  headers.set("Content-Length", String(fileRecord.file.sizeBytes))
  headers.set("ETag", `"${fileRecord.file.sha256}"`)
  headers.set("Cache-Control", "public, max-age=31536000, immutable")
  headers.set("Access-Control-Allow-Origin", "*")

  return new Response(r2Object.body, {
    status: 200,
    headers,
  })
}
