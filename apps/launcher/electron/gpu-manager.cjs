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

module.exports = {
  setJavaGpuPreference,
}
