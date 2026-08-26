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

  extend type Query {
    """
    Retrieves current server operational status and resource metrics - requires ADMIN role
    """
    serverStatus: ServerResources
  }

  extend type Mutation {
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
  }
`
