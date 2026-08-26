export const dashboardTypeDefs = /* GraphQL */ `
  """
  Consolidated summary for the administrative dashboard
  """
  type AdminDashboardSummary {
    server: AdminDashboardServerSummary!
    news: AdminDashboardNewsSummary!
    skins: AdminDashboardSkinsSummary!
    game: AdminDashboardGameSummary!
  }

  type AdminDashboardServerSummary {
    status: ServerStatus!
  }


  type AdminDashboardNewsSummary {
    publishedCount: Int!
    draftCount: Int!
  }

  type AdminDashboardSkinsSummary {
    totalCount: Int!
    availableCount: Int!
  }

  type AdminDashboardGameSummary {
    publishedVersion: String
    publishedAt: DateTime
    pendingChangesCount: Int!
  }

  extend type Query {
    """
    Consolidated administrative dashboard statistics - requires ADMIN role.
    Resilient: survives upstream server/Pterodactyl errors.
    """
    adminDashboard: AdminDashboardSummary!
  }
`
