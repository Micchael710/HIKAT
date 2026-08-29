export declare function validateSyncPayload(options: {
  clientFiles: any
  modpackVersion: any
  requireNonEmptyFiles?: boolean
  instanceRoot?: string
}): void

export declare class GameOperationManager {
  state: string
  activeOperationPromise: Promise<any> | null
  activeCancelSignal: { isCancelled: boolean; isPaused: boolean; id: number } | null
  operationCounter: number

  constructor()
  getState(): string
  checkPlan(options: {
    instanceRoot: string
    clientFiles?: any[]
    modpackVersion?: string
  }): Promise<any>
  startSync(options: {
    instanceRoot: string
    clientFiles?: any[]
    modpackVersion?: string
    onProgress?: (data: any) => void
    onPhaseChange?: (phase: string) => void
    apiBaseUrl?: string
  }): Promise<any>
  pauseSync(): Promise<any>
  cancelSync(instanceRoot: string): Promise<any>
  launchGame(gameLauncher: any, options?: any): Promise<any>
  uninstallGame(instanceRoot: string, appDataRoot: string): Promise<any>
}
