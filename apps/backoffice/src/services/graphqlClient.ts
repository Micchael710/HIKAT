import type {
  NewsItem,
  NewsConnection,
  ContentMedia,
} from "../types"
import type { NewsType, NewsStatus } from "@hikat/shared"
import { authService } from "./authService"

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787"
const GRAPHQL_ENDPOINT = `${BACKEND_URL}/graphql`

export interface CreateNewsInput {
  title: string
  content: string
  type: NewsType
  imageMediaId?: string | null
  youtubeUrl?: string | null
  videoMediaId?: string | null
  status?: NewsStatus
}

export interface UpdateNewsInput {
  title?: string
  content?: string
  type?: NewsType
  imageMediaId?: string | null
  youtubeUrl?: string | null
  videoMediaId?: string | null
  status?: NewsStatus
}

export interface CreateMediaUploadTicketInput {
  mimeType: string
  sizeBytes: number
}

export interface MediaUploadTicketPayload {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
  maxSizeBytes: number
  expectedMimeType: string
  allowedMimeTypes: string[]
}

const NEWS_FIELDS = `
  id
  title
  content
  type
  image {
    id
    mediaType
    mimeType
    sizeBytes
    url
    createdAt
  }
  youtubeVideoId
  youtubeUrl
  video {
    id
    mediaType
    mimeType
    sizeBytes
    url
    createdAt
  }
  status
  publishedAt
  createdAt
  updatedAt
`

export async function executeGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = authService.getAccessToken()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const sendRequest = async (authHeader?: string) => {
    const reqHeaders = { ...headers }
    if (authHeader) {
      reqHeaders["Authorization"] = authHeader
    }

    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ query, variables }),
    })

    if (!res.ok && res.status === 401) {
      throw new Error("UNAUTHENTICATED")
    }

    return res.json()
  }

  let result
  try {
    result = await sendRequest()
  } catch (err: any) {
    if (err.message === "UNAUTHENTICATED") {
      const newToken = await authService.refresh()
      if (newToken) {
        result = await sendRequest(`Bearer ${newToken}`)
      } else {
        throw new Error("Su sesión ha expirado. Por favor inicie sesión nuevamente.")
      }
    } else {
      throw new Error("No se pudo conectar con el servidor.")
    }
  }

  if (result.errors && result.errors.length > 0) {
    const firstErr = result.errors[0]
    const code = firstErr.extensions?.code
    if (code === "UNAUTHENTICATED") {
      throw new Error("Sesión no autorizada o expirada.")
    }
    if (code === "FORBIDDEN") {
      throw new Error("No tiene permisos suficientes para realizar esta acción.")
    }
    if (code === "VALIDATION_ERROR") {
      throw new Error(firstErr.message || "Los datos ingresados no son válidos.")
    }
    if (code === "NOT_FOUND") {
      throw new Error("El elemento solicitado no fue encontrado.")
    }
    throw new Error(firstErr.message || "Ocurrió un error al procesar la solicitud.")
  }

  return result.data as T
}

export const newsApi = {
  async getAdminNews(options?: {
    first?: number
    after?: string
    type?: NewsType | null
    status?: NewsStatus | null
  }): Promise<NewsConnection> {
    const query = /* GraphQL */ `
      query AdminNews($first: Int, $after: String, $type: NewsType, $status: NewsStatus) {
        adminNews(first: $first, after: $after, type: $type, status: $status) {
          items {
            ${NEWS_FIELDS}
          }
          totalCount
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `

    const data = await executeGraphQL<{ adminNews: NewsConnection }>(query, {
      first: options?.first ?? 50,
      after: options?.after ?? null,
      type: options?.type ?? null,
      status: options?.status ?? null,
    })

    return data.adminNews
  },

  async getAdminNewsItem(id: string): Promise<NewsItem | null> {
    const query = /* GraphQL */ `
      query AdminNewsItem($id: ID!) {
        adminNewsItem(id: $id) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ adminNewsItem: NewsItem | null }>(query, { id })
    return data.adminNewsItem
  },

  async createNews(input: CreateNewsInput): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation CreateNews($input: CreateNewsInput!) {
        createNews(input: $input) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ createNews: NewsItem }>(mutation, { input })
    return data.createNews
  },

  async updateNews(id: string, input: UpdateNewsInput): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateNews($id: ID!, $input: UpdateNewsInput!) {
        updateNews(id: $id, input: $input) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ updateNews: NewsItem }>(mutation, { id, input })
    return data.updateNews
  },

  async publishNews(id: string): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation PublishNews($id: ID!) {
        publishNews(id: $id) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ publishNews: NewsItem }>(mutation, { id })
    return data.publishNews
  },

  async unpublishNews(id: string): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation UnpublishNews($id: ID!) {
        unpublishNews(id: $id) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ unpublishNews: NewsItem }>(mutation, { id })
    return data.unpublishNews
  },

  async deleteNews(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteNews($id: ID!) {
        deleteNews(id: $id)
      }
    `

    const data = await executeGraphQL<{ deleteNews: boolean }>(mutation, { id })
    return data.deleteNews
  },

  async createContentMediaUpload(
    input: CreateMediaUploadTicketInput,
  ): Promise<MediaUploadTicketPayload> {
    const mutation = /* GraphQL */ `
      mutation CreateContentMediaUpload($input: CreateContentMediaUploadInput!) {
        createContentMediaUpload(input: $input) {
          uploadUrl
          uploadToken
          expiresAt
          maxSizeBytes
          expectedMimeType
          allowedMimeTypes
        }
      }
    `

    const data = await executeGraphQL<{
      createContentMediaUpload: MediaUploadTicketPayload
    }>(mutation, { input })

    return data.createContentMediaUpload
  },

  async deleteContentMedia(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteContentMedia($id: ID!) {
        deleteContentMedia(id: $id)
      }
    `

    const data = await executeGraphQL<{ deleteContentMedia: boolean }>(mutation, { id })
    return data.deleteContentMedia
  },
}
