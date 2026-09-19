const path = require("path")
const os = require("os")

/**
 * HiKAT Canonical Installation & Data Paths Resolver
 * Single source of truth for all local filesystem roots across production and development.
 */

function getElectronApp() {
  try {
    const electron = require("electron")
    if (electron && typeof electron === "object" && electron.app) {
      return electron.app
    }
    return null
  } catch (_) {
    return null
  }
}

function isPackagedApp() {
  const app = getElectronApp()
  if (app && typeof app.isPackaged === "boolean") {
    return app.isPackaged
  }
  const exeBase = path.basename(process.execPath).toLowerCase()
  if (exeBase.includes("hikat") && !exeBase.includes("node") && !exeBase.includes("electron")) {
    return true
  }
  return false
}

/**
 * Resolves the root of the HiKAT installation (<BASE>/HiKAT).
 * In production, derived from the executable location (<BASE>/HiKAT/Launcher/HiKAT Launcher.exe -> <BASE>/HiKAT).
 * In development, falls back to process.env.HIKAT_ROOT or canonical %APPDATA%/HiKAT.
 */
function getHiKatRoot() {
  if (isPackagedApp()) {
    const exeDir = path.dirname(process.execPath)
    if (path.basename(exeDir).toLowerCase() === "launcher") {
      return path.dirname(exeDir)
    }
    return exeDir
  }

  if (process.env.HIKAT_ROOT && process.env.HIKAT_ROOT.trim()) {
    return path.resolve(process.env.HIKAT_ROOT.trim())
  }

  const app = getElectronApp()
  if (app && typeof app.getPath === "function") {
    try {
      return path.join(app.getPath("appData"), "HiKAT")
    } catch (_) {}
  }

  const appData = process.env.APPDATA || (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : path.join(os.homedir(), ".config"))
  return path.join(appData, "HiKAT")
}

/**
 * Resolves the application binary directory (<HiKAT root>/Launcher).
 */
function getLauncherRoot() {
  if (isPackagedApp()) {
    return path.dirname(process.execPath)
  }
  return path.join(getHiKatRoot(), "Launcher")
}

/**
 * Resolves the directory for isolated game server instances (<HiKAT root>/games).
 */
function getGamesRoot() {
  return path.join(getHiKatRoot(), "games")
}

/**
 * Resolves the shared runtime directory (<HiKAT root>/runtime).
 */
function getRuntimeRoot() {
  return path.join(getHiKatRoot(), "runtime")
}

/**
 * Resolves the private state directory for user configuration, authentication,
 * and download session metadata. Stays strictly inside %APPDATA%/HiKAT/launcher.
 */
function getUserDataRoot() {
  const app = getElectronApp()
  if (app && typeof app.getPath === "function") {
    try {
      return path.join(app.getPath("appData"), "HiKAT", "launcher")
    } catch (_) {}
  }

  const appData = process.env.APPDATA || (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : path.join(os.homedir(), ".config"))
  return path.join(appData, "HiKAT", "launcher")
}

/**
 * Legacy instance root fallback for contexts without gameId/gameName.
 */
function getLegacyInstanceRoot() {
  return path.join(getHiKatRoot(), "game files")
}

const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

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

module.exports = {
  getHiKatRoot,
  getLauncherRoot,
  getGamesRoot,
  getRuntimeRoot,
  getUserDataRoot,
  getLegacyInstanceRoot,
  validateGameName,
  resolveGameContext,
}
