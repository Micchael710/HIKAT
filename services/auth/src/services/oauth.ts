/**
 * HiKAT OAuth2 / OIDC Engine (Google & Discord) and Launcher PKCE
 */

import { eq, and, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import {
  ALLOWED_REDIRECT_URIS,
  ALLOWED_LINK_REDIRECT_URIS,
  AuthErrorCode,
  ExternalAuthProvider,
} from "@hikat/shared"
import { generateSecureToken, verifyPkceChallenge } from "../crypto/tokens"

export interface OAuthProviderProfile {
  provider: ExternalAuthProvider
  providerSubject: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
}

export interface OAuthProviderConfig {
  clientId?: string
  clientSecret?: string
  authServiceUrl?: string
}

export interface OAuthFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * Validate redirect URI against strict allowed list for Launcher OAuth (no broad wildcards)
 */
export function isAllowedRedirectUri(
  uri: string,
  customAllowedList?: readonly string[],
): boolean {
  if (!uri || typeof uri !== "string") {
    return false
  }

  const allowedList = customAllowedList || ALLOWED_REDIRECT_URIS
  return allowedList.includes(uri as (typeof ALLOWED_REDIRECT_URIS)[number])
}

/**
 * Validate redirect URI against strict allowed list for Account Linking / Web Portal
 */
export function isAllowedLinkRedirectUri(
  uri: string,
  customAllowedList?: readonly string[],
): boolean {
  if (!uri || typeof uri !== "string") {
    return false
  }

  const allowedList = customAllowedList || ALLOWED_LINK_REDIRECT_URIS
  return allowedList.includes(uri as (typeof ALLOWED_LINK_REDIRECT_URIS)[number])
}

/**
 * Create an OAuth State record in D1
 */
export async function createOAuthState(
  db: Database,
  params: {
    flowType: "LOGIN" | "LINK" | "LAUNCHER"
    provider?: ExternalAuthProvider
    userId?: string
    sessionId?: string
    clientState?: string
    redirectUri?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    expiryMinutes?: number
  },
): Promise<string> {
  const stateId = generateSecureToken(24)
  const now = new Date().toISOString()
  const expiryMinutes = params.expiryMinutes || 15
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()

  await db.insert(schema.oauthStates).values({
    id: stateId,
    clientState: params.clientState || null,
    sessionId: params.sessionId || null,
    flowType: params.flowType,
    provider: params.provider || null,
    userId: params.userId || null,
    redirectUri: params.redirectUri || null,
    codeChallenge: params.codeChallenge || null,
    codeChallengeMethod: params.codeChallengeMethod || "S256",
    expiresAt,
    createdAt: now,
  })

  return stateId
}

/**
 * Consume and validate an OAuth State record from D1 with strict atomic concurrency protection
 */
export async function consumeOAuthState(
  db: Database,
  stateId: string,
): Promise<schema.OAuthState> {
  if (!stateId || typeof stateId !== "string") {
    throw new Error(AuthErrorCode.INVALID_STATE)
  }

  const now = new Date()
  const nowIso = now.toISOString()

  const stateRecord = await db
    .select()
    .from(schema.oauthStates)
    .where(eq(schema.oauthStates.id, stateId))
    .get()

  if (!stateRecord) {
    throw new Error(AuthErrorCode.INVALID_STATE)
  }

  if (stateRecord.usedAt || new Date(stateRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.INVALID_STATE)
  }

  // Atomically mark state as used with concurrency check (changes === 1)
  const d1 = (db as unknown as { session?: { client?: D1Database } }).session?.client

  if (d1) {
    const res = await d1
      .prepare(
        `UPDATE oauth_states
         SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(nowIso, stateId, nowIso)
      .run()

    if (res.meta.changes === 0) {
      // Another concurrent callback consumed this state first
      throw new Error(AuthErrorCode.INVALID_STATE)
    }
  } else {
    const res = await db
      .update(schema.oauthStates)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(schema.oauthStates.id, stateId),
          sql`${schema.oauthStates.usedAt} IS NULL`,
          sql`${schema.oauthStates.expiresAt} > ${nowIso}`,
        ),
      )
      .run()

    if (res.meta.changes === 0) {
      throw new Error(AuthErrorCode.INVALID_STATE)
    }
  }

  return stateRecord
}

/**
 * Create a single-use HiKAT Authorization Code bound to PKCE code_challenge
 */
export async function createAuthorizationCode(
  db: Database,
  params: {
    userId: string
    sessionId?: string
    codeChallenge: string
    codeChallengeMethod?: string
    redirectUri: string
    expiryMinutes?: number
  },
): Promise<string> {
  const code = generateSecureToken(32)
  const now = new Date().toISOString()
  const expiryMinutes = params.expiryMinutes || 5 // 5 minutes
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()

  await db.insert(schema.authorizationCodes).values({
    id: code,
    userId: params.userId,
    sessionId: params.sessionId || null,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod || "S256",
    redirectUri: params.redirectUri,
    expiresAt,
    createdAt: now,
  })

  return code
}

/**
 * Exchange and consume a HiKAT Authorization Code using PKCE code_verifier
 */
export async function consumeAuthorizationCode(
  db: Database,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<schema.AuthorizationCode> {
  if (!code || !codeVerifier) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  const now = new Date()
  const nowIso = now.toISOString()

  const codeRecord = await db
    .select()
    .from(schema.authorizationCodes)
    .where(eq(schema.authorizationCodes.id, code))
    .get()

  if (!codeRecord) {
    throw new Error(AuthErrorCode.INVALID_TOKEN)
  }

  if (codeRecord.usedAt) {
    throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
  }

  if (new Date(codeRecord.expiresAt) <= now) {
    throw new Error(AuthErrorCode.TOKEN_EXPIRED)
  }

  if (codeRecord.redirectUri !== redirectUri) {
    throw new Error(AuthErrorCode.INVALID_REDIRECT_URI)
  }

  // Verify PKCE
  const isPkceValid = await verifyPkceChallenge(
    codeVerifier,
    codeRecord.codeChallenge,
    codeRecord.codeChallengeMethod,
  )

  if (!isPkceValid) {
    throw new Error(AuthErrorCode.INVALID_PKCE)
  }

  // Atomically mark authorization code as used
  const d1 = (db as unknown as { session: { client: D1Database } }).session?.client
  if (d1) {
    const res = await d1
      .prepare(
        `UPDATE authorization_codes
         SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(nowIso, code, nowIso)
      .run()

    if (res.meta.changes === 0) {
      throw new Error(AuthErrorCode.TOKEN_REUSE_DETECTED)
    }
  } else {
    await db
      .update(schema.authorizationCodes)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(schema.authorizationCodes.id, code),
          sql`${schema.authorizationCodes.usedAt} IS NULL`,
        ),
      )
      .run()
  }

  return codeRecord
}

/**
 * Fetch profile from Google OAuth code
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  config: OAuthProviderConfig,
  customFetcher: OAuthFetcher = {
    fetch: (input, init) => fetch(input, init),
  },
): Promise<OAuthProviderProfile> {
  const tokenUrl = "https://oauth2.googleapis.com/token"
  const body = new URLSearchParams({
    code,
    client_id: config.clientId || "google-client-id-placeholder",
    client_secret: config.clientSecret || "google-client-secret-placeholder",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })

  const tokenRes = await customFetcher.fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed with status ${tokenRes.status}`)
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string
    id_token?: string
  }

  if (!tokenData.access_token) {
    throw new Error("Missing access_token from Google OAuth response")
  }

  // Fetch UserInfo
  const userinfoRes = await customFetcher.fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    },
  )

  if (!userinfoRes.ok) {
    throw new Error(`Google userinfo fetch failed with status ${userinfoRes.status}`)
  }

  const userinfo = (await userinfoRes.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }

  if (!userinfo.sub) {
    throw new Error("Google profile is missing stable unique identifier (sub)")
  }

  return {
    provider: "GOOGLE",
    providerSubject: userinfo.sub,
    email: userinfo.email ? userinfo.email.trim().toLowerCase() : null,
    emailVerified: Boolean(userinfo.email_verified),
    displayName: userinfo.name || null,
    avatarUrl: userinfo.picture || null,
  }
}

/**
 * Fetch profile from Discord OAuth code
 */
export async function exchangeDiscordCode(
  code: string,
  redirectUri: string,
  config: OAuthProviderConfig,
  customFetcher: OAuthFetcher = {
    fetch: (input, init) => fetch(input, init),
  },
): Promise<OAuthProviderProfile> {
  const tokenUrl = "https://discord.com/api/oauth2/token"
  const body = new URLSearchParams({
    code,
    client_id: config.clientId || "discord-client-id-placeholder",
    client_secret: config.clientSecret || "discord-client-secret-placeholder",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })

  const tokenRes = await customFetcher.fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    throw new Error(`Discord token exchange failed with status ${tokenRes.status}`)
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string
  }

  if (!tokenData.access_token) {
    throw new Error("Missing access_token from Discord OAuth response")
  }

  // Fetch UserInfo
  const userinfoRes = await customFetcher.fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!userinfoRes.ok) {
    throw new Error(`Discord userinfo fetch failed with status ${userinfoRes.status}`)
  }

  const userinfo = (await userinfoRes.json()) as {
    id?: string
    username?: string
    global_name?: string
    email?: string
    verified?: boolean
    avatar?: string
  }

  if (!userinfo.id) {
    throw new Error("Discord profile is missing stable unique identifier (id)")
  }

  const avatarUrl = userinfo.avatar
    ? `https://cdn.discordapp.com/avatars/${userinfo.id}/${userinfo.avatar}.png`
    : null

  return {
    provider: "DISCORD",
    providerSubject: userinfo.id,
    email: userinfo.email ? userinfo.email.trim().toLowerCase() : null,
    emailVerified: Boolean(userinfo.verified),
    displayName: userinfo.global_name || userinfo.username || null,
    avatarUrl,
  }
}
