const child_process = require("child_process")
const path = require("path")
const fs = require("fs")
const os = require("os")

/**
 * Manages Windows DirectX User GPU Preferences for the exact javaw.exe executable used by HiKAT.
 * - enable === true: Sets GpuPreference=2; (High performance dedicated GPU).
 * - enable === false: Sets GpuPreference=1; (Power saving / Integrated GPU).
 *
 * Uses a temporary PowerShell script executed with execution policy bypass and verifies
 * that the registry value was correctly written before returning.
 */
function setJavaGpuPreference(javawPath, enable = true) {
  if (process.platform !== "win32" || !javawPath) {
    return false
  }

  const expectedPreference = enable ? "GpuPreference=2;" : "GpuPreference=1;"
  const normalizedPath = path.normalize(javawPath)
  const escapedPath = normalizedPath.replace(/'/g, "''")
  const tempScriptPath = path.join(
    os.tmpdir(),
    `hikat-gpu-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.ps1`,
  )

  try {
    const scriptContent = `
$registryPath = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
if (-not (Test-Path $registryPath)) {
  New-Item -Path $registryPath -Force | Out-Null
}
Set-ItemProperty -Path $registryPath -Name '${escapedPath}' -Value '${expectedPreference}' -Type String -Force
(Get-ItemProperty -Path $registryPath -Name '${escapedPath}' -ErrorAction SilentlyContinue).'${escapedPath}'
`

    fs.writeFileSync(tempScriptPath, scriptContent.trim(), "utf8")

    const stdout = child_process.execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tempScriptPath],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      },
    )

    const actualValue = typeof stdout === "string" ? stdout.trim() : ""

    if (actualValue !== expectedPreference) {
      console.warn(
        `[GPU Manager] Preference verification failed for '${normalizedPath}'. Expected: '${expectedPreference}', Found: '${actualValue}'`,
      )
      return false
    }

    return true
  } catch (err) {
    console.warn(`[GPU Manager] Failed to update GPU preference (enable=${enable}):`, err.message)
    return false
  } finally {
    try {
      if (fs.existsSync(tempScriptPath)) {
        fs.unlinkSync(tempScriptPath)
      }
    } catch (_) {}
  }
}

/**
 * Detects the dedicated GPU vendor on Windows ('nvidia' | 'amd' | null).
 */
function detectDedicatedGpu() {
  if (process.platform !== "win32") {
    return null
  }

  try {
    const output = child_process.execSync("wmic path win32_VideoController get name", {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const gpuList = output.toLowerCase()

    if (
      gpuList.includes("nvidia") ||
      gpuList.includes("geforce") ||
      gpuList.includes("rtx") ||
      gpuList.includes("gtx")
    ) {
      return "nvidia"
    } else if (gpuList.includes("amd") || gpuList.includes("radeon")) {
      return "amd"
    }
  } catch (_) {
    try {
      const psOutput = child_process.execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ],
        {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
      const gpuList = (psOutput || "").toLowerCase()
      if (
        gpuList.includes("nvidia") ||
        gpuList.includes("geforce") ||
        gpuList.includes("rtx") ||
        gpuList.includes("gtx")
      ) {
        return "nvidia"
      } else if (gpuList.includes("amd") || gpuList.includes("radeon")) {
        return "amd"
      }
    } catch (_) {}
  }

  return null
}

/**
 * Injects or clears process environment variables needed to bypass Windows
 * AppCompat shims and enforce dedicated GPU rendering for Minecraft/Java OpenGL.
 */
function applyGpuEnvironment(enable = true) {
  if (process.platform !== "win32") {
    return
  }

  if (enable) {
    const gpuVendor = detectDedicatedGpu()
    process.env.SHIM_MCCOMPAT_DISABLE = "1"
    process.env.MESA_GLSL_CACHE_DISABLE = "false"

    if (gpuVendor === "nvidia") {
      process.env.__GL_SHADER_DISK_CACHE = "1"
      process.env.__GL_THREADED_OPTIMIZATION = "1"
      process.env.CUDA_VISIBLE_DEVICES = "0"
    } else if (gpuVendor === "amd") {
      process.env.AMD_VULKAN_ICD = "RADV"
    }
  } else {
    delete process.env.SHIM_MCCOMPAT_DISABLE
    delete process.env.__GL_SHADER_DISK_CACHE
    delete process.env.__GL_THREADED_OPTIMIZATION
    delete process.env.CUDA_VISIBLE_DEVICES
    delete process.env.AMD_VULKAN_ICD
    delete process.env.MESA_GLSL_CACHE_DISABLE
  }
}

/**
 * Returns OS/display subsystem JVM flags when dedicated GPU is enabled.
 */
function getGpuOptimizedJvmArgs(enable = true) {
  if (!enable || process.platform !== "win32") {
    return []
  }
  return ["-Dos.name=Windows 10", "-Dos.version=10.0"]
}

module.exports = {
  setJavaGpuPreference,
  detectDedicatedGpu,
  applyGpuEnvironment,
  getGpuOptimizedJvmArgs,
}
