import { describe, it, expect } from "vitest"

import { typeDefs, getBaseSchema } from "./index"

import { GraphQLSchema } from "graphql"

describe("@hikat/graphql foundation", () => {
  it("exports valid GraphQL typeDefs string", () => {
    expect(typeDefs).toContain("type Query")

    expect(typeDefs).toContain("health: HealthStatus!")
  })

  it("builds a valid GraphQLSchema object", () => {
    const schema = getBaseSchema()

    expect(schema).toBeInstanceOf(GraphQLSchema)

    const queryType = schema.getQueryType()

    expect(queryType).toBeDefined()

    expect(queryType?.getFields()["health"]).toBeDefined()

    expect(queryType?.getFields()["version"]).toBeDefined()
  })
})
