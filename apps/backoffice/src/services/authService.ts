import {
  AuthClientCore,
  createWebSessionStorageAdapter,
  SessionState,
  AuthStatus,
  generateCodeVerifier,
  generateCodeChallenge,
  generateRandomState,
} from "@hikat/shared"
import type { AdminUser } from "../types"

const AUTH_URL = import.meta.env.VITE_AUTH_API_URL || "http://localhost:8788"

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
  user: AdminUser
}

export interface AuthErrorResponse {
  error: string
  message?: string
}

type SessionListener = (user: AdminUser | null) => void

class BackofficeAuthService {
  private client: AuthClientCore
  private listeners: Set<SessionListener> = new Set()

  constructor() {
    this.client = new AuthClientCore({
      authServiceUrl: AUTH_URL,
      allowedRole: "ADMIN",
      storageAdapter: createWebSessionStorageAdapter("hikat_backoffice_session"),
    })

    this.client.subscribe((session) => {
      const user = session?.user
        ? {
            id: session.user.id,
            email: session.user.email,
            displayName: session.user.displayName,
            role: "ADMIN" as const,
            minecraftUsername: (session.user as any).minecraftUsername,
          }
        : null
      for (const listener of this.listeners) {
        try {
          listener(user)
        } catch {}
      }
    })
  }

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }


  public getStatus(): AuthStatus {
    return this.client.getStatus()
  }

  public async bootstrap(): Promise<AdminUser | null> {
    await this.client.bootstrap()
    return this.getUser()
  }

  public getAccessToken(): string | null {
    return this.client.getAccessToken()
  }

  public getRefreshToken(): string | null {
    return this.client.getRefreshToken()
  }

  public getUser(): AdminUser | null {
    const u = this.client.getUser()
    if (!u) return null
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: "ADMIN",
      minecraftUsername: (u as any).minecraftUsername,
    }
  }

  public setSession(accessToken: string, refreshToken: string, user: AdminUser): Promise<void> {
    return this.client.setSession({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: "ADMIN",
        ...(user.minecraftUsername ? { minecraftUsername: user.minecraftUsername } : {}),
      } as any,
    })
  }

  public clearSession() {
    return this.client.clearSession()
  }

  public async login(email: string, password: string): Promise<AdminUser> {
    const user = await this.client.login(email, password)
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: "ADMIN",
      minecraftUsername: (user as any).minecraftUsername,
    }
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

  // --- OAuth PKCE for Backoffice ---

  public async initiateOAuth(provider: "GOOGLE" | "DISCORD"): Promise<{
    authUrl: string
    codeVerifier: string
    state: string
  }> {
    const codeVerifier = generateCodeVerifier(64)
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateRandomState(32)
    const redirectUri = `${window.location.origin}/auth/callback`

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
  }): Promise<AdminUser> {
    if (params.state !== params.expectedState) {
      throw new Error("Estado de autenticación inválido (posible ataque CSRF).")
    }

    const redirectUri = `${window.location.origin}/auth/callback`
    const user = await this.client.exchangeOAuthCode({
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri,
    })

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: "ADMIN",
      minecraftUsername: (user as any).minecraftUsername,
    }
  }
}

export const authService = new BackofficeAuthService()
