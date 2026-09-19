const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("splashAPI", {
  onUpdateStatus: (callback) => {
    ipcRenderer.on("updater:status", (_event, data) => callback(data))
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on("updater:progress", (_event, data) => callback(data))
  },
})
