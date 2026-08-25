import { GraphQLScalarType, Kind, GraphQLError } from "graphql"

function validateAndFormatDate(value: unknown): string {
  if (
    typeof value === "string" ||
    value instanceof Date ||
    typeof value === "number"
  ) {
    const date = new Date(value)
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
  }
  throw new GraphQLError(
    `Invalid DateTime scalar value: ${String(value)}. Expected ISO-8601 format.`,
  )
}

export const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description:
    "An ISO-8601 encoded UTC date-time string (e.g. 2026-08-25T16:00:00.000Z)",
  serialize(value: unknown): string {
    return validateAndFormatDate(value)
  },
  parseValue(value: unknown): string {
    return validateAndFormatDate(value)
  },
  parseLiteral(ast): string {
    if (ast.kind === Kind.STRING) {
      return validateAndFormatDate(ast.value)
    }
    throw new GraphQLError(
      `DateTime scalar can only parse strings, but got kind: ${ast.kind}`,
    )
  },
})
