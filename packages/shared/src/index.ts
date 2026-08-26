/**
 * HiKAT Shared Foundation
 * Minimal shared types and constants for HiKAT workspace
 */

export const HIKAT_APP_NAME = "HiKAT"

export const HIKAT_VERSION = "0.1.0"

export const ALLOWED_ROLES = ["PLAYER", "ADMIN"] as const
export type AppRole = typeof ALLOWED_ROLES[number]

export const ALLOWED_AUTH_PROVIDERS = ["GOOGLE", "DISCORD"] as const
export type ExternalAuthProvider = typeof ALLOWED_AUTH_PROVIDERS[number]

export const ALLOWED_AUTH_METHODS = ["PASSWORD", "GOOGLE", "DISCORD"] as const
export type AuthMethodType = typeof ALLOWED_AUTH_METHODS[number]

export const AUTH_AUDIENCE_API = "hikat-api"
export const AUTH_AUDIENCE_GAME = "hikat-minecraft"
export const DEFAULT_AUTH_ISSUER = "https://auth.hikat.org"

export const ALLOWED_REDIRECT_URIS = [
  "hikat://auth/callback",
  "http://localhost:5173/auth/callback",
  "http://127.0.0.1:5173/auth/callback",
] as const

export interface AccessTokenPayload {
  iss: string
  aud: string
  sub: string
  sid: string
  role: AppRole
  displayName?: string | null
  iat: number
  exp: number
  jti: string
}

export interface GameTokenPayload {
  iss: string
  aud: "hikat-minecraft"
  sub: string
  sid: string
  role: AppRole
  displayName?: string | null
  iat: number
  exp: number
  jti: string
}

export interface AuthMethodSummary {
  type: AuthMethodType
  email?: string | null
  displayName?: string | null
  providerSubject?: string | null
  verified?: boolean
  linkedAt: string
}

export const AuthErrorCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  USER_ALREADY_EXISTS: "USER_ALREADY_EXISTS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  RATE_LIMITED: "RATE_LIMITED",
  EMAIL_CONFLICT_LINK_REQUIRED: "EMAIL_CONFLICT_LINK_REQUIRED",
  LAST_AUTH_METHOD: "LAST_AUTH_METHOD",
  PROVIDER_ALREADY_LINKED: "PROVIDER_ALREADY_LINKED",
  INVALID_PKCE: "INVALID_PKCE",
  INVALID_STATE: "INVALID_STATE",
  INVALID_REDIRECT_URI: "INVALID_REDIRECT_URI",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
} as const

export type AuthErrorCodeType = typeof AuthErrorCode[keyof typeof AuthErrorCode]

export interface ServiceHealth {
  status: "ok" | "degraded" | "error"
  service: string
  version: string
  timestamp: string
}

