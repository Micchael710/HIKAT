const fs = require("fs")
const path = require("path")

const DEFAULT_SETTINGS = {
  minimizeToTray: true,
  minimizeOnGameLaunch: true,
  dedicatedGpu: true,
  ramGB: 8,
}

class SettingsStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "launcher-settings.json")
    this.settings = { ...DEFAULT_SETTINGS }
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
        }
      }
    } catch (err) {
      console.warn("[SettingsStore] Failed to read settings, using safe defaults:", err)
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  save() {
    try {
      const data = JSON.stringify(this.settings, null, 2)
      const tempPath = `${this.filePath}.tmp.${Date.now()}`
      fs.writeFileSync(tempPath, data, "utf-8")
      fs.renameSync(tempPath, this.filePath)
    } catch (err) {
      console.error("[SettingsStore] Failed to save settings atomically:", err)
    }
  }

  get(key) {
    return this.settings[key] !== undefined ? this.settings[key] : DEFAULT_SETTINGS[key]
  }

  set(key, value) {
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
      }
    }
    this.save()
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS }
