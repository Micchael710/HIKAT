/**
 * Server Administration Service (Shard 06, 06A & 06B)
 * Business logic orchestrating Pterodactyl infrastructure, truly atomic distributed command rate limits,
 * distributed power action locks, real-state power action validation, and single-use console tickets.
 */

import { eq, and, sql, lt, gt, isNull } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import {
  mapPterodactylStateToHiKAT,
  validateServerCommand,
  SERVER_ERROR_CODES,
  SERVER_PUBLIC_MESSAGES,
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
      SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
      SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
      "Pterodactyl configuration missing (baseUrl, apiKey, or serverId)",
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
      SERVER_ERROR_CODES.SERVER_BUSY,
      SERVER_PUBLIC_MESSAGES.SERVER_BUSY,
      "Another power action is currently in progress",
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
      SERVER_ERROR_CODES.SERVER_BUSY,
      SERVER_PUBLIC_MESSAGES.SERVER_BUSY,
      "Concurrent power action lock acquisition collision",
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
 * Executes a power action (START, RESTART, STOP) with distributed lock coordination
 * and real server-state compatibility validation.
 */
export async function executeServerPowerAction(
  env: Env,
  action: ServerPowerAction,
  userId: string,
  clientOverride?: IPterodactylClient,
): Promise<{ success: boolean; status: ServerStatus; message: string }> {
  if (!env.DB) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
      "Database binding is unavailable",
    )
  }

  if (action !== "START" && action !== "RESTART" && action !== "STOP") {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Acción de servidor inválida.",
      `Invalid power action requested: ${action}`,
    )
  }

  const client = clientOverride || createPterodactylClient(env)
  const db = createDatabase(env.DB)

  // 1. Acquire distributed lock for concurrency safety during request
  await acquireDistributedPowerLock(db, action, userId)

  try {
    // 2. Validate current real server state before dispatching power action
    let currentMetrics: ServerResourcesData
    try {
      currentMetrics = await getServerStatus(env, client)
    } catch {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_STATUS_UNAVAILABLE,
        "Failed to verify server status before executing power action",
      )
    }

    const currentStatus = currentMetrics.status

    if (currentStatus === "UNKNOWN" || currentStatus === "DISCONNECTED") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_STATUS_UNAVAILABLE,
        `Cannot execute power action when server status is ${currentStatus}`,
      )
    }

    if (currentStatus === "STARTING") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_BUSY,
        SERVER_PUBLIC_MESSAGES.SERVER_IS_STARTING,
        "Cannot execute power action while server is starting",
      )
    }

    if (currentStatus === "STOPPING") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_BUSY,
        SERVER_PUBLIC_MESSAGES.SERVER_IS_STOPPING,
        "Cannot execute power action while server is stopping",
      )
    }

    if (action === "START" && currentStatus === "ONLINE") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_BUSY,
        SERVER_PUBLIC_MESSAGES.SERVER_ALREADY_RUNNING,
        "Cannot start server that is already online",
      )
    }

    if ((action === "STOP" || action === "RESTART") && currentStatus === "OFFLINE") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_BUSY,
        SERVER_PUBLIC_MESSAGES.SERVER_ALREADY_STOPPED,
        `Cannot ${action.toLowerCase()} server that is already offline`,
      )
    }

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
 * Truly atomic command rate limiting in D1 using a single UPSERT query.
 */
export async function checkAndIncrementCommandRateLimit(
  db: ReturnType<typeof createDatabase>,
  userId: string,
): Promise<void> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const newResetAtIso = new Date(
    now + SERVER_COMMAND_RATE_LIMIT.WINDOW_SECONDS * 1000,
  ).toISOString()
  const key = `cmd_rl:${userId}`

  // Execute an atomic UPSERT in D1:
  // If no row exists: inserts with count = 1, reset_at = now + 10s.
  // If row exists:
  //   - If reset_at <= now (expired window): resets count = 1, reset_at = now + 10s.
  //   - If reset_at > now (active window): increments count = count + 1.
  // RETURNING count gives the atomically assigned count for this request.
  const query = sql`
    INSERT INTO server_command_rate_limits (key, count, window_start, reset_at)
    VALUES (${key}, 1, ${nowIso}, ${newResetAtIso})
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN reset_at <= ${nowIso} THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN reset_at <= ${nowIso} THEN ${nowIso} ELSE window_start END,
      reset_at = CASE WHEN reset_at <= ${nowIso} THEN ${newResetAtIso} ELSE reset_at END
    RETURNING count;
  `

  const rows = await db.all<{ count: number }>(query)
  const assignedCount = rows?.[0]?.count ?? 1

  if (assignedCount > SERVER_COMMAND_RATE_LIMIT.MAX_COMMANDS) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_RATE_LIMITED,
      SERVER_PUBLIC_MESSAGES.COMMAND_RATE_LIMITED,
      `Command rate limit exceeded: count is ${assignedCount} (max ${SERVER_COMMAND_RATE_LIMIT.MAX_COMMANDS})`,
    )
  }
}

/**
 * Executes a console command with centralized validation and atomic rate limiting.
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
      "VALIDATION_ERROR",
      validation.error || "El comando no es válido.",
      "Command validation failed",
    )
  }

  if (!env.DB) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
      "Database binding is unavailable",
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
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
      "Database binding is unavailable",
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
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
      "Invalid console ticket format",
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
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
      "Console ticket already consumed, expired, or not found",
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
