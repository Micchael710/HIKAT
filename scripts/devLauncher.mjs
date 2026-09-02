/**
 * HiKAT Launcher Local Development Orchestrator
 *
 * Sequentially boots:
 * 1. Pre-flight port sanitation (frees port 8443 if held by an orphaned process)
 * 2. Vite dev server (pnpm --filter hikat-launcher dev on http://127.0.0.1:8443)
 * 3. Readiness health check polling http://127.0.0.1:8443
 * 4. Electron desktop application (pnpm --filter hikat-launcher desktop)
 *
 * Ensures Electron never falls back to dist/index.html during local development
 * and cleanly terminates both processes on exit.
 */

import { spawn, execSync } from "node:child_process"
import http from "node:http"

export const LAUNCHER_DEV_URL = "http://127.0.0.1:8443"
export const LAUNCHER_PORT = 8443
export const READY_TIMEOUT_MS = 30000
export const POLL_INTERVAL_MS = 300

export const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

let viteProcess = null
let electronProcess = null
let isShuttingDown = false

export function freePortIfOccupied(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      const lines = output.trim().split("\n")
      const pids = new Set()
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        const pid = parts[parts.length - 1]
        if (pid && /^\d+$/.test(pid) && pid !== "0" && pid !== String(process.pid)) {
          pids.add(pid)
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" })
        } catch (_) {}
      }
    } else {
      try {
        const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
        if (pids) {
          execSync(`kill -9 ${pids.split("\n").join(" ")}`, { stdio: "ignore" })
        }
      } catch (_) {}
    }
  } catch (_) {}
}

export function killProcessTree(proc) {
  if (!proc || !proc.pid) return
  try {
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" })
      } catch (_) {}
    } else {
      proc.kill("SIGTERM")
    }
  } catch (_) {}
}

export function cleanup() {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log("\n[dev:launcher] Stopping Launcher development processes...")

  if (electronProcess) {
    killProcessTree(electronProcess)
    electronProcess = null
  }

  if (viteProcess) {
    killProcessTree(viteProcess)
    viteProcess = null
  }

  freePortIfOccupied(LAUNCHER_PORT)
}

/**
 * Polls the dev URL until it responds or times out.
 */
export async function waitForUrl(url, timeoutMs = READY_TIMEOUT_MS) {
  const parsed = new URL(url)
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - startTime > timeoutMs) {
        return reject(
          new Error(`Timeout (${timeoutMs}ms) waiting for Vite server at ${url}`),
        )
      }

      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: "/",
          timeout: 1000,
        },
        (res) => {
          res.resume()
          resolve()
        },
      )

      req.on("error", () => {
        setTimeout(check, POLL_INTERVAL_MS)
      })

      req.on("timeout", () => {
        req.destroy()
        setTimeout(check, POLL_INTERVAL_MS)
      })
    }

    check()
  })
}

export async function startDevLauncher() {
  process.on("SIGINT", () => {
    cleanup()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  process.on("exit", () => {
    cleanup()
  })

  // Ensure port 8443 is clean before boot
  freePortIfOccupied(LAUNCHER_PORT)

  console.log("[dev:launcher] Starting Launcher Vite dev server...")

  viteProcess = spawn(pnpmCmd, ["--filter", "hikat-launcher", "dev"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_ENV: "development" },
  })

  viteProcess.on("exit", (code) => {
    if (!isShuttingDown && code !== 0) {
      console.error(`[dev:launcher] Vite process exited with code ${code}`)
      cleanup()
      process.exit(code || 1)
    }
  })

  try {
    console.log(`[dev:launcher] Waiting for Vite readiness at ${LAUNCHER_DEV_URL}...`)
    await waitForUrl(LAUNCHER_DEV_URL, READY_TIMEOUT_MS)
    console.log("[dev:launcher] Vite is ready! Spawning Electron...")
  } catch (err) {
    console.error(`[dev:launcher] Failed to connect to Vite: ${err.message}`)
    cleanup()
    process.exit(1)
  }

  electronProcess = spawn(pnpmCmd, ["--filter", "hikat-launcher", "desktop"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_ENV: "development" },
  })

  electronProcess.on("exit", (code) => {
    console.log(`[dev:launcher] Electron window closed (exit code ${code || 0}).`)
    cleanup()
    process.exit(code || 0)
  })
}

// Auto-run if executed directly as a script (not in Vitest test runner)
if (!process.env.VITEST && process.argv[1]?.includes("devLauncher")) {
  startDevLauncher().catch((err) => {
    console.error("[dev:launcher] Unexpected error:", err)
    cleanup()
    process.exit(1)
  })
}
