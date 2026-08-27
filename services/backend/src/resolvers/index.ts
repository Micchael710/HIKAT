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
  ContentMediaUploadPayloadGql,
  CreateContentMediaUploadInputGql,
  ServerResourcesGql,
  ServerPowerActionResultGql,
  ServerCommandResultGql,
  ServerConsoleTicketPayloadGql,
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
  AddGameFileInputGql,
  UpdateGameFileInputGql,
  PrepareGameDraftInputGql,
  PublishGameReleaseInputGql,
  AdminSettingsGql,
  ClientConfigurationGql,
  UpdateAdminSettingsInputGql,
  GameFileCategoryGql,
  PlayerSkinGql,
  AdminPlayerSkinGql,
  AdminPlayerSkinConnectionGql,
  SetPlayerSkinInputGql,
  UpdateAdminPlayerSkinInputGql,
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
import { createContentMediaUpload, deleteMedia } from "../services/mediaService"
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
  getAdminPlayerSkins,
  getAdminPlayerSkinById,
  updateAdminPlayerSkin,
  deleteAdminPlayerSkin,
} from "../services/skinService"

import {
  getPublishedModpack,
  getAdminGameOverview,
  prepareGameDraft,
  discardGameDraft,
  publishGameRelease,
  getGameReleaseHistory,
} from "../services/game/releaseService"
import {
  getAdminGameFiles,
  createGameFileUploadToken,
  addGameFile,
  updateGameFile,
  removeGameFile,
  restoreGameFile,
} from "../services/game"

import {
  getAdminSettings,
  getClientConfiguration,
  updateAdminSettings,
} from "../services/settingsService"

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

    // --- News Public Queries ---

    newsFeed: async (
      _parent: unknown,
      args: {
        first?: number | null
        after?: string | null
        type?: NewsType | null
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
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerResourcesGql> => {
      requireAdmin(context)
      return getServerStatus(context.env)
    },

    serverActivity: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerActivityItemGql[]> => {
      requireAdmin(context)
      return getServerActivity(context.env)
    },

    serverBackups: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerBackupItemGql[]> => {
      requireAdmin(context)
      return listServerBackups(context.env)
    },

    serverWorld: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerWorldInfoGql> => {
      requireAdmin(context)
      return getServerWorldInfo(context.env)
    },

    serverMinecraftSettings: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<MinecraftServerSettingsGql> => {
      requireAdmin(context)
      return getMinecraftServerSettings(context.env)
    },

    serverAutomations: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerAutomationItemGql[]> => {
      requireAdmin(context)
      return listServerAutomations(context.env)
    },

    serverFiles: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerFileItemGql[]> => {
      requireAdmin(context)
      return listServerFiles(context.env, args.root, args.relativePath)
    },

    serverTextFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string },
      context: BackendGraphQLContext,
    ): Promise<ServerFileContentGql> => {
      requireAdmin(context)
      return readServerTextFile(context.env, args.root, args.relativePath)
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


    // --- Game & Launcher Queries (Shard 06.5) ---

    publishedModpack: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<PublishedModpackGql | null> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getPublishedModpack(context.db, context.env)
    },

    adminGameOverview: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<AdminGameOverviewGql> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminGameOverview(context.db, context.env)
    },

    gameReleaseHistory: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql[]> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getGameReleaseHistory(context.db)
    },

    adminGameFiles: async (
      _parent: unknown,
      args: { releaseId?: string | null; category?: GameFileCategoryGql | null },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql[]> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return getAdminGameFiles(context.db, args.releaseId, args.category)
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
    // --- Server Administration Mutations (Require ADMIN - Shard 06 & 06A) ---

    createServerConsoleTicket: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerConsoleTicketPayloadGql> => {
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
      )
    },

    serverPowerAction: async (
      _parent: unknown,
      args: { action: ServerPowerAction },
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        args.action,
        identity.userId,
      )
    },

    startServer: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        "START",
        identity.userId,
      )
    },

    restartServer: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        "RESTART",
        identity.userId,
      )
    },

    stopServer: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      const identity = requireAdmin(context)
      return executeServerPowerAction(
        context.env,
        "STOP",
        identity.userId,
      )
    },

    sendServerCommand: async (
      _parent: unknown,
      args: { command: string },
      context: BackendGraphQLContext,
    ): Promise<ServerCommandResultGql> => {
      const identity = requireAdmin(context)
      return executeServerCommand(
        context.env,
        args.command,
        identity.userId,
      )
    },

    // --- Server Administration II Mutations (Require ADMIN - Shard 07) ---

    createServerBackup: async (
      _parent: unknown,
      args: { name?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerBackupItemGql> => {
      requireAdmin(context)
      return createServerBackup(context.env, args.name)
    },

    restoreServerBackup: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return restoreServerBackup(context.env, context.db, identity.userId, args.id)
    },

    deleteServerBackup: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return deleteServerBackup(context.env, args.id)
    },

    toggleServerBackupLock: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<ServerBackupItemGql> => {
      requireAdmin(context)
      return toggleServerBackupLock(context.env, args.id)
    },

    createServerBackupDownloadUrl: async (
      _parent: unknown,
      args: { id: string; name?: string | null },
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return getServerBackupDownloadUrl(context.env, args.id)
    },

    createServerWorldDownloadUrl: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return createServerWorldDownloadUrl(context.env)
    },

    prepareServerWorldUpload: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return prepareServerWorldUpload(context.env)
    },

    replaceServerWorld: async (
      _parent: unknown,
      args: { uploadedFileName: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return replaceServerWorld(context.env, context.db, identity.userId, args.uploadedFileName)
    },

    updateMinecraftServerSettings: async (
      _parent: unknown,
      args: { input: UpdateMinecraftServerSettingsInputGql },
      context: BackendGraphQLContext,
    ): Promise<MinecraftServerSettingsGql> => {
      requireAdmin(context)
      return updateMinecraftServerSettings(context.env, args.input as any)
    },

    createServerAutomation: async (
      _parent: unknown,
      args: { input: ServerAutomationInputGql },
      context: BackendGraphQLContext,
    ): Promise<ServerAutomationItemGql> => {
      requireAdmin(context)
      return createServerAutomation(context.env, args.input as any)
    },

    updateServerAutomation: async (
      _parent: unknown,
      args: { id: string; input: ServerAutomationInputGql },
      context: BackendGraphQLContext,
    ): Promise<ServerAutomationItemGql> => {
      requireAdmin(context)
      return updateServerAutomation(context.env, args.id, args.input as any)
    },

    runServerAutomation: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return runServerAutomation(context.env, args.id)
    },

    deleteServerAutomation: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return deleteServerAutomation(context.env, args.id)
    },

    createServerFolder: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; folderName: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return createServerFolder(context.env, args.root, args.relativePath, args.folderName)
    },

    renameServerFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; newName: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return renameServerFile(context.env, args.root, args.relativePath, args.newName)
    },

    deleteServerFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return deleteServerFile(context.env, args.root, args.relativePath)
    },

    writeServerTextFile: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string; content: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      return writeServerTextFile(context.env, args.root, args.relativePath, args.content)
    },

    prepareServerFileUpload: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string },
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return prepareServerFileUploadUrl(context.env, args.root, args.relativePath)
    },

    createServerFileDownloadUrl: async (
      _parent: unknown,
      args: { root: ServerFileRoot; relativePath: string },
      context: BackendGraphQLContext,
    ): Promise<ServerSignedUrlPayloadGql> => {
      requireAdmin(context)
      return createServerFileDownloadUrl(context.env, args.root, args.relativePath)
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
      return createSkin(context.db, args.input, identity.userId)
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
      return updateSkin(context.db, args.id, args.input)
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



    // --- Game Administrative Mutations (Require ADMIN - Shard 06.5) ---

    prepareGameDraft: async (
      _parent: unknown,
      args: { input?: PrepareGameDraftInputGql | null },
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return prepareGameDraft(context.db, identity.userId, args.input)
    },

    discardGameDraft: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return discardGameDraft(context.db)
    },

    createGameFileUpload: async (
      _parent: unknown,
      args: { input: CreateGameFileUploadInputGql },
      context: BackendGraphQLContext,
    ): Promise<GameFileUploadPayloadGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return createGameFileUploadToken(context.db, args.input, identity.userId)
    },

    addGameFile: async (
      _parent: unknown,
      args: { input: AddGameFileInputGql },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return addGameFile(context.db, args.input, identity.userId, context.env)
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
      return updateGameFile(context.db, args.id, args.input)
    },

    removeGameFile: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return removeGameFile(context.db, args.id)
    },

    restoreGameFile: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<AdminGameFileGql> => {
      const identity = requireAdmin(context)
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return restoreGameFile(context.db, args.id, identity.userId)
    },

    publishGameRelease: async (
      _parent: unknown,
      args: { input: PublishGameReleaseInputGql },
      context: BackendGraphQLContext,
    ): Promise<GameReleaseGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }
      return publishGameRelease(context.db, context.env, args.input, identity.userId)
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

