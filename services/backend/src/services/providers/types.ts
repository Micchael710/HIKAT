import type { Env } from "../../types"
import type {
  ModProviderGql,
  ModDependencyTypeGql,
  ModReleaseTypeGql,
  ModPlanActionGql,
} from "@hikat/graphql"

export interface NormalizedModProject {
  provider: ModProviderGql
  projectId: string
  slug?: string | null
  name: string
  summary: string
  description?: string | null
  author: string
  iconUrl?: string | null
  downloads: number
  follows?: number | null
  categories: string[]
  latestVersion?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
}

export interface NormalizedModDependency {
  projectId?: string | null
  versionId?: string | null
  fileId?: string | null
  dependencyType: ModDependencyTypeGql
  projectName?: string | null
  fileName?: string | null
}

export interface NormalizedModVersion {
  id: string
  fileId?: string | null
  versionNumber: string
  name: string
  releaseType: ModReleaseTypeGql
  gameVersions: string[]
  loaders: string[]
  publishedAt: string
  downloads: number
  filename: string
  sizeBytes: number
  sha256?: string | null
  downloadUrl: string
  dependencies: NormalizedModDependency[]
}

export interface ModProviderAdapter {
  provider: ModProviderGql
  isConfigured(env: Env): boolean
  searchMods(
    env: Env,
    query: string,
    minecraftVersion: string,
    loader: string,
    limit: number,
    offset: number,
  ): Promise<{ items: NormalizedModProject[]; totalCount: number }>
  getProject(env: Env, projectId: string): Promise<NormalizedModProject | null>
  getCompatibleVersions(
    env: Env,
    projectId: string,
    minecraftVersion: string,
    loader: string,
  ): Promise<NormalizedModVersion[]>
  getVersion(
    env: Env,
    versionId: string,
    projectId?: string,
  ): Promise<NormalizedModVersion | null>
}
