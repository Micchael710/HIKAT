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
    this.pendingOAuthFilePath = path.join(userDataPath, "pending-oauth.enc")
    this.memorySession = null
    this.pendingOAuth = null
  }

  isEncryptionAvailable() {
    return Boolean(
      electronSafeStorage &&
      typeof electronSafeStorage.isEncryptionAvailable === "function" &&
      electronSafeStorage.isEncryptionAvailable()
    )
  }

  loadSession() {
    try {
      if (this.memorySession) {
        return this.memorySession
      }

      if (!fs.existsSync(this.filePath)) {
        return null
      }

      const fileData = fs.readFileSync(this.filePath)
      let jsonStr = ""

      if (this.isEncryptionAvailable()) {
        jsonStr = electronSafeStorage.decryptString(fileData)
      } else {
        // Only allow fallback in test environments; in production without safeStorage, do not read plaintext secrets
        if (process.env.NODE_ENV === "test" || process.env.VITEST) {
          jsonStr = fileData.toString("utf-8")
        } else {
          return null
        }
      }

      const parsed = JSON.parse(jsonStr)
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.accessToken === "string" &&
        typeof parsed.refreshToken === "string" &&
        parsed.user &&
        (parsed.user.role === "PLAYER" || parsed.user.role === "ADMIN")
      ) {
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

      // Strict validation
      if (
        typeof session !== "object" ||
        typeof session.accessToken !== "string" ||
        typeof session.refreshToken !== "string" ||
        !session.user ||
        (session.user.role !== "PLAYER" && session.user.role !== "ADMIN")
      ) {
        return
      }

      this.memorySession = session

      if (!this.isEncryptionAvailable()) {
        if (process.env.NODE_ENV === "test" || process.env.VITEST) {
          // Allow plaintext only in local unit tests
          const tempPath = `${this.filePath}.tmp.${Date.now()}`
          fs.writeFileSync(tempPath, Buffer.from(JSON.stringify(session), "utf-8"), { mode: 0o600 })
          fs.renameSync(tempPath, this.filePath)
        }
        // In production, keep session in memory-only if encryption unavailable
        return
      }

      const jsonStr = JSON.stringify(session)
      const bufferToWrite = electronSafeStorage.encryptString(jsonStr)
      const tempPath = `${this.filePath}.tmp.${Date.now()}`
      fs.writeFileSync(tempPath, bufferToWrite, { mode: 0o600 })
      fs.renameSync(tempPath, this.filePath)
    } catch (err) {
      console.error("[SecureAuthStore] Failed to save session securely:", err)
    }
  }

  clearSession() {
    this.memorySession = null
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath)
      }
    } catch (_) {}
  }

  // --- Pending OAuth PKCE State ---

  savePendingOAuth(data) {
    try {
      if (!data || !data.state || !data.codeVerifier) {
        this.clearPendingOAuth()
        return
      }

      this.pendingOAuth = {
        provider: data.provider || "GOOGLE",
        codeVerifier: data.codeVerifier,
        state: data.state,
        keepSession: typeof data.keepSession === "boolean" ? data.keepSession : true,
        locale: data.locale,
        expiresAt: data.expiresAt || Date.now() + 10 * 60 * 1000, // 10 minutes max
      }

      if (!this.isEncryptionAvailable()) {
        if (process.env.NODE_ENV === "test" || process.env.VITEST) {
          // Allow plaintext only in local unit test suite
          const jsonStr = JSON.stringify(this.pendingOAuth)
          const tempPath = `${this.pendingOAuthFilePath}.tmp.${Date.now()}`
          fs.writeFileSync(tempPath, Buffer.from(jsonStr, "utf-8"), { mode: 0o600 })
          fs.renameSync(tempPath, this.pendingOAuthFilePath)
        }
        // In production, keep pending OAuth in memory-only if encryption is unavailable
        return
      }

      const jsonStr = JSON.stringify(this.pendingOAuth)
      const bufferToWrite = electronSafeStorage.encryptString(jsonStr)
      const tempPath = `${this.pendingOAuthFilePath}.tmp.${Date.now()}`
      fs.writeFileSync(tempPath, bufferToWrite, { mode: 0o600 })
      fs.renameSync(tempPath, this.pendingOAuthFilePath)
    } catch (_) {}
  }

  peekPendingOAuth(state) {
    try {
      if (!this.pendingOAuth && fs.existsSync(this.pendingOAuthFilePath)) {
        const fileData = fs.readFileSync(this.pendingOAuthFilePath)
        let jsonStr = ""
        if (this.isEncryptionAvailable()) {
          jsonStr = electronSafeStorage.decryptString(fileData)
        } else {
          if (process.env.NODE_ENV === "test" || process.env.VITEST) {
            jsonStr = fileData.toString("utf-8")
          } else {
            return null
          }
        }
        this.pendingOAuth = JSON.parse(jsonStr)
      }

      if (this.pendingOAuth) {
        if (this.pendingOAuth.state === state && Date.now() < this.pendingOAuth.expiresAt) {
          return { ...this.pendingOAuth }
        }
      }
      return null
    } catch (_) {
      return null
    }
  }

  getPendingOAuth(state) {
    try {
      if (!this.pendingOAuth && fs.existsSync(this.pendingOAuthFilePath)) {
        const fileData = fs.readFileSync(this.pendingOAuthFilePath)
        let jsonStr = ""
        if (this.isEncryptionAvailable()) {
          jsonStr = electronSafeStorage.decryptString(fileData)
        } else {
          if (process.env.NODE_ENV === "test" || process.env.VITEST) {
            jsonStr = fileData.toString("utf-8")
          } else {
            this.clearPendingOAuth()
            return null
          }
        }
        this.pendingOAuth = JSON.parse(jsonStr)
      }

      if (this.pendingOAuth) {
        if (this.pendingOAuth.state === state && Date.now() < this.pendingOAuth.expiresAt) {
          const item = { ...this.pendingOAuth }
          this.clearPendingOAuth()
          return item
        }
      }
      this.clearPendingOAuth()
      return null
    } catch (_) {
      this.clearPendingOAuth()
      return null
    }
  }


  clearPendingOAuth() {
    this.pendingOAuth = null
    try {
      if (fs.existsSync(this.pendingOAuthFilePath)) {
        fs.unlinkSync(this.pendingOAuthFilePath)
      }
    } catch (_) {}
  }
}

module.exports = { SecureAuthStore }
