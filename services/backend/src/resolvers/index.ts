/**
 * HiKAT Backend GraphQL Resolvers
 * Implements business operations, health queries, user profile fetching, and admin status.
 */

import { DateTimeScalar, createGraphQLError, UserGql, AdminStatusGql, HealthStatusGql } from "@hikat/graphql"
import { HIKAT_VERSION } from "@hikat/shared"
import type { BackendGraphQLContext } from "../types"
import { requireAuth, requireAdmin } from "../auth/guards"
import { getUserById } from "../services/userService"

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
  },
}
