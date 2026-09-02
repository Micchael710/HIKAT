import { describe, it, expect } from "vitest"

import {
  GraphQLSchema,
  GraphQLEnumType,
  GraphQLObjectType,
  Kind,
  parse,
  validate,
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

  it("builds a valid GraphQLSchema with Server Administration queries and mutations (Shard 06)", () => {
    const schema = getBaseSchema()

    const queryType = schema.getQueryType()

    expect(queryType?.getFields()["serverStatus"]).toBeDefined()

    const mutationType = schema.getMutationType()

    expect(mutationType?.getFields()["createServerConsoleTicket"]).toBeDefined()

    expect(mutationType?.getFields()["serverPowerAction"]).toBeDefined()

    expect(mutationType?.getFields()["startServer"]).toBeDefined()

    expect(mutationType?.getFields()["restartServer"]).toBeDefined()

    expect(mutationType?.getFields()["stopServer"]).toBeDefined()

    expect(mutationType?.getFields()["sendServerCommand"]).toBeDefined()

    const consoleTicketPayload = schema.getType(
      "ServerConsoleTicketPayload",
    ) as GraphQLObjectType

    expect(consoleTicketPayload).toBeDefined()

    const ticketFields = Object.keys(consoleTicketPayload.getFields())

    expect(ticketFields).toContain("ticket")

    expect(ticketFields).toContain("expiresAt")

    expect(ticketFields).not.toContain("token")

    expect(ticketFields).not.toContain("socket")

    expect(ticketFields).not.toContain("wsUrl")

    const serverStatusEnum = schema.getType("ServerStatus") as GraphQLEnumType

    expect(serverStatusEnum).toBeDefined()

    expect(serverStatusEnum.getValues().map((v) => v.name)).toEqual([
      "ONLINE",

      "STARTING",

      "STOPPING",

      "OFFLINE",

      "DISCONNECTED",

      "UNKNOWN",
    ])

    const serverPowerActionEnum = schema.getType(
      "ServerPowerAction",
    ) as GraphQLEnumType

    expect(serverPowerActionEnum).toBeDefined()

    expect(serverPowerActionEnum.getValues().map((v) => v.name)).toEqual([
      "START",

      "RESTART",

      "STOP",
    ])

    const serverResourcesType = schema.getType(
      "ServerResources",
    ) as GraphQLObjectType

    expect(serverResourcesType).toBeDefined()

    const resourceFields = Object.keys(serverResourcesType.getFields())

    expect(resourceFields).toContain("status")

    expect(resourceFields).toContain("cpuPercent")

    expect(resourceFields).toContain("cpuLimitPercent")

    expect(resourceFields).toContain("memoryUsedBytes")

    expect(resourceFields).toContain("memoryLimitBytes")

    expect(resourceFields).toContain("diskUsedBytes")

    expect(resourceFields).toContain("diskLimitBytes")

    expect(resourceFields).toContain("uptimeMs")

    expect(resourceFields).toContain("isSuspended")

    // Security check: internal Pterodactyl details are not exposed

    expect(resourceFields).not.toContain("node")

    expect(resourceFields).not.toContain("allocation")

    expect(resourceFields).not.toContain("dockerImage")

    expect(resourceFields).not.toContain("containerId")
  })

  it("builds a valid GraphQLSchema with Dashboard, Skins, Game, and Settings contracts (Shard 06.5)", () => {
    const schema = getBaseSchema()

    const queryType = schema.getQueryType()

    const mutationType = schema.getMutationType()

    // 1. Dashboard

    expect(queryType?.getFields()["adminDashboard"]).toBeDefined()

    // 2. Skins & Player Skins (Shard 06.5 / 06.6 / 07 Hardening)

    expect(queryType?.getFields()["skins"]).toBeDefined()
    expect(queryType?.getFields()["adminSkins"]).toBeDefined()
    expect(queryType?.getFields()["adminSkin"]).toBeDefined()
    expect(queryType?.getFields()["myPlayerSkin"]).toBeDefined()
    expect(queryType?.getFields()["adminPlayerSkins"]).toBeDefined()
    expect(queryType?.getFields()["adminPlayerSkin"]).toBeDefined()

    // Capes queries (Shard 07 Hardening)
    expect(queryType?.getFields()["capes"]).toBeDefined()
    expect(queryType?.getFields()["adminCapes"]).toBeDefined()
    expect(queryType?.getFields()["adminCape"]).toBeDefined()
    expect(queryType?.getFields()["myPlayerCapes"]).toBeDefined()
    expect(queryType?.getFields()["myActiveCape"]).toBeDefined()
    expect(queryType?.getFields()["adminPlayerCapes"]).toBeDefined()
    expect(queryType?.getFields()["adminPlayerCape"]).toBeDefined()

    expect(mutationType?.getFields()["createSkin"]).toBeDefined()
    expect(mutationType?.getFields()["updateSkin"]).toBeDefined()
    expect(mutationType?.getFields()["deleteSkin"]).toBeDefined()
    expect(mutationType?.getFields()["createPlayerSkinUpload"]).toBeDefined()
    expect(mutationType?.getFields()["setMyPlayerSkin"]).toBeDefined()
    expect(mutationType?.getFields()["deleteMyPlayerSkin"]).toBeDefined()
    expect(mutationType?.getFields()["updateAdminPlayerSkin"]).toBeDefined()
    expect(mutationType?.getFields()["deleteAdminPlayerSkin"]).toBeDefined()

    // Capes mutations (Shard 07 Hardening)
    expect(mutationType?.getFields()["createCape"]).toBeDefined()
    expect(mutationType?.getFields()["updateCape"]).toBeDefined()
    expect(mutationType?.getFields()["deleteCape"]).toBeDefined()
    expect(mutationType?.getFields()["createPlayerCapeUpload"]).toBeDefined()
    expect(mutationType?.getFields()["addMyPlayerCape"]).toBeDefined()
    expect(mutationType?.getFields()["deleteMyPlayerCape"]).toBeDefined()
    expect(mutationType?.getFields()["setMyActiveCape"]).toBeDefined()
    expect(mutationType?.getFields()["updateAdminPlayerCape"]).toBeDefined()
    expect(mutationType?.getFields()["deleteAdminPlayerCape"]).toBeDefined()

    // Check PlayerSkin and AdminPlayerSkin contracts (No model)
    const playerSkinType = schema.getType("PlayerSkin") as GraphQLObjectType
    expect(playerSkinType).toBeDefined()
    const playerSkinFields = Object.keys(playerSkinType.getFields())
    expect(playerSkinFields).toEqual([
      "id",
      "userId",
      "imageUrl",
      "createdAt",
      "updatedAt",
    ])

    const adminPlayerSkinType = schema.getType(
      "AdminPlayerSkin",
    ) as GraphQLObjectType
    expect(adminPlayerSkinType).toBeDefined()
    const adminPlayerSkinFields = Object.keys(adminPlayerSkinType.getFields())
    expect(adminPlayerSkinFields).toEqual([
      "id",
      "userId",
      "userDisplayName",
      "imageUrl",
      "createdAt",
      "updatedAt",
    ])

    // Verify SkinModel is not in schema
    expect(schema.getType("SkinModel")).toBeUndefined()

    // 3. Game & Launcher Manifest
    expect(queryType?.getFields()["publishedModpack"]).toBeDefined()
    expect(queryType?.getFields()["adminGameOverview"]).toBeDefined()
    expect(queryType?.getFields()["gameReleaseHistory"]).toBeDefined()
    expect(queryType?.getFields()["adminGameFiles"]).toBeDefined()

    expect(mutationType?.getFields()["prepareGameDraft"]).toBeDefined()
    expect(mutationType?.getFields()["discardGameDraft"]).toBeDefined()
    expect(mutationType?.getFields()["createGameFileUpload"]).toBeDefined()
    expect(mutationType?.getFields()["addGameFile"]).toBeDefined()
    expect(mutationType?.getFields()["updateGameFile"]).toBeDefined()
    expect(mutationType?.getFields()["removeGameFile"]).toBeDefined()
    expect(mutationType?.getFields()["restoreGameFile"]).toBeDefined()
    expect(mutationType?.getFields()["publishGameRelease"]).toBeDefined()

    // 4. Settings
    expect(queryType?.getFields()["clientConfiguration"]).toBeDefined()
    expect(queryType?.getFields()["adminSettings"]).toBeDefined()
    expect(mutationType?.getFields()["updateAdminSettings"]).toBeDefined()

    // Check ClientFile contract
    const clientFileType = schema.getType("ClientFile") as GraphQLObjectType
    expect(clientFileType).toBeDefined()
    const clientFields = Object.keys(clientFileType.getFields())
    expect(clientFields).toEqual([
      "path",
      "sha256",
      "sizeBytes",
      "downloadUrl",
      "policy",
    ])

    // Check PublishedModpack contract
    const publishedModpackType = schema.getType(
      "PublishedModpack",
    ) as GraphQLObjectType
    expect(publishedModpackType).toBeDefined()
    const modpackFields = Object.keys(publishedModpackType.getFields())
    expect(modpackFields).toEqual([
      "version",
      "minecraftVersion",
      "modLoader",
      "modLoaderVersion",
      "neoForgeVersion",
      "mandatory",
      "clientFiles",
      "directoryPolicies",
      "notes",
      "cover",
    ])
  })

  it("validates real Launcher active skin queries and mutations against schema", () => {
    const schema = getBaseSchema()

    // 1. Valid Launcher MyActiveSkin Query (no model field)
    const validMyActiveSkinQuery = /* GraphQL */ `
      query MyActiveSkin {
        myActiveSkin {
          type
          skinId
          skin {
            id
            name
            imageUrl
          }
        }
      }
    `
    const errors1 = validate(schema, parse(validMyActiveSkinQuery))
    expect(errors1).toHaveLength(0)

    // 2. Valid Launcher SetMyActiveSkin Mutation
    const validSetMyActiveSkinMutation = /* GraphQL */ `
      mutation SetMyActiveSkin($input: SetActiveSkinInput!) {
        setMyActiveSkin(input: $input) {
          type
          skinId
          skin {
            id
            name
            imageUrl
          }
        }
      }
    `
    const errors2 = validate(schema, parse(validSetMyActiveSkinMutation))
    expect(errors2).toHaveLength(0)

    // 3. Reject invalid query asking for non-existent globalSkinId
    const invalidQuery = /* GraphQL */ `
      query BadActiveSkin {
        myActiveSkin {
          type
          globalSkinId
        }
      }
    `
    const invalidErrors = validate(schema, parse(invalidQuery))
    expect(invalidErrors.length).toBeGreaterThan(0)
    expect(invalidErrors[0]?.message).toContain('Cannot query field "globalSkinId"')
  })

  it("validates Capes GraphQL operations against schema", () => {
    const schema = getBaseSchema()

    // 1. Query capes and active cape
    const capesQueryDoc = /* GraphQL */ `
      query LauncherCapes {
        capes(first: 20) {
          items {
            id
            name
            imageUrl
            status
          }
        }
        myPlayerCapes {
          id
          name
          imageUrl
        }
        myActiveCape {
          type
          capeId
          playerCapeId
          imageUrl
          name
        }
      }
    `
    expect(validate(schema, parse(capesQueryDoc))).toHaveLength(0)

    // 2. Set active cape mutation
    const setActiveCapeDoc = /* GraphQL */ `
      mutation SetActiveCape($input: SetActiveCapeInput!) {
        setMyActiveCape(input: $input) {
          type
          capeId
          playerCapeId
          imageUrl
          name
        }
      }
    `
    expect(validate(schema, parse(setActiveCapeDoc))).toHaveLength(0)
  })

  it("Shard 07 Hardening: Back Office skin mutations are valid and model is not defined on inputs or types", () => {
    const schema = getBaseSchema()

    // 1. Back Office createSkin mutation (no model)
    const createSkinDoc = /* GraphQL */ `
      mutation CreateSkin($input: CreateSkinInput!) {
        createSkin(input: $input) {
          id
          name
          imageUrl
          status
          createdAt
          updatedAt
        }
      }
    `
    expect(validate(schema, parse(createSkinDoc))).toHaveLength(0)

    // 2. Back Office updateSkin mutation (no model)
    const updateSkinDoc = /* GraphQL */ `
      mutation UpdateSkin($id: ID!, $input: UpdateSkinInput!) {
        updateSkin(id: $id, input: $input) {
          id
          name
          imageUrl
          status
          createdAt
          updatedAt
        }
      }
    `
    expect(validate(schema, parse(updateSkinDoc))).toHaveLength(0)

    // 3. Back Office updateAdminPlayerSkin mutation (no model)
    const updateAdminPlayerSkinDoc = /* GraphQL */ `
      mutation UpdateAdminPlayerSkin($id: ID!, $input: UpdateAdminPlayerSkinInput!) {
        updateAdminPlayerSkin(id: $id, input: $input) {
          id
          userId
          userDisplayName
          imageUrl
          createdAt
          updatedAt
        }
      }
    `
    expect(validate(schema, parse(updateAdminPlayerSkinDoc))).toHaveLength(0)

    // 4. Verify model field does not exist on CreateSkinInput, UpdateSkinInput, UpdateAdminPlayerSkinInput, SetPlayerSkinInput
    const createSkinType = schema.getType("CreateSkinInput") as any
    expect(createSkinType.getFields().model).toBeUndefined()
    expect(createSkinType.getFields().name).toBeDefined()
    expect(createSkinType.getFields().mediaId).toBeDefined()

    const updateSkinType = schema.getType("UpdateSkinInput") as any
    expect(updateSkinType.getFields().model).toBeUndefined()
    expect(updateSkinType.getFields().name).toBeDefined()

    const updateAdminPlayerSkinType = schema.getType("UpdateAdminPlayerSkinInput") as any
    expect(updateAdminPlayerSkinType.getFields().model).toBeUndefined()
    expect(updateAdminPlayerSkinType.getFields().mediaId).toBeDefined()

    const setPlayerSkinType = schema.getType("SetPlayerSkinInput") as any
    expect(setPlayerSkinType.getFields().model).toBeUndefined()
    expect(setPlayerSkinType.getFields().mediaId).toBeDefined()
  })
})
