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

const DEFAULT_CURSEFORGE_BASE_URL = "https://api.curseforge.com/v1"
const MINECRAFT_GAME_ID = 432

// Official CurseForge class IDs for Minecraft
const CURSEFORGE_CLASS_MAP: Record<ContentTypeGql, number> = {
  MOD: 6,
  RESOURCE_PACK: 12,
  DATA_PACK: 6945,
  SHADER: 6552,
}

const NEOFORGE_LOADER_TYPE = 6

export class CurseForgeAdapter implements ModProviderAdapter {
  readonly provider = "CURSEFORGE" as const
  private classIdCache: Map<ContentTypeGql, number> | null = null

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

  async resolveClassId(env: Env, contentType: ContentTypeGql): Promise<number> {
    if (this.classIdCache && this.classIdCache.has(contentType)) {
      return this.classIdCache.get(contentType)!
    }

    const fallbackMap: Record<ContentTypeGql, number> = {
      MOD: 6,
      RESOURCE_PACK: 12,
      DATA_PACK: 6945,
      SHADER: 6552,
    }

    if (!this.isConfigured(env)) {
      return fallbackMap[contentType]
    }

    try {
      const baseUrl = this.getBaseUrl(env)
      const res = await fetch(`${baseUrl}/categories?gameId=${MINECRAFT_GAME_ID}&classesOnly=true`, {
        headers: this.getHeaders(env),
      })
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: number; name?: string; slug?: string }> }
        if (data.data && Array.isArray(data.data)) {
          const map = new Map<ContentTypeGql, number>()
          for (const cls of data.data) {
            const name = (cls.name || "").toLowerCase()
            const slug = (cls.slug || "").toLowerCase()
            if (slug === "mc-mods" || name === "mods") map.set("MOD", cls.id)
            else if (slug === "texture-packs" || name === "resource packs") map.set("RESOURCE_PACK", cls.id)
            else if (slug === "data-packs" || name === "data packs") map.set("DATA_PACK", cls.id)
            else if (slug === "shaders" || name.includes("shader") || slug.includes("customization")) map.set("SHADER", cls.id)
          }
          for (const [ct, id] of Object.entries(fallbackMap)) {
            if (!map.has(ct as ContentTypeGql)) {
              map.set(ct as ContentTypeGql, id)
            }
          }
          this.classIdCache = map
          return map.get(contentType) || fallbackMap[contentType]
        }
      }
    } catch {
      // Fallback on error
    }

    return fallbackMap[contentType]
  }

  async searchMods(
    env: Env,
    query: string,
    minecraftVersion: string,
    _loader: string,
    limit: number,
    offset: number,
    contentType: ContentTypeGql = "MOD",
  ): Promise<{ items: NormalizedModProject[]; totalCount: number }> {
    if (!this.isConfigured(env)) {
      return { items: [], totalCount: 0 }
    }

    const baseUrl = this.getBaseUrl(env)
    const classId = await this.resolveClassId(env, contentType)

    const paramsRecord: Record<string, string> = {
      gameId: String(MINECRAFT_GAME_ID),
      classId: String(classId),
      gameVersion: minecraftVersion,
      pageSize: String(Math.min(limit || 20, 50)),
      index: String(offset || 0),
    }

    if (contentType === "MOD") {
      paramsRecord.modLoaderType = String(NEOFORGE_LOADER_TYPE)
    }

    if (query.trim()) {
      paramsRecord.searchFilter = query.trim()
    }

    const params = new URLSearchParams(paramsRecord)
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
          classId?: number
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
        contentType,
        environment: null,
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

  async getProject(
    env: Env,
    projectId: string,
    contentType: ContentTypeGql = "MOD",
  ): Promise<NormalizedModProject | null> {
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
          classId?: number
          mainCategoryId?: number
        }
      }

      const mod = data.data
      if (!mod) return null

      const classId = mod.classId || mod.mainCategoryId
      let discoveredType: ContentTypeGql = contentType
      if (classId === 6) discoveredType = "MOD"
      else if (classId === 12) discoveredType = "RESOURCE_PACK"
      else if (classId === 6945) discoveredType = "DATA_PACK"
      else if (classId === 6552) discoveredType = "SHADER"

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
        contentType: discoveredType,
        environment: null,
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
    contentType: ContentTypeGql = "MOD",
  ): Promise<NormalizedModVersion[]> {
    if (!this.isConfigured(env)) return []

    const baseUrl = this.getBaseUrl(env)
    const paramsRecord: Record<string, string> = {
      gameVersion: minecraftVersion,
      pageSize: "50",
    }

    if (contentType === "MOD") {
      paramsRecord.modLoaderType = String(NEOFORGE_LOADER_TYPE)
    }

    const params = new URLSearchParams(paramsRecord)
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

      const versions: NormalizedModVersion[] = []
      for (const file of data.data || []) {
        const v = await this.mapCurseForgeFile(env, projectId, file, minecraftVersion, contentType)
        versions.push(v)
      }

      return versions
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getVersion(
    env: Env,
    versionId: string,
    projectId?: string | null,
    contentType: ContentTypeGql = "MOD",
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

      return await this.mapCurseForgeFile(env, projectId, data.data, "", contentType)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async mapCurseForgeFile(
    env: Env,
    projectId: string,
    file: any,
    defaultMc: string,
    contentType: ContentTypeGql = "MOD",
  ): Promise<NormalizedModVersion> {
    let downloadUrl = file.downloadUrl || ""

    // If downloadUrl is missing in the file object, query official CurseForge endpoint for download URL
    if (!downloadUrl && projectId && file.id) {
      try {
        const baseUrl = this.getBaseUrl(env)
        const dlRes = await fetch(
          `${baseUrl}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}/download-url`,
          {
            headers: this.getHeaders(env),
          },
        )
        if (dlRes.ok) {
          const dlData = (await dlRes.json()) as { data?: string }
          if (dlData.data) {
            downloadUrl = dlData.data
          }
        }
      } catch {
        // Leave downloadUrl empty if endpoint fails
      }
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

    const rawGameVersions: string[] = file.gameVersions || []
    const extractedLoaders: string[] = []
    const extractedMcVersions: string[] = []

    for (const gv of rawGameVersions) {
      const lower = String(gv).toLowerCase()
      if (lower === "neoforge") extractedLoaders.push("NeoForge")
      else if (lower === "forge") extractedLoaders.push("Forge")
      else if (lower === "fabric") extractedLoaders.push("Fabric")
      else if (lower === "quilt") extractedLoaders.push("Quilt")
      else if (lower === "rift") extractedLoaders.push("Rift")
      else if (/^\d+\.\d+(\.\d+)?$/.test(gv)) extractedMcVersions.push(gv)
    }

    // Official CurseForge file hashes: algo 1 = SHA-1, algo 2 = MD5
    const sha1 = file.hashes?.find((h: any) => h.algo === 1)?.value || null
    const md5 = file.hashes?.find((h: any) => h.algo === 2)?.value || null

    return {
      id: String(file.id),
      projectId,
      fileId: String(file.id),
      versionNumber: file.displayName || file.fileName,
      name: file.displayName || file.fileName,
      releaseType,
      gameVersions:
        extractedMcVersions.length > 0
          ? extractedMcVersions
          : rawGameVersions.length > 0
          ? rawGameVersions
          : defaultMc
          ? [defaultMc]
          : [],
      loaders: contentType === "MOD" ? extractedLoaders : [],
      publishedAt: file.fileDate || new Date().toISOString(),
      downloads: Number(file.downloadCount || 0),
      filename: file.fileName || `${file.displayName || "file"}.jar`,
      sizeBytes: Number(file.fileLength || 0),
      sha256: null,
      hashes: {
        sha1: sha1 || undefined,
        md5: md5 || undefined,
      },
      downloadUrl,
      contentType,
      environment: null,
      dependencies,
    }
  }
}
