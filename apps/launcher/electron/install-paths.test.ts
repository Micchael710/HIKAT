import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "node:path"
import os from "node:os"
import {
  getHiKatRoot,
  getLauncherRoot,
  getGamesRoot,
  getRuntimeRoot,
  getUserDataRoot,
  getLegacyInstanceRoot,
} from "./install-paths.cjs"

describe("Install Paths Resolver Suite", () => {
  const originalEnv = { ...process.env }
  const originalExecPath = process.execPath

  beforeEach(() => {
    delete process.env.HIKAT_ROOT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    Object.defineProperty(process, "execPath", {
      value: originalExecPath,
      configurable: true,
      writable: true,
    })
    vi.restoreAllMocks()
  })

  it("1. Derives roots from HIKAT_ROOT environment variable when present", () => {
    const customRoot = path.resolve("D:/CustomGames/HiKAT")
    process.env.HIKAT_ROOT = customRoot

    expect(getHiKatRoot()).toBe(customRoot)
    expect(getGamesRoot()).toBe(path.join(customRoot, "games"))
    expect(getRuntimeRoot()).toBe(path.join(customRoot, "runtime"))
    expect(getLauncherRoot()).toBe(path.join(customRoot, "Launcher"))
    expect(getLegacyInstanceRoot()).toBe(path.join(customRoot, "game files"))
  })

  it("2. UserData root always resides in AppData/HiKAT/launcher, unaffected by HIKAT_ROOT", () => {
    process.env.HIKAT_ROOT = "D:/CustomGames/HiKAT"
    const userData = getUserDataRoot()

    expect(userData).toContain(path.join("HiKAT", "launcher"))
    expect(userData).not.toContain("CustomGames")
  })

  it("3. Packaged mode: resolves HiKAT root from process.execPath parent directory", () => {
    const mockExe = path.resolve("D:/HiKAT/Launcher/HiKAT Launcher.exe")
    Object.defineProperty(process, "execPath", {
      value: mockExe,
      configurable: true,
      writable: true,
    })

    const electronMock = require("electron")
    const originalIsPackaged = electronMock.app?.isPackaged
    if (electronMock.app) {
      electronMock.app.isPackaged = true
    }

    try {
      expect(getLauncherRoot()).toBe(path.dirname(mockExe))
      expect(getHiKatRoot()).toBe(path.resolve("D:/HiKAT"))
      expect(getGamesRoot()).toBe(path.resolve("D:/HiKAT/games"))
      expect(getRuntimeRoot()).toBe(path.resolve("D:/HiKAT/runtime"))
    } finally {
      if (electronMock.app) {
        electronMock.app.isPackaged = originalIsPackaged
      }
    }
  })

  it("3b. Packaged mode with HIKAT_ROOT set: process.execPath always wins over HIKAT_ROOT override", () => {
    process.env.HIKAT_ROOT = path.resolve("E:/IgnoredDevOverride/HiKAT")
    const mockExe = path.resolve("D:/RealInstall/HiKAT/Launcher/HiKAT Launcher.exe")
    Object.defineProperty(process, "execPath", {
      value: mockExe,
      configurable: true,
      writable: true,
    })

    const electronMock = require("electron")
    const originalIsPackaged = electronMock.app?.isPackaged
    if (electronMock.app) {
      electronMock.app.isPackaged = true
    }

    try {
      expect(getLauncherRoot()).toBe(path.dirname(mockExe))
      expect(getHiKatRoot()).toBe(path.resolve("D:/RealInstall/HiKAT"))
      expect(getGamesRoot()).toBe(path.resolve("D:/RealInstall/HiKAT/games"))
      expect(getRuntimeRoot()).toBe(path.resolve("D:/RealInstall/HiKAT/runtime"))
    } finally {
      if (electronMock.app) {
        electronMock.app.isPackaged = originalIsPackaged
      }
    }
  })

  it("4. Development fallback: resolves HiKAT root to canonical appData when not packaged and HIKAT_ROOT unset", () => {
    const electronMock = require("electron")
    const originalIsPackaged = electronMock.app?.isPackaged
    if (electronMock.app) {
      electronMock.app.isPackaged = false
    }

    try {
      const root = getHiKatRoot()
      expect(root).toBeDefined()
      expect(root.endsWith("HiKAT")).toBe(true)
      expect(getGamesRoot()).toBe(path.join(root, "games"))
      expect(getRuntimeRoot()).toBe(path.join(root, "runtime"))
    } finally {
      if (electronMock.app) {
        electronMock.app.isPackaged = originalIsPackaged
      }
    }
  })

  it("5. Safe uninstallation in custom gamesRoot outside AppData succeeds", async () => {
    const { uninstallGame } = require("./client-files-sync.cjs")
    const tempBase = await (await import("fs/promises")).mkdtemp(path.join(os.tmpdir(), "hikat-custom-root-"))
    const customGamesRoot = path.join(tempBase, "HiKAT", "games")
    const serverInstance = path.join(customGamesRoot, "ServerBravo")
    const fsp = await import("fs/promises")

    await fsp.mkdir(serverInstance, { recursive: true })
    await fsp.writeFile(path.join(serverInstance, "installed-manifest.json"), "{}", "utf8")

    const res = await uninstallGame(serverInstance, customGamesRoot)
    expect(res).toEqual({ success: true })
    expect((await import("fs")).existsSync(serverInstance)).toBe(false)

    try {
      await fsp.rm(tempBase, { recursive: true, force: true })
    } catch (_) {}
  })

  it("6. Path traversal or target outside gamesRoot is rejected with security violation", async () => {
    const { uninstallGame } = require("./client-files-sync.cjs")
    const customGamesRoot = path.resolve("D:/HiKAT/games")
    const outsideTarget = path.resolve("D:/HiKAT/Launcher")

    await expect(uninstallGame(outsideTarget, customGamesRoot)).rejects.toThrow(
      /Security violation: Attempted to uninstall directory outside canonical gamesRoot/
    )

    const traversalTarget = path.resolve("D:/HiKAT/games/../runtime")
    await expect(uninstallGame(traversalTarget, customGamesRoot)).rejects.toThrow(
      /Security violation: Attempted to uninstall directory outside canonical gamesRoot/
    )
  })
})

