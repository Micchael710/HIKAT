import type {
  NewsItem,
  NewsConnection,
  ContentMedia,
  ServerResources,
  ServerStatus,
  ServerActivityItem,
  ServerBackupItem,
  ServerWorldInfo,
  MinecraftServerSettings,
  UpdateMinecraftServerSettingsInput,
  ServerAutomationItem,
  ServerAutomationInput,
  ServerFileRoot,
  ServerFileItem,
  ServerFileContent,
} from "../types"

import type { NewsType, NewsStatus } from "@hikat/shared"

import { authService } from "./authService"

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || "http://127.0.0.1:8787"
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
          networkRxBytes
          networkTxBytes
          uptimeMs
          isSuspended
        }
      }
    `

    const data = await executeGraphQL<{ serverStatus: ServerResources }>(query)
    return data.serverStatus
  },

  async getServerActivity(): Promise<ServerActivityItem[]> {
    const query = /* GraphQL */ `
      query ServerActivity {
        serverActivity {
          id
          description
          eventType
          timestamp
        }
      }
    `

    const data = await executeGraphQL<{ serverActivity: ServerActivityItem[] }>(query)
    return data.serverActivity || []
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

  // --- Backups API ---

  async getServerBackups(): Promise<ServerBackupItem[]> {
    const query = /* GraphQL */ `
      query ServerBackups {
        serverBackups {
          id
          name
          bytes
          createdAt
          completedAt
          isSuccessful
          isLocked
        }
      }
    `

    const data = await executeGraphQL<{ serverBackups: ServerBackupItem[] }>(query)
    return data.serverBackups || []
  },

  async createServerBackup(name?: string): Promise<ServerBackupItem> {
    const mutation = /* GraphQL */ `
      mutation CreateServerBackup($name: String) {
        createServerBackup(name: $name) {
          id
          name
          bytes
          createdAt
          completedAt
          isSuccessful
          isLocked
        }
      }
    `

    const data = await executeGraphQL<{ createServerBackup: ServerBackupItem }>(mutation, { name })
    return data.createServerBackup
  },

  async restoreServerBackup(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RestoreServerBackup($id: ID!) {
        restoreServerBackup(id: $id)
      }
    `

    const data = await executeGraphQL<{ restoreServerBackup: boolean }>(mutation, { id })
    return data.restoreServerBackup
  },

  async deleteServerBackup(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServerBackup($id: ID!) {
        deleteServerBackup(id: $id)
      }
    `

    const data = await executeGraphQL<{ deleteServerBackup: boolean }>(mutation, { id })
    return data.deleteServerBackup
  },

  async toggleServerBackupLock(id: string): Promise<ServerBackupItem> {
    const mutation = /* GraphQL */ `
      mutation ToggleServerBackupLock($id: ID!) {
        toggleServerBackupLock(id: $id) {
          id
          name
          bytes
          createdAt
          completedAt
          isSuccessful
          isLocked
        }
      }
    `

    const data = await executeGraphQL<{ toggleServerBackupLock: ServerBackupItem }>(mutation, { id })
    return data.toggleServerBackupLock
  },

  async createServerBackupDownloadUrl(id: string, name?: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerBackupDownloadUrl($id: ID!, $name: String) {
        createServerBackupDownloadUrl(id: $id, name: $name) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ createServerBackupDownloadUrl: { url: string } }>(mutation, { id, name })
    return data.createServerBackupDownloadUrl
  },

  // --- World API ---

  async getServerWorld(): Promise<ServerWorldInfo> {
    const query = /* GraphQL */ `
      query ServerWorld {
        serverWorld {
          name
          sizeBytes
          lastModified
        }
      }
    `

    const data = await executeGraphQL<{ serverWorld: ServerWorldInfo }>(query)
    return data.serverWorld
  },

  async createServerWorldDownloadUrl(): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerWorldDownloadUrl {
        createServerWorldDownloadUrl {
          url
        }
      }
    `

    const data = await executeGraphQL<{ createServerWorldDownloadUrl: { url: string } }>(mutation)
    return data.createServerWorldDownloadUrl
  },

  async prepareServerWorldUpload(): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation PrepareServerWorldUpload {
        prepareServerWorldUpload {
          url
        }
      }
    `

    const data = await executeGraphQL<{ prepareServerWorldUpload: { url: string } }>(mutation)
    return data.prepareServerWorldUpload
  },

  async replaceServerWorld(uploadedFileName: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation ReplaceServerWorld($uploadedFileName: String!) {
        replaceServerWorld(uploadedFileName: $uploadedFileName)
      }
    `

    const data = await executeGraphQL<{ replaceServerWorld: boolean }>(mutation, { uploadedFileName })
    return data.replaceServerWorld
  },

  /**
   * Performs real HTTP transfer of File bytes to a Pterodactyl Wings signed upload URL.
   * Validates HTTP response.ok before completing.
   */
  async uploadFileToSignedUrl(uploadUrl: string, file: File): Promise<void> {
    const formData = new FormData()
    formData.append("files", file, file.name)
    const res = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    })
    if (!res.ok) {
      throw new Error(`Fallo en la transferencia del archivo (${res.status} ${res.statusText}).`)
    }
  },

  // --- Minecraft Configuration API ---

  async getMinecraftServerSettings(): Promise<MinecraftServerSettings> {
    const query = /* GraphQL */ `
      query ServerMinecraftSettings {
        serverMinecraftSettings {
          difficulty
          maxPlayers
          pvp
          whitelist
          viewDistance
          simulationDistance
          motd
          allowFlight
        }
      }
    `

    const data = await executeGraphQL<{ serverMinecraftSettings: MinecraftServerSettings }>(query)
    return data.serverMinecraftSettings
  },

  async updateMinecraftServerSettings(input: UpdateMinecraftServerSettingsInput): Promise<MinecraftServerSettings> {
    const mutation = /* GraphQL */ `
      mutation UpdateMinecraftServerSettings($input: UpdateMinecraftServerSettingsInput!) {
        updateMinecraftServerSettings(input: $input) {
          difficulty
          maxPlayers
          pvp
          whitelist
          viewDistance
          simulationDistance
          motd
          allowFlight
        }
      }
    `

    const data = await executeGraphQL<{ updateMinecraftServerSettings: MinecraftServerSettings }>(mutation, { input })
    return data.updateMinecraftServerSettings
  },

  // --- Automations / Schedules API ---

  async getServerAutomations(): Promise<ServerAutomationItem[]> {
    const query = /* GraphQL */ `
      query ServerAutomations {
        serverAutomations {
          id
          name
          template
          action
          frequency
          time
          intervalHours
          weekday
          weekdays
          command
          delaySeconds
          humanSchedule
          enabled
          isProcessing
          isAdvanced
          isManaged
          lastRunAt
          nextRunAt
        }
      }
    `

    const data = await executeGraphQL<{ serverAutomations: ServerAutomationItem[] }>(query)
    return data.serverAutomations || []
  },

  async createServerAutomation(input: ServerAutomationInput): Promise<ServerAutomationItem> {
    const mutation = /* GraphQL */ `
      mutation CreateServerAutomation($input: ServerAutomationInput!) {
        createServerAutomation(input: $input) {
          id
          name
          template
          action
          frequency
          time
          intervalHours
          weekday
          weekdays
          command
          delaySeconds
          humanSchedule
          enabled
          isProcessing
          isAdvanced
          isManaged
          lastRunAt
          nextRunAt
        }
      }
    `

    const data = await executeGraphQL<{ createServerAutomation: ServerAutomationItem }>(mutation, { input })
    return data.createServerAutomation
  },

  async updateServerAutomation(id: string, input: ServerAutomationInput): Promise<ServerAutomationItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateServerAutomation($id: ID!, $input: ServerAutomationInput!) {
        updateServerAutomation(id: $id, input: $input) {
          id
          name
          template
          action
          frequency
          time
          intervalHours
          weekday
          weekdays
          command
          delaySeconds
          humanSchedule
          enabled
          isProcessing
          isAdvanced
          isManaged
          lastRunAt
          nextRunAt
        }
      }
    `

    const data = await executeGraphQL<{ updateServerAutomation: ServerAutomationItem }>(mutation, { id, input })
    return data.updateServerAutomation
  },

  async runServerAutomation(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RunServerAutomation($id: ID!) {
        runServerAutomation(id: $id)
      }
    `

    const data = await executeGraphQL<{ runServerAutomation: boolean }>(mutation, { id })
    return data.runServerAutomation
  },

  async deleteServerAutomation(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServerAutomation($id: ID!) {
        deleteServerAutomation(id: $id)
      }
    `

    const data = await executeGraphQL<{ deleteServerAutomation: boolean }>(mutation, { id })
    return data.deleteServerAutomation
  },

  // --- Files API ---

  async getServerFiles(root: ServerFileRoot, relativePath?: string): Promise<ServerFileItem[]> {
    const query = /* GraphQL */ `
      query ServerFiles($root: ServerFileRoot!, $relativePath: String) {
        serverFiles(root: $root, relativePath: $relativePath) {
          name
          isFile
          isSymlink
          sizeBytes
          mimeType
          modifiedAt
        }
      }
    `

    const data = await executeGraphQL<{ serverFiles: ServerFileItem[] }>(query, { root, relativePath })
    return data.serverFiles || []
  },

  async getServerTextFile(root: ServerFileRoot, relativePath: string): Promise<ServerFileContent> {
    const query = /* GraphQL */ `
      query ServerTextFile($root: ServerFileRoot!, $relativePath: String!) {
        serverTextFile(root: $root, relativePath: $relativePath) {
          content
          sizeBytes
        }
      }
    `

    const data = await executeGraphQL<{ serverTextFile: ServerFileContent }>(query, { root, relativePath })
    return data.serverTextFile
  },

  async writeServerTextFile(root: ServerFileRoot, relativePath: string, content: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation WriteServerTextFile($root: ServerFileRoot!, $relativePath: String!, $content: String!) {
        writeServerTextFile(root: $root, relativePath: $relativePath, content: $content)
      }
    `

    const data = await executeGraphQL<{ writeServerTextFile: boolean }>(mutation, { root, relativePath, content })
    return data.writeServerTextFile
  },

  async createServerFolder(root: ServerFileRoot, relativePath: string, folderName: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation CreateServerFolder($root: ServerFileRoot!, $relativePath: String!, $folderName: String!) {
        createServerFolder(root: $root, relativePath: $relativePath, folderName: $folderName)
      }
    `

    const data = await executeGraphQL<{ createServerFolder: boolean }>(mutation, { root, relativePath, folderName })
    return data.createServerFolder
  },

  async renameServerFile(root: ServerFileRoot, relativePath: string, newName: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RenameServerFile($root: ServerFileRoot!, $relativePath: String!, $newName: String!) {
        renameServerFile(root: $root, relativePath: $relativePath, newName: $newName)
      }
    `

    const data = await executeGraphQL<{ renameServerFile: boolean }>(mutation, { root, relativePath, newName })
    return data.renameServerFile
  },

  async deleteServerFile(root: ServerFileRoot, relativePath: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServerFile($root: ServerFileRoot!, $relativePath: String!) {
        deleteServerFile(root: $root, relativePath: $relativePath)
      }
    `

    const data = await executeGraphQL<{ deleteServerFile: boolean }>(mutation, { root, relativePath })
    return data.deleteServerFile
  },

  async prepareServerFileUpload(root: ServerFileRoot, relativePath: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation PrepareServerFileUpload($root: ServerFileRoot!, $relativePath: String!) {
        prepareServerFileUpload(root: $root, relativePath: $relativePath) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ prepareServerFileUpload: { url: string } }>(mutation, { root, relativePath })
    return data.prepareServerFileUpload
  },

  async createServerFileDownloadUrl(root: ServerFileRoot, relativePath: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerFileDownloadUrl($root: ServerFileRoot!, $relativePath: String!) {
        createServerFileDownloadUrl(root: $root, relativePath: $relativePath) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ createServerFileDownloadUrl: { url: string } }>(mutation, { root, relativePath })
    return data.createServerFileDownloadUrl
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
    mediaId: string
    status?: string
  }): Promise<import("../types").SkinItem> {
    const mutation = /* GraphQL */ `
      mutation CreateSkin($input: CreateSkinInput!) {
        createSkin(input: $input) {
          id
          name
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
    input: { name?: string; mediaId?: string; status?: string },
  ): Promise<import("../types").SkinItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateSkin($id: ID!, $input: UpdateSkinInput!) {
        updateSkin(id: $id, input: $input) {
          id
          name
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

  async getAdminPlayerSkins(
    paramsOrFirst?: { first?: number; after?: string | null; search?: string | null } | number,
    afterArg?: string | null,
    searchArg?: string | null,
  ): Promise<import("../types").AdminPlayerSkinConnection> {
    let first = 50
    let after: string | null | undefined = undefined
    let search: string | null | undefined = undefined

    if (typeof paramsOrFirst === "object" && paramsOrFirst !== null) {
      first = paramsOrFirst.first ?? 50
      after = paramsOrFirst.after
      search = paramsOrFirst.search
    } else {
      if (typeof paramsOrFirst === "number") first = paramsOrFirst
      after = afterArg
      search = searchArg
    }

    const query = /* GraphQL */ `
      query AdminPlayerSkins($first: Int, $after: String, $search: String) {
        adminPlayerSkins(first: $first, after: $after, search: $search) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          items {
            id
            userId
            userDisplayName
            imageUrl
            createdAt
            updatedAt
          }
        }
      }
    `
    const data = await executeGraphQL<{ adminPlayerSkins: import("../types").AdminPlayerSkinConnection }>(query, {
      first,
      after,
      search,
    })
    return data.adminPlayerSkins
  },

  async getAdminPlayerSkin(id: string): Promise<import("../types").AdminPlayerSkin | null> {
    const query = /* GraphQL */ `
      query AdminPlayerSkin($id: ID!) {
        adminPlayerSkin(id: $id) {
          id
          userId
          userDisplayName
          imageUrl
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ adminPlayerSkin: import("../types").AdminPlayerSkin | null }>(query, { id })
    return data.adminPlayerSkin
  },

  async updateAdminPlayerSkin(
    id: string,
    input: import("../types").UpdateAdminPlayerSkinInput,
  ): Promise<import("../types").AdminPlayerSkin> {
    const mutation = /* GraphQL */ `
      mutation UpdateAdminPlayerSkin($id: ID!, $input: UpdateAdminPlayerSkinInput!) {
        updateAdminPlayerSkin(id: $id, input: $input) {
          id
          userId
          userDisplayName
          imageUrl
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ updateAdminPlayerSkin: import("../types").AdminPlayerSkin }>(mutation, {
      id,
      input,
    })
    return data.updateAdminPlayerSkin
  },

  async deleteAdminPlayerSkin(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteAdminPlayerSkin($id: ID!) {
        deleteAdminPlayerSkin(id: $id)
      }
    `
    const data = await executeGraphQL<{ deleteAdminPlayerSkin: boolean }>(mutation, { id })
    return data.deleteAdminPlayerSkin
  },
}

// --- Capes API Facade (Phase 07 Hardening) ---

export const capesApi = {
  async getAdminCapes(params?: { status?: string | null }): Promise<import("../types").CapeConnection> {
    const query = /* GraphQL */ `
      query AdminCapes($status: CapeStatus) {
        adminCapes(status: $status) {
          items {
            id
            name
            imageUrl
            status
            createdAt
            updatedAt
          }
          totalCount
        }
      }
    `
    const data = await executeGraphQL<{ adminCapes: import("../types").CapeConnection }>(query, {
      status: params?.status === "ALL" ? null : params?.status,
    })
    return data.adminCapes
  },

  async createCape(input: import("../types").CreateCapeInput): Promise<import("../types").CapeItem> {
    const mutation = /* GraphQL */ `
      mutation CreateCape($input: CreateCapeInput!) {
        createCape(input: $input) {
          id
          name
          imageUrl
          status
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ createCape: import("../types").CapeItem }>(mutation, { input })
    return data.createCape
  },

  async updateCape(
    id: string,
    input: import("../types").UpdateCapeInput,
  ): Promise<import("../types").CapeItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateCape($id: ID!, $input: UpdateCapeInput!) {
        updateCape(id: $id, input: $input) {
          id
          name
          imageUrl
          status
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ updateCape: import("../types").CapeItem }>(mutation, { id, input })
    return data.updateCape
  },

  async deleteCape(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteCape($id: ID!) {
        deleteCape(id: $id)
      }
    `
    const data = await executeGraphQL<{ deleteCape: boolean }>(mutation, { id })
    return data.deleteCape
  },

  async getAdminPlayerCapes(
    paramsOrFirst?: { first?: number; after?: string | null; search?: string | null } | number,
    afterArg?: string | null,
    searchArg?: string | null,
  ): Promise<import("../types").AdminPlayerCapeConnection> {
    let first = 50
    let after: string | null | undefined = undefined
    let search: string | null | undefined = undefined

    if (typeof paramsOrFirst === "object" && paramsOrFirst !== null) {
      first = paramsOrFirst.first ?? 50
      after = paramsOrFirst.after
      search = paramsOrFirst.search
    } else {
      if (typeof paramsOrFirst === "number") first = paramsOrFirst
      after = afterArg
      search = searchArg
    }

    const query = /* GraphQL */ `
      query AdminPlayerCapes($first: Int, $after: String, $search: String) {
        adminPlayerCapes(first: $first, after: $after, search: $search) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          items {
            id
            userId
            userDisplayName
            name
            imageUrl
            createdAt
            updatedAt
          }
        }
      }
    `
    const data = await executeGraphQL<{ adminPlayerCapes: import("../types").AdminPlayerCapeConnection }>(query, {
      first,
      after,
      search,
    })
    return data.adminPlayerCapes
  },

  async getAdminPlayerCape(id: string): Promise<import("../types").AdminPlayerCape | null> {
    const query = /* GraphQL */ `
      query AdminPlayerCape($id: ID!) {
        adminPlayerCape(id: $id) {
          id
          userId
          userDisplayName
          name
          imageUrl
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ adminPlayerCape: import("../types").AdminPlayerCape | null }>(query, { id })
    return data.adminPlayerCape
  },

  async updateAdminPlayerCape(
    id: string,
    input: import("../types").UpdateAdminPlayerCapeInput,
  ): Promise<import("../types").AdminPlayerCape> {
    const mutation = /* GraphQL */ `
      mutation UpdateAdminPlayerCape($id: ID!, $input: UpdateAdminPlayerCapeInput!) {
        updateAdminPlayerCape(id: $id, input: $input) {
          id
          userId
          userDisplayName
          name
          imageUrl
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ updateAdminPlayerCape: import("../types").AdminPlayerCape }>(mutation, {
      id,
      input,
    })
    return data.updateAdminPlayerCape
  },

  async deleteAdminPlayerCape(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteAdminPlayerCape($id: ID!) {
        deleteAdminPlayerCape(id: $id)
      }
    `
    const data = await executeGraphQL<{ deleteAdminPlayerCape: boolean }>(mutation, { id })
    return data.deleteAdminPlayerCape
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
            coverMediaId
            cover {
              id
              mediaType
              mimeType
              sizeBytes
              url
              createdAt
            }
            publishedAt
            files {
              id
              name
              logicalPath
              category
              sha256
              sizeBytes
              policy
              explicitPolicy
              effectivePolicy
              isInherited
              isDirectory
              sourceProvider
              sourceProjectId
              sourceVersionId
              sourceFileId
              sourceEnvironment
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
            coverMediaId
            cover {
              id
              mediaType
              mimeType
              sizeBytes
              url
              createdAt
            }
            publishedAt
            files {
              id
              name
              logicalPath
              category
              sha256
              sizeBytes
              policy
              explicitPolicy
              effectivePolicy
              isInherited
              isDirectory
              changeStatus
              sourceProvider
              sourceProjectId
              sourceVersionId
              sourceFileId
              sourceEnvironment
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
            uniqueVersion
            hasFiles
            noConflicts
            storageVerified
            issues
          }
          draftFingerprint
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
          coverMediaId
          cover {
            id
            mediaType
            mimeType
            sizeBytes
            url
            createdAt
          }
          publishedAt
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
            explicitPolicy
            effectivePolicy
            isInherited
            isDirectory
            sourceProvider
            sourceProjectId
            sourceVersionId
            sourceFileId
            sourceEnvironment
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

  async prepareGameDraft(input?: { baseReleaseId?: string }): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation PrepareGameDraft($input: PrepareGameDraftInput) {
        prepareGameDraft(input: $input) {
          id
          version
          minecraftVersion
          neoForgeVersion
          status
          notes
          coverMediaId
          cover {
            id
            mediaType
            mimeType
            sizeBytes
            url
            createdAt
          }
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
            explicitPolicy
            effectivePolicy
            isInherited
            isDirectory
            sourceProvider
            sourceProjectId
            sourceVersionId
            sourceFileId
            sourceEnvironment
            createdAt
          }
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ prepareGameDraft: import("../types").GameRelease }>(mutation, { input })
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
    category?: string
    originalFilename: string
    sizeBytes: number
    logicalPath?: string
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
    logicalPath?: string
    explicitPolicy?: import("../types").SyncPolicy
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
          explicitPolicy
          effectivePolicy
          isInherited
          isDirectory
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ addGameFile: import("../types").AdminGameFile }>(mutation, { input })
    return data.addGameFile
  },

  async updateGameFile(
    id: string,
    input: {
      name?: string
      category?: string
      logicalPath?: string
      explicitPolicy?: import("../types").SyncPolicy
      tokenHash?: string
    },
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
          explicitPolicy
          effectivePolicy
          isInherited
          isDirectory
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ updateGameFile: import("../types").AdminGameFile }>(mutation, { id, input })
    return data.updateGameFile
  },

  async saveGameFileContent(input: {
    logicalPath: string
    content: string
    explicitPolicy?: import("../types").SyncPolicy | null
  }): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation SaveGameFileContent($input: SaveGameFileContentInput!) {
        saveGameFileContent(input: $input) {
          id
          name
          logicalPath
          category
          sha256
          sizeBytes
          policy
          explicitPolicy
          effectivePolicy
          isInherited
          isDirectory
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ saveGameFileContent: import("../types").AdminGameFile }>(mutation, { input })
    return data.saveGameFileContent
  },

  async readGameFileContent(id: string): Promise<string> {
    const query = /* GraphQL */ `
      query ReadGameFileContent($id: ID!) {
        readGameFileContent(id: $id)
      }
    `
    const data = await executeGraphQL<{ readGameFileContent: string }>(query, { id })
    return data.readGameFileContent
  },

  async createGameFolder(logicalPath: string): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation CreateGameFolder($logicalPath: String!) {
        createGameFolder(logicalPath: $logicalPath) {
          id
          name
          logicalPath
          category
          sha256
          sizeBytes
          policy
          explicitPolicy
          effectivePolicy
          isInherited
          isDirectory
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ createGameFolder: import("../types").AdminGameFile }>(mutation, { logicalPath })
    return data.createGameFolder
  },

  async renameGamePath(oldPath: string, newPath: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RenameGamePath($oldPath: String!, $newPath: String!) {
        renameGamePath(oldPath: $oldPath, newPath: $newPath)
      }
    `
    const data = await executeGraphQL<{ renameGamePath: boolean }>(mutation, { oldPath, newPath })
    return data.renameGamePath
  },

  async moveGamePaths(sources: string[], destinationFolder: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation MoveGamePaths($sources: [String!]!, $destinationFolder: String!) {
        moveGamePaths(sources: $sources, destinationFolder: $destinationFolder)
      }
    `
    const data = await executeGraphQL<{ moveGamePaths: boolean }>(mutation, { sources, destinationFolder })
    return data.moveGamePaths
  },

  async copyGamePaths(sources: string[], destinationFolder: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation CopyGamePaths($sources: [String!]!, $destinationFolder: String!) {
        copyGamePaths(sources: $sources, destinationFolder: $destinationFolder)
      }
    `
    const data = await executeGraphQL<{ copyGamePaths: boolean }>(mutation, { sources, destinationFolder })
    return data.copyGamePaths
  },

  async deleteGamePaths(paths: string[]): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteGamePaths($paths: [String!]!) {
        deleteGamePaths(paths: $paths)
      }
    `
    const data = await executeGraphQL<{ deleteGamePaths: boolean }>(mutation, { paths })
    return data.deleteGamePaths
  },

  async setGamePathPolicy(path: string, explicitPolicy?: import("../types").SyncPolicy | null): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation SetGamePathPolicy($path: String!, $explicitPolicy: SyncPolicy) {
        setGamePathPolicy(path: $path, explicitPolicy: $explicitPolicy)
      }
    `
    const data = await executeGraphQL<{ setGamePathPolicy: boolean }>(mutation, { path, explicitPolicy })
    return data.setGamePathPolicy
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
          explicitPolicy
          effectivePolicy
          isInherited
          isDirectory
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ restoreGameFile: import("../types").AdminGameFile }>(mutation, { id })
    return data.restoreGameFile
  },

  async updateGameDraftMetadata(
    input: import("../types").UpdateGameDraftMetadataInput,
  ): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation UpdateGameDraftMetadata($input: UpdateGameDraftMetadataInput!) {
        updateGameDraftMetadata(input: $input) {
          id
          version
          minecraftVersion
          neoForgeVersion
          status
          notes
          coverMediaId
          cover {
            id
            mediaType
            mimeType
            sizeBytes
            url
            createdAt
          }
          publishedAt
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
            explicitPolicy
            effectivePolicy
            isInherited
            isDirectory
            changeStatus
            sourceProvider
            sourceProjectId
            sourceVersionId
            sourceFileId
            sourceEnvironment
            createdAt
          }
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ updateGameDraftMetadata: import("../types").GameRelease }>(mutation, { input })
    return data.updateGameDraftMetadata
  },

  async publishGameRelease(
    input: import("../types").PublishGameReleaseInput,
  ): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation PublishGameRelease($input: PublishGameReleaseInput!) {
        publishGameRelease(input: $input) {
          id
          version
          minecraftVersion
          neoForgeVersion
          status
          notes
          coverMediaId
          cover {
            id
            mediaType
            mimeType
            sizeBytes
            url
            createdAt
          }
          publishedAt
          files {
            id
            name
            logicalPath
            category
            sha256
            sizeBytes
            policy
            explicitPolicy
            effectivePolicy
            isInherited
            isDirectory
            sourceProvider
            sourceProjectId
            sourceVersionId
            sourceFileId
            sourceEnvironment
            createdAt
          }
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ publishGameRelease: import("../types").GameRelease }>(mutation, { input })
    return data.publishGameRelease
  },

  async searchMods(
    query: string,
    contentType?: import("../types").ContentType | null,
    provider?: import("../types").ModProvider | null,
    limit?: number,
    offset?: number,
  ): Promise<import("../types").ModSearchPayload> {
    return graphqlClient.searchMods(query, contentType, provider, limit, offset)
  },

  async getModProjectDetail(
    provider: import("../types").ModProvider,
    projectId: string,
    contentType?: import("../types").ContentType | null,
  ): Promise<import("../types").ModProjectDetail> {
    return graphqlClient.getModProjectDetail(provider, projectId, contentType)
  },

  async resolveModInstallationPlan(
    input: import("../types").ResolveModPlanInput,
  ): Promise<import("../types").ModInstallationPlan> {
    return graphqlClient.resolveModInstallationPlan(input)
  },

  async installModPlan(
    input: import("../types").InstallModPlanInput,
  ): Promise<import("../types").AdminGameFile[]> {
    return graphqlClient.installModPlan(input)
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

// --- Mod Providers API Facade (Shard 08B) ---

export const modProvidersApi = {
  async searchMods(
    query: string,
    contentType?: import("../types").ContentType | null,
    provider?: import("../types").ModProvider | null,
    limit?: number,
    offset?: number,
  ): Promise<import("../types").ModSearchPayload> {
    const gqlQuery = /* GraphQL */ `
      query SearchMods(
        $query: String!
        $contentType: ContentType
        $provider: ModProvider
        $limit: Int
        $offset: Int
      ) {
        searchMods(
          query: $query
          contentType: $contentType
          provider: $provider
          limit: $limit
          offset: $offset
        ) {
          items {
            provider
            projectId
            slug
            name
            summary
            description
            author
            iconUrl
            downloads
            follows
            categories
            contentType
            environment
            latestVersion
            publishedAt
            updatedAt
          }
          totalCount
          providersStatus {
            provider
            available
            error
          }
          minecraftVersion
          neoForgeVersion
        }
      }
    `
    const data = await executeGraphQL<{ searchMods: import("../types").ModSearchPayload }>(gqlQuery, {
      query,
      contentType: contentType || "MOD",
      provider,
      limit,
      offset,
    })
    return data.searchMods
  },

  async getModProjectDetail(
    provider: import("../types").ModProvider,
    projectId: string,
    contentType?: import("../types").ContentType | null,
  ): Promise<import("../types").ModProjectDetail> {
    const gqlQuery = /* GraphQL */ `
      query GetModProjectDetail(
        $provider: ModProvider!
        $projectId: String!
        $contentType: ContentType
      ) {
        getModProjectDetail(
          provider: $provider
          projectId: $projectId
          contentType: $contentType
        ) {
          provider
          projectId
          slug
          name
          summary
          description
          author
          iconUrl
          downloads
          contentType
          environment
          compatibleVersions {
            id
            fileId
            versionNumber
            name
            releaseType
            gameVersions
            loaders
            publishedAt
            downloads
            filename
            sizeBytes
            sha256
            dependencies {
              projectId
              versionId
              fileId
              dependencyType
              projectName
              fileName
            }
          }
          installedVersion
          isInstalled
          minecraftVersion
          neoForgeVersion
        }
      }
    `
    const data = await executeGraphQL<{ getModProjectDetail: import("../types").ModProjectDetail }>(gqlQuery, {
      provider,
      projectId,
      contentType: contentType || "MOD",
    })
    return data.getModProjectDetail
  },

  async resolveModInstallationPlan(
    input: import("../types").ResolveModPlanInput,
  ): Promise<import("../types").ModInstallationPlan> {
    const gqlQuery = /* GraphQL */ `
      query ResolveModInstallationPlan($input: ResolveModPlanInput!) {
        resolveModInstallationPlan(input: $input) {
          items {
            provider
            projectId
            projectName
            versionId
            fileId
            versionNumber
            filename
            sizeBytes
            sha256
            contentType
            environment
            logicalPath
            isRoot
            isDependency
            isRequired
            isInstalled
            action
            installedFileId
            installedVersionNumber
            availableCompatibleVersions {
              id
              fileId
              versionNumber
              name
              releaseType
              gameVersions
              loaders
              publishedAt
              downloads
              filename
              sizeBytes
            }
          }
          totalDownloadSizeBytes
          conflicts
          optionalDependencies {
            provider
            projectId
            projectName
            versionId
            fileId
            versionNumber
            filename
            sizeBytes
            contentType
            isInstalled
          }
          isValid
        }
      }
    `
    const data = await executeGraphQL<{ resolveModInstallationPlan: import("../types").ModInstallationPlan }>(gqlQuery, {
      input,
    })
    return data.resolveModInstallationPlan
  },

  async installModPlan(
    input: import("../types").InstallModPlanInput,
  ): Promise<import("../types").AdminGameFile[]> {
    const mutation = /* GraphQL */ `
      mutation InstallModPlan($input: InstallModPlanInput!) {
        installModPlan(input: $input) {
          id
          name
          logicalPath
          category
          sha256
          sizeBytes
          policy
          explicitPolicy
          effectivePolicy
          isInherited
          isDirectory
          changeStatus
          sourceProvider
          sourceProjectId
          sourceVersionId
          sourceFileId
          sourceEnvironment
          createdAt
        }
      }
    `
    const data = await executeGraphQL<{ installModPlan: import("../types").AdminGameFile[] }>(mutation, { input })
    return data.installModPlan
  },
}

// --- Server Content & Release Sync API (Shard 08D) ---

export const serverContentApi = {
  async getServerManagedContent(): Promise<import("../types").ServerManagedContentItem[]> {
    const query = /* GraphQL */ `
      query ServerManagedContent {
        serverManagedContent {
          id
          managementSource
          provider
          projectId
          versionId
          fileId
          contentType
          environment
          targetPath
          sha256
          sizeBytes
          gameReleaseId
          gameReleaseFileId
          status
          name
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ serverManagedContent: import("../types").ServerManagedContentItem[] }>(query)
    return data.serverManagedContent || []
  },

  async searchServerContent(
    query: string,
    contentType?: import("../types").ContentType | null,
    provider?: import("../types").ModProvider | null,
    limit?: number,
    offset?: number,
  ): Promise<import("../types").ServerContentSearchPayload> {
    const gqlQuery = /* GraphQL */ `
      query SearchServerContent(
        $query: String!
        $contentType: ContentType
        $provider: ModProvider
        $limit: Int
        $offset: Int
      ) {
        searchServerContent(
          query: $query
          contentType: $contentType
          provider: $provider
          limit: $limit
          offset: $offset
        ) {
          items {
            provider
            projectId
            slug
            name
            summary
            description
            author
            iconUrl
            downloads
            follows
            categories
            contentType
            environment
            latestVersion
            publishedAt
            updatedAt
          }
          totalCount
          providersStatus {
            provider
            available
            error
          }
          minecraftVersion
          neoForgeVersion
          isPublishedEnvironment
        }
      }
    `
    const data = await executeGraphQL<{ searchServerContent: import("../types").ServerContentSearchPayload }>(gqlQuery, {
      query,
      contentType: contentType || "MOD",
      provider,
      limit,
      offset,
    })
    return data.searchServerContent
  },

  async getServerContentProjectDetail(
    provider: import("../types").ModProvider,
    projectId: string,
    contentType?: import("../types").ContentType | null,
  ): Promise<import("../types").ModProjectDetail> {
    const gqlQuery = /* GraphQL */ `
      query ServerContentProjectDetail(
        $provider: ModProvider!
        $projectId: String!
        $contentType: ContentType
      ) {
        serverContentProjectDetail(
          provider: $provider
          projectId: $projectId
          contentType: $contentType
        ) {
          provider
          projectId
          slug
          name
          summary
          description
          author
          iconUrl
          downloads
          contentType
          environment
          compatibleVersions {
            id
            fileId
            versionNumber
            name
            releaseType
            gameVersions
            loaders
            publishedAt
            downloads
            filename
            sizeBytes
            sha256
            dependencies {
              projectId
              versionId
              fileId
              dependencyType
              projectName
              fileName
            }
          }
          installedVersion
          isInstalled
          minecraftVersion
          neoForgeVersion
        }
      }
    `
    const data = await executeGraphQL<{ serverContentProjectDetail: import("../types").ModProjectDetail }>(gqlQuery, {
      provider,
      projectId,
      contentType: contentType || "MOD",
    })
    return data.serverContentProjectDetail
  },

  async resolveServerContentPlan(
    input: import("../types").ResolveServerContentPlanInput,
  ): Promise<import("../types").ServerContentInstallationPlan> {
    const gqlQuery = /* GraphQL */ `
      query ResolveServerContentPlan($input: ResolveServerContentPlanInput!) {
        resolveServerContentPlan(input: $input) {
          items {
            provider
            projectId
            projectName
            versionId
            fileId
            versionNumber
            filename
            sizeBytes
            sha256
            contentType
            environment
            targetPath
            isRoot
            isDependency
            isRequired
            isInstalled
            action
            installedManagedId
            installedVersionNumber
            availableCompatibleVersions {
              id
              fileId
              versionNumber
              name
              releaseType
              gameVersions
              loaders
              publishedAt
              downloads
              filename
              sizeBytes
            }
          }
          totalDownloadSizeBytes
          conflicts
          optionalDependencies {
            provider
            projectId
            projectName
            versionId
            fileId
            versionNumber
            filename
            sizeBytes
            contentType
            isInstalled
          }
          isValid
          requiresGameUpdate
          gameUpdateReason
        }
      }
    `
    const data = await executeGraphQL<{ resolveServerContentPlan: import("../types").ServerContentInstallationPlan }>(gqlQuery, {
      input,
    })
    return data.resolveServerContentPlan
  },

  async installServerContentPlan(
    input: import("../types").InstallServerContentPlanInput,
  ): Promise<import("../types").ServerManagedContentItem[]> {
    const mutation = /* GraphQL */ `
      mutation InstallServerContentPlan($input: InstallServerContentPlanInput!) {
        installServerContentPlan(input: $input) {
          id
          managementSource
          provider
          projectId
          versionId
          fileId
          contentType
          environment
          targetPath
          sha256
          sizeBytes
          gameReleaseId
          gameReleaseFileId
          status
          name
          createdAt
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ installServerContentPlan: import("../types").ServerManagedContentItem[] }>(mutation, { input })
    return data.installServerContentPlan
  },

  async removeServerManagedContent(id: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RemoveServerManagedContent($id: ID!) {
        removeServerManagedContent(id: $id)
      }
    `
    const data = await executeGraphQL<{ removeServerManagedContent: boolean }>(mutation, { id })
    return data.removeServerManagedContent
  },

  async getServerReleaseSyncPlan(): Promise<import("../types").ServerReleaseSyncPlan> {
    const query = /* GraphQL */ `
      query ServerReleaseSyncPlan {
        serverReleaseSyncPlan {
          releaseId
          releaseVersion
          isPending
          items {
            action
            filename
            targetPath
            sizeBytes
            sha256
            sourceProvider
            sourceProjectId
            sourceVersionId
            sourceFileId
            gameReleaseFileId
            managedContentId
            currentVersionNumber
            desiredVersionNumber
          }
          summary {
            toInstall
            toUpdate
            toRemove
            toKeep
          }
          serverStatus
          canApply
          blockReason
        }
      }
    `
    const data = await executeGraphQL<{ serverReleaseSyncPlan: import("../types").ServerReleaseSyncPlan }>(query)
    return data.serverReleaseSyncPlan
  },

  async getServerReleaseSyncStatus(): Promise<import("../types").ServerReleaseSyncStatus | null> {
    const query = /* GraphQL */ `
      query ServerReleaseSyncStatus {
        serverReleaseSyncStatus {
          releaseId
          releaseVersion
          status
          appliedAt
          details
        }
      }
    `
    const data = await executeGraphQL<{ serverReleaseSyncStatus: import("../types").ServerReleaseSyncStatus | null }>(query)
    return data.serverReleaseSyncStatus
  },

  async applyServerReleaseSync(createBackup?: boolean): Promise<import("../types").ServerReleaseSyncResult> {
    const mutation = /* GraphQL */ `
      mutation ApplyServerReleaseSync($createBackup: Boolean) {
        applyServerReleaseSync(createBackup: $createBackup) {
          success
          message
          syncedCount
          status
        }
      }
    `
    const data = await executeGraphQL<{ applyServerReleaseSync: import("../types").ServerReleaseSyncResult }>(mutation, { createBackup })
    return data.applyServerReleaseSync
  },
}

export const graphqlClient = {
  ...newsApi,
  ...serverApi,
  ...skinsApi,
  ...gameApi,
  ...settingsApi,
  ...modProvidersApi,
  ...serverContentApi,
}





