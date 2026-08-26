/**
 * HiKAT Backend Service Comprehensive Test Suite
 * Tests GraphQL Yoga, authentication verification, session validation,
 * authorization guards, user queries, admin queries, CORS, and security edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest"

import * as jose from "jose"

import { eq } from "drizzle-orm"

import {
  createDatabase,
  users,
  sessions,
  news,
  contentMedia,
  contentMediaUploadTokens,
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

        const tokenHash = await (
          await import("./services/mediaService")
        ).sha256Hex(rawToken)

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
})
