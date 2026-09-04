const path = require("path")
const fs = require("fs")
const { execFileSync } = require("child_process")
const { Version, launch: xmclLaunch } = require("@xmcl/core")
const { setJavaGpuPreference } = require("./gpu-manager.cjs")
const { resolveJavaRuntime, validateJavaBinary } = require("./java-runtime.cjs")
const { checkCore } = require("./minecraft-core.cjs")

const DEFAULT_RAM_GB = 4
const DEFAULT_LAUNCH_TOLERANCE_MS = 30000 // 30 seconds

function pathsMatch(pathA, pathB) {
  if (!pathA || !pathB) return false
  try {
    return path.resolve(String(pathA).trim()).toLowerCase() === path.resolve(String(pathB).trim()).toLowerCase()
  } catch (_) {
    return false
  }
}

function defaultProcessChecker(pid) {
  if (!pid || typeof pid !== "number" || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === "EPERM"
  }
}

function defaultProcessInfoFetcher(pid) {
  if (process.platform !== "win32") {
    return null
  }
  if (!pid || typeof pid !== "number" || pid <= 0) {
    return null
  }

  try {
    const psScript = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p -and $p.ExecutablePath) { [PSCustomObject]@{ Path = $p.ExecutablePath; StartTime = $p.CreationDate.ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress } else { $gp = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($gp -and $gp.Path) { [PSCustomObject]@{ Path = $gp.Path; StartTime = $gp.StartTime.ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress } }`

    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }
    )

    if (!stdout || !stdout.trim()) {
      return null
    }

    const parsed = JSON.parse(stdout.trim())
    if (!parsed || !parsed.Path) {
      return null
    }

    return {
      path: parsed.Path,
      startTime: parsed.StartTime ? new Date(parsed.StartTime).toISOString() : null,
    }
  } catch (_) {
    return null
  }
}

class GameLauncher {
  constructor(app, options = {}) {
    this.app = app
    this.instanceRoot = options.instanceRoot || path.join(process.env.APPDATA || "", "HiKAT", "game files")
    this.activeChildProcess = null
    this.launchStatus = "idle" // 'idle' | 'preparing' | 'running'
    this.onStatusChangeCallback = null
    this.xmclLauncher = options.xmclLauncher || xmclLaunch
    this.versionParser = options.versionParser || Version.parse
    this.readinessChecker = options.readinessChecker || checkCore
    this.javaResolver = options.javaResolver || resolveJavaRuntime
    this.javaValidator = options.javaValidator || validateJavaBinary
    this.processChecker = options.processChecker || defaultProcessChecker
    this.processInfoFetcher = options.processInfoFetcher || defaultProcessInfoFetcher
    this.processIdentityVerifier = options.processIdentityVerifier || null
    this.pollIntervalMs = options.pollIntervalMs || 1000
    this.launchToleranceMs = options.launchToleranceMs || DEFAULT_LAUNCH_TOLERANCE_MS
    this.trackedPid = null
    this.pollTimer = null

    this.initProcessMonitoring()
  }

  getPidFilePath() {
    return path.join(this.instanceRoot, ".hikat", "game-process.json")
  }

  saveProcessPid(pid, metadata = {}) {
    try {
      const filePath = this.getPidFilePath()
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          pid,
          launchedAt: metadata.launchedAt || new Date().toISOString(),
          ...metadata,
        }),
        "utf8"
      )
    } catch (e) {
      console.error("[GameLauncher] Failed to save PID file:", e)
    }
  }

  clearProcessPid() {
    try {
      const filePath = this.getPidFilePath()
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (e) {
      console.error("[GameLauncher] Failed to clear PID file:", e)
    }
  }

  readSavedProcessRecord() {
    try {
      const filePath = this.getPidFilePath()
      if (!fs.existsSync(filePath)) return null
      const content = fs.readFileSync(filePath, "utf8")
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed.pid !== "number" || parsed.pid <= 0) {
        return null
      }
      return parsed
    } catch (_) {
      return null
    }
  }

  readSavedPid() {
    const record = this.readSavedProcessRecord()
    return record?.pid || null
  }

  isProcessRunning(pid) {
    return this.processChecker(pid)
  }

  verifyProcessIdentity(savedRecord) {
    if (typeof this.processIdentityVerifier === "function") {
      return this.processIdentityVerifier(savedRecord)
    }

    if (!savedRecord || typeof savedRecord.pid !== "number" || savedRecord.pid <= 0) {
      return false
    }

    if (process.platform !== "win32") {
      return true
    }

    if (!savedRecord.javaPath || !savedRecord.launchedAt) {
      return false
    }

    try {
      const processInfo = this.processInfoFetcher(savedRecord.pid)
      if (!processInfo || !processInfo.path || !processInfo.startTime) {
        return false
      }

      if (!pathsMatch(processInfo.path, savedRecord.javaPath)) {
        return false
      }

      const savedTime = new Date(savedRecord.launchedAt).getTime()
      const osTime = new Date(processInfo.startTime).getTime()

      if (Number.isNaN(savedTime) || Number.isNaN(osTime)) {
        return false
      }

      const diffMs = Math.abs(savedTime - osTime)
      if (diffMs > this.launchToleranceMs) {
        return false
      }

      return true
    } catch (_) {
      return false
    }
  }

  initProcessMonitoring() {
    const savedRecord = this.readSavedProcessRecord()
    if (savedRecord) {
      const pid = savedRecord.pid
      const isAlive = this.isProcessRunning(pid)
      const isIdentityValid = isAlive && this.verifyProcessIdentity(savedRecord)

      if (isIdentityValid) {
        console.log(`[GameLauncher] Detected existing game process running with PID ${pid}`)
        this.launchStatus = "running"
        this.trackedPid = pid
        this.startProcessPoll(pid)
      } else {
        console.log(`[GameLauncher] Cleaned stale PID file for inactive/mismatched process ${pid}`)
        this.clearProcessPid()
        this.launchStatus = "idle"
        this.trackedPid = null
      }
    }
  }

  startProcessPoll(pid) {
    this.stopProcessPoll()
    this.trackedPid = pid
    this.pollTimer = setInterval(() => {
      if (!this.isProcessRunning(pid)) {
        console.log(`[GameLauncher] Monitored game process ${pid} exited`)
        this.stopProcessPoll()
        this.clearProcessPid()
        this.activeChildProcess = null
        this.setStatus("idle")
      }
    }, this.pollIntervalMs)
    if (this.pollTimer && this.pollTimer.unref) {
      this.pollTimer.unref()
    }
  }

  stopProcessPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.trackedPid = null
  }

  setStatus(status, details = null) {
    this.launchStatus = status
    if (typeof this.onStatusChangeCallback === "function") {
      this.onStatusChangeCallback(status, details)
    }
  }

  getLaunchStatus() {
    return {
      status: this.launchStatus,
      pid: this.activeChildProcess?.pid || this.trackedPid || null,
    }
  }

  /**
   * Pure Game Launch via XMCL.
   * Performs quick local validation, parses installed profile, and spawns process.
   * NEVER downloads or installs anything.
   */
  async launch({
    playerName = "Player",
    ramGB = DEFAULT_RAM_GB,
    minecraftVersion,
    modLoader,
    modLoaderVersion,
    neoForgeVersion,
    dedicatedGpu = true,
    customJavaPath,
    customArgs = [],
  }) {
    if (this.launchStatus === "running" || this.launchStatus === "preparing") {
      throw new Error("Game is already running or launching.")
    }

    if (!minecraftVersion || !String(minecraftVersion).trim()) {
      throw new Error("Cannot launch Minecraft: Missing required minecraftVersion.")
    }

    // Resolve effective loader (supports legacy neoForgeVersion path)
    const resolvedLoader = (modLoader || (neoForgeVersion ? "NEOFORGE" : "VANILLA")).toUpperCase()
    const resolvedLoaderVersion = String(modLoaderVersion || neoForgeVersion || "").trim()

    if (resolvedLoader !== "VANILLA" && !resolvedLoaderVersion) {
      throw new Error(`Cannot launch Minecraft: Missing required loader version for ${resolvedLoader}.`)
    }

    this.setStatus("preparing")

    try {
      const cleanMc = String(minecraftVersion).trim()

      console.log(`[GameLauncher] Initiating launch for MC: ${cleanMc}, Loader: ${resolvedLoader} ${resolvedLoaderVersion}`)

      // 1. Quick local readiness check (Strictly Local, NO Downloads)
      const readiness = await this.readinessChecker({
        instanceRoot: this.instanceRoot,
        minecraftVersion: cleanMc,
        modLoader: resolvedLoader,
        modLoaderVersion: resolvedLoaderVersion,
        neoForgeVersion,
      })

      if (!readiness.installed || !readiness.resolvedVersionId) {
        throw new Error(
          "Cannot launch Minecraft: Installation is incomplete. Please verify the game installation first.",
        )
      }

      const requiredJavaMajor = readiness.javaMajorVersion || 21

      // 2. Resolve & Validate Java Runtime (GUI javaw.exe)
      const javaRuntime = this.javaResolver(this.instanceRoot, {
        isGui: true,
        customPath: customJavaPath,
        majorVersion: requiredJavaMajor,
      })

      if (!javaRuntime.javaPath) {
        throw new Error(
          `Cannot launch Minecraft: Java runtime resolution failed (${javaRuntime.error || `Java ${requiredJavaMajor} not found`}).`,
        )
      }

      const javawPath = javaRuntime.javaPath
      const javaCliPath = javaRuntime.cliJavaPath || javawPath

      const javaValidation = this.javaValidator(javaCliPath, requiredJavaMajor)
      if (!javaValidation.valid) {
        throw new Error(
          `Cannot launch Minecraft: Java runtime validation failed (${javaValidation.error}).`,
        )
      }

      // Apply dedicated GPU preference on Windows if enabled
      if (process.platform === "win32" && javawPath && fs.existsSync(javawPath)) {
        setJavaGpuPreference(javawPath, Boolean(dedicatedGpu))
      }

      // 3. Resolve Installed Version Profile
      const resolvedVersion = await this.versionParser(this.instanceRoot, readiness.resolvedVersionId)
      if (!resolvedVersion) {
        throw new Error(`Failed to parse installed version profile: ${readiness.resolvedVersionId}`)
      }

      const safeRam = Math.min(Math.max(Number(ramGB) || DEFAULT_RAM_GB, 2), 64)
      const minMemoryMb = 2048
      const maxMemoryMb = safeRam * 1024

      const jvmOptimizationArgs = [
        "-XX:+UseG1GC",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:+ParallelRefProcEnabled",
        "-XX:+AlwaysPreTouch",
        "-XX:+DisableExplicitGC",
        "-XX:+UseStringDeduplication",
        "-XX:MaxGCPauseMillis=50",
        "-XX:G1HeapRegionSize=32M",
        "-XX:InitiatingHeapOccupancyPercent=30",
      ]

      const launchOptions = {
        gamePath: this.instanceRoot,
        resourcePath: this.instanceRoot,
        javaPath: javawPath,
        version: resolvedVersion,
        gameProfile: {
          name: String(playerName || "Player").slice(0, 16),
          id: "00000000-0000-0000-0000-000000000000",
        },
        minMemory: minMemoryMb,
        maxMemory: maxMemoryMb,
        extraJVMArgs: [...jvmOptimizationArgs, ...customArgs],
        extraExecOption: {
          detached: true,
          stdio: "ignore",
        },
      }

      console.log(`[GameLauncher] Spawning XMCL launch process with version: ${readiness.resolvedVersionId}`)
      const child = await this.xmclLauncher(launchOptions)

      if (!child || typeof child.on !== "function") {
        throw new Error("Minecraft Launcher failed to return a valid process handle.")
      }

      if (typeof child.unref === "function") {
        child.unref()
      }

      this.activeChildProcess = child
      this.saveProcessPid(child.pid, {
        minecraftVersion: cleanMc,
        modLoader: resolvedLoader,
        javaPath: javawPath,
      })
      this.setStatus("running")

      let terminationHandled = false

      child.on("close", (code) => {
        if (terminationHandled) return
        terminationHandled = true

        console.log(`[GameLauncher] Game process exited with code ${code}`)
        this.activeChildProcess = null
        this.clearProcessPid()
        this.stopProcessPoll()
        const isUnexpected = code !== 0
        this.setStatus(
          "idle",
          isUnexpected ? { unexpected: true, code } : { unexpected: false, code: 0 },
        )
      })

      child.on("error", (err) => {
        if (terminationHandled) return
        terminationHandled = true

        console.error("[GameLauncher] Game process encountered an error:", err)
        this.activeChildProcess = null
        this.clearProcessPid()
        this.stopProcessPoll()
        this.setStatus("idle", { unexpected: true, error: err })
      })

      return {
        success: true,
        pid: child.pid,
      }
    } catch (err) {
      this.activeChildProcess = null
      this.clearProcessPid()
      this.stopProcessPoll()
      this.setStatus("idle")
      throw err
    }
  }
}

module.exports = {
  GameLauncher,
  pathsMatch,
  defaultProcessChecker,
  defaultProcessInfoFetcher,
}
