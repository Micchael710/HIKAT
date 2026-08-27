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

export type BackofficeSection = "dashboard" | "news" | "skins" | "server" | "game" | "settings"

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
  networkRxBytes?: number | null
  networkTxBytes?: number | null
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

// --- Dashboard Types (Shard 06.5) ---

export interface AdminDashboardSummary {
  server: {
    status: ServerStatus
  }

  news: {
    publishedCount: number

    draftCount: number
  }

  skins: {
    totalCount: number

    availableCount: number
  }

  game: {
    publishedVersion?: string | null

    publishedAt?: string | null

    pendingChangesCount: number
  }
}

// --- Skin Types (Shard 06.5) ---

export type SkinModel = "CLASSIC" | "SLIM"

export type SkinStatus = "AVAILABLE" | "UNAVAILABLE"

export interface SkinItem {
  id: string

  name: string

  model: SkinModel

  imageUrl: string

  status: SkinStatus

  createdAt: string

  updatedAt: string
}

export interface SkinConnection {
  items: SkinItem[]

  totalCount: number
}

// --- Player Skin Types (Shard 06.6) ---

export interface AdminPlayerSkin {
  id: string

  userId: string

  userDisplayName: string

  model: SkinModel

  imageUrl: string

  createdAt: string

  updatedAt: string
}

export interface AdminPlayerSkinConnection {
  items: AdminPlayerSkin[]

  totalCount: number
}

export interface UpdateAdminPlayerSkinInput {
  model?: SkinModel | null

  mediaId?: string | null
}

// --- Game & Modpack Types (Shard 06.5) ---

export type GameFileCategory = "MOD" | "RESOURCE_PACK" | "SHADER_PACK" | "KUBEJS" | "SCRIPT"

export type GameReleaseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"

export type SyncPolicy = "NO_MODIFICABLE" | "MODIFICABLE"

export type GameDraftChangeStatus = "UNCHANGED" | "ADDED" | "UPDATED" | "REMOVED"

export interface GameDraftChanges {
  added: number

  updated: number

  removed: number

  unchanged: number

  total: number
}

export interface GameDraftReadiness {
  isReady: boolean

  validVersion: boolean

  noConflicts: boolean

  storageVerified: boolean

  issues: string[]
}

export interface AdminGameFile {
  id: string

  name: string

  logicalPath: string

  category: GameFileCategory

  sha256: string

  sizeBytes: number

  policy: SyncPolicy

  changeStatus?: GameDraftChangeStatus | null

  createdAt: string
}

export interface GameRelease {
  id: string

  version: string

  minecraftVersion: string

  neoForgeVersion: string

  status: GameReleaseStatus

  notes?: string | null

  publishedAt?: string | null

  files: AdminGameFile[]

  createdAt: string

  updatedAt: string
}

export interface AdminGameOverview {
  publishedRelease?: GameRelease | null

  draftRelease?: GameRelease | null

  pendingChangesCount: number

  changes?: GameDraftChanges | null

  readiness?: GameDraftReadiness | null
}

// --- Settings Types (Shard 06.5) ---

export interface AdminSettings {
  projectName: string

  maintenanceEnabled: boolean

  maintenanceMessage: string

  serverIp: string

  serverPort: number

  discordUrl?: string | null
  websiteUrl?: string | null
  minRamGb: number
  recommendedRamGb: number
  updatedAt: string
}



// --- Server Administration II Types (Shard 07) ---

export interface ServerActivityItem {
  id: string
  description: string
  eventType: string
  timestamp: string
}

export interface ServerBackupItem {
  id: string
  name: string
  bytes: number
  createdAt: string
  completedAt?: string | null
  isSuccessful: boolean
  isLocked: boolean
}

export interface ServerWorldInfo {
  name: string
  sizeBytes?: number | null
  lastModified?: string | null
}

export interface MinecraftServerSettings {
  difficulty: string
  maxPlayers: number
  pvp: boolean
  whitelist: boolean
  viewDistance: number
  simulationDistance: number
  motd: string
  allowFlight: boolean
}

export interface UpdateMinecraftServerSettingsInput {
  difficulty?: string
  maxPlayers?: number
  pvp?: boolean
  whitelist?: boolean
  viewDistance?: number
  simulationDistance?: number
  motd?: string
  allowFlight?: boolean
}

export type ServerAutomationAction = "BACKUP" | "RESTART" | "START" | "STOP" | "COMMAND"
export type ServerAutomationFrequency = "DAILY" | "WEEKLY" | "SELECTED_DAYS" | "INTERVAL"
export type ServerTaskTemplate =
  | "AUTO_STOP"
  | "AUTO_START"
  | "AUTO_RESTART"
  | "AUTO_BACKUP"
  | "RUN_COMMAND"
  | "BACKUP_AND_RESTART"
  | "BACKUP_AND_STOP"
  | "WARN_AND_RESTART"
  | "WARN_AND_STOP"
  | "SAVE_AND_BACKUP"
  | "CUSTOM"

export interface ServerAutomationItem {
  id: string
  name: string
  template?: ServerTaskTemplate | null
  action: ServerAutomationAction
  frequency: ServerAutomationFrequency
  time: string
  intervalHours?: number | null
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  delaySeconds?: number | null
  humanSchedule?: string | null
  enabled: boolean
  isProcessing: boolean
  isAdvanced: boolean
  isManaged?: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
}

export interface ServerAutomationInput {
  name: string
  template?: ServerTaskTemplate | null
  action?: ServerAutomationAction | null
  frequency: ServerAutomationFrequency
  time?: string | null
  intervalHours?: number | null
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  delaySeconds?: number | null
  enabled?: boolean
}

export type ServerFileRoot = "SERVER" | "WORLD" | "CONFIG" | "MODS" | "LOGS"

export interface ServerFileItem {
  name: string
  isFile: boolean
  isSymlink: boolean
  sizeBytes: number
  mimeType?: string | null
  modifiedAt: string
}

export interface ServerFileContent {
  content: string
  sizeBytes: number
}

export interface ServerSignedUrlPayload {
  url: string
}

