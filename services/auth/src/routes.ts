/**
 * HiKAT Auth Service Router & Request Dispatcher
 */

import { Database, schema } from "@hikat/database"
import { eq } from "drizzle-orm"
import {
  HIKAT_VERSION,
  AuthErrorCode,
  AUTH_AUDIENCE_API,
  DEFAULT_AUTH_ISSUER,
  ExternalAuthProvider,
} from "@hikat/shared"
import {
  JwtKeyManager,
  getJwksResponse,
  verifyAccessToken,
} from "./crypto/jwt"
import { hashToken } from "./crypto/tokens"
import { EmailService } from "./services/email"
import { checkRateLimit } from "./services/rateLimiter"
import {
  registerWithPassword,
  loginWithPassword,
  verifyEmailToken,
  requestPasswordReset,
  resetPasswordWithToken,
  changePassword,
  getOrCreateOAuthUser,
  resolveOAuthUser,
  getLinkedAuthMethods,
  linkOAuthAccount,
  unlinkAuthMethod,
  issueGameToken,
} from "./services/auth"
import {
  createSession,
  rotateRefreshToken,
  revokeSession,
  validateActiveSession,
} from "./services/session"
import {
  isAllowedRedirectUri,
  isAllowedLinkRedirectUri,
  createOAuthState,
  consumeOAuthState,
  createAuthorizationCode,
  consumeAuthorizationCode,
  exchangeGoogleCode,
  exchangeDiscordCode,
  OAuthProviderConfig,
  OAuthFetcher,
} from "./services/oauth"

export interface RouteContext {
  request: Request
  env: {
    ENVIRONMENT?: string
    AUTH_SERVICE_ENDPOINT?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    DISCORD_CLIENT_ID?: string
    DISCORD_CLIENT_SECRET?: string
    AUTH_JWT_PRIVATE_KEY_PEM?: string
    AUTH_JWT_PUBLIC_KEY_PEM?: string
    AUTH_JWT_KID?: string
    DB?: D1Database
  }
  db?: Database
  keyManager: JwtKeyManager
  emailService: EmailService
  oauthFetcher?: OAuthFetcher
}

function jsonResponse(data: unknown, status: number = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  })
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({ error: code, message }, status)
}

function redirectResponse(url: string, status: number = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: url },
  })
}

async function extractAuthenticatedSession(
  request: Request,
  keyManager: JwtKeyManager,
): Promise<{ userId: string; sessionId: string; role: "PLAYER" | "ADMIN" }> {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }

  const token = authHeader.slice(7).trim()
  try {
    const payload = await verifyAccessToken(token, keyManager)
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      role: payload.role,
    }
  } catch {
    throw new Error(AuthErrorCode.UNAUTHORIZED)
  }
}

export async function handleRequest(ctx: RouteContext): Promise<Response> {
  const { request, env, db, keyManager, emailService, oauthFetcher } = ctx
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method.toUpperCase()
  const authServiceUrl = env.AUTH_SERVICE_ENDPOINT || `${url.protocol}//${url.host}`
  const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1"
  const isProduction = env.ENVIRONMENT === "production"

  // 1. Health Checks
  if (pathname === "/health" || pathname === "/") {
    return jsonResponse({
      status: "ok",
      service: "hikat-auth",
      version: HIKAT_VERSION,
      timestamp: new Date().toISOString(),
    })
  }

  // 2. Public JWKS
  if (pathname === "/.well-known/jwks.json" && method === "GET") {
    return jsonResponse(getJwksResponse(keyManager), 200, {
      "Cache-Control": "public, max-age=3600",
    })
  }

  // Ensure DB is bound for database-backed endpoints
  if (!db) {
    return errorResponse("DATABASE_UNAVAILABLE", "Database connection is unavailable", 503)
  }

  try {
    // 3. Email/Password: Register
    if (pathname === "/auth/register" && method === "POST") {
      const rate = await checkRateLimit(db, `register:${clientIp}`, 15, 3600, { isProduction })
      if (!rate.allowed) {
        return errorResponse(AuthErrorCode.RATE_LIMITED, "Too many registration attempts", 429)
      }

      const body = (await request.json().catch(() => ({}))) as {
        email?: string
        password?: string
        displayName?: string
      }

      if (!body.email || !body.password) {
        return errorResponse(AuthErrorCode.INVALID_CREDENTIALS, "Email and password are required", 400)
      }

      const result = await registerWithPassword(
        db,
        {
          email: body.email,
          password: body.password,
          displayName: body.displayName,
        },
        emailService,
        authServiceUrl,
      )

      return jsonResponse(
        {
          success: true,
          user: result.user,
          emailVerificationRequired: result.emailVerificationRequired,
        },
        201,
      )
    }

    // 4. Email/Password: Login
    if (pathname === "/auth/login" && method === "POST") {
      const rate = await checkRateLimit(db, `login:${clientIp}`, 10, 300, { isProduction })
      if (!rate.allowed) {
        return errorResponse(AuthErrorCode.RATE_LIMITED, "Too many login attempts. Please wait.", 429)
      }

      const body = (await request.json().catch(() => ({}))) as {
        email?: string
        password?: string
      }

      if (!body.email || !body.password) {
        return errorResponse(AuthErrorCode.INVALID_CREDENTIALS, "Email and password are required", 400)
      }

      const sessionResult = await loginWithPassword(
        db,
        { email: body.email, password: body.password },
        keyManager,
      )

      return jsonResponse({
        accessToken: sessionResult.accessToken,
        refreshToken: sessionResult.refreshToken,
        expiresIn: sessionResult.expiresIn,
        tokenType: "Bearer",
        user: sessionResult.user,
      })
    }

    // 5. Verify Email
    if ((pathname === "/auth/verify-email" && method === "POST") || (pathname === "/auth/verify-email" && method === "GET")) {
      const token = method === "GET"
        ? url.searchParams.get("token")
        : ((await request.json().catch(() => ({}))) as { token?: string }).token

      if (!token) {
        return errorResponse(AuthErrorCode.INVALID_TOKEN, "Verification token is required", 400)
      }

      const res = await verifyEmailToken(db, token)
      return jsonResponse({ success: res.success, message: "Email verified successfully" })
    }

    // 6. Forgot Password
    if (pathname === "/auth/forgot-password" && method === "POST") {
      const rate = await checkRateLimit(db, `forgot-pwd:${clientIp}`, 5, 900, { isProduction })
      if (!rate.allowed) {
        return errorResponse(AuthErrorCode.RATE_LIMITED, "Too many reset requests", 429)
      }

      const body = (await request.json().catch(() => ({}))) as { email?: string }
      if (body.email) {
        await requestPasswordReset(db, body.email, emailService, authServiceUrl)
      }

      return jsonResponse({
        success: true,
        message: "If the email is registered, a password reset email has been sent.",
      })
    }

    // 7. Reset Password
    if (pathname === "/auth/reset-password" && method === "POST") {
      const rate = await checkRateLimit(db, `reset-pwd:${clientIp}`, 5, 900, { isProduction })
      if (!rate.allowed) {
        return errorResponse(AuthErrorCode.RATE_LIMITED, "Too many password reset attempts", 429)
      }

      const body = (await request.json().catch(() => ({}))) as {
        token?: string
        newPassword?: string
      }

      if (!body.token || !body.newPassword) {
        return errorResponse(AuthErrorCode.INVALID_TOKEN, "Token and newPassword are required", 400)
      }

      await resetPasswordWithToken(db, body.token, body.newPassword)
      return jsonResponse({ success: true, message: "Password reset successfully. Please log in with your new password." })
    }

    // 8. Change Password (authenticated)
    if (pathname === "/auth/change-password" && method === "POST") {
      const session = await extractAuthenticatedSession(request, keyManager)
      const isSessionActive = await validateActiveSession(db, session.sessionId, session.userId)
      if (!isSessionActive) {
        return errorResponse(AuthErrorCode.UNAUTHORIZED, "Session expired or revoked", 401)
      }

      const body = (await request.json().catch(() => ({}))) as {
        currentPassword?: string
        newPassword?: string
      }

      if (!body.currentPassword || !body.newPassword) {
        return errorResponse(AuthErrorCode.INVALID_CREDENTIALS, "currentPassword and newPassword are required", 400)
      }

      await changePassword(
        db,
        session.userId,
        session.sessionId,
        body.currentPassword,
        body.newPassword,
      )

      return jsonResponse({ success: true, message: "Password updated successfully" })
    }

    // 9. Session Refresh Token Rotation (atomic & race-condition-safe)
    if (pathname === "/auth/refresh" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { refreshToken?: string }
      if (!body.refreshToken) {
        return errorResponse(AuthErrorCode.INVALID_TOKEN, "refreshToken is required", 400)
      }

      const result = await rotateRefreshToken(db, body.refreshToken, keyManager)
      return jsonResponse({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        tokenType: "Bearer",
        user: result.user,
      })
    }

    // 10. Logout (Secure Session Revocation - strictly authenticated)
    if (pathname === "/auth/logout" && method === "POST") {
      const authHeader = request.headers.get("Authorization")

      // Option A: Logout with Bearer Access JWT
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const session = await extractAuthenticatedSession(request, keyManager)
        await revokeSession(db, session.sessionId)
        return jsonResponse({ success: true, message: "Logged out successfully" })
      }

      // Option B: Logout with Refresh Token (validated cryptographically by SHA-256 hash)
      const body = (await request.json().catch(() => ({}))) as {
        refreshToken?: string
      }

      if (body.refreshToken && typeof body.refreshToken === "string") {
        const tokenHash = await hashToken(body.refreshToken)
        const tokenRecord = await db
          .select()
          .from(schema.sessionRefreshTokens)
          .where(eq(schema.sessionRefreshTokens.tokenHash, tokenHash))
          .get()

        if (!tokenRecord) {
          return errorResponse(AuthErrorCode.INVALID_TOKEN, "Invalid refresh token", 401)
        }

        await revokeSession(db, tokenRecord.sessionId)
        return jsonResponse({ success: true, message: "Logged out successfully" })
      }

      // Rejection: Arbitrary unauthenticated session ID is never accepted!
      return errorResponse(AuthErrorCode.UNAUTHORIZED, "Authentication (Bearer token or valid refreshToken) is required to logout", 401)
    }

    // 11. Game JWT for Minecraft
    if (pathname === "/auth/game-token" && method === "POST") {
      const session = await extractAuthenticatedSession(request, keyManager)
      const gameToken = await issueGameToken(db, session.userId, session.sessionId, keyManager)
      return jsonResponse({
        token: gameToken.token,
        expiresIn: gameToken.expiresIn,
        audience: "hikat-minecraft",
        tokenType: "Bearer",
      })
    }

    // 12. Get Linked Auth Methods (authenticated)
    if (pathname === "/auth/me/methods" && method === "GET") {
      const session = await extractAuthenticatedSession(request, keyManager)
      const isSessionActive = await validateActiveSession(db, session.sessionId, session.userId)
      if (!isSessionActive) {
        return errorResponse(AuthErrorCode.UNAUTHORIZED, "Session expired or revoked", 401)
      }

      const methods = await getLinkedAuthMethods(db, session.userId)
      return jsonResponse({ methods })
    }

    // 13. Unlink Auth Provider (authenticated)
    if (pathname.startsWith("/auth/me/methods/") && method === "DELETE") {
      const provider = pathname.slice("/auth/me/methods/".length).toUpperCase() as ExternalAuthProvider
      if (provider !== "GOOGLE" && provider !== "DISCORD") {
        return errorResponse(AuthErrorCode.INVALID_CREDENTIALS, "Invalid auth provider", 400)
      }

      const session = await extractAuthenticatedSession(request, keyManager)
      await unlinkAuthMethod(db, session.userId, session.sessionId, provider)
      return jsonResponse({ success: true, message: `Unlinked ${provider} successfully` })
    }

    // 14. Launcher / Browser OAuth Authorization Initiation (PKCE Flow)
    if (pathname === "/oauth/authorize" && method === "GET") {
      const responseType = url.searchParams.get("response_type")
      const redirectUri = url.searchParams.get("redirect_uri")
      const codeChallenge = url.searchParams.get("code_challenge")
      const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256"
      const provider = (url.searchParams.get("provider") || "google").toUpperCase() as ExternalAuthProvider
      const clientState = url.searchParams.get("state") || undefined

      if (responseType !== "code") {
        return errorResponse("UNSUPPORTED_RESPONSE_TYPE", "Only response_type=code is supported", 400)
      }

      if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
        return errorResponse(AuthErrorCode.INVALID_REDIRECT_URI, "Unauthorized redirect URI", 400)
      }

      if (!codeChallenge) {
        return errorResponse(AuthErrorCode.INVALID_PKCE, "PKCE code_challenge is required", 400)
      }

      if (codeChallengeMethod !== "S256") {
        return errorResponse(AuthErrorCode.INVALID_PKCE, "Only PKCE code_challenge_method=S256 is supported", 400)
      }

      // Store Launcher OAuth state and preserve original clientState
      const internalState = await createOAuthState(db, {
        flowType: "LAUNCHER",
        provider,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        clientState,
      })

      // Redirect to Google or Discord authorization endpoint
      if (provider === "GOOGLE") {
        const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
        googleAuthUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID || "google-client-id-placeholder")
        googleAuthUrl.searchParams.set("redirect_uri", `${authServiceUrl}/oauth/google/callback`)
        googleAuthUrl.searchParams.set("response_type", "code")
        googleAuthUrl.searchParams.set("scope", "openid email profile")
        googleAuthUrl.searchParams.set("state", internalState)
        return redirectResponse(googleAuthUrl.toString())
      }

      if (provider === "DISCORD") {
        const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize")
        discordAuthUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID || "discord-client-id-placeholder")
        discordAuthUrl.searchParams.set("redirect_uri", `${authServiceUrl}/oauth/discord/callback`)
        discordAuthUrl.searchParams.set("response_type", "code")
        discordAuthUrl.searchParams.set("scope", "identify email")
        discordAuthUrl.searchParams.set("state", internalState)
        return redirectResponse(discordAuthUrl.toString())
      }

      return errorResponse("INVALID_PROVIDER", "Invalid OAuth provider", 400)
    }

    // 15. Start OAuth Account Link flow (authenticated)
    if (pathname.startsWith("/oauth/link/") && method === "GET" && !pathname.includes("/callback")) {
      const provider = pathname.slice("/oauth/link/".length).toUpperCase() as ExternalAuthProvider
      if (provider !== "GOOGLE" && provider !== "DISCORD") {
        return errorResponse("INVALID_PROVIDER", "Invalid OAuth provider", 400)
      }

      const session = await extractAuthenticatedSession(request, keyManager)
      const isSessionActive = await validateActiveSession(db, session.sessionId, session.userId)
      if (!isSessionActive) {
        return errorResponse(AuthErrorCode.UNAUTHORIZED, "Session expired or revoked", 401)
      }

      const redirectUri = url.searchParams.get("redirect_uri")
      if (!redirectUri || !isAllowedLinkRedirectUri(redirectUri)) {
        return errorResponse(
          AuthErrorCode.INVALID_REDIRECT_URI,
          "A registered, valid redirect_uri is required for account linking",
          400,
        )
      }

      const clientState = url.searchParams.get("state") || undefined

      const internalState = await createOAuthState(db, {
        flowType: "LINK",
        provider,
        userId: session.userId,
        sessionId: session.sessionId,
        clientState,
        redirectUri,
      })

      const callbackPath = provider === "GOOGLE" ? "/oauth/google/callback" : "/oauth/discord/callback"
      const authUrl = provider === "GOOGLE"
        ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
        : new URL("https://discord.com/api/oauth2/authorize")

      const clientId = provider === "GOOGLE"
        ? (env.GOOGLE_CLIENT_ID || "google-client-id-placeholder")
        : (env.DISCORD_CLIENT_ID || "discord-client-id-placeholder")

      authUrl.searchParams.set("client_id", clientId)
      authUrl.searchParams.set("redirect_uri", `${authServiceUrl}${callbackPath}`)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("scope", provider === "GOOGLE" ? "openid email profile" : "identify email")
      authUrl.searchParams.set("state", internalState)

      return redirectResponse(authUrl.toString())
    }

    // 16. Google OAuth Callback
    if (pathname === "/oauth/google/callback" && method === "GET") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")

      if (error || !code || !state) {
        return errorResponse(AuthErrorCode.INVALID_STATE, error || "Missing code or state", 400)
      }

      const oauthState = await consumeOAuthState(db, state)
      const redirectUri = `${authServiceUrl}/oauth/google/callback`

      const profile = await exchangeGoogleCode(
        code,
        redirectUri,
        {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
        oauthFetcher,
      )

      // Handle LINK flow with active session verification
      if (oauthState.flowType === "LINK") {
        if (!oauthState.userId || !oauthState.sessionId) {
          return errorResponse(AuthErrorCode.UNAUTHORIZED, "Invalid linking state", 401)
        }

        const isSessionActive = await validateActiveSession(db, oauthState.sessionId, oauthState.userId)
        if (!isSessionActive) {
          return errorResponse(AuthErrorCode.UNAUTHORIZED, "Linking session expired or was revoked", 401)
        }

        await linkOAuthAccount(db, oauthState.userId, oauthState.sessionId, profile)
        if (oauthState.redirectUri) {
          const redirectUrl = new URL(oauthState.redirectUri)
          redirectUrl.searchParams.set("linked", "google")
          redirectUrl.searchParams.set("success", "true")
          if (oauthState.clientState) {
            redirectUrl.searchParams.set("state", oauthState.clientState)
          }
          return redirectResponse(redirectUrl.toString())
        }
        return jsonResponse({ success: true, provider: "GOOGLE", message: "Google account linked successfully" })
      }

      // Handle LAUNCHER flow: generate short HiKAT authorization code bound to PKCE (NO intermediate session created!)
      if (oauthState.flowType === "LAUNCHER" && oauthState.redirectUri && oauthState.codeChallenge) {
        let user: { id: string }
        try {
          user = await getOrCreateOAuthUser(db, profile)
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          if (errMsg === AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED) {
            const redirectUrl = new URL(oauthState.redirectUri)
            redirectUrl.searchParams.set("error", AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED)
            redirectUrl.searchParams.set("email", profile.email || "")
            if (oauthState.clientState) {
              redirectUrl.searchParams.set("state", oauthState.clientState)
            }
            return redirectResponse(redirectUrl.toString())
          }
          throw err
        }

        const hikatAuthCode = await createAuthorizationCode(db, {
          userId: user.id,
          codeChallenge: oauthState.codeChallenge,
          codeChallengeMethod: oauthState.codeChallengeMethod || "S256",
          redirectUri: oauthState.redirectUri,
        })

        const launcherRedirectUrl = new URL(oauthState.redirectUri)
        launcherRedirectUrl.searchParams.set("code", hikatAuthCode)
        if (oauthState.clientState) {
          launcherRedirectUrl.searchParams.set("state", oauthState.clientState)
        }
        return redirectResponse(launcherRedirectUrl.toString())
      }

      // Default browser login flow
      const sessionResult = await resolveOAuthUser(db, profile, keyManager)
      return jsonResponse({
        accessToken: sessionResult.accessToken,
        refreshToken: sessionResult.refreshToken,
        expiresIn: sessionResult.expiresIn,
        tokenType: "Bearer",
        user: sessionResult.user,
      })
    }

    // 17. Discord OAuth Callback
    if (pathname === "/oauth/discord/callback" && method === "GET") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")

      if (error || !code || !state) {
        return errorResponse(AuthErrorCode.INVALID_STATE, error || "Missing code or state", 400)
      }

      const oauthState = await consumeOAuthState(db, state)
      const redirectUri = `${authServiceUrl}/oauth/discord/callback`

      const profile = await exchangeDiscordCode(
        code,
        redirectUri,
        {
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
        },
        oauthFetcher,
      )

      // Handle LINK flow with active session verification
      if (oauthState.flowType === "LINK") {
        if (!oauthState.userId || !oauthState.sessionId) {
          return errorResponse(AuthErrorCode.UNAUTHORIZED, "Invalid linking state", 401)
        }

        const isSessionActive = await validateActiveSession(db, oauthState.sessionId, oauthState.userId)
        if (!isSessionActive) {
          return errorResponse(AuthErrorCode.UNAUTHORIZED, "Linking session expired or was revoked", 401)
        }

        await linkOAuthAccount(db, oauthState.userId, oauthState.sessionId, profile)
        if (oauthState.redirectUri) {
          const redirectUrl = new URL(oauthState.redirectUri)
          redirectUrl.searchParams.set("linked", "discord")
          redirectUrl.searchParams.set("success", "true")
          if (oauthState.clientState) {
            redirectUrl.searchParams.set("state", oauthState.clientState)
          }
          return redirectResponse(redirectUrl.toString())
        }
        return jsonResponse({ success: true, provider: "DISCORD", message: "Discord account linked successfully" })
      }

      // Handle LAUNCHER flow: generate short HiKAT authorization code bound to PKCE (NO intermediate session created!)
      if (oauthState.flowType === "LAUNCHER" && oauthState.redirectUri && oauthState.codeChallenge) {
        let user: { id: string }
        try {
          user = await getOrCreateOAuthUser(db, profile)
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          if (errMsg === AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED) {
            const redirectUrl = new URL(oauthState.redirectUri)
            redirectUrl.searchParams.set("error", AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED)
            redirectUrl.searchParams.set("email", profile.email || "")
            if (oauthState.clientState) {
              redirectUrl.searchParams.set("state", oauthState.clientState)
            }
            return redirectResponse(redirectUrl.toString())
          }
          throw err
        }

        const hikatAuthCode = await createAuthorizationCode(db, {
          userId: user.id,
          codeChallenge: oauthState.codeChallenge,
          codeChallengeMethod: oauthState.codeChallengeMethod || "S256",
          redirectUri: oauthState.redirectUri,
        })

        const launcherRedirectUrl = new URL(oauthState.redirectUri)
        launcherRedirectUrl.searchParams.set("code", hikatAuthCode)
        if (oauthState.clientState) {
          launcherRedirectUrl.searchParams.set("state", oauthState.clientState)
        }
        return redirectResponse(launcherRedirectUrl.toString())
      }

      // Default browser login flow
      const sessionResult = await resolveOAuthUser(db, profile, keyManager)
      return jsonResponse({
        accessToken: sessionResult.accessToken,
        refreshToken: sessionResult.refreshToken,
        expiresIn: sessionResult.expiresIn,
        tokenType: "Bearer",
        user: sessionResult.user,
      })
    }

    // 18. Launcher PKCE Token Exchange: POST /oauth/token
    if (pathname === "/oauth/token" && method === "POST") {
      const rate = await checkRateLimit(db, `oauth-token:${clientIp}`, 20, 60, { isProduction })
      if (!rate.allowed) {
        return errorResponse(AuthErrorCode.RATE_LIMITED, "Too many token exchange requests", 429)
      }

      let body: Record<string, string> = {}
      const contentType = request.headers.get("Content-Type") || ""

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await request.formData()
        formData.forEach((val, key) => {
          body[key] = String(val)
        })
      } else {
        body = (await request.json().catch(() => ({}))) as Record<string, string>
      }

      const grantType = body.grant_type
      const code = body.code
      const codeVerifier = body.code_verifier
      const redirectUri = body.redirect_uri

      if (grantType !== "authorization_code") {
        return errorResponse("UNSUPPORTED_GRANT_TYPE", "Only authorization_code grant is supported", 400)
      }

      if (!code || !codeVerifier || !redirectUri) {
        return errorResponse(AuthErrorCode.INVALID_TOKEN, "code, code_verifier, and redirect_uri are required", 400)
      }

      if (!isAllowedRedirectUri(redirectUri)) {
        return errorResponse(AuthErrorCode.INVALID_REDIRECT_URI, "Unauthorized redirect URI", 400)
      }

      const authCode = await consumeAuthorizationCode(db, code, codeVerifier, redirectUri)

      // Fetch user entity
      const user = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, authCode.userId))
        .get()

      if (!user) {
        return errorResponse(AuthErrorCode.UNAUTHORIZED, "User not found", 401)
      }

      // Create new session for Launcher
      const session = await createSession(
        db,
        {
          id: user.id,
          role: user.role,
          displayName: user.displayName,
        },
        keyManager,
      )

      return jsonResponse({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        tokenType: "Bearer",
        user: session.user,
      })
    }

    // 404 Fallback
    return errorResponse("NOT_FOUND", `Endpoint ${method} ${pathname} not found`, 404)
  } catch (err: unknown) {
    const errorString = err instanceof Error ? err.message : String(err)

    if (errorString === AuthErrorCode.INVALID_CREDENTIALS) {
      return errorResponse(AuthErrorCode.INVALID_CREDENTIALS, "Invalid email or password", 401)
    }
    if (errorString === AuthErrorCode.USER_ALREADY_EXISTS) {
      return errorResponse(AuthErrorCode.USER_ALREADY_EXISTS, "An account with this email already exists", 409)
    }
    if (errorString === AuthErrorCode.EMAIL_NOT_VERIFIED) {
      return errorResponse(AuthErrorCode.EMAIL_NOT_VERIFIED, "Email verification is required before obtaining Game JWT", 403)
    }
    if (errorString === AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED) {
      return errorResponse(AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED, "An account with this email exists. Please log in and link account explicitly.", 409)
    }
    if (errorString === AuthErrorCode.LAST_AUTH_METHOD) {
      return errorResponse(AuthErrorCode.LAST_AUTH_METHOD, "Cannot unlink the last remaining authentication method", 400)
    }
    if (errorString === AuthErrorCode.PROVIDER_ALREADY_LINKED) {
      return errorResponse(AuthErrorCode.PROVIDER_ALREADY_LINKED, "This external account is already linked to another user", 409)
    }
    if (errorString === AuthErrorCode.TOKEN_REUSE_DETECTED) {
      return errorResponse(AuthErrorCode.TOKEN_REUSE_DETECTED, "Security alert: token reuse detected. Session has been revoked.", 401)
    }
    if (errorString === AuthErrorCode.TOKEN_EXPIRED) {
      return errorResponse(AuthErrorCode.TOKEN_EXPIRED, "Token has expired or was revoked", 401)
    }
    if (errorString === AuthErrorCode.INVALID_TOKEN || errorString === AuthErrorCode.INVALID_PKCE || errorString === AuthErrorCode.INVALID_STATE) {
      return errorResponse(errorString, "Invalid or malformed token/state", 400)
    }
    if (errorString === AuthErrorCode.UNAUTHORIZED) {
      return errorResponse(AuthErrorCode.UNAUTHORIZED, "Unauthorized or session revoked", 401)
    }
    if (errorString === AuthErrorCode.RATE_LIMITED) {
      return errorResponse(AuthErrorCode.RATE_LIMITED, "Rate limit exceeded. Please try again later.", 429)
    }

    return errorResponse("INTERNAL_ERROR", errorString || "Internal server error", 500)
  }
}
