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
