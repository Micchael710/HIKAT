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
  phase?: "DOWNLOADING" | "INSTALLING" | string
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
  hasExistingInstall?: boolean
  isFullyInstalled?: boolean
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
  startSync?: (payload: { clientFiles: ClientFile[]; modpackVersion?: string }) => Promise<{ success: boolean; downloadedCount: number; prunedCount: number; paused?: boolean }>
  pauseSync?: () => Promise<boolean>
  cancelSync?: () => Promise<boolean>
  uninstallGame?: () => Promise<{ success: boolean }>
  launchGame?: (options: {
    playerName?: string
    ramGB?: number
    neoForgeVersion?: string
    customJavaPath?: string
    customArgs?: string[]
  }) => Promise<{ success: boolean; pid?: number }>
  getLaunchStatus?: () => Promise<{ status: string; pid?: number | null; operationState?: string }>
  onDownloadProgress?: (callback: (data: DownloadProgressData) => void) => () => void
  onPhaseChange?: (callback: (phase: string) => void) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}

declare module "../../electron/client-files-sync.cjs" {
  export const generateSyncPlan: any
  export const executeSync: any
  export const loadInstalledManifest: any
  export const saveInstalledManifest: any
  export const loadDownloadSession: any
  export const saveDownloadSession: any
  export const cleanStaging: any
  export const reconcileStagingFiles: any
  export const getDeterministicStagingFileName: any
  export const calculateFileSha256: any
  export const resolveAndValidateDownloadUrl: any
  export const validateUrlSecurity: any
  export const getEffectiveApiBaseUrl: any
  export const uninstallGame: any
}

declare module "../../electron/game-operation-manager.cjs" {
  export const validateSyncPayload: any
  export class GameOperationManager {
    state: string
    activeOperationPromise: any
    activeCancelSignal: any
    operationCounter: number
    getState(): string
    checkPlan(options: any): Promise<any>
    startSync(options: any): Promise<any>
    pauseSync(): Promise<any>
    cancelSync(instanceRoot: string): Promise<any>
    launchGame(gameLauncher: any, options?: any): Promise<any>
    uninstallGame(instanceRoot: string, appDataRoot: string): Promise<any>
  }
}
