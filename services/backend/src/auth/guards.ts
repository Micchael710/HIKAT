/**
 * HiKAT Authorization Guards
 * Lightweight, robust server-side guards for GraphQL resolvers.
 */

import { createGraphQLError } from "@hikat/graphql"
import type { BackendGraphQLContext, AuthenticatedIdentity } from "../types"

/**
 * Ensures that the request contains a valid, authenticated identity with an active session.
 * Throws a GraphQL UNAUTHENTICATED error if anonymous, invalid, or expired.
 */
export function requireAuth(context: BackendGraphQLContext): AuthenticatedIdentity {
  if (context.auth.status === "authenticated") {
    return context.auth.identity
  }

  if (context.auth.status === "invalid") {
    throw createGraphQLError(
      context.auth.reason || "Invalid authentication token",
      "UNAUTHENTICATED",
    )
  }

  throw createGraphQLError(
    "Authentication required to access this resource",
    "UNAUTHENTICATED",
  )
}

/**
 * Ensures that the request is authenticated and that the caller possesses the ADMIN role.
 * Throws FORBIDDEN if the caller has the PLAYER role.
 */
export function requireAdmin(context: BackendGraphQLContext): AuthenticatedIdentity {
  const identity = requireAuth(context)

  if (identity.role !== "ADMIN") {
    throw createGraphQLError(
      "Forbidden: administrative privilege required",
      "FORBIDDEN",
    )
  }

  return identity
}
