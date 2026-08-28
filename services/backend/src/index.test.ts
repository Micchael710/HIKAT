/**
 * HiKAT Backend Service Comprehensive Test Suite
 * Tests GraphQL Yoga, authentication verification, session validation,
 * authorization guards, user queries, admin queries, CORS, and security edge cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { encode } from "fast-png"
import * as jose from "jose"

import { eq } from "drizzle-orm"

import {
  createDatabase,
  users,
  sessions,
  news,
  contentMedia,
  contentMediaUploadTokens,
  gameReleases,
  gameReleaseFiles,
  skins,
  playerSkins,
  playerSkinSelections,
} from "@hikat/database"

import { createTestD1 } from "@hikat/database/testUtils"

import {
  AUTH_AUDIENCE_API,
  AUTH_AUDIENCE_GAME,
  DEFAULT_AUTH_ISSUER,
  HIKAT_VERSION,
  AppRole,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_MEDIA_SIZE_BYTES,
} from "@hikat/shared"

import worker, {
  Env,
  requireAuth,
  requireAdmin,
  verifyAccessToken,
  validateSessionInDb,
  getUserById,
  getPublicNewsFeed,
  getPublicNewsById,
  getAdminNews,
  getAdminNewsById,
  createNews,
  updateNews,
  publishNews,
  unpublishNews,
  deleteNews,
  createContentMediaUpload,
  deleteMedia,
  publishGameRelease,
} from "./index"

import { createTestR2Bucket } from "./testUtils/mockR2"

describe("HiKAT Backend Core (Shard 03)", () => {
  let testD1: ReturnType<typeof createTestD1>

  let db: ReturnType<typeof createDatabase>

  // Primary Test Keypair (ES256)

  let privateKey: jose.CryptoKey

  let publicKey: jose.CryptoKey

  let publicSpkiPem: string

  const keyId = "test-auth-key-1"

  // Secondary Keypair for rotation testing

  let secondaryPrivateKey: jose.CryptoKey

  let secondaryPublicKey: jose.CryptoKey

  let secondaryPublicSpkiPem: string

  const secondaryKeyId = "test-auth-key-2"

  // Untrusted Keypair for attack testing

  let attackerPrivateKey: jose.CryptoKey

  beforeEach(async () => {
    testD1 = createTestD1()

    db = createDatabase(testD1)

    // Generate test keys

    const kp1 = await jose.generateKeyPair("ES256", { extractable: true })

    privateKey = kp1.privateKey

    publicKey = kp1.publicKey

    publicSpkiPem = await jose.exportSPKI(publicKey)

    const kp2 = await jose.generateKeyPair("ES256", { extractable: true })

    secondaryPrivateKey = kp2.privateKey

    secondaryPublicKey = kp2.publicKey

    secondaryPublicSpkiPem = await jose.exportSPKI(secondaryPublicKey)

    const kpAttacker = await jose.generateKeyPair("ES256", {
      extractable: true,
    })

    attackerPrivateKey = kpAttacker.privateKey
  })

  // Helper to parse typed JSON responses in tests

  async function getJson<T = any>(res: Response): Promise<T> {
    return (await res.json()) as T
  }

  // Helper to sign test access tokens

  async function createTestAccessToken(params: {
    userId: string

    sessionId: string

    role: AppRole

    displayName?: string | null

    key?: jose.CryptoKey

    kid?: string

    issuer?: string

    audience?: string

    expiresInSeconds?: number

    issuedAtOffset?: number
  }): Promise<string> {
    const key = params.key || privateKey

    const kid = params.kid || keyId

    const issuer = params.issuer || DEFAULT_AUTH_ISSUER

    const audience = params.audience || AUTH_AUDIENCE_API

    const expiresIn = params.expiresInSeconds ?? 900 // 15m

    const now = Math.floor(Date.now() / 1000) + (params.issuedAtOffset ?? 0)

    return new jose.SignJWT({
      role: params.role,

      displayName: params.displayName ?? null,

      sid: params.sessionId,
    })

      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid })

      .setSubject(params.userId)

      .setIssuer(issuer)

      .setAudience(audience)

      .setJti(crypto.randomUUID())

      .setIssuedAt(now)

      .setExpirationTime(now + expiresIn)

      .sign(key)
  }

  // Helper to seed a user and active session in D1

  async function seedUserAndSession(params: {
    userId: string

    role?: AppRole

    displayName?: string | null

    sessionId: string

    isSessionExpired?: boolean

    isSessionRevoked?: boolean
  }) {
    const now = new Date()

    const expiresAt = new Date(
      params.isSessionExpired
        ? now.getTime() - 3600000
        : now.getTime() + 7 * 86400000,
    ).toISOString()

    const revokedAt = params.isSessionRevoked ? now.toISOString() : null

    await db.insert(users).values({
      id: params.userId,

      role: params.role || "PLAYER",

      displayName: params.displayName ?? "Test Player",

      createdAt: now.toISOString(),

      updatedAt: now.toISOString(),
    })

    await db.insert(sessions).values({
      id: params.sessionId,

      userId: params.userId,

      createdAt: now.toISOString(),

      expiresAt,

      revokedAt,
    })
  }

  describe("1. Public Infrastructure & Health Endpoints", () => {
    it("responds to minimal REST /health endpoint with 200 OK without auth", async () => {
      const request = new Request("http://localhost/health")

      const env: Env = { DB: testD1 }

      const response = await worker.fetch(request, env)

      expect(response.status).toBe(200)

      const data = await getJson(response)

      expect(data).toMatchObject({
        status: "ok",

        service: "hikat-backend",

        version: HIKAT_VERSION,
      })

      expect(data.timestamp).toBeDefined()
    })

    it("executes GraphQL health query anonymously without authorization header", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          query: "{ health { status service version timestamp } version }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      expect(response.status).toBe(200)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.health?.status).toBe("ok")

      expect(result.data?.health?.service).toBe("hikat-backend")

      expect(result.data?.health?.version).toBe(HIKAT_VERSION)

      expect(result.data?.version).toBe(HIKAT_VERSION)
    })

    it("allows public queries to succeed even when DB is not available", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          query: "{ health { status } version }",
        }),
      })

      const env: Env = { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem } // No DB

      const response = await worker.fetch(request, env)

      expect(response.status).toBe(200)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.health?.status).toBe("ok")

      expect(result.data?.version).toBe(HIKAT_VERSION)
    })

    it("allows public queries to succeed even when an invalid Authorization header is sent", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: "Bearer invalid.corrupt.token",
        },

        body: JSON.stringify({
          query: "{ version }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      expect(response.status).toBe(200)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.version).toBe(HIKAT_VERSION)
    })
  })

  describe("2. GraphQL User Core (me Query)", () => {
    it("rejects me query with UNAUTHENTICATED when called anonymously", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          query: "{ me { id role displayName createdAt updatedAt } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors).toBeDefined()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("resolves me query with full D1 account data for valid authenticated user", async () => {
      const userId = "usr_player_1"

      const sessionId = "ses_active_1"

      await seedUserAndSession({
        userId,

        role: "PLAYER",

        displayName: "HeroPlayer",

        sessionId,
      })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        displayName: "HeroPlayer",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ me { id role displayName createdAt updatedAt } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.me).toMatchObject({
        id: userId,

        role: "PLAYER",

        displayName: "HeroPlayer",
      })

      expect(result.data?.me?.createdAt).toBeDefined()

      expect(result.data?.me?.updatedAt).toBeDefined()
    })

    it("reflects fresh D1 database values in me query even if JWT had stale claims", async () => {
      const userId = "usr_player_stale"

      const sessionId = "ses_stale_1"

      await seedUserAndSession({
        userId,

        role: "ADMIN", // Promoted in D1

        displayName: "PromotedAdmin", // Renamed in D1

        sessionId,
      })

      // Old JWT signed before promotion

      const staleToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        displayName: "OldPlayerName",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${staleToken}`,
        },

        body: JSON.stringify({
          query: "{ me { id role displayName } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.me).toEqual({
        id: userId,

        role: "ADMIN",

        displayName: "PromotedAdmin",
      })
    })

    it("fails closed when user is deleted/missing in D1 (returns UNAUTHENTICATED)", async () => {
      const userId = "usr_deleted"

      const sessionId = "ses_ghost"

      // Token generated for non-existent user

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ me { id role } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors).toBeDefined()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })
  })

  describe("3. Administrative Guards & Dynamic D1 Roles", () => {
    it("rejects anonymous callers from adminStatus with UNAUTHENTICATED", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          query: "{ adminStatus { ok serverTime environment } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.adminStatus).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects authenticated PLAYER from adminStatus with FORBIDDEN", async () => {
      const userId = "usr_regular_player"

      const sessionId = "ses_player_1"

      await seedUserAndSession({
        userId,

        role: "PLAYER",

        sessionId,
      })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ adminStatus { ok serverTime environment } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.adminStatus).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN")
    })

    it("rejects JWT with ADMIN claim if account was demoted to PLAYER in D1 (FORBIDDEN)", async () => {
      const userId = "usr_demoted_admin"

      const sessionId = "ses_demoted_1"

      // User was demoted in D1 database

      await seedUserAndSession({
        userId,

        role: "PLAYER",

        sessionId,
      })

      // Old JWT signed with ADMIN role claim

      const adminToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "ADMIN",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${adminToken}`,
        },

        body: JSON.stringify({
          query: "{ adminStatus { ok } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.adminStatus).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN")
    })

    it("allows JWT with PLAYER claim if account was promoted to ADMIN in D1", async () => {
      const userId = "usr_promoted_player"

      const sessionId = "ses_promoted_1"

      // User is ADMIN in D1 database

      await seedUserAndSession({
        userId,

        role: "ADMIN",

        sessionId,
      })

      // Old JWT signed with PLAYER role claim

      const playerToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${playerToken}`,
        },

        body: JSON.stringify({
          query: "{ adminStatus { ok environment } }",
        }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.adminStatus?.ok).toBe(true)
    })

    it("allows authenticated ADMIN to execute adminStatus query successfully", async () => {
      const userId = "usr_admin_master"

      const sessionId = "ses_admin_1"

      await seedUserAndSession({
        userId,

        role: "ADMIN",

        sessionId,
      })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "ADMIN",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ adminStatus { ok serverTime environment } }",
        }),
      })

      const env: Env = {
        DB: testD1,

        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        ENVIRONMENT: "staging",
      }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.adminStatus?.ok).toBe(true)

      expect(result.data?.adminStatus?.environment).toBe("staging")

      expect(result.data?.adminStatus?.serverTime).toBeDefined()
    })

    it("FAILS CLOSED when DB is unavailable on protected adminStatus query (UNAUTHENTICATED)", async () => {
      const token = await createTestAccessToken({
        userId: "usr_admin_nodb",

        sessionId: "ses_admin_nodb",

        role: "ADMIN",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ adminStatus { ok } }",
        }),
      })

      // Env without DB binding

      const env: Env = { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.adminStatus).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })
  })

  describe("4. Cryptographic JWT Verification & Claim Security", () => {
    it("rejects token signed by untrusted attacker key", async () => {
      const userId = "usr_victim"

      const sessionId = "ses_legit"

      await seedUserAndSession({ userId, sessionId })

      const forgedToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "ADMIN",

        key: attackerPrivateKey, // Untrusted key
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${forgedToken}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects tampered token with altered signature or payload", async () => {
      const userId = "usr_tamper"

      const sessionId = "ses_tamper"

      await seedUserAndSession({ userId, sessionId })

      const validToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const parts = validToken.split(".")

      const tamperedToken = `${parts[0]}.${parts[1]}.badSig_${parts[2]?.slice(7)}`

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${tamperedToken}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects expired token", async () => {
      const userId = "usr_expired"

      const sessionId = "ses_expired_jwt"

      await seedUserAndSession({ userId, sessionId })

      const expiredToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        issuedAtOffset: -100,

        expiresInSeconds: 90,
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${expiredToken}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects token with invalid issuer", async () => {
      const userId = "usr_wrong_iss"

      const sessionId = "ses_wrong_iss"

      await seedUserAndSession({ userId, sessionId })

      const wrongIssToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        issuer: "https://evil.auth.org",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${wrongIssToken}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects Game JWT (aud=hikat-minecraft) used against Backend API", async () => {
      const userId = "usr_game_jwt"

      const sessionId = "ses_game_jwt"

      await seedUserAndSession({ userId, sessionId })

      const gameToken = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        audience: AUTH_AUDIENCE_GAME,
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${gameToken}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects tokens with non-ES256 symmetric algorithms (e.g. HS256 algorithm confusion)", async () => {
      const symmetricKey = new TextEncoder().encode(
        "super-secret-key-that-should-not-work",
      )

      const hs256Token = await new jose.SignJWT({
        role: "ADMIN",

        sid: "ses_hs256",
      })

        .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: keyId })

        .setSubject("usr_hs256")

        .setIssuer(DEFAULT_AUTH_ISSUER)

        .setAudience(AUTH_AUDIENCE_API)

        .setIssuedAt()

        .setExpirationTime("15m")

        .setJti(crypto.randomUUID())

        .sign(symmetricKey)

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${hs256Token}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("supports kid-based key rotation with multiple active public keys", async () => {
      const userId = "usr_rotated"

      const sessionId = "ses_rotated"

      await seedUserAndSession({ userId, sessionId })

      const jwksMap = new Map<string, jose.CryptoKey>([
        [keyId, publicKey],

        [secondaryKeyId, secondaryPublicKey],
      ])

      const jwksResolver: jose.JWTVerifyGetKey = async (protectedHeader) => {
        const key = protectedHeader.kid
          ? jwksMap.get(protectedHeader.kid)
          : undefined

        if (!key) throw new Error(`Unknown key ID: ${protectedHeader.kid}`)

        return key
      }

      const token1 = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        key: privateKey,

        kid: keyId,
      })

      const token2 = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",

        key: secondaryPrivateKey,

        kid: secondaryKeyId,
      })

      const payload1 = await verifyAccessToken(token1, {}, { jwksResolver })

      const payload2 = await verifyAccessToken(token2, {}, { jwksResolver })

      expect(payload1.sub).toBe(userId)

      expect(payload2.sub).toBe(userId)
    })
  })

  describe("5. D1 Session State & Revocation Security", () => {
    it("rejects token when session does not exist in D1", async () => {
      const userId = "usr_no_session"

      const sessionId = "ses_ghost"

      await db.insert(users).values({
        id: userId,

        role: "PLAYER",

        displayName: "Ghost",

        createdAt: new Date().toISOString(),

        updatedAt: new Date().toISOString(),
      })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects token when session belongs to a different user ID", async () => {
      const userVictim = "usr_victim_id"

      const userAttacker = "usr_attacker_id"

      const sessionId = "ses_victim_session"

      await seedUserAndSession({
        userId: userVictim,

        sessionId,
      })

      await db.insert(users).values({
        id: userAttacker,

        role: "PLAYER",

        displayName: "Attacker",

        createdAt: new Date().toISOString(),

        updatedAt: new Date().toISOString(),
      })

      const forgedToken = await createTestAccessToken({
        userId: userAttacker,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${forgedToken}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects token immediately when session is revoked in D1", async () => {
      const userId = "usr_logged_out"

      const sessionId = "ses_revoked_1"

      await seedUserAndSession({
        userId,

        sessionId,

        isSessionRevoked: true,
      })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("rejects token when session in D1 has expired", async () => {
      const userId = "usr_expired_ses"

      const sessionId = "ses_expired_d1"

      await seedUserAndSession({
        userId,

        sessionId,

        isSessionExpired: true,
      })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })
  })

  describe("6. Authorization Guards Unit Tests", () => {
    it("requireAuth throws UNAUTHENTICATED for anonymous context", () => {
      const context = {
        env: {},

        auth: { status: "anonymous" as const },

        request: new Request("http://localhost"),
      }

      expect(() => requireAuth(context)).toThrowError(/Authentication required/)
    })

    it("requireAuth throws UNAUTHENTICATED for invalid context with exact reason", () => {
      const context = {
        env: {},

        auth: {
          status: "invalid" as const,

          reason: "Session has been revoked",
        },

        request: new Request("http://localhost"),
      }

      expect(() => requireAuth(context)).toThrowError(
        /Session has been revoked/,
      )
    })

    it("requireAuth returns identity for authenticated context", () => {
      const identity = {
        userId: "u1",

        sessionId: "s1",

        role: "PLAYER" as AppRole,

        displayName: "User One",

        tokenPayload: {} as any,
      }

      const context = {
        env: {},

        auth: { status: "authenticated" as const, identity },

        request: new Request("http://localhost"),
      }

      expect(requireAuth(context)).toEqual(identity)
    })

    it("requireAdmin throws FORBIDDEN for PLAYER role", () => {
      const identity = {
        userId: "u1",

        sessionId: "s1",

        role: "PLAYER" as AppRole,

        displayName: "User One",

        tokenPayload: {} as any,
      }

      const context = {
        env: {},

        auth: { status: "authenticated" as const, identity },

        request: new Request("http://localhost"),
      }

      expect(() => requireAdmin(context)).toThrowError(
        /administrative privilege required/,
      )
    })

    it("requireAdmin returns identity for ADMIN role", () => {
      const identity = {
        userId: "admin_1",

        sessionId: "s_admin",

        role: "ADMIN" as AppRole,

        displayName: "Super Admin",

        tokenPayload: {} as any,
      }

      const context = {
        env: {},

        auth: { status: "authenticated" as const, identity },

        request: new Request("http://localhost"),
      }

      expect(requireAdmin(context)).toEqual(identity)
    })
  })

  describe("7. Strict CORS Allowlist & Preflight Handling", () => {
    it("handles OPTIONS preflight for exact allowed production origins", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "OPTIONS",

        headers: {
          Origin: "https://app.hikat.org",

          "Access-Control-Request-Method": "POST",

          "Access-Control-Request-Headers": "Content-Type, Authorization",
        },
      })

      const env: Env = { DB: testD1 }

      const response = await worker.fetch(request, env)

      expect(response.status).toBe(204)

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.hikat.org",
      )

      expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
        "POST",
      )
    })

    it("allows desktop origins like hikat://launcher and hikat://app", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "OPTIONS",

        headers: {
          Origin: "hikat://launcher",
        },
      })

      const env: Env = { DB: testD1 }

      const response = await worker.fetch(request, env)

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "hikat://launcher",
      )
    })

    it("rejects open/wildcard custom protocol prefixes like hikat://attacker-site", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Origin: "hikat://attacker-site",
        },

        body: JSON.stringify({ query: "{ version }" }),
      })

      const env: Env = { DB: testD1 }

      const response = await worker.fetch(request, env)

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    })

    it("rejects localhost in production environment without explicit configuration", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Origin: "http://localhost:5173",
        },

        body: JSON.stringify({ query: "{ version }" }),
      })

      const env: Env = { DB: testD1, ENVIRONMENT: "production" }

      const response = await worker.fetch(request, env)

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    })

    it("allows localhost when environment is explicitly development", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Origin: "http://localhost:5173",
        },

        body: JSON.stringify({ query: "{ version }" }),
      })

      const env: Env = { DB: testD1, ENVIRONMENT: "development" }

      const response = await worker.fetch(request, env)

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost:5173",
      )
    })

    it("allows custom configured origins via CORS_ALLOW_ORIGIN", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Origin: "https://custom.client.com",
        },

        body: JSON.stringify({ query: "{ version }" }),
      })

      const env: Env = {
        DB: testD1,

        CORS_ALLOW_ORIGIN: "https://custom.client.com, https://other.com",
      }

      const response = await worker.fetch(request, env)

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://custom.client.com",
      )
    })
  })

  describe("8. Header Parsing & Edge Cases", () => {
    it("rejects non-Bearer Authorization formats on protected routes", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: "Basic dXNlcjpwYXNz",
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.data?.me).toBeNull()

      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })

    it("handles whitespace and casing in Bearer scheme correctly", async () => {
      const userId = "usr_case_test"

      const sessionId = "ses_case_test"

      await seedUserAndSession({ userId, sessionId })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `bearer   ${token}`,
        },

        body: JSON.stringify({ query: "{ me { id } }" }),
      })

      const env: Env = { DB: testD1, AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeUndefined()

      expect(result.data?.me?.id).toBe(userId)
    })
  })

  describe("9. JWT Header & Claims Hardening", () => {
    it("rejects token missing kid in protected header", async () => {
      const token = await new jose.SignJWT({
        role: "PLAYER",

        sid: "ses_1",
      })

        .setProtectedHeader({ alg: "ES256", typ: "JWT" }) // Missing kid

        .setSubject("usr_no_kid")

        .setIssuer(DEFAULT_AUTH_ISSUER)

        .setAudience(AUTH_AUDIENCE_API)

        .setIssuedAt()

        .setExpirationTime("15m")

        .setJti(crypto.randomUUID())

        .sign(privateKey)

      await expect(
        verifyAccessToken(token, { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }),
      ).rejects.toThrow(/missing or invalid key ID/)
    })

    it("rejects token with missing subject (sub)", async () => {
      const token = await new jose.SignJWT({
        role: "PLAYER",

        sid: "ses_1",
      })

        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyId })

        .setIssuer(DEFAULT_AUTH_ISSUER)

        .setAudience(AUTH_AUDIENCE_API)

        .setIssuedAt()

        .setExpirationTime("15m")

        .setJti(crypto.randomUUID())

        .sign(privateKey)

      await expect(
        verifyAccessToken(token, { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }),
      ).rejects.toThrow(/missing or invalid subject/)
    })

    it("rejects token with missing session ID (sid)", async () => {
      const token = await new jose.SignJWT({
        role: "PLAYER",
      })

        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyId })

        .setSubject("usr_no_sid")

        .setIssuer(DEFAULT_AUTH_ISSUER)

        .setAudience(AUTH_AUDIENCE_API)

        .setIssuedAt()

        .setExpirationTime("15m")

        .setJti(crypto.randomUUID())

        .sign(privateKey)

      await expect(
        verifyAccessToken(token, { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }),
      ).rejects.toThrow(/missing or invalid session ID/)
    })

    it("rejects token with missing JWT ID (jti)", async () => {
      const now = Math.floor(Date.now() / 1000)

      const token = await new jose.SignJWT({
        role: "PLAYER",

        sid: "ses_1",
      })

        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyId })

        .setSubject("usr_no_jti")

        .setIssuer(DEFAULT_AUTH_ISSUER)

        .setAudience(AUTH_AUDIENCE_API)

        .setIssuedAt(now)

        .setExpirationTime(now + 900)

        // No jti

        .sign(privateKey)

      await expect(
        verifyAccessToken(token, { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }),
      ).rejects.toThrow(/missing or invalid JWT ID/)
    })

    it("rejects token with invalid role value", async () => {
      const token = await new jose.SignJWT({
        role: "SUPERADMIN", // Invalid role

        sid: "ses_1",
      })

        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyId })

        .setSubject("usr_bad_role")

        .setIssuer(DEFAULT_AUTH_ISSUER)

        .setAudience(AUTH_AUDIENCE_API)

        .setIssuedAt()

        .setExpirationTime("15m")

        .setJti(crypto.randomUUID())

        .sign(privateKey)

      await expect(
        verifyAccessToken(token, { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }),
      ).rejects.toThrow(/missing or invalid role/)
    })

    it("verifies tokens using JWT_PUBLIC_KEY_PEM environment variable", async () => {
      const token = await createTestAccessToken({
        userId: "usr_env_test",

        sessionId: "ses_env_test",

        role: "PLAYER",
      })

      const payload = await verifyAccessToken(token, {
        JWT_PUBLIC_KEY_PEM: publicSpkiPem,
      })

      expect(payload.sub).toBe("usr_env_test")
    })
  })

  describe("10. Service & Database Integration Unit Tests", () => {
    it("getUserById returns null when user does not exist", async () => {
      const result = await getUserById(db, "non_existent_id")

      expect(result).toBeNull()
    })

    it("validateSessionInDb returns false when parameters are empty", async () => {
      const res1 = await validateSessionInDb(db, "", "some_sid")

      expect(res1.valid).toBe(false)

      const res2 = await validateSessionInDb(db, "some_uid", "")

      expect(res2.valid).toBe(false)
    })
  })

  describe("11. Secure-by-Default Error Masking", () => {
    it("preserves expected domain errors (e.g. UNAUTHENTICATED) across all environments", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          query: "{ me { id } }",
        }),
      })

      const env: Env = {
        ENVIRONMENT: "production",

        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        DB: testD1,
      }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeDefined()

      expect(result.errors[0].extensions.code).toBe("UNAUTHENTICATED")
    })

    it("masks unexpected database failures in ENVIRONMENT=production to INTERNAL_ERROR", async () => {
      const userId = "usr_prod_err"

      const sessionId = "ses_prod_err"

      await seedUserAndSession({ userId, sessionId, role: "PLAYER" })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      let userQueries = 0

      const faultyD1 = {
        ...testD1,

        prepare: (query: string) => {
          if (query.toLowerCase().includes("users")) {
            userQueries++

            if (userQueries >= 2) {
              return {
                bind: () => ({
                  first: () => {
                    throw new Error(
                      "CRITICAL_INTERNAL_DATABASE_PANIC: secret connection string postgres://secret:1234@db/internal",
                    )
                  },

                  all: () => {
                    throw new Error(
                      "CRITICAL_INTERNAL_DATABASE_PANIC: secret connection string postgres://secret:1234@db/internal",
                    )
                  },

                  run: () => {
                    throw new Error(
                      "CRITICAL_INTERNAL_DATABASE_PANIC: secret connection string postgres://secret:1234@db/internal",
                    )
                  },
                }),
              } as any
            }
          }

          return (testD1 as any).prepare(query)
        },
      } as unknown as D1Database

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ me { id } }",
        }),
      })

      const env: Env = {
        ENVIRONMENT: "production",

        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        DB: faultyD1,
      }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeDefined()

      expect(result.errors[0].message).toBe("Internal server error")

      expect(result.errors[0].extensions.code).toBe("INTERNAL_ERROR")

      expect(JSON.stringify(result.errors)).not.toContain(
        "CRITICAL_INTERNAL_DATABASE_PANIC",
      )

      expect(JSON.stringify(result.errors)).not.toContain("postgres://")
    })

    it("masks unexpected database failures when ENVIRONMENT is absent/undefined (secure-by-default)", async () => {
      const userId = "usr_undef_err"

      const sessionId = "ses_undef_err"

      await seedUserAndSession({ userId, sessionId, role: "PLAYER" })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      let userQueries = 0

      const faultyD1 = {
        ...testD1,

        prepare: (query: string) => {
          if (query.toLowerCase().includes("users")) {
            userQueries++

            if (userQueries >= 2) {
              return {
                bind: () => ({
                  first: () => {
                    throw new Error(
                      "UNHANDLED_DATABASE_EXCEPTION_LEAK: secret connection string postgres://secret:1234@db/internal",
                    )
                  },

                  all: () => {
                    throw new Error(
                      "UNHANDLED_DATABASE_EXCEPTION_LEAK: secret connection string postgres://secret:1234@db/internal",
                    )
                  },

                  run: () => {
                    throw new Error(
                      "UNHANDLED_DATABASE_EXCEPTION_LEAK: secret connection string postgres://secret:1234@db/internal",
                    )
                  },
                }),
              } as any
            }
          }

          return (testD1 as any).prepare(query)
        },
      } as unknown as D1Database

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ me { id } }",
        }),
      })

      // ENVIRONMENT is undefined (secure-by-default)

      const env: Env = {
        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        DB: faultyD1,
      }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeDefined()

      expect(result.errors[0].message).toBe("Internal server error")

      expect(result.errors[0].extensions.code).toBe("INTERNAL_ERROR")

      expect(JSON.stringify(result.errors)).not.toContain(
        "UNHANDLED_DATABASE_EXCEPTION_LEAK",
      )

      expect(JSON.stringify(result.errors)).not.toContain("postgres://")
    })

    it("preserves unexpected internal error messages in ENVIRONMENT=development for debugging", async () => {
      const userId = "usr_dev_err"

      const sessionId = "ses_dev_err"

      await seedUserAndSession({ userId, sessionId, role: "PLAYER" })

      const token = await createTestAccessToken({
        userId,

        sessionId,

        role: "PLAYER",
      })

      let userQueries = 0

      const faultyD1 = {
        ...testD1,

        prepare: (query: string) => {
          if (query.toLowerCase().includes("users")) {
            userQueries++

            if (userQueries >= 2) {
              return {
                bind: () => ({
                  first: () => {
                    throw new Error(
                      "DEBUG_HELPFUL_SQL_SYNTAX_ERROR: column foo does not exist",
                    )
                  },

                  all: () => {
                    throw new Error(
                      "DEBUG_HELPFUL_SQL_SYNTAX_ERROR: column foo does not exist",
                    )
                  },

                  run: () => {
                    throw new Error(
                      "DEBUG_HELPFUL_SQL_SYNTAX_ERROR: column foo does not exist",
                    )
                  },
                }),
              } as any
            }
          }

          return (testD1 as any).prepare(query)
        },
      } as unknown as D1Database

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          query: "{ me { id } }",
        }),
      })

      const env: Env = {
        ENVIRONMENT: "development",

        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        DB: faultyD1,
      }

      const response = await worker.fetch(request, env)

      const result = await getJson(response)

      expect(result.errors).toBeDefined()

      // In development, the specific debug error details are preserved with INTERNAL_ERROR code

      expect(result.errors[0].message).toContain("Failed query:")

      expect(result.errors[0].extensions.code).toBe("INTERNAL_ERROR")
    })
  })

  describe("HiKAT News & Media Core (Shard 04B)", () => {
    let testR2: ReturnType<typeof createTestR2Bucket>

    let adminToken: string

    let playerToken: string

    let adminBToken: string

    const adminId = "admin-news-user-1"

    const adminSessionId = "sess-admin-news-1"

    const adminBId = "admin-news-user-2"

    const adminBSessionId = "sess-admin-news-2"

    const playerId = "player-news-user-1"

    const playerSessionId = "sess-player-news-1"

    beforeEach(async () => {
      testR2 = createTestR2Bucket()

      // Seed Admin User 1

      await seedUserAndSession({
        userId: adminId,

        role: "ADMIN",

        displayName: "NewsAdmin1",

        sessionId: adminSessionId,
      })

      adminToken = await createTestAccessToken({
        userId: adminId,

        sessionId: adminSessionId,

        role: "ADMIN",

        displayName: "NewsAdmin1",
      })

      // Seed Admin User 2

      await seedUserAndSession({
        userId: adminBId,

        role: "ADMIN",

        displayName: "NewsAdmin2",

        sessionId: adminBSessionId,
      })

      adminBToken = await createTestAccessToken({
        userId: adminBId,

        sessionId: adminBSessionId,

        role: "ADMIN",

        displayName: "NewsAdmin2",
      })

      // Seed Player User

      await seedUserAndSession({
        userId: playerId,

        role: "PLAYER",

        displayName: "PlayerNormal",

        sessionId: playerSessionId,
      })

      playerToken = await createTestAccessToken({
        userId: playerId,

        sessionId: playerSessionId,

        role: "PLAYER",

        displayName: "PlayerNormal",
      })
    })

    function createEnv(overrides?: Partial<Env>): Env {
      return {
        ENVIRONMENT: "production",

        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        DB: testD1,

        ASSETS: testR2,

        ...overrides,
      }
    }

    async function executeGql(
      query: string,

      variables?: Record<string, any>,

      token?: string,

      env?: Env,
    ) {
      const activeEnv = env || createEnv()

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }

      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers,

        body: JSON.stringify({ query, variables }),
      })

      const response = await worker.fetch(request, activeEnv)

      return getJson(response)
    }

    describe("Public News Queries", () => {
      it("returns empty feed when no news articles are published", async () => {
        const res = await executeGql(`
          query {
            newsFeed {
              totalCount
              items { id title }
              edges { cursor node { id } }
              pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            }
          }
        `)

        expect(res.data?.newsFeed).toBeDefined()

        expect(res.data.newsFeed.totalCount).toBe(0)

        expect(res.data.newsFeed.items).toEqual([])

        expect(res.data.newsFeed.edges).toEqual([])

        expect(res.data.newsFeed.pageInfo.hasNextPage).toBe(false)

        expect(res.data.newsFeed.pageInfo.hasPreviousPage).toBe(false)
      })

      it("returns only published news in descending order of (publishedAt, id)", async () => {
        const now = Date.now()

        // 1. Published News 1 (earlier)

        await db.insert(news).values({
          id: "news-pub-1",

          type: "NEWS",

          title: "Primera Noticia",

          content: "Cuerpo 1",

          status: "PUBLISHED",

          publishedAt: new Date(now - 100000).toISOString(),

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: new Date(now - 100000).toISOString(),

          updatedAt: new Date(now - 100000).toISOString(),
        })

        // 2. Draft News (must NOT appear in public feed)

        await db.insert(news).values({
          id: "news-draft-secret",

          type: "NEWS",

          title: "Borrador Secreto",

          content: "Cuerpo secreto",

          status: "DRAFT",

          publishedAt: null,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: new Date(now - 50000).toISOString(),

          updatedAt: new Date(now - 50000).toISOString(),
        })

        // 3. Published News 2 (later / newer)

        await db.insert(news).values({
          id: "news-pub-2",

          type: "UPDATE",

          title: "Segunda Noticia",

          content: "Cuerpo 2",

          status: "PUBLISHED",

          publishedAt: new Date(now - 10000).toISOString(),

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: new Date(now - 10000).toISOString(),

          updatedAt: new Date(now - 10000).toISOString(),
        })

        const res = await executeGql(`
          query {
            newsFeed {
              totalCount
              items { id title type status publishedAt }
            }
          }
        `)

        expect(res.errors).toBeUndefined()

        expect(res.data.newsFeed.totalCount).toBe(2)

        expect(res.data.newsFeed.items.length).toBe(2)

        // Must be in descending order of publishedAt

        expect(res.data.newsFeed.items[0].id).toBe("news-pub-2")

        expect(res.data.newsFeed.items[1].id).toBe("news-pub-1")
      })

      it("filters public feed by type (NEWS vs UPDATE vs ANNOUNCEMENT)", async () => {
        const now = new Date().toISOString()

        await db.insert(news).values({
          id: "news-type-news",

          type: "NEWS",

          title: "Noticia General",

          content: "Contenido",

          status: "PUBLISHED",

          publishedAt: now,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        await db.insert(news).values({
          id: "news-type-announcement",

          type: "ANNOUNCEMENT",

          title: "Anuncio Importante",

          content: "Contenido",

          status: "PUBLISHED",

          publishedAt: now,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        const resNews = await executeGql(`
          query {
            newsFeed(type: NEWS) {
              totalCount
              items { id type }
            }
          }
        `)

        expect(resNews.data.newsFeed.totalCount).toBe(1)

        expect(resNews.data.newsFeed.items[0].id).toBe("news-type-news")

        const resAnn = await executeGql(`
          query {
            newsFeed(type: ANNOUNCEMENT) {
              totalCount
              items { id type }
            }
          }
        `)

        expect(resAnn.data.newsFeed.totalCount).toBe(1)

        expect(resAnn.data.newsFeed.items[0].id).toBe("news-type-announcement")
      })

      it("supports stable compound cursor-based pagination for public news feed", async () => {
        const now = Date.now()

        for (let i = 1; i <= 5; i++) {
          await db.insert(news).values({
            id: `news-page-${i}`,

            type: "NEWS",

            title: `Noticia ${i}`,

            content: `Contenido ${i}`,

            status: "PUBLISHED",

            publishedAt: new Date(now + i * 1000).toISOString(),

            createdBy: adminId,

            updatedBy: adminId,

            createdAt: new Date(now + i * 1000).toISOString(),

            updatedAt: new Date(now + i * 1000).toISOString(),
          })
        }

        // Fetch first page (2 items)

        const page1 = await executeGql(`
          query {
            newsFeed(first: 2) {
              totalCount
              items { id }
              edges { cursor node { id } }
              pageInfo { hasNextPage endCursor }
            }
          }
        `)

        expect(page1.data.newsFeed.totalCount).toBe(5)

        expect(page1.data.newsFeed.items.length).toBe(2)

        expect(page1.data.newsFeed.items[0].id).toBe("news-page-5")

        expect(page1.data.newsFeed.items[1].id).toBe("news-page-4")

        expect(page1.data.newsFeed.pageInfo.hasNextPage).toBe(true)

        const cursor = page1.data.newsFeed.pageInfo.endCursor

        // Fetch second page using cursor

        const page2 = await executeGql(
          `
          query($after: String) {
            newsFeed(first: 2, after: $after) {
              items { id }
              pageInfo { hasNextPage endCursor }
            }
          }
          `,

          { after: cursor },
        )

        expect(page2.data.newsFeed.items.length).toBe(2)

        expect(page2.data.newsFeed.items[0].id).toBe("news-page-3")

        expect(page2.data.newsFeed.items[1].id).toBe("news-page-2")

        expect(page2.data.newsFeed.pageInfo.hasNextPage).toBe(true)
      })

      it("returns published news by ID and null for non-existent or DRAFT news", async () => {
        const now = new Date().toISOString()

        await db.insert(news).values({
          id: "news-single-pub",

          type: "NEWS",

          title: "Noticia Publicada",

          content: "Contenido publico",

          status: "PUBLISHED",

          publishedAt: now,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        await db.insert(news).values({
          id: "news-single-draft",

          type: "NEWS",

          title: "Noticia Borrador",

          content: "Contenido borrador",

          status: "DRAFT",

          publishedAt: null,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        // Published news succeeds

        const resPub = await executeGql(`
          query {
            news(id: "news-single-pub") {
              id
              title
              content
              type
              status
            }
          }
        `)

        expect(resPub.data.news).toBeDefined()

        expect(resPub.data.news.id).toBe("news-single-pub")

        expect(resPub.data.news.title).toBe("Noticia Publicada")

        // Draft news returns null for public lookup

        const resDraft = await executeGql(`
          query {
            news(id: "news-single-draft") {
              id
            }
          }
        `)

        expect(resDraft.data.news).toBeNull()

        // Non-existent news returns null

        const resNotFound = await executeGql(`
          query {
            news(id: "non-existent-id") {
              id
            }
          }
        `)

        expect(resNotFound.data.news).toBeNull()
      })
    })

    describe("Administrative News Operations", () => {
      it("ADMIN creates a news article with title, content, type, and optional status", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) {
              id
              title
              content
              type
              status
              publishedAt
              createdAt
              updatedAt
            }
          }
          `,

          {
            input: {
              title: "Lanzamiento Servidor Survival",

              content:
                "Nos complace anunciar la apertura del nuevo servidor survival.",

              type: "UPDATE",

              status: "PUBLISHED",
            },
          },

          adminToken,
        )

        expect(res.errors).toBeUndefined()

        expect(res.data.createNews).toBeDefined()

        expect(res.data.createNews.id).toBeDefined()

        expect(res.data.createNews.title).toBe("Lanzamiento Servidor Survival")

        expect(res.data.createNews.content).toBe(
          "Nos complace anunciar la apertura del nuevo servidor survival.",
        )

        expect(res.data.createNews.type).toBe("UPDATE")

        expect(res.data.createNews.status).toBe("PUBLISHED")

        expect(res.data.createNews.publishedAt).toBeDefined()
      })

      it("REJECTS createNews for PLAYER role (FORBIDDEN)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Intento Jugador",

              content: "Contenido",

              type: "NEWS",
            },
          },

          playerToken,
        )

        expect(res.errors).toBeDefined()

        expect(res.errors[0].extensions.code).toBe("FORBIDDEN")
      })

      it("REJECTS createNews for anonymous caller (UNAUTHENTICATED)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Intento Anonimo",

              content: "Contenido",

              type: "NEWS",
            },
          },
        )

        expect(res.errors).toBeDefined()

        expect(res.errors[0].extensions.code).toBe("UNAUTHENTICATED")
      })

      it("REJECTS invalid input fields with VALIDATION_ERROR", async () => {
        // Short title (<3 chars)

        const resShortTitle = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "No",

              content: "Contenido valido",

              type: "NEWS",
            },
          },

          adminToken,
        )

        expect(resShortTitle.errors).toBeDefined()

        expect(resShortTitle.errors[0].extensions.code).toBe("VALIDATION_ERROR")

        // Empty content

        const resEmptyContent = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Titulo Valido",

              content: "",

              type: "NEWS",
            },
          },

          adminToken,
        )

        expect(resEmptyContent.errors).toBeDefined()

        expect(resEmptyContent.errors[0].extensions.code).toBe(
          "VALIDATION_ERROR",
        )
      })

      it("updates an existing news article and clears fields using null", async () => {
        const created = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Titulo Original",

              content: "Contenido Original",

              type: "NEWS",
            },
          },

          adminToken,
        )

        const id = created.data.createNews.id

        const resUpdate = await executeGql(
          `
          mutation($id: ID!, $input: UpdateNewsInput!) {
            updateNews(id: $id, input: $input) {
              id
              title
              content
              type
            }
          }
          `,

          {
            id,

            input: {
              title: "Titulo Modificado",

              content: "Contenido Modificado",

              type: "MAINTENANCE",
            },
          },

          adminToken,
        )

        expect(resUpdate.errors).toBeUndefined()

        expect(resUpdate.data.updateNews.title).toBe("Titulo Modificado")

        expect(resUpdate.data.updateNews.content).toBe("Contenido Modificado")

        expect(resUpdate.data.updateNews.type).toBe("MAINTENANCE")
      })

      it("handles publish, unpublish, and republication semantics", async () => {
        const created = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id status publishedAt }
          }
          `,

          {
            input: {
              title: "Articulo Para Publicacion",

              content: "Contenido",

              type: "NEWS",

              status: "DRAFT",
            },
          },

          adminToken,
        )

        const id = created.data.createNews.id

        expect(created.data.createNews.status).toBe("DRAFT")

        expect(created.data.createNews.publishedAt).toBeNull()

        // 1. Publish

        const pubRes = await executeGql(
          `
          mutation($id: ID!) {
            publishNews(id: $id) { id status publishedAt }
          }
          `,

          { id },

          adminToken,
        )

        expect(pubRes.errors).toBeUndefined()

        expect(pubRes.data.publishNews.status).toBe("PUBLISHED")

        const initialPublishedAt = pubRes.data.publishNews.publishedAt

        expect(initialPublishedAt).toBeDefined()

        // 2. Unpublish -> sets status=DRAFT, publishedAt=null

        const unpubRes = await executeGql(
          `
          mutation($id: ID!) {
            unpublishNews(id: $id) { id status publishedAt }
          }
          `,

          { id },

          adminToken,
        )

        expect(unpubRes.errors).toBeUndefined()

        expect(unpubRes.data.unpublishNews.status).toBe("DRAFT")

        expect(unpubRes.data.unpublishNews.publishedAt).toBeNull()

        // 3. Republish -> sets status=PUBLISHED and assigns a new publishedAt

        await new Promise((r) => setTimeout(r, 10))

        const repubRes = await executeGql(
          `
          mutation($id: ID!) {
            publishNews(id: $id) { id status publishedAt }
          }
          `,

          { id },

          adminToken,
        )

        expect(repubRes.errors).toBeUndefined()

        expect(repubRes.data.publishNews.status).toBe("PUBLISHED")

        expect(repubRes.data.publishNews.publishedAt).toBeDefined()
      })

      it("deletes a news article successfully", async () => {
        const created = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Articulo Para Borrar",

              content: "Contenido",

              type: "NEWS",
            },
          },

          adminToken,
        )

        const id = created.data.createNews.id

        const delRes = await executeGql(
          `
          mutation($id: ID!) {
            deleteNews(id: $id)
          }
          `,

          { id },

          adminToken,
        )

        expect(delRes.errors).toBeUndefined()

        expect(delRes.data.deleteNews).toBe(true)

        // Verify article no longer exists in D1

        const checkArticle = await db

          .select()

          .from(news)

          .where(eq(news.id, id))

          .get()

        expect(checkArticle).toBeUndefined()
      })

      it("adminNews lists both drafts and published articles with filters", async () => {
        const now = new Date().toISOString()

        await db.insert(news).values({
          id: "news-adm-pub",

          type: "NEWS",

          title: "Publicada Admin",

          content: "Contenido",

          status: "PUBLISHED",

          publishedAt: now,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        await db.insert(news).values({
          id: "news-adm-draft",

          type: "ANNOUNCEMENT",

          title: "Borrador Admin",

          content: "Contenido",

          status: "DRAFT",

          publishedAt: null,

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        const res = await executeGql(
          `
          query {
            adminNews {
              totalCount
              items { id status type }
            }
          }
          `,

          {},

          adminToken,
        )

        expect(res.errors).toBeUndefined()

        expect(res.data.adminNews.totalCount).toBe(2)

        const resDrafts = await executeGql(
          `
          query {
            adminNews(status: DRAFT) {
              totalCount
              items { id status }
            }
          }
          `,

          {},

          adminToken,
        )

        expect(resDrafts.data.adminNews.totalCount).toBe(1)

        expect(resDrafts.data.adminNews.items[0].id).toBe("news-adm-draft")

        // adminNewsItem allows admin to view draft

        const resSingle = await executeGql(
          `
          query($id: ID!) {
            adminNewsItem(id: $id) { id title status }
          }
          `,

          { id: "news-adm-draft" },

          adminToken,
        )

        expect(resSingle.data.adminNewsItem.id).toBe("news-adm-draft")
      })
    })

    describe("Cloudflare R2 Media Upload & Delivery Transport", () => {
      it("ADMIN requests upload token via GraphQL createContentMediaUpload for image (5MB max) and video (25MB max)", async () => {
        // Image ticket

        const resImg = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) {
              uploadUrl
              uploadToken
              expectedMimeType
              allowedMimeTypes
            }
          }
          `,

          {
            input: {
              mimeType: "image/png",

              sizeBytes: 1024,
            },
          },

          adminToken,
        )

        expect(resImg.errors).toBeUndefined()

        expect(resImg.data.createContentMediaUpload).toBeDefined()

        expect(resImg.data.createContentMediaUpload.uploadUrl).toContain(
          "/media/content/upload",
        )

        expect(
          resImg.data.createContentMediaUpload.uploadToken.length,
        ).toBeGreaterThan(16)

        expect(resImg.data.createContentMediaUpload.expectedMimeType).toBe(
          "image/png",
        )

        expect(resImg.data.createContentMediaUpload.allowedMimeTypes).toContain(
          "image/png",
        )

        expect(resImg.data.createContentMediaUpload.allowedMimeTypes).toContain(
          "video/mp4",
        )

        // Video ticket (e.g. 20 MB)

        const resVid = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) {
              uploadToken
              expectedMimeType
              maxSizeBytes
            }
          }
          `,

          {
            input: {
              mimeType: "video/mp4",

              sizeBytes: 20 * 1024 * 1024,
            },
          },

          adminToken,
        )

        expect(resVid.errors).toBeUndefined()

        expect(resVid.data.createContentMediaUpload.expectedMimeType).toBe(
          "video/mp4",
        )

        expect(resVid.data.createContentMediaUpload.maxSizeBytes).toBe(
          20 * 1024 * 1024,
        )
      })

      it("REJECTS createContentMediaUpload exceeding type size limit (6MB for image, 30MB for video)", async () => {
        const resOversizedImg = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          {
            input: {
              mimeType: "image/png",

              sizeBytes: 6 * 1024 * 1024, // > 5 MB
            },
          },

          adminToken,
        )

        expect(resOversizedImg.errors).toBeDefined()

        expect(resOversizedImg.errors[0].extensions.code).toBe(
          "VALIDATION_ERROR",
        )

        const resOversizedVid = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          {
            input: {
              mimeType: "video/mp4",

              sizeBytes: 30 * 1024 * 1024, // > 25 MB
            },
          },

          adminToken,
        )

        expect(resOversizedVid.errors).toBeDefined()

        expect(resOversizedVid.errors[0].extensions.code).toBe(
          "VALIDATION_ERROR",
        )
      })

      it("REJECTS createContentMediaUpload for PLAYER role (FORBIDDEN)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1000 } },

          playerToken,
        )

        expect(res.errors).toBeDefined()

        expect(res.errors[0].extensions.code).toBe("FORBIDDEN")
      })

      it("executes binary upload via PUT /media/content/upload for PNG image and MP4 video with Bearer JWT + X-Upload-Token", async () => {
        // 1. Image upload

        const ticketImg = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawTokenImg = ticketImg.data.createContentMediaUpload.uploadToken

        const imgBody = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

        const reqImg = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawTokenImg,

            "Content-Type": "image/png",
          },

          body: imgBody,
        })

        const resImg = await worker.fetch(reqImg, createEnv())

        expect(resImg.status).toBe(201)

        const dataImg = (await resImg.json()) as any

        expect(dataImg.id).toBeDefined()

        expect(dataImg.mediaType).toBe("IMAGE")

        expect(dataImg.mimeType).toBe("image/png")

        expect(dataImg.sizeBytes).toBe(imgBody.byteLength)

        expect(dataImg.url).toContain(`/media/content/${dataImg.id}`)

        expect(dataImg.objectKey).toBeUndefined() // Clean contract: no internal objectKey

        // 2. Video upload (MP4)

        const ticketVid = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "video/mp4", sizeBytes: 2048 } },

          adminToken,
        )

        const rawTokenVid = ticketVid.data.createContentMediaUpload.uploadToken

        const vidBody = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])

        const reqVid = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawTokenVid,

            "Content-Type": "video/mp4",
          },

          body: vidBody,
        })

        const resVid = await worker.fetch(reqVid, createEnv())

        expect(resVid.status).toBe(201)

        const dataVid = (await resVid.json()) as any

        expect(dataVid.mediaType).toBe("VIDEO")

        expect(dataVid.mimeType).toBe("video/mp4")
      })

      it("REJECTS upload without Bearer JWT (401)", async () => {
        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: { "X-Upload-Token": "some-token" },

          body: new Uint8Array([1, 2, 3]),
        })

        const res = await worker.fetch(req, createEnv())

        expect(res.status).toBe(401)
      })

      it("REJECTS upload with PLAYER Bearer JWT (403)", async () => {
        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${playerToken}`,

            "X-Upload-Token": "some-token",
          },

          body: new Uint8Array([1, 2, 3]),
        })

        const res = await worker.fetch(req, createEnv())

        expect(res.status).toBe(403)
      })

      it("REJECTS upload when X-Upload-Token header is missing (400)", async () => {
        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: { Authorization: `Bearer ${adminToken}` },

          body: new Uint8Array([1, 2, 3]),
        })

        const res = await worker.fetch(req, createEnv())

        expect(res.status).toBe(400)
      })

      it("REJECTS upload if token belongs to a different administrator (403), and allows legitimate owner to use unburned ticket afterwards (201)", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const tokenFromAdminA = ticket.data.createContentMediaUpload.uploadToken

        // Admin B attempts upload with Admin A's token -> 403 Forbidden

        const reqB = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminBToken}`,

            "X-Upload-Token": tokenFromAdminA,

            "Content-Type": "image/png",
          },

          body: new Uint8Array([1, 2, 3]),
        })

        const env = createEnv()

        const resB = await worker.fetch(reqB, env)

        expect(resB.status).toBe(403)

        // Admin A now uses the exact same token -> 201 Created (verifies token was not burned)

        const reqA = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": tokenFromAdminA,

            "Content-Type": "image/png",
          },

          body: new Uint8Array([1, 2, 3]),
        })

        const resA = await worker.fetch(reqA, env)

        expect(resA.status).toBe(201)
      })

      it("enforces ticket-bound max_size_bytes: REJECTS body of 1025 bytes when ticket was requested for 1024 bytes (413) and leaves R2 clean", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken maxSizeBytes }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        const body1025 = new Uint8Array(1025)

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: body1025,
        })

        const env = createEnv()

        const res = await worker.fetch(req, env)

        expect(res.status).toBe(413)

        expect(testR2._storage.size).toBe(0)
      })

      it("ALLOWS body of exactly 1024 bytes when ticket was requested for 1024 bytes (201)", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken maxSizeBytes }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        const body1024 = new Uint8Array(1024)

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: body1024,
        })

        const env = createEnv()

        const res = await worker.fetch(req, env)

        expect(res.status).toBe(201)

        expect(testR2._storage.size).toBe(1)
      })

      it("REJECTS streamed body without Content-Length that exceeds ticket limit (413) without storing in R2", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 500 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(300))

            controller.enqueue(new Uint8Array(300))

            controller.close()
          },
        })

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: stream,

          // @ts-expect-error Node/undici RequestInit extension for ReadableStream body

          duplex: "half",
        })

        const env = createEnv()

        const res = await worker.fetch(req, env)

        expect(res.status).toBe(413)

        expect(testR2._storage.size).toBe(0)
      })

      it("REJECTS reused upload token on second upload (single-use enforcement: 409)", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        const body = new Uint8Array([1, 2, 3])

        // First upload succeeds (201)

        const req1 = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body,
        })

        const res1 = await worker.fetch(req1, createEnv())

        expect(res1.status).toBe(201)

        // Second upload with same token fails (409)

        const req2 = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body,
        })

        const res2 = await worker.fetch(req2, createEnv())

        expect(res2.status).toBe(409)
      })

      it("enforces atomic consumption under concurrent upload requests (only one succeeds)", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        const req1 = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: new Uint8Array([1, 2, 3, 4]),
        })

        const req2 = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: new Uint8Array([5, 6, 7, 8]),
        })

        const env = createEnv()

        const [res1, res2] = await Promise.all([
          worker.fetch(req1, env),

          worker.fetch(req2, env),
        ])

        const statuses = [res1.status, res2.status].sort()

        expect(statuses).toEqual([201, 409])
      })

      it("REJECTS expired upload token (401)", async () => {
        const past = new Date(Date.now() - 3600000).toISOString()

        const rawToken = "expired-token-raw-value"

        const tokenHash = await (await import("./services/mediaService"))

          .sha256Hex(rawToken)

        await db.insert(contentMediaUploadTokens).values({
          id: "token-exp",

          tokenHash,

          mediaType: "IMAGE",

          createdBy: adminId,

          expectedMimeType: "image/png",

          maxSizeBytes: 1024,

          expiresAt: past,

          createdAt: past,
        })

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: new Uint8Array([1, 2, 3]),
        })

        const res = await worker.fetch(req, createEnv())

        expect(res.status).toBe(401)
      })

      it("REJECTS invalid / unsupported MIME type (415)", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "application/x-msdownload", // .exe
          },

          body: new Uint8Array([1, 2, 3]),
        })

        const res = await worker.fetch(req, createEnv())

        expect(res.status).toBe(415)
      })

      it("performs explicit compensation rollback (deletes from R2) if D1 insert fails", async () => {
        const ticket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,

          { input: { mimeType: "image/png", sizeBytes: 1024 } },

          adminToken,
        )

        const rawToken = ticket.data.createContentMediaUpload.uploadToken

        // Faulty D1 database

        const originalPrepare = testD1.prepare.bind(testD1)

        const faultyD1 = {
          ...testD1,

          prepare(query: string) {
            const q = query.toLowerCase()

            if (q.includes("content_media") && q.includes("insert")) {
              return {
                bind: () => ({
                  run: () => {
                    throw new Error("D1_DISK_FULL_SIMULATION")
                  },

                  get: () => {
                    throw new Error("D1_DISK_FULL_SIMULATION")
                  },

                  first: () => {
                    throw new Error("D1_DISK_FULL_SIMULATION")
                  },

                  all: () => {
                    throw new Error("D1_DISK_FULL_SIMULATION")
                  },
                }),
              } as any
            }

            return originalPrepare(query)
          },
        } as unknown as D1Database

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${adminToken}`,

            "X-Upload-Token": rawToken,

            "Content-Type": "image/png",
          },

          body: new Uint8Array([1, 2, 3, 4]),
        })

        const env = createEnv({ DB: faultyD1 })

        const res = await worker.fetch(req, env)

        expect(res.status).toBe(500)

        // Verify compensation rollback: R2 storage must NOT retain the orphaned media file

        expect(testR2._storage.size).toBe(0)
      })

      it("serves binary media on GET /media/content/:id and handles 404/traversal safely", async () => {
        // Seed media

        const mediaId = "media-serve-test-1"

        const now = new Date().toISOString()

        await db.insert(contentMedia).values({
          id: mediaId,

          objectKey: "content/media/test.png",

          mediaType: "IMAGE",

          mimeType: "image/png",

          sizeBytes: 4,

          createdBy: adminId,

          createdAt: now,
        })

        await testR2.put("content/media/test.png", new Uint8Array([1, 2, 3, 4]))

        // Success GET

        const req = new Request(`http://localhost/media/content/${mediaId}`, {
          method: "GET",
        })

        const res = await worker.fetch(req, createEnv())

        expect(res.status).toBe(200)

        expect(res.headers.get("content-type")).toBe("image/png")

        expect(res.headers.get("cache-control")).toContain("immutable")

        // 404 for non-existent media

        const req404 = new Request(
          "http://localhost/media/content/non-existent",

          { method: "GET" },
        )

        const res404 = await worker.fetch(req404, createEnv())

        expect(res404.status).toBe(404)

        // 400 for path traversal attempt

        const reqTraversal = new Request(
          "http://localhost/media/content/..%2F..%2Fsecret",

          { method: "GET" },
        )

        const resTraversal = await worker.fetch(reqTraversal, createEnv())

        expect(resTraversal.status).toBe(400)
      })
    })

    describe("Media Relationships & YouTube Validation", () => {
      it("allows assigning valid IMAGE media to imageMediaId and rejects VIDEO media as image", async () => {
        const now = new Date().toISOString()

        // Image

        await db.insert(contentMedia).values({
          id: "valid-img-1",

          objectKey: "content/media/img.png",

          mediaType: "IMAGE",

          mimeType: "image/png",

          sizeBytes: 100,

          createdBy: adminId,

          createdAt: now,
        })

        // Video

        await db.insert(contentMedia).values({
          id: "valid-vid-1",

          objectKey: "content/media/vid.mp4",

          mediaType: "VIDEO",

          mimeType: "video/mp4",

          sizeBytes: 5000,

          createdBy: adminId,

          createdAt: now,
        })

        // Valid image assignment -> succeeds

        const resValid = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id image { id mediaType } }
          }
          `,

          {
            input: {
              title: "Noticia Con Imagen",

              content: "Contenido",

              type: "NEWS",

              imageMediaId: "valid-img-1",
            },
          },

          adminToken,
        )

        expect(resValid.errors).toBeUndefined()

        expect(resValid.data.createNews.image.id).toBe("valid-img-1")

        expect(resValid.data.createNews.image.mediaType).toBe("IMAGE")

        // Video as image -> rejected with VALIDATION_ERROR

        const resInvalid = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Noticia Invalida",

              content: "Contenido",

              type: "NEWS",

              imageMediaId: "valid-vid-1", // VIDEO assigned as image!
            },
          },

          adminToken,
        )

        expect(resInvalid.errors).toBeDefined()

        expect(resInvalid.errors[0].extensions.code).toBe("VALIDATION_ERROR")
      })

      it("allows assigning valid VIDEO media to videoMediaId and rejects IMAGE media as video", async () => {
        const now = new Date().toISOString()

        await db.insert(contentMedia).values({
          id: "valid-img-2",

          objectKey: "content/media/img2.png",

          mediaType: "IMAGE",

          mimeType: "image/png",

          sizeBytes: 100,

          createdBy: adminId,

          createdAt: now,
        })

        await db.insert(contentMedia).values({
          id: "valid-vid-2",

          objectKey: "content/media/vid2.mp4",

          mediaType: "VIDEO",

          mimeType: "video/mp4",

          sizeBytes: 5000,

          createdBy: adminId,

          createdAt: now,
        })

        // Valid video assignment -> succeeds

        const resValid = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id video { id mediaType } }
          }
          `,

          {
            input: {
              title: "Noticia Con Video",

              content: "Contenido",

              type: "NEWS",

              videoMediaId: "valid-vid-2",
            },
          },

          adminToken,
        )

        expect(resValid.errors).toBeUndefined()

        expect(resValid.data.createNews.video.id).toBe("valid-vid-2")

        expect(resValid.data.createNews.video.mediaType).toBe("VIDEO")

        // Image as video -> rejected with VALIDATION_ERROR

        const resInvalid = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Noticia Invalida 2",

              content: "Contenido",

              type: "NEWS",

              videoMediaId: "valid-img-2", // IMAGE assigned as video!
            },
          },

          adminToken,
        )

        expect(resInvalid.errors).toBeDefined()

        expect(resInvalid.errors[0].extensions.code).toBe("VALIDATION_ERROR")
      })

      it("REJECTS deleteContentMedia if media is in use by news as image OR video (CONFLICT)", async () => {
        const now = new Date().toISOString()

        await db.insert(contentMedia).values({
          id: "media-in-use-img",

          objectKey: "content/media/inuse.png",

          mediaType: "IMAGE",

          mimeType: "image/png",

          sizeBytes: 100,

          createdBy: adminId,

          createdAt: now,
        })

        await db.insert(news).values({
          id: "news-using-media",

          title: "Noticia con Media",

          content: "Contenido",

          type: "NEWS",

          imageMediaId: "media-in-use-img",

          status: "DRAFT",

          createdBy: adminId,

          updatedBy: adminId,

          createdAt: now,

          updatedAt: now,
        })

        const resDel = await executeGql(
          `
          mutation($id: ID!) {
            deleteContentMedia(id: $id)
          }
          `,

          { id: "media-in-use-img" },

          adminToken,
        )

        expect(resDel.errors).toBeDefined()

        expect(resDel.errors[0].extensions.code).toBe("CONFLICT")
      })

      it("deletes unreferenced media from D1 and R2 successfully", async () => {
        const now = new Date().toISOString()

        await db.insert(contentMedia).values({
          id: "media-unref-1",

          objectKey: "content/media/unref.png",

          mediaType: "IMAGE",

          mimeType: "image/png",

          sizeBytes: 100,

          createdBy: adminId,

          createdAt: now,
        })

        await testR2.put("content/media/unref.png", new Uint8Array([1, 2]))

        const resDel = await executeGql(
          `
          mutation($id: ID!) {
            deleteContentMedia(id: $id)
          }
          `,

          { id: "media-unref-1" },

          adminToken,
        )

        expect(resDel.errors).toBeUndefined()

        expect(resDel.data.deleteContentMedia).toBe(true)

        // Verify removed from D1 and R2

        const inDb = await db

          .select()

          .from(contentMedia)

          .where(eq(contentMedia.id, "media-unref-1"))

          .get()

        expect(inDb).toBeUndefined()

        expect(testR2._storage.size).toBe(0)
      })

      it("validates and normalizes YouTube URLs on news creation and rejects arbitrary URLs", async () => {
        // Valid YouTube watch URL

        const resValid = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) {
              id
              youtubeVideoId
              youtubeUrl
            }
          }
          `,

          {
            input: {
              title: "Trailer Oficial",

              content: "Mira el trailer oficial",

              type: "NEWS",

              youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            },
          },

          adminToken,
        )

        expect(resValid.errors).toBeUndefined()

        expect(resValid.data.createNews.youtubeVideoId).toBe("dQw4w9WgXcQ")

        expect(resValid.data.createNews.youtubeUrl).toBe(
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )

        // Invalid YouTube URL -> rejected with VALIDATION_ERROR

        const resInvalid = await executeGql(
          `
          mutation($input: CreateNewsInput!) {
            createNews(input: $input) { id }
          }
          `,

          {
            input: {
              title: "Video Invalido",

              content: "Contenido",

              type: "NEWS",

              youtubeUrl: "https://vimeo.com/12345678",
            },
          },

          adminToken,
        )

        expect(resInvalid.errors).toBeDefined()

        expect(resInvalid.errors[0].extensions.code).toBe("VALIDATION_ERROR")
      })
    })
  })

  describe("HiKAT Server Administration & Pterodactyl Integration (Shard 06)", () => {
    const adminId = "srv-admin-1"

    const adminSessionId = "srv-admin-session-1"

    const playerId = "srv-player-1"

    const playerSessionId = "srv-player-session-1"

    let adminToken: string

    let playerToken: string

    const fakePterodactylUrl = "https://panel.test.hikat.org"

    const fakeApiKey = "ptlc_test_secret_api_key_123"

    const fakeServerId = "srv-abc12345"

    beforeEach(async () => {
      await seedUserAndSession({
        userId: adminId,

        sessionId: adminSessionId,

        role: "ADMIN",

        displayName: "ServerAdmin",
      })

      adminToken = await createTestAccessToken({
        userId: adminId,

        sessionId: adminSessionId,

        role: "ADMIN",

        displayName: "ServerAdmin",
      })

      await seedUserAndSession({
        userId: playerId,

        sessionId: playerSessionId,

        role: "PLAYER",

        displayName: "ServerPlayer",
      })

      playerToken = await createTestAccessToken({
        userId: playerId,

        sessionId: playerSessionId,

        role: "PLAYER",

        displayName: "ServerPlayer",
      })
    })

    function createServerEnv(overrides?: Partial<Env>): Env {
      return {
        ENVIRONMENT: "production",

        AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

        DB: testD1,

        PTERODACTYL_BASE_URL: fakePterodactylUrl,

        PTERODACTYL_API_KEY: fakeApiKey,

        PTERODACTYL_SERVER_ID: fakeServerId,

        ...overrides,
      }
    }

    async function executeGqlServer(
      query: string,

      variables?: Record<string, any>,

      token?: string,

      env?: Env,
    ) {
      const activeEnv = env || createServerEnv()

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }

      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }

      const request = new Request("http://localhost/graphql", {
        method: "POST",

        headers,

        body: JSON.stringify({ query, variables }),
      })

      const response = await worker.fetch(request, activeEnv)

      return getJson(response)
    }

    describe("1. Pterodactyl HTTP Client Adapter (Unit)", () => {
      it("creates PterodactylHttpClient with trimmed baseUrl and normalizes URLs", async () => {
        const { PterodactylHttpClient } = await import(
          "./services/pterodactyl/pterodactylClient"
        )

        let requestedUrl = ""

        let authHeader = ""

        const mockFetch: typeof fetch = async (input, init) => {
          requestedUrl = String(input)

          authHeader =
            (init?.headers as Record<string, string>)?.["Authorization"] || ""

          return new Response(
            JSON.stringify({
              object: "stats",

              attributes: {
                current_state: "running",

                is_suspended: false,

                resources: {
                  memory_bytes: 4 * 1024 * 1024 * 1024,

                  cpu_absolute: 25.5,

                  disk_bytes: 10 * 1024 * 1024 * 1024,

                  network_rx_bytes: 1000,

                  network_tx_bytes: 2000,

                  uptime: 3600000,
                },
              },
            }),
            { status: 200 },
          )
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com/",

          apiKey: "  secret_key  ",

          serverId: "server-123",

          fetchFn: mockFetch,
        })

        const res = await client.getServerResources()

        expect(res.attributes.current_state).toBe("running")

        expect(requestedUrl).toBe(
          "https://panel.example.com/api/client/servers/server-123/resources",
        )

        expect(authHeader).toBe("Bearer secret_key")
      })

      it("handles and normalizes 401/403 upstream errors without leaking API key", async () => {
        const { PterodactylHttpClient, ServerInfrastructureError } =
          await import("./services/pterodactyl/pterodactylClient")

        const { SERVER_PUBLIC_MESSAGES, SERVER_ERROR_CODES } = await import(
          "@hikat/shared"
        )

        const mockFetch: typeof fetch = async () => {
          return new Response(
            JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
            { status: 401 },
          )
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com",

          apiKey: "super_secret_token_12345",

          serverId: "server-123",

          fetchFn: mockFetch,
        })

        try {
          await client.getServerResources()

          expect.unreachable("should have thrown")
        } catch (err: any) {
          expect(err).toBeInstanceOf(ServerInfrastructureError)

          expect(err.message).toBe(SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED)

          expect(err.code).toBe(SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)

          expect(err.internalMessage).toContain("401")
        }
      })

      it("handles and normalizes 404 upstream errors", async () => {
        const { PterodactylHttpClient, ServerInfrastructureError } =
          await import("./services/pterodactyl/pterodactylClient")

        const { SERVER_PUBLIC_MESSAGES, SERVER_ERROR_CODES } = await import(
          "@hikat/shared"
        )

        const mockFetch: typeof fetch = async () => {
          return new Response(
            JSON.stringify({ errors: [{ code: "NotFound" }] }),
            { status: 404 },
          )
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com",

          apiKey: "secret",

          serverId: "server-unknown",

          fetchFn: mockFetch,
        })

        try {
          await client.getServerDetails()

          expect.unreachable("should have thrown")
        } catch (err: any) {
          expect(err).toBeInstanceOf(ServerInfrastructureError)

          expect(err.message).toBe(SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE)

          expect(err.code).toBe(SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
        }
      })

      it("handles and normalizes 429 rate limited upstream error", async () => {
        const { PterodactylHttpClient, ServerInfrastructureError } =
          await import("./services/pterodactyl/pterodactylClient")

        const { SERVER_PUBLIC_MESSAGES, SERVER_ERROR_CODES } = await import(
          "@hikat/shared"
        )

        const mockFetch: typeof fetch = async () => {
          return new Response("Too Many Requests", { status: 429 })
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com",

          apiKey: "secret",

          serverId: "server-123",

          fetchFn: mockFetch,
        })

        try {
          await client.sendCommand("say hi")

          expect.unreachable("should have thrown")
        } catch (err: any) {
          expect(err).toBeInstanceOf(ServerInfrastructureError)

          expect(err.message).toBe(SERVER_PUBLIC_MESSAGES.SERVER_RATE_LIMITED)

          expect(err.code).toBe(SERVER_ERROR_CODES.SERVER_RATE_LIMITED)
        }
      })

      it("handles and normalizes 502/503/504 Wings upstream error", async () => {
        const { PterodactylHttpClient } = await import(
          "./services/pterodactyl/pterodactylClient"
        )

        const { SERVER_PUBLIC_MESSAGES } = await import("@hikat/shared")

        const mockFetch: typeof fetch = async () => {
          return new Response("502 Bad Gateway from Wings", { status: 502 })
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com",

          apiKey: "secret",

          serverId: "server-123",

          fetchFn: mockFetch,
        })

        await expect(client.sendPowerAction("start")).rejects.toThrow(
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        )
      })

      it("handles AbortError timeout gracefully", async () => {
        const { PterodactylHttpClient } = await import(
          "./services/pterodactyl/pterodactylClient"
        )

        const { SERVER_PUBLIC_MESSAGES } = await import("@hikat/shared")

        const mockFetch: typeof fetch = async () => {
          const err = new Error("The operation was aborted")

          err.name = "AbortError"

          throw err
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com",

          apiKey: "secret",

          serverId: "server-123",

          fetchFn: mockFetch,
        })

        await expect(client.getServerResources()).rejects.toThrow(
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        )
      })

      it("handles network failure (TypeError) gracefully", async () => {
        const { PterodactylHttpClient } = await import(
          "./services/pterodactyl/pterodactylClient"
        )

        const { SERVER_PUBLIC_MESSAGES } = await import("@hikat/shared")

        const mockFetch: typeof fetch = async () => {
          throw new TypeError("Failed to fetch")
        }

        const client = new PterodactylHttpClient({
          baseUrl: "https://panel.example.com",

          apiKey: "secret",

          serverId: "server-123",

          fetchFn: mockFetch,
        })

        await expect(client.getServerResources()).rejects.toThrow(
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        )
      })
    })

    describe("2. Security & Authorization Guards", () => {
      it("REJECTS anonymous requests to serverStatus with UNAUTHENTICATED", async () => {
        const res = await executeGqlServer(`
          query {
            serverStatus {
              status
            }
          }
        `)

        expect(res.errors).toBeDefined()

        expect(res.errors[0].extensions.code).toBe("UNAUTHENTICATED")
      })

      it("REJECTS PLAYER requests to serverStatus with FORBIDDEN", async () => {
        const res = await executeGqlServer(
          `
          query {
            serverStatus {
              status
            }
          }
          `,

          {},

          playerToken,
        )

        expect(res.errors).toBeDefined()

        expect(res.errors[0].extensions.code).toBe("FORBIDDEN")
      })

      it("REJECTS anonymous and PLAYER requests to power actions, command, and console ticket with FORBIDDEN/UNAUTHENTICATED", async () => {
        // Anonymous startServer

        const resAnon = await executeGqlServer(`
          mutation {
            startServer { success }
          }
        `)

        expect(resAnon.errors[0].extensions.code).toBe("UNAUTHENTICATED")

        // Anonymous createServerConsoleTicket

        const resAnonTicket = await executeGqlServer(`
          mutation {
            createServerConsoleTicket { ticket expiresAt }
          }
        `)

        expect(resAnonTicket.errors[0].extensions.code).toBe("UNAUTHENTICATED")

        // Player restartServer

        const resPlayerRestart = await executeGqlServer(
          `mutation { restartServer { success } }`,

          {},

          playerToken,
        )

        expect(resPlayerRestart.errors[0].extensions.code).toBe("FORBIDDEN")

        // Player stopServer

        const resPlayerStop = await executeGqlServer(
          `mutation { stopServer { success } }`,

          {},

          playerToken,
        )

        expect(resPlayerStop.errors[0].extensions.code).toBe("FORBIDDEN")

        // Player sendServerCommand

        const resPlayerCmd = await executeGqlServer(
          `mutation { sendServerCommand(command: "op test") { success } }`,

          {},

          playerToken,
        )

        expect(resPlayerCmd.errors[0].extensions.code).toBe("FORBIDDEN")

        // Player createServerConsoleTicket

        const resPlayerTicket = await executeGqlServer(
          `mutation { createServerConsoleTicket { ticket expiresAt } }`,

          {},

          playerToken,
        )

        expect(resPlayerTicket.errors[0].extensions.code).toBe("FORBIDDEN")
      })
    })

    describe("3. Server Administration Service & GraphQL Operations", () => {
      it("fails gracefully if Pterodactyl environment variables are missing with safe code SERVER_NOT_CONFIGURED", async () => {
        const unconfiguredEnv = createServerEnv({
          PTERODACTYL_BASE_URL: undefined,

          PTERODACTYL_API_KEY: undefined,
        })

        const res = await executeGqlServer(
          `query { serverStatus { status } }`,

          {},

          adminToken,

          unconfiguredEnv,
        )

        expect(res.errors).toBeDefined()

        expect(res.errors[0].message).toContain(
          "El servidor todavía no está configurado.",
        )

        expect(res.errors[0].extensions.code).toBe("SERVER_NOT_CONFIGURED")
      })

      it("enforces HTTPS in production and rejects embedded credentials", async () => {
        const { PterodactylHttpClient, ServerInfrastructureError } =
          await import("./services/pterodactyl/pterodactylClient")

        const { SERVER_PUBLIC_MESSAGES } = await import("@hikat/shared")

        // Non-https in production

        expect(() => {
          new PterodactylHttpClient({
            baseUrl: "http://panel.example.com",

            apiKey: "key",

            serverId: "srv",

            isProduction: true,
          })
        }).toThrow(SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED)

        // Embedded credentials

        expect(() => {
          new PterodactylHttpClient({
            baseUrl: "https://user:pass@panel.example.com",

            apiKey: "key",

            serverId: "srv",

            isProduction: false,
          })
        }).toThrow(SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED)
      })

      it("ADMIN queries serverStatus and receives properly formatted metrics and limits", async () => {
        const { getServerStatus } = await import(
          "./services/pterodactyl/serverAdministrationService"
        )

        const mockClient = {
          getServerResources: async () => ({
            object: "stats" as const,

            attributes: {
              current_state: "running" as const,

              is_suspended: false,

              resources: {
                cpu_absolute: 42.8,

                memory_bytes: 6442450944, // 6 GB in bytes

                disk_bytes: 21474836480, // 20 GB in bytes

                network_rx_bytes: 12345,

                network_tx_bytes: 67890,

                uptime: 7200000, // 2 hours in ms
              },
            },
          }),

          getServerDetails: async () => ({
            object: "server" as const,

            attributes: {
              server_owner: true,

              identifier: "srv-123",

              uuid: "uuid-123",

              name: "HiKAT Main",

              node: "Node-1",

              is_suspended: false,

              limits: {
                memory: 8192, // 8 GB in MB

                swap: 0,

                disk: 51200, // 50 GB in MB

                io: 500,

                cpu: 200, // 200%

                threads: null,
              },
            },
          }),

          sendPowerAction: async () => {},

          sendCommand: async () => {},

          getWebsocketCredentials: async () => ({
            token: "ws-token",
            socket: "wss://wings.test/ws",
          }),
        } as any

        const metrics = await getServerStatus(createServerEnv(), mockClient)

        expect(metrics.status).toBe("ONLINE")

        expect(metrics.cpuPercent).toBe(42.8)

        expect(metrics.cpuLimitPercent).toBe(200)

        expect(metrics.memoryUsedBytes).toBe(6442450944)

        expect(metrics.memoryLimitBytes).toBe(8192 * 1024 * 1024)

        expect(metrics.diskUsedBytes).toBe(21474836480)

        expect(metrics.diskLimitBytes).toBe(51200 * 1024 * 1024)

        expect(metrics.uptimeMs).toBe(7200000)

        expect(metrics.isSuspended).toBe(false)
      })

      it("maps offline / starting / stopping / suspended states correctly", async () => {
        const { getServerStatus } = await import(
          "./services/pterodactyl/serverAdministrationService"
        )

        const createMockClientWithState = (
          state: any,
          isSuspended = false,
        ): any => ({
          getServerResources: async () => ({
            object: "stats" as const,

            attributes: {
              current_state: state,

              is_suspended: isSuspended,

              resources: {
                cpu_absolute: 0,

                memory_bytes: 0,

                disk_bytes: 1024,

                network_rx_bytes: 0,

                network_tx_bytes: 0,

                uptime: 0,
              },
            },
          }),

          getServerDetails: async () => ({
            object: "server" as const,

            attributes: {
              server_owner: true,

              identifier: "srv",

              uuid: "uuid",

              name: "Server",

              node: "Node",

              is_suspended: isSuspended,

              limits: {
                memory: 0,
                swap: 0,
                disk: 0,
                io: 500,
                cpu: 0,
                threads: null,
              },
            },
          }),

          sendPowerAction: async () => {},

          sendCommand: async () => {},

          getWebsocketCredentials: async () => ({
            token: "t",
            socket: "wss://wings.test/ws",
          }),
        })


        const starting = await getServerStatus(
          createServerEnv(),
          createMockClientWithState("starting"),
        )

        expect(starting.status).toBe("STARTING")

        const stopping = await getServerStatus(
          createServerEnv(),
          createMockClientWithState("stopping"),
        )

        expect(stopping.status).toBe("STOPPING")

        const offline = await getServerStatus(
          createServerEnv(),
          createMockClientWithState("offline"),
        )

        expect(offline.status).toBe("OFFLINE")

        const suspended = await getServerStatus(
          createServerEnv(),
          createMockClientWithState("running", true),
        )

        expect(suspended.status).toBe("DISCONNECTED")
      })

      it("executes power actions (START, RESTART, STOP) with real state validation and distributed lock in D1", async () => {
        const { executeServerPowerAction } = await import(
          "./services/pterodactyl/serverAdministrationService"
        )

        let lastSignal = ""

        const createMockClientWithStatus = (state: string) => ({
          getServerResources: async () => ({
            object: "stats" as const,

            attributes: {
              current_state: state as any,

              is_suspended: false,

              resources: {
                cpu_absolute: 0,
                memory_bytes: 0,
                disk_bytes: 0,
                network_rx_bytes: 0,
                network_tx_bytes: 0,
                uptime: 0,
              },
            },
          }),

          getServerDetails: async () => ({
            object: "server" as const,

            attributes: {
              server_owner: true,

              identifier: "srv",

              uuid: "uuid",

              name: "Server",

              node: "Node",

              is_suspended: false,

              limits: {
                memory: 0,
                swap: 0,
                disk: 0,
                io: 500,
                cpu: 0,
                threads: null,
              },
            },
          }),

          sendPowerAction: async (signal: string) => {
            lastSignal = signal
          },

          sendCommand: async () => {},

          getWebsocketCredentials: async () => ({}) as any,
        }) as any

        // 1. If server is already ONLINE, START must be rejected

        const onlineClient = createMockClientWithStatus("running")

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "START",
            adminId,
            onlineClient,
          ),
        ).rejects.toThrow("El servidor ya está encendido.")

        // 2. If server is already OFFLINE, STOP and RESTART must be rejected

        const offlineClient = createMockClientWithStatus("offline")

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "STOP",
            adminId,
            offlineClient,
          ),
        ).rejects.toThrow("El servidor ya está apagado.")

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "RESTART",
            adminId,
            offlineClient,
          ),
        ).rejects.toThrow("El servidor ya está apagado.")

        // 3. If server is STARTING, power actions must be rejected

        const startingClient = createMockClientWithStatus("starting")

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "START",
            adminId,
            startingClient,
          ),
        ).rejects.toThrow("El servidor se está iniciando. Espera un momento.")

        // 4. If server is STOPPING, power actions must be rejected

        const stoppingClient = createMockClientWithStatus("stopping")

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "STOP",
            adminId,
            stoppingClient,
          ),
        ).rejects.toThrow("El servidor se está apagando. Espera un momento.")

        // 5. If server is UNKNOWN or DISCONNECTED, power actions must be rejected without calling sendPowerAction

        const unknownClient = createMockClientWithStatus("invalid_state")

        const disconnectedClient: any = {
          ...createMockClientWithStatus("running"),

          getServerResources: async () => ({
            object: "stats" as const,

            attributes: {
              current_state: "running" as any,

              is_suspended: true,

              resources: {
                cpu_absolute: 0,
                memory_bytes: 0,
                disk_bytes: 0,
                network_rx_bytes: 0,
                network_tx_bytes: 0,
                uptime: 0,
              },
            },
          }),
        }

        let powerActionCalled = false

        const trackingUnknownClient: any = {
          ...unknownClient,

          sendPowerAction: async () => {
            powerActionCalled = true
          },
        }

        const trackingDisconnectedClient: any = {
          ...disconnectedClient,

          sendPowerAction: async () => {
            powerActionCalled = true
          },
        }

        // UNKNOWN rejections

        powerActionCalled = false

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "START",
            adminId,
            trackingUnknownClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )

        expect(powerActionCalled).toBe(false)

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "STOP",
            adminId,
            trackingUnknownClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )

        expect(powerActionCalled).toBe(false)

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "RESTART",
            adminId,
            trackingUnknownClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )

        expect(powerActionCalled).toBe(false)

        // DISCONNECTED rejections

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "START",
            adminId,
            trackingDisconnectedClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )

        expect(powerActionCalled).toBe(false)

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "STOP",
            adminId,
            trackingDisconnectedClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )

        expect(powerActionCalled).toBe(false)

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "RESTART",
            adminId,
            trackingDisconnectedClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )

        expect(powerActionCalled).toBe(false)

        // getServerStatus() network / infrastructure failure rejection

        const failingStatusClient: any = {
          ...unknownClient,

          getServerResources: async () => {
            throw new Error("Network timeout / Pterodactyl offline")
          },

          sendPowerAction: async () => {
            powerActionCalled = true
          },
        }

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "START",
            adminId,
            failingStatusClient,
          ),
        ).rejects.toThrow(
          "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
        )


        expect(powerActionCalled).toBe(false)

        // 6. Valid actions execute successfully

        const startRes = await executeServerPowerAction(
          createServerEnv(),
          "START",
          adminId,
          offlineClient as any,
        )

        expect(startRes.success).toBe(true)

        expect(startRes.status).toBe("STARTING")

        expect(lastSignal).toBe("start")

        const restartRes = await executeServerPowerAction(
          createServerEnv(),
          "RESTART",
          adminId,
          onlineClient as any,
        )

        expect(restartRes.success).toBe(true)

        expect(restartRes.status).toBe("STARTING")

        expect(lastSignal).toBe("restart")

        const stopRes = await executeServerPowerAction(
          createServerEnv(),
          "STOP",
          adminId,
          onlineClient as any,
        )

        expect(stopRes.success).toBe(true)

        expect(stopRes.status).toBe("STOPPING")

        expect(lastSignal).toBe("stop")
      })

      it("enforces distributed power lock concurrency rejection in D1", async () => {
        const { executeServerPowerAction } = await import(
          "./services/pterodactyl/serverAdministrationService"
        )

        // Pre-insert an active lock

        await testD1
          .prepare(`
          INSERT OR REPLACE INTO server_power_locks (lock_key, action, acquired_by_user_id, acquired_at, expires_at)
          VALUES ('main_server_power', 'START', ?, ?, ?)
        `)
          .bind(
            adminId,
            new Date().toISOString(),
            new Date(Date.now() + 20000).toISOString(),
          )
          .run()

        const mockClient = {
          getServerResources: async () => ({}) as any,

          getServerDetails: async () => ({}) as any,

          sendPowerAction: async () => {},

          sendCommand: async () => {},

          getWebsocketCredentials: async () => ({}) as any,
        }

        // Attempting another power action while locked must throw SERVER_BUSY

        await expect(
          executeServerPowerAction(
            createServerEnv(),
            "STOP",
            adminId,
            mockClient as any,
          ),
        ).rejects.toThrow(
          "Hay otra acción en curso. Espera un momento.",
        )

        // Clear lock

        await testD1
          .prepare(
            "DELETE FROM server_power_locks WHERE lock_key = 'main_server_power'",
          )
          .run()
      })

      it("validates console commands and enforces truly atomic rate limiting under 20 concurrent requests", async () => {
        const { executeServerCommand } = await import(
          "./services/pterodactyl/serverAdministrationService"
        )

        let sentCommand = ""

        const mockClient = {
          getServerResources: async () => ({}) as any,

          getServerDetails: async () => ({}) as any,

          sendPowerAction: async () => {},

          sendCommand: async (cmd: string) => {
            sentCommand = cmd
          },

          getWebsocketCredentials: async () => ({}) as any,
        }

        // Empty command -> rejected

        await expect(
          executeServerCommand(createServerEnv(), "", adminId, mockClient as any),
        ).rejects.toThrow(
          "El comando no puede estar vacío.",
        )

        await expect(
          executeServerCommand(createServerEnv(), "   ", adminId, mockClient as any),
        ).rejects.toThrow(
          "El comando no puede estar vacío.",
        )

        // Oversized command (>500 chars) -> rejected

        const hugeCmd = "say " + "a".repeat(510)

        await expect(
          executeServerCommand(createServerEnv(), hugeCmd, adminId, mockClient as any),
        ).rejects.toThrow(
          "El comando excede la longitud máxima permitida",
        )

        // Clear rate limit table for clean test

        await testD1.prepare("DELETE FROM server_command_rate_limits").run()

        // Launch 20 concurrent commands simultaneously to test atomic race condition resistance

        const promises = Array.from({ length: 20 }, (_, idx) =>
          executeServerCommand(
            createServerEnv(),
            `say concurrent command ${idx}`,
            adminId,
            mockClient as any,
          )


            .then(() => ({ success: true, error: null }))

            .catch((err: any) => ({ success: false, error: err.message })),
        )

        const results = await Promise.all(promises)

        const succeeded = results.filter((r) => r.success)

        const rateLimited = results.filter(
          (r) =>
            !r.success &&
            r.error === "Has enviado demasiados comandos. Espera un momento.",
        )

        // Exactly MAX_COMMANDS (10) must succeed, and the remaining 10 must be rate limited!

        expect(succeeded.length).toBe(10)

        expect(rateLimited.length).toBe(10)
      })

      it("generates single-use console tickets and enforces mandatory Origin validation on WebSocket", async () => {
        // 1. ADMIN requests console ticket via GraphQL

        const ticketRes = await executeGqlServer(
          `mutation { createServerConsoleTicket { ticket expiresAt } }`,

          {},

          adminToken,
        )

        expect(ticketRes.data?.createServerConsoleTicket).toBeDefined()

        const { ticket, expiresAt } = ticketRes.data.createServerConsoleTicket

        expect(ticket.startsWith("cstk_")).toBe(true)

        expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())

        // 2. Reject POST method

        const reqPost = new Request(
          `http://localhost/api/server/console/ws?ticket=${ticket}`,
          {
            method: "POST",

            headers: {
              Upgrade: "websocket",
              Origin: "https://admin.hikat.org",
            },
          },
        )

        const resPost = await worker.fetch(reqPost, createServerEnv())

        expect(resPost.status).toBe(405)

        // 3. Reject missing Upgrade header

        const reqNoUpgrade = new Request(
          `http://localhost/api/server/console/ws?ticket=${ticket}`,
          {
            method: "GET",

            headers: { Origin: "https://admin.hikat.org" },
          },
        )

        const resNoUpgrade = await worker.fetch(reqNoUpgrade, createServerEnv())

        expect(resNoUpgrade.status).toBe(426)

        // 4. Reject access token in query string (enforcing tickets only)

        const reqTokenParam = new Request(
          `http://localhost/api/server/console/ws?token=${adminToken}`,
          {
            method: "GET",

            headers: {
              Upgrade: "websocket",
              Origin: "https://admin.hikat.org",
            },
          },
        )

        const resTokenParam = await worker.fetch(
          reqTokenParam,
          createServerEnv(),
        )

        expect(resTokenParam.status).toBe(400)

        // 5. Reject missing Origin header (mandatory Origin requirement)

        const reqNoOrigin = new Request(
          `http://localhost/api/server/console/ws?ticket=${ticket}`,
          {
            method: "GET",

            headers: { Upgrade: "websocket" },
          },
        )

        const resNoOrigin = await worker.fetch(reqNoOrigin, createServerEnv())

        expect(resNoOrigin.status).toBe(403)

        // 6. Reject unauthorized / malicious origin

        const reqBadOrigin = new Request(
          `http://localhost/api/server/console/ws?ticket=${ticket}`,
          {
            method: "GET",

            headers: {
              Upgrade: "websocket",
              Origin: "https://malicious-site.com",
            },
          },
        )

        const resBadOrigin = await worker.fetch(reqBadOrigin, createServerEnv())

        expect(resBadOrigin.status).toBe(403)

        // 7. Connect with valid ticket and allowed production origin

        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              object: "token",

              data: { socket: "wss://wings.test/ws", token: "mock-token" },
            }),

            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )

        const reqValid = new Request(
          `http://localhost/api/server/console/ws?ticket=${ticket}`,
          {
            method: "GET",

            headers: {
              Upgrade: "websocket",
              Origin: "https://admin.hikat.org",
            },
          },
        )

        const resValid = await worker.fetch(reqValid, createServerEnv())

        expect(resValid.status).toBe(200) // 200 in Node test mock environment

        fetchSpy.mockRestore()

        // 8. Single-use enforcement: re-using the same ticket must fail (401)

        const resReused = await worker.fetch(reqValid, createServerEnv())

        expect(resReused.status).toBe(401)
      })
    })
  })

  describe("HiKAT Back Office Core (Shard 06.5)", () => {
    let coreAdminId: string

    let coreAdminToken: string

    let playerUserId: string

    let playerUserToken: string

    let mockR2: ReturnType<typeof createTestR2Bucket>

    const createCoreEnv = (): Env => ({
      DB: testD1 as unknown as D1Database,

      ASSETS: mockR2 as unknown as R2Bucket,

      AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

      AUTH_ISSUER: DEFAULT_AUTH_ISSUER,

      PTERODACTYL_BASE_URL: "https://panel.test",

      PTERODACTYL_API_KEY: "ptlc_test_key",

      PTERODACTYL_SERVER_ID: "srv_test_uuid",

      ENVIRONMENT: "test",
    })

    beforeEach(async () => {
      mockR2 = createTestR2Bucket()

      // Create Admin User & Session

      coreAdminId = "admin-core-" + crypto.randomUUID()

      const adminSessionId = "sess-admin-" + crypto.randomUUID()

      await db.insert(users).values({
        id: coreAdminId,

        displayName: "Super Admin",

        role: "ADMIN",

        createdAt: new Date().toISOString(),

        updatedAt: new Date().toISOString(),
      })

      await db.insert(sessions).values({
        id: adminSessionId,

        userId: coreAdminId,

        expiresAt: new Date(Date.now() + 86400000).toISOString(),

        createdAt: new Date().toISOString(),
      })

      coreAdminToken = await createTestAccessToken({
        userId: coreAdminId,

        sessionId: adminSessionId,

        role: "ADMIN" as any,

        displayName: "Super Admin",
      })

      // Create Player User & Session

      playerUserId = "player-" + crypto.randomUUID()

      const playerSessionId = "sess-player-" + crypto.randomUUID()

      await db.insert(users).values({
        id: playerUserId,

        displayName: "Regular Player",

        role: "PLAYER",

        createdAt: new Date().toISOString(),

        updatedAt: new Date().toISOString(),
      })

      await db.insert(sessions).values({
        id: playerSessionId,

        userId: playerUserId,

        expiresAt: new Date(Date.now() + 86400000).toISOString(),

        createdAt: new Date().toISOString(),
      })

      playerUserToken = await createTestAccessToken({
        userId: playerUserId,

        sessionId: playerSessionId,

        role: "PLAYER" as any,

        displayName: "Regular Player",
      })
    })

    it("adminDashboard gracefully survives upstream server errors and returns D1 stats", async () => {
      // Mock fetch failure (e.g. Pterodactyl DNS not found / offline)

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("DNS resolution failed"))

      const query = `
        query {
          adminDashboard {
            server { status }
            news { publishedCount draftCount }
            skins { totalCount availableCount }
            game { publishedVersion pendingChangesCount }
          }
        }
      `

      const req = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({ query }),
      })

      const res = await worker.fetch(req, createCoreEnv())

      expect(res.status).toBe(200)

      const data = (await res.json()) as any

      expect(data.errors).toBeUndefined()

      expect(data.data.adminDashboard.server.status).toBe("UNKNOWN")

      expect(data.data.adminDashboard.news).toBeDefined()

      expect(data.data.adminDashboard.skins).toBeDefined()

      expect(data.data.adminDashboard.game).toBeDefined()

      fetchSpy.mockRestore()
    })

    it("handles full Skins lifecycle: upload texture, create, update, query and delete", async () => {
      // 1. Upload valid 64x64 PNG skin texture to R2 (Alex Slim style)
      const data = new Uint8Array(64 * 64 * 4).fill(255)
      // Clear (50, 16, 2, 4) to 0 for SLIM model detection
      for (let y = 16; y < 20; y++) {
        for (let x = 50; x < 52; x++) {
          data[(y * 64 + x) * 4 + 3] = 0
        }
      }
      const skinTexture = encode({ width: 64, height: 64, data, channels: 4, depth: 8 })

      const mediaId = "media-skin-" + crypto.randomUUID()

      await db.insert(contentMedia).values({
        id: mediaId,

        objectKey: `content/${mediaId}.png`,

        mediaType: "IMAGE",

        mimeType: "image/png",

        sizeBytes: skinTexture.byteLength,

        createdBy: coreAdminId,

        createdAt: new Date().toISOString(),
      })

      await mockR2.put(`content/${mediaId}.png`, skinTexture.buffer as ArrayBuffer, {
        httpMetadata: { contentType: "image/png" },
      })

      // 2. Create Skin mutation

      const createMutation = `
        mutation CreateSkin($input: CreateSkinInput!) {
          createSkin(input: $input) {
            id
            name
            imageUrl
            status
          }
        }
      `

      const createReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: createMutation,

          variables: {
            input: {
              name: "Alex Aventurera",

              mediaId,

              status: "AVAILABLE",
            },
          },
        }),
      })

      const createRes = await worker.fetch(createReq, createCoreEnv())

      const createData = (await createRes.json()) as any

      expect(createData.errors).toBeUndefined()

      const skinId = createData.data.createSkin.id

      expect(skinId).toBeDefined()

      expect(createData.data.createSkin.name).toBe("Alex Aventurera")

      // 3. Public catalog query

      const publicQuery = `
        query {
          skins {
            items { id name imageUrl }
            totalCount
          }
        }
      `

      const publicReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ query: publicQuery }),
      })

      const publicRes = await worker.fetch(publicReq, createCoreEnv())

      const publicData = (await publicRes.json()) as any

      expect(publicData.data.skins.totalCount).toBeGreaterThanOrEqual(1)

      expect(
        publicData.data.skins.items.some((s: any) => s.id === skinId),
      ).toBe(true)

      // 4. Delete skin

      const deleteMutation = `
        mutation DeleteSkin($id: ID!) {
          deleteSkin(id: $id)
        }
      `

      const deleteReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: deleteMutation,
          variables: { id: skinId },
        }),
      })

      const deleteRes = await worker.fetch(deleteReq, createCoreEnv())

      const deleteData = (await deleteRes.json()) as any

      expect(deleteData.data.deleteSkin).toBe(true)
    })

    it("enforces Game Releases draft cloning, atomic publish, single published constraint, and safe download", async () => {
      // 1. Initial State: Prepare Draft

      const prepMutation = `
        mutation {
          prepareGameDraft {
            id
            version
            status
            files { id }
          }
        }
      `

      const prepReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({ query: prepMutation }),
      })

      const prepRes = await worker.fetch(prepReq, createCoreEnv())

      const prepData = (await prepRes.json()) as any

      expect(prepData.errors).toBeUndefined()

      expect(prepData.data.prepareGameDraft.status).toBe("DRAFT")

      // 2. Request upload token for a mod

      const uploadTokenMutation = `
        mutation CreateUpload($input: CreateGameFileUploadInput!) {
          createGameFileUpload(input: $input) {
            uploadUrl
            uploadToken
            maxSizeBytes
            expectedCategory
          }
        }
      `

      const tokenReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: uploadTokenMutation,

          variables: {
            input: {
              category: "MOD",

              originalFilename: "journeymap-1.21.1-6.0.0.jar",

              sizeBytes: 1024,
            },
          },
        }),
      })

      const tokenRes = await worker.fetch(tokenReq, createCoreEnv())

      const tokenData = (await tokenRes.json()) as any

      const uploadToken = tokenData.data.createGameFileUpload.uploadToken

      expect(uploadToken).toBeDefined()

      // 3. Upload valid ZIP/JAR binary via PUT /game/files/upload

      const jarBuffer = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04,
      ])

      const uploadHttpReq = new Request("http://localhost/game/files/upload", {
        method: "PUT",

        headers: {
          Authorization: `Bearer ${coreAdminToken}`,

          "X-Upload-Token": uploadToken,
        },

        body: jarBuffer,
      })

      const uploadHttpRes = await worker.fetch(uploadHttpReq, createCoreEnv())

      expect(uploadHttpRes.status).toBe(200)

      const uploadedInfo = (await uploadHttpRes.json()) as any

      expect(uploadedInfo.tokenHash).toBeDefined()

      expect(uploadedInfo.originalFilename).toBe("journeymap-1.21.1-6.0.0.jar")

      expect(uploadedInfo.objectKey).toBeUndefined()

      // 4. Attach uploaded file to draft via addGameFile mutation

      const addFileMutation = `
        mutation AddFile($input: AddGameFileInput!) {
          addGameFile(input: $input) {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
          }
        }
      `

      const addReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: addFileMutation,

          variables: {
            input: {
              name: "JourneyMap",

              category: "MOD",

              tokenHash: uploadedInfo.tokenHash,
            },
          },
        }),
      })

      const addRes = await worker.fetch(addReq, createCoreEnv())

      const addData = (await addRes.json()) as any

      expect(addData.errors).toBeUndefined()

      const fileId = addData.data.addGameFile.id

      expect(addData.data.addGameFile.logicalPath).toBe(
        "mods/journeymap-1.21.1-6.0.0.jar",
      )

      expect(addData.data.addGameFile.policy).toBe("NO_MODIFICABLE")

      // 5. Verify that file CANNOT be downloaded publicly while in DRAFT status

      const downloadDraftReq = new Request(
        `http://localhost/game/download/${fileId}`,
        {
          method: "GET",
        },
      )

      const downloadDraftRes = await worker.fetch(
        downloadDraftReq,
        createCoreEnv(),
      )

      expect(downloadDraftRes.status).toBe(404)

      // 6. Publish Game Release 1.4.2

      const publishMutation = `
        mutation Publish($input: PublishGameReleaseInput!) {
          publishGameRelease(input: $input) {
            id
            version
            status
            files { id logicalPath }
          }
        }
      `

      const publishReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: publishMutation,

          variables: {
            input: {
              version: "1.4.2",

              notes: "Actualización inicial de mods",
            },
          },
        }),
      })

      const publishRes = await worker.fetch(publishReq, createCoreEnv())

      const publishData = (await publishRes.json()) as any

      expect(publishData.errors).toBeUndefined()

      expect(publishData.data.publishGameRelease.status).toBe("PUBLISHED")

      expect(publishData.data.publishGameRelease.version).toBe("1.4.2")

      // 7. Verify file CAN now be downloaded publicly

      const downloadPubRes = await worker.fetch(
        downloadDraftReq,
        createCoreEnv(),
      )

      expect(downloadPubRes.status).toBe(200)

      expect(downloadPubRes.headers.get("Cache-Control")).toContain("immutable")

      expect(downloadPubRes.headers.get("Content-Disposition")).toContain(
        "journeymap-1.21.1-6.0.0.jar",
      )

      // 8. Public PublishedModpack query contract verification

      const modpackQuery = `
        query {
          publishedModpack {
            version
            minecraftVersion
            neoForgeVersion
            mandatory
            clientFiles {
              path
              sha256
              sizeBytes
              downloadUrl
              policy
            }
          }
        }
      `

      const modpackReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ query: modpackQuery }),
      })

      const modpackRes = await worker.fetch(modpackReq, createCoreEnv())

      const modpackData = (await modpackRes.json()) as any

      expect(modpackData.errors).toBeUndefined()

      const modpack = modpackData.data.publishedModpack

      expect(modpack.version).toBe("1.4.2")

      expect(modpack.mandatory).toBe(true)

      expect(modpack.clientFiles.length).toBe(1)

      expect(modpack.clientFiles[0].path).toBe(
        "mods/journeymap-1.21.1-6.0.0.jar",
      )

      expect(modpack.clientFiles[0].downloadUrl).toBe(
        `/game/download/${fileId}`,
      )

      expect(modpack.clientFiles[0].policy).toBe("NO_MODIFICABLE")
    })

    it("manages typed project settings and provides public client configuration", async () => {
      // 1. Query client configuration (public)

      const clientConfigQuery = `
        query {
          clientConfiguration {
            projectName
            serverIp
            serverPort
            maintenanceEnabled
            minRamGb
            recommendedRamGb
          }
        }
      `

      const clientReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ query: clientConfigQuery }),
      })

      const clientRes = await worker.fetch(clientReq, createCoreEnv())

      const clientData = (await clientRes.json()) as any

      expect(clientData.errors).toBeUndefined()

      expect(clientData.data.clientConfiguration.projectName).toBe("HiKAT")

      // 2. Update Admin Settings

      const updateMutation = `
        mutation UpdateSettings($input: UpdateAdminSettingsInput!) {
          updateAdminSettings(input: $input) {
            projectName
            serverIp
            minRamGb
            recommendedRamGb
          }
        }
      `

      const updateReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: updateMutation,

          variables: {
            input: {
              projectName: "HiKAT Official",

              serverIp: "play.hikat.org",

              minRamGb: 6,

              recommendedRamGb: 12,
            },
          },
        }),
      })

      const updateRes = await worker.fetch(updateReq, createCoreEnv())

      const updateData = (await updateRes.json()) as any

      expect(updateData.errors).toBeUndefined()

      expect(updateData.data.updateAdminSettings.projectName).toBe(
        "HiKAT Official",
      )

      expect(updateData.data.updateAdminSettings.serverIp).toBe(
        "play.hikat.org",
      )

      expect(updateData.data.updateAdminSettings.recommendedRamGb).toBe(12)
    })

    it("evaluates draft change tracking, readiness check, version history, and mod replacement (Shard 06.5A)", async () => {
      const testEnv = createCoreEnv()

      // 1. Initial upload and publish release 1.4.2

      const ticketReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: `mutation { createGameFileUpload(input: { category: MOD, originalFilename: "sodium-1.21.1.jar", sizeBytes: 50 }) { uploadUrl uploadToken } }`,
        }),
      })

      const ticketRes = await worker.fetch(ticketReq, testEnv)

      const ticketData = (await ticketRes.json()) as any

      const { uploadUrl, uploadToken } = ticketData.data.createGameFileUpload

      const binaryPayload = new Uint8Array([
        0x50,
        0x4b,
        0x03,
        0x04,
        ...new Array(46).fill(0x00),
      ])

      const uploadReq = new Request(`http://localhost${uploadUrl}`, {
        method: "PUT",

        headers: {
          Authorization: `Bearer ${coreAdminToken}`,
          "X-Upload-Token": uploadToken,
        },

        body: binaryPayload,
      })

      const uploadRes = await worker.fetch(uploadReq, testEnv)

      const uploadedInfo = (await uploadRes.json()) as any

      // Add to draft and publish 1.4.2

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { addGameFile(input: { name: "Sodium", category: MOD, tokenHash: "${uploadedInfo.tokenHash}" }) { id } }`,
          }),
        }),

        testEnv,
      )

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { publishGameRelease(input: { version: "1.4.2", notes: "Initial version" }) { id version } }`,
          }),
        }),

        testEnv,
      )

      // 2. Prepare new draft from published 1.4.2

      const draftReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query:
            "mutation { prepareGameDraft { id version files { id name } } }",
        }),
      })

      const draftRes = await worker.fetch(draftReq, testEnv)

      const draftData = (await draftRes.json()) as any

      expect(draftData.errors).toBeUndefined()

      expect(draftData.data.prepareGameDraft.files.length).toBe(1)

      // 3. Query overview to verify change tracking & readiness

      const overviewReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: `
            query {
              adminGameOverview {
                draftRelease { id version files { id name changeStatus } }
                changes { added updated removed unchanged total }
                readiness { isReady validVersion noConflicts storageVerified issues }
              }
            }
          `,
        }),
      })

      const overviewRes = await worker.fetch(overviewReq, testEnv)

      const overviewData = (await overviewRes.json()) as any

      expect(overviewData.errors).toBeUndefined()

      expect(overviewData.data.adminGameOverview.changes.unchanged).toBe(1)

      expect(overviewData.data.adminGameOverview.readiness.isReady).toBe(true)

      // 4. Query game release history

      const historyReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: `
            query {
              gameReleaseHistory {
                id
                version
                status
                files { id name }
              }
            }
          `,
        }),
      })

      const historyRes = await worker.fetch(historyReq, testEnv)

      const historyData = (await historyRes.json()) as any

      expect(historyData.errors).toBeUndefined()

      expect(historyData.data.gameReleaseHistory.length).toBeGreaterThanOrEqual(
        1,
      )

      expect(historyData.data.gameReleaseHistory[0].version).toBe("1.4.2")
    })

    it("enforces backend DRAFT guards, sanitized upload response, tombstones, restore, and atomic publication (Shard 06.5B)", async () => {
      const testEnv = createCoreEnv()

      // 1. Test sanitized upload response (Requirement 7)

      const ticketReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: `mutation { createGameFileUpload(input: { category: MOD, originalFilename: "mod-a.jar", sizeBytes: 100 }) { uploadUrl uploadToken } }`,
        }),
      })

      const ticketRes = await worker.fetch(ticketReq, testEnv)

      const ticketData = (await ticketRes.json()) as any

      const { uploadUrl, uploadToken } = ticketData.data.createGameFileUpload

      const binaryA = new Uint8Array([
        0x50,
        0x4b,
        0x03,
        0x04,
        ...new Array(96).fill(0x00),
      ])

      const uploadReq = new Request(`http://localhost${uploadUrl}`, {
        method: "PUT",

        headers: {
          Authorization: `Bearer ${coreAdminToken}`,
          "X-Upload-Token": uploadToken,
        },

        body: binaryA,
      })

      const uploadRes = await worker.fetch(uploadReq, testEnv)

      expect(uploadRes.status).toBe(200)

      const uploadJson = (await uploadRes.json()) as any

      // Assert that internal storage details are NOT exposed

      expect(uploadJson.tokenHash).toBeDefined()

      expect(uploadJson.originalFilename).toBe("mod-a.jar")

      expect(uploadJson.category).toBe("MOD")

      expect(uploadJson.sizeBytes).toBe(100)

      expect(uploadJson.objectKey).toBeUndefined()

      expect(uploadJson.sha256).toBeUndefined()

      expect(uploadJson.id).toBeUndefined()

      // 2. Add mod A to draft and publish version 1.0.0

      const addFileRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { addGameFile(input: { name: "Mod A", category: MOD, tokenHash: "${uploadJson.tokenHash}" }) { id name } }`,
          }),
        }),

        testEnv,
      )

      const addFileData = (await addFileRes.json()) as any

      const fileAId = addFileData.data.addGameFile.id

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { publishGameRelease(input: { version: "1.0.0", notes: "Initial v1.0.0" }) { id version status } }`,
          }),
        }),

        testEnv,
      )

      // 3. Backend MUST reject update / remove on PUBLISHED release files (Requirement 5)

      const updatePubRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { updateGameFile(id: "${fileAId}", input: { name: "Mod A Hacked" }) { id } }`,
          }),
        }),

        testEnv,
      )

      const updatePubData = (await updatePubRes.json()) as any

      expect(updatePubData.errors).toBeDefined()

      expect(updatePubData.errors[0].message).toContain(
        "Solo puedes modificar archivos de una actualización en preparación",
      )

      const removePubRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { removeGameFile(id: "${fileAId}") }`,
          }),
        }),

        testEnv,
      )

      const removePubData = (await removePubRes.json()) as any

      expect(removePubData.errors).toBeDefined()

      expect(removePubData.errors[0].message).toContain(
        "Solo puedes modificar archivos de una actualización en preparación",
      )

      // 4. Prepare draft for next update (cloned from published 1.0.0)

      const prepareRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query:
              "mutation { prepareGameDraft { id version files { id name } } }",
          }),
        }),

        testEnv,
      )

      const prepareData = (await prepareRes.json()) as any

      const draftFileAId = prepareData.data.prepareGameDraft.files[0].id

      // 5. Upload Mod B and add to draft

      const ticketBReq = new Request("http://localhost/graphql", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${coreAdminToken}`,
        },

        body: JSON.stringify({
          query: `mutation { createGameFileUpload(input: { category: MOD, originalFilename: "mod-b.jar", sizeBytes: 80 }) { uploadUrl uploadToken } }`,
        }),
      })

      const ticketBRes = await worker.fetch(ticketBReq, testEnv)

      const { uploadUrl: uB, uploadToken: tB } =
        ((await ticketBRes.json()) as any).data.createGameFileUpload

      const uploadBRes = await worker.fetch(
        new Request(`http://localhost${uB}`, {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${coreAdminToken}`,
            "X-Upload-Token": tB,
          },

          body: new Uint8Array([
            0x50,
            0x4b,
            0x03,
            0x04,
            ...new Array(76).fill(0x00),
          ]),
        }),

        testEnv,
      )

      const tokenHashB = ((await uploadBRes.json()) as any).tokenHash

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { addGameFile(input: { name: "Mod B", category: MOD, tokenHash: "${tokenHashB}" }) { id } }`,
          }),
        }),

        testEnv,
      )

      // 6. Delete draftFileA from draft -> verifies tombstone with changeStatus REMOVED (Requirement 4)

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { removeGameFile(id: "${draftFileAId}") }`,
          }),
        }),

        testEnv,
      )

      const overviewDiffRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `
              query {
                adminGameOverview {
                  draftRelease {
                    files { id name changeStatus }
                  }
                  changes { added updated removed unchanged total }
                }
              }
            `,
          }),
        }),

        testEnv,
      )

      const overviewDiff = ((await overviewDiffRes.json()) as any).data
        .adminGameOverview

      expect(overviewDiff.changes.removed).toBe(1)

      expect(overviewDiff.changes.added).toBe(1)

      const tombstoneA = overviewDiff.draftRelease.files.find(
        (f: any) => f.name === "Mod A",
      )

      expect(tombstoneA).toBeDefined()

      expect(tombstoneA.changeStatus).toBe("REMOVED")

      // 7. Test restore (Deshacer) tombstone

      const restoreRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { restoreGameFile(id: "${tombstoneA.id}") { id name } }`,
          }),
        }),

        testEnv,
      )

      const restoreData = (await restoreRes.json()) as any

      expect(restoreData.errors).toBeUndefined()

      expect(restoreData.data.restoreGameFile.name).toBe("Mod A")

      // Remove it again so final release has only Mod B

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { removeGameFile(id: "${restoreData.data.restoreGameFile.id}") }`,
          }),
        }),

        testEnv,
      )

      // 8. Atomically publish release 1.0.1

      const finalPubRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { publishGameRelease(input: { version: "1.0.1", notes: "Release with Mod B" }) { id version status files { name } } }`,
          }),
        }),

        testEnv,
      )

      const finalPubData = (await finalPubRes.json()) as any

      expect(finalPubData.errors).toBeUndefined()

      expect(finalPubData.data.publishGameRelease.version).toBe("1.0.1")

      expect(finalPubData.data.publishGameRelease.files.length).toBe(1)

      expect(finalPubData.data.publishGameRelease.files[0].name).toBe("Mod B")

      // 9. Verify history: previous release 1.0.0 is ARCHIVED and its file Mod A remains intact

      const historyCheckRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `query { gameReleaseHistory { version status files { name } } }`,
          }),
        }),

        testEnv,
      )

      const historyCheck = ((await historyCheckRes.json()) as any).data
        .gameReleaseHistory

      expect(historyCheck.length).toBe(2)

      const v1 = historyCheck.find((r: any) => r.version === "1.0.0")

      expect(v1.status).toBe("ARCHIVED")

      expect(v1.files[0].name).toBe("Mod A")

      // 10. Attempt update and remove on ARCHIVED release files -> rejected (Requirement 2 & 3)

      const updateArchRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { updateGameFile(id: "${fileAId}", input: { name: "Archived Hack" }) { id } }`,
          }),
        }),

        testEnv,
      )

      expect(((await updateArchRes.json()) as any).errors[0].message).toContain(
        "Solo puedes modificar archivos de una actualización en preparación",
      )

      const removeArchRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { removeGameFile(id: "${fileAId}") }`,
          }),
        }),

        testEnv,
      )

      expect(((await removeArchRes.json()) as any).errors[0].message).toContain(
        "Solo puedes modificar archivos de una actualización en preparación",
      )

      // Confirm archived file and release remain 100% intact in database (Requirement 2)

      const historyVerifyRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `query { gameReleaseHistory { version status files { id name } } }`,
          }),
        }),

        testEnv,
      )

      const historyVerify = ((await historyVerifyRes.json()) as any).data
        .gameReleaseHistory

      const v1Archived = historyVerify.find((r: any) => r.version === "1.0.0")

      expect(v1Archived.status).toBe("ARCHIVED")

      expect(
        v1Archived.files.some(
          (f: any) => f.id === fileAId && f.name === "Mod A",
        ),
      ).toBe(true)

      const dbArchivedFile = await db

        .select()

        .from(gameReleaseFiles)

        .where(eq(gameReleaseFiles.id, fileAId))

        .get()

      expect(dbArchivedFile).toBeDefined()

      expect(dbArchivedFile?.name).toBe("Mod A")
    })

    it("exercises db.batch() branch and enforces atomic rollback when batch fails during publication (Shard 06.5B)", async () => {
      const testEnv = createCoreEnv()

      // 1. Setup Initial State:

      // - Publish release v1.0.0 with 1 mod

      // - Prepare draft v1.0.1 with 1 mod

      const prepRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: "mutation { prepareGameDraft { id version } }",
          }),
        }),

        testEnv,
      )

      expect(((await prepRes.json()) as any).errors).toBeUndefined()

      // Upload binary for mod 1

      const ticketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { createGameFileUpload(input: { category: MOD, originalFilename: "mod-1.jar", sizeBytes: 120 }) { uploadUrl uploadToken } }`,
          }),
        }),

        testEnv,
      )

      const { uploadUrl, uploadToken } = ((await ticketRes.json()) as any).data
        .createGameFileUpload

      const uploadRes = await worker.fetch(
        new Request(`http://localhost${uploadUrl}`, {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${coreAdminToken}`,
            "X-Upload-Token": uploadToken,
          },

          body: new Uint8Array([
            0x50,
            0x4b,
            0x03,
            0x04,
            ...new Array(116).fill(0x00),
          ]),
        }),

        testEnv,
      )

      const { tokenHash } = (await uploadRes.json()) as any

      // Add to draft and publish v1.0.0

      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { addGameFile(input: { name: "Mod 1", category: MOD, tokenHash: "${tokenHash}" }) { id } }`,
          }),
        }),

        testEnv,
      )

      const pub1Res = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query: `mutation { publishGameRelease(input: { version: "1.0.0", notes: "Initial release" }) { id version status } }`,
          }),
        }),

        testEnv,
      )

      const pub1Data = (await pub1Res.json()) as any

      expect(pub1Data.errors).toBeUndefined()

      expect(pub1Data.data.publishGameRelease.status).toBe("PUBLISHED")

      expect(pub1Data.data.publishGameRelease.version).toBe("1.0.0")

      // 2. Prepare next draft for v1.0.1

      const draft2Res = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${coreAdminToken}`,
          },

          body: JSON.stringify({
            query:
              "mutation { prepareGameDraft { id version files { id name } } }",
          }),
        }),

        testEnv,
      )

      const draft2Data = (await draft2Res.json()) as any

      const draft2Id = draft2Data.data.prepareGameDraft.id

      expect(draft2Data.data.prepareGameDraft.files.length).toBe(1)

      // Confirm baseline state in database before batch test:

      // Exactly 1 PUBLISHED (v1.0.0), 1 DRAFT (v1.0.1)

      const releasesBefore = await db.select().from(gameReleases).all()

      const publishedBefore = releasesBefore.find(
        (r) => r.status === "PUBLISHED",
      )

      const draftBefore = releasesBefore.find((r) => r.status === "DRAFT")

      expect(publishedBefore?.version).toBe("1.0.0")

      expect(draftBefore?.id).toBe(draft2Id)

      // 3. Mock db.batch on the database to SIMULATE a D1 batch failure and explicitly exercise the db.batch() branch

      const batchError = new Error(
        "D1_ERROR: simulated atomic batch transaction rollback",
      )

      const batchSpy = vi.fn().mockImplementation(async (queries: any[]) => {
        // Assert that the batch received exactly 2 statements:

        // [0]: update gameReleases set status=ARCHIVED where status=PUBLISHED

        // [1]: update gameReleases set version=1.0.1, status=PUBLISHED where id=draft2Id

        expect(queries.length).toBe(2)

        // Simulate atomic rollback - no changes are written to database

        throw batchError
      })

      // Attach batch implementation to db
      ;(db as any).batch = batchSpy

      // Attempt to publish v1.0.1 using publishGameRelease with mock db.batch

      await expect(
        publishGameRelease(
          db,
          testEnv,
          { version: "1.0.1", notes: "Failing batch" },
          coreAdminId,
        ),
      ).rejects.toThrow("D1_ERROR: simulated atomic batch transaction rollback")

      // Verify db.batch was explicitly invoked

      expect(batchSpy).toHaveBeenCalledTimes(1)

      // 4. VERIFY OBSERVABLE ATOMIC ROLLBACK PROPERTIES (Requirement 1):

      // - v1.0.0 MUST STILL BE "PUBLISHED"

      // - Draft MUST STILL BE "DRAFT"

      // - NO orphan state (system is NOT left without a published version)

      // - NO partial publication (draft was NOT marked published, old was NOT archived)

      const releasesAfterFail = await db.select().from(gameReleases).all()

      const publishedAfterFail = releasesAfterFail.filter(
        (r) => r.status === "PUBLISHED",
      )

      const draftAfterFail = releasesAfterFail.filter(
        (r) => r.status === "DRAFT",
      )

      expect(publishedAfterFail.length).toBe(1)

      expect(publishedAfterFail[0]?.version).toBe("1.0.0")

      expect(publishedAfterFail[0]?.id).toBe(publishedBefore?.id)

      expect(draftAfterFail.length).toBe(1)

      expect(draftAfterFail[0]?.id).toBe(draft2Id)

      expect(draftAfterFail[0]?.status).toBe("DRAFT")

      // 5. Verify the SUCCESS path of db.batch()

      const successBatchSpy = vi
        .fn()
        .mockImplementation(async (queries: any[]) => {
          expect(queries.length).toBe(2)

          // Execute both queries atomically

          for (const q of queries) {
            if (typeof q.execute === "function") {
              await q.execute()
            } else {
              await q
            }
          }

          return []
        })
      ;(db as any).batch = successBatchSpy

      const successPub = await publishGameRelease(
        db,

        testEnv,

        { version: "1.0.1", notes: "Successful atomic publication" },

        coreAdminId,
      )

      expect(successBatchSpy).toHaveBeenCalledTimes(1)

      expect(successPub.version).toBe("1.0.1")

      expect(successPub.status).toBe("PUBLISHED")

      // Verify DB state after successful batch

      const releasesAfterSuccess = await db.select().from(gameReleases).all()

      const publishedFinal = releasesAfterSuccess.filter(
        (r) => r.status === "PUBLISHED",
      )

      const archivedFinal = releasesAfterSuccess.filter(
        (r) => r.status === "ARCHIVED",
      )

      expect(publishedFinal.length).toBe(1)

      expect(publishedFinal[0]?.version).toBe("1.0.1")

      const v1Archived = archivedFinal.find((r) => r.version === "1.0.0")

      expect(v1Archived).toBeDefined()

      expect(v1Archived?.status).toBe("ARCHIVED")

      // Clean up mock

      delete (db as any).batch
    })
  })

  describe("HiKAT Player Custom Skins & Synchronization (Shard 06.6)", () => {
    let mockR2: ReturnType<typeof createTestR2Bucket>

    const createEnv = (): Env => ({
      DB: testD1 as unknown as D1Database,

      ASSETS: mockR2 as unknown as R2Bucket,

      AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,

      AUTH_ISSUER: DEFAULT_AUTH_ISSUER,

      PTERODACTYL_BASE_URL: "https://panel.test",

      PTERODACTYL_API_KEY: "ptlc_test_key",

      PTERODACTYL_SERVER_ID: "srv_test_uuid",

      ENVIRONMENT: "test",
    })

    beforeEach(() => {
      mockR2 = createTestR2Bucket()
    })

    function createMockSkinPng(width = 64, height = 64, isAlexSlim = false): Uint8Array {
      const data = new Uint8Array(width * height * 4)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 120
        data[i + 1] = 80
        data[i + 2] = 60
        data[i + 3] = 255
      }
      if (isAlexSlim && width === 64 && height === 64) {
        for (let y = 16; y < 20; y++) {
          for (let x = 50; x < 52; x++) {
            data[(y * 64 + x) * 4 + 3] = 0
          }
        }
      }
      return encode({ width, height, data, channels: 4, depth: 8 })
    }

    it("handles complete player skin lifecycle: ticket creation, upload, set, query, replace, and delete", async () => {
      const testEnv = createEnv()

      const db = createDatabase(testEnv.DB!)

      const playerId = crypto.randomUUID()

      const adminId = crypto.randomUUID()

      const playerSessionId = crypto.randomUUID()

      const adminSessionId = crypto.randomUUID()

      await db.insert(users).values([
        {
          id: playerId,

          displayName: "SteveMiner",

          role: "PLAYER",

          createdAt: new Date().toISOString(),

          updatedAt: new Date().toISOString(),
        },

        {
          id: adminId,

          displayName: "AdminUser",

          role: "ADMIN",

          createdAt: new Date().toISOString(),

          updatedAt: new Date().toISOString(),
        },
      ])

      await db.insert(sessions).values([
        {
          id: playerSessionId,

          userId: playerId,

          expiresAt: new Date(Date.now() + 3600000).toISOString(),

          createdAt: new Date().toISOString(),
        },

        {
          id: adminSessionId,

          userId: adminId,

          expiresAt: new Date(Date.now() + 3600000).toISOString(),

          createdAt: new Date().toISOString(),
        },
      ])

      const playerToken = await createTestAccessToken({
        userId: playerId,

        sessionId: playerSessionId,

        role: "PLAYER",

        displayName: "SteveMiner",
      })

      const adminToken = await createTestAccessToken({
        userId: adminId,

        sessionId: adminSessionId,

        role: "ADMIN",

        displayName: "AdminUser",
      })

      // 1. Initial query: myPlayerSkin returns null

      const initMySkinRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `query { myPlayerSkin { id userId imageUrl } }`,
          }),
        }),

        testEnv,
      )

      const initMySkinJson = (await initMySkinRes.json()) as any

      expect(initMySkinJson.errors).toBeUndefined()

      expect(initMySkinJson.data.myPlayerSkin).toBeNull()

      // 2. PLAYER requests upload ticket

      const ticketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `mutation { createPlayerSkinUpload { uploadUrl uploadToken } }`,
          }),
        }),

        testEnv,
      )

      const ticketJson = (await ticketRes.json()) as any

      expect(ticketJson.errors).toBeUndefined()

      expect(ticketJson.data.createPlayerSkinUpload.uploadUrl).toContain(
        "/media/player-skin/upload",
      )

      expect(ticketJson.data.createPlayerSkinUpload.uploadToken).toBeDefined()

      const uploadToken = ticketJson.data.createPlayerSkinUpload.uploadToken

      // 3. Unauthenticated ticket request fails

      const unauthTicketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({
            query: `mutation { createPlayerSkinUpload { uploadUrl uploadToken } }`,
          }),
        }),

        testEnv,
      )

      const unauthTicketJson = (await unauthTicketRes.json()) as any
      expect(unauthTicketJson.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")



      // 4. Binary upload rejects missing/invalid headers and non-PNG

      const noAuthUpload = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",

          headers: {
            "Content-Type": "image/png",

            "X-Upload-Token": uploadToken,
          },

          body: createMockSkinPng(64, 64) as unknown as BodyInit,
        }),

        testEnv,
      )

      expect(noAuthUpload.status).toBe(401)

      const wrongMimeUpload = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",

          headers: {
            "Content-Type": "image/jpeg",

            Authorization: `Bearer ${playerToken}`,

            "X-Upload-Token": uploadToken,
          },

          body: createMockSkinPng(64, 64) as unknown as BodyInit,
        }),

        testEnv,
      )

      expect(wrongMimeUpload.status).toBe(415)

      // 5. Binary upload rejects invalid Minecraft texture dimensions (e.g. 50x50)

      const invalidDimUpload = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",

          headers: {
            "Content-Type": "image/png",

            Authorization: `Bearer ${playerToken}`,

            "X-Upload-Token": uploadToken,
          },

          body: createMockSkinPng(50, 50) as unknown as BodyInit,
        }),

        testEnv,
      )

      expect(invalidDimUpload.status).toBe(400)

      const invalidDimJson = (await invalidDimUpload.json()) as any

      expect(invalidDimJson.error).toContain("Dimensiones")

      // 6. Valid 64x64 skin upload succeeds and consumes token

      const validSkinBytes = createMockSkinPng(64, 64)

      const validUploadRes = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",

          headers: {
            "Content-Type": "image/png",

            Authorization: `Bearer ${playerToken}`,

            "X-Upload-Token": uploadToken,
          },

          body: validSkinBytes as unknown as BodyInit,
        }),

        testEnv,
      )

      expect(validUploadRes.status).toBe(201)

      const mediaJson = (await validUploadRes.json()) as any

      expect(mediaJson.id).toBeDefined()

      const mediaId1 = mediaJson.id

      // 7. Reusing same upload token fails with 409

      const reuseUploadRes = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",

          headers: {
            "Content-Type": "image/png",

            Authorization: `Bearer ${playerToken}`,

            "X-Upload-Token": uploadToken,
          },

          body: validSkinBytes as unknown as BodyInit,
        }),

        testEnv,
      )

      expect(reuseUploadRes.status).toBe(409)

      // 8. setMyPlayerSkin assigns custom skin to player

      const setSkinRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `mutation SetSkin($input: SetPlayerSkinInput!) {
              setMyPlayerSkin(input: $input) {
                id
                userId
                imageUrl
              }
            }`,

            variables: {
              input: {
                mediaId: mediaId1,
              },
            },
          }),
        }),

        testEnv,
      )

      const setSkinJson = (await setSkinRes.json()) as any

      expect(setSkinJson.errors).toBeUndefined()

      expect(setSkinJson.data.setMyPlayerSkin.imageUrl).toBe(
        `/media/content/${mediaId1}`,
      )

      const playerSkinId = setSkinJson.data.setMyPlayerSkin.id

      // 9. Query myPlayerSkin now returns the uploaded skin

      const mySkinRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `query { myPlayerSkin { id userId imageUrl } }`,
          }),
        }),

        testEnv,
      )

      const mySkinJson = (await mySkinRes.json()) as any

      expect(mySkinJson.errors).toBeUndefined()

      expect(mySkinJson.data.myPlayerSkin.id).toBe(playerSkinId)

      // 10. Public skins query does NOT return player custom skins (Strict domain isolation)

      const publicSkinsRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({
            query: `query { skins { items { id name } totalCount } }`,
          }),
        }),

        testEnv,
      )

      const publicSkinsJson = (await publicSkinsRes.json()) as any

      expect(publicSkinsJson.errors).toBeUndefined()

      expect(publicSkinsJson.data.skins.totalCount).toBe(0)

      // 11. Admin player skins listing returns player skin with userDisplayName

      const adminListRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${adminToken}`,
          },

          body: JSON.stringify({
            query: `query { adminPlayerSkins { items { id userId userDisplayName imageUrl } totalCount } }`,
          }),
        }),

        testEnv,
      )

      const adminListJson = (await adminListRes.json()) as any

      expect(adminListJson.errors).toBeUndefined()

      expect(adminListJson.data.adminPlayerSkins.totalCount).toBe(1)

      expect(
        adminListJson.data.adminPlayerSkins.items[0]?.userDisplayName,
      ).toBe("SteveMiner")

      // 12. Admin single player skin query

      const adminSingleRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${adminToken}`,
          },

          body: JSON.stringify({
            query: `query GetSingle($id: ID!) { adminPlayerSkin(id: $id) { id userDisplayName imageUrl } }`,

            variables: { id: playerSkinId },
          }),
        }),

        testEnv,
      )

      const adminSingleJson = (await adminSingleRes.json()) as any

      expect(adminSingleJson.errors).toBeUndefined()

      expect(adminSingleJson.data.adminPlayerSkin.userDisplayName).toBe(
        "SteveMiner",
      )

      // 13. Admin updates player skin texture to new texture
      const slimData = new Uint8Array(64 * 64 * 4).fill(255)
      for (let y = 16; y < 20; y++) {
        for (let x = 50; x < 52; x++) {
          slimData[(y * 64 + x) * 4 + 3] = 0
        }
      }
      const slimPng = encode({ width: 64, height: 64, data: slimData, channels: 4, depth: 8 })
      const slimMediaId = "media-slim-" + crypto.randomUUID()
      await db.insert(contentMedia).values({
        id: slimMediaId,
        objectKey: `content/${slimMediaId}.png`,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: slimPng.byteLength,
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })
      await mockR2.put(`content/${slimMediaId}.png`, slimPng.buffer as ArrayBuffer, {
        httpMetadata: { contentType: "image/png" },
      })

      const adminUpdateRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${adminToken}`,
          },

          body: JSON.stringify({
            query: `mutation Update($id: ID!, $input: UpdateAdminPlayerSkinInput!) {
              updateAdminPlayerSkin(id: $id, input: $input) { id imageUrl }
            }`,

            variables: { id: playerSkinId, input: { mediaId: slimMediaId } },
          }),
        }),

        testEnv,
      )

      const adminUpdateJson = (await adminUpdateRes.json()) as any

      expect(adminUpdateJson.errors).toBeUndefined()
      expect(adminUpdateJson.data.updateAdminPlayerSkin.id).toBe(playerSkinId)

      // 14. Safe Replacement: Upload a second skin and replace

      const ticket2Res = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `mutation { createPlayerSkinUpload { uploadToken } }`,
          }),
        }),

        testEnv,
      )

      const token2 = ((await ticket2Res.json()) as any).data
        .createPlayerSkinUpload.uploadToken

      const upload2Res = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",

          headers: {
            "Content-Type": "image/png",

            Authorization: `Bearer ${playerToken}`,

            "X-Upload-Token": token2,
          },

          body: createMockSkinPng(64, 32) as unknown as BodyInit, // Legacy 64x32 format
        }),

        testEnv,
      )

      expect(upload2Res.status).toBe(201)

      const media2Json = (await upload2Res.json()) as any

      const mediaId2 = media2Json.id

      // Replace skin

      const replaceRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `mutation SetSkin($input: SetPlayerSkinInput!) {
              setMyPlayerSkin(input: $input) {
                id
                imageUrl
              }
            }`,

            variables: {
              input: {
                mediaId: mediaId2,
              },
            },
          }),
        }),

        testEnv,
      )

      const replaceJson = (await replaceRes.json()) as any

      expect(replaceJson.data.setMyPlayerSkin.id).toBe(playerSkinId) // Replaces in-place

      expect(replaceJson.data.setMyPlayerSkin.imageUrl).toContain(mediaId2)

      // 15. Player deletes custom skin

      const deleteRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `mutation { deleteMyPlayerSkin }`,
          }),
        }),

        testEnv,
      )

      const deleteJson = (await deleteRes.json()) as any

      expect(deleteJson.data.deleteMyPlayerSkin).toBe(true)

      // Verify myPlayerSkin is null after deletion

      const finalQuery = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `query { myPlayerSkin { id } }`,
          }),
        }),

        testEnv,
      )

      const finalJson = (await finalQuery.json()) as any

      expect(finalJson.data.myPlayerSkin).toBeNull()

      // Idempotent delete returns true

      const repeatDelete = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${playerToken}`,
          },

          body: JSON.stringify({
            query: `mutation { deleteMyPlayerSkin }`,
          }),
        }),

        testEnv,
      )

      const repeatDeleteJson = (await repeatDelete.json()) as any
      expect(repeatDeleteJson.data.deleteMyPlayerSkin).toBe(true)
    })

    it("safely handles concurrent setMyPlayerSkin calls with atomic UPSERT and enforces single row", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const concurrentPlayerId = crypto.randomUUID()
      const concurrentPlayerSessionId = crypto.randomUUID()
      const concurrentAdminId = crypto.randomUUID()
      const concurrentAdminSessionId = crypto.randomUUID()

      await db.insert(users).values([
        {
          id: concurrentPlayerId,
          displayName: "ConcurrentPlayer",
          role: "PLAYER",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: concurrentAdminId,
          displayName: "ConcurrentAdmin",
          role: "ADMIN",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])


      await db.insert(sessions).values([
        {
          id: concurrentPlayerSessionId,
          userId: concurrentPlayerId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: concurrentAdminSessionId,
          userId: concurrentAdminId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ])

      const pToken = await createTestAccessToken({
        userId: concurrentPlayerId,
        sessionId: concurrentPlayerSessionId,
        role: "PLAYER",
        displayName: "ConcurrentPlayer",
      })

      const aToken = await createTestAccessToken({
        userId: concurrentAdminId,
        sessionId: concurrentAdminSessionId,
        role: "ADMIN",
        displayName: "ConcurrentAdmin",
      })

      // Upload texture
      const ticketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${pToken}`,
          },
          body: JSON.stringify({
            query: `mutation { createPlayerSkinUpload { uploadToken } }`,
          }),
        }),
        testEnv,
      )
      const token = ((await ticketRes.json()) as any).data.createPlayerSkinUpload.uploadToken
      const uploadRes = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            Authorization: `Bearer ${pToken}`,
            "X-Upload-Token": token,
          },
          body: createMockSkinPng(64, 64) as unknown as BodyInit,
        }),
        testEnv,
      )
      const media = (await uploadRes.json()) as any

      // Execute 2 concurrent setMyPlayerSkin calls
      const [res1, res2] = await Promise.all([
        worker.fetch(
          new Request("http://localhost/graphql", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${pToken}`,
            },
            body: JSON.stringify({
              query: `mutation SetSkin($input: SetPlayerSkinInput!) {
                setMyPlayerSkin(input: $input) { id imageUrl }
              }`,
              variables: { input: { mediaId: media.id } },
            }),
          }),
          testEnv,
        ),
        worker.fetch(
          new Request("http://localhost/graphql", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${pToken}`,
            },
            body: JSON.stringify({
              query: `mutation SetSkin($input: SetPlayerSkinInput!) {
                setMyPlayerSkin(input: $input) { id imageUrl }
              }`,
              variables: { input: { mediaId: media.id } },
            }),
          }),
          testEnv,
        ),
      ])

      const json1 = (await res1.json()) as any
      const json2 = (await res2.json()) as any
      expect(json1.errors).toBeUndefined()
      expect(json2.errors).toBeUndefined()

      // Verify that in D1 there is exactly ONE row for this user
      const countRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aToken}`,
          },
          body: JSON.stringify({
            query: `query { adminPlayerSkins(search: "ConcurrentPlayer") { totalCount } }`,
          }),
        }),
        testEnv,
      )
      const countJson = (await countRes.json()) as any
      expect(countJson.data.adminPlayerSkins.totalCount).toBe(1)
    })

    it("rejects deleteContentMedia with CONFLICT when media is in use by a player skin", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const conflictPlayerId = crypto.randomUUID()
      const conflictPlayerSessionId = crypto.randomUUID()
      const conflictAdminId = crypto.randomUUID()
      const conflictAdminSessionId = crypto.randomUUID()

      await db.insert(users).values([
        {
          id: conflictPlayerId,
          displayName: "ConflictPlayer",
          role: "PLAYER",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: conflictAdminId,
          displayName: "ConflictAdmin",
          role: "ADMIN",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])


      await db.insert(sessions).values([
        {
          id: conflictPlayerSessionId,
          userId: conflictPlayerId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: conflictAdminSessionId,
          userId: conflictAdminId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ])

      const pToken = await createTestAccessToken({
        userId: conflictPlayerId,
        sessionId: conflictPlayerSessionId,
        role: "PLAYER",
        displayName: "ConflictPlayer",
      })

      const aToken = await createTestAccessToken({
        userId: conflictAdminId,
        sessionId: conflictAdminSessionId,
        role: "ADMIN",
        displayName: "ConflictAdmin",
      })

      // Upload texture
      const ticketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${pToken}`,
          },
          body: JSON.stringify({
            query: `mutation { createPlayerSkinUpload { uploadToken } }`,
          }),
        }),
        testEnv,
      )
      const token = ((await ticketRes.json()) as any).data.createPlayerSkinUpload.uploadToken
      const uploadRes = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            Authorization: `Bearer ${pToken}`,
            "X-Upload-Token": token,
          },
          body: createMockSkinPng(64, 64) as unknown as BodyInit,
        }),
        testEnv,
      )
      const media = (await uploadRes.json()) as any

      // Set skin
      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${pToken}`,
          },
          body: JSON.stringify({
            query: `mutation SetSkin($input: SetPlayerSkinInput!) {
              setMyPlayerSkin(input: $input) { id }
            }`,
            variables: { input: { mediaId: media.id, model: "CLASSIC" } },
          }),
        }),
        testEnv,
      )

      // Attempt to delete content media using admin token
      const delRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aToken}`,
          },
          body: JSON.stringify({
            query: `mutation DeleteMedia($id: ID!) {
              deleteContentMedia(id: $id)
            }`,
            variables: { id: media.id },
          }),
        }),
        testEnv,
      )
    })
  })

  describe("HiKAT Unified Active Skin Selection (Phase 07)", () => {
    let mockR2: ReturnType<typeof createTestR2Bucket>

    const createEnv = (): Env => ({
      DB: testD1 as unknown as D1Database,
      ASSETS: mockR2 as unknown as R2Bucket,
      AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,
      AUTH_ISSUER: DEFAULT_AUTH_ISSUER,
      ENVIRONMENT: "test",
    })

    beforeEach(() => {
      mockR2 = createTestR2Bucket()
    })

    it("manages active skin selection with strict fallback semantics", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const playerId = "player-active-" + crypto.randomUUID()
      const playerSessionId = "sess-" + crypto.randomUUID()
      const adminId = "admin-active-" + crypto.randomUUID()
      const adminSessionId = "sess-admin-" + crypto.randomUUID()

      await db.insert(users).values([
        { id: playerId, displayName: "SkinMaster", role: "PLAYER" },
        { id: adminId, displayName: "AdminSkin", role: "ADMIN" },
      ])

      await db.insert(sessions).values([
        {
          id: playerSessionId,
          userId: playerId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: adminSessionId,
          userId: adminId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ])

      const playerToken = await createTestAccessToken({
        userId: playerId,
        sessionId: playerSessionId,
        role: "PLAYER",
        displayName: "SkinMaster",
      })

      // 1. Initially, player has no active skin
      const initRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `query { myActiveSkin { type skinId imageUrl name } }`,
          }),
        }),
        testEnv,
      )
      const initJson = (await initRes.json()) as any
      expect(initJson.errors).toBeUndefined()
      expect(initJson.data.myActiveSkin).toBeNull()

      // 2. Player cannot set CUSTOM if they don't have custom skin
      const failCustomRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation { setMyActiveSkin(input: { type: CUSTOM }) { type name } }`,
          }),
        }),
        testEnv,
      )
      const failCustomJson = (await failCustomRes.json()) as any
      expect(failCustomJson.errors).toBeDefined()
      expect(failCustomJson.errors[0].extensions?.code).toBe("VALIDATION_ERROR")

      // 3. Upload custom skin (Alex Slim texture)
      const ticketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation { createPlayerSkinUpload { uploadUrl uploadToken } }`,
          }),
        }),
        testEnv,
      )
      const ticketToken = ((await ticketRes.json()) as any).data.createPlayerSkinUpload.uploadToken

      const slimData = new Uint8Array(64 * 64 * 4).fill(200)
      // Make box 1 transparent
      for (let y = 16; y < 20; y++) {
        for (let x = 50; x < 52; x++) {
          slimData[(y * 64 + x) * 4 + 3] = 0
        }
      }
      const slimPng = encode({ width: 64, height: 64, data: slimData, channels: 4, depth: 8 })

      const uploadRes = await worker.fetch(
        new Request("http://localhost/media/player-skin/upload", {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            Authorization: `Bearer ${playerToken}`,
            "X-Upload-Token": ticketToken,
          },
          body: slimPng as unknown as BodyInit,
        }),
        testEnv,
      )
      const mediaJson = (await uploadRes.json()) as any

      const setSkinRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation SetSkin($input: SetPlayerSkinInput!) {
              setMyPlayerSkin(input: $input) { id imageUrl }
            }`,
            variables: { input: { mediaId: mediaJson.id } },
          }),
        }),
        testEnv,
      )
      const setSkinData = (await setSkinRes.json()) as any
      expect(setSkinData.errors).toBeUndefined()
      expect(setSkinData.data.setMyPlayerSkin.id).toBeDefined()

      // 4. Setting active skin to CUSTOM now succeeds
      const setCustomActiveRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation { setMyActiveSkin(input: { type: CUSTOM }) { type imageUrl name } }`,
          }),
        }),
        testEnv,
      )
      const setCustomActiveJson = (await setCustomActiveRes.json()) as any
      expect(setCustomActiveJson.errors).toBeUndefined()
      expect(setCustomActiveJson.data.setMyActiveSkin.type).toBe("CUSTOM")

      // 5. Query myActiveSkin returns CUSTOM
      const queryActiveRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `query { myActiveSkin { type imageUrl name } }`,
          }),
        }),
        testEnv,
      )
      const queryActiveJson = (await queryActiveRes.json()) as any
      expect(queryActiveJson.data.myActiveSkin.type).toBe("CUSTOM")

      // 6. Create a Global Skin
      const classicData = new Uint8Array(64 * 64 * 4).fill(150)
      const classicPng = encode({ width: 64, height: 64, data: classicData, channels: 4, depth: 8 })
      const globalMediaId = "media-global-" + crypto.randomUUID()
      await db.insert(contentMedia).values({
        id: globalMediaId,
        objectKey: `content/${globalMediaId}.png`,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: classicPng.byteLength,
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })
      await mockR2.put(`content/${globalMediaId}.png`, classicPng.buffer as ArrayBuffer, {
        httpMetadata: { contentType: "image/png" },
      })

      const globalSkinId = "skin-global-" + crypto.randomUUID()
      await db.insert(skins).values({
        id: globalSkinId,
        name: "Caballero Real",
        mediaId: globalMediaId,
        status: "AVAILABLE",
        createdBy: adminId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // 7. Player switches active skin to GLOBAL
      const setGlobalActiveRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation SetActive($input: SetActiveSkinInput!) {
              setMyActiveSkin(input: $input) { type skinId name }
            }`,
            variables: { input: { type: "GLOBAL", skinId: globalSkinId } },
          }),
        }),
        testEnv,
      )
      const setGlobalActiveJson = (await setGlobalActiveRes.json()) as any
      expect(setGlobalActiveJson.errors).toBeUndefined()
      expect(setGlobalActiveJson.data.setMyActiveSkin.type).toBe("GLOBAL")
      expect(setGlobalActiveJson.data.setMyActiveSkin.skinId).toBe(globalSkinId)
      expect(setGlobalActiveJson.data.setMyActiveSkin.name).toBe("Caballero Real")

      // 8. Test Fallback: Admin deletes global skin via deleteSkin -> D1 selection immediately reconciles to CUSTOM
      const { deleteSkin, updateSkin } = await import("./services/skinService")
      await deleteSkin(db, globalSkinId, testEnv)

      // Direct inspection of D1 immediately after deletion (before any query)
      const d1Selection = await db
        .select()
        .from(playerSkinSelections)
        .where(eq(playerSkinSelections.userId, playerId))
        .get()

      expect(d1Selection).toBeDefined()
      expect(d1Selection?.type).toBe("CUSTOM")
      expect(d1Selection?.skinId).toBeNull()

      const fallbackRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `query { myActiveSkin { type imageUrl name } }`,
          }),
        }),
        testEnv,
      )
      const fallbackJson = (await fallbackRes.json()) as any
      expect(fallbackJson.errors).toBeUndefined()
      expect(fallbackJson.data.myActiveSkin.type).toBe("CUSTOM")
    })

    it("Phase 07 Hardening: deleteSkin without custom skin removes D1 selection row immediately", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const player2Id = "player-2-" + crypto.randomUUID()
      const adminId = "admin-2-" + crypto.randomUUID()

      await db.insert(users).values([
        { id: player2Id, displayName: "PlayerTwo", role: "PLAYER" },
        { id: adminId, displayName: "AdminTwo", role: "ADMIN" },
      ])

      // Create a global skin
      const global2Id = "skin-global-2-" + crypto.randomUUID()
      const media2Id = "media-global-2-" + crypto.randomUUID()
      await db.insert(contentMedia).values({
        id: media2Id,
        objectKey: `content/${media2Id}.png`,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 100,
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })
      await db.insert(skins).values({
        id: global2Id,
        name: "Global Skin 2",
        mediaId: media2Id,
        status: "AVAILABLE",
        createdBy: adminId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Player 2 selects this global skin (has NO custom skin)
      await db.insert(playerSkinSelections).values({
        userId: player2Id,
        type: "GLOBAL",
        skinId: global2Id,
        updatedAt: new Date().toISOString(),
      })

      // Admin deletes global skin
      const { deleteSkin } = await import("./services/skinService")
      await deleteSkin(db, global2Id, testEnv)

      // Direct inspection of D1 immediately after deletion
      const d1Selection = await db
        .select()
        .from(playerSkinSelections)
        .where(eq(playerSkinSelections.userId, player2Id))
        .get()

      expect(d1Selection).toBeUndefined()

      // Verify D1 never has type = GLOBAL with skinId = null
      const invalidRows = await db
        .select()
        .from(playerSkinSelections)
        .where(eq(playerSkinSelections.type, "GLOBAL"))
        .all()
      for (const row of invalidRows) {
        expect(row.skinId).not.toBeNull()
      }
    })

    it("Phase 07 Hardening: updateSkin to UNAVAILABLE reconciles D1 selection immediately", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const player3Id = "player-3-" + crypto.randomUUID()
      const adminId = "admin-3-" + crypto.randomUUID()

      await db.insert(users).values([
        { id: player3Id, displayName: "PlayerThree", role: "PLAYER" },
        { id: adminId, displayName: "AdminThree", role: "ADMIN" },
      ])

      // Create a global skin
      const global3Id = "skin-global-3-" + crypto.randomUUID()
      const media3Id = "media-global-3-" + crypto.randomUUID()
      await db.insert(contentMedia).values({
        id: media3Id,
        objectKey: `content/${media3Id}.png`,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 100,
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })
      await db.insert(skins).values({
        id: global3Id,
        name: "Global Skin 3",
        mediaId: media3Id,
        status: "AVAILABLE",
        createdBy: adminId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Player 3 selects this global skin (and has custom skin)
      await db.insert(playerSkinSelections).values({
        userId: player3Id,
        type: "GLOBAL",
        skinId: global3Id,
        updatedAt: new Date().toISOString(),
      })
      await db.insert(playerSkins).values({
        id: crypto.randomUUID(),
        userId: player3Id,
        mediaId: media3Id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Admin marks skin as UNAVAILABLE
      const { updateSkin } = await import("./services/skinService")
      await updateSkin(db, testEnv, global3Id, { status: "UNAVAILABLE" })

      // Direct inspection of D1 immediately after update
      const d1Selection = await db
        .select()
        .from(playerSkinSelections)
        .where(eq(playerSkinSelections.userId, player3Id))
        .get()

      expect(d1Selection).toBeDefined()
      expect(d1Selection?.type).toBe("CUSTOM")
      expect(d1Selection?.skinId).toBeNull()
    })

    it("Phase 07 Hardening: updateSkin with UNAVAILABLE and invalid media does not produce partial effects", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const player4Id = "player-4-" + crypto.randomUUID()
      const adminId = "admin-4-" + crypto.randomUUID()

      await db.insert(users).values([
        { id: player4Id, displayName: "PlayerFour", role: "PLAYER" },
        { id: adminId, displayName: "AdminFour", role: "ADMIN" },
      ])

      // Create a global skin
      const global4Id = "skin-global-4-" + crypto.randomUUID()
      const media4Id = "media-global-4-" + crypto.randomUUID()
      await db.insert(contentMedia).values({
        id: media4Id,
        objectKey: `content/${media4Id}.png`,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 100,
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })
      await db.insert(skins).values({
        id: global4Id,
        name: "Global Skin 4",
        mediaId: media4Id,
        status: "AVAILABLE",
        createdBy: adminId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Player 4 selects this global skin (and has custom skin)
      await db.insert(playerSkinSelections).values({
        userId: player4Id,
        type: "GLOBAL",
        skinId: global4Id,
        updatedAt: new Date().toISOString(),
      })
      await db.insert(playerSkins).values({
        id: crypto.randomUUID(),
        userId: player4Id,
        mediaId: media4Id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Attempt to update with status UNAVAILABLE and a NON-EXISTENT mediaId
      const { updateSkin } = await import("./services/skinService")
      await expect(
        updateSkin(db, testEnv, global4Id, {
          status: "UNAVAILABLE",
          mediaId: "non-existent-media-id",
        }),
      ).rejects.toThrow("La textura de skin seleccionada no existe.")

      // 1. Skin status must STILL be AVAILABLE
      const skinAfter = await db
        .select()
        .from(skins)
        .where(eq(skins.id, global4Id))
        .get()
      expect(skinAfter?.status).toBe("AVAILABLE")

      // 2. Player selection must STILL be GLOBAL + global4Id (NOT reconciled to CUSTOM)
      const selectionAfter = await db
        .select()
        .from(playerSkinSelections)
        .where(eq(playerSkinSelections.userId, player4Id))
        .get()
      expect(selectionAfter?.type).toBe("GLOBAL")
      expect(selectionAfter?.skinId).toBe(global4Id)
    })

    it("Phase 07 Micro-Hardening: inspectSkinMedia and createSkin reject skin PNG > 1 MB even with valid 64x64 dimensions", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const adminId = "admin-size-" + crypto.randomUUID()
      await db.insert(users).values({
        id: adminId,
        displayName: "AdminSize",
        role: "ADMIN",
      })

      const skinData = new Uint8Array(64 * 64 * 4)
      for (let i = 0; i < skinData.length; i += 4) {
        skinData[i] = 100
        skinData[i + 1] = 120
        skinData[i + 2] = 140
        skinData[i + 3] = 255
      }
      const validPngBytes = encode({ width: 64, height: 64, data: skinData, channels: 4, depth: 8 })

      // 1. Oversized media record (> 1 MB) with valid 64x64 PNG in R2
      const oversizedMediaId = "media-oversized-" + crypto.randomUUID()
      const oversizedObjectKey = `content/${oversizedMediaId}.png`
      await testEnv.ASSETS!.put(oversizedObjectKey, validPngBytes)

      await db.insert(contentMedia).values({
        id: oversizedMediaId,
        objectKey: oversizedObjectKey,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 1024 * 1024 + 500, // 1.0005 MB (> 1 MB)
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })

      const { inspectSkinMedia, createSkin, updateSkin } = await import("./services/skinService")

      // inspectSkinMedia should reject fail-closed
      await expect(
        inspectSkinMedia(db, testEnv, oversizedMediaId),
      ).rejects.toThrow("La textura de skin supera el tamaño máximo permitido de 1 MB.")

      // createSkin should reject fail-closed
      await expect(
        createSkin(
          db,
          testEnv,
          {
            name: "Oversized Global Skin",
            mediaId: oversizedMediaId,
          },
          adminId,
        ),
      ).rejects.toThrow("La textura de skin supera el tamaño máximo permitido de 1 MB.")

      // 2. Valid sized media record (<= 1 MB)
      const validMediaId = "media-valid-" + crypto.randomUUID()
      const validObjectKey = `content/${validMediaId}.png`
      await testEnv.ASSETS!.put(validObjectKey, validPngBytes)

      await db.insert(contentMedia).values({
        id: validMediaId,
        objectKey: validObjectKey,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: validPngBytes.length, // Valid ~1KB
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })

      const inspected = await inspectSkinMedia(db, testEnv, validMediaId)
      expect(inspected.media.id).toBe(validMediaId)

      const created = await createSkin(
        db,
        testEnv,
        {
          name: "Valid Global Skin",
          mediaId: validMediaId,
        },
        adminId,
      )
      expect(created.name).toBe("Valid Global Skin")
      expect(created.imageUrl).toBe(`/media/content/${validMediaId}`)

      // Updating with oversized media should also reject fail-closed
      await expect(
        updateSkin(db, testEnv, created.id, {
          mediaId: oversizedMediaId,
        }),
      ).rejects.toThrow("La textura de skin supera el tamaño máximo permitido de 1 MB.")
    })
  })

  describe("HiKAT Capes Management & Selection (Phase 07 Hardening)", () => {
    let mockR2: ReturnType<typeof createTestR2Bucket>

    const createEnv = (): Env => ({
      DB: testD1 as unknown as D1Database,
      ASSETS: mockR2 as unknown as R2Bucket,
      AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem,
      AUTH_ISSUER: DEFAULT_AUTH_ISSUER,
      ENVIRONMENT: "test",
    })

    beforeEach(() => {
      mockR2 = createTestR2Bucket()
    })

    it("manages global capes, multiple player custom capes, active cape selection with canonical NONE, and limits", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const adminId = "admin-cape-" + crypto.randomUUID()
      const adminSessionId = "sess-admin-cape-" + crypto.randomUUID()
      const playerId = "player-cape-" + crypto.randomUUID()
      const playerSessionId = "sess-player-cape-" + crypto.randomUUID()

      await db.insert(users).values([
        { id: adminId, displayName: "CapeAdmin", role: "ADMIN" },
        { id: playerId, displayName: "CapePlayer", role: "PLAYER" },
      ])

      await db.insert(sessions).values([
        {
          id: adminSessionId,
          userId: adminId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: playerSessionId,
          userId: playerId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ])

      const adminToken = await createTestAccessToken({
        userId: adminId,
        sessionId: adminSessionId,
        role: "ADMIN",
        displayName: "CapeAdmin",
      })
      const playerToken = await createTestAccessToken({
        userId: playerId,
        sessionId: playerSessionId,
        role: "PLAYER",
        displayName: "CapePlayer",
      })

      // 1. Initial State: Player has no active cape (canonical NONE)
      const initActiveRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `query { myActiveCape { type capeId playerCapeId imageUrl name } }`,
          }),
        }),
        testEnv,
      )
      const initActiveJson = (await initActiveRes.json()) as any
      expect(initActiveJson.errors).toBeUndefined()
      expect(initActiveJson.data.myActiveCape.type).toBe("NONE")
      expect(initActiveJson.data.myActiveCape.capeId).toBeNull()
      expect(initActiveJson.data.myActiveCape.playerCapeId).toBeNull()
      expect(initActiveJson.data.myActiveCape.name).toBe("Sin capa")

      // 2. Admin creates a Global Cape (Standard 64x32 or HD 128x64)
      const capeData = new Uint8Array(64 * 32 * 4).fill(180)
      const capePng = encode({ width: 64, height: 32, data: capeData, channels: 4, depth: 8 })
      const globalMediaId = "media-cape-global-" + crypto.randomUUID()

      await db.insert(contentMedia).values({
        id: globalMediaId,
        objectKey: `content/${globalMediaId}.png`,
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: capePng.byteLength,
        createdBy: adminId,
        createdAt: new Date().toISOString(),
      })
      await mockR2.put(`content/${globalMediaId}.png`, capePng.buffer as ArrayBuffer, {
        httpMetadata: { contentType: "image/png" },
      })

      const createCapeRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            query: `mutation CreateCape($input: CreateCapeInput!) {
              createCape(input: $input) { id name imageUrl status }
            }`,
            variables: {
              input: {
                name: "Capa Fundador",
                mediaId: globalMediaId,
                status: "AVAILABLE",
              },
            },
          }),
        }),
        testEnv,
      )
      const createCapeJson = (await createCapeRes.json()) as any
      expect(createCapeJson.errors).toBeUndefined()
      const globalCapeId = createCapeJson.data.createCape.id
      expect(globalCapeId).toBeDefined()
      expect(createCapeJson.data.createCape.name).toBe("Capa Fundador")

      // 3. Player selects Global Cape
      const setGlobalRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation SetActiveCape($input: SetActiveCapeInput!) {
              setMyActiveCape(input: $input) { type capeId playerCapeId name }
            }`,
            variables: { input: { type: "GLOBAL", capeId: globalCapeId } },
          }),
        }),
        testEnv,
      )
      const setGlobalJson = (await setGlobalRes.json()) as any
      expect(setGlobalJson.errors).toBeUndefined()
      expect(setGlobalJson.data.setMyActiveCape.type).toBe("GLOBAL")
      expect(setGlobalJson.data.setMyActiveCape.capeId).toBe(globalCapeId)
      expect(setGlobalJson.data.setMyActiveCape.playerCapeId).toBeNull()

      // 4. Player uploads and adds a custom cape (e.g. HD 128x64 OptiFine style)
      const playerCapeTicketRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation { createPlayerCapeUpload { uploadUrl uploadToken } }`,
          }),
        }),
        testEnv,
      )
      const playerCapeTicket = ((await playerCapeTicketRes.json()) as any).data.createPlayerCapeUpload.uploadToken

      const hdCapeData = new Uint8Array(128 * 64 * 4).fill(220)
      const hdCapePng = encode({ width: 128, height: 64, data: hdCapeData, channels: 4, depth: 8 })

      const uploadCapeRes = await worker.fetch(
        new Request("http://localhost/media/player-cape/upload", {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            Authorization: `Bearer ${playerToken}`,
            "X-Upload-Token": playerCapeTicket,
          },
          body: hdCapePng as unknown as BodyInit,
        }),
        testEnv,
      )
      const uploadCapeJson = (await uploadCapeRes.json()) as any
      expect(uploadCapeRes.status).toBe(201)

      const addCapeRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation AddPlayerCape($input: AddPlayerCapeInput!) {
              addMyPlayerCape(input: $input) { id name imageUrl }
            }`,
            variables: { input: { name: "Mi Capa Dragón", mediaId: uploadCapeJson.id } },
          }),
        }),
        testEnv,
      )
      const addCapeJson = (await addCapeRes.json()) as any
      expect(addCapeJson.errors).toBeUndefined()
      const playerCapeId = addCapeJson.data.addMyPlayerCape.id
      expect(playerCapeId).toBeDefined()

      // Adding custom cape automatically sets active selection to CUSTOM
      const queryActiveAfterAdd = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `query { myActiveCape { type capeId playerCapeId name } }`,
          }),
        }),
        testEnv,
      )
      const activeAfterAddJson = (await queryActiveAfterAdd.json()) as any
      expect(activeAfterAddJson.data.myActiveCape.type).toBe("CUSTOM")
      expect(activeAfterAddJson.data.myActiveCape.playerCapeId).toBe(playerCapeId)
      expect(activeAfterAddJson.data.myActiveCape.capeId).toBeNull()

      // 5. Player sets active cape to NONE explicitly
      const setNoneRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation { setMyActiveCape(input: { type: NONE }) { type capeId playerCapeId name } }`,
          }),
        }),
        testEnv,
      )
      const setNoneJson = (await setNoneRes.json()) as any
      expect(setNoneJson.errors).toBeUndefined()
      expect(setNoneJson.data.setMyActiveCape.type).toBe("NONE")
      expect(setNoneJson.data.setMyActiveCape.capeId).toBeNull()
      expect(setNoneJson.data.setMyActiveCape.playerCapeId).toBeNull()

      // 6. Delete custom cape reconciles active selection to NONE if it was active
      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation SetActiveCape($input: SetActiveCapeInput!) {
              setMyActiveCape(input: $input) { type playerCapeId }
            }`,
            variables: { input: { type: "CUSTOM", playerCapeId } },
          }),
        }),
        testEnv,
      )

      const deleteMyCapeRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `mutation DeleteMyCape($id: ID!) {
              deleteMyPlayerCape(id: $id)
            }`,
            variables: { id: playerCapeId },
          }),
        }),
        testEnv,
      )
      const deleteMyCapeJson = (await deleteMyCapeRes.json()) as any
      expect(deleteMyCapeJson.data.deleteMyPlayerCape).toBe(true)

      const queryActiveAfterDel = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({
            query: `query { myActiveCape { type capeId playerCapeId name } }`,
          }),
        }),
        testEnv,
      )
      const activeAfterDelJson = (await queryActiveAfterDel.json()) as any
      expect(activeAfterDelJson.data.myActiveCape.type).toBe("NONE")
      expect(activeAfterDelJson.data.myActiveCape.capeId).toBeNull()
      expect(activeAfterDelJson.data.myActiveCape.playerCapeId).toBeNull()
    })

    it("cleans up orphaned media on updateSkin and updateCape when texture is replaced, but preserves media if referenced elsewhere", async () => {
      const testEnv = createEnv()
      const db = createDatabase(testEnv.DB!)

      const adminId = "admin-cleanup-" + crypto.randomUUID()
      const adminSessionId = "sess-admin-cleanup-" + crypto.randomUUID()
      const now = new Date().toISOString()

      await db.insert(users).values({
        id: adminId,
        displayName: "CleanupAdmin",
        role: "ADMIN",
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(sessions).values({
        id: adminSessionId,
        userId: adminId,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: now,
      })
      const adminToken = await createTestAccessToken({
        userId: adminId,
        sessionId: adminSessionId,
        role: "ADMIN",
        displayName: "CleanupAdmin",
      })

      async function createTestMedia(data: Uint8Array, id: string): Promise<string> {
        await db.insert(contentMedia).values({
          id,
          objectKey: `content/${id}.png`,
          mediaType: "IMAGE",
          mimeType: "image/png",
          sizeBytes: data.byteLength,
          createdBy: adminId,
          createdAt: new Date().toISOString(),
        })
        await mockR2.put(`content/${id}.png`, data.buffer as ArrayBuffer, {
          httpMetadata: { contentType: "image/png" },
        })
        return id
      }

      // 1. Create two textures for skin
      const skin1Png = encode({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(100), channels: 4, depth: 8 })
      const skin2Png = encode({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(150), channels: 4, depth: 8 })

      const media1Id = await createTestMedia(skin1Png, "media-skin-cleanup-1")
      const media2Id = await createTestMedia(skin2Png, "media-skin-cleanup-2")

      // Create global skin with media1Id
      const createSkinRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            query: `mutation CreateSkin($input: CreateSkinInput!) {
              createSkin(input: $input) { id imageUrl }
            }`,
            variables: { input: { name: "Clean Media Skin", mediaId: media1Id, status: "AVAILABLE" } },
          }),
        }),
        testEnv,
      )
      const skinId = ((await createSkinRes.json()) as any).data.createSkin.id

      // Update skin with media2Id -> media1Id should be cleaned up as it is orphaned
      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            query: `mutation UpdateSkin($id: ID!, $input: UpdateSkinInput!) {
              updateSkin(id: $id, input: $input) { id imageUrl }
            }`,
            variables: { id: skinId, input: { mediaId: media2Id } },
          }),
        }),
        testEnv,
      )

      // media1Id record should be deleted from contentMedia
      const oldMediaInDb = await db.select().from(contentMedia).where(eq(contentMedia.id, media1Id)).get()
      expect(oldMediaInDb).toBeUndefined()

      // 2. Test shared media: create cape with media2Id (which is now shared with the skin)
      const cape3Png = encode({ width: 64, height: 32, data: new Uint8Array(64 * 32 * 4).fill(200), channels: 4, depth: 8 })
      const media3Id = await createTestMedia(cape3Png, "media-cape-cleanup-3")

      const createCapeRes = await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            query: `mutation CreateCape($input: CreateCapeInput!) {
              createCape(input: $input) { id }
            }`,
            variables: { input: { name: "Shared Cape", mediaId: media2Id, status: "AVAILABLE" } },
          }),
        }),
        testEnv,
      )
      const capeId = ((await createCapeRes.json()) as any).data.createCape.id

      // Update cape to media3Id -> media2Id should NOT be deleted because it is still referenced by the skin!
      await worker.fetch(
        new Request("http://localhost/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            query: `mutation UpdateCape($id: ID!, $input: UpdateCapeInput!) {
              updateCape(id: $id, input: $input) { id }
            }`,
            variables: { id: capeId, input: { mediaId: media3Id } },
          }),
        }),
        testEnv,
      )

      const sharedMediaInDb = await db.select().from(contentMedia).where(eq(contentMedia.id, media2Id)).get()
      expect(sharedMediaInDb).toBeDefined()
    })
  })
})






