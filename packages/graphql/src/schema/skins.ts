export const skinsTypeDefs = /* GraphQL */ `
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
    imageUrl: String!
    name: String
    updatedAt: DateTime!
  }

  input SetActiveSkinInput {
    type: ActiveSkinType!
    skinId: ID
  }

  """
  Cape availability status
  """
  enum CapeStatus {
    AVAILABLE
    UNAVAILABLE
  }

  """
  HiKAT Character Cape Entity (Global Catalog)
  """
  type Cape {
    id: ID!
    name: String!
    imageUrl: String!
    status: CapeStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type CapeEdge {
    node: Cape!
    cursor: String!
  }

  type CapeConnection {
    edges: [CapeEdge!]!
    items: [Cape!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  """
  Personal custom cape belonging to an authenticated player
  """
  type PlayerCape {
    id: ID!
    userId: ID!
    name: String!
    imageUrl: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type PlayerCapeEdge {
    node: PlayerCape!
    cursor: String!
  }

  type PlayerCapeConnection {
    edges: [PlayerCapeEdge!]!
    items: [PlayerCape!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  """
  Administrative view of a player's personal cape - requires ADMIN role
  """
  type AdminPlayerCape {
    id: ID!
    userId: ID!
    userDisplayName: String!
    name: String!
    imageUrl: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AdminPlayerCapeEdge {
    node: AdminPlayerCape!
    cursor: String!
  }

  type AdminPlayerCapeConnection {
    edges: [AdminPlayerCapeEdge!]!
    items: [AdminPlayerCape!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  input CreateCapeInput {
    name: String!
    mediaId: ID!
    status: CapeStatus
  }

  input UpdateCapeInput {
    name: String
    mediaId: ID
    status: CapeStatus
  }

  input AddPlayerCapeInput {
    name: String!
    mediaId: ID!
  }

  input UpdateAdminPlayerCapeInput {
    name: String
    mediaId: ID
  }

  """
  Active Cape Selection Type: NONE, CUSTOM or GLOBAL
  """
  enum ActiveCapeType {
    NONE
    CUSTOM
    GLOBAL
  }

  """
  Resolved active cape representation for the player
  """
  type ActiveCapeSelection {
    type: ActiveCapeType!
    capeId: ID
    playerCapeId: ID
    cape: Cape
    playerCape: PlayerCape
    imageUrl: String
    name: String
    updatedAt: DateTime!
  }

  input SetActiveCapeInput {
    type: ActiveCapeType!
    capeId: ID
    playerCapeId: ID
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

    """
    Public catalog of available capes for the launcher/game
    """
    capes(first: Int, after: String): CapeConnection!

    """
    Administrative list of capes - requires ADMIN role
    """
    adminCapes(
      first: Int
      after: String
      status: CapeStatus
    ): CapeConnection!

    """
    Administrative lookup of a cape by ID - requires ADMIN role
    """
    adminCape(id: ID!): Cape

    """
    List of personal custom capes belonging to the authenticated player - requires auth
    """
    myPlayerCapes: [PlayerCape!]!

    """
    Current active cape selection of the authenticated player - requires auth
    """
    myActiveCape: ActiveCapeSelection

    """
    Administrative list of all player personal capes with optional search - requires ADMIN role
    """
    adminPlayerCapes(
      first: Int
      after: String
      search: String
    ): AdminPlayerCapeConnection!

    """
    Administrative lookup of a player cape by ID - requires ADMIN role
    """
    adminPlayerCape(id: ID!): AdminPlayerCape
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
    Update a player's custom skin texture - requires ADMIN role
    """
    updateAdminPlayerSkin(
      id: ID!
      input: UpdateAdminPlayerSkinInput!
    ): AdminPlayerSkin!

    """
    Delete a player's custom skin - requires ADMIN role
    """
    deleteAdminPlayerSkin(id: ID!): Boolean!

    """
    Create a new global cape - requires ADMIN role
    """
    createCape(input: CreateCapeInput!): Cape!

    """
    Update an existing global cape - requires ADMIN role
    """
    updateCape(id: ID!, input: UpdateCapeInput!): Cape!

    """
    Delete a global cape - requires ADMIN role
    """
    deleteCape(id: ID!): Boolean!

    """
    Request a single-use upload ticket for an authenticated player to upload a custom cape - requires auth
    """
    createPlayerCapeUpload: ContentMediaUploadPayload!

    """
    Add a new personal custom cape for the authenticated player - requires auth
    """
    addMyPlayerCape(input: AddPlayerCapeInput!): PlayerCape!

    """
    Delete a personal custom cape belonging to the authenticated player - requires auth
    """
    deleteMyPlayerCape(id: ID!): Boolean!

    """
    Set the active cape for the authenticated player (NONE, CUSTOM or GLOBAL) - requires auth
    """
    setMyActiveCape(input: SetActiveCapeInput!): ActiveCapeSelection!

    """
    Update a player's custom cape - requires ADMIN role
    """
    updateAdminPlayerCape(
      id: ID!
      input: UpdateAdminPlayerCapeInput!
    ): AdminPlayerCape!

    """
    Delete a player's custom cape - requires ADMIN role
    """
    deleteAdminPlayerCape(id: ID!): Boolean!
  }
`
