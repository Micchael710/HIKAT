/**
 * Centralized Authentication Service for HiKAT Launcher
 * Interacts with the real HiKAT Auth Worker (POST /auth/login, POST /auth/register)
 */
import {
  sanitizeUsername,
  sanitizeEmail,
  sanitizeInput,
} from "../utils/security"

export const AUTH_URL =
  import.meta.env.VITE_AUTH_API_URL || "http://localhost:8788"

export interface UserProfile {
  id?: string
  username: string
  displayName?: string
  email: string
  role?: string
  skinUrl?: string
  capeUrl?: string
  rank?: string
  level?: number
  memberSince?: string
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

export interface AuthLoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
  user: {
    id: string
    email: string
    displayName?: string
    role?: string
  }
}

export interface AuthRegisterResponse {
  success: boolean
  user: {
    id: string
    email: string
    displayName?: string
    role?: string
  }
  emailVerificationRequired: boolean
}

export const authService = {
  /**
   * Login user with the real Auth Worker (/auth/login)
   */
  async login(credentials: LoginCredentials): Promise<{
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
      const res = await fetch(`${AUTH_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: cleanEmail,
          password,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const errorMsg =
          data.message ||
          data.error ||
          (res.status === 401
            ? "Credenciales inválidas. Verifica tu correo y contraseña."
            : res.status === 429
              ? "Demasiados intentos de inicio de sesión. Por favor espera unos momentos."
              : `Error de autenticación (${res.status})`)
        return { success: false, error: errorMsg }
      }

      const payload = data as AuthLoginResponse
      if (!payload.accessToken || !payload.user) {
        return {
          success: false,
          error: "Respuesta de autenticación incompleta del servidor.",
        }
      }

      const cleanToken = sanitizeInput(payload.accessToken, 1024)
      const userProfile: UserProfile = {
        id: payload.user.id,
        username: payload.user.displayName || payload.user.email.split("@")[0] || "Jugador",
        displayName: payload.user.displayName || payload.user.email.split("@")[0] || "Jugador",
        email: payload.user.email,
        role: payload.user.role || "PLAYER",
      }

      if (cleanToken) {
        localStorage.setItem("hikat_auth_token", cleanToken)
        if (payload.refreshToken) {
          localStorage.setItem("hikat_refresh_token", payload.refreshToken)
        }
        localStorage.setItem("hikat_last_user", JSON.stringify(userProfile))
      }

      return {
        success: true,
        user: userProfile,
        token: cleanToken,
      }
    } catch (err: any) {
      return {
        success: false,
        error: "No se pudo conectar con el servidor de autenticación. Verifica tu conexión.",
      }
    }
  },

  /**
   * Register new user account with Auth Worker (/auth/register)
   */
  async register(credentials: RegisterCredentials): Promise<{
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
      const res = await fetch(`${AUTH_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          displayName: cleanUsername || cleanEmail.split("@")[0],
          email: cleanEmail,
          password,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const errorMsg =
          data.message ||
          data.error ||
          (res.status === 409
            ? "Este correo electrónico ya está registrado."
            : res.status === 429
              ? "Demasiados intentos de registro. Por favor espera unos momentos."
              : `Error al registrar la cuenta (${res.status})`)
        return { success: false, error: errorMsg }
      }

      const payload = data as AuthRegisterResponse
      const userProfile: UserProfile = {
        id: payload.user?.id,
        username: payload.user?.displayName || cleanUsername || cleanEmail.split("@")[0],
        displayName: payload.user?.displayName || cleanUsername || cleanEmail.split("@")[0],
        email: payload.user?.email || cleanEmail,
        role: payload.user?.role || "PLAYER",
      }

      return {
        success: true,
        user: userProfile,
        emailVerificationRequired: Boolean(payload.emailVerificationRequired),
      }
    } catch (err: any) {
      return {
        success: false,
        error: "No se pudo conectar con el servidor de autenticación.",
      }
    }
  },

  /**
   * Request password reset email (/auth/forgot-password)
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const safeEmail = sanitizeEmail(email)
    if (!safeEmail) {
      return { success: false, error: "Ingresa un correo electrónico válido." }
    }
    try {
      const res = await fetch(`${AUTH_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: safeEmail }),
      })
      if (!res.ok) {
        return { success: false, error: "Error al solicitar restablecimiento de contraseña." }
      }
      return { success: true }
    } catch {
      return { success: false, error: "No se pudo conectar con el servidor." }
    }
  },

  /**
   * Get cached local session or current user profile with safe JSON parsing
   */
  getCachedUser(): UserProfile | null {
    try {
      const saved = localStorage.getItem("hikat_last_user")
      if (!saved) return null
      const parsed = JSON.parse(saved)
      if (parsed && (typeof parsed.username === "string" || typeof parsed.email === "string")) {
        return {
          ...parsed,
          username: sanitizeUsername(parsed.username || parsed.displayName || parsed.email?.split("@")[0]) || "Jugador",
          displayName: sanitizeUsername(parsed.displayName || parsed.username || parsed.email?.split("@")[0]) || "Jugador",
          email: sanitizeEmail(parsed.email || ""),
        }
      }
      return null
    } catch (_) {
      return null
    }
  },

  /**
   * Returns the stored access token if available
   */
  getStoredToken(): string | null {
    try {
      return localStorage.getItem("hikat_auth_token")
    } catch {
      return null
    }
  },

  /**
   * Log out and clear tokens cleanly
   */
  logout(): void {
    try {
      localStorage.removeItem("hikat_auth_token")
      localStorage.removeItem("hikat_refresh_token")
      localStorage.removeItem("hikat_last_user")
    } catch (_) {}
  },
}
