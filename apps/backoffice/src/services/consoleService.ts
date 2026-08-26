/**
 * HiKAT Back Office Server Console Service (Shard 06)
 * Manages real-time WebSocket connection to the HiKAT Backend console proxy
 * with automatic reconnection, event dispatching, and HTTP fallback.
 */

import { authService } from "./authService"
import { serverApi } from "./graphqlClient"
import type { ConsoleLogEntry, ServerStatus } from "../types"

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787"

type LogListener = (entry: ConsoleLogEntry) => void
type StatusListener = (status: ServerStatus) => void
type ConnectionListener = (connected: boolean) => void

class ConsoleService {
  private ws: WebSocket | null = null
  private logListeners: Set<LogListener> = new Set()
  private statusListeners: Set<StatusListener> = new Set()
  private connectionListeners: Set<ConnectionListener> = new Set()
  private isConnecting: boolean = false
  private shouldReconnect: boolean = false
  private reconnectTimer: any = null
  private retryCount: number = 0

  public connect(): void {
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
      const wsUrl = new URL(BACKEND_URL)
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
      wsUrl.pathname = "/api/server/console/ws"
      wsUrl.searchParams.set("token", token)

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
          }
        } catch {
          // If plain text line received
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

      this.ws.onclose = () => {
        this.isConnecting = false
        this.ws = null
        this.notifyConnection(false)
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
        this.ws.close()
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
    const trimmed = command.trim()
    if (!trimmed) {
      throw new Error("El comando no puede estar vacío.")
    }

    if (this.isConnected() && this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: "command", command: trimmed }))
        return
      } catch {
        // Fallback to GraphQL mutation
      }
    }

    await serverApi.sendServerCommand(trimmed)
  }
}

export const consoleService = new ConsoleService()
