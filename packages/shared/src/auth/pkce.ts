/**
 * HiKAT PKCE & Cryptographic State Utilities
 * Standard Web Crypto API compatible across modern browsers, Node.js, Electron, and Cloudflare Workers.
 */

export function generateSecureRandomString(length = 32): string {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  let result = ""
  for (let i = 0; i < length; i++) {
    const byteVal = bytes[i] ?? 0
    result += chars[byteVal % chars.length] ?? ""
  }
  return result
}

export function generateCodeVerifier(length = 64): string {
  const safeLength = Math.min(Math.max(length, 43), 128)
  return generateSecureRandomString(safeLength)
}

export function generateRandomState(length = 32): string {
  return generateSecureRandomString(length)
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i] ?? 0
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest("SHA-256", data)
    return base64UrlEncode(digest)
  }
  throw new Error("Web Crypto API (crypto.subtle.digest) is not available in current environment")
}
