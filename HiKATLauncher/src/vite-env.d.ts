/// <reference types="vite/client" />

export type SyncPolicy = "NO_MODIFICABLE" | "MODIFICABLE"

export interface ClientFile {
  path: string
  sha256: string
  sizeBytes: number
  downloadUrl: string
  policy: SyncPolicy
}

export interface PublishedModpack {
  version: string
  minecraftVersion: string
  neoForgeVersion: string
  mandatory?: boolean
  clientFiles: ClientFile[]
}

export interface DownloadProgressData {
  progress: number
  downloadedGB: number
  totalGB: number
  speedMBs: number
  remainingMinutes: number
  currentFile?: string
  filesToDownload?: number
  filesToPrune?: number
}

export interface SyncPlanCheckResult {
  success: boolean
  filesToDownload: number
  filesToPrune: number
  totalDownloadBytes: number
  needsUpdate: boolean
  error?: string
}

interface ElectronAPI {
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (isMax: boolean) => void) => () => void

  getMemory?: () => Promise<{ totalGb: number }>

  getStartWithSystem?: () => Promise<boolean>
  setStartWithSystem?: (enabled: boolean) => Promise<boolean> | void
  getMinimizeToTray?: () => Promise<boolean>
  setMinimizeToTray?: (enabled: boolean) => Promise<boolean> | void
  setDedicatedGpu?: (enabled: boolean) => Promise<boolean> | void
  setRamAllocation?: (ramGB: number) => void
  setAutoUpdates?: (enabled: boolean) => void
  setNotifications?: (enabled: boolean) => void
  openExternal?: (url: string) => void

  checkSyncPlan?: (payload: { clientFiles: ClientFile[]; modpackVersion?: string }) => Promise<SyncPlanCheckResult>
  startSync?: (payload: { clientFiles: ClientFile[]; modpackVersion?: string }) => Promise<{ success: boolean; downloadedCount: number; prunedCount: number }>
  cancelSync?: () => Promise<boolean>
  launchGame?: (options: {
    playerName?: string
    ramGB?: number
    neoForgeVersion?: string
    customJavaPath?: string
    customArgs?: string[]
  }) => Promise<{ success: boolean; pid?: number }>
  getLaunchStatus?: () => Promise<{ status: string; pid?: number | null }>
  onDownloadProgress?: (callback: (data: DownloadProgressData) => void) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
