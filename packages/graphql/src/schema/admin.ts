export const adminTypeDefs = /* GraphQL */ `
  """
  HiKAT administrative status for role and permission verification
  """
  type AdminStatus {
    ok: Boolean!
    serverTime: DateTime!
    environment: String!
  }

  extend type Query {
    """
    Administrative status check - requires ADMIN role
    """
    adminStatus: AdminStatus
  }
`
