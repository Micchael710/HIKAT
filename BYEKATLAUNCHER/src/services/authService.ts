import { apiClient, ApiResponse } from "./apiClient"
import {
  sanitizeUsername,
  sanitizeEmail,
  sanitizeInput,
} from "../utils/security"

export interface UserProfile {
  id?: string
  username: string
  email: string
  skinUrl?: string
  capeUrl?: string
  rank?: string
  level?: number
  memberSince?: string
}

export interface LoginCredentials {
  usernameOrEmail: string
  password?: string
  keepSession?: boolean
}

export interface RegisterCredentials {
  username: string
  email: string
  password?: string
}

export interface AuthResponseData {
  user: UserProfile
  token: string
}

export const authService = {
  /**
   * Login user with backend or offline fallback (pre-sanitized)
   */
  async login(
    credentials: LoginCredentials,
  ): Promise<ApiResponse<AuthResponseData>> {
    const safePayload: LoginCredentials = {
      usernameOrEmail: sanitizeInput(credentials.usernameOrEmail, 254),
      password: credentials.password
        ? sanitizeInput(credentials.password, 128)
        : undefined,
      keepSession: Boolean(credentials.keepSession),
    }

    const res = await apiClient<AuthResponseData>("/auth/login", {
      method: "POST",
      body: JSON.stringify(safePayload),
    })

    if (res.success && res.data?.token) {
      const cleanToken = sanitizeInput(res.data.token, 1024)
      if (cleanToken) {
        localStorage.setItem("hikat_auth_token", cleanToken)
        localStorage.setItem("hikat_last_user", JSON.stringify(res.data.user))
      }
    }

    return res
  },

  /**
   * Register new user account (pre-sanitized)
   */
  async register(
    credentials: RegisterCredentials,
  ): Promise<ApiResponse<AuthResponseData>> {
    const safePayload: RegisterCredentials = {
      username: sanitizeUsername(credentials.username),
      email: sanitizeEmail(credentials.email),
      password: credentials.password
        ? sanitizeInput(credentials.password, 128)
        : undefined,
    }

    const res = await apiClient<AuthResponseData>("/auth/register", {
      method: "POST",
      body: JSON.stringify(safePayload),
    })

    if (res.success && res.data?.token) {
      const cleanToken = sanitizeInput(res.data.token, 1024)
      if (cleanToken) {
        localStorage.setItem("hikat_auth_token", cleanToken)
        localStorage.setItem("hikat_last_user", JSON.stringify(res.data.user))
      }
    }

    return res
  },

  /**
   * Request password reset email (pre-sanitized)
   */
  async requestPasswordReset(email: string): Promise<ApiResponse<{
    sent: boolean
  }>> {
    const safeEmail = sanitizeEmail(email)
    return apiClient<{ sent: boolean }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email: safeEmail }),
    })
  },

  /**
   * Get cached local session or current user profile with safe JSON parsing
   */
  getCachedUser(): UserProfile | null {
    try {
      const saved = localStorage.getItem("hikat_last_user")
      if (!saved) return null
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed.username === "string") {
        return {
          ...parsed,
          username: sanitizeUsername(parsed.username) || "Jugador",
          email: sanitizeEmail(parsed.email || ""),
        }
      }
      return null
    } catch (_) {
      return null
    }
  },

  /**
   * Log out and clear tokens cleanly
   */
  logout(): void {
    try {
      localStorage.removeItem("hikat_auth_token")
    } catch (_) {}
  },
}
