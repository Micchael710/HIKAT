const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onMaximizeChange: (callback) => {
    const handler = (_event, isMax) => callback(isMax);
    ipcRenderer.on("window-maximize-changed", handler);
    return () => ipcRenderer.removeListener("window-maximize-changed", handler);
  },
  // Global settings bridge to Backend
  setStartWithSystem: (enabled) =>
    ipcRenderer.send("setting-start-with-system", enabled),
  setMinimizeToTray: (enabled) =>
    ipcRenderer.send("setting-minimize-to-tray", enabled),
  setAutoUpdates: (enabled) =>
    ipcRenderer.send("setting-auto-updates", enabled),
  setNotifications: (enabled) =>
    ipcRenderer.send("setting-notifications", enabled),
  setRamAllocation: (ramGB) =>
    ipcRenderer.send("setting-ram-allocation", ramGB),
  setDedicatedGpu: (enabled) =>
    ipcRenderer.send("setting-dedicated-gpu", enabled),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  // Game Download & Launch IPC Bridge
  launchGame: (options) => ipcRenderer.send("game-launch", options),
  startDownload: (manifest) =>
    ipcRenderer.send("game-start-download", manifest),
  pauseDownload: () => ipcRenderer.send("game-pause-download"),
  resumeDownload: () => ipcRenderer.send("game-resume-download"),
  cancelDownload: () => ipcRenderer.send("game-cancel-download"),
  repairGame: () => ipcRenderer.send("game-repair-installation"),
  uninstallGame: () => ipcRenderer.send("game-uninstall"),
  onDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("game-download-progress", handler);
    return () => ipcRenderer.removeListener("game-download-progress", handler);
  },
});
