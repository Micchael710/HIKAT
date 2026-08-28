import type { Env } from "../../types"
import type {
  ModProviderAdapter,
  NormalizedModProject,
  NormalizedModVersion,
  NormalizedModDependency,
} from "./types"
import type {
  ModReleaseTypeGql,
  ModDependencyTypeGql,
  ContentTypeGql,
  ModEnvironmentGql,
} from "@hikat/graphql"

const DEFAULT_MODRINTH_BASE_URL = "https://api.modrinth.com/v2"
const USER_AGENT = "HiKAT/0.1.0 (contact@hikat.local)"

function mapModrinthProjectTypeToContentType(
  projectType?: string,
  allProjectTypes?: string[],
  categories?: string[],
  additionalCategories?: string[],
  requestedContentType: ContentTypeGql = "MOD",
): ContentTypeGql {
  const allTypes = new Set([
    ...(allProjectTypes || []).map((t) => t.toLowerCase()),
    (projectType || "").toLowerCase(),
  ])
  const cats = new Set([
    ...(categories || []).map((c) => c.toLowerCase()),
    ...(additionalCategories || []).map((c) => c.toLowerCase()),
  ])

  // If the project explicitly supports the requested content type, return it
  if (requestedContentType === "DATA_PACK" && (allTypes.has("datapack") || cats.has("datapack"))) {
    return "DATA_PACK"
  }
  if (requestedContentType === "MOD" && (allTypes.has("mod") || projectType?.toLowerCase() === "mod")) {
    return "MOD"
  }
  if (
    requestedContentType === "RESOURCE_PACK" &&
    (allTypes.has("resourcepack") || projectType?.toLowerCase() === "resourcepack")
  ) {
    return "RESOURCE_PACK"
  }
  if (
    requestedContentType === "SHADER" &&
    (allTypes.has("shader") || projectType?.toLowerCase() === "shader")
  ) {
    return "SHADER"
  }

  // Fallback inferred from primary project type
  const pt = projectType?.toLowerCase()
  if (pt === "mod") return "MOD"
  if (pt === "resourcepack") return "RESOURCE_PACK"
  if (pt === "shader") return "SHADER"
  if (allTypes.has("datapack") || cats.has("datapack")) return "DATA_PACK"
  return requestedContentType
}

function mapModrinthEnvironment(clientSide?: string, serverSide?: string): ModEnvironmentGql {
  const client = clientSide?.toLowerCase()
  const server = serverSide?.toLowerCase()
  if (client === "unsupported" && server && server !== "unsupported") return "SERVER"
  if (server === "unsupported" && client && client !== "unsupported") return "CLIENT"
  if (client && client !== "unsupported" && server && server !== "unsupported") return "BOTH"
  return "UNKNOWN"
}

export class ModrinthAdapter implements ModProviderAdapter {
  readonly provider = "MODRINTH" as const

  isConfigured(_env: Env): boolean {
    return true // Modrinth is a public open API
  }

  private getBaseUrl(env: Env): string {
    return env.MODRINTH_API_BASE_URL || DEFAULT_MODRINTH_BASE_URL
  }

  async searchMods(
    env: Env,
    query: string,
    minecraftVersion: string,
    loader: string,
    limit: number,
    offset: number,
    contentType: ContentTypeGql = "MOD",
  ): Promise<{ items: NormalizedModProject[]; totalCount: number }> {
    const baseUrl = this.getBaseUrl(env)

    // Build facets per content type according to official Modrinth v2 documentation
    const facets: string[][] = []

    if (contentType === "MOD") {
      facets.push(["project_type:mod"])
      facets.push([`versions:${minecraftVersion}`])
      facets.push([`categories:${loader.toLowerCase()}`])
    } else if (contentType === "RESOURCE_PACK") {
      facets.push(["project_type:resourcepack"])
      facets.push([`versions:${minecraftVersion}`])
    } else if (contentType === "SHADER") {
      facets.push(["project_type:shader"])
      facets.push([`versions:${minecraftVersion}`])
    } else if (contentType === "DATA_PACK") {
      // In Modrinth, Data Packs use official facet all_project_types:datapack
      facets.push(["all_project_types:datapack"])
      facets.push([`versions:${minecraftVersion}`])
    }

    const params = new URLSearchParams()
    if (query.trim()) {
      params.set("query", query.trim())
    }
    params.set("facets", JSON.stringify(facets))
    params.set("limit", String(Math.min(limit || 20, 100)))
    params.set("offset", String(offset || 0))

    const url = `${baseUrl}/search?${params.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`Modrinth search failed with status ${res.status}`)
      }

      const data = (await res.json()) as {
        hits: Array<{
          project_id: string
          slug: string
          title: string
          description: string
          author: string
          categories: string[]
          additional_categories?: string[]
          all_project_types?: string[]
          downloads: number
          follows: number
          icon_url?: string | null
          latest_version?: string | null
          date_created?: string
          date_modified?: string
          project_type?: string
          client_side?: string
          server_side?: string
        }>
        total_hits: number
      }

      const items: NormalizedModProject[] = (data.hits || []).map((hit) => {
        const itemType = mapModrinthProjectTypeToContentType(
          hit.project_type,
          hit.all_project_types,
          hit.categories,
          hit.additional_categories,
          contentType,
        )
        const environment = mapModrinthEnvironment(hit.client_side, hit.server_side)

        return {
          provider: "MODRINTH",
          projectId: hit.project_id,
          slug: hit.slug,
          name: hit.title,
          summary: hit.description,
          description: hit.description,
          author: hit.author,
          iconUrl: hit.icon_url || null,
          downloads: Number(hit.downloads || 0),
          follows: Number(hit.follows || 0),
          categories: hit.categories || [],
          contentType: itemType,
          environment,
          latestVersion: hit.latest_version || null,
          publishedAt: hit.date_created || null,
          updatedAt: hit.date_modified || null,
        }
      })

      return { items, totalCount: data.total_hits || items.length }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getProject(
    env: Env,
    projectId: string,
    contentType: ContentTypeGql = "MOD",
  ): Promise<NormalizedModProject | null> {
    const baseUrl = this.getBaseUrl(env)
    const url = `${baseUrl}/project/${encodeURIComponent(projectId)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      })

      if (res.status === 404) return null
      if (!res.ok) {
        throw new Error(`Modrinth getProject failed with status ${res.status}`)
      }

      const data = (await res.json()) as {
        id: string
        slug: string
        title: string
        description: string
        body?: string
        organization?: string
        categories: string[]
        additional_categories?: string[]
        all_project_types?: string[]
        downloads: number
        followers: number
        icon_url?: string | null
        published?: string
        updated?: string
        project_type?: string
        client_side?: string
        server_side?: string
      }

      const itemType = mapModrinthProjectTypeToContentType(
        data.project_type,
        data.all_project_types,
        data.categories,
        data.additional_categories,
        contentType,
      )
      const environment = mapModrinthEnvironment(data.client_side, data.server_side)

      return {
        provider: "MODRINTH",
        projectId: data.id,
        slug: data.slug,
        name: data.title,
        summary: data.description,
        description: data.body || data.description,
        author: data.organization || data.slug,
        iconUrl: data.icon_url || null,
        downloads: Number(data.downloads || 0),
        follows: Number(data.followers || 0),
        categories: data.categories || [],
        contentType: itemType,
        environment,
        publishedAt: data.published || null,
        updatedAt: data.updated || null,
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("Timeout contacting Modrinth API")
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getSupportedContentTypes(env: Env, projectId: string): Promise<ContentTypeGql[]> {
    const baseUrl = this.getBaseUrl(env)
    const projectUrl = `${baseUrl}/project/${encodeURIComponent(projectId)}`
    const versionsUrl = `${baseUrl}/project/${encodeURIComponent(projectId)}/version`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(projectUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      })

      if (!res.ok) return []

      const data = (await res.json()) as {
        project_type?: string
        all_project_types?: string[]
        categories?: string[]
        additional_categories?: string[]
      }

      const allTypes = (data.all_project_types || []).map((t) => t.toLowerCase())
      const cats = [...(data.categories || []), ...(data.additional_categories || [])].map((c) => c.toLowerCase())
      const pt = (data.project_type || "").toLowerCase()

      // Fetch versions to inspect authorative version loaders
      let versions: Array<{ loaders?: string[] }> = []
      try {
        const vRes = await fetch(versionsUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
          signal: controller.signal,
        })
        if (vRes.ok) {
          const vData = await vRes.json()
          if (Array.isArray(vData)) {
            versions = vData
          }
        }
      } catch {
        // Ignore error and use project metadata fallback
      }

      const types = new Set<ContentTypeGql>()

      if (versions.length > 0) {
        let hasModVersion = false
        let hasDpVersion = false
        let hasRpVersion = false

        for (const v of versions) {
          const rawLoaders = (v.loaders || []).map((l: string) => l.toLowerCase())
          if (rawLoaders.some((l) => ["neoforge", "forge", "fabric", "quilt"].includes(l))) {
            hasModVersion = true
          }
          if (rawLoaders.includes("datapack")) {
            hasDpVersion = true
          }
          if (
            rawLoaders.includes("minecraft") &&
            (pt === "resourcepack" || allTypes.includes("resourcepack") || cats.includes("resourcepack"))
          ) {
            hasRpVersion = true
          }
        }

        if (hasModVersion) types.add("MOD")
        if (hasDpVersion) types.add("DATA_PACK")
        if (hasRpVersion || pt === "resourcepack" || allTypes.includes("resourcepack")) types.add("RESOURCE_PACK")
        if (pt === "shader" || allTypes.includes("shader")) types.add("SHADER")
      }

      if (types.size === 0) {
        if (allTypes.includes("mod") || pt === "mod") types.add("MOD")
        if (allTypes.includes("datapack") || cats.includes("datapack")) types.add("DATA_PACK")
        if (allTypes.includes("resourcepack") || pt === "resourcepack") types.add("RESOURCE_PACK")
        if (allTypes.includes("shader") || pt === "shader") types.add("SHADER")
      }

      return Array.from(types)
    } catch {
      return []
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getCompatibleVersions(
    env: Env,
    projectId: string,
    minecraftVersion: string,
    loader: string,
    contentType: ContentTypeGql = "MOD",
  ): Promise<NormalizedModVersion[]> {
    const baseUrl = this.getBaseUrl(env)
    const paramsRecord: Record<string, string> = {
      game_versions: JSON.stringify([minecraftVersion]),
    }

    if (contentType === "MOD") {
      paramsRecord.loaders = JSON.stringify([loader.toLowerCase()])
    } else if (contentType === "DATA_PACK") {
      paramsRecord.loaders = JSON.stringify(["datapack"])
    }

    const params = new URLSearchParams(paramsRecord)
    const url = `${baseUrl}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`Modrinth getCompatibleVersions failed with status ${res.status}`)
      }

      const data = await res.json()
      const list = Array.isArray(data) ? data : data ? [data] : []
      return list.map((v) => this.mapModrinthVersion(v, contentType))
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getVersion(
    env: Env,
    versionId: string,
    _projectId?: string | null,
    contentType?: ContentTypeGql,
  ): Promise<NormalizedModVersion | null> {
    const baseUrl = this.getBaseUrl(env)
    const url = `${baseUrl}/version/${encodeURIComponent(versionId)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      })

      if (res.status === 404) return null
      if (!res.ok) {
        throw new Error(`Modrinth getVersion failed with status ${res.status}`)
      }

      const data = (await res.json()) as any
      return this.mapModrinthVersion(data, contentType)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private mapModrinthVersion(raw: any, fallbackContentType?: ContentTypeGql): NormalizedModVersion {
    const primaryFile =
      raw.files?.find((f: any) => f.primary) ||
      raw.files?.find((f: any) => f.filename?.endsWith(".jar") || f.filename?.endsWith(".zip")) ||
      raw.files?.[0] || {
        filename: `${raw.name || "file"}.jar`,
        size: 0,
        url: "",
        hashes: {},
      }

    const releaseType: ModReleaseTypeGql =
      raw.version_type === "beta"
        ? "BETA"
        : raw.version_type === "alpha"
        ? "ALPHA"
        : "RELEASE"

    const dependencies: NormalizedModDependency[] = (raw.dependencies || []).map(
      (d: any) => {
        let depType: ModDependencyTypeGql = "REQUIRED"
        if (d.dependency_type === "optional") depType = "OPTIONAL"
        else if (d.dependency_type === "incompatible") depType = "INCOMPATIBLE"
        else if (d.dependency_type === "embedded") depType = "EMBEDDED"

        return {
          projectId: d.project_id || null,
          versionId: d.version_id || null,
          fileId: null,
          dependencyType: depType,
          projectName: d.project_name || d.title || null,
          fileName: d.file_name || null,
        }
      },
    )

    const rawLoaders = raw.loaders || []
    const loaders = rawLoaders.map((l: string) => {
      const lower = l.toLowerCase()
      if (lower === "neoforge") return "NeoForge"
      if (lower === "forge") return "Forge"
      if (lower === "fabric") return "Fabric"
      if (lower === "quilt") return "Quilt"
      if (lower === "datapack") return "datapack"
      return l
    })

    let versionContentType: ContentTypeGql = fallbackContentType || "MOD"
    const lowerLoaders = rawLoaders.map((l: string) => l.toLowerCase())
    if (lowerLoaders.includes("datapack")) {
      versionContentType = "DATA_PACK"
    } else if (lowerLoaders.some((l: string) => ["neoforge", "forge", "fabric", "quilt"].includes(l))) {
      versionContentType = "MOD"
    } else if (lowerLoaders.includes("minecraft")) {
      versionContentType = fallbackContentType || "RESOURCE_PACK"
    } else if (fallbackContentType) {
      versionContentType = fallbackContentType
    }

    const hashes = primaryFile.hashes || {}

    return {
      id: raw.id,
      projectId: raw.project_id || undefined,
      fileId: null,
      versionNumber: raw.version_number || raw.name,
      name: raw.name || raw.version_number,
      releaseType,
      gameVersions: raw.game_versions || [],
      loaders,
      publishedAt: raw.date_published || new Date().toISOString(),
      downloads: Number(raw.downloads || 0),
      filename: primaryFile.filename,
      sizeBytes: Number(primaryFile.size || 0),
      sha256: null,
      hashes: {
        sha1: hashes.sha1,
        sha512: hashes.sha512,
      },
      downloadUrl: primaryFile.url,
      contentType: versionContentType,
      environment: null,
      dependencies,
    }
  }
}
