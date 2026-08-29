import { eq } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  AdminSettingsGql,
  ClientConfigurationGql,
  UpdateAdminSettingsInputGql,
} from "@hikat/graphql"
import { normalizeIsoDateTime, ALLOWED_UPDATE_DEPLOYMENT_ORDERS } from "@hikat/shared"

export function formatAdminSettings(row: schema.ProjectSetting): AdminSettingsGql {
  return {
    projectName: row.projectName,
    maintenanceEnabled: row.maintenanceEnabled === 1,
    maintenanceMessage: row.maintenanceMessage,
    serverIp: row.serverIp,
    serverPort: row.serverPort,
    discordUrl: row.discordUrl,
    websiteUrl: row.websiteUrl,
    minRamGb: row.minRamGb,
    recommendedRamGb: row.recommendedRamGb,
    updateDeploymentOrder: (row.updateDeploymentOrder as any) || "SERVER_FIRST",
    launcherActiveReleaseId: row.launcherActiveReleaseId || null,
    updatedAt: normalizeIsoDateTime(row.updatedAt),
  }
}

export function formatClientConfiguration(row: schema.ProjectSetting): ClientConfigurationGql {
  return {
    projectName: row.projectName,
    serverIp: row.serverIp,
    serverPort: row.serverPort,
    discordUrl: row.discordUrl,
    websiteUrl: row.websiteUrl,
    maintenanceEnabled: row.maintenanceEnabled === 1,
    maintenanceMessage: row.maintenanceEnabled === 1 ? row.maintenanceMessage : null,
    minRamGb: row.minRamGb,
    recommendedRamGb: row.recommendedRamGb,
  }
}

export async function ensureSettingsRecord(db: Database): Promise<schema.ProjectSetting> {
  const existing = await db
    .select()
    .from(schema.projectSettings)
    .where(eq(schema.projectSettings.id, "main"))
    .get()

  if (existing) {
    // Bootstrap backfill: If launcherActiveReleaseId is null and a legacy PUBLISHED release exists,
    // establish it as the initial baseline active release.
    if (existing.launcherActiveReleaseId === null) {
      const published = await db
        .select()
        .from(schema.gameReleases)
        .where(eq(schema.gameReleases.status, "PUBLISHED"))
        .get()
      if (published) {
        await db
          .update(schema.projectSettings)
          .set({ launcherActiveReleaseId: published.id })
          .where(eq(schema.projectSettings.id, "main"))
        existing.launcherActiveReleaseId = published.id
      }
    }
    return existing
  }

  const published = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "PUBLISHED"))
    .get()

  const now = new Date().toISOString()
  const initial = {
    id: "main",
    projectName: "HiKAT",
    maintenanceEnabled: 0,
    maintenanceMessage: "Servidor en mantenimiento programado. Volvemos pronto.",
    serverIp: "mc.hikat.org",
    serverPort: 25565,
    discordUrl: "https://discord.gg/hikat",
    websiteUrl: "https://hikat.org",
    minRamGb: 4,
    recommendedRamGb: 8,
    updateDeploymentOrder: "SERVER_FIRST",
    launcherActiveReleaseId: published?.id || null,
    updatedBy: null,
    updatedAt: now,
  }

  await db.insert(schema.projectSettings).values(initial)
  return initial
}

export async function getAdminSettings(db: Database): Promise<AdminSettingsGql> {
  const settings = await ensureSettingsRecord(db)
  return formatAdminSettings(settings)
}

export async function getClientConfiguration(db: Database): Promise<ClientConfigurationGql> {
  const settings = await ensureSettingsRecord(db)
  return formatClientConfiguration(settings)
}

export async function updateAdminSettings(
  db: Database,
  input: UpdateAdminSettingsInputGql,
  userId: string,
): Promise<AdminSettingsGql> {
  await ensureSettingsRecord(db)

  const updates: Partial<schema.ProjectSetting> = {
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  }

  if (input.projectName !== undefined && input.projectName !== null) {
    const trimmed = input.projectName.trim()
    if (!trimmed) {
      throw createGraphQLError("El nombre del proyecto no puede estar vacío.", "VALIDATION_ERROR")
    }
    updates.projectName = trimmed
  }

  if (input.maintenanceEnabled !== undefined && input.maintenanceEnabled !== null) {
    updates.maintenanceEnabled = input.maintenanceEnabled ? 1 : 0
  }

  if (input.maintenanceMessage !== undefined && input.maintenanceMessage !== null) {
    updates.maintenanceMessage = input.maintenanceMessage.trim() || "Servidor en mantenimiento."
  }

  if (input.serverIp !== undefined && input.serverIp !== null) {
    const ip = input.serverIp.trim()
    if (!ip) {
      throw createGraphQLError("La IP del servidor no puede estar vacía.", "VALIDATION_ERROR")
    }
    updates.serverIp = ip
  }

  if (input.serverPort !== undefined && input.serverPort !== null) {
    const port = Number(input.serverPort)
    if (isNaN(port) || port < 1 || port > 65535) {
      throw createGraphQLError("El puerto del servidor debe estar entre 1 y 65535.", "VALIDATION_ERROR")
    }
    updates.serverPort = port
  }

  if (input.discordUrl !== undefined) {
    updates.discordUrl = input.discordUrl?.trim() || null
  }

  if (input.websiteUrl !== undefined) {
    updates.websiteUrl = input.websiteUrl?.trim() || null
  }

  if (input.minRamGb !== undefined && input.minRamGb !== null) {
    const minRam = Number(input.minRamGb)
    if (isNaN(minRam) || minRam < 1 || minRam > 64) {
      throw createGraphQLError("La memoria RAM mínima debe estar entre 1 y 64 GB.", "VALIDATION_ERROR")
    }
    updates.minRamGb = minRam
  }

  if (input.recommendedRamGb !== undefined && input.recommendedRamGb !== null) {
    const recRam = Number(input.recommendedRamGb)
    if (isNaN(recRam) || recRam < 1 || recRam > 64) {
      throw createGraphQLError("La memoria RAM recomendada debe estar entre 1 y 64 GB.", "VALIDATION_ERROR")
    }
    updates.recommendedRamGb = recRam
  }

  if (input.updateDeploymentOrder !== undefined && input.updateDeploymentOrder !== null) {
    if (!ALLOWED_UPDATE_DEPLOYMENT_ORDERS.includes(input.updateDeploymentOrder as any)) {
      throw createGraphQLError(
        `Orden de actualización inválido: ${input.updateDeploymentOrder}`,
        "VALIDATION_ERROR",
      )
    }
    updates.updateDeploymentOrder = input.updateDeploymentOrder
  }

  await db
    .update(schema.projectSettings)
    .set(updates)
    .where(eq(schema.projectSettings.id, "main"))

  const updated = await db
    .select()
    .from(schema.projectSettings)
    .where(eq(schema.projectSettings.id, "main"))
    .get()

  return formatAdminSettings(updated!)
}

