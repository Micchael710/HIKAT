import type {
  AppRole,
  NewsType,
  NewsStatus,
  MediaType,
  ServerStatus,
  ServerPowerAction,
} from "@hikat/shared"

export type { ServerStatus, ServerPowerAction }

export type ThemeMode = "dark" | "light"

export type BackofficeSection =
  | "dashboard"
  | "news"
  | "skins"
  | "server"
  | "game"
  | "settings"

export interface ContentMedia {
  id: string
  mediaType: MediaType
  mimeType: string
  sizeBytes: number
  url: string
  createdAt: string
}

export interface NewsItem {
  id: string
  title: string
  content: string
  type: NewsType
  image?: ContentMedia | null
  youtubeVideoId?: string | null
  youtubeUrl?: string | null
  video?: ContentMedia | null
  status: NewsStatus
  publishedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface NewsEdge {
  node: NewsItem
  cursor: string
}

export interface NewsConnection {
  edges: NewsEdge[]
  items: NewsItem[]
  totalCount: number
}

export interface ServerResources {
  status: ServerStatus
  cpuPercent: number
  cpuLimitPercent?: number | null
  memoryUsedBytes: number
  memoryLimitBytes?: number | null
  diskUsedBytes: number
  diskLimitBytes?: number | null
  uptimeMs?: number | null
  isSuspended: boolean
}

export interface ConsoleLogEntry {
  id: string
  line: string
  timestamp?: string
  type?: "stdout" | "stderr" | "info" | "error"
}

export interface AdminUser {
  id: string
  displayName?: string | null
  role: AppRole
  minecraftUuid?: string | null
  minecraftUsername?: string | null
}

export interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  user: AdminUser | null
  accessToken: string | null
  error: string | null
}

