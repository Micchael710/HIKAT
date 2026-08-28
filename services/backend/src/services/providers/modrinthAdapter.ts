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

function isModrinthDataPack(
  allProjectTypes?: string[],
  categories?: string[],
  additionalCategories?: string[],
): boolean {
  const allTypes = (allProjectTypes || []).map((t) => t.toLowerCase())
  const cats = (categories || []).map((c) => c.toLowerCase())
  const addCats = (additionalCategories || []).map((c) => c.toLowerCase())
  return (
    allTypes.includes("datapack") ||
    cats.includes("datapack") ||
    addCats.includes("datapack")
  )
}

function mapModrinthProjectTypeToContentType(
  projectType?: string,
  allProjectTypes?: string[],
  categories?: string[],
  additionalCategories?: string[],
  fallback: ContentTypeGql = "MOD",
): ContentTypeGql {
  if (isModrinthDataPack(allProjectTypes, categories, additionalCategories)) {
    return "DATA_PACK"
  }
  const pt = projectType?.toLowerCase()
  if (pt === "mod") return "MOD"
  if (pt === "resourcepack") return "RESOURCE_PACK"
  if (pt === "shader") return "SHADER"
  return fallback
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
      // In Modrinth, Data Packs are identified by categories:datapack
      facets.push(["categories:datapack"])
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
    contentType: ContentTypeGql = "MOD",
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

  private mapModrinthVersion(raw: any, fallbackContentType: ContentTypeGql = "MOD"): NormalizedModVersion {
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

    const hashes = primaryFile.hashes || {}

    return {
      id: raw.id,
      projectId: raw.project_id || undefined,
      fileId: null,
      versionNumber: raw.version_number || raw.name,
      name: raw.name || raw.version_number,
      releaseType,
      gameVersions: raw.game_versions || [],
      loaders: raw.loaders || [],
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
      contentType: fallbackContentType,
      environment: null,
      dependencies,
    }
  }
}
