/**
 * HiKAT Backend GraphQL Resolvers
 * Implements business operations, health queries, user profile fetching,
 * admin status, and Content Core public & admin operations.
 */

import {
  DateTimeScalar,
  createGraphQLError,
  UserGql,
  AdminStatusGql,
  HealthStatusGql,
  ContentPostGql,
  ContentFeedConnectionGql,
  ContentMediaUploadPayloadGql,
  CreateContentPostInputGql,
  UpdateContentPostInputGql,
  CreateContentMediaUploadInputGql,
} from "@hikat/graphql"
import {
  HIKAT_VERSION,
  ContentPostKind,
  ContentPostStatus,
} from "@hikat/shared"
import type { BackendGraphQLContext } from "../types"
import { requireAuth, requireAdmin } from "../auth/guards"
import { getUserById } from "../services/userService"
import {
  getContentFeed,
  getContentPostBySlug,
  getAdminContentPosts,
  getAdminContentPost,
  createContentPost,
  updateContentPost,
  publishContentPost,
  unpublishContentPost,
  deleteContentPost,
} from "../services/contentService"
import {
  createContentMediaUpload,
  deleteContentMedia,
} from "../services/mediaService"

export const resolvers = {
  DateTime: DateTimeScalar,
  Query: {
    health: (): HealthStatusGql => ({
      status: "ok",
      service: "hikat-backend",
      version: HIKAT_VERSION,
      timestamp: new Date().toISOString(),
    }),

    version: (): string => HIKAT_VERSION,

    me: async (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): Promise<UserGql> => {
      const identity = requireAuth(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      const user = await getUserById(context.db, identity.userId)
      if (!user) {
        throw createGraphQLError("User profile not found", "NOT_FOUND")
      }

      return user
    },

    adminStatus: (
      _parent: unknown,
      _args: unknown,
      context: BackendGraphQLContext,
    ): AdminStatusGql => {
      requireAdmin(context)

      return {
        ok: true,
        serverTime: new Date().toISOString(),
        environment: context.env.ENVIRONMENT || "development",
      }
    },

    // --- Content Core Public Queries ---

    contentFeed: async (
      _parent: unknown,
      args: {
        first?: number
        after?: string
        kind?: ContentPostKind
      },
      context: BackendGraphQLContext,
    ): Promise<ContentFeedConnectionGql> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getContentFeed(context.db, context.env, args, context.request)
    },

    contentPost: async (
      _parent: unknown,
      args: { slug: string },
      context: BackendGraphQLContext,
    ): Promise<ContentPostGql | null> => {
      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      if (!args.slug || args.slug.trim() === "") {
        throw createGraphQLError("Slug parameter is required", "VALIDATION_ERROR")
      }

      return getContentPostBySlug(
        context.db,
        context.env,
        args.slug,
        context.request,
      )
    },

    // --- Content Core Administrative Queries ---

    adminContentPosts: async (
      _parent: unknown,
      args: {
        first?: number
        after?: string
        kind?: ContentPostKind
        status?: ContentPostStatus
      },
      context: BackendGraphQLContext,
    ): Promise<ContentFeedConnectionGql> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getAdminContentPosts(context.db, context.env, args, context.request)
    },

    adminContentPost: async (
      _parent: unknown,
      args: { id?: string; slug?: string },
      context: BackendGraphQLContext,
    ): Promise<ContentPostGql | null> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return getAdminContentPost(context.db, context.env, args, context.request)
    },
  },

  Mutation: {
    // --- Content Core Administrative Mutations ---

    createContentPost: async (
      _parent: unknown,
      args: { input: CreateContentPostInputGql },
      context: BackendGraphQLContext,
    ): Promise<ContentPostGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return createContentPost(
        context.db,
        context.env,
        identity.userId,
        args.input,
        context.request,
      )
    },

    updateContentPost: async (
      _parent: unknown,
      args: { id: string; input: UpdateContentPostInputGql },
      context: BackendGraphQLContext,
    ): Promise<ContentPostGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return updateContentPost(
        context.db,
        context.env,
        identity.userId,
        args.id,
        args.input,
        context.request,
      )
    },

    publishContentPost: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<ContentPostGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return publishContentPost(
        context.db,
        context.env,
        identity.userId,
        args.id,
        context.request,
      )
    },

    unpublishContentPost: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<ContentPostGql> => {
      const identity = requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return unpublishContentPost(
        context.db,
        context.env,
        identity.userId,
        args.id,
        context.request,
      )
    },

    deleteContentPost: async (
      _parent: unknown,
      args: { id: string },
      context: BackendGraphQLContext,
    ): Promise<boolean> => {
      requireAdmin(context)

      if (!context.db) {
        throw createGraphQLError("Database unavailable", "INTERNAL_ERROR")
      }

      return deleteContentPost(context.db, args.id)
    },

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

      return deleteContentMedia(context.db, context.env, args.id)
    },
  },
}
