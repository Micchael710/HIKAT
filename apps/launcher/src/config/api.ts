/**
 * HiKAT Launcher - Centralized API & Backend URL Resolution Authority
 *
 * Enforces unified backend targeting across:
 * - GraphQL queries and mutations
 * - REST API endpoints
 * - Asset and media URL resolution (skins, capes, news, banners)
 * - Game binary download resolution
 */

export const DEFAULT_DEV_API_BASE_URL = "http://127.0.0.1:8787"
export const DEFAULT_PROD_API_BASE_URL = "https://api.apparatia.net/api/v1"

/**
 * Returns the authoritative base API URL for the renderer.
 *
 * Rules:
 * 1. Explicit override via VITE_API_URL or VITE_BACKEND_API_URL takes precedence.
 * 2. Development mode (import.meta.env.DEV or import.meta.env.MODE === 'development') defaults to http://127.0.0.1:8787.
 * 3. Packaged production build defaults to https://api.apparatia.net/api/v1.
 */
export function getApiBaseUrl(): string {
  const override =
    import.meta.env?.VITE_API_URL ||
    import.meta.env?.VITE_BACKEND_API_URL

  if (override && typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/+$/, "")
  }

  const isDev = Boolean(
    import.meta.env?.DEV ||
    import.meta.env?.MODE === "development" ||
    (typeof process !== "undefined" && process.env?.NODE_ENV === "development")
  )

  if (isDev) {
    return DEFAULT_DEV_API_BASE_URL
  }

  return DEFAULT_PROD_API_BASE_URL
}

/**
 * Resolves relative or absolute media/asset URLs against the unified backend authority.
 *
 * Examples:
 * - "/media/content/xyz" -> "http://127.0.0.1:8787/media/content/xyz" (in dev)
 * - "https://cdn.example.com/image.png" -> "https://cdn.example.com/image.png" (preserved)
 * - "data:image/png;base64,..." -> preserved
 * - "blob:http://..." -> preserved
 */
export function resolveApiAssetUrl(url?: string | null): string {
  if (!url || typeof url !== "string") return ""
  const trimmed = url.trim()
  if (!trimmed) return ""

  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed
  }

  const base = getApiBaseUrl()
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${base}${cleanPath}`
}
