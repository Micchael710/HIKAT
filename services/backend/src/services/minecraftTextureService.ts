/**
 * HiKAT Minecraft Texture Delivery Service
 * Public endpoints for Custom Skin Loader:
 * - GET /minecraft/skins/:username.png
 * - GET /minecraft/capes/:username.png
 *
 * Dynamically resolves player's active skin or cape in real time
 * directly from D1 and streams the binary PNG from Cloudflare R2 ASSETS.
 */

import { sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import type { Env } from "../types"
import { getCorsHeaders } from "../cors"
import { getMyActiveSkin } from "./skinService"
import { getMyActiveCape } from "./capeService"
import { getContentMediaById } from "./mediaService"

/**
 * Validates a Minecraft username (1-16 characters, alphanumeric or underscore).
 */
export function isValidMinecraftUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{1,16}$/.test(username)
}

/**
 * Helper to fetch a PNG binary stream from R2 and serve it with no-store cache headers.
 */
async function serveMediaPng(
  request: Request,
  env: Env,
  db: Database,
  mediaId: string,
): Promise<Response> {
  const cors = getCorsHeaders(request, env)
  const media = await getContentMediaById(db, mediaId)
  if (!media) {
    return new Response(JSON.stringify({ error: "Media not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  if (!env.ASSETS) {
    return new Response(JSON.stringify({ error: "Storage bucket unavailable" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const object = await env.ASSETS.get(media.objectKey)
  if (!object) {
    return new Response(JSON.stringify({ error: "Media object not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const headers = new Headers()
  headers.set("Content-Type", "image/png")
  headers.set("Content-Length", String(media.sizeBytes || object.size))
  headers.set("Cache-Control", "no-store")
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v)
  }

  return new Response(object.body, {
    status: 200,
    headers,
  })
}

/**
 * Handles public texture serving: GET /minecraft/skins/:username.png
 * Dynamically resolves the active skin for the player and streams the PNG from R2.
 */
export async function handleMinecraftSkinServe(
  request: Request,
  env: Env,
  db: Database | undefined,
  usernameParam?: string,
): Promise<Response> {
  const cors = getCorsHeaders(request, env)

  let username = (usernameParam ?? "").trim()
  if (username.toLowerCase().endsWith(".png")) {
    username = username.slice(0, -4)
  }
  if (!username) {
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/minecraft\/skins\/(.+)\.png$/i)
    username = match?.[1] || ""
  }

  if (!isValidMinecraftUsername(username)) {
    return new Response(JSON.stringify({ error: "Invalid username or skin not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  if (!db) {
    return new Response(JSON.stringify({ error: "Database unavailable" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const user = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(sql`lower(${schema.users.displayName}) = lower(${username})`)
    .get()

  if (!user || !user.displayName) {
    return new Response(JSON.stringify({ error: "Player not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const activeSkin = await getMyActiveSkin(db, env, user.id)
  if (!activeSkin || !activeSkin.imageUrl) {
    return new Response(JSON.stringify({ error: "Active skin not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const mediaId = activeSkin.imageUrl.replace(/^\/media\/content\//, "")
  return serveMediaPng(request, env, db, mediaId)
}

/**
 * Handles public texture serving: GET /minecraft/capes/:username.png
 * Dynamically resolves the active cape for the player and streams the PNG from R2.
 */
export async function handleMinecraftCapeServe(
  request: Request,
  env: Env,
  db: Database | undefined,
  usernameParam?: string,
): Promise<Response> {
  const cors = getCorsHeaders(request, env)

  let username = (usernameParam ?? "").trim()
  if (username.toLowerCase().endsWith(".png")) {
    username = username.slice(0, -4)
  }
  if (!username) {
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/minecraft\/capes\/(.+)\.png$/i)
    username = match?.[1] || ""
  }

  if (!isValidMinecraftUsername(username)) {
    return new Response(JSON.stringify({ error: "Invalid username or cape not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  if (!db) {
    return new Response(JSON.stringify({ error: "Database unavailable" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const user = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(sql`lower(${schema.users.displayName}) = lower(${username})`)
    .get()

  if (!user || !user.displayName) {
    return new Response(JSON.stringify({ error: "Player not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const activeCape = await getMyActiveCape(db, env, user.id)
  if (!activeCape || activeCape.type === "NONE" || !activeCape.imageUrl) {
    return new Response(JSON.stringify({ error: "Active cape not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    })
  }

  const mediaId = activeCape.imageUrl.replace(/^\/media\/content\//, "")
  return serveMediaPng(request, env, db, mediaId)
}
