export const healthTypeDefs = /* GraphQL */ `
  """
  Service health status report
  """
  type HealthStatus {
    status: String!
    service: String!
    version: String!
    timestamp: String!
  }

  type Query {
    """
    Health check query for backend service
    """
    health: HealthStatus!

    """
    Backend service version string
    """
    version: String!
  }
`
