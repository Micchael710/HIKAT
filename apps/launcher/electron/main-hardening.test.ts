import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"
import { DEV_CSP, PROD_CSP, getCSP } from "../src/config/csp"
import {
  DEFAULT_PROD_API_BASE_URL,
  DEFAULT_DEV_API_BASE_URL,
  DEFAULT_PROD_AUTH_BASE_URL,
  DEFAULT_DEV_AUTH_BASE_URL,
} from "../src/config/api"

describe("HiKAT Launcher - Production Hardening Suite", () => {
  const mainCjsPath = path.resolve(__dirname, "main.cjs")
  const mainCjsContent = fs.readFileSync(mainCjsPath, "utf-8")
  const preloadCjsPath = path.resolve(__dirname, "preload.cjs")
  const preloadCjsContent = fs.readFileSync(preloadCjsPath, "utf-8")
  const splashPreloadCjsPath = path.resolve(__dirname, "splash-preload.cjs")
  const splashPreloadCjsContent = fs.readFileSync(splashPreloadCjsPath, "utf-8")

  describe("1. DevTools & Window Preferences Hardening", () => {
    it("configures mainWindow with contextIsolation: true, nodeIntegration: false, sandbox: true, and devTools: !app.isPackaged", () => {
      expect(mainCjsContent).toContain("contextIsolation: true")
      expect(mainCjsContent).toContain("nodeIntegration: false")
      expect(mainCjsContent).toContain("sandbox: true")
      expect(mainCjsContent).toContain("devTools: !app.isPackaged")
    })

    it("configures splashWindow with contextIsolation: true, nodeIntegration: false, sandbox: true, and devTools: false", () => {
      // Find splash window definition block
      const splashBlockStart = mainCjsContent.indexOf("splashWindow = new BrowserWindow({")
      expect(splashBlockStart).toBeGreaterThan(-1)
      const splashBlock = mainCjsContent.slice(splashBlockStart, splashBlockStart + 600)

      expect(splashBlock).toContain("devTools: false")
      expect(splashBlock).toContain("contextIsolation: true")
      expect(splashBlock).toContain("nodeIntegration: false")
      expect(splashBlock).toContain("sandbox: true")
    })

    it("prevents opening DevTools via shortcuts (F12, Ctrl+Shift+I/J/C) and closes them if opened in production", () => {
      expect(mainCjsContent).toContain('if (app.isPackaged)')
      expect(mainCjsContent).toContain('input.key === "F12"')
      expect(mainCjsContent).toContain('mainWindow.webContents.closeDevTools()')
    })
  })

  describe("2. No Vite Server in Production", () => {
    it("in packaged production, mainWindow loads dist/index.html directly without probing or loading localhost dev server", () => {
      const loadLogicMatch = mainCjsContent.match(
        /if\s*\(\s*app\.isPackaged\s*\)\s*\{\s*mainWindow\.loadFile\(distPath\)\s*\}\s*else\s*\{([\s\S]*?)\}/,
      )
      expect(loadLogicMatch).toBeTruthy()
      const devBranch = loadLogicMatch![1]
      expect(devBranch).toContain("checkServer(devUrl, 600)")
      expect(devBranch).toContain("mainWindow.loadURL(devUrl)")
    })
  })

  describe("3. Production API and Auth Authority", () => {
    it("authoritative production backend is https://api.hikat.org without legacy apparatia URLs", () => {
      expect(DEFAULT_PROD_API_BASE_URL).toBe("https://api.hikat.org")
      expect(DEFAULT_DEV_API_BASE_URL).toBe("http://127.0.0.1:8787")
      expect(mainCjsContent).not.toContain("api.apparatia.net")
    })

    it("authoritative production auth is https://auth.hikat.org", () => {
      expect(DEFAULT_PROD_AUTH_BASE_URL).toBe("https://auth.hikat.org")
      expect(DEFAULT_DEV_AUTH_BASE_URL).toBe("http://localhost:8788")
    })
  })

  describe("4. Distinct CSP for Production vs Development", () => {
    it("production CSP eliminates localhost and 127.0.0.1 wildcards from connect-src, img-src, media-src", () => {
      expect(PROD_CSP).not.toContain("http://localhost")
      expect(PROD_CSP).not.toContain("ws://localhost")
      expect(PROD_CSP).not.toContain("http://127.0.0.1:*")
      expect(PROD_CSP).not.toContain("ws://127.0.0.1:*")

      // Strictly allows HiKAT production domains
      expect(PROD_CSP).toContain("https://api.hikat.org")
      expect(PROD_CSP).toContain("wss://api.hikat.org")
      expect(PROD_CSP).toContain("https://auth.hikat.org")

      // Allows local OAuth callback port strictly if needed
      expect(PROD_CSP).toContain("http://127.0.0.1:47821")
    })

    it("production CSP connect-src does NOT contain generic https: and strictly contains HiKAT endpoints + OAuth loopback", () => {
      const connectSrcMatch = PROD_CSP.match(/connect-src\s+([^;]+);/)
      expect(connectSrcMatch).toBeTruthy()
      const connectSrc = connectSrcMatch![1]
      const tokens = connectSrc.split(/\s+/).filter(Boolean)

      // Must NOT contain generic https:
      expect(tokens).not.toContain("https:")

      // Must strictly contain expected origins
      expect(tokens).toEqual([
        "'self'",
        "https://api.hikat.org",
        "wss://api.hikat.org",
        "https://auth.hikat.org",
        "http://127.0.0.1:47821",
      ])

      // img-src and media-src retain https: for external assets
      expect(PROD_CSP).toMatch(/img-src[^;]*\bhttps:/)
      expect(PROD_CSP).toMatch(/media-src[^;]*\bhttps:/)
    })

    it("development CSP allows localhost and local network servers", () => {
      expect(DEV_CSP).toContain("http://localhost:*")
      expect(DEV_CSP).toContain("http://127.0.0.1:*")
      expect(DEV_CSP).toContain("ws://localhost:*")
      expect(DEV_CSP).toContain("wss://api.hikat.org")
    })

    it("getCSP helper selects appropriate policy", () => {
      expect(getCSP(true)).toBe(PROD_CSP)
      expect(getCSP(false)).toBe(DEV_CSP)
    })
  })

  describe("5. Application Menu Hardening", () => {
    it("disables application menu in production", () => {
      expect(mainCjsContent).toMatch(/if\s*\(\s*app\.isPackaged\s*\)\s*\{\s*Menu\.setApplicationMenu\(null\)/)
      expect(mainCjsContent).toContain("mainWindow.setMenu(null)")
    })
  })

  describe("6. Renderer Console Message Forwarding", () => {
    it("forwards renderer console messages only in development", () => {
      expect(mainCjsContent).toMatch(/if\s*\(\s*!app\.isPackaged\s*\)\s*\{\s*mainWindow\.webContents\.on\(\s*["']console-message["']/)
    })
  })

  describe("7. Sandboxing & Preload Bridge Security", () => {
    it("preload only exposes safe methods via contextBridge without exposing require or ipcRenderer directly", () => {
      expect(preloadCjsContent).toContain('contextBridge.exposeInMainWorld("electronAPI"')
      expect(preloadCjsContent).not.toContain('contextBridge.exposeInMainWorld("ipcRenderer"')
      expect(preloadCjsContent).not.toContain('contextBridge.exposeInMainWorld("require"')
      expect(preloadCjsContent).not.toContain('contextBridge.exposeInMainWorld("process"')
    })

    it("splash-preload only exposes splashAPI via contextBridge", () => {
      expect(splashPreloadCjsContent).toContain('contextBridge.exposeInMainWorld("splashAPI"')
      expect(splashPreloadCjsContent).not.toContain('contextBridge.exposeInMainWorld("ipcRenderer"')
    })
  })
})
