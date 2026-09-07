/**
 * Centralized Authentication Service for HiKAT Launcher
 * Powered by unified AuthClientCore with strict PLAYER role enforcement,
 * single-flight token rotation, and Electron Main secure storage persistence.
 */

import {
  AuthClientCore,
  AuthStorageAdapter,
  SessionState,
  AuthStatus,
  AuthMethodSummary,
  generateCodeVerifier,
  generateCodeChallenge,
  generateRandomState,
  isValidUsername,
  AuthErrorCode,
} from "@hikat/shared"
import { sanitizeUsername, sanitizeEmail, sanitizeInput } from "../utils/security"

export const AUTH_URL = import.meta.env.VITE_AUTH_API_URL || "http://localhost:8788"

export interface UserProfile {
  id: string
  username: string
  displayName?: string | null
  suggestedUsername?: string
  email: string
  role?: string
  createdAt?: string
}

export type { AuthMethodSummary }

export interface LoginCredentials {
  email: string
  password?: string
  keepSession?: boolean
}

export interface RegisterCredentials {
  username: string
  email: string
  password?: string
  locale?: string
}

/**
 * Storage adapter bridging strictly to Electron Main's SecureAuthStore (safeStorage).
 * No refresh tokens or full session secrets are ever stored in renderer localStorage.
 */
export function createLauncherStorageAdapter(): AuthStorageAdapter {
  return {
    loadSession: async () => {
      // Clean any legacy insecure token storage from previous versions
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("hikat_auth_session")
          localStorage.removeItem("hikat_auth_token")
          localStorage.removeItem("hikat_refresh_token")
        }
      } catch (_) { }

      if (typeof window !== "undefined" && window.electronAPI?.authLoadSession) {
        try {
          const session = await window.electronAPI.authLoadSession()
          if (session && session.accessToken && session.refreshToken && session.user) {
            return session as SessionState
          }
        } catch (_) { }
      }
      return null
    },

    saveSession: async (session) => {
      if (typeof window !== "undefined" && window.electronAPI?.authSaveSession) {
        try {
          await window.electronAPI.authSaveSession(session)
        } catch (_) { }
      }

      // In Renderer localStorage, ONLY cache non-sensitive user profile for instant UI display
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("hikat_auth_session")
          localStorage.removeItem("hikat_auth_token")
          localStorage.removeItem("hikat_refresh_token")
          const validDisplayName = session.user.displayName && session.user.displayName.trim()
            ? session.user.displayName.trim()
            : null
          localStorage.setItem(
            "hikat_last_user",
            JSON.stringify({
              id: session.user.id,
              username: validDisplayName || "",
              displayName: validDisplayName,
              suggestedUsername: session.user.suggestedUsername,
              email: session.user.email,
              role: session.user.role,
              createdAt: session.user.createdAt,
            }),
          )
        }
      } catch (_) { }
    },

    clearSession: async () => {
      if (typeof window !== "undefined" && window.electronAPI?.authClearSession) {
        try {
          await window.electronAPI.authClearSession()
        } catch (_) { }
      }
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("hikat_auth_session")
          localStorage.removeItem("hikat_auth_token")
          localStorage.removeItem("hikat_refresh_token")
          localStorage.removeItem("hikat_last_user")
        }
      } catch (_) { }
    },
  }
}

class LauncherAuthService {
  private client: AuthClientCore
  private cooldowns = new Map<string, number>()

  constructor(storageAdapter?: AuthStorageAdapter) {
    this.client = new AuthClientCore({
      authServiceUrl: AUTH_URL,
      allowedRole: "PLAYER",
      storageAdapter: storageAdapter || createLauncherStorageAdapter(),
    })
  }

  public setCooldown(action: "verify" | "reset", email: string, seconds = 60): void {
    const cleanEmail = sanitizeEmail(email).toLowerCase()
    if (!cleanEmail) return
    const key = `${action}:${cleanEmail}`
    const expiresAt = Date.now() + seconds * 1000
    this.cooldowns.set(key, expiresAt)
  }

  public getRemainingCooldown(action: "verify" | "reset", email: string): number {
    const cleanEmail = sanitizeEmail(email).toLowerCase()
    if (!cleanEmail) return 0
    const key = `${action}:${cleanEmail}`
    const expiresAt = this.cooldowns.get(key)
    if (!expiresAt) return 0
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000)
    if (remaining <= 0) {
      this.cooldowns.delete(key)
      return 0
    }
    return remaining
  }

  public subscribe(listener: (session: SessionState | null, status: AuthStatus) => void): () => void {
    return this.client.subscribe(listener)
  }

  public getStatus(): AuthStatus {
    return this.client.getStatus()
  }

  public async bootstrap(): Promise<SessionState | null> {
    return this.client.bootstrap()
  }

  public getAccessToken(): string | null {
    return this.client.getAccessToken()
  }

  public getRefreshToken(): string | null {
    return this.client.getRefreshToken()
  }

  public getStoredToken(): string | null {
    return this.client.getAccessToken()
  }

  public getUser(): UserProfile | null {
    const u = this.client.getUser()
    if (!u) return this.getCachedUser()
    const validDisplayName = u.displayName && u.displayName.trim() ? u.displayName.trim() : null
    return {
      id: u.id,
      username: validDisplayName || "",
      displayName: validDisplayName,
      suggestedUsername: u.suggestedUsername,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    }
  }

  public getCachedUser(): UserProfile | null {
    try {
      if (typeof localStorage === "undefined") return null
      const saved = localStorage.getItem("hikat_last_user")
      if (!saved) return null
      const parsed = JSON.parse(saved)
      if (parsed && (typeof parsed.username === "string" || typeof parsed.email === "string" || typeof parsed.id === "string")) {
        const rawDisplayName = parsed.displayName ?? parsed.username ?? null
        const validDisplayName = typeof rawDisplayName === "string" && rawDisplayName.trim() ? rawDisplayName.trim() : null
        return {
          id: parsed.id || "",
          username: validDisplayName || "",
          displayName: validDisplayName,
          suggestedUsername: typeof parsed.suggestedUsername === "string" ? parsed.suggestedUsername : undefined,
          email: sanitizeEmail(parsed.email || ""),
          role: parsed.role || "PLAYER",
          createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
        }
      }
      return null
    } catch (_) {
      return null
    }
  }

  public async login(credentials: LoginCredentials): Promise<{
    success: boolean
    user?: UserProfile
    token?: string
    error?: string
    code?: string
    errorCode?: string
  }> {
    const cleanEmail = sanitizeEmail(credentials.email)
    const password = credentials.password || ""
    const keepSession = credentials.keepSession ?? true

    if (!cleanEmail || !password) {
      return {
        success: false,
        error: "Por favor ingresa tu correo y contraseña.",
        code: "MISSING_FIELDS",
        errorCode: "MISSING_FIELDS",
      }
    }

    try {
      const user = await this.client.login(cleanEmail, password, keepSession)
      return {
        success: true,
        user: {
          id: user.id,
          username: user.displayName || cleanEmail.split("@")[0],
          displayName: user.displayName || cleanEmail.split("@")[0],
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
        token: this.client.getAccessToken() || undefined,
      }
    } catch (err: any) {
      const errCode = err?.code || err?.errorCode || (
        err?.message === "EMAIL_NOT_VERIFIED" || err?.message?.includes("EMAIL_NOT_VERIFIED")
          ? AuthErrorCode.EMAIL_NOT_VERIFIED
          : err?.message?.includes("Credenciales") || err?.message?.includes("Invalid credentials")
            ? AuthErrorCode.INVALID_CREDENTIALS
            : "LOGIN_FAILED"
      )
      return {
        success: false,
        error: err.message || "Error al iniciar sesión.",
        code: errCode,
        errorCode: errCode,
      }
    }
  }

  public async register(credentials: RegisterCredentials): Promise<{
    success: boolean
    user?: UserProfile
    emailVerificationRequired?: boolean
    retryAfterSeconds?: number
    error?: string
    code?: string
    errorCode?: string
  }> {
    const rawUsername = typeof credentials.username === "string" ? credentials.username.trim() : ""
    const cleanEmail = sanitizeEmail(credentials.email)
    const password = credentials.password || ""
    const locale = credentials.locale

    if (!rawUsername || !cleanEmail || !password) {
      return {
        success: false,
        error: "Todos los campos son obligatorios.",
        code: "MISSING_FIELDS",
        errorCode: "MISSING_FIELDS",
      }
    }

    if (!isValidUsername(rawUsername)) {
      return {
        success: false,
        error: "El nombre de usuario debe tener entre 3 y 16 caracteres y solo contener letras, números y guion bajo.",
        code: AuthErrorCode.INVALID_USERNAME,
        errorCode: AuthErrorCode.INVALID_USERNAME,
      }
    }

    if (password.length < 8) {
      return {
        success: false,
        error: "La contraseña debe tener al menos 8 caracteres.",
        code: "PASSWORD_TOO_SHORT",
        errorCode: "PASSWORD_TOO_SHORT",
      }
    }

    try {
      const res = await this.client.register(cleanEmail, password, rawUsername, locale)
      if (res.emailVerificationRequired) {
        const retryAfter = res.retryAfterSeconds ?? 60
        this.setCooldown("verify", cleanEmail, retryAfter)
      }
      return {
        success: true,
        user: {
          id: res.user.id,
          username: res.user.displayName || rawUsername,
          displayName: res.user.displayName || rawUsername,
          email: res.user.email,
          role: res.user.role,
          createdAt: res.user.createdAt,
        },
        emailVerificationRequired: res.emailVerificationRequired,
        retryAfterSeconds: res.retryAfterSeconds,
      }
    } catch (err: any) {
      const errCode = err?.code || err?.errorCode || (
        err?.message?.includes("ya está registrado") || err?.message === AuthErrorCode.USER_ALREADY_EXISTS
          ? AuthErrorCode.USER_ALREADY_EXISTS
          : err?.message === AuthErrorCode.USERNAME_ALREADY_EXISTS || err?.message?.includes("USERNAME_ALREADY_EXISTS") || err?.message?.includes("taken")
            ? AuthErrorCode.USERNAME_ALREADY_EXISTS
            : err?.message === AuthErrorCode.INVALID_USERNAME || err?.message?.includes("INVALID_USERNAME")
              ? AuthErrorCode.INVALID_USERNAME
              : "REGISTRATION_FAILED"
      )
      return {
        success: false,
        error: err.message || "Error al registrar la cuenta.",
        code: errCode,
        errorCode: errCode,
      }
    }
  }

  public async getValidAccessTokenOutcome(bufferSeconds = 60) {
    return this.client.getValidAccessTokenOutcome(bufferSeconds)
  }

  public async ensureValidAccessToken(bufferSeconds = 60): Promise<string | null> {
    return this.client.ensureValidAccessToken(bufferSeconds)
  }

  public async refreshOutcome() {
    return this.client.refreshOutcome()
  }

  public async refresh(): Promise<string | null> {
    return this.client.refresh()
  }

  public async logout(): Promise<void> {
    await this.client.logout()
  }

  public clearCooldowns(): void {
    this.cooldowns.clear()
  }

  public clearSession(): void {
    this.client.clearSession()
    this.clearCooldowns()
  }

  public setSession(session: SessionState, persist = true): Promise<void> {
    return this.client.setSession(session, persist)
  }

  public async requestPasswordReset(
    email: string,
    locale?: string,
  ): Promise<{
    success: boolean
    message?: string
    error?: string
    code?: string
    errorCode?: string
    retryAfterSeconds?: number
  }> {
    const cleanEmail = sanitizeEmail(email)
    if (!cleanEmail) {
      return {
        success: false,
        error: "Correo electrónico no proporcionado.",
        code: "MISSING_FIELDS",
        errorCode: "MISSING_FIELDS",
      }
    }
    try {
      const res = await fetch(`${AUTH_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, locale: locale || undefined }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, any>
      const retryAfter =
        typeof data.retryAfterSeconds === "number"
          ? data.retryAfterSeconds
          : res.ok
            ? 60
            : undefined
      if (retryAfter !== undefined) {
        this.setCooldown("reset", cleanEmail, retryAfter)
      }
      if (!res.ok) {
        const code =
          data.code ||
          data.error ||
          (res.status === 429
            ? AuthErrorCode.RATE_LIMITED
            : "RESET_EMAIL_ERROR")
        return {
          success: false,
          error: data.message || data.error || code,
          code,
          errorCode: code,
          retryAfterSeconds: retryAfter,
        }
      }
      return {
        success: true,
        message: data.message,
        retryAfterSeconds: retryAfter,
      }
    } catch {
      return {
        success: false,
        error: "Error al solicitar restablecimiento de contraseña",
        code: "NETWORK_ERROR",
        errorCode: "NETWORK_ERROR",
      }
    }
  }

  public async requestEmailVerification(
    email: string,
    locale?: string,
  ): Promise<{
    success: boolean
    message?: string
    error?: string
    code?: string
    errorCode?: string
    retryAfterSeconds?: number
  }> {
    const cleanEmail = sanitizeEmail(email)
    if (!cleanEmail) {
      return {
        success: false,
        error: "Correo electrónico no proporcionado.",
        code: "MISSING_FIELDS",
        errorCode: "MISSING_FIELDS",
      }
    }
    try {
      const res = await fetch(`${AUTH_URL}/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, locale: locale || undefined }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, any>
      const retryAfter =
        typeof data.retryAfterSeconds === "number"
          ? data.retryAfterSeconds
          : res.ok
            ? 60
            : undefined
      if (retryAfter !== undefined) {
        this.setCooldown("verify", cleanEmail, retryAfter)
      }
      if (!res.ok) {
        const code =
          data.code ||
          data.error ||
          (res.status === 429
            ? AuthErrorCode.RATE_LIMITED
            : "RESEND_VERIFICATION_ERROR")
        return {
          success: false,
          error: data.message || data.error || code,
          code,
          errorCode: code,
          retryAfterSeconds: retryAfter,
        }
      }
      return {
        success: true,
        message: data.message,
        retryAfterSeconds: retryAfter,
      }
    } catch {
      return {
        success: false,
        error: "Error al solicitar reenvío de verificación.",
        code: "NETWORK_ERROR",
        errorCode: "NETWORK_ERROR",
      }
    }
  }

  public async verifyEmail(
    token: string,
  ): Promise<{
    success: boolean
    message?: string
    error?: string
    code?: string
    errorCode?: string
  }> {
    const rawToken = typeof token === "string" ? token.trim() : ""
    if (!rawToken || rawToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(rawToken)) {
      return {
        success: false,
        error: "Token de verificación no proporcionado o inválido.",
        code: AuthErrorCode.INVALID_TOKEN,
        errorCode: AuthErrorCode.INVALID_TOKEN,
      }
    }
    try {
      const res = await fetch(`${AUTH_URL}/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, any>
      if (!res.ok) {
        const code =
          data.code ||
          data.error ||
          (res.status === 400 || res.status === 404
            ? AuthErrorCode.INVALID_TOKEN
            : res.status === 410
              ? AuthErrorCode.TOKEN_EXPIRED
              : "VERIFY_EMAIL_ERROR")
        return {
          success: false,
          error: data.error || data.message || code,
          code,
          errorCode: code,
        }
      }
      return { success: true, message: data.message }
    } catch {
      return {
        success: false,
        error: "Error de conexión al verificar el correo.",
        code: "NETWORK_ERROR",
        errorCode: "NETWORK_ERROR",
      }
    }
  }

  public async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{
    success: boolean
    message?: string
    error?: string
    code?: string
    errorCode?: string
  }> {
    const rawToken = typeof token === "string" ? token.trim() : ""
    const cleanPass = newPassword || ""

    if (!rawToken || rawToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(rawToken) || !cleanPass) {
      return {
        success: false,
        error: "Token y nueva contraseña requeridos.",
        code: "MISSING_FIELDS",
        errorCode: "MISSING_FIELDS",
      }
    }
    if (cleanPass.length < 8) {
      return {
        success: false,
        error: "La contraseña debe tener al menos 8 caracteres.",
        code: "PASSWORD_TOO_SHORT",
        errorCode: "PASSWORD_TOO_SHORT",
      }
    }

    try {
      const res = await fetch(`${AUTH_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken, newPassword: cleanPass }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, any>
      if (!res.ok) {
        const code =
          data.code ||
          data.error ||
          (res.status === 400 || res.status === 404
            ? AuthErrorCode.INVALID_TOKEN
            : res.status === 410
              ? AuthErrorCode.TOKEN_EXPIRED
              : "RESET_PASSWORD_ERROR")
        return {
          success: false,
          error: data.error || data.message || code,
          code,
          errorCode: code,
        }
      }
      return { success: true, message: data.message }
    } catch {
      return {
        success: false,
        error: "Error de conexión al restablecer la contraseña.",
        code: "NETWORK_ERROR",
        errorCode: "NETWORK_ERROR",
      }
    }
  }

  // --- OAuth PKCE Integration ---

  public async initiateOAuth(
    provider: "GOOGLE" | "DISCORD",
    keepSession = true,
    locale?: string,
  ): Promise<{
    authUrl: string
    codeVerifier: string
    state: string
  }> {
    const codeVerifier = generateCodeVerifier(64)
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateRandomState(32)
    const redirectUri = "http://127.0.0.1:47821/auth/callback"

    const authUrl = this.client.createOAuthAuthorizationUrl({
      provider,
      redirectUri,
      state,
      codeChallenge,
    })

    // Store pending PKCE state in Electron Main store (persists across cold restarts)
    if (typeof window !== "undefined" && window.electronAPI?.authSavePendingOAuth) {
      try {
        await window.electronAPI.authSavePendingOAuth({
          provider,
          codeVerifier,
          state,
          keepSession,
          locale: locale || undefined,
          expiresAt: Date.now() + 10 * 60 * 1000,
        })
      } catch (_) { }
    }

    // Web fallback
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("hikat_launcher_oauth_verifier", codeVerifier)
        sessionStorage.setItem("hikat_launcher_oauth_state", state)
        sessionStorage.setItem("hikat_launcher_oauth_keep_session", keepSession ? "true" : "false")
      }
    } catch (_) { }

    return { authUrl, codeVerifier, state }
  }

  public async handleOAuthCallback(params: {
    code: string
    codeVerifier?: string
    state: string
    expectedState?: string
    keepSession?: boolean
  }): Promise<UserProfile> {
    let verifier = params.codeVerifier || ""
    let keepSession = params.keepSession

    // If verifier or keepSession not passed directly, fetch from Electron Main pending OAuth store
    if ((!verifier || keepSession === undefined) && typeof window !== "undefined" && window.electronAPI?.authGetPendingOAuth) {
      try {
        const pending = await window.electronAPI.authGetPendingOAuth(params.state)
        if (pending) {
          if (!verifier && pending.codeVerifier) {
            verifier = pending.codeVerifier
          }
          if (keepSession === undefined && typeof pending.keepSession === "boolean") {
            keepSession = pending.keepSession
          }
        }
      } catch (_) { }
    }

    // Fallback to sessionStorage
    if (!verifier && typeof sessionStorage !== "undefined") {
      const savedState = sessionStorage.getItem("hikat_launcher_oauth_state")
      if (savedState === params.state) {
        verifier = sessionStorage.getItem("hikat_launcher_oauth_verifier") || ""
      }
    }
    if (keepSession === undefined && typeof sessionStorage !== "undefined") {
      const savedKeep = sessionStorage.getItem("hikat_launcher_oauth_keep_session")
      if (savedKeep !== null) {
        keepSession = savedKeep === "true"
      }
    }

    if (!verifier) {
      if (typeof window !== "undefined" && window.electronAPI?.authClearPendingOAuth) {
        try {
          const p = window.electronAPI.authClearPendingOAuth()
          if (p && typeof p.catch === "function") p.catch(() => { })
        } catch (_) { }
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("hikat_launcher_oauth_verifier")
        sessionStorage.removeItem("hikat_launcher_oauth_state")
        sessionStorage.removeItem("hikat_launcher_oauth_keep_session")
      }
      const err: any = new Error("Estado de autenticación inválido o sesión OAuth expirada.")
      err.code = AuthErrorCode.INVALID_STATE
      throw err
    }

    if (params.expectedState && params.state !== params.expectedState) {
      if (typeof window !== "undefined" && window.electronAPI?.authClearPendingOAuth) {
        try {
          const p = window.electronAPI.authClearPendingOAuth()
          if (p && typeof p.catch === "function") p.catch(() => { })
        } catch (_) { }
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("hikat_launcher_oauth_verifier")
        sessionStorage.removeItem("hikat_launcher_oauth_state")
        sessionStorage.removeItem("hikat_launcher_oauth_keep_session")
      }
      const err: any = new Error("Estado de autenticación inválido (posible ataque CSRF).")
      err.code = AuthErrorCode.INVALID_STATE
      throw err
    }

    const finalKeepSession = typeof keepSession === "boolean" ? keepSession : true

    try {
      const user = await this.client.exchangeOAuthCode(
        {
          code: params.code,
          codeVerifier: verifier,
          redirectUri: "http://127.0.0.1:47821/auth/callback",
        },
        finalKeepSession,
      )

      // Mark OAuth completed in Electron Main so /auth/status endpoint knows it's completed
      if (typeof window !== "undefined" && window.electronAPI?.authMarkOAuthCompleted && params.state) {
        try {
          const p = window.electronAPI.authMarkOAuthCompleted(params.state)
          if (p && typeof p.catch === "function") p.catch(() => { })
        } catch (_) { }
      }

      // Clean pending state on success
      if (typeof window !== "undefined" && window.electronAPI?.authClearPendingOAuth) {
        try {
          const p = window.electronAPI.authClearPendingOAuth()
          if (p && typeof p.catch === "function") p.catch(() => { })
        } catch (_) { }
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("hikat_launcher_oauth_verifier")
        sessionStorage.removeItem("hikat_launcher_oauth_state")
        sessionStorage.removeItem("hikat_launcher_oauth_keep_session")
      }

      const validDisplayName = user.displayName && user.displayName.trim() ? user.displayName.trim() : null
      return {
        id: user.id,
        username: validDisplayName || "",
        displayName: validDisplayName,
        suggestedUsername: user.suggestedUsername,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      }
    } catch (err) {
      // Clean pending state on error
      if (typeof window !== "undefined" && window.electronAPI?.authClearPendingOAuth) {
        try {
          const p = window.electronAPI.authClearPendingOAuth()
          if (p && typeof p.catch === "function") p.catch(() => { })
        } catch (_) { }
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("hikat_launcher_oauth_verifier")
        sessionStorage.removeItem("hikat_launcher_oauth_state")
        sessionStorage.removeItem("hikat_launcher_oauth_keep_session")
      }
      throw err
    }
  }

  public async getAuthMethods(): Promise<{
    success: boolean
    methods?: AuthMethodSummary[]
    error?: string
    code?: string
    errorCode?: string
  }> {
    try {
      const token = await this.ensureValidAccessToken()
      if (!token) {
        return {
          success: false,
          error: "No se encontró sesión activa.",
          code: "NO_SESSION",
          errorCode: "NO_SESSION",
        }
      }
      const res = await fetch(`${AUTH_URL}/auth/me/methods`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, any>
        const code = data.code || data.error || `HTTP_${res.status}`
        return {
          success: false,
          error: data.error || data.message || code,
          code,
          errorCode: code,
        }
      }
      const data = await res.json()
      return { success: true, methods: data.methods || [] }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Error al consultar métodos de autenticación.",
        code: "NETWORK_ERROR",
        errorCode: "NETWORK_ERROR",
      }
    }
  }

  public async changeUsername(newUsername: string): Promise<{
    success: boolean
    user?: UserProfile
    error?: string
    code?: string
    errorCode?: string
  }> {
    const trimmed = typeof newUsername === "string" ? newUsername.trim() : ""
    if (!trimmed || !isValidUsername(trimmed)) {
      return {
        success: false,
        error: "INVALID_USERNAME",
        code: AuthErrorCode.INVALID_USERNAME,
        errorCode: AuthErrorCode.INVALID_USERNAME,
      }
    }
    try {
      const user = await this.client.changeUsername(trimmed)
      return {
        success: true,
        user: {
          id: user.id,
          username: user.displayName || trimmed,
          displayName: user.displayName || trimmed,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
      }
    } catch (err: any) {
      const rawCode = err?.code || err?.errorCode || ""
      const rawMessage = err?.message || ""
      let code = rawCode
      if (
        rawMessage === AuthErrorCode.USERNAME_ALREADY_EXISTS ||
        rawCode === AuthErrorCode.USERNAME_ALREADY_EXISTS ||
        rawMessage.includes("USERNAME_ALREADY_EXISTS")
      ) {
        code = AuthErrorCode.USERNAME_ALREADY_EXISTS
      } else if (
        rawMessage === AuthErrorCode.INVALID_USERNAME ||
        rawCode === AuthErrorCode.INVALID_USERNAME ||
        rawMessage.includes("INVALID_USERNAME")
      ) {
        code = AuthErrorCode.INVALID_USERNAME
      } else if (!code) {
        code = "USERNAME_CHANGE_ERROR"
      }
      return {
        success: false,
        error: rawMessage || code,
        code,
        errorCode: code,
      }
    }
  }
}

export const authService = new LauncherAuthService()
