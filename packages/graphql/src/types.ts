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
  ServerTaskTemplate,
} from "@hikat/shared"

export type ServerStatusGql = ServerStatus

export type ServerPowerActionGql = ServerPowerAction

export type ServerFileRootGql = ServerFileRoot

export type ServerAutomationActionGql = ServerAutomationAction

export type ServerAutomationFrequencyGql = ServerAutomationFrequency

export type ServerTaskTemplateGql = ServerTaskTemplate

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

export interface ServerConsoleTicketGql {
  ticket: string
  expiresAt: string
}

export interface ServerCommandResultGql {
  success: boolean
  message?: string | null
}

export interface ServerActivityItemGql {
  id: string
  eventType: string
  description: string
  timestamp: string
  metadata?: Record<string, unknown> | null
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
  template?: ServerTaskTemplateGql | null
  frequency: ServerAutomationFrequencyGql
  time: string
  intervalHours?: number | null
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  delaySeconds?: number | null
  message?: string | null
  humanSchedule?: string | null
  enabled: boolean
  isProcessing: boolean
  isAdvanced: boolean
  isManaged: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
}

export interface ServerAutomationInputGql {
  name: string
  action?: ServerAutomationActionGql | null
  template?: ServerTaskTemplateGql | null
  frequency: ServerAutomationFrequencyGql
  time?: string | null
  intervalHours?: number | null
  weekday?: number | null
  weekdays?: number[] | null
  command?: string | null
  delaySeconds?: number | null
  message?: string | null
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

// --- Skin Types (Shard 06.5 / 07 Hardening) ---

export type SkinStatusGql = "AVAILABLE" | "UNAVAILABLE"

export interface SkinGql {
  id: string
  name: string
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
  mediaId: string
  status?: SkinStatusGql | null
}

export interface UpdateSkinInputGql {
  name?: string | null
  mediaId?: string | null
  status?: SkinStatusGql | null
}

// --- Player Skins Types (Shard 06.6 / 07 Hardening) ---

export interface PlayerSkinGql {
  id: string
  userId: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export interface AdminPlayerSkinGql {
  id: string
  userId: string
  userDisplayName: string
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
}

export type ActiveSkinTypeGql = "CUSTOM" | "GLOBAL"

export interface ActiveSkinSelectionGql {
  type: ActiveSkinTypeGql
  skinId?: string | null
  skin?: SkinGql | null
  playerSkin?: PlayerSkinGql | null
  imageUrl: string
  name?: string | null
  updatedAt: string
}

export interface SetActiveSkinInputGql {
  type: ActiveSkinTypeGql
  skinId?: string | null
}

export interface UpdateAdminPlayerSkinInputGql {
  mediaId: string
}

// --- Capes Types (Shard 07 Hardening) ---

export type CapeStatusGql = "AVAILABLE" | "UNAVAILABLE"

export interface CapeGql {
  id: string
  name: string
  imageUrl: string
  status: CapeStatusGql
  createdAt: string
  updatedAt: string
}

export interface CapeEdgeGql {
  node: CapeGql
  cursor: string
}

export interface CapeConnectionGql {
  edges: CapeEdgeGql[]
  items: CapeGql[]
  pageInfo: PageInfoGql
  totalCount: number
}

export interface CreateCapeInputGql {
  name: string
  mediaId: string
  status?: CapeStatusGql | null
}

export interface UpdateCapeInputGql {
  name?: string | null
  mediaId?: string | null
  status?: CapeStatusGql | null
}

export interface PlayerCapeGql {
  id: string
  userId: string
  name: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export interface PlayerCapeEdgeGql {
  node: PlayerCapeGql
  cursor: string
}

export interface PlayerCapeConnectionGql {
  edges: PlayerCapeEdgeGql[]
  items: PlayerCapeGql[]
  pageInfo: PageInfoGql
  totalCount: number
}

export interface AddPlayerCapeInputGql {
  name: string
  mediaId: string
}

export interface AdminPlayerCapeGql {
  id: string
  userId: string
  userDisplayName: string
  name: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export interface AdminPlayerCapeEdgeGql {
  node: AdminPlayerCapeGql
  cursor: string
}

export interface AdminPlayerCapeConnectionGql {
  edges: AdminPlayerCapeEdgeGql[]
  items: AdminPlayerCapeGql[]
  pageInfo: PageInfoGql
  totalCount: number
}

export interface UpdateAdminPlayerCapeInputGql {
  name?: string | null
  mediaId?: string | null
}

export type ActiveCapeTypeGql = "NONE" | "CUSTOM" | "GLOBAL"

export interface ActiveCapeSelectionGql {
  type: ActiveCapeTypeGql
  capeId?: string | null
  playerCapeId?: string | null
  cape?: CapeGql | null
  playerCape?: PlayerCapeGql | null
  imageUrl?: string | null
  name?: string | null
  updatedAt: string
}

export interface SetActiveCapeInputGql {
  type: ActiveCapeTypeGql
  capeId?: string | null
  playerCapeId?: string | null
}

// --- Game & Launcher Types (Shard 06.5 / Shard 08A) ---

export type GameFileCategoryGql =
  | "MOD"
  | "RESOURCE_PACK"
  | "DATA_PACK"
  | "SHADER_PACK"
  | "KUBEJS"
  | "SCRIPT"
  | "CONFIG"
  | "GENERAL"

export type ContentTypeGql = "MOD" | "RESOURCE_PACK" | "DATA_PACK" | "SHADER"
export type ModEnvironmentGql = "CLIENT" | "SERVER" | "BOTH" | "UNKNOWN"

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
  uniqueVersion: boolean
  hasFiles: boolean
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
  explicitPolicy?: SyncPolicyGql | null
  effectivePolicy: SyncPolicyGql
  isInherited: boolean
  isDirectory: boolean
  changeStatus?: GameDraftChangeStatusGql | null
  sourceProvider?: ModProviderGql | null
  sourceProjectId?: string | null
  sourceVersionId?: string | null
  sourceFileId?: string | null
  sourceEnvironment?: ModEnvironmentGql | null
  createdAt: string
}

export interface GameReleaseGql {
  id: string
  version: string
  minecraftVersion: string
  neoForgeVersion: string
  status: GameReleaseStatusGql
  notes?: string | null
  coverMediaId?: string | null
  cover?: ContentMediaGql | null
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
  draftFingerprint?: string | null
}

export interface GameFileUploadPayloadGql {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
  maxSizeBytes: number
  expectedCategory: GameFileCategoryGql
}

export interface CreateGameFileUploadInputGql {
  category?: GameFileCategoryGql | null
  originalFilename: string
  sizeBytes: number
  logicalPath?: string | null
}

export interface AddGameFileInputGql {
  name: string
  category?: GameFileCategoryGql | null
  logicalPath?: string | null
  explicitPolicy?: SyncPolicyGql | null
  tokenHash: string
}

export interface UpdateGameFileInputGql {
  name?: string | null
  category?: GameFileCategoryGql | null
  logicalPath?: string | null
  explicitPolicy?: SyncPolicyGql | null
  tokenHash?: string | null
}

export interface SaveGameFileContentInputGql {
  logicalPath: string
  content: string
  explicitPolicy?: SyncPolicyGql | null
}

export interface PrepareGameDraftInputGql {
  baseReleaseId?: string | null
}

export interface UpdateGameDraftMetadataInputGql {
  version?: string | null
  notes?: string | null
  coverMediaId?: string | null
}

export interface PublishGameReleaseInputGql {
  version?: string | null
  notes?: string | null
  coverMediaId?: string | null
  expectedDraftFingerprint?: string | null
}

// --- Mod Providers Types (Shard 08B) ---

export type ModProviderGql = "MODRINTH" | "CURSEFORGE"
export type ModDependencyTypeGql = "REQUIRED" | "OPTIONAL" | "INCOMPATIBLE" | "EMBEDDED"
export type ModReleaseTypeGql = "RELEASE" | "BETA" | "ALPHA"
export type ModPlanActionGql = "INSTALL" | "UPDATE" | "ALREADY_INSTALLED" | "CONFLICT"

export interface ModProviderStatusGql {
  provider: ModProviderGql
  available: boolean
  error?: string | null
}

export interface ModSearchResultItemGql {
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
  contentType: ContentTypeGql
  environment?: ModEnvironmentGql | null
  latestVersion?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
}

export interface ModSearchPayloadGql {
  items: ModSearchResultItemGql[]
  totalCount: number
  providersStatus: ModProviderStatusGql[]
  minecraftVersion: string
  neoForgeVersion: string
}

export interface ModDependencyGql {
  projectId?: string | null
  versionId?: string | null
  fileId?: string | null
  dependencyType: ModDependencyTypeGql
  projectName?: string | null
  fileName?: string | null
}

export interface ModProjectVersionGql {
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
  dependencies: ModDependencyGql[]
}

export interface ModProjectDetailGql {
  provider: ModProviderGql
  projectId: string
  slug?: string | null
  name: string
  summary: string
  description?: string | null
  author: string
  iconUrl?: string | null
  downloads: number
  contentType: ContentTypeGql
  environment?: ModEnvironmentGql | null
  compatibleVersions: ModProjectVersionGql[]
  installedVersion?: string | null
  isInstalled: boolean
  minecraftVersion: string
  neoForgeVersion: string
}

export interface ModInstallationPlanItemGql {
  provider: ModProviderGql
  projectId: string
  projectName: string
  versionId: string
  fileId?: string | null
  versionNumber: string
  filename: string
  sizeBytes: number
  sha256?: string | null
  contentType: ContentTypeGql
  environment?: ModEnvironmentGql | null
  logicalPath: string
  isRoot: boolean
  isDependency: boolean
  isRequired: boolean
  isInstalled: boolean
  action: ModPlanActionGql
  installedFileId?: string | null
  installedVersionNumber?: string | null
  availableCompatibleVersions: ModProjectVersionGql[]
}

export interface ModInstallationPlanGql {
  items: ModInstallationPlanItemGql[]
  totalDownloadSizeBytes: number
  conflicts: string[]
  optionalDependencies: ModInstallationPlanItemGql[]
  isValid: boolean
}

export interface ModVersionOverrideInputGql {
  provider: ModProviderGql
  projectId: string
  versionId: string
  contentType?: ContentTypeGql | null
}

export interface ResolveModPlanInputGql {
  provider: ModProviderGql
  projectId: string
  versionId: string
  contentType?: ContentTypeGql | null
  manualOverrides?: ModVersionOverrideInputGql[] | null
}

export interface InstallModPlanInputGql {
  provider: ModProviderGql
  projectId: string
  versionId: string
  contentType?: ContentTypeGql | null
  manualOverrides?: ModVersionOverrideInputGql[] | null
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

// --- Server Content & Release Sync Types (Shard 08D) ---

export type ServerManagedContentSourceGql = "SERVER_DIRECT" | "GAME_RELEASE"
export type ServerManagedContentStatusGql = "INSTALLED" | "UPDATE_AVAILABLE" | "MISSING"

export interface ServerManagedContentItemGql {
  id: string
  managementSource: ServerManagedContentSourceGql
  provider?: ModProviderGql | null
  projectId?: string | null
  versionId?: string | null
  fileId?: string | null
  contentType: ContentTypeGql
  environment?: ModEnvironmentGql | null
  targetPath: string
  sha256: string
  sizeBytes: number
  gameReleaseId?: string | null
  gameReleaseFileId?: string | null
  status: ServerManagedContentStatusGql
  name: string
  createdAt: string
  updatedAt: string
}

export interface ServerContentSearchPayloadGql {
  items: ModSearchResultItemGql[]
  totalCount: number
  providersStatus: ModProviderStatusGql[]
  minecraftVersion: string
  neoForgeVersion: string
  isPublishedEnvironment: boolean
}

export interface ServerContentPlanItemGql {
  provider: ModProviderGql
  projectId: string
  projectName: string
  versionId: string
  fileId?: string | null
  versionNumber: string
  filename: string
  sizeBytes: number
  sha256?: string | null
  contentType: ContentTypeGql
  environment?: ModEnvironmentGql | null
  targetPath: string
  isRoot: boolean
  isDependency: boolean
  isRequired: boolean
  isInstalled: boolean
  action: ModPlanActionGql
  installedManagedId?: string | null
  installedVersionNumber?: string | null
  availableCompatibleVersions: ModProjectVersionGql[]
}

export interface ServerContentInstallationPlanGql {
  items: ServerContentPlanItemGql[]
  totalDownloadSizeBytes: number
  conflicts: string[]
  optionalDependencies: ServerContentPlanItemGql[]
  isValid: boolean
  requiresGameUpdate: boolean
  gameUpdateReason?: string | null
}

export interface ResolveServerContentPlanInputGql {
  provider: ModProviderGql
  projectId: string
  versionId: string
  contentType?: ContentTypeGql | null
  manualOverrides?: ModVersionOverrideInputGql[] | null
}

export interface InstallServerContentPlanInputGql {
  provider: ModProviderGql
  projectId: string
  versionId: string
  contentType?: ContentTypeGql | null
  manualOverrides?: ModVersionOverrideInputGql[] | null
}

export type ServerReleaseSyncPlanActionGql = "INSTALL" | "UPDATE" | "REMOVE" | "KEEP"

export interface ServerReleaseSyncPlanItemGql {
  action: ServerReleaseSyncPlanActionGql
  filename: string
  targetPath: string
  sizeBytes: number
  sha256: string
  sourceProvider?: ModProviderGql | null
  sourceProjectId?: string | null
  sourceVersionId?: string | null
  sourceFileId?: string | null
  gameReleaseFileId?: string | null
  managedContentId?: string | null
  currentVersionNumber?: string | null
  desiredVersionNumber?: string | null
}

export interface ServerReleaseSyncSummaryGql {
  toInstall: number
  toUpdate: number
  toRemove: number
  toKeep: number
}

export interface ServerReleaseSyncPlanGql {
  releaseId?: string | null
  releaseVersion?: string | null
  isPending: boolean
  items: ServerReleaseSyncPlanItemGql[]
  summary: ServerReleaseSyncSummaryGql
  serverStatus: ServerStatusGql
  canApply: boolean
  blockReason?: string | null
}

export type ServerReleaseSyncStatusEnumGql = "PENDING" | "APPLYING" | "APPLIED" | "FAILED"

export interface ServerReleaseSyncStatusGql {
  releaseId?: string | null
  releaseVersion?: string | null
  status: ServerReleaseSyncStatusEnumGql
  appliedAt?: string | null
  details?: string | null
}

export interface ServerReleaseSyncResultGql {
  success: boolean
  message: string
  syncedCount: number
  status: ServerReleaseSyncStatusEnumGql
}

