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

function getJavaRuntimeDir(appDataRoot, majorVersion = 21) {
  if (!appDataRoot) return null
  const base =
    path.basename(appDataRoot).toLowerCase() === "game files"
      ? path.dirname(appDataRoot)
      : appDataRoot

  return path.join(base, "runtime", "java", String(majorVersion))
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

function validateJavaBinary(executablePath, expectedMajorVersion = 21) {
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
    const valid = res.status === 0 && major === expectedMajorVersion
    return {
      valid,
      majorVersion: major,
      output: output.trim(),
      error: valid ? null : `Expected Java ${expectedMajorVersion}, found version ${major ?? "unknown"}`,
    }
  } catch (err) {
    return { valid: false, majorVersion: null, output: "", error: err.message }
  }
}

function resolveJavaRuntime(root, { isGui = false, customPath, majorVersion = 21 } = {}) {
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
    searchRoots.push(getJavaRuntimeDir(root, majorVersion))
    searchRoots.push(path.join(root, "runtime", "java", String(majorVersion)))
    if (path.basename(root).toLowerCase() === "game files") {
      searchRoots.push(path.join(path.dirname(root), "runtime", "java", String(majorVersion)))
    }
    // Legacy fallback directory only when majorVersion === 21
    if (majorVersion === 21) {
      searchRoots.push(path.join(root, "jdk-21"))
    }
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
    error: `Official HiKAT Java ${majorVersion} runtime not found.`,
  }
}

async function ensureJavaRuntime({ appDataRoot, majorVersion = 21, component, signal, onProgress } = {}) {
  const existing = resolveJavaRuntime(appDataRoot, { isGui: false, majorVersion })
  if (existing.cliJavaPath) {
    const check = validateJavaBinary(existing.cliJavaPath, majorVersion)
    if (check.valid) return existing
  }

  const destination = getJavaRuntimeDir(appDataRoot, majorVersion)
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
  if (!platformTargets) throw new Error(`Unsupported platform for Java ${majorVersion} runtime: ${platformKey}`)

  let targetList = null
  if (component && platformTargets[component]) {
    targetList = platformTargets[component]
  } else {
    targetList =
      platformTargets["java-runtime-delta"] ||
      platformTargets["java-runtime-gamma"] ||
      platformTargets["java-runtime-alpha"] ||
      platformTargets["jre-legacy"]
  }

  const target = Array.isArray(targetList) ? targetList[0] : targetList
  if (!target) throw new Error(`No Java runtime target found for component: ${component || "default"}`)

  await fsp.mkdir(destination, { recursive: true })
  const workflow = createJavaRuntimeInstallWorkflow({ target, destination })
  const runtime = createHiKatInstallRuntime({
    signal,
    onTransferProgress: (progress) => {
      if (typeof onProgress === "function") {
        onProgress({
          phase: "INSTALLING",
          progress,
        })
      }
    },
    progressStart: 30,
    progressEnd: 40,
  })
  await executeInstallWorkflow(workflow, runtime, { signal })

  const installed = resolveJavaRuntime(appDataRoot, { isGui: false, majorVersion })
  if (!installed.cliJavaPath) {
    throw new Error(`Java ${majorVersion} installation completed but binary was not found.`)
  }

  const finalCheck = validateJavaBinary(installed.cliJavaPath, majorVersion)
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
