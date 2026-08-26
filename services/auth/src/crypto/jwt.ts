/**
 * HiKAT Asymmetric JWT & JWKS Engine
 * Implements ES256 asymmetric signing and verification using `jose`
 */

import * as jose from "jose"
import {
  AppRole,
  AccessTokenPayload,
  GameTokenPayload,
  AUTH_AUDIENCE_API,
  AUTH_AUDIENCE_GAME,
  DEFAULT_AUTH_ISSUER,
} from "@hikat/shared"

export interface JwtKeyManager {
  kid: string
  privateKey: jose.CryptoKey | Uint8Array
  publicKey: jose.CryptoKey | Uint8Array
  publicJwk: jose.JWK
}

let cachedDevKeyManager: JwtKeyManager | null = null

export async function createDevKeyManager(kid: string = "hikat-dev-key-1"): Promise<JwtKeyManager> {
  if (cachedDevKeyManager && cachedDevKeyManager.kid === kid) {
    return cachedDevKeyManager
  }

  const { privateKey, publicKey } = await jose.generateKeyPair("ES256", {
    extractable: true,
  })

  const publicJwk = await jose.exportJWK(publicKey)
  publicJwk.kid = kid
  publicJwk.alg = "ES256"
  publicJwk.use = "sig"

  cachedDevKeyManager = {
    kid,
    privateKey,
    publicKey,
    publicJwk,
  }

  return cachedDevKeyManager
}

/**
 * Initialize JwtKeyManager from environment secrets or dev fallback
 */
export async function initializeKeyManager(env: {
  AUTH_JWT_PRIVATE_KEY_PEM?: string
  AUTH_JWT_PUBLIC_KEY_PEM?: string
  AUTH_JWT_KID?: string
  ENVIRONMENT?: string
}): Promise<JwtKeyManager> {
  const kid = env.AUTH_JWT_KID || "hikat-key-1"

  // 1. If PEM private key is provided in Cloudflare secrets / env
  if (env.AUTH_JWT_PRIVATE_KEY_PEM) {
    const privateKey = await jose.importPKCS8(env.AUTH_JWT_PRIVATE_KEY_PEM, "ES256")

    let publicKey: jose.CryptoKey
    if (env.AUTH_JWT_PUBLIC_KEY_PEM) {
      publicKey = (await jose.importSPKI(env.AUTH_JWT_PUBLIC_KEY_PEM, "ES256")) as jose.CryptoKey
    } else {
      // Derive public key from private key
      const jwk = await jose.exportJWK(privateKey)
      delete jwk.d // remove private component
      jwk.kid = kid
      jwk.alg = "ES256"
      jwk.use = "sig"
      publicKey = (await jose.importJWK(jwk, "ES256")) as jose.CryptoKey
    }

    const publicJwk = await jose.exportJWK(publicKey)
    publicJwk.kid = kid
    publicJwk.alg = "ES256"
    publicJwk.use = "sig"

    return {
      kid,
      privateKey,
      publicKey,
      publicJwk,
    }
  }

  // 2. In production, missing private key secret is a configuration error
  if (env.ENVIRONMENT === "production") {
    throw new Error(
      "Missing AUTH_JWT_PRIVATE_KEY_PEM in production environment. Secrets must be configured.",
    )
  }

  // 3. Fallback for tests & local development
  return createDevKeyManager(kid)
}

/**
 * Get Public JWKS JSON
 */
export function getJwksResponse(keyManager: JwtKeyManager): { keys: jose.JWK[] } {
  return {
    keys: [keyManager.publicJwk],
  }
}

/**
 * Sign an Access Token (ES256 JWT, 15m default expiry)
 */
export async function signAccessToken(
  params: {
    userId: string
    sessionId: string
    role: AppRole
    displayName?: string | null
  },
  keyManager: JwtKeyManager,
  options?: {
    issuer?: string
    audience?: string
    expiresInSeconds?: number
  },
): Promise<{ token: string; expiresIn: number }> {
  const issuer = options?.issuer || DEFAULT_AUTH_ISSUER
  const audience = options?.audience || AUTH_AUDIENCE_API
  const expiresIn = options?.expiresInSeconds || 15 * 60 // 15 minutes

  const jti = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  const token = await new jose.SignJWT({
    role: params.role,
    displayName: params.displayName ?? null,
    sid: params.sessionId,
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyManager.kid })
    .setSubject(params.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(keyManager.privateKey)

  return { token, expiresIn }
}

/**
 * Sign a Game JWT for Minecraft (ES256 JWT, 3m short expiry)
 */
export async function signGameToken(
  params: {
    userId: string
    sessionId: string
    role: AppRole
    displayName?: string | null
  },
  keyManager: JwtKeyManager,
  options?: {
    issuer?: string
    expiresInSeconds?: number
  },
): Promise<{ token: string; expiresIn: number }> {
  const issuer = options?.issuer || DEFAULT_AUTH_ISSUER
  const audience = AUTH_AUDIENCE_GAME
  const expiresIn = options?.expiresInSeconds || 3 * 60 // 3 minutes

  const jti = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  const token = await new jose.SignJWT({
    role: params.role,
    displayName: params.displayName ?? null,
    sid: params.sessionId,
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyManager.kid })
    .setSubject(params.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(keyManager.privateKey)

  return { token, expiresIn }
}

/**
 * Verify an Access JWT using public key or JWKS
 */
export async function verifyAccessToken(
  token: string,
  keyManagerOrPublicKey: JwtKeyManager | jose.CryptoKey | Uint8Array,
  options?: {
    issuer?: string
    audience?: string
  },
): Promise<AccessTokenPayload> {
  const publicKey =
    "publicKey" in keyManagerOrPublicKey
      ? keyManagerOrPublicKey.publicKey
      : keyManagerOrPublicKey

  const issuer = options?.issuer || DEFAULT_AUTH_ISSUER
  const audience = options?.audience || AUTH_AUDIENCE_API

  const { payload } = await jose.jwtVerify(token, publicKey, {
    issuer,
    audience,
    algorithms: ["ES256"],
  })

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Invalid JWT: missing subject (sub)")
  }
  if (!payload.sid || typeof payload.sid !== "string") {
    throw new Error("Invalid JWT: missing session ID (sid)")
  }
  if (!payload.role || (payload.role !== "PLAYER" && payload.role !== "ADMIN")) {
    throw new Error("Invalid JWT: invalid or missing role")
  }

  return {
    iss: payload.iss as string,
    aud: payload.aud as string,
    sub: payload.sub,
    sid: payload.sid,
    role: payload.role as AppRole,
    displayName: (payload.displayName as string) ?? null,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
  }
}

/**
 * Verify a Game JWT using public key or JWKS
 */
export async function verifyGameToken(
  token: string,
  keyManagerOrPublicKey: JwtKeyManager | jose.CryptoKey | Uint8Array,
  options?: {
    issuer?: string
    audience?: string
  },
): Promise<GameTokenPayload> {
  const publicKey =
    "publicKey" in keyManagerOrPublicKey
      ? keyManagerOrPublicKey.publicKey
      : keyManagerOrPublicKey

  const issuer = options?.issuer || DEFAULT_AUTH_ISSUER
  const audience = options?.audience || AUTH_AUDIENCE_GAME

  const { payload } = await jose.jwtVerify(token, publicKey, {
    issuer,
    audience,
    algorithms: ["ES256"],
  })

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Invalid Game JWT: missing subject (sub)")
  }
  if (!payload.sid || typeof payload.sid !== "string") {
    throw new Error("Invalid Game JWT: missing session ID (sid)")
  }
  if (!payload.role || (payload.role !== "PLAYER" && payload.role !== "ADMIN")) {
    throw new Error("Invalid Game JWT: invalid or missing role")
  }

  return {
    iss: payload.iss as string,
    aud: AUTH_AUDIENCE_GAME,
    sub: payload.sub,
    sid: payload.sid,
    role: payload.role as AppRole,
    displayName: (payload.displayName as string) ?? null,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
  }
}
