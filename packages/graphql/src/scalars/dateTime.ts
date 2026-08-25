import { GraphQLScalarType, Kind, GraphQLError } from "graphql"

// Matches ISO-8601 extended format (e.g. 2026-08-25T16:00:00.000Z, 2026-08-25T16:00:00+02:00, 2026-08-25T16:00:00Z)
const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i

function parseIsoString(value: string): string {
  if (!ISO_8601_REGEX.test(value)) {
    throw new GraphQLError(
      `Invalid DateTime string: "${value}". Expected ISO-8601 format (e.g. 2026-08-25T16:00:00.000Z).`,
    )
  }
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    throw new GraphQLError(`Invalid DateTime value: "${value}". Date does not exist.`)
  }
  return date.toISOString()
}

export const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description:
    "An ISO-8601 encoded UTC date-time string (e.g. 2026-08-25T16:00:00.000Z)",
  serialize(value: unknown): string {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new GraphQLError("Cannot serialize invalid Date object as DateTime.")
      }
      return value.toISOString()
    }
    if (typeof value === "string") {
      return parseIsoString(value)
    }
    throw new GraphQLError(
      `DateTime scalar serialization expected Date object or ISO-8601 string, but received: ${typeof value}`,
    )
  },
  parseValue(value: unknown): string {
    if (typeof value !== "string") {
      throw new GraphQLError(
        `DateTime scalar input must be an ISO-8601 formatted string, but received: ${typeof value}`,
      )
    }
    return parseIsoString(value)
  },
  parseLiteral(ast): string {
    if (ast.kind !== Kind.STRING) {
      throw new GraphQLError(
        `DateTime scalar can only parse String literal nodes, but received AST kind: ${ast.kind}`,
      )
    }
    return parseIsoString(ast.value)
  },
})
