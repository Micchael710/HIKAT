import { buildSchema, GraphQLSchema } from "graphql";
import { typeDefs } from "./schema";

export * from "./schema";

/**
 * Creates and returns the parsed GraphQLSchema for base foundation
 */
export function getBaseSchema(): GraphQLSchema {
  return buildSchema(typeDefs);
}
