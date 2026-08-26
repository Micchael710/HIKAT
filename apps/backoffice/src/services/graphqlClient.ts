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

export function resolveMediaUrl(url?: string | null): string {
  if (!url || typeof url !== "string" || !url.trim()) return ""
  const trimmed = url.trim()
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed
  }
  const cleanBase = BACKEND_URL.replace(/\/$/, "")
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${cleanBase}${cleanPath}`
}


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
    if (code === "NOT_FOUND") {
      throw new Error("El elemento solicitado no fue encontrado.")
    }

    const KNOWN_SAFE_USER_CODES = ["VALIDATION_ERROR", "CONFLICT", "SERVER_BUSY"]
    if (code && KNOWN_SAFE_USER_CODES.includes(code) && firstErr.message) {
      const raw = firstErr.message.toLowerCase()
      if (
        !raw.includes("sql") &&
        !raw.includes("sqlite") &&
        !raw.includes("select ") &&
        !raw.includes("datetime") &&
        !raw.includes("iso-8601") &&
        !raw.includes("database")
      ) {
        throw new Error(firstErr.message)
      }
    }

    throw new Error("Ocurrió un error al procesar la solicitud.")
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

// --- Dashboard API Facade (Shard 06.5) ---

export const dashboardApi = {
  async getAdminDashboard(): Promise<import("../types").AdminDashboardSummary> {
    const query = /* GraphQL */ `
      query AdminDashboard {
        adminDashboard {
          server {
            status
          }
          news {
            publishedCount
            draftCount
          }
          skins {
            totalCount
            availableCount
          }
          game {
            publishedVersion
            publishedAt
            pendingChangesCount
          }
        }
      }
    `
    const data = await executeGraphQL<{ adminDashboard: import("../types").AdminDashboardSummary }>(query)
    return data.adminDashboard
  },
}

// --- Skins API Facade (Shard 06.5) ---

export const skinsApi = {
  async getAdminSkins(params?: { status?: string | null }): Promise<import("../types").SkinConnection> {
    const query = /* GraphQL */ `
      query AdminSkins($status: SkinStatus) {
        adminSkins(status: $status) {
          items {
            id
            name
            model
            imageUrl
            status
            createdAt
            updatedAt
          }
          totalCount
        }
      }
    `
    const data = await executeGraphQL<{ adminSkins: import("../types").SkinConnection }>(query, {
      status: params?.status === "ALL" ? null : params?.status,
    })
    return data.adminSkins
  },

  async createSkin(input: {
    name: string
    model?: string
    mediaId: string
    status?: string
  }): Promise<import("../types").SkinItem> {
    const mutation = /* GraphQL */ `
      mutation CreateSkin($input: CreateSkinInput!) {
        createSkin(input: $input) {
          id
          name
          model
          imageUrl
          status
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ createSkin: import("../types").SkinItem }>(mutation, { input })
    return data.createSkin
  },

  async updateSkin(
    id: string,
    input: { name?: string; model?: string; mediaId?: string; status?: string },
  ): Promise<import("../types").SkinItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateSkin($id: ID!, $input: UpdateSkinInput!) {
        updateSkin(id: $id, input: $input) {
          id
          name
          model
          imageUrl
          status
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ updateSkin: import("../types").SkinItem }>(mutation, { id, input })
    return data.updateSkin
  },

  async deleteSkin(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteSkin($id: ID!) {
        deleteSkin(id: $id)
      }
    `
    const data = await executeGraphQL<{ deleteSkin: boolean }>(mutation, { id })
    return data.deleteSkin
  },
}

// --- Game & Updates API Facade (Shard 06.5) ---

export const gameApi = {
  async getAdminGameOverview(): Promise<import("../types").AdminGameOverview> {
    const query = /* GraphQL */ `
      query AdminGameOverview {
        adminGameOverview {
          publishedRelease {
            id
            version
            minecraftVersion
            neoForgeVersion
            status
            notes
            publishedAt
            files {
              id
              name
              logicalPath
              category
              sha256
              sizeBytes
              policy
              createdAt
            }
            createdAt
            updatedAt
          }
          draftRelease {
            id
            version
            minecraftVersion
            neoForgeVersion
            status
            notes
            publishedAt
            files {
              id
              name
              logicalPath
              category
              sha256
              sizeBytes
              policy
              changeStatus
              createdAt
            }
            createdAt
            updatedAt
          }
          pendingChangesCount
          changes {
            added
            updated
            removed
            unchanged
            total
          }
          readiness {
            isReady
            validVersion
            noConflicts
            storageVerified
            issues
          }
        }
      }
    `
    const data = await executeGraphQL<{ adminGameOverview: import("../types").AdminGameOverview }>(query)
    return data.adminGameOverview
  },

  async getGameReleaseHistory(): Promise<import("../types").GameRelease[]> {
    const query = /* GraphQL */ `
      query GameReleaseHistory {
        gameReleaseHistory {
          id
          version
          minecraftVersion
          neoForgeVersion
          status
          notes
          publishedAt
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
            createdAt
          }
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ gameReleaseHistory: import("../types").GameRelease[] }>(query)
    return data.gameReleaseHistory
  },

  async prepareGameDraft(): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation PrepareGameDraft {
        prepareGameDraft {
          id
          version
          status
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
          }
        }
      }
    `
    const data = await executeGraphQL<{ prepareGameDraft: import("../types").GameRelease }>(mutation)
    return data.prepareGameDraft
  },

  async discardGameDraft(): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DiscardGameDraft {
        discardGameDraft
      }
    `
    const data = await executeGraphQL<{ discardGameDraft: boolean }>(mutation)
    return data.discardGameDraft
  },

  async createGameFileUpload(input: {
    category: string
    originalFilename: string
    sizeBytes: number
  }): Promise<{
    uploadUrl: string
    uploadToken: string
    maxSizeBytes: number
    expectedCategory: string
  }> {
    const mutation = /* GraphQL */ `
      mutation CreateGameFileUpload($input: CreateGameFileUploadInput!) {
        createGameFileUpload(input: $input) {
          uploadUrl
          uploadToken
          maxSizeBytes
          expectedCategory
        }
      }
    `
    const data = await executeGraphQL<{ createGameFileUpload: any }>(mutation, { input })
    return data.createGameFileUpload
  },

  async uploadGameBinary(
    file: File,
    uploadUrl: string,
    uploadToken: string,
  ): Promise<{ tokenHash: string; originalFilename?: string; sizeBytes?: number }> {

    const token = authService.getAccessToken()
    const targetUrl = uploadUrl.startsWith("http") ? uploadUrl : `${BACKEND_URL}${uploadUrl}`

    const res = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Upload-Token": uploadToken,
      },
      body: file,
    })

    if (!res.ok) {
      let errMessage = "Error al subir el archivo de juego."
      try {
        const json = await res.json()
        if (json.error) errMessage = json.error
      } catch {}
      throw new Error(errMessage)
    }

    return res.json()
  },

  async addGameFile(input: {
    name: string
    category?: string
    tokenHash: string
  }): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation AddGameFile($input: AddGameFileInput!) {
        addGameFile(input: $input) {
          id
          name
          logicalPath
          category
          sha256
          sizeBytes
          policy
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ addGameFile: import("../types").AdminGameFile }>(mutation, { input })
    return data.addGameFile
  },

  async updateGameFile(
    id: string,
    input: { name?: string; category?: string; tokenHash?: string },
  ): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation UpdateGameFile($id: ID!, $input: UpdateGameFileInput!) {
        updateGameFile(id: $id, input: $input) {
          id
          name
          logicalPath
          category
          sha256
          sizeBytes
          policy
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ updateGameFile: import("../types").AdminGameFile }>(mutation, { id, input })
    return data.updateGameFile
  },

  async removeGameFile(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RemoveGameFile($id: ID!) {
        removeGameFile(id: $id)
      }
    `
    const data = await executeGraphQL<{ removeGameFile: boolean }>(mutation, { id })
    return data.removeGameFile
  },

  async restoreGameFile(id: string): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation RestoreGameFile($id: ID!) {
        restoreGameFile(id: $id) {
          id
          name
          logicalPath
          category
          sha256
          sizeBytes
          policy
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ restoreGameFile: import("../types").AdminGameFile }>(mutation, { id })
    return data.restoreGameFile
  },

  async publishGameRelease(input: {
    version: string
    notes?: string
  }): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `

      mutation PublishGameRelease($input: PublishGameReleaseInput!) {
        publishGameRelease(input: $input) {
          id
          version
          minecraftVersion
          neoForgeVersion
          status
          notes
          publishedAt
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
            createdAt
          }
        }
      }
    `
    const data = await executeGraphQL<{ publishGameRelease: import("../types").GameRelease }>(mutation, { input })
    return data.publishGameRelease
  },
}


// --- Settings API Facade (Shard 06.5) ---

export const settingsApi = {
  async getAdminSettings(): Promise<import("../types").AdminSettings> {
    const query = /* GraphQL */ `
      query AdminSettings {
        adminSettings {
          projectName
          maintenanceEnabled
          maintenanceMessage
          serverIp
          serverPort
          discordUrl
          websiteUrl
          minRamGb
          recommendedRamGb
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ adminSettings: import("../types").AdminSettings }>(query)
    return data.adminSettings
  },

  async updateAdminSettings(input: {
    projectName?: string
    maintenanceEnabled?: boolean
    maintenanceMessage?: string
    serverIp?: string
    serverPort?: number
    discordUrl?: string
    websiteUrl?: string
    minRamGb?: number
    recommendedRamGb?: number
  }): Promise<import("../types").AdminSettings> {
    const mutation = /* GraphQL */ `
      mutation UpdateAdminSettings($input: UpdateAdminSettingsInput!) {
        updateAdminSettings(input: $input) {
          projectName
          maintenanceEnabled
          maintenanceMessage
          serverIp
          serverPort
          discordUrl
          websiteUrl
          minRamGb
          recommendedRamGb
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ updateAdminSettings: import("../types").AdminSettings }>(mutation, { input })
    return data.updateAdminSettings
  },
}



