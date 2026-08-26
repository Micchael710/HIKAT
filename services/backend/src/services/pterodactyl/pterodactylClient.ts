/**
 * Pterodactyl HTTP Client Adapter (Shard 06, 06A & 06B)
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
      body?: Record<string, unknown>
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "Application/vnd.pterodactyl.v1+json",
    }

    let response: Response
    try {
      response = await this.fetchFn(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
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
}
