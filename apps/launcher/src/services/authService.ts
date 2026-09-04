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
  generateCodeVerifier,
  generateCodeChallenge,
  generateRandomState,
} from "@hikat/shared"
import { sanitizeUsername, sanitizeEmail, sanitizeInput } from "../utils/security"

export const AUTH_URL = import.meta.env.VITE_AUTH_API_URL || "http://localhost:8788"

export interface UserProfile {
  id: string
  username: string
  displayName?: string
  email: string
  role?: string
  createdAt?: string
}

export interface LinkedAuthMethod {
  type: "PASSWORD" | "GOOGLE" | "DISCORD"
  email?: string
  displayName?: string
  verified?: boolean
  linkedAt?: string
}

export interface LoginCredentials {
  email: string
  password?: string
  keepSession?: boolean
}

export interface RegisterCredentials {
  username: string
  email: string
  password?: string
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
          localStorage.setItem(
            "hikat_last_user",
            JSON.stringify({
              id: session.user.id,
              username: session.user.displayName || session.user.email.split("@")[0] || "Jugador",
              displayName: session.user.displayName || session.user.email.split("@")[0] || "Jugador",
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

  constructor(storageAdapter?: AuthStorageAdapter) {
    this.client = new AuthClientCore({
      authServiceUrl: AUTH_URL,
      allowedRole: "PLAYER",
      storageAdapter: storageAdapter || createLauncherStorageAdapter(),
    })
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
    return {
      id: u.id,
      username: u.displayName || u.email.split("@")[0] || "Jugador",
      displayName: u.displayName || u.email.split("@")[0] || "Jugador",
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
      if (parsed && (typeof parsed.username === "string" || typeof parsed.email === "string")) {
        return {
          id: parsed.id || "",
          username: sanitizeUsername(parsed.username || parsed.displayName || parsed.email?.split("@")[0]) || "Jugador",
          displayName: sanitizeUsername(parsed.displayName || parsed.username || parsed.email?.split("@")[0]) || "Jugador",
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
  }> {
    const cleanEmail = sanitizeEmail(credentials.email)
    const password = credentials.password || ""
    const keepSession = credentials.keepSession ?? true

    if (!cleanEmail || !password) {
      return {
        success: false,
        error: "Por favor ingresa tu correo y contraseña.",
      }
    }

    try {
      const user = await this.client.login(cleanEmail, password, keepSession)
      const token = this.client.getAccessToken() || ""
      return {
        success: true,
        user: {
          id: user.id,
          username: user.displayName || user.email.split("@")[0] || "Jugador",
          displayName: user.displayName || user.email.split("@")[0] || "Jugador",
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
        token,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Error al iniciar sesión.",
      }
    }
  }

  public async register(credentials: RegisterCredentials): Promise<{
    success: boolean
    user?: UserProfile
    emailVerificationRequired?: boolean
    error?: string
  }> {
    const cleanUsername = sanitizeUsername(credentials.username)
    const cleanEmail = sanitizeEmail(credentials.email)
    const password = credentials.password || ""

    if (!cleanEmail || !password) {
      return {
        success: false,
        error: "El correo electrónico y la contraseña son obligatorios.",
      }
    }

    if (password.length < 8) {
      return {
        success: false,
        error: "La contraseña debe tener al menos 8 caracteres.",
      }
    }

    try {
      const res = await this.client.register(cleanEmail, password, cleanUsername)
      return {
        success: true,
        user: {
          id: res.user.id,
          username: res.user.displayName || cleanUsername || cleanEmail.split("@")[0],
          displayName: res.user.displayName || cleanUsername || cleanEmail.split("@")[0],
          email: res.user.email,
          role: res.user.role,
          createdAt: res.user.createdAt,
        },
        emailVerificationRequired: res.emailVerificationRequired,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Error al registrar la cuenta.",
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

  public clearSession(): void {
    this.client.clearSession()
  }

  public setSession(session: SessionState, persist = true): Promise<void> {
    return this.client.setSession(session, persist)
  }

  public async requestPasswordReset(email: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await fetch(`${AUTH_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sanitizeEmail(email) }),
      })
      const data = await res.json().catch(() => ({}))
      return { success: res.ok, message: data.message, error: data.error }
    } catch {
      return { success: false, error: "Error al solicitar restablecimiento de contraseña" }
    }
  }

  public async verifyEmail(token: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const rawToken = typeof token === "string" ? token.trim() : ""
    if (!rawToken || rawToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(rawToken)) {
      return { success: false, error: "Token de verificación no proporcionado o inválido." }
    }
    try {
      const res = await fetch(`${AUTH_URL}/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { success: false, error: data.error || data.message || "Error al verificar el correo." }
      }
      return { success: true, message: data.message }
    } catch {
      return { success: false, error: "Error de conexión al verificar el correo." }
    }
  }

  public async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const rawToken = typeof token === "string" ? token.trim() : ""
    const cleanPass = newPassword || ""

    if (!rawToken || rawToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(rawToken) || !cleanPass) {
      return { success: false, error: "Token y nueva contraseña requeridos." }
    }
    if (cleanPass.length < 8) {
      return { success: false, error: "La contraseña debe tener al menos 8 caracteres." }
    }

    try {
      const res = await fetch(`${AUTH_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken, newPassword: cleanPass }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { success: false, error: data.error || data.message || "Error al restablecer la contraseña." }
      }
      return { success: true, message: data.message }
    } catch {
      return { success: false, error: "Error de conexión al restablecer la contraseña." }
    }
  }

  // --- OAuth PKCE Integration ---

  public async initiateOAuth(
    provider: "GOOGLE" | "DISCORD",
    keepSession = true,
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
      throw new Error("Estado de autenticación inválido o sesión OAuth expirada.")
    }

    if (params.expectedState && params.state !== params.expectedState) {
      throw new Error("Estado de autenticación inválido (posible ataque CSRF).")
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

      return {
        id: user.id,
        username: user.displayName || user.email.split("@")[0] || "Jugador",
        displayName: user.displayName || user.email.split("@")[0] || "Jugador",
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

  public async getLinkedMethods(): Promise<{ success: boolean; methods?: LinkedAuthMethod[]; error?: string }> {
    try {
      const token = await this.ensureValidAccessToken()
      if (!token) {
        return { success: false, error: "No se encontró sesión activa." }
      }
      const res = await fetch(`${AUTH_URL}/auth/me/methods`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { success: false, error: data.error || data.message || `HTTP ${res.status}` }
      }
      const data = await res.json()
      return { success: true, methods: data.methods || [] }
    } catch (err: any) {
      return { success: false, error: err?.message || "Error al consultar métodos de autenticación." }
    }
  }
}

export const authService = new LauncherAuthService()
