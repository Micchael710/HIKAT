export const launcherTypeDefs = /* GraphQL */ `
  """
  Publication status of a HiKAT Launcher desktop release
  """
  enum LauncherReleaseStatus {
    DRAFT
    PUBLISHED
    ARCHIVED
  }

  """
  HiKAT Launcher binary release entity
  """
  type LauncherRelease {
    id: ID!
    version: String!
    status: LauncherReleaseStatus!
    filename: String!
    sizeBytes: Int!
    sha512: String!
    notes: String
    createdAt: DateTime!
    publishedAt: DateTime
  }

  """
  Payload returned when requesting a direct R2 upload ticket for the launcher binary
  """
  type LauncherUploadTicketPayload {
    ticketId: ID!
    uploadToken: String!
    version: String!
    filename: String!
    objectKey: String!
    declaredSizeBytes: Int!
    sha512: String!
    bucketName: String!
    endpoint: String!
    credentials: R2TemporaryCredentials!
    expiresAt: DateTime!
  }

  extend type Query {
    """
    List all launcher desktop releases (Admin only)
    """
    launcherReleases: [LauncherRelease!]!

    """
    Get the currently active published launcher desktop release
    """
    publishedLauncherRelease: LauncherRelease
  }

  extend type Mutation {
    """
    Request a temporary upload ticket to upload a new launcher binary directly to R2 (Admin only)
    """
    requestLauncherReleaseUploadTicket(
      version: String!
      filename: String!
      declaredSizeBytes: Int!
      sha512: String!
    ): LauncherUploadTicketPayload!

    """
    Finalize launcher upload and register as a DRAFT release after verifying R2 size (Admin only)
    """
    completeLauncherReleaseUpload(
      uploadToken: String!
      notes: String
    ): LauncherRelease!

    """
    Publish a launcher release, automatically archiving any previously published release (Admin only)
    """
    publishLauncherRelease(id: ID!): LauncherRelease!

    """
    Delete an unpublished (DRAFT) launcher release, removing its R2 installer binary and database record (Admin only)
    """
    deleteLauncherRelease(id: ID!): Boolean!
  }
`
