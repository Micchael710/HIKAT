/**
 * HiKAT Opaque Token & PKCE Engine
 */

export function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
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

export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Generate cryptographically secure random token (base64url)
 */
export function generateSecureToken(byteLength: number = 32): string {
  const length = byteLength > 0 ? byteLength : 32
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return bufferToBase64Url(bytes)
}

/**
 * Hash an opaque token (refresh token, verification token, etc.) using SHA-256
 */
export async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded)
  return bufferToHex(hashBuffer)
}

/**
 * Generate PKCE S256 code_challenge from code_verifier
 */
export async function generatePkceChallenge(codeVerifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(codeVerifier)
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded)
  return bufferToBase64Url(hashBuffer)
}

/**
 * Verify PKCE code_verifier against stored code_challenge
 */
export async function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: string = "S256",
): Promise<boolean> {
  if (!codeVerifier || !codeChallenge) {
    return false
  }

  // HiKAT strictly enforces PKCE S256 and rejects plain or any other method
  if (method !== "S256") {
    return false
  }

  const computedChallenge = await generatePkceChallenge(codeVerifier)
  return computedChallenge === codeChallenge
}
