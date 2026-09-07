/**
 * HiKAT GraphQL Resolvers
 * Wires authentication guards, schema scalar definitions, user queries,
 * admin operations, news feed & management, and media upload ticket creation.
 */

import { DateTimeScalar, createGraphQLError } from "@hikat/graphql"
import type {
  UserGql,
  ServiceHealthGql,
  NewsGql,
  NewsConnectionGql,
  CreateNewsInputGql,
  UpdateNewsInputGql,
  ContentMediaGql,
  ContentMediaUploadPayloadGql,
  CreateContentMediaUploadInputGql,
  CompleteContentMediaUploadInputGql,
  ServerResourcesGql,
  ServerPowerActionResultGql,
  ServerCommandResultGql,
  ServerConsoleTicketGql,
  ServerActivityItemGql,
  ServerBackupItemGql,
  ServerWorldInfoGql,
  MinecraftServerSettingsGql,
  UpdateMinecraftServerSettingsInputGql,
  ServerAutomationItemGql,
  ServerAutomationInputGql,
  ServerFileRootGql,
  ServerFileItemGql,
  ServerFileContentGql,
  ServerSignedUrlPayloadGql,
  AdminDashboardSummaryGql,
  SkinGql,
  SkinConnectionGql,
  SkinStatusGql,
  CreateSkinInputGql,
  UpdateSkinInputGql,
  PublishedModpackGql,
  AdminGameOverviewGql,
  AdminGameFileGql,
  GameReleaseGql,
  GameFileUploadPayloadGql,
  CreateGameFileUploadInputGql,
  CompleteGameFileUploadInputGql,
  GameFileUploadCompletePayloadGql,
  AddGameFileInputGql,
  UpdateGameFileInputGql,
  SaveGameFileContentInputGql,
  SyncPolicyGql,
  PrepareGameDraftInputGql,
  PublishGameReleaseInputGql,
  UpdateGameDraftMetadataInputGql,
  AdminSettingsGql,
  ClientConfigurationGql,
  UpdateAdminSettingsInputGql,
  GameFileCategoryGql,
  PlayerSkinGql,
  AdminPlayerSkinGql,
  AdminPlayerSkinConnectionGql,
  SetPlayerSkinInputGql,
  UpdateAdminPlayerSkinInputGql,
  ActiveSkinSelectionGql,
  SetActiveSkinInputGql,
  CapeGql,
  CapeConnectionGql,
  CapeStatusGql,
  CreateCapeInputGql,
  UpdateCapeInputGql,
  PlayerCapeGql,
  PlayerCapeConnectionGql,
  AdminPlayerCapeGql,
  AdminPlayerCapeConnectionGql,
  AddPlayerCapeInputGql,
  UpdateAdminPlayerCapeInputGql,
  ActiveCapeSelectionGql,
  SetActiveCapeInputGql,
  ModProviderGql,
  ModSearchPayloadGql,
  ModProjectDetailGql,
  ModInstallationPlanGql,
  ResolveModPlanInputGql,
  InstallModPlanInputGql,
  ContentTypeGql,
  ModEnvironmentGql,
  ServerManagedContentItemGql,
  ServerContentSearchPayloadGql,
  ServerContentInstallationPlanGql,
  ResolveServerContentPlanInputGql,
  InstallServerContentPlanInputGql,
  ServerReleaseSyncPlanGql,
  ServerReleaseSyncStatusGql,
  ServerReleaseSyncResultGql,
  ServerGql,
  CreateServerInputGql,
} from "@hikat/graphql"

import {
  HIKAT_VERSION,
  NewsType,
  NewsStatus,
  type ServerPowerAction,
  type ServerFileRoot,
} from "@hikat/shared"
import { requireAuth, requireAdmin } from "../auth/guards"
import { getUserById } from "../services/userService"
import {
  getServers,
  getServerById,
  createServer,
  deleteServer,
} from "../services/serverService"
import {
  getPublicNewsFeed,
  getPublicNewsById,
  getAdminNews,
  getAdminNewsById,
  createNews,
  updateNews,
  publishNews,
  unpublishNews,
  deleteNews,
} from "../services/newsService"
import { createContentMediaUpload, completeContentMediaUpload, deleteMedia } from "../services/mediaService"
import {
  getServerStatus,
  executeServerPowerAction,
  executeServerCommand,
  createConsoleTicket,
  getServerActivity,
} from "../services/pterodactyl/serverAdministrationService"
import {
  listServerBackups,
  createServerBackup,
  restoreServerBackup,
  deleteServerBackup,
  toggleServerBackupLock,
  getServerBackupDownloadUrl,
} from "../services/pterodactyl/serverBackupService"
import {
  getServerWorldInfo,
  createServerWorldDownloadUrl,
  prepareServerWorldUpload,
  replaceServerWorld,
} from "../services/pterodactyl/serverWorldService"
import {
  getMinecraftServerSettings,
  updateMinecraftServerSettings,
} from "../services/pterodactyl/serverConfigService"
import {
  listServerAutomations,
  createServerAutomation,
  updateServerAutomation,
  runServerAutomation,
  deleteServerAutomation,
} from "../services/pterodactyl/serverScheduleService"
import {
  listServerFiles,
  readServerTextFile,
  writeServerTextFile,
  createServerFolder,
  renameServerFile,
  deleteServerFile,
  prepareServerFileUploadUrl,
  createServerFileDownloadUrl,
} from "../services/pterodactyl/serverFileService"
import {
  getServerManagedContent,
  installServerContentPlan,
  removeServerManagedContent,
} from "../services/pterodactyl/serverContentService"
import {
  getServerReleaseSyncPlan,
  getServerReleaseSyncStatus,
  applyServerReleaseSync,
} from "../services/pterodactyl/serverReleaseSyncService"
import { getAdminDashboard } from "../services/dashboardService"

import {
  getAdminSkins,
  getPublicSkins,
  getSkinById,
  createSkin,
  updateSkin,
  deleteSkin,
  getMyPlayerSkin,
  createPlayerSkinUpload,
  setMyPlayerSkin,
  deleteMyPlayerSkin,
  getMyActiveSkin,
  setMyActiveSkin,
  getAdminPlayerSkins,
  getAdminPlayerSkinById,
  updateAdminPlayerSkin,
  deleteAdminPlayerSkin,
} from "../services/skinService"

import {
  getAdminCapes,
  getPublicCapes,
  getCapeById,
  createCape,
  updateCape,
  deleteCape,
  getMyPlayerCapes,
  createPlayerCapeUpload,
  addMyPlayerCape,
  deleteMyPlayerCape,
  getMyActiveCape,
  setMyActiveCape,
  getAdminPlayerCapes,
  getAdminPlayerCapeById,
  updateAdminPlayerCape,
  deleteAdminPlayerCape,
} from "../services/capeService"

import {
  getPublishedModpack,
  getAdminGameOverview,
  prepareGameDraft,
  discardGameDraft,
  updateGameDraftMetadata,
  publishGameRelease,
  getGameReleaseHistory,
} from "../services/game/releaseService"
import {
  getAdminGameFiles,
  createGameFileUploadToken,
  completeGameFileUploadToken,
  addGameFile,
  updateGameFile,
  removeGameFile,
  restoreGameFile,
  saveGameFileContent,
  readGameFileContent,
  createGameFolder,
  renameGamePath,
  moveGamePaths,
  copyGamePaths,
  deleteGamePaths,
  setGamePathPolicy,
} from "../services/game"

import {
  getGameEnvironmentCatalog,
  getLoaderVersions,
} from "../services/game/gameEnvironmentService"

import {
  getAdminSettings,
  getClientConfiguration,
  updateAdminSettings,
} from "../services/settingsService"

import { modProviderManager } from "../services/providers/modProviderManager"
import { installModPlan } from "../services/providers/modInstallationService"

import type { BackendGraphQLContext } from "../types"



export const resolvers = {
  DateTime: DateTimeScalar,

  Query: {
    health: (): ServiceHealthGql => {
      return {
        status: "ok",
        service: "hikat-backend",
        version: HIKAT_VERSION,
        timestamp: new Date().toISOString(),
      }
    },

    version: (): string => {
      return HIKAT_VERSION
    },

    me: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<UserGql | null> => {
      const identity = requireAuth(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      const user = await getUserById(context.db, identity.userId)
      if (!user) {
        return null
      }

      return {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        minecraftUuid: user.minecraftUuid,
        minecraftUsername: user.minecraftUsername,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }
    },

    adminStatus: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<{
      ok: boolean
      serverTime: string
      environment: string
    }> => {
      requireAdmin(context)

      return {
        ok: true,
        serverTime: new Date().toISOString(),
        environment: context.env.ENVIRONMENT || "development",
      }
    },

    // --- Server Infrastructure Queries (Require ADMIN) ---

    servers: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerGql[]> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getServers(context.db, context.env, context.request)
    },

    server: async (
      _parent: unknown,
      args: { serverId: string },
      context: BackendGraphQLContext,
    ): Promise<ServerGql | null> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getServerById(context.db, context.env, args.serverId, context.request)
    },

    // --- News Public Queries ---

    newsFeed: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        type?: NewsType | null
        serverId?: string | null
      },
      context: BackendGraphQLContext,
    ): Promise<NewsConnectionGql> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getPublicNewsFeed(context.db, context.env, args, context.request)
    },

    news: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<NewsGql | null> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getPublicNewsById(
        context.db,
        context.env,
        args.id,
        context.request,
      )
    },

    // --- News Administrative Queries (Require ADMIN) ---

    adminNews: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        type?: NewsType | null
        status?: NewsStatus | null
        serverId?: string | null
      },
      context: BackendGraphQLContext,
    ): Promise<NewsConnectionGql> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getAdminNews(context.db, context.env, args, context.request)
    },

    adminNewsItem: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<NewsGql | null> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getAdminNewsById(context.db, context.env, args.id, context.request)
    },

    // --- Server Administration Queries (Require ADMIN - Shard 06 & Shard 07) ---

    serverStatus: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerResourcesGql> => {
      requireAdmin(context)
      return getServerStatus(context.env, context.db, args?.serverId)
    },

    serverActivity: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerActivityItemGql[]> => {
      requireAdmin(context)
      return getServerActivity(context.env, context.db, args?.serverId)
    },

    serverBackups: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerBackupItemGql[]> => {
      requireAdmin(context)
      return listServerBackups(context.env, args?.serverId, undefined, context.db)
    },

    serverWorld: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerWorldInfoGql> => {
      requireAdmin(context)
      return getServerWorldInfo(context.env, args?.serverId, undefined, context.db)
    },

    serverMinecraftSettings: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<MinecraftServerSettingsGql> => {
      requireAdmin(context)
      return getMinecraftServerSettings(context.env, args?.serverId, undefined, context.db)
    },

    serverAutomations: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerAutomationItemGql[]> => {
      requireAdmin(context)
      return listServerAutomations(context.env, context.db, args?.serverId)
    },

    serverFiles: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath?: string | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerFileItemGql[]> => {
      requireAdmin(context)
      return listServerFiles(context.env, args.root, args.relativePath, args.serverId, undefined, context.db)
    },

    serverTextFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerFileContentGql> => {
      requireAdmin(context)
      return readServerTextFile(context.env, args.root, args.relativePath, args.serverId, undefined, context.db)
    },

    // --- Server Managed Content & Release Sync Queries (Require ADMIN - Shard 08D) ---

    serverManagedContent: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerManagedContentItemGql[]> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getServerManagedContent(context.db, context.env, args?.serverId)
    },

    searchServerContent: async (
      _parent: unknown,
      args: {
        query: string
        contentType?: ContentTypeGql | null
        provider?: ModProviderGql | null
        limit?: number | null
        offset?: number | null
        cursor?: string | null
      },
      context: BackendGraphQLContext,
    ): Promise<ServerContentSearchPayloadGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return modProviderManager.searchServerMods(
        context.env,
        context.db,
        args.query,
        args.provider,
        args.limit || 20,
        args.offset || 0,
        args.contentType || "MOD",
        args.cursor,
      )
    },

    serverContentProjectDetail: async (
      _parent: unknown,
      args: { provider: ModProviderGql; projectId: string; contentType?: ContentTypeGql | null },
      context: BackendGraphQLContext,
    ): Promise<ModProjectDetailGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return modProviderManager.getServerProjectDetail(
        context.env,
        context.db,
        args.provider,
        args.projectId,
        args.contentType || "MOD",
      )
    },

    resolveServerContentPlan: async (
      _parent: unknown,
      args: { input: ResolveServerContentPlanInputGql },
      context: BackendGraphQLContext,
    ): Promise<ServerContentInstallationPlanGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return modProviderManager.resolveServerInstallationPlan(
        context.env,
        context.db,
        args.input,
      )
    },

    serverReleaseSyncPlan: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerReleaseSyncPlanGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getServerReleaseSyncPlan(context.db, context.env, args?.serverId)
    },

    serverReleaseSyncStatus: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerReleaseSyncStatusGql | null> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getServerReleaseSyncStatus(context.db, args?.serverId)
    },


    // --- Dashboard Query (Require ADMIN - Shard 06.5) ---

    adminDashboard: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<AdminDashboardSummaryGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminDashboard(context.db, context.env)
    },

    // --- Skins Queries (Shard 06.5) ---

    skins: async (
      _parent: unknown,
      args: { first?: number | null; after?: string | null },
      context: BackendGraphQLContext,
    ): Promise<SkinConnectionGql> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getPublicSkins(context.db, context.env, args)
    },

    adminSkins: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        status?: SkinStatusGql | null
      },
      context: BackendGraphQLContext,
    ): Promise<SkinConnectionGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminSkins(context.db, context.env, args)
    },

    adminSkin: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<SkinGql | null> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getSkinById(context.db, args.id)
    },

    myPlayerSkin: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<PlayerSkinGql | null> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getMyPlayerSkin(context.db, identity.userId)
    },

    myActiveSkin: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ActiveSkinSelectionGql | null> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getMyActiveSkin(context.db, context.env, identity.userId)
    },

    adminPlayerSkins: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        search?: string | null
      },
      context: BackendGraphQLContext,
    ): Promise<AdminPlayerSkinConnectionGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminPlayerSkins(context.db, context.env, args)
    },

    adminPlayerSkin: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<AdminPlayerSkinGql | null> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminPlayerSkinById(context.db, args.id)
    },

    // --- Capes Queries (Shard 07 Hardening) ---

    capes: async (
      _parent: unknown,
      args: { first?: number | null; after?: string | null },
      context: BackendGraphQLContext,
    ): Promise<CapeConnectionGql> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getPublicCapes(context.db, context.env, args)
    },

    adminCapes: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        status?: CapeStatusGql | null
      },
      context: BackendGraphQLContext,
    ): Promise<CapeConnectionGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminCapes(context.db, context.env, args)
    },

    adminCape: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<CapeGql | null> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getCapeById(context.db, args.id)
    },

    myPlayerCapes: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<PlayerCapeGql[]> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getMyPlayerCapes(context.db, identity.userId)
    },

    myActiveCape: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ActiveCapeSelectionGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getMyActiveCape(context.db, context.env, identity.userId)
    },

    adminPlayerCapes: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        search?: string | null
      },
      context: BackendGraphQLContext,
    ): Promise<AdminPlayerCapeConnectionGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminPlayerCapes(context.db, context.env, args)
    },

    adminPlayerCape: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<AdminPlayerCapeGql | null> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminPlayerCapeById(context.db, args.id)
    },


    // --- Game & Launcher Queries (Shard 06.5) ---

    publishedModpack: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<PublishedModpackGql | null> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getPublishedModpack(context.db, context.env, context.request, args?.serverId)
    },

    adminGameOverview: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<AdminGameOverviewGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminGameOverview(context.db, context.env, context.request, args?.serverId)
    },

    gameReleaseHistory: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql[]> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getGameReleaseHistory(context.db, context.env, context.request, args?.serverId)
    },

    adminGameFiles: async (
      _parent: unknown,
      args: { releaseId?: string | null; category?: GameFileCategoryGql | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql[]> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminGameFiles(context.db, args.releaseId, args.category, args?.serverId)
    },

    readGameFileContent: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<string> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return readGameFileContent(context.db, args.id, context.env)
    },

    gameEnvironmentCatalog: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ) => {
      requireAdmin(context)
      return getGameEnvironmentCatalog()
    },

    gameLoaderVersions: async (
      _parent: unknown,
      args: { minecraftVersion: string; modLoader: string },
      context: BackendGraphQLContext,
    ) => {
      requireAdmin(context)
      return getLoaderVersions(args.minecraftVersion, args.modLoader as any)
    },

    searchMods: async (
      _parent: unknown,
      args: {
        query: string
        contentType?: ContentTypeGql | null
        provider?: ModProviderGql | null
        limit?: number | null
        offset?: number | null
      },
      context: BackendGraphQLContext,
    ): Promise<ModSearchPayloadGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return modProviderManager.searchMods(
        context.env,
        context.db,
        args.query,
        args.provider,
        args.limit || 20,
        args.offset || 0,
        args.contentType || "MOD",
      )
    },

    getModProjectDetail: async (
      _parent: unknown,
      args: { provider: ModProviderGql; projectId: string; contentType?: ContentTypeGql | null },
      context: BackendGraphQLContext,
    ): Promise<ModProjectDetailGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return modProviderManager.getProjectDetail(
        context.env,
        context.db,
        args.provider,
        args.projectId,
        args.contentType || "MOD",
      )
    },

    resolveModInstallationPlan: async (
      _parent: unknown,
      args: { input: ResolveModPlanInputGql },
      context: BackendGraphQLContext,
    ): Promise<ModInstallationPlanGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return modProviderManager.resolveInstallationPlan(
        context.env,
        context.db,
        args.input,
      )
    },


    // --- Settings Queries (Shard 06.5) ---

    clientConfiguration: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ClientConfigurationGql> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getClientConfiguration(context.db)
    },

    adminSettings: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<AdminSettingsGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminSettings(context.db)
    },
  },


  Mutation: {
    // --- Server Infrastructure Mutations (Require ADMIN) ---

    createServer: async (
      _parent: unknown,
      args: { input: CreateServerInputGql },
      context: BackendGraphQLContext,
    ): Promise<ServerGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createServer(context.db, context.env, args.input, identity.userId)
    },

    deleteServer: async (
      _parent: unknown,
      args: { serverId: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteServer(context.db, context.env, args.serverId)
    },

    // --- Server Administration Mutations (Require ADMIN - Shard 06 & 06A) ---

    createServerConsoleTicket: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerConsoleTicketGql> => {
      const identity = requireAdmin(context)
      if (!identity.sessionId) {
        throw createGraphQLError(
          "Session required for console ticket",
          "UNAUTHENTICATED",
        )
      }
      return createConsoleTicket(
        context.env,
        identity.userId,
        identity.sessionId,
        context.db,
        args?.serverId,
      )
    },

    serverPowerAction: async (
      _parent: unknown,
      args: { action: ServerPowerAction; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        args.action,
        identity.userId,
        undefined,
        args.serverId,
      )
    },

    startServer: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        "START",
        identity.userId,
        undefined,
        args?.serverId,
      )
    },

    restartServer: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        "RESTART",
        identity.userId,
        undefined,
        args?.serverId,
      )
    },

    stopServer: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        "STOP",
        identity.userId,
        undefined,
        args?.serverId,
      )
    },

    sendServerCommand: async (
      _parent: unknown,
      args: { command: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerCommandResultGql> => {
      const identity = requireAdmin(context)
      return executeServerCommand(
        context.env,
        args.command,
        identity.userId,
        undefined,
        args.serverId,
      )
    },

    // --- Server Administration II Mutations (Require ADMIN - Shard 07) ---

    createServerBackup: async (
      _parent: unknown,
      args: { name?: string | null; isLocked?: boolean | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerBackupItemGql> => {
      requireAdmin(context)
      return createServerBackup(context.env, args.name, args.serverId, undefined, context.db)
    },

    restoreServerBackup: async (
      _parent: unknown,
      args: { id: string; truncateDirectory?: boolean | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return restoreServerBackup(context.env, context.db, identity.userId, args.id, args.serverId)
    },

    deleteServerBackup: async (
      _parent: unknown,
      args: { id: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return deleteServerBackup(context.env, args.id, args.serverId, undefined, context.db)
    },

    toggleServerBackupLock: async (
      _parent: unknown,
      args: { id: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerBackupItemGql> => {
      requireAdmin(context)
      return toggleServerBackupLock(context.env, args.id, args.serverId, undefined, context.db)
    },

    createServerBackupDownloadUrl: async (
      _parent: unknown,
      args: { id: string; name?: string | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return getServerBackupDownloadUrl(context.env, args.id, args.serverId, undefined, context.db)
    },

    createServerWorldDownloadUrl: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return createServerWorldDownloadUrl(context.env, undefined, args?.serverId, undefined, context.db)
    },

    prepareServerWorldUpload: async (
      _parent: unknown,
      args: { serverId?: string | null } | undefined,
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return prepareServerWorldUpload(context.env, args?.serverId, undefined, context.db)
    },

    replaceServerWorld: async (
      _parent: unknown,
      args: { uploadedFileName: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return replaceServerWorld(context.env, context.db, identity.userId, args.uploadedFileName, args.serverId)
    },

    updateMinecraftServerSettings: async (
      _parent: unknown,
      args: { input: UpdateMinecraftServerSettingsInputGql; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<MinecraftServerSettingsGql> => {
      requireAdmin(context)
      return updateMinecraftServerSettings(context.env, args.input as any, args.serverId, undefined, context.db)
    },

    createServerAutomation: async (
      _parent: unknown,
      args: { input: ServerAutomationInputGql; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerAutomationItemGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createServerAutomation(context.db, context.env, args.input as any, args.serverId)
    },

    updateServerAutomation: async (
      _parent: unknown,
      args: { id: string; input: ServerAutomationInputGql; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerAutomationItemGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateServerAutomation(context.db, context.env, args.id, args.input as any, args.serverId)
    },

    runServerAutomation: async (
      _parent: unknown,
      args: { id: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return runServerAutomation(context.env, args.id, args.serverId, undefined, context.db)
    },

    deleteServerAutomation: async (
      _parent: unknown,
      args: { id: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteServerAutomation(context.db, context.env, args.id, args.serverId)
    },

    createServerFolder: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; folderName: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return createServerFolder(context.env, args.root, args.relativePath, args.folderName, args.serverId, undefined, context.db)
    },

    renameServerFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; newName: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return renameServerFile(context.env, args.root, args.relativePath, args.newName, args.serverId, undefined, context.db)
    },

    deleteServerFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return deleteServerFile(context.env, args.root, args.relativePath, args.serverId, undefined, context.db)
    },

    // --- Server Managed Content & Release Sync Mutations (Require ADMIN - Shard 08D) ---

    installServerContentPlan: async (
      _parent: unknown,
      args: { input: InstallServerContentPlanInputGql; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerManagedContentItemGql[]> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return installServerContentPlan(context.db, context.env, args.input, identity.userId, args.serverId)
    },

    removeServerManagedContent: async (
      _parent: unknown,
      args: { id: string; deleteFile?: boolean | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return removeServerManagedContent(context.db, context.env, args.id, identity.userId, args.deleteFile, args.serverId)
    },

    applyServerReleaseSync: async (
      _parent: unknown,
      args: { createBackup?: boolean | null; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerReleaseSyncResultGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return applyServerReleaseSync(
        context.db,
        context.env,
        identity.userId,
        Boolean(args.createBackup),
        args.serverId,
      )
    },

    writeServerTextFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; content: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return writeServerTextFile(context.env, args.root, args.relativePath, args.content, args.serverId, undefined, context.db)
    },

    prepareServerFileUpload: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return prepareServerFileUploadUrl(context.env, args.root, args.relativePath, args.serverId, undefined, context.db)
    },

    createServerFileDownloadUrl: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return createServerFileDownloadUrl(context.env, args.root, args.relativePath, args.serverId, undefined, context.db)
    },



    // --- News Administrative Mutations (Require ADMIN) ---


    createNews: async (
      _parent: unknown,
      args: { input: CreateNewsInputGql },
      context: BackendGraphQLContext,
    ): Promise<NewsGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return createNews(
        context.db,
        context.env,
        identity.userId,
        args.input,
        context.request,
      )
    },

    updateNews: async (
      _parent: unknown,
      args: { id: string; input: UpdateNewsInputGql },
      context: BackendGraphQLContext,
    ): Promise<NewsGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return updateNews(
        context.db,
        context.env,
        identity.userId,
        args.id,
        args.input,
        context.request,
      )
    },

    publishNews: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<NewsGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return publishNews(
        context.db,
        context.env,
        identity.userId,
        args.id,
        context.request,
      )
    },

    unpublishNews: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<NewsGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return unpublishNews(
        context.db,
        context.env,
        identity.userId,
        args.id,
        context.request,
      )
    },

    deleteNews: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return deleteNews(context.db, args.id)
    },

    // --- Media Administrative Mutations (Require ADMIN) ---

    createContentMediaUpload: async (
      _parent: unknown,
      args: { input: CreateContentMediaUploadInputGql },
      context: BackendGraphQLContext,
    ): Promise<ContentMediaUploadPayloadGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return createContentMediaUpload(
        context.db,
        context.env,
        identity.userId,
        args.input,
        context.request,
      )
    },

    completeContentMediaUpload: async (
      _parent: unknown,
      args: { input: CompleteContentMediaUploadInputGql },
      context: BackendGraphQLContext,
    ): Promise<ContentMediaGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return completeContentMediaUpload(
        context.db,
        context.env,
        identity.userId,
        args.input,
        context.request,
      )
    },

    deleteContentMedia: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return deleteMedia(context.db, context.env, args.id)
    },

    // --- Skins Administrative Mutations (Require ADMIN - Shard 06.5) ---

    createSkin: async (
      _parent: unknown,
      args: { input: CreateSkinInputGql },
      context: BackendGraphQLContext,
    ): Promise<SkinGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createSkin(context.db, context.env, args.input, identity.userId)
    },

    updateSkin: async (
      _parent: unknown,
      args: { id: string; input: UpdateSkinInputGql },
      context: BackendGraphQLContext,
    ): Promise<SkinGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateSkin(context.db, context.env, args.id, args.input)
    },

    deleteSkin: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteSkin(context.db, args.id, context.env)
    },

    // --- Player Custom Skins Mutations (Shard 06.6) ---

    createPlayerSkinUpload: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ContentMediaUploadPayloadGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createPlayerSkinUpload(
        context.db,
        context.env,
        identity.userId,
        context.request,
      )
    },

    setMyPlayerSkin: async (
      _parent: unknown,
      args: { input: SetPlayerSkinInputGql },
      context: BackendGraphQLContext,
    ): Promise<PlayerSkinGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return setMyPlayerSkin(context.db, context.env, args.input, identity.userId)
    },

    deleteMyPlayerSkin: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteMyPlayerSkin(context.db, context.env, identity.userId)
    },

    setMyActiveSkin: async (
      _parent: unknown,
      args: { input: SetActiveSkinInputGql },
      context: BackendGraphQLContext,
    ): Promise<ActiveSkinSelectionGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return setMyActiveSkin(context.db, context.env, identity.userId, args.input)
    },

    updateAdminPlayerSkin: async (
      _parent: unknown,
      args: { id: string; input: UpdateAdminPlayerSkinInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminPlayerSkinGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateAdminPlayerSkin(context.db, context.env, args.id, args.input)
    },


    deleteAdminPlayerSkin: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteAdminPlayerSkin(context.db, context.env, args.id)
    },

    // --- Capes Administrative & Player Mutations (Shard 07 Hardening) ---

    createCape: async (
      _parent: unknown,
      args: { input: CreateCapeInputGql },
      context: BackendGraphQLContext,
    ): Promise<CapeGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createCape(context.db, context.env, args.input, identity.userId)
    },

    updateCape: async (
      _parent: unknown,
      args: { id: string; input: UpdateCapeInputGql },
      context: BackendGraphQLContext,
    ): Promise<CapeGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateCape(context.db, context.env, args.id, args.input)
    },

    deleteCape: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteCape(context.db, args.id, context.env)
    },

    createPlayerCapeUpload: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ContentMediaUploadPayloadGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createPlayerCapeUpload(
        context.db,
        context.env,
        identity.userId,
        context.request,
      )
    },

    addMyPlayerCape: async (
      _parent: unknown,
      args: { input: AddPlayerCapeInputGql },
      context: BackendGraphQLContext,
    ): Promise<PlayerCapeGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return addMyPlayerCape(context.db, context.env, args.input, identity.userId)
    },

    deleteMyPlayerCape: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteMyPlayerCape(context.db, context.env, args.id, identity.userId)
    },

    setMyActiveCape: async (
      _parent: unknown,
      args: { input: SetActiveCapeInputGql },
      context: BackendGraphQLContext,
    ): Promise<ActiveCapeSelectionGql> => {
      const identity = requireAuth(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return setMyActiveCape(context.db, context.env, identity.userId, args.input)
    },

    updateAdminPlayerCape: async (
      _parent: unknown,
      args: { id: string; input: UpdateAdminPlayerCapeInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminPlayerCapeGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateAdminPlayerCape(context.db, context.env, args.id, args.input)
    },

    deleteAdminPlayerCape: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteAdminPlayerCape(context.db, context.env, args.id)
    },



    // --- Game Administrative Mutations (Require ADMIN - Shard 06.5) ---

    prepareGameDraft: async (
      _parent: unknown,
      args: { serverId?: string | null; input?: PrepareGameDraftInputGql | null },
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return prepareGameDraft(context.db, identity.userId, args.input, context.env, context.request, args.serverId)
    },

    discardGameDraft: async (
      _parent: unknown,
      args: { serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return discardGameDraft(context.db, context.env, args.serverId)
    },

    createGameFileUpload: async (
      _parent: unknown,
      args: { serverId?: string | null; input: CreateGameFileUploadInputGql },
      context: BackendGraphQLContext,
    ): Promise<GameFileUploadPayloadGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createGameFileUploadToken(context.db, args.input, identity.userId, context.env, args.serverId)
    },

    completeGameFileUpload: async (
      _parent: unknown,
      args: { input: CompleteGameFileUploadInputGql },
      context: BackendGraphQLContext,
    ): Promise<GameFileUploadCompletePayloadGql> => {
      requireAdmin(context)
      if (!context.db || !context.env.ASSETS) {
        throw createGraphQLError("Database or storage unavailable", "INTERNAL_ERROR")
      }
      return completeGameFileUploadToken(context.db, args.input, context.env)
    },

    addGameFile: async (
      _parent: unknown,
      args: { serverId?: string | null; input: AddGameFileInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return addGameFile(context.db, args.input, identity.userId, context.env, undefined, args.serverId)
    },

    updateGameFile: async (
      _parent: unknown,
      args: { id: string; input: UpdateGameFileInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateGameFile(context.db, args.id, args.input, context.env)
    },

    saveGameFileContent: async (
      _parent: unknown,
      args: { serverId?: string | null; input: SaveGameFileContentInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return saveGameFileContent(context.db, args.input, identity.userId, context.env, args.serverId)
    },

    createGameFolder: async (
      _parent: unknown,
      args: { serverId?: string | null; logicalPath: string },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createGameFolder(context.db, args.logicalPath, identity.userId, args.serverId)
    },

    renameGamePath: async (
      _parent: unknown,
      args: { serverId?: string | null; oldPath: string; newPath: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return renameGamePath(context.db, args.oldPath, args.newPath, identity.userId, args.serverId)
    },

    moveGamePaths: async (
      _parent: unknown,
      args: { serverId?: string | null; sources: string[]; destinationFolder: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return moveGamePaths(context.db, args.sources, args.destinationFolder, identity.userId, args.serverId)
    },

    copyGamePaths: async (
      _parent: unknown,
      args: { serverId?: string | null; sources: string[]; destinationFolder: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return copyGamePaths(context.db, args.sources, args.destinationFolder, identity.userId, context.env, args.serverId)
    },

    deleteGamePaths: async (
      _parent: unknown,
      args: { serverId?: string | null; paths: string[] },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return deleteGamePaths(context.db, args.paths, identity.userId, context.env, args.serverId)
    },

    setGamePathPolicy: async (
      _parent: unknown,
      args: { serverId?: string | null; path: string; explicitPolicy?: SyncPolicyGql | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return setGamePathPolicy(context.db, args.path, args.explicitPolicy, identity.userId, args.serverId)
    },

    removeGameFile: async (
      _parent: unknown,
      args: { id: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return removeGameFile(context.db, args.id, context.env)
    },

    restoreGameFile: async (
      _parent: unknown,
      args: { id: string; serverId?: string | null },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return restoreGameFile(context.db, args.id, identity.userId, args.serverId)
    },

    updateGameDraftMetadata: async (
      _parent: unknown,
      args: { serverId?: string | null; input: UpdateGameDraftMetadataInputGql },
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateGameDraftMetadata(context.db, context.env, args.input, identity.userId, context.request, args.serverId)
    },

    publishGameRelease: async (
      _parent: unknown,
      args: { serverId?: string | null; input: PublishGameReleaseInputGql },
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return publishGameRelease(context.db, context.env, args.input, identity.userId, context.request, args.serverId)
    },

    installModPlan: async (
      _parent: unknown,
      args: { serverId?: string | null; input: InstallModPlanInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql[]> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return installModPlan(context.db, context.env, args.input, identity.userId, args.serverId)
    },

    // --- Settings Administrative Mutations (Require ADMIN - Shard 06.5) ---


    updateAdminSettings: async (
      _parent: unknown,
      args: { input: UpdateAdminSettingsInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminSettingsGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return updateAdminSettings(context.db, args.input, identity.userId)
    },
  },
}

