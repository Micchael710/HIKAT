import { buildSchema, GraphQLSchema } from "graphql"

import { typeDefs } from "./schema"

export * from "./schema"
export * from "./scalars/dateTime"
export * from "./errors"
export * from "./types"

/**
 * Creates and returns the parsed GraphQLSchema for base foundation
 */
export function getBaseSchema(): GraphQLSchema {
  return buildSchema(typeDefs)
}
