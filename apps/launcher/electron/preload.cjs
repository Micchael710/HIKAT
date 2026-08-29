const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  // Window Controls
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onMaximizeChange: (callback) => {
    const handler = (_event, isMax) => callback(isMax)
    ipcRenderer.on("window-maximize-changed", handler)
    return () => ipcRenderer.removeListener("window-maximize-changed", handler)
  },

  // System
  getMemory: () => ipcRenderer.invoke("system:get-memory"),

  // Global Settings
  getStartWithSystem: () => ipcRenderer.invoke("get-start-with-system"),
  setStartWithSystem: (enabled) =>
    ipcRenderer.invoke("setting-start-with-system", enabled),
  getMinimizeToTray: () => ipcRenderer.invoke("get-minimize-to-tray"),
  setMinimizeToTray: (enabled) =>
    ipcRenderer.invoke("setting-minimize-to-tray", enabled),
  setDedicatedGpu: (enabled) =>
    ipcRenderer.invoke("setting-dedicated-gpu", enabled),
  setRamAllocation: (ramGB) =>
    ipcRenderer.send("setting-ram-allocation", ramGB),
  setAutoUpdates: (enabled) =>
    ipcRenderer.send("setting-auto-updates", enabled),
  setNotifications: (enabled) =>
    ipcRenderer.send("setting-notifications", enabled),
  openExternal: (url) => ipcRenderer.send("open-external", url),

  // Client Files Sync & Launch Engine
  checkSyncPlan: (payload) => ipcRenderer.invoke("game-check-plan", payload),
  startSync: (payload) => ipcRenderer.invoke("game-start-sync", payload),
  pauseSync: () => ipcRenderer.invoke("game-pause-sync"),
  cancelSync: () => ipcRenderer.invoke("game-cancel-sync"),
  uninstallGame: () => ipcRenderer.invoke("game-uninstall"),
  launchGame: (options) => ipcRenderer.invoke("game-launch", options),
  getLaunchStatus: () => ipcRenderer.invoke("game-get-status"),
  onDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on("game-download-progress", handler)
    return () => ipcRenderer.removeListener("game-download-progress", handler)
  },
  onPhaseChange: (callback) => {
    const handler = (_event, phase) => callback(phase)
    ipcRenderer.on("game-phase-changed", handler)
    return () => ipcRenderer.removeListener("game-phase-changed", handler)
  },
})
