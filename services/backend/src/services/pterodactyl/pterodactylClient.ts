/**
 * Pterodactyl HTTP Client Adapter (Shard 06 & 06A)
 * Encapsulates communication with Pterodactyl Panel Client API v1 with strict
 * timeouts, protocol/SSRF validation, credential protection, normalized Spanish errors,
 * and zero secret leakage.
 */

import type {
  IPterodactylClient,
  PterodactylServerResponse,
  PterodactylStatsResponse,
  PterodactylWebsocketData,
  PterodactylWebsocketResponse,
} from "./types"
import { SERVER_ERROR_CODES } from "@hikat/shared"

export class ServerInfrastructureError extends Error {
  public readonly code: string
  public readonly extensions: { code: string }
  constructor(message: string, code: string = SERVER_ERROR_CODES.SERVER_UNAVAILABLE) {
    super(message)
    this.name = "ServerInfrastructureError"
    this.code = code
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
      throw new ServerInfrastructureError("La URL de Pterodactyl no está configurada.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
    }
    if (!options.apiKey || typeof options.apiKey !== "string") {
      throw new ServerInfrastructureError("La API key de Pterodactyl no está configurada.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
    }
    if (!options.serverId || typeof options.serverId !== "string") {
      throw new ServerInfrastructureError("El ID del servidor no está configurado.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
    }

    const trimmedUrl = options.baseUrl.trim()
    let parsed: URL
    try {
      parsed = new URL(trimmedUrl)
    } catch {
      throw new ServerInfrastructureError("La URL de Pterodactyl es inválida.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
    }

    this.isProduction = options.isProduction ?? false

    // SSRF & Protocol validation
    if (this.isProduction && parsed.protocol !== "https:") {
      throw new ServerInfrastructureError("Pterodactyl debe utilizar HTTPS en entorno de producción.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ServerInfrastructureError("Protocolo de Pterodactyl inválido. Debe ser HTTP o HTTPS.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
    }

    if (parsed.username || parsed.password) {
      throw new ServerInfrastructureError("La URL de Pterodactyl no debe contener credenciales embebidas.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
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
        throw new ServerInfrastructureError("Tiempo de espera agotado al conectar con el servidor.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
      }
      throw new ServerInfrastructureError("No se pudo conectar con el servidor en este momento.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ServerInfrastructureError("Error de autenticación con la infraestructura del servidor.", SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED)
      }
      if (response.status === 404) {
        throw new ServerInfrastructureError("Servidor no encontrado en la infraestructura.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
      }
      if (response.status === 429) {
        throw new ServerInfrastructureError("Límite de solicitudes alcanzado. Por favor espera un momento.", SERVER_ERROR_CODES.SERVER_RATE_LIMITED)
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new ServerInfrastructureError("No se pudo conectar con el servidor en este momento.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
      }
      throw new ServerInfrastructureError("Error al comunicarse con la infraestructura del servidor.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T
    }

    try {
      const data = await response.json()
      return data as T
    } catch {
      throw new ServerInfrastructureError("Respuesta inválida de la infraestructura del servidor.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
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
      throw new ServerInfrastructureError("No se pudieron obtener credenciales de consola.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
    }

    // Validate Wings socket URL
    try {
      const socketUrl = new URL(res.data.socket)
      if (this.isProduction && socketUrl.protocol !== "wss:") {
        throw new ServerInfrastructureError("El WebSocket de Wings debe utilizar WSS en producción.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
      } else if (socketUrl.protocol !== "wss:" && socketUrl.protocol !== "ws:") {
        throw new ServerInfrastructureError("Protocolo de WebSocket de Wings inválido.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
      }
    } catch (err: unknown) {
      if (err instanceof ServerInfrastructureError) throw err
      throw new ServerInfrastructureError("URL de WebSocket de Wings inválida.", SERVER_ERROR_CODES.SERVER_UNAVAILABLE)
    }

    return res.data
  }
}
