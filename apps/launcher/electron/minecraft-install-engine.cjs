const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const { execFileSync } = require("child_process")
const { Version, diagnose, diagnoseLibraries, diagnoseAssets } = require("@xmcl/core")
const {
  getVersionList,
  installVersionTask,
  installNeoForgedTask,
  installLibrariesTask,
  installAssetsTask,
  diagnoseInstall,
} = require("@xmcl/installer")

/**
 * Returns path to .hikat/core-state.json.
 */
function getCoreStatePath(instanceRoot) {
  return path.join(instanceRoot, ".hikat", "core-state.json")
}

/**
 * Loads cached core state metadata from .hikat/core-state.json if available.
 */
async function loadCoreState(instanceRoot) {
  try {
    const raw = await fsp.readFile(getCoreStatePath(instanceRoot), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch (_) {
    return null
  }
}

/**
 * Saves core state metadata safely via atomic write.
 */
async function saveCoreState(instanceRoot, state) {
  const metaDir = path.join(instanceRoot, ".hikat")
  await fsp.mkdir(metaDir, { recursive: true })
  const statePath = getCoreStatePath(instanceRoot)
  const tempPath = path.join(
    metaDir,
    `core-state.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8")
  try {
    await fsp.rename(tempPath, statePath)
  } catch (_) {
    if (fs.existsSync(statePath)) {
      await fsp.unlink(statePath)
    }
    await fsp.rename(tempPath, statePath)
  }
}

/**
 * Reads install_profile.json directly from a Forge/NeoForge installer jar using yauzl.
 */
function readInstallProfileFromJar(jarPath) {
  return new Promise((resolve, reject) => {
    if (!jarPath || !fs.existsSync(jarPath)) {
      return resolve(null)
    }

    let yauzl
    try {
      yauzl = require("yauzl")
    } catch (_) {
      try {
        const yauzlPath = require.resolve("yauzl", {
          paths: [require.resolve("@xmcl/installer")],
        })
        yauzl = require(yauzlPath)
      } catch (err) {
        return reject(err)
      }
    }

    yauzl.open(jarPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return resolve(null)
      let found = false

      zipfile.readEntry()
      zipfile.on("entry", (entry) => {
        if (entry.fileName === "install_profile.json") {
          found = true
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) return resolve(null)
            const chunks = []
            readStream.on("data", (chunk) => chunks.push(chunk))
            readStream.on("end", () => {
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
                resolve(parsed)
              } catch (_) {
                resolve(null)
              }
            })
            readStream.on("error", () => resolve(null))
          })
        } else {
          zipfile.readEntry()
        }
      })
      zipfile.on("end", () => {
        if (!found) resolve(null)
      })
      zipfile.on("error", () => resolve(null))
    })
  })
}

/**
 * Parses major version from Java CLI output (e.g. 21.0.3 -> 21, 1.8.0 -> 8).
 */
function parseJavaMajorVersion(output) {
  if (!output || typeof output !== "string") return null
  const match = output.match(/(?:version\s+|")([0-9]+)(?:\.([0-9]+))?/i)
  if (!match) return null
  let major = parseInt(match[1], 10)
  if (major === 1 && match[2]) {
    major = parseInt(match[2], 10)
  }
  return Number.isFinite(major) ? major : null
}

/**
 * Resolves Java runtime strictly from official HiKAT distribution:
 * <instanceRoot>/jdk-21/bin/java.exe (CLI/processors) and javaw.exe (GUI).
 * Does NOT silently fall back to system Java.
 */
function resolveJavaRuntime(instanceRoot, { isGui = false, customPath } = {}) {
  const exeName = process.platform === "win32" ? (isGui ? "javaw.exe" : "java.exe") : (isGui ? "javaw" : "java")
  const cliExeName = process.platform === "win32" ? "java.exe" : "java"

  // 1. Explicit Custom Path if provided
  if (customPath && typeof customPath === "string") {
    if (fs.existsSync(customPath)) {
      return {
        javaPath: customPath,
        cliJavaPath: customPath,
        isOfficialJdk: false,
      }
    }
    return {
      javaPath: null,
      cliJavaPath: null,
      isOfficialJdk: false,
      error: `Custom Java executable not found: ${customPath}`,
    }
  }

  // 2. Official HiKAT JDK 21 in instanceRoot/jdk-21
  if (instanceRoot) {
    const officialBin = path.join(instanceRoot, "jdk-21", "bin", exeName)
    const officialCliBin = path.join(instanceRoot, "jdk-21", "bin", cliExeName)
    if (fs.existsSync(officialBin) && fs.existsSync(officialCliBin)) {
      return {
        javaPath: officialBin,
        cliJavaPath: officialCliBin,
        isOfficialJdk: true,
      }
    }
  }

  // Fail closed if official JDK is absent
  return {
    javaPath: null,
    cliJavaPath: null,
    isOfficialJdk: false,
    error: `Official Java 21 runtime not found at ${path.join(instanceRoot || "", "jdk-21", "bin")}`,
  }
}

/**
 * Validates that the Java binary is functional and is exactly the required Java version (Java 21).
 */
function validateJavaBinary(javaCliPath, requiredMajor = 21, execRunner = execFileSync) {
  if (!javaCliPath || !fs.existsSync(javaCliPath)) {
    return {
      valid: false,
      error: `Java binary not found: ${javaCliPath || "null"}`,
    }
  }

  try {
    const stdout = execRunner(javaCliPath, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    })
    const major = parseJavaMajorVersion(String(stdout || ""))
    if (major !== requiredMajor) {
      return {
        valid: false,
        major,
        error: `Incompatible Java version (found Java ${major}, expected Java ${requiredMajor}).`,
      }
    }
    return { valid: true, major, versionOutput: String(stdout) }
  } catch (err) {
    // java -version outputs to stderr on most JVMs
    const stderr = err.stderr || ""
    const major = parseJavaMajorVersion(String(stderr || err.message || ""))
    if (major !== null) {
      if (major !== requiredMajor) {
        return {
          valid: false,
          major,
          error: `Incompatible Java version (found Java ${major}, expected Java ${requiredMajor}).`,
        }
      }
      return { valid: true, major, versionOutput: String(stderr) }
    }
    return {
      valid: false,
      error: err.message || "Failed to execute java -version",
    }
  }
}

/**
 * Derives the expected NeoForge profile ID or candidate directory names.
 */
function getNeoForgeProfileCandidates(minecraftVersion, neoForgeVersion) {
  const cleanMc = String(minecraftVersion || "").trim()
  const cleanNf = String(neoForgeVersion || "").trim()
  if (!cleanMc || !cleanNf) return []
  return [
    `${cleanMc}-neoforge-${cleanNf}`,
    `neoforge-${cleanNf}`,
    `${cleanMc}-NeoForge-${cleanNf}`,
    `${cleanMc}-neoforged-${cleanNf}`,
  ]
}

/**
 * Returns the path to the cached NeoForge installer jar in the instance libraries directory.
 */
function getNeoForgeInstallerJarPath(instanceRoot, neoForgeVersion) {
  const cleanNf = String(neoForgeVersion || "").trim()
  return path.join(
    instanceRoot,
    "libraries",
    "net",
    "neoforged",
    "neoforge",
    cleanNf,
    `neoforge-${cleanNf}-installer.jar`,
  )
}

/**
 * Checks readiness of Minecraft Vanilla + NeoForge + Libraries + Assets on the local filesystem.
 * Filesystem + Diagnostics is the ultimate authority. Fail-closed on missing InstallProfile or broken processors.
 */
async function checkMinecraftCoreReadiness({ instanceRoot, minecraftVersion, neoForgeVersion }) {
  if (!minecraftVersion || !String(minecraftVersion).trim()) {
    return {
      isCoreInstalled: false,
      hasExistingInstall: false,
      resolvedVersionId: null,
      needsVanilla: true,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: ["Missing required minecraftVersion from backend."],
    }
  }

  if (!neoForgeVersion || !String(neoForgeVersion).trim()) {
    return {
      isCoreInstalled: false,
      hasExistingInstall: false,
      resolvedVersionId: null,
      needsVanilla: true,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: ["Missing required neoForgeVersion from backend."],
    }
  }

  if (!instanceRoot || !fs.existsSync(instanceRoot)) {
    return {
      isCoreInstalled: false,
      hasExistingInstall: false,
      resolvedVersionId: null,
      needsVanilla: true,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: ["Instance root directory does not exist."],
    }
  }

  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()
  const coreState = await loadCoreState(instanceRoot)

  // 1. Check Vanilla Version JSON & Client JAR
  const vanillaDir = path.join(instanceRoot, "versions", cleanMc)
  const vanillaJson = path.join(vanillaDir, `${cleanMc}.json`)
  const vanillaJar = path.join(vanillaDir, `${cleanMc}.jar`)
  const hasVanillaFiles = fs.existsSync(vanillaJson) && fs.existsSync(vanillaJar)

  // 2. Resolve Candidate NeoForge Profile
  let candidateProfileId = coreState?.resolvedVersionId || null
  if (
    !candidateProfileId ||
    coreState?.minecraftVersion !== cleanMc ||
    coreState?.neoForgeVersion !== cleanNf
  ) {
    const candidates = getNeoForgeProfileCandidates(cleanMc, cleanNf)
    for (const cand of candidates) {
      const candJson = path.join(instanceRoot, "versions", cand, `${cand}.json`)
      if (fs.existsSync(candJson)) {
        candidateProfileId = cand
        break
      }
    }
  }

  const hasExistingInstall = hasVanillaFiles || Boolean(candidateProfileId)

  if (!hasVanillaFiles) {
    return {
      isCoreInstalled: false,
      hasExistingInstall,
      resolvedVersionId: candidateProfileId,
      needsVanilla: true,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: ["Vanilla Minecraft files missing or incomplete."],
    }
  }

  if (!candidateProfileId) {
    return {
      isCoreInstalled: false,
      hasExistingInstall,
      resolvedVersionId: null,
      needsVanilla: false,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: ["NeoForge version profile not found."],
    }
  }

  // 3. Obtain & Verify InstallProfile (Fail closed if missing or corrupt)
  let installProfile = coreState?.installProfile || null
  if (!installProfile || installProfile.minecraft !== cleanMc || String(installProfile.version) !== cleanNf) {
    // Attempt reconstruction from cached installer jar
    const installerJar = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)
    if (fs.existsSync(installerJar)) {
      try {
        installProfile = await readInstallProfileFromJar(installerJar)
        if (installProfile) {
          // Update cached core state with reconstructed install profile
          await saveCoreState(instanceRoot, {
            ...(coreState || {}),
            minecraftVersion: cleanMc,
            neoForgeVersion: cleanNf,
            resolvedVersionId: candidateProfileId,
            installProfile,
          })
        }
      } catch (_) {}
    }
  }

  if (!installProfile || typeof installProfile !== "object") {
    return {
      isCoreInstalled: false,
      hasExistingInstall: true,
      resolvedVersionId: candidateProfileId,
      needsVanilla: false,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: ["NeoForge InstallProfile metadata is missing or corrupted. Reinstallation required."],
    }
  }

  // 4. Check Post-Processor Outputs via diagnoseInstall
  let processorIssues = []
  try {
    const profileReport = await diagnoseInstall(installProfile, instanceRoot)
    if (profileReport && Array.isArray(profileReport.issues)) {
      processorIssues = profileReport.issues.filter(
        (issue) => issue.type === "missing" || issue.type === "corrupted",
      )
    }
  } catch (err) {
    processorIssues.push({
      role: "processor",
      type: "corrupted",
      hint: `InstallProfile diagnostics failed: ${err.message}`,
    })
  }

  if (processorIssues.length > 0) {
    return {
      isCoreInstalled: false,
      hasExistingInstall: true,
      resolvedVersionId: candidateProfileId,
      needsVanilla: false,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: processorIssues.map((i) => i.hint || "Processor output corrupted or missing"),
      processorIssuesCount: processorIssues.length,
      installProfile,
    }
  }

  // 5. Try parsing the version profile hierarchy via Version.parse
  let resolvedVersion = null
  try {
    resolvedVersion = await Version.parse(instanceRoot, candidateProfileId)
  } catch (err) {
    return {
      isCoreInstalled: false,
      hasExistingInstall: true,
      resolvedVersionId: candidateProfileId,
      needsVanilla: false,
      needsNeoForge: true,
      needsLibraries: false,
      needsAssets: false,
      issues: [`Version.parse failed: ${err.message}`],
      installProfile,
    }
  }

  // 6. Run Diagnostics for Libraries & Assets
  let missingLibraries = []
  let missingAssets = []

  try {
    const report = await diagnose(candidateProfileId, instanceRoot)
    if (report && Array.isArray(report.issues)) {
      for (const issue of report.issues) {
        if (issue.type === "missing" || issue.type === "corrupted") {
          if (issue.role === "library") {
            missingLibraries.push(issue)
          } else if (issue.role === "asset" || issue.role === "assetIndex") {
            missingAssets.push(issue)
          }
        }
      }
    }
  } catch (_) {
    try {
      const libIssues = await diagnoseLibraries(resolvedVersion, instanceRoot)
      if (Array.isArray(libIssues)) {
        missingLibraries = libIssues.filter((i) => i.type === "missing" || i.type === "corrupted")
      }
    } catch (_) {}
  }

  const needsLibraries = missingLibraries.length > 0
  const needsAssets = missingAssets.length > 0
  const isCoreInstalled = !needsLibraries && !needsAssets && Boolean(resolvedVersion)

  const issues = [
    ...missingLibraries.map((l) => `Library missing: ${l.hint || l.file || "unknown"}`),
    ...missingAssets.map((a) => `Asset missing: ${a.hint || a.file || "unknown"}`),
  ]

  return {
    isCoreInstalled,
    hasExistingInstall: true,
    resolvedVersionId: candidateProfileId,
    needsVanilla: false,
    needsNeoForge: false,
    needsLibraries,
    needsAssets,
    missingLibraries,
    missingAssets,
    missingLibrariesCount: missingLibraries.length,
    missingAssetsCount: missingAssets.length,
    processorIssuesCount: 0,
    installProfile,
    issues,
  }
}

/**
 * Calculates estimated bytes to download for missing Core components derived strictly from authoritative metadata.
 * NO arbitrary hardcoded constants.
 */
async function estimateCoreDownloadBytes({ instanceRoot, minecraftVersion, neoForgeVersion }) {
  if (!minecraftVersion || !neoForgeVersion) {
    return { totalCoreBytes: 0, readiness: null }
  }

  const readiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion,
    neoForgeVersion,
  })

  if (readiness.isCoreInstalled) {
    return { totalCoreBytes: 0, readiness }
  }

  let totalBytes = 0
  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()

  // 1. Vanilla package metadata
  let mojangPackage = null
  const vanillaJsonPath = path.join(instanceRoot, "versions", cleanMc, `${cleanMc}.json`)
  if (fs.existsSync(vanillaJsonPath)) {
    try {
      mojangPackage = JSON.parse(await fsp.readFile(vanillaJsonPath, "utf8"))
    } catch (_) {}
  }

  if (!mojangPackage && readiness.needsVanilla) {
    try {
      const list = await getVersionList()
      const versionItem = list.versions.find((v) => v.id === cleanMc)
      if (versionItem?.url) {
        const res = await fetch(versionItem.url)
        if (res.ok) {
          mojangPackage = await res.json()
        }
      }
    } catch (_) {}
  }

  // Add Vanilla Client JAR size from metadata
  if (readiness.needsVanilla && mojangPackage?.downloads?.client?.size) {
    totalBytes += Number(mojangPackage.downloads.client.size)
  }

  // 2. NeoForge Installer Jar size from maven HTTP Content-Length header or installProfile
  if (readiness.needsNeoForge) {
    try {
      const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${cleanNf}/neoforge-${cleanNf}-installer.jar`
      const headRes = await fetch(installerUrl, { method: "HEAD" })
      const contentLength = headRes.headers.get("content-length")
      if (contentLength) {
        totalBytes += parseInt(contentLength, 10)
      }
    } catch (_) {}

    // Add NeoForge install profile libraries if available
    if (readiness.installProfile?.libraries && Array.isArray(readiness.installProfile.libraries)) {
      for (const lib of readiness.installProfile.libraries) {
        const size = lib.downloads?.artifact?.size
        if (typeof size === "number" && size > 0) {
          totalBytes += size
        }
      }
    }
  }

  // 3. Missing Libraries exact sizes from metadata
  if (readiness.needsLibraries && Array.isArray(readiness.missingLibraries)) {
    for (const issue of readiness.missingLibraries) {
      const size = issue.library?.downloads?.artifact?.size
      if (typeof size === "number" && size > 0) {
        totalBytes += size
      }
    }
  }

  // 4. Missing Assets exact sizes from metadata
  if (readiness.needsAssets && Array.isArray(readiness.missingAssets)) {
    for (const issue of readiness.missingAssets) {
      const size = issue.asset?.size
      if (typeof size === "number" && size > 0) {
        totalBytes += size
      }
    }
  }

  return {
    totalCoreBytes: totalBytes,
    readiness,
  }
}

/**
 * Installs or repairs only the missing/corrupted components of Minecraft Vanilla, NeoForge, Libraries and Assets using XMCL.
 * Does 0 downloads and 0 installer calls if the component is already valid on disk.
 */
async function installOrRepairMinecraftCore({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  javaCliPath,
  onTaskBytes,
  onPhaseChange,
  cancelSignal,
}) {
  if (!minecraftVersion || !String(minecraftVersion).trim()) {
    throw new Error("Missing required parameter: minecraftVersion.")
  }
  if (!neoForgeVersion || !String(neoForgeVersion).trim()) {
    throw new Error("Missing required parameter: neoForgeVersion.")
  }

  if (cancelSignal?.isCancelled) {
    throw new Error("Core installation cancelled by user.")
  }

  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()

  // Step 0: Check current readiness
  const initialReadiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  // Healthy Core Invariant: 0 operations if everything is already intact!
  if (initialReadiness.isCoreInstalled) {
    return {
      success: true,
      resolvedVersionId: initialReadiness.resolvedVersionId,
      installedVanilla: false,
      installedNeoForge: false,
      installedLibraries: false,
      installedAssets: false,
    }
  }

  let installedVanilla = false
  let installedNeoForge = false
  let installedLibraries = false
  let installedAssets = false

  // Step 1: Install Vanilla if missing
  if (initialReadiness.needsVanilla) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    const list = await getVersionList()
    const versionMeta = list?.versions?.find((v) => v.id === cleanMc)
    if (!versionMeta) {
      throw new Error(`Minecraft version "${cleanMc}" not found in Mojang version manifest.`)
    }

    const vanillaTask = installVersionTask(versionMeta, instanceRoot)
    if (cancelSignal) {
      cancelSignal.activeXmclTask = vanillaTask
    }

    await vanillaTask.startAndWait({
      onUpdate: (_task, chunkSize) => {
        if (typeof onTaskBytes === "function" && chunkSize > 0) {
          onTaskBytes("vanilla", chunkSize)
        }
      },
    })
    installedVanilla = true
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 2: Install NeoForge if missing or corrupted
  let resolvedVersionId = initialReadiness.resolvedVersionId
  let installProfile = initialReadiness.installProfile

  if (initialReadiness.needsNeoForge) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    // Validate Java 21 runtime strictly
    const javaValidation = validateJavaBinary(javaCliPath, 21)
    if (!javaValidation.valid) {
      throw new Error(`Java runtime validation failed for NeoForge installer: ${javaValidation.error}`)
    }

    const neoforgeOptions = {
      java: javaCliPath,
    }

    const nfTask = installNeoForgedTask("neoforge", cleanNf, instanceRoot, neoforgeOptions)
    if (cancelSignal) {
      cancelSignal.activeXmclTask = nfTask
    }

    if (typeof onPhaseChange === "function") {
      onPhaseChange("RUNNING_PROCESSORS")
    }

    resolvedVersionId = await nfTask.startAndWait({
      onUpdate: (_task, chunkSize) => {
        if (typeof onTaskBytes === "function" && chunkSize > 0) {
          onTaskBytes("neoforge", chunkSize)
        }
      },
    })

    // Extract real InstallProfile from the downloaded installer jar
    const installerJar = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)
    installProfile = await readInstallProfileFromJar(installerJar)

    installedNeoForge = true
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 3: Parse Resolved Profile
  const resolvedVersion = await Version.parse(instanceRoot, resolvedVersionId)
  if (!resolvedVersion) {
    throw new Error(`Failed to parse version profile for "${resolvedVersionId}".`)
  }

  // Step 4: Install Libraries if needed
  if (initialReadiness.needsLibraries || installedNeoForge || installedVanilla) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    const libTask = installLibrariesTask(resolvedVersion, {
      librariesDownloadConcurrency: 8,
    })
    if (cancelSignal) {
      cancelSignal.activeXmclTask = libTask
    }

    await libTask.startAndWait({
      onUpdate: (_task, chunkSize) => {
        if (typeof onTaskBytes === "function" && chunkSize > 0) {
          onTaskBytes("libraries", chunkSize)
        }
      },
    })
    installedLibraries = true
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 5: Install Assets if needed
  if (initialReadiness.needsAssets || installedNeoForge || installedVanilla) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    const assetTask = installAssetsTask(resolvedVersion, {
      assetsDownloadConcurrency: 8,
    })
    if (cancelSignal) {
      cancelSignal.activeXmclTask = assetTask
    }

    await assetTask.startAndWait({
      onUpdate: (_task, chunkSize) => {
        if (typeof onTaskBytes === "function" && chunkSize > 0) {
          onTaskBytes("assets", chunkSize)
        }
      },
    })
    installedAssets = true
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 6: Post-Verification Diagnostics
  if (typeof onPhaseChange === "function") {
    onPhaseChange("INSTALLING")
  }

  const postReadiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  if (!postReadiness.isCoreInstalled) {
    throw new Error(`Post-installation verification failed: ${postReadiness.issues.join(", ")}`)
  }

  // Step 7: Persist .hikat/core-state.json
  const coreState = {
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
    resolvedVersionId,
    installedAt: new Date().toISOString(),
    installProfile: postReadiness.installProfile || installProfile,
  }

  await saveCoreState(instanceRoot, coreState)

  return {
    success: true,
    resolvedVersionId,
    installedVanilla,
    installedNeoForge,
    installedLibraries,
    installedAssets,
  }
}

module.exports = {
  checkMinecraftCoreReadiness,
  estimateCoreDownloadBytes,
  installOrRepairMinecraftCore,
  resolveJavaRuntime,
  validateJavaBinary,
  parseJavaMajorVersion,
  readInstallProfileFromJar,
  getNeoForgeInstallerJarPath,
  getNeoForgeProfileCandidates,
  loadCoreState,
  saveCoreState,
}
