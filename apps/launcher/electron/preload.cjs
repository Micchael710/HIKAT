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

  // Global Settings (Main Process Authoritative)
  getStartWithSystem: () => ipcRenderer.invoke("get-start-with-system"),
  setStartWithSystem: (enabled) =>
    ipcRenderer.invoke("setting-start-with-system", enabled),
  getMinimizeToTray: () => ipcRenderer.invoke("get-minimize-to-tray"),
  setMinimizeToTray: (enabled) =>
    ipcRenderer.invoke("setting-minimize-to-tray", enabled),
  getMinimizeOnGameLaunch: () => ipcRenderer.invoke("get-minimize-on-game-launch"),
  setMinimizeOnGameLaunch: (enabled) =>
    ipcRenderer.invoke("setting-minimize-on-game-launch", enabled),
  getDedicatedGpu: () => ipcRenderer.invoke("get-dedicated-gpu"),
  setDedicatedGpu: (enabled) =>
    ipcRenderer.invoke("setting-dedicated-gpu", enabled),
  getRamAllocation: () => ipcRenderer.invoke("get-ram-allocation"),
  setRamAllocation: (ramGB) =>
    ipcRenderer.invoke("setting-ram-allocation", ramGB),
  openExternal: (url) => ipcRenderer.send("open-external", url),

  // Secure Auth Session Storage (Main Process Safe Storage)
  authLoadSession: () => ipcRenderer.invoke("auth:load-session"),
  authSaveSession: (session) => ipcRenderer.invoke("auth:save-session", session),
  authClearSession: () => ipcRenderer.invoke("auth:clear-session"),
  authSavePendingOAuth: (data) => ipcRenderer.invoke("auth:save-pending-oauth", data),
  authGetPendingOAuth: (state) => ipcRenderer.invoke("auth:get-pending-oauth", state),
  authClearPendingOAuth: () => ipcRenderer.invoke("auth:clear-pending-oauth"),

  // OAuth Deep Link Callback Handler
  onOAuthCallback: (callback) => {
    const handler = (_event, url) => callback(url)
    ipcRenderer.on("oauth:callback", handler)
    return () => ipcRenderer.removeListener("oauth:callback", handler)
  },
  getPendingOAuthCallback: () => ipcRenderer.invoke("oauth:get-pending-callback"),

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
  onLaunchStatus: (callback) => {
    const handler = (_event, status, details) => callback(status, details)
    ipcRenderer.on("game-launch-status", handler)
    return () => ipcRenderer.removeListener("game-launch-status", handler)
  },
  onGameFileIntegrityChanged: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on("game-file-integrity-changed", handler)
    return () => ipcRenderer.removeListener("game-file-integrity-changed", handler)
  },
})
