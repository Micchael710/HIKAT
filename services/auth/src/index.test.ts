/**
 * HiKAT Authentication Service Comprehensive Test Suite
 */

import { describe, it, expect, beforeEach } from "vitest"
import * as jose from "jose"
import { eq } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  AuthErrorCode,
  AUTH_AUDIENCE_API,
  AUTH_AUDIENCE_GAME,
  DEFAULT_AUTH_ISSUER,
} from "@hikat/shared"
import {
  hashPassword,
  verifyPassword,
} from "./crypto/password"
import {
  generateSecureToken,
  hashToken,
  generatePkceChallenge,
  verifyPkceChallenge,
} from "./crypto/tokens"
import {
  createDevKeyManager,
  signAccessToken,
  signGameToken,
  verifyAccessToken,
  verifyGameToken,
  getJwksResponse,
} from "./crypto/jwt"
import { MockEmailService } from "./services/email"
import { checkRateLimit, clearInMemoryRateLimits } from "./services/rateLimiter"
import {
  createSession,
  rotateRefreshToken,
  revokeSession,
  validateActiveSession,
} from "./services/session"
import {
  registerWithPassword,
  loginWithPassword,
  verifyEmailToken,
  requestPasswordReset,
  resetPasswordWithToken,
  changePassword,
  resolveOAuthUser,
  getLinkedAuthMethods,
  linkOAuthAccount,
  unlinkAuthMethod,
  issueGameToken,
} from "./services/auth"
import {
  createOAuthState,
  consumeOAuthState,
  createAuthorizationCode,
  consumeAuthorizationCode,
  isAllowedRedirectUri,
  OAuthFetcher,
} from "./services/oauth"
import { handleRequest } from "./routes"

describe("HiKAT Authentication System (Shard 02)", () => {
  let d1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let keyManager: Awaited<ReturnType<typeof createDevKeyManager>>
  let emailService: MockEmailService

  beforeEach(async () => {
    d1 = createTestD1()
    db = createDatabase(d1)
    keyManager = await createDevKeyManager("test-key-1")
    emailService = new MockEmailService()
    clearInMemoryRateLimits()
  })

  // ==========================================
  // 1. PASSWORD CRYPTOGRAPHY
  // ==========================================
  describe("Password Cryptography (PBKDF2-HMAC-SHA512 >= 220k iterations)", () => {
    it("hashes password with PBKDF2-HMAC-SHA512 and min 220,000 iterations", async () => {
      const hash = await hashPassword("superSecret123!")
      expect(hash).toMatch(/^\$pbkdf2-sha512\$i=220000\$/)

      const isValid = await verifyPassword("superSecret123!", hash)
      expect(isValid).toBe(true)

      const isInvalid = await verifyPassword("wrongPassword", hash)
      expect(isInvalid).toBe(false)
    })

    it("ensures password is never stored in plaintext", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "secure@hikat.org", password: "MyPassword999!" },
        emailService,
      )

      const cred = await db
        .select()
        .from(schema.passwordCredentials)
        .where(eq(schema.passwordCredentials.userId, reg.user.id))
        .get()

      expect(cred).toBeDefined()
      expect(cred?.passwordHash).not.toContain("MyPassword999!")
      expect(cred?.passwordHash.startsWith("$pbkdf2-sha512$i=220000$")).toBe(true)
    })
  })

  // ==========================================
  // 2. EMAIL / PASSWORD REGISTRATION & LOGIN
  // ==========================================
  describe("Email / Password Registration & Login", () => {
    it("successfully registers a new user with default role PLAYER", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "Steve@HiKAT.org", password: "password123", displayName: "Steve" },
        emailService,
      )

      expect(reg.user.id).toBeDefined()
      expect(reg.user.role).toBe("PLAYER")
      expect(reg.user.displayName).toBe("Steve")
      expect(reg.emailVerificationRequired).toBe(true)

      // Verification email sent
      const sentEmail = emailService.getLastEmailFor("steve@hikat.org")
      expect(sentEmail).toBeDefined()
      expect(sentEmail?.type).toBe("verification")
      expect(sentEmail?.token).toBeDefined()
    })

    it("rejects duplicate email registration", async () => {
      await registerWithPassword(
        db,
        { email: "alex@hikat.org", password: "password123" },
        emailService,
      )

      await expect(
        registerWithPassword(
          db,
          { email: "ALEX@hikat.org", password: "anotherPassword" },
          emailService,
        ),
      ).rejects.toThrow(AuthErrorCode.USER_ALREADY_EXISTS)
    })

    it("successfully logs in with correct email and password, returning session and tokens", async () => {
      await registerWithPassword(
        db,
        { email: "player1@hikat.org", password: "secretPassword123", displayName: "Player1" },
        emailService,
      )

      const session = await loginWithPassword(
        db,
        { email: "player1@hikat.org", password: "secretPassword123" },
        keyManager,
      )

      expect(session.accessToken).toBeDefined()
      expect(session.refreshToken).toBeDefined()
      expect(session.expiresIn).toBe(15 * 60)
      expect(session.user.role).toBe("PLAYER")
      expect(session.user.displayName).toBe("Player1")

      // Verify Access JWT
      const payload = await verifyAccessToken(session.accessToken, keyManager)
      expect(payload.sub).toBe(session.user.id)
      expect(payload.sid).toBe(session.sessionId)
      expect(payload.role).toBe("PLAYER")
      expect(payload.aud).toBe(AUTH_AUDIENCE_API)
      expect(payload.iss).toBe(DEFAULT_AUTH_ISSUER)
    })

    it("rejects login with incorrect password", async () => {
      await registerWithPassword(
        db,
        { email: "player2@hikat.org", password: "correctPassword123" },
        emailService,
      )

      await expect(
        loginWithPassword(
          db,
          { email: "player2@hikat.org", password: "wrongPassword" },
          keyManager,
        ),
      ).rejects.toThrow(AuthErrorCode.INVALID_CREDENTIALS)
    })
  })

  // ==========================================
  // 3. EMAIL VERIFICATION & PASSWORD RESET
  // ==========================================
  describe("Email Verification & Password Reset", () => {
    it("successfully verifies email and marks password credentials as verified", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "verify@hikat.org", password: "password123" },
        emailService,
      )

      const sentEmail = emailService.getLastEmailFor("verify@hikat.org")
      expect(sentEmail).toBeDefined()

      const verifyRes = await verifyEmailToken(db, sentEmail!.token)
      expect(verifyRes.success).toBe(true)

      const cred = await db
        .select()
        .from(schema.passwordCredentials)
        .where(eq(schema.passwordCredentials.userId, reg.user.id))
        .get()

      expect(cred?.emailVerifiedAt).not.toBeNull()
    })

    it("rejects expired or reused email verification token", async () => {
      await registerWithPassword(
        db,
        { email: "expired@hikat.org", password: "password123" },
        emailService,
      )

      const sentEmail = emailService.getLastEmailFor("expired@hikat.org")
      expect(sentEmail).toBeDefined()

      // First verification succeeds
      await verifyEmailToken(db, sentEmail!.token)

      // Reused token throws error
      await expect(verifyEmailToken(db, sentEmail!.token)).rejects.toThrow(
        AuthErrorCode.TOKEN_REUSE_DETECTED,
      )
    })

    it("handles password reset request, token consumption, and session revocation", async () => {
      await registerWithPassword(
        db,
        { email: "reset@hikat.org", password: "oldPassword123" },
        emailService,
      )

      // Log in to have an active session
      const oldSession = await loginWithPassword(
        db,
        { email: "reset@hikat.org", password: "oldPassword123" },
        keyManager,
      )

      // Request reset
      await requestPasswordReset(db, "reset@hikat.org", emailService)
      const resetEmail = emailService.getLastEmailFor("reset@hikat.org")
      expect(resetEmail).toBeDefined()
      expect(resetEmail?.type).toBe("password_reset")

      // Reset password
      const resetRes = await resetPasswordWithToken(db, resetEmail!.token, "newBrandPassword123!")
      expect(resetRes.success).toBe(true)

      // Old session was revoked
      const isActive = await validateActiveSession(db, oldSession.sessionId, oldSession.user.id)
      expect(isActive).toBe(false)

      // Old password fails, new password succeeds
      await expect(
        loginWithPassword(db, { email: "reset@hikat.org", password: "oldPassword123" }, keyManager),
      ).rejects.toThrow(AuthErrorCode.INVALID_CREDENTIALS)

      const newSession = await loginWithPassword(
        db,
        { email: "reset@hikat.org", password: "newBrandPassword123!" },
        keyManager,
      )
      expect(newSession.user.id).toBe(oldSession.user.id)

      // Reusing the reset token throws
      await expect(
        resetPasswordWithToken(db, resetEmail!.token, "anotherNewPassword123!"),
      ).rejects.toThrow(AuthErrorCode.TOKEN_REUSE_DETECTED)
    })

    it("allows changing password with active session and current password", async () => {
      await registerWithPassword(
        db,
        { email: "change@hikat.org", password: "currentPassword123" },
        emailService,
      )

      const session = await loginWithPassword(
        db,
        { email: "change@hikat.org", password: "currentPassword123" },
        keyManager,
      )

      const res = await changePassword(
        db,
        session.user.id,
        session.sessionId,
        "currentPassword123",
        "brandNewPassword999!",
      )
      expect(res.success).toBe(true)

      const newSession = await loginWithPassword(
        db,
        { email: "change@hikat.org", password: "brandNewPassword999!" },
        keyManager,
      )
      expect(newSession.user.id).toBe(session.user.id)
    })
  })

  // ==========================================
  // 4. OAUTH (GOOGLE & DISCORD) & ACCOUNT LINKING
  // ==========================================
  describe("OAuth (Google & Discord) & Account Linking", () => {
    it("creates a new HiKAT User with role PLAYER when authenticating with Google for the first time", async () => {
      const googleProfile = {
        provider: "GOOGLE" as const,
        providerSubject: "google-unique-sub-1001",
        email: "googleuser@gmail.com",
        emailVerified: true,
        displayName: "Google Gamer",
        avatarUrl: "https://lh3.googleusercontent.com/a/12345",
      }

      const session = await resolveOAuthUser(db, googleProfile, keyManager)
      expect(session.user.id).toBeDefined()
      expect(session.user.role).toBe("PLAYER")
      expect(session.user.displayName).toBe("Google Gamer")

      // Linked in external_accounts
      const linked = await db
        .select()
        .from(schema.externalAccounts)
        .where(eq(schema.externalAccounts.userId, session.user.id))
        .get()

      expect(linked).toBeDefined()
      expect(linked?.provider).toBe("GOOGLE")
      expect(linked?.providerSubject).toBe("google-unique-sub-1001")
    })

    it("creates a new HiKAT User with role PLAYER when authenticating with Discord for the first time", async () => {
      const discordProfile = {
        provider: "DISCORD" as const,
        providerSubject: "discord-user-id-998877",
        email: "discordgamer@discord.gg",
        emailVerified: true,
        displayName: "DiscordPro",
        avatarUrl: "https://cdn.discordapp.com/avatars/123/abc.png",
      }

      const session = await resolveOAuthUser(db, discordProfile, keyManager)
      expect(session.user.role).toBe("PLAYER")
      expect(session.user.displayName).toBe("DiscordPro")
    })

    it("authenticates existing linked OAuth account without creating a duplicate user", async () => {
      const profile = {
        provider: "GOOGLE" as const,
        providerSubject: "google-existing-sub-2002",
        email: "existing@gmail.com",
        emailVerified: true,
        displayName: "Existing User",
        avatarUrl: null,
      }

      const firstSession = await resolveOAuthUser(db, profile, keyManager)
      const secondSession = await resolveOAuthUser(db, profile, keyManager)

      expect(secondSession.user.id).toBe(firstSession.user.id)
    })

    it("PREVENTS auto-linking on email collision (prevents account takeover)", async () => {
      // 1. Existing user registered with password
      await registerWithPassword(
        db,
        { email: "victim@hikat.org", password: "victimPassword123" },
        emailService,
      )

      // 2. An external Google account tries to log in with the same email
      const maliciousGoogleProfile = {
        provider: "GOOGLE" as const,
        providerSubject: "attacker-google-sub-777",
        email: "victim@hikat.org", // Matching email
        emailVerified: true,
        displayName: "Attacker",
        avatarUrl: null,
      }

      // Must REJECT auto-link and require explicit login + linking
      await expect(resolveOAuthUser(db, maliciousGoogleProfile, keyManager)).rejects.toThrow(
        AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED,
      )
    })

    it("allows explicit linking of Google and Discord to an authenticated account", async () => {
      // 1. Register with password
      const reg = await registerWithPassword(
        db,
        { email: "linker@hikat.org", password: "password123" },
        emailService,
      )
      const session = await loginWithPassword(
        db,
        { email: "linker@hikat.org", password: "password123" },
        keyManager,
      )

      // 2. Explicitly link Google
      await linkOAuthAccount(db, session.user.id, session.sessionId, {
        provider: "GOOGLE",
        providerSubject: "google-sub-link-1",
        email: "linker.google@gmail.com",
        emailVerified: true,
        displayName: "Linker Google",
        avatarUrl: null,
      })

      // 3. Explicitly link Discord
      await linkOAuthAccount(db, session.user.id, session.sessionId, {
        provider: "DISCORD",
        providerSubject: "discord-id-link-1",
        email: "linker.discord@discord.gg",
        emailVerified: true,
        displayName: "Linker Discord",
        avatarUrl: null,
      })

      // 4. Check linked methods
      const methods = await getLinkedAuthMethods(db, session.user.id)
      expect(methods.length).toBe(3)
      expect(methods.map((m) => m.type).sort()).toEqual(["DISCORD", "GOOGLE", "PASSWORD"])
    })

    it("prevents unlinking the last remaining authentication method", async () => {
      // Create user with ONLY Google OAuth
      const profile = {
        provider: "GOOGLE" as const,
        providerSubject: "google-solo-user",
        email: "solo@gmail.com",
        emailVerified: true,
        displayName: "Solo User",
        avatarUrl: null,
      }
      const session = await resolveOAuthUser(db, profile, keyManager)

      const methodsBefore = await getLinkedAuthMethods(db, session.user.id)
      expect(methodsBefore.length).toBe(1)

      // Attempt to unlink Google -> MUST FAIL
      await expect(
        unlinkAuthMethod(db, session.user.id, session.sessionId, "GOOGLE"),
      ).rejects.toThrow(AuthErrorCode.LAST_AUTH_METHOD)
    })

    it("allows unlinking an authentication method when multiple methods exist", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "multi@hikat.org", password: "password123" },
        emailService,
      )
      const session = await loginWithPassword(
        db,
        { email: "multi@hikat.org", password: "password123" },
        keyManager,
      )

      await linkOAuthAccount(db, session.user.id, session.sessionId, {
        provider: "DISCORD",
        providerSubject: "discord-multi-1",
        email: "multi@discord.gg",
        emailVerified: true,
        displayName: "Multi",
        avatarUrl: null,
      })

      // Unlink Discord
      await unlinkAuthMethod(db, session.user.id, session.sessionId, "DISCORD")

      const methodsAfter = await getLinkedAuthMethods(db, session.user.id)
      expect(methodsAfter.length).toBe(1)
      expect(methodsAfter[0]?.type).toBe("PASSWORD")
    })
  })

  // ==========================================
  // 5. LAUNCHER PKCE & AUTHORIZATION CODE FLOW
  // ==========================================
  describe("Launcher PKCE & Authorization Code Flow", () => {
    it("completes full PKCE authorization code exchange: verifier -> challenge -> code -> tokens", async () => {
      // 1. Launcher creates code_verifier and code_challenge
      const codeVerifier = generateSecureToken(43)
      const codeChallenge = await generatePkceChallenge(codeVerifier)
      const redirectUri = "hikat://auth/callback"

      expect(isAllowedRedirectUri(redirectUri)).toBe(true)

      // 2. User creates account and Auth issues HiKAT authorization code
      const reg = await registerWithPassword(
        db,
        { email: "launcher@hikat.org", password: "password123" },
        emailService,
      )

      const authCode = await createAuthorizationCode(db, {
        userId: reg.user.id,
        codeChallenge,
        codeChallengeMethod: "S256",
        redirectUri,
      })

      // 3. Launcher exchanges authorization code + code_verifier at /oauth/token
      const consumed = await consumeAuthorizationCode(db, authCode, codeVerifier, redirectUri)
      expect(consumed.userId).toBe(reg.user.id)

      // 4. Reusing the authorization code throws error
      await expect(
        consumeAuthorizationCode(db, authCode, codeVerifier, redirectUri),
      ).rejects.toThrow(AuthErrorCode.TOKEN_REUSE_DETECTED)
    })

    it("rejects mismatched PKCE code_verifier", async () => {
      const codeVerifier = generateSecureToken(43)
      const codeChallenge = await generatePkceChallenge(codeVerifier)
      const redirectUri = "hikat://auth/callback"

      const reg = await registerWithPassword(
        db,
        { email: "pkce.fail@hikat.org", password: "password123" },
        emailService,
      )

      const authCode = await createAuthorizationCode(db, {
        userId: reg.user.id,
        codeChallenge,
        codeChallengeMethod: "S256",
        redirectUri,
      })

      await expect(
        consumeAuthorizationCode(db, authCode, "wrong-verifier-12345", redirectUri),
      ).rejects.toThrow(AuthErrorCode.INVALID_PKCE)
    })

    it("rejects unauthorized redirect URIs", () => {
      expect(isAllowedRedirectUri("https://malicious.site.com/steal")).toBe(false)
      expect(isAllowedRedirectUri("hikat://*")).toBe(false) // No wildcards
      expect(isAllowedRedirectUri("hikat://auth/callback")).toBe(true)
      expect(isAllowedRedirectUri("http://localhost:5173/auth/callback")).toBe(true)
    })
  })

  // ==========================================
  // 6. SESSIONS & REFRESH TOKEN ROTATION
  // ==========================================
  describe("Sessions, Refresh Token Rotation & Replay Detection", () => {
    it("rotates refresh token: issues new access + refresh tokens and invalidates old token", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "rotate@hikat.org", password: "password123" },
        emailService,
      )
      const session1 = await loginWithPassword(
        db,
        { email: "rotate@hikat.org", password: "password123" },
        keyManager,
      )

      const session2 = await rotateRefreshToken(db, session1.refreshToken, keyManager)

      expect(session2.accessToken).toBeDefined()
      expect(session2.refreshToken).not.toBe(session1.refreshToken)
      expect(session2.sessionId).toBe(session1.sessionId)
      expect(session2.user.id).toBe(reg.user.id)
    })

    it("detects refresh token replay: immediately revokes entire session if old consumed token is presented", async () => {
      await registerWithPassword(
        db,
        { email: "replay@hikat.org", password: "password123" },
        emailService,
      )
      const session1 = await loginWithPassword(
        db,
        { email: "replay@hikat.org", password: "password123" },
        keyManager,
      )

      // Rotate once (session1.refreshToken is now consumed)
      const session2 = await rotateRefreshToken(db, session1.refreshToken, keyManager)

      // Attacker attempts to replay session1.refreshToken
      await expect(rotateRefreshToken(db, session1.refreshToken, keyManager)).rejects.toThrow(
        AuthErrorCode.TOKEN_REUSE_DETECTED,
      )

      // Entire session family is now revoked! Even the legitimate session2.refreshToken will fail:
      await expect(rotateRefreshToken(db, session2.refreshToken, keyManager)).rejects.toThrow(
        AuthErrorCode.TOKEN_EXPIRED,
      )

      const isActive = await validateActiveSession(db, session1.sessionId, session1.user.id)
      expect(isActive).toBe(false)
    })

    it("handles logout by truly revoking the session in D1", async () => {
      await registerWithPassword(
        db,
        { email: "logout@hikat.org", password: "password123" },
        emailService,
      )
      const session = await loginWithPassword(
        db,
        { email: "logout@hikat.org", password: "password123" },
        keyManager,
      )

      await revokeSession(db, session.sessionId)

      const isActive = await validateActiveSession(db, session.sessionId, session.user.id)
      expect(isActive).toBe(false)

      await expect(rotateRefreshToken(db, session.refreshToken, keyManager)).rejects.toThrow(
        AuthErrorCode.TOKEN_EXPIRED,
      )
    })

    it("handles concurrent race condition on refresh token: only one request succeeds, other triggers replay revocation", async () => {
      await registerWithPassword(
        db,
        { email: "race@hikat.org", password: "password123" },
        emailService,
      )
      const session = await loginWithPassword(
        db,
        { email: "race@hikat.org", password: "password123" },
        keyManager,
      )

      // Launch 2 concurrent rotation requests with the exact same refresh token
      const results = await Promise.allSettled([
        rotateRefreshToken(db, session.refreshToken, keyManager),
        rotateRefreshToken(db, session.refreshToken, keyManager),
      ])

      const fulfilled = results.filter((r) => r.status === "fulfilled")
      const rejected = results.filter((r) => r.status === "rejected")

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
    })
  })

  // ==========================================
  // 7. ASYMMETRIC JWT & JWKS VALIDATION
  // ==========================================
  describe("Asymmetric JWT & JWKS Validation", () => {
    it("exposes public JWKS matching the signing key kid", async () => {
      const jwks = getJwksResponse(keyManager)
      expect(jwks.keys).toHaveLength(1)
      expect(jwks.keys[0]?.kid).toBe(keyManager.kid)
      expect(jwks.keys[0]?.kty).toBe("EC")
      expect(jwks.keys[0]?.crv).toBe("P-256")
      expect(jwks.keys[0]?.use).toBe("sig")
    })

    it("verifies JWT using JWKS public key", async () => {
      const { token } = await signAccessToken(
        { userId: "u-jwt-1", sessionId: "s-jwt-1", role: "ADMIN", displayName: "Admin" },
        keyManager,
      )

      const jwks = getJwksResponse(keyManager)
      const firstKey = jwks.keys[0]
      expect(firstKey).toBeDefined()
      const publicKey = (await jose.importJWK(firstKey!, "ES256")) as jose.CryptoKey

      const verified = await verifyAccessToken(token, publicKey)
      expect(verified.sub).toBe("u-jwt-1")
      expect(verified.sid).toBe("s-jwt-1")
      expect(verified.role).toBe("ADMIN")
      expect(verified.aud).toBe(AUTH_AUDIENCE_API)
      expect(verified.iss).toBe(DEFAULT_AUTH_ISSUER)
    })

    it("rejects tampered JWT signature", async () => {
      const { token } = await signAccessToken(
        { userId: "u-tamper", sessionId: "s-1", role: "PLAYER" },
        keyManager,
      )

      const parts = token.split(".")
      const tampered = `${parts[0]}.${parts[1]}.invalidsignature`

      await expect(verifyAccessToken(tampered, keyManager)).rejects.toThrow()
    })

    it("rejects expired JWT", async () => {
      const { token } = await signAccessToken(
        { userId: "u-exp", sessionId: "s-1", role: "PLAYER" },
        keyManager,
        { expiresInSeconds: -10 }, // expired in the past
      )

      await expect(verifyAccessToken(token, keyManager)).rejects.toThrow()
    })

    it("rejects invalid issuer or audience", async () => {
      const { token } = await signAccessToken(
        { userId: "u-iss", sessionId: "s-1", role: "PLAYER" },
        keyManager,
        { issuer: "https://fake-issuer.com" },
      )

      await expect(verifyAccessToken(token, keyManager)).rejects.toThrow()
    })
  })

  // ==========================================
  // 8. GAME JWT (MINECRAFT CREDENTIAL)
  // ==========================================
  describe("Game JWT for Minecraft", () => {
    it("issues a valid short Game JWT for verified player with active session", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "minecraft@hikat.org", password: "password123", displayName: "Crafter" },
        emailService,
      )

      // Verify email
      const verifyEmail = emailService.getLastEmailFor("minecraft@hikat.org")
      await verifyEmailToken(db, verifyEmail!.token)

      // Log in
      const session = await loginWithPassword(
        db,
        { email: "minecraft@hikat.org", password: "password123" },
        keyManager,
      )

      const gameJwt = await issueGameToken(db, session.user.id, session.sessionId, keyManager)
      expect(gameJwt.token).toBeDefined()
      expect(gameJwt.expiresIn).toBe(3 * 60)

      // Validate Game JWT claims
      const verified = await verifyGameToken(gameJwt.token, keyManager)
      expect(verified.sub).toBe(session.user.id)
      expect(verified.sid).toBe(session.sessionId)
      expect(verified.role).toBe("PLAYER")
      expect(verified.displayName).toBe("Crafter")
      expect(verified.aud).toBe(AUTH_AUDIENCE_GAME)
    })

    it("REJECTS Game JWT issuance if email is not verified for password accounts", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "unverified@hikat.org", password: "password123" },
        emailService,
      )

      const session = await loginWithPassword(
        db,
        { email: "unverified@hikat.org", password: "password123" },
        keyManager,
      )

      // Attempt to get Game JWT without verified email -> MUST FAIL
      await expect(
        issueGameToken(db, session.user.id, session.sessionId, keyManager),
      ).rejects.toThrow(AuthErrorCode.EMAIL_NOT_VERIFIED)
    })

    it("REJECTS Game JWT issuance if session was revoked", async () => {
      const reg = await registerWithPassword(
        db,
        { email: "game.revoked@hikat.org", password: "password123" },
        emailService,
      )
      const verifyEmail = emailService.getLastEmailFor("game.revoked@hikat.org")
      await verifyEmailToken(db, verifyEmail!.token)

      const session = await loginWithPassword(
        db,
        { email: "game.revoked@hikat.org", password: "password123" },
        keyManager,
      )

      // Revoke session
      await revokeSession(db, session.sessionId)

      // Attempt to issue Game JWT -> MUST FAIL
      await expect(
        issueGameToken(db, session.user.id, session.sessionId, keyManager),
      ).rejects.toThrow(AuthErrorCode.UNAUTHORIZED)
    })
  })

  // ==========================================
  // 9. HTTP ENDPOINTS & WORKER INTEGRATION
  // ==========================================
  describe("HTTP Router Endpoints", () => {
    it("handles /health", async () => {
      const req = new Request("http://localhost:8788/health")
      const res = await handleRequest({
        request: req,
        env: {},
        db,
        keyManager,
        emailService,
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { status: string; service: string }
      expect(data.status).toBe("ok")
      expect(data.service).toBe("hikat-auth")
    })

    it("handles /.well-known/jwks.json", async () => {
      const req = new Request("http://localhost:8788/.well-known/jwks.json")
      const res = await handleRequest({
        request: req,
        env: {},
        db,
        keyManager,
        emailService,
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { keys: Array<{ kid: string }> }
      expect(data.keys).toHaveLength(1)
      expect(data.keys[0]?.kid).toBe(keyManager.kid)
    })

    it("handles full HTTP registration, login, game-token, and logout flow", async () => {
      // 1. POST /auth/register
      const regReq = new Request("http://localhost:8788/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "flow@hikat.org",
          password: "flowPassword123!",
          displayName: "FlowUser",
        }),
      })

      const regRes = await handleRequest({ request: regReq, env: {}, db, keyManager, emailService })
      expect(regRes.status).toBe(201)

      // 2. Verify email
      const sentEmail = emailService.getLastEmailFor("flow@hikat.org")
      const verifyReq = new Request("http://localhost:8788/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: sentEmail!.token }),
      })
      const verifyRes = await handleRequest({ request: verifyReq, env: {}, db, keyManager, emailService })
      expect(verifyRes.status).toBe(200)

      // 3. POST /auth/login
      const loginReq = new Request("http://localhost:8788/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "flow@hikat.org",
          password: "flowPassword123!",
        }),
      })
      const loginRes = await handleRequest({ request: loginReq, env: {}, db, keyManager, emailService })
      expect(loginRes.status).toBe(200)
      const loginData = (await loginRes.json()) as { accessToken: string; refreshToken: string }
      expect(loginData.accessToken).toBeDefined()
      expect(loginData.refreshToken).toBeDefined()

      // 4. POST /auth/game-token
      const gameReq = new Request("http://localhost:8788/auth/game-token", {
        method: "POST",
        headers: { Authorization: `Bearer ${loginData.accessToken}` },
      })
      const gameRes = await handleRequest({ request: gameReq, env: {}, db, keyManager, emailService })
      expect(gameRes.status).toBe(200)
      const gameData = (await gameRes.json()) as { token: string; audience: string }
      expect(gameData.token).toBeDefined()
      expect(gameData.audience).toBe("hikat-minecraft")

      // 5. POST /auth/refresh
      const refreshReq = new Request("http://localhost:8788/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: loginData.refreshToken }),
      })
      const refreshRes = await handleRequest({ request: refreshReq, env: {}, db, keyManager, emailService })
      expect(refreshRes.status).toBe(200)
      const refreshData = (await refreshRes.json()) as { accessToken: string; refreshToken: string }
      expect(refreshData.accessToken).toBeDefined()
      expect(refreshData.refreshToken).not.toBe(loginData.refreshToken)

      // 6. POST /auth/logout
      const logoutReq = new Request("http://localhost:8788/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshData.accessToken}` },
      })
      const logoutRes = await handleRequest({ request: logoutReq, env: {}, db, keyManager, emailService })
      expect(logoutRes.status).toBe(200)
    })

    it("validates active session during OAuth account linking and rejects if session was revoked", async () => {
      // 1. Register and login
      await registerWithPassword(db, { email: "linking-test@hikat.org", password: "password123" }, emailService)
      const session = await loginWithPassword(db, { email: "linking-test@hikat.org", password: "password123" }, keyManager)

      const mockOAuthFetcher: OAuthFetcher = {
        fetch: async (url: RequestInfo | URL) => {
          const urlStr = url.toString()
          if (urlStr.includes("oauth2.googleapis.com/token")) {
            return new Response(JSON.stringify({ access_token: "google-token-link" }), { status: 200 })
          }
          if (urlStr.includes("openidconnect.googleapis.com/v1/userinfo")) {
            return new Response(
              JSON.stringify({
                sub: "google-link-sub-99",
                email: "google-link-sub-99@gmail.com",
                email_verified: true,
                name: "Link Subject",
              }),
              { status: 200 },
            )
          }
          return new Response("{}", { status: 404 })
        },
      }

      // 2. Start link flow
      const linkReq = new Request("http://localhost:8788/oauth/link/google?redirect_uri=https://app.hikat.org/settings&state=client-link-state", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const linkRes = await handleRequest({ request: linkReq, env: {}, db, keyManager, emailService })
      expect(linkRes.status).toBe(302)
      const location = linkRes.headers.get("Location")!
      const locationUrl = new URL(location)
      const internalState = locationUrl.searchParams.get("state")!
      expect(internalState).toBeDefined()

      // 3. Complete callback with active session -> success
      const cbReq = new Request(`http://localhost:8788/oauth/google/callback?code=mock-google-code&state=${internalState}`)
      const cbRes = await handleRequest({ request: cbReq, env: {}, db, keyManager, emailService, oauthFetcher: mockOAuthFetcher })
      expect(cbRes.status).toBe(302)
      const cbLocation = new URL(cbRes.headers.get("Location")!)
      expect(cbLocation.searchParams.get("linked")).toBe("google")
      expect(cbLocation.searchParams.get("success")).toBe("true")
      expect(cbLocation.searchParams.get("state")).toBe("client-link-state")

      // 4. Start second link flow, but revoke the session before callback
      const linkReq2 = new Request("http://localhost:8788/oauth/link/google?redirect_uri=https://app.hikat.org/settings", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const linkRes2 = await handleRequest({ request: linkReq2, env: {}, db, keyManager, emailService })
      const internalState2 = new URL(linkRes2.headers.get("Location")!).searchParams.get("state")!

      // Revoke session in D1
      await revokeSession(db, session.sessionId)

      // Callback should now be rejected because the linking session is revoked!
      const cbReq2 = new Request(`http://localhost:8788/oauth/google/callback?code=mock-google-code&state=${internalState2}`)
      const cbRes2 = await handleRequest({ request: cbReq2, env: {}, db, keyManager, emailService, oauthFetcher: mockOAuthFetcher })
      expect(cbRes2.status).toBe(401)
      const cbData2 = (await cbRes2.json()) as { error: string }
      expect(cbData2.error).toBe(AuthErrorCode.UNAUTHORIZED)
    })

    it("preserves client state parameter in Launcher PKCE flow and rejects tampered state", async () => {
      const codeVerifier = generateSecureToken(43)
      const codeChallenge = await generatePkceChallenge(codeVerifier)
      const clientState = "launcher_session_random_xyz_789"

      const mockOAuthFetcher: OAuthFetcher = {
        fetch: async (url: RequestInfo | URL) => {
          const urlStr = url.toString()
          if (urlStr.includes("oauth2.googleapis.com/token")) {
            return new Response(JSON.stringify({ access_token: "google-token-pkce" }), { status: 200 })
          }
          if (urlStr.includes("openidconnect.googleapis.com/v1/userinfo")) {
            return new Response(
              JSON.stringify({
                sub: "google-pkce-sub-1",
                email: "pkce-user@gmail.com",
                email_verified: true,
                name: "PKCE User",
              }),
              { status: 200 },
            )
          }
          return new Response("{}", { status: 404 })
        },
      }

      // 1. GET /oauth/authorize with custom client state
      const authReq = new Request(
        `http://localhost:8788/oauth/authorize?response_type=code&redirect_uri=hikat://auth/callback&code_challenge=${codeChallenge}&code_challenge_method=S256&provider=google&state=${clientState}`,
      )
      const authRes = await handleRequest({ request: authReq, env: {}, db, keyManager, emailService })
      expect(authRes.status).toBe(302)
      const googleAuthUrl = new URL(authRes.headers.get("Location")!)
      const internalState = googleAuthUrl.searchParams.get("state")!
      expect(internalState).toBeDefined()
      expect(internalState).not.toBe(clientState) // Internal state is distinct and secure

      // 2. Reject tampered state token
      const tamperedCbReq = new Request(`http://localhost:8788/oauth/google/callback?code=mock-code&state=tampered-invalid-state`)
      const tamperedRes = await handleRequest({ request: tamperedCbReq, env: {}, db, keyManager, emailService, oauthFetcher: mockOAuthFetcher })
      expect(tamperedRes.status).toBe(400)
      const tamperedData = (await tamperedRes.json()) as { error: string }
      expect(tamperedData.error).toBe(AuthErrorCode.INVALID_STATE)

      // 3. Valid callback redirects back to Launcher with auth code and exact client state
      const cbReq = new Request(`http://localhost:8788/oauth/google/callback?code=mock-code&state=${internalState}`)
      const cbRes = await handleRequest({ request: cbReq, env: {}, db, keyManager, emailService, oauthFetcher: mockOAuthFetcher })
      expect(cbRes.status).toBe(302)
      const launcherRedirect = new URL(cbRes.headers.get("Location")!)
      expect(launcherRedirect.protocol).toBe("hikat:")
      expect(launcherRedirect.searchParams.get("code")).toBeDefined()
      expect(launcherRedirect.searchParams.get("state")).toBe(clientState)
    })

    it("ensures Launcher PKCE flow does NOT create a session during OAuth callback, creating session only in /oauth/token", async () => {
      const codeVerifier = generateSecureToken(43)
      const codeChallenge = await generatePkceChallenge(codeVerifier)

      const mockOAuthFetcher: OAuthFetcher = {
        fetch: async (url: RequestInfo | URL) => {
          const urlStr = url.toString()
          if (urlStr.includes("oauth2.googleapis.com/token")) {
            return new Response(JSON.stringify({ access_token: "google-token-separate-session" }), { status: 200 })
          }
          if (urlStr.includes("openidconnect.googleapis.com/v1/userinfo")) {
            return new Response(
              JSON.stringify({
                sub: "google-separate-session-sub-1",
                email: "separate-session@gmail.com",
                email_verified: true,
                name: "Separate Session User",
              }),
              { status: 200 },
            )
          }
          return new Response("{}", { status: 404 })
        },
      }

      // Count sessions in DB before
      const sessionsBefore = (await db.select().from(schema.sessions).all()).length

      // 1. Authorize
      const authReq = new Request(
        `http://localhost:8788/oauth/authorize?response_type=code&redirect_uri=hikat://auth/callback&code_challenge=${codeChallenge}&provider=google`,
      )
      const authRes = await handleRequest({ request: authReq, env: {}, db, keyManager, emailService })
      const internalState = new URL(authRes.headers.get("Location")!).searchParams.get("state")!

      // 2. Callback
      const cbReq = new Request(`http://localhost:8788/oauth/google/callback?code=mock-code&state=${internalState}`)
      const cbRes = await handleRequest({ request: cbReq, env: {}, db, keyManager, emailService, oauthFetcher: mockOAuthFetcher })
      expect(cbRes.status).toBe(302)
      const authCode = new URL(cbRes.headers.get("Location")!).searchParams.get("code")!

      // VERIFY: No new session was created during callback!
      const sessionsAfterCallback = (await db.select().from(schema.sessions).all()).length
      expect(sessionsAfterCallback).toBe(sessionsBefore)

      // 3. Exchange at /oauth/token
      const tokenReq = new Request("http://localhost:8788/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: "hikat://auth/callback",
        }),
      })
      const tokenRes = await handleRequest({ request: tokenReq, env: {}, db, keyManager, emailService })
      expect(tokenRes.status).toBe(200)

      // VERIFY: Exactly one new session was created upon token exchange!
      const sessionsAfterToken = (await db.select().from(schema.sessions).all()).length
      expect(sessionsAfterToken).toBe(sessionsBefore + 1)
    })

    it("securely handles /auth/logout: rejecting arbitrary sessionId, supporting Bearer JWT and verified refreshToken", async () => {
      await registerWithPassword(db, { email: "logout-secure@hikat.org", password: "password123" }, emailService)
      const session = await loginWithPassword(db, { email: "logout-secure@hikat.org", password: "password123" }, keyManager)

      // 1. Rejects arbitrary unauthenticated sessionId
      const insecureReq = new Request("http://localhost:8788/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      })
      const insecureRes = await handleRequest({ request: insecureReq, env: {}, db, keyManager, emailService })
      expect(insecureRes.status).toBe(401)
      expect(await validateActiveSession(db, session.sessionId, session.user.id)).toBe(true)

      // 2. Rejects invalid refresh token
      const invalidRefreshReq = new Request("http://localhost:8788/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: "invalid-random-token" }),
      })
      const invalidRefreshRes = await handleRequest({ request: invalidRefreshReq, env: {}, db, keyManager, emailService })
      expect(invalidRefreshRes.status).toBe(401)

      // 3. Successfully logs out with valid refreshToken
      const validRefreshReq = new Request("http://localhost:8788/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
      const validRefreshRes = await handleRequest({ request: validRefreshReq, env: {}, db, keyManager, emailService })
      expect(validRefreshRes.status).toBe(200)
      expect(await validateActiveSession(db, session.sessionId, session.user.id)).toBe(false)
    })

    it("enforces rate limits on /auth/reset-password and /oauth/token", async () => {
      // Test /auth/reset-password rate limit
      for (let i = 0; i < 5; i++) {
        const req = new Request("http://localhost:8788/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.1" },
          body: JSON.stringify({ token: "fake-token", newPassword: "newPassword123!" }),
        })
        await handleRequest({ request: req, env: {}, db, keyManager, emailService })
      }

      // 6th attempt from the same IP must be rate limited (429)
      const limitedReq = new Request("http://localhost:8788/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.1" },
        body: JSON.stringify({ token: "fake-token", newPassword: "newPassword123!" }),
      })
      const limitedRes = await handleRequest({ request: limitedReq, env: {}, db, keyManager, emailService })
      expect(limitedRes.status).toBe(429)
      const data = (await limitedRes.json()) as { error: string }
      expect(data.error).toBe(AuthErrorCode.RATE_LIMITED)
    })

    it("handles concurrent rate limiter increments safely in D1", async () => {
      const key = `test-concurrent-rate-${Date.now()}`
      const attempts = 10

      // Execute 10 concurrent checkRateLimit calls
      const results = await Promise.all(
        Array.from({ length: attempts }, () => checkRateLimit(db, key, 20, 60)),
      )

      // All 10 requests should be allowed
      expect(results.every((r) => r.allowed)).toBe(true)

      // Remaining on the last result should reflect exactly 20 - 10 = 10
      const minRemaining = Math.min(...results.map((r) => r.remaining))
      expect(minRemaining).toBe(10)
    })

    it("ensures consumeOAuthState is strictly atomic under concurrent requests: only 1 succeeds", async () => {
      const stateId = await createOAuthState(db, {
        flowType: "LAUNCHER",
        provider: "GOOGLE",
        redirectUri: "hikat://auth/callback",
        codeChallenge: "xyz-challenge",
      })

      // Execute 2 concurrent consumeOAuthState calls
      const results = await Promise.allSettled([
        consumeOAuthState(db, stateId),
        consumeOAuthState(db, stateId),
      ])

      const fulfilled = results.filter((r) => r.status === "fulfilled")
      const rejected = results.filter((r) => r.status === "rejected")

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      const error = (rejected[0] as PromiseRejectedResult).reason as Error
      expect(error.message).toBe(AuthErrorCode.INVALID_STATE)
    })

    it("rejects non-S256 PKCE code_challenge_method in /oauth/authorize", async () => {
      const plainReq = new Request(
        "http://localhost:8788/oauth/authorize?response_type=code&redirect_uri=hikat://auth/callback&code_challenge=plain-challenge&code_challenge_method=plain&provider=google",
      )
      const plainRes = await handleRequest({ request: plainReq, env: {}, db, keyManager, emailService })
      expect(plainRes.status).toBe(400)
      const plainData = (await plainRes.json()) as { error: string }
      expect(plainData.error).toBe(AuthErrorCode.INVALID_PKCE)

      const invalidReq = new Request(
        "http://localhost:8788/oauth/authorize?response_type=code&redirect_uri=hikat://auth/callback&code_challenge=xyz&code_challenge_method=SHA1&provider=google",
      )
      const invalidRes = await handleRequest({ request: invalidReq, env: {}, db, keyManager, emailService })
      expect(invalidRes.status).toBe(400)
    })

    it("enforces strict allowlist for /oauth/link/:provider redirect_uri", async () => {
      await registerWithPassword(db, { email: "link-allowlist@hikat.org", password: "password123" }, emailService)
      const session = await loginWithPassword(db, { email: "link-allowlist@hikat.org", password: "password123" }, keyManager)

      // 1. Rejects unallowed redirect_uri
      const invalidReq = new Request("http://localhost:8788/oauth/link/google?redirect_uri=https://malicious-phishing.com/steal", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const invalidRes = await handleRequest({ request: invalidReq, env: {}, db, keyManager, emailService })
      expect(invalidRes.status).toBe(400)
      const invalidData = (await invalidRes.json()) as { error: string }
      expect(invalidData.error).toBe(AuthErrorCode.INVALID_REDIRECT_URI)

      // 2. Rejects missing redirect_uri
      const missingReq = new Request("http://localhost:8788/oauth/link/google", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const missingRes = await handleRequest({ request: missingReq, env: {}, db, keyManager, emailService })
      expect(missingRes.status).toBe(400)

      // 3. Accepts registered allowlisted redirect_uri
      const validReq = new Request("http://localhost:8788/oauth/link/google?redirect_uri=https://app.hikat.org/settings", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const validRes = await handleRequest({ request: validReq, env: {}, db, keyManager, emailService })
      expect(validRes.status).toBe(302)
    })
  })

  // ==========================================
  // 12. REFRESH TOKEN ROTATION CAS & CONCURRENCY (SHARD 8F HARDENING)
  // ==========================================
  describe("Refresh Token Rotation CAS & Concurrency Protection", () => {
    it("successfully rotates refresh token and returns full AuthUser contract with email", async () => {
      await registerWithPassword(
        db,
        { email: "rotate-test@hikat.org", password: "Password123!", displayName: "RotateTester" },
        emailService,
      )

      const initialSession = await loginWithPassword(
        db,
        { email: "rotate-test@hikat.org", password: "Password123!" },
        keyManager,
      )

      expect(initialSession.user.email).toBe("rotate-test@hikat.org")
      expect(initialSession.user.displayName).toBe("RotateTester")
      expect(initialSession.user.role).toBe("PLAYER")

      // Rotate refresh token
      const rotatedSession = await rotateRefreshToken(db, initialSession.refreshToken, keyManager)

      expect(rotatedSession.accessToken).toBeDefined()
      expect(rotatedSession.refreshToken).toBeDefined()
      expect(rotatedSession.refreshToken).not.toBe(initialSession.refreshToken)
      expect(rotatedSession.user.id).toBe(initialSession.user.id)
      expect(rotatedSession.user.email).toBe("rotate-test@hikat.org")
      expect(rotatedSession.user.displayName).toBe("RotateTester")
      expect(rotatedSession.user.role).toBe("PLAYER")

      // Old refresh token is marked as consumed
      const oldHash = await hashToken(initialSession.refreshToken)
      const oldRecord = await db
        .select()
        .from(schema.sessionRefreshTokens)
        .where(eq(schema.sessionRefreshTokens.tokenHash, oldHash))
        .get()

      expect(oldRecord?.consumedAt).not.toBeNull()

      // Rotating again with the new refresh token succeeds (B -> C)
      const secondRotation = await rotateRefreshToken(db, rotatedSession.refreshToken, keyManager)
      expect(secondRotation.user.email).toBe("rotate-test@hikat.org")
      expect(secondRotation.refreshToken).not.toBe(rotatedSession.refreshToken)
    })

    it("two concurrent rotateRefreshToken requests with the same token: exactly ONE succeeds, the loser gets TOKEN_REUSE_DETECTED and creates NO successor", async () => {
      await registerWithPassword(
        db,
        { email: "cas-race@hikat.org", password: "Password123!", displayName: "CasRacer" },
        emailService,
      )

      const initialSession = await loginWithPassword(
        db,
        { email: "cas-race@hikat.org", password: "Password123!" },
        keyManager,
      )

      // Count initial tokens in database for this session
      const initialTokens = await db
        .select()
        .from(schema.sessionRefreshTokens)
        .where(eq(schema.sessionRefreshTokens.sessionId, initialSession.sessionId))
        .all()
      expect(initialTokens).toHaveLength(1)

      // Fire 2 concurrent rotation requests with the identical initial refresh token
      const results = await Promise.allSettled([
        rotateRefreshToken(db, initialSession.refreshToken, keyManager),
        rotateRefreshToken(db, initialSession.refreshToken, keyManager),
      ])

      const fulfilled = results.filter((r) => r.status === "fulfilled")
      const rejected = results.filter((r) => r.status === "rejected")

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)

      const error = (rejected[0] as PromiseRejectedResult).reason as Error
      expect(error.message).toBe(AuthErrorCode.TOKEN_REUSE_DETECTED)

      // Verify that the loser did NOT create a rogue second successor token
      // Winner added exactly 1 token (total 2 tokens: 1 consumed, 1 new)
      const finalTokens = await db
        .select()
        .from(schema.sessionRefreshTokens)
        .where(eq(schema.sessionRefreshTokens.sessionId, initialSession.sessionId))
        .all()
      expect(finalTokens).toHaveLength(2)
    })

    it("handles /auth/refresh HTTP endpoint correctly and rotates tokens", async () => {
      await registerWithPassword(
        db,
        { email: "http-refresh@hikat.org", password: "Password123!" },
        emailService,
      )

      const session = await loginWithPassword(
        db,
        { email: "http-refresh@hikat.org", password: "Password123!" },
        keyManager,
      )

      const req = new Request("http://localhost:8788/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })

      const res = await handleRequest({ request: req, env: {}, db, keyManager, emailService })
      expect(res.status).toBe(200)

      const data = (await res.json()) as any
      expect(data.accessToken).toBeDefined()
      expect(data.refreshToken).toBeDefined()
      expect(data.user.email).toBe("http-refresh@hikat.org")
      expect(data.user.role).toBe("PLAYER")
    })

    it("handles canonical /auth/forgot-password HTTP endpoint", async () => {
      await registerWithPassword(
        db,
        { email: "forgot-canon@hikat.org", password: "Password123!" },
        emailService,
      )

      const req = new Request("http://localhost:8788/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "forgot-canon@hikat.org" }),
      })

      const res = await handleRequest({ request: req, env: {}, db, keyManager, emailService })
      expect(res.status).toBe(200)

      const data = (await res.json()) as any
      expect(data.success).toBe(true)

      const sent = emailService.getLastEmailFor("forgot-canon@hikat.org")
      expect(sent).toBeDefined()
      expect(sent?.type).toBe("password_reset")
    })
  })
})
