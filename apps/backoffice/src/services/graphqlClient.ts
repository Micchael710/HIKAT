import type {
  NewsItem,
  NewsConnection,
  ContentMedia,
  ServerResources,
  ServerStatus,
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
  isRetry: boolean = false,
): Promise<T> {
  const token = authService.getAccessToken()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    throw new Error("No se pudo conectar con el servidor.")
  }

  // 1. Handle HTTP 401 Unauthenticated
  if (res.status === 401) {
    if (!isRetry) {
      const newToken = await authService.refresh()
      if (newToken) {
        return executeGraphQL<T>(query, variables, true)
      }
    }
    authService.clearSession()
    throw new Error("Su sesión ha expirado. Por favor inicie sesión nuevamente.")
  }

  const result = await res.json().catch(() => ({}))

  // 2. Handle GraphQL errors (including extensions.code === "UNAUTHENTICATED")
  if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
    const hasUnauthenticated = result.errors.some(
      (e: any) =>
        e.extensions?.code === "UNAUTHENTICATED" ||
        e.message === "UNAUTHENTICATED" ||
        e.message === "Authentication required",
    )

    if (hasUnauthenticated) {
      if (!isRetry) {
        const newToken = await authService.refresh()
        if (newToken) {
          return executeGraphQL<T>(query, variables, true)
        }
      }
      authService.clearSession()
      throw new Error("Su sesión ha expirado. Por favor inicie sesión nuevamente.")
    }

    const firstErr = result.errors[0]
    const code = firstErr.extensions?.code
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

export const serverApi = {
  async getServerStatus(): Promise<ServerResources> {
    const query = /* GraphQL */ `
      query ServerStatus {
        serverStatus {
          status
          cpuPercent
          cpuLimitPercent
          memoryUsedBytes
          memoryLimitBytes
          diskUsedBytes
          diskLimitBytes
          uptimeMs
          isSuspended
        }
      }
    `

    const data = await executeGraphQL<{ serverStatus: ServerResources }>(query)
    return data.serverStatus
  },

  async startServer(): Promise<{ success: boolean; status: ServerStatus; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation StartServer {
        startServer {
          success
          status
          message
        }
      }
    `

    const data = await executeGraphQL<{
      startServer: { success: boolean; status: ServerStatus; message?: string }
    }>(mutation)
    return data.startServer
  },

  async restartServer(): Promise<{ success: boolean; status: ServerStatus; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation RestartServer {
        restartServer {
          success
          status
          message
        }
      }
    `

    const data = await executeGraphQL<{
      restartServer: { success: boolean; status: ServerStatus; message?: string }
    }>(mutation)
    return data.restartServer
  },

  async stopServer(): Promise<{ success: boolean; status: ServerStatus; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation StopServer {
        stopServer {
          success
          status
          message
        }
      }
    `

    const data = await executeGraphQL<{
      stopServer: { success: boolean; status: ServerStatus; message?: string }
    }>(mutation)
    return data.stopServer
  },

  async sendServerCommand(
    command: string,
  ): Promise<{ success: boolean; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation SendServerCommand($command: String!) {
        sendServerCommand(command: $command) {
          success
          message
        }
      }
    `

    const data = await executeGraphQL<{
      sendServerCommand: { success: boolean; message?: string }
    }>(mutation, { command })
    return data.sendServerCommand
  },

  async createServerConsoleTicket(): Promise<{ ticket: string; expiresAt: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerConsoleTicket {
        createServerConsoleTicket {
          ticket
          expiresAt
        }
      }
    `

    const data = await executeGraphQL<{
      createServerConsoleTicket: { ticket: string; expiresAt: string }
    }>(mutation)
    return data.createServerConsoleTicket
  },
}


