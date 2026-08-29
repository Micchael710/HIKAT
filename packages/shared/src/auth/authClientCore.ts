/**
 * HiKAT Unified Authentication Client Core
 * Authoritative session manager, single-flight token rotation, role enforcement,
 * and observable state engine shared between Launcher and Backoffice.
 */

import type { AppRole } from "../index"

export interface AuthUser {
  id: string
  email: string
  displayName?: string | null
  role: AppRole
}

export interface SessionState {
  accessToken: string
  refreshToken: string
  expiresIn?: number
  tokenType?: string
  user: AuthUser
}

export type AuthStatus = "BOOTSTRAPPING" | "AUTHENTICATED" | "UNAUTHENTICATED"

export type SessionListener = (session: SessionState | null, status: AuthStatus) => void

export interface AuthStorageAdapter {
  loadSession(): Promise<SessionState | null> | SessionState | null
  saveSession(session: SessionState): Promise<void> | void
  clearSession(): Promise<void> | void
}

export function parseJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const base64Url = parts[1]
    if (!base64Url) return null
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
    const jsonStr = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("utf-8")
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

export function isJwtExpired(token: string, bufferSeconds = 30): boolean {
  const payload = parseJwtPayload(token)
  if (!payload || typeof payload.exp !== "number") return false
  const now = Math.floor(Date.now() / 1000)
  return now >= payload.exp - bufferSeconds
}


export function createMemoryStorageAdapter(): AuthStorageAdapter {
  let session: SessionState | null = null
  return {
    loadSession: () => session,
    saveSession: (s) => {
      session = s
    },
    clearSession: () => {
      session = null
    },
  }
}

export function createWebSessionStorageAdapter(key = "hikat_auth_session"): AuthStorageAdapter {
  return {
    loadSession: () => {
      try {
        const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object" && parsed.accessToken && parsed.user) {
          return parsed as SessionState
        }
        return null
      } catch {
        return null
      }
    },
    saveSession: (session) => {
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(key, JSON.stringify(session))
        }
      } catch {}
    },
    clearSession: () => {
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem(key)
        }
      } catch {}
    },
  }
}

export interface AuthClientOptions {
  authServiceUrl: string
  allowedRole: AppRole
  storageAdapter?: AuthStorageAdapter
  fetcher?: typeof fetch
}

export class AuthClientCore {
  private authServiceUrl: string
  private allowedRole: AppRole
  private storageAdapter: AuthStorageAdapter
  private fetcher: typeof fetch

  private session: SessionState | null = null
  private status: AuthStatus = "BOOTSTRAPPING"
  private listeners: Set<SessionListener> = new Set()
  private refreshPromise: Promise<string | null> | null = null
  private persistSession = true

  constructor(options: AuthClientOptions) {
    this.authServiceUrl = options.authServiceUrl.replace(/\/$/, "")
    this.allowedRole = options.allowedRole
    this.storageAdapter = options.storageAdapter || createMemoryStorageAdapter()
    this.fetcher = options.fetcher || ((input, init) => fetch(input, init))
  }

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    try {
      listener(this.session, this.status)
    } catch {}
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.session, this.status)
      } catch {}
    }
  }

  public getStatus(): AuthStatus {
    return this.status
  }

  public getSession(): SessionState | null {
    return this.session
  }

  public getUser(): AuthUser | null {
    return this.session?.user || null
  }

  public getAccessToken(): string | null {
    return this.session?.accessToken || null
  }

  public getRefreshToken(): string | null {
    return this.session?.refreshToken || null
  }

  public setSession(session: SessionState, persist = true): Promise<void> {
    if (!session.user || session.user.role !== this.allowedRole) {
      const errorMsg =
        this.allowedRole === "ADMIN"
          ? "Acceso denegado: Se requiere cuenta con permisos de Administrador"
          : "Acceso denegado: Rol de cuenta no autorizado para el Launcher"

      // Revoke invalid session on server immediately
      if (session.accessToken || session.refreshToken) {
        this.logoutWithToken(session.accessToken, session.refreshToken).catch(() => {})
      }
      this.clearSession()
      throw new Error(errorMsg)
    }

    this.persistSession = persist
    this.session = session
    this.status = "AUTHENTICATED"
    this.notify()

    if (persist) {
      return Promise.resolve(this.storageAdapter.saveSession(session))
    } else {
      return Promise.resolve(this.storageAdapter.clearSession())
    }
  }

  public clearSession(): Promise<void> {
    this.session = null
    this.status = "UNAUTHENTICATED"
    this.notify()
    return Promise.resolve(this.storageAdapter.clearSession())
  }

  public async bootstrap(): Promise<SessionState | null> {
    this.status = "BOOTSTRAPPING"
    this.notify()

    try {
      const stored = await Promise.resolve(this.storageAdapter.loadSession())
      if (!stored || !stored.accessToken || !stored.refreshToken || !stored.user) {
        await this.clearSession()
        return null
      }

      if (stored.user.role !== this.allowedRole) {
        await this.clearSession()
        return null
      }

      this.session = stored
      this.persistSession = true

      // If access token is expired, proactively rotate via refresh
      if (isJwtExpired(stored.accessToken)) {
        const refreshed = await this.refresh()
        if (!refreshed || !this.session) {
          await this.clearSession()
          return null
        }
        return this.session
      }

      this.status = "AUTHENTICATED"
      this.notify()

      return stored
    } catch {
      await this.clearSession()
      return null
    }
  }

  public async login(email: string, password: string, keepSession = true): Promise<AuthUser> {
    const cleanEmail = email.trim().toLowerCase()
    const cleanPass = password || ""

    const res = await this.fetcher(`${this.authServiceUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
    })

    const data = (await res.json().catch(() => ({}))) as Record<string, any>

    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        (res.status === 401
          ? "Credenciales inválidas. Verifica tu correo y contraseña."
          : res.status === 429
            ? "Demasiados intentos de inicio de sesión. Espera unos momentos."
            : `Error de autenticación (${res.status})`)
      throw new Error(msg)
    }

    const payload = data as {
      accessToken: string
      refreshToken: string
      expiresIn: number
      tokenType: string
      user: AuthUser
    }

    if (!payload.accessToken || !payload.user) {
      throw new Error("Respuesta de autenticación incompleta del servidor.")
    }

    await this.setSession(
      {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresIn: payload.expiresIn,
        tokenType: payload.tokenType,
        user: payload.user,
      },
      keepSession,
    )

    return payload.user
  }

  public async register(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<{ success: boolean; user: AuthUser; emailVerificationRequired: boolean }> {
    const res = await this.fetcher(`${this.authServiceUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        displayName: displayName?.trim() || undefined,
      }),
    })

    const data = (await res.json().catch(() => ({}))) as Record<string, any>

    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        (res.status === 409
          ? "Este correo electrónico ya está registrado."
          : `Error al registrar la cuenta (${res.status})`)
      throw new Error(msg)
    }

    return {
      success: true,
      user: data.user,
      emailVerificationRequired: Boolean(data.emailVerificationRequired),
    }
  }

  public async refresh(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    const currentRefresh = this.session?.refreshToken
    if (!currentRefresh) {
      await this.clearSession()
      return null
    }

    this.refreshPromise = (async () => {
      try {
        const res = await this.fetcher(`${this.authServiceUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: currentRefresh }),
        })

        if (!res.ok) {
          await this.clearSession()
          return null
        }

        const data = (await res.json()) as {
          accessToken: string
          refreshToken: string
          expiresIn: number
          tokenType: string
          user: AuthUser
        }

        if (!data.accessToken || !data.user || data.user.role !== this.allowedRole) {
          await this.clearSession()
          return null
        }

        // Atomically replace session with rotated tokens, respecting persistSession
        await this.setSession(
          {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            expiresIn: data.expiresIn,
            tokenType: data.tokenType,
            user: data.user,
          },
          this.persistSession,
        )

        return data.accessToken
      } catch {
        await this.clearSession()
        return null
      } finally {
        this.refreshPromise = null
      }
    })()

    return this.refreshPromise
  }

  public async logout(): Promise<void> {
    const access = this.session?.accessToken || null
    const refresh = this.session?.refreshToken || null

    await this.clearSession()

    if (access || refresh) {
      await this.logoutWithToken(access, refresh).catch(() => {})
    }
  }

  private async logoutWithToken(access: string | null, refresh: string | null): Promise<void> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (access) headers["Authorization"] = `Bearer ${access}`
      await this.fetcher(`${this.authServiceUrl}/auth/logout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ refreshToken: refresh }),
      })
    } catch (_) {}
  }

  // --- OAuth PKCE Integration ---

  public async exchangeOAuthCode(
    params: {
      code: string
      codeVerifier: string
      redirectUri: string
    },
    keepSession = true,
  ): Promise<AuthUser> {
    const res = await this.fetcher(`${this.authServiceUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: params.redirectUri,
      }),
    })

    const data = (await res.json().catch(() => ({}))) as Record<string, any>

    if (!res.ok) {
      const errCode = data.error || data.message
      if (errCode === "EMAIL_CONFLICT_LINK_REQUIRED") {
        throw new Error(
          "Este correo electrónico ya está registrado con otro método de autenticación. Por favor inicia sesión con tu contraseña.",
        )
      }
      if (errCode === "INVALID_STATE" || errCode === "INVALID_PKCE") {
        throw new Error("Error en la validación de seguridad de OAuth (PKCE).")
      }
      if (errCode === "TOKEN_EXPIRED" || errCode === "TOKEN_REUSE_DETECTED") {
        throw new Error("El código de autorización expiró o ya fue utilizado.")
      }
      throw new Error(data.message || data.error || "Error al completar la autenticación con el proveedor.")
    }

    const payload = data as {
      accessToken: string
      refreshToken: string
      expiresIn: number
      tokenType: string
      user: AuthUser
    }

    if (!payload.accessToken || !payload.user) {
      throw new Error("Respuesta de autenticación OAuth incompleta.")
    }

    await this.setSession(
      {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresIn: payload.expiresIn,
        tokenType: payload.tokenType,
        user: payload.user,
      },
      keepSession,
    )

    return payload.user
  }

  public createOAuthAuthorizationUrl(params: {
    provider: "GOOGLE" | "DISCORD"
    redirectUri: string
    state: string
    codeChallenge: string
  }): string {
    const query = new URLSearchParams({
      provider: params.provider.toLowerCase(),
      response_type: "code",
      redirect_uri: params.redirectUri,
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
    })

    return `${this.authServiceUrl}/oauth/authorize?${query.toString()}`
  }
}
