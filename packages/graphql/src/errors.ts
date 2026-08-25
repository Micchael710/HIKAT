import { GraphQLError } from "graphql"

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const

export type ErrorCode = typeof ERROR_CODES[number]

export interface ErrorExtensions extends Record<string, unknown> {
  code: ErrorCode
}

export function createGraphQLError(
  message: string,
  code: ErrorCode,
  extensions?: Record<string, unknown>,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code,
      ...extensions,
    },
  })
}
