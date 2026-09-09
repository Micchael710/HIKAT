const fs = require("fs")
const path = require("path")

const DEFAULT_SETTINGS = {
  minimizeToTray: true,
  minimizeOnGameLaunch: true,
  dedicatedGpu: true,
  ramGB: 8,
  games: {},
}

class SettingsStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "launcher-settings.json")
    this.settings = { ...DEFAULT_SETTINGS, games: {} }
    this.load()
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8")
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.minimizeToTray === "boolean") {
            this.settings.minimizeToTray = parsed.minimizeToTray
          }
          if (typeof parsed.minimizeOnGameLaunch === "boolean") {
            this.settings.minimizeOnGameLaunch = parsed.minimizeOnGameLaunch
          }
          if (typeof parsed.dedicatedGpu === "boolean") {
            this.settings.dedicatedGpu = parsed.dedicatedGpu
          }
          if (
            typeof parsed.ramGB === "number" &&
            !isNaN(parsed.ramGB) &&
            parsed.ramGB >= 1 &&
            parsed.ramGB <= 64
          ) {
            this.settings.ramGB = Math.round(parsed.ramGB)
          }
          if (parsed.games && typeof parsed.games === "object" && !Array.isArray(parsed.games)) {
            this.settings.games = {}
            for (const [gid, gSettings] of Object.entries(parsed.games)) {
              if (gSettings && typeof gSettings === "object") {
                const entry = {}
                if (typeof gSettings.dedicatedGpu === "boolean") {
                  entry.dedicatedGpu = gSettings.dedicatedGpu
                } else {
                  entry.dedicatedGpu = true
                }
                if (
                  typeof gSettings.ramGB === "number" &&
                  !isNaN(gSettings.ramGB) &&
                  gSettings.ramGB >= 1 &&
                  gSettings.ramGB <= 64
                ) {
                  entry.ramGB = Math.round(gSettings.ramGB)
                } else {
                  entry.ramGB = 8
                }
                this.settings.games[gid] = entry
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[SettingsStore] Failed to read settings, using safe defaults:", err)
      this.settings = { ...DEFAULT_SETTINGS, games: {} }
    }
  }

  save() {
    try {
      const data = JSON.stringify(this.settings, null, 2)
      const tempPath = `${this.filePath}.tmp.${Date.now()}`
      fs.writeFileSync(tempPath, data, "utf-8")
      fs.renameSync(tempPath, this.filePath)
      return true
    } catch (err) {
      console.error("[SettingsStore] Failed to save settings atomically:", err)
      return false
    }
  }

  get(key) {
    return this.settings[key] !== undefined ? this.settings[key] : DEFAULT_SETTINGS[key]
  }

  set(key, value) {
    const previousValue = this.settings[key]

    if (key === "minimizeToTray") {
      this.settings.minimizeToTray = Boolean(value)
    } else if (key === "minimizeOnGameLaunch") {
      this.settings.minimizeOnGameLaunch = Boolean(value)
    } else if (key === "dedicatedGpu") {
      this.settings.dedicatedGpu = Boolean(value)
    } else if (key === "ramGB") {
      const num = Number(value)
      if (!isNaN(num) && num >= 1 && num <= 64) {
        this.settings.ramGB = Math.round(num)
      } else {
        return false
      }
    } else {
      return false
    }

    const saved = this.save()
    if (!saved) {
      this.settings[key] = previousValue
      return false
    }
    return true
  }

  getGameSetting(gameId, key, _options = {}) {
    if (!gameId || typeof gameId !== "string") {
      return this.get(key)
    }

    if (!this.settings.games) {
      this.settings.games = {}
    }

    if (!this.settings.games[gameId]) {
      return key === "dedicatedGpu" ? true : 8
    }

    const entry = this.settings.games[gameId]
    if (key === "dedicatedGpu") {
      return typeof entry.dedicatedGpu === "boolean" ? entry.dedicatedGpu : true
    }
    if (key === "ramGB") {
      return typeof entry.ramGB === "number" ? entry.ramGB : 8
    }
    return this.get(key)
  }

  setGameSetting(gameId, key, value, _options = {}) {
    if (!gameId || typeof gameId !== "string") {
      return false
    }

    if (!this.settings.games) {
      this.settings.games = {}
    }

    if (!this.settings.games[gameId]) {
      this.settings.games[gameId] = {
        dedicatedGpu: true,
        ramGB: 8,
      }
    }

    const previousEntry = { ...this.settings.games[gameId] }

    if (key === "dedicatedGpu") {
      this.settings.games[gameId].dedicatedGpu = Boolean(value)
    } else if (key === "ramGB") {
      const num = Number(value)
      if (!isNaN(num) && num >= 1 && num <= 64) {
        this.settings.games[gameId].ramGB = Math.round(num)
      } else {
        return false
      }
    } else {
      return false
    }

    const saved = this.save()
    if (!saved) {
      this.settings.games[gameId] = previousEntry
      return false
    }
    return true
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS }
