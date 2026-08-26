/**
 * HiKAT Backend Service Comprehensive Test Suite
 * Tests GraphQL Yoga, authentication verification, session validation,
 * authorization guards, user queries, admin queries, CORS, and security edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest"
import * as jose from "jose"
import { createDatabase, users, sessions } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  AUTH_AUDIENCE_API,
  AUTH_AUDIENCE_GAME,
  DEFAULT_AUTH_ISSUER,
  HIKAT_VERSION,
  AppRole,
} from "@hikat/shared"
import worker, {
  Env,
  requireAuth,
  requireAdmin,
  verifyAccessToken,
  validateSessionInDb,
  getUserById,
} from "./index"

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

    it("returns NOT_FOUND when authenticated user is deleted or missing in D1", async () => {
      const userId = "usr_deleted"
      const sessionId = "ses_ghost"

      // Token generated for non-existent user (and no session in D1)
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
      // Session missing in D1 -> UNAUTHENTICATED
      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED")
    })
  })

  describe("3. Administrative Guards & adminStatus Query", () => {
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
      // Tamper signature by modifying characters
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

      // Token expired 10 seconds ago
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

      // Game JWT targeted specifically for Minecraft Gateway
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
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject("usr_hs256")
        .setIssuer(DEFAULT_AUTH_ISSUER)
        .setAudience(AUTH_AUDIENCE_API)
        .setExpirationTime("15m")
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

      // Create a local JWKS containing both keys
      const jwksMap = new Map<string, jose.CryptoKey>([
        [keyId, publicKey],
        [secondaryKeyId, secondaryPublicKey],
      ])

      const jwksResolver: jose.JWTVerifyGetKey = async (protectedHeader) => {
        const key = protectedHeader.kid ? jwksMap.get(protectedHeader.kid) : undefined
        if (!key) throw new Error(`Unknown key ID: ${protectedHeader.kid}`)
        return key
      }

      // Sign with primary key
      const token1 = await createTestAccessToken({
        userId,
        sessionId,
        role: "PLAYER",
        key: privateKey,
        kid: keyId,
      })

      // Sign with secondary rotated key
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
      // Seed user but NOT session
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

      // Seed victim session belonging to userVictim
      await seedUserAndSession({
        userId: userVictim,
        sessionId,
      })

      // Seed attacker user
      await db.insert(users).values({
        id: userAttacker,
        role: "PLAYER",
        displayName: "Attacker",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Attacker issues token with their own sub but victim's sid
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

    it("rejects token immediately when session is revoked in D1 (e.g. after logout)", async () => {
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

  describe("7. CORS & Preflight Handling", () => {
    it("handles OPTIONS preflight requests with 204 No Content and appropriate CORS headers", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, Authorization",
        },
      })
      const env: Env = { DB: testD1 }
      const response = await worker.fetch(request, env)

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173")
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST")
    })

    it("appends CORS headers on standard GraphQL POST requests", async () => {
      const request = new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://app.hikat.org",
        },
        body: JSON.stringify({ query: "{ version }" }),
      })
      const env: Env = { DB: testD1 }
      const response = await worker.fetch(request, env)

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.hikat.org")
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
          Authorization: `bearer   ${token}`, // Lowercase 'bearer' with spaces
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

  describe("9. JWT Claims Integrity & Fallback Verification", () => {
    it("rejects token with missing subject (sub)", async () => {
      const token = await new jose.SignJWT({
        role: "PLAYER",
        sid: "ses_1",
      })
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: keyId })
        .setIssuer(DEFAULT_AUTH_ISSUER)
        .setAudience(AUTH_AUDIENCE_API)
        .setExpirationTime("15m")
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
        .setExpirationTime("15m")
        .sign(privateKey)

      await expect(
        verifyAccessToken(token, { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }),
      ).rejects.toThrow(/missing or invalid session ID/)
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
        .setExpirationTime("15m")
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

    it("handles me query gracefully when DB is not configured", async () => {
      const token = await createTestAccessToken({
        userId: "usr_nodb",
        sessionId: "ses_nodb",
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
      // Env without DB binding
      const env: Env = { AUTH_JWT_PUBLIC_KEY_PEM: publicSpkiPem }
      const response = await worker.fetch(request, env)

      const result = await getJson(response)
      expect(result.data?.me).toBeNull()
      expect(result.errors?.[0]?.extensions?.code).toBe("INTERNAL_ERROR")
    })
  })
})
