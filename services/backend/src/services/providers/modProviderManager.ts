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
  ResolveModPlanInputGql,
  ContentTypeGql,
  ServerContentSearchPayloadGql,
  ServerContentInstallationPlanGql,
  ServerContentPlanItemGql,
  ResolveServerContentPlanInputGql,
} from "@hikat/graphql"
import { createGraphQLError } from "@hikat/graphql"

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

export class ModProviderManager {
  private modrinth = new ModrinthAdapter()
  private curseforge = new CurseForgeAdapter()

  getAdapter(provider: ModProviderGql): ModProviderAdapter {
    if (provider === "MODRINTH") return this.modrinth
    if (provider === "CURSEFORGE") return this.curseforge
    throw new Error(`Proveedor de contenido no soportado: ${provider}`)
  }

  async getActiveEnvironment(
    db: Database,
  ): Promise<{ minecraftVersion: string; neoForgeVersion: string }> {
    // 1. Try active draft
    const draft = await db
      .select({
        minecraftVersion: schema.gameReleases.minecraftVersion,
        neoForgeVersion: schema.gameReleases.neoForgeVersion,
      })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
      .get()

    if (draft) {
      return {
        minecraftVersion: draft.minecraftVersion || "1.21.1",
        neoForgeVersion: draft.neoForgeVersion || "21.1.65",
      }
    }

    // 2. Try published release
    const published = await db
      .select({
        minecraftVersion: schema.gameReleases.minecraftVersion,
        neoForgeVersion: schema.gameReleases.neoForgeVersion,
      })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()

    if (published) {
      return {
        minecraftVersion: published.minecraftVersion || "1.21.1",
        neoForgeVersion: published.neoForgeVersion || "21.1.65",
      }
    }

    return {
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    }
  }

  async getPublishedEnvironment(
    db: Database,
  ): Promise<{ minecraftVersion: string; neoForgeVersion: string; isPublished: boolean; releaseId?: string }> {
    const published = await db
      .select({
        id: schema.gameReleases.id,
        minecraftVersion: schema.gameReleases.minecraftVersion,
        neoForgeVersion: schema.gameReleases.neoForgeVersion,
      })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "PUBLISHED"))
      .get()

    if (published) {
      return {
        releaseId: published.id,
        minecraftVersion: published.minecraftVersion || "1.21.1",
        neoForgeVersion: published.neoForgeVersion || "21.1.65",
        isPublished: true,
      }
    }

    return {
      minecraftVersion: "1.21.1",
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
  ): Promise<ModSearchPayloadGql> {
    const envData = await this.getActiveEnvironment(db)
    const { minecraftVersion, neoForgeVersion } = envData
    const loader = contentType === "MOD" ? "NeoForge" : ""
    const providersStatus: ModProviderStatusGql[] = []

    if (provider === "MODRINTH") {
      try {
        const isAllowedInGame = (item: NormalizedModProject) =>
          contentType !== "MOD" || item.environment !== "SERVER"

        const res = await this.fetchFilteredFromProvider(
          this.modrinth,
          env,
          query,
          minecraftVersion,
          loader,
          offset + limit,
          contentType,
          isAllowedInGame,
          50,
        )
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        return {
          items: res.items.slice(offset, offset + limit),
          totalCount: res.totalCount,
          providersStatus,
          minecraftVersion,
          neoForgeVersion,
        }
      } catch (err: any) {
        providersStatus.push({ provider: "MODRINTH", available: false, error: err.message })
        return {
          items: [],
          totalCount: 0,
          providersStatus,
          minecraftVersion,
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
          providersStatus,
          minecraftVersion,
          neoForgeVersion,
        }
      }

      try {
        const isAllowedInGame = (item: NormalizedModProject) =>
          contentType !== "MOD" || item.environment !== "SERVER"

        const res = await this.fetchFilteredFromProvider(
          this.curseforge,
          env,
          query,
          minecraftVersion,
          loader,
          offset + limit,
          contentType,
          isAllowedInGame,
          50,
        )
        providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
        return {
          items: res.items.slice(offset, offset + limit),
          totalCount: res.totalCount,
          providersStatus,
          minecraftVersion,
          neoForgeVersion,
        }
      } catch (err: any) {
        providersStatus.push({ provider: "CURSEFORGE", available: false, error: err.message })
        return {
          items: [],
          totalCount: 0,
          providersStatus,
          minecraftVersion,
          neoForgeVersion,
        }
      }
    }

    // "Todos" (ALL providers in parallel with deterministic gap-free chunked pagination)
    const fetchLimit = offset + limit
    const isAllowedInGame = (item: NormalizedModProject) =>
      contentType !== "MOD" || item.environment !== "SERVER"

    const [modrinthResult, curseforgeResult] = await Promise.allSettled([
      this.fetchFilteredFromProvider(this.modrinth, env, query, minecraftVersion, loader, fetchLimit, contentType, isAllowedInGame, 50),
      this.curseforge.isConfigured(env)
        ? this.fetchFilteredFromProvider(this.curseforge, env, query, minecraftVersion, loader, fetchLimit, contentType, isAllowedInGame, 50)
        : Promise.resolve({ items: [], totalCount: 0, hasMore: false }),
    ])

    const allItems: any[] = []
    let totalCount = 0

    if (modrinthResult.status === "fulfilled") {
      providersStatus.push({ provider: "MODRINTH", available: true, error: null })
      totalCount += modrinthResult.value.totalCount
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
      totalCount += curseforgeResult.value.totalCount
    } else {
      providersStatus.push({
        provider: "CURSEFORGE",
        available: false,
        error: curseforgeResult.reason?.message || "Error al conectar con CurseForge",
      })
    }

    const modrinthItems = modrinthResult.status === "fulfilled" ? modrinthResult.value.items : []
    const curseforgeItems = curseforgeResult.status === "fulfilled" ? curseforgeResult.value.items : []

    // Interleave results preserving relevance ranking deterministically
    const maxLength = Math.max(modrinthItems.length, curseforgeItems.length)
    for (let i = 0; i < maxLength; i++) {
      if (i < modrinthItems.length) allItems.push(modrinthItems[i])
      if (i < curseforgeItems.length) allItems.push(curseforgeItems[i])
    }

    return {
      items: allItems.slice(offset, offset + limit),
      totalCount: totalCount || allItems.length,
      providersStatus,
      minecraftVersion,
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
  ): Promise<ServerContentSearchPayloadGql> {
    if (contentType !== "MOD" && contentType !== "DATA_PACK") {
      throw createGraphQLError(
        `Tipo de contenido no permitido para el servidor (${contentType}). Solo se admiten Mods de servidor y Data Packs.`,
        "VALIDATION_ERROR",
      )
    }

    const envData = await this.getPublishedEnvironment(db)
    const { minecraftVersion, neoForgeVersion, isPublished } = envData
    const loader = contentType === "MOD" ? "NeoForge" : ""
    const providersStatus: ModProviderStatusGql[] = []

    const isAllowedInServer = (item: NormalizedModProject) =>
      contentType !== "MOD" || item.environment === "SERVER"

    let rawResults: { items: NormalizedModProject[]; totalCount: number; providersStatus: ModProviderStatusGql[] }

    if (provider === "MODRINTH") {
      try {
        const res = await this.fetchFilteredFromProvider(
          this.modrinth,
          env,
          query,
          minecraftVersion,
          loader,
          offset + limit,
          contentType,
          isAllowedInServer,
          50,
        )
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        rawResults = {
          items: res.items.slice(offset, offset + limit),
          totalCount: res.totalCount,
          providersStatus,
        }
      } catch (err: any) {
        providersStatus.push({ provider: "MODRINTH", available: false, error: err.message })
        rawResults = { items: [], totalCount: 0, providersStatus }
      }
    } else if (provider === "CURSEFORGE") {
      if (!this.curseforge.isConfigured(env)) {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: "CurseForge API Key no está configurada en el servidor.",
        })
        rawResults = { items: [], totalCount: 0, providersStatus }
      } else {
        try {
          const res = await this.fetchFilteredFromProvider(
            this.curseforge,
            env,
            query,
            minecraftVersion,
            loader,
            offset + limit,
            contentType,
            isAllowedInServer,
            50,
          )
          providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
          rawResults = {
            items: res.items.slice(offset, offset + limit),
            totalCount: res.totalCount,
            providersStatus,
          }
        } catch (err: any) {
          providersStatus.push({ provider: "CURSEFORGE", available: false, error: err.message })
          rawResults = { items: [], totalCount: 0, providersStatus }
        }
      }
    } else {
      // ALL providers
      const fetchLimit = offset + limit
      const [modrinthResult, curseforgeResult] = await Promise.allSettled([
        this.fetchFilteredFromProvider(this.modrinth, env, query, minecraftVersion, loader, fetchLimit, contentType, isAllowedInServer, 50),
        this.curseforge.isConfigured(env)
          ? this.fetchFilteredFromProvider(this.curseforge, env, query, minecraftVersion, loader, fetchLimit, contentType, isAllowedInServer, 50)
          : Promise.resolve({ items: [], totalCount: 0, hasMore: false }),
      ])

      const allItems: any[] = []
      let totalCount = 0

      if (modrinthResult.status === "fulfilled") {
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        totalCount += modrinthResult.value.totalCount
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
        totalCount += curseforgeResult.value.totalCount
      } else {
        providersStatus.push({
          provider: "CURSEFORGE",
          available: false,
          error: curseforgeResult.reason?.message || "Error al conectar con CurseForge",
        })
      }

      const modrinthItems = modrinthResult.status === "fulfilled" ? modrinthResult.value.items : []
      const curseforgeItems = curseforgeResult.status === "fulfilled" ? curseforgeResult.value.items : []

      const maxLength = Math.max(modrinthItems.length, curseforgeItems.length)
      for (let i = 0; i < maxLength; i++) {
        if (i < modrinthItems.length) allItems.push(modrinthItems[i])
        if (i < curseforgeItems.length) allItems.push(curseforgeItems[i])
      }

      rawResults = {
        items: allItems.slice(offset, offset + limit),
        totalCount: totalCount || allItems.length,
        providersStatus,
      }
    }

    return {
      items: rawResults.items as any,
      totalCount: rawResults.totalCount,
      providersStatus: rawResults.providersStatus,
      minecraftVersion,
      neoForgeVersion,
      isPublishedEnvironment: isPublished,
    }
  }

  async getServerProjectDetail(
    env: Env,
    db: Database,
    provider: ModProviderGql,
    projectId: string,
    contentType: ContentTypeGql = "MOD",
  ): Promise<ModProjectDetailGql> {
    if (contentType !== "MOD" && contentType !== "DATA_PACK") {
      throw createGraphQLError(
        `Tipo de contenido no permitido para el servidor (${contentType}). Solo se admiten Mods de servidor y Data Packs.`,
        "VALIDATION_ERROR",
      )
    }

    const envData = await this.getPublishedEnvironment(db)
    const { minecraftVersion, neoForgeVersion } = envData
    const loader = contentType === "MOD" ? "NeoForge" : ""

    const adapter = this.getAdapter(provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${provider} no está configurado en el servidor.`,
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

    // Check if installed in server_managed_content
    let installedVersion: string | null = null
    let isInstalled = false

    const installedRecord = await db
      .select()
      .from(schema.serverManagedContent)
      .where(
        and(
          eq(schema.serverManagedContent.provider, provider),
          eq(schema.serverManagedContent.projectId, projectId),
          eq(schema.serverManagedContent.contentType, contentType),
        ),
      )
      .get()

    if (installedRecord) {
      isInstalled = true
      const matchingVer = compatibleVersions.find(
        (v) => v.id === installedRecord.versionId || v.fileId === installedRecord.fileId,
      )
      installedVersion = matchingVer?.versionNumber || installedRecord.targetPath.split("/").pop() || null
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
      neoForgeVersion,
    }
  }

  private async fetchFilteredFromProvider(
    adapter: ModProviderAdapter,
    env: Env,
    query: string,
    minecraftVersion: string,
    loader: string,
    neededCount: number,
    contentType: ContentTypeGql,
    filterFn: (item: NormalizedModProject) => boolean,
    pageSize: number = 50,
  ): Promise<{ items: NormalizedModProject[]; totalCount: number; hasMore: boolean }> {
    const allFilteredItems: NormalizedModProject[] = []
    let currentOffset = 0
    let providerTotalCount = 0
    const maxPages = 6 // Safety ceiling: up to 300 raw items per provider

    for (let page = 0; page < maxPages; page++) {
      const res = await adapter.searchMods(
        env,
        query,
        minecraftVersion,
        loader,
        pageSize,
        currentOffset,
        contentType,
      )
      providerTotalCount = res.totalCount
      if (!res.items || res.items.length === 0) break

      for (const item of res.items) {
        if (filterFn(item)) {
          allFilteredItems.push(item)
        }
      }

      currentOffset += res.items.length
      if (
        allFilteredItems.length >= neededCount + 1 ||
        currentOffset >= providerTotalCount ||
        res.items.length < pageSize
      ) {
        break
      }
    }

    const hasMore = allFilteredItems.length > neededCount || currentOffset < providerTotalCount
    return {
      items: allFilteredItems,
      totalCount: providerTotalCount || allFilteredItems.length,
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
  ): Promise<ModProjectDetailGql> {
    const envData = await this.getActiveEnvironment(db)
    const { minecraftVersion, neoForgeVersion } = envData
    const loader = contentType === "MOD" ? "NeoForge" : ""

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

    const draft = await db
      .select({ id: schema.gameReleases.id })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
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
          (v) => v.id === installedFile.sourceVersionId || v.fileId === installedFile.sourceFileId,
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
  ): Promise<ModInstallationPlanGql> {
    const envData = await this.getActiveEnvironment(db)
    const { minecraftVersion, neoForgeVersion } = envData
    const contentType = input.contentType || "MOD"
    if (contentType === "DATA_PACK") {
      throw createGraphQLError(
        "Los Data Packs se administran exclusivamente desde Servidor → Archivos.",
        "VALIDATION_ERROR",
      )
    }
    const loader = contentType === "MOD" ? "NeoForge" : ""

    const adapter = this.getAdapter(input.provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${input.provider} no está disponible.`,
        "VALIDATION_ERROR",
      )
    }

    // 1. Fetch active draft files for status comparison
    let draftFiles: schema.GameReleaseFile[] = []
    const draft = await db
      .select({ id: schema.gameReleases.id })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
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
        if (
          contentType === "MOD" &&
          (!directVersion.loaders ||
            directVersion.loaders.length === 0 ||
            !directVersion.loaders.map((l) => l.toLowerCase()).includes("neoforge"))
        ) {
          throw createGraphQLError(
            `La versión "${input.versionId}" no es compatible con el loader NeoForge.`,
            "VALIDATION_ERROR",
          )
        }
        throw createGraphQLError(
          `La versión "${input.versionId}" no es compatible con el entorno actual (Minecraft ${minecraftVersion}${contentType === "MOD" ? " · NeoForge" : ""}).`,
          "VALIDATION_ERROR",
        )
      }

      throw createGraphQLError(
        `La versión seleccionada no fue encontrada o no es compatible con Minecraft ${minecraftVersion}.`,
        "NOT_FOUND",
      )
    }

    if (contentType === "MOD" && (rootProject.environment === "SERVER" || rootVersion.environment === "SERVER")) {
      throw createGraphQLError(
        "Los mods exclusivos de servidor (SERVER) no corresponden al cliente y se administran desde Servidor → Archivos.",
        "VALIDATION_ERROR",
      )
    }

    const rootProjectName = rootProject?.name || rootVersion.name || "Elemento Principal"
    const rootLogicalPath = getLogicalPathForContent(contentType, rootVersion.filename)

    // Add root item with 3-part identity key
    const rootKey = `${input.provider}:${input.projectId}:${contentType}`
    visitedBranches.add(rootKey)

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

      if (isSameVersion) {
        rootAction = "ALREADY_INSTALLED"
      } else {
        rootAction = "UPDATE"
      }
    }

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
      environment: rootProject?.environment || rootVersion.environment || null,
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

        // A. Accumulate INCOMPATIBLE restrictions (evaluated at end of traversal)
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

        const depAdapter = this.getAdapter(current.provider)
        let depProjectId = dep.projectId
        const pinnedId = dep.versionId || dep.fileId || null
        let pinnedVersionObj: NormalizedModVersion | null = null

        // 1. If pinned versionId is given, resolve the pinned version directly first
        if (pinnedId) {
          pinnedVersionObj = await depAdapter.getVersion(env, pinnedId, depProjectId).catch(() => null)
          if (!depProjectId && pinnedVersionObj?.projectId) {
            depProjectId = pinnedVersionObj.projectId
          }
        }

        if (!depProjectId) continue

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
            // Cross supported types with version metadata
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
              conflicts.push(
                `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" es de tipo indeterminable o ambigua (tipos compatibles posibles: ${candidateTypes.join(", ")}).`,
              )
              continue
            }
          } else {
            conflicts.push(
              `Conflicto: no se pudo determinar el tipo de contenido para la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}".`,
            )
            continue
          }
        } else {
          // No pinned version (only projectId)
          if (supportedTypes.length === 1) {
            depContentType = supportedTypes[0]!
          } else if (supportedTypes.length > 1) {
            conflicts.push(
              `Conflicto: la dependencia "${dep.projectName || depProjectId}" es multi-tipo y ambigua (soporta ${supportedTypes.join(", ")}); se requiere especificar versión o resolver manualmente.`,
            )
            continue
          } else {
            conflicts.push(
              `Conflicto: la dependencia "${dep.projectName || depProjectId}" tiene un tipo de contenido desconocido o no soportado.`,
            )
            continue
          }
        }

        if (depContentType === "DATA_PACK") {
          conflicts.push(
            `Conflicto: la dependencia "${dep.projectName || depProjectId}" es un Data Pack y debe administrarse desde Servidor → Archivos.`,
          )
          continue
        }

        const depKey = `${current.provider}:${depProjectId}:${depContentType}`

        // B. Handle OPTIONAL dependencies (do NOT automatically install)
        if (dep.dependencyType === "OPTIONAL" || dep.dependencyType === "EMBEDDED") {
          if (!optionalDepsMap.has(depKey) && !itemsMap.has(depKey)) {
            try {
              const depProj = await depAdapter.getProject(env, depProjectId, depContentType)
              const depFilename = dep.fileName || (depContentType === "MOD" ? "optional.jar" : "optional.zip")
              const targetCat = depContentType === "SHADER" ? "SHADER_PACK" : depContentType
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
                logicalPath: getLogicalPathForContent(depContentType, depFilename),
                isRoot: false,
                isDependency: true,
                isRequired: false,
                isInstalled: draftFiles.some(
                  (f) =>
                    f.sourceProvider === current.provider &&
                    f.sourceProjectId === depProjectId &&
                    f.category === targetCat,
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

        // C. Handle REQUIRED dependencies
        // Check duplicate within same provider + projectId + contentType
        if (itemsMap.has(depKey)) {
          // Already resolved in plan
          continue
        }

        if (visitedBranches.has(depKey)) {
          // Cycle detected in dependency graph, skip re-traversal
          continue
        }
        visitedBranches.add(depKey)

        // Fetch compatible versions for the required dependency using its discovered depContentType
        let depCompatibleVersions: NormalizedModVersion[] = []
        let depProject: NormalizedModProject | null = null
        try {
          depProject = await depAdapter.getProject(env, depProjectId, depContentType).catch(() => null)
          const depLoader = depContentType === "MOD" ? "NeoForge" : ""
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

        if (depContentType === "MOD" && depProject?.environment === "SERVER") {
          conflicts.push(
            `Conflicto: la dependencia "${dep.projectName || depProjectId}" es un mod exclusivo de servidor y no corresponde al cliente.`,
          )
          continue
        }

        let selectedDepVersion: NormalizedModVersion | undefined

        // Priority 1: Manual override (exact 3-part key first, then 2-part key fallback)
        const overrideVersionId =
          manualOverridesMap.get(depKey) ||
          manualOverridesMap.get(`${current.provider}:${depProjectId}`)

        if (overrideVersionId) {
          selectedDepVersion = depCompatibleVersions.find(
            (v) => v.id === overrideVersionId || v.fileId === overrideVersionId,
          )
          if (!selectedDepVersion) {
            conflicts.push(
              `La versión manual seleccionada (${overrideVersionId}) para "${dep.projectName || depProjectId}" no es compatible con el entorno.`,
            )
            continue
          }
        } else if (pinnedId) {
          // Priority 2: Explicitly pinned versionId by provider -> MUST MATCH pinned version, NO silent fallback!
          selectedDepVersion = depCompatibleVersions.find((v) => v.id === pinnedId || v.fileId === pinnedId)

          if (!selectedDepVersion) {
            if (pinnedVersionObj) {
              if (pinnedVersionObj.contentType && pinnedVersionObj.contentType !== depContentType) {
                conflicts.push(
                  `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" es de tipo ${pinnedVersionObj.contentType}, no ${depContentType}.`,
                )
              } else if (!pinnedVersionObj.gameVersions.includes(minecraftVersion)) {
                conflicts.push(
                  `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" no es compatible con Minecraft ${minecraftVersion}.`,
                )
              } else if (
                depContentType === "MOD" &&
                !pinnedVersionObj.loaders.map((l) => l.toLowerCase()).includes("neoforge")
              ) {
                conflicts.push(
                  `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" no es compatible con el loader NeoForge.`,
                )
              } else {
                conflicts.push(
                  `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" no es compatible con Minecraft ${minecraftVersion}.`,
                )
              }
            } else {
              conflicts.push(
                `Conflicto: la versión requerida "${pinnedId}" de "${dep.projectName || depProjectId}" no fue encontrada.`,
              )
            }
            continue
          }
        } else {
          // Priority 3: Automatic selection (latest stable RELEASE, fallback to BETA/ALPHA)
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

        if (depContentType === "MOD" && selectedDepVersion.environment === "SERVER") {
          conflicts.push(
            `Conflicto: la dependencia "${dep.projectName || depProjectId}" es un mod exclusivo de servidor y no corresponde al cliente.`,
          )
          continue
        }

        const finalDepContentType: ContentTypeGql = selectedDepVersion.contentType || depContentType
        const depProjectName = depProject?.name || dep.projectName || selectedDepVersion.name || "Dependencia"
        const depLogicalPath = getLogicalPathForContent(finalDepContentType, selectedDepVersion.filename)
        const depTargetCategory = finalDepContentType === "SHADER" ? "SHADER_PACK" : finalDepContentType

        const existingDep = draftFiles.find(
          (f) =>
            f.sourceProvider === current.provider &&
            f.sourceProjectId === depProjectId &&
            f.category === depTargetCategory,
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

          if (isSameVersion) {
            depAction = "ALREADY_INSTALLED"
          } else {
            depAction = "UPDATE"
          }
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
          environment: depProject?.environment || selectedDepVersion.environment || null,
          logicalPath: depLogicalPath,
          isRoot: false,
          isDependency: true,
          isRequired: true,
          isInstalled: Boolean(existingDep),
          action: depAction,
          installedFileId: depInstalledFileId,
          installedVersionNumber: depInstalledVersionNumber,
          availableCompatibleVersions: depCompatibleVersions as any,
        })

        // Enqueue to resolve transitive dependencies
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
            conflicts.push(
              `Conflicto detectado: "${rule.sourceName}" declara incompatibilidad con la versión instalada de "${draftMatch.name}".`,
            )
          }
        } else {
          conflicts.push(
            `Conflicto detectado: "${rule.sourceName}" declara incompatibilidad con "${draftMatch.name}".`,
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
            conflicts.push(
              `Conflicto detectado: "${rule.sourceName}" declara incompatibilidad con la versión seleccionada de "${planMatch.projectName}".`,
            )
          }
        } else {
          conflicts.push(
            `Conflicto detectado: "${rule.sourceName}" declara incompatibilidad con "${planMatch.projectName}".`,
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
      optionalDependencies: Array.from(optionalDepsMap.values()),
      isValid: conflicts.length === 0,
    }
  }

  async resolveServerInstallationPlan(
    env: Env,
    db: Database,
    input: ResolveServerContentPlanInputGql,
    activeWorldName: string = "world",
  ): Promise<ServerContentInstallationPlanGql> {
    const contentType = input.contentType || "MOD"
    if (contentType !== "MOD" && contentType !== "DATA_PACK") {
      throw createGraphQLError(
        `Tipo de contenido no permitido para el servidor (${contentType}). Solo se admiten Mods de servidor y Data Packs.`,
        "VALIDATION_ERROR",
      )
    }

    const envData = await this.getPublishedEnvironment(db)
    const { minecraftVersion, neoForgeVersion } = envData
    const loader = contentType === "MOD" ? "NeoForge" : ""

    const adapter = this.getAdapter(input.provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${input.provider} no está disponible.`,
        "VALIDATION_ERROR",
      )
    }

    // 1. Fetch server_managed_content records for status comparison
    const managedRecords = await db
      .select()
      .from(schema.serverManagedContent)
      .all()

    const manualOverridesMap = new Map<string, string>()
    for (const ov of input.manualOverrides || []) {
      if (ov.contentType) {
        manualOverridesMap.set(`${ov.provider}:${ov.projectId}:${ov.contentType}`, ov.versionId)
      } else {
        manualOverridesMap.set(`${ov.provider}:${ov.projectId}`, ov.versionId)
      }
    }

    const itemsMap = new Map<string, ServerContentPlanItemGql>()
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

    // Root project environment check for server installation
    if (contentType === "MOD") {
      if (rootProject.environment === "BOTH") {
        return {
          items: [],
          totalDownloadSizeBytes: 0,
          conflicts: ["Este mod también es necesario en los clientes. Debe añadirse desde Juego → Actualizaciones."],
          optionalDependencies: [],
          isValid: false,
          requiresGameUpdate: true,
          gameUpdateReason: "Este mod también es necesario en los clientes. Añade este mod desde Juego → Actualizaciones.",
        }
      }
      if (rootProject.environment === "CLIENT") {
        throw createGraphQLError(
          "Este mod es exclusivo del cliente y no corresponde al servidor.",
          "VALIDATION_ERROR",
        )
      }
      if (rootProject.environment === "UNKNOWN" || !rootProject.environment) {
        throw createGraphQLError(
          "HiKAT no puede garantizar que este mod sea exclusivamente de servidor. Debe añadirse desde Juego → Actualizaciones o verificar su configuración.",
          "VALIDATION_ERROR",
        )
      }
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
        if (
          contentType === "MOD" &&
          (!directVersion.loaders ||
            directVersion.loaders.length === 0 ||
            !directVersion.loaders.map((l) => l.toLowerCase()).includes("neoforge"))
        ) {
          throw createGraphQLError(
            `La versión "${input.versionId}" no es compatible con el loader NeoForge.`,
            "VALIDATION_ERROR",
          )
        }
        throw createGraphQLError(
          `La versión "${input.versionId}" no es compatible con el entorno actual del servidor (Minecraft ${minecraftVersion}${contentType === "MOD" ? " · NeoForge" : ""}).`,
          "VALIDATION_ERROR",
        )
      }

      throw createGraphQLError(
        `La versión seleccionada no fue encontrada o no es compatible con Minecraft ${minecraftVersion}.`,
        "NOT_FOUND",
      )
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
      environment: rootProject?.environment || rootVersion.environment || null,
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

        let depCompatibleVersions: NormalizedModVersion[] = []
        let depProject: NormalizedModProject | null = null
        try {
          depProject = await depAdapter.getProject(env, depProjectId, depContentType).catch(() => null)
          const depLoader = depContentType === "MOD" ? "NeoForge" : ""
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

        // Check environment of required dependency!
        if (depContentType === "MOD") {
          const depEnv = depProject?.environment
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
          } else if (depEnv === "UNKNOWN" || !depEnv) {
            conflicts.push(
              `La dependencia ("${depProject?.name || dep.projectName || depProjectId}") tiene un entorno ambiguo o desconocido. HiKAT no puede garantizar que sea exclusivamente de servidor.`,
            )
            continue
          }
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
          environment: depProject?.environment || selectedDepVersion.environment || null,
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
      items,
      totalDownloadSizeBytes,
      conflicts,
      optionalDependencies: Array.from(optionalDepsMap.values()),
      isValid: conflicts.length === 0,
      requiresGameUpdate,
      gameUpdateReason,
    }
  }
}

export const modProviderManager = new ModProviderManager()

