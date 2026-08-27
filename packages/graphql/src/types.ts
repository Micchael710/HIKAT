import type {
  AppRoleType,
  NewsType,
  NewsStatus,
  MediaType,
  MediaMimeType,
  ServerStatus,
  ServerPowerAction,
  ServerFileRoot,
  ServerAutomationAction,
  ServerAutomationFrequency,
} from "@hikat/shared"

export type ServerStatusGql = ServerStatus

export type ServerPowerActionGql = ServerPowerAction

export type ServerFileRootGql = ServerFileRoot

export type ServerAutomationActionGql = ServerAutomationAction

export type ServerAutomationFrequencyGql = ServerAutomationFrequency

export interface ServerResourcesGql {
  status: ServerStatusGql
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

export interface ServerPowerActionResultGql {
  success: boolean
  status: ServerStatusGql
  message?: string | null
}

export interface ServerCommandResultGql {
  success: boolean
  message?: string | null
}

export interface ServerConsoleTicketPayloadGql {
  ticket: string
  expiresAt: string
}

export interface ServerActivityItemGql {
  id: string
  description: string
  eventType: string
  timestamp: string
}

export interface ServerBackupItemGql {
  id: string
  name: string
  bytes: number
  createdAt: string
  completedAt?: string | null
  isSuccessful: boolean
  isLocked: boolean
}

export interface ServerWorldInfoGql {
  name: string
  sizeBytes?: number | null
  lastModified?: string | null
}

export interface MinecraftServerSettingsGql {
  difficulty: string
  maxPlayers: number
  pvp: boolean
  whitelist: boolean
  viewDistance: number
  simulationDistance: number
  motd: string
  allowFlight: boolean
}

export interface UpdateMinecraftServerSettingsInputGql {
  difficulty?: string | null
  maxPlayers?: number | null
  pvp?: boolean | null
  whitelist?: boolean | null
  viewDistance?: number | null
  simulationDistance?: number | null
  motd?: string | null
  allowFlight?: boolean | null
}

export interface ServerAutomationItemGql {
  id: string
  name: string
  action: ServerAutomationActionGql
  frequency: ServerAutomationFrequencyGql
  time: string
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  enabled: boolean
  isProcessing: boolean
  isAdvanced: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
}

export interface ServerAutomationInputGql {
  name: string
  action: ServerAutomationActionGql
  frequency: ServerAutomationFrequencyGql
  time: string
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  enabled?: boolean | null
}

export interface ServerFileItemGql {
  name: string
  isFile: boolean
  sizeBytes: number
  mimeType?: string | null
  modifiedAt: string
}

export interface ServerFileContentGql {
  content: string
  sizeBytes: number
}

export interface ServerSignedUrlPayloadGql {
  url: string
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

// --- Dashboard Types (Shard 06.5) ---

export interface AdminDashboardServerSummaryGql {
  status: ServerStatusGql
}

export interface AdminDashboardNewsSummaryGql {
  publishedCount: number

  draftCount: number
}

export interface AdminDashboardSkinsSummaryGql {
  totalCount: number

  availableCount: number
}

export interface AdminDashboardGameSummaryGql {
  publishedVersion?: string | null

  publishedAt?: string | null

  pendingChangesCount: number
}

export interface AdminDashboardSummaryGql {
  server: AdminDashboardServerSummaryGql

  news: AdminDashboardNewsSummaryGql

  skins: AdminDashboardSkinsSummaryGql

  game: AdminDashboardGameSummaryGql
}

// --- Skin Types (Shard 06.5) ---

export type SkinModelGql = "CLASSIC" | "SLIM"

export type SkinStatusGql = "AVAILABLE" | "UNAVAILABLE"

export interface SkinGql {
  id: string

  name: string

  model: SkinModelGql

  imageUrl: string

  status: SkinStatusGql

  createdAt: string

  updatedAt: string
}

export interface SkinEdgeGql {
  node: SkinGql

  cursor: string
}

export interface SkinConnectionGql {
  edges: SkinEdgeGql[]

  items: SkinGql[]

  pageInfo: PageInfoGql

  totalCount: number
}

export interface CreateSkinInputGql {
  name: string

  model?: SkinModelGql | null

  mediaId: string

  status?: SkinStatusGql | null
}

export interface UpdateSkinInputGql {
  name?: string | null

  model?: SkinModelGql | null

  mediaId?: string | null

  status?: SkinStatusGql | null
}

// --- Player Skins Types (Shard 06.6) ---

export interface PlayerSkinGql {
  id: string
  userId: string
  model: SkinModelGql
  imageUrl: string
  createdAt: string
  updatedAt: string
}


export interface AdminPlayerSkinGql {
  id: string

  userId: string

  userDisplayName: string

  model: SkinModelGql

  imageUrl: string

  createdAt: string

  updatedAt: string
}

export interface AdminPlayerSkinEdgeGql {
  node: AdminPlayerSkinGql

  cursor: string
}

export interface AdminPlayerSkinConnectionGql {
  edges: AdminPlayerSkinEdgeGql[]

  items: AdminPlayerSkinGql[]

  pageInfo: PageInfoGql

  totalCount: number
}

export interface SetPlayerSkinInputGql {
  mediaId: string

  model: SkinModelGql
}

export interface UpdateAdminPlayerSkinInputGql {
  model?: SkinModelGql | null

  mediaId?: string | null
}

// --- Game & Launcher Types (Shard 06.5) ---

export type GameFileCategoryGql = "MOD" | "RESOURCE_PACK" | "SHADER_PACK" | "KUBEJS" | "SCRIPT"

export type GameReleaseStatusGql = "DRAFT" | "PUBLISHED" | "ARCHIVED"

export type SyncPolicyGql = "NO_MODIFICABLE" | "MODIFICABLE"

export type GameDraftChangeStatusGql = "UNCHANGED" | "ADDED" | "UPDATED" | "REMOVED"

export interface GameDraftChangesGql {
  added: number

  updated: number

  removed: number

  unchanged: number

  total: number
}

export interface GameDraftReadinessGql {
  isReady: boolean

  validVersion: boolean

  noConflicts: boolean

  storageVerified: boolean

  issues: string[]
}

export interface ClientFileGql {
  path: string

  sha256: string

  sizeBytes: number

  downloadUrl: string

  policy: SyncPolicyGql
}

export interface PublishedModpackGql {
  version: string

  minecraftVersion: string

  neoForgeVersion: string

  mandatory: boolean

  clientFiles: ClientFileGql[]
}

export interface AdminGameFileGql {
  id: string

  name: string

  logicalPath: string

  category: GameFileCategoryGql

  sha256: string

  sizeBytes: number

  policy: SyncPolicyGql

  changeStatus?: GameDraftChangeStatusGql | null

  createdAt: string
}

export interface GameReleaseGql {
  id: string

  version: string

  minecraftVersion: string

  neoForgeVersion: string

  status: GameReleaseStatusGql

  notes?: string | null

  publishedAt?: string | null

  files: AdminGameFileGql[]

  createdAt: string

  updatedAt: string
}

export interface AdminGameOverviewGql {
  publishedRelease?: GameReleaseGql | null

  draftRelease?: GameReleaseGql | null

  pendingChangesCount: number

  changes?: GameDraftChangesGql | null

  readiness?: GameDraftReadinessGql | null
}

export interface GameFileUploadPayloadGql {
  uploadUrl: string

  uploadToken: string

  expiresAt: string

  maxSizeBytes: number

  expectedCategory: GameFileCategoryGql
}

export interface CreateGameFileUploadInputGql {
  category: GameFileCategoryGql

  originalFilename: string

  sizeBytes: number
}

export interface AddGameFileInputGql {
  name: string

  category?: GameFileCategoryGql | null

  tokenHash: string
}

export interface UpdateGameFileInputGql {
  name?: string | null

  category?: GameFileCategoryGql | null

  tokenHash?: string | null
}

export interface PrepareGameDraftInputGql {
  baseReleaseId?: string | null
}

export interface PublishGameReleaseInputGql {
  version: string

  notes?: string | null
}

// --- Settings Types (Shard 06.5) ---

export interface AdminSettingsGql {
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

export interface ClientConfigurationGql {
  projectName: string

  serverIp: string

  serverPort: number

  discordUrl?: string | null

  websiteUrl?: string | null

  maintenanceEnabled: boolean

  maintenanceMessage?: string | null

  minRamGb: number

  recommendedRamGb: number
}

export interface UpdateAdminSettingsInputGql {
  projectName?: string | null

  maintenanceEnabled?: boolean | null

  maintenanceMessage?: string | null

  serverIp?: string | null

  serverPort?: number | null

  discordUrl?: string | null

  websiteUrl?: string | null

  minRamGb?: number | null

  recommendedRamGb?: number | null
}
