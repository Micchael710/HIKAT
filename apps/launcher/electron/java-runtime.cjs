const fs = require("fs")
const fsp = require("fs/promises")
const path = require("path")
const child_process = require("child_process")
const axios = require("axios")
const { getPlatform } = require("@xmcl/core")
const {
  DEFAULT_RUNTIME_ALL_URL,
  createJavaRuntimeInstallWorkflow,
  executeInstallWorkflow,
} = require("@xmcl/installer")
const { createHiKatInstallRuntime } = require("./xmcl-install-runtime.cjs")

function getJavaRuntimeDir(appDataRoot) {
  if (!appDataRoot) return null
  if (path.basename(appDataRoot).toLowerCase() === "game files") {
    return path.join(path.dirname(appDataRoot), "runtime", "java", "21")
  }
  return path.join(appDataRoot, "runtime", "java", "21")
}

function parseJavaMajorVersion(output) {
  if (!output || typeof output !== "string") return null
  const match = output.match(/version\s+"(\d+)(?:\.([0-9_]+))?.*"/i)
  if (!match) return null
  const firstNum = parseInt(match[1], 10)
  if (firstNum === 1 && match[2]) {
    return parseInt(match[2].split("_")[0], 10)
  }
  return firstNum
}

function validateJavaBinary(executablePath) {
  if (!executablePath || typeof executablePath !== "string") {
    return { valid: false, majorVersion: null, output: "", error: "No executable path provided" }
  }
  if (!fs.existsSync(executablePath)) {
    return { valid: false, majorVersion: null, output: "", error: "File does not exist" }
  }

  try {
    const res = child_process.spawnSync(executablePath, ["-version"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    })
    const output = (res.stderr || "") + "\n" + (res.stdout || "")
    const major = parseJavaMajorVersion(output)
    const valid = res.status === 0 && major === 21
    return {
      valid,
      majorVersion: major,
      output: output.trim(),
      error: valid ? null : `Expected Java 21, found version ${major ?? "unknown"}`,
    }
  } catch (err) {
    return { valid: false, majorVersion: null, output: "", error: err.message }
  }
}

function resolveJavaRuntime(root, { isGui = false, customPath } = {}) {
  const isWin = process.platform === "win32"
  const exeName = isGui && isWin ? "javaw.exe" : isWin ? "java.exe" : "java"
  const cliExeName = isWin ? "java.exe" : "java"

  if (customPath && typeof customPath === "string") {
    if (fs.existsSync(customPath)) {
      return { javaPath: customPath, cliJavaPath: customPath, isOfficialJdk: false }
    }
    return { javaPath: null, cliJavaPath: null, isOfficialJdk: false, error: `Custom Java executable not found: ${customPath}` }
  }

  const searchRoots = []
  if (root && typeof root === "string") {
    searchRoots.push(getJavaRuntimeDir(root))
    searchRoots.push(path.join(root, "runtime", "java", "21"))
    if (path.basename(root).toLowerCase() === "game files") {
      searchRoots.push(path.join(path.dirname(root), "runtime", "java", "21"))
    }
    // Legacy fallback directory
    searchRoots.push(path.join(root, "jdk-21"))
  }

  for (const candidateDir of searchRoots) {
    if (!candidateDir) continue
    const binDir = path.join(candidateDir, "bin")
    const officialBin = path.join(binDir, exeName)
    const officialCliBin = path.join(binDir, cliExeName)
    if (fs.existsSync(officialBin) && fs.existsSync(officialCliBin)) {
      return {
        javaPath: officialBin,
        cliJavaPath: officialCliBin,
        isOfficialJdk: true,
        runtimeDir: candidateDir,
      }
    }
    const directBin = path.join(candidateDir, exeName)
    const directCliBin = path.join(candidateDir, cliExeName)
    if (fs.existsSync(directBin) && fs.existsSync(directCliBin)) {
      return {
        javaPath: directBin,
        cliJavaPath: directCliBin,
        isOfficialJdk: true,
        runtimeDir: candidateDir,
      }
    }
  }

  return {
    javaPath: null,
    cliJavaPath: null,
    isOfficialJdk: false,
    error: "Official HiKAT Java 21 runtime not found.",
  }
}

async function ensureJavaRuntime({ appDataRoot, signal, onProgress, component = "java-runtime-delta" } = {}) {
  const existing = resolveJavaRuntime(appDataRoot, { isGui: false })
  if (existing.cliJavaPath) {
    const check = validateJavaBinary(existing.cliJavaPath)
    if (check.valid) return existing
  }

  const destination = getJavaRuntimeDir(appDataRoot)
  if (!destination) throw new Error("Invalid appDataRoot for Java installation")

  // Fetch official Mojang runtime index
  const res = await axios.get(DEFAULT_RUNTIME_ALL_URL, { signal })
  const allData = res.data
  const platform = getPlatform()
  const platformKey =
    platform.name === "windows"
      ? platform.arch === "x64" ? "windows-x64" : "windows-x86"
      : platform.name === "osx"
        ? platform.arch === "arm64" ? "mac-os-arm64" : "mac-os"
        : platform.arch === "x64" ? "linux" : "linux-i386"

  const platformTargets = allData[platformKey] || allData["windows-x64"]
  if (!platformTargets) throw new Error(`Unsupported platform for Java 21 runtime: ${platformKey}`)

  const targetList =
    platformTargets[component] ||
    platformTargets["java-runtime-delta"] ||
    platformTargets["java-runtime-gamma"] ||
    platformTargets["java-runtime-alpha"]

  const target = Array.isArray(targetList) ? targetList[0] : targetList
  if (!target) throw new Error(`No Java runtime target found for component: ${component}`)

  await fsp.mkdir(destination, { recursive: true })
  const workflow = createJavaRuntimeInstallWorkflow({ target, destination })
  const runtime = createHiKatInstallRuntime({ signal })
  await executeInstallWorkflow(workflow, runtime, { signal })

  const installed = resolveJavaRuntime(appDataRoot, { isGui: false })
  if (!installed.cliJavaPath) {
    throw new Error("Java 21 installation completed but binary was not found.")
  }

  const finalCheck = validateJavaBinary(installed.cliJavaPath)
  if (!finalCheck.valid) {
    throw new Error(`Installed Java binary failed validation: ${finalCheck.error}`)
  }

  return installed
}

module.exports = {
  getJavaRuntimeDir,
  parseJavaMajorVersion,
  validateJavaBinary,
  resolveJavaRuntime,
  ensureJavaRuntime,
}
