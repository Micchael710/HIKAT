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
    expect(typeDefs).toContain("type AdminStatus")
    expect(typeDefs).toContain("type News")
    expect(typeDefs).toContain("type ContentMedia")
    expect(typeDefs).toContain("type Query")
    expect(typeDefs).toContain("type Mutation")
  })

  it("builds a valid GraphQLSchema object with News queries and mutations", () => {
    const schema = getBaseSchema()
    expect(schema).toBeInstanceOf(GraphQLSchema)

    const queryType = schema.getQueryType()
    expect(queryType).toBeDefined()
    expect(queryType?.getFields()["health"]).toBeDefined()
    expect(queryType?.getFields()["version"]).toBeDefined()
    expect(queryType?.getFields()["me"]).toBeDefined()
    expect(queryType?.getFields()["adminStatus"]).toBeDefined()
    expect(queryType?.getFields()["newsFeed"]).toBeDefined()
    expect(queryType?.getFields()["news"]).toBeDefined()
    expect(queryType?.getFields()["adminNews"]).toBeDefined()
    expect(queryType?.getFields()["adminNewsItem"]).toBeDefined()

    const mutationType = schema.getMutationType()
    expect(mutationType).toBeDefined()
    expect(mutationType?.getFields()["createNews"]).toBeDefined()
    expect(mutationType?.getFields()["updateNews"]).toBeDefined()
    expect(mutationType?.getFields()["publishNews"]).toBeDefined()
    expect(mutationType?.getFields()["unpublishNews"]).toBeDefined()
    expect(mutationType?.getFields()["deleteNews"]).toBeDefined()
    expect(mutationType?.getFields()["createContentMediaUpload"]).toBeDefined()
    expect(mutationType?.getFields()["deleteContentMedia"]).toBeDefined()
  })

  it("defines NewsType, NewsStatus and MediaType enums", () => {
    const schema = getBaseSchema()
    const typeEnum = schema.getType("NewsType") as GraphQLEnumType
    expect(typeEnum).toBeDefined()
    expect(typeEnum.getValues().map((v) => v.name)).toEqual([
      "NEWS",
      "UPDATE",
      "ANNOUNCEMENT",
      "MAINTENANCE",
    ])

    const statusEnum = schema.getType("NewsStatus") as GraphQLEnumType
    expect(statusEnum).toBeDefined()
    expect(statusEnum.getValues().map((v) => v.name)).toEqual([
      "DRAFT",
      "PUBLISHED",
    ])

    const mediaTypeEnum = schema.getType("MediaType") as GraphQLEnumType
    expect(mediaTypeEnum).toBeDefined()
    expect(mediaTypeEnum.getValues().map((v) => v.name)).toEqual([
      "IMAGE",
      "VIDEO",
    ])
  })

  it("defines News contract with clean fields and without legacy slug/summary/bodyMarkdown", () => {
    const schema = getBaseSchema()
    const newsType = schema.getType("News") as GraphQLObjectType
    expect(newsType).toBeDefined()

    const fields = Object.keys(newsType.getFields())
    expect(fields).toContain("id")
    expect(fields).toContain("title")
    expect(fields).toContain("content")
    expect(fields).toContain("type")
    expect(fields).toContain("image")
    expect(fields).toContain("youtubeVideoId")
    expect(fields).toContain("youtubeUrl")
    expect(fields).toContain("video")
    expect(fields).toContain("status")
    expect(fields).toContain("publishedAt")
    expect(fields).toContain("createdAt")
    expect(fields).toContain("updatedAt")

    expect(fields).not.toContain("slug")
    expect(fields).not.toContain("summary")
    expect(fields).not.toContain("bodyMarkdown")
  })

  it("defines ContentMedia contract without exposing internal objectKey", () => {
    const schema = getBaseSchema()
    const mediaType = schema.getType("ContentMedia") as GraphQLObjectType
    expect(mediaType).toBeDefined()

    const fields = Object.keys(mediaType.getFields())
    expect(fields).toContain("id")
    expect(fields).toContain("mediaType")
    expect(fields).toContain("mimeType")
    expect(fields).toContain("sizeBytes")
    expect(fields).toContain("url")
    expect(fields).toContain("createdAt")

    // Security: objectKey is internal to Backend/R2 and NOT exposed to GraphQL
    expect(fields).not.toContain("objectKey")
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

  it("validates DateTime scalar serialization and parsing", () => {
    const now = new Date()
    const nowIso = now.toISOString()

    expect(DateTimeScalar.serialize(now)).toBe(nowIso)
    expect(DateTimeScalar.serialize(nowIso)).toBe(nowIso)
    expect(() => DateTimeScalar.serialize("not-a-date")).toThrow()
    expect(() => DateTimeScalar.serialize(12345)).toThrow()

    expect(DateTimeScalar.parseValue(nowIso)).toBe(nowIso)
    expect(() => DateTimeScalar.parseValue("invalid")).toThrow()

    const astNode = { kind: Kind.STRING, value: nowIso } as const
    expect(DateTimeScalar.parseLiteral(astNode)).toBe(nowIso)

    const invalidAstNode = { kind: Kind.INT, value: "123" } as const
    expect(() => DateTimeScalar.parseLiteral(invalidAstNode as any)).toThrow()
  })

  it("creates structured GraphQLError instances with correct extensions", () => {
    const err = createGraphQLError("Resource not found", "NOT_FOUND", {
      entity: "User",
      entityId: "123",
    })

    expect(err.message).toBe("Resource not found")
    expect(err.extensions.code).toBe("NOT_FOUND")
    expect(err.extensions.entity).toBe("User")
    expect(err.extensions.entityId).toBe("123")
  })
})
