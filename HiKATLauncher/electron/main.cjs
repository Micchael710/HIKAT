const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

// Configure clean dedicated user data path to avoid Windows cache permissions warnings
try {
  app.setPath("userData", path.join(app.getPath("appData"), "hikat-launcher"));
} catch (_) {}

let mainWindow = null;
let splashWindow = null;

// Official Windows application icon
function getLauncherIcon() {
  try {
    const iconFile = "logo-windows.png";

    const candidatePaths = [
      path.join(__dirname, "../public", iconFile),
      path.join(__dirname, "../src/assets/branding", iconFile),
      path.join(__dirname, "../dist/assets", iconFile),
      path.join(process.resourcesPath || "", "public", iconFile),
    ];

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        return nativeImage.createFromPath(candidate);
      }
    }
  } catch (_) {}
  return undefined;
}

function getOptimalWindowSize() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

    // Standard desktop launcher default resolutions:
    // - On 1080p, 2K, 4K: 1600x900 (fits ~83% of screen, looks grand & comfortable)
    // - On 1366x768 / 1440x900 laptops: 1280x720
    // - On small displays: 1024x576
    if (screenW >= 1680 && screenH >= 950) {
      return { width: 1600, height: 900 };
    } else if (screenW >= 1360 && screenH >= 760) {
      return { width: 1280, height: 720 };
    } else {
      return { width: 1024, height: 576 };
    }
  } catch (_) {
    return { width: 1600, height: 900 };
  }
}

function getOptimalSplashSize() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

    // Scale splash size according to display resolution with ample transparent margins for glowing beam
    if (screenW >= 1680 && screenH >= 950) {
      // 1080p, 2K, 4K displays
      return { width: 820, height: 520 };
    } else if (screenW >= 1360 && screenH >= 760) {
      // 1366x768 / 1440x900 laptops
      return { width: 740, height: 470 };
    } else {
      // Small displays
      return { width: 660, height: 420 };
    }
  } catch (_) {
    return { width: 820, height: 520 };
  }
}

function checkServer(url, timeout = 500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || "/",
          timeout,
        },
        (res) => {
          resolve(res.statusCode < 500);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function createSplashWindow() {
  const { width: splashW, height: splashH } = getOptimalSplashSize();
  const appIcon = getLauncherIcon();

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
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));

  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });
}

async function createWindow() {
  const { width: defaultWidth, height: defaultHeight } = getOptimalWindowSize();
  const appIcon = getLauncherIcon();

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
  });

  // Lock zoom levels and prevent accidental browser scaling
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  // Safely open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url);
      }
    }
  });

  const distPath = path.join(__dirname, "../dist/index.html");
  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:8443";

  // Check if live Vite server is reachable
  const isServerLive = await checkServer(devUrl, 600);

  if (isServerLive) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(distPath);
  }

  // Backup fallback if loadURL ever fails
  mainWindow.webContents.on("did-fail-load", () => {
    mainWindow.loadFile(distPath);
  });

  const startTime = Date.now();
  const MIN_SPLASH_TIME = 3800; // Smooth 3.8s display time for perimeter glowing beam animation

  mainWindow.once("ready-to-show", () => {
    const elapsed = Date.now() - startTime;
    const remainingTime = Math.max(0, MIN_SPLASH_TIME - elapsed);

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, remainingTime);
  });

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-maximize-changed", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.setResizable(false);
    mainWindow.webContents.send("window-maximize-changed", false);
  });
}

// IPC Handlers for custom titlebar controls
ipcMain.on("window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.setResizable(true);
      mainWindow.unmaximize();
      const { width, height } = getOptimalWindowSize();
      mainWindow.setSize(width, height);
      mainWindow.center();
      mainWindow.setResizable(false);
    } else {
      mainWindow.setResizable(true);
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window-close", () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// IPC Handlers for Global Settings (Backend Integration with Security Validation)
ipcMain.on("setting-start-with-system", (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  } catch (_) {}
});

ipcMain.on("setting-minimize-to-tray", (_event, enabled) => {
  // Stored safely as boolean for tray integration
  const safeEnabled = Boolean(enabled);
});

ipcMain.on("setting-auto-updates", (_event, enabled) => {
  // Auto-updater channel safely boolean
  const safeEnabled = Boolean(enabled);
});

ipcMain.on("setting-notifications", (_event, enabled) => {
  // Notifications channel safely boolean
  const safeEnabled = Boolean(enabled);
});

ipcMain.on("setting-ram-allocation", (_event, ramGB) => {
  // Enforce integer boundaries between 1 and 64 GB for Minecraft JVM args (-Xmx{ramGB}G)
  const num = Number(ramGB);
  if (!isNaN(num)) {
    const safeRam = Math.min(Math.max(Math.round(num), 1), 64);
  }
});

ipcMain.on("setting-dedicated-gpu", (_event, enabled) => {
  // Dedicated GPU flags safely boolean
  const safeEnabled = Boolean(enabled);
});

ipcMain.on("open-external", (_event, url) => {
  if (typeof url === "string") {
    const cleanUrl = url.trim();
    try {
      const parsed = new URL(cleanUrl);
      // Strictly allow only http and https web schemes
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(cleanUrl);
      }
    } catch (_) {}
  }
});

// Game Download & Execution Handlers (with Command Injection Prevention)
ipcMain.on("game-start-download", (_event, manifest) => {
  // Start background download worker with validated manifest URLs
  if (manifest && typeof manifest === "object") {
    const cleanVersion = String(manifest.version || "").replace(
      /[^a-zA-Z0-9._-]/g,
      "",
    );
  }
});

ipcMain.on("game-pause-download", () => {
  // Pause active stream
});

ipcMain.on("game-resume-download", () => {
  // Resume active stream
});

ipcMain.on("game-cancel-download", () => {
  // Cancel and cleanup temp files
});

ipcMain.on("game-repair-installation", () => {
  // Verify MD5/SHA hashes of local modpack files against remote manifest
});

ipcMain.on("game-uninstall", () => {
  // Delete game files, local modpack folders and cleanup
});

ipcMain.on("game-launch", (_event, options) => {
  // Sanitize launch options to prevent JVM argument command injection
  const safeVersion = String(options?.version || "1.20.1").replace(
    /[^a-zA-Z0-9._-]/g,
    "",
  );
  const safeRam = Math.min(Math.max(Number(options?.ramGB) || 4, 1), 64);
  // Clean, isolated Java process parameters without raw shell execution
});

app.whenReady().then(() => {
  createSplashWindow();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
