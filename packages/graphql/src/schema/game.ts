export const gameTypeDefs = /* GraphQL */ `
  """
  Category of file inside the Minecraft game instance
  """
  enum GameFileCategory {
    MOD
    RESOURCE_PACK
    SHADER_PACK
    KUBEJS
    SCRIPT
  }

  """
  Release publication status
  """
  enum GameReleaseStatus {
    DRAFT
    PUBLISHED
    ARCHIVED
  }

  """
  Synchronization enforcement policy for the client
  """
  enum SyncPolicy {
    NO_MODIFICABLE
    MODIFICABLE
  }

  """
  Public client file manifest entry for the HiKAT Launcher sync engine
  """
  type ClientFile {
    path: String!
    sha256: String!
    sizeBytes: Int!
    downloadUrl: String!
    policy: SyncPolicy!
  }

  """
  Published modpack release contract consumed by the HiKAT Launcher
  """
  type PublishedModpack {
    version: String!
    minecraftVersion: String!
    neoForgeVersion: String!
    mandatory: Boolean!
    clientFiles: [ClientFile!]!
  }

  """
  Administrative game release file representation
  """
  type AdminGameFile {
    id: ID!
    name: String!
    logicalPath: String!
    category: GameFileCategory!
    sha256: String!
    sizeBytes: Int!
    policy: SyncPolicy!
    createdAt: DateTime!
  }

  """
  Game release snapshot
  """
  type GameRelease {
    id: ID!
    version: String!
    minecraftVersion: String!
    neoForgeVersion: String!
    status: GameReleaseStatus!
    notes: String
    publishedAt: DateTime
    files: [AdminGameFile!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  """
  Administrative overview of current published version and active draft
  """
  type AdminGameOverview {
    publishedRelease: GameRelease
    draftRelease: GameRelease
    pendingChangesCount: Int!
  }

  """
  Payload returned when requesting a game file upload ticket
  """
  type GameFileUploadPayload {
    uploadUrl: String!
    uploadToken: String!
    expiresAt: DateTime!
    maxSizeBytes: Int!
    expectedCategory: GameFileCategory!
  }

  input CreateGameFileUploadInput {
    category: GameFileCategory!
    originalFilename: String!
    sizeBytes: Int!
  }

  input AddGameFileInput {
    name: String!
    category: GameFileCategory
    tokenHash: String!
  }

  input UpdateGameFileInput {
    name: String
    category: GameFileCategory
  }

  input PrepareGameDraftInput {
    baseReleaseId: ID
  }

  input PublishGameReleaseInput {
    version: String!
    notes: String
  }

  extend type Query {
    """
    Authoritative active published modpack manifest for Launcher
    """
    publishedModpack: PublishedModpack

    """
    Administrative overview of game releases and drafts - requires ADMIN role
    """
    adminGameOverview: AdminGameOverview!

    """
    List of files associated with a release or draft - requires ADMIN role
    """
    adminGameFiles(
      releaseId: ID
      category: GameFileCategory
    ): [AdminGameFile!]!
  }

  extend type Mutation {
    """
    Create a new draft snapshot cloned from the current published release - requires ADMIN role
    """
    prepareGameDraft(input: PrepareGameDraftInput): GameRelease!

    """
    Discard the active draft and any pending uncommitted changes - requires ADMIN role
    """
    discardGameDraft: Boolean!

    """
    Request a single-use token to upload a game file binary (.jar / .zip) - requires ADMIN role
    """
    createGameFileUpload(input: CreateGameFileUploadInput!): GameFileUploadPayload!

    """
    Add an uploaded game file to the active draft - requires ADMIN role
    """
    addGameFile(input: AddGameFileInput!): AdminGameFile!

    """
    Update metadata of an existing game file in the active draft - requires ADMIN role
    """
    updateGameFile(id: ID!, input: UpdateGameFileInput!): AdminGameFile!

    """
    Remove a game file from the active draft - requires ADMIN role
    """
    removeGameFile(id: ID!): Boolean!

    """
    Atomically publish the active draft as the new official version - requires ADMIN role
    """
    publishGameRelease(input: PublishGameReleaseInput!): GameRelease!
  }
`
