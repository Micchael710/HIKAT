/**
 * HiKAT Launcher Auto-Update HTTP Transport
 * Serves /launcher/update/latest.yml and /launcher/update/download/<filename>
 * for electron-updater compatibility.
 */

import { eq, and, inArray } from "drizzle-orm"
import { Database, launcherReleases } from "@hikat/database"
import type { Env } from "../types"

export async function handleLatestYaml(
  _request: Request,
  _env: Env,
  db: Database | undefined,
): Promise<Response> {
  if (!db) {
    return new Response("Database not available", { status: 503 })
  }

  const published = await db
    .select()
    .from(launcherReleases)
    .where(eq(launcherReleases.status, "PUBLISHED"))
    .limit(1)

  if (published.length === 0 || !published[0]) {
    return new Response("No published launcher release found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    })
  }

  const release = published[0]
  const encodedFilename = encodeURIComponent(release.filename)
  const releaseDate = release.publishedAt || release.createdAt

  const yamlContent = [
    `version: ${release.version}`,
    `files:`,
    `  - url: download/${encodedFilename}`,
    `    sha512: ${release.sha512}`,
    `    size: ${release.sizeBytes}`,
    `path: ${release.filename}`,
    `sha512: ${release.sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n")

  return new Response(yamlContent, {
    status: 200,
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

export async function handleLauncherBinaryDownload(
  request: Request,
  env: Env,
  db: Database | undefined,
  rawFilename: string,
): Promise<Response> {
  if (!db) {
    return new Response("Database not available", { status: 503 })
  }

  let filename: string
  try {
    const decoded = decodeURIComponent(rawFilename).trim()
    if (
      decoded.includes("..") ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      return new Response("Forbidden", { status: 403 })
    }
    filename = decoded
  } catch {
    return new Response("Invalid filename encoding", { status: 400 })
  }

  // Strict security barriers:
  if (!filename) {
    return new Response("Forbidden", { status: 403 })
  }

  // 2. Query D1 strictly for registered releases with status PUBLISHED or ARCHIVED
  const matches = await db
    .select()
    .from(launcherReleases)
    .where(
      and(
        eq(launcherReleases.filename, filename),
        inArray(launcherReleases.status, ["PUBLISHED", "ARCHIVED"]),
      ),
    )
    .limit(1)

  // 3. If no matching registered release in D1, 404 immediately without touching R2
  if (matches.length === 0 || !matches[0]) {
    return new Response("Release binary not found", { status: 404 })
  }

  const release = matches[0]
  const totalSizeBytes = release.sizeBytes

  if (request.method === "HEAD") {
    const headers = new Headers()
    headers.set("Content-Type", "application/octet-stream")
    headers.set("Content-Disposition", `attachment; filename="${release.filename}"`)
    headers.set("Content-Length", String(totalSizeBytes))
    headers.set("Accept-Ranges", "bytes")
    headers.set("Cache-Control", "public, max-age=86400")
    headers.set("Access-Control-Allow-Origin", "*")
    return new Response(null, { status: 200, headers })
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (!env.ASSETS) {
    return new Response("Storage not configured", { status: 503 })
  }

  // 4. Handle HTTP Range requests for resume capability
  const rangeHeader = request.headers.get("Range")
  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/)
    if (match && match[1]) {
      const start = parseInt(match[1], 10)
      const end = match[2] ? parseInt(match[2], 10) : totalSizeBytes - 1

      if (isNaN(start) || start >= totalSizeBytes || end < start || end >= totalSizeBytes) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSizeBytes}`,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
          },
        })
      }

      const contentLength = end - start + 1
      const r2Object = await env.ASSETS.get(release.objectKey, {
        range: { offset: start, length: contentLength },
      })

      if (!r2Object) {
        return new Response("Object missing from storage", { status: 404 })
      }

      const headers = new Headers()
      headers.set("Content-Type", "application/octet-stream")
      headers.set("Content-Disposition", `attachment; filename="${release.filename}"`)
      headers.set("Content-Range", `bytes ${start}-${end}/${totalSizeBytes}`)
      headers.set("Content-Length", String(contentLength))
      headers.set("Accept-Ranges", "bytes")
      headers.set("Cache-Control", "public, max-age=86400")
      headers.set("Access-Control-Allow-Origin", "*")

      return new Response(r2Object.body, {
        status: 206,
        headers,
      })
    }
  }

  // 5. Full download (200 OK)
  const r2Object = await env.ASSETS.get(release.objectKey)
  if (!r2Object) {
    return new Response("Object missing from storage", { status: 404 })
  }

  const headers = new Headers()
  headers.set("Content-Type", "application/octet-stream")
  headers.set("Content-Disposition", `attachment; filename="${release.filename}"`)
  headers.set("Content-Length", String(totalSizeBytes))
  headers.set("Accept-Ranges", "bytes")
  headers.set("Cache-Control", "public, max-age=86400")
  headers.set("Access-Control-Allow-Origin", "*")

  return new Response(r2Object.body, {
    status: 200,
    headers,
  })
}
