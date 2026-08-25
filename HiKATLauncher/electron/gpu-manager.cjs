const { execSync } = require("child_process")
const path = require("path")
const fs = require("fs")

/**
 * Manages Windows DirectX User GPU Preferences for the exact javaw.exe executable used by HiKAT.
 * - enable === true: Sets GpuPreference=2; (High performance dedicated GPU).
 * - enable === false: Reverts / removes the registry property for that javaw.exe.
 */
function setJavaGpuPreference(javawPath, enable = true) {
  if (process.platform !== "win32" || !javawPath) {
    return false
  }

  try {
    const escapedPath = javawPath.replace(/\\/g, "\\\\")
    let script = ""

    if (enable) {
      script = `
$regPath = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name '${escapedPath}' -Value 'GpuPreference=2;' -Type String -Force
`
    } else {
      script = `
$regPath = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
if (Test-Path $regPath) {
  Remove-ItemProperty -Path $regPath -Name '${escapedPath}' -ErrorAction SilentlyContinue | Out-Null
}
`
    }

    execSync(`powershell -NoProfile -NonInteractive -Command "${script.trim()}"`, {
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
