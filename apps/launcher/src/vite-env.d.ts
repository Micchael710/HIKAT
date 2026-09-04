/// <reference types="vite/client" />

export type SyncPolicy = "NO_MODIFICABLE" | "MODIFICABLE"

export interface ClientFile {
  path: string
  sha256: string
  sizeBytes: number
  downloadUrl: string
  policy: SyncPolicy
}

export interface DirectoryPolicy {
  path: string
  policy: SyncPolicy
}

export type GameModLoader = "VANILLA" | "NEOFORGE" | "FORGE" | "FABRIC" | "QUILT"

export interface ContentMedia {
  id: string
  mediaType: "IMAGE" | "VIDEO"
  mimeType: string
  sizeBytes: number
  url: string
  createdAt: string
}

export interface PublishedModpack {
  version: string
  minecraftVersion: string
  modLoader: GameModLoader
  modLoaderVersion?: string | null
  /** @deprecated Use modLoader + modLoaderVersion */
  neoForgeVersion?: string | null
  mandatory?: boolean
  clientFiles: ClientFile[]
  directoryPolicies?: DirectoryPolicy[]
  notes?: string | null
  cover?: ContentMedia | null
}

export interface DownloadProgressData {
  progress: number
  phase?: "DOWNLOADING" | "INSTALLING" | string
  downloadedGB?: number
  totalGB?: number
  downloadedBytes?: number
  totalBytes?: number
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
  hasUpdate?: boolean
  hasIntegrityIssue?: boolean
  needsUpdate?: boolean
  installedModpackVersion?: string | null
  hasExistingInstall?: boolean
  isFullyInstalled?: boolean
  hasPausedSession?: boolean
  hasInterruptedDownload?: boolean
  stagedBytes?: number
  stagedFilesCount?: number
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
  getMinimizeOnGameLaunch?: () => Promise<boolean>
  setMinimizeOnGameLaunch?: (enabled: boolean) => Promise<boolean> | void
  getDedicatedGpu?: () => Promise<boolean>
  setDedicatedGpu?: (enabled: boolean) => Promise<boolean> | void
  setRamAllocation?: (ramGB: number) => void
  openExternal?: (url: string) => void

  checkSyncPlan?: (payload: {
    clientFiles: ClientFile[]
    directoryPolicies?: DirectoryPolicy[]
    modpackVersion?: string
    minecraftVersion?: string
    modLoader?: GameModLoader
    modLoaderVersion?: string
    neoForgeVersion?: string
  }) => Promise<SyncPlanCheckResult>
  startSync?: (payload: {
    clientFiles: ClientFile[]
    directoryPolicies?: DirectoryPolicy[]
    modpackVersion?: string
    minecraftVersion?: string
    modLoader?: GameModLoader
    modLoaderVersion?: string
    neoForgeVersion?: string
    apiBaseUrl?: string
    isVerify?: boolean
  }) => Promise<{
    success: boolean
    downloadedCount: number
    prunedCount: number
    paused?: boolean
    resolvedVersionId?: string
  }>
  pauseSync?: () => Promise<boolean>
  cancelSync?: () => Promise<boolean>
  uninstallGame?: () => Promise<{ success: boolean }>
  launchGame?: (options: {
    playerName?: string
    ramGB?: number
    minecraftVersion?: string
    modLoader?: GameModLoader
    modLoaderVersion?: string
    neoForgeVersion?: string
    customJavaPath?: string
    customArgs?: string[]
  }) => Promise<{ success: boolean; pid?: number }>
  getLaunchStatus?: () => Promise<{ status: string; pid?: number | null; operationState?: string }>
  getGameRuntimeInfo?: () => Promise<{ javaMajorVersion: number | null }>
  onDownloadProgress?: (callback: (data: DownloadProgressData) => void) => () => void
  onPhaseChange?: (callback: (phase: string) => void) => () => void
  onLaunchStatus?: (
    callback: (
      status: "idle" | "preparing" | "running",
      details?: { unexpected?: boolean; code?: number | null; error?: any }
    ) => void
  ) => () => void
  onGameFileIntegrityChanged?: (callback: (data: { path: string }) => void) => () => void
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
  export const ENFORCED_DIRECTORIES: string[]
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
