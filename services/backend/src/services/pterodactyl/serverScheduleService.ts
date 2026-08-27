/**
 * Server Automation / Schedule Service (Shard 07)
 * Translates between HiKAT human automation model and Pterodactyl schedules/tasks.
 */

import {
  convertAutomationToPterodactylCron,
  validateServerCommand,
  SERVER_ERROR_CODES,
  type ServerAutomationAction,
  type ServerAutomationFrequency,
  type ServerAutomationModel,
} from "@hikat/shared"
import type { Env } from "../../types"
import type { IPterodactylClient, PterodactylScheduleResponse } from "./types"
import { ServerInfrastructureError } from "./pterodactylClient"
import { createPterodactylClient } from "./serverAdministrationService"

export interface ServerAutomationItemData {
  id: string
  name: string
  action: ServerAutomationAction
  frequency: ServerAutomationFrequency
  time: string
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  enabled: boolean
  isProcessing: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
}

function parsePterodactylScheduleToHuman(schedule: PterodactylScheduleResponse): ServerAutomationItemData {
  const attr = schedule.attributes
  const cron = attr.cron || { minute: "0", hour: "4", day_of_week: "*" }

  const time = `${String(cron.hour || "0").padStart(2, "0")}:${String(cron.minute || "0").padStart(2, "0")}`

  let frequency: ServerAutomationFrequency = "DAILY"
  let weekday: number | null = null
  let weekdays: number[] | null = null

  if (cron.day_of_week && cron.day_of_week !== "*") {
    if (cron.day_of_week.includes(",")) {
      frequency = "SELECTED_DAYS"
      weekdays = cron.day_of_week.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    } else {
      frequency = "WEEKLY"
      weekday = parseInt(cron.day_of_week, 10)
      if (isNaN(weekday)) weekday = 1
    }
  }

  let action: ServerAutomationAction = "BACKUP"
  let command: string | null = null

  const firstTask = attr.tasks && attr.tasks.length > 0 ? attr.tasks[0]?.attributes : undefined
  if (firstTask) {
    if (firstTask.action === "backup") {
      action = "BACKUP"
    } else if (firstTask.action === "power") {
      const payload = (firstTask.payload || "").toLowerCase()
      if (payload === "start") action = "START"
      else if (payload === "stop") action = "STOP"
      else action = "RESTART"
    } else if (firstTask.action === "command") {
      action = "COMMAND"
      command = firstTask.payload || null
    }
  }

  return {
    id: String(attr.id),
    name: attr.name || "Automatización",
    action,
    frequency,
    time,
    weekday,
    weekdays,
    command,
    enabled: attr.is_active,
    isProcessing: attr.is_processing,
    lastRunAt: attr.last_run_at,
    nextRunAt: attr.next_run_at,
  }
}

/**
 * Lists all automated schedules.
 */
export async function listServerAutomations(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerAutomationItemData[]> {
  const client = clientOverride || createPterodactylClient(env)
  const res = await client.listSchedules()
  if (!res || !res.data || !Array.isArray(res.data)) {
    return []
  }
  return res.data.map((item) => parsePterodactylScheduleToHuman(item))
}

/**
 * Creates a scheduled server automation.
 */
export async function createServerAutomation(
  env: Env,
  input: ServerAutomationModel,
  clientOverride?: IPterodactylClient,
): Promise<ServerAutomationItemData> {
  const client = clientOverride || createPterodactylClient(env)

  if (!input.name || !input.name.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El nombre de la automatización es requerido.",
    )
  }

  if (input.action === "COMMAND") {
    const val = validateServerCommand(input.command)
    if (!val.valid) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        val.error || "Comando no válido.",
      )
    }
    if (input.command && input.command.trim().toLowerCase().startsWith("kill")) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        "No se permite el comando kill en automatizaciones programadas.",
      )
    }
  }

  const cron = convertAutomationToPterodactylCron(
    input.frequency,
    input.time,
    input.weekday,
    input.weekdays,
  )

  const scheduleRes = await client.createSchedule({
    name: input.name.trim(),
    is_active: input.enabled ?? true,
    minute: cron.minute,
    hour: cron.hour,
    day_of_month: cron.day_of_month,
    month: cron.month,
    day_of_week: cron.day_of_week,
    only_when_online: true,
  })

  const scheduleId = scheduleRes.attributes.id

  // Create corresponding task
  if (input.action === "BACKUP") {
    await client.createScheduleTask(scheduleId, {
      action: "backup",
      payload: "",
      time_offset: 0,
    })
  } else if (input.action === "RESTART" || input.action === "START" || input.action === "STOP") {
    await client.createScheduleTask(scheduleId, {
      action: "power",
      payload: input.action.toLowerCase(),
      time_offset: 0,
    })
  } else if (input.action === "COMMAND" && input.command) {
    await client.createScheduleTask(scheduleId, {
      action: "command",
      payload: input.command.trim(),
      time_offset: 0,
    })
  }

  const refreshed = await client.getSchedule(scheduleId)
  return parsePterodactylScheduleToHuman(refreshed)
}

/**
 * Updates a scheduled automation.
 */
export async function updateServerAutomation(
  env: Env,
  id: string,
  input: ServerAutomationModel,
  clientOverride?: IPterodactylClient,
): Promise<ServerAutomationItemData> {
  const client = clientOverride || createPterodactylClient(env)

  const cron = convertAutomationToPterodactylCron(
    input.frequency,
    input.time,
    input.weekday,
    input.weekdays,
  )

  const scheduleRes = await client.updateSchedule(id, {
    name: input.name.trim(),
    is_active: input.enabled ?? true,
    minute: cron.minute,
    hour: cron.hour,
    day_of_month: cron.day_of_month,
    month: cron.month,
    day_of_week: cron.day_of_week,
  })

  return parsePterodactylScheduleToHuman(scheduleRes)
}

/**
 * Manually executes a scheduled automation now.
 */
export async function runServerAutomation(
  env: Env,
  id: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)
  await client.executeSchedule(id)
  return true
}

/**
 * Deletes a scheduled automation.
 */
export async function deleteServerAutomation(
  env: Env,
  id: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)
  await client.deleteSchedule(id)
  return true
}
