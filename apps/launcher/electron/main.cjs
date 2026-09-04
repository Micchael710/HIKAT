const { app, BrowserWindow, ipcMain, screen, nativeImage, shell, Tray, Menu } = require("electron")
const path = require("path")
const http = require("http")
const fs = require("fs")
const os = require("os")
const { GameLauncher } = require("./game-launcher.cjs")
const { GameOperationManager } = require("./game-operation-manager.cjs")
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
} = require("./client-files-sync.cjs")

const instanceRoot = path.join(appDataRoot, "game files")
const gameLauncher = new GameLauncher(app, { instanceRoot })
const operationManager = new GameOperationManager()
const settingsStore = new SettingsStore(app.getPath("userData"))
const authStore = new SecureAuthStore(app.getPath("userData"))

let mainWindow = null
let splashWindow = null
let instanceWatcher = null
let latestDirectoryPolicies = []

function setupInstanceWatcher() {
  if (instanceWatcher) return
  if (!fs.existsSync(instanceRoot)) return

  try {
    instanceWatcher = fs.watch(instanceRoot, { recursive: true }, async (_eventType, filename) => {
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

        // If currently syncing/downloading, ignore watcher
        if (operationManager && operationManager.getState() !== "IDLE") {
          return
        }

        const installedManifest = await loadInstalledManifest(instanceRoot)
        if (!installedManifest || !installedManifest.modpackVersion) return

        const decision = resolveWatcherDecision(
          relPath,
          latestDirectoryPolicies,
          installedManifest.files || {},
          instanceRoot,
        )

        if (decision === "EMIT") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("game-file-integrity-changed", { path: relPath })
          }
        }
      } catch (_) {}
    })

    instanceWatcher.on("error", () => {
      try {
        instanceWatcher?.close()
      } catch (_) {}
      instanceWatcher = null
    })
  } catch (err) {
    console.error("[Main] Failed to setup instance watcher:", err)
    instanceWatcher = null
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
      hiddenByGameLaunch = false
      focusMainWindow()
      if (!minimizeToTrayEnabled) {
        destroyTray()
      }
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("game-launch-status", status, details)
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
const completedOAuthStates = new Set()

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

  try {
    const parsed = new URL(validUrl)
    const state = parsed.searchParams.get("state")
    const code = parsed.searchParams.get("code")

    if (state && code) {
      completedOAuthStates.add(state)

      setTimeout(() => {
        completedOAuthStates.delete(state)
      }, 60_000)
    }
  } catch (_) { }

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

      const completed = Boolean(
        state &&
        completedOAuthStates.has(state),
      )

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      })

      res.end(
        JSON.stringify({
          completed,
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

    // Idioma preferido del navegador
    const acceptLanguage = String(
      req.headers["accept-language"] || "",
    ).toLowerCase()

    const language =
      acceptLanguage.startsWith("es")
        ? "es"
        : acceptLanguage.startsWith("pt")
          ? "pt"
          : acceptLanguage.startsWith("fr")
            ? "fr"
            : "en"

    const translations = {
      es: {
        waitingStatus: "Cuenta autenticada",
        waitingTitle: "Continuando en HiKAT Launcher",
        waitingDescription:
          "Estamos redirigiéndote al Launcher. Tu navegador te pedirá permiso para abrir HiKAT.",
        waitingSecondary:
          "Confirma el aviso del navegador para continuar.",

        successStatus: "Inicio de sesión completado",
        successTitle: "Todo listo",
        successDescription:
          "HiKAT Launcher se abrió correctamente. Ya puedes continuar desde la aplicación.",
        successSecondary:
          "Puedes cerrar esta pestaña de forma segura.",

        openErrorStatus: "No se pudo abrir el Launcher",
        openErrorTitle: "Algo salió mal",
        openErrorDescription:
          "HiKAT Launcher no respondió. Es posible que hayas cancelado el aviso del navegador.",
        openErrorSecondary:
          "Puedes volver a intentarlo.",
        retry: "Reintentar",

        providerErrorStatus: "Inicio de sesión cancelado",
        providerErrorTitle: "No se completó el acceso",
        providerErrorDescription:
          "El inicio de sesión con tu cuenta externa fue cancelado o no pudo completarse.",
        providerErrorSecondary:
          "Vuelve a HiKAT Launcher e inténtalo nuevamente.",
      },

      en: {
        waitingStatus: "Account authenticated",
        waitingTitle: "Continuing to HiKAT Launcher",
        waitingDescription:
          "We're redirecting you to the Launcher. Your browser will ask for permission to open HiKAT.",
        waitingSecondary:
          "Confirm the browser prompt to continue.",

        successStatus: "Sign-in complete",
        successTitle: "You're all set",
        successDescription:
          "HiKAT Launcher opened successfully. You can continue from the application.",
        successSecondary:
          "You can safely close this tab.",

        openErrorStatus: "Launcher could not be opened",
        openErrorTitle: "Something went wrong",
        openErrorDescription:
          "HiKAT Launcher did not respond. You may have cancelled the browser prompt.",
        openErrorSecondary:
          "You can try again.",
        retry: "Try again",

        providerErrorStatus: "Sign-in cancelled",
        providerErrorTitle: "Sign-in was not completed",
        providerErrorDescription:
          "Sign-in with your external account was cancelled or could not be completed.",
        providerErrorSecondary:
          "Return to HiKAT Launcher and try again.",
      },

      pt: {
        waitingStatus: "Conta autenticada",
        waitingTitle: "Continuando no HiKAT Launcher",
        waitingDescription:
          "Estamos redirecionando você para o Launcher. Seu navegador pedirá permissão para abrir o HiKAT.",
        waitingSecondary:
          "Confirme o aviso do navegador para continuar.",

        successStatus: "Login concluído",
        successTitle: "Tudo pronto",
        successDescription:
          "O HiKAT Launcher foi aberto corretamente. Agora você pode continuar pelo aplicativo.",
        successSecondary:
          "Você pode fechar esta aba com segurança.",

        openErrorStatus: "Não foi possível abrir o Launcher",
        openErrorTitle: "Algo deu errado",
        openErrorDescription:
          "O HiKAT Launcher não respondeu. Talvez você tenha cancelado o aviso do navegador.",
        openErrorSecondary:
          "Você pode tentar novamente.",
        retry: "Tentar novamente",

        providerErrorStatus: "Login cancelado",
        providerErrorTitle: "Não foi possível concluir o login",
        providerErrorDescription:
          "O login com sua conta externa foi cancelado ou não pôde ser concluído.",
        providerErrorSecondary:
          "Volte ao HiKAT Launcher e tente novamente.",
      },

      fr: {
        waitingStatus: "Compte authentifié",
        waitingTitle: "Redirection vers HiKAT Launcher",
        waitingDescription:
          "Nous vous redirigeons vers le Launcher. Votre navigateur vous demandera l’autorisation d’ouvrir HiKAT.",
        waitingSecondary:
          "Confirmez l’invite du navigateur pour continuer.",

        successStatus: "Connexion terminée",
        successTitle: "Tout est prêt",
        successDescription:
          "HiKAT Launcher s’est ouvert correctement. Vous pouvez maintenant continuer dans l’application.",
        successSecondary:
          "Vous pouvez fermer cet onglet en toute sécurité.",

        openErrorStatus: "Impossible d’ouvrir le Launcher",
        openErrorTitle: "Un problème est survenu",
        openErrorDescription:
          "HiKAT Launcher n’a pas répondu. Vous avez peut-être annulé l’invite du navigateur.",
        openErrorSecondary:
          "Vous pouvez réessayer.",
        retry: "Réessayer",

        providerErrorStatus: "Connexion annulée",
        providerErrorTitle: "La connexion n’a pas été terminée",
        providerErrorDescription:
          "La connexion avec votre compte externe a été annulée ou n’a pas pu être terminée.",
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

              font-family:
                Inter,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
            }

            body {
              min-height: 100vh;

              background:
                linear-gradient(
                  rgba(5, 8, 12, 0.72),
                  rgba(5, 8, 12, 0.90)
                ),
                url("/auth/background.png")
                center / cover no-repeat,
                #090d12;

              color: #ffffff;
            }

            .page {
              min-height: 100vh;

              display: flex;
              flex-direction: column;

              padding: 34px 42px;
            }

            .brand {
              min-height: 64px;

              display: flex;
              align-items: center;
            }

            .brand img {
              max-width: 180px;
              max-height: 58px;

              object-fit: contain;
              object-position: left center;
            }

            .content {
              flex: 1;

              display: flex;
              align-items: center;
              justify-content: center;
            }

            .card {
              width: min(
                480px,
                calc(100vw - 48px)
              );

              padding: 42px 40px;

              background:
                rgba(12, 18, 26, 0.96);

              border:
                1px solid
                rgba(255, 255, 255, 0.09);

              border-radius: 18px;

              box-shadow:
                0 32px 90px
                rgba(0, 0, 0, 0.48);

              text-align: center;
            }

            .status {
              margin-bottom: 20px;

              color: #efc436;

              font-size: 13px;
              font-weight: 700;
            }

            h1 {
              margin: 0 0 16px;

              font-size: 30px;
              line-height: 1.15;

              font-weight: 800;

              letter-spacing: -0.025em;
            }

            .description {
              margin: 0;

              color: #aab5c2;

              font-size: 16px;
              line-height: 1.65;
            }

            .secondary {
              margin: 18px 0 0;

              color: #718090;

              font-size: 13px;
              line-height: 1.5;
            }

            .loader {
              width: 30px;
              height: 30px;

              margin: 28px auto 0;

              border:
                3px solid
                rgba(255, 255, 255, 0.10);

              border-top-color: #efc436;

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

              margin-top: 26px;
              padding: 13px 18px;

              border: 0;
              border-radius: 10px;

              background: #efc436;
              color: #10151c;

              font-size: 14px;
              font-weight: 800;

              cursor: pointer;
            }

            .retry:hover {
              filter: brightness(1.06);
            }

            .footer {
              color:
                rgba(255, 255, 255, 0.42);

              font-size: 11px;
            }
          </style>
        </head>

        <body>

          <div class="page">

            <header class="brand">
              <img
                src="/auth/logo.png"
                alt="HiKAT"
              >
            </header>

            <main class="content">

              <section class="card">

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

              </section>

            </main>

            <footer class="footer">
              HiKAT Launcher
            </footer>

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

            function showLauncherError() {
              if (completed) {
                return;
              }

              clearInterval(statusInterval);

              status.textContent =
                t.openErrorStatus;

              title.textContent =
                t.openErrorTitle;

              description.textContent =
                t.openErrorDescription;

              secondary.textContent =
                t.openErrorSecondary;

              loader.style.display =
                "none";

              retry.textContent =
                t.retry;

              retry.style.display =
                "block";
            }

            function showProviderError() {
              completed = true;

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

                if (result.completed) {
                  showCompletedState();
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

              // Chrome no informa directamente
              // si el usuario pulsó Cancel.
              // Si Electron no responde,
              // asumimos que no se abrió.
              launchTimeout =
                setTimeout(() => {
                  checkLauncherStatus()
                    .finally(() => {
                      if (!completed) {
                        showLauncherError();
                      }
                    });
                }, 10000);
            }

            retry.addEventListener(
              "click",
              () => {
                openLauncher();
              },
            );

            if (providerError) {
              showProviderError();
            } else {
              showWaitingState();

              setTimeout(() => {
                openLauncher();
              }, 150);
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

ipcMain.handle("get-dedicated-gpu", async () => {
  return settingsStore.get("dedicatedGpu")
})

ipcMain.handle("setting-dedicated-gpu", async (_event, enabled) => {
  const safeVal = Boolean(enabled)
  settingsStore.set("dedicatedGpu", safeVal)
  dedicatedGpuEnabled = safeVal
  return dedicatedGpuEnabled
})

ipcMain.on("setting-dedicated-gpu", (_event, enabled) => {
  const safeVal = Boolean(enabled)
  settingsStore.set("dedicatedGpu", safeVal)
  dedicatedGpuEnabled = safeVal
})

ipcMain.handle("get-ram-allocation", async () => {
  return settingsStore.get("ramGB")
})

ipcMain.handle("setting-ram-allocation", async (_event, ramGB) => {
  settingsStore.set("ramGB", ramGB)
  return settingsStore.get("ramGB")
})

ipcMain.on("setting-ram-allocation", (_event, ramGB) => {
  settingsStore.set("ramGB", ramGB)
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
  return authStore.getPendingOAuth(state)
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
    if (Array.isArray(payload.directoryPolicies)) {
      latestDirectoryPolicies = payload.directoryPolicies
    }
    setupInstanceWatcher()
    return await operationManager.checkPlan({
      instanceRoot,
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

ipcMain.handle("game-start-sync", async (_event, payload = {}) => {
  if (Array.isArray(payload.directoryPolicies)) {
    latestDirectoryPolicies = payload.directoryPolicies
  }
  const onProgress = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-download-progress", data)
    }
  }

  const onPhaseChange = (phase) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("game-phase-changed", phase)
    }
  }

  const result = await operationManager.startSync({
    instanceRoot,
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

  setupInstanceWatcher()
  return result
})

ipcMain.handle("game-pause-sync", async () => {
  return await operationManager.pauseSync()
})

ipcMain.handle("game-cancel-sync", async () => {
  return await operationManager.cancelSync(instanceRoot)
})

ipcMain.handle("game-uninstall", async () => {
  return await operationManager.uninstallGame(instanceRoot, appDataRoot)
})

ipcMain.handle("game-launch", async (_event, options = {}) => {
  return await operationManager.launchGame(gameLauncher, {
    playerName: options.playerName || "Player",
    ramGB: options.ramGB || 4,
    minecraftVersion: options.minecraftVersion,
    modLoader: options.modLoader,
    modLoaderVersion: options.modLoaderVersion,
    neoForgeVersion: options.neoForgeVersion,
    dedicatedGpu: dedicatedGpuEnabled,
    customJavaPath: options.customJavaPath,
    customArgs: options.customArgs || [],
  })
})

ipcMain.handle("game-get-status", async () => {
  return {
    ...gameLauncher.getLaunchStatus(),
    operationState: operationManager.getState(),
  }
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
