export const skinsTypeDefs = /* GraphQL */ `
  """
  Minecraft character skin model arm thickness
  """
  enum SkinModel {
    CLASSIC
    SLIM
  }

  """
  Skin availability status
  """
  enum SkinStatus {
    AVAILABLE
    UNAVAILABLE
  }

  """
  HiKAT Character Skin Entity
  """
  type Skin {
    id: ID!
    name: String!
    model: SkinModel!
    imageUrl: String!
    status: SkinStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type SkinEdge {
    node: Skin!
    cursor: String!
  }

  type SkinConnection {
    edges: [SkinEdge!]!
    items: [Skin!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  input CreateSkinInput {
    name: String!
    model: SkinModel
    mediaId: ID!
    status: SkinStatus
  }

  input UpdateSkinInput {
    name: String
    model: SkinModel
    mediaId: ID
    status: SkinStatus
  }

  extend type Query {
    """
    Public catalog of available skins for the launcher/game
    """
    skins(first: Int, after: String): SkinConnection!

    """
    Administrative list of skins - requires ADMIN role
    """
    adminSkins(
      first: Int
      after: String
      status: SkinStatus
    ): SkinConnection!

    """
    Administrative lookup of a skin by ID - requires ADMIN role
    """
    adminSkin(id: ID!): Skin
  }

  extend type Mutation {
    """
    Create a new skin - requires ADMIN role
    """
    createSkin(input: CreateSkinInput!): Skin!

    """
    Update an existing skin - requires ADMIN role
    """
    updateSkin(id: ID!, input: UpdateSkinInput!): Skin!

    """
    Delete a skin - requires ADMIN role
    """
    deleteSkin(id: ID!): Boolean!
  }
`
