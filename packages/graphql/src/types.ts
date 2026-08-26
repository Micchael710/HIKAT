import type { AppRole } from "@hikat/shared"

export type RoleGql = AppRole

export interface UserGql {
  id: string
  role: RoleGql
  displayName: string | null
  createdAt: string
  updatedAt: string
}

export interface HealthStatusGql {
  status: string
  service: string
  version: string
  timestamp: string
}

export interface AdminStatusGql {
  ok: boolean
  serverTime: string
  environment: string
}

