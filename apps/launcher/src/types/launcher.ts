export type ThemeMode = "dark" | "light"

export type LauncherScreen = "login" | "home"
export type LauncherView = "home" | "skins" | "settings" | "profile"

export interface UserAccount {
  id: string
  username: string
  email?: string
  avatar?: string
  lastLogin?: string
  keepSession?: boolean
}

export interface UserProfileData {
  username: string
  rank: string
  joinedDate: string
  playtimeHours: number
  achievementsUnlocked: number
  achievementsTotal: number
  serverStatus: "online" | "offline"
  pingMs: number
}

declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow?: () => void
      maximizeWindow?: () => void
      closeWindow?: () => void
      isMaximized?: () => Promise<boolean>
      on?: (channel: string, callback: (...args: any[]) => void) => void
      off?: (channel: string, callback: (...args: any[]) => void) => void
      send?: (channel: string, ...args: any[]) => void
      invoke?: (channel: string, ...args: any[]) => Promise<any>
      getPlatformInfo?: () => Promise<any>
      [key: string]: any
    }
  }
}
