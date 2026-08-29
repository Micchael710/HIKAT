const fs = require("fs")
const path = require("path")
let electronSafeStorage = null
try {
  const electron = require("electron")
  electronSafeStorage = electron.safeStorage || null
} catch (_) {}

class SecureAuthStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "auth-session.enc")
  }

  loadSession() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null
      }
      const fileData = fs.readFileSync(this.filePath)
      let jsonStr = ""
      if (electronSafeStorage && typeof electronSafeStorage.isEncryptionAvailable === "function" && electronSafeStorage.isEncryptionAvailable()) {
        try {
          jsonStr = electronSafeStorage.decryptString(fileData)
        } catch {
          // Fallback in case stored as plain utf-8
          jsonStr = fileData.toString("utf-8")
        }
      } else {
        jsonStr = fileData.toString("utf-8")
      }

      const parsed = JSON.parse(jsonStr)
      if (parsed && typeof parsed === "object" && parsed.accessToken && parsed.user) {
        return parsed
      }
      return null
    } catch (_) {
      return null
    }
  }

  saveSession(session) {
    try {
      if (!session) {
        this.clearSession()
        return
      }
      const jsonStr = JSON.stringify(session)
      let bufferToWrite
      if (electronSafeStorage && typeof electronSafeStorage.isEncryptionAvailable === "function" && electronSafeStorage.isEncryptionAvailable()) {
        bufferToWrite = electronSafeStorage.encryptString(jsonStr)
      } else {
        bufferToWrite = Buffer.from(jsonStr, "utf-8")
      }
      const tempPath = `${this.filePath}.tmp.${Date.now()}`
      fs.writeFileSync(tempPath, bufferToWrite, { mode: 0o600 })
      fs.renameSync(tempPath, this.filePath)
    } catch (err) {
      console.error("[SecureAuthStore] Failed to save session securely:", err)
    }
  }

  clearSession() {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath)
      }
    } catch (_) {}
  }
}

module.exports = { SecureAuthStore }
