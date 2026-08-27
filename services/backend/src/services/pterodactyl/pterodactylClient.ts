/**
 * Pterodactyl HTTP Client Adapter (Shard 06 & Shard 07)
 * Encapsulates communication with Pterodactyl Panel Client API v1 with strict
 * timeouts, protocol/SSRF validation, credential protection, normalized Spanish public messages,
 * and zero secret leakage.
 */

import type {
  IPterodactylClient,
  PterodactylServerResponse,
  PterodactylStatsResponse,
  PterodactylWebsocketData,
  PterodactylWebsocketResponse,
  PterodactylBackupResponse,
  PterodactylBackupListResponse,
  PterodactylSignedUrlResponse,
  PterodactylFileResponse,
  PterodactylFileListResponse,
  PterodactylScheduleResponse,
  PterodactylScheduleListResponse,
  PterodactylActivityListResponse,
  CreateScheduleInput,
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from "./types"
import { SERVER_ERROR_CODES, SERVER_PUBLIC_MESSAGES } from "@hikat/shared"

export class ServerInfrastructureError extends Error {
  public readonly code: string
  public readonly publicMessage: string
  public readonly internalMessage?: string
  public readonly extensions: { code: string }

  constructor(
    code: string = SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
    publicMessage: string = SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
    internalMessage?: string,
  ) {
    super(publicMessage)
    this.name = "ServerInfrastructureError"
    this.code = code
    this.publicMessage = publicMessage
    this.internalMessage = internalMessage
    this.extensions = { code }
  }
}

export interface PterodactylClientOptions {
  baseUrl: string
  apiKey: string
  serverId: string
  isProduction?: boolean
  timeoutMs?: number
  fetchFn?: typeof fetch
}

export class PterodactylHttpClient implements IPterodactylClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly serverId: string
  private readonly isProduction: boolean
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(options: PterodactylClientOptions) {
    if (!options.baseUrl || typeof options.baseUrl !== "string") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Pterodactyl baseUrl is missing or not a string",
      )
    }
    if (!options.apiKey || typeof options.apiKey !== "string") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Pterodactyl apiKey is missing or not a string",
      )
    }
    if (!options.serverId || typeof options.serverId !== "string") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Pterodactyl serverId is missing or not a string",
      )
    }

    const trimmedUrl = options.baseUrl.trim()
    let parsed: URL
    try {
      parsed = new URL(trimmedUrl)
    } catch {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Invalid Pterodactyl baseUrl URL format",
      )
    }

    this.isProduction = options.isProduction ?? false

    // SSRF & Protocol validation
    if (this.isProduction && parsed.protocol !== "https:") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Pterodactyl baseUrl must use HTTPS in production environment",
      )
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Invalid Pterodactyl URL protocol. Expected HTTP or HTTPS.",
      )
    }

    if (parsed.username || parsed.password) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
        SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
        "Pterodactyl baseUrl must not contain embedded user credentials",
      )
    }

    // Normalize baseUrl: strip trailing slashes
    this.baseUrl = trimmedUrl.replace(/\/+$/, "")
    this.apiKey = options.apiKey.trim()
    this.serverId = options.serverId.trim()
    this.timeoutMs = options.timeoutMs ?? 8000
    this.fetchFn = options.fetchFn ?? fetch
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string
      body?: Record<string, unknown> | string
      rawBody?: boolean
      isTextResponse?: boolean
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "Application/vnd.pterodactyl.v1+json",
    }

    let requestBody: string | undefined
    if (options.body !== undefined) {
      if (options.rawBody && typeof options.body === "string") {
        headers["Content-Type"] = "text/plain"
        requestBody = options.body
      } else {
        headers["Content-Type"] = "application/json"
        requestBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body)
      }
    }

    let response: Response
    try {
      response = await this.fetchFn(url, {
        method: options.method ?? "GET",
        headers,
        body: requestBody,
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("aborted"))) {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
          "Connection timeout with Pterodactyl API",
        )
      }
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        "Network connection failure with Pterodactyl API",
      )
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED,
          SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED,
          `Pterodactyl authentication failed with status ${response.status}`,
        )
      }
      if (response.status === 404) {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
          `Pterodactyl server resource not found (${response.status})`,
        )
      }
      if (response.status === 429) {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_RATE_LIMITED,
          SERVER_PUBLIC_MESSAGES.SERVER_RATE_LIMITED,
          "Pterodactyl upstream rate limit (429)",
        )
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
          `Pterodactyl upstream gateway error (${response.status})`,
        )
      }
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        `Pterodactyl API returned HTTP error ${response.status}`,
      )
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T
    }

    if (options.isTextResponse) {
      try {
        const text = await response.text()
        return text as unknown as T
      } catch {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
          "Invalid text response from Pterodactyl API",
        )
      }
    }

    try {
      const data = await response.json()
      return data as T
    } catch {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        "Invalid JSON response from Pterodactyl API",
      )
    }
  }

  async getServerDetails(): Promise<PterodactylServerResponse> {
    return this.request<PterodactylServerResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}`,
      { method: "GET" },
    )
  }

  async getServerResources(): Promise<PterodactylStatsResponse> {
    return this.request<PterodactylStatsResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/resources`,
      { method: "GET" },
    )
  }

  async sendPowerAction(signal: "start" | "stop" | "restart" | "kill"): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/power`,
      {
        method: "POST",
        body: { signal },
      },
    )
  }

  async sendCommand(command: string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/command`,
      {
        method: "POST",
        body: { command },
      },
    )
  }

  async getWebsocketCredentials(): Promise<PterodactylWebsocketData> {
    const res = await this.request<PterodactylWebsocketResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/websocket`,
      { method: "GET" },
    )
    if (!res || !res.data || !res.data.socket || !res.data.token) {
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        "Failed to retrieve WebSocket credentials from Pterodactyl",
      )
    }

    // Validate Wings socket URL
    try {
      const socketUrl = new URL(res.data.socket)
      if (this.isProduction && socketUrl.protocol !== "wss:") {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
          "Wings WebSocket URL must use WSS in production environment",
        )
      } else if (socketUrl.protocol !== "wss:" && socketUrl.protocol !== "ws:") {
        throw new ServerInfrastructureError(
          SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
          SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
          "Invalid Wings WebSocket URL protocol",
        )
      }
    } catch (err: unknown) {
      if (err instanceof ServerInfrastructureError) throw err
      throw new ServerInfrastructureError(
        SERVER_ERROR_CODES.SERVER_UNAVAILABLE,
        SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE,
        "Invalid Wings WebSocket URL structure",
      )
    }

    return res.data
  }

  // --- Backups API ---

  async listBackups(): Promise<PterodactylBackupListResponse> {
    return this.request<PterodactylBackupListResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups`,
      { method: "GET" },
    )
  }

  async getBackup(uuid: string): Promise<PterodactylBackupResponse> {
    return this.request<PterodactylBackupResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups/${encodeURIComponent(uuid)}`,
      { method: "GET" },
    )
  }

  async createBackup(name?: string, isLocked: boolean = false): Promise<PterodactylBackupResponse> {
    const body: Record<string, unknown> = { is_locked: Boolean(isLocked) }
    if (name && typeof name === "string" && name.trim()) {
      body.name = name.trim()
    }
    return this.request<PterodactylBackupResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups`,
      {
        method: "POST",
        body,
      },
    )
  }

  async getBackupDownload(uuid: string): Promise<PterodactylSignedUrlResponse> {
    return this.request<PterodactylSignedUrlResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups/${encodeURIComponent(uuid)}/download`,
      { method: "GET" },
    )
  }

  async restoreBackup(uuid: string, truncate: boolean = true): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups/${encodeURIComponent(uuid)}/restore`,
      {
        method: "POST",
        body: { truncate },
      },
    )
  }

  async deleteBackup(uuid: string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups/${encodeURIComponent(uuid)}`,
      { method: "DELETE" },
    )
  }

  async toggleBackupLock(uuid: string): Promise<PterodactylBackupResponse> {
    return this.request<PterodactylBackupResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/backups/${encodeURIComponent(uuid)}/lock`,
      { method: "POST" },
    )
  }

  // --- Files API ---

  async listDirectory(directory: string = "/"): Promise<PterodactylFileListResponse> {
    const dirParam = encodeURIComponent(directory || "/")
    return this.request<PterodactylFileListResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/list?directory=${dirParam}`,
      { method: "GET" },
    )
  }

  async getFileContents(filePath: string): Promise<string> {
    const fileParam = encodeURIComponent(filePath)
    return this.request<string>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/contents?file=${fileParam}`,
      { method: "GET", isTextResponse: true },
    )
  }

  async getFileDownload(filePath: string): Promise<PterodactylSignedUrlResponse> {
    const fileParam = encodeURIComponent(filePath)
    return this.request<PterodactylSignedUrlResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/download?file=${fileParam}`,
      { method: "GET" },
    )
  }

  async getFileUploadUrl(): Promise<PterodactylSignedUrlResponse> {
    return this.request<PterodactylSignedUrlResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/upload`,
      { method: "GET" },
    )
  }

  async renameFile(root: string, from: string, to: string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/rename`,
      {
        method: "PUT",
        body: {
          root: root || "/",
          files: [{ from, to }],
        },
      },
    )
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fileParam = encodeURIComponent(filePath)
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/write?file=${fileParam}`,
      {
        method: "POST",
        body: content,
        rawBody: true,
      },
    )
  }

  async createFolder(root: string, name: string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/create-folder`,
      {
        method: "POST",
        body: {
          root: root || "/",
          name,
        },
      },
    )
  }

  async deleteFiles(root: string, files: string[]): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/delete`,
      {
        method: "POST",
        body: {
          root: root || "/",
          files,
        },
      },
    )
  }

  async compressFiles(root: string, files: string[]): Promise<PterodactylFileResponse> {
    return this.request<PterodactylFileResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/compress`,
      {
        method: "POST",
        body: {
          root: root || "/",
          files,
        },
      },
    )
  }

  async decompressFile(root: string, file: string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/files/decompress`,
      {
        method: "POST",
        body: {
          root: root || "/",
          file,
        },
      },
    )
  }

  // --- Schedules API ---

  async listSchedules(): Promise<PterodactylScheduleListResponse> {
    return this.request<PterodactylScheduleListResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules`,
      { method: "GET" },
    )
  }

  async getSchedule(id: number | string): Promise<PterodactylScheduleResponse> {
    return this.request<PterodactylScheduleResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(id))}`,
      { method: "GET" },
    )
  }

  async createSchedule(payload: CreateScheduleInput): Promise<PterodactylScheduleResponse> {
    return this.request<PterodactylScheduleResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules`,
      {
        method: "POST",
        body: {
          name: payload.name,
          is_active: payload.is_active ?? true,
          minute: payload.minute,
          hour: payload.hour,
          day_of_month: payload.day_of_month,
          month: payload.month,
          day_of_week: payload.day_of_week,
          only_when_online: payload.only_when_online ?? true,
        },
      },
    )
  }

  async updateSchedule(
    id: number | string,
    payload: Partial<CreateScheduleInput>,
  ): Promise<PterodactylScheduleResponse> {
    return this.request<PterodactylScheduleResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(id))}`,
      {
        method: "POST",
        body: payload as Record<string, unknown>,
      },
    )
  }

  async executeSchedule(id: number | string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(id))}/execute`,
      { method: "POST" },
    )
  }

  async deleteSchedule(id: number | string): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(id))}`,
      { method: "DELETE" },
    )
  }

  async createScheduleTask(
    scheduleId: number | string,
    taskPayload: CreateScheduleTaskInput,
  ): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(scheduleId))}/tasks`,
      {
        method: "POST",
        body: {
          action: taskPayload.action,
          payload: taskPayload.payload,
          time_offset: taskPayload.time_offset ?? 0,
          continue_on_failure: taskPayload.continue_on_failure ?? false,
        },
      },
    )
  }

  async updateScheduleTask(
    scheduleId: number | string,
    taskId: number | string,
    taskPayload: UpdateScheduleTaskInput,
  ): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(scheduleId))}/tasks/${encodeURIComponent(String(taskId))}`,
      {
        method: "POST",
        body: {
          action: taskPayload.action,
          payload: taskPayload.payload,
          time_offset: taskPayload.time_offset ?? 0,
          continue_on_failure: taskPayload.continue_on_failure ?? false,
        },
      },
    )
  }

  async deleteScheduleTask(
    scheduleId: number | string,
    taskId: number | string,
  ): Promise<void> {
    await this.request<void>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/schedules/${encodeURIComponent(String(scheduleId))}/tasks/${encodeURIComponent(String(taskId))}`,
      { method: "DELETE" },
    )
  }

  // --- Activity API ---

  async getServerActivity(): Promise<PterodactylActivityListResponse> {
    return this.request<PterodactylActivityListResponse>(
      `/api/client/servers/${encodeURIComponent(this.serverId)}/activity`,
      { method: "GET" },
    )
  }
}
