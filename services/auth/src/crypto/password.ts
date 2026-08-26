/**
 * HiKAT Password Hashing & Verification Engine
 * Implements PBKDF2-HMAC-SHA512 using native WebCrypto (crypto.subtle)
 * Formats: $pbkdf2-sha512$i=<iterations>$<salt_b64url>$<hash_b64url>
 */

export const DEFAULT_PBKDF2_ITERATIONS = 220000
export const MIN_PBKDF2_ITERATIONS = 220000
const SALT_BYTE_LENGTH = 32
const KEY_BYTE_LENGTH = 64 // 512 bits

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i]
    if (b !== undefined) {
      binary += String.fromCharCode(b)
    }
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/")
  while (base64.length % 4) {
    base64 += "="
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0
    const bVal = b[i] ?? 0
    diff |= aVal ^ bVal
  }
  return diff === 0
}

/**
 * Hash password using PBKDF2-HMAC-SHA512
 */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  const effectiveIterations = Math.max(iterations, MIN_PBKDF2_ITERATIONS)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH))
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: effectiveIterations,
      hash: "SHA-512",
    },
    passwordKey,
    KEY_BYTE_LENGTH * 8,
  )

  const saltB64 = bufferToBase64Url(salt)
  const hashB64 = bufferToBase64Url(derivedBits)

  return `$pbkdf2-sha512$i=${effectiveIterations}$${saltB64}$${hashB64}`
}

/**
 * Verify password against stored PBKDF2 hash in constant time
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash || typeof storedHash !== "string") {
    return false
  }

  // Format: $pbkdf2-sha512$i=220000$salt$hash
  const parts = storedHash.split("$")
  if (parts.length !== 5 || parts[1] !== "pbkdf2-sha512") {
    return false
  }

  const iterPart = parts[2]
  if (!iterPart) return false

  const iterMatch = iterPart.match(/^i=(\d+)$/)
  if (!iterMatch) {
    return false
  }

  const iterStr = iterMatch[1]
  if (!iterStr) return false

  const iterations = parseInt(iterStr, 10)
  if (isNaN(iterations) || iterations < 1) {
    return false
  }

  const saltB64 = parts[3]
  const expectedHashB64 = parts[4]
  if (!saltB64 || !expectedHashB64) {
    return false
  }

  try {
    const salt = base64UrlToBuffer(saltB64)
    const expectedHash = base64UrlToBuffer(expectedHashB64)

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    )

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-512",
      },
      passwordKey,
      KEY_BYTE_LENGTH * 8,
    )

    const derivedBytes = new Uint8Array(derivedBits)
    return constantTimeEqual(derivedBytes, expectedHash)
  } catch {
    return false
  }
}

/**
 * Check if a stored password hash was hashed with an older/lower iteration count
 */
export function needsRehash(
  storedHash: string,
  targetIterations: number = DEFAULT_PBKDF2_ITERATIONS,
): boolean {
  const parts = storedHash.split("$")
  if (parts.length !== 5 || parts[1] !== "pbkdf2-sha512") {
    return true
  }
  const iterPart = parts[2]
  if (!iterPart) return true

  const iterMatch = iterPart.match(/^i=(\d+)$/)
  if (!iterMatch) {
    return true
  }
  const iterStr = iterMatch[1]
  if (!iterStr) return true

  const iterations = parseInt(iterStr, 10)
  return isNaN(iterations) || iterations < targetIterations
}
