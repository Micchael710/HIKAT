export const userTypeDefs = /* GraphQL */ `
  """
  HiKAT user identity entity contract
  """
  type User {
    id: ID!
    role: Role!
    displayName: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }
`
