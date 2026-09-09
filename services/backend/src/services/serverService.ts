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
  SERVER_MAX_CPU_PERCENT,
} from "@hikat/shared"
import type { Env } from "../types"
import { getContentMediaById, formatMediaGql } from "./mediaService"
import { validateGameEnvironment, getMinecraftJavaMajorVersion } from "./game/gameEnvironmentService"
import { createPterodactylApplicationClient } from "./pterodactyl/serverAdministrationService"
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

async function syncServerProvisioningStatus(
  server: schema.Server,
  db: Database,
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<void> {
  if (server.provisioningStatus !== "PROVISIONING" || !server.pterodactylServerId) {
    return
  }

  try {
    const client = clientOverride || createPterodactylApplicationClient(env)
    const pServer = await client.getApplicationServer(server.pterodactylServerId)
    if (pServer?.attributes) {
      const isInstalled =
        pServer.attributes.container?.installed === 1 ||
        pServer.attributes.status === null
      const isFailed =
        pServer.attributes.container?.installed === 2 ||
        pServer.attributes.status === "install_failed"

      if (isInstalled) {
        server.provisioningStatus = "READY"
        server.updatedAt = new Date().toISOString()
        await db
          .update(schema.servers)
          .set({ provisioningStatus: "READY", updatedAt: server.updatedAt })
          .where(eq(schema.servers.id, server.id))
      } else if (isFailed) {
        server.provisioningStatus = "FAILED"
        server.updatedAt = new Date().toISOString()
        await db
          .update(schema.servers)
          .set({ provisioningStatus: "FAILED", updatedAt: server.updatedAt })
          .where(eq(schema.servers.id, server.id))
      }
    }
  } catch {
    // If Pterodactyl API is temporarily unreachable, leave as PROVISIONING
  }
}

export async function getServers(
  db: Database,
  env: Env,
  request?: Request,
  clientOverride?: IPterodactylClient,
): Promise<ServerGql[]> {
  const allServers = await db.select().from(schema.servers).all()
  await Promise.all(
    allServers.map((s) => syncServerProvisioningStatus(s, db, env, clientOverride)),
  )
  return Promise.all(allServers.map((s) => formatServerGql(s, db, env, request)))
}

export async function getServerById(
  db: Database,
  env: Env,
  serverId: string,
  request?: Request,
  clientOverride?: IPterodactylClient,
): Promise<ServerGql | null> {
  const server = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .get()

  if (!server) return null
  await syncServerProvisioningStatus(server, db, env, clientOverride)
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

  // 4. Validate resources strictly without silent substitution
  const cpu = input.cpu !== undefined && input.cpu !== null ? Number(input.cpu) : 200
  if (!Number.isInteger(cpu) || cpu < 50 || cpu > SERVER_MAX_CPU_PERCENT) {
    throw createGraphQLError(
      `La asignación de CPU debe ser un número entero entre 50% y ${SERVER_MAX_CPU_PERCENT}%.`,
      "VALIDATION_ERROR",
    )
  }

  const memoryMb = input.memoryMb !== undefined && input.memoryMb !== null ? Number(input.memoryMb) : 4096
  if (!Number.isInteger(memoryMb) || memoryMb < 512) {
    throw createGraphQLError(
      "La memoria RAM debe ser un número entero de al menos 512 MB.",
      "VALIDATION_ERROR",
    )
  }

  const diskMb = input.diskMb !== undefined && input.diskMb !== null ? Number(input.diskMb) : 10240
  if (!Number.isInteger(diskMb) || diskMb < 1024) {
    throw createGraphQLError(
      "El espacio en disco debe ser un número entero de al menos 1024 MB.",
      "VALIDATION_ERROR",
    )
  }

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

  interface LoaderProvisioningConfig {
    eggId: number
    dockerImage: string
    startup: string
    environment: Record<string, string>
  }

  function resolvePterodactylLoaderConfig(
    modLoader: GameModLoaderGql,
    minecraftVersion: string,
    modLoaderVersion: string | null | undefined,
    javaMajor: number,
    env: Env,
  ): LoaderProvisioningConfig {
    const mcVersion = minecraftVersion.trim()
    const loaderVersion = modLoaderVersion?.trim() || ""

    let rawEggId: string | undefined
    let dockerImage: string
    let startup: string
    let environment: Record<string, string>

    switch (modLoader) {
      case "VANILLA":
        rawEggId = env.PTERODACTYL_EGG_VANILLA_ID
        dockerImage = `ghcr.io/pterodactyl/yolks:java_${javaMajor}`
        startup = "java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}"
        environment = {
          SERVER_JARFILE: "server.jar",
          VANILLA_VERSION: mcVersion,
        }
        break

      case "FORGE":
        rawEggId = env.PTERODACTYL_EGG_FORGE_ID
        dockerImage = `ghcr.io/pterodactyl/yolks:java_${javaMajor}`
        startup =
          'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true $( [[  ! -f unix_args.txt ]] && printf %s "-jar {{SERVER_JARFILE}}" || printf %s "@unix_args.txt" )'
        environment = {
          SERVER_JARFILE: "server.jar",
          MC_VERSION: mcVersion,
          BUILD_TYPE: "recommended",
          FORGE_VERSION: `${mcVersion}-${loaderVersion}`,
        }
        break

      case "NEOFORGE":
        rawEggId = env.PTERODACTYL_EGG_NEOFORGE_ID
        dockerImage = `ghcr.io/pterodactyl/yolks:java_${javaMajor}`
        startup =
          "java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true @unix_args.txt"
        environment = {
          MC_VERSION: mcVersion,
          NEOFORGE_VERSION: loaderVersion,
        }
        break

      case "FABRIC":
        rawEggId = env.PTERODACTYL_EGG_FABRIC_ID
        dockerImage = `ghcr.io/ptero-eggs/yolks:java_${javaMajor}`
        startup = "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}"
        environment = {
          SERVER_JARFILE: "server.jar",
          MC_VERSION: mcVersion,
          FABRIC_VERSION: "latest",
          LOADER_VERSION: loaderVersion,
        }
        break

      case "QUILT":
        rawEggId = env.PTERODACTYL_EGG_QUILT_ID
        dockerImage = `ghcr.io/ptero-eggs/yolks:java_${javaMajor}`
        startup = "java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}} nogui"
        environment = {
          SERVER_JARFILE: "server.jar",
          MC_VERSION: mcVersion,
          QUILT_LOADER_VERSION: loaderVersion,
        }
        break

      default:
        throw createGraphQLError(
          `Mod loader no soportado: ${modLoader}`,
          "VALIDATION_ERROR",
        )
    }

    const eggId = Number(rawEggId)
    if (!rawEggId || !Number.isInteger(eggId) || eggId <= 0) {
      throw createGraphQLError(
        `La configuración de aprovisionamiento de Pterodactyl para ${modLoader} está incompleta o es inválida (PTERODACTYL_EGG_${modLoader}_ID).`,
        "VALIDATION_ERROR",
      )
    }

    return {
      eggId,
      dockerImage,
      startup,
      environment,
    }
  }

  // 7. Validate Pterodactyl provisioning configuration
  const rawOwnerId = env.PTERODACTYL_DEFAULT_OWNER_ID
  const rawLocationId = env.PTERODACTYL_DEFAULT_LOCATION_ID

  const ownerUserId = Number(rawOwnerId)
  const locationId = Number(rawLocationId)

  if (
    !rawOwnerId ||
    !Number.isInteger(ownerUserId) ||
    ownerUserId <= 0 ||
    !rawLocationId ||
    !Number.isInteger(locationId) ||
    locationId <= 0
  ) {
    throw createGraphQLError(
      "La configuración de aprovisionamiento de Pterodactyl está incompleta o es inválida (PTERODACTYL_DEFAULT_OWNER_ID, PTERODACTYL_DEFAULT_LOCATION_ID).",
      "VALIDATION_ERROR",
    )
  }

  const javaMajor = await getMinecraftJavaMajorVersion(input.minecraftVersion)
  const loaderConfig = resolvePterodactylLoaderConfig(
    input.modLoader,
    input.minecraftVersion,
    input.modLoaderVersion,
    javaMajor,
    env,
  )

  const serverId = crypto.randomUUID()
  const now = new Date().toISOString()

  // 8. Insert initial server record in D1 with PROVISIONING status
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

  // 9. Provision in Pterodactyl Application API
  const client = clientOverride || createPterodactylApplicationClient(env)

  let pterodactylRes: any
  try {
    pterodactylRes = await client.createApplicationServer({
      name: cleanName,
      user: ownerUserId,
      egg: loaderConfig.eggId,
      docker_image: loaderConfig.dockerImage,
      startup: loaderConfig.startup,
      environment: loaderConfig.environment,
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


    console.error("[Pterodactyl Provisioning Error]", {
      serverName: cleanName,
      modLoader: input.modLoader,
      minecraftVersion: input.minecraftVersion.trim(),
      eggId: loaderConfig.eggId,
      locationId,
      memoryMb,
      cpu,
      diskMb,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      internalMessage:
        err && typeof err === "object" && "internalMessage" in err
          ? (err as any).internalMessage
          : undefined,
    })

    const errorMsg =
      err instanceof Error ? err.message : "Error al aprovisionar el servidor en Pterodactyl"
    throw createGraphQLError(errorMsg, "INTERNAL_ERROR")
  }

  // 10. Update server with Pterodactyl identifiers and proper initial status
  const pterodactylId = String(pterodactylRes.attributes.id)
  const pterodactylIdentifier = pterodactylRes.attributes.identifier

  const isAlreadyInstalled =
    pterodactylRes.attributes?.container?.installed === 1 ||
    pterodactylRes.attributes?.status === null

  const initialStatus = isAlreadyInstalled ? "READY" : "PROVISIONING"

  try {
    await db
      .update(schema.servers)
      .set({
        pterodactylServerId: pterodactylId,
        pterodactylIdentifier,
        provisioningStatus: initialStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.servers.id, serverId))
  } catch (d1UpdateErr) {
    // Compensation cleanup: delete upstream server in Pterodactyl if final D1 save fails
    try {
      await client.deleteApplicationServer(pterodactylRes.attributes.id)
    } catch { }
    try {
      await db
        .update(schema.servers)
        .set({
          provisioningStatus: "FAILED",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.servers.id, serverId))
    } catch { }
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
  deletePterodactyl: boolean,
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

  // If deletePterodactyl is true and server has Pterodactyl ID, cleanup upstream first
  if (deletePterodactyl && server.pterodactylServerId) {
    try {
      const client = clientOverride || createPterodactylApplicationClient(env)
      await client.deleteApplicationServer(server.pterodactylServerId)
    } catch (err) {
      console.error("[Pterodactyl Delete Server Error]", {
        serverId,
        pterodactylServerId: server.pterodactylServerId,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        internalMessage:
          err && typeof err === "object" && "internalMessage" in err
            ? (err as any).internalMessage
            : undefined,
      })
      throw createGraphQLError(
        `Error al eliminar el servidor en Pterodactyl: ${err instanceof Error ? err.message : String(err)}. La eliminación local se canceló para permitir reintentar.`,
        "INTERNAL_ERROR",
      )
    }
  }

  // Delete server record in D1 (CASCADE removes server-scoped records: releases, files, news, tasks, tickets, managed content)
  // Does NOT delete: users, auth, skins, capes, global settings, or other servers
  await db.delete(schema.servers).where(eq(schema.servers.id, serverId))
  return true
}

export interface ServerNodeCapacityData {
  totalMemoryMb: number
  allocatedMemoryMb: number
  availableMemoryMb: number
  totalDiskMb: number
  allocatedDiskMb: number
  availableDiskMb: number
}

export async function getServerNodeCapacity(
  env: Env,
  clientOverride?: IPterodactylClient,
): Promise<ServerNodeCapacityData> {
  const client = clientOverride || createPterodactylApplicationClient(env)
  const rawLocationId = env.PTERODACTYL_DEFAULT_LOCATION_ID
  const locationId = rawLocationId ? Number(rawLocationId) : 1

  let node: import("./pterodactyl/types").PterodactylNodeAttributes | undefined

  try {
    const nodesList = await client.listApplicationNodes()
    if (nodesList?.data && nodesList.data.length > 0) {
      const match = nodesList.data.find(
        (n) => n.attributes.location_id === locationId,
      )
      node = match?.attributes || nodesList.data[0]?.attributes
    }
  } catch {
    // If list fails, fallback safely
  }

  if (!node) {
    throw createGraphQLError(
      "No se pudo obtener la información de capacidad del nodo de Pterodactyl.",
      "INTERNAL_ERROR",
    )
  }

  const memoryOverallocate = node.memory_overallocate ?? 0
  const allocatedMemoryMb = node.allocated_resources?.memory || 0
  let maxMemoryMb: number
  let availableMemoryMb: number

  if (memoryOverallocate === -1) {
    maxMemoryMb = node.memory
    availableMemoryMb = node.memory
  } else {
    maxMemoryMb = Math.floor(node.memory * (1 + Math.max(0, memoryOverallocate) / 100))
    availableMemoryMb = Math.max(0, maxMemoryMb - allocatedMemoryMb)
  }

  const diskOverallocate = node.disk_overallocate ?? 0
  const allocatedDiskMb = node.allocated_resources?.disk || 0
  let maxDiskMb: number
  let availableDiskMb: number

  if (diskOverallocate === -1) {
    maxDiskMb = node.disk
    availableDiskMb = node.disk
  } else {
    maxDiskMb = Math.floor(node.disk * (1 + Math.max(0, diskOverallocate) / 100))
    availableDiskMb = Math.max(0, maxDiskMb - allocatedDiskMb)
  }

  return {
    totalMemoryMb: maxMemoryMb,
    allocatedMemoryMb,
    availableMemoryMb,
    totalDiskMb: maxDiskMb,
    allocatedDiskMb,
    availableDiskMb,
  }
}
