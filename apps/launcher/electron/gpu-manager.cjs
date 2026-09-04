const child_process = require("child_process")
const path = require("path")

/**
 * Manages Windows DirectX User GPU Preferences for the exact javaw.exe executable used by HiKAT.
 * - enable === true: Sets GpuPreference=2; (High performance dedicated GPU).
 * - enable === false: Sets GpuPreference=1; (Power saving / Integrated GPU).
 */
function setJavaGpuPreference(javawPath, enable = true) {
  if (process.platform !== "win32" || !javawPath) {
    return false
  }

  try {
    const normalizedPath = path.normalize(javawPath).replace(/'/g, "''")
    const preferenceValue = enable ? "GpuPreference=2;" : "GpuPreference=1;"

    const script = `
$regPath = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name '${normalizedPath}' -Value '${preferenceValue}' -Type String -Force
`

    child_process.execSync(`powershell -NoProfile -NonInteractive -Command "${script.trim()}"`, {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    })

    return true
  } catch (err) {
    console.warn(`[GPU Manager] Failed to update GPU preference (enable=${enable}):`, err.message)
    return false
  }
}

module.exports = {
  setJavaGpuPreference,
}
