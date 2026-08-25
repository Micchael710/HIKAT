/**
 * HiKAT Shared Foundation
 * Minimal shared types and constants for HiKAT workspace
 */

export const HIKAT_APP_NAME = "HiKAT"

export const HIKAT_VERSION = "0.1.0"

export type AppRole = "PLAYER" | "ADMIN"

export interface ServiceHealth {
  status: "ok" | "degraded" | "error"

  service: string

  version: string

  timestamp: string
}
