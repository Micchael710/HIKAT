import type {
  AppRole,
  ContentPostKind,
  ContentPostStatus,
  MediaMimeType,
} from "@hikat/shared"

export type RoleGql = AppRole

export interface UserGql {
  id: string
  role: RoleGql
  displayName: string | null
  createdAt: string
  updatedAt: string
}

export interface HealthStatusGql {
  status: string
  service: string
  version: string
  timestamp: string
}

export interface AdminStatusGql {
  ok: boolean
  serverTime: string
  environment: string
}

export interface ContentMediaGql {
  id: string
  objectKey: string
  mimeType: MediaMimeType | string
  sizeBytes: number
  url: string
  createdAt: string
}

export interface ContentPostGql {
  id: string
  kind: ContentPostKind
  slug: string
  title: string
  summary: string
  bodyMarkdown: string
  coverMediaId?: string | null
  coverMedia?: ContentMediaGql | null
  status: ContentPostStatus
  publishedAt?: string | null
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export interface PageInfoGql {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

export interface ContentPostEdgeGql {
  node: ContentPostGql
  cursor: string
}

export interface ContentFeedConnectionGql {
  edges: ContentPostEdgeGql[]
  items: ContentPostGql[]
  pageInfo: PageInfoGql
  totalCount: number
}

export interface ContentMediaUploadPayloadGql {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
  maxSizeBytes: number
  expectedMimeType: string
  allowedMimeTypes: string[]
}

export interface CreateContentPostInputGql {
  kind: ContentPostKind
  slug: string
  title: string
  summary: string
  bodyMarkdown: string
  coverMediaId?: string | null
  status?: ContentPostStatus | null
}

export interface UpdateContentPostInputGql {
  kind?: ContentPostKind | null
  slug?: string | null
  title?: string | null
  summary?: string | null
  bodyMarkdown?: string | null
  coverMediaId?: string | null
  status?: ContentPostStatus | null
}

export interface CreateContentMediaUploadInputGql {
  mimeType: string
  sizeBytes: number
}

