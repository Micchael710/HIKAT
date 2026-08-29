import { describe, it, expect, beforeEach, afterEach } from "vitest"
import http from "node:http"
import { waitForUrl, LAUNCHER_DEV_URL, pnpmCmd } from "./devLauncher.mjs"

describe("devLauncher Orchestration Script", () => {
  let server

  afterEach(() => {
    if (server) {
      server.close()
      server = null
    }
  })

  it("1. Exports expected constants and commands", () => {
    expect(LAUNCHER_DEV_URL).toBe("http://127.0.0.1:8443")
    expect(pnpmCmd).toBe(process.platform === "win32" ? "pnpm.cmd" : "pnpm")
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
})
