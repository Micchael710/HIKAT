import type {
  NewsItem,
  NewsConnection,
  ContentMedia,
  ServerItem,
  CreateServerInput,
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
import type {
  GameFileUploadPayloadGql,
  GameFileUploadCompletePayloadGql,
  CreateGameFileUploadInputGql,
  CompleteGameFileUploadInputGql,
} from "@hikat/graphql"

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
  serverId: string
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
  uploadToken: string
  expiresAt: string
  maxSizeBytes: number
  expectedMimeType: string
  allowedMimeTypes: string[]
  mediaId: string
  objectKey: string
  bucket: string
  endpoint: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  }
  uploadUrl?: string | null
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
  const tokenOutcome = await authService.getValidAccessTokenOutcome()
  if (tokenOutcome.kind === "TRANSIENT_FAILURE") {
    throw new Error(tokenOutcome.error || "Error temporal de conexión al renovar sesión con el servidor.")
  }
  if (tokenOutcome.kind === "TERMINAL_FAILURE") {
    throw new Error("Su sesión ha expirado. Por favor inicie sesión nuevamente.")
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (tokenOutcome.kind === "READY") {
    headers["Authorization"] = `Bearer ${tokenOutcome.accessToken}`
  }

  let res: Response
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    })
  } catch (err: unknown) {
    if (err instanceof TypeError || (err as any)?.name === "TypeError") {
      throw new Error("No se pudo conectar con el servidor. Comprueba tu conexión a internet.")
    }
    throw err
  }

  // 1. Handle HTTP 401 Unauthenticated
  if (res.status === 401) {
    if (!isRetry) {
      const outcome = await authService.refreshOutcome()
      if (outcome.kind === "REFRESHED") {
        return executeGraphQL<T>(query, variables, true)
      }
      if (outcome.kind === "TRANSIENT_FAILURE") {
        throw new Error("Error temporal de conexión al renovar sesión con el servidor.")
      }
    }
    authService.clearSession()
    throw new Error("Su sesión ha expirado. Por favor inicie sesión nuevamente.")
  }

  if (!res.ok) {
    throw new Error(`Error en el servidor (${res.status} ${res.statusText}).`)
  }

  const result = await res.json()

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
        const outcome = await authService.refreshOutcome()
        if (outcome.kind === "REFRESHED") {
          return executeGraphQL<T>(query, variables, true)
        }
        if (outcome.kind === "TRANSIENT_FAILURE") {
          throw new Error("Error temporal de conexión al renovar sesión con el servidor.")
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
  async getAdminNews(options: {
    serverId: string
    first?: number
    after?: string
    type?: NewsType | null
    status?: NewsStatus | null
  }): Promise<NewsConnection> {
    const query = /* GraphQL */ `
      query AdminNews($serverId: ID, $first: Int, $after: String, $type: NewsType, $status: NewsStatus) {
        adminNews(serverId: $serverId, first: $first, after: $after, type: $type, status: $status) {
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
      serverId: options.serverId,
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

  async updateNews(id: string, input: UpdateNewsInput, serverId: string): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateNews($serverId: ID, $id: ID!, $input: UpdateNewsInput!) {
        updateNews(serverId: $serverId, id: $id, input: $input) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ updateNews: NewsItem }>(mutation, {
      serverId,
      id,
      input,
    })
    return data.updateNews
  },

  async publishNews(id: string, serverId: string): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation PublishNews($serverId: ID, $id: ID!) {
        publishNews(serverId: $serverId, id: $id) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ publishNews: NewsItem }>(mutation, {
      serverId,
      id,
    })
    return data.publishNews
  },

  async unpublishNews(id: string, serverId: string): Promise<NewsItem> {
    const mutation = /* GraphQL */ `
      mutation UnpublishNews($serverId: ID, $id: ID!) {
        unpublishNews(serverId: $serverId, id: $id) {
          ${NEWS_FIELDS}
        }
      }
    `

    const data = await executeGraphQL<{ unpublishNews: NewsItem }>(mutation, {
      serverId,
      id,
    })
    return data.unpublishNews
  },

  async deleteNews(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteNews($serverId: ID, $id: ID!) {
        deleteNews(serverId: $serverId, id: $id)
      }
    `

    const data = await executeGraphQL<{ deleteNews: boolean }>(mutation, {
      serverId,
      id,
    })
    return data.deleteNews
  },

  async createContentMediaUpload(
    input: CreateMediaUploadTicketInput,
  ): Promise<MediaUploadTicketPayload> {
    const mutation = /* GraphQL */ `
      mutation CreateContentMediaUpload($input: CreateContentMediaUploadInput!) {
        createContentMediaUpload(input: $input) {
          uploadToken
          expiresAt
          maxSizeBytes
          expectedMimeType
          allowedMimeTypes
          mediaId
          objectKey
          bucket
          endpoint
          credentials {
            accessKeyId
            secretAccessKey
            sessionToken
          }
          uploadUrl
        }
      }
    `

    const data = await executeGraphQL<{
      createContentMediaUpload: MediaUploadTicketPayload
    }>(mutation, { input })

    return data.createContentMediaUpload
  },

  async completeContentMediaUpload(input: {
    uploadToken: string
  }): Promise<ContentMedia> {
    const mutation = /* GraphQL */ `
      mutation CompleteContentMediaUpload($input: CompleteContentMediaUploadInput!) {
        completeContentMediaUpload(input: $input) {
          id
          mediaType
          mimeType
          sizeBytes
          url
          createdAt
        }
      }
    `

    const data = await executeGraphQL<{
      completeContentMediaUpload: ContentMedia
    }>(mutation, { input })

    return data.completeContentMediaUpload
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

const SERVER_FIELDS = `
  id
  name
  minecraftVersion
  modLoader
  modLoaderVersion
  mainLogo {
    id
    mediaType
    mimeType
    sizeBytes
    url
    createdAt
  }
  sidebarLogo {
    id
    mediaType
    mimeType
    sizeBytes
    url
    createdAt
  }
  accentColor
  cpu
  memoryMb
  diskMb
  provisioningStatus
  launcherActiveReleaseId
  createdAt
  updatedAt
`

export const serverApi = {
  async getServers(): Promise<ServerItem[]> {
    const query = /* GraphQL */ `
      query Servers {
        servers {
          ${SERVER_FIELDS}
        }
      }
    `
    const data = await executeGraphQL<{ servers: ServerItem[] }>(query)
    return data.servers || []
  },

  async getServer(serverId: string): Promise<ServerItem | null> {
    const query = /* GraphQL */ `
      query Server($serverId: ID!) {
        server(serverId: $serverId) {
          ${SERVER_FIELDS}
        }
      }
    `
    const data = await executeGraphQL<{ server: ServerItem | null }>(query, { serverId })
    return data.server
  },

  async createServer(input: CreateServerInput): Promise<ServerItem> {
    const mutation = /* GraphQL */ `
      mutation CreateServer($input: CreateServerInput!) {
        createServer(input: $input) {
          ${SERVER_FIELDS}
        }
      }
    `
    const data = await executeGraphQL<{ createServer: ServerItem }>(mutation, { input })
    return data.createServer
  },

  async deleteServer(serverId: string, deletePterodactyl: boolean): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServer($serverId: ID!, $deletePterodactyl: Boolean!) {
        deleteServer(serverId: $serverId, deletePterodactyl: $deletePterodactyl)
      }
    `
    const data = await executeGraphQL<{ deleteServer: boolean }>(mutation, {
      serverId,
      deletePterodactyl,
    })
    return data.deleteServer
  },

  async getServerStatus(serverId: string): Promise<ServerResources> {
    const query = /* GraphQL */ `
      query ServerStatus($serverId: ID) {
        serverStatus(serverId: $serverId) {
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

    const data = await executeGraphQL<{ serverStatus: ServerResources }>(query, {
      serverId,
    })
    return data.serverStatus
  },

  async getServerActivity(serverId: string): Promise<ServerActivityItem[]> {
    const query = /* GraphQL */ `
      query ServerActivity($serverId: ID) {
        serverActivity(serverId: $serverId) {
          id
          description
          eventType
          timestamp
        }
      }
    `

    const data = await executeGraphQL<{ serverActivity: ServerActivityItem[] }>(query, {
      serverId,
    })
    return data.serverActivity || []
  },

  async startServer(serverId: string): Promise<{ success: boolean; status: ServerStatus; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation StartServer($serverId: ID) {
        startServer(serverId: $serverId) {
          success
          status
          message
        }
      }
    `

    const data = await executeGraphQL<{
      startServer: { success: boolean; status: ServerStatus; message?: string }
    }>(mutation, { serverId })
    return data.startServer
  },

  async restartServer(serverId: string): Promise<{ success: boolean; status: ServerStatus; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation RestartServer($serverId: ID) {
        restartServer(serverId: $serverId) {
          success
          status
          message
        }
      }
    `

    const data = await executeGraphQL<{
      restartServer: { success: boolean; status: ServerStatus; message?: string }
    }>(mutation, { serverId })
    return data.restartServer
  },

  async stopServer(serverId: string): Promise<{ success: boolean; status: ServerStatus; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation StopServer($serverId: ID) {
        stopServer(serverId: $serverId) {
          success
          status
          message
        }
      }
    `

    const data = await executeGraphQL<{
      stopServer: { success: boolean; status: ServerStatus; message?: string }
    }>(mutation, { serverId })
    return data.stopServer
  },

  async sendServerCommand(
    command: string,
    serverId: string,
  ): Promise<{ success: boolean; message?: string }> {
    const mutation = /* GraphQL */ `
      mutation SendServerCommand($command: String!, $serverId: ID) {
        sendServerCommand(command: $command, serverId: $serverId) {
          success
          message
        }
      }
    `

    const data = await executeGraphQL<{
      sendServerCommand: { success: boolean; message?: string }
    }>(mutation, { command, serverId })
    return data.sendServerCommand
  },

  async createServerConsoleTicket(serverId: string): Promise<{ ticket: string; expiresAt: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerConsoleTicket($serverId: ID) {
        createServerConsoleTicket(serverId: $serverId) {
          ticket
          expiresAt
        }
      }
    `

    const data = await executeGraphQL<{
      createServerConsoleTicket: { ticket: string; expiresAt: string }
    }>(mutation, { serverId })
    return data.createServerConsoleTicket
  },

  // --- Backups API ---

  async getServerBackups(serverId: string): Promise<ServerBackupItem[]> {
    const query = /* GraphQL */ `
      query ServerBackups($serverId: ID) {
        serverBackups(serverId: $serverId) {
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

    const data = await executeGraphQL<{ serverBackups: ServerBackupItem[] }>(query, {
      serverId,
    })
    return data.serverBackups || []
  },

  async createServerBackup(name: string | undefined, serverId: string): Promise<ServerBackupItem> {
    const mutation = /* GraphQL */ `
      mutation CreateServerBackup($name: String, $serverId: ID) {
        createServerBackup(name: $name, serverId: $serverId) {
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

    const data = await executeGraphQL<{ createServerBackup: ServerBackupItem }>(mutation, {
      name,
      serverId,
    })
    return data.createServerBackup
  },

  async restoreServerBackup(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RestoreServerBackup($id: ID!, $serverId: ID) {
        restoreServerBackup(id: $id, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ restoreServerBackup: boolean }>(mutation, {
      id,
      serverId,
    })
    return data.restoreServerBackup
  },

  async deleteServerBackup(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServerBackup($id: ID!, $serverId: ID) {
        deleteServerBackup(id: $id, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ deleteServerBackup: boolean }>(mutation, {
      id,
      serverId,
    })
    return data.deleteServerBackup
  },

  async toggleServerBackupLock(id: string, serverId: string): Promise<ServerBackupItem> {
    const mutation = /* GraphQL */ `
      mutation ToggleServerBackupLock($id: ID!, $serverId: ID) {
        toggleServerBackupLock(id: $id, serverId: $serverId) {
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

    const data = await executeGraphQL<{ toggleServerBackupLock: ServerBackupItem }>(mutation, {
      id,
      serverId,
    })
    return data.toggleServerBackupLock
  },

  async createServerBackupDownloadUrl(id: string, name: string | undefined, serverId: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerBackupDownloadUrl($id: ID!, $name: String, $serverId: ID) {
        createServerBackupDownloadUrl(id: $id, name: $name, serverId: $serverId) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ createServerBackupDownloadUrl: { url: string } }>(mutation, {
      id,
      name,
      serverId,
    })
    return data.createServerBackupDownloadUrl
  },

  // --- World API ---

  async getServerWorld(serverId: string): Promise<ServerWorldInfo> {
    const query = /* GraphQL */ `
      query ServerWorld($serverId: ID) {
        serverWorld(serverId: $serverId) {
          name
          sizeBytes
          lastModified
        }
      }
    `

    const data = await executeGraphQL<{ serverWorld: ServerWorldInfo }>(query, {
      serverId,
    })
    return data.serverWorld
  },

  async createServerWorldDownloadUrl(serverId: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerWorldDownloadUrl($serverId: ID) {
        createServerWorldDownloadUrl(serverId: $serverId) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ createServerWorldDownloadUrl: { url: string } }>(mutation, {
      serverId,
    })
    return data.createServerWorldDownloadUrl
  },

  async prepareServerWorldUpload(serverId: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation PrepareServerWorldUpload($serverId: ID) {
        prepareServerWorldUpload(serverId: $serverId) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ prepareServerWorldUpload: { url: string } }>(mutation, {
      serverId,
    })
    return data.prepareServerWorldUpload
  },

  async replaceServerWorld(uploadedFileName: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation ReplaceServerWorld($uploadedFileName: String!, $serverId: ID) {
        replaceServerWorld(uploadedFileName: $uploadedFileName, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ replaceServerWorld: boolean }>(mutation, {
      uploadedFileName,
      serverId,
    })
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

  async getMinecraftServerSettings(serverId: string): Promise<MinecraftServerSettings> {
    const query = /* GraphQL */ `
      query ServerMinecraftSettings($serverId: ID) {
        serverMinecraftSettings(serverId: $serverId) {
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

    const data = await executeGraphQL<{ serverMinecraftSettings: MinecraftServerSettings }>(query, {
      serverId,
    })
    return data.serverMinecraftSettings
  },

  async updateMinecraftServerSettings(input: UpdateMinecraftServerSettingsInput, serverId: string): Promise<MinecraftServerSettings> {
    const mutation = /* GraphQL */ `
      mutation UpdateMinecraftServerSettings($input: UpdateMinecraftServerSettingsInput!, $serverId: ID) {
        updateMinecraftServerSettings(input: $input, serverId: $serverId) {
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

    const data = await executeGraphQL<{ updateMinecraftServerSettings: MinecraftServerSettings }>(mutation, {
      input,
      serverId,
    })
    return data.updateMinecraftServerSettings
  },

  // --- Automations / Schedules API ---

  async getServerAutomations(serverId: string): Promise<ServerAutomationItem[]> {
    const query = /* GraphQL */ `
      query ServerAutomations($serverId: ID) {
        serverAutomations(serverId: $serverId) {
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

    const data = await executeGraphQL<{ serverAutomations: ServerAutomationItem[] }>(query, {
      serverId,
    })
    return data.serverAutomations || []
  },

  async createServerAutomation(input: ServerAutomationInput, serverId: string): Promise<ServerAutomationItem> {
    const mutation = /* GraphQL */ `
      mutation CreateServerAutomation($input: ServerAutomationInput!, $serverId: ID) {
        createServerAutomation(input: $input, serverId: $serverId) {
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

    const data = await executeGraphQL<{ createServerAutomation: ServerAutomationItem }>(mutation, {
      input,
      serverId,
    })
    return data.createServerAutomation
  },

  async updateServerAutomation(id: string, input: ServerAutomationInput, serverId: string): Promise<ServerAutomationItem> {
    const mutation = /* GraphQL */ `
      mutation UpdateServerAutomation($id: ID!, $input: ServerAutomationInput!, $serverId: ID) {
        updateServerAutomation(id: $id, input: $input, serverId: $serverId) {
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

    const data = await executeGraphQL<{ updateServerAutomation: ServerAutomationItem }>(mutation, {
      id,
      input,
      serverId,
    })
    return data.updateServerAutomation
  },

  async runServerAutomation(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RunServerAutomation($id: ID!, $serverId: ID) {
        runServerAutomation(id: $id, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ runServerAutomation: boolean }>(mutation, {
      id,
      serverId,
    })
    return data.runServerAutomation
  },

  async deleteServerAutomation(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServerAutomation($id: ID!, $serverId: ID) {
        deleteServerAutomation(id: $id, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ deleteServerAutomation: boolean }>(mutation, {
      id,
      serverId,
    })
    return data.deleteServerAutomation
  },

  // --- Files API ---

  async getServerFiles(root: ServerFileRoot, relativePath: string | undefined, serverId: string): Promise<ServerFileItem[]> {
    const query = /* GraphQL */ `
      query ServerFiles($root: ServerFileRoot!, $relativePath: String, $serverId: ID) {
        serverFiles(root: $root, relativePath: $relativePath, serverId: $serverId) {
          name
          isFile
          isSymlink
          sizeBytes
          mimeType
          modifiedAt
        }
      }
    `

    const data = await executeGraphQL<{ serverFiles: ServerFileItem[] }>(query, {
      root,
      relativePath,
      serverId,
    })
    return data.serverFiles || []
  },

  async getServerTextFile(root: ServerFileRoot, relativePath: string, serverId: string): Promise<ServerFileContent> {
    const query = /* GraphQL */ `
      query ServerTextFile($root: ServerFileRoot!, $relativePath: String!, $serverId: ID) {
        serverTextFile(root: $root, relativePath: $relativePath, serverId: $serverId) {
          content
          sizeBytes
        }
      }
    `

    const data = await executeGraphQL<{ serverTextFile: ServerFileContent }>(query, {
      root,
      relativePath,
      serverId,
    })
    return data.serverTextFile
  },

  async writeServerTextFile(root: ServerFileRoot, relativePath: string, content: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation WriteServerTextFile($root: ServerFileRoot!, $relativePath: String!, $content: String!, $serverId: ID) {
        writeServerTextFile(root: $root, relativePath: $relativePath, content: $content, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ writeServerTextFile: boolean }>(mutation, {
      root,
      relativePath,
      content,
      serverId,
    })
    return data.writeServerTextFile
  },

  async createServerFolder(root: ServerFileRoot, relativePath: string, folderName: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation CreateServerFolder($root: ServerFileRoot!, $relativePath: String!, $folderName: String!, $serverId: ID) {
        createServerFolder(root: $root, relativePath: $relativePath, folderName: $folderName, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ createServerFolder: boolean }>(mutation, {
      root,
      relativePath,
      folderName,
      serverId,
    })
    return data.createServerFolder
  },

  async renameServerFile(root: ServerFileRoot, relativePath: string, newName: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RenameServerFile($root: ServerFileRoot!, $relativePath: String!, $newName: String!, $serverId: ID) {
        renameServerFile(root: $root, relativePath: $relativePath, newName: $newName, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ renameServerFile: boolean }>(mutation, {
      root,
      relativePath,
      newName,
      serverId,
    })
    return data.renameServerFile
  },

  async deleteServerFile(root: ServerFileRoot, relativePath: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteServerFile($root: ServerFileRoot!, $relativePath: String!, $serverId: ID) {
        deleteServerFile(root: $root, relativePath: $relativePath, serverId: $serverId)
      }
    `

    const data = await executeGraphQL<{ deleteServerFile: boolean }>(mutation, {
      root,
      relativePath,
      serverId,
    })
    return data.deleteServerFile
  },

  async prepareServerFileUpload(root: ServerFileRoot, relativePath: string, serverId: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation PrepareServerFileUpload($root: ServerFileRoot!, $relativePath: String!, $serverId: ID) {
        prepareServerFileUpload(root: $root, relativePath: $relativePath, serverId: $serverId) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ prepareServerFileUpload: { url: string } }>(mutation, {
      root,
      relativePath,
      serverId,
    })
    return data.prepareServerFileUpload
  },

  async createServerFileDownloadUrl(root: ServerFileRoot, relativePath: string, serverId: string): Promise<{ url: string }> {
    const mutation = /* GraphQL */ `
      mutation CreateServerFileDownloadUrl($root: ServerFileRoot!, $relativePath: String!, $serverId: ID) {
        createServerFileDownloadUrl(root: $root, relativePath: $relativePath, serverId: $serverId) {
          url
        }
      }
    `

    const data = await executeGraphQL<{ createServerFileDownloadUrl: { url: string } }>(mutation, {
      root,
      relativePath,
      serverId,
    })
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
  async getAdminGameOverview(serverId: string): Promise<import("../types").AdminGameOverview> {
    const query = /* GraphQL */ `
      query AdminGameOverview($serverId: ID) {
        adminGameOverview(serverId: $serverId) {
          publishedRelease {
            id
            version
            minecraftVersion
            modLoader
            modLoaderVersion
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
            modLoader
            modLoaderVersion
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
    const data = await executeGraphQL<{ adminGameOverview: import("../types").AdminGameOverview }>(query, {
      serverId,
    })
    return data.adminGameOverview
  },

  async getGameReleaseHistory(serverId: string): Promise<import("../types").GameRelease[]> {
    const query = /* GraphQL */ `
      query GameReleaseHistory($serverId: ID) {
        gameReleaseHistory(serverId: $serverId) {
          id
          version
          minecraftVersion
          modLoader
          modLoaderVersion
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
    const data = await executeGraphQL<{ gameReleaseHistory: import("../types").GameRelease[] }>(query, {
      serverId,
    })
    return data.gameReleaseHistory
  },

  async prepareGameDraft(input: { baseReleaseId?: string } | undefined, serverId: string): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation PrepareGameDraft($input: PrepareGameDraftInput, $serverId: ID) {
        prepareGameDraft(input: $input, serverId: $serverId) {
          id
          version
          minecraftVersion
          modLoader
          modLoaderVersion
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
    const data = await executeGraphQL<{ prepareGameDraft: import("../types").GameRelease }>(mutation, {
      input,
      serverId,
    })
    return data.prepareGameDraft
  },

  async discardGameDraft(serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DiscardGameDraft($serverId: ID) {
        discardGameDraft(serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ discardGameDraft: boolean }>(mutation, {
      serverId,
    })
    return data.discardGameDraft
  },

  async createGameFileUpload(
    input: CreateGameFileUploadInputGql,
    serverId: string,
  ): Promise<GameFileUploadPayloadGql> {
    const mutation = /* GraphQL */ `
      mutation CreateGameFileUpload($input: CreateGameFileUploadInput!, $serverId: ID) {
        createGameFileUpload(input: $input, serverId: $serverId) {
          uploadToken
          expiresAt
          maxSizeBytes
          expectedCategory
          objectKey
          bucket
          endpoint
          credentials {
            accessKeyId
            secretAccessKey
            sessionToken
          }
        }
      }
    `
    const data = await executeGraphQL<{ createGameFileUpload: GameFileUploadPayloadGql }>(mutation, {
      input,
      serverId,
    })
    return data.createGameFileUpload
  },

  async completeGameFileUpload(
    input: CompleteGameFileUploadInputGql,
  ): Promise<GameFileUploadCompletePayloadGql> {
    const mutation = /* GraphQL */ `
      mutation CompleteGameFileUpload($input: CompleteGameFileUploadInput!) {
        completeGameFileUpload(input: $input) {
          tokenHash
          sizeBytes
        }
      }
    `
    const data = await executeGraphQL<{ completeGameFileUpload: GameFileUploadCompletePayloadGql }>(mutation, { input })
    return data.completeGameFileUpload
  },

  async addGameFile(input: {
    name: string
    category?: string
    logicalPath?: string
    explicitPolicy?: import("../types").SyncPolicy
    tokenHash: string
  }, serverId: string): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation AddGameFile($input: AddGameFileInput!, $serverId: ID) {
        addGameFile(input: $input, serverId: $serverId) {
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
    const data = await executeGraphQL<{ addGameFile: import("../types").AdminGameFile }>(mutation, {
      input,
      serverId,
    })
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
  }, serverId: string): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation SaveGameFileContent($input: SaveGameFileContentInput!, $serverId: ID) {
        saveGameFileContent(input: $input, serverId: $serverId) {
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
    const data = await executeGraphQL<{ saveGameFileContent: import("../types").AdminGameFile }>(mutation, {
      input,
      serverId,
    })
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

  async createGameFolder(logicalPath: string, serverId: string): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation CreateGameFolder($logicalPath: String!, $serverId: ID) {
        createGameFolder(logicalPath: $logicalPath, serverId: $serverId) {
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
    const data = await executeGraphQL<{ createGameFolder: import("../types").AdminGameFile }>(mutation, {
      logicalPath,
      serverId,
    })
    return data.createGameFolder
  },

  async renameGamePath(oldPath: string, newPath: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RenameGamePath($oldPath: String!, $newPath: String!, $serverId: ID) {
        renameGamePath(oldPath: $oldPath, newPath: $newPath, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ renameGamePath: boolean }>(mutation, {
      oldPath,
      newPath,
      serverId,
    })
    return data.renameGamePath
  },

  async moveGamePaths(sources: string[], destinationFolder: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation MoveGamePaths($sources: [String!]!, $destinationFolder: String!, $serverId: ID) {
        moveGamePaths(sources: $sources, destinationFolder: $destinationFolder, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ moveGamePaths: boolean }>(mutation, {
      sources,
      destinationFolder,
      serverId,
    })
    return data.moveGamePaths
  },

  async copyGamePaths(sources: string[], destinationFolder: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation CopyGamePaths($sources: [String!]!, $destinationFolder: String!, $serverId: ID) {
        copyGamePaths(sources: $sources, destinationFolder: $destinationFolder, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ copyGamePaths: boolean }>(mutation, {
      sources,
      destinationFolder,
      serverId,
    })
    return data.copyGamePaths
  },

  async deleteGamePaths(paths: string[], serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation DeleteGamePaths($paths: [String!]!, $serverId: ID) {
        deleteGamePaths(paths: $paths, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ deleteGamePaths: boolean }>(mutation, {
      paths,
      serverId,
    })
    return data.deleteGamePaths
  },

  async setGamePathPolicy(path: string, explicitPolicy: import("../types").SyncPolicy | null | undefined, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation SetGamePathPolicy($path: String!, $explicitPolicy: SyncPolicy, $serverId: ID) {
        setGamePathPolicy(path: $path, explicitPolicy: $explicitPolicy, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ setGamePathPolicy: boolean }>(mutation, {
      path,
      explicitPolicy,
      serverId,
    })
    return data.setGamePathPolicy
  },

  async removeGameFile(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RemoveGameFile($id: ID!, $serverId: ID) {
        removeGameFile(id: $id, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ removeGameFile: boolean }>(mutation, {
      id,
      serverId,
    })
    return data.removeGameFile
  },

  async restoreGameFile(id: string, serverId: string): Promise<import("../types").AdminGameFile> {
    const mutation = /* GraphQL */ `
      mutation RestoreGameFile($id: ID!, $serverId: ID) {
        restoreGameFile(id: $id, serverId: $serverId) {
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
    const data = await executeGraphQL<{ restoreGameFile: import("../types").AdminGameFile }>(mutation, {
      id,
      serverId,
    })
    return data.restoreGameFile
  },

  async getGameEnvironmentCatalog(): Promise<{ minecraftVersions: string[]; loaders: import("../types").GameModLoader[] }> {
    const query = /* GraphQL */ `
      query GameEnvironmentCatalog {
        gameEnvironmentCatalog {
          minecraftVersions
          loaders
        }
      }
    `
    const data = await executeGraphQL<{ gameEnvironmentCatalog: { minecraftVersions: string[]; loaders: import("../types").GameModLoader[] } }>(query)
    return data.gameEnvironmentCatalog
  },

  async getGameLoaderVersions(
    minecraftVersion: string,
    modLoader: import("../types").GameModLoader,
  ): Promise<import("../types").GameLoaderVersion[]> {
    const query = /* GraphQL */ `
      query GameLoaderVersions($minecraftVersion: String!, $modLoader: GameModLoader!) {
        gameLoaderVersions(minecraftVersion: $minecraftVersion, modLoader: $modLoader) {
          version
          stable
        }
      }
    `
    const data = await executeGraphQL<{ gameLoaderVersions: import("../types").GameLoaderVersion[] }>(
      query,
      { minecraftVersion, modLoader },
    )
    return data.gameLoaderVersions
  },

  async updateGameDraftMetadata(
    input: import("../types").UpdateGameDraftMetadataInput,
    serverId: string,
  ): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation UpdateGameDraftMetadata($input: UpdateGameDraftMetadataInput!, $serverId: ID) {
        updateGameDraftMetadata(input: $input, serverId: $serverId) {
          id
          version
          minecraftVersion
          modLoader
          modLoaderVersion
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
    const data = await executeGraphQL<{ updateGameDraftMetadata: import("../types").GameRelease }>(mutation, {
      input,
      serverId,
    })
    return data.updateGameDraftMetadata
  },

  async publishGameRelease(
    input: import("../types").PublishGameReleaseInput,
    serverId: string,
  ): Promise<import("../types").GameRelease> {
    const mutation = /* GraphQL */ `
      mutation PublishGameRelease($input: PublishGameReleaseInput!, $serverId: ID) {
        publishGameRelease(input: $input, serverId: $serverId) {
          id
          version
          minecraftVersion
          modLoader
          modLoaderVersion
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
    const data = await executeGraphQL<{ publishGameRelease: import("../types").GameRelease }>(mutation, {
      input,
      serverId,
    })
    return data.publishGameRelease
  },

  async searchMods(
    query: string,
    contentType: import("../types").ContentType | null | undefined,
    provider: import("../types").ModProvider | null | undefined,
    limit: number | undefined,
    offset: number | undefined,
    serverId: string,
  ): Promise<import("../types").ModSearchPayload> {
    return modProvidersApi.searchMods(query, contentType, provider, limit, offset, serverId)
  },

  async getModProjectDetail(
    provider: import("../types").ModProvider,
    projectId: string,
    contentType: import("../types").ContentType | null | undefined,
    serverId: string,
  ): Promise<import("../types").ModProjectDetail> {
    return modProvidersApi.getModProjectDetail(provider, projectId, contentType, serverId)
  },

  async resolveModInstallationPlan(
    input: import("../types").ResolveModPlanInput,
    serverId: string,
  ): Promise<import("../types").ModInstallationPlan> {
    return modProvidersApi.resolveModInstallationPlan(input, serverId)
  },

  async installModPlan(
    input: import("../types").InstallModPlanInput,
    serverId: string,
  ): Promise<import("../types").AdminGameFile[]> {
    return modProvidersApi.installModPlan(input, serverId)
  },
}


// --- Settings API Facade (Shard 06.5 & Shard 08F) ---

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
          updateDeploymentOrder
          launcherActiveReleaseId
          updatedAt
        }
      }
    `
    const data = await executeGraphQL<{ adminSettings: import("../types").AdminSettings }>(query)
    return data.adminSettings
  },

  async updateAdminSettings(
    input: import("../types").UpdateAdminSettingsInput,
  ): Promise<import("../types").AdminSettings> {
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
          updateDeploymentOrder
          launcherActiveReleaseId
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
    contentType: import("../types").ContentType | null | undefined,
    provider: import("../types").ModProvider | null | undefined,
    limit: number | undefined,
    offset: number | undefined,
    serverId: string,
  ): Promise<import("../types").ModSearchPayload> {
    const gqlQuery = /* GraphQL */ `
      query SearchMods(
        $query: String!
        $contentType: ContentType
        $provider: ModProvider
        $limit: Int
        $offset: Int
        $serverId: ID
      ) {
        searchMods(
          query: $query
          contentType: $contentType
          provider: $provider
          limit: $limit
          offset: $offset
          serverId: $serverId
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
          modLoader
          modLoaderVersion
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
      serverId,
    })
    return data.searchMods
  },

  async getModProjectDetail(
    provider: import("../types").ModProvider,
    projectId: string,
    contentType: import("../types").ContentType | null | undefined,
    serverId: string,
  ): Promise<import("../types").ModProjectDetail> {
    const gqlQuery = /* GraphQL */ `
      query GetModProjectDetail(
        $provider: ModProvider!
        $projectId: String!
        $contentType: ContentType
        $serverId: ID
      ) {
        getModProjectDetail(
          provider: $provider
          projectId: $projectId
          contentType: $contentType
          serverId: $serverId
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
          modLoader
          modLoaderVersion
          neoForgeVersion
        }
      }
    `
    const data = await executeGraphQL<{ getModProjectDetail: import("../types").ModProjectDetail }>(gqlQuery, {
      provider,
      projectId,
      contentType: contentType || "MOD",
      serverId,
    })
    return data.getModProjectDetail
  },

  async resolveModInstallationPlan(
    input: import("../types").ResolveModPlanInput,
    serverId: string,
  ): Promise<import("../types").ModInstallationPlan> {
    const gqlQuery = /* GraphQL */ `
      query ResolveModInstallationPlan($input: ResolveModPlanInput!, $serverId: ID) {
        resolveModInstallationPlan(input: $input, serverId: $serverId) {
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
      serverId,
    })
    return data.resolveModInstallationPlan
  },

  async installModPlan(
    input: import("../types").InstallModPlanInput,
    serverId: string,
  ): Promise<import("../types").AdminGameFile[]> {
    const mutation = /* GraphQL */ `
      mutation InstallModPlan($input: InstallModPlanInput!, $serverId: ID) {
        installModPlan(input: $input, serverId: $serverId) {
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
    const data = await executeGraphQL<{ installModPlan: import("../types").AdminGameFile[] }>(mutation, {
      input,
      serverId,
    })
    return data.installModPlan
  },
}

// --- Server Content & Release Sync API (Shard 08D) ---

export const serverContentApi = {
  async getServerManagedContent(serverId: string): Promise<import("../types").ServerManagedContentItem[]> {
    const query = /* GraphQL */ `
      query ServerManagedContent($serverId: ID) {
        serverManagedContent(serverId: $serverId) {
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
    const data = await executeGraphQL<{ serverManagedContent: import("../types").ServerManagedContentItem[] }>(query, {
      serverId,
    })
    return data.serverManagedContent || []
  },

  async searchServerContent(
    query: string,
    contentType: import("../types").ContentType | null | undefined,
    provider: import("../types").ModProvider | null | undefined,
    limit: number | undefined,
    offset: number | undefined,
    cursor: string | null | undefined,
    serverId: string,
  ): Promise<import("../types").ServerContentSearchPayload> {
    const gqlQuery = /* GraphQL */ `
      query SearchServerContent(
        $query: String!
        $contentType: ContentType
        $provider: ModProvider
        $limit: Int
        $offset: Int
        $cursor: String
        $serverId: ID
      ) {
        searchServerContent(
          query: $query
          contentType: $contentType
          provider: $provider
          limit: $limit
          offset: $offset
          cursor: $cursor
          serverId: $serverId
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
          hasMore
          nextCursor
          providersStatus {
            provider
            available
            error
          }
          minecraftVersion
          modLoader
          modLoaderVersion
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
      cursor,
      serverId,
    })
    return data.searchServerContent
  },

  async getServerContentProjectDetail(
    provider: import("../types").ModProvider,
    projectId: string,
    contentType: import("../types").ContentType | null | undefined,
    serverId: string,
  ): Promise<import("../types").ModProjectDetail> {
    const gqlQuery = /* GraphQL */ `
      query ServerContentProjectDetail(
        $provider: ModProvider!
        $projectId: String!
        $contentType: ContentType
        $serverId: ID
      ) {
        serverContentProjectDetail(
          provider: $provider
          projectId: $projectId
          contentType: $contentType
          serverId: $serverId
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
          modLoader
          modLoaderVersion
          neoForgeVersion
        }
      }
    `
    const data = await executeGraphQL<{ serverContentProjectDetail: import("../types").ModProjectDetail }>(gqlQuery, {
      provider,
      projectId,
      contentType: contentType || "MOD",
      serverId,
    })
    return data.serverContentProjectDetail
  },

  async resolveServerContentPlan(
    input: import("../types").ResolveServerContentPlanInput,
    serverId: string,
  ): Promise<import("../types").ServerContentInstallationPlan> {
    const gqlQuery = /* GraphQL */ `
      query ResolveServerContentPlan($input: ResolveServerContentPlanInput!, $serverId: ID) {
        resolveServerContentPlan(input: $input, serverId: $serverId) {
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
      serverId,
    })
    return data.resolveServerContentPlan
  },

  async installServerContentPlan(
    input: import("../types").InstallServerContentPlanInput,
    serverId: string,
  ): Promise<import("../types").ServerManagedContentItem[]> {
    const mutation = /* GraphQL */ `
      mutation InstallServerContentPlan($input: InstallServerContentPlanInput!, $serverId: ID) {
        installServerContentPlan(input: $input, serverId: $serverId) {
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
    const data = await executeGraphQL<{ installServerContentPlan: import("../types").ServerManagedContentItem[] }>(mutation, {
      input,
      serverId,
    })
    return data.installServerContentPlan
  },

  async removeServerManagedContent(id: string, serverId: string): Promise<boolean> {
    const mutation = /* GraphQL */ `
      mutation RemoveServerManagedContent($id: ID!, $serverId: ID) {
        removeServerManagedContent(id: $id, serverId: $serverId)
      }
    `
    const data = await executeGraphQL<{ removeServerManagedContent: boolean }>(mutation, {
      id,
      serverId,
    })
    return data.removeServerManagedContent
  },

  async getServerReleaseSyncPlan(serverId: string): Promise<import("../types").ServerReleaseSyncPlan> {
    const query = /* GraphQL */ `
      query ServerReleaseSyncPlan($serverId: ID) {
        serverReleaseSyncPlan(serverId: $serverId) {
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
    const data = await executeGraphQL<{ serverReleaseSyncPlan: import("../types").ServerReleaseSyncPlan }>(query, {
      serverId,
    })
    return data.serverReleaseSyncPlan
  },

  async getServerReleaseSyncStatus(serverId: string): Promise<import("../types").ServerReleaseSyncStatus | null> {
    const query = /* GraphQL */ `
      query ServerReleaseSyncStatus($serverId: ID) {
        serverReleaseSyncStatus(serverId: $serverId) {
          releaseId
          releaseVersion
          status
          appliedAt
          details
        }
      }
    `
    const data = await executeGraphQL<{ serverReleaseSyncStatus: import("../types").ServerReleaseSyncStatus | null }>(query, {
      serverId,
    })
    return data.serverReleaseSyncStatus
  },

  async applyServerReleaseSync(createBackup: boolean | undefined, serverId: string): Promise<import("../types").ServerReleaseSyncResult> {
    const mutation = /* GraphQL */ `
      mutation ApplyServerReleaseSync($createBackup: Boolean, $serverId: ID) {
        applyServerReleaseSync(createBackup: $createBackup, serverId: $serverId) {
          success
          message
          syncedCount
          status
        }
      }
    `
    const data = await executeGraphQL<{ applyServerReleaseSync: import("../types").ServerReleaseSyncResult }>(mutation, {
      createBackup,
      serverId,
    })
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






