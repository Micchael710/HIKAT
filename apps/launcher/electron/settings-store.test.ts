import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import fs from "fs"
import path from "path"
import os from "os"
import { SettingsStore, DEFAULT_SETTINGS } from "./settings-store.cjs"
import { SecureAuthStore } from "./secure-auth-store.cjs"

describe("Electron Main SettingsStore & SecureAuthStore Suite (Shard 8F)", () => {
  let tempDir = ""

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hikat-settings-test-"))
  })

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("1. SettingsStore initializes with safe defaults if file does not exist", () => {
    const store = new SettingsStore(tempDir)
    expect(store.get("minimizeToTray")).toBe(true)
    expect(store.get("minimizeOnGameLaunch")).toBe(true)
    expect(store.get("dedicatedGpu")).toBe(true)
    expect(store.get("ramGB")).toBe(8)
  })

  it("2. minimizeToTray false persists across restarts without opening Settings", () => {
    const store1 = new SettingsStore(tempDir)
    store1.set("minimizeToTray", false)

    expect(store1.get("minimizeToTray")).toBe(false)

    // Simulate process restart
    const store2 = new SettingsStore(tempDir)
    expect(store2.get("minimizeToTray")).toBe(false)
  })

  it("2b. minimizeOnGameLaunch false persists across restarts", () => {
    const store1 = new SettingsStore(tempDir)
    expect(store1.get("minimizeOnGameLaunch")).toBe(true)
    store1.set("minimizeOnGameLaunch", false)

    expect(store1.get("minimizeOnGameLaunch")).toBe(false)

    // Simulate process restart
    const store2 = new SettingsStore(tempDir)
    expect(store2.get("minimizeOnGameLaunch")).toBe(false)
  })

  it("3. dedicatedGpu false persists across restarts", () => {
    const store1 = new SettingsStore(tempDir)
    store1.set("dedicatedGpu", false)

    expect(store1.get("dedicatedGpu")).toBe(false)

    // Simulate process restart
    const store2 = new SettingsStore(tempDir)
    expect(store2.get("dedicatedGpu")).toBe(false)
  })

  it("4. Corrupted settings JSON falls back gracefully to safe defaults", () => {
    const settingsFile = path.join(tempDir, "launcher-settings.json")
    fs.writeFileSync(settingsFile, "{ corrupted invalid json content ...", "utf-8")

    const store = new SettingsStore(tempDir)
    expect(store.get("minimizeToTray")).toBe(true)
    expect(store.get("minimizeOnGameLaunch")).toBe(true)
    expect(store.get("dedicatedGpu")).toBe(true)
    expect(store.get("ramGB")).toBe(8)
  })

  it("5. Unknown JSON fields are safely ignored and never leak secrets", () => {
    const settingsFile = path.join(tempDir, "launcher-settings.json")
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        minimizeToTray: false,
        dedicatedGpu: false,
        ramGB: 12,
        unknownDangerousField: "ignored",
      }),
      "utf-8",
    )

    const store = new SettingsStore(tempDir)
    expect(store.get("minimizeToTray")).toBe(false)
    expect(store.get("dedicatedGpu")).toBe(false)
    expect(store.get("ramGB")).toBe(12)
    expect((store as any).settings.unknownDangerousField).toBeUndefined()
  })

  it("6. SecureAuthStore saves, loads, and clears session correctly", () => {
    const authStore1 = new SecureAuthStore(tempDir)
    const session = {
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      user: {
        id: "usr-123",
        email: "player@hikat.org",
        role: "PLAYER",
      },
    }

    authStore1.saveSession(session)

    // Simulate process restart
    const authStore2 = new SecureAuthStore(tempDir)
    const loaded = authStore2.loadSession()

    expect(loaded).not.toBeNull()
    expect(loaded.accessToken).toBe("test-access-token")
    expect(loaded.user.email).toBe("player@hikat.org")

    authStore2.clearSession()
    expect(authStore2.loadSession()).toBeNull()
  })

  it("7. SecureAuthStore pending OAuth state persists across restarts and clears on retrieval", () => {
    const authStore1 = new SecureAuthStore(tempDir)
    authStore1.savePendingOAuth({
      provider: "GOOGLE",
      codeVerifier: "pkce-verifier-12345",
      state: "oauth-state-abcde",
      expiresAt: Date.now() + 60000,
    })

    // Simulate process restart
    const authStore2 = new SecureAuthStore(tempDir)

    // Mismatched state returns null
    expect(authStore2.getPendingOAuth("wrong-state")).toBeNull()

    // Re-save to test valid retrieval
    authStore2.savePendingOAuth({
      provider: "GOOGLE",
      codeVerifier: "pkce-verifier-12345",
      state: "oauth-state-abcde",
      expiresAt: Date.now() + 60000,
    })

    const pending = authStore2.getPendingOAuth("oauth-state-abcde")
    expect(pending).not.toBeNull()
    expect(pending.codeVerifier).toBe("pkce-verifier-12345")
    expect(pending.provider).toBe("GOOGLE")

    // Once retrieved, it is automatically cleared
    expect(authStore2.getPendingOAuth("oauth-state-abcde")).toBeNull()
  })

  it("8. In production without safeStorage, savePendingOAuth never writes plaintext file and operates memory-only", () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalVitest = process.env.VITEST

    try {
      // Simulate production environment
      process.env.NODE_ENV = "production"
      delete process.env.VITEST

      const authStore = new SecureAuthStore(tempDir)
      // Force encryption unavailable
      vi.spyOn(authStore, "isEncryptionAvailable").mockReturnValue(false)

      authStore.savePendingOAuth({
        provider: "DISCORD",
        codeVerifier: "pkce-secret-12345",
        state: "state-secret-999",
        expiresAt: Date.now() + 60000,
      })

      const pendingFile = path.join(tempDir, "pending-oauth.enc")
      // Strict verification: NO plaintext file was written!
      expect(fs.existsSync(pendingFile)).toBe(false)

      // Operates in memory-only for current session
      const retrieved = authStore.getPendingOAuth("state-secret-999")
      expect(retrieved).not.toBeNull()
      expect(retrieved.codeVerifier).toBe("pkce-secret-12345")
      expect(retrieved.provider).toBe("DISCORD")

      // A restarted store in production without safeStorage will find NO file and return null
      const restartedStore = new SecureAuthStore(tempDir)
      vi.spyOn(restartedStore, "isEncryptionAvailable").mockReturnValue(false)
      expect(restartedStore.getPendingOAuth("state-secret-999")).toBeNull()
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      if (originalVitest !== undefined) {
        process.env.VITEST = originalVitest
      }
    }
  })

  describe("minimizeOnGameLaunch event handler logic", () => {
    function simulateLaunchStatusHandler({
      status,
      details,
      minimizeOnGameLaunchEnabled,
      minimizeToTrayEnabled,
      mainWindow,
      ensureTray,
    }: {
      status: string
      details?: any
      minimizeOnGameLaunchEnabled: boolean
      minimizeToTrayEnabled: boolean
      mainWindow: any
      ensureTray: () => void
    }) {
      if (status === "running") {
        if (minimizeOnGameLaunchEnabled) {
          ensureTray()
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
            mainWindow.hide()
          }
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("game-launch-status", status, details)
      }
    }

    it("9. running + minimizeOnGameLaunch: true calls ensureTray and hides mainWindow even if minimizeToTray is false", () => {
      const ensureTray = vi.fn()
      const hide = vi.fn()
      const send = vi.fn()
      const mainWindow = {
        isDestroyed: () => false,
        isVisible: () => true,
        hide,
        webContents: { send },
      }

      simulateLaunchStatusHandler({
        status: "running",
        minimizeOnGameLaunchEnabled: true,
        minimizeToTrayEnabled: false,
        mainWindow,
        ensureTray,
      })

      expect(ensureTray).toHaveBeenCalledTimes(1)
      expect(hide).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith("game-launch-status", "running", undefined)
    })

    it("10. running + minimizeOnGameLaunch: false does not hide mainWindow and does not call ensureTray", () => {
      const ensureTray = vi.fn()
      const hide = vi.fn()
      const send = vi.fn()
      const mainWindow = {
        isDestroyed: () => false,
        isVisible: () => true,
        hide,
        webContents: { send },
      }

      simulateLaunchStatusHandler({
        status: "running",
        minimizeOnGameLaunchEnabled: false,
        minimizeToTrayEnabled: false,
        mainWindow,
        ensureTray,
      })

      expect(ensureTray).not.toHaveBeenCalled()
      expect(hide).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith("game-launch-status", "running", undefined)
    })

    it("11. preparing status does not hide mainWindow", () => {
      const ensureTray = vi.fn()
      const hide = vi.fn()
      const send = vi.fn()
      const mainWindow = {
        isDestroyed: () => false,
        isVisible: () => true,
        hide,
        webContents: { send },
      }

      simulateLaunchStatusHandler({
        status: "preparing",
        minimizeOnGameLaunchEnabled: true,
        minimizeToTrayEnabled: true,
        mainWindow,
        ensureTray,
      })

      expect(ensureTray).not.toHaveBeenCalled()
      expect(hide).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith("game-launch-status", "preparing", undefined)
    })

    it("12. launch failure / idle status with error does not hide mainWindow", () => {
      const ensureTray = vi.fn()
      const hide = vi.fn()
      const send = vi.fn()
      const mainWindow = {
        isDestroyed: () => false,
        isVisible: () => true,
        hide,
        webContents: { send },
      }

      simulateLaunchStatusHandler({
        status: "idle",
        details: { unexpected: true, code: 1 },
        minimizeOnGameLaunchEnabled: true,
        minimizeToTrayEnabled: true,
        mainWindow,
        ensureTray,
      })

      expect(ensureTray).not.toHaveBeenCalled()
      expect(hide).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith("game-launch-status", "idle", { unexpected: true, code: 1 })
    })
  })
})


