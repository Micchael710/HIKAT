import { describe, it, expect, afterEach, beforeAll, vi } from "vitest"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import url from "node:url"

let waitForUrl, LAUNCHER_DEV_URL, pnpmCmd, terminateProcess, killProcessTree

describe("devLauncher Orchestration Script", () => {
  let server

  beforeAll(async () => {
    const filePath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "devLauncher.mjs")
    const content = fs.readFileSync(filePath, "utf8").replace(/^#![^\n]+/, "")
    const mod = await import(`data:text/javascript;base64,${Buffer.from(content).toString("base64")}`)
    waitForUrl = mod.waitForUrl
    LAUNCHER_DEV_URL = mod.LAUNCHER_DEV_URL
    pnpmCmd = mod.pnpmCmd
    terminateProcess = mod.terminateProcess
    killProcessTree = mod.killProcessTree
  })

  afterEach(() => {
    if (server) {
      server.close()
      server = null
    }
  })

  it("1. Exports expected constants and commands", () => {
    expect(LAUNCHER_DEV_URL).toBe("http://127.0.0.1:8443")
    expect(pnpmCmd).toBe(process.platform === "win32" ? "pnpm.cmd" : "pnpm")
    expect(typeof terminateProcess).toBe("function")
    expect(typeof killProcessTree).toBe("function")
  })

  it("2. waitForUrl resolves successfully when HTTP server responds", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end("<!DOCTYPE html><html><body>Vite Ready</body></html>")
    })

    await new Promise((resolve) => server.listen(8443, "127.0.0.1", resolve))

    await expect(waitForUrl("http://127.0.0.1:8443", 2000)).resolves.toBeUndefined()
  })

  it("3. waitForUrl rejects with timeout if server is not responding", async () => {
    // Port 18443 has no server listening
    await expect(waitForUrl("http://127.0.0.1:18443", 300)).rejects.toThrow(
      /Timeout \(300ms\) waiting for Vite server/i,
    )
  })

  it("4. terminateProcess safely handles null, invalid, or mock process without throwing", () => {
    expect(() => terminateProcess(null)).not.toThrow()
    expect(() => terminateProcess({})).not.toThrow()
    const mockProc = { pid: 9999999, kill: vi.fn() }
    expect(() => terminateProcess(mockProc)).not.toThrow()
  })

  it("5. devLauncher script uses terminateProcess without /T for Electron cleanup", () => {
    const filePath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "devLauncher.mjs")
    const code = fs.readFileSync(filePath, "utf8")
    // Ensure terminateProcess does not contain /T
    const terminateProcessBody = code.match(/function terminateProcess\([\s\S]*?^}/m)?.[0] || ""
    expect(terminateProcessBody).not.toContain("/T")
    // Ensure cleanup calls terminateProcess on electronProcess
    const cleanupBody = code.match(/function cleanup\([\s\S]*?^}/m)?.[0] || ""
    expect(cleanupBody).toContain("terminateProcess(electronProcess)")
    expect(cleanupBody).toContain("killProcessTree(viteProcess)")
  })
})
