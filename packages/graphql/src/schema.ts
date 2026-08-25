/**
 * Base GraphQL Type Definitions for HiKAT
 * In Shard 0, contains only minimal foundation definitions (health & version)
 */

export const typeDefs = /* GraphQL */ `
  type HealthStatus {
    status: String!
    service: String!
    version: String!
    timestamp: String!
  }

  type Query {
    health: HealthStatus!
    version: String!
  }
`
