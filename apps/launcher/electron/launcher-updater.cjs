const electron = require("electron")
const app = electron && typeof electron === "object" && electron.app ? electron.app : electron
const { getEffectiveApiBaseUrl } = require("./client-files-sync.cjs")

function getUpdateFeedUrl(customIsPackaged = null) {
  if (process.env.HIKAT_UPDATE_URL && process.env.HIKAT_UPDATE_URL.trim()) {
    return process.env.HIKAT_UPDATE_URL.trim().replace(/\/+$/, "")
  }
  const isPackaged =
    typeof customIsPackaged === "boolean"
      ? customIsPackaged
      : app && typeof app === "object" && typeof app.isPackaged === "boolean"
        ? app.isPackaged
        : undefined
  const apiBase = getEffectiveApiBaseUrl(isPackaged)
  return `${apiBase.replace(/\/+$/, "")}/launcher/update`
}


/**
 * Executes the auto-update lifecycle during splash presentation.
 * Returns a promise that resolves to:
 * - { updated: false, reason: string } -> continue normal launcher startup
 * - { updated: true } -> update downloaded, quitAndInstall executed
 *
 * @param {import("electron").BrowserWindow} splashWindow
 * @param {any} [customUpdater] Optional injected updater instance (primarily for tests)
 * @param {any} [customApp] Optional injected electron app (primarily for tests)
 * @returns {Promise<{ updated: boolean, reason?: string }>}
 */
function runLauncherUpdateBootstrap(splashWindow, customUpdater = null, customApp = null) {
  return new Promise((resolve) => {
    const currentApp = customApp || app
    const isPackaged =
      currentApp && typeof currentApp === "object" && typeof currentApp.isPackaged === "boolean"
        ? currentApp.isPackaged
        : undefined

    // In unpackaged development environment, skip update check unless explicitly forced for testing
    if (currentApp && !currentApp.isPackaged && !process.env.FORCE_LAUNCHER_AUTO_UPDATE) {
      console.log("[AutoUpdater] Running in unpackaged dev mode; skipping auto-update check.")
      return resolve({ updated: false, reason: "dev_mode" })
    }

    const feedUrl = getUpdateFeedUrl(isPackaged)
    console.log(`[AutoUpdater] Initializing auto-updater with feed URL: ${feedUrl}`)

    let isResolved = false
    const finish = (result) => {
      if (!isResolved) {
        isResolved = true
        resolve(result)
      }
    }

    let autoUpdater
    try {
      autoUpdater = customUpdater || require("electron-updater").autoUpdater
    } catch (loadErr) {
      console.warn("[AutoUpdater] Failed to load autoUpdater:", loadErr)
      return finish({ updated: false, reason: "load_error", error: loadErr })
    }

    // Safety timeout: if network hangs during update check, do not block launcher startup
    const checkTimeout = setTimeout(() => {
      console.warn("[AutoUpdater] Update check timed out after 7000ms. Continuing normal startup.")
      finish({ updated: false, reason: "timeout" })
    }, 7000)

    try {
      if (process.env.FORCE_LAUNCHER_AUTO_UPDATE) {
        autoUpdater.forceDevUpdateConfig = true
      }

      autoUpdater.setFeedURL({
        provider: "generic",
        url: feedUrl,
      })

      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      // For this first version, use full installer downloads without differential packages
      autoUpdater.disableDifferentialDownload = true

      autoUpdater.removeAllListeners()

      autoUpdater.on("error", (err) => {
        clearTimeout(checkTimeout)
        console.warn("[AutoUpdater] Update check or download error (continuing normally):", err && err.message ? err.message : err)
        finish({ updated: false, reason: "error", error: err })
      })

      autoUpdater.on("checking-for-update", () => {
        console.log("[AutoUpdater] Checking for launcher updates...")
      })

      autoUpdater.on("update-not-available", (info) => {
        clearTimeout(checkTimeout)
        console.log("[AutoUpdater] Launcher is up to date (current version).", info ? info.version : "")
        finish({ updated: false, reason: "not_available" })
      })

      autoUpdater.on("update-available", (info) => {
        clearTimeout(checkTimeout)
        const targetVer = info && info.version ? info.version : "nueva versión"
        console.log(`[AutoUpdater] Update available: v${targetVer}. Starting download...`)

        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send("updater:status", {
            message: `Descargando actualización (v${targetVer})...`,
          })
        }

        // Start automatic download
        autoUpdater.downloadUpdate().catch((dlErr) => {
          console.warn("[AutoUpdater] Error initiating download:", dlErr && dlErr.message ? dlErr.message : dlErr)
          finish({ updated: false, reason: "download_init_error", error: dlErr })
        })
      })

      autoUpdater.on("download-progress", (progressObj) => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send("updater:progress", {
            percent: progressObj.percent,
            bytesPerSecond: progressObj.bytesPerSecond,
            transferred: progressObj.transferred,
            total: progressObj.total,
          })
        }
      })

      autoUpdater.on("update-downloaded", (info) => {
        console.log("[AutoUpdater] Update download complete:", info ? info.version : "")

        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send("updater:status", {
            message: "Instalando actualización y reiniciando...",
          })
          splashWindow.webContents.send("updater:progress", {
            percent: 100,
            bytesPerSecond: 0,
            transferred: info && info.downloadedFile ? 1 : 1,
            total: 1,
          })
        }

        // Give the UI a moment to show completion before restarting
        setTimeout(() => {
          console.log("[AutoUpdater] Executing quitAndInstall...")
          try {
            // isSilent = true (silent install), isForceRunAfter = true (relaunches app)
            autoUpdater.quitAndInstall(true, true)
          } catch (quitErr) {
            console.error("[AutoUpdater] Error during quitAndInstall:", quitErr)
            app.quit()
          }
        }, 1200)

        finish({ updated: true })
      })

      autoUpdater.checkForUpdates().catch((err) => {
        clearTimeout(checkTimeout)
        console.warn("[AutoUpdater] checkForUpdates exception (continuing normally):", err && err.message ? err.message : err)
        finish({ updated: false, reason: "check_exception", error: err })
      })
    } catch (outerErr) {
      clearTimeout(checkTimeout)
      console.warn("[AutoUpdater] Exception setting up updater:", outerErr)
      finish({ updated: false, reason: "setup_exception", error: outerErr })
    }
  })
}

module.exports = {
  runLauncherUpdateBootstrap,
  getUpdateFeedUrl,
}
