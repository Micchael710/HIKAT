/**
 * HiKAT Authentication Worker Entrypoint
 */

import { createDatabase, Database } from "@hikat/database"
import { initializeKeyManager, JwtKeyManager } from "./crypto/jwt"
import { MockEmailService, EmailService } from "./services/email"
import { handleRequest } from "./routes"

export interface Env {
  ENVIRONMENT?: string
  AUTH_SERVICE_ENDPOINT?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  AUTH_JWT_PRIVATE_KEY_PEM?: string
  AUTH_JWT_PUBLIC_KEY_PEM?: string
  AUTH_JWT_KID?: string
  DB?: D1Database
}

let keyManagerCache: JwtKeyManager | null = null
const defaultEmailService: EmailService = new MockEmailService()

export { createDatabase, type Database, MockEmailService, type EmailService }

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const db = env.DB ? createDatabase(env.DB) : undefined

    if (!keyManagerCache) {
      keyManagerCache = await initializeKeyManager(env)
    }

    return handleRequest({
      request,
      env,
      db,
      keyManager: keyManagerCache,
      emailService: defaultEmailService,
    })
  },
}
