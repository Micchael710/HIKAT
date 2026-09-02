export declare function generateSyncPlan(
  instanceRoot: string,
  clientFiles: any[],
  modpackVersion: string,
  directoryPolicies?: any[],
  isVerify?: boolean,
): Promise<any>

export declare function downloadClientFilesToStaging(options: {
  instanceRoot: string
  clientFiles: any[]
  modpackVersion: string
  directoryPolicies?: any[]
  onProgress?: (data: any) => void
  onPhaseChange?: (phase: string) => void
  cancelSignal?: { isCancelled: boolean; isPaused?: boolean }
  apiBaseUrl?: string
  isVerify?: boolean
}): Promise<any>

export declare function applyStagingToInstance(options: {
  instanceRoot: string
  clientFiles?: any[]
  directoryPolicies?: any[]
  modpackVersion: string
  stagedFiles?: any[]
  plan?: any
  onProgress?: (data: any) => void
  onPhaseChange?: (phase: string) => void
  cancelSignal?: { isCancelled: boolean; isPaused?: boolean }
  isVerify?: boolean
}): Promise<any>

export declare function executeSync(options: {
  instanceRoot: string
  clientFiles: any[]
  directoryPolicies?: any[]
  modpackVersion: string
  onProgress?: (data: any) => void
  onPhaseChange?: (phase: string) => void
  cancelSignal?: { isCancelled: boolean; isPaused?: boolean }
  apiBaseUrl?: string
  isVerify?: boolean
}): Promise<any>

export declare function resolveWatcherDecision(
  relPath: string,
  directoryPolicies?: any[],
  installedManifestFiles?: any,
  instanceRoot?: string | null,
): "EMIT" | "IGNORE"

export declare function loadInstalledManifest(instanceRoot: string): Promise<any>
export declare function saveInstalledManifest(instanceRoot: string, manifestData: any): Promise<void>
export declare function loadDownloadSession(instanceRoot: string): Promise<any>
export declare function saveDownloadSession(instanceRoot: string, sessionData: any): Promise<void>
export declare function cleanStaging(instanceRoot: string): Promise<void>
export declare function reconcileStagingFiles(instanceRoot: string, tasks: any[]): Promise<any>
export declare function getDeterministicStagingFileName(task: any): string
export declare function calculateFileSha256(filePath: string): Promise<string>
export declare function resolveAndValidateDownloadUrl(rawUrl: string, apiBaseUrl?: string): string
export declare function validateUrlSecurity(parsedUrl: URL): boolean
export declare function getEffectiveApiBaseUrl(): string
export declare function uninstallGame(instanceRoot: string, appDataRoot: string): Promise<{ success: boolean }>
export declare function resolvePathPolicy(
  relPath: string,
  filesMap: any,
): "MODIFICABLE" | "NO_MODIFICABLE" | null
export declare const ENFORCED_DIRECTORIES: string[]
