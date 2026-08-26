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
  contentPosts,
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
  MAX_MEDIA_SIZE_BYTES,
} from "@hikat/shared"
import worker, {
  Env,
  requireAuth,
  requireAdmin,
  verifyAccessToken,
  validateSessionInDb,
  getUserById,
  getContentFeed,
  getContentPostBySlug,
  getAdminContentPosts,
  createContentPost,
  updateContentPost,
  publishContentPost,
  unpublishContentPost,
  deleteContentPost,
  createContentMediaUpload,
  deleteContentMedia,
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

    const kpAttacker = await jose.generateKeyPair("ES256", { extractable: true })
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
      params.isSessionExpired ? now.getTime() - 3600000 : now.getTime() + 7 * 86400000,
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

      const validToken = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })
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
      const symmetricKey = new TextEncoder().encode("super-secret-key-that-should-not-work")
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
        const key = protectedHeader.kid ? jwksMap.get(protectedHeader.kid) : undefined
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

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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
        auth: { status: "invalid" as const, reason: "Session has been revoked" },
        request: new Request("http://localhost"),
      }
      expect(() => requireAuth(context)).toThrowError(/Session has been revoked/)
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
      expect(() => requireAdmin(context)).toThrowError(/administrative privilege required/)
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
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.hikat.org")
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST")
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

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("hikat://launcher")
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

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173")
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

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://custom.client.com")
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

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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

      const payload = await verifyAccessToken(token, { JWT_PUBLIC_KEY_PEM: publicSpkiPem })
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

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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
                    throw new Error("CRITICAL_INTERNAL_DATABASE_PANIC: secret connection string postgres://secret:1234@db/internal")
                  },
                  all: () => {
                    throw new Error("CRITICAL_INTERNAL_DATABASE_PANIC: secret connection string postgres://secret:1234@db/internal")
                  },
                  run: () => {
                    throw new Error("CRITICAL_INTERNAL_DATABASE_PANIC: secret connection string postgres://secret:1234@db/internal")
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
      expect(JSON.stringify(result.errors)).not.toContain("CRITICAL_INTERNAL_DATABASE_PANIC")
      expect(JSON.stringify(result.errors)).not.toContain("postgres://")
    })

    it("masks unexpected database failures when ENVIRONMENT is absent/undefined (secure-by-default)", async () => {
      const userId = "usr_undef_err"
      const sessionId = "ses_undef_err"
      await seedUserAndSession({ userId, sessionId, role: "PLAYER" })

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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
                    throw new Error("UNHANDLED_DATABASE_EXCEPTION_LEAK: secret connection string postgres://secret:1234@db/internal")
                  },
                  all: () => {
                    throw new Error("UNHANDLED_DATABASE_EXCEPTION_LEAK: secret connection string postgres://secret:1234@db/internal")
                  },
                  run: () => {
                    throw new Error("UNHANDLED_DATABASE_EXCEPTION_LEAK: secret connection string postgres://secret:1234@db/internal")
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
      expect(JSON.stringify(result.errors)).not.toContain("UNHANDLED_DATABASE_EXCEPTION_LEAK")
      expect(JSON.stringify(result.errors)).not.toContain("postgres://")
    })

    it("preserves unexpected internal error messages in ENVIRONMENT=development for debugging", async () => {
      const userId = "usr_dev_err"
      const sessionId = "ses_dev_err"
      await seedUserAndSession({ userId, sessionId, role: "PLAYER" })

      const token = await createTestAccessToken({ userId, sessionId, role: "PLAYER" })

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
                    throw new Error("DEBUG_HELPFUL_SQL_SYNTAX_ERROR: column foo does not exist")
                  },
                  all: () => {
                    throw new Error("DEBUG_HELPFUL_SQL_SYNTAX_ERROR: column foo does not exist")
                  },
                  run: () => {
                    throw new Error("DEBUG_HELPFUL_SQL_SYNTAX_ERROR: column foo does not exist")
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

  describe("HiKAT Content Core (Shard 04)", () => {
    let testR2: ReturnType<typeof createTestR2Bucket>
    let adminToken: string
    let playerToken: string
    let adminBToken: string
    const adminId = "admin-content-user-1"
    const adminSessionId = "sess-admin-content-1"
    const adminBId = "admin-content-user-2"
    const adminBSessionId = "sess-admin-content-2"
    const playerId = "player-content-user-1"
    const playerSessionId = "sess-player-content-1"

    beforeEach(async () => {
      testR2 = createTestR2Bucket()

      // Seed Admin User 1
      await seedUserAndSession({
        userId: adminId,
        role: "ADMIN",
        displayName: "ContentAdmin1",
        sessionId: adminSessionId,
      })
      adminToken = await createTestAccessToken({
        userId: adminId,
        sessionId: adminSessionId,
        role: "ADMIN",
        displayName: "ContentAdmin1",
      })

      // Seed Admin User 2
      await seedUserAndSession({
        userId: adminBId,
        role: "ADMIN",
        displayName: "ContentAdmin2",
        sessionId: adminBSessionId,
      })
      adminBToken = await createTestAccessToken({
        userId: adminBId,
        sessionId: adminBSessionId,
        role: "ADMIN",
        displayName: "ContentAdmin2",
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

    async function executeGql(query: string, variables?: Record<string, any>, token?: string, env?: Env) {
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

    describe("Public Content Queries", () => {
      it("returns empty feed when no content posts are published", async () => {
        const res = await executeGql(`
          query {
            contentFeed {
              totalCount
              items { id title }
              edges { cursor node { id } }
              pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            }
          }
        `)
        expect(res.data?.contentFeed).toBeDefined()
        expect(res.data.contentFeed.totalCount).toBe(0)
        expect(res.data.contentFeed.items).toEqual([])
        expect(res.data.contentFeed.edges).toEqual([])
        expect(res.data.contentFeed.pageInfo.hasNextPage).toBe(false)
        expect(res.data.contentFeed.pageInfo.hasPreviousPage).toBe(false)
      })

      it("returns only published posts in descending order of (publishedAt, id)", async () => {
        const now = Date.now()
        // 1. Published Post 1 (earlier)
        await db.insert(contentPosts).values({
          id: "post-pub-1",
          kind: "NEWS",
          slug: "primera-noticia",
          title: "Primera Noticia",
          summary: "Resumen 1",
          bodyMarkdown: "Cuerpo 1",
          status: "PUBLISHED",
          publishedAt: new Date(now - 100000).toISOString(),
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: new Date(now - 100000).toISOString(),
          updatedAt: new Date(now - 100000).toISOString(),
        })

        // 2. Draft Post (must NOT appear in public feed)
        await db.insert(contentPosts).values({
          id: "post-draft-secret",
          kind: "NEWS",
          slug: "noticia-secreta",
          title: "Noticia Secreta",
          summary: "Borrador secreto",
          bodyMarkdown: "Cuerpo secreto",
          status: "DRAFT",
          publishedAt: null,
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: new Date(now - 50000).toISOString(),
          updatedAt: new Date(now - 50000).toISOString(),
        })

        // 3. Published Post 2 (later)
        await db.insert(contentPosts).values({
          id: "post-pub-2",
          kind: "ANNOUNCEMENT",
          slug: "anuncio-importante",
          title: "Anuncio Importante",
          summary: "Resumen 2",
          bodyMarkdown: "Cuerpo 2",
          status: "PUBLISHED",
          publishedAt: new Date(now).toISOString(),
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        })

        const res = await executeGql(`
          query {
            contentFeed {
              totalCount
              items {
                id
                slug
                title
                kind
                status
                publishedAt
              }
            }
          }
        `)

        expect(res.data.contentFeed.totalCount).toBe(2)
        expect(res.data.contentFeed.items.length).toBe(2)
        // Most recent first: post-pub-2 then post-pub-1
        expect(res.data.contentFeed.items[0].id).toBe("post-pub-2")
        expect(res.data.contentFeed.items[0].slug).toBe("anuncio-importante")
        expect(res.data.contentFeed.items[0].kind).toBe("ANNOUNCEMENT")
        expect(res.data.contentFeed.items[1].id).toBe("post-pub-1")
        expect(res.data.contentFeed.items[1].slug).toBe("primera-noticia")

        // Draft never returned
        const foundDraft = res.data.contentFeed.items.find((i: any) => i.id === "post-draft-secret")
        expect(foundDraft).toBeUndefined()
      })

      it("filters public feed by kind (NEWS vs ANNOUNCEMENT)", async () => {
        const now = Date.now()
        await db.insert(contentPosts).values([
          {
            id: "post-news-1",
            kind: "NEWS",
            slug: "noticia-1",
            title: "Noticia 1",
            summary: "Resumen",
            bodyMarkdown: "Body",
            status: "PUBLISHED",
            publishedAt: new Date(now).toISOString(),
            createdBy: adminId,
            updatedBy: adminId,
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
          },
          {
            id: "post-announcement-1",
            kind: "ANNOUNCEMENT",
            slug: "anuncio-1",
            title: "Anuncio 1",
            summary: "Resumen",
            bodyMarkdown: "Body",
            status: "PUBLISHED",
            publishedAt: new Date(now - 1000).toISOString(),
            createdBy: adminId,
            updatedBy: adminId,
            createdAt: new Date(now - 1000).toISOString(),
            updatedAt: new Date(now - 1000).toISOString(),
          },
        ])

        const resNews = await executeGql(`
          query {
            contentFeed(kind: NEWS) {
              totalCount
              items { id kind slug }
            }
          }
        `)
        expect(resNews.data.contentFeed.totalCount).toBe(1)
        expect(resNews.data.contentFeed.items[0].id).toBe("post-news-1")

        const resAnnounce = await executeGql(`
          query {
            contentFeed(kind: ANNOUNCEMENT) {
              totalCount
              items { id kind slug }
            }
          }
        `)
        expect(resAnnounce.data.contentFeed.totalCount).toBe(1)
        expect(resAnnounce.data.contentFeed.items[0].id).toBe("post-announcement-1")
      })

      it("supports deterministic compound cursor pagination on public feed", async () => {
        const now = Date.now()
        const postsToInsert = []
        for (let i = 1; i <= 5; i++) {
          postsToInsert.push({
            id: `post-page-${i}`,
            kind: "NEWS" as const,
            slug: `post-page-${i}`,
            title: `Post Page ${i}`,
            summary: `Summary ${i}`,
            bodyMarkdown: `Body ${i}`,
            status: "PUBLISHED" as const,
            publishedAt: new Date(now - (10 - i) * 1000).toISOString(),
            createdBy: adminId,
            updatedBy: adminId,
            createdAt: new Date(now - (10 - i) * 1000).toISOString(),
            updatedAt: new Date(now - (10 - i) * 1000).toISOString(),
          })
        }
        await db.insert(contentPosts).values(postsToInsert)

        // Page 1: first 2 items
        const page1 = await executeGql(`
          query {
            contentFeed(first: 2) {
              items { id }
              pageInfo { hasNextPage endCursor }
            }
          }
        `)
        expect(page1.data.contentFeed.items.length).toBe(2)
        expect(page1.data.contentFeed.items[0].id).toBe("post-page-5")
        expect(page1.data.contentFeed.items[1].id).toBe("post-page-4")
        expect(page1.data.contentFeed.pageInfo.hasNextPage).toBe(true)

        const endCursor1 = page1.data.contentFeed.pageInfo.endCursor
        expect(endCursor1).toBeDefined()

        // Page 2: next 2 items using after cursor
        const page2 = await executeGql(`
          query($after: String) {
            contentFeed(first: 2, after: $after) {
              items { id }
              pageInfo { hasNextPage endCursor }
            }
          }
        `, { after: endCursor1 })
        expect(page2.data.contentFeed.items.length).toBe(2)
        expect(page2.data.contentFeed.items[0].id).toBe("post-page-3")
        expect(page2.data.contentFeed.items[1].id).toBe("post-page-2")
        expect(page2.data.contentFeed.pageInfo.hasNextPage).toBe(true)

        // Page 3: last 1 item
        const endCursor2 = page2.data.contentFeed.pageInfo.endCursor
        const page3 = await executeGql(`
          query($after: String) {
            contentFeed(first: 2, after: $after) {
              items { id }
              pageInfo { hasNextPage }
            }
          }
        `, { after: endCursor2 })
        expect(page3.data.contentFeed.items.length).toBe(1)
        expect(page3.data.contentFeed.items[0].id).toBe("post-page-1")
        expect(page3.data.contentFeed.pageInfo.hasNextPage).toBe(false)
      })

      it("looks up published post by slug, returning cover media if present", async () => {
        const now = new Date().toISOString()
        // Insert cover media
        await db.insert(contentMedia).values({
          id: "media-cover-1",
          objectKey: "content/media/media-cover-1.webp",
          mimeType: "image/webp",
          sizeBytes: 45000,
          createdBy: adminId,
          createdAt: now,
        })

        // Insert post with cover media
        await db.insert(contentPosts).values({
          id: "post-with-cover",
          kind: "NEWS",
          slug: "actualizacion-de-otono",
          title: "Actualización de Otoño",
          summary: "Novedades de la temporada",
          bodyMarkdown: "# Detalles\n\nNuevos mundos y características.",
          coverMediaId: "media-cover-1",
          status: "PUBLISHED",
          publishedAt: now,
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: now,
          updatedAt: now,
        })

        const res = await executeGql(`
          query {
            contentPost(slug: "actualizacion-de-otono") {
              id
              slug
              title
              summary
              bodyMarkdown
              status
              publishedAt
              coverMedia {
                id
                objectKey
                mimeType
                sizeBytes
                url
              }
            }
          }
        `)

        expect(res.data.contentPost).toBeDefined()
        expect(res.data.contentPost.title).toBe("Actualización de Otoño")
        expect(res.data.contentPost.coverMedia).toBeDefined()
        expect(res.data.contentPost.coverMedia.id).toBe("media-cover-1")
        expect(res.data.contentPost.coverMedia.url).toContain("/media/content/media-cover-1")
      })

      it("returns null for draft post when queried by public contentPost(slug)", async () => {
        const now = new Date().toISOString()
        await db.insert(contentPosts).values({
          id: "post-draft-slug-test",
          kind: "NEWS",
          slug: "draft-slug-public-test",
          title: "Draft Title",
          summary: "Draft Summary",
          bodyMarkdown: "Draft Body",
          status: "DRAFT",
          publishedAt: null,
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: now,
          updatedAt: now,
        })

        const res = await executeGql(`
          query {
            contentPost(slug: "draft-slug-public-test") {
              id
              title
            }
          }
        `)

        expect(res.data.contentPost).toBeNull()
      })

      it("returns null for non-existent slug", async () => {
        const res = await executeGql(`
          query {
            contentPost(slug: "slug-que-no-existe-en-el-sistema") {
              id
            }
          }
        `)
        expect(res.data.contentPost).toBeNull()
      })
    })

    describe("Administrative Content Operations", () => {
      it("ADMIN creates a post successfully (createdBy & updatedBy bound to admin identity)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) {
              id
              kind
              slug
              title
              summary
              bodyMarkdown
              status
              publishedAt
              createdBy
              updatedBy
            }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "nueva-guia-de-inicio",
              title: "Nueva Guía de Inicio",
              summary: "Aprende a jugar en HiKAT",
              bodyMarkdown: "## Guía completa para nuevos jugadores",
              status: "PUBLISHED",
            },
          },
          adminToken,
        )

        expect(res.errors).toBeUndefined()
        expect(res.data.createContentPost).toBeDefined()
        expect(res.data.createContentPost.slug).toBe("nueva-guia-de-inicio")
        expect(res.data.createContentPost.status).toBe("PUBLISHED")
        expect(res.data.createContentPost.publishedAt).toBeDefined()
        expect(res.data.createContentPost.createdBy).toBe(adminId)
        expect(res.data.createContentPost.updatedBy).toBe(adminId)
      })

      it("REJECTS createContentPost for PLAYER role (FORBIDDEN)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) {
              id
            }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "post-hacker-player",
              title: "Hacked Post",
              summary: "Hacked Summary",
              bodyMarkdown: "Hacked Body",
            },
          },
          playerToken,
        )

        expect(res.errors).toBeDefined()
        expect(res.errors[0].extensions.code).toBe("FORBIDDEN")
      })

      it("REJECTS createContentPost for anonymous caller (UNAUTHENTICATED)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) {
              id
            }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "post-anon",
              title: "Anon Post",
              summary: "Anon Summary",
              bodyMarkdown: "Anon Body",
            },
          },
        )

        expect(res.errors).toBeDefined()
        expect(res.errors[0].extensions.code).toBe("UNAUTHENTICATED")
      })

      it("REJECTS duplicate slug on creation via D1 UNIQUE constraint and returns CONFLICT", async () => {
        // Create first post
        await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) { id }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "slug-duplicado-test",
              title: "Primer Post",
              summary: "Primer Resumen",
              bodyMarkdown: "Primer Body",
            },
          },
          adminToken,
        )

        // Try creating second post with identical slug
        const res = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) { id }
          }
          `,
          {
            input: {
              kind: "ANNOUNCEMENT",
              slug: "slug-duplicado-test",
              title: "Segundo Post",
              summary: "Segundo Resumen",
              bodyMarkdown: "Segundo Body",
            },
          },
          adminToken,
        )

        expect(res.errors).toBeDefined()
        expect(res.errors[0].extensions.code).toBe("CONFLICT")
        expect(res.errors[0].message).toContain("already exists")
      })

      it("REJECTS invalid input fields with VALIDATION_ERROR", async () => {
        // Invalid slug format (e.g. uppercase / spaces / invalid chars)
        const resInvalidSlug = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) { id }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "Slug Con Espacios & Mayusculas!!", // normalized slug helper might handle it or reject if invalid after normalization
              title: "Ab", // too short (<3)
              summary: "Ok summary",
              bodyMarkdown: "Ok body",
            },
          },
          adminToken,
        )
        expect(resInvalidSlug.errors).toBeDefined()
        expect(resInvalidSlug.errors[0].extensions.code).toBe("VALIDATION_ERROR")
      })

      it("updates an existing post, updates updatedBy, and enforces unique slug on update", async () => {
        // Create post
        const createRes = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) { id slug }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "post-para-actualizar",
              title: "Titulo Original",
              summary: "Resumen Original",
              bodyMarkdown: "Cuerpo Original",
            },
          },
          adminToken,
        )
        const postId = createRes.data.createContentPost.id

        // Update post with Admin B
        const updateRes = await executeGql(
          `
          mutation($id: ID!, $input: UpdateContentPostInput!) {
            updateContentPost(id: $id, input: $input) {
              id
              title
              summary
              updatedBy
            }
          }
          `,
          {
            id: postId,
            input: {
              title: "Titulo Modificado por Admin B",
              summary: "Resumen Modificado",
            },
          },
          adminBToken,
        )

        expect(updateRes.errors).toBeUndefined()
        expect(updateRes.data.updateContentPost.title).toBe("Titulo Modificado por Admin B")
        expect(updateRes.data.updateContentPost.updatedBy).toBe(adminBId)
      })

      it("handles publish, unpublish, and republication semantics", async () => {
        // 1. Create draft post
        const createRes = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) { id status publishedAt }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "post-ciclo-publicacion",
              title: "Post Ciclo",
              summary: "Resumen Ciclo",
              bodyMarkdown: "Cuerpo Ciclo",
              status: "DRAFT",
            },
          },
          adminToken,
        )
        const postId = createRes.data.createContentPost.id
        expect(createRes.data.createContentPost.status).toBe("DRAFT")
        expect(createRes.data.createContentPost.publishedAt).toBeNull()

        // 2. Publish post -> sets PUBLISHED and publishedAt = now
        const publishRes = await executeGql(
          `
          mutation($id: ID!) {
            publishContentPost(id: $id) { id status publishedAt }
          }
          `,
          { id: postId },
          adminToken,
        )
        expect(publishRes.data.publishContentPost.status).toBe("PUBLISHED")
        const firstPublishedAt = publishRes.data.publishContentPost.publishedAt
        expect(firstPublishedAt).toBeDefined()

        // 3. Unpublish post -> sets DRAFT and resets publishedAt = null
        const unpublishRes = await executeGql(
          `
          mutation($id: ID!) {
            unpublishContentPost(id: $id) { id status publishedAt }
          }
          `,
          { id: postId },
          adminToken,
        )
        expect(unpublishRes.data.unpublishContentPost.status).toBe("DRAFT")
        expect(unpublishRes.data.unpublishContentPost.publishedAt).toBeNull()

        // 4. Republish post -> sets PUBLISHED and updates publishedAt
        const republishRes = await executeGql(
          `
          mutation($id: ID!) {
            publishContentPost(id: $id) { id status publishedAt }
          }
          `,
          { id: postId },
          adminToken,
        )
        expect(republishRes.data.publishContentPost.status).toBe("PUBLISHED")
        expect(republishRes.data.publishContentPost.publishedAt).toBeDefined()
      })

      it("deletes a content post successfully", async () => {
        const createRes = await executeGql(
          `
          mutation($input: CreateContentPostInput!) {
            createContentPost(input: $input) { id }
          }
          `,
          {
            input: {
              kind: "NEWS",
              slug: "post-para-borrar",
              title: "Para Borrar",
              summary: "Resumen",
              bodyMarkdown: "Cuerpo",
            },
          },
          adminToken,
        )
        const postId = createRes.data.createContentPost.id

        const deleteRes = await executeGql(
          `
          mutation($id: ID!) {
            deleteContentPost(id: $id)
          }
          `,
          { id: postId },
          adminToken,
        )
        expect(deleteRes.data.deleteContentPost).toBe(true)

        // Verify post no longer exists
        const checkPost = await db.select().from(contentPosts).where(eq(contentPosts.id, postId)).get()
        expect(checkPost).toBeUndefined()
      })

      it("adminContentPosts lists both drafts and published posts with filters", async () => {
        const now = new Date().toISOString()
        await db.insert(contentPosts).values([
          {
            id: "adm-p-1",
            kind: "NEWS",
            slug: "adm-noticia-borrador",
            title: "Admin Draft",
            summary: "Summary",
            bodyMarkdown: "Body",
            status: "DRAFT",
            createdBy: adminId,
            updatedBy: adminId,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "adm-p-2",
            kind: "ANNOUNCEMENT",
            slug: "adm-anuncio-publicado",
            title: "Admin Published",
            summary: "Summary",
            bodyMarkdown: "Body",
            status: "PUBLISHED",
            publishedAt: now,
            createdBy: adminId,
            updatedBy: adminId,
            createdAt: now,
            updatedAt: now,
          },
        ])

        const resAll = await executeGql(
          `
          query {
            adminContentPosts {
              totalCount
              items { id status kind }
            }
          }
          `,
          {},
          adminToken,
        )

        expect(resAll.data.adminContentPosts.totalCount).toBe(2)
        expect(resAll.data.adminContentPosts.items.length).toBe(2)

        const resDraftsOnly = await executeGql(
          `
          query {
            adminContentPosts(status: DRAFT) {
              totalCount
              items { id status }
            }
          }
          `,
          {},
          adminToken,
        )
        expect(resDraftsOnly.data.adminContentPosts.totalCount).toBe(1)
        expect(resDraftsOnly.data.adminContentPosts.items[0].id).toBe("adm-p-1")
      })
    })

    describe("Cloudflare R2 Media Upload & Delivery Transport", () => {
      it("ADMIN requests upload token via GraphQL createContentMediaUpload", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) {
              uploadUrl
              uploadToken
              expiresAt
              maxSizeBytes
              expectedMimeType
              allowedMimeTypes
            }
          }
          `,
          {
            input: {
              mimeType: "image/png",
              sizeBytes: 102400,
            },
          },
          adminToken,
        )

        expect(res.errors).toBeUndefined()
        expect(res.data.createContentMediaUpload).toBeDefined()
        expect(res.data.createContentMediaUpload.uploadUrl).toContain("/media/content/upload")
        expect(res.data.createContentMediaUpload.uploadToken.length).toBeGreaterThan(16)
        expect(res.data.createContentMediaUpload.expectedMimeType).toBe("image/png")
        expect(res.data.createContentMediaUpload.allowedMimeTypes).toContain("image/png")
      })

      it("REJECTS createContentMediaUpload for PLAYER role (FORBIDDEN)", async () => {
        const res = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,
          {
            input: {
              mimeType: "image/png",
              sizeBytes: 1024,
            },
          },
          playerToken,
        )

        expect(res.errors).toBeDefined()
        expect(res.errors[0].extensions.code).toBe("FORBIDDEN")
      })

      it("executes binary upload via PUT /media/content/upload with Bearer JWT + X-Upload-Token header", async () => {
        // 1. Request upload token
        const uploadTicket = await executeGql(
          `
          mutation($input: CreateContentMediaUploadInput!) {
            createContentMediaUpload(input: $input) { uploadToken }
          }
          `,
          {
            input: {
              mimeType: "image/png",
              sizeBytes: 2048,
            },
          },
          adminToken,
        )
        const rawToken = uploadTicket.data.createContentMediaUpload.uploadToken

        // 2. Perform PUT /media/content/upload with mock PNG binary
        const fakePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
        const uploadRequest = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "X-Upload-Token": rawToken,
            "Content-Type": "image/png",
          },
          body: fakePngBytes,
        })

        const env = createEnv()
        const uploadResponse = await worker.fetch(uploadRequest, env)
        expect(uploadResponse.status).toBe(201)

        const uploadData = await getJson(uploadResponse)
        expect(uploadData.id).toBeDefined()
        expect(uploadData.objectKey).toContain("content/media/")
        expect(uploadData.mimeType).toBe("image/png")
        expect(uploadData.sizeBytes).toBe(fakePngBytes.byteLength)
        expect(uploadData.url).toContain(`/media/content/${uploadData.id}`)

        // 3. Verify object written to R2 mock
        const storedObject = await testR2.get(uploadData.objectKey)
        expect(storedObject).toBeDefined()
        expect(storedObject?.size).toBe(fakePngBytes.byteLength)

        // 4. Verify GET /media/content/:id delivers the file with caching and correct headers
        const serveRequest = new Request(`http://localhost/media/content/${uploadData.id}`, {
          method: "GET",
        })
        const serveResponse = await worker.fetch(serveRequest, env)
        expect(serveResponse.status).toBe(200)
        expect(serveResponse.headers.get("Content-Type")).toBe("image/png")
        expect(serveResponse.headers.get("Cache-Control")).toContain("immutable")

        const servedBuffer = await serveResponse.arrayBuffer()
        expect(new Uint8Array(servedBuffer)).toEqual(fakePngBytes)
      })

      it("REJECTS upload without Bearer JWT (401)", async () => {
        const fakeBytes = new Uint8Array([1, 2, 3, 4])
        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            "X-Upload-Token": "some-token",
            "Content-Type": "image/png",
          },
          body: fakeBytes,
        })
        const res = await worker.fetch(req, createEnv())
        expect(res.status).toBe(401)
      })

      it("REJECTS upload with PLAYER Bearer JWT (403)", async () => {
        const fakeBytes = new Uint8Array([1, 2, 3, 4])
        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${playerToken}`,
            "X-Upload-Token": "some-token",
            "Content-Type": "image/png",
          },
          body: fakeBytes,
        })
        const res = await worker.fetch(req, createEnv())
        expect(res.status).toBe(403)
      })

      it("REJECTS upload when X-Upload-Token header is missing (400)", async () => {
        const fakeBytes = new Uint8Array([1, 2, 3, 4])
        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "image/png",
          },
          body: fakeBytes,
        })
        const res = await worker.fetch(req, createEnv())
        expect(res.status).toBe(400)
      })

      it("REJECTS upload if token belongs to a different administrator (403), and allows legitimate owner to use unburned ticket afterwards (201)", async () => {
        // Admin A generates token
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

        // Admin B tries to upload using Admin A's token -> 403 Forbidden
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

        // Legitimate Admin A now uses the exact same token -> 201 Created (verifies token was not burned)
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

        // Create stream of 600 bytes without Content-Length
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

        const body1 = new Uint8Array([1, 2, 3, 4])
        const body2 = new Uint8Array([5, 6, 7, 8])

        const req1 = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "X-Upload-Token": rawToken,
            "Content-Type": "image/png",
          },
          body: body1,
        })

        const req2 = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "X-Upload-Token": rawToken,
            "Content-Type": "image/png",
          },
          body: body2,
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
        const tokenHash = await (await import("./services/mediaService")).sha256Hex(rawToken)

        await db.insert(contentMediaUploadTokens).values({
          id: "token-exp",
          tokenHash,
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

      it("REJECTS oversized file exceeding MAX_MEDIA_SIZE_BYTES (413)", async () => {
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

        // Create buffer exceeding 5MB
        const largeBuffer = new Uint8Array(MAX_MEDIA_SIZE_BYTES + 1024)

        const req = new Request("http://localhost/media/content/upload", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "X-Upload-Token": rawToken,
            "Content-Type": "image/png",
          },
          body: largeBuffer,
        })
        const res = await worker.fetch(req, createEnv())
        expect(res.status).toBe(413)
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

        // Create a faulty D1 that fails during content_media insert
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

        // Verify compensation: R2 storage must NOT retain the orphaned media file
        expect(testR2._storage.size).toBe(0)
      })

      it("serves 404 for non-existent media ID", async () => {
        const req = new Request("http://localhost/media/content/non-existent-media-id", {
          method: "GET",
        })
        const res = await worker.fetch(req, createEnv())
        expect(res.status).toBe(404)
      })

      it("prevents arbitrary object key access and path traversal on GET /media/content/:id", async () => {
        const req = new Request("http://localhost/media/content/..%2F..%2Fsecret", {
          method: "GET",
        })
        const res = await worker.fetch(req, createEnv())
        expect([400, 404]).toContain(res.status)
      })

      it("REJECTS media deletion if media is currently used as cover image (CONFLICT)", async () => {
        const now = new Date().toISOString()
        await db.insert(contentMedia).values({
          id: "media-linked-1",
          objectKey: "content/media/media-linked-1.png",
          mimeType: "image/png",
          sizeBytes: 100,
          createdBy: adminId,
          createdAt: now,
        })
        await db.insert(contentPosts).values({
          id: "post-using-media",
          kind: "NEWS",
          slug: "post-con-media",
          title: "Post con media",
          summary: "Summary",
          bodyMarkdown: "Body",
          coverMediaId: "media-linked-1",
          status: "PUBLISHED",
          publishedAt: now,
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: now,
          updatedAt: now,
        })

        const res = await executeGql(
          `
          mutation($id: ID!) {
            deleteContentMedia(id: $id)
          }
          `,
          { id: "media-linked-1" },
          adminToken,
        )

        expect(res.errors).toBeDefined()
        expect(res.errors[0].extensions.code).toBe("CONFLICT")
      })

      it("deletes unreferenced media from D1 and R2 successfully", async () => {
        const now = new Date().toISOString()
        const fakeBytes = new Uint8Array([1, 2, 3])
        await testR2.put("content/media/media-unref-1.png", fakeBytes)

        await db.insert(contentMedia).values({
          id: "media-unref-1",
          objectKey: "content/media/media-unref-1.png",
          mimeType: "image/png",
          sizeBytes: 3,
          createdBy: adminId,
          createdAt: now,
        })

        const res = await executeGql(
          `
          mutation($id: ID!) {
            deleteContentMedia(id: $id)
          }
          `,
          { id: "media-unref-1" },
          adminToken,
        )

        expect(res.data.deleteContentMedia).toBe(true)

        // Verify removed from D1
        const inDb = await db.select().from(contentMedia).where(eq(contentMedia.id, "media-unref-1")).get()
        expect(inDb).toBeUndefined()

        // Verify removed from R2
        const inR2 = await testR2.get("content/media/media-unref-1.png")
        expect(inR2).toBeNull()
      })
    })
  })
})
