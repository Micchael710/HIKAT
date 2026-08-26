/**
 * Server Administration Service (Shard 06 & Shard 06A)
 * Business logic orchestrating Pterodactyl infrastructure, distributed power locks in D1,
 * distributed command rate limits in D1, single-use console tickets, and telemetry mapping.
 */

import { eq, and, sql, lt, gt, isNull } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import {
  mapPterodactylStateToHiKAT,
  validateServerCommand,
  SERVER_ERROR_CODES,
  SERVER_CONSOLE_TICKET_TTL_SECONDS,
  SERVER_POWER_LOCK_TTL_SECONDS,
  SERVER_COMMAND_RATE_LIMIT,
} from "@hikat/shared"
import type { ServerResourcesData, ServerPowerAction, ServerStatus } from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { PterodactylHttpClient, ServerInfrastructureError } from "./pterodactylClient"

export function createPterodactylClient(env: Env): IPterodactylClient {
  const baseUrl = env.PTERODACTYL_BASE_URL
  const apiKey = env.PTERODACTYL_API_KEY
  const serverId = env.PTERODACTYL_SERVER_ID

  if (!baseUrl || !apiKey || !serverId) {
    throw new ServerInfrastructureError(
      "La integración con el servidor no está configurada.",
      SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
    )
  }

  return new PterodactylHttpClient({
    baseUrl,
    apiKey,
    serverId,
    isProduction: env.ENVIRONMENT === "production",
  })
}

/**
 * Retrieves current server status and resource usage.
 */
export async function getServerStatus(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerResourcesData> {

  const client = clientOverride || createPterodactylClient(env)

  const [statsRes, detailsRes] = await Promise.all([
    client.getServerResources(),
    client.getServerDetails(),
  ])

  const stats = statsRes.attributes
  const details = detailsRes.attributes

  const isSuspended = stats.is_suspended || details.is_suspended || false
  const status: ServerStatus = mapPterodactylStateToHiKAT(
    stats.current_state,
    isSuspended,
  )

  const cpuPercent = stats.resources.cpu_absolute ?? 0
  const cpuLimitPercent = details.limits.cpu ?? null

  const memoryUsedBytes = stats.resources.memory_bytes ?? 0
  const memoryLimitBytes =
    details.limits.memory && details.limits.memory > 0
      ? details.limits.memory * 1024 * 1024
      : null

  const diskUsedBytes = stats.resources.disk_bytes ?? 0
  const diskLimitBytes =
    details.limits.disk && details.limits.disk > 0
      ? details.limits.disk * 1024 * 1024
      : null

  const uptimeMs = stats.resources.uptime ?? null

  return {
    status,
    cpuPercent,
    cpuLimitPercent,
    memoryUsedBytes,
    memoryLimitBytes,
    diskUsedBytes,
    diskLimitBytes,
    uptimeMs,
    isSuspended,
  }
}

/**
 * Acquires a distributed power action lock in D1.
 */
async function acquireDistributedPowerLock(
  db: ReturnType<typeof createDatabase>,
  action: ServerPowerAction,
  userId: string,
): Promise<void> {
  const nowIso = new Date().toISOString()
  const lockKey = "main_server_power"

  // 1. Opportunistically clear expired locks
  try {
    await db
      .delete(schema.serverPowerLocks)
      .where(
        and(
          eq(schema.serverPowerLocks.lockKey, lockKey),
          lt(schema.serverPowerLocks.expiresAt, nowIso),
        ),
      )
  } catch {}

  // 2. Check for active lock
  const activeLock = await db
    .select()
    .from(schema.serverPowerLocks)
    .where(
      and(
        eq(schema.serverPowerLocks.lockKey, lockKey),
        gt(schema.serverPowerLocks.expiresAt, nowIso),
      ),
    )
    .get()

  if (activeLock) {
    throw new ServerInfrastructureError(
      "Hay otra acción en curso en el servidor. Por favor espera un momento.",
      SERVER_ERROR_CODES.SERVER_BUSY,
    )
  }

  // 3. Insert new lock
  const expiresAt = new Date(
    Date.now() + SERVER_POWER_LOCK_TTL_SECONDS * 1000,
  ).toISOString()

  try {
    await db.insert(schema.serverPowerLocks).values({
      lockKey,
      action,
      acquiredByUserId: userId,
      acquiredAt: nowIso,
      expiresAt,
    })
  } catch {
    // Conflict on insert means another isolate concurrently acquired the lock
    throw new ServerInfrastructureError(
      "Hay otra acción en curso en el servidor. Por favor espera un momento.",
      SERVER_ERROR_CODES.SERVER_BUSY,
    )
  }
}

/**
 * Releases the distributed power action lock in D1.
 */
async function releaseDistributedPowerLock(
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  try {
    await db
      .delete(schema.serverPowerLocks)
      .where(eq(schema.serverPowerLocks.lockKey, "main_server_power"))
  } catch {}
}

/**
 * Executes a power action (START, RESTART, STOP) with distributed lock coordination.
 */
export async function executeServerPowerAction(
  env: Env,
  action: ServerPowerAction,
  userId: string,
  clientOverride?: IPterodactylClient,
): Promise<{ success: boolean; status: ServerStatus; message: string }> {
  if (!env.DB) {
    throw new ServerInfrastructureError(
      "La base de datos no está disponible.",
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    )
  }
  const client = clientOverride || createPterodactylClient(env)
  const db = createDatabase(env.DB)

  await acquireDistributedPowerLock(db, action, userId)


  try {
    let signal: "start" | "restart" | "stop"
    let targetStatus: ServerStatus
    let message: string

    switch (action) {
      case "START":
        signal = "start"
        targetStatus = "STARTING"
        message = "Iniciando servidor..."
        break
      case "RESTART":
        signal = "restart"
        targetStatus = "STARTING"
        message = "Reiniciando servidor..."
        break
      case "STOP":
        signal = "stop"
        targetStatus = "STOPPING"
        message = "Apagando servidor..."
        break
      default:
        throw new ServerInfrastructureError(
          "Acción de servidor desconocida.",
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        )
    }

    await client.sendPowerAction(signal)

    return {
      success: true,
      status: targetStatus,
      message,
    }
  } finally {
    await releaseDistributedPowerLock(db)
  }
}

/**
 * Checks and increments distributed command rate limit in D1.
 */
export async function checkAndIncrementCommandRateLimit(
  db: ReturnType<typeof createDatabase>,
  userId: string,
): Promise<void> {
  const now = Date.now()
  const key = `cmd_rl:${userId}`
  const nowIso = new Date(now).toISOString()

  const existing = await db
    .select()
    .from(schema.serverCommandRateLimits)
    .where(eq(schema.serverCommandRateLimits.key, key))
    .get()

  if (!existing || new Date(existing.resetAt).getTime() <= now) {
    // Start new window
    const resetAt = new Date(
      now + SERVER_COMMAND_RATE_LIMIT.WINDOW_SECONDS * 1000,
    ).toISOString()

    if (!existing) {
      await db.insert(schema.serverCommandRateLimits).values({
        key,
        count: 1,
        windowStart: nowIso,
        resetAt,
      })
    } else {
      await db
        .update(schema.serverCommandRateLimits)
        .set({
          count: 1,
          windowStart: nowIso,
          resetAt,
        })
        .where(eq(schema.serverCommandRateLimits.key, key))
    }
    return
  }

  // Inside current window
  if (existing.count >= SERVER_COMMAND_RATE_LIMIT.MAX_COMMANDS) {
    throw new ServerInfrastructureError(
      "Has enviado demasiados comandos. Espera un momento.",
      SERVER_ERROR_CODES.SERVER_RATE_LIMITED,
    )
  }

  // Increment
  await db
    .update(schema.serverCommandRateLimits)
    .set({
      count: existing.count + 1,
    })
    .where(eq(schema.serverCommandRateLimits.key, key))
}

/**
 * Executes a console command with centralized validation and rate limiting.
 */
export async function executeServerCommand(
  env: Env,
  command: string,
  userId: string,
  clientOverride?: IPterodactylClient,
): Promise<{ success: boolean; message: string }> {
  const validation = validateServerCommand(command)
  if (!validation.valid || !validation.command) {
    throw new ServerInfrastructureError(
      validation.error || "Comando inválido.",
      "VALIDATION_ERROR",
    )
  }

  if (!env.DB) {
    throw new ServerInfrastructureError(
      "La base de datos no está disponible.",
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    )
  }

  const db = createDatabase(env.DB)
  await checkAndIncrementCommandRateLimit(db, userId)

  const client = clientOverride || createPterodactylClient(env)
  await client.sendCommand(validation.command)

  return {
    success: true,
    message: "Comando enviado correctamente.",
  }
}

/**
 * Generates a cryptographically random, short-lived, single-use console ticket.
 */
export async function createConsoleTicket(
  env: Env,
  userId: string,
  sessionId: string,
): Promise<{ ticket: string; expiresAt: string }> {
  if (!env.DB) {
    throw new ServerInfrastructureError(
      "La base de datos no está disponible.",
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    )
  }

  const db = createDatabase(env.DB)
  const now = Date.now()

  const nowIso = new Date(now).toISOString()

  // 1. Opportunistically delete expired tickets
  try {
    await db
      .delete(schema.serverConsoleTickets)
      .where(lt(schema.serverConsoleTickets.expiresAt, nowIso))
  } catch {}

  // 2. Generate random opaque ticket ID
  const randomBytes = new Uint8Array(20)
  crypto.getRandomValues(randomBytes)
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  const ticketId = `cstk_${randomHex}`

  const expiresAt = new Date(
    now + SERVER_CONSOLE_TICKET_TTL_SECONDS * 1000,
  ).toISOString()

  await db.insert(schema.serverConsoleTickets).values({
    id: ticketId,
    userId,
    sessionId,
    expiresAt,
    usedAt: null,
    createdAt: nowIso,
  })

  return {
    ticket: ticketId,
    expiresAt,
  }
}

/**
 * Atomically consumes a single-use console ticket in D1.
 */
export async function consumeConsoleTicket(
  db: ReturnType<typeof createDatabase>,
  ticketId: string,
): Promise<{ userId: string; sessionId: string }> {
  if (!ticketId || typeof ticketId !== "string" || !ticketId.startsWith("cstk_")) {
    throw new ServerInfrastructureError(
      "Ticket de consola inválido o expirado.",
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    )
  }

  const nowIso = new Date().toISOString()

  // Atomic conditional update: update used_at only if used_at IS NULL and expires_at > now
  const updatedRow = await db
    .update(schema.serverConsoleTickets)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(schema.serverConsoleTickets.id, ticketId),
        isNull(schema.serverConsoleTickets.usedAt),
        gt(schema.serverConsoleTickets.expiresAt, nowIso),
      ),
    )
    .returning({
      userId: schema.serverConsoleTickets.userId,
      sessionId: schema.serverConsoleTickets.sessionId,
    })
    .get()

  if (!updatedRow) {
    throw new ServerInfrastructureError(
      "Ticket de consola inválido o expirado.",
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    )
  }

  return updatedRow
}

/**
 * Retrieves upstream Wings credentials (internal use only).
 */
export async function getServerConsoleWebsocketCredentials(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<{ token: string; socket: string }> {
  const client = clientOverride || createPterodactylClient(env)
  return client.getWebsocketCredentials()
}
