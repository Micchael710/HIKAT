export const contentTypeDefs = /* GraphQL */ `
  """
  Kind of content post
  """
  enum ContentPostKind {
    NEWS
    ANNOUNCEMENT
  }

  """
  Publication status of a content post
  """
  enum ContentPostStatus {
    DRAFT
    PUBLISHED
  }

  """
  Content Media entity stored in Cloudflare R2
  """
  type ContentMedia {
    id: ID!
    objectKey: String!
    mimeType: String!
    sizeBytes: Int!
    url: String!
    createdAt: DateTime!
  }

  """
  Content Post entity for official news and announcements
  """
  type ContentPost {
    id: ID!
    kind: ContentPostKind!
    slug: String!
    title: String!
    summary: String!
    bodyMarkdown: String!
    coverMediaId: ID
    coverMedia: ContentMedia
    status: ContentPostStatus!
    publishedAt: DateTime
    createdBy: ID!
    updatedBy: ID!
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
  Edge representing a content post in a paginated feed
  """
  type ContentPostEdge {
    node: ContentPost!
    cursor: String!
  }

  """
  Paginated connection of content posts
  """
  type ContentFeedConnection {
    edges: [ContentPostEdge!]!
    items: [ContentPost!]!
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

  input CreateContentPostInput {
    kind: ContentPostKind!
    slug: String!
    title: String!
    summary: String!
    bodyMarkdown: String!
    coverMediaId: ID
    status: ContentPostStatus
  }

  input UpdateContentPostInput {
    kind: ContentPostKind
    slug: String
    title: String
    summary: String
    bodyMarkdown: String
    coverMediaId: ID
    status: ContentPostStatus
  }

  input CreateContentMediaUploadInput {
    mimeType: String!
    sizeBytes: Int!
  }

  extend type Query {
    """
    Public feed of published news and announcements
    """
    contentFeed(
      first: Int
      after: String
      kind: ContentPostKind
    ): ContentFeedConnection!

    """
    Public lookup of a published content post by its unique slug
    """
    contentPost(slug: String!): ContentPost

    """
    Administrative list of content posts (drafts and published) - requires ADMIN role
    """
    adminContentPosts(
      first: Int
      after: String
      kind: ContentPostKind
      status: ContentPostStatus
    ): ContentFeedConnection!

    """
    Administrative lookup of a content post by ID or slug - requires ADMIN role
    """
    adminContentPost(id: ID, slug: String): ContentPost
  }

  type Mutation {
    """
    Create a new content post - requires ADMIN role
    """
    createContentPost(input: CreateContentPostInput!): ContentPost!

    """
    Update an existing content post - requires ADMIN role
    """
    updateContentPost(id: ID!, input: UpdateContentPostInput!): ContentPost!

    """
    Publish a content post (sets status to PUBLISHED and publishedAt to now) - requires ADMIN role
    """
    publishContentPost(id: ID!): ContentPost!

    """
    Unpublish a content post (sets status to DRAFT and publishedAt to null) - requires ADMIN role
    """
    unpublishContentPost(id: ID!): ContentPost!

    """
    Delete a content post - requires ADMIN role
    """
    deleteContentPost(id: ID!): Boolean!

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
