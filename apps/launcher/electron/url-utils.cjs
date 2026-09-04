/**
 * Validates and normalizes deep link URLs for HiKAT.
 * Strictly accepts ONLY URLs with:
 *  - protocol: "hikat:"
 *  - host / hostname: "auth"
 *  - pathname: "/callback", "/verify-email", or "/reset-password" (with optional trailing slashes)
 *
 * Any other scheme, hostname, or pathname is strictly rejected.
 */
function parseValidAuthDeepLinkUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null
  try {
    const trimmed = rawUrl.trim()
    const parsed = new URL(trimmed)

    if (parsed.protocol !== "hikat:") {
      return null
    }

    const host = parsed.hostname || parsed.host
    if (host !== "auth") {
      return null
    }

    const cleanPath = parsed.pathname.replace(/\/+$/, "")
    const ALLOWED_PATHS = new Set(["/callback", "/verify-email", "/reset-password"])
    if (!ALLOWED_PATHS.has(cleanPath)) {
      return null
    }

    return trimmed
  } catch (_) {
    return null
  }
}

const parseValidOAuthCallbackUrl = parseValidAuthDeepLinkUrl

module.exports = { parseValidAuthDeepLinkUrl, parseValidOAuthCallbackUrl }
