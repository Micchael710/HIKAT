export const settingsTypeDefs = /* GraphQL */ `
  """
  Full project and launcher configuration for administrators
  """
  type AdminSettings {
    projectName: String!
    maintenanceEnabled: Boolean!
    maintenanceMessage: String!
    serverIp: String!
    serverPort: Int!
    discordUrl: String
    websiteUrl: String
    minRamGb: Int!
    recommendedRamGb: Int!
    updatedAt: DateTime!
  }

  """
  Public client configuration subset consumed by the HiKAT Launcher
  """
  type ClientConfiguration {
    projectName: String!
    serverIp: String!
    serverPort: Int!
    discordUrl: String
    websiteUrl: String
    maintenanceEnabled: Boolean!
    maintenanceMessage: String
    minRamGb: Int!
    recommendedRamGb: Int!
  }

  input UpdateAdminSettingsInput {
    projectName: String
    maintenanceEnabled: Boolean
    maintenanceMessage: String
    serverIp: String
    serverPort: Int
    discordUrl: String
    websiteUrl: String
    minRamGb: Int
    recommendedRamGb: Int
  }

  extend type Query {
    """
    Public configuration subset for the HiKAT Launcher
    """
    clientConfiguration: ClientConfiguration!

    """
    Complete configuration for administrators - requires ADMIN role
    """
    adminSettings: AdminSettings!
  }

  extend type Mutation {
    """
    Update project and launcher settings - requires ADMIN role
    """
    updateAdminSettings(input: UpdateAdminSettingsInput!): AdminSettings!
  }
`
