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

  email?: string | null

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

export type SkinStatus = "AVAILABLE" | "UNAVAILABLE"

export interface SkinItem {
  id: string
  name: string
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
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export interface AdminPlayerSkinConnection {
  items: AdminPlayerSkin[]
  totalCount: number
}

export interface UpdateAdminPlayerSkinInput {
  mediaId?: string | null
}

// --- Capes Types (Phase 07 Hardening) ---

export type CapeStatus = "AVAILABLE" | "UNAVAILABLE"

export interface CapeItem {
  id: string
  name: string
  imageUrl: string
  status: CapeStatus
  createdAt: string
  updatedAt: string
}

export interface CapeConnection {
  items: CapeItem[]
  totalCount: number
}

export interface AdminPlayerCape {
  id: string
  userId: string
  userDisplayName: string
  name: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export interface AdminPlayerCapeConnection {
  items: AdminPlayerCape[]
  totalCount: number
}

export interface CreateCapeInput {
  name: string
  mediaId: string
  status?: CapeStatus
}

export interface UpdateCapeInput {
  name?: string
  mediaId?: string
  status?: CapeStatus
}

export interface UpdateAdminPlayerCapeInput {
  name?: string
  mediaId?: string
}

// --- Game & Modpack Types (Shard 06.5) ---

export type GameFileCategory =
  | "MOD"
  | "RESOURCE_PACK"
  | "DATA_PACK"
  | "SHADER_PACK"
  | "KUBEJS"
  | "SCRIPT"
  | "CONFIG"
  | "GENERAL"

export type ContentType = "MOD" | "RESOURCE_PACK" | "DATA_PACK" | "SHADER"
export type ModEnvironment = "CLIENT" | "SERVER" | "BOTH" | "UNKNOWN"

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
  uniqueVersion: boolean
  hasFiles: boolean
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
  explicitPolicy?: SyncPolicy | null
  effectivePolicy: SyncPolicy
  isInherited: boolean
  isDirectory: boolean
  changeStatus?: GameDraftChangeStatus | null
  sourceProvider?: ModProvider | null
  sourceProjectId?: string | null
  sourceVersionId?: string | null
  sourceFileId?: string | null
  sourceEnvironment?: ModEnvironment | null
  createdAt: string
}

// --- Mod Provider Types (Shard 08B) ---

export type ModProvider = "MODRINTH" | "CURSEFORGE"
export type ModDependencyType = "REQUIRED" | "OPTIONAL" | "INCOMPATIBLE" | "EMBEDDED"
export type ModReleaseType = "RELEASE" | "BETA" | "ALPHA"
export type ModPlanAction = "INSTALL" | "UPDATE" | "ALREADY_INSTALLED" | "CONFLICT"

export interface ModProviderStatus {
  provider: ModProvider
  available: boolean
  error?: string | null
}

export interface ModSearchResultItem {
  provider: ModProvider
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
  contentType: ContentType
  environment?: ModEnvironment | null
  latestVersion?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
}

export interface ModSearchPayload {
  items: ModSearchResultItem[]
  totalCount: number
  providersStatus: ModProviderStatus[]
  minecraftVersion: string
  neoForgeVersion: string
}

export interface ModDependency {
  projectId?: string | null
  versionId?: string | null
  fileId?: string | null
  dependencyType: ModDependencyType
  projectName?: string | null
  fileName?: string | null
}

export interface ModProjectVersion {
  id: string
  fileId?: string | null
  versionNumber: string
  name: string
  releaseType: ModReleaseType
  gameVersions: string[]
  loaders: string[]
  publishedAt: string
  downloads: number
  filename: string
  sizeBytes: number
  sha256?: string | null
  dependencies: ModDependency[]
}

export interface ModProjectDetail {
  provider: ModProvider
  projectId: string
  slug?: string | null
  name: string
  summary: string
  description?: string | null
  author: string
  iconUrl?: string | null
  downloads: number
  contentType: ContentType
  environment?: ModEnvironment | null
  compatibleVersions: ModProjectVersion[]
  installedVersion?: string | null
  isInstalled: boolean
  minecraftVersion: string
  neoForgeVersion: string
}

export interface ModInstallationPlanItem {
  provider: ModProvider
  projectId: string
  projectName: string
  versionId: string
  fileId?: string | null
  versionNumber: string
  filename: string
  sizeBytes: number
  sha256?: string | null
  contentType: ContentType
  environment?: ModEnvironment | null
  logicalPath: string
  isRoot: boolean
  isDependency: boolean
  isRequired: boolean
  isInstalled: boolean
  action: ModPlanAction
  installedFileId?: string | null
  installedVersionNumber?: string | null
  availableCompatibleVersions: ModProjectVersion[]
}

export interface ModInstallationPlan {
  items: ModInstallationPlanItem[]
  totalDownloadSizeBytes: number
  conflicts: string[]
  optionalDependencies: ModInstallationPlanItem[]
  isValid: boolean
}

export interface ModVersionOverrideInput {
  provider: ModProvider
  projectId: string
  versionId: string
  contentType?: ContentType | null
}

export interface ResolveModPlanInput {
  provider: ModProvider
  projectId: string
  versionId: string
  contentType?: ContentType | null
  manualOverrides?: ModVersionOverrideInput[] | null
}

export interface InstallModPlanInput {
  provider: ModProvider
  projectId: string
  versionId: string
  contentType?: ContentType | null
  manualOverrides?: ModVersionOverrideInput[] | null
}

export interface UpdateGameDraftMetadataInput {
  version?: string | null
  notes?: string | null
  coverMediaId?: string | null
}

export interface PublishGameReleaseInput {
  version?: string | null
  notes?: string | null
  coverMediaId?: string | null
  expectedDraftFingerprint?: string | null
}

export interface GameRelease {
  id: string

  version: string

  minecraftVersion: string

  neoForgeVersion: string

  status: GameReleaseStatus

  notes?: string | null

  coverMediaId?: string | null

  cover?: ContentMedia | null

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

  draftFingerprint?: string | null
}

// --- Settings Types (Shard 06.5 & Shard 08F) ---

export type UpdateDeploymentOrder = "SERVER_FIRST" | "PLAYERS_FIRST"

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
  updateDeploymentOrder: UpdateDeploymentOrder
  launcherActiveReleaseId?: string | null
  updatedAt: string
}

export interface UpdateAdminSettingsInput {
  projectName?: string
  maintenanceEnabled?: boolean
  maintenanceMessage?: string
  serverIp?: string
  serverPort?: number
  discordUrl?: string
  websiteUrl?: string
  minRamGb?: number
  recommendedRamGb?: number
  updateDeploymentOrder?: UpdateDeploymentOrder
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

// --- Server Managed Content & Release Sync Types (Shard 08D) ---

export type ServerManagedContentSource = "SERVER_DIRECT" | "GAME_RELEASE"
export type ServerManagedContentStatus = "INSTALLED" | "UPDATE_AVAILABLE" | "MISSING"

export interface ServerManagedContentItem {
  id: string
  managementSource: ServerManagedContentSource
  provider?: ModProvider | null
  projectId?: string | null
  versionId?: string | null
  fileId?: string | null
  contentType: ContentType
  environment?: ModEnvironment | null
  targetPath: string
  sha256: string
  sizeBytes: number
  gameReleaseId?: string | null
  gameReleaseFileId?: string | null
  status: ServerManagedContentStatus
  name: string
  createdAt: string
  updatedAt: string
}

export interface ServerContentSearchPayload {
  items: ModSearchResultItem[]
  totalCount: number
  hasMore: boolean
  nextCursor?: string | null
  providersStatus: ModProviderStatus[]
  minecraftVersion: string
  neoForgeVersion: string
  isPublishedEnvironment: boolean
}

export interface ServerContentPlanItem {
  provider: ModProvider
  projectId: string
  projectName: string
  versionId: string
  fileId?: string | null
  versionNumber: string
  filename: string
  sizeBytes: number
  sha256?: string | null
  contentType: ContentType
  environment?: ModEnvironment | null
  targetPath: string
  isRoot: boolean
  isDependency: boolean
  isRequired: boolean
  isInstalled: boolean
  action: ModPlanAction
  installedManagedId?: string | null
  installedVersionNumber?: string | null
  availableCompatibleVersions: ModProjectVersion[]
}

export interface ServerContentInstallationPlan {
  items: ServerContentPlanItem[]
  totalDownloadSizeBytes: number
  conflicts: string[]
  optionalDependencies: ServerContentPlanItem[]
  isValid: boolean
  requiresGameUpdate: boolean
  gameUpdateReason?: string | null
}

export interface ResolveServerContentPlanInput {
  provider: ModProvider
  projectId: string
  versionId: string
  contentType?: ContentType | null
  manualOverrides?: ModVersionOverrideInput[] | null
}

export interface InstallServerContentPlanInput {
  provider: ModProvider
  projectId: string
  versionId: string
  contentType?: ContentType | null
  manualOverrides?: ModVersionOverrideInput[] | null
}

export type ServerReleaseSyncPlanAction = "INSTALL" | "UPDATE" | "REMOVE" | "KEEP"

export interface ServerReleaseSyncPlanItem {
  action: ServerReleaseSyncPlanAction
  filename: string
  targetPath: string
  sizeBytes: number
  sha256: string
  sourceProvider?: ModProvider | null
  sourceProjectId?: string | null
  sourceVersionId?: string | null
  sourceFileId?: string | null
  gameReleaseFileId?: string | null
  managedContentId?: string | null
  currentVersionNumber?: string | null
  desiredVersionNumber?: string | null
}

export interface ServerReleaseSyncSummary {
  toInstall: number
  toUpdate: number
  toRemove: number
  toKeep: number
}

export interface ServerReleaseSyncPlan {
  releaseId?: string | null
  releaseVersion?: string | null
  isPending: boolean
  items: ServerReleaseSyncPlanItem[]
  summary: ServerReleaseSyncSummary
  serverStatus: ServerStatus
  canApply: boolean
  blockReason?: string | null
}

export type ServerReleaseSyncStatusEnum = "PENDING" | "APPLYING" | "APPLIED" | "FAILED"

export interface ServerReleaseSyncStatus {
  releaseId?: string | null
  releaseVersion?: string | null
  status: ServerReleaseSyncStatusEnum
  appliedAt?: string | null
  details?: string | null
}

export interface ServerReleaseSyncResult {
  success: boolean
  message: string
  syncedCount: number
  status: ServerReleaseSyncStatusEnum
}

