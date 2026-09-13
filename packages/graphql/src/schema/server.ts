export const serverTypeDefs = /* GraphQL */ `
  """
  HiKAT server status enum
  """
  enum ServerStatus {
    ONLINE
    STARTING
    STOPPING
    OFFLINE
    DISCONNECTED
    UNKNOWN
  }

  """
  HiKAT server power action enum
  """
  enum ServerPowerAction {
    START
    RESTART
    STOP
  }

  """
  HiKAT Minecraft server resources and telemetry
  """
  type ServerResources {
    status: ServerStatus!
    cpuPercent: Float!
    cpuLimitPercent: Float
    memoryUsedBytes: Float!
    memoryLimitBytes: Float
    diskUsedBytes: Float!
    diskLimitBytes: Float
    networkRxBytes: Float
    networkTxBytes: Float
    uptimeMs: Float
    isSuspended: Boolean!
  }

  """
  Result of executing a server power action
  """
  type ServerPowerActionResult {
    success: Boolean!
    status: ServerStatus!
    message: String
  }

  """
  Result of sending a server console command
  """
  type ServerCommandResult {
    success: Boolean!
    message: String
  }

  """
  Single-use temporary ticket for connecting to the live server console WebSocket
  """
  type ServerConsoleTicketPayload {
    ticket: String!
    expiresAt: String!
  }

  """
  Recent human-friendly server activity log item
  """
  type ServerActivityItem {
    id: ID!
    description: String!
    eventType: String!
    timestamp: String!
  }

  """
  Server backup metadata representation
  """
  type ServerBackupItem {
    id: ID!
    name: String!
    bytes: Float!
    createdAt: String!
    completedAt: String
    isSuccessful: Boolean!
    isLocked: Boolean!
  }

  """
  Server active world detection and summary
  """
  type ServerWorldInfo {
    name: String!
    sizeBytes: Float
    lastModified: String
  }

  """
  Minecraft server configuration properties
  """
  type MinecraftServerSettings {
    difficulty: String!
    maxPlayers: Int!
    pvp: Boolean!
    whitelist: Boolean!
    viewDistance: Int!
    simulationDistance: Int!
    motd: String!
    allowFlight: Boolean!
  }

  input UpdateMinecraftServerSettingsInput {
    difficulty: String
    maxPlayers: Int
    pvp: Boolean
    whitelist: Boolean
    viewDistance: Int
    simulationDistance: Int
    motd: String
    allowFlight: Boolean
  }

  enum ServerTaskTemplate {
    AUTO_STOP
    AUTO_START
    AUTO_RESTART
    AUTO_BACKUP
    RUN_COMMAND
    BACKUP_AND_RESTART
    BACKUP_AND_STOP
    WARN_AND_RESTART
    WARN_AND_STOP
    SAVE_AND_BACKUP
    CUSTOM
  }

  enum ServerAutomationAction {
    BACKUP
    RESTART
    START
    STOP
    COMMAND
  }

  enum ServerAutomationFrequency {
    DAILY
    WEEKLY
    SELECTED_DAYS
    INTERVAL
  }

  type ServerAutomationItem {
    id: ID!
    name: String!
    action: ServerAutomationAction!
    template: ServerTaskTemplate
    frequency: ServerAutomationFrequency!
    time: String!
    intervalHours: Int
    weekday: Int
    weekdays: [Int!]
    command: String
    delaySeconds: Int
    message: String
    humanSchedule: String
    enabled: Boolean!
    isProcessing: Boolean!
    isAdvanced: Boolean!
    isManaged: Boolean!
    lastRunAt: String
    nextRunAt: String
  }

  input ServerAutomationInput {
    name: String!
    action: ServerAutomationAction
    template: ServerTaskTemplate
    frequency: ServerAutomationFrequency!
    time: String
    intervalHours: Int
    weekday: Int
    weekdays: [Int!]
    command: String
    delaySeconds: Int
    message: String
    enabled: Boolean
  }

  enum ServerFileRoot {
    SERVER
    WORLD
    CONFIG
    MODS
    LOGS
  }

  type ServerFileItem {
    name: String!
    isFile: Boolean!
    isSymlink: Boolean!
    sizeBytes: Float!
    mimeType: String
    modifiedAt: String!
  }

  type ServerFileContent {
    content: String!
    sizeBytes: Float!
  }

  type ServerSignedUrlPayload {
    url: String!
  }

  enum ServerManagedContentSource {
    SERVER_DIRECT
    GAME_RELEASE
  }

  enum ServerManagedContentStatus {
    INSTALLED
    UPDATE_AVAILABLE
    MISSING
  }

  type ServerManagedContentItem {
    id: ID!
    managementSource: String!
    provider: ModProvider
    projectId: String
    versionId: String
    fileId: String
    contentType: ContentType!
    environment: String
    targetPath: String!
    sha256: String!
    sizeBytes: Float!
    gameReleaseId: String
    gameReleaseFileId: String
    status: String!
    name: String!
    createdAt: String!
    updatedAt: String!
  }

  type ServerContentSearchPayload {
    items: [ModSearchResultItem!]!
    totalCount: Int!
    hasMore: Boolean!
    nextCursor: String
    providersStatus: [ModProviderStatus!]!
    minecraftVersion: String!
    neoForgeVersion: String!
    isPublishedEnvironment: Boolean!
  }

  type ServerContentPlanItem {
    provider: ModProvider!
    projectId: String!
    projectName: String!
    versionId: String!
    fileId: String
    versionNumber: String!
    filename: String!
    sizeBytes: Float!
    sha256: String
    contentType: ContentType!
    environment: String
    targetPath: String!
    isRoot: Boolean!
    isDependency: Boolean!
    isRequired: Boolean!
    isInstalled: Boolean!
    action: ModPlanAction!
    installedManagedId: String
    installedVersionNumber: String
    availableCompatibleVersions: [ModProjectVersion!]!
  }

  type ServerContentInstallationPlan {
    items: [ServerContentPlanItem!]!
    totalDownloadSizeBytes: Float!
    conflicts: [String!]!
    optionalDependencies: [ServerContentPlanItem!]!
    isValid: Boolean!
    requiresGameUpdate: Boolean!
    gameUpdateReason: String
  }

  input ResolveServerContentPlanInput {
    provider: ModProvider!
    projectId: String!
    versionId: String!
    contentType: ContentType
    manualOverrides: [ModVersionOverrideInput!]
    environmentOverride: ModEnvironment
  }

  input InstallServerContentPlanInput {
    provider: ModProvider!
    projectId: String!
    versionId: String!
    contentType: ContentType
    manualOverrides: [ModVersionOverrideInput!]
    environmentOverride: ModEnvironment
  }

  input InstallServerContentPlansBatchInput {
    plans: [InstallServerContentPlanInput!]!
  }

  enum ServerReleaseSyncPlanAction {
    INSTALL
    UPDATE
    REMOVE
    KEEP
  }

  type ServerReleaseSyncPlanItem {
    action: ServerReleaseSyncPlanAction!
    filename: String!
    targetPath: String!
    sizeBytes: Float!
    sha256: String!
    sourceProvider: ModProvider
    sourceProjectId: String
    sourceVersionId: String
    sourceFileId: String
    gameReleaseFileId: String
    managedContentId: String
    currentVersionNumber: String
    desiredVersionNumber: String
  }

  type ServerReleaseSyncSummary {
    toInstall: Int!
    toUpdate: Int!
    toRemove: Int!
    toKeep: Int!
  }

  type ServerReleaseSyncPlan {
    releaseId: ID
    releaseVersion: String
    isPending: Boolean!
    items: [ServerReleaseSyncPlanItem!]!
    summary: ServerReleaseSyncSummary!
    serverStatus: ServerStatus!
    canApply: Boolean!
    blockReason: String
  }

  enum ServerReleaseSyncStatusEnum {
    PENDING
    APPLYING
    APPLIED
    FAILED
  }

  type ServerReleaseSyncStatus {
    releaseId: ID
    releaseVersion: String
    status: ServerReleaseSyncStatusEnum!
    appliedAt: String
    details: String
  }

  type ServerReleaseSyncResult {
    success: Boolean!
    message: String!
    syncedCount: Int!
    status: ServerReleaseSyncStatusEnum!
  }

  enum ServerProvisioningStatus {
    PROVISIONING
    READY
    FAILED
  }

  """
  HiKAT Server Entity
  """
  type Server {
    id: ID!
    name: String!
    minecraftVersion: String!
    modLoader: GameModLoader!
    modLoaderVersion: String
    mainLogo: ContentMedia
    sidebarLogo: ContentMedia
    accentColor: String
    cpu: Int!
    memoryMb: Int!
    diskMb: Int!
    provisioningStatus: ServerProvisioningStatus!
    launcherActiveReleaseId: ID
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  """
  Lightweight active release summary for launcher server discovery
  """
  type LauncherReleaseSummary {
    version: String!
    minecraftVersion: String!
    modLoader: GameModLoader!
    modLoaderVersion: String
    neoForgeVersion: String
    notes: String
    cover: ContentMedia
  }

  """
  Public Server entity for HiKAT Launcher discovery (strictly excludes infrastructure details)
  """
  type LauncherServer {
    id: ID!
    name: String!
    minecraftVersion: String!
    modLoader: GameModLoader!
    modLoaderVersion: String
    mainLogo: ContentMedia
    sidebarLogo: ContentMedia
    accentColor: String
    launcherActiveReleaseId: ID!
    activeRelease: LauncherReleaseSummary
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input CreateServerInput {
    name: String!
    minecraftVersion: String!
    modLoader: GameModLoader!
    modLoaderVersion: String
    cpu: Int!
    memoryMb: Int!
    diskMb: Int!
    mainLogoMediaId: ID
    sidebarLogoMediaId: ID
    accentColor: String
  }

  """
  Input payload for updating server branding (logos and accent color)
  """
  input UpdateServerBrandingInput {
    mainLogoMediaId: ID
    sidebarLogoMediaId: ID
    accentColor: String!
  }

  """
  Lightweight live Minecraft server ping for launcher Home
  """
  type LauncherServerPing {
    latencyMs: Int!
    playersOnline: Int!
    maxPlayers: Int!
  }

  extend type Query {
    """
    Public query discovering all available servers with active releases for Launcher
    """
    launcherServers: [LauncherServer!]!

    """
    Lightweight Minecraft server list ping for launcher Home
    """
    launcherServerPing(serverId: ID!): LauncherServerPing

    """
    Lists all servers - requires ADMIN role
    """
    servers: [Server!]!

    """
    Retrieves a single server by ID - requires ADMIN role
    """
    server(serverId: ID!): Server

    """
    Retrieves current server operational status and resource metrics - requires ADMIN role
    """
    serverStatus(serverId: ID): ServerResources

    """
    Retrieves recent server activity events - requires ADMIN role
    """
    serverActivity(serverId: ID): [ServerActivityItem!]!

    """
    Lists all server backups - requires ADMIN role
    """
    serverBackups(serverId: ID): [ServerBackupItem!]!

    """
    Retrieves information on currently active world - requires ADMIN role
    """
    serverWorld(serverId: ID): ServerWorldInfo!

    """
    Retrieves parsed Minecraft server.properties settings - requires ADMIN role
    """
    serverMinecraftSettings(serverId: ID): MinecraftServerSettings!

    """
    Lists automated schedules - requires ADMIN role
    """
    serverAutomations(serverId: ID): [ServerAutomationItem!]!

    """
    Lists files and directories within a sandboxed virtual root - requires ADMIN role
    """
    serverFiles(serverId: ID, root: ServerFileRoot!, relativePath: String): [ServerFileItem!]!

    """
    Reads an allowlisted text file from a sandboxed virtual root - requires ADMIN role
    """
    serverTextFile(serverId: ID, root: ServerFileRoot!, relativePath: String!): ServerFileContent!

    """
    Lists all content tracked as managed on the server - requires ADMIN role
    """
    serverManagedContent(serverId: ID): [ServerManagedContentItem!]!

    """
    Searches server-only content (SERVER mods and DATA_PACKs) against published environment - requires ADMIN role
    """
    searchServerContent(serverId: ID, query: String!, provider: ModProvider, limit: Int, offset: Int, cursor: String, contentType: ContentType): ServerContentSearchPayload!

    """
    Retrieves details for a server-side project scoped to the published environment - requires ADMIN role
    """
    serverContentProjectDetail(serverId: ID, provider: ModProvider!, projectId: String!, contentType: ContentType): ModProjectDetail!

    """
    Resolves dependency plan for installing content directly on the server - requires ADMIN role
    """
    resolveServerContentPlan(serverId: ID, input: ResolveServerContentPlanInput!): ServerContentInstallationPlan!

    """
    Computes release synchronization plan comparing published release BOTH mods against server state - requires ADMIN role
    """
    serverReleaseSyncPlan(serverId: ID): ServerReleaseSyncPlan!

    """
    Retrieves status of server release synchronization - requires ADMIN role
    """
    serverReleaseSyncStatus(serverId: ID): ServerReleaseSyncStatus

    """
    Retrieves available hardware capacity from Pterodactyl node for server provisioning - requires ADMIN role
    """
    serverNodeCapacity: ServerNodeCapacity!
  }

  """
  Hardware capacity from Pterodactyl node for server provisioning
  """
  type ServerNodeCapacity {
    totalMemoryMb: Int!
    allocatedMemoryMb: Int!
    availableMemoryMb: Int!
    totalDiskMb: Int!
    allocatedDiskMb: Int!
    availableDiskMb: Int!
  }

  extend type Mutation {
    """
    Creates a new HiKAT server and automatically provisions infrastructure in Pterodactyl - requires ADMIN role
    """
    createServer(input: CreateServerInput!): Server!

    """
    Updates the branding (main logo, sidebar logo, accent color) of a server - requires ADMIN role
    """
    updateServerBranding(serverId: ID!, input: UpdateServerBrandingInput!): Server!

    """
    Deletes a HiKAT server with explicit upstream Pterodactyl deletion choice - requires ADMIN role
    """
    deleteServer(serverId: ID!, deletePterodactyl: Boolean!): Boolean!

    """
    Requests a short-lived single-use ticket for connecting to the live server console WebSocket - requires ADMIN role
    """
    createServerConsoleTicket(serverId: ID): ServerConsoleTicketPayload!

    """
    Executes a power action on the server (START, RESTART, STOP) - requires ADMIN role
    """
    serverPowerAction(serverId: ID, action: ServerPowerAction!): ServerPowerActionResult!

    """
    Starts the server - requires ADMIN role
    """
    startServer(serverId: ID): ServerPowerActionResult!

    """
    Restarts the server - requires ADMIN role
    """
    restartServer(serverId: ID): ServerPowerActionResult!

    """
    Stops the server - requires ADMIN role
    """
    stopServer(serverId: ID): ServerPowerActionResult!

    """
    Sends a console command to the Minecraft server - requires ADMIN role
    """
    sendServerCommand(serverId: ID, command: String!): ServerCommandResult!

    """
    Creates a new server backup - requires ADMIN role
    """
    createServerBackup(serverId: ID, name: String): ServerBackupItem!

    """
    Restores a server backup (requires server to be OFFLINE) - requires ADMIN role
    """
    restoreServerBackup(serverId: ID, id: ID!): Boolean!

    """
    Deletes a server backup (must not be locked) - requires ADMIN role
    """
    deleteServerBackup(serverId: ID, id: ID!): Boolean!

    """
    Toggles lock protection on a backup - requires ADMIN role
    """
    toggleServerBackupLock(serverId: ID, id: ID!): ServerBackupItem!

    """
    Generates a secure signed download URL for a backup - requires ADMIN role
    """
    createServerBackupDownloadUrl(serverId: ID, id: ID!, name: String): ServerSignedUrlPayload!

    """
    Compresses and generates a secure download URL for the active world - requires ADMIN role
    """
    createServerWorldDownloadUrl(serverId: ID): ServerSignedUrlPayload!

    """
    Prepares a temporary signed upload URL for world upload - requires ADMIN role
    """
    prepareServerWorldUpload(serverId: ID): ServerSignedUrlPayload!

    """
    Replaces the active world with an uploaded archive (requires server to be OFFLINE, creates automatic pre-backup) - requires ADMIN role
    """
    replaceServerWorld(serverId: ID, uploadedFileName: String!): Boolean!

    """
    Non-destructively updates allowlisted Minecraft server.properties settings - requires ADMIN role
    """
    updateMinecraftServerSettings(serverId: ID, input: UpdateMinecraftServerSettingsInput!): MinecraftServerSettings!

    """
    Creates a scheduled server automation - requires ADMIN role
    """
    createServerAutomation(serverId: ID, input: ServerAutomationInput!): ServerAutomationItem!

    """
    Updates a scheduled server automation - requires ADMIN role
    """
    updateServerAutomation(serverId: ID, id: ID!, input: ServerAutomationInput!): ServerAutomationItem!

    """
    Manually triggers execution of a scheduled automation - requires ADMIN role
    """
    runServerAutomation(serverId: ID, id: ID!): Boolean!

    """
    Deletes a scheduled server automation - requires ADMIN role
    """
    deleteServerAutomation(serverId: ID, id: ID!): Boolean!

    """
    Creates a new folder within a sandboxed virtual root - requires ADMIN role
    """
    createServerFolder(serverId: ID, root: ServerFileRoot!, relativePath: String!, folderName: String!): Boolean!

    """
    Renames a file or folder within a sandboxed virtual root - requires ADMIN role
    """
    renameServerFile(serverId: ID, root: ServerFileRoot!, relativePath: String!, newName: String!): Boolean!

    """
    Deletes a file or directory within a sandboxed virtual root - requires ADMIN role
    """
    deleteServerFile(serverId: ID, root: ServerFileRoot!, relativePath: String!): Boolean!

    """
    Writes content to an allowlisted text file within a sandboxed virtual root - requires ADMIN role
    """
    writeServerTextFile(serverId: ID, root: ServerFileRoot!, relativePath: String!, content: String!): Boolean!

    """
    Prepares a signed upload URL for uploading a file into a sandboxed virtual root - requires ADMIN role
    """
    prepareServerFileUpload(serverId: ID, root: ServerFileRoot!, relativePath: String!): ServerSignedUrlPayload!

    """
    Generates a signed download URL for a file within a sandboxed virtual root - requires ADMIN role
    """
    createServerFileDownloadUrl(serverId: ID, root: ServerFileRoot!, relativePath: String!): ServerSignedUrlPayload!

    """
    Installs server content (SERVER mod or DATA_PACK) directly on the physical server - requires ADMIN role
    """
    installServerContentPlan(serverId: ID, input: InstallServerContentPlanInput!): [ServerManagedContentItem!]!

    """
    Installs multiple server contents (SERVER mod or DATA_PACK) directly on the physical server in batch - requires ADMIN role
    """
    installServerContentPlansBatch(serverId: ID, input: InstallServerContentPlansBatchInput!): [ServerManagedContentItem!]!

    """
    Removes server-direct managed content physically and from tracking - requires ADMIN role
    """
    removeServerManagedContent(serverId: ID, id: ID!): Boolean!

    """
    Applies release synchronization to server (syncs BOTH mods from published release to server) - requires ADMIN role
    """
    applyServerReleaseSync(serverId: ID, createBackup: Boolean): ServerReleaseSyncResult!
  }
`
