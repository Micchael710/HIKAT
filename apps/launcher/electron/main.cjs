const { app, BrowserWindow, ipcMain, screen, nativeImage, shell, Tray, Menu } = require("electron")
const path = require("path")
const http = require("http")
const fs = require("fs")
const os = require("os")
const { GameLauncher } = require("./game-launcher.cjs")
const { GameOperationManager, cleanFreshInstall } = require("./game-operation-manager.cjs")
const { setJavaGpuPreference } = require("./gpu-manager.cjs")
const { SettingsStore } = require("./settings-store.cjs")
const { SecureAuthStore } = require("./secure-auth-store.cjs")
const { parseValidOAuthCallbackUrl } = require("./url-utils.cjs")

// Single instance lock to prevent duplicate launcher instances and focus existing instance
const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  app.quit()
  process.exit(0)
}

const appDataRoot = path.join(app.getPath("appData"), "HiKAT")

try {
  app.setPath("userData", path.join(appDataRoot, "launcher"))
} catch (_) { }

// Protocol client registration for OAuth deep linking (hikat://auth/callback)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("hikat", process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient("hikat")
}

const {
  loadInstalledManifest,
  resolveWatcherDecision,
  quickCheckProtectedIntegrity,
  backgroundCheckProtectedSha,
  cleanStaging,
} = require("./client-files-sync.cjs")
const { loadCoreState } = require("./minecraft-core.cjs")

const gamesRoot = path.join(appDataRoot, "games")
const legacyInstanceRoot = path.join(appDataRoot, "game files")
const instanceRoot = legacyInstanceRoot

const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

function getGamesRoot() {
  try {
    return path.join(app.getPath("appData"), "HiKAT", "games")
  } catch (_) {
    return gamesRoot
  }
}

function getLegacyInstanceRoot() {
  try {
    return path.join(app.getPath("appData"), "HiKAT", "game files")
  } catch (_) {
    return legacyInstanceRoot
  }
}

function validateGameName(name) {
  if (typeof name !== "string") {
    throw new Error("Invalid gameName: must be a string.")
  }
  if (!name) {
    throw new Error("Invalid gameName: cannot be empty.")
  }
  if (name !== name.trim()) {
    throw new Error("Invalid gameName: leading or trailing whitespace is not allowed.")
  }
  if (name === "." || name === "..") {
    throw new Error("Invalid gameName: '.' or '..' is not allowed.")
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error("Invalid gameName: directory separators are not allowed.")
  }
  if (name.endsWith(".")) {
    throw new Error("Invalid gameName: name cannot end with a period.")
  }
  if (WINDOWS_INVALID_CHARS.test(name)) {
    throw new Error("Invalid gameName: contains invalid filesystem characters.")
  }
  const baseName = name.split(".")[0]
  if (WINDOWS_RESERVED_NAMES.test(name) || WINDOWS_RESERVED_NAMES.test(baseName)) {
    throw new Error(`Invalid gameName: "${name}" is a reserved system name.`)
  }
  const currentGamesRoot = getGamesRoot()
  const resolved = path.resolve(currentGamesRoot, name)
  const rel = path.relative(currentGamesRoot, resolved)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid gameName: path escapes gamesRoot.")
  }
  return name
}

function resolveGameContext(payload = {}) {
  const hasGameId =
    payload &&
    payload.gameId !== undefined &&
    payload.gameId !== null &&
    String(payload.gameId).trim() !== ""
  const hasGameName =
    payload &&
    payload.gameName !== undefined &&
    payload.gameName !== null &&
    String(payload.gameName).trim() !== ""

  if (hasGameId && hasGameName) {
    const gameId = String(payload.gameId).trim()
    const validName = validateGameName(payload.gameName)
    const currentGamesRoot = getGamesRoot()

    return {
      gameId,
      gameName: validName,
      instanceRoot: path.join(currentGamesRoot, validName),
    }
  }

  if (!hasGameId && !hasGameName) {
    return {
      gameId: null,
      gameName: null,
      instanceRoot: getLegacyInstanceRoot(),
    }
  }

  throw new Error("Invalid game context: gameId and gameName must be provided together or neither.")
}

const gameLauncher = new GameLauncher(app, {
  instanceRoot,
  javaStorageRoot: appDataRoot,
  processStateRoot: app.getPath("userData"),
})
const operationManager = new GameOperationManager()
const settingsStore = new SettingsStore(app.getPath("userData"))
const authStore = new SecureAuthStore(app.getPath("userData"))
let activeOperationGameId = null
let activeOperationGameName = null
let activeOperationPayload = null
let activeOperationQueuedAt = null
let activeOperationSnapshot = null
let downloadQueue = []
let autoPausedDownloadGameId = null
let pausedByUser = false
let isRestoredUserPause = false
let currentProcessingItem = null
let isProcessingQueue = false
let isPromotingQueuedSync = false
let currentIsVerify = false
let lastPayload = null
const lastPayloadByGameId = new Map()
let resumeProgressFloor = null

function mergePersistedPayload(persisted, incoming = {}) {
  if (!persisted) return incoming
  const merged = { ...persisted }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue
    if (typeof value === "string" && value.trim() === "") continue
    if (Array.isArray(value) && value.length === 0 && Array.isArray(persisted[key]) && persisted[key].length > 0) continue
    merged[key] = value
  }
  return merged
}

function getQueueFilePath() {
  return path.join(app.getPath("userData"), "download-queue.json")
}

let lastPersistentQueueSaveTime = 0
let lastPersistentQueueSaveProgress = -1
let lastPersistentQueueSavePhase = null

function savePersistentDownloadQueueThrottled(force = false) {
  const now = Date.now()
  const currentProgress = activeOperationSnapshot?.progress ?? 0
  const currentPhase = activeOperationSnapshot?.phase ?? null

  const isSignificantChange =
    currentPhase !== lastPersistentQueueSavePhase ||
    currentProgress !== lastPersistentQueueSaveProgress ||
    currentProgress === 100 ||
    currentProgress === 0

  if (force || isSignificantChange || now - lastPersistentQueueSaveTime >= 500) {
    lastPersistentQueueSaveTime = now
    lastPersistentQueueSaveProgress = currentProgress
    lastPersistentQueueSavePhase = currentPhase
    savePersistentDownloadQueue()
  }
}

function savePersistentDownloadQueue() {
  try {
    lastPersistentQueueSaveTime = Date.now()
    lastPersistentQueueSaveProgress = activeOperationSnapshot?.progress ?? 0
    lastPersistentQueueSavePhase = activeOperationSnapshot?.phase ?? null

    const queueFile = getQueueFilePath()
    const isPaused = Boolean(
      pausedByUser ||
      isRestoredUserPause ||
      operationManager.getState() === "PAUSED"
    )
    const data = {
      active: activeOperationGameId && activeOperationPayload ? {
        gameId: activeOperationGameId,
        gameName: activeOperationGameName || activeOperationGameId,
        payload: activeOperationPayload,
        queuedAt: activeOperationQueuedAt || Date.now(),
        phase: activeOperationSnapshot?.phase || null,
        progress: activeOperationSnapshot?.progress ?? 0,
        downloadedBytes: activeOperationSnapshot?.downloadedBytes ?? 0,
        totalBytes: activeOperationSnapshot?.totalBytes ?? 0,
        speedMBs: isPaused ? 0 : (activeOperationSnapshot?.speedMBs ?? 0),
        remainingMinutes: isPaused ? 0 : (activeOperationSnapshot?.remainingMinutes ?? 0),
        pausedByUser: Boolean(pausedByUser || isRestoredUserPause),
      } : null,
      queue: downloadQueue.map((item) => ({
        gameId: item.gameId,
        gameName: item.gameName,
        payload: item.payload,
        queuedAt: item.queuedAt || Date.now(),
        savedPhase: item.savedPhase || null,
        savedProgress: typeof item.savedProgress === "number" ? item.savedProgress : 0,
        savedDownloadedBytes: item.savedDownloadedBytes || 0,
        savedTotalBytes: item.savedTotalBytes || 0,
      })),
    }
    const tempFile = `${queueFile}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8")
    try {
      fs.renameSync(tempFile, queueFile)
    } catch (_) {
      if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile)
      fs.renameSync(tempFile, queueFile)
    }
  } catch (err) {
    console.error("[Main] Error saving persistent download queue:", err)
  }
}

function loadPersistentDownloadQueue() {
  try {
    const queueFile = getQueueFilePath()
    if (!fs.existsSync(queueFile)) return
    const raw = fs.readFileSync(queueFile, "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return

    const restoredQueue = []
    if (parsed.active && parsed.active.gameId && parsed.active.payload) {
      if (parsed.active.pausedByUser === true) {
        // Restaurar como ACTIVE + PAUSED sin meter en downloadQueue
        activeOperationGameId = parsed.active.gameId
        activeOperationGameName = parsed.active.gameName || parsed.active.gameId
        activeOperationPayload = parsed.active.payload
        activeOperationQueuedAt = parsed.active.queuedAt || Date.now()
        pausedByUser = true
        isRestoredUserPause = true
        lastPayload = parsed.active.payload
        if (parsed.active.gameId) {
          lastPayloadByGameId.set(parsed.active.gameId, parsed.active.payload)
        }
        const savedPhase = parsed.active.phase || "DOWNLOADING"
        const savedProgress = typeof parsed.active.progress === "number" ? parsed.active.progress : 0
        activeOperationSnapshot = {
          gameId: parsed.active.gameId,
          phase: savedPhase,
          progress: savedProgress,
          downloadedBytes: parsed.active.downloadedBytes || 0,
          totalBytes: parsed.active.totalBytes || 0,
          speedMBs: 0,
          remainingMinutes: 0,
        }
        resumeProgressFloor = {
          gameId: parsed.active.gameId,
          targetPhase: savedPhase,
          phase: savedPhase,
          floor: savedProgress,
          isResume: true,
        }
      } else {
        restoredQueue.push({
          gameId: parsed.active.gameId,
          gameName: parsed.active.gameName || parsed.active.gameId,
          payload: parsed.active.payload,
          queuedAt: parsed.active.queuedAt || Date.now(),
          savedPhase: parsed.active.phase || null,
          savedProgress: typeof parsed.active.progress === "number" ? parsed.active.progress : 0,
          savedDownloadedBytes: parsed.active.downloadedBytes || 0,
          savedTotalBytes: parsed.active.totalBytes || 0,
        })
      }
    }
    if (Array.isArray(parsed.queue)) {
      for (const item of parsed.queue) {
        if (item && item.gameId && item.payload) {
          if (item.gameId !== activeOperationGameId && !restoredQueue.some((q) => q.gameId === item.gameId)) {
            restoredQueue.push({
              gameId: item.gameId,
              gameName: item.gameName || item.gameId,
              payload: item.payload,
              queuedAt: item.queuedAt || Date.now(),
              savedPhase: item.savedPhase || null,
              savedProgress: typeof item.savedProgress === "number" ? item.savedProgress : 0,
              savedDownloadedBytes: item.savedDownloadedBytes || 0,
              savedTotalBytes: item.savedTotalBytes || 0,
            })
          }
        }
      }
    }
    downloadQueue = restoredQueue
  } catch (err) {
    console.error("[Main] Error loading persistent download queue:", err)
  }
}

loadPersistentDownloadQueue()

let mainWindow = null
let splashWindow = null
const instanceWatchers = new Map()
const latestDirectoryPoliciesByGameId = new Map()
let latestDirectoryPolicies = []
const dirtyGameIds = new Set()

function markGameIntegrityDirty(gameId) {
  dirtyGameIds.add(gameId || "__default__")
}

function isGameIntegrityDirty(gameId) {
  return dirtyGameIds.has(gameId || "__default__")
}

function clearGameIntegrityDirty(gameId) {
  dirtyGameIds.delete(gameId || "__default__")
}

function setupInstanceWatcher(gameId = null, targetInstanceRoot = instanceRoot) {
  const key = gameId || "__legacy__"
  const root = targetInstanceRoot || instanceRoot
  if (instanceWatchers.has(key)) return
  if (!fs.existsSync(root)) return

  try {
    const watcher = fs.watch(root, { recursive: true }, async (_eventType, filename) => {
      try {
        if (!filename) return
        const relPath = String(filename).replace(/\\/g, "/")

        // Ignore internal metadata, logs, crashes, saves, screenshots, temp files
        if (
          relPath.startsWith(".hikat/") ||
          relPath.startsWith("logs/") ||
          relPath.startsWith("crash-reports/") ||
          relPath.startsWith("saves/") ||
          relPath.startsWith("screenshots/") ||
          relPath.endsWith(".tmp") ||
          relPath.endsWith(".log")
        ) {
          return
        }

        // If currently syncing/downloading, ignore watcher only if it belongs to the SAME game
        if (
          operationManager &&
          operationManager.getState() !== "IDLE" &&
          activeOperationGameId === (gameId || null)
        ) {
          return
        }

        const installedManifest = await loadInstalledManifest(root)
        if (!installedManifest || !installedManifest.modpackVersion) return

        const policies =
          key === "__legacy__"
            ? latestDirectoryPolicies
            : (latestDirectoryPoliciesByGameId.get(key) || [])
        const decision = resolveWatcherDecision(
          relPath,
          policies,
          installedManifest.files || {},
          root,
        )

        if (decision === "EMIT") {
          markGameIntegrityDirty(gameId)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("game-file-integrity-changed", {
              path: relPath,
              gameId: gameId || null,
            })
          }
        }
      } catch (_) { }
    })

    watcher.on("error", () => {
      try {
        watcher?.close()
      } catch (_) { }
      instanceWatchers.delete(key)
    })

    instanceWatchers.set(key, watcher)
  } catch (err) {
    console.error(`[Main] Failed to setup instance watcher for ${key}:`, err)
  }
}

let tray = null
let isQuitRequested = false
let minimizeToTrayEnabled = settingsStore.get("minimizeToTray")
let minimizeOnGameLaunchEnabled = settingsStore.get("minimizeOnGameLaunch")
let dedicatedGpuEnabled = settingsStore.get("dedicatedGpu")
let hiddenByGameLaunch = false

gameLauncher.onStatusChangeCallback = (status, details) => {
  if (status === "running") {
    if (minimizeOnGameLaunchEnabled) {
      ensureTray()
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide()
        hiddenByGameLaunch = true
      }
    }
  } else if (status === "idle") {
    if (hiddenByGameLaunch) {
      focusMainWindow()
    }

    const pauseOnLaunch = settingsStore.get("pauseDownloadsOnGameLaunch") !== false
    if (
      pauseOnLaunch &&
      autoPausedDownloadGameId &&
      autoPausedDownloadGameId === activeOperationGameId &&
      operationManager.getState() === "PAUSED"
    ) {
      autoPausedDownloadGameId = null
      notifyDownloadQueueChanged()
      operationManager.resumeSync().then(() => {
        if (operationManager.getState() === "IDLE") {
          activeOperationGameId = null
          activeOperationGameName = null
          activeOperationPayload = null
          activeOperationSnapshot = null
          savePersistentDownloadQueue()
          processNextQueuedSync()
        }
        notifyDownloadQueueChanged()
      }).catch((err) => {
        console.error("[Main] Error auto-resuming sync:", err)
      })
    } else if (operationManager.getState() === "IDLE") {
      processNextQueuedSync()
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    const launchStatus = gameLauncher.getLaunchStatus()
    const enrichedDetails = {
      ...(details || {}),
      gameId: details?.gameId || launchStatus.gameId || null,
      runningGameId: launchStatus.gameId || null,
    }
    mainWindow.webContents.send("game-launch-status", status, enrichedDetails)
  }
}


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
  } catch (_) { }
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
  const wasHiddenByGameLaunch = hiddenByGameLaunch
  hiddenByGameLaunch = false
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

  if (wasHiddenByGameLaunch && !minimizeToTrayEnabled) {
    destroyTray()
  }
}

function ensureTray() {
  if (tray && (typeof tray.isDestroyed !== "function" || !tray.isDestroyed())) {
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
    } catch (_) { }
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
        processNextQueuedSync()
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

let pendingDeepLinkUrl = null
const completedOAuthStates = new Map()

function extractDeepLinkFromArgs(args) {
  if (!Array.isArray(args)) return null
  for (const arg of args) {
    const valid = parseValidOAuthCallbackUrl(arg)
    if (valid) return valid
  }
  return null
}

const initialDeepLink = extractDeepLinkFromArgs(process.argv)
if (initialDeepLink) {
  pendingDeepLinkUrl = initialDeepLink
}

function handleDeepLinkUrl(rawUrl) {
  const validUrl = parseValidOAuthCallbackUrl(rawUrl)
  if (!validUrl) return

  focusMainWindow()

  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isLoading()
  ) {
    pendingDeepLinkUrl = null
    mainWindow.webContents.send("oauth:callback", validUrl)
  } else {
    pendingDeepLinkUrl = validUrl
  }
}

const OAUTH_LOOPBACK_HOST = "127.0.0.1"
const OAUTH_LOOPBACK_PORT = 47821

let oauthLoopbackServer = null

function startOAuthLoopbackServer() {
  if (oauthLoopbackServer) {
    return
  }

  const logoPath = path.join(__dirname, "splash-logo.png")
  const backgroundPath = path.join(__dirname, "oauth-bg.png")

  oauthLoopbackServer = http.createServer((req, res) => {
    const url = new URL(
      req.url,
      `http://${OAUTH_LOOPBACK_HOST}:${OAUTH_LOOPBACK_PORT}`,
    )

    // Logo HiKAT
    if (url.pathname === "/auth/logo.png") {
      if (!fs.existsSync(logoPath)) {
        res.writeHead(404)
        res.end()
        return
      }

      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      })

      fs.createReadStream(logoPath).pipe(res)
      return
    }

    // Fondo HiKAT
    if (url.pathname === "/auth/background.png") {
      if (!fs.existsSync(backgroundPath)) {
        res.writeHead(404)
        res.end()
        return
      }

      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      })

      fs.createReadStream(backgroundPath).pipe(res)
      return
    }

    // Estado real del callback en Electron
    if (url.pathname === "/auth/status") {
      const state = url.searchParams.get("state")

      let status = "invalid"
      if (state && completedOAuthStates.has(state)) {
        status = "completed"
      } else if (
        state &&
        authStore &&
        typeof authStore.peekPendingOAuth === "function" &&
        authStore.peekPendingOAuth(state)
      ) {
        status = "pending"
      } else {
        status = "invalid"
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      })

      res.end(
        JSON.stringify({
          status,
          completed: status === "completed",
        }),
      )

      return
    }

    if (url.pathname !== "/auth/callback") {
      res.writeHead(404)
      res.end()
      return
    }

    const callbackUrl =
      `hikat://auth/callback${url.search}`

    const callbackState =
      url.searchParams.get("state") || ""

    const providerError =
      url.searchParams.get("error") || ""

    const serializedCallbackUrl =
      JSON.stringify(callbackUrl).replace(
        /</g,
        "\\u003c",
      )

    const serializedState =
      JSON.stringify(callbackState).replace(
        /</g,
        "\\u003c",
      )

    const serializedProviderError =
      JSON.stringify(providerError).replace(
        /</g,
        "\\u003c",
      )

    // Idioma: 1. lang explícito en URL; 2. OAuth completed guardado; 3. pending OAuth; 4. Accept-Language; 5. en fallback
    const VALID_LOCALES = ["es", "en", "pt", "fr"]

    const urlLang = String(url.searchParams.get("lang") || "").toLowerCase().trim()
    let resolvedLanguage = null
    if (VALID_LOCALES.includes(urlLang)) {
      resolvedLanguage = urlLang
    }

    if (!resolvedLanguage && callbackState && completedOAuthStates.has(callbackState)) {
      const completedData = completedOAuthStates.get(callbackState)
      const completedLocale = completedData?.locale ? String(completedData.locale).toLowerCase().trim() : null
      if (completedLocale && VALID_LOCALES.includes(completedLocale)) {
        resolvedLanguage = completedLocale
      }
    }

    if (!resolvedLanguage && callbackState && authStore && typeof authStore.peekPendingOAuth === "function") {
      const pending = authStore.peekPendingOAuth(callbackState)
      const pendingLocale = pending?.locale ? String(pending.locale).toLowerCase().trim() : null
      if (pendingLocale && VALID_LOCALES.includes(pendingLocale)) {
        resolvedLanguage = pendingLocale
      }
    }

    if (!resolvedLanguage) {
      const acceptLanguage = String(req.headers["accept-language"] || "").toLowerCase()
      if (acceptLanguage.startsWith("es")) {
        resolvedLanguage = "es"
      } else if (acceptLanguage.startsWith("pt")) {
        resolvedLanguage = "pt"
      } else if (acceptLanguage.startsWith("fr")) {
        resolvedLanguage = "fr"
      } else if (acceptLanguage.startsWith("en")) {
        resolvedLanguage = "en"
      }
    }

    if (!resolvedLanguage) {
      resolvedLanguage = "en"
    }

    const language = resolvedLanguage

    const serializedLanguage =
      JSON.stringify(language).replace(
        /</g,
        "\\u003c",
      )

    const translations = {
      es: {
        waitingStatus: "",
        waitingTitle: "Continuando en HiKAT Launcher",
        waitingDescription:
          "Estamos abriendo HiKAT para completar el inicio de sesión.",
        waitingSecondary:
          "Confirma el aviso del navegador para continuar.",

        successStatus: "",
        successTitle: "Inicio de sesión completado",
        successDescription:
          "Ya puedes continuar en HiKAT Launcher.",
        successSecondary:
          "Puedes cerrar esta pestaña de forma segura.",

        invalidStatus: "",
        invalidTitle: "Intento no válido",
        invalidDescription:
          "Este intento de inicio de sesión ya no es válido.",
        invalidSecondary:
          "Vuelve a HiKAT Launcher e inténtalo de nuevo.",

        openErrorStatus: "",
        openErrorTitle: "No se pudo abrir el Launcher",
        openErrorDescription:
          "HiKAT Launcher no respondió. Puedes volver a intentarlo.",
        openErrorSecondary:
          "Puedes volver a intentarlo si el Launcher no se abrió automáticamente.",
        retry: "Abrir HiKAT Launcher",

        providerErrorStatus: "",
        providerErrorTitle: "Inicio de sesión cancelado",
        providerErrorDescription:
          "El inicio de sesión con tu cuenta externa no pudo completarse.",
        providerErrorSecondary:
          "Vuelve a HiKAT Launcher e inténtalo nuevamente.",
      },

      en: {
        waitingStatus: "",
        waitingTitle: "Continuing to HiKAT Launcher",
        waitingDescription:
          "We're opening HiKAT to complete sign-in.",
        waitingSecondary:
          "Confirm the browser prompt to continue.",

        successStatus: "",
        successTitle: "Sign-in complete",
        successDescription:
          "You can now continue in HiKAT Launcher.",
        successSecondary:
          "You can safely close this tab.",

        invalidStatus: "",
        invalidTitle: "Invalid sign-in",
        invalidDescription:
          "This sign-in attempt is no longer valid.",
        invalidSecondary:
          "Return to HiKAT Launcher and try again.",

        openErrorStatus: "",
        openErrorTitle: "Launcher could not be opened",
        openErrorDescription:
          "HiKAT Launcher did not respond. You can try again.",
        openErrorSecondary:
          "You can try again if the Launcher did not open automatically.",
        retry: "Open HiKAT Launcher",

        providerErrorStatus: "",
        providerErrorTitle: "Sign-in cancelled",
        providerErrorDescription:
          "Sign-in with your external account could not be completed.",
        providerErrorSecondary:
          "Return to HiKAT Launcher and try again.",
      },

      pt: {
        waitingStatus: "",
        waitingTitle: "Continuando no HiKAT Launcher",
        waitingDescription:
          "Estamos abrindo o HiKAT para concluir o login.",
        waitingSecondary:
          "Confirme o aviso do navegador para continuar.",

        successStatus: "",
        successTitle: "Login concluído",
        successDescription:
          "Agora você pode continuar no HiKAT Launcher.",
        successSecondary:
          "Você pode fechar esta aba com segurança.",

        invalidStatus: "",
        invalidTitle: "Tentativa inválida",
        invalidDescription:
          "Esta tentativa de login não é mais válida.",
        invalidSecondary:
          "Volte ao HiKAT Launcher e tente novamente.",

        openErrorStatus: "",
        openErrorTitle: "Não foi possível abrir o Launcher",
        openErrorDescription:
          "O HiKAT Launcher não respondeu. Você pode tentar novamente.",
        openErrorSecondary:
          "Você pode tentar novamente se o Launcher não abrir automaticamente.",
        retry: "Abrir o HiKAT Launcher",

        providerErrorStatus: "",
        providerErrorTitle: "Login cancelado",
        providerErrorDescription:
          "O login com sua conta externa não pôde ser concluído.",
        providerErrorSecondary:
          "Volte ao HiKAT Launcher e tente novamente.",
      },

      fr: {
        waitingStatus: "",
        waitingTitle: "Redirection vers HiKAT Launcher",
        waitingDescription:
          "Nous ouvrons HiKAT pour finaliser la connexion.",
        waitingSecondary:
          "Confirmez l’invite du navigateur pour continuer.",

        successStatus: "",
        successTitle: "Connexion terminée",
        successDescription:
          "Vous pouvez maintenant continuer dans HiKAT Launcher.",
        successSecondary:
          "Vous pouvez fermer cet onglet en toute sécurité.",

        invalidStatus: "",
        invalidTitle: "Tentative non valide",
        invalidDescription:
          "Cette tentative de connexion n'est plus valide.",
        invalidSecondary:
          "Retournez dans HiKAT Launcher et réessayez.",

        openErrorStatus: "",
        openErrorTitle: "Impossible d’ouvrir le Launcher",
        openErrorDescription:
          "HiKAT Launcher n’a pas répondu. Vous pouvez réessayer.",
        openErrorSecondary:
          "Vous pouvez réessayer si le Launcher ne s’est pas ouvert automatiquement.",
        retry: "Ouvrir HiKAT Launcher",

        providerErrorStatus: "",
        providerErrorTitle: "Connexion annulée",
        providerErrorDescription:
          "La connexion avec votre compte externe n’a pas pu être terminée.",
        providerErrorSecondary:
          "Retournez dans HiKAT Launcher et réessayez.",
      },
    }

    const copy =
      translations[language] ||
      translations.en

    const serializedCopy =
      JSON.stringify(copy).replace(
        /</g,
        "\\u003c",
      )

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    })

    res.end(`
      <!doctype html>

      <html lang="${language}">
        <head>
          <meta charset="utf-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          >

          <meta
            name="color-scheme"
            content="dark"
          >

          <title>HiKAT Launcher</title>

          <style>
            * {
              box-sizing: border-box;
            }

            html,
            body {
              margin: 0;
              width: 100%;
              min-height: 100%;
              background-color: #090d12;
              color: #ffffff;
              font-family:
                Inter,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
            }

            body {
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              overflow: hidden;
            }

            .bg-layer {
              position: absolute;
              inset: 0;
              background-image: url("/auth/background.png");
              background-size: cover;
              background-position: center;
              opacity: 0.35;
              filter: blur(2px);
              transform: scale(1.04);
              z-index: 0;
            }

            .overlay-layer {
              position: absolute;
              inset: 0;
              background: radial-gradient(
                ellipse at center,
                rgba(9, 13, 18, 0.7) 0%,
                rgba(9, 13, 18, 0.95) 100%
              );
              z-index: 1;
            }

            .page {
              position: relative;
              z-index: 2;
              width: 100%;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }

            .card {
              width: min(
                440px,
                calc(100vw - 32px)
              );
              padding: 36px 30px;
              background:
                linear-gradient(
                  180deg,
                  rgba(20, 29, 38, 0.96) 0%,
                  rgba(13, 18, 24, 0.96) 100%
                );
              border:
                1.5px solid
                rgba(255, 255, 255, 0.1);
              border-radius: 20px;
              box-shadow:
                0 24px 60px rgba(0, 0, 0, 0.65),
                0 2px 8px rgba(0, 0, 0, 0.4);
              backdrop-filter: blur(16px);
              text-align: center;
            }

            .brand {
              display: flex;
              justify-content: center;
              margin-bottom: 20px;
            }

            .brand img {
              max-height: 48px;
              max-width: 240px;
              object-fit: contain;
            }

            .status {
              display: none;
            }

            h1 {
              margin: 0 0 10px 0;
              font-size: 20px;
              line-height: 1.3;
              font-weight: 700;
              color: #ffffff;
            }

            .description {
              margin: 0;
              color: #8899aa;
              font-size: 14px;
              line-height: 1.5;
            }

            .secondary {
              margin: 18px 0 0;
              color: #718090;
              font-size: 12.5px;
              line-height: 1.5;
            }

            .loader {
              width: 32px;
              height: 32px;
              margin: 24px auto 0;
              border:
                3px solid
                rgba(255, 255, 255, 0.10);
              border-top-color: rgba(130, 200, 230, 0.9);
              border-radius: 50%;
              animation:
                spin 0.8s linear infinite;
            }

            @keyframes spin {
              to {
                transform: rotate(360deg);
              }
            }

            .retry {
              display: none;
              width: 100%;
              margin-top: 24px;
              padding: 13px 20px;
              border: 2px solid rgba(130, 200, 230, 0.5);
              border-radius: 12px;
              background: linear-gradient(135deg, #1c384e 0%, #295372 100%);
              color: #ffffff;
              font-family:
                Inter,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
              font-size: 15px;
              font-weight: 700;
              cursor: pointer;
              transition:
                border-color 0.22s ease,
                background 0.22s ease,
                box-shadow 0.25s ease,
                transform 0.2s ease;
              text-align: center;
              text-decoration: none;
              line-height: 1.2;
            }

            .retry:hover {
              background: linear-gradient(135deg, #234764, #33678e);
              border-color: rgba(160, 230, 255, 0.9);
              box-shadow: 0 0 28px rgba(90, 180, 220, 0.45);
            }
          </style>
        </head>

        <body>

          <div class="bg-layer"></div>
          <div class="overlay-layer"></div>

          <div class="page">

            <main class="card">

              <div class="brand">
                <img
                  src="/auth/logo.png"
                  alt="HiKAT"
                >
              </div>

              <div
                id="status"
                class="status"
              ></div>

              <h1 id="title"></h1>

              <p
                id="description"
                class="description"
              ></p>

              <div
                id="loader"
                class="loader"
              ></div>

              <button
                id="retry"
                class="retry"
                type="button"
              ></button>

              <p
                id="secondary"
                class="secondary"
              ></p>

            </main>

          </div>

          <script>
            const callbackUrl =
              ${serializedCallbackUrl};

            const callbackState =
              ${serializedState};

            const providerError =
              ${serializedProviderError};

            const t =
              ${serializedCopy};

            const resolvedLang =
              ${serializedLanguage};

            try {
              const currentUrl = new URL(window.location.href);
              if (currentUrl.searchParams.get("lang") !== resolvedLang) {
                currentUrl.searchParams.set("lang", resolvedLang);
                window.history.replaceState({}, "", currentUrl.toString());
              }
            } catch (_) { }

            const status =
              document.getElementById("status");

            const title =
              document.getElementById("title");

            const description =
              document.getElementById("description");

            const loader =
              document.getElementById("loader");

            const secondary =
              document.getElementById("secondary");

            const retry =
              document.getElementById("retry");

            let completed = false;
            let launchTimeout = null;
            let statusInterval = null;

            function showWaitingState() {
              completed = false;

              status.textContent =
                t.waitingStatus;

              title.textContent =
                t.waitingTitle;

              description.textContent =
                t.waitingDescription;

              secondary.textContent =
                t.waitingSecondary;

              loader.style.display =
                "block";

              retry.style.display =
                "none";
            }

            function showCompletedState() {
              if (completed) {
                return;
              }

              completed = true;

              clearTimeout(launchTimeout);
              clearInterval(statusInterval);

              status.textContent =
                t.successStatus;

              title.textContent =
                t.successTitle;

              description.textContent =
                t.successDescription;

              secondary.textContent =
                t.successSecondary;

              loader.style.display =
                "none";

              retry.style.display =
                "none";
            }

            function showFallbackRetry() {
              if (completed) {
                return;
              }

              retry.textContent =
                t.retry;

              retry.style.display =
                "block";
            }

            function showProviderError() {
              completed = true;

              clearTimeout(launchTimeout);
              clearInterval(statusInterval);

              status.textContent =
                t.providerErrorStatus;

              title.textContent =
                t.providerErrorTitle;

              description.textContent =
                t.providerErrorDescription;

              secondary.textContent =
                t.providerErrorSecondary;

              loader.style.display =
                "none";

              retry.style.display =
                "none";
            }

            function showInvalidState() {
              completed = true;

              clearTimeout(launchTimeout);
              clearInterval(statusInterval);

              status.textContent =
                t.invalidStatus || "";

              title.textContent =
                t.invalidTitle || "Intento no válido";

              description.textContent =
                t.invalidDescription || "Este intento de inicio de sesión ya no es válido.";

              secondary.textContent =
                t.invalidSecondary || "Vuelve a HiKAT Launcher e inténtalo de nuevo.";

              loader.style.display =
                "none";

              retry.style.display =
                "none";
            }

            async function checkLauncherStatus() {
              if (
                completed ||
                !callbackState
              ) {
                return;
              }

              try {
                const response = await fetch(
                  "/auth/status?state=" +
                  encodeURIComponent(callbackState),
                  {
                    cache: "no-store",
                  },
                );

                if (!response.ok) {
                  return;
                }

                const result =
                  await response.json();

                if (result.status === "completed" || result.completed) {
                  showCompletedState();
                } else if (result.status === "invalid") {
                  showInvalidState();
                }
              } catch (_) { }
            }

            function openLauncher() {
              clearTimeout(launchTimeout);
              clearInterval(statusInterval);

              showWaitingState();

              window.location.href =
                callbackUrl;

              statusInterval =
                setInterval(
                  checkLauncherStatus,
                  500,
                );

              launchTimeout =
                setTimeout(() => {
                  checkLauncherStatus()
                    .finally(() => {
                      if (!completed) {
                        showFallbackRetry();
                      }
                    });
                }, 3000);
            }

            window.addEventListener(
              "focus",
              () => {
                if (!completed) {
                  showFallbackRetry();
                }
              },
            );

            retry.addEventListener(
              "click",
              () => {
                openLauncher();
              },
            );

            async function initPreflight() {
              if (!callbackState) {
                showInvalidState();
                return;
              }

              try {
                const response = await fetch(
                  "/auth/status?state=" +
                  encodeURIComponent(callbackState),
                  {
                    cache: "no-store",
                  },
                );

                if (!response.ok) {
                  showInvalidState();
                  return;
                }

                const result =
                  await response.json();

                if (result.status === "completed" || result.completed) {
                  showCompletedState();
                } else if (result.status === "invalid") {
                  showInvalidState();
                } else if (result.status === "pending") {
                  openLauncher();
                } else {
                  showInvalidState();
                }
              } catch (_) {
                showInvalidState();
              }
            }

            if (providerError) {
              showProviderError();
            } else {
              showWaitingState();
              initPreflight();
            }
          </script>

        </body>
      </html>
    `)
  })

  oauthLoopbackServer.listen(
    OAUTH_LOOPBACK_PORT,
    OAUTH_LOOPBACK_HOST,
  )
}

// Second instance handler (when user launches launcher while already running or via deep link)
app.on("second-instance", (_event, commandLine) => {
  focusMainWindow()
  const deepLink = extractDeepLinkFromArgs(commandLine)
  if (deepLink) {
    handleDeepLinkUrl(deepLink)
  }
})

// macOS open-url deep link handler
app.on("open-url", (event, url) => {
  event.preventDefault()
  handleDeepLinkUrl(url)
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

// IPC Handlers for Global Settings (Main Authoritative Storage)
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
  } catch (_) { }
})

ipcMain.handle("get-minimize-to-tray", async () => {
  return settingsStore.get("minimizeToTray")
})

ipcMain.handle("setting-minimize-to-tray", async (_event, enabled) => {
  const safeVal = Boolean(enabled)
  settingsStore.set("minimizeToTray", safeVal)
  minimizeToTrayEnabled = safeVal
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
  const safeVal = Boolean(enabled)
  settingsStore.set("minimizeToTray", safeVal)
  minimizeToTrayEnabled = safeVal
  if (minimizeToTrayEnabled) {
    ensureTray()
  } else {
    destroyTray()
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }
})

ipcMain.handle("get-minimize-on-game-launch", async () => {
  return settingsStore.get("minimizeOnGameLaunch")
})

ipcMain.handle("setting-minimize-on-game-launch", async (_event, enabled) => {
  const safeVal = Boolean(enabled)
  settingsStore.set("minimizeOnGameLaunch", safeVal)
  minimizeOnGameLaunchEnabled = safeVal
  return minimizeOnGameLaunchEnabled
})

ipcMain.on("setting-minimize-on-game-launch", (_event, enabled) => {
  const safeVal = Boolean(enabled)
  settingsStore.set("minimizeOnGameLaunch", safeVal)
  minimizeOnGameLaunchEnabled = safeVal
})

ipcMain.handle("get-pause-downloads-on-game-launch", async () => {
  return settingsStore.get("pauseDownloadsOnGameLaunch") !== false
})

ipcMain.handle("setting-pause-downloads-on-game-launch", async (_event, enabled) => {
  const safeVal = Boolean(enabled)
  settingsStore.set("pauseDownloadsOnGameLaunch", safeVal)
  return safeVal
})

ipcMain.handle("get-dedicated-gpu", async (_event, payload) => {
  if (payload && payload.gameId) {
    return settingsStore.getGameSetting(payload.gameId, "dedicatedGpu", { gameName: payload.gameName })
  }
  return settingsStore.get("dedicatedGpu")
})

ipcMain.handle("setting-dedicated-gpu", async (_event, enabled, context) => {
  const safeVal = Boolean(enabled)
  if (context && context.gameId) {
    settingsStore.setGameSetting(context.gameId, "dedicatedGpu", safeVal, { gameName: context.gameName })
    return settingsStore.getGameSetting(context.gameId, "dedicatedGpu", { gameName: context.gameName })
  }
  const saved = settingsStore.set("dedicatedGpu", safeVal)
  if (!saved) {
    throw new Error("Failed to persist dedicated GPU preference")
  }
  dedicatedGpuEnabled = safeVal
  return dedicatedGpuEnabled
})

ipcMain.on("setting-dedicated-gpu", (_event, enabled, context) => {
  const safeVal = Boolean(enabled)
  if (context && context.gameId) {
    settingsStore.setGameSetting(context.gameId, "dedicatedGpu", safeVal, { gameName: context.gameName })
  } else {
    const saved = settingsStore.set("dedicatedGpu", safeVal)
    if (saved) {
      dedicatedGpuEnabled = safeVal
    }
  }
})

ipcMain.handle("get-ram-allocation", async (_event, payload) => {
  if (payload && payload.gameId) {
    return settingsStore.getGameSetting(payload.gameId, "ramGB", { gameName: payload.gameName })
  }
  return settingsStore.get("ramGB")
})

ipcMain.handle("setting-ram-allocation", async (_event, ramGB, context) => {
  if (context && context.gameId) {
    settingsStore.setGameSetting(context.gameId, "ramGB", ramGB, { gameName: context.gameName })
    return settingsStore.getGameSetting(context.gameId, "ramGB", { gameName: context.gameName })
  }
  settingsStore.set("ramGB", ramGB)
  return settingsStore.get("ramGB")
})

ipcMain.on("setting-ram-allocation", (_event, ramGB, context) => {
  if (context && context.gameId) {
    settingsStore.setGameSetting(context.gameId, "ramGB", ramGB, { gameName: context.gameName })
  } else {
    settingsStore.set("ramGB", ramGB)
  }
})

// IPC Handlers for Secure Auth Session Storage (safeStorage)
ipcMain.handle("auth:load-session", async () => {
  return authStore.loadSession()
})

ipcMain.handle("auth:save-session", async (_event, session) => {
  authStore.saveSession(session)
  return true
})

ipcMain.handle("auth:clear-session", async () => {
  authStore.clearSession()
  return true
})

ipcMain.handle("auth:save-pending-oauth", async (_event, data) => {
  authStore.savePendingOAuth(data)
  return true
})

ipcMain.handle("auth:get-pending-oauth", async (_event, state) => {
  return authStore.peekPendingOAuth(state)
})

ipcMain.handle("auth:mark-oauth-completed", async (_event, state) => {
  if (state && typeof state === "string") {
    let locale = undefined
    if (authStore && typeof authStore.peekPendingOAuth === "function") {
      const pending = authStore.peekPendingOAuth(state)
      if (pending && pending.locale) {
        locale = pending.locale
      }
    }
    completedOAuthStates.set(state, { locale })
    setTimeout(() => {
      completedOAuthStates.delete(state)
    }, 60_000)
  }
  return true
})

ipcMain.handle("auth:clear-pending-oauth", async () => {
  authStore.clearPendingOAuth()
  return true
})

ipcMain.handle("oauth:get-pending-callback", async () => {
  const url = pendingDeepLinkUrl
  pendingDeepLinkUrl = null
  return url
})


ipcMain.on("open-external", (_event, url) => {

  if (typeof url === "string") {
    const cleanUrl = url.trim()
    try {
      const parsed = new URL(cleanUrl)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(cleanUrl)
      }
    } catch (_) { }
  }
})

// Game Download, Verification & Launch IPC Bridges
ipcMain.handle("game-check-plan", async (_event, payload = {}) => {
  try {
    const ctx = resolveGameContext(payload)
    const watcherKey = ctx.gameId || "__legacy__"
    if (Array.isArray(payload.directoryPolicies)) {
      latestDirectoryPoliciesByGameId.set(watcherKey, payload.directoryPolicies)
      if (!ctx.gameId) {
        latestDirectoryPolicies = payload.directoryPolicies
      }
    }
    setupInstanceWatcher(ctx.gameId, ctx.instanceRoot)
    return await operationManager.checkPlan({
      instanceRoot: ctx.instanceRoot,
      javaStorageRoot: appDataRoot,
      clientFiles: payload.clientFiles,
      directoryPolicies: payload.directoryPolicies,
      modpackVersion: payload.modpackVersion,
      minecraftVersion: payload.minecraftVersion,
      modLoader: payload.modLoader,
      modLoaderVersion: payload.modLoaderVersion,
      neoForgeVersion: payload.neoForgeVersion,
    })
  } catch (err) {
    console.error("[Main] Failed to generate sync plan:", err)
    return { success: false, error: err.message }
  }
})

function getDownloadQueueSnapshot() {
  let active = null
  if (activeOperationGameId) {
    const isRestoredPause = isRestoredUserPause && operationManager.getState() === "IDLE"
    const opState = isRestoredPause ? "PAUSED" : operationManager.getState()
    const realPhase =
      activeOperationSnapshot?.phase ||
      operationManager.lastPausedPhase ||
      (opState === "INSTALLING" ? "INSTALLING" : "DOWNLOADING")
    const isCommitting = Boolean(operationManager.isCommitting)
    const isVerifying = Boolean(currentIsVerify || realPhase === "VERIFYING")
    active = {
      gameId: activeOperationGameId,
      gameName: activeOperationGameName || activeOperationGameId,
      state: opState,
      phase: realPhase,
      isCommitting,
      canPause: opState !== "PAUSED" && opState !== "IDLE" && !isCommitting && !isVerifying,
      canCancel: (opState !== "IDLE" || isRestoredPause) && !isCommitting && !isVerifying,
      progress: activeOperationSnapshot?.progress ?? 0,
      speedMBs: opState === "PAUSED" ? 0 : (activeOperationSnapshot?.speedMBs ?? 0),
      downloadedBytes: activeOperationSnapshot?.downloadedBytes ?? 0,
      totalBytes: activeOperationSnapshot?.totalBytes ?? 0,
      remainingMinutes: opState === "PAUSED" ? 0 : (activeOperationSnapshot?.remainingMinutes ?? 0),
    }
  } else {
    const pendingRecovery = (currentProcessingItem && (currentProcessingItem.savedPhase || currentProcessingItem.savedProgress))
      ? currentProcessingItem
      : downloadQueue.find((item) => item && (item.savedPhase || (typeof item.savedProgress === "number" && item.savedProgress > 0)))

    if (pendingRecovery && operationManager.getState() === "IDLE") {
      const savedPhase = pendingRecovery.savedPhase || "DOWNLOADING"
      const savedProgress = typeof pendingRecovery.savedProgress === "number" ? pendingRecovery.savedProgress : 0
      active = {
        gameId: pendingRecovery.gameId,
        gameName: pendingRecovery.gameName || pendingRecovery.gameId,
        state: "SYNCING",
        phase: savedPhase,
        isCommitting: false,
        canPause: true,
        canCancel: true,
        progress: savedProgress,
        speedMBs: 0,
        downloadedBytes: pendingRecovery.savedDownloadedBytes || 0,
        totalBytes: pendingRecovery.savedTotalBytes || 0,
        remainingMinutes: 0,
        isPendingResume: true,
      }
    }
  }

  const queuedSource = active
    ? downloadQueue.filter((item) => item.gameId !== active.gameId)
    : downloadQueue

  const queued = queuedSource.map((item, index) => {
    const hasStarted = Boolean(
      item.savedPhase ||
      (typeof item.savedProgress === "number" && item.savedProgress > 0) ||
      (typeof item.savedDownloadedBytes === "number" && item.savedDownloadedBytes > 0)
    )
    return {
      gameId: item.gameId,
      gameName: item.gameName,
      position: index + 1,
      hasStarted,
      savedProgress: typeof item.savedProgress === "number" ? item.savedProgress : 0,
      savedPhase: item.savedPhase || null,
    }
  })

  return { active, queued }
}

function notifyDownloadQueueChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("game-download-queue-changed", getDownloadQueueSnapshot())
  }
}

async function processNextQueuedSync() {
  if (isProcessingQueue) return
  if (downloadQueue.length === 0) return
  if (isRestoredUserPause) return
  if (operationManager.getState() !== "IDLE") return

  const pauseOnLaunch = settingsStore.get("pauseDownloadsOnGameLaunch") !== false
  const launchStatus = gameLauncher.getLaunchStatus()
  const isMinecraftActive = launchStatus.status !== "idle"
  const runningGameId = launchStatus.gameId || null

  if (isMinecraftActive) {
    if (pauseOnLaunch) {
      return
    }
    if (downloadQueue[0]?.gameId && downloadQueue[0].gameId === runningGameId) {
      return
    }
  }

  const nextItem = downloadQueue.shift()
  if (!nextItem) return

  currentProcessingItem = nextItem
  isProcessingQueue = true
  savePersistentDownloadQueue()
  notifyDownloadQueueChanged()

  try {
    const isRestoredActive = Boolean(
      nextItem.savedPhase ||
      (typeof nextItem.savedProgress === "number" && nextItem.savedProgress > 0)
    )
    const effectiveItemPayload = {
      ...nextItem.payload,
      gameId: nextItem.gameId,
      gameName: nextItem.gameName,
      ...(isRestoredActive ? { resume: true } : {}),
    }

    if (isRestoredActive) {
      resumeProgressFloor = {
        gameId: nextItem.gameId,
        targetPhase: nextItem.savedPhase || "DOWNLOADING",
        phase: nextItem.savedPhase || "DOWNLOADING",
        floor: typeof nextItem.savedProgress === "number" ? nextItem.savedProgress : 0,
        isResume: true,
      }
    }

    const ctx = resolveGameContext(effectiveItemPayload)
    await runGameSync(ctx, effectiveItemPayload)
  } catch (err) {
    const isCancelled =
      err?.message?.includes("cancelled") ||
      Boolean(operationManager.activeCancelSignal?.isCancelled)
    if (!isCancelled) {
      console.error(`[Main] Error running queued sync for ${nextItem.gameId}:`, err)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("game-phase-changed", "ERROR", nextItem.gameId, err?.message || null)
      }
    }
  } finally {
    isProcessingQueue = false
    currentProcessingItem = null
    if (operationManager.getState() === "IDLE") {
      processNextQueuedSync()
    }
  }
}

async function runGameSync(ctx, payload) {
  isRestoredUserPause = false
  pausedByUser = false
  currentProcessingItem = null
  const watcherKey = ctx.gameId || "__legacy__"
  if (Array.isArray(payload.directoryPolicies)) {
    latestDirectoryPoliciesByGameId.set(watcherKey, payload.directoryPolicies)
    if (!ctx.gameId) {
      latestDirectoryPolicies = payload.directoryPolicies
    }
  }

  activeOperationGameId = ctx.gameId
  activeOperationGameName = ctx.gameName || payload.gameName || ctx.gameId
  activeOperationPayload = payload
  activeOperationQueuedAt = Date.now()
  currentIsVerify = Boolean(payload.isVerify)
  lastPayload = payload
  if (ctx.gameId) {
    lastPayloadByGameId.set(ctx.gameId, payload)
  }
  savePersistentDownloadQueue()

  if (!payload.resume) {
    resumeProgressFloor = null
  }

  if (!activeOperationSnapshot || activeOperationSnapshot.gameId !== ctx.gameId) {
    const initialProgress =
      resumeProgressFloor && (!resumeProgressFloor.gameId || resumeProgressFloor.gameId === ctx.gameId)
        ? resumeProgressFloor.floor
        : 0
    const initialPhase =
      resumeProgressFloor && (!resumeProgressFloor.gameId || resumeProgressFloor.gameId === ctx.gameId) && (resumeProgressFloor.targetPhase || resumeProgressFloor.phase)
        ? (resumeProgressFloor.targetPhase || resumeProgressFloor.phase)
        : (payload.isVerify ? "VERIFYING" : "DOWNLOADING")

    activeOperationSnapshot = {
      gameId: ctx.gameId || null,
      phase: initialPhase,
      progress: initialProgress,
      speedMBs: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      remainingMinutes: 0,
    }
  }
  notifyDownloadQueueChanged()

  const isIntermediateResumeReplay = (phase) => {
    return Boolean(
      resumeProgressFloor &&
      resumeProgressFloor.isResume &&
      (!resumeProgressFloor.gameId || resumeProgressFloor.gameId === ctx.gameId) &&
      resumeProgressFloor.targetPhase === "INSTALLING" &&
      (phase === "DOWNLOADING" || phase === "CHECKING")
    )
  }

  const onProgress = (data) => {
    const rawPhase = data.phase || activeOperationSnapshot?.phase || "DOWNLOADING"
    const rawProgress = typeof data.progress === "number" ? data.progress : 0
    let effectiveProgress = rawProgress
    let effectivePhase = rawPhase

    if (resumeProgressFloor && (!resumeProgressFloor.gameId || resumeProgressFloor.gameId === ctx.gameId)) {
      if (isIntermediateResumeReplay(rawPhase)) {
        effectivePhase = resumeProgressFloor.targetPhase
        effectiveProgress = resumeProgressFloor.floor
      } else if (rawPhase === (resumeProgressFloor.targetPhase || resumeProgressFloor.phase)) {
        if (effectiveProgress <= resumeProgressFloor.floor) {
          effectiveProgress = resumeProgressFloor.floor
        } else {
          resumeProgressFloor = null
        }
      } else {
        resumeProgressFloor = null
      }
    }

    if (activeOperationSnapshot) {
      activeOperationSnapshot = {
        gameId: ctx.gameId || null,
        phase: effectivePhase,
        isCommitting: Boolean(operationManager.isCommitting),
        progress: effectiveProgress,
        speedMBs: typeof data.speedMBs === "number" ? data.speedMBs : 0,
        downloadedBytes: typeof data.downloadedBytes === "number" ? data.downloadedBytes : 0,
        totalBytes: typeof data.totalBytes === "number" ? data.totalBytes : 0,
        remainingMinutes: typeof data.remainingMinutes === "number" ? data.remainingMinutes : 0,
      }
      savePersistentDownloadQueueThrottled()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const opState = operationManager.getState()
      const isCommitting = Boolean(operationManager.isCommitting)
      const isVerifying = Boolean(currentIsVerify || effectivePhase === "VERIFYING")
      mainWindow.webContents.send("game-download-progress", {
        ...data,
        phase: effectivePhase,
        progress: effectiveProgress,
        state: opState,
        isCommitting,
        canPause: opState !== "PAUSED" && opState !== "IDLE" && !isCommitting && !isVerifying,
        canCancel: opState !== "IDLE" && !isCommitting && !isVerifying,
        gameId: ctx.gameId || null,
      })
    }
  }

  const onPhaseChange = (phase, underlyingPhase) => {
    if (activeOperationSnapshot) {
      if (phase === "PAUSED") {
        const effectivePhase = underlyingPhase || activeOperationSnapshot.phase || "DOWNLOADING"
        activeOperationSnapshot.phase = effectivePhase
        resumeProgressFloor = {
          gameId: ctx.gameId || activeOperationGameId || null,
          targetPhase: effectivePhase,
          phase: effectivePhase,
          floor: typeof activeOperationSnapshot.progress === "number" ? activeOperationSnapshot.progress : 0,
          isResume: true,
        }
      } else if (isIntermediateResumeReplay(phase)) {
        activeOperationSnapshot.phase = resumeProgressFloor.targetPhase
        activeOperationSnapshot.progress = resumeProgressFloor.floor
        activeOperationSnapshot.speedMBs = 0
        activeOperationSnapshot.remainingMinutes = 0
        activeOperationSnapshot.isCommitting = Boolean(operationManager.isCommitting)
        savePersistentDownloadQueue()
        notifyDownloadQueueChanged()
        return
      } else {
        if (activeOperationSnapshot.phase !== phase) {
          activeOperationSnapshot.speedMBs = 0
          activeOperationSnapshot.remainingMinutes = 0
          if (resumeProgressFloor && (resumeProgressFloor.targetPhase || resumeProgressFloor.phase) !== phase) {
            resumeProgressFloor = null
          }
        }
        activeOperationSnapshot.phase = phase
      }
      activeOperationSnapshot.isCommitting = Boolean(operationManager.isCommitting)
    }
    if (phase === "IDLE") {
      const deferredKey = ctx.gameId || "__default__"
      if (deferredBackgroundShaChecks.has(deferredKey)) {
        const deferred = deferredBackgroundShaChecks.get(deferredKey)
        deferredBackgroundShaChecks.delete(deferredKey)
        loadInstalledManifest(deferred.targetInstanceRoot).then((fresh) => {
          if (fresh && fresh.modpackVersion) {
            scheduleBackgroundShaCheck(ctx.gameId, deferred.targetInstanceRoot, fresh)
          }
        }).catch(() => { })
      }
      resumeProgressFloor = null
      if (activeOperationGameId === ctx.gameId) {
        activeOperationGameId = null
        activeOperationGameName = null
        activeOperationPayload = null
        activeOperationSnapshot = null
        savePersistentDownloadQueue()
      }
      notifyDownloadQueueChanged()
    } else {
      savePersistentDownloadQueue()
      notifyDownloadQueueChanged()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-phase-changed", phase, ctx.gameId || null, underlyingPhase || null)
    }
  }

  try {
    const result = await operationManager.startSync({
      instanceRoot: ctx.instanceRoot,
      javaStorageRoot: appDataRoot,
      clientFiles: payload.clientFiles,
      directoryPolicies: payload.directoryPolicies,
      modpackVersion: payload.modpackVersion,
      minecraftVersion: payload.minecraftVersion,
      modLoader: payload.modLoader,
      modLoaderVersion: payload.modLoaderVersion,
      neoForgeVersion: payload.neoForgeVersion,
      apiBaseUrl: payload.apiBaseUrl,
      isVerify: Boolean(payload.isVerify),
      onProgress,
      onPhaseChange,
    })
    if (result && result.success !== false && !result.cancelled) {
      clearGameIntegrityDirty(ctx.gameId)
    }
    if (operationManager.getState() === "IDLE") {
      resumeProgressFloor = null
      if (activeOperationGameId === ctx.gameId) {
        activeOperationGameId = null
        activeOperationGameName = null
        activeOperationPayload = null
        activeOperationSnapshot = null
        savePersistentDownloadQueue()
        notifyDownloadQueueChanged()
      }
      processNextQueuedSync()
    }
    setupInstanceWatcher(ctx.gameId, ctx.instanceRoot)
    return result
  } catch (err) {
    const isCancelled =
      err?.name === "AbortError" ||
      err?.message?.includes("aborted") ||
      err?.message?.includes("cancelled") ||
      Boolean(operationManager.activeCancelSignal?.isCancelled)
    resumeProgressFloor = null
    if (activeOperationGameId === ctx.gameId) {
      activeOperationGameId = null
      activeOperationGameName = null
      activeOperationPayload = null
      activeOperationSnapshot = null
      savePersistentDownloadQueue()
      notifyDownloadQueueChanged()
    }
    if (operationManager.getState() === "IDLE") {
      processNextQueuedSync()
    }
    if (isCancelled) {
      return { success: false, cancelled: true }
    }
    throw err
  }
}

ipcMain.handle("game-start-sync", async (_event, payload = {}) => {
  const ctx = resolveGameContext(payload)

  const isRestoredTarget = Boolean(
    isRestoredUserPause &&
    activeOperationGameId &&
    (!ctx.gameId || activeOperationGameId === ctx.gameId)
  )

  if (payload.resume || isRestoredTarget) {
    if (operationManager.getState() === "PAUSED") {
      if (activeOperationGameId && activeOperationGameId !== ctx.gameId) {
        throw new Error("Cannot resume sync for another game.")
      }
      autoPausedDownloadGameId = null
      pausedByUser = false
      isRestoredUserPause = false
      if (!resumeProgressFloor && activeOperationSnapshot) {
        const pausedPhase = activeOperationSnapshot.phase || operationManager.lastPausedPhase || "DOWNLOADING"
        resumeProgressFloor = {
          gameId: activeOperationGameId,
          targetPhase: pausedPhase,
          phase: pausedPhase,
          floor: typeof activeOperationSnapshot.progress === "number" ? activeOperationSnapshot.progress : 0,
          isResume: true,
        }
      } else if (resumeProgressFloor) {
        resumeProgressFloor.isResume = true
        if (!resumeProgressFloor.targetPhase) {
          resumeProgressFloor.targetPhase = resumeProgressFloor.phase || "DOWNLOADING"
        }
      }
      const res = await operationManager.resumeSync()
      if (operationManager.getState() === "IDLE") {
        resumeProgressFloor = null
        if (activeOperationGameId === ctx.gameId) {
          activeOperationGameId = null
          activeOperationGameName = null
          activeOperationPayload = null
          activeOperationSnapshot = null
          savePersistentDownloadQueue()
        }
        processNextQueuedSync()
      }
      notifyDownloadQueueChanged()
      return res
    }
    if (activeOperationGameId === ctx.gameId && !isRestoredTarget) {
      return { alreadyActive: true }
    }

    // Recovery path (e.g. after restart or recovering from idle):
    let savedPayload = null
    let savedPhase = null
    let savedProgress = 0

    if (isRestoredTarget) {
      savedPayload = activeOperationPayload
      savedPhase = activeOperationSnapshot?.phase || "DOWNLOADING"
      savedProgress = typeof activeOperationSnapshot?.progress === "number" ? activeOperationSnapshot.progress : 0
      isRestoredUserPause = false
      pausedByUser = false
    }

    if (ctx.gameId && lastPayloadByGameId.has(ctx.gameId)) {
      if (!savedPayload) savedPayload = lastPayloadByGameId.get(ctx.gameId)
    } else if (lastPayload && (!ctx.gameId || lastPayload.gameId === ctx.gameId)) {
      if (!savedPayload) savedPayload = lastPayload
    }

    const queueIndex = downloadQueue.findIndex((q) => !ctx.gameId || q.gameId === ctx.gameId)
    if (queueIndex !== -1) {
      if (!savedPayload && downloadQueue[queueIndex].payload) {
        savedPayload = downloadQueue[queueIndex].payload
      }
      if (downloadQueue[queueIndex].savedPhase) {
        savedPhase = downloadQueue[queueIndex].savedPhase
        savedProgress = downloadQueue[queueIndex].savedProgress || 0
      }
      downloadQueue.splice(queueIndex, 1)
      savePersistentDownloadQueue()
      notifyDownloadQueueChanged()
    }

    if (!savedPayload) {
      try {
        const queueFile = getQueueFilePath()
        if (fs.existsSync(queueFile)) {
          const raw = fs.readFileSync(queueFile, "utf8")
          const parsed = JSON.parse(raw)
          if (parsed?.active?.payload && (!ctx.gameId || parsed.active.gameId === ctx.gameId)) {
            savedPayload = parsed.active.payload
            savedPhase = parsed.active.phase || null
            savedProgress = typeof parsed.active.progress === "number" ? parsed.active.progress : 0
          } else if (Array.isArray(parsed?.queue)) {
            const match = parsed.queue.find((item) => !ctx.gameId || item.gameId === ctx.gameId)
            if (match?.payload) {
              savedPayload = match.payload
            }
          }
        }
      } catch (_) { }
    }

    if (!savedPayload && payload.clientFiles && payload.modpackVersion) {
      savedPayload = payload
    }

    if (!savedPayload) {
      throw new Error("No previous operation payload found to resume.")
    }

    if (savedPhase && savedProgress > 0 && !resumeProgressFloor) {
      resumeProgressFloor = {
        gameId: ctx.gameId,
        targetPhase: savedPhase,
        phase: savedPhase,
        floor: savedProgress,
        isResume: true,
      }
    } else if (resumeProgressFloor) {
      resumeProgressFloor.isResume = true
      if (!resumeProgressFloor.targetPhase) {
        resumeProgressFloor.targetPhase = resumeProgressFloor.phase || savedPhase || "DOWNLOADING"
      }
    }

    const effectivePayload = mergePersistedPayload(savedPayload, payload)
    effectivePayload.resume = true
    const effectiveCtx = resolveGameContext(effectivePayload)
    return await runGameSync(effectiveCtx, effectivePayload)
  }

  const pauseOnLaunch = settingsStore.get("pauseDownloadsOnGameLaunch") !== false
  const launchStatus = gameLauncher.getLaunchStatus()
  const isMinecraftActive = launchStatus.status !== "idle"
  const runningGameId = launchStatus.gameId || null
  const isSameGameRunning = Boolean(isMinecraftActive && ctx.gameId && runningGameId && ctx.gameId === runningGameId)
  const shouldBlockDueToGameLaunch = isMinecraftActive && (isSameGameRunning || pauseOnLaunch)

  if (isSameGameRunning && (payload.resume || isRestoredTarget)) {
    throw new Error("Cannot resume sync while game is running.")
  }

  if (payload.isVerify) {
    if (isSameGameRunning) {
      throw new Error("Cannot verify files while game is running.")
    }
    if (operationManager.getState() !== "IDLE" || isRestoredUserPause) {
      if (activeOperationGameId !== ctx.gameId) {
        throw new Error("Another game operation is already in progress.")
      }
    }
    return await runGameSync(ctx, payload)
  }

  if (activeOperationGameId === ctx.gameId && operationManager.getState() === "PAUSED") {
    autoPausedDownloadGameId = null
    pausedByUser = false
    isRestoredUserPause = false
    const res = await operationManager.resumeSync()
    if (operationManager.getState() === "IDLE") {
      if (activeOperationGameId === ctx.gameId) {
        activeOperationGameId = null
        activeOperationGameName = null
        activeOperationPayload = null
        activeOperationSnapshot = null
        savePersistentDownloadQueue()
      }
      processNextQueuedSync()
    }
    notifyDownloadQueueChanged()
    return res
  }

  const isTargetInRecovery = Boolean(
    (currentProcessingItem &&
      currentProcessingItem.gameId === ctx.gameId &&
      (currentProcessingItem.savedPhase || (typeof currentProcessingItem.savedProgress === "number" && currentProcessingItem.savedProgress > 0))) ||
    downloadQueue.some(
      (item) =>
        item &&
        item.gameId === ctx.gameId &&
        (item.savedPhase || (typeof item.savedProgress === "number" && item.savedProgress > 0))
    )
  )

  if (isTargetInRecovery) {
    return {
      alreadyActive: true,
    }
  }

  const hasAnyPendingRecovery = Boolean(
    (currentProcessingItem && (currentProcessingItem.savedPhase || (typeof currentProcessingItem.savedProgress === "number" && currentProcessingItem.savedProgress > 0))) ||
    downloadQueue.some((item) => item && (item.savedPhase || (typeof item.savedProgress === "number" && item.savedProgress > 0)))
  )

  if (
    operationManager.getState() === "IDLE" &&
    !isRestoredUserPause &&
    !hasAnyPendingRecovery &&
    downloadQueue.length === 0 &&
    !shouldBlockDueToGameLaunch
  ) {
    autoPausedDownloadGameId = null
    return await runGameSync(ctx, payload)
  }

  if (activeOperationGameId === ctx.gameId) {
    return {
      alreadyActive: true,
    }
  }

  // Requirement 7: If already queued, keep FIFO position but update payload
  const existingIndex = downloadQueue.findIndex((item) => item.gameId === ctx.gameId)
  if (existingIndex !== -1) {
    downloadQueue[existingIndex].payload = {
      ...downloadQueue[existingIndex].payload,
      ...payload,
    }
    if (ctx.gameName) {
      downloadQueue[existingIndex].gameName = ctx.gameName
    }
    savePersistentDownloadQueue()
    notifyDownloadQueueChanged()
    return {
      success: true,
      queued: true,
      position: existingIndex + 1,
    }
  }

  downloadQueue.push({
    gameId: ctx.gameId,
    gameName: ctx.gameName || payload.gameName || ctx.gameId,
    payload,
    queuedAt: Date.now(),
  })
  savePersistentDownloadQueue()
  notifyDownloadQueueChanged()

  return {
    success: true,
    queued: true,
    position: downloadQueue.length,
  }
})

ipcMain.handle("game-pause-sync", async (_event, payload = {}) => {
  const ctx = resolveGameContext(payload)

  if (ctx.gameId) {
    if (isRestoredUserPause && activeOperationGameId === ctx.gameId) {
      return { success: true, paused: true, state: "PAUSED" }
    }
    if (operationManager.getState() === "IDLE") {
      throw new Error("Cannot pause sync: operation manager is IDLE.")
    }
    if (activeOperationGameId !== ctx.gameId) {
      throw new Error("Cannot pause operation for another game.")
    }
    autoPausedDownloadGameId = null
    pausedByUser = true
    isRestoredUserPause = false
    if (activeOperationSnapshot) {
      const pausedPhase = activeOperationSnapshot.phase || "DOWNLOADING"
      resumeProgressFloor = {
        gameId: activeOperationGameId,
        targetPhase: pausedPhase,
        phase: pausedPhase,
        floor: typeof activeOperationSnapshot.progress === "number" ? activeOperationSnapshot.progress : 0,
        isResume: true,
      }
    }
    const res = await operationManager.pauseSync()
    savePersistentDownloadQueue()
    notifyDownloadQueueChanged()
    return res
  }

  if (activeOperationGameId !== null && !isRestoredUserPause) {
    throw new Error("Cannot pause scoped game operation from legacy request.")
  }
  autoPausedDownloadGameId = null
  pausedByUser = true
  isRestoredUserPause = false
  if (activeOperationSnapshot) {
    const pausedPhase = activeOperationSnapshot.phase || "DOWNLOADING"
    resumeProgressFloor = {
      gameId: null,
      targetPhase: pausedPhase,
      phase: pausedPhase,
      floor: typeof activeOperationSnapshot.progress === "number" ? activeOperationSnapshot.progress : 0,
      isResume: true,
    }
  }
  const res = await operationManager.pauseSync()
  savePersistentDownloadQueue()
  notifyDownloadQueueChanged()
  return res
})

ipcMain.handle("game-cancel-sync", async (_event, payload = {}) => {
  const ctx = resolveGameContext(payload)

  if (ctx.gameId) {
    const isCurrentProcessing = Boolean(currentProcessingItem && currentProcessingItem.gameId === ctx.gameId)
    if (isCurrentProcessing && operationManager.getState() === "IDLE") {
      const isRecoveryItem = Boolean(
        currentProcessingItem.savedPhase ||
        (typeof currentProcessingItem.savedProgress === "number" && currentProcessingItem.savedProgress > 0)
      )
      currentProcessingItem = null

      if (isRecoveryItem) {
        try {
          const manifest = await loadInstalledManifest(ctx.instanceRoot).catch(() => null)
          if (manifest && manifest.modpackVersion) {
            await cleanStaging(ctx.instanceRoot)
          } else {
            await cleanFreshInstall(ctx.instanceRoot)
          }
        } catch (_) { }
      }

      savePersistentDownloadQueue()
      notifyDownloadQueueChanged()
      processNextQueuedSync()
      return { success: true, queuedRemoved: true }
    }

    const queueIndex = downloadQueue.findIndex((item) => item.gameId === ctx.gameId)
    if (queueIndex !== -1) {
      const targetItem = downloadQueue[queueIndex]
      const isRecoveryItem = Boolean(
        targetItem && (targetItem.savedPhase || (typeof targetItem.savedProgress === "number" && targetItem.savedProgress > 0))
      )
      downloadQueue.splice(queueIndex, 1)

      if (isRecoveryItem) {
        try {
          const manifest = await loadInstalledManifest(ctx.instanceRoot).catch(() => null)
          if (manifest && manifest.modpackVersion) {
            await cleanStaging(ctx.instanceRoot)
          } else {
            await cleanFreshInstall(ctx.instanceRoot)
          }
        } catch (_) { }
      }

      if (currentProcessingItem && currentProcessingItem.gameId === ctx.gameId) {
        currentProcessingItem = null
      }

      savePersistentDownloadQueue()
      notifyDownloadQueueChanged()
      processNextQueuedSync()
      return { success: true, queuedRemoved: true }
    }
  }

  const isRestoredPause = Boolean(
    isRestoredUserPause &&
    (!ctx.gameId || activeOperationGameId === ctx.gameId)
  )

  if (ctx.gameId) {
    if (operationManager.getState() === "IDLE" && !isRestoredPause) {
      throw new Error("Cannot cancel sync: operation manager is IDLE.")
    }
    if (activeOperationGameId !== ctx.gameId) {
      throw new Error("Cannot cancel operation for another game.")
    }
    try {
      return await operationManager.cancelSync(ctx.instanceRoot)
    } finally {
      if (activeOperationGameId === ctx.gameId) {
        isRestoredUserPause = false
        pausedByUser = false
        activeOperationGameId = null
        activeOperationGameName = null
        activeOperationPayload = null
        activeOperationSnapshot = null
        autoPausedDownloadGameId = null
        resumeProgressFloor = null
        savePersistentDownloadQueue()
        notifyDownloadQueueChanged()
        processNextQueuedSync()
      }
    }
  }

  if (activeOperationGameId !== null && !isRestoredPause) {
    throw new Error("Cannot cancel scoped game operation from legacy request.")
  }
  if (operationManager.getState() === "IDLE" && !isRestoredPause) {
    throw new Error("Cannot cancel sync: operation manager is IDLE.")
  }
  try {
    return await operationManager.cancelSync(instanceRoot)
  } finally {
    if (activeOperationGameId === ctx.gameId || !activeOperationGameId) {
      isRestoredUserPause = false
      pausedByUser = false
      activeOperationGameId = null
      activeOperationGameName = null
      activeOperationPayload = null
      activeOperationSnapshot = null
      autoPausedDownloadGameId = null
      savePersistentDownloadQueue()
      notifyDownloadQueueChanged()
      processNextQueuedSync()
    }
  }
})

async function promoteQueuedSync(payload = {}) {
  if (isPromotingQueuedSync) {
    return { success: false, busy: true }
  }
  isPromotingQueuedSync = true
  try {
    const targetGameId = payload?.gameId || payload?.id
    if (!targetGameId) {
      throw new Error("Missing gameId to promote.")
    }

    // 1. Locate the target item in downloadQueue
    const targetIndex = downloadQueue.findIndex((item) => item.gameId === targetGameId)
    if (targetIndex === -1) {
      return { success: false, error: "Item not found in download queue." }
    }
    const targetItem = downloadQueue[targetIndex]
    const gameName = payload?.gameName || targetItem.gameName || targetGameId
    const ctx = resolveGameContext({ gameId: targetGameId, gameName })

    // 2. Safe Commit / Verifying gate: do not interrupt if active operation is verifying or committing
    const isCommitting = Boolean(operationManager.isCommitting)
    const isVerifying = Boolean(currentIsVerify || activeOperationSnapshot?.phase === "VERIFYING")
    const canPause = operationManager.canPause !== false && activeOperationSnapshot?.canPause !== false
    const opState = isRestoredUserPause && operationManager.getState() === "IDLE" ? "PAUSED" : operationManager.getState()

    if (activeOperationGameId && opState !== "PAUSED" && opState !== "IDLE") {
      if (isCommitting || isVerifying || !canPause) {
        return { success: false, error: "Cannot promote: active operation cannot be safely paused." }
      }
    }

    // 3. Pause active operation safely if it's currently running
    if (activeOperationGameId && opState !== "PAUSED" && opState !== "IDLE") {
      pausedByUser = true
      isRestoredUserPause = false
      if (activeOperationSnapshot) {
        const pausedPhase = activeOperationSnapshot.phase || "DOWNLOADING"
        resumeProgressFloor = {
          gameId: activeOperationGameId,
          targetPhase: pausedPhase,
          phase: pausedPhase,
          floor: typeof activeOperationSnapshot.progress === "number" ? activeOperationSnapshot.progress : 0,
          isResume: true,
        }
      }
      await operationManager.pauseSync()
    }

    // 4. Demote active operation (if present) into downloadQueue
    if (activeOperationGameId) {
      const demotedItem = {
        gameId: activeOperationGameId,
        gameName: activeOperationGameName || activeOperationGameId,
        payload: activeOperationPayload,
        queuedAt: activeOperationQueuedAt || Date.now(),
        savedPhase: activeOperationSnapshot?.phase || operationManager.lastPausedPhase || "DOWNLOADING",
        savedProgress: typeof activeOperationSnapshot?.progress === "number" ? activeOperationSnapshot.progress : 0,
        savedDownloadedBytes: activeOperationSnapshot?.downloadedBytes || 0,
        savedTotalBytes: activeOperationSnapshot?.totalBytes || 0,
      }

      // Remove promoted item from queue
      downloadQueue = downloadQueue.filter((item) => item.gameId !== targetItem.gameId)

      // Ensure demoted item is not duplicated in queue and add it to front of queue
      downloadQueue = downloadQueue.filter((item) => item.gameId !== demotedItem.gameId)
      downloadQueue.unshift(demotedItem)

      // Clear active state variables
      activeOperationGameId = null
      activeOperationGameName = null
      activeOperationPayload = null
      activeOperationSnapshot = null
      isRestoredUserPause = false
      pausedByUser = false
      resumeProgressFloor = null
      operationManager.lastPausedPhase = null
      operationManager.state = "IDLE"

      // Place promoted item at head of queue
      downloadQueue.unshift(targetItem)
    } else {
      // If no active operation, move target item to front of queue
      downloadQueue = downloadQueue.filter((item) => item.gameId !== targetItem.gameId)
      downloadQueue.unshift(targetItem)
    }

    savePersistentDownloadQueue()
    notifyDownloadQueueChanged()

    // Process the promoted item at the front of the queue
    processNextQueuedSync()

    return { success: true, promoted: true, gameId: ctx.gameId }
  } finally {
    isPromotingQueuedSync = false
  }
}

ipcMain.handle("game-promote-queued-sync", async (_event, payload = {}) => {
  return await promoteQueuedSync(payload)
})

const activeBackgroundShaChecks = new Map()
const deferredBackgroundShaChecks = new Map()

function isGameOperatingOrSyncing(gameId) {
  if (operationManager && operationManager.getState() !== "IDLE") {
    if (!gameId || activeOperationGameId === gameId || currentProcessingItem?.gameId === gameId) {
      return true
    }
  }
  return false
}

function scheduleBackgroundShaCheck(gameId, targetInstanceRoot, manifest) {
  const key = gameId || "__default__"
  if (isGameOperatingOrSyncing(gameId)) {
    deferredBackgroundShaChecks.set(key, { targetInstanceRoot, manifest })
    return
  }
  if (activeBackgroundShaChecks.has(key)) return

  const checkingVersion = manifest?.modpackVersion

  const checkPromise = (async () => {
    try {
      const result = await backgroundCheckProtectedSha(targetInstanceRoot, manifest)
      if (isGameOperatingOrSyncing(gameId)) {
        return { dirty: false }
      }
      const freshManifest = await loadInstalledManifest(targetInstanceRoot).catch(() => null)
      if (!freshManifest || freshManifest.modpackVersion !== checkingVersion) {
        return { dirty: false }
      }
      if (result && result.dirty) {
        markGameIntegrityDirty(gameId)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("game-file-integrity-changed", {
            path: result.path || "",
            gameId: gameId || null,
          })
        }
        return { dirty: true, path: result.path }
      }
      return { dirty: false }
    } catch (_) {
      return { dirty: false }
    } finally {
      activeBackgroundShaChecks.delete(key)
    }
  })()

  activeBackgroundShaChecks.set(key, {
    promise: checkPromise,
    modpackVersion: checkingVersion,
  })
}

ipcMain.handle("game-get-installed-state", async (_event, payload = {}) => {
  try {
    const ctx = resolveGameContext(payload)
    const manifest = await loadInstalledManifest(ctx.instanceRoot)
    let integrityDirty = isGameIntegrityDirty(ctx.gameId)
    if (manifest && manifest.modpackVersion) {
      setupInstanceWatcher(ctx.gameId, ctx.instanceRoot)
      const quickDirty = await quickCheckProtectedIntegrity(ctx.instanceRoot, manifest)
      if (quickDirty) {
        markGameIntegrityDirty(ctx.gameId)
        integrityDirty = true
      } else if (!integrityDirty) {
        scheduleBackgroundShaCheck(ctx.gameId, ctx.instanceRoot, manifest)
      }
    }
    return {
      installedModpackVersion: manifest?.modpackVersion || null,
      integrityDirty: Boolean(integrityDirty),
    }
  } catch (_) {
    return {
      installedModpackVersion: null,
      integrityDirty: isGameIntegrityDirty(payload?.gameId),
    }
  }
})

ipcMain.handle("game-uninstall", async (_event, payload = {}) => {
  const ctx = resolveGameContext(payload)
  const res = await operationManager.uninstallGame(ctx.instanceRoot, appDataRoot)
  if (res && res.success !== false) {
    clearGameIntegrityDirty(ctx.gameId)
  }
  return res
})

ipcMain.handle("game-launch", async (_event, options = {}) => {
  const ctx = resolveGameContext(options)

  const opState = operationManager.getState()
  const opPhase = activeOperationSnapshot?.phase
  const isSameOp = Boolean(
    (activeOperationGameId && activeOperationGameId === ctx.gameId) ||
    (!ctx.gameId && !activeOperationGameId)
  )
  const isOtherOp = Boolean(activeOperationGameId && activeOperationGameId !== ctx.gameId)

  if (isSameOp && opState !== "IDLE") {
    throw new Error("Cannot launch Minecraft while this game is updating or installing.")
  }

  if (isOtherOp) {
    if (opPhase === "VERIFYING" || opState === "VERIFYING") {
      throw new Error("Cannot launch Minecraft while another game is verifying.")
    }
  }

  const pauseOnLaunch = settingsStore.get("pauseDownloadsOnGameLaunch") !== false
  const isCommitting = Boolean(operationManager.isCommitting)
  const canPause = opState !== "PAUSED" && opState !== "IDLE" && !isCommitting && opPhase !== "VERIFYING" && opState !== "VERIFYING"

  if (isOtherOp && (opState === "SYNCING" || opState === "INSTALLING")) {
    if (pauseOnLaunch && canPause) {
      try {
        autoPausedDownloadGameId = activeOperationGameId
        if (activeOperationSnapshot) {
          const pausedPhase = activeOperationSnapshot.phase || (opState === "INSTALLING" ? "INSTALLING" : "DOWNLOADING")
          resumeProgressFloor = {
            gameId: activeOperationGameId,
            targetPhase: pausedPhase,
            phase: pausedPhase,
            floor: typeof activeOperationSnapshot.progress === "number" ? activeOperationSnapshot.progress : 0,
            isResume: true,
          }
        }
        await operationManager.pauseSync()
        notifyDownloadQueueChanged()
      } catch (pauseErr) {
        console.warn("[Main] Best-effort auto-pause before launch failed:", pauseErr)
        autoPausedDownloadGameId = null
      }
    }
  }

  let effectiveRamGB = options.ramGB
  let effectiveDedicatedGpu = dedicatedGpuEnabled

  if (ctx.gameId) {
    effectiveRamGB = settingsStore.getGameSetting(ctx.gameId, "ramGB", { gameName: ctx.gameName })
    effectiveDedicatedGpu = settingsStore.getGameSetting(ctx.gameId, "dedicatedGpu", { gameName: ctx.gameName })
  } else {
    effectiveRamGB = options.ramGB || settingsStore.get("ramGB") || 4
    effectiveDedicatedGpu = settingsStore.get("dedicatedGpu")
  }

  const allowDuringOperation = Boolean(
    isOtherOp &&
    opPhase !== "VERIFYING" &&
    opState !== "VERIFYING"
  )

  const shaCheckKey = ctx.gameId || "__default__"
  const pendingShaCheck = activeBackgroundShaChecks.get(shaCheckKey)
  if (pendingShaCheck && pendingShaCheck.promise) {
    const checkRes = await pendingShaCheck.promise.catch(() => ({ dirty: false }))
    if (checkRes && checkRes.dirty) {
      markGameIntegrityDirty(ctx.gameId)
      throw new Error("Integrity check failed. Please verify game files.")
    }
  }

  if (isGameIntegrityDirty(ctx.gameId)) {
    throw new Error("Integrity check failed. Please verify game files.")
  }

  return await operationManager.launchGame(gameLauncher, {
    gameId: ctx.gameId,
    gameName: ctx.gameName || options.gameName || null,
    instanceRoot: ctx.instanceRoot,
    playerName: options.playerName || "Player",
    ramGB: effectiveRamGB,
    minecraftVersion: options.minecraftVersion,
    modLoader: options.modLoader,
    modLoaderVersion: options.modLoaderVersion,
    neoForgeVersion: options.neoForgeVersion,
    dedicatedGpu: effectiveDedicatedGpu,
    customJavaPath: options.customJavaPath,
    customArgs: options.customArgs || [],
    allowDuringOperation,
  })
})

ipcMain.handle("game-write-token", async (_event, options = {}) => {
  const token = typeof options.token === "string" ? options.token.trim() : ""
  if (!token) return { success: false, error: "Missing token" }

  const ctx = resolveGameContext(options)
  const metaDir = path.join(ctx.instanceRoot, ".hikat")
  try {
    if (!fs.existsSync(metaDir)) {
      fs.mkdirSync(metaDir, { recursive: true })
    }
    const targetFile = path.join(metaDir, "game-token.json")
    const tempFile = path.join(
      metaDir,
      `game-token.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`
    )
    fs.writeFileSync(tempFile, JSON.stringify({ token, updatedAt: new Date().toISOString() }), "utf8")
    try {
      fs.renameSync(tempFile, targetFile)
    } catch (_) {
      if (fs.existsSync(targetFile)) {
        fs.unlinkSync(targetFile)
      }
      fs.renameSync(tempFile, targetFile)
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle("game-get-status", async (_event, payload = {}) => {
  const launchStatus = gameLauncher.getLaunchStatus()
  const runningGameId = launchStatus.gameId || null

  const isRestoredPause = Boolean(isRestoredUserPause && operationManager.getState() === "IDLE")
  const pendingRecovery = !activeOperationGameId && operationManager.getState() === "IDLE"
    ? ((currentProcessingItem && (currentProcessingItem.savedPhase || currentProcessingItem.savedProgress))
      ? currentProcessingItem
      : downloadQueue.find((item) => item && (item.savedPhase || (typeof item.savedProgress === "number" && item.savedProgress > 0))))
    : null

  const effectiveActiveGameId = activeOperationGameId || pendingRecovery?.gameId || null
  const currentOpState = isRestoredPause
    ? "PAUSED"
    : (pendingRecovery ? "SYNCING" : operationManager.getState())

  const effectiveSnapshot = activeOperationSnapshot || (pendingRecovery ? {
    gameId: pendingRecovery.gameId,
    phase: pendingRecovery.savedPhase || "DOWNLOADING",
    progress: pendingRecovery.savedProgress || 0,
    downloadedBytes: pendingRecovery.savedDownloadedBytes || 0,
    totalBytes: pendingRecovery.savedTotalBytes || 0,
    speedMBs: 0,
    remainingMinutes: 0,
  } : null)

  if (payload && payload.gameId) {
    const requestedGameId = payload.gameId
    const isThisGameRunning = launchStatus.status !== "idle" && runningGameId === requestedGameId
    const status = isThisGameRunning ? launchStatus.status : "idle"
    const pid = isThisGameRunning ? launchStatus.pid : null
    const operationState = effectiveActiveGameId === requestedGameId ? currentOpState : "IDLE"
    const operationSnapshot = effectiveActiveGameId === requestedGameId ? effectiveSnapshot : null

    return {
      status,
      pid,
      gameId: requestedGameId,
      gameName: isThisGameRunning ? (launchStatus.gameName || null) : null,
      runningGameId,
      operationState,
      activeOperationGameId: effectiveActiveGameId,
      activeOperationState: currentOpState,
      activeOperationPhase: effectiveSnapshot?.phase || null,
      operationSnapshot,
    }
  }

  return {
    ...launchStatus,
    runningGameId,
    operationState: currentOpState,
    activeOperationGameId: effectiveActiveGameId,
    activeOperationState: currentOpState,
    activeOperationPhase: effectiveSnapshot?.phase || null,
    operationSnapshot: effectiveSnapshot,
  }
})

ipcMain.handle("game-get-download-queue", async () => {
  return getDownloadQueueSnapshot()
})

ipcMain.handle("game-get-runtime-info", async (_event, payload = {}) => {
  try {
    const ctx = resolveGameContext(payload)
    const state = await loadCoreState(ctx.instanceRoot)
    if (state && typeof state.javaMajorVersion === "number") {
      return { javaMajorVersion: state.javaMajorVersion }
    }
  } catch (_) { }
  return { javaMajorVersion: null }
})

app.whenReady().then(() => {
  startOAuthLoopbackServer()
  setupInstanceWatcher()

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

  savePersistentDownloadQueue()

  if (oauthLoopbackServer) {
    oauthLoopbackServer.close()
    oauthLoopbackServer = null
  }
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

function resetDownloadQueueForTesting() {
  downloadQueue = []
  activeOperationGameId = null
  activeOperationGameName = null
  activeOperationPayload = null
  activeOperationQueuedAt = null
  activeOperationSnapshot = null
  autoPausedDownloadGameId = null
  pausedByUser = false
  isRestoredUserPause = false
  currentProcessingItem = null
  isProcessingQueue = false
  currentIsVerify = false
  lastPayload = null
  lastPayloadByGameId.clear()
  resumeProgressFloor = null
  lastPersistentQueueSaveTime = 0
  lastPersistentQueueSaveProgress = -1
  lastPersistentQueueSavePhase = null
  for (const [, w] of instanceWatchers) {
    try {
      w?.close()
    } catch (_) { }
  }
  instanceWatchers.clear()
  dirtyGameIds.clear()
  if (gameLauncher) {
    gameLauncher.runningGameId = null
    gameLauncher.setStatus("idle")
  }
  if (operationManager) {
    if (operationManager.activeCancelSignal) {
      operationManager.activeCancelSignal.isCancelled = true
    }
    if (operationManager.activeAbortController) {
      operationManager.activeAbortController.abort()
    }
    operationManager.state = "IDLE"
    operationManager.isCommitting = false
    operationManager.lastPausedPhase = null
    operationManager.lastPayload = null
    operationManager.activeSyncPromise = null
    operationManager.activeCancelSignal = null
    operationManager.activeAbortController = null
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    resolveGameContext,
    validateGameName,
    gameLauncher,
    operationManager,
    settingsStore,
    getDownloadQueueSnapshot,
    resetDownloadQueueForTesting,
    savePersistentDownloadQueue,
    savePersistentDownloadQueueThrottled,
    loadPersistentDownloadQueue,
    processNextQueuedSync,
    runGameSync,
    getGamesRoot,
    getLegacyInstanceRoot,
    getResumeProgressFloor: () => resumeProgressFloor,
    getDownloadQueue: () => downloadQueue,
    isRestoredUserPauseForTesting: () => isRestoredUserPause,
    isPausedByUserForTesting: () => pausedByUser,
    setMainWindowForTesting: (win) => {
      mainWindow = win
    },
    scheduleBackgroundShaCheck,
    activeBackgroundShaChecks,
    deferredBackgroundShaChecks,
    setCurrentProcessingItemForTesting: (item) => {
      currentProcessingItem = item
    },
    getCurrentProcessingItemForTesting: () => currentProcessingItem,
    setActiveOperationGameIdForTesting: (id) => {
      activeOperationGameId = id
    },
    getActiveOperationGameIdForTesting: () => activeOperationGameId,
    markGameIntegrityDirty,
    isGameIntegrityDirty,
    clearGameIntegrityDirty,
    promoteQueuedSync,
    isPromotingQueuedSyncForTesting: () => isPromotingQueuedSync,
    resetPromotingQueuedSyncForTesting: () => {
      isPromotingQueuedSync = false
    },
    setActiveOperationSnapshotForTesting: (snap) => {
      activeOperationSnapshot = snap
    },
    getActiveOperationSnapshotForTesting: () => activeOperationSnapshot,
    setActiveOperationPayloadForTesting: (p) => {
      activeOperationPayload = p
    },
  }
}
