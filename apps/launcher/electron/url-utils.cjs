/**
 * Validates and normalizes deep link OAuth callback URLs for HiKAT.
 * Strictly accepts ONLY URLs with:
 *  - protocol: "hikat:"
 *  - host / hostname: "auth"
 *  - pathname: "/callback" (or "/callback/")
 *
 * Any other scheme, hostname, or pathname prefix (e.g. callback-evil) is strictly rejected.
 */
function parseValidOAuthCallbackUrl(rawUrl) {
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
    if (cleanPath !== "/callback") {
      return null
    }

    return trimmed
  } catch (_) {
    return null
  }
}

module.exports = { parseValidOAuthCallbackUrl }
