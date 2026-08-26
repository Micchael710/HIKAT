/**
 * HiKAT Server Administration Service (Shard 06)
 * Orchestrates server queries, power operations, console commands, and error mapping.
 */

import { createGraphQLError } from "@hikat/graphql"
import type {
  ServerResourcesGql,
  ServerPowerActionResultGql,
  ServerCommandResultGql,
} from "@hikat/graphql"
import {
  mapPterodactylStateToHiKAT,
  SERVER_LIMITS,
  type ServerPowerAction,
} from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient } from "./types"
import { PterodactylHttpClient } from "./pterodactylClient"

// Concurrency lock to prevent simultaneous contradicting power actions
let isPowerActionInFlight = false
let lastPowerActionTimestamp = 0
const POWER_ACTION_COOLDOWN_MS = 1500

/**
 * Creates or resolves an IPterodactylClient from environment variables.
 */
export function getPterodactylClient(
  env: Env,
  customClient?: IPterodactylClient,
): IPterodactylClient {
  if (customClient) {
    return customClient
  }

  const baseUrl = env.PTERODACTYL_BASE_URL
  const apiKey = env.PTERODACTYL_API_KEY
  const serverId = env.PTERODACTYL_SERVER_ID

  if (!baseUrl || !apiKey || !serverId) {
    throw createGraphQLError(
      "La integración con el servidor no está configurada.",
      "INTERNAL_ERROR",
    )
  }

  return new PterodactylHttpClient({
    baseUrl,
    apiKey,
    serverId,
  })
}

/**
 * Retrieves current server status and resource metrics.
 */
export async function getServerStatus(
  env: Env,
  customClient?: IPterodactylClient,
): Promise<ServerResourcesGql> {
  const client = getPterodactylClient(env, customClient)

  try {
    const [statsResult, detailsResult] = await Promise.allSettled([
      client.getServerResources(),
      client.getServerDetails(),
    ])

    if (statsResult.status === "rejected") {
      const err = statsResult.reason as Error
      // If Pterodactyl returned a normalized connection or not found error
      throw createGraphQLError(
        err?.message || "No se pudo obtener el estado del servidor.",
        "INTERNAL_ERROR",
      )
    }

    const stats = statsResult.value
    const details =
      detailsResult.status === "fulfilled" ? detailsResult.value : null

    const status = mapPterodactylStateToHiKAT(
      stats.attributes?.current_state,
      stats.attributes?.is_suspended,
    )

    const limits = details?.attributes?.limits

    // Calculate memory limit in bytes (limits.memory is in MB, 0 = unlimited)
    const memoryLimitBytes =
      limits && limits.memory > 0 ? limits.memory * 1024 * 1024 : null

    // Calculate disk limit in bytes (limits.disk is in MB, 0 = unlimited)
    const diskLimitBytes =
      limits && limits.disk > 0 ? limits.disk * 1024 * 1024 : null

    // Calculate CPU limit % (0 = unlimited)
    const cpuLimitPercent = limits && limits.cpu > 0 ? limits.cpu : null

    const resources = stats.attributes?.resources

    return {
      status,
      cpuPercent: resources?.cpu_absolute ?? 0,
      cpuLimitPercent: cpuLimitPercent ?? null,
      memoryUsedBytes: resources?.memory_bytes ?? 0,
      memoryLimitBytes: memoryLimitBytes ?? null,
      diskUsedBytes: resources?.disk_bytes ?? 0,
      diskLimitBytes: diskLimitBytes ?? null,
      uptimeMs: resources?.uptime ?? null,
      isSuspended: Boolean(stats.attributes?.is_suspended),
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && "extensions" in err) {
      throw err
    }
    const message =
      err instanceof Error
        ? err.message
        : "No se pudo obtener el estado del servidor."
    throw createGraphQLError(message, "INTERNAL_ERROR")
  }
}

/**
 * Executes a server power action (START, RESTART, STOP) with concurrency guard.
 */
export async function executeServerPowerAction(
  env: Env,
  action: ServerPowerAction,
  customClient?: IPterodactylClient,
): Promise<ServerPowerActionResultGql> {
  const now = Date.now()

  // Concurrency guard against rapid repeated clicks or race conditions
  if (isPowerActionInFlight) {
    throw createGraphQLError(
      "Ya hay una acción del servidor en proceso. Por favor espera.",
      "CONFLICT",
    )
  }

  if (now - lastPowerActionTimestamp < POWER_ACTION_COOLDOWN_MS) {
    throw createGraphQLError(
      "Por favor espera un momento antes de enviar otra acción.",
      "CONFLICT",
    )
  }

  isPowerActionInFlight = true
  lastPowerActionTimestamp = now

  try {
    const client = getPterodactylClient(env, customClient)

    let signal: "start" | "restart" | "stop"
    let targetStatus: "STARTING" | "STOPPING"
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
        throw createGraphQLError("Acción no válida.", "VALIDATION_ERROR")
    }

    await client.sendPowerAction(signal)

    return {
      success: true,
      status: targetStatus,
      message,
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && "extensions" in err) {
      throw err
    }
    const message =
      err instanceof Error
        ? err.message
        : "No se pudo ejecutar la acción en el servidor."
    throw createGraphQLError(message, "INTERNAL_ERROR")
  } finally {
    isPowerActionInFlight = false
  }
}

/**
 * Sends a console command to the Minecraft server.
 */
export async function executeServerCommand(
  env: Env,
  command: string,
  customClient?: IPterodactylClient,
): Promise<ServerCommandResultGql> {
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    throw createGraphQLError(
      "El comando no puede estar vacío.",
      "VALIDATION_ERROR",
    )
  }

  const trimmed = command.trim()

  if (trimmed.length > SERVER_LIMITS.MAX_COMMAND_LENGTH) {
    throw createGraphQLError(
      `El comando excede la longitud máxima permitida de ${SERVER_LIMITS.MAX_COMMAND_LENGTH} caracteres.`,
      "VALIDATION_ERROR",
    )
  }

  const client = getPterodactylClient(env, customClient)

  try {
    await client.sendCommand(trimmed)

    return {
      success: true,
      message: "Comando enviado correctamente.",
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && "extensions" in err) {
      throw err
    }
    const message =
      err instanceof Error
        ? err.message
        : "No se pudo enviar el comando al servidor."
    throw createGraphQLError(message, "INTERNAL_ERROR")
  }
}

/**
 * Retrieves temporary WebSocket credentials for the server console.
 */
export async function getServerConsoleWebsocketCredentials(
  env: Env,
  customClient?: IPterodactylClient,
): Promise<{ token: string; socket: string }> {
  const client = getPterodactylClient(env, customClient)

  try {
    return await client.getWebsocketCredentials()
  } catch (err: unknown) {
    if (err && typeof err === "object" && "extensions" in err) {
      throw err
    }
    const message =
      err instanceof Error
        ? err.message
        : "No se pudieron obtener credenciales de la consola."
    throw createGraphQLError(message, "INTERNAL_ERROR")
  }
}
