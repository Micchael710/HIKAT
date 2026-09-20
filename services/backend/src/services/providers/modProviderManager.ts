import type { Env } from "../../types"
import { schema, type Database } from "@hikat/database"
import { eq, and } from "drizzle-orm"
import { ModrinthAdapter } from "./modrinthAdapter"
import { CurseForgeAdapter } from "./curseforgeAdapter"
import type {
  ModProviderAdapter,
  NormalizedModProject,
  NormalizedModVersion,
} from "./types"
import type {
  ModProviderGql,
  ModSearchPayloadGql,
  ModProviderStatusGql,
  ModProjectDetailGql,
  ModInstallationPlanGql,
  ModInstallationPlanItemGql,
  ModPlanUnresolvedDependencyGql,
  ResolveModPlanInputGql,
  ContentTypeGql,
  ModEnvironmentGql,
  ServerContentSearchPayloadGql,
  ServerContentInstallationPlanGql,
  ServerContentPlanItemGql,
  ResolveServerContentPlanInputGql,
  GameModLoaderGql,
  ModCategoryItemGql,
} from "@hikat/graphql"
import { createGraphQLError } from "@hikat/graphql"

export interface InternalServerTransferItem {
  provider: ModProviderGql
  projectId: string
  projectName: string
  versionId: string
  versionNumber?: string
  fileId?: string | null
  filename: string
  contentType: ContentTypeGql
  environment?: ModEnvironmentGql | null
  downloadUrl: string
  sizeBytes: number
  targetPath: string
  expectedSha256?: string | null
  hashes?: {
    sha1?: string
    sha512?: string
    md5?: string
  }
}

export interface ServerContentPlanResolutionResult {
  plan: ServerContentInstallationPlanGql
  transferItems: InternalServerTransferItem[]
}

export interface NormalizedCategoryInternal {
  key: string
  name: string
  modrinthSlug?: string
  curseForgeCategoryId?: number
  contentType: ContentTypeGql
}

/**
 * Maps HiKAT GameModLoader enum to the loader string used by Modrinth and CurseForge search APIs.
 * Returns empty string when loader filtering is not applicable (e.g. VANILLA or non-MOD content).
 */
export function mapModLoaderToProviderName(modLoader: GameModLoaderGql | string): string {
  switch (modLoader) {
    case "NEOFORGE": return "neoforge"
    case "FORGE": return "forge"
    case "FABRIC": return "fabric"
    case "QUILT": return "quilt"
    case "VANILLA":
    default: return ""
  }
}

export function formatModLoaderDisplayName(modLoader: string): string {
  switch (modLoader.toUpperCase()) {
    case "NEOFORGE": return "NeoForge"
    case "FORGE": return "Forge"
    case "FABRIC": return "Fabric"
    case "QUILT": return "Quilt"
    default: return modLoader
  }
}

export function getLogicalPathForContent(contentType: ContentTypeGql, filename: string): string {
  const cleanFilename = filename.trim().replace(/^[/\\]+/, "")
  switch (contentType) {
    case "MOD":
      return `mods/${cleanFilename}`
    case "RESOURCE_PACK":
      return `resourcepacks/${cleanFilename}`
    case "DATA_PACK":
      return `datapacks/${cleanFilename}`
    case "SHADER":
      return `shaderpacks/${cleanFilename}`
    default:
      return `mods/${cleanFilename}`
  }
}

function isKnownEnvironment(env?: string | null): env is "CLIENT" | "SERVER" | "BOTH" {
  return env === "CLIENT" || env === "SERVER" || env === "BOTH"
}

export function getLogicalPathForServerContent(
  contentType: ContentTypeGql,
  filename: string,
  worldName: string = "world",
): string {
  const cleanFilename = filename.trim().replace(/^[/\\]+/, "")
  if (contentType === "DATA_PACK") {
    return `${worldName}/datapacks/${cleanFilename}`
  }
  return `mods/${cleanFilename}`
}

interface ModSearchCursorData {
  q: string
  ct: string
  mode: "MODRINTH" | "CURSEFORGE" | "ALL"
  cat?: string | null
  ldr?: string | null
  env?: string | null
  mrOff?: number
  cfOff?: number
}

type ServerSearchCursorData = ModSearchCursorData

function encodeSearchCursor(data: ModSearchCursorData): string {
  const json = JSON.stringify(data)
  return Buffer.from(json, "utf-8").toString("base64url")
}

const encodeServerSearchCursor = encodeSearchCursor

function decodeSearchCursor(
  cursorStr: string | null | undefined,
  expectedQuery: string,
  expectedContentType: string,
  expectedMode: "MODRINTH" | "CURSEFORGE" | "ALL",
  expectedCategory?: string | null,
  expectedLoader?: string | null,
  expectedEnv?: string | null,
): ModSearchCursorData | null {
  if (!cursorStr || typeof cursorStr !== "string" || !cursorStr.trim()) return null
  let parsed: ModSearchCursorData
  try {
    const json = Buffer.from(cursorStr, "base64url").toString("utf-8")
    parsed = JSON.parse(json) as ModSearchCursorData
  } catch {
    throw createGraphQLError(
      "Cursor de paginación inválido o corrupto.",
      "VALIDATION_ERROR",
    )
  }

  const normExpectedQuery = expectedQuery.trim().toLowerCase()
  const normExpectedCat =
    expectedCategory && expectedCategory.trim() && expectedCategory !== "ALL" && expectedCategory !== "Todas"
      ? expectedCategory.trim().toLowerCase()
      : null
  const normExpectedLdr = expectedLoader ? expectedLoader.trim().toLowerCase() : null
  const normExpectedEnv = expectedEnv ? expectedEnv.trim() : null

  const parsedCat =
    parsed.cat && parsed.cat.trim() && parsed.cat !== "ALL" && parsed.cat !== "Todas"
      ? parsed.cat.trim().toLowerCase()
      : null
  const parsedLdr = parsed.ldr ? parsed.ldr.trim().toLowerCase() : null
  const parsedEnv = parsed.env ? parsed.env.trim() : null

  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.q !== normExpectedQuery ||
    parsed.ct !== expectedContentType ||
    parsed.mode !== expectedMode ||
    parsedCat !== normExpectedCat ||
    parsedLdr !== normExpectedLdr ||
    parsedEnv !== normExpectedEnv
  ) {
    throw createGraphQLError(
      "El cursor de paginación no coincide con la consulta, tipo de contenido o proveedor solicitados.",
      "VALIDATION_ERROR",
    )
  }

  return parsed
}

const decodeServerSearchCursor = decodeSearchCursor

export interface ScannedFilteredItem {
  item: NormalizedModProject
  rawIndex: number
}

export class ModProviderManager {
  private modrinth = new ModrinthAdapter()
  private curseforge = new CurseForgeAdapter()
  private normalizedCategoryCache = new Map<ContentTypeGql, NormalizedCategoryInternal[]>()

  getAdapter(provider: ModProviderGql): ModProviderAdapter {
    if (provider === "MODRINTH") return this.modrinth
    if (provider === "CURSEFORGE") return this.curseforge
    throw new Error(`Proveedor de contenido no soportado: ${provider}`)
  }

  async getAvailableCategories(
    env: Env,
    contentType: ContentTypeGql = "MOD",
  ): Promise<ModCategoryItemGql[]> {
    const categories = await this.getInternalCategories(env, contentType)
    return categories.map((c) => {
      const providers: ModProviderGql[] = []
      if (c.modrinthSlug) {
        providers.push("MODRINTH")
      }
      if (c.curseForgeCategoryId !== undefined && c.curseForgeCategoryId !== null) {
        providers.push("CURSEFORGE")
      }
      return {
        key: c.key,
        name: c.name,
        providers,
      }
    })
  }

  async getInternalCategories(
    env: Env,
    contentType: ContentTypeGql = "MOD",
  ): Promise<NormalizedCategoryInternal[]> {
    if (this.normalizedCategoryCache.has(contentType)) {
      return this.normalizedCategoryCache.get(contentType)!
    }

    const [mrCategories, cfCategories] = await Promise.all([
      this.modrinth.getCategories ? this.modrinth.getCategories(env, contentType).catch(() => []) : [],
      this.curseforge.getCategories ? this.curseforge.getCategories(env, contentType).catch(() => []) : [],
    ])

    const map = new Map<string, NormalizedCategoryInternal>()

    for (const mr of mrCategories) {
      const key = (mr.slug || mr.name).toLowerCase().replace(/[^a-z0-9_-]/g, "")
      map.set(key, {
        key,
        name: mr.name,
        modrinthSlug: mr.slug || mr.name.toLowerCase(),
        contentType,
      })
    }

    for (const cf of cfCategories) {
      const key = (cf.slug || cf.name).toLowerCase().replace(/[^a-z0-9_-]/g, "")
      const existing = map.get(key)
      if (existing) {
        existing.curseForgeCategoryId = typeof cf.id === "number" ? cf.id : Number(cf.id)
      } else {
        map.set(key, {
          key,
          name: cf.name,
          curseForgeCategoryId: typeof cf.id === "number" ? cf.id : Number(cf.id),
          contentType,
        })
      }
    }

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    this.normalizedCategoryCache.set(contentType, list)
    return list
  }

  private resolveCategoryFiltering(
    categories: NormalizedCategoryInternal[],
    categoryKey?: string | null,
  ): { mrCategorySlug?: string; cfCategoryId?: number; skipModrinth: boolean; skipCurseForge: boolean } {
    if (!categoryKey || !categoryKey.trim() || categoryKey === "ALL" || categoryKey === "Todas") {
      return { skipModrinth: false, skipCurseForge: false }
    }
    const normKey = categoryKey.trim().toLowerCase()
    const matched = categories.find((c) => c.key === normKey)
    if (matched) {
      return {
        mrCategorySlug: matched.modrinthSlug,
        cfCategoryId: matched.curseForgeCategoryId,
        skipModrinth: !matched.modrinthSlug,
        skipCurseForge: !matched.curseForgeCategoryId,
      }
    }
    return {
      mrCategorySlug: normKey,
      skipModrinth: false,
      skipCurseForge: true,
    }
  }

  async getActiveEnvironment(
    db: Database,
    serverId?: string | null,
  ): Promise<{ minecraftVersion: string; modLoader: GameModLoaderGql; modLoaderVersion: string | null; neoForgeVersion: string }> {
    if (serverId) {
      const server = await db
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, serverId))
        .get()

      if (!server) {
        throw createGraphQLError("Servidor no encontrado.", "NOT_FOUND")
      }

      // 1. Try active draft for this server
      const draft = await db
        .select({
          minecraftVersion: schema.gameReleases.minecraftVersion,
          neoForgeVersion: schema.gameReleases.neoForgeVersion,
          modLoader: schema.gameReleases.modLoader,
          modLoaderVersion: schema.gameReleases.modLoaderVersion,
        })
        .from(schema.gameReleases)
        .where(
          and(
            eq(schema.gameReleases.status, "DRAFT"),
            eq(schema.gameReleases.serverId, serverId),
          ),
        )
        .get()

      if (draft) {
        return {
          minecraftVersion: draft.minecraftVersion || server.minecraftVersion || "1.21.1",
          modLoader: ((draft.modLoader || server.modLoader || "NEOFORGE") as GameModLoaderGql),
          modLoaderVersion: draft.modLoaderVersion || server.modLoaderVersion || null,
          neoForgeVersion: draft.neoForgeVersion || server.modLoaderVersion || "21.1.65",
        }
      }

      // 2. Try published release for this server
      const published = await db
        .select({
          minecraftVersion: schema.gameReleases.minecraftVersion,
          neoForgeVersion: schema.gameReleases.neoForgeVersion,
          modLoader: schema.gameReleases.modLoader,
          modLoaderVersion: schema.gameReleases.modLoaderVersion,
        })
        .from(schema.gameReleases)
        .where(
          and(
            eq(schema.gameReleases.status, "PUBLISHED"),
            eq(schema.gameReleases.serverId, serverId),
          ),
        )
        .get()

      if (published) {
        return {
          minecraftVersion: published.minecraftVersion || server.minecraftVersion || "1.21.1",
          modLoader: ((published.modLoader || server.modLoader || "NEOFORGE") as GameModLoaderGql),
          modLoaderVersion: published.modLoaderVersion || server.modLoaderVersion || null,
          neoForgeVersion: published.neoForgeVersion || server.modLoaderVersion || "21.1.65",
        }
      }

      return {
        minecraftVersion: server.minecraftVersion || "1.21.1",
        modLoader: ((server.modLoader || "NEOFORGE") as GameModLoaderGql),
        modLoaderVersion: server.modLoaderVersion || null,
        neoForgeVersion: server.modLoaderVersion || "21.1.65",
      }
    }

    // Legacy fallback ONLY when NO serverId was passed
    const draft = await db
      .select({
        minecraftVersion: schema.gameReleases.minecraftVersion,
        neoForgeVersion: schema.gameReleases.neoForgeVersion,
        modLoader: schema.gameReleases.modLoader,
        modLoaderVersion: schema.gameReleases.modLoaderVersion,
      })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
      .get()

    if (draft) {
      return {
        minecraftVersion: draft.minecraftVersion || "1.21.1",
        modLoader: ((draft.modLoader || "NEOFORGE") as GameModLoaderGql),
        modLoaderVersion: draft.modLoaderVersion || null,
        neoForgeVersion: draft.neoForgeVersion || "21.1.65",
      }
    }

    const published = await db
      .select({
        minecraftVersion: schema.gameReleases.minecraftVersion,
        neoForgeVersion: schema.gameReleases.neoForgeVersion,
        modLoader: schema.gameReleases.modLoader,
        modLoaderVersion: schema.gameReleases.modLoaderVersion,
      })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()

    if (published) {
      return {
        minecraftVersion: published.minecraftVersion || "1.21.1",
        modLoader: ((published.modLoader || "NEOFORGE") as GameModLoaderGql),
        modLoaderVersion: published.modLoaderVersion || null,
        neoForgeVersion: published.neoForgeVersion || "21.1.65",
      }
    }

    return {
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      neoForgeVersion: "21.1.65",
    }
  }

  async getPublishedEnvironment(
    db: Database,
    serverId?: string | null,
  ): Promise<{ minecraftVersion: string; modLoader: GameModLoaderGql; modLoaderVersion: string | null; neoForgeVersion: string; isPublished: boolean; releaseId?: string }> {
    if (serverId) {
      const server = await db
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, serverId))
        .get()

      if (!server) {
        throw createGraphQLError("Servidor no encontrado.", "NOT_FOUND")
      }

      const published = await db
        .select({
          id: schema.gameReleases.id,
          minecraftVersion: schema.gameReleases.minecraftVersion,
          neoForgeVersion: schema.gameReleases.neoForgeVersion,
          modLoader: schema.gameReleases.modLoader,
          modLoaderVersion: schema.gameReleases.modLoaderVersion,
        })
        .from(schema.gameReleases)
        .where(
          and(
            eq(schema.gameReleases.status, "PUBLISHED"),
            eq(schema.gameReleases.serverId, serverId),
          ),
        )
        .get()

      if (published) {
        return {
          releaseId: published.id,
          minecraftVersion: published.minecraftVersion || server.minecraftVersion || "1.21.1",
          modLoader: ((published.modLoader || server.modLoader || "NEOFORGE") as GameModLoaderGql),
          modLoaderVersion: published.modLoaderVersion || server.modLoaderVersion || null,
          neoForgeVersion: published.neoForgeVersion || server.modLoaderVersion || "21.1.65",
          isPublished: true,
        }
      }

      return {
        minecraftVersion: server.minecraftVersion || "1.21.1",
        modLoader: ((server.modLoader || "NEOFORGE") as GameModLoaderGql),
        modLoaderVersion: server.modLoaderVersion || null,
        neoForgeVersion: server.modLoaderVersion || "21.1.65",
        isPublished: false,
      }
    }

    // Legacy fallback ONLY when NO serverId was passed
    const published = await db
      .select({
        id: schema.gameReleases.id,
        minecraftVersion: schema.gameReleases.minecraftVersion,
        neoForgeVersion: schema.gameReleases.neoForgeVersion,
        modLoader: schema.gameReleases.modLoader,
        modLoaderVersion: schema.gameReleases.modLoaderVersion,
      })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()

    if (published) {
      return {
        releaseId: published.id,
        minecraftVersion: published.minecraftVersion || "1.21.1",
        modLoader: ((published.modLoader || "NEOFORGE") as GameModLoaderGql),
        modLoaderVersion: published.modLoaderVersion || null,
        neoForgeVersion: published.neoForgeVersion || "21.1.65",
        isPublished: true,
      }
    }

    return {
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      neoForgeVersion: "21.1.65",
      isPublished: false,
    }
  }

  async searchMods(
    env: Env,
    db: Database,
    query: string,
    provider: ModProviderGql | null | undefined,
    limit: number = 20,
    offset: number = 0,
    contentType: ContentTypeGql = "MOD",
    serverId?: string | null,
    loaderOverride?: GameModLoaderGql | null,
    categoryKey?: string | null,
    environmentFilter?: ModEnvironmentGql | null,
    cursor?: string | null,
  ): Promise<ModSearchPayloadGql> {
    const envData = await this.getActiveEnvironment(db, serverId)
    const { minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion } = envData
    const effectiveLoader = loaderOverride || modLoader
    const loader = contentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""
    const providersStatus: ModProviderStatusGql[] = []

    const categories = await this.getInternalCategories(env, contentType)
    const { mrCategorySlug, cfCategoryId, skipModrinth, skipCurseForge } =
      this.resolveCategoryFiltering(categories, categoryKey)

    const isAllowedInGame = (item: NormalizedModProject) => {
      if (contentType !== "MOD") return true
      if (environmentFilter) {
        return item.environment === environmentFilter
      }
      return true
    }

    // Preserve legacy offset behavior ONLY when offset > 0, no cursor was passed, and no environmentFilter
    const isLegacyOffset = !cursor && offset > 0 && !environmentFilter
    if (isLegacyOffset) {
      if (provider === "MODRINTH") {
        if (skipModrinth) {
          providersStatus.push({ provider: "MODRINTH", available: true, error: null })
          return {
            items: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        }
        try {
          const res = await this.fetchFilteredFromProvider(
            this.modrinth,
            env,
            query,
            minecraftVersion,
            loader,
            offset + limit,
            contentType,
            isAllowedInGame,
            0,
            50,
            mrCategorySlug,
          )
          providersStatus.push({ provider: "MODRINTH", available: true, error: null })
          const mappedItems = res.items.map((i) => i.item)
          return {
            items: mappedItems.slice(offset, offset + limit),
            totalCount: res.providerTotalCount || res.totalCount,
            hasMore: res.hasMore,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        } catch (err: any) {
          providersStatus.push({ provider: "MODRINTH", available: false, error: err.message })
          return {
            items: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        }
      }

      if (provider === "CURSEFORGE") {
        if (!this.curseforge.isConfigured(env)) {
          providersStatus.push({
            provider: "CURSEFORGE",
            available: false,
            error: "CurseForge API Key no está configurada en el servidor.",
          })
          return {
            items: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        }

        if (skipCurseForge) {
          providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
          return {
            items: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        }

        try {
          const res = await this.fetchFilteredFromProvider(
            this.curseforge,
            env,
            query,
            minecraftVersion,
            loader,
            offset + limit,
            contentType,
            isAllowedInGame,
            0,
            50,
            cfCategoryId ? String(cfCategoryId) : undefined,
          )
          providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
          const mappedItems = res.items.map((i) => i.item)
          return {
            items: mappedItems.slice(offset, offset + limit),
            totalCount: res.providerTotalCount || res.totalCount,
            hasMore: res.hasMore,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        } catch (err: any) {
          providersStatus.push({ provider: "CURSEFORGE", available: false, error: err.message })
          return {
            items: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            providersStatus,
            minecraftVersion,
            modLoader,
            modLoaderVersion,
            neoForgeVersion,
          }
        }
      }

      // "Todos" legacy offset
      const fetchLimit = offset + limit
      const [modrinthResult, curseforgeResult] = await Promise.allSettled([
        skipModrinth
          ? Promise.resolve({ items: [], totalCount: 0, providerTotalCount: 0, nextRawOffset: null, hasMore: false })
          : this.fetchFilteredFromProvider(this.modrinth, env, query, minecraftVersion, loader, fetchLimit, contentType, isAllowedInGame, 0, 50, mrCategorySlug),
        !this.curseforge.isConfigured(env) || skipCurseForge
          ? Promise.resolve({ items: [], totalCount: 0, providerTotalCount: 0, nextRawOffset: null, hasMore: false })
          : this.fetchFilteredFromProvider(this.curseforge, env, query, minecraftVersion, loader, fetchLimit, contentType, isAllowedInGame, 0, 50, cfCategoryId ? String(cfCategoryId) : undefined),
      ])

      const allItems: NormalizedModProject[] = []
      let totalCount = 0

      if (modrinthResult.status === "fulfilled") {
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        totalCount += modrinthResult.value.providerTotalCount || modrinthResult.value.totalCount
      } else {
        providersStatus.push({
          provider: "MODRINTH",
          available: false,
          error: modrinthResult.reason?.message || "Error al conectar con Modrinth",
        })
      }

      if (curseforgeResult.status === "fulfilled") {
        const isConf = this.curseforge.isConfigured(env)
        providersStatus.push({
          provider: "CURSEFORGE",
          available: isConf,
          error: isConf ? null : "CurseForge API Key no está configurada.",
        })
        totalCount += curseforgeResult.value.providerTotalCount || curseforgeResult.value.totalCount
      } else {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: curseforgeResult.reason?.message || "Error al conectar con CurseForge",
        })
      }

      const modrinthItems = modrinthResult.status === "fulfilled" ? modrinthResult.value.items.map((i) => i.item) : []
      const curseforgeItems = curseforgeResult.status === "fulfilled" ? curseforgeResult.value.items.map((i) => i.item) : []

      const maxLength = Math.max(modrinthItems.length, curseforgeItems.length)
      for (let i = 0; i < maxLength; i++) {
        if (i < modrinthItems.length) allItems.push(modrinthItems[i]!)
        if (i < curseforgeItems.length) allItems.push(curseforgeItems[i]!)
      }

      return {
        items: allItems.slice(offset, offset + limit),
        totalCount: totalCount || allItems.length,
        hasMore: false,
        nextCursor: null,
        providersStatus,
        minecraftVersion,
        modLoader,
        modLoaderVersion,
        neoForgeVersion,
      }
    }

    const normQuery = query.trim().toLowerCase()
    const mode: "MODRINTH" | "CURSEFORGE" | "ALL" = provider ? provider : "ALL"
    const decodedCursor = decodeSearchCursor(
      cursor,
      query,
      contentType,
      mode,
      categoryKey,
      effectiveLoader,
      environmentFilter,
    )

    let rawResults: {
      items: NormalizedModProject[]
      totalCount: number
      hasMore: boolean
      nextCursor: string | null
      providersStatus: ModProviderStatusGql[]
    }

    if (provider === "MODRINTH") {
      if (skipModrinth) {
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
      } else {
        const startOffset = decodedCursor?.mrOff ?? (cursor ? 0 : offset)
        try {
          const res = await this.fetchFilteredFromProvider(
            this.modrinth,
            env,
            query,
            minecraftVersion,
            loader,
            limit,
            contentType,
            isAllowedInGame,
            startOffset,
            50,
            mrCategorySlug,
          )
          providersStatus.push({ provider: "MODRINTH", available: true, error: null })
          const nextCursor = res.hasMore && res.nextRawOffset !== null
            ? encodeSearchCursor({
                q: normQuery,
                ct: contentType,
                mode: "MODRINTH",
                cat: categoryKey || null,
                ldr: effectiveLoader || null,
                env: environmentFilter || null,
                mrOff: res.nextRawOffset,
              })
            : null

          rawResults = {
            items: res.items.map((i) => i.item),
            totalCount: res.providerTotalCount || res.totalCount,
            hasMore: res.hasMore,
            nextCursor,
            providersStatus,
          }
        } catch (err: any) {
          if (err.extensions?.code === "VALIDATION_ERROR") throw err
          providersStatus.push({ provider: "MODRINTH", available: false, error: err.message })
          rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
        }
      }
    } else if (provider === "CURSEFORGE") {
      if (!this.curseforge.isConfigured(env)) {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: "CurseForge API Key no está configurada en el servidor.",
        })
        rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
      } else if (skipCurseForge) {
        providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
        rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
      } else {
        const startOffset = decodedCursor?.cfOff ?? (cursor ? 0 : offset)
        try {
          const res = await this.fetchFilteredFromProvider(
            this.curseforge,
            env,
            query,
            minecraftVersion,
            loader,
            limit,
            contentType,
            isAllowedInGame,
            startOffset,
            50,
            cfCategoryId ? String(cfCategoryId) : undefined,
          )
          providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
          const nextCursor = res.hasMore && res.nextRawOffset !== null
            ? encodeSearchCursor({
                q: normQuery,
                ct: contentType,
                mode: "CURSEFORGE",
                cat: categoryKey || null,
                ldr: effectiveLoader || null,
                env: environmentFilter || null,
                cfOff: res.nextRawOffset,
              })
            : null

          rawResults = {
            items: res.items.map((i) => i.item),
            totalCount: res.providerTotalCount || res.totalCount,
            hasMore: res.hasMore,
            nextCursor,
            providersStatus,
          }
        } catch (err: any) {
          if (err.extensions?.code === "VALIDATION_ERROR") throw err
          providersStatus.push({ provider: "CURSEFORGE", available: false, error: err.message })
          rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
        }
      }
    } else {
      // ALL providers
      const mrStartOffset = decodedCursor?.mrOff ?? (cursor ? 0 : offset)
      const cfStartOffset = decodedCursor?.cfOff ?? (cursor ? 0 : offset)

      const [modrinthResult, curseforgeResult] = await Promise.allSettled([
        skipModrinth
          ? Promise.resolve({ items: [], totalCount: 0, providerTotalCount: 0, nextRawOffset: null, hasMore: false })
          : this.fetchFilteredFromProvider(
              this.modrinth,
              env,
              query,
              minecraftVersion,
              loader,
              limit,
              contentType,
              isAllowedInGame,
              mrStartOffset,
              50,
              mrCategorySlug,
            ),
        !this.curseforge.isConfigured(env) || skipCurseForge
          ? Promise.resolve({ items: [], totalCount: 0, providerTotalCount: 0, nextRawOffset: null, hasMore: false })
          : this.fetchFilteredFromProvider(
              this.curseforge,
              env,
              query,
              minecraftVersion,
              loader,
              limit,
              contentType,
              isAllowedInGame,
              cfStartOffset,
              50,
              cfCategoryId ? String(cfCategoryId) : undefined,
            ),
      ])

      let mrItems: ScannedFilteredItem[] = []
      let cfItems: ScannedFilteredItem[] = []
      let mrHasMore = false
      let cfHasMore = false
      let mrTotalCount = 0
      let cfTotalCount = 0

      if (modrinthResult.status === "fulfilled") {
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        mrItems = modrinthResult.value.items
        mrHasMore = modrinthResult.value.hasMore
        mrTotalCount = modrinthResult.value.providerTotalCount
      } else {
        providersStatus.push({
          provider: "MODRINTH",
          available: false,
          error: modrinthResult.reason?.message || "Error al conectar con Modrinth",
        })
      }

      if (curseforgeResult.status === "fulfilled") {
        const isConf = this.curseforge.isConfigured(env)
        providersStatus.push({
          provider: "CURSEFORGE",
          available: isConf,
          error: isConf ? null : "CurseForge API Key no está configurada.",
        })
        cfItems = curseforgeResult.value.items
        cfHasMore = curseforgeResult.value.hasMore
        cfTotalCount = curseforgeResult.value.providerTotalCount
      } else {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: curseforgeResult.reason?.message || "Error al conectar con CurseForge",
        })
      }

      const pageItems: NormalizedModProject[] = []
      const seenIds = new Set<string>()
      let mrConsumed = 0
      let cfConsumed = 0

      const maxLen = Math.max(mrItems.length, cfItems.length)
      for (let i = 0; i < maxLen; i++) {
        if (i < mrItems.length && pageItems.length < limit) {
          const entry = mrItems[i]
          if (entry && !seenIds.has(`MODRINTH:${entry.item.projectId}`)) {
            seenIds.add(`MODRINTH:${entry.item.projectId}`)
            pageItems.push(entry.item)
            mrConsumed = i + 1
          }
        }
        if (i < cfItems.length && pageItems.length < limit) {
          const entry = cfItems[i]
          if (entry && !seenIds.has(`CURSEFORGE:${entry.item.projectId}`)) {
            seenIds.add(`CURSEFORGE:${entry.item.projectId}`)
            pageItems.push(entry.item)
            cfConsumed = i + 1
          }
        }
        if (pageItems.length >= limit) {
          break
        }
      }

      let nextMrOff: number | undefined
      let nextCfOff: number | undefined

      if (modrinthResult.status === "fulfilled") {
        if (mrConsumed > 0) {
          const lastConsumed = mrItems[mrConsumed - 1]
          if (lastConsumed) {
            const nextOffset = lastConsumed.rawIndex + 1
            if (nextOffset < mrTotalCount || mrHasMore) {
              nextMrOff = nextOffset
            }
          }
        } else if (mrItems.length > 0) {
          nextMrOff = mrStartOffset
        } else if (mrHasMore) {
          nextMrOff = modrinthResult.value.nextRawOffset ?? mrStartOffset
        }
      }

      if (curseforgeResult.status === "fulfilled" && this.curseforge.isConfigured(env)) {
        if (cfConsumed > 0) {
          const lastConsumed = cfItems[cfConsumed - 1]
          if (lastConsumed) {
            const nextOffset = lastConsumed.rawIndex + 1
            if (nextOffset < cfTotalCount || cfHasMore) {
              nextCfOff = nextOffset
            }
          }
        } else if (cfItems.length > 0) {
          nextCfOff = cfStartOffset
        } else if (cfHasMore) {
          nextCfOff = curseforgeResult.value.nextRawOffset ?? cfStartOffset
        }
      }

      const hasMore = Boolean(nextMrOff !== undefined || nextCfOff !== undefined)
      const nextCursor = hasMore
        ? encodeSearchCursor({
            q: normQuery,
            ct: contentType,
            mode: "ALL",
            cat: categoryKey || null,
            ldr: effectiveLoader || null,
            env: environmentFilter || null,
            mrOff: nextMrOff ?? (modrinthResult.status === "fulfilled" ? mrTotalCount : mrStartOffset),
            cfOff: nextCfOff ?? (curseforgeResult.status === "fulfilled" ? cfTotalCount : cfStartOffset),
          })
        : null

      rawResults = {
        items: pageItems,
        totalCount: mrTotalCount + cfTotalCount || pageItems.length,
        hasMore,
        nextCursor,
        providersStatus,
      }
    }

    return {
      items: rawResults.items,
      totalCount: rawResults.totalCount,
      hasMore: rawResults.hasMore,
      nextCursor: rawResults.nextCursor,
      providersStatus: rawResults.providersStatus,
      minecraftVersion,
      modLoader,
      modLoaderVersion,
      neoForgeVersion,
    }
  }

  async searchServerMods(
    env: Env,
    db: Database,
    query: string,
    provider: ModProviderGql | null | undefined,
    limit: number = 20,
    offset: number = 0,
    contentType: ContentTypeGql = "MOD",
    cursor?: string | null,
    serverId?: string | null,
    loaderOverride?: GameModLoaderGql | null,
    categoryKey?: string | null,
    environmentFilter?: ModEnvironmentGql | null,
  ): Promise<ServerContentSearchPayloadGql> {
    if (contentType !== "MOD" && contentType !== "DATA_PACK") {
      throw createGraphQLError(
        `Tipo de contenido no permitido para el servidor (${contentType}). Solo se admiten Mods de servidor y Data Packs.`,
        "VALIDATION_ERROR",
      )
    }

    const envData = await this.getPublishedEnvironment(db, serverId)
    const { minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion, isPublished } = envData
    const effectiveLoader = loaderOverride || modLoader
    const loader = contentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""
    const providersStatus: ModProviderStatusGql[] = []

    const categories = await this.getInternalCategories(env, contentType)
    const { mrCategorySlug, cfCategoryId, skipModrinth, skipCurseForge } =
      this.resolveCategoryFiltering(categories, categoryKey)

    const isAllowedInServer = (item: NormalizedModProject) => {
      if (contentType !== "MOD") return true
      if (environmentFilter) {
        return item.environment === environmentFilter
      }
      if (item.provider === "MODRINTH") {
        return item.environment === "SERVER" || item.environment === "BOTH"
      }
      if (item.provider === "CURSEFORGE") {
        return item.environment !== "CLIENT"
      }
      return item.environment === "SERVER" || item.environment === "BOTH"
    }

    const normQuery = query.trim().toLowerCase()
    const mode: "MODRINTH" | "CURSEFORGE" | "ALL" = provider ? provider : "ALL"
    const decodedCursor = decodeServerSearchCursor(
      cursor,
      query,
      contentType,
      mode,
      categoryKey,
      effectiveLoader,
      environmentFilter,
    )

    let rawResults: {
      items: NormalizedModProject[]
      totalCount: number
      hasMore: boolean
      nextCursor: string | null
      providersStatus: ModProviderStatusGql[]
    }

    if (provider === "MODRINTH") {
      if (skipModrinth) {
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
      } else {
        const startOffset = decodedCursor?.mrOff ?? (cursor ? 0 : offset)
        try {
          const res = await this.fetchFilteredFromProvider(
            this.modrinth,
            env,
            query,
            minecraftVersion,
            loader,
            limit,
            contentType,
            isAllowedInServer,
            startOffset,
            50,
            mrCategorySlug,
          )
          providersStatus.push({ provider: "MODRINTH", available: true, error: null })
          const nextCursor = res.hasMore && res.nextRawOffset !== null
            ? encodeServerSearchCursor({
                q: normQuery,
                ct: contentType,
                mode: "MODRINTH",
                cat: categoryKey || null,
                ldr: effectiveLoader || null,
                env: environmentFilter || null,
                mrOff: res.nextRawOffset,
              })
            : null

          rawResults = {
            items: res.items.map((i) => i.item),
            totalCount: res.items.length,
            hasMore: res.hasMore,
            nextCursor,
            providersStatus,
          }
        } catch (err: any) {
          if (err.extensions?.code === "VALIDATION_ERROR") throw err
          providersStatus.push({ provider: "MODRINTH", available: false, error: err.message })
          rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
        }
      }
    } else if (provider === "CURSEFORGE") {
      if (!this.curseforge.isConfigured(env)) {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: "CurseForge API Key no está configurada en el servidor.",
        })
        rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
      } else if (skipCurseForge) {
        providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
        rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
      } else {
        const startOffset = decodedCursor?.cfOff ?? (cursor ? 0 : offset)
        try {
          const res = await this.fetchFilteredFromProvider(
            this.curseforge,
            env,
            query,
            minecraftVersion,
            loader,
            limit,
            contentType,
            isAllowedInServer,
            startOffset,
            50,
            cfCategoryId ? String(cfCategoryId) : undefined,
          )
          providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
          const nextCursor = res.hasMore && res.nextRawOffset !== null
            ? encodeServerSearchCursor({
                q: normQuery,
                ct: contentType,
                mode: "CURSEFORGE",
                cat: categoryKey || null,
                ldr: effectiveLoader || null,
                env: environmentFilter || null,
                cfOff: res.nextRawOffset,
              })
            : null

          rawResults = {
            items: res.items.map((i) => i.item),
            totalCount: res.items.length,
            hasMore: res.hasMore,
            nextCursor,
            providersStatus,
          }
        } catch (err: any) {
          if (err.extensions?.code === "VALIDATION_ERROR") throw err
          providersStatus.push({ provider: "CURSEFORGE", available: false, error: err.message })
          rawResults = { items: [], totalCount: 0, hasMore: false, nextCursor: null, providersStatus }
        }
      }
    } else {
      // ALL providers
      const mrStartOffset = decodedCursor?.mrOff ?? (cursor ? 0 : offset)
      const cfStartOffset = decodedCursor?.cfOff ?? (cursor ? 0 : offset)

      const [modrinthResult, curseforgeResult] = await Promise.allSettled([
        skipModrinth
          ? Promise.resolve({ items: [], totalCount: 0, providerTotalCount: 0, nextRawOffset: null, hasMore: false })
          : this.fetchFilteredFromProvider(
              this.modrinth,
              env,
              query,
              minecraftVersion,
              loader,
              limit,
              contentType,
              isAllowedInServer,
              mrStartOffset,
              50,
              mrCategorySlug,
            ),
        !this.curseforge.isConfigured(env) || skipCurseForge
          ? Promise.resolve({ items: [], totalCount: 0, providerTotalCount: 0, nextRawOffset: null, hasMore: false })
          : this.fetchFilteredFromProvider(
              this.curseforge,
              env,
              query,
              minecraftVersion,
              loader,
              limit,
              contentType,
              isAllowedInServer,
              cfStartOffset,
              50,
              cfCategoryId ? String(cfCategoryId) : undefined,
            ),
      ])

      let mrItems: ScannedFilteredItem[] = []
      let cfItems: ScannedFilteredItem[] = []
      let mrHasMore = false
      let cfHasMore = false
      let mrTotalCount = 0
      let cfTotalCount = 0

      if (modrinthResult.status === "fulfilled") {
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        mrItems = modrinthResult.value.items
        mrHasMore = modrinthResult.value.hasMore
        mrTotalCount = modrinthResult.value.providerTotalCount
      } else {
        providersStatus.push({
          provider: "MODRINTH",
          available: false,
          error: modrinthResult.reason?.message || "Error al conectar con Modrinth",
        })
      }

      if (curseforgeResult.status === "fulfilled") {
        const isConf = this.curseforge.isConfigured(env)
        providersStatus.push({
          provider: "CURSEFORGE",
          available: isConf,
          error: isConf ? null : "CurseForge API Key no está configurada.",
        })
        cfItems = curseforgeResult.value.items
        cfHasMore = curseforgeResult.value.hasMore
        cfTotalCount = curseforgeResult.value.providerTotalCount
      } else {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: curseforgeResult.reason?.message || "Error al conectar con CurseForge",
        })
      }

      const pageItems: NormalizedModProject[] = []
      const seenIds = new Set<string>()
      let mrConsumed = 0
      let cfConsumed = 0

      const maxLen = Math.max(mrItems.length, cfItems.length)
      for (let i = 0; i < maxLen; i++) {
        if (i < mrItems.length && pageItems.length < limit) {
          const entry = mrItems[i]
          if (entry && !seenIds.has(`MODRINTH:${entry.item.projectId}`)) {
            seenIds.add(`MODRINTH:${entry.item.projectId}`)
            pageItems.push(entry.item)
            mrConsumed = i + 1
          }
        }
        if (i < cfItems.length && pageItems.length < limit) {
          const entry = cfItems[i]
          if (entry && !seenIds.has(`CURSEFORGE:${entry.item.projectId}`)) {
            seenIds.add(`CURSEFORGE:${entry.item.projectId}`)
            pageItems.push(entry.item)
            cfConsumed = i + 1
          }
        }
        if (pageItems.length >= limit) {
          break
        }
      }

      let nextMrOff: number | undefined
      let nextCfOff: number | undefined

      if (modrinthResult.status === "fulfilled") {
        if (mrConsumed > 0) {
          const lastConsumed = mrItems[mrConsumed - 1]
          if (lastConsumed) {
            const nextOffset = lastConsumed.rawIndex + 1
            if (nextOffset < mrTotalCount || mrHasMore) {
              nextMrOff = nextOffset
            }
          }
        } else if (mrItems.length > 0) {
          nextMrOff = mrStartOffset
        } else if (mrHasMore) {
          nextMrOff = modrinthResult.value.nextRawOffset ?? mrStartOffset
        }
      }

      if (curseforgeResult.status === "fulfilled" && this.curseforge.isConfigured(env)) {
        if (cfConsumed > 0) {
          const lastConsumed = cfItems[cfConsumed - 1]
          if (lastConsumed) {
            const nextOffset = lastConsumed.rawIndex + 1
            if (nextOffset < cfTotalCount || cfHasMore) {
              nextCfOff = nextOffset
            }
          }
        } else if (cfItems.length > 0) {
          nextCfOff = cfStartOffset
        } else if (cfHasMore) {
          nextCfOff = curseforgeResult.value.nextRawOffset ?? cfStartOffset
        }
      }

      const hasMore = Boolean(nextMrOff !== undefined || nextCfOff !== undefined)
      const nextCursor = hasMore
        ? encodeServerSearchCursor({
            q: normQuery,
            ct: contentType,
            mode: "ALL",
            cat: categoryKey || null,
            ldr: effectiveLoader || null,
            env: environmentFilter || null,
            mrOff: nextMrOff ?? (modrinthResult.status === "fulfilled" ? mrTotalCount : mrStartOffset),
            cfOff: nextCfOff ?? (curseforgeResult.status === "fulfilled" ? cfTotalCount : cfStartOffset),
          })
        : null

      rawResults = {
        items: pageItems,
        totalCount: pageItems.length,
        hasMore,
        nextCursor,
        providersStatus,
      }
    }

    return {
      items: rawResults.items as any,
      totalCount: rawResults.totalCount,
      hasMore: rawResults.hasMore,
      nextCursor: rawResults.nextCursor,
      providersStatus: rawResults.providersStatus,
      minecraftVersion,
      modLoader,
      modLoaderVersion,
      neoForgeVersion,
      isPublishedEnvironment: isPublished,
    }
  }

  private async fetchFilteredFromProvider(
    adapter: ModProviderAdapter,
    env: Env,
    query: string,
    minecraftVersion: string,
    loader: string,
    limit: number,
    contentType: ContentTypeGql,
    filterFn: (item: NormalizedModProject) => boolean,
    startRawOffset: number = 0,
    pageSize: number = 50,
    categoryParam?: string,
  ): Promise<{
    items: ScannedFilteredItem[]
    totalCount: number
    providerTotalCount: number
    nextRawOffset: number | null
    hasMore: boolean
  }> {
    const allFilteredItems: ScannedFilteredItem[] = []
    const seenKeys = new Set<string>()
    let currentOffset = startRawOffset
    let providerTotalCount = 0
    const maxBatches = 6 // Safety ceiling: up to 300 raw items per search step
    let reachedEnd = false

    for (let batch = 0; batch < maxBatches; batch++) {
      const res = await adapter.searchMods(
        env,
        query,
        minecraftVersion,
        loader,
        pageSize,
        currentOffset,
        contentType,
        categoryParam,
      )
      providerTotalCount = res.totalCount
      if (!res.items || res.items.length === 0) {
        reachedEnd = true
        break
      }

      let batchReachedLimit = false
      for (let i = 0; i < res.items.length; i++) {
        const rawIdx = currentOffset + i
        const item = res.items[i]
        if (item && filterFn(item)) {
          const itemKey = `${item.provider}:${item.projectId}`
          if (!seenKeys.has(itemKey)) {
            seenKeys.add(itemKey)
            allFilteredItems.push({ item, rawIndex: rawIdx })
          }
        }

        if (allFilteredItems.length >= limit) {
          currentOffset = rawIdx + 1
          batchReachedLimit = true
          break
        }
      }

      if (batchReachedLimit) {
        break
      }

      currentOffset += res.items.length
      if (currentOffset >= providerTotalCount) {
        reachedEnd = true
        break
      }
    }

    const hasMore = !reachedEnd && currentOffset < providerTotalCount
    const nextRawOffset = hasMore ? currentOffset : null

    return {
      items: allFilteredItems,
      totalCount: allFilteredItems.length,
      providerTotalCount,
      nextRawOffset,
      hasMore,
    }
  }

  private async fetchChunkedFromProvider(
    adapter: ModProviderAdapter,
    env: Env,
    query: string,
    minecraftVersion: string,
    loader: string,
    neededCount: number,
    contentType: ContentTypeGql,
    pageSize: number,
  ): Promise<{ items: NormalizedModProject[]; totalCount: number }> {
    const allItems: NormalizedModProject[] = []
    let currentOffset = 0
    let totalCount = 0

    while (allItems.length < neededCount) {
      const take = Math.min(pageSize, neededCount - allItems.length)
      if (take <= 0) break
      const res = await adapter.searchMods(
        env,
        query,
        minecraftVersion,
        loader,
        take,
        currentOffset,
        contentType,
      )
      totalCount = res.totalCount
      if (!res.items || res.items.length === 0) break
      allItems.push(...res.items)
      currentOffset += res.items.length
      if (currentOffset >= totalCount || res.items.length < take) break
    }

    return { items: allItems, totalCount }
  }

  async getProjectDetail(
    env: Env,
    db: Database,
    provider: ModProviderGql,
    projectId: string,
    contentType: ContentTypeGql = "MOD",
    serverId?: string | null,
    loaderOverride?: GameModLoaderGql | null,
  ): Promise<ModProjectDetailGql> {
    const envData = await this.getActiveEnvironment(db, serverId)
    const { minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion } = envData
    const effectiveLoader = loaderOverride || modLoader
    const loader = contentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""

    const adapter = this.getAdapter(provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${provider} no está configurado en el servidor.`,
        "VALIDATION_ERROR",
      )
    }

    // 1. Authoritatively validate supported content types in current draft environment
    let supportedTypes: ContentTypeGql[] = []
    if (typeof adapter.getSupportedContentTypes === "function") {
      supportedTypes = await adapter
        .getSupportedContentTypes(env, projectId, minecraftVersion)
        .catch(() => [])
    }

    if (supportedTypes.length > 0 && !supportedTypes.includes(contentType)) {
      throw createGraphQLError(
        `El proyecto no es compatible con el tipo solicitado (${contentType}) en Minecraft ${minecraftVersion}. Tipos disponibles: ${supportedTypes.join(", ")}.`,
        "VALIDATION_ERROR",
      )
    }

    const [project, compatibleVersions] = await Promise.all([
      adapter.getProject(env, projectId, contentType),
      adapter.getCompatibleVersions(env, projectId, minecraftVersion, loader, contentType),
    ])

    if (!project) {
      throw createGraphQLError("Proyecto no encontrado en el proveedor.", "NOT_FOUND")
    }

    if (supportedTypes.length === 0 && project.contentType && project.contentType !== contentType) {
      throw createGraphQLError(
        `El proyecto "${project.name}" es de tipo ${project.contentType}, no corresponde al tipo solicitado ${contentType}.`,
        "VALIDATION_ERROR",
      )
    }

    // Check if installed in active draft
    let installedVersion: string | null = null
    let isInstalled = false

    const draftConditions = [eq(schema.gameReleases.status, "DRAFT")]
    if (serverId) {
      draftConditions.push(eq(schema.gameReleases.serverId, serverId))
    }

    const draft = await db
      .select({ id: schema.gameReleases.id })
      .from(schema.gameReleases)
      .where(and(...draftConditions))
      .get()

    const targetCategory = contentType === "SHADER" ? "SHADER_PACK" : contentType

    if (draft) {
      const installedFile = await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(
          and(
            eq(schema.gameReleaseFiles.releaseId, draft.id),
            eq(schema.gameReleaseFiles.sourceProvider, provider),
            eq(schema.gameReleaseFiles.sourceProjectId, projectId),
            eq(schema.gameReleaseFiles.category, targetCategory),
          ),
        )
        .get()

      if (installedFile) {
        isInstalled = true
        // Match version number
        const matchingVer = compatibleVersions.find(
          (v) => v.id === installedFile.sourceVersionId || (installedFile.sourceFileId && String(v.fileId) === String(installedFile.sourceFileId)),
        )
        installedVersion = matchingVer?.versionNumber || installedFile.name
      }
    }

    return {
      provider,
      projectId: project.projectId,
      slug: project.slug,
      name: project.name,
      summary: project.summary,
      description: project.description,
      author: project.author,
      iconUrl: project.iconUrl,
      downloads: project.downloads,
      contentType: project.contentType || contentType,
      environment: project.environment || null,
      compatibleVersions: compatibleVersions as any,
      installedVersion,
      isInstalled,
      minecraftVersion,
      modLoader: effectiveLoader,
      modLoaderVersion,
      neoForgeVersion,
    }
  }

  async getServerProjectDetail(
    env: Env,
    db: Database,
    provider: ModProviderGql,
    projectId: string,
    contentType: ContentTypeGql = "MOD",
    serverId?: string | null,
    loaderOverride?: GameModLoaderGql | null,
  ): Promise<ModProjectDetailGql> {
    const envData = await this.getPublishedEnvironment(db, serverId)
    const { minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion } = envData
    const effectiveLoader = loaderOverride || modLoader
    const loader = contentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""

    const adapter = this.getAdapter(provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${provider} no está configurado en el servidor.`,
        "VALIDATION_ERROR",
      )
    }

    let supportedTypes: ContentTypeGql[] = []
    if (typeof adapter.getSupportedContentTypes === "function") {
      supportedTypes = await adapter
        .getSupportedContentTypes(env, projectId, minecraftVersion)
        .catch(() => [])
    }

    if (supportedTypes.length > 0 && !supportedTypes.includes(contentType)) {
      throw createGraphQLError(
        `El proyecto no es compatible con el tipo solicitado (${contentType}) en Minecraft ${minecraftVersion}. Tipos disponibles: ${supportedTypes.join(", ")}.`,
        "VALIDATION_ERROR",
      )
    }

    const [project, compatibleVersions] = await Promise.all([
      adapter.getProject(env, projectId, contentType),
      adapter.getCompatibleVersions(env, projectId, minecraftVersion, loader, contentType),
    ])

    if (!project) {
      throw createGraphQLError("Proyecto no encontrado en el proveedor.", "NOT_FOUND")
    }

    if (supportedTypes.length === 0 && project.contentType && project.contentType !== contentType) {
      throw createGraphQLError(
        `El proyecto "${project.name}" es de tipo ${project.contentType}, no corresponde al tipo solicitado ${contentType}.`,
        "VALIDATION_ERROR",
      )
    }

    // Check if installed in server_managed_content
    let installedVersion: string | null = null
    let isInstalled = false

    const queryConditions = [
      eq(schema.serverManagedContent.provider, provider),
      eq(schema.serverManagedContent.projectId, projectId),
      eq(schema.serverManagedContent.contentType, contentType),
    ]
    if (serverId) {
      queryConditions.push(eq(schema.serverManagedContent.serverId, serverId))
    }

    const managed = await db
      .select()
      .from(schema.serverManagedContent)
      .where(and(...queryConditions))
      .get()

    if (managed) {
      isInstalled = true
      const matchingVer = compatibleVersions.find(
        (v) => v.id === managed.versionId || (managed.fileId && String(v.fileId) === String(managed.fileId)),
      )
      installedVersion = matchingVer?.versionNumber || managed.targetPath.split("/").pop() || null
    }

    return {
      provider,
      projectId: project.projectId,
      slug: project.slug,
      name: project.name,
      summary: project.summary,
      description: project.description,
      author: project.author,
      iconUrl: project.iconUrl,
      downloads: project.downloads,
      contentType: project.contentType || contentType,
      environment: project.environment || null,
      compatibleVersions: compatibleVersions as any,
      installedVersion,
      isInstalled,
      minecraftVersion,
      modLoader: effectiveLoader,
      modLoaderVersion,
      neoForgeVersion,
    }
  }

  getLogicalPathForServerContent(
    contentType: ContentTypeGql,
    filename: string,
    worldName: string = "world",
  ): string {
    return getLogicalPathForServerContent(contentType, filename, worldName)
  }

  async resolveInstallationPlan(
    env: Env,
    db: Database,
    input: ResolveModPlanInputGql,
    serverId?: string | null,
  ): Promise<ModInstallationPlanGql> {
    const envData = await this.getActiveEnvironment(db, serverId)
    const { minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion } = envData
    const contentType = input.contentType || "MOD"
    if (contentType === "DATA_PACK") {
      throw createGraphQLError(
        "Los Data Packs se administran exclusivamente desde Servidor → Archivos.",
        "VALIDATION_ERROR",
      )
    }
    const effectiveLoader = input.loaderOverride || modLoader
    const loader = contentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""

    const adapter = this.getAdapter(input.provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${input.provider} no está disponible.`,
        "VALIDATION_ERROR",
      )
    }

    // 1. Fetch active draft files for status comparison
    let draftFiles: schema.GameReleaseFile[] = []
    const draftConditions = [eq(schema.gameReleases.status, "DRAFT")]
    if (serverId) {
      draftConditions.push(eq(schema.gameReleases.serverId, serverId))
    }
    const draft = await db
      .select({ id: schema.gameReleases.id })
      .from(schema.gameReleases)
      .where(and(...draftConditions))
      .get()

    if (draft) {
      draftFiles = await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(eq(schema.gameReleaseFiles.releaseId, draft.id))
        .all()
    }

    const manualOverridesMap = new Map<string, string>()
    for (const ov of input.manualOverrides || []) {
      if (ov.contentType) {
        manualOverridesMap.set(`${ov.provider}:${ov.projectId}:${ov.contentType}`, ov.versionId)
      } else {
        manualOverridesMap.set(`${ov.provider}:${ov.projectId}`, ov.versionId)
      }
    }

    const itemsMap = new Map<string, ModInstallationPlanItemGql>()
    const optionalDepsMap = new Map<string, ModInstallationPlanItemGql>()
    const conflicts: string[] = []
    const warnings: string[] = []
    const unresolvedDependencies: ModPlanUnresolvedDependencyGql[] = []
    const visitedBranches = new Set<string>()
    const incompatibleRules: Array<{
      provider: ModProviderGql
      sourceName: string
      targetProjectId: string
      targetVersionId?: string | null
      targetFileId?: number | string | null
    }> = []

    // 2. Authoritatively validate supported content types for root project
    let rootSupportedTypes: ContentTypeGql[] = []
    if (typeof adapter.getSupportedContentTypes === "function") {
      rootSupportedTypes = await adapter
        .getSupportedContentTypes(env, input.projectId, minecraftVersion)
        .catch(() => [])
    }

    if (rootSupportedTypes.length > 0 && !rootSupportedTypes.includes(contentType)) {
      throw createGraphQLError(
        `El proyecto no es compatible con el tipo solicitado (${contentType}) en Minecraft ${minecraftVersion}. Tipos disponibles: ${rootSupportedTypes.join(", ")}.`,
        "VALIDATION_ERROR",
      )
    }

    const rootProject = await adapter.getProject(env, input.projectId, contentType)
    if (!rootProject) {
      throw createGraphQLError("Proyecto no encontrado en el proveedor.", "NOT_FOUND")
    }

    if (rootSupportedTypes.length === 0 && rootProject.contentType && rootProject.contentType !== contentType) {
      throw createGraphQLError(
        `El proyecto "${rootProject.name}" es de tipo ${rootProject.contentType}, no corresponde al tipo solicitado ${contentType}.`,
        "VALIDATION_ERROR",
      )
    }

    // Fetch compatible versions with strict compatibility validation (authoritative collection)
    const rootCompatibleVersions = await adapter.getCompatibleVersions(
      env,
      input.projectId,
      minecraftVersion,
      loader,
      contentType,
    )

    const rootVersion = rootCompatibleVersions.find(
      (v) => v.id === input.versionId || v.fileId === input.versionId,
    )

    if (!rootVersion) {
      // Check if version exists to provide authoritative descriptive error (fail-closed: getVersion never turns it valid)
      const directVersion = await adapter
        .getVersion(env, input.versionId, input.projectId, contentType)
        .catch(() => null)

      if (directVersion) {
        if (directVersion.contentType && directVersion.contentType !== contentType) {
          throw createGraphQLError(
            `La versión "${input.versionId}" es de tipo ${directVersion.contentType}, no corresponde al tipo solicitado ${contentType}.`,
            "VALIDATION_ERROR",
          )
        }
        if (!directVersion.gameVersions.includes(minecraftVersion)) {
          throw createGraphQLError(
            `La versión "${input.versionId}" no es compatible con Minecraft ${minecraftVersion}.`,
            "VALIDATION_ERROR",
          )
        }
        const targetLoader = loader.trim().toLowerCase()
        const displayLoader = formatModLoaderDisplayName(effectiveLoader || loader)
        if (
          contentType === "MOD" &&
          (!directVersion.loaders ||
            directVersion.loaders.length === 0 ||
            !directVersion.loaders.map((l) => l.toLowerCase()).includes(targetLoader))
        ) {
          throw createGraphQLError(
            `La versión "${input.versionId}" no es compatible con el loader ${displayLoader}.`,
            "VALIDATION_ERROR",
          )
        }
        throw createGraphQLError(
          `La versión "${input.versionId}" no es compatible con el entorno actual (Minecraft ${minecraftVersion}${contentType === "MOD" ? ` · ${displayLoader}` : ""}).`,
          "VALIDATION_ERROR",
        )
      }

      throw createGraphQLError(
        `La versión seleccionada no fue encontrada o no es compatible con Minecraft ${minecraftVersion}.`,
        "NOT_FOUND",
      )
    }

    const knownRootEnv: ModEnvironmentGql | null =
      isKnownEnvironment(rootVersion.environment)
        ? rootVersion.environment
        : null

    let rootEnv: ModEnvironmentGql | null = knownRootEnv
    if (
      input.environmentOverride === "CLIENT" ||
      input.environmentOverride === "BOTH" ||
      input.environmentOverride === "SERVER"
    ) {
      rootEnv = input.environmentOverride
    }

    const rootProjectName = rootProject?.name || rootVersion.name || "Elemento Principal"
    const rootLogicalPath = getLogicalPathForContent(contentType, rootVersion.filename)
    const rootProjectKey = `${input.provider}:${input.projectId}`

    // Visited tracks exact resolved artifacts: `${provider}:${projectId}:${versionId}`
    const visited = new Set<string>()
    const rootArtifactKey = `${input.provider}:${input.projectId}:${rootVersion.id}`
    visited.add(rootArtifactKey)

    const targetCategory = contentType === "SHADER" ? "SHADER_PACK" : contentType
    const existingRoot = draftFiles.find(
      (f) =>
        f.sourceProvider === input.provider &&
        f.sourceProjectId === input.projectId &&
        f.category === targetCategory,
    )

    let rootAction: "INSTALL" | "UPDATE" | "ALREADY_INSTALLED" | "CONFLICT" = "INSTALL"
    let rootInstalledFileId: string | null = null
    let rootInstalledVersionNumber: string | null = null

    if (existingRoot) {
      rootInstalledFileId = existingRoot.id
      rootInstalledVersionNumber = existingRoot.name
      const isSameVersion =
        Boolean(existingRoot.sourceVersionId && existingRoot.sourceVersionId === rootVersion.id) ||
        Boolean(existingRoot.sourceFileId && rootVersion.fileId && existingRoot.sourceFileId === rootVersion.fileId)
      const isSameEnv = (existingRoot.sourceEnvironment || null) === (rootEnv || null)

      if (isSameVersion && isSameEnv) {
        rootAction = "ALREADY_INSTALLED"
      } else {
        rootAction = "UPDATE"
      }
    }

    itemsMap.set(rootProjectKey, {
      provider: input.provider,
      projectId: input.projectId,
      projectName: rootProjectName,
      versionId: rootVersion.id,
      fileId: rootVersion.fileId || null,
      versionNumber: rootVersion.versionNumber,
      filename: rootVersion.filename,
      sizeBytes: rootVersion.sizeBytes,
      sha256: rootVersion.sha256 || null,
      contentType,
      environment: rootEnv,
      logicalPath: rootLogicalPath,
      isRoot: true,
      isDependency: false,
      isRequired: true,
      isInstalled: Boolean(existingRoot),
      action: rootAction,
      installedFileId: rootInstalledFileId,
      installedVersionNumber: rootInstalledVersionNumber,
      availableCompatibleVersions: rootCompatibleVersions as any,
    })

    // 3. Single recursive dependency graph traversal
    const queue: Array<{
      provider: ModProviderGql
      version: NormalizedModVersion
      parentName: string
    }> = [{ provider: input.provider, version: rootVersion, parentName: rootProjectName }]

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentDeps = current.version.dependencies || []

      for (const dep of currentDeps) {
        if (!dep.projectId && !dep.versionId) {
          if (dep.fileName && dep.dependencyType === "REQUIRED") {
            const reason = `Dependencia requerida externa "${dep.fileName}" no está disponible en el proveedor.`
            warnings.push(reason)
            unresolvedDependencies.push({
              provider: current.provider,
              projectId: null,
              versionId: null,
              projectName: dep.fileName,
              contentType: null,
              reason,
              allVersions: [],
            })
          }
          continue
        }

        // A. Accumulate INCOMPATIBLE restrictions
        if (dep.dependencyType === "INCOMPATIBLE") {
          let targetProjectId = dep.projectId || ""
          const pinnedId = dep.versionId || dep.fileId || null
          if (!targetProjectId && pinnedId) {
            const depAdapter = this.getAdapter(current.provider)
            const pinnedVer = await depAdapter.getVersion(env, pinnedId, null).catch(() => null)
            if (pinnedVer?.projectId) {
              targetProjectId = pinnedVer.projectId
            }
          }

          incompatibleRules.push({
            provider: current.provider,
            sourceName: current.parentName,
            targetProjectId,
            targetVersionId: dep.versionId || null,
            targetFileId: dep.fileId || null,
          })
          continue
        }

        // B. Handle OPTIONAL dependencies (do NOT auto-install, do NOT recurse)
        if (dep.dependencyType === "OPTIONAL") {
          const depProjectId = dep.projectId
          if (
            depProjectId &&
            !optionalDepsMap.has(`${current.provider}:${depProjectId}`) &&
            !itemsMap.has(`${current.provider}:${depProjectId}`)
          ) {
            try {
              const depAdapter = this.getAdapter(current.provider)
              const depProj = await depAdapter.getProject(env, depProjectId).catch(() => null)
              const depFilename = dep.fileName || "optional.jar"
              optionalDepsMap.set(`${current.provider}:${depProjectId}`, {
                provider: current.provider,
                projectId: depProjectId,
                projectName: depProj?.name || dep.projectName || "Dependencia Opcional",
                versionId: dep.versionId || "",
                fileId: dep.fileId || null,
                versionNumber: "",
                filename: depFilename,
                sizeBytes: 0,
                sha256: null,
                contentType: "MOD",
                environment: depProj?.environment || null,
                logicalPath: getLogicalPathForContent("MOD", depFilename),
                isRoot: false,
                isDependency: true,
                isRequired: false,
                isInstalled: draftFiles.some(
                  (f) => f.sourceProvider === current.provider && f.sourceProjectId === depProjectId,
                ),
                action: "ALREADY_INSTALLED",
                installedFileId: null,
                installedVersionNumber: null,
                availableCompatibleVersions: [],
              })
            } catch {
              // Ignore optional resolution errors
            }
          }
          continue
        }

        if (dep.dependencyType !== "REQUIRED") {
          continue
        }

        // C. REQUIRED dependencies
        const depAdapter = this.getAdapter(current.provider)
        let depProjectId = dep.projectId
        const pinnedId = dep.versionId || dep.fileId || null

        if (!depProjectId && pinnedId) {
          const pinnedVer = await depAdapter.getVersion(env, pinnedId, null).catch(() => null)
          if (pinnedVer?.projectId) {
            depProjectId = pinnedVer.projectId
          }
        }

        // 1. If pinned versionId is given, resolve the pinned version directly first
        let pinnedVersionObj: NormalizedModVersion | null = null
        if (pinnedId) {
          pinnedVersionObj = await depAdapter.getVersion(env, pinnedId, depProjectId).catch(() => null)
          if (!depProjectId && pinnedVersionObj?.projectId) {
            depProjectId = pinnedVersionObj.projectId
          }
        }

        if (!depProjectId) {
          const reason = `No se pudo determinar el proyecto correspondiente a la versión/archivo dependiente "${pinnedId || "desconocido"}".`
          warnings.push(reason)
          unresolvedDependencies.push({
            provider: current.provider,
            projectId: null,
            versionId: pinnedId ? String(pinnedId) : null,
            projectName: dep.projectName || null,
            contentType: null,
            reason,
            allVersions: [],
          })
          continue
        }

        // 2. Determine target contentType for the dependency without assuming MOD:
        let depContentType: ContentTypeGql | null = null

        // Query supported types for project scoped to draft minecraftVersion
        let supportedTypes: ContentTypeGql[] = []
        if (typeof depAdapter.getSupportedContentTypes === "function") {
          supportedTypes = await depAdapter.getSupportedContentTypes(env, depProjectId, minecraftVersion).catch(() => [])
        } else {
          const candidate = await depAdapter.getProject(env, depProjectId).catch(() => null)
          if (candidate?.contentType) {
            supportedTypes = [candidate.contentType]
          }
        }

        const manualDepOverride = input.manualOverrides?.find(
          (o) => o.provider === current.provider && o.projectId === depProjectId,
        )

        let manualVersionObj: NormalizedModVersion | null = null
        if (manualDepOverride?.versionId) {
          let manualFetchFailed = false
          try {
            manualVersionObj = await depAdapter.getVersion(env, manualDepOverride.versionId, depProjectId)
          } catch {
            manualFetchFailed = true
          }

          if (manualFetchFailed) {
            const reason = `Error temporal al consultar la versión manual seleccionada "${manualDepOverride.versionId}" para la dependencia "${dep.projectName || depProjectId}".`
            warnings.push(reason)
            let allVers: NormalizedModVersion[] = []
            if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
              allVers = await depAdapter.getProjectVersions(env, depProjectId, "MOD").catch(() => [])
            }
            unresolvedDependencies.push({
              provider: current.provider,
              projectId: depProjectId,
              versionId: manualDepOverride.versionId,
              projectName: dep.projectName || null,
              contentType: null,
              reason,
              allVersions: allVers && allVers.length > 0 ? (allVers as any) : [],
            })
            continue
          }

          if (manualVersionObj === null) {
            conflicts.push(
              `La versión manual seleccionada (${manualDepOverride.versionId}) para "${dep.projectName || depProjectId}" no existe en el proveedor.`,
            )
            continue
          }

          if (manualVersionObj.projectId && depProjectId && manualVersionObj.projectId !== depProjectId) {
            conflicts.push(
              `La versión manual seleccionada no pertenece a la dependencia seleccionada.`,
            )
            continue
          }

          if (manualDepOverride.contentType) {
            depContentType = manualDepOverride.contentType
          } else if (manualVersionObj.contentType) {
            depContentType = manualVersionObj.contentType
          } else {
            const mLoaders = (manualVersionObj.loaders || []).map((l) => l.toLowerCase())
            if (mLoaders.some((l) => ["neoforge", "forge", "fabric", "quilt"].includes(l))) {
              depContentType = "MOD"
            } else if (mLoaders.includes("datapack")) {
              depContentType = "DATA_PACK"
            } else if (mLoaders.includes("minecraft") && supportedTypes.includes("RESOURCE_PACK")) {
              depContentType = "RESOURCE_PACK"
            } else if (supportedTypes.length === 1) {
              depContentType = supportedTypes[0]!
            }
          }
        }

        if (!depContentType) {
          if (pinnedVersionObj) {
            const vLoaders = (pinnedVersionObj.loaders || []).map((l) => l.toLowerCase())
            if (vLoaders.some((l) => ["neoforge", "forge", "fabric", "quilt"].includes(l))) {
              depContentType = "MOD"
            } else if (vLoaders.includes("datapack")) {
              depContentType = "DATA_PACK"
            } else if (vLoaders.includes("minecraft") && supportedTypes.includes("RESOURCE_PACK")) {
              depContentType = "RESOURCE_PACK"
            } else if (
              supportedTypes.includes("SHADER") &&
              !supportedTypes.includes("MOD") &&
              !supportedTypes.includes("RESOURCE_PACK") &&
              !supportedTypes.includes("DATA_PACK")
            ) {
              depContentType = "SHADER"
            } else if (supportedTypes.length === 1) {
              depContentType = supportedTypes[0]!
            } else if (supportedTypes.length > 1) {
              const candidateTypes = supportedTypes.filter((t) => {
                if (t === "MOD") return vLoaders.some((l) => ["neoforge", "forge", "fabric", "quilt"].includes(l))
                if (t === "DATA_PACK") return vLoaders.includes("datapack")
                if (t === "RESOURCE_PACK") return vLoaders.includes("minecraft")
                if (t === "SHADER") return true
                return false
              })
              if (candidateTypes.length === 1) {
                depContentType = candidateTypes[0]!
              } else {
                const reason = `La versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" es de tipo indeterminable o ambigua (tipos compatibles posibles: ${candidateTypes.join(", ")}).`
                warnings.push(reason)
                let allVers: NormalizedModVersion[] = []
                if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
                  allVers = await depAdapter.getProjectVersions(env, depProjectId, "MOD").catch(() => [])
                }
                unresolvedDependencies.push({
                  provider: current.provider,
                  projectId: depProjectId,
                  versionId: pinnedId ? String(pinnedId) : null,
                  projectName: dep.projectName || null,
                  contentType: null,
                  reason,
                  allVersions: allVers && allVers.length > 0 ? (allVers as any) : [],
                })
                continue
              }
            } else {
              const reason = `No se pudo determinar el tipo de contenido para la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}".`
              warnings.push(reason)
              let allVers: NormalizedModVersion[] = []
              if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
                allVers = await depAdapter.getProjectVersions(env, depProjectId, "MOD").catch(() => [])
              }
              unresolvedDependencies.push({
                provider: current.provider,
                projectId: depProjectId,
                versionId: pinnedId ? String(pinnedId) : null,
                projectName: dep.projectName || null,
                contentType: null,
                reason,
                allVersions: allVers && allVers.length > 0 ? (allVers as any) : [],
              })
              continue
            }
          } else {
            if (supportedTypes.length === 1) {
              depContentType = supportedTypes[0]!
            } else if (supportedTypes.length > 1) {
              const reason = `La dependencia "${dep.projectName || depProjectId}" es multi-tipo y ambigua (soporta ${supportedTypes.join(", ")}); se requiere especificar versión o resolver manualmente.`
              warnings.push(reason)
              let allVers: NormalizedModVersion[] = []
              if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
                allVers = await depAdapter.getProjectVersions(env, depProjectId, "MOD").catch(() => [])
              }
              unresolvedDependencies.push({
                provider: current.provider,
                projectId: depProjectId,
                versionId: null,
                projectName: dep.projectName || null,
                contentType: null,
                reason,
                allVersions: allVers && allVers.length > 0 ? (allVers as any) : [],
              })
              continue
            } else {
              const reason = `La dependencia "${dep.projectName || depProjectId}" tiene un tipo de contenido desconocido o no soportado.`
              warnings.push(reason)
              let allVers: NormalizedModVersion[] = []
              if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
                allVers = await depAdapter.getProjectVersions(env, depProjectId, "MOD").catch(() => [])
              }
              unresolvedDependencies.push({
                provider: current.provider,
                projectId: depProjectId,
                versionId: null,
                projectName: dep.projectName || null,
                contentType: null,
                reason,
                allVersions: allVers && allVers.length > 0 ? (allVers as any) : [],
              })
              continue
            }
          }
        }

        // Check if dep is DATA_PACK per Shard 08D rules
        if (depContentType === "DATA_PACK") {
          const reason = `La dependencia "${dep.projectName || depProjectId}" es un Data Pack y debe administrarse desde Servidor → Archivos.`
          warnings.push(reason)
          unresolvedDependencies.push({
            provider: current.provider,
            projectId: depProjectId,
            versionId: pinnedId || null,
            projectName: dep.projectName || null,
            contentType: "DATA_PACK",
            reason,
            allVersions: [],
          })
          continue
        }

        const depProject = await depAdapter.getProject(env, depProjectId, depContentType).catch(() => null)
        const depProjectName = depProject?.name || dep.projectName || "Dependencia"

        let selectedDepVersion: NormalizedModVersion | null = null
        let depCompatibleVersions: NormalizedModVersion[] = []

        if (manualDepOverride?.versionId && manualVersionObj) {
          selectedDepVersion = manualVersionObj
          warnings.push(
            `Se forzó manualmente la versión "${selectedDepVersion.versionNumber || selectedDepVersion.id}" para "${depProjectName}". Verifique la compatibilidad en juego.`,
          )
        } else if (pinnedId) {
          const depLoader = depContentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""
          try {
            depCompatibleVersions = await depAdapter.getCompatibleVersions(
              env,
              depProjectId,
              minecraftVersion,
              depLoader,
              depContentType,
            )
          } catch {
            // Ignore
          }

          if (pinnedVersionObj && pinnedVersionObj.gameVersions.includes(minecraftVersion)) {
            selectedDepVersion = pinnedVersionObj
          } else if (depCompatibleVersions.length > 0) {
            const sorted = [...depCompatibleVersions].sort((a, b) => {
              const rankA = a.releaseType === "RELEASE" ? 3 : a.releaseType === "BETA" ? 2 : 1
              const rankB = b.releaseType === "RELEASE" ? 3 : b.releaseType === "BETA" ? 2 : 1
              if (rankA !== rankB) return rankB - rankA
              return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
            })
            selectedDepVersion = sorted[0]!
            warnings.push(
              `El mod "${depProjectName}" requería la versión "${pinnedId}", pero no es compatible con Minecraft ${minecraftVersion}. Se seleccionó automáticamente la versión compatible "${selectedDepVersion.versionNumber}".`,
            )
          } else {
            let allVersionsForDep: NormalizedModVersion[] | null = null
            if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
              allVersionsForDep = await depAdapter
                .getProjectVersions(env, depProjectId, depContentType)
                .catch(() => null)
            }
            const reason = `No se encontró ninguna versión compatible con Minecraft ${minecraftVersion}${depContentType === "MOD" ? ` y loader ${formatModLoaderDisplayName(effectiveLoader || depLoader)}` : ""}.`
            warnings.push(
              `No se encontró versión compatible para "${depProjectName}". Puede seleccionar una versión manualmente.`,
            )
            unresolvedDependencies.push({
              provider: current.provider,
              projectId: depProjectId,
              versionId: pinnedId,
              projectName: depProjectName,
              contentType: depContentType,
              reason,
              allVersions: allVersionsForDep && allVersionsForDep.length > 0 ? (allVersionsForDep as any) : null,
            })
            continue
          }
        } else {
          const depLoader = depContentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""
          try {
            depCompatibleVersions = await depAdapter.getCompatibleVersions(
              env,
              depProjectId,
              minecraftVersion,
              depLoader,
              depContentType,
            )
          } catch {
            // Ignore
          }

          if (depCompatibleVersions.length > 0) {
            const sorted = [...depCompatibleVersions].sort((a, b) => {
              const rankA = a.releaseType === "RELEASE" ? 3 : a.releaseType === "BETA" ? 2 : 1
              const rankB = b.releaseType === "RELEASE" ? 3 : b.releaseType === "BETA" ? 2 : 1
              if (rankA !== rankB) return rankB - rankA
              return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
            })
            selectedDepVersion = sorted[0]!
          } else {
            let allVersionsForDep: NormalizedModVersion[] | null = null
            if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
              allVersionsForDep = await depAdapter
                .getProjectVersions(env, depProjectId, depContentType)
                .catch(() => null)
            }
            const reason = `No se encontró ninguna versión compatible con Minecraft ${minecraftVersion}${depContentType === "MOD" ? ` y loader ${formatModLoaderDisplayName(effectiveLoader || depLoader)}` : ""}.`
            warnings.push(
              `No se encontró versión compatible para "${depProjectName}". Puede seleccionar una versión manualmente.`,
            )
            unresolvedDependencies.push({
              provider: current.provider,
              projectId: depProjectId,
              versionId: null,
              projectName: depProjectName,
              contentType: depContentType,
              reason,
              allVersions: allVersionsForDep && allVersionsForDep.length > 0 ? (allVersionsForDep as any) : null,
            })
            continue
          }
        }

        if (!selectedDepVersion) {
          warnings.push(`No se pudo resolver una versión válida para la dependencia "${depProjectName}".`)
          continue
        }

        // Construct exact artifactKey for visited tracking
        const artifactKey = `${current.provider}:${depProjectId}:${selectedDepVersion.id}`
        if (visited.has(artifactKey)) {
          // Exact artifact already processed (diamond dependency or cycle cut)
          continue
        }
        visited.add(artifactKey)

        // Check project-level version conflict in itemsMap
        const projectKey = `${current.provider}:${depProjectId}`
        const existingItem = itemsMap.get(projectKey)

        if (existingItem) {
          if (existingItem.versionId !== selectedDepVersion.id) {
            conflicts.push(
              `Conflicto de versiones para el proyecto "${depProjectName}": se solicitaron las versiones "${existingItem.versionNumber || existingItem.versionId}" y "${selectedDepVersion.versionNumber || selectedDepVersion.id}".`,
            )
          }
          continue
        }

        let depEnv: ModEnvironmentGql | null = null
        if (isKnownEnvironment(selectedDepVersion.environment)) {
          depEnv = selectedDepVersion.environment
        } else if (isKnownEnvironment(rootEnv)) {
          depEnv = rootEnv
        }

        const depCategory = depContentType === "SHADER" ? "SHADER_PACK" : depContentType
        const existingDep = draftFiles.find(
          (f) =>
            f.sourceProvider === current.provider &&
            f.sourceProjectId === depProjectId &&
            f.category === depCategory,
        )

        let depAction: "INSTALL" | "UPDATE" | "ALREADY_INSTALLED" | "CONFLICT" = "INSTALL"
        let depInstalledFileId: string | null = null
        let depInstalledVersionNumber: string | null = null

        if (existingDep) {
          depInstalledFileId = existingDep.id
          depInstalledVersionNumber = existingDep.name
          const isSameVersion =
            Boolean(existingDep.sourceVersionId && existingDep.sourceVersionId === selectedDepVersion.id) ||
            Boolean(existingDep.sourceFileId && selectedDepVersion.fileId && existingDep.sourceFileId === selectedDepVersion.fileId)
          const isSameEnv = (existingDep.sourceEnvironment || null) === (depEnv || null)

          if (isSameVersion && isSameEnv) {
            depAction = "ALREADY_INSTALLED"
          } else {
            depAction = "UPDATE"
          }
        }

        let allVersionsForDep: NormalizedModVersion[] | null = null
        if (input.includeAllVersions && typeof depAdapter.getProjectVersions === "function") {
          allVersionsForDep = await depAdapter
            .getProjectVersions(env, depProjectId, depContentType)
            .catch(() => null)
        }

        const finalDepContentType: ContentTypeGql = depContentType || selectedDepVersion.contentType || "MOD"
        const depLogicalPath = getLogicalPathForContent(finalDepContentType, selectedDepVersion.filename)

        itemsMap.set(projectKey, {
          provider: current.provider,
          projectId: depProjectId,
          projectName: depProjectName,
          versionId: selectedDepVersion.id,
          fileId: selectedDepVersion.fileId || null,
          versionNumber: selectedDepVersion.versionNumber,
          filename: selectedDepVersion.filename,
          sizeBytes: selectedDepVersion.sizeBytes,
          sha256: selectedDepVersion.sha256 || null,
          contentType: finalDepContentType,
          environment: depEnv,
          logicalPath: depLogicalPath,
          isRoot: false,
          isDependency: true,
          isRequired: true,
          isInstalled: Boolean(existingDep),
          action: depAction,
          installedFileId: depInstalledFileId,
          installedVersionNumber: depInstalledVersionNumber,
          availableCompatibleVersions: depCompatibleVersions as any,
          allVersions: allVersionsForDep && allVersionsForDep.length > 0 ? (allVersionsForDep as any) : null,
        })

        // Enqueue to resolve transitive dependencies recursively
        queue.push({
          provider: current.provider,
          version: selectedDepVersion,
          parentName: depProjectName,
        })
      }
    }

    // 4. Evaluate accumulated INCOMPATIBLE rules against draftFiles and resolved plan items
    for (const rule of incompatibleRules) {
      if (!rule.targetProjectId) continue

      // Check DRAFT files (scoped to the same provider)
      const draftMatch = draftFiles.find(
        (f) =>
          f.sourceProvider === rule.provider &&
          (f.sourceProjectId === rule.targetProjectId || f.id === rule.targetProjectId),
      )
      if (draftMatch) {
        if (rule.targetVersionId || rule.targetFileId) {
          const isSameVersion =
            Boolean(rule.targetVersionId && draftMatch.sourceVersionId === rule.targetVersionId) ||
            Boolean(rule.targetFileId && draftMatch.sourceFileId && String(draftMatch.sourceFileId) === String(rule.targetFileId))
          if (isSameVersion) {
            warnings.push(
              `Incompatibilidad detectada: "${rule.sourceName}" declara incompatibilidad con la versión instalada de "${draftMatch.name}".`,
            )
          }
        } else {
          warnings.push(
            `Incompatibilidad detectada: "${rule.sourceName}" declara incompatibilidad con "${draftMatch.name}".`,
          )
        }
      }

      // Check resolved plan items (scoped to the same provider)
      const planMatches = Array.from(itemsMap.values()).filter(
        (i) => i.provider === rule.provider && i.projectId === rule.targetProjectId,
      )
      for (const planMatch of planMatches) {
        if (rule.targetVersionId || rule.targetFileId) {
          const isSameVersion =
            Boolean(rule.targetVersionId && planMatch.versionId === rule.targetVersionId) ||
            Boolean(rule.targetFileId && planMatch.fileId && String(planMatch.fileId) === String(rule.targetFileId))
          if (isSameVersion) {
            warnings.push(
              `Incompatibilidad detectada: "${rule.sourceName}" declara incompatibilidad con la versión seleccionada de "${planMatch.projectName}".`,
            )
          }
        } else {
          warnings.push(
            `Incompatibilidad detectada: "${rule.sourceName}" declara incompatibilidad con "${planMatch.projectName}".`,
          )
        }
      }
    }

    const items = Array.from(itemsMap.values())
    const totalDownloadSizeBytes = items
      .filter((i) => i.action === "INSTALL" || i.action === "UPDATE")
      .reduce((sum, i) => sum + (i.sizeBytes || 0), 0)

    return {
      items,
      totalDownloadSizeBytes,
      conflicts,
      warnings,
      optionalDependencies: Array.from(optionalDepsMap.values()),
      unresolvedDependencies,
      isValid: conflicts.length === 0,
    }
  }

  async resolveServerInstallationPlan(
    env: Env,
    db: Database,
    input: ResolveServerContentPlanInputGql,
    activeWorldName: string = "world",
    serverId?: string | null,
  ): Promise<ServerContentInstallationPlanGql> {
    const envData = await this.getPublishedEnvironment(db, serverId)
    const conditions = serverId ? [eq(schema.serverManagedContent.serverId, serverId)] : []
    const managedRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .where(and(...conditions))
      .all()

    const result = await this.resolveServerInstallationPlanWithContext(env, input, {
      envData,
      managedRecords,
      activeWorldName,
      serverId,
    })
    return result.plan
  }

  async resolveServerInstallationPlanWithContext(
    env: Env,
    input: ResolveServerContentPlanInputGql,
    context: {
      envData: {
        minecraftVersion: string
        modLoader: GameModLoaderGql
        modLoaderVersion: string | null
        neoForgeVersion: string
        isPublished: boolean
        releaseId?: string
      }
      managedRecords: (typeof schema.serverManagedContent.$inferSelect)[]
      activeWorldName?: string
      serverId?: string | null
      maxResolvedInstallItems?: number
    },
  ): Promise<ServerContentPlanResolutionResult> {
    const contentType = input.contentType || "MOD"
    if (contentType !== "MOD" && contentType !== "DATA_PACK") {
      throw createGraphQLError(
        `Tipo de contenido no permitido para el servidor (${contentType}). Solo se admiten Mods de servidor y Data Packs.`,
        "VALIDATION_ERROR",
      )
    }

    const { envData, managedRecords, activeWorldName = "world", maxResolvedInstallItems } = context
    const { minecraftVersion, modLoader } = envData
    const effectiveLoader = input.loaderOverride || modLoader
    const loader = contentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""

    const adapter = this.getAdapter(input.provider)
    if (adapter && typeof adapter.isConfigured === "function" && !adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${input.provider} no está disponible.`,
        "VALIDATION_ERROR",
      )
    }

    const manualOverridesMap = new Map<string, string>()
    for (const ov of input.manualOverrides || []) {
      if (ov.contentType) {
        manualOverridesMap.set(`${ov.provider}:${ov.projectId}:${ov.contentType}`, ov.versionId)
      } else {
        manualOverridesMap.set(`${ov.provider}:${ov.projectId}`, ov.versionId)
      }
    }

    const itemsMap = new Map<string, ServerContentPlanItemGql>()
    const transferItemsMap = new Map<string, InternalServerTransferItem>()
    const optionalDepsMap = new Map<string, ServerContentPlanItemGql>()
    const conflicts: string[] = []
    const visitedBranches = new Set<string>()
    const incompatibleRules: Array<{
      provider: ModProviderGql
      sourceName: string
      targetProjectId: string
      targetVersionId?: string | null
      targetFileId?: number | string | null
    }> = []

    let requiresGameUpdate = false
    let gameUpdateReason: string | null = null

    // 2. Authoritatively validate supported content types for root project
    let rootSupportedTypes: ContentTypeGql[] = []
    if (typeof adapter.getSupportedContentTypes === "function") {
      rootSupportedTypes = await adapter
        .getSupportedContentTypes(env, input.projectId, minecraftVersion)
        .catch(() => [])
    }

    if (rootSupportedTypes.length > 0 && !rootSupportedTypes.includes(contentType)) {
      throw createGraphQLError(
        `El proyecto no es compatible con el tipo solicitado (${contentType}) en Minecraft ${minecraftVersion}. Tipos disponibles: ${rootSupportedTypes.join(", ")}.`,
        "VALIDATION_ERROR",
      )
    }

    const rootProject = await adapter.getProject(env, input.projectId, contentType)
    if (!rootProject) {
      throw createGraphQLError("Proyecto no encontrado en el proveedor.", "NOT_FOUND")
    }

    if (rootSupportedTypes.length === 0 && rootProject.contentType && rootProject.contentType !== contentType) {
      throw createGraphQLError(
        `El proyecto "${rootProject.name}" es de tipo ${rootProject.contentType}, no corresponde al tipo solicitado ${contentType}.`,
        "VALIDATION_ERROR",
      )
    }

    // Fetch compatible versions with strict compatibility validation
    const rootCompatibleVersions = await adapter.getCompatibleVersions(
      env,
      input.projectId,
      minecraftVersion,
      loader,
      contentType,
    )

    const rootVersion = rootCompatibleVersions.find(
      (v) => v.id === input.versionId || v.fileId === input.versionId,
    )

    if (!rootVersion) {
      const directVersion = await adapter
        .getVersion(env, input.versionId, input.projectId, contentType)
        .catch(() => null)

      if (directVersion) {
        if (directVersion.contentType && directVersion.contentType !== contentType) {
          throw createGraphQLError(
            `La versión "${input.versionId}" es de tipo ${directVersion.contentType}, no corresponde al tipo solicitado ${contentType}.`,
            "VALIDATION_ERROR",
          )
        }
        if (!directVersion.gameVersions.includes(minecraftVersion)) {
          throw createGraphQLError(
            `La versión "${input.versionId}" no es compatible con Minecraft ${minecraftVersion}.`,
            "VALIDATION_ERROR",
          )
        }
        const targetLoader = loader.trim().toLowerCase()
        const displayLoader = formatModLoaderDisplayName(effectiveLoader || loader)
        if (
          contentType === "MOD" &&
          (!directVersion.loaders ||
            directVersion.loaders.length === 0 ||
            !directVersion.loaders.map((l) => l.toLowerCase()).includes(targetLoader))
        ) {
          throw createGraphQLError(
            `La versión "${input.versionId}" no es compatible con el loader ${displayLoader}.`,
            "VALIDATION_ERROR",
          )
        }
        throw createGraphQLError(
          `La versión "${input.versionId}" no es compatible con el entorno actual del servidor (Minecraft ${minecraftVersion}${contentType === "MOD" ? ` · ${displayLoader}` : ""}).`,
          "VALIDATION_ERROR",
        )
      }

      throw createGraphQLError(
        `La versión seleccionada no fue encontrada o no es compatible con Minecraft ${minecraftVersion}.`,
        "NOT_FOUND",
      )
    }

    // Root project/version environment check for server installation
    const knownRootEnv: ModEnvironmentGql | null =
      isKnownEnvironment(rootProject.environment)
        ? rootProject.environment
        : isKnownEnvironment(rootVersion.environment)
        ? rootVersion.environment
        : null

    let rootEnv: ModEnvironmentGql | null = knownRootEnv
    if (contentType === "MOD") {
      if (input.provider === "CURSEFORGE" && !isKnownEnvironment(rootEnv)) {
        if (input.environmentOverride === "BOTH") {
          return {
            plan: {
              items: [],
              totalDownloadSizeBytes: 0,
              conflicts: ["Este mod también es necesario en los clientes. Debe añadirse desde Juego → Actualizaciones."],
              optionalDependencies: [],
              isValid: false,
              requiresGameUpdate: true,
              gameUpdateReason: "Este mod también es necesario en los clientes. Añade este mod desde Juego → Actualizaciones.",
            },
            transferItems: [],
          }
        } else if (input.environmentOverride === "SERVER") {
          rootEnv = "SERVER"
        } else if (input.environmentOverride === "CLIENT") {
          throw createGraphQLError(
            "Este mod es exclusivo del cliente y no corresponde al servidor.",
            "VALIDATION_ERROR",
          )
        } else {
          throw createGraphQLError(
            "HiKAT no puede garantizar que este mod sea exclusivamente de servidor. Debe añadirse desde Juego → Actualizaciones o verificar su configuración.",
            "VALIDATION_ERROR",
          )
        }
      }

      if (rootEnv === "BOTH") {
        return {
          plan: {
            items: [],
            totalDownloadSizeBytes: 0,
            conflicts: ["Este mod también es necesario en los clientes. Debe añadirse desde Juego → Actualizaciones."],
            optionalDependencies: [],
            isValid: false,
            requiresGameUpdate: true,
            gameUpdateReason: "Este mod también es necesario en los clientes. Añade este mod desde Juego → Actualizaciones.",
          },
          transferItems: [],
        }
      }
      if (rootEnv === "CLIENT") {
        throw createGraphQLError(
          "Este mod es exclusivo del cliente y no corresponde al servidor.",
          "VALIDATION_ERROR",
        )
      }
      if (!isKnownEnvironment(rootEnv)) {
        throw createGraphQLError(
          "HiKAT no puede garantizar que este mod sea exclusivamente de servidor. Debe añadirse desde Juego → Actualizaciones o verificar su configuración.",
          "VALIDATION_ERROR",
        )
      }
    }

    const rootProjectName = rootProject?.name || rootVersion.name || "Elemento Principal"
    const rootTargetPath = getLogicalPathForServerContent(contentType, rootVersion.filename, activeWorldName)

    // Add root item with 3-part identity key
    const rootKey = `${input.provider}:${input.projectId}:${contentType}`
    visitedBranches.add(rootKey)

    const existingRoot = managedRecords.find(
      (m) =>
        m.provider === input.provider &&
        m.projectId === input.projectId &&
        m.contentType === contentType,
    )

    let rootAction: "INSTALL" | "UPDATE" | "ALREADY_INSTALLED" | "CONFLICT" = "INSTALL"
    let rootInstalledManagedId: string | null = null
    let rootInstalledVersionNumber: string | null = null

    if (existingRoot) {
      rootInstalledManagedId = existingRoot.id
      rootInstalledVersionNumber = existingRoot.targetPath.split("/").pop() || null
      const isSameVersion =
        Boolean(existingRoot.versionId && existingRoot.versionId === rootVersion.id) ||
        Boolean(existingRoot.fileId && rootVersion.fileId && existingRoot.fileId === rootVersion.fileId)

      if (isSameVersion) {
        rootAction = "ALREADY_INSTALLED"
      } else {
        rootAction = "UPDATE"
      }
    }

    let resolvedInstallCount = rootAction === "INSTALL" || rootAction === "UPDATE" ? 1 : 0

    itemsMap.set(rootKey, {
      provider: input.provider,
      projectId: input.projectId,
      projectName: rootProjectName,
      versionId: rootVersion.id,
      fileId: rootVersion.fileId || null,
      versionNumber: rootVersion.versionNumber,
      filename: rootVersion.filename,
      sizeBytes: rootVersion.sizeBytes,
      sha256: rootVersion.sha256 || null,
      contentType,
      environment: rootEnv || rootVersion.environment || null,
      targetPath: rootTargetPath,
      isRoot: true,
      isDependency: false,
      isRequired: true,
      isInstalled: Boolean(existingRoot),
      action: rootAction,
      installedManagedId: rootInstalledManagedId,
      installedVersionNumber: rootInstalledVersionNumber,
      availableCompatibleVersions: rootCompatibleVersions as any,
    })

    transferItemsMap.set(rootKey, {
      provider: input.provider,
      projectId: input.projectId,
      projectName: rootProjectName,
      versionId: rootVersion.id,
      versionNumber: rootVersion.versionNumber,
      fileId: rootVersion.fileId || null,
      filename: rootVersion.filename,
      contentType,
      environment: rootEnv || rootVersion.environment || null,
      downloadUrl: rootVersion.downloadUrl,
      sizeBytes: rootVersion.sizeBytes,
      targetPath: rootTargetPath,
      expectedSha256: rootVersion.sha256 || null,
      hashes: rootVersion.hashes,
    })

    // 3. Recursive dependency traversal for REQUIRED dependencies
    const queue: Array<{
      provider: ModProviderGql
      version: NormalizedModVersion
      parentName: string
    }> = [{ provider: input.provider, version: rootVersion, parentName: rootProjectName }]

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentDeps = current.version.dependencies || []

      for (const dep of currentDeps) {
        if (!dep.projectId && !dep.versionId) continue

        // Accumulate INCOMPATIBLE
        if (dep.dependencyType === "INCOMPATIBLE") {
          let targetProjectId = dep.projectId || ""
          const pinnedId = dep.versionId || dep.fileId || null
          if (!targetProjectId && pinnedId) {
            const depAdapter = this.getAdapter(current.provider)
            const pinnedVer = await depAdapter.getVersion(env, pinnedId, null).catch(() => null)
            if (pinnedVer?.projectId) {
              targetProjectId = pinnedVer.projectId
            }
          }

          incompatibleRules.push({
            provider: current.provider,
            sourceName: current.parentName,
            targetProjectId,
            targetVersionId: dep.versionId || null,
            targetFileId: dep.fileId || null,
          })
          continue
        }

        if (dep.dependencyType !== "OPTIONAL" && dep.dependencyType !== "EMBEDDED") {
          const isAlreadyHandled =
            (dep.projectId && Array.from(visitedBranches).some((k) => k.startsWith(`${current.provider}:${dep.projectId}:`))) ||
            (dep.versionId && Array.from(itemsMap.values()).some((item) => item.versionId === dep.versionId || (dep.fileId && item.fileId === dep.fileId)))

          if (!isAlreadyHandled && maxResolvedInstallItems !== undefined && resolvedInstallCount >= maxResolvedInstallItems) {
            throw createGraphQLError(
              "El contenido solicitado requiere demasiadas dependencias para el plan gratuito de Workers (máximo 3 archivos).",
              "VALIDATION_ERROR",
            )
          }
        }

        const depAdapter = this.getAdapter(current.provider)
        let depProjectId = dep.projectId
        const pinnedId = dep.versionId || dep.fileId || null
        let pinnedVersionObj: NormalizedModVersion | null = null

        if (pinnedId) {
          pinnedVersionObj = await depAdapter.getVersion(env, pinnedId, depProjectId).catch(() => null)
          if (!depProjectId && pinnedVersionObj?.projectId) {
            depProjectId = pinnedVersionObj.projectId
          }
        }

        if (!depProjectId) continue

        let depContentType: ContentTypeGql | null = null
        let supportedTypes: ContentTypeGql[] = []
        if (typeof depAdapter.getSupportedContentTypes === "function") {
          supportedTypes = await depAdapter.getSupportedContentTypes(env, depProjectId, minecraftVersion).catch(() => [])
        } else {
          const candidate = await depAdapter.getProject(env, depProjectId).catch(() => null)
          if (candidate?.contentType) {
            supportedTypes = [candidate.contentType]
          }
        }

        if (pinnedVersionObj) {
          const vLoaders = (pinnedVersionObj.loaders || []).map((l) => l.toLowerCase())
          if (vLoaders.some((l) => ["neoforge", "forge", "fabric", "quilt"].includes(l))) {
            depContentType = "MOD"
          } else if (vLoaders.includes("datapack")) {
            depContentType = "DATA_PACK"
          } else if (supportedTypes.length === 1) {
            depContentType = supportedTypes[0]!
          } else {
            conflicts.push(
              `Conflicto: no se pudo determinar el tipo de contenido para la dependencia "${dep.projectName || depProjectId}".`,
            )
            continue
          }
        } else {
          if (supportedTypes.length === 1) {
            depContentType = supportedTypes[0]!
          } else if (supportedTypes.includes("MOD") && !supportedTypes.includes("DATA_PACK")) {
            depContentType = "MOD"
          } else if (supportedTypes.includes("DATA_PACK") && !supportedTypes.includes("MOD")) {
            depContentType = "DATA_PACK"
          } else {
            conflicts.push(
              `Conflicto: la dependencia "${dep.projectName || depProjectId}" tiene un tipo de contenido no soportado o ambiguo para servidor.`,
            )
            continue
          }
        }

        // Server only allows MOD or DATA_PACK
        if (depContentType !== "MOD" && depContentType !== "DATA_PACK") {
          conflicts.push(
            `Conflicto: la dependencia "${dep.projectName || depProjectId}" es de tipo ${depContentType}, que no corresponde al servidor.`,
          )
          continue
        }

        const depKey = `${current.provider}:${depProjectId}:${depContentType}`

        // OPTIONAL dependencies
        if (dep.dependencyType === "OPTIONAL" || dep.dependencyType === "EMBEDDED") {
          if (!optionalDepsMap.has(depKey) && !itemsMap.has(depKey)) {
            try {
              const depProj = await depAdapter.getProject(env, depProjectId, depContentType)
              const depFilename = dep.fileName || (depContentType === "MOD" ? "optional.jar" : "optional.zip")
              optionalDepsMap.set(depKey, {
                provider: current.provider,
                projectId: depProjectId,
                projectName: depProj?.name || dep.projectName || "Dependencia Opcional",
                versionId: dep.versionId || "",
                fileId: dep.fileId || null,
                versionNumber: "",
                filename: depFilename,
                sizeBytes: 0,
                sha256: null,
                contentType: depContentType,
                environment: depProj?.environment || null,
                targetPath: getLogicalPathForServerContent(depContentType, depFilename, activeWorldName),
                isRoot: false,
                isDependency: true,
                isRequired: false,
                isInstalled: managedRecords.some(
                  (m) =>
                    m.provider === current.provider &&
                    m.projectId === depProjectId &&
                    m.contentType === depContentType,
                ),
                action: "ALREADY_INSTALLED",
                installedManagedId: null,
                installedVersionNumber: null,
                availableCompatibleVersions: [],
              })
            } catch {
              // Ignore
            }
          }
          continue
        }

        // REQUIRED dependencies
        if (itemsMap.has(depKey)) continue
        if (visitedBranches.has(depKey)) continue
        visitedBranches.add(depKey)

        if (maxResolvedInstallItems !== undefined && resolvedInstallCount >= maxResolvedInstallItems) {
          throw createGraphQLError(
            "El contenido solicitado requiere demasiadas dependencias para el plan gratuito de Workers (máximo 3 archivos).",
            "VALIDATION_ERROR",
          )
        }

        let depCompatibleVersions: NormalizedModVersion[] = []
        let depProject: NormalizedModProject | null = null
        try {
          depProject = await depAdapter.getProject(env, depProjectId, depContentType).catch(() => null)
          const depLoader = depContentType === "MOD" ? mapModLoaderToProviderName(effectiveLoader) : ""
          depCompatibleVersions = await depAdapter.getCompatibleVersions(
            env,
            depProjectId,
            minecraftVersion,
            depLoader,
            depContentType,
          )
        } catch {
          conflicts.push(`Error al consultar versiones para la dependencia "${dep.projectName || depProjectId}".`)
          continue
        }

        let selectedDepVersion: NormalizedModVersion | undefined
        const overrideVersionId =
          manualOverridesMap.get(depKey) || manualOverridesMap.get(`${current.provider}:${depProjectId}`)

        if (overrideVersionId) {
          selectedDepVersion = depCompatibleVersions.find(
            (v) => v.id === overrideVersionId || v.fileId === overrideVersionId,
          )
          if (!selectedDepVersion) {
            conflicts.push(
              `La versión manual seleccionada (${overrideVersionId}) para "${dep.projectName || depProjectId}" no es compatible con el entorno del servidor.`,
            )
            continue
          }
        } else if (pinnedId) {
          selectedDepVersion = depCompatibleVersions.find((v) => v.id === pinnedId || v.fileId === pinnedId)
          if (!selectedDepVersion) {
            conflicts.push(
              `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" no es compatible con el entorno del servidor.`,
            )
            continue
          }
        } else {
          if (depCompatibleVersions.length === 0) {
            conflicts.push(
              `No se encontró ninguna versión compatible con Minecraft ${minecraftVersion} para la dependencia "${dep.projectName || depProjectId}".`,
            )
            continue
          }
          const sorted = [...depCompatibleVersions].sort((a, b) => {
            const rankA = a.releaseType === "RELEASE" ? 3 : a.releaseType === "BETA" ? 2 : 1
            const rankB = b.releaseType === "RELEASE" ? 3 : b.releaseType === "BETA" ? 2 : 1
            if (rankA !== rankB) return rankB - rankA
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
          })
          selectedDepVersion = sorted[0]
        }

        if (!selectedDepVersion) {
          conflicts.push(`No se pudo resolver una versión válida para la dependencia "${dep.projectName || depProjectId}".`)
          continue
        }

        // Check environment of required dependency based on priority: project -> version -> root override
        const knownDepEnv: ModEnvironmentGql | null =
          isKnownEnvironment(depProject?.environment)
            ? depProject.environment
            : isKnownEnvironment(selectedDepVersion.environment)
            ? selectedDepVersion.environment
            : null

        let depEnv: ModEnvironmentGql | null = knownDepEnv
        if (depContentType === "MOD") {
          if (input.provider === "CURSEFORGE" && !isKnownEnvironment(depEnv)) {
            if (rootEnv === "SERVER") {
              depEnv = "SERVER"
            }
          }

          if (depEnv === "BOTH") {
            conflicts.push(
              `Una dependencia ("${depProject?.name || dep.projectName || depProjectId}") también es necesaria en los clientes. Instala este contenido desde Juego → Actualizaciones.`,
            )
            requiresGameUpdate = true
            gameUpdateReason = `Una dependencia ("${depProject?.name || dep.projectName || depProjectId}") también es necesaria en los clientes. Instala este contenido desde Juego → Actualizaciones.`
            continue
          } else if (depEnv === "CLIENT") {
            conflicts.push(
              `La dependencia ("${depProject?.name || dep.projectName || depProjectId}") es exclusiva de cliente y no corresponde al servidor.`,
            )
            continue
          } else if (!isKnownEnvironment(depEnv)) {
            conflicts.push(
              `La dependencia ("${depProject?.name || dep.projectName || depProjectId}") tiene un entorno ambiguo o desconocido. HiKAT no puede garantizar que sea exclusivamente de servidor.`,
            )
            continue
          }
        }

        const finalDepContentType: ContentTypeGql = selectedDepVersion.contentType || depContentType
        const depProjectName = depProject?.name || dep.projectName || selectedDepVersion.name || "Dependencia"
        const depTargetPath = getLogicalPathForServerContent(finalDepContentType, selectedDepVersion.filename, activeWorldName)

        const existingDep = managedRecords.find(
          (m) =>
            m.provider === current.provider &&
            m.projectId === depProjectId &&
            m.contentType === finalDepContentType,
        )

        let depAction: "INSTALL" | "UPDATE" | "ALREADY_INSTALLED" | "CONFLICT" = "INSTALL"
        let depInstalledManagedId: string | null = null
        let depInstalledVersionNumber: string | null = null

        if (existingDep) {
          depInstalledManagedId = existingDep.id
          depInstalledVersionNumber = existingDep.targetPath.split("/").pop() || null
          const isSameVersion =
            Boolean(existingDep.versionId && existingDep.versionId === selectedDepVersion.id) ||
            Boolean(existingDep.fileId && selectedDepVersion.fileId && existingDep.fileId === selectedDepVersion.fileId)

          if (isSameVersion) {
            depAction = "ALREADY_INSTALLED"
          } else {
            depAction = "UPDATE"
          }
        }

        if (depAction === "INSTALL" || depAction === "UPDATE") {
          resolvedInstallCount++
        }

        itemsMap.set(depKey, {
          provider: current.provider,
          projectId: depProjectId,
          projectName: depProjectName,
          versionId: selectedDepVersion.id,
          fileId: selectedDepVersion.fileId || null,
          versionNumber: selectedDepVersion.versionNumber,
          filename: selectedDepVersion.filename,
          sizeBytes: selectedDepVersion.sizeBytes,
          sha256: selectedDepVersion.sha256 || null,
          contentType: finalDepContentType,
          environment: depEnv || selectedDepVersion.environment || null,
          targetPath: depTargetPath,
          isRoot: false,
          isDependency: true,
          isRequired: true,
          isInstalled: Boolean(existingDep),
          action: depAction,
          installedManagedId: depInstalledManagedId,
          installedVersionNumber: depInstalledVersionNumber,
          availableCompatibleVersions: depCompatibleVersions as any,
        })

        transferItemsMap.set(depKey, {
          provider: current.provider,
          projectId: depProjectId,
          projectName: depProjectName,
          versionId: selectedDepVersion.id,
          versionNumber: selectedDepVersion.versionNumber,
          fileId: selectedDepVersion.fileId || null,
          filename: selectedDepVersion.filename,
          contentType: finalDepContentType,
          environment: depEnv || selectedDepVersion.environment || null,
          downloadUrl: selectedDepVersion.downloadUrl,
          sizeBytes: selectedDepVersion.sizeBytes,
          targetPath: depTargetPath,
          expectedSha256: selectedDepVersion.sha256 || null,
          hashes: selectedDepVersion.hashes,
        })

        queue.push({
          provider: current.provider,
          version: selectedDepVersion,
          parentName: depProjectName,
        })
      }
    }

    // 4. Incompatible rules
    for (const rule of incompatibleRules) {
      if (!rule.targetProjectId) continue
      const match = managedRecords.find(
        (m) => m.provider === rule.provider && m.projectId === rule.targetProjectId,
      )
      if (match) {
        conflicts.push(
          `Conflicto detectado: "${rule.sourceName}" declara incompatibilidad con el contenido instalado en "${match.targetPath}".`,
        )
      }
    }

    const items = Array.from(itemsMap.values())
    const totalDownloadSizeBytes = items
      .filter((i) => i.action === "INSTALL" || i.action === "UPDATE")
      .reduce((sum, i) => sum + (i.sizeBytes || 0), 0)

    return {
      plan: {
        items,
        totalDownloadSizeBytes,
        conflicts,
        optionalDependencies: Array.from(optionalDepsMap.values()),
        isValid: conflicts.length === 0,
        requiresGameUpdate,
        gameUpdateReason,
      },
      transferItems: Array.from(transferItemsMap.values()),
    }
  }
}

export const modProviderManager = new ModProviderManager()

