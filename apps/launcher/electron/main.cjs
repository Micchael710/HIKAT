const { app, BrowserWindow, ipcMain, screen, nativeImage, shell, Tray, Menu } = require("electron")
const path = require("path")
const http = require("http")
const fs = require("fs")
const os = require("os")
const {
  executeSync,
  generateSyncPlan,
  uninstallGame,
  loadInstalledManifest,
} = require("./client-files-sync.cjs")
const { GameLauncher } = require("./game-launcher.cjs")
const { setJavaGpuPreference } = require("./gpu-manager.cjs")

// Single instance lock to prevent duplicate launcher instances and focus existing instance
const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  app.quit()
  process.exit(0)
}

const appDataRoot = path.join(app.getPath("appData"), "HiKAT")
try {
  app.setPath("userData", path.join(appDataRoot, "launcher"))
} catch (_) {}

const instanceRoot = path.join(appDataRoot, "game files")
const gameLauncher = new GameLauncher(app, { instanceRoot })
let activeSyncCancelSignal = null
let currentOperationState = "IDLE" // IDLE | SYNCING | PAUSED | INSTALLING | UNINSTALLING

let mainWindow = null
let splashWindow = null
let tray = null
let isQuitRequested = false
let minimizeToTrayEnabled = true
let dedicatedGpuEnabled = true

function getLauncherIcon() {
  try {
    const iconFile = "logo-windows.png"

    const candidatePaths = [
      path.join(__dirname, iconFile),
      path.join(__dirname, "../public", iconFile),
      path.join(__dirname, "../src/assets/branding", iconFile),
      path.join(__dirname, "../dist/assets", iconFile),
      path.join(process.resourcesPath || "", "public", iconFile),
    ]

    for (const candidate of candidatePaths) {
      if (candidate && fs.existsSync(candidate)) {
        return nativeImage.createFromPath(candidate)
      }
    }
  } catch (_) {}
  return undefined
}

function getOptimalWindowSize() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize

    if (screenW >= 1680 && screenH >= 950) {
      return { width: 1600, height: 900 }
    } else if (screenW >= 1360 && screenH >= 760) {
      return { width: 1280, height: 720 }
    } else {
      return { width: 1024, height: 576 }
    }
  } catch (_) {
    return { width: 1600, height: 900 }
  }
}

function getOptimalSplashSize() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize

    if (screenW >= 1680 && screenH >= 950) {
      return { width: 820, height: 520 }
    } else if (screenW >= 1360 && screenH >= 760) {
      return { width: 740, height: 470 }
    } else {
      return { width: 660, height: 420 }
    }
  } catch (_) {
    return { width: 820, height: 520 }
  }
}

function checkServer(url, timeout = 500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url)
      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || "/",
          timeout,
        },
        (res) => {
          resolve(res.statusCode < 500)
        },
      )
      req.on("error", () => resolve(false))
      req.on("timeout", () => {
        req.destroy()
        resolve(false)
      })
    } catch (_) {
      resolve(false)
    }
  })
}

function createSplashWindow() {
  const { width: splashW, height: splashH } = getOptimalSplashSize()
  const appIcon = getLauncherIcon()

  splashWindow = new BrowserWindow({
    width: splashW,
    height: splashH,
    icon: appIcon,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    center: true,
    show: false,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      devTools: false,
      contextIsolation: true,
    },
  })

  splashWindow.loadFile(path.join(__dirname, "splash.html"))

  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show()
    }
  })
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.focus()
}

function ensureTray() {
  if (tray && !tray.isDestroyed()) {
    return tray
  }
  const trayIcon = getLauncherIcon()
  if (!trayIcon) {
    return null
  }
  try {
    tray = new Tray(trayIcon)
    tray.setToolTip("HiKAT Launcher")
    tray.on("double-click", () => {
      focusMainWindow()
    })
    updateTrayMenu()
    return tray
  } catch (err) {
    console.warn("Failed to create system tray icon:", err)
    return null
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) {
    return
  }
  const template = [
    {
      label: "Mostrar HiKAT Launcher",
      click: () => {
        focusMainWindow()
      },
    },
    { type: "separator" },
    {
      label: "Salir",
      click: () => {
        isQuitRequested = true
        app.quit()
      },
    },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    try {
      tray.destroy()
    } catch (_) {}
    tray = null
  }
}

async function createWindow() {
  const { width: defaultWidth, height: defaultHeight } = getOptimalWindowSize()
  const appIcon = getLauncherIcon()

  mainWindow = new BrowserWindow({
    title: "HiKAT Launcher",
    icon: appIcon,
    width: defaultWidth,
    height: defaultHeight,
    minWidth: defaultWidth,
    minHeight: defaultHeight,
    resizable: false,
    maximizable: true,
    center: true,
    frame: false, // frameless window for custom Titlebar
    titleBarStyle: "hidden",
    backgroundColor: "#090d12",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  })

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url)
    }
    return { action: "deny" }
  })

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault()
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url)
      }
    }
  })

  mainWindow.on("close", (event) => {
    if (isQuitRequested) {
      return
    }
    if (minimizeToTrayEnabled) {
      event.preventDefault()
      ensureTray()
      mainWindow.hide()
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  const distPath = path.join(__dirname, "../dist/index.html")
  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:8443"

  const isServerLive = await checkServer(devUrl, 600)

  if (isServerLive) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(distPath)
  }

  mainWindow.webContents.on("did-fail-load", () => {
    mainWindow.loadFile(distPath)
  })

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const levelName = level === 3 ? "ERROR" : level === 2 ? "WARN" : "INFO"
    console.log(`[Renderer ${levelName}] ${message} (${path.basename(sourceId || "")}:${line})`)
  })

  const startTime = Date.now()
  const MIN_SPLASH_TIME = 3800

  mainWindow.once("ready-to-show", () => {
    const elapsed = Date.now() - startTime
    const remainingTime = Math.max(0, MIN_SPLASH_TIME - elapsed)

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close()
        splashWindow = null
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    }, remainingTime)
  })

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-maximize-changed", true)
  })

  mainWindow.on("unmaximize", () => {
    mainWindow.setResizable(false)
    mainWindow.webContents.send("window-maximize-changed", false)
  })
}

// Second instance handler (when user launches launcher while already running)
app.on("second-instance", () => {
  focusMainWindow()
})

// IPC Handlers for custom titlebar controls
ipcMain.on("window-minimize", () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.setResizable(true)
      mainWindow.unmaximize()
      const { width, height } = getOptimalWindowSize()
      mainWindow.setSize(width, height)
      mainWindow.center()
      mainWindow.setResizable(false)
    } else {
      mainWindow.setResizable(true)
      mainWindow.maximize()
    }
  }
})

ipcMain.on("window-close", () => {
  if (mainWindow) mainWindow.close()
})

ipcMain.handle("window-is-maximized", () => {
  return mainWindow ? mainWindow.isMaximized() : false
})

// IPC Handlers for System Information
ipcMain.handle("system:get-memory", async () => {
  try {
    const totalBytes = os.totalmem()
    const totalGb = Math.max(1, Math.floor(totalBytes / 1024 / 1024 / 1024))
    return { totalGb }
  } catch (_) {
    return { totalGb: 16 }
  }
})

// IPC Handlers for Global Settings
ipcMain.handle("get-start-with-system", async () => {
  try {
    const settings = app.getLoginItemSettings()
    return Boolean(settings.openAtLogin)
  } catch (_) {
    return false
  }
})

ipcMain.handle("setting-start-with-system", async (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
    return Boolean(app.getLoginItemSettings().openAtLogin)
  } catch (_) {
    return Boolean(enabled)
  }
})

ipcMain.on("setting-start-with-system", (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
  } catch (_) {}
})

ipcMain.handle("get-minimize-to-tray", async () => {
  return minimizeToTrayEnabled
})

ipcMain.handle("setting-minimize-to-tray", async (_event, enabled) => {
  minimizeToTrayEnabled = Boolean(enabled)
  if (minimizeToTrayEnabled) {
    ensureTray()
  } else {
    destroyTray()
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }
  return minimizeToTrayEnabled
})

ipcMain.on("setting-minimize-to-tray", (_event, enabled) => {
  minimizeToTrayEnabled = Boolean(enabled)
  if (minimizeToTrayEnabled) {
    ensureTray()
  } else {
    destroyTray()
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }
})

ipcMain.handle("setting-dedicated-gpu", async (_event, enabled) => {
  dedicatedGpuEnabled = Boolean(enabled)
  return dedicatedGpuEnabled
})

ipcMain.on("setting-dedicated-gpu", (_event, enabled) => {
  dedicatedGpuEnabled = Boolean(enabled)
})

ipcMain.on("setting-ram-allocation", (_event, ramGB) => {
  const num = Number(ramGB)
  if (!isNaN(num)) {
    const safeRam = Math.min(Math.max(Math.round(num), 1), 64)
  }
})

ipcMain.on("open-external", (_event, url) => {
  if (typeof url === "string") {
    const cleanUrl = url.trim()
    try {
      const parsed = new URL(cleanUrl)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(cleanUrl)
      }
    } catch (_) {}
  }
})

// Game Download, Verification & Launch IPC Bridges
ipcMain.handle("game-check-plan", async (_event, payload = {}) => {
  try {
    const clientFiles = Array.isArray(payload.clientFiles) ? payload.clientFiles : []
    const modpackVersion = String(payload.modpackVersion || "1.0.0")
    const plan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
    const installedManifest = await loadInstalledManifest(instanceRoot)

    return {
      success: true,
      filesToDownload: plan.toDownload.length,
      filesToPrune: plan.toPrune.length,
      totalDownloadBytes: plan.totalDownloadBytes,
      needsUpdate: plan.toDownload.length > 0 || plan.toPrune.length > 0,
      hasExistingInstall: plan.hasExistingInstall,
      isFullyInstalled:
        plan.toDownload.length === 0 &&
        plan.toPrune.length === 0 &&
        Boolean(installedManifest.modpackVersion),
    }
  } catch (err) {
    console.error("[Main] Failed to generate sync plan:", err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle("game-start-sync", async (_event, payload = {}) => {
  if (
    currentOperationState !== "IDLE" &&
    currentOperationState !== "PAUSED"
  ) {
    throw new Error(
      `Cannot start sync: Operation already in progress (${currentOperationState})`,
    )
  }

  const clientFiles = Array.isArray(payload.clientFiles) ? payload.clientFiles : []
  const modpackVersion = String(payload.modpackVersion || "1.0.0")

  // Strict payload validation
  for (const file of clientFiles) {
    if (!file || typeof file.path !== "string" || !file.path.trim()) {
      throw new Error("Invalid payload: clientFiles contains file without valid path.")
    }
    if (typeof file.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(file.sha256.trim())) {
      throw new Error(`Invalid payload: file "${file.path}" has invalid SHA-256 hash.`)
    }
  }

  currentOperationState = "SYNCING"
  activeSyncCancelSignal = { isCancelled: false, isPaused: false }

  const onProgress = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-download-progress", data)
    }
  }

  const onPhaseChange = (phase) => {
    currentOperationState = phase
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-phase-changed", phase)
    }
  }

  try {
    const result = await executeSync({
      instanceRoot,
      clientFiles,
      modpackVersion,
      onProgress,
      onPhaseChange,
      cancelSignal: activeSyncCancelSignal,
    })

    if (result.paused) {
      currentOperationState = "PAUSED"
    } else {
      currentOperationState = "IDLE"
    }

    return { success: true, ...result }
  } catch (err) {
    currentOperationState = "IDLE"
    console.error("[Main] Sync execution failed:", err)
    throw err
  } finally {
    activeSyncCancelSignal = null
  }
})

ipcMain.handle("game-pause-sync", async () => {
  if (activeSyncCancelSignal) {
    activeSyncCancelSignal.isPaused = true
  }
  currentOperationState = "PAUSED"
  return true
})

ipcMain.handle("game-cancel-sync", async () => {
  if (activeSyncCancelSignal) {
    activeSyncCancelSignal.isCancelled = true
  }
  currentOperationState = "IDLE"
  return true
})

ipcMain.handle("game-uninstall", async () => {
  if (
    currentOperationState === "SYNCING" ||
    currentOperationState === "INSTALLING"
  ) {
    throw new Error("Cannot uninstall game while synchronization is active.")
  }

  currentOperationState = "UNINSTALLING"
  try {
    const result = await uninstallGame(instanceRoot, appDataRoot)
    return result
  } catch (err) {
    console.error("[Main] Game uninstall failed:", err)
    throw err
  } finally {
    currentOperationState = "IDLE"
  }
})

ipcMain.handle("game-launch", async (_event, options = {}) => {
  if (
    currentOperationState === "SYNCING" ||
    currentOperationState === "INSTALLING" ||
    currentOperationState === "UNINSTALLING"
  ) {
    throw new Error(
      "Cannot launch Minecraft while game synchronization or installation is in progress.",
    )
  }

  try {
    return await gameLauncher.launch({
      playerName: options.playerName || "Player",
      ramGB: options.ramGB || 4,
      neoForgeVersion: options.neoForgeVersion,
      dedicatedGpu: dedicatedGpuEnabled,
      customJavaPath: options.customJavaPath,
      customArgs: options.customArgs || [],
    })
  } catch (err) {
    console.error("[Main] Launch failed:", err)
    throw err
  }
})

ipcMain.handle("game-get-status", async () => {
  return {
    ...gameLauncher.getLaunchStatus(),
    operationState: currentOperationState,
  }
})

app.whenReady().then(() => {
  createSplashWindow()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      focusMainWindow()
    }
  })
})

app.on("before-quit", () => {
  isQuitRequested = true
})

app.on("window-all-closed", () => {
  if (minimizeToTrayEnabled) {
    ensureTray()
    return
  }
  destroyTray()
  if (process.platform !== "darwin") {
    app.quit()
  }
})
