/// <reference types="vite/client" />

interface ElectronAPI {
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (isMax: boolean) => void) => () => void
  setStartWithSystem?: (enabled: boolean) => void
  setMinimizeToTray?: (enabled: boolean) => void
  setAutoUpdates?: (enabled: boolean) => void
  setNotifications?: (enabled: boolean) => void
  setRamAllocation?: (ramGB: number) => void
  setDedicatedGpu?: (enabled: boolean) => void
  openExternal?: (url: string) => void
  launchGame?: (options?: any) => void
  startDownload?: (manifest?: any) => void
  pauseDownload?: () => void
  resumeDownload?: () => void
  cancelDownload?: () => void
  repairGame?: () => void
  uninstallGame?: () => void
  onDownloadProgress?: (
    callback: (data: {
      progress: number
      downloadedGB: number
      totalGB: number
      speedMBs: number
      remainingMinutes: number
    }) => void,
  ) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
