import { describe, it, expect } from "vitest"
import {
  GraphQLSchema,
  GraphQLEnumType,
  GraphQLObjectType,
  Kind,
} from "graphql"

import {
  typeDefs,
  getBaseSchema,
  DateTimeScalar,
  createGraphQLError,
  ERROR_CODES,
} from "./index"

describe("@hikat/graphql foundation & contracts", () => {
  it("exports valid GraphQL typeDefs string with modular components", () => {
    expect(typeDefs).toContain("scalar DateTime")
    expect(typeDefs).toContain("enum Role")
    expect(typeDefs).toContain("type User")
    expect(typeDefs).toContain("type HealthStatus")
    expect(typeDefs).toContain("type Query")
  })

  it("builds a valid GraphQLSchema object", () => {
    const schema = getBaseSchema()
    expect(schema).toBeInstanceOf(GraphQLSchema)

    const queryType = schema.getQueryType()
    expect(queryType).toBeDefined()
    expect(queryType?.getFields()["health"]).toBeDefined()
    expect(queryType?.getFields()["version"]).toBeDefined()
  })

  it("defines Role enum with strictly PLAYER and ADMIN", () => {
    const schema = getBaseSchema()
    const roleType = schema.getType("Role") as GraphQLEnumType

    expect(roleType).toBeDefined()
    expect(roleType).toBeInstanceOf(GraphQLEnumType)

    const values = roleType.getValues().map((v) => v.name)
    expect(values).toEqual(["PLAYER", "ADMIN"])
    expect(values).not.toContain("MODERATOR")
    expect(values).not.toContain("OWNER")
    expect(values).not.toContain("STAFF")
    expect(values).not.toContain("SUPERADMIN")
  })

  it("defines User contract without exposing sensitive tokens or hashes", () => {
    const schema = getBaseSchema()
    const userType = schema.getType("User") as GraphQLObjectType

    expect(userType).toBeDefined()
    expect(userType).toBeInstanceOf(GraphQLObjectType)

    const fields = Object.keys(userType.getFields())
    expect(fields).toContain("id")
    expect(fields).toContain("role")
    expect(fields).toContain("displayName")
    expect(fields).toContain("createdAt")
    expect(fields).toContain("updatedAt")

    // Security assertions: ensure no sensitive internal fields exist
    expect(fields).not.toContain("refreshTokenHash")
    expect(fields).not.toContain("password")
    expect(fields).not.toContain("secret")
    expect(fields).not.toContain("token")
  })

  describe("DateTime scalar", () => {
    it("serializes valid Date and ISO strings correctly", () => {
      const now = new Date()
      expect(DateTimeScalar.serialize(now)).toBe(now.toISOString())
      expect(DateTimeScalar.serialize(now.toISOString())).toBe(
        now.toISOString(),
      )
    })

    it("throws on invalid serialization input", () => {
      expect(() => DateTimeScalar.serialize("invalid-date-string")).toThrow()
      expect(() => DateTimeScalar.serialize(null)).toThrow()
      expect(() => DateTimeScalar.serialize(123456789)).toThrow()
      expect(() => DateTimeScalar.serialize(new Date("invalid"))).toThrow()
    })

    it("parses valid ISO-8601 string value and literal", () => {
      const isoStr = "2026-08-25T16:00:00.000Z"
      expect(DateTimeScalar.parseValue(isoStr)).toBe(isoStr)
      expect(
        DateTimeScalar.parseLiteral({ kind: Kind.STRING, value: isoStr }, {}),
      ).toBe(isoStr)
    })

    it("rejects non-string and non-ISO format inputs in parseValue", () => {
      // Rejects numbers (unix timestamps not allowed as input)
      expect(() => DateTimeScalar.parseValue(1756137600000)).toThrow()
      // Rejects non-ISO string formats
      expect(() => DateTimeScalar.parseValue("2026/08/25")).toThrow()
      expect(() => DateTimeScalar.parseValue("August 25, 2026")).toThrow()
      expect(() => DateTimeScalar.parseValue("invalid-string")).toThrow()
      // Rejects booleans and objects
      expect(() => DateTimeScalar.parseValue(true)).toThrow()
      expect(() => DateTimeScalar.parseValue({})).toThrow()
      expect(() => DateTimeScalar.parseValue(null)).toThrow()
    })

    it("throws on non-string parse literal AST kinds", () => {
      expect(() =>
        DateTimeScalar.parseLiteral({ kind: Kind.INT, value: "12345" }, {}),
      ).toThrow()
      expect(() =>
        DateTimeScalar.parseLiteral({ kind: Kind.FLOAT, value: "123.45" }, {}),
      ).toThrow()
      expect(() =>
        DateTimeScalar.parseLiteral({ kind: Kind.BOOLEAN, value: true }, {}),
      ).toThrow()
    })
  })

  describe("GraphQL Error Handling", () => {
    it("defines standard error codes", () => {
      expect(ERROR_CODES).toEqual([
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "VALIDATION_ERROR",
        "CONFLICT",
        "INTERNAL_ERROR",
      ])
    })

    it("creates GraphQLError with structured code extension", () => {
      const error = createGraphQLError("User not found", "NOT_FOUND", {
        userId: "u-123",
      })
      expect(error.message).toBe("User not found")
      expect(error.extensions.code).toBe("NOT_FOUND")
      expect(error.extensions.userId).toBe("u-123")
    })
  })
})
