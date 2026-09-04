/**
 * HiKAT Authentication Service Comprehensive Test Suite
 */

import { describe, it, expect, beforeEach } from "vitest"
import * as jose from "jose"
import { eq } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  AuthClientCore,
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
import { MockEmailService, ResendEmailService, renderHikatEmail } from "./services/email"
import { createEmailServiceFromEnv } from "./index"
import { checkRateLimit, clearInMemoryRateLimits } from "./services/rateLimiter"
import {
  createSession,
  getUserEmail,
  rotateRefreshToken,
  revokeSession,
  validateActiveSession,
} from "./services/session"
import {
  registerWithPassword,
  resendVerificationEmail,
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

  const registerAndVerify = async (
    input: { email: string; password: string; displayName?: string },
  ) => {
    const reg = await registerWithPassword(db, input, emailService)
    const sent = emailService.getLastEmailFor(input.email)
    if (sent) {
      await verifyEmailToken(db, sent.token)
    }
    return reg
  }

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
      expect(sentEmail?.url).toBe(`https://auth.hikat.org/auth/email-action?type=verify-email&token=${sentEmail?.token}&lang=en`)
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

    it("rejects password login if email is not verified (EMAIL_NOT_VERIFIED)", async () => {
      await registerWithPassword(
        db,
        { email: "unverified@hikat.org", password: "secretPassword123", displayName: "Unverified" },
        emailService,
      )

      await expect(
        loginWithPassword(
          db,
          { email: "unverified@hikat.org", password: "secretPassword123" },
          keyManager,
        ),
      ).rejects.toThrow(AuthErrorCode.EMAIL_NOT_VERIFIED)

      // HTTP Endpoint also returns 403 EMAIL_NOT_VERIFIED
      const req = new Request("http://localhost:8788/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "unverified@hikat.org", password: "secretPassword123" }),
      })
      const res = await handleRequest({ request: req, env: {}, db, keyManager, emailService })
      expect(res.status).toBe(403)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe(AuthErrorCode.EMAIL_NOT_VERIFIED)
    })

    it("successfully logs in with verified email and password, returning session and tokens", async () => {
      await registerAndVerify(
        { email: "player1@hikat.org", password: "secretPassword123", displayName: "Player1" },
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
      await registerAndVerify(
        { email: "player2@hikat.org", password: "correctPassword123" },
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
      await registerAndVerify(
        { email: "reset@hikat.org", password: "oldPassword123" },
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
      expect(resetEmail?.url).toBe(`https://auth.hikat.org/auth/email-action?type=reset-password&token=${resetEmail?.token}&lang=en`)

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
      await registerAndVerify(
        { email: "change@hikat.org", password: "currentPassword123" },
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
        displayName: "Google User",
        avatarUrl: "https://lh3.googleusercontent.com/a/avatar",
      }

      const session = await resolveOAuthUser(db, googleProfile, keyManager)

      expect(session.user.id).toBeDefined()
      expect(session.user.role).toBe("PLAYER")
      expect(session.user.displayName).toBe("Google User")

      // Verify Access JWT has correct user and role
      const payload = await verifyAccessToken(session.accessToken, keyManager)
      expect(payload.sub).toBe(session.user.id)
      expect(payload.role).toBe("PLAYER")
    })

    it("creates a new HiKAT User with role PLAYER when authenticating with Discord for the first time", async () => {
      const discordProfile = {
        provider: "DISCORD" as const,
        providerSubject: "discord-unique-id-2002",
        email: "discorduser@discord.gg",
        emailVerified: true,
        displayName: "DiscordPlayer",
        avatarUrl: "https://cdn.discordapp.com/avatars/2002/avatar.png",
      }

      const session = await resolveOAuthUser(db, discordProfile, keyManager)

      expect(session.user.id).toBeDefined()
      expect(session.user.role).toBe("PLAYER")
      expect(session.user.displayName).toBe("DiscordPlayer")
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

    it("logs in existing user when returning with the same linked OAuth provider", async () => {
      const profile = {
        provider: "GOOGLE" as const,
        providerSubject: "google-returning-sub",
        email: "returning@gmail.com",
        emailVerified: true,
        displayName: "Returning User",
        avatarUrl: null,
      }

      const session1 = await resolveOAuthUser(db, profile, keyManager)
      const session2 = await resolveOAuthUser(db, profile, keyManager)

      expect(session1.user.id).toBe(session2.user.id)
      expect(session1.sessionId).not.toBe(session2.sessionId)
    })

    it("requires explicit account linking if OAuth email matches an existing password account", async () => {
      // 1. User registers with Password first
      await registerWithPassword(
        db,
        { email: "overlap@hikat.org", password: "password123", displayName: "Overlap" },
        emailService,
      )

      // 2. Someone tries to authenticate via Google using the same email address
      const maliciousGoogleProfile = {
        provider: "GOOGLE" as const,
        providerSubject: "google-overlap-sub",
        email: "overlap@hikat.org",
        emailVerified: true,
        displayName: "Overlap Google",
        avatarUrl: null,
      }

      // Must REJECT auto-link and require explicit login + linking
      await expect(resolveOAuthUser(db, maliciousGoogleProfile, keyManager)).rejects.toThrow(
        AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED,
      )
    })

    it("allows explicit linking of Google and Discord to an authenticated account", async () => {
      // 1. Register with password
      await registerAndVerify(
        { email: "linker@hikat.org", password: "password123" },
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
      await registerAndVerify(
        { email: "multi@hikat.org", password: "password123" },
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
      const reg = await registerAndVerify(
        { email: "rotate@hikat.org", password: "password123" },
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
      await registerAndVerify(
        { email: "replay@hikat.org", password: "password123" },
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
      await registerAndVerify(
        { email: "logout@hikat.org", password: "password123" },
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
      await registerAndVerify(
        { email: "race@hikat.org", password: "password123" },
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

      const rawSession = await createSession(
        db,
        { id: reg.user.id, role: "PLAYER", displayName: "Unverified" },
        keyManager,
      )

      // Attempt to get Game JWT without verified email -> MUST FAIL
      await expect(
        issueGameToken(db, reg.user.id, rawSession.sessionId, keyManager),
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
      const loginData = (await loginRes.json()) as { accessToken: string; refreshToken: string; user: { id: string; email: string; createdAt?: string } }
      expect(loginData.accessToken).toBeDefined()
      expect(loginData.refreshToken).toBeDefined()
      expect(loginData.user.createdAt).toBeDefined()
      expect(typeof loginData.user.createdAt).toBe("string")

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
      const refreshData = (await refreshRes.json()) as { accessToken: string; refreshToken: string; user: { id: string; email: string; createdAt?: string } }
      expect(refreshData.accessToken).toBeDefined()
      expect(refreshData.refreshToken).not.toBe(loginData.refreshToken)
      expect(refreshData.user.createdAt).toBeDefined()
      expect(typeof refreshData.user.createdAt).toBe("string")

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
      await registerAndVerify({ email: "linking-test@hikat.org", password: "password123" })
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
      await registerAndVerify({ email: "logout-secure@hikat.org", password: "password123" })
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
      await registerAndVerify({ email: "link-allowlist@hikat.org", password: "password123" })
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
      await registerAndVerify(
        { email: "rotate-test@hikat.org", password: "Password123!", displayName: "RotateTester" },
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
      await registerAndVerify(
        { email: "cas-race@hikat.org", password: "Password123!", displayName: "CasRacer" },
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
      await registerAndVerify(
        { email: "http-refresh@hikat.org", password: "Password123!" },
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
      expect(sent?.url).toBe(`http://localhost:8788/auth/email-action?type=reset-password&token=${sent?.token}&lang=en`)
    })

    it("OAuth PKCE /oauth/token exchange returns full AuthUser contract with email and integrates end-to-end with AuthClientCore", async () => {
      const codeVerifier = generateSecureToken(43)
      const codeChallenge = await generatePkceChallenge(codeVerifier)
      const redirectUri = "hikat://auth/callback"

      const reg = await registerWithPassword(
        db,
        { email: "oauth-launcher@hikat.org", password: "Password123!", displayName: "OAuthUser" },
        emailService,
      )

      const authCode = await createAuthorizationCode(db, {
        userId: reg.user.id,
        codeChallenge,
        codeChallengeMethod: "S256",
        redirectUri,
      })

      // 1. Instantiate AuthClientCore configured with mock fetcher that routes to handleRequest
      const client = new AuthClientCore({
        authServiceUrl: "http://localhost:8788",
        allowedRole: "PLAYER",
        fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = new Request(input, init)
          return handleRequest({ request: req, env: {}, db, keyManager, emailService })
        },
      })

      // 2. Consume OAuth code through AuthClientCore.exchangeOAuthCode
      const authUser = await client.exchangeOAuthCode({
        code: authCode,
        codeVerifier,
        redirectUri,
      })

      expect(authUser.id).toBe(reg.user.id)
      expect(authUser.email).toBe("oauth-launcher@hikat.org")
      expect(authUser.role).toBe("PLAYER")
      expect(authUser.displayName).toBe("OAuthUser")

      expect(client.getStatus()).toBe("AUTHENTICATED")
      expect(client.getAccessToken()).toBeTruthy()
      expect(client.getRefreshToken()).toBeTruthy()
      expect(client.getUser()?.email).toBe("oauth-launcher@hikat.org")
    })

    it("user without recoverable email fails createSession with UNAUTHORIZED and never emits email: ''", async () => {
      // Insert a headless user with no password credentials and no external accounts
      const headlessUserId = "headless-user-no-email"
      await db.insert(schema.users).values({
        id: headlessUserId,
        role: "PLAYER",
        displayName: "NoEmailUser",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // createSession without email throws UNAUTHORIZED fail-closed error
      await expect(
        createSession(db, { id: headlessUserId, role: "PLAYER", displayName: "NoEmailUser" }, keyManager),
      ).rejects.toThrow(AuthErrorCode.UNAUTHORIZED)
    })

    it("getUserEmail fails closed with UNAUTHORIZED when neither password nor external email exists", async () => {
      await expect(getUserEmail(db, "non-existent-user-id")).rejects.toThrow(AuthErrorCode.UNAUTHORIZED)
    })

    it("detects token replay: using consumed Refresh A revokes session and invalidates successor Refresh B", async () => {
      await registerAndVerify(
        { email: "replay-chain@hikat.org", password: "Password123!" },
      )

      const initialSession = await loginWithPassword(
        db,
        { email: "replay-chain@hikat.org", password: "Password123!" },
        keyManager,
      )

      // 1. First rotation: A -> B succeeds
      const rot1 = await rotateRefreshToken(db, initialSession.refreshToken, keyManager)
      expect(rot1.refreshToken).toBeDefined()
      expect(rot1.refreshToken).not.toBe(initialSession.refreshToken)

      // 2. Attacker replays consumed Token A:
      await expect(rotateRefreshToken(db, initialSession.refreshToken, keyManager)).rejects.toThrow(
        AuthErrorCode.TOKEN_REUSE_DETECTED,
      )

      // 3. Database session is confirmed revoked:
      const sessionDb = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, initialSession.sessionId))
        .get()
      expect(sessionDb?.revokedAt).not.toBeNull()

      // 4. Successor Token B CANNOT be used anymore because entire session is dead:
      await expect(rotateRefreshToken(db, rot1.refreshToken, keyManager)).rejects.toThrow(
        AuthErrorCode.TOKEN_EXPIRED,
      )
    })
  })

  // ==========================================
  // 13. RESEND EMAIL SERVICE & TEMPLATES
  // ==========================================
  describe("ResendEmailService & Email Delivery", () => {
    it("formats and renders clean HiKAT HTML email template copying Launcher Login card and logo CID", () => {
      const html = renderHikatEmail({
        title: "Test Email Title",
        description: "Test Description",
        buttonText: "Click Me",
        buttonUrl: "https://auth.hikat.org/auth/email-action?type=verify-email&token=xyz",
        expiryNotice: "Expires in 24 hours.",
      })

      expect(html).toContain("cid:hikat-logo")
      expect(html).toContain("Test Email Title")
      expect(html).toContain("Test Description")
      expect(html).toContain("Click Me")
      expect(html).toContain("https://auth.hikat.org/auth/email-action?type=verify-email&token=xyz")
      expect(html).toContain("target=\"_blank\"")
      expect(html).toContain("rel=\"noopener noreferrer\"")
      expect(html).not.toContain("Si el botón no funciona")
      expect(html).toContain("Expires in 24 hours.")
    })

    it("ResendEmailService dispatches correct HTTP request with inline logo attachment without leaking API key", async () => {
      let interceptedUrl = ""
      let interceptedAuth = ""
      let interceptedBody: any = null

      const mockFetch: typeof fetch = async (url, init) => {
        interceptedUrl = url.toString()
        interceptedAuth = (init?.headers as Record<string, string>)?.["Authorization"] || ""
        interceptedBody = JSON.parse(init?.body as string)
        return new Response(JSON.stringify({ id: "resend-msg-123" }), { status: 200 })
      }

      const resend = new ResendEmailService("re_secret_key_12345", "HiKAT <noreply@mail.hikat.org>", mockFetch)

      await resend.sendVerificationEmail(
        "tester@hikat.org",
        "token123",
        "https://auth.hikat.org/auth/email-action?type=verify-email&token=token123&lang=es",
        "es",
      )

      expect(interceptedUrl).toBe("https://api.resend.com/emails")
      expect(interceptedAuth).toBe("Bearer re_secret_key_12345")
      expect(interceptedBody.from).toBe("HiKAT <noreply@mail.hikat.org>")
      expect(interceptedBody.to).toEqual(["tester@hikat.org"])
      expect(interceptedBody.subject).toBe("Verifica tu cuenta de HiKAT")
      expect(interceptedBody.html).toContain("https://auth.hikat.org/auth/email-action?type=verify-email&token=token123")
      expect(interceptedBody.html).toContain("cid:hikat-logo")
      expect(interceptedBody.attachments).toBeDefined()
      expect(interceptedBody.attachments).toHaveLength(1)
      expect(interceptedBody.attachments[0].filename).toBe("logo-white.png")
      expect(interceptedBody.attachments[0].content_id).toBe("hikat-logo")
      expect(typeof interceptedBody.attachments[0].content).toBe("string")
      expect(interceptedBody.attachments[0].content.length).toBeGreaterThan(100)
    })

    it("ResendEmailService handles error response safely without leaking API key in error message", async () => {
      const mockFetchError: typeof fetch = async () => {
        return new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 })
      }

      const resend = new ResendEmailService("re_super_secret_key_xyz", "HiKAT <noreply@mail.hikat.org>", mockFetchError)

      try {
        await resend.sendPasswordResetEmail("user@hikat.org", "resetToken", "https://auth.hikat.org/auth/email-action?type=reset-password&token=resetToken")
        expect.fail("Should have thrown error")
      } catch (err: any) {
        expect(err.message).toContain("Resend email delivery failed: Domain not verified")
        expect(err.message).not.toContain("re_super_secret_key_xyz")
      }
    })
  })

  // ==========================================
  // 14. EMAIL VERIFICATION & RESET HARDENING
  // ==========================================
  describe("Email Verification & Password Reset Hardening", () => {
    it("token Base64URL with '--' and '_' is validated and processed without error", async () => {
      const complexToken = "tok_ABC--123__XYZ-456"
      const tokenHash = await hashToken(complexToken)
      const now = new Date().toISOString()
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()

      // 1. Verify complex token in verifyEmailToken
      const userId = crypto.randomUUID()
      await db.insert(schema.users).values({
        id: userId,
        role: "PLAYER",
        displayName: "ComplexTokenUser",
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(schema.passwordCredentials).values({
        id: crypto.randomUUID(),
        userId,
        email: "complextoken@hikat.org",
        passwordHash: await hashPassword("InitialPass123!"),
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(schema.emailVerificationTokens).values({
        id: crypto.randomUUID(),
        userId,
        tokenHash,
        expiresAt,
        createdAt: now,
      })

      const verifyRes = await verifyEmailToken(db, complexToken)
      expect(verifyRes.success).toBe(true)

      // 2. Verify complex token in resetPasswordWithToken
      const resetTokenHash = await hashToken(complexToken)
      await db.insert(schema.passwordResetTokens).values({
        id: crypto.randomUUID(),
        userId,
        tokenHash: resetTokenHash,
        expiresAt,
        createdAt: now,
      })

      const resetRes = await resetPasswordWithToken(db, complexToken, "NewValidComplexPass123!")
      expect(resetRes.success).toBe(true)
    })

    it("registration rollback on email service failure cleans up database so user can re-register cleanly", async () => {
      const failingEmailService: typeof emailService = {
        sendVerificationEmail: async () => {
          throw new Error("Resend 429: Rate limit exceeded")
        },
        sendPasswordResetEmail: async () => {},
        getLastEmailFor: () => undefined,
        clear: () => {},
        getSentEmails: () => [],
      } as any

      // 1. Direct service call fails and cleans up
      await expect(
        registerWithPassword(
          db,
          { email: "rollback@hikat.org", password: "Password123!" },
          failingEmailService,
        ),
      ).rejects.toThrow("EMAIL_SERVICE_ERROR")

      // Verify no leftover user or credential exists
      const user = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.displayName, "rollback"))
        .get()
      expect(user).toBeUndefined()

      const cred = await db
        .select()
        .from(schema.passwordCredentials)
        .where(eq(schema.passwordCredentials.email, "rollback@hikat.org"))
        .get()
      expect(cred).toBeUndefined()

      // 2. HTTP Endpoint returns generic 500 without leaking Resend internal details
      const req = new Request("http://localhost:8788/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "rollback-http@hikat.org", password: "Password123!" }),
      })
      const res = await handleRequest({
        request: req,
        env: {},
        db,
        keyManager,
        emailService: failingEmailService,
      })
      expect(res.status).toBe(500)
      const data = (await res.json()) as any
      expect(data.error).toBe("EMAIL_SERVICE_ERROR")
      expect(data.message).toBe("Unable to send verification email. Please try again later.")
      expect(JSON.stringify(data)).not.toContain("Resend 429")

      // 3. User can immediately re-register with functioning email service
      const successReg = await registerWithPassword(
        db,
        { email: "rollback-http@hikat.org", password: "Password123!" },
        emailService,
      )
      expect(successReg.user.id).toBeDefined()
    })

    it("forgot password with failing email service logs server-side, does not leak Resend error, and returns generic success response to prevent user enumeration", async () => {
      await registerAndVerify({ email: "registered-forgot@hikat.org", password: "Password123!" })

      const failingEmailService: typeof emailService = {
        sendVerificationEmail: async () => {},
        sendPasswordResetEmail: async () => {
          throw new Error("Resend 500: Internal service error")
        },
        getLastEmailFor: () => undefined,
        clear: () => {},
        getSentEmails: () => [],
      } as any

      // 1. Request for registered user with failing Resend
      const reqRegistered = new Request("http://localhost:8788/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "registered-forgot@hikat.org" }),
      })
      const resRegistered = await handleRequest({
        request: reqRegistered,
        env: {},
        db,
        keyManager,
        emailService: failingEmailService,
      })
      expect(resRegistered.status).toBe(200)
      const dataRegistered = (await resRegistered.json()) as any

      // 2. Request for non-existent user
      const reqUnknown = new Request("http://localhost:8788/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent-user-999@hikat.org" }),
      })
      const resUnknown = await handleRequest({
        request: reqUnknown,
        env: {},
        db,
        keyManager,
        emailService: failingEmailService,
      })
      expect(resUnknown.status).toBe(200)
      const dataUnknown = (await resUnknown.json()) as any

      // Responses must be completely identical
      expect(dataRegistered).toEqual(dataUnknown)
      expect(dataRegistered.success).toBe(true)
      expect(JSON.stringify(dataRegistered)).not.toContain("Resend 500")
    })

    it("production mode without RESEND_API_KEY throws missing configuration error and does not use MockEmailService", () => {
      // Production without RESEND_API_KEY throws
      expect(() => {
        createEmailServiceFromEnv({ ENVIRONMENT: "production" })
      }).toThrow("Missing RESEND_API_KEY in production environment")

      // Production with RESEND_API_KEY returns ResendEmailService
      const prodService = createEmailServiceFromEnv({
        ENVIRONMENT: "production",
        RESEND_API_KEY: "re_valid_key_123",
      })
      expect(prodService).toBeInstanceOf(ResendEmailService)

      // Development / default environment without key uses MockEmailService
      const devService = createEmailServiceFromEnv({
        ENVIRONMENT: "development",
      })
      expect(devService).toBeInstanceOf(MockEmailService)
    })

    it("requesting a new password reset token invalidates any previous reset tokens for that user", async () => {
      await registerAndVerify({ email: "multi-reset-tokens@hikat.org", password: "Password123!" })

      // First reset request
      await requestPasswordReset(db, "multi-reset-tokens@hikat.org", emailService)
      const firstToken = emailService.getLastEmailFor("multi-reset-tokens@hikat.org")!.token

      // Second reset request
      await requestPasswordReset(db, "multi-reset-tokens@hikat.org", emailService)
      const secondToken = emailService.getLastEmailFor("multi-reset-tokens@hikat.org")!.token

      expect(firstToken).not.toBe(secondToken)

      // First token is now invalidated
      await expect(
        resetPasswordWithToken(db, firstToken, "NewBrandPassword123!"),
      ).rejects.toThrow(AuthErrorCode.TOKEN_REUSE_DETECTED)

      // Second token succeeds
      const res = await resetPasswordWithToken(db, secondToken, "NewBrandPassword123!")
      expect(res.success).toBe(true)
    })

    it("atomic CAS consumption prevents token reuse during concurrent or repeated verification/reset requests", async () => {
      // 1. Concurrent email verification
      await registerWithPassword(
        db,
        { email: "cas-verify@hikat.org", password: "Password123!" },
        emailService,
      )
      const verifyToken = emailService.getLastEmailFor("cas-verify@hikat.org")!.token

      const verifyResults = await Promise.allSettled([
        verifyEmailToken(db, verifyToken),
        verifyEmailToken(db, verifyToken),
      ])

      const verifyFulfilled = verifyResults.filter((r) => r.status === "fulfilled")
      const verifyRejected = verifyResults.filter((r) => r.status === "rejected")

      expect(verifyFulfilled).toHaveLength(1)
      expect(verifyRejected).toHaveLength(1)
      expect((verifyRejected[0] as PromiseRejectedResult).reason.message).toBe(
        AuthErrorCode.TOKEN_REUSE_DETECTED,
      )

      // 2. Concurrent password reset
      await requestPasswordReset(db, "cas-verify@hikat.org", emailService)
      const resetToken = emailService.getLastEmailFor("cas-verify@hikat.org")!.token

      const resetResults = await Promise.allSettled([
        resetPasswordWithToken(db, resetToken, "BrandNewPassword123!"),
        resetPasswordWithToken(db, resetToken, "BrandNewPassword123!"),
      ])

      const resetFulfilled = resetResults.filter((r) => r.status === "fulfilled")
      const resetRejected = resetResults.filter((r) => r.status === "rejected")

      expect(resetFulfilled).toHaveLength(1)
      expect(resetRejected).toHaveLength(1)
      expect((resetRejected[0] as PromiseRejectedResult).reason.message).toBe(
        AuthErrorCode.TOKEN_REUSE_DETECTED,
      )
    })

    it("GET /auth/email-action validates token format and serves clean HTML deep link bridge with no-store headers", async () => {
      // 1. Valid verify-email action (Spanish default or explicit)
      const reqVerify = new Request("http://localhost:8788/auth/email-action?type=verify-email&token=validToken123&lang=es", {
        method: "GET",
      })
      const resVerify = await handleRequest({
        request: reqVerify,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resVerify.status).toBe(200)
      expect(resVerify.headers.get("Content-Type")).toContain("text/html")
      expect(resVerify.headers.get("Cache-Control")).toBe("no-store")
      expect(resVerify.headers.get("Referrer-Policy")).toBe("no-referrer")
      const htmlVerify = await resVerify.text()

      // Confirm no meta refresh and no script redirect in <head>
      expect(htmlVerify).not.toContain("http-equiv=\"refresh\"")
      const headEnd = htmlVerify.indexOf("</head>")
      const headContent = htmlVerify.slice(0, headEnd)
      expect(headContent).not.toContain("window.location.href")
      expect(headContent).not.toContain("hikat://")

      // Confirm card renders before openLauncher script
      const cardPos = htmlVerify.indexOf("<main class=\"card\">")
      const scriptPos = htmlVerify.indexOf("<script>")
      expect(cardPos).toBeGreaterThan(-1)
      expect(scriptPos).toBeGreaterThan(cardPos)

      // Confirm delayed open attempt & button trigger
      expect(htmlVerify).toContain("function openLauncher()")
      expect(htmlVerify).toContain("setTimeout(openLauncher, 150)")
      expect(htmlVerify).toContain("onclick=\"openLauncher()\"")

      // Confirm background & logo asset references
      expect(htmlVerify).toContain("/auth/background.png")
      expect(htmlVerify).toContain("/auth/logo.png")
      expect(htmlVerify).not.toContain("#efc436") // No yellow styling!

      // Confirm copy & deep link
      expect(htmlVerify).toContain("hikat://auth/verify-email?token=validToken123")
      expect(htmlVerify).toContain("Verificar cuenta")
      expect(htmlVerify).toContain("Estamos abriendo HiKAT Launcher para verificar tu cuenta.")
      expect(htmlVerify).toContain("Abrir HiKAT Launcher")

      // 2. Valid reset-password action with English language
      const reqReset = new Request("http://localhost:8788/auth/email-action?type=reset-password&token=resetToken456&lang=en", {
        method: "GET",
      })
      const resReset = await handleRequest({
        request: reqReset,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resReset.status).toBe(200)
      const htmlReset = await resReset.text()
      expect(htmlReset).not.toContain("http-equiv=\"refresh\"")
      expect(htmlReset).toContain("hikat://auth/reset-password?token=resetToken456")
      expect(htmlReset).toContain("Reset password")
      expect(htmlReset).toContain("Continue in HiKAT Launcher to set your new password.")
      expect(htmlReset).toContain("Open HiKAT Launcher")
      expect(htmlReset).toContain("setTimeout(openLauncher, 150)")

      // 3. Fallback to Accept-Language (French)
      const reqFr = new Request("http://localhost:8788/auth/email-action?type=verify-email&token=tokFrench789", {
        method: "GET",
        headers: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
      })
      const resFr = await handleRequest({
        request: reqFr,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resFr.status).toBe(200)
      const htmlFr = await resFr.text()
      expect(htmlFr).toContain("Vérifier le compte")
      expect(htmlFr).toContain("Nous ouvrons HiKAT Launcher pour vérifier votre compte.")
      expect(htmlFr).toContain("Ouvrir HiKAT Launcher")

      // 4. Invalid locale falls back to 'en'
      const reqInvalidLang = new Request("http://localhost:8788/auth/email-action?type=verify-email&token=tokInv999&lang=unknown_lang", {
        method: "GET",
      })
      const resInvalidLang = await handleRequest({
        request: reqInvalidLang,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resInvalidLang.status).toBe(200)
      const htmlInvalidLang = await resInvalidLang.text()
      expect(htmlInvalidLang).toContain("Verify account")

      // 5. Invalid type rejected with 400
      const reqInvalid = new Request("http://localhost:8788/auth/email-action?type=malicious&token=tok123", {
        method: "GET",
      })
      const resInvalid = await handleRequest({
        request: reqInvalid,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resInvalid.status).toBe(400)
    })

    it("GET /auth/logo.png and GET /auth/background.png serve raw image assets", async () => {
      // 1. Logo Asset
      const reqLogo = new Request("http://localhost:8788/auth/logo.png", {
        method: "GET",
      })
      const resLogo = await handleRequest({
        request: reqLogo,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resLogo.status).toBe(200)
      expect(resLogo.headers.get("Content-Type")).toBe("image/png")
      const logoBuffer = await resLogo.arrayBuffer()
      expect(logoBuffer.byteLength).toBeGreaterThan(100)

      // 2. Background Asset
      const reqBg = new Request("http://localhost:8788/auth/background.png", {
        method: "GET",
      })
      const resBg = await handleRequest({
        request: reqBg,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resBg.status).toBe(200)
      expect(resBg.headers.get("Content-Type")).toBe("image/png")
      const bgBuffer = await resBg.arrayBuffer()
      expect(bgBuffer.byteLength).toBeGreaterThan(1000)
    })

    it("registerWithPassword, resendVerification, and requestPasswordReset propagate locale into email URLs and templates", async () => {
      // 1. Register with Portuguese locale
      await registerWithPassword(
        db,
        { email: "portuguese@hikat.org", password: "Password123!", locale: "pt" },
        emailService,
      )
      const ptEmail = emailService.getLastEmailFor("portuguese@hikat.org")!
      expect(ptEmail.url).toContain("&lang=pt")
      expect(ptEmail.subject).toBe("Verifique sua conta do HiKAT")

      // 2. Resend verification with French locale
      const reqResendFr = new Request("http://localhost:8788/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "portuguese@hikat.org", locale: "fr" }),
      })
      await handleRequest({
        request: reqResendFr,
        env: {},
        db,
        keyManager,
        emailService,
      })
      const frEmail = emailService.getLastEmailFor("portuguese@hikat.org")!
      expect(frEmail.url).toContain("&lang=fr")
      expect(frEmail.subject).toBe("Vérifiez votre compte HiKAT")

      // 3. Password reset with English locale
      const reqForgotEn = new Request("http://localhost:8788/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "portuguese@hikat.org", locale: "en" }),
      })
      await handleRequest({
        request: reqForgotEn,
        env: {},
        db,
        keyManager,
        emailService,
      })
      const enResetEmail = emailService.getLastEmailFor("portuguese@hikat.org")!
      expect(enResetEmail.url).toContain("&lang=en")
      expect(enResetEmail.subject).toBe("Reset your HiKAT password")
    })

    it("POST /auth/resend-verification generates new token, invalidates prior tokens on success, and conserves valid tokens on email failure", async () => {
      // Register user without verifying
      await registerWithPassword(
        db,
        { email: "resend-test@hikat.org", password: "Password123!" },
        emailService,
      )
      const firstToken = emailService.getLastEmailFor("resend-test@hikat.org")!.token

      // 1. Resend verification email succeeds
      const reqResend = new Request("http://localhost:8788/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "resend-test@hikat.org" }),
      })
      const resResend = await handleRequest({
        request: reqResend,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resResend.status).toBe(200)
      const data = (await resResend.json()) as any
      expect(data.success).toBe(true)

      const secondToken = emailService.getLastEmailFor("resend-test@hikat.org")!.token
      expect(secondToken).not.toBe(firstToken)

      // First token was invalidated on successful resend
      await expect(verifyEmailToken(db, firstToken)).rejects.toThrow(AuthErrorCode.TOKEN_REUSE_DETECTED)

      // Second token succeeds
      const verifyRes = await verifyEmailToken(db, secondToken)
      expect(verifyRes.success).toBe(true)

      // 2. Resending for already verified user returns generic success without creating tokens
      emailService.clear()
      const reqAlreadyVerified = new Request("http://localhost:8788/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "resend-test@hikat.org" }),
      })
      const resAlreadyVerified = await handleRequest({
        request: reqAlreadyVerified,
        env: {},
        db,
        keyManager,
        emailService,
      })
      expect(resAlreadyVerified.status).toBe(200)
      expect(emailService.getSentEmails()).toHaveLength(0)
    })

    it("resend verification and password reset preserve prior valid tokens if email delivery fails", async () => {
      // 1. Verification token preservation
      await registerWithPassword(
        db,
        { email: "preserve-verify@hikat.org", password: "Password123!" },
        emailService,
      )
      const validVerifyToken = emailService.getLastEmailFor("preserve-verify@hikat.org")!.token

      const failingEmailService: typeof emailService = {
        sendVerificationEmail: async () => {
          throw new Error("Resend 500: Delivery failure")
        },
        sendPasswordResetEmail: async () => {
          throw new Error("Resend 500: Delivery failure")
        },
        getLastEmailFor: () => undefined,
        clear: () => {},
        getSentEmails: () => [],
      } as any

      // Attempt resend with failing email service
      await resendVerificationEmail(db, "preserve-verify@hikat.org", failingEmailService)

      // Prior valid verification token is STILL valid and can be verified
      const verifySuccess = await verifyEmailToken(db, validVerifyToken)
      expect(verifySuccess.success).toBe(true)

      // 2. Password reset token preservation
      await requestPasswordReset(db, "preserve-verify@hikat.org", emailService)
      const validResetToken = emailService.getLastEmailFor("preserve-verify@hikat.org")!.token

      // Attempt second reset with failing email service
      await requestPasswordReset(db, "preserve-verify@hikat.org", failingEmailService)

      // Prior valid reset token is STILL valid and can reset password
      const resetSuccess = await resetPasswordWithToken(db, validResetToken, "BrandNewPassword999!")
      expect(resetSuccess.success).toBe(true)
    })
  })
})
