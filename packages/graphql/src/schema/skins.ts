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

  """
  Personal custom skin belonging to an authenticated player
  """
  type PlayerSkin {
    id: ID!
    userId: ID!
    model: SkinModel!
    imageUrl: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }


  """
  Administrative view of a player's personal skin - requires ADMIN role
  """
  type AdminPlayerSkin {
    id: ID!
    userId: ID!
    userDisplayName: String!
    model: SkinModel!
    imageUrl: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminPlayerSkinEdge {
    node: AdminPlayerSkin!
    cursor: String!
  }

  type AdminPlayerSkinConnection {
    edges: [AdminPlayerSkinEdge!]!
    items: [AdminPlayerSkin!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  input CreateSkinInput {
    name: String!
    mediaId: ID!
    status: SkinStatus
  }

  input UpdateSkinInput {
    name: String
    mediaId: ID
    status: SkinStatus
  }

  input SetPlayerSkinInput {
    mediaId: ID!
  }

  input UpdateAdminPlayerSkinInput {
    mediaId: ID!
  }

  """
  Active Skin Selection Type: CUSTOM or GLOBAL
  """
  enum ActiveSkinType {
    CUSTOM
    GLOBAL
  }

  """
  Resolved active skin representation for the player
  """
  type ActiveSkinSelection {
    type: ActiveSkinType!
    skinId: ID
    skin: Skin
    playerSkin: PlayerSkin
    model: SkinModel!
    imageUrl: String!
    name: String
    updatedAt: DateTime!
  }

  input SetActiveSkinInput {
    type: ActiveSkinType!
    skinId: ID
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

    """
    Personal custom skin of the currently authenticated player - requires auth
    """
    myPlayerSkin: PlayerSkin

    """
    Current active skin selection of the authenticated player - requires auth
    """
    myActiveSkin: ActiveSkinSelection

    """
    Administrative list of all player personal skins with optional search by player name - requires ADMIN role
    """
    adminPlayerSkins(
      first: Int
      after: String
      search: String
    ): AdminPlayerSkinConnection!

    """
    Administrative lookup of a player skin by ID - requires ADMIN role
    """
    adminPlayerSkin(id: ID!): AdminPlayerSkin
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

    """
    Request a single-use upload ticket for an authenticated player to upload their custom skin - requires auth
    """
    createPlayerSkinUpload: ContentMediaUploadPayload!

    """
    Set or replace the current authenticated player's personal custom skin - requires auth
    """
    setMyPlayerSkin(input: SetPlayerSkinInput!): PlayerSkin!

    """
    Delete the current authenticated player's personal custom skin - requires auth
    """
    deleteMyPlayerSkin: Boolean!

    """
    Set the active skin for the authenticated player (CUSTOM or GLOBAL) - requires auth
    """
    setMyActiveSkin(input: SetActiveSkinInput!): ActiveSkinSelection!

    """
    Update a player's custom skin model or texture - requires ADMIN role
    """
    updateAdminPlayerSkin(
      id: ID!
      input: UpdateAdminPlayerSkinInput!
    ): AdminPlayerSkin!

    """
    Delete a player's custom skin - requires ADMIN role
    """
    deleteAdminPlayerSkin(id: ID!): Boolean!
  }
`
