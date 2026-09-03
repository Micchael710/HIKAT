const path = require("path")
const fs = require("fs")
const { Version, launch: xmclLaunch } = require("@xmcl/core")
const { setJavaGpuPreference } = require("./gpu-manager.cjs")
const { resolveJavaRuntime, validateJavaBinary } = require("./java-runtime.cjs")
const { checkCore } = require("./minecraft-core.cjs")

const DEFAULT_RAM_GB = 4

function defaultProcessChecker(pid) {
  if (!pid || typeof pid !== "number" || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === "EPERM"
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
    this.pollIntervalMs = options.pollIntervalMs || 1000
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
          launchedAt: new Date().toISOString(),
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

  readSavedPid() {
    try {
      const filePath = this.getPidFilePath()
      if (!fs.existsSync(filePath)) return null
      const content = fs.readFileSync(filePath, "utf8")
      const parsed = JSON.parse(content)
      return typeof parsed.pid === "number" ? parsed.pid : null
    } catch (_) {
      return null
    }
  }

  isProcessRunning(pid) {
    return this.processChecker(pid)
  }

  initProcessMonitoring() {
    const savedPid = this.readSavedPid()
    if (savedPid) {
      if (this.isProcessRunning(savedPid)) {
        console.log(`[GameLauncher] Detected existing game process running with PID ${savedPid}`)
        this.launchStatus = "running"
        this.trackedPid = savedPid
        this.startProcessPoll(savedPid)
      } else {
        console.log(`[GameLauncher] Cleaned stale PID file for inactive process ${savedPid}`)
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

  setStatus(status) {
    this.launchStatus = status
    if (typeof this.onStatusChangeCallback === "function") {
      this.onStatusChangeCallback(status)
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
      }

      console.log(`[GameLauncher] Spawning XMCL launch process with version: ${readiness.resolvedVersionId}`)
      const child = await this.xmclLauncher(launchOptions)

      if (!child || typeof child.on !== "function") {
        throw new Error("Minecraft Launcher failed to return a valid process handle.")
      }

      this.activeChildProcess = child
      this.saveProcessPid(child.pid, {
        minecraftVersion: cleanMc,
        modLoader: resolvedLoader,
      })
      this.setStatus("running")

      child.on("close", (code) => {
        console.log(`[GameLauncher] Game process exited with code ${code}`)
        this.activeChildProcess = null
        this.clearProcessPid()
        this.stopProcessPoll()
        this.setStatus("idle")
      })

      child.on("error", (err) => {
        console.error("[GameLauncher] Game process encountered an error:", err)
        this.activeChildProcess = null
        this.clearProcessPid()
        this.stopProcessPoll()
        this.setStatus("idle")
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
}
