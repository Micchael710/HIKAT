/**
 * HiKAT Backend CORS Strategy
 * Configures safe CORS headers for Backoffice, Launcher, and local development.
 */

import type { Env } from "./types"

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "https://app.hikat.org",
  "https://admin.hikat.org",
]

export function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin")
  let allowOrigin = ""

  if (origin) {
    if (env.CORS_ALLOW_ORIGIN && env.CORS_ALLOW_ORIGIN === origin) {
      allowOrigin = origin
    } else if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) {
      allowOrigin = origin
    } else if (origin.startsWith("hikat://") || origin.startsWith("app://")) {
      allowOrigin = origin
    } else if (env.ENVIRONMENT === "development" && (origin.includes("localhost") || origin.includes("127.0.0.1"))) {
      allowOrigin = origin
    }
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  }

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin
    headers["Access-Control-Allow-Credentials"] = "true"
  }

  return headers
}

export function handleOptionsRequest(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  })
}
