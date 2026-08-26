/**
 * HiKAT Backend JWT & JWKS Verification Engine
 * Validates ES256 Access Tokens issued by HiKAT Auth Provider using asymmetric cryptography.
 */

import * as jose from "jose"
import {
  AUTH_AUDIENCE_API,
  DEFAULT_AUTH_ISSUER,
  AccessTokenPayload,
  AppRole,
} from "@hikat/shared"
import type { Env } from "../types"

// Cache remote JWKS instances by URL to avoid recreating key resolvers
const remoteJwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>()

/**
 * Get or create a cached remote JWKS resolver for the given URL
 */
export function getRemoteJwksResolver(jwksUrl: string): ReturnType<typeof jose.createRemoteJWKSet> {
  let resolver = remoteJwksCache.get(jwksUrl)
  if (!resolver) {
    resolver = jose.createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes cache
      cooldownDuration: 30 * 1000,  // 30 seconds cooldown for unknown kid
    })
    remoteJwksCache.set(jwksUrl, resolver)
  }
  return resolver
}

/**
 * Clear JWKS cache (primarily for tests)
 */
export function clearJwksCache(): void {
  remoteJwksCache.clear()
}

export interface VerifyJwtOptions {
  issuer?: string
  audience?: string
  jwksResolver?: jose.JWTVerifyGetKey
  publicKey?: jose.CryptoKey | Uint8Array
}

/**
 * Verify and decode an Access JWT using public keys or JWKS
 */
export async function verifyAccessToken(
  token: string,
  env: Env,
  options?: VerifyJwtOptions,
): Promise<AccessTokenPayload> {
  const expectedIssuer = options?.issuer || env.AUTH_ISSUER || DEFAULT_AUTH_ISSUER
  const expectedAudience = options?.audience || AUTH_AUDIENCE_API

  let keyOrResolver: jose.JWTVerifyGetKey | jose.CryptoKey | Uint8Array

  if (options?.publicKey) {
    keyOrResolver = options.publicKey
  } else if (options?.jwksResolver) {
    keyOrResolver = options.jwksResolver
  } else if (env.AUTH_JWT_PUBLIC_KEY_PEM || env.JWT_PUBLIC_KEY_PEM) {
    const pem = (env.AUTH_JWT_PUBLIC_KEY_PEM || env.JWT_PUBLIC_KEY_PEM)!
    keyOrResolver = (await jose.importSPKI(pem, "ES256")) as jose.CryptoKey
  } else if (env.AUTH_JWKS_URL) {
    keyOrResolver = getRemoteJwksResolver(env.AUTH_JWKS_URL)
  } else {
    // Default to issuer-derived JWKS endpoint
    const defaultJwksUrl = `${expectedIssuer.replace(/\/$/, "")}/.well-known/jwks.json`
    keyOrResolver = getRemoteJwksResolver(defaultJwksUrl)
  }

  let verifyResult: jose.JWTVerifyResult
  try {
    if (typeof keyOrResolver === "function") {
      verifyResult = await jose.jwtVerify(token, keyOrResolver, {
        issuer: expectedIssuer,
        audience: expectedAudience,
        algorithms: ["ES256"],
      })
    } else {
      verifyResult = await jose.jwtVerify(token, keyOrResolver, {
        issuer: expectedIssuer,
        audience: expectedAudience,
        algorithms: ["ES256"],
      })
    }
  } catch (err: unknown) {
    const error = err as Error
    if (error.name === "JWTExpired") {
      throw new Error("Token has expired")
    }
    if (error.name === "JWSSignatureVerificationFailed") {
      throw new Error("Invalid token signature")
    }
    if (error.name === "JWTClaimValidationFailed") {
      throw new Error(`Token claim validation failed: ${error.message}`)
    }
    throw new Error(`Invalid token: ${error.message}`)
  }

  const { payload } = verifyResult

  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.trim() === "") {
    throw new Error("Invalid token: missing or invalid subject claim (sub)")
  }

  if (!payload.sid || typeof payload.sid !== "string" || payload.sid.trim() === "") {
    throw new Error("Invalid token: missing or invalid session ID claim (sid)")
  }

  if (!payload.role || (payload.role !== "PLAYER" && payload.role !== "ADMIN")) {
    throw new Error("Invalid token: missing or invalid role claim")
  }

  return {
    iss: payload.iss as string,
    aud: payload.aud as string,
    sub: payload.sub,
    sid: payload.sid,
    role: payload.role as AppRole,
    displayName: typeof payload.displayName === "string" ? payload.displayName : null,
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
  }
}
