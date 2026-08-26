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
} from "@hikat/graphql"
import {
  HIKAT_VERSION,
  NewsType,
  NewsStatus,
  type ServerPowerAction,
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
} from "../services/pterodactyl/serverAdministrationService"
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

    // --- Server Administration Queries (Require ADMIN - Shard 06) ---

    serverStatus: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerResourcesGql> => {
      requireAdmin(context)
      return getServerStatus(context.env)
    },
  },

  Mutation: {
    // --- Server Administration Mutations (Require ADMIN - Shard 06) ---

    serverPowerAction: async (
      _parent: unknown,
      args: { action: ServerPowerAction },
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      requireAdmin(context)
      return executeServerPowerAction(context.env, args.action)
    },

    startServer: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      requireAdmin(context)
      return executeServerPowerAction(context.env, "START")
    },

    restartServer: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      requireAdmin(context)
      return executeServerPowerAction(context.env, "RESTART")
    },

    stopServer: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<ServerPowerActionResultGql> => {
      requireAdmin(context)
      return executeServerPowerAction(context.env, "STOP")
    },

    sendServerCommand: async (
      _parent: unknown,
      args: { command: string },
      context: BackendGraphQLContext,
    ): Promise<ServerCommandResultGql> => {
      requireAdmin(context)
      return executeServerCommand(context.env, args.command)
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
  },
}
