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

export interface ServiceHealth {
  status: "ok" | "degraded" | "error"
  service: string
  version: string
  timestamp: string
}
