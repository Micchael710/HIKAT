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
} from "@hikat/graphql"
import { createGraphQLError } from "@hikat/graphql"

export class ModProviderManager {
  private modrinth = new ModrinthAdapter()
  private curseforge = new CurseForgeAdapter()

  getAdapter(provider: ModProviderGql): ModProviderAdapter {
    if (provider === "MODRINTH") return this.modrinth
    if (provider === "CURSEFORGE") return this.curseforge
    throw new Error(`Proveedor de mods no soportado: ${provider}`)
  }

  async searchMods(
    env: Env,
    query: string,
    provider: ModProviderGql | null | undefined,
    limit: number = 20,
    offset: number = 0,
    minecraftVersion: string = "1.21.1",
    loader: string = "NeoForge",
  ): Promise<ModSearchPayloadGql> {
    const providersStatus: ModProviderStatusGql[] = []

    if (provider === "MODRINTH") {
      try {
        const res = await this.modrinth.searchMods(env, query, minecraftVersion, loader, limit, offset)
        providersStatus.push({ provider: "MODRINTH", available: true, error: null })
        return {
          items: res.items,
          totalCount: res.totalCount,
          providersStatus,
          minecraftVersion,
          neoForgeVersion: "21.1.65",
        }
      } catch (err: any) {
        providersStatus.push({ provider: "MODRINTH", available: false, error: err.message })
        return {
          items: [],
          totalCount: 0,
          providersStatus,
          minecraftVersion,
          neoForgeVersion: "21.1.65",
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
          neoForgeVersion: "21.1.65",
        }
      }

      try {
        const res = await this.curseforge.searchMods(env, query, minecraftVersion, loader, limit, offset)
        providersStatus.push({ provider: "CURSEFORGE", available: true, error: null })
        return {
          items: res.items,
          totalCount: res.totalCount,
          providersStatus,
          minecraftVersion,
          neoForgeVersion: "21.1.65",
        }
      } catch (err: any) {
        providersStatus.push({ provider: "CURSEFORGE", available: false, error: err.message })
        return {
          items: [],
          totalCount: 0,
          providersStatus,
          minecraftVersion,
          neoForgeVersion: "21.1.65",
        }
      }
    }

    // "Todos" (ALL providers in parallel with graceful partial degradation)
    const [modrinthResult, curseforgeResult] = await Promise.allSettled([
      this.modrinth.searchMods(env, query, minecraftVersion, loader, limit, offset),
      this.curseforge.isConfigured(env)
        ? this.curseforge.searchMods(env, query, minecraftVersion, loader, limit, offset)
        : Promise.resolve({ items: [], totalCount: 0 }),
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

    // Interleave results preserving relevance ranking
    const maxLength = Math.max(modrinthItems.length, curseforgeItems.length)
    for (let i = 0; i < maxLength; i++) {
      if (i < modrinthItems.length) allItems.push(modrinthItems[i])
      if (i < curseforgeItems.length) allItems.push(curseforgeItems[i])
    }

    return {
      items: allItems.slice(0, limit),
      totalCount: totalCount || allItems.length,
      providersStatus,
      minecraftVersion,
      neoForgeVersion: "21.1.65",
    }
  }

  async getProjectDetail(
    env: Env,
    db: Database,
    provider: ModProviderGql,
    projectId: string,
    minecraftVersion: string = "1.21.1",
    loader: string = "NeoForge",
  ): Promise<ModProjectDetailGql> {
    const adapter = this.getAdapter(provider)
    if (!adapter.isConfigured(env)) {
      throw createGraphQLError(
        `El proveedor ${provider} no está configurado en el servidor.`,
        "VALIDATION_ERROR",
      )
    }

    const [project, compatibleVersions] = await Promise.all([
      adapter.getProject(env, projectId),
      adapter.getCompatibleVersions(env, projectId, minecraftVersion, loader),
    ])

    if (!project) {
      throw createGraphQLError("Proyecto de mod no encontrado en el proveedor.", "NOT_FOUND")
    }

    // Check if installed in active draft
    let installedVersion: string | null = null
    let isInstalled = false

    const draft = await db
      .select({ id: schema.gameReleases.id })
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.status, "DRAFT"))
      .get()

    if (draft) {
      const installedFile = await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(
          and(
            eq(schema.gameReleaseFiles.releaseId, draft.id),
            eq(schema.gameReleaseFiles.sourceProvider, provider),
            eq(schema.gameReleaseFiles.sourceProjectId, projectId),
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
      compatibleVersions: compatibleVersions as any,
      installedVersion,
      isInstalled,
      minecraftVersion,
      neoForgeVersion: "21.1.65",
    }
  }

  async resolveInstallationPlan(
    env: Env,
    db: Database,
    input: ResolveModPlanInputGql,
    minecraftVersion: string = "1.21.1",
    loader: string = "NeoForge",
  ): Promise<ModInstallationPlanGql> {
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
      manualOverridesMap.set(`${ov.provider}:${ov.projectId}`, ov.versionId)
    }

    const itemsMap = new Map<string, ModInstallationPlanItemGql>()
    const optionalDepsMap = new Map<string, ModInstallationPlanItemGql>()
    const conflicts: string[] = []
    const visitedBranches = new Set<string>()

    // 2. Fetch root project and version
    const rootCompatibleVersions = await adapter.getCompatibleVersions(
      env,
      input.projectId,
      minecraftVersion,
      loader,
    )

    let rootVersion = rootCompatibleVersions.find((v) => v.id === input.versionId || v.fileId === input.versionId)
    if (!rootVersion) {
      // Fallback direct getVersion
      rootVersion = (await adapter.getVersion(env, input.versionId, input.projectId)) || undefined
    }

    if (!rootVersion) {
      throw createGraphQLError("La versión seleccionada no fue encontrada o no es compatible.", "NOT_FOUND")
    }

    const rootProject = await adapter.getProject(env, input.projectId)
    const rootProjectName = rootProject?.name || rootVersion.name || "Mod Principal"

    // Add root item
    const rootKey = `${input.provider}:${input.projectId}`
    visitedBranches.add(rootKey)

    const existingRoot = draftFiles.find(
      (f) => f.sourceProvider === input.provider && f.sourceProjectId === input.projectId,
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

        // A. Handle INCOMPATIBLE
        if (dep.dependencyType === "INCOMPATIBLE") {
          conflicts.push(
            `Conflicto detectado: "${current.parentName}" declara incompatibilidad con el mod "${dep.projectName || dep.projectId}".`,
          )
          continue
        }

        const depAdapter = this.getAdapter(current.provider)
        let depProjectId = dep.projectId

        // If only versionId is given (e.g. Modrinth specific file dependency), resolve its project ID
        if (!depProjectId && dep.versionId) {
          const fetchedVer = await depAdapter.getVersion(env, dep.versionId)
          if (fetchedVer) {
            depProjectId = fetchedVer.id // or fetchedVer
          }
        }

        if (!depProjectId) continue
        const depKey = `${current.provider}:${depProjectId}`

        // B. Handle OPTIONAL dependencies (do NOT automatically install)
        if (dep.dependencyType === "OPTIONAL" || dep.dependencyType === "EMBEDDED") {
          if (!optionalDepsMap.has(depKey) && !itemsMap.has(depKey)) {
            try {
              const depProj = await depAdapter.getProject(env, depProjectId)
              optionalDepsMap.set(depKey, {
                provider: current.provider,
                projectId: depProjectId,
                projectName: depProj?.name || dep.projectName || "Dependencia Opcional",
                versionId: dep.versionId || "",
                fileId: dep.fileId || null,
                versionNumber: "",
                filename: dep.fileName || "optional.jar",
                sizeBytes: 0,
                sha256: null,
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

        // C. Handle REQUIRED dependencies
        // Check cycle / duplicate
        if (itemsMap.has(depKey)) {
          // Already resolved in plan!
          continue
        }

        if (visitedBranches.has(depKey)) {
          // Cycle detected in dependency graph, skip re-traversal
          continue
        }
        visitedBranches.add(depKey)

        // Fetch compatible versions for the required dependency
        let depCompatibleVersions: NormalizedModVersion[] = []
        try {
          depCompatibleVersions = await depAdapter.getCompatibleVersions(
            env,
            depProjectId,
            minecraftVersion,
            loader,
          )
        } catch {
          conflicts.push(`Error al consultar versiones para la dependencia "${dep.projectName || depProjectId}".`)
          continue
        }

        if (depCompatibleVersions.length === 0) {
          conflicts.push(
            `No se encontró ninguna versión compatible con Minecraft ${minecraftVersion} y ${loader} para la dependencia "${dep.projectName || depProjectId}".`,
          )
          continue
        }

        let selectedDepVersion: NormalizedModVersion | undefined

        // Check if manual override exists
        const overrideVersionId = manualOverridesMap.get(depKey)
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
        } else if (dep.versionId) {
          // Priority 1: Explicitly pinned versionId by provider
          selectedDepVersion = depCompatibleVersions.find((v) => v.id === dep.versionId || v.fileId === dep.versionId)
        }

        // Priority 2: Automatic selection (latest RELEASE stable, fallback to BETA/ALPHA)
        if (!selectedDepVersion) {
          const sorted = [...depCompatibleVersions].sort((a, b) => {
            const rankA = a.releaseType === "RELEASE" ? 3 : a.releaseType === "BETA" ? 2 : 1
            const rankB = b.releaseType === "RELEASE" ? 3 : b.releaseType === "BETA" ? 2 : 1
            if (rankA !== rankB) return rankB - rankA
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
          })
          selectedDepVersion = sorted[0]
        }

        if (!selectedDepVersion) {
          conflicts.push(`No se pudo seleccionar una versión válida para la dependencia "${dep.projectName || depProjectId}".`)
          continue
        }

        const depProject = await depAdapter.getProject(env, depProjectId).catch(() => null)
        const depProjectName = depProject?.name || dep.projectName || selectedDepVersion.name || "Dependencia"

        const existingDep = draftFiles.find(
          (f) => f.sourceProvider === current.provider && f.sourceProjectId === depProjectId,
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
}

export const modProviderManager = new ModProviderManager()
