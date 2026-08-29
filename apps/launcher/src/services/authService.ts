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
 * Storage adapter bridging to Electron Main's safeStorage with safe fallback
 */
export function createLauncherStorageAdapter(): AuthStorageAdapter {
  return {
    loadSession: async () => {
      if (typeof window !== "undefined" && window.electronAPI?.authLoadSession) {
        try {
          const session = await window.electronAPI.authLoadSession()
          if (session && session.accessToken && session.user) {
            return session as SessionState
          }
        } catch (_) {}
      }
      // Fallback for browser testing / dev mode
      try {
        const raw = localStorage.getItem("hikat_auth_session")
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && parsed.accessToken && parsed.user) {
            return parsed as SessionState
          }
        }
      } catch (_) {}
      return null
    },

    saveSession: async (session) => {
      if (typeof window !== "undefined" && window.electronAPI?.authSaveSession) {
        try {
          await window.electronAPI.authSaveSession(session)
        } catch (_) {}
      }
      // Also cache user profile in localStorage for fast UI rendering
      try {
        localStorage.setItem("hikat_auth_session", JSON.stringify(session))
        localStorage.setItem("hikat_auth_token", session.accessToken)
        localStorage.setItem(
          "hikat_last_user",
          JSON.stringify({
            id: session.user.id,
            username: session.user.displayName || session.user.email.split("@")[0] || "Jugador",
            displayName: session.user.displayName || session.user.email.split("@")[0] || "Jugador",
            email: session.user.email,
            role: session.user.role,
          }),
        )
      } catch (_) {}
    },

    clearSession: async () => {
      if (typeof window !== "undefined" && window.electronAPI?.authClearSession) {
        try {
          await window.electronAPI.authClearSession()
        } catch (_) {}
      }
      try {
        localStorage.removeItem("hikat_auth_session")
        localStorage.removeItem("hikat_auth_token")
        localStorage.removeItem("hikat_refresh_token")
        localStorage.removeItem("hikat_last_user")
      } catch (_) {}
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

  public getStoredToken(): string | null {
    return this.client.getAccessToken() || (typeof localStorage !== "undefined" ? localStorage.getItem("hikat_auth_token") : null)
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
    }
  }

  public getCachedUser(): UserProfile | null {
    try {
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

    if (!cleanEmail || !password) {
      return {
        success: false,
        error: "Por favor ingresa tu correo y contraseña.",
      }
    }

    try {
      const user = await this.client.login(cleanEmail, password)
      const token = this.client.getAccessToken() || ""
      return {
        success: true,
        user: {
          id: user.id,
          username: user.displayName || user.email.split("@")[0] || "Jugador",
          displayName: user.displayName || user.email.split("@")[0] || "Jugador",
          email: user.email,
          role: user.role,
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

  public async refresh(): Promise<string | null> {
    return this.client.refresh()
  }

  public async logout(): Promise<void> {
    await this.client.logout()
  }

  public clearSession(): void {
    this.client.clearSession()
  }

  public setSession(session: SessionState): Promise<void> {
    return this.client.setSession(session)
  }

  public async requestPasswordReset(email: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await fetch(`${AUTH_URL}/auth/password/reset-request`, {
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


  // --- OAuth PKCE Integration ---


  public async initiateOAuth(provider: "GOOGLE" | "DISCORD"): Promise<{
    authUrl: string
    codeVerifier: string
    state: string
  }> {
    const codeVerifier = generateCodeVerifier(64)
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateRandomState(32)
    const redirectUri = "hikat://auth/callback"

    const authUrl = this.client.createOAuthAuthorizationUrl({
      provider,
      redirectUri,
      state,
      codeChallenge,
    })

    return { authUrl, codeVerifier, state }
  }

  public async handleOAuthCallback(params: {
    code: string
    codeVerifier: string
    state: string
    expectedState: string
  }): Promise<UserProfile> {
    if (params.state !== params.expectedState) {
      throw new Error("Estado de autenticación inválido (posible ataque CSRF).")
    }

    const user = await this.client.exchangeOAuthCode({
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri: "hikat://auth/callback",
    })

    return {
      id: user.id,
      username: user.displayName || user.email.split("@")[0] || "Jugador",
      displayName: user.displayName || user.email.split("@")[0] || "Jugador",
      email: user.email,
      role: user.role,
    }
  }
}

export const authService = new LauncherAuthService()
