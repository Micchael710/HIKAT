import { eq, and } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import type { Env } from "../../types"
import { getCorsHeaders } from "../../cors"
import { isClientGameReleaseFile } from "./releaseService"
import { ensureSettingsRecord } from "../settingsService"



/**
 * Handles binary game file downloads: GET /game/download/:fileId
 * Public endpoint: strictly allows downloading files belonging to the active release (launcherActiveReleaseId).
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

  // 1. Fetch settings to get current launcherActiveReleaseId
  const settings = await ensureSettingsRecord(db)
  if (!settings.launcherActiveReleaseId) {
    return new Response(JSON.stringify({ error: "No hay ninguna versión activa actualmente." }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors },
    })
  }

  // 2. Verify that fileId belongs strictly to the currently active release for players
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
        eq(schema.gameReleaseFiles.releaseId, settings.launcherActiveReleaseId),
        eq(schema.gameReleaseFiles.isDirectory, 0),
      ),
    )
    .get()

  if (!fileRecord || !isClientGameReleaseFile(fileRecord.file)) {
    return new Response(JSON.stringify({ error: "Archivo de juego no encontrado o no disponible públicamente." }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors },
    })
  }

  // 3. Fetch object from R2
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

  // 4. Check client If-None-Match header
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
