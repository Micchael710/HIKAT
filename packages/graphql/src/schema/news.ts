export const newsTypeDefs = /* GraphQL */ `
  """
  Type category of news article
  """
  enum NewsType {
    NEWS
    UPDATE
    ANNOUNCEMENT
    MAINTENANCE
  }

  """
  Publication status of a news article
  """
  enum NewsStatus {
    DRAFT
    PUBLISHED
  }

  """
  Type of media asset
  """
  enum MediaType {
    IMAGE
    VIDEO
  }

  """
  Content Media entity stored in Cloudflare R2
  """
  type ContentMedia {
    id: ID!
    mediaType: MediaType!
    mimeType: String!
    sizeBytes: Int!
    url: String!
    createdAt: DateTime!
  }

  """
  Official HiKAT News entity
  """
  type News {
    id: ID!
    title: String!
    content: String!
    type: NewsType!
    image: ContentMedia
    youtubeVideoId: String
    youtubeUrl: String
    video: ContentMedia
    status: NewsStatus!
    publishedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  """
  Connection page info for cursor-based pagination
  """
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  """
  Edge representing a news article in a paginated feed
  """
  type NewsEdge {
    node: News!
    cursor: String!
  }

  """
  Paginated connection of news articles
  """
  type NewsConnection {
    edges: [NewsEdge!]!
    items: [News!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  """
  Payload returned when requesting a media upload ticket
  """
  type ContentMediaUploadPayload {
    uploadUrl: String!
    uploadToken: String!
    expiresAt: DateTime!
    maxSizeBytes: Int!
    expectedMimeType: String!
    allowedMimeTypes: [String!]!
  }

  input CreateNewsInput {
    title: String!
    content: String!
    type: NewsType!
    imageMediaId: ID
    youtubeUrl: String
    videoMediaId: ID
    status: NewsStatus
  }

  input UpdateNewsInput {
    title: String
    content: String
    type: NewsType
    imageMediaId: ID
    youtubeUrl: String
    videoMediaId: ID
    status: NewsStatus
  }

  input CreateContentMediaUploadInput {
    mimeType: String!
    sizeBytes: Int!
  }

  extend type Query {
    """
    Public feed of published news articles
    """
    newsFeed(
      first: Int
      after: String
      type: NewsType
    ): NewsConnection!

    """
    Public lookup of a published news article by ID
    """
    news(id: ID!): News

    """
    Administrative list of news articles (drafts and published) - requires ADMIN role
    """
    adminNews(
      first: Int
      after: String
      type: NewsType
      status: NewsStatus
    ): NewsConnection!

    """
    Administrative lookup of a news article by ID - requires ADMIN role
    """
    adminNewsItem(id: ID!): News
  }

  type Mutation {
    """
    Create a new news article - requires ADMIN role
    """
    createNews(input: CreateNewsInput!): News!

    """
    Update an existing news article - requires ADMIN role
    """
    updateNews(id: ID!, input: UpdateNewsInput!): News!

    """
    Publish a news article (sets status to PUBLISHED and publishedAt to now) - requires ADMIN role
    """
    publishNews(id: ID!): News!

    """
    Unpublish a news article (sets status to DRAFT and publishedAt to null) - requires ADMIN role
    """
    unpublishNews(id: ID!): News!

    """
    Delete a news article - requires ADMIN role
    """
    deleteNews(id: ID!): Boolean!

    """
    Request a single-use token to upload binary media - requires ADMIN role
    """
    createContentMediaUpload(input: CreateContentMediaUploadInput!): ContentMediaUploadPayload!

    """
    Delete a media asset from D1 and R2 - requires ADMIN role
    """
    deleteContentMedia(id: ID!): Boolean!
  }
`
