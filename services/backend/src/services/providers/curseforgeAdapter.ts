import type { Env } from "../../types"
import type {
  ModProviderAdapter,
  NormalizedModProject,
  NormalizedModVersion,
  NormalizedModDependency,
} from "./types"
import type { ModReleaseTypeGql, ModDependencyTypeGql } from "@hikat/graphql"

const DEFAULT_CURSEFORGE_BASE_URL = "https://api.curseforge.com/v1"
const MINECRAFT_GAME_ID = 432
const MINECRAFT_MODS_CLASS_ID = 6
const NEOFORGE_LOADER_TYPE = 6

export class CurseForgeAdapter implements ModProviderAdapter {
  readonly provider = "CURSEFORGE" as const

  isConfigured(env: Env): boolean {
    return Boolean(env.CURSEFORGE_API_KEY && env.CURSEFORGE_API_KEY.trim())
  }

  private getBaseUrl(env: Env): string {
    return env.CURSEFORGE_API_BASE_URL || DEFAULT_CURSEFORGE_BASE_URL
  }

  private getHeaders(env: Env): Record<string, string> {
    return {
      "x-api-key": env.CURSEFORGE_API_KEY?.trim() || "",
      Accept: "application/json",
    }
  }

  async searchMods(
    env: Env,
    query: string,
    minecraftVersion: string,
    _loader: string,
    limit: number,
    offset: number,
  ): Promise<{ items: NormalizedModProject[]; totalCount: number }> {
    if (!this.isConfigured(env)) {
      return { items: [], totalCount: 0 }
    }

    const baseUrl = this.getBaseUrl(env)
    const params = new URLSearchParams({
      gameId: String(MINECRAFT_GAME_ID),
      classId: String(MINECRAFT_MODS_CLASS_ID),
      gameVersion: minecraftVersion,
      modLoaderType: String(NEOFORGE_LOADER_TYPE),
      pageSize: String(Math.min(limit || 20, 50)),
      index: String(offset || 0),
    })

    if (query.trim()) {
      params.set("searchFilter", query.trim())
    }

    const url = `${baseUrl}/mods/search?${params.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: this.getHeaders(env),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`CurseForge search failed with status ${res.status}`)
      }

      const data = (await res.json()) as {
        data: Array<{
          id: number
          name: string
          slug: string
          summary: string
          authors?: Array<{ name: string }>
          logo?: { url?: string }
          downloadCount?: number
          categories?: Array<{ name: string }>
          dateCreated?: string
          dateModified?: string
        }>
        pagination?: { totalCount?: number }
      }

      const items: NormalizedModProject[] = (data.data || []).map((mod) => ({
        provider: "CURSEFORGE",
        projectId: String(mod.id),
        slug: mod.slug,
        name: mod.name,
        summary: mod.summary || "",
        description: mod.summary || "",
        author: mod.authors?.map((a) => a.name).join(", ") || "Desconocido",
        iconUrl: mod.logo?.url || null,
        downloads: Number(mod.downloadCount || 0),
        follows: null,
        categories: mod.categories?.map((c) => c.name) || [],
        latestVersion: null,
        publishedAt: mod.dateCreated || null,
        updatedAt: mod.dateModified || null,
      }))

      return {
        items,
        totalCount: data.pagination?.totalCount || items.length,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getProject(env: Env, projectId: string): Promise<NormalizedModProject | null> {
    if (!this.isConfigured(env)) return null

    const baseUrl = this.getBaseUrl(env)
    const url = `${baseUrl}/mods/${encodeURIComponent(projectId)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: this.getHeaders(env),
        signal: controller.signal,
      })

      if (res.status === 404) return null
      if (!res.ok) {
        throw new Error(`CurseForge getProject failed with status ${res.status}`)
      }

      const data = (await res.json()) as {
        data: {
          id: number
          name: string
          slug: string
          summary: string
          authors?: Array<{ name: string }>
          logo?: { url?: string }
          downloadCount?: number
          categories?: Array<{ name: string }>
          dateCreated?: string
          dateModified?: string
        }
      }

      const mod = data.data
      if (!mod) return null

      return {
        provider: "CURSEFORGE",
        projectId: String(mod.id),
        slug: mod.slug,
        name: mod.name,
        summary: mod.summary || "",
        description: mod.summary || "",
        author: mod.authors?.map((a) => a.name).join(", ") || "Desconocido",
        iconUrl: mod.logo?.url || null,
        downloads: Number(mod.downloadCount || 0),
        follows: null,
        categories: mod.categories?.map((c) => c.name) || [],
        publishedAt: mod.dateCreated || null,
        updatedAt: mod.dateModified || null,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getCompatibleVersions(
    env: Env,
    projectId: string,
    minecraftVersion: string,
    _loader: string,
  ): Promise<NormalizedModVersion[]> {
    if (!this.isConfigured(env)) return []

    const baseUrl = this.getBaseUrl(env)
    const params = new URLSearchParams({
      gameVersion: minecraftVersion,
      modLoaderType: String(NEOFORGE_LOADER_TYPE),
      pageSize: "50",
    })

    const url = `${baseUrl}/mods/${encodeURIComponent(projectId)}/files?${params.toString()}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: this.getHeaders(env),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`CurseForge getCompatibleVersions failed with status ${res.status}`)
      }

      const data = (await res.json()) as {
        data: Array<any>
      }

      return (data.data || []).map((file) => this.mapCurseForgeFile(file, minecraftVersion))
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getVersion(
    env: Env,
    versionId: string,
    projectId?: string,
  ): Promise<NormalizedModVersion | null> {
    if (!this.isConfigured(env)) return null
    if (!projectId) {
      throw new Error("CurseForge getVersion requires projectId")
    }

    const baseUrl = this.getBaseUrl(env)
    const url = `${baseUrl}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(versionId)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch(url, {
        headers: this.getHeaders(env),
        signal: controller.signal,
      })

      if (res.status === 404) return null
      if (!res.ok) {
        throw new Error(`CurseForge getVersion failed with status ${res.status}`)
      }

      const data = (await res.json()) as { data: any }
      if (!data.data) return null

      return this.mapCurseForgeFile(data.data, "")
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private mapCurseForgeFile(file: any, defaultMc: string): NormalizedModVersion {
    const fileId = Number(file.id)
    let downloadUrl = file.downloadUrl
    if (!downloadUrl) {
      // Fallback direct ForgeCDN pattern
      const p1 = Math.floor(fileId / 1000)
      const p2 = fileId % 1000
      downloadUrl = `https://edge.forgecdn.net/files/${p1}/${p2}/${encodeURIComponent(file.fileName || "mod.jar")}`
    }

    let releaseType: ModReleaseTypeGql = "RELEASE"
    if (file.releaseType === 2) releaseType = "BETA"
    else if (file.releaseType === 3) releaseType = "ALPHA"

    // Map dependencies
    // FileRelationType: 1=Embedded, 2=Optional, 3=Required, 5=Incompatible, 6=Include
    const dependencies: NormalizedModDependency[] = (file.dependencies || []).map((d: any) => {
      let depType: ModDependencyTypeGql = "REQUIRED"
      if (d.relationType === 2) depType = "OPTIONAL"
      else if (d.relationType === 5) depType = "INCOMPATIBLE"
      else if (d.relationType === 1 || d.relationType === 6) depType = "EMBEDDED"

      return {
        projectId: String(d.modId),
        versionId: null,
        fileId: null,
        dependencyType: depType,
        projectName: null,
        fileName: null,
      }
    })

    const sha256 = file.hashes?.find((h: any) => h.algo === 3)?.value || null

    return {
      id: String(file.id),
      fileId: String(file.id),
      versionNumber: file.displayName || file.fileName,
      name: file.displayName || file.fileName,
      releaseType,
      gameVersions: file.gameVersions || (defaultMc ? [defaultMc] : []),
      loaders: ["NeoForge"],
      publishedAt: file.fileDate || new Date().toISOString(),
      downloads: Number(file.downloadCount || 0),
      filename: file.fileName || `${file.displayName || "mod"}.jar`,
      sizeBytes: Number(file.fileLength || 0),
      sha256,
      downloadUrl,
      dependencies,
    }
  }
}
