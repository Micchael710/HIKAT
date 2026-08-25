const { Client: MinecraftLauncherClient } = require("minecraft-launcher-core")
const path = require("path")
const fs = require("fs")
const os = require("os")
const { setJavaGpuPreference } = require("./gpu-manager.cjs")

const DEFAULT_MC_VERSION = "1.21.1"
const DEFAULT_RAM_GB = 4

/**
 * Finds Java 21 executable if available inside game files (bundled JDK) or system.
 */
function findJavaExecutable(instanceRoot, customPath) {
  if (customPath && typeof customPath === "string" && fs.existsSync(customPath)) {
    return customPath
  }

  const exeName = process.platform === "win32" ? "javaw.exe" : "java"

  // 1. Check inside instanceRoot (game files) for JDK folders
  if (instanceRoot && fs.existsSync(instanceRoot)) {
    try {
      const rootEntries = fs.readdirSync(instanceRoot)
      const directJdkFolder = rootEntries.find((f) => f.toLowerCase().startsWith("jdk-") || f.toLowerCase() === "jdk21" || f.toLowerCase() === "java")
      if (directJdkFolder) {
        const candidateBin = path.join(instanceRoot, directJdkFolder, "bin", exeName)
        if (fs.existsSync(candidateBin)) {
          return candidateBin
        }
      }

      // Check native_files subfolder (Orion structure)
      const nativeFilesDir = path.join(instanceRoot, "native_files")
      if (fs.existsSync(nativeFilesDir)) {
        const nativeEntries = fs.readdirSync(nativeFilesDir)
        const nativeJdkFolder = nativeEntries.find((f) => f.toLowerCase().startsWith("jdk-") || f.toLowerCase() === "java")
        if (nativeJdkFolder) {
          const candidateBin = path.join(nativeFilesDir, nativeJdkFolder, "bin", exeName)
          if (fs.existsSync(candidateBin)) {
            return candidateBin
          }
        }
      }
    } catch (_) {}
  }

  // 2. Check candidate default HiKAT paths
  const appData = process.env.APPDATA || ""
  const candidateDirs = [
    path.join(appData, "HiKAT", "game files", "jdk-21"),
    path.join(appData, "HiKAT", "game files", "native_files", "jdk-21"),
    path.join(appData, "Byekat", "native_files"),
    path.join(process.env.JAVA_HOME || "", "bin"),
  ]

  for (const dir of candidateDirs) {
    if (!dir || !fs.existsSync(dir)) continue
    const full = path.join(dir, exeName)
    if (fs.existsSync(full)) {
      return full
    }
    const fullBin = path.join(dir, "bin", exeName)
    if (fs.existsSync(fullBin)) {
      return fullBin
    }
  }

  return process.platform === "win32" ? "javaw" : "java"
}

class GameLauncher {
  constructor(app, options = {}) {
    this.app = app
    this.instanceRoot = options.instanceRoot || path.join(process.env.APPDATA || "", "HiKAT", "game files")
    this.launcherClient = new MinecraftLauncherClient()
    this.activeChildProcess = null
    this.launchStatus = "idle" // 'idle' | 'preparing' | 'running'
    this.onStatusChangeCallback = null
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
      pid: this.activeChildProcess?.pid || null,
    }
  }

  /**
   * Launches Minecraft 1.21.1 with NeoForge.
   */
  async launch({
    playerName = "Player",
    ramGB = DEFAULT_RAM_GB,
    neoForgeVersion,
    dedicatedGpu = true,
    customJavaPath,
    customArgs = [],
  }) {
    if (this.launchStatus === "running" || this.launchStatus === "preparing") {
      throw new Error("Game is already running or launching.")
    }

    this.setStatus("preparing")

    const safeRam = Math.min(Math.max(Number(ramGB) || DEFAULT_RAM_GB, 2), 64)
    const javaPath = findJavaExecutable(this.instanceRoot, customJavaPath)

    // Apply or rollback GPU dedicated preference for this specific javaw.exe
    if (process.platform === "win32" && javaPath && fs.existsSync(javaPath)) {
      setJavaGpuPreference(javaPath, Boolean(dedicatedGpu))
    }

    const minMemoryMb = 2048
    const maxMemoryMb = safeRam * 1024

    const authorization = {
      access_token: "0",
      client_token: "0",
      uuid: "00000000-0000-0000-0000-000000000000",
      name: String(playerName || "Player").slice(0, 16),
      user_properties: "{}",
      meta: {
        type: "offline",
        offline: true,
      },
    }

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
      root: this.instanceRoot,
      version: {
        number: DEFAULT_MC_VERSION,
        type: "release",
      },
      memory: {
        min: `${minMemoryMb}M`,
        max: `${maxMemoryMb}M`,
      },
      authorization,
      overrides: {
        gameDirectory: this.instanceRoot,
      },
      customArgs: [...jvmOptimizationArgs, ...customArgs],
    }

    if (javaPath && javaPath !== "javaw" && javaPath !== "java") {
      launchOptions.javaPath = javaPath
    }

    // Configure NeoForge / Forge if specified
    if (neoForgeVersion && typeof neoForgeVersion === "string" && neoForgeVersion.trim()) {
      launchOptions.forge = neoForgeVersion.trim()
    }

    try {
      const child = await this.launcherClient.launch(launchOptions)

      if (!child || typeof child.on !== "function") {
        throw new Error("Minecraft Launcher failed to return a valid process handle.")
      }

      this.activeChildProcess = child
      this.setStatus("running")

      child.on("close", (code) => {
        console.log(`[GameLauncher] Game process exited with code ${code}`)
        this.activeChildProcess = null
        this.setStatus("idle")
      })

      child.on("error", (err) => {
        console.error("[GameLauncher] Game process encountered an error:", err)
        this.activeChildProcess = null
        this.setStatus("idle")
      })

      return {
        success: true,
        pid: child.pid,
      }
    } catch (err) {
      this.activeChildProcess = null
      this.setStatus("idle")
      throw err
    }
  }
}

module.exports = {
  GameLauncher,
  findJavaExecutable,
}
