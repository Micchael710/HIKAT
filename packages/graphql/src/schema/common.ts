export const commonTypeDefs = /* GraphQL */ `
  """
  An ISO-8601 encoded UTC date-time string (e.g. 2026-08-25T16:00:00.000Z)
  """
  scalar DateTime

  """
  Application user authorization roles in HiKAT
  """
  enum Role {
    PLAYER
    ADMIN
  }
`
