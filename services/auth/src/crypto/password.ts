/**
 * HiKAT Password Hashing & Verification Engine
 * Implements PBKDF2-HMAC-SHA512 using node:crypto (compatible with Cloudflare Workers nodejs_compat)
 * Formats: $pbkdf2-sha512$i=<iterations>$<salt_b64url>$<hash_b64url>
 */

import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto"

export const DEFAULT_PBKDF2_ITERATIONS = 220000
export const MIN_PBKDF2_ITERATIONS = 220000
const SALT_BYTE_LENGTH = 32
const KEY_BYTE_LENGTH = 64 // 512 bits

function bufferToBase64Url(buffer: Uint8Array | Buffer): string {
  return Buffer.isBuffer(buffer)
    ? buffer.toString("base64url")
    : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString("base64url")
}

function base64UrlToBuffer(base64url: string): Buffer {
  return Buffer.from(base64url, "base64url")
}

function constantTimeEqual(a: Uint8Array | Buffer, b: Uint8Array | Buffer): boolean {
  if (a.length !== b.length) {
    return false
  }
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a)
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b)
  return timingSafeEqual(bufA, bufB)
}

function derivePbkdf2Key(
  password: string,
  salt: Uint8Array | Buffer,
  iterations: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(
      password,
      salt,
      iterations,
      KEY_BYTE_LENGTH,
      "sha512",
      (err, derivedKey) => {
        if (err) {
          reject(err)
        } else {
          resolve(derivedKey)
        }
      },
    )
  })
}

/**
 * Hash password using PBKDF2-HMAC-SHA512
 */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  const effectiveIterations = Math.max(iterations, MIN_PBKDF2_ITERATIONS)
  const salt = randomBytes(SALT_BYTE_LENGTH)
  const derivedKey = await derivePbkdf2Key(password, salt, effectiveIterations)

  const saltB64 = bufferToBase64Url(salt)
  const hashB64 = bufferToBase64Url(derivedKey)

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

    const derivedKey = await derivePbkdf2Key(password, salt, iterations)

    return constantTimeEqual(derivedKey, expectedHash)
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
