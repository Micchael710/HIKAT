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

export const ALLOWED_LINK_REDIRECT_URIS = [
  "https://app.hikat.org/settings",
  "https://app.hikat.org/account",
  "http://localhost:5173/settings",
  "http://127.0.0.1:5173/settings",
  "hikat://settings/accounts",
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

// --- HiKAT Content Core Constants & Types ---

export const ALLOWED_CONTENT_KINDS = ["NEWS", "ANNOUNCEMENT"] as const
export type ContentPostKind = typeof ALLOWED_CONTENT_KINDS[number]

export const ALLOWED_CONTENT_STATUSES = ["DRAFT", "PUBLISHED"] as const
export type ContentPostStatus = typeof ALLOWED_CONTENT_STATUSES[number]

export const ALLOWED_MEDIA_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const
export type MediaMimeType = typeof ALLOWED_MEDIA_MIME_TYPES[number]

export const MAX_MEDIA_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MEDIA_UPLOAD_TOKEN_EXPIRATION_SECONDS = 15 * 60 // 15 minutes

export const CONTENT_LIMITS = {
  TITLE_MIN_LENGTH: 3,
  TITLE_MAX_LENGTH: 200,
  SLUG_MIN_LENGTH: 3,
  SLUG_MAX_LENGTH: 100,
  SUMMARY_MIN_LENGTH: 3,
  SUMMARY_MAX_LENGTH: 500,
  BODY_MIN_LENGTH: 1,
  BODY_MAX_LENGTH: 100000,
  DEFAULT_FEED_LIMIT: 20,
  MAX_FEED_LIMIT: 50,
} as const

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Normalizes a raw slug: converts to lowercase, removes invalid characters,
 * collapses consecutive hyphens, and trims leading/trailing hyphens.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z0-9-]+/g, "-") // replace non-alphanumerics with -
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
}

/**
 * Validates whether a slug matches strict URL-safe format and length bounds.
 */
export function isValidSlug(slug: string): boolean {
  if (
    slug.length < CONTENT_LIMITS.SLUG_MIN_LENGTH ||
    slug.length > CONTENT_LIMITS.SLUG_MAX_LENGTH
  ) {
    return false
  }
  return SLUG_REGEX.test(slug)
}

/**
 * Encodes compound pagination cursor data to a stable Base64 string.
 */
export function encodeCursor<T extends object>(data: T): string {
  const json = JSON.stringify(data)
  return Buffer.from(json, "utf-8").toString("base64url")
}

/**
 * Decodes a Base64 cursor string into typed structured data.
 */
export function decodeCursor<T = Record<string, unknown>>(cursor: string): T | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8")
    const parsed = JSON.parse(json)
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as T
    }
    return null
  } catch {
    return null
  }
}

