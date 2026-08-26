/**
 * Pterodactyl Client API types & data structures (Internal to Backend)
 */

export interface PterodactylServerLimits {
  memory: number // MB (0 = unlimited)
  swap: number
  disk: number // MB (0 = unlimited)
  io: number
  cpu: number // % limit (0 = unlimited)
  threads: string | null
}

export interface PterodactylServerAttributes {
  server_owner: boolean
  identifier: string
  uuid: string
  name: string
  node: string
  is_suspended: boolean
  limits: PterodactylServerLimits
}

export interface PterodactylServerResponse {
  object: "server"
  attributes: PterodactylServerAttributes
}

export interface PterodactylStatsResources {
  memory_bytes: number
  cpu_absolute: number
  disk_bytes: number
  network_rx_bytes: number
  network_tx_bytes: number
  uptime: number // milliseconds
}

export interface PterodactylStatsAttributes {
  current_state: "running" | "starting" | "stopping" | "offline"
  is_suspended: boolean
  resources: PterodactylStatsResources
}

export interface PterodactylStatsResponse {
  object: "stats"
  attributes: PterodactylStatsAttributes
}

export interface PterodactylWebsocketData {
  token: string
  socket: string
}

export interface PterodactylWebsocketResponse {
  data: PterodactylWebsocketData
}

export interface IPterodactylClient {
  getServerDetails(): Promise<PterodactylServerResponse>
  getServerResources(): Promise<PterodactylStatsResponse>
  sendPowerAction(signal: "start" | "stop" | "restart" | "kill"): Promise<void>
  sendCommand(command: string): Promise<void>
  getWebsocketCredentials(): Promise<PterodactylWebsocketData>
}
