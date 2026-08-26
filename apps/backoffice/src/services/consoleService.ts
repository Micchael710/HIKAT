/**
 * HiKAT Back Office Server Console Service (Shard 06 & Shard 06A)
 * Manages real-time WebSocket connection to the HiKAT Backend console proxy
 * using single-use console connection tickets (no JWT in URL), with automatic
 * reconnection with fresh tickets, event dispatching, and fallback.
 */

import { authService } from "./authService"
import { serverApi } from "./graphqlClient"
import { validateServerCommand } from "@hikat/shared"
import type { ConsoleLogEntry, ServerStatus } from "../types"

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787"

type LogListener = (entry: ConsoleLogEntry) => void
type StatusListener = (status: ServerStatus) => void
type ConnectionListener = (connected: boolean) => void
type ErrorListener = (error: string) => void

class ConsoleService {
  private ws: WebSocket | null = null
  private logListeners: Set<LogListener> = new Set()
  private statusListeners: Set<StatusListener> = new Set()
  private connectionListeners: Set<ConnectionListener> = new Set()
  private errorListeners: Set<ErrorListener> = new Set()
  private isConnecting: boolean = false
  private shouldReconnect: boolean = false
  private reconnectTimer: any = null
  private retryCount: number = 0

  public async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const token = authService.getAccessToken()
    if (!token) {
      this.notifyConnection(false)
      return
    }

    this.shouldReconnect = true
    this.isConnecting = true

    try {
      // 1. Request a single-use console connection ticket via authenticated GraphQL
      let ticketData: { ticket: string; expiresAt: string }
      try {
        ticketData = await serverApi.createServerConsoleTicket()
      } catch (err: unknown) {
        // If authentication failed, attempt refresh
        const isAuthError =
          err instanceof Error &&
          (err.message.includes("UNAUTHENTICATED") || err.message.includes("401"))

        if (isAuthError) {
          const refreshed = await authService.refresh()
          if (refreshed) {
            ticketData = await serverApi.createServerConsoleTicket()
          } else {

            this.shouldReconnect = false
            this.notifyConnection(false)
            this.isConnecting = false
            return
          }
        } else {
          this.isConnecting = false
          this.notifyConnection(false)
          if (this.shouldReconnect) {
            this.scheduleReconnect()
          }
          return
        }
      }

      // 2. Open WebSocket using ONLY the single-use ticket (No JWT in URL)
      const wsUrl = new URL(BACKEND_URL)
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
      wsUrl.pathname = "/api/server/console/ws"
      wsUrl.searchParams.set("ticket", ticketData.ticket)

      this.ws = new WebSocket(wsUrl.toString())

      this.ws.onopen = () => {
        this.isConnecting = false
        this.retryCount = 0
        this.notifyConnection(true)
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (!data) return

          if (data.type === "log" && typeof data.line === "string") {
            const entry: ConsoleLogEntry = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              line: data.line,
              timestamp: data.timestamp || new Date().toISOString(),
              type: "stdout",
            }
            this.logListeners.forEach((listener) => listener(entry))
          } else if (data.type === "status" && data.status) {
            this.statusListeners.forEach((listener) => listener(data.status))
          } else if (data.type === "error" && typeof data.message === "string") {
            this.errorListeners.forEach((listener) => listener(data.message))
          }
        } catch {
          if (typeof event.data === "string" && event.data.trim()) {
            const entry: ConsoleLogEntry = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              line: event.data,
              timestamp: new Date().toISOString(),
              type: "stdout",
            }
            this.logListeners.forEach((listener) => listener(entry))
          }
        }
      }

      this.ws.onclose = (event) => {
        this.isConnecting = false
        this.ws = null
        this.notifyConnection(false)

        // If closed due to policy violation (e.g. session revoked/expired), stop reconnect
        if (event.code === 1008) {
          this.shouldReconnect = false
          return
        }

        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        this.isConnecting = false
        this.notifyConnection(false)
      }
    } catch {
      this.isConnecting = false
      this.notifyConnection(false)
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    const delay = Math.min(1000 * Math.pow(1.5, this.retryCount), 8000)
    this.retryCount++
    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect()
      }
    }, delay)
  }

  public disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "User left console")
      } catch {}
      this.ws = null
    }
    this.notifyConnection(false)
  }

  public onLog(listener: LogListener): () => void {
    this.logListeners.add(listener)
    return () => {
      this.logListeners.delete(listener)
    }
  }

  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  public onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  public onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    listener(this.isConnected())
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private notifyConnection(connected: boolean): void {
    this.connectionListeners.forEach((listener) => listener(connected))
  }

  public async sendCommand(command: string): Promise<void> {
    const validation = validateServerCommand(command)
    if (!validation.valid || !validation.command) {
      throw new Error(validation.error || "El comando no es válido.")
    }

    const res = await serverApi.sendServerCommand(validation.command)
    if (!res || !res.success) {
      throw new Error(res?.message || "No se pudo ejecutar el comando.")
    }
  }
}


export const consoleService = new ConsoleService()
