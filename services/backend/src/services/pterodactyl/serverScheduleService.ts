/**
 * Server Tasks / Schedule Service (Phase 07)
 * Implements 10 operational templates + custom task support,
 * Pterodactyl as source-of-truth, D1 metadata tracking & reconciliation,
 * human schedule formatting, and multi-task atomic compensation.
 */

import { eq, inArray } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import {
  convertAutomationToPterodactylCron,
  validateServerCommand,
  formatScheduleHumanDescription,
  SERVER_ERROR_CODES,
  type ServerAutomationAction,
  type ServerAutomationFrequency,
  type ServerTaskTemplate,
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
  template?: ServerTaskTemplate | null
  frequency: ServerAutomationFrequency
  time: string
  intervalHours?: number | null
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  delaySeconds?: number | null
  message?: string | null
  humanSchedule?: string | null
  enabled: boolean
  isProcessing: boolean
  isAdvanced: boolean
  isManaged: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
}

interface TaskStepDef {
  action: "power" | "command" | "backup"
  payload: string
  time_offset: number
}

interface TemplatePlan {
  template: ServerTaskTemplate
  onlyWhenOnline: boolean
  action: ServerAutomationAction
  tasks: TaskStepDef[]
}

export interface TemplatePlanInput {
  template?: ServerTaskTemplate | null
  action?: ServerAutomationAction | null
  command?: string | null
  delaySeconds?: number | null
}

/**
 * Builds the sequence of Pterodactyl schedule tasks based on the chosen HiKAT task template.
 */
export function buildTemplatePlan(input: TemplatePlanInput): TemplatePlan {
  const template: ServerTaskTemplate = input.template || "CUSTOM"

  switch (template) {
    case "AUTO_STOP":
      return {
        template: "AUTO_STOP",
        onlyWhenOnline: true,
        action: "STOP",
        tasks: [{ action: "power", payload: "stop", time_offset: 0 }],
      }

    case "AUTO_START":
      return {
        template: "AUTO_START",
        onlyWhenOnline: false,
        action: "START",
        tasks: [{ action: "power", payload: "start", time_offset: 0 }],
      }

    case "AUTO_RESTART":
      return {
        template: "AUTO_RESTART",
        onlyWhenOnline: true,
        action: "RESTART",
        tasks: [{ action: "power", payload: "restart", time_offset: 0 }],
      }

    case "AUTO_BACKUP":
      return {
        template: "AUTO_BACKUP",
        onlyWhenOnline: true,
        action: "BACKUP",
        tasks: [{ action: "backup", payload: "", time_offset: 0 }],
      }

    case "RUN_COMMAND": {
      const cmd = (input.command || "").trim()
      return {
        template: "RUN_COMMAND",
        onlyWhenOnline: true,
        action: "COMMAND",
        tasks: [{ action: "command", payload: cmd, time_offset: 0 }],
      }
    }

    case "BACKUP_AND_RESTART": {
      const delay = Math.max(Number(input.delaySeconds) || 60, 5)
      return {
        template: "BACKUP_AND_RESTART",
        onlyWhenOnline: true,
        action: "RESTART",
        tasks: [
          { action: "backup", payload: "", time_offset: 0 },
          { action: "power", payload: "restart", time_offset: delay },
        ],
      }
    }

    case "BACKUP_AND_STOP": {
      const delay = Math.max(Number(input.delaySeconds) || 60, 5)
      return {
        template: "BACKUP_AND_STOP",
        onlyWhenOnline: true,
        action: "STOP",
        tasks: [
          { action: "backup", payload: "", time_offset: 0 },
          { action: "power", payload: "stop", time_offset: delay },
        ],
      }
    }

    case "WARN_AND_RESTART": {
      const delay = Math.max(Number(input.delaySeconds) || 30, 5)
      const rawMsg = (input.command || "El servidor se reiniciará en breve...").trim()
      const sayPayload = rawMsg.startsWith("/") ? rawMsg.slice(1) : rawMsg.startsWith("say ") ? rawMsg : `say ${rawMsg}`
      return {
        template: "WARN_AND_RESTART",
        onlyWhenOnline: true,
        action: "RESTART",
        tasks: [
          { action: "command", payload: sayPayload, time_offset: 0 },
          { action: "power", payload: "restart", time_offset: delay },
        ],
      }
    }

    case "WARN_AND_STOP": {
      const delay = Math.max(Number(input.delaySeconds) || 30, 5)
      const rawMsg = (input.command || "El servidor se apagará en breve...").trim()
      const sayPayload = rawMsg.startsWith("/") ? rawMsg.slice(1) : rawMsg.startsWith("say ") ? rawMsg : `say ${rawMsg}`
      return {
        template: "WARN_AND_STOP",
        onlyWhenOnline: true,
        action: "STOP",
        tasks: [
          { action: "command", payload: sayPayload, time_offset: 0 },
          { action: "power", payload: "stop", time_offset: delay },
        ],
      }
    }

    case "SAVE_AND_BACKUP": {
      const delay = Math.max(Number(input.delaySeconds) || 10, 2)
      return {
        template: "SAVE_AND_BACKUP",
        onlyWhenOnline: true,
        action: "BACKUP",
        tasks: [
          { action: "command", payload: "save-all flush", time_offset: 0 },
          { action: "backup", payload: "", time_offset: delay },
        ],
      }
    }

    case "CUSTOM":
    default: {
      const action = input.action || "BACKUP"
      const isStart = action === "START"
      if (action === "BACKUP") {
        return {
          template: "CUSTOM",
          onlyWhenOnline: true,
          action: "BACKUP",
          tasks: [{ action: "backup", payload: "", time_offset: 0 }],
        }
      } else if (action === "START" || action === "STOP" || action === "RESTART") {
        return {
          template: "CUSTOM",
          onlyWhenOnline: !isStart,
          action,
          tasks: [{ action: "power", payload: action.toLowerCase(), time_offset: 0 }],
        }
      } else {
        const cmd = (input.command || "").trim()
        return {
          template: "CUSTOM",
          onlyWhenOnline: true,
          action: "COMMAND",
          tasks: [{ action: "command", payload: cmd, time_offset: 0 }],
        }
      }
    }
  }
}

/**
 * Validates task template input before submission.
 */
function validateTaskInput(input: ServerAutomationModel): void {
  if (!input.name || !input.name.trim()) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "El nombre de la tarea es obligatorio.",
    )
  }

  const template = input.template || "CUSTOM"
  if (template === "RUN_COMMAND" || (template === "CUSTOM" && input.action === "COMMAND")) {
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
        "No se permite el comando kill en tareas programadas.",
      )
    }
  }
}

/**
 * Checks whether the tasks list on a Pterodactyl schedule matches the expected template definition.
 */
function checkTasksMatchTemplate(
  pteroTasks: Array<{ attributes: { action: string; payload: string; time_offset: number } }> | undefined,
  plan: TemplatePlan,
): boolean {
  if (!pteroTasks) return false
  if (pteroTasks.length !== plan.tasks.length) return false

  for (let i = 0; i < plan.tasks.length; i++) {
    const expected = plan.tasks[i]
    const actual = pteroTasks[i]?.attributes
    if (!expected || !actual) return false
    if (actual.action !== expected.action) return false
    if (expected.action === "power" && actual.payload.toLowerCase() !== expected.payload.toLowerCase()) return false
  }

  return true
}

/**
 * Lists all automated server tasks, reconciling Pterodactyl with D1 metadata.
 */
export async function listServerAutomations(
  env: Env,
  db?: Database,
  clientOverride?: IPterodactylClient,
): Promise<ServerAutomationItemData[]> {
  const client = clientOverride || createPterodactylClient(env)
  const res = await client.listSchedules()
  if (!res || !res.data || !Array.isArray(res.data)) {
    return []
  }

  const pteroSchedules = res.data
  const pteroScheduleIds = new Set(pteroSchedules.map((s) => String(s.attributes.id)))

  let d1TasksMap = new Map<string, schema.ServerTaskRecord>()
  if (db) {
    try {
      const d1Records = await db.select().from(schema.serverTasks).all()
      for (const rec of d1Records) {
        d1TasksMap.set(rec.scheduleId, rec)
      }

      // Cleanup stale D1 records that no longer exist in Pterodactyl
      const staleScheduleIds = Array.from(d1TasksMap.keys()).filter((id) => !pteroScheduleIds.has(id))
      if (staleScheduleIds.length > 0) {
        await db
          .delete(schema.serverTasks)
          .where(inArray(schema.serverTasks.scheduleId, staleScheduleIds))
      }
    } catch {
      // Non-blocking database error
    }
  }

  return pteroSchedules.map((schedule) => {
    const attr = schedule.attributes
    const scheduleId = String(attr.id)
    const d1Record = d1TasksMap.get(scheduleId)

    const cron = attr.cron || { minute: "0", hour: "4", day_of_week: "*" }
    const time = `${String(cron.hour || "0").padStart(2, "0")}:${String(cron.minute || "0").padStart(2, "0")}`

    let frequency: ServerAutomationFrequency = "DAILY"
    let weekday: number | null = null
    let weekdays: number[] | null = null
    let intervalHours: number | null = null

    if (cron.hour && cron.hour.startsWith("*/")) {
      frequency = "INTERVAL"
      intervalHours = parseInt(cron.hour.replace("*/", ""), 10) || 1
    } else if (cron.day_of_week && cron.day_of_week !== "*") {
      if (cron.day_of_week.includes(",")) {
        frequency = "SELECTED_DAYS"
        weekdays = cron.day_of_week
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
      } else {
        frequency = "WEEKLY"
        weekday = parseInt(cron.day_of_week, 10)
        if (isNaN(weekday)) weekday = 1
      }
    }

    const firstTask = attr.tasks && attr.tasks.length > 0 ? attr.tasks[0]?.attributes : undefined
    let action: ServerAutomationAction = "BACKUP"
    let command: string | null = null

    if (firstTask) {
      if (firstTask.action === "backup") action = "BACKUP"
      else if (firstTask.action === "power") {
        const p = (firstTask.payload || "").toLowerCase()
        if (p === "start") action = "START"
        else if (p === "stop") action = "STOP"
        else action = "RESTART"
      } else if (firstTask.action === "command") {
        action = "COMMAND"
        command = firstTask.payload || null
      }
    }

    if (d1Record) {
      const template = d1Record.template as ServerTaskTemplate
      const plan = buildTemplatePlan({
        template,
        action: d1Record.command ? "COMMAND" : action,
        command: d1Record.command,
        delaySeconds: d1Record.delaySeconds,
      })

      const isMatching = checkTasksMatchTemplate(attr.tasks, plan)
      if (isMatching) {
        const parsedWeekdays = d1Record.weekdays ? JSON.parse(d1Record.weekdays) : weekdays
        const humanSchedule = formatScheduleHumanDescription({
          frequency: d1Record.frequency as ServerAutomationFrequency,
          time: d1Record.time || time,
          weekday: d1Record.weekday ?? weekday,
          weekdays: parsedWeekdays,
          intervalHours: d1Record.intervalHours ?? intervalHours,
        })

        return {
          id: scheduleId,
          name: d1Record.name,
          template,
          action: plan.action,
          frequency: d1Record.frequency as ServerAutomationFrequency,
          time: d1Record.time || time,
          intervalHours: d1Record.intervalHours ?? intervalHours,
          weekday: d1Record.weekday ?? weekday,
          weekdays: parsedWeekdays,
          command: d1Record.command,
          delaySeconds: d1Record.delaySeconds,
          humanSchedule,
          enabled: attr.is_active,
          isProcessing: attr.is_processing,
          isAdvanced: false,
          isManaged: true,
          lastRunAt: attr.last_run_at,
          nextRunAt: attr.next_run_at,
        }
      }
    }

    // Schedule not managed by HiKAT or externally modified
    const isMultiTask = attr.tasks && attr.tasks.length > 1
    const humanSchedule = formatScheduleHumanDescription({
      frequency,
      time,
      weekday,
      weekdays,
      intervalHours,
    })

    return {
      id: scheduleId,
      name: isMultiTask ? `${attr.name || "Tarea"} (Avanzada)` : (attr.name || "Tarea"),
      template: null,
      action,
      frequency,
      time,
      intervalHours,
      weekday,
      weekdays,
      command,
      humanSchedule,
      enabled: attr.is_active,
      isProcessing: attr.is_processing,
      isAdvanced: true,
      isManaged: false,
      lastRunAt: attr.last_run_at,
      nextRunAt: attr.next_run_at,
    }
  })
}

/**
 * Creates a scheduled server task with automatic multi-task generation and compensation rollback on failure.
 */
export async function createServerAutomation(
  env: Env,
  input: ServerAutomationModel,
  clientOverride?: IPterodactylClient,
  db?: Database,
): Promise<ServerAutomationItemData> {
  const client = clientOverride || createPterodactylClient(env)
  validateTaskInput(input)

  const plan = buildTemplatePlan(input)
  const cron = convertAutomationToPterodactylCron(
    input.frequency,
    input.time,
    input.weekday,
    input.weekdays,
    input.intervalHours,
  )

  // 1. Create schedule in Pterodactyl
  const scheduleRes = await client.createSchedule({
    name: input.name.trim(),
    is_active: input.enabled ?? true,
    minute: cron.minute,
    hour: cron.hour,
    day_of_month: cron.day_of_month,
    month: cron.month,
    day_of_week: cron.day_of_week,
    only_when_online: plan.onlyWhenOnline,
  })

  const scheduleId = String(scheduleRes.attributes.id)

  // 2. Sequential Task Creation with Compensating Rollback
  try {
    for (const taskDef of plan.tasks) {
      await client.createScheduleTask(scheduleId, {
        action: taskDef.action,
        payload: taskDef.payload,
        time_offset: taskDef.time_offset,
      })
    }
  } catch (taskErr: any) {
    // Rollback created schedule
    try {
      await client.deleteSchedule(scheduleId)
    } catch {}
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      `Error al configurar los pasos de la tarea: ${taskErr.message || "Fallo en la comunicación con el servidor"}`,
    )
  }

  // 3. Persist HiKAT metadata in D1
  if (db) {
    const now = new Date().toISOString()
    await db.insert(schema.serverTasks).values({
      id: crypto.randomUUID(),
      scheduleId,
      template: plan.template,
      name: input.name.trim(),
      frequency: input.frequency,
      cronMinute: cron.minute,
      cronHour: cron.hour,
      cronDayOfWeek: cron.day_of_week,
      time: input.time || null,
      intervalHours: input.intervalHours || null,
      weekday: input.weekday ?? null,
      weekdays: input.weekdays ? JSON.stringify(input.weekdays) : null,
      command: input.command || null,
      delaySeconds: input.delaySeconds || null,
      enabled: input.enabled ?? true,
      templateVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  const humanSchedule = formatScheduleHumanDescription({
    frequency: input.frequency,
    time: input.time,
    weekday: input.weekday,
    weekdays: input.weekdays,
    intervalHours: input.intervalHours,
  })

  return {
    id: scheduleId,
    name: input.name.trim(),
    template: plan.template,
    action: plan.action,
    frequency: input.frequency,
    time: input.time || "04:00",
    intervalHours: input.intervalHours,
    weekday: input.weekday,
    weekdays: input.weekdays,
    command: input.command,
    delaySeconds: input.delaySeconds,
    humanSchedule,
    enabled: input.enabled ?? true,
    isProcessing: false,
    isAdvanced: false,
    isManaged: true,
  }
}

/**
 * Updates a scheduled automation.
 */
export async function updateServerAutomation(
  env: Env,
  id: string,
  input: ServerAutomationModel,
  clientOverride?: IPterodactylClient,
  db?: Database,
): Promise<ServerAutomationItemData> {
  const client = clientOverride || createPterodactylClient(env)

  // 1. Fetch full schedule from Pterodactyl FIRST
  const fullSchedule = await client.getSchedule(id)
  const existingTasks = fullSchedule.attributes.tasks || []

  // 2. Check if schedule is managed in D1
  let d1Record: schema.ServerTaskRecord | undefined
  if (db) {
    d1Record = await db
      .select()
      .from(schema.serverTasks)
      .where(eq(schema.serverTasks.scheduleId, id))
      .get()
  }

  if (!d1Record && existingTasks.length > 1) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Esta automatización es avanzada (contiene múltiples tareas) y no puede ser modificada desde HiKAT.",
    )
  }

  validateTaskInput(input)
  const plan = buildTemplatePlan(input)
  const cron = convertAutomationToPterodactylCron(
    input.frequency,
    input.time,
    input.weekday,
    input.weekdays,
    input.intervalHours,
  )

  // 3. Update schedule metadata (name, cron, enabled, only_when_online)
  await client.updateSchedule(id, {
    name: input.name.trim(),
    is_active: input.enabled ?? true,
    minute: cron.minute,
    hour: cron.hour,
    day_of_month: cron.day_of_month,
    month: cron.month,
    day_of_week: cron.day_of_week,
    only_when_online: plan.onlyWhenOnline,
  })

  // 4. Update or recreate tasks
  if (
    existingTasks.length === 1 &&
    existingTasks[0]?.attributes?.id &&
    plan.tasks.length === 1 &&
    client.updateScheduleTask
  ) {
    const taskId = existingTasks[0].attributes.id
    const taskDef = plan.tasks[0]
    if (taskDef) {
      await client.updateScheduleTask(id, taskId, {
        action: taskDef.action,
        payload: taskDef.payload,
        time_offset: taskDef.time_offset,
      })
    }
  } else {
    for (const existingTask of existingTasks) {
      if (existingTask.attributes?.id && client.deleteScheduleTask) {
        await client
          .deleteScheduleTask(id, existingTask.attributes.id)
          .catch(() => {})
      }
    }

    for (const taskDef of plan.tasks) {
      if (client.createScheduleTask) {
        await client.createScheduleTask(id, {
          action: taskDef.action,
          payload: taskDef.payload,
          time_offset: taskDef.time_offset,
        })
      }
    }
  }

  // 5. Update D1 record
  if (db) {
    const now = new Date().toISOString()
    if (d1Record) {
      await db
        .update(schema.serverTasks)
        .set({
          template: plan.template,
          name: input.name.trim(),
          frequency: input.frequency,
          cronMinute: cron.minute,
          cronHour: cron.hour,
          cronDayOfWeek: cron.day_of_week,
          time: input.time || null,
          intervalHours: input.intervalHours || null,
          weekday: input.weekday ?? null,
          weekdays: input.weekdays ? JSON.stringify(input.weekdays) : null,
          command: input.command || null,
          delaySeconds: input.delaySeconds || null,
          enabled: input.enabled ?? true,
          updatedAt: now,
        })
        .where(eq(schema.serverTasks.scheduleId, id))
    }
  }

  const humanSchedule = formatScheduleHumanDescription({
    frequency: input.frequency,
    time: input.time,
    weekday: input.weekday,
    weekdays: input.weekdays,
    intervalHours: input.intervalHours,
  })

  return {
    id,
    name: input.name.trim(),
    template: plan.template,
    action: plan.action,
    frequency: input.frequency,
    time: input.time || "04:00",
    intervalHours: input.intervalHours,
    weekday: input.weekday,
    weekdays: input.weekdays,
    command: input.command,
    delaySeconds: input.delaySeconds,
    humanSchedule,
    enabled: input.enabled ?? true,
    isProcessing: false,
    isAdvanced: false,
    isManaged: true,
  }
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
  db?: Database,
): Promise<boolean> {
  const client = clientOverride || createPterodactylClient(env)
  const fullSchedule = await client.getSchedule(id)
  const existingTasks = fullSchedule.attributes.tasks || []

  let d1Record: schema.ServerTaskRecord | undefined
  if (db) {
    d1Record = await db
      .select()
      .from(schema.serverTasks)
      .where(eq(schema.serverTasks.scheduleId, id))
      .get()
  }

  if (!d1Record && existingTasks.length > 1) {
    throw new ServerInfrastructureError(
      SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
      "Esta automatización es avanzada (contiene múltiples tareas) y no puede ser eliminada desde HiKAT.",
    )
  }

  await client.deleteSchedule(id)

  if (db) {
    try {
      await db
        .delete(schema.serverTasks)
        .where(eq(schema.serverTasks.scheduleId, id))
    } catch {}
  }

  return true
}
