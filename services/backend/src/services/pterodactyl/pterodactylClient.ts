/**
 * Pterodactyl HTTP Client Adapter (Shard 06)
 * Encapsulates communication with Pterodactyl Panel Client API v1 with strict
 * timeouts, credential protection, normalized Spanish errors, and zero secret leakage.
 */

import type {
  IPterodactylClient,
  PterodactylServerResponse,
  PterodactylStatsResponse,
  PterodactylWebsocketData,
  PterodactylWebsocketResponse,
} from "./types"

export interface PterodactylClientOptions {
  baseUrl: string
  apiKey: string
  serverId: string
  timeoutMs?: number
  fetchFn?: typeof fetch
}

export class PterodactylHttpClient implements IPterodactylClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly serverId: string
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(options: PterodactylClientOptions) {
    if (!options.baseUrl || typeof options.baseUrl !== "string") {
      throw new Error("Pterodactyl baseUrl is required")
    }
    if (!options.apiKey || typeof options.apiKey !== "string") {
      throw new Error("Pterodactyl apiKey is required")
    }
    if (!options.serverId || typeof options.serverId !== "string") {
      throw new Error("Pterodactyl serverId is required")
    }

    // Normalize baseUrl: strip trailing slashes
    this.baseUrl = options.baseUrl.replace(/\/+$/, "")
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
        throw new Error("Tiempo de espera agotado al conectar con el servidor.")
      }
      throw new Error("No se pudo conectar con el servidor en este momento.")
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Error de autenticación con la infraestructura del servidor.")
      }
      if (response.status === 404) {
        throw new Error("Servidor no encontrado en la infraestructura.")
      }
      if (response.status === 429) {
        throw new Error("Límite de solicitudes alcanzado. Por favor espera un momento.")
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new Error("No se pudo conectar con el servidor en este momento.")
      }
      throw new Error("Error al comunicarse con la infraestructura del servidor.")
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T
    }

    try {
      const data = await response.json()
      return data as T
    } catch {
      throw new Error("Respuesta inválida de la infraestructura del servidor.")
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
    if (!res || !res.data) {
      throw new Error("No se pudieron obtener credenciales de consola.")
    }
    return res.data
  }
}
