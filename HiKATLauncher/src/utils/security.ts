/**
 * Centralized Cybersecurity & Input Sanitization Utilities for HiKAT Launcher
 * Protection against SQLi, XSS, Command Injection, Malicious URLs, and Buffer Overflow
 */

/**
 * Strips HTML tags, script injection patterns, control characters,
 * and common SQL injection signatures from raw strings.
 */

export function sanitizeInput(text: string, maxLength = 128): string {
  if (typeof text !== "string") return ""

  let clean = text

    // Remove control characters (ASCII 0-31 except space/newline)

    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")

    // Remove script tags and HTML tags

    .replace(/<[^>]*>?/gm, "")

    // Remove dangerous inline JS protocols

    .replace(/javascript\s*:/gi, "")

    .replace(/data\s*:\s*text\/html/gi, "")

    .replace(/vbscript\s*:/gi, "")

    // Neutralize dangerous SQL injection keywords and termination patterns

    .replace(
      /(\b(UNION\s+SELECT|INSERT\s+INTO|DROP\s+TABLE|ALTER\s+TABLE|DELETE\s+FROM|EXEC(\s|\+)+(s|x)p\w*)\b)/gi,

      "",
    )

    .replace(/(--|\/\*|\*\/|;)/g, "")

  // Enforce maximum character boundary

  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength)
  }

  return clean.trim()
}

/**
 * Validates and sanitizes Minecraft & Apparatia Usernames:
 * Allowed: 3 to 16 characters, alphanumeric and underscores only.
 */

export function sanitizeUsername(username: string): string {
  if (typeof username !== "string") return ""

  // Keep only alphanumeric and underscore characters

  const clean = username.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16)

  return clean
}

/**
 * Validates that a username complies with standard format (3-16 chars, alphanumeric + underscore).
 */

export function isValidUsername(username: string): boolean {
  if (!username) return false

  return /^[a-zA-Z0-9_]{3,16}$/.test(username)
}

/**
 * Sanitizes and validates email addresses according to standard RFC 5322 specs.
 */

export function sanitizeEmail(email: string): string {
  if (typeof email !== "string") return ""

  const clean = email.trim().toLowerCase().slice(0, 254)

  // Remove any whitespace or control chars

  return clean.replace(/\s+/g, "")
}

/**
 * Checks if email address has a valid format.
 */

export function isValidEmail(email: string): boolean {
  if (!email) return false

  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

  return emailRegex.test(email) && email.length <= 254
}

/**
 * Sanitizes external URLs:
 * Whitelists strictly http:// and https:// protocols.
 * Rejects javascript:, file:, data:, cmd:, powershell:, etc.
 */

export function sanitizeUrl(url: string): string | null {
  if (typeof url !== "string") return null

  const trimmed = url.trim()

  try {
    const parsed = new URL(trimmed)

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString()
    }
  } catch (_) {
    // If URL parsing fails, check if relative safe path

    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      return trimmed.replace(/[<>"'`\s]/g, "")
    }
  }

  return null
}

/**
 * Sanitizes and bounds RAM allocation in GB:
 * Ensures positive integers between 1 GB and 64 GB.
 */

export function sanitizeRamAllocation(ramGB: number): number {
  if (typeof ramGB !== "number" || isNaN(ramGB)) return 4

  const rounded = Math.round(ramGB)

  if (rounded < 1) return 1

  if (rounded > 64) return 64

  return rounded
}

/**
 * Sanitizes game version strings to prevent command injection in JVM args.
 * Allowed: alphanumeric, dots, hyphens, and underscores (e.g. "1.20.1-Forge-47.2.0").
 */

export function sanitizeGameVersion(version: string): string {
  if (typeof version !== "string") return "1.20.1"

  return version.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64) || "1.20.1"
}
