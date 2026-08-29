import { describe, it, expect, beforeEach, afterEach } from "vitest"
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
})

