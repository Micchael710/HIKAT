/**
 * HiKAT Auth Worker CORS Strategy
 * Strict allowlist for Backoffice, Launcher desktop app, and local development.
 */

import type { Env } from "./index"

const DEFAULT_PRODUCTION_ORIGINS = [
  "https://app.hikat.org",
  "https://admin.hikat.org",
  "hikat://app",
  "hikat://launcher",
  "app://localhost",
  "app://.",
]

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
]

export function getCorsHeaders(request: Request, env: { ENVIRONMENT?: string; CORS_ALLOW_ORIGIN?: string }): HeadersInit {
  const origin = request.headers.get("origin")
  let allowOrigin = ""

  if (origin) {
    const configuredOrigins = env.CORS_ALLOW_ORIGIN
      ? env.CORS_ALLOW_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
      : []

    const isExplicitlyConfigured = configuredOrigins.includes(origin)
    const isProductionAllowed = DEFAULT_PRODUCTION_ORIGINS.includes(origin)
    const isDevAllowed =
      env.ENVIRONMENT === "development" && DEFAULT_DEV_ORIGINS.includes(origin)

    if (isExplicitlyConfigured || isProductionAllowed || isDevAllowed) {
      allowOrigin = origin
    }
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  }

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin
    headers["Access-Control-Allow-Credentials"] = "true"
  }

  return headers
}

export function handleOptionsRequest(
  request: Request,
  env: { ENVIRONMENT?: string; CORS_ALLOW_ORIGIN?: string },
): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  })
}
