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
  }

  type ServerAutomationItem {
    id: ID!
    name: String!
    action: ServerAutomationAction!
    frequency: ServerAutomationFrequency!
    time: String!
    weekday: Int
    weekdays: [Int!]
    command: String
    enabled: Boolean!
    isProcessing: Boolean!
    lastRunAt: String
    nextRunAt: String
  }

  input ServerAutomationInput {
    name: String!
    action: ServerAutomationAction!
    frequency: ServerAutomationFrequency!
    time: String!
    weekday: Int
    weekdays: [Int!]
    command: String
    enabled: Boolean
  }

  enum ServerFileRoot {
    WORLD
    CONFIG
    MODS
    LOGS
  }

  type ServerFileItem {
    name: String!
    isFile: Boolean!
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

  extend type Query {
    """
    Retrieves current server operational status and resource metrics - requires ADMIN role
    """
    serverStatus: ServerResources

    """
    Retrieves recent server activity events - requires ADMIN role
    """
    serverActivity: [ServerActivityItem!]!

    """
    Lists all server backups - requires ADMIN role
    """
    serverBackups: [ServerBackupItem!]!

    """
    Retrieves information on currently active world - requires ADMIN role
    """
    serverWorld: ServerWorldInfo!

    """
    Retrieves parsed Minecraft server.properties settings - requires ADMIN role
    """
    serverMinecraftSettings: MinecraftServerSettings!

    """
    Lists automated schedules - requires ADMIN role
    """
    serverAutomations: [ServerAutomationItem!]!

    """
    Lists files and directories within a sandboxed virtual root - requires ADMIN role
    """
    serverFiles(root: ServerFileRoot!, relativePath: String): [ServerFileItem!]!

    """
    Reads an allowlisted text file from a sandboxed virtual root - requires ADMIN role
    """
    serverTextFile(root: ServerFileRoot!, relativePath: String!): ServerFileContent!
  }

  extend type Mutation {
    """
    Requests a short-lived single-use ticket for connecting to the live server console WebSocket - requires ADMIN role
    """
    createServerConsoleTicket: ServerConsoleTicketPayload!

    """
    Executes a power action on the server (START, RESTART, STOP) - requires ADMIN role
    """
    serverPowerAction(action: ServerPowerAction!): ServerPowerActionResult!

    """
    Starts the server - requires ADMIN role
    """
    startServer: ServerPowerActionResult!

    """
    Restarts the server - requires ADMIN role
    """
    restartServer: ServerPowerActionResult!

    """
    Stops the server - requires ADMIN role
    """
    stopServer: ServerPowerActionResult!

    """
    Sends a console command to the Minecraft server - requires ADMIN role
    """
    sendServerCommand(command: String!): ServerCommandResult!

    """
    Creates a new server backup - requires ADMIN role
    """
    createServerBackup(name: String): ServerBackupItem!

    """
    Restores a server backup (requires server to be OFFLINE) - requires ADMIN role
    """
    restoreServerBackup(id: ID!): Boolean!

    """
    Deletes a server backup (must not be locked) - requires ADMIN role
    """
    deleteServerBackup(id: ID!): Boolean!

    """
    Toggles lock protection on a backup - requires ADMIN role
    """
    toggleServerBackupLock(id: ID!): ServerBackupItem!

    """
    Generates a secure signed download URL for a backup - requires ADMIN role
    """
    createServerBackupDownloadUrl(id: ID!, name: String): ServerSignedUrlPayload!

    """
    Compresses and generates a secure download URL for the active world - requires ADMIN role
    """
    createServerWorldDownloadUrl: ServerSignedUrlPayload!

    """
    Prepares a temporary signed upload URL for world upload - requires ADMIN role
    """
    prepareServerWorldUpload: ServerSignedUrlPayload!

    """
    Replaces the active world with an uploaded archive (requires server to be OFFLINE, creates automatic pre-backup) - requires ADMIN role
    """
    replaceServerWorld(uploadedFileName: String!): Boolean!

    """
    Non-destructively updates allowlisted Minecraft server.properties settings - requires ADMIN role
    """
    updateMinecraftServerSettings(input: UpdateMinecraftServerSettingsInput!): MinecraftServerSettings!

    """
    Creates a scheduled server automation - requires ADMIN role
    """
    createServerAutomation(input: ServerAutomationInput!): ServerAutomationItem!

    """
    Updates a scheduled server automation - requires ADMIN role
    """
    updateServerAutomation(id: ID!, input: ServerAutomationInput!): ServerAutomationItem!

    """
    Manually triggers execution of a scheduled automation - requires ADMIN role
    """
    runServerAutomation(id: ID!): Boolean!

    """
    Deletes a scheduled server automation - requires ADMIN role
    """
    deleteServerAutomation(id: ID!): Boolean!

    """
    Creates a new folder within a sandboxed virtual root - requires ADMIN role
    """
    createServerFolder(root: ServerFileRoot!, relativePath: String!, folderName: String!): Boolean!

    """
    Renames a file or folder within a sandboxed virtual root - requires ADMIN role
    """
    renameServerFile(root: ServerFileRoot!, relativePath: String!, newName: String!): Boolean!

    """
    Deletes a file or directory within a sandboxed virtual root - requires ADMIN role
    """
    deleteServerFile(root: ServerFileRoot!, relativePath: String!): Boolean!

    """
    Writes content to an allowlisted text file within a sandboxed virtual root - requires ADMIN role
    """
    writeServerTextFile(root: ServerFileRoot!, relativePath: String!, content: String!): Boolean!

    """
    Prepares a signed upload URL for uploading a file into a sandboxed virtual root - requires ADMIN role
    """
    prepareServerFileUpload(root: ServerFileRoot!, relativePath: String!): ServerSignedUrlPayload!

    """
    Generates a signed download URL for a file within a sandboxed virtual root - requires ADMIN role
    """
    createServerFileDownloadUrl(root: ServerFileRoot!, relativePath: String!): ServerSignedUrlPayload!
  }
`
