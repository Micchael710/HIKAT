import type { Database } from "@hikat/database"
import type { AppRole, AccessTokenPayload } from "@hikat/shared"

export interface Env {
  ENVIRONMENT?: string
  DB?: D1Database
  ASSETS?: R2Bucket
  AUTH_JWKS_URL?: string
  AUTH_ISSUER?: string
  AUTH_JWT_PUBLIC_KEY_PEM?: string
  JWT_PUBLIC_KEY_PEM?: string
  CORS_ALLOW_ORIGIN?: string
  PUBLIC_MEDIA_URL_BASE?: string
  PTERODACTYL_BASE_URL?: string
  PTERODACTYL_API_KEY?: string
  PTERODACTYL_SERVER_ID?: string
  CURSEFORGE_API_KEY?: string
  CURSEFORGE_API_BASE_URL?: string
  MODRINTH_API_BASE_URL?: string
  RELEASE_EVENTS?: DurableObjectNamespace
}


export interface AuthenticatedIdentity {
  userId: string
  sessionId: string
  role: AppRole
  displayName: string | null
  tokenPayload: AccessTokenPayload
}

export type AuthState =
  | { status: "anonymous" }
  | { status: "authenticated"; identity: AuthenticatedIdentity }
  | { status: "invalid"; reason: string }

export interface BackendGraphQLContext {
  env: Env
  db?: Database
  auth: AuthState
  request: Request
}
