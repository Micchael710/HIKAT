export type ServerStatus =
  | "ONLINE"
  | "OFFLINE"
  | "STARTING"
  | "STOPPING"
  | "MAINTENANCE"
  | "UNKNOWN"
  | "online"
  | "offline"
  | "maintenance"

export interface ServerStatusResponse {
  online: boolean
  playersOnline: number
  maxPlayers: number
  latencyMs: number
  version?: string
  motd?: string
}

export interface PlayerStats {
  playersOnline: number
  maxPlayers: number
  latencyMs: number
  playtimeHours?: number
  unlockedAchievements?: number
  totalAchievements?: number
}

export interface ServerSpecs {
  name: string
  ip: string
  version: string
  modpack: string
  playersOnline: number
  maxPlayers: number
  latencyMs: number
  status: "online" | "offline" | "maintenance"
  totalPlaytimeHours: number
  unlockedAchievements: number
  totalAchievements: number
}
