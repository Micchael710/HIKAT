import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getUpdateFeedUrl, runLauncherUpdateBootstrap } from "./launcher-updater.cjs"

function createMockUpdater() {
  const listeners: Record<string, Function[]> = {}
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
    forceDevUpdateConfig: false,
    setFeedURL: vi.fn(),
    removeAllListeners: vi.fn(() => {
      for (const k of Object.keys(listeners)) {
        delete listeners[k]
      }
    }),
    on: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    emit: (event: string, ...args: any[]) => {
      const cbs = listeners[event] || []
      cbs.forEach((cb) => cb(...args))
    },
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn().mockResolvedValue([]),
    quitAndInstall: vi.fn(),
  }
}

describe("HiKAT Launcher Auto-Updater Service Suite", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("1. Feed URL Resolution", () => {
    it("returns default production feed URL when packaged without overrides", () => {
      delete process.env.HIKAT_UPDATE_URL
      delete process.env.HIKAT_API_URL
      delete process.env.VITE_API_URL
      delete process.env.VITE_BACKEND_API_URL
      process.env.NODE_ENV = "development" // Even if NODE_ENV is development

      expect(getUpdateFeedUrl(true)).toBe("https://api.hikat.org/launcher/update")
    })

    it("returns local development feed URL when unpackaged without overrides", () => {
      delete process.env.HIKAT_UPDATE_URL
      delete process.env.HIKAT_API_URL
      delete process.env.VITE_API_URL
      delete process.env.VITE_BACKEND_API_URL
      process.env.NODE_ENV = "production" // Even if NODE_ENV is production

      expect(getUpdateFeedUrl(false)).toBe("http://127.0.0.1:8787/launcher/update")
    })

    it("respects explicit HIKAT_UPDATE_URL environment override in both packaged and dev modes", () => {
      process.env.HIKAT_UPDATE_URL = "http://localhost:8787/launcher/update/"
      expect(getUpdateFeedUrl(true)).toBe("http://localhost:8787/launcher/update")
      expect(getUpdateFeedUrl(false)).toBe("http://localhost:8787/launcher/update")
    })

    it("derives update feed URL from VITE_API_URL / HIKAT_API_URL in both packaged and dev modes", () => {
      delete process.env.HIKAT_UPDATE_URL
      process.env.VITE_API_URL = "http://127.0.0.1:8787"
      expect(getUpdateFeedUrl(true)).toBe("http://127.0.0.1:8787/launcher/update")
      expect(getUpdateFeedUrl(false)).toBe("http://127.0.0.1:8787/launcher/update")
    })
  })

  describe("2. Lifecycle & Resilience", () => {
    it("skips update check in dev mode when app is unpackaged and not forced", async () => {
      delete process.env.FORCE_LAUNCHER_AUTO_UPDATE
      const mockApp = { isPackaged: false, quit: vi.fn() }
      const mockSplash: any = {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      }
      const mockUpdater = createMockUpdater()

      const result = await runLauncherUpdateBootstrap(mockSplash, mockUpdater, mockApp)
      expect(result.updated).toBe(false)
      expect(result.reason).toBe("dev_mode")
      expect(mockUpdater.setFeedURL).not.toHaveBeenCalled()
    })

    it("gracefully survives network error without throwing or blocking", async () => {
      const mockApp = { isPackaged: true, quit: vi.fn() }
      const mockSplash: any = {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      }
      const mockUpdater = createMockUpdater()

      mockUpdater.checkForUpdates.mockImplementationOnce(() => {
        mockUpdater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
        return Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"))
      })

      const result = await runLauncherUpdateBootstrap(mockSplash, mockUpdater, mockApp)
      expect(result.updated).toBe(false)
      expect(result.reason).toBe("error")
    })

    it("proceeds normally when no update is available", async () => {
      const mockApp = { isPackaged: true, quit: vi.fn() }
      const mockSplash: any = {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      }
      const mockUpdater = createMockUpdater()

      mockUpdater.checkForUpdates.mockImplementationOnce(async () => {
        mockUpdater.emit("update-not-available", { version: "1.0.0" })
      })

      const result = await runLauncherUpdateBootstrap(mockSplash, mockUpdater, mockApp)
      expect(result.updated).toBe(false)
      expect(result.reason).toBe("not_available")
    })

    it("downloads update, emits splash progress, and calls quitAndInstall", async () => {
      vi.useFakeTimers()
      const mockApp = { isPackaged: true, quit: vi.fn() }
      const mockSplash: any = {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      }
      const mockUpdater = createMockUpdater()

      mockUpdater.checkForUpdates.mockImplementationOnce(async () => {
        mockUpdater.emit("update-available", { version: "1.0.1" })
      })

      const promise = runLauncherUpdateBootstrap(mockSplash, mockUpdater, mockApp)

      // Simulate download progress
      mockUpdater.emit("download-progress", {
        percent: 50,
        bytesPerSecond: 1024 * 1024 * 5,
        transferred: 50 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      })

      expect(mockSplash.webContents.send).toHaveBeenCalledWith("updater:status", {
        state: "downloading",
        message: "DESCARGANDO ACTUALIZACION",
      })

      expect(mockSplash.webContents.send).toHaveBeenCalledWith(
        "updater:progress",
        expect.objectContaining({ percent: 50 }),
      )

      // Simulate update-downloaded
      mockUpdater.emit("update-downloaded", { version: "1.0.1" })

      expect(mockSplash.webContents.send).toHaveBeenCalledWith("updater:status", {
        state: "installing",
        message: "INSTALANDO ACTUALIZACION",
        submessage: "HiKAT se reiniciará automáticamente al finalizar.",
      })

      // Advance timer for UI grace period before restart (1800ms)
      vi.advanceTimersByTime(2000)

      const result = await promise
      expect(result.updated).toBe(true)
      expect(mockUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)

      vi.useRealTimers()
    })
  })
})
