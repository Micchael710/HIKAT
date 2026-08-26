import type {
  AppRoleType,
  NewsType,
  NewsStatus,
  MediaType,
  MediaMimeType,
  ServerStatus,
  ServerPowerAction,
} from "@hikat/shared"

export type ServerStatusGql = ServerStatus
export type ServerPowerActionGql = ServerPowerAction

export interface ServerResourcesGql {
  status: ServerStatusGql
  cpuPercent: number
  cpuLimitPercent?: number | null
  memoryUsedBytes: number
  memoryLimitBytes?: number | null
  diskUsedBytes: number
  diskLimitBytes?: number | null
  uptimeMs?: number | null
  isSuspended: boolean
}

export interface ServerPowerActionResultGql {
  success: boolean
  status: ServerStatusGql
  message?: string | null
}

export interface ServerCommandResultGql {
  success: boolean
  message?: string | null
}


export interface UserGql {
  id: string
  displayName?: string | null
  role: AppRoleType
  email?: string | null
  emailVerified?: boolean
  minecraftUuid?: string | null
  minecraftUsername?: string | null
  createdAt: string
  updatedAt: string
}

export interface ServiceHealthGql {
  status: "ok" | "degraded" | "error"
  service: string
  version: string
  timestamp: string
}

export interface PageInfoGql {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor?: string | null
  endCursor?: string | null
}

export interface ContentMediaGql {
  id: string
  mediaType: MediaType
  mimeType: string
  sizeBytes: number
  url: string
  createdAt: string
}

export interface NewsGql {
  id: string
  title: string
  content: string
  type: NewsType
  image?: ContentMediaGql | null
  youtubeVideoId?: string | null
  youtubeUrl?: string | null
  video?: ContentMediaGql | null
  status: NewsStatus
  publishedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface NewsEdgeGql {
  node: NewsGql
  cursor: string
}

export interface NewsConnectionGql {
  edges: NewsEdgeGql[]
  items: NewsGql[]
  pageInfo: PageInfoGql
  totalCount: number
}

export interface ContentMediaUploadPayloadGql {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
  maxSizeBytes: number
  expectedMimeType: string
  allowedMimeTypes: string[]
}

export interface CreateNewsInputGql {
  title: string
  content: string
  type: NewsType
  imageMediaId?: string | null
  youtubeUrl?: string | null
  videoMediaId?: string | null
  status?: NewsStatus | null
}

export interface UpdateNewsInputGql {
  title?: string | null
  content?: string | null
  type?: NewsType | null
  imageMediaId?: string | null
  youtubeUrl?: string | null
  videoMediaId?: string | null
  status?: NewsStatus | null
}

export interface CreateContentMediaUploadInputGql {
  mimeType: string
  sizeBytes: number
}
