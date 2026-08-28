export const gameTypeDefs = /* GraphQL */ `
  """
  Category of file inside the Minecraft game instance
  """
  enum GameFileCategory {
    MOD
    RESOURCE_PACK
    DATA_PACK
    SHADER_PACK
    KUBEJS
    SCRIPT
    CONFIG
    GENERAL
  }

  """
  Type of content in external provider or local game instance
  """
  enum ContentType {
    MOD
    RESOURCE_PACK
    DATA_PACK
    SHADER
  }

  """
  Target distribution environment for mods
  """
  enum ModEnvironment {
    CLIENT
    SERVER
    BOTH
    UNKNOWN
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
  Draft change tracking status relative to current published version
  """
  enum GameDraftChangeStatus {
    UNCHANGED
    ADDED
    UPDATED
    REMOVED
  }

  """
  External mod repository providers supported by HiKAT
  """
  enum ModProvider {
    MODRINTH
    CURSEFORGE
  }

  """
  Relation type of declared mod dependencies
  """
  enum ModDependencyType {
    REQUIRED
    OPTIONAL
    INCOMPATIBLE
    EMBEDDED
  }

  """
  Release channel/stability type
  """
  enum ModReleaseType {
    RELEASE
    BETA
    ALPHA
  }

  """
  Planned installation action for an individual mod or dependency in draft
  """
  enum ModPlanAction {
    INSTALL
    UPDATE
    ALREADY_INSTALLED
    CONFLICT
  }

  """
  Summary of file modifications between published version and active draft
  """
  type GameDraftChanges {
    added: Int!
    updated: Int!
    removed: Int!
    unchanged: Int!
    total: Int!
  }

  """
  Readiness checklist for publishing an update
  """
  type GameDraftReadiness {
    isReady: Boolean!
    validVersion: Boolean!
    noConflicts: Boolean!
    storageVerified: Boolean!
    issues: [String!]!
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
    explicitPolicy: SyncPolicy
    effectivePolicy: SyncPolicy!
    isInherited: Boolean!
    isDirectory: Boolean!
    changeStatus: GameDraftChangeStatus
    sourceProvider: ModProvider
    sourceProjectId: String
    sourceVersionId: String
    sourceFileId: String
    sourceEnvironment: ModEnvironment
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
    changes: GameDraftChanges
    readiness: GameDraftReadiness
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

  """
  Status of individual mod repository provider
  """
  type ModProviderStatus {
    provider: ModProvider!
    available: Boolean!
    error: String
  }

  """
  Single mod/content search result item normalized across providers
  """
  type ModSearchResultItem {
    provider: ModProvider!
    projectId: String!
    slug: String
    name: String!
    summary: String!
    description: String
    author: String!
    iconUrl: String
    downloads: Int!
    follows: Int
    categories: [String!]!
    contentType: ContentType!
    environment: ModEnvironment
    latestVersion: String
    publishedAt: String
    updatedAt: String
  }

  """
  Normalized payload returned from searching mod repositories
  """
  type ModSearchPayload {
    items: [ModSearchResultItem!]!
    totalCount: Int!
    providersStatus: [ModProviderStatus!]!
    minecraftVersion: String!
    neoForgeVersion: String!
  }

  """
  Declared dependency for a mod version
  """
  type ModDependency {
    projectId: String
    versionId: String
    fileId: String
    dependencyType: ModDependencyType!
    projectName: String
    fileName: String
  }

  """
  Compatible version file for a mod project
  """
  type ModProjectVersion {
    id: String!
    fileId: String
    versionNumber: String!
    name: String!
    releaseType: ModReleaseType!
    gameVersions: [String!]!
    loaders: [String!]!
    publishedAt: String!
    downloads: Int!
    filename: String!
    sizeBytes: Int!
    sha256: String
    dependencies: [ModDependency!]!
  }

  """
  Detailed mod/content project information with compatible versions
  """
  type ModProjectDetail {
    provider: ModProvider!
    projectId: String!
    slug: String
    name: String!
    summary: String!
    description: String
    author: String!
    iconUrl: String
    downloads: Int!
    contentType: ContentType!
    environment: ModEnvironment
    compatibleVersions: [ModProjectVersion!]!
    installedVersion: String
    isInstalled: Boolean!
    minecraftVersion: String!
    neoForgeVersion: String!
  }

  """
  Single mod or dependency entry in the installation plan
  """
  type ModInstallationPlanItem {
    provider: ModProvider!
    projectId: String!
    projectName: String!
    versionId: String!
    fileId: String
    versionNumber: String!
    filename: String!
    sizeBytes: Int!
    sha256: String
    contentType: ContentType!
    environment: ModEnvironment
    logicalPath: String!
    isRoot: Boolean!
    isDependency: Boolean!
    isRequired: Boolean!
    isInstalled: Boolean!
    action: ModPlanAction!
    installedFileId: String
    installedVersionNumber: String
    availableCompatibleVersions: [ModProjectVersion!]!
  }

  """
  Complete dependency installation plan calculated prior to download
  """
  type ModInstallationPlan {
    items: [ModInstallationPlanItem!]!
    totalDownloadSizeBytes: Int!
    conflicts: [String!]!
    optionalDependencies: [ModInstallationPlanItem!]!
    isValid: Boolean!
  }

  input CreateGameFileUploadInput {
    category: GameFileCategory
    originalFilename: String!
    sizeBytes: Int!
    logicalPath: String
  }

  input AddGameFileInput {
    name: String!
    category: GameFileCategory
    logicalPath: String
    explicitPolicy: SyncPolicy
    tokenHash: String!
  }

  input UpdateGameFileInput {
    name: String
    category: GameFileCategory
    logicalPath: String
    explicitPolicy: SyncPolicy
    tokenHash: String
  }

  input SaveGameFileContentInput {
    logicalPath: String!
    content: String!
    explicitPolicy: SyncPolicy
  }

  input PrepareGameDraftInput {
    baseReleaseId: ID
  }

  input PublishGameReleaseInput {
    version: String!
    notes: String
  }

  input ModVersionOverrideInput {
    provider: ModProvider!
    projectId: String!
    versionId: String!
  }

  input ResolveModPlanInput {
    provider: ModProvider!
    projectId: String!
    versionId: String!
    contentType: ContentType
    manualOverrides: [ModVersionOverrideInput!]
  }

  input InstallModPlanInput {
    provider: ModProvider!
    projectId: String!
    versionId: String!
    contentType: ContentType
    manualOverrides: [ModVersionOverrideInput!]
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
    Historical releases - requires ADMIN role
    """
    gameReleaseHistory: [GameRelease!]!

    """
    List of files associated with a release or draft - requires ADMIN role
    """
    adminGameFiles(
      releaseId: ID
      category: GameFileCategory
    ): [AdminGameFile!]!

    """
    Read text content of a game file from active draft/release - requires ADMIN role
    """
    readGameFileContent(id: ID!): String!

    """
    Search mods across Modrinth and/or CurseForge filtered by Minecraft version & NeoForge - requires ADMIN role
    """
    searchMods(
      query: String!
      contentType: ContentType
      provider: ModProvider
      limit: Int
      offset: Int
    ): ModSearchPayload!

    """
    Get detailed information and compatible versions of a mod project - requires ADMIN role
    """
    getModProjectDetail(
      provider: ModProvider!
      projectId: String!
      contentType: ContentType
    ): ModProjectDetail!

    """
    Resolve and preview complete dependency plan before installing - requires ADMIN role
    """
    resolveModInstallationPlan(
      input: ResolveModPlanInput!
    ): ModInstallationPlan!
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
    Request a single-use token to upload a game file binary - requires ADMIN role
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
    Save direct UTF-8 text file content into active draft - requires ADMIN role
    """
    saveGameFileContent(input: SaveGameFileContentInput!): AdminGameFile!

    """
    Create an explicit directory record in the active draft - requires ADMIN role
    """
    createGameFolder(logicalPath: String!): AdminGameFile!

    """
    Rename a file or folder path in the active draft - requires ADMIN role
    """
    renameGamePath(oldPath: String!, newPath: String!): Boolean!

    """
    Move one or multiple files/folders into a destination folder in active draft - requires ADMIN role
    """
    moveGamePaths(sources: [String!]!, destinationFolder: String!): Boolean!

    """
    Copy one or multiple files/folders into a destination folder in active draft - requires ADMIN role
    """
    copyGamePaths(sources: [String!]!, destinationFolder: String!): Boolean!

    """
    Delete one or multiple files or folders from active draft - requires ADMIN role
    """
    deleteGamePaths(paths: [String!]!): Boolean!

    """
    Set explicit policy on a file or folder (pass null to inherit) - requires ADMIN role
    """
    setGamePathPolicy(path: String!, explicitPolicy: SyncPolicy): Boolean!

    """
    Remove a game file from the active draft - requires ADMIN role
    """
    removeGameFile(id: ID!): Boolean!

    """
    Restore a removed game file back to the active draft - requires ADMIN role
    """
    restoreGameFile(id: ID!): AdminGameFile!

    """
    Atomically publish the active draft as the new official version - requires ADMIN role
    """
    publishGameRelease(input: PublishGameReleaseInput!): GameRelease!

    """
    Download, validate, and install a mod and its required dependencies into the active draft - requires ADMIN role
    """
    installModPlan(
      input: InstallModPlanInput!
    ): [AdminGameFile!]!
  }
`
