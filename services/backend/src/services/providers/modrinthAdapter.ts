import type { Env } from "../../types"
import type {
  ModProviderAdapter,
  NormalizedModProject,
  NormalizedModVersion,
  NormalizedModDependency,
} from "./types"
import type { ModReleaseTypeGql, ModDependencyTypeGql } from "@hikat/graphql"

const DEFAULT_MODRINTH_BASE_URL = "https://api.modrinth.com/v2"
const USER_AGENT = "HiKAT/0.1.0 (contact@hikat.local)"

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
  ): Promise<{ items: NormalizedModProject[]; totalCount: number }> {
    const baseUrl = this.getBaseUrl(env)

    // Build facets for mod, current minecraft version, and loader (neoforge)
    const facets = [
      ["project_type:mod"],
      [`versions:${minecraftVersion}`],
      [`categories:${loader.toLowerCase()}`],
    ]

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
          downloads: number
          follows: number
          icon_url?: string | null
          latest_version?: string | null
          date_created?: string
          date_modified?: string
        }>
        total_hits: number
      }

      const items: NormalizedModProject[] = (data.hits || []).map((hit) => ({
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
        latestVersion: hit.latest_version || null,
        publishedAt: hit.date_created || null,
        updatedAt: hit.date_modified || null,
      }))

      return { items, totalCount: data.total_hits || items.length }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getProject(env: Env, projectId: string): Promise<NormalizedModProject | null> {
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
        downloads: number
        followers: number
        icon_url?: string | null
        published?: string
        updated?: string
      }

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
  ): Promise<NormalizedModVersion[]> {
    const baseUrl = this.getBaseUrl(env)
    const params = new URLSearchParams({
      loaders: JSON.stringify([loader.toLowerCase()]),
      game_versions: JSON.stringify([minecraftVersion]),
    })

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

      const data = (await res.json()) as Array<{
        id: string
        project_id: string
        name: string
        version_number: string
        game_versions: string[]
        loaders: string[]
        version_type: string
        date_published: string
        downloads: number
        files: Array<{
          hashes: { sha512?: string; sha1?: string; sha256?: string }
          url: string
          filename: string
          primary?: boolean
          size: number
        }>
        dependencies: Array<{
          version_id?: string | null
          project_id?: string | null
          file_name?: string | null
          dependency_type: string
        }>
      }>

      return (data || []).map((v) => this.mapModrinthVersion(v))
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getVersion(
    env: Env,
    versionId: string,
    _projectId?: string,
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
      return this.mapModrinthVersion(data)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private mapModrinthVersion(raw: any): NormalizedModVersion {
    const primaryFile =
      raw.files?.find((f: any) => f.primary) ||
      raw.files?.find((f: any) => f.filename?.endsWith(".jar")) ||
      raw.files?.[0] || {
        filename: `${raw.name || "mod"}.jar`,
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

    return {
      id: raw.id,
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
      sha256: primaryFile.hashes?.sha256 || null,
      downloadUrl: primaryFile.url,
      dependencies,
    }
  }
}
