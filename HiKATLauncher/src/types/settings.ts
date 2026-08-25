export type SettingsTab = "general" | "game"

export interface LauncherSettings {
  lang: string
  startWithSystem: boolean
  minimizeToTray: boolean
  autoUpdates: boolean
  notifications: boolean
  ramGB: number
  dedicatedGPU: boolean
  javaPath?: string
  jvmArgs?: string
  resolutionWidth?: number
  resolutionHeight?: number
  fullscreenOnLaunch?: boolean
}
