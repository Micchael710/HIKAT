import { eq, sql } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  ServerGql,
  CreateServerInputGql,
  GameModLoaderGql,
  ServerProvisioningStatusGql,
} from "@hikat/graphql"
import {
  validateWindowsFolderName,
  normalizeHexColor,
  resolveJavaMajorForMinecraft,
} from "@hikat/shared"
import type { Env } from "../types"
import { getContentMediaById, formatMediaGql } from "./mediaService"
import { validateGameEnvironment } from "./game/gameEnvironmentService"
import { createPterodactylClient } from "./pterodactyl/serverAdministrationService"
import type { IPterodactylClient } from "./pterodactyl/types"

export async function formatServerGql(
  server: schema.Server,
  db: Database,
  env: Env,
  request?: Request,
): Promise<ServerGql> {
  let mainLogo = null
  if (server.mainLogoMediaId) {
    const media = await getContentMediaById(db, server.mainLogoMediaId)
    if (media) {
      mainLogo = formatMediaGql(media, env, request)
    }
  }

  let sidebarLogo = null
  if (server.sidebarLogoMediaId) {
    const media = await getContentMediaById(db, server.sidebarLogoMediaId)
    if (media) {
      sidebarLogo = formatMediaGql(media, env, request)
    }
  }

  return {
    id: server.id,
    name: server.name,
    minecraftVersion: server.minecraftVersion,
    modLoader: server.modLoader as GameModLoaderGql,
    modLoaderVersion: server.modLoaderVersion || null,
    mainLogo,
    sidebarLogo,
    accentColor: server.accentColor || null,
    cpu: server.cpu,
    memoryMb: server.memoryMb,
    diskMb: server.diskMb,
    provisioningStatus: server.provisioningStatus as ServerProvisioningStatusGql,
    launcherActiveReleaseId: server.launcherActiveReleaseId || null,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }
}

export async function getServers(
  db: Database,
  env: Env,
  request?: Request,
): Promise<ServerGql[]> {
  const allServers = await db.select().from(schema.servers).all()
  return Promise.all(allServers.map((s) => formatServerGql(s, db, env, request)))
}

export async function getServerById(
  db: Database,
  env: Env,
  serverId: string,
  request?: Request,
): Promise<ServerGql | null> {
  const server = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .get()

  if (!server) return null
  return formatServerGql(server, db, env, request)
}

export async function createServer(
  db: Database,
  env: Env,
  input: CreateServerInputGql,
  userId: string,
  clientOverride?: IPterodactylClient,
  request?: Request,
): Promise<ServerGql> {
  // 1. Validate Windows folder-safe server name
  const cleanName = validateWindowsFolderName(input.name)

  // 2. Check case-insensitive uniqueness of server name
  const existing = await db
    .select()
    .from(schema.servers)
    .where(sql`lower(${schema.servers.name}) = lower(${cleanName})`)
    .get()

  if (existing) {
    throw createGraphQLError(
      `Ya existe un servidor con el nombre "${cleanName}".`,
      "VALIDATION_ERROR",
    )
  }

  // 3. Validate Minecraft and Loader version against official catalog
  await validateGameEnvironment(
    input.minecraftVersion,
    input.modLoader,
    input.modLoaderVersion,
  )

  // 4. Validate resources
  const cpu = Math.max(50, Math.floor(Number(input.cpu) || 200))
  const memoryMb = Math.max(512, Math.floor(Number(input.memoryMb) || 4096))
  const diskMb = Math.max(1024, Math.floor(Number(input.diskMb) || 10240))

  // 5. Validate and normalize accent color
  const normalizedColor = normalizeHexColor(input.accentColor)

  // 6. Verify logo media references if provided
  if (input.mainLogoMediaId) {
    const mainMedia = await getContentMediaById(db, input.mainLogoMediaId)
    if (!mainMedia) {
      throw createGraphQLError(
        "El medio del logo principal no fue encontrado.",
        "NOT_FOUND",
      )
    }
  }

  if (input.sidebarLogoMediaId) {
    const sideMedia = await getContentMediaById(db, input.sidebarLogoMediaId)
    if (!sideMedia) {
      throw createGraphQLError(
        "El medio del logo de la barra lateral no fue encontrado.",
        "NOT_FOUND",
      )
    }
  }

  const serverId = crypto.randomUUID()
  const now = new Date().toISOString()

  // 7. Insert initial server record in D1 with PROVISIONING status
  await db.insert(schema.servers).values({
    id: serverId,
    name: cleanName,
    minecraftVersion: input.minecraftVersion.trim(),
    modLoader: input.modLoader,
    modLoaderVersion: input.modLoaderVersion?.trim() || null,
    mainLogoMediaId: input.mainLogoMediaId || null,
    sidebarLogoMediaId: input.sidebarLogoMediaId || null,
    accentColor: normalizedColor,
    cpu,
    memoryMb,
    diskMb,
    provisioningStatus: "PROVISIONING",
    createdAt: now,
    updatedAt: now,
  })

  // 8. Provision in Pterodactyl Application API
  const client = clientOverride || createPterodactylClient(env)
  const javaMajor = resolveJavaMajorForMinecraft(input.minecraftVersion)
  const dockerImage =
    env.PTERODACTYL_DEFAULT_DOCKER_IMAGE ||
    `ghcr.io/pterodactyl/yolks:java_${javaMajor}`
  const startup =
    env.PTERODACTYL_DEFAULT_STARTUP ||
    "java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true -jar {{SERVER_JARFILE}}"
  const ownerUserId = Number(env.PTERODACTYL_DEFAULT_OWNER_ID) || 1
  const eggId = Number(env.PTERODACTYL_DEFAULT_EGG_ID) || 1
  const locationId = Number(env.PTERODACTYL_DEFAULT_LOCATION_ID) || 1

  let pterodactylRes: any
  try {
    pterodactylRes = await client.createApplicationServer({
      name: cleanName,
      user: ownerUserId,
      egg: eggId,
      docker_image: dockerImage,
      startup,
      environment: {
        MC_VERSION: input.minecraftVersion.trim(),
        MOD_LOADER: input.modLoader,
        MOD_LOADER_VERSION: input.modLoaderVersion?.trim() || "",
        SERVER_JARFILE: "server.jar",
      },
      limits: {
        memory: memoryMb,
        swap: 0,
        disk: diskMb,
        io: 500,
        cpu,
      },
      feature_limits: {
        databases: 0,
        allocations: 1,
        backups: 10,
      },
      deploy: {
        locations: [locationId],
        dedicated_ip: false,
        port_range: [],
      },
      external_id: serverId,
      start_on_completion: false,
    })
  } catch (err: unknown) {
    // Upstream Pterodactyl provisioning failure: update D1 to FAILED
    await db
      .update(schema.servers)
      .set({
        provisioningStatus: "FAILED",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.servers.id, serverId))

    const errorMsg =
      err instanceof Error ? err.message : "Error al aprovisionar el servidor en Pterodactyl"
    throw createGraphQLError(errorMsg, "INTERNAL_ERROR")
  }

  // 9. Update server with Pterodactyl identifiers and READY status
  const pterodactylId = String(pterodactylRes.attributes.id)
  const pterodactylIdentifier = pterodactylRes.attributes.identifier

  try {
    await db
      .update(schema.servers)
      .set({
        pterodactylServerId: pterodactylId,
        pterodactylIdentifier,
        provisioningStatus: "READY",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.servers.id, serverId))
  } catch (d1UpdateErr) {
    // Compensation cleanup: delete upstream server in Pterodactyl if final D1 save fails
    try {
      await client.deleteApplicationServer(pterodactylRes.attributes.id)
    } catch {}
    try {
      await db
        .update(schema.servers)
        .set({
          provisioningStatus: "FAILED",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.servers.id, serverId))
    } catch {}
    throw d1UpdateErr
  }

  const created = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .get()

  if (!created) {
    throw createGraphQLError("Error al recuperar el servidor creado.", "INTERNAL_ERROR")
  }

  return formatServerGql(created, db, env, request)
}

export async function deleteServer(
  db: Database,
  env: Env,
  serverId: string,
  clientOverride?: IPterodactylClient,
): Promise<boolean> {
  const server = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .get()

  if (!server) {
    throw createGraphQLError("Servidor no encontrado.", "NOT_FOUND")
  }

  // If server has Pterodactyl ID, cleanup upstream
  if (server.pterodactylServerId) {
    try {
      const client = clientOverride || createPterodactylClient(env)
      await client.deleteApplicationServer(server.pterodactylServerId)
    } catch (err) {
      console.error("[ServerService] Failed to delete Pterodactyl server:", err)
      // Continue to delete from D1 fail-safe
    }
  }

  // Delete server record in D1 (CASCADE removes related releases, news, tasks, etc.)
  await db.delete(schema.servers).where(eq(schema.servers.id, serverId))
  return true
}
