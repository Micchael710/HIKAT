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

class AuthService {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private user: AdminUser | null = null
  private listeners: Set<SessionListener> = new Set()
  private refreshPromise: Promise<string | null> | null = null

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.user)
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  public getAccessToken(): string | null {
    return this.accessToken
  }

  public getUser(): AdminUser | null {
    return this.user
  }

  public setSession(accessToken: string, refreshToken: string, user: AdminUser) {
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    this.user = user
    this.notify()
  }

  public clearSession() {
    this.accessToken = null
    this.refreshToken = null
    this.user = null
    this.notify()
  }

  public async login(email: string, password: string): Promise<AdminUser> {
    const res = await fetch(`${AUTH_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim(), password }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        (res.status === 401 ? "Credenciales inválidas" : "Error al iniciar sesión")
      throw new Error(msg)
    }

    const payload = data as LoginResponse

    if (!payload.user || payload.user.role !== "ADMIN") {
      // Reject non-admin users and revoke session immediately
      if (payload.refreshToken) {
        await this.logoutWithToken(payload.accessToken, payload.refreshToken).catch(() => {})
      }
      this.clearSession()
      throw new Error("Acceso denegado: Se requiere cuenta con permisos de Administrador")
    }

    this.setSession(payload.accessToken, payload.refreshToken, payload.user)
    return payload.user
  }

  public async refresh(): Promise<string | null> {
    // Avoid concurrent duplicate refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    if (!this.refreshToken) {
      this.clearSession()
      return null
    }

    this.refreshPromise = (async () => {
      try {
        const res = await fetch(`${AUTH_URL}/auth/refresh`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        })

        if (!res.ok) {
          this.clearSession()
          return null
        }

        const data = (await res.json()) as LoginResponse
        if (!data.user || data.user.role !== "ADMIN") {
          this.clearSession()
          return null
        }

        // Atomically replace both accessToken and rotated refreshToken in memory
        this.setSession(data.accessToken, data.refreshToken, data.user)
        return data.accessToken
      } catch {
        this.clearSession()
        return null
      } finally {
        this.refreshPromise = null
      }
    })()

    return this.refreshPromise
  }

  public async logout(): Promise<void> {
    const access = this.accessToken
    const refresh = this.refreshToken
    this.clearSession()

    if (access || refresh) {
      await this.logoutWithToken(access, refresh).catch(() => {})
    }
  }

  private async logoutWithToken(
    access: string | null,
    refresh: string | null,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (access) {
        headers["Authorization"] = `Bearer ${access}`
      }
      await fetch(`${AUTH_URL}/auth/logout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ refreshToken: refresh }),
      })
    } catch {
      // Ignore network errors on logout
    }
  }
}

export const authService = new AuthService()
