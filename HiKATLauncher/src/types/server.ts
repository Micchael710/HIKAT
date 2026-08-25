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

export interface ServerStatus {
  online: boolean

  playersOnline?: number

  maxPlayers?: number

  latencyMs?: number

  version?: string

  motd?: string

  players?: {
    online: number

    max: number
  }

  ping?: number
}

export interface PlayerStats {
  playtimeHours: number

  achievements: number

  rank: string
}
