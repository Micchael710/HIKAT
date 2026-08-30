const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const { execFileSync } = require("child_process")
const { Version, diagnose, diagnoseLibraries, diagnoseAssets, diagnoseJar } = require("@xmcl/core")
const {
  getVersionList,
  installVersion,
  installNeoForged,
  installLibraries,
  installAssets,
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
 * Finds and validates Java 21 executable.
 * Priority: Official HiKAT runtime in <instanceRoot>/jdk-21/bin/
 */
function resolveJavaRuntime(instanceRoot, { isGui = false, customPath } = {}) {
  const exeName = process.platform === "win32" ? (isGui ? "javaw.exe" : "java.exe") : (isGui ? "javaw" : "java")
  const cliExeName = process.platform === "win32" ? "java.exe" : "java"

  // 1. Custom path override if provided and exists
  if (customPath && typeof customPath === "string" && fs.existsSync(customPath)) {
    return {
      javaPath: customPath,
      isOfficialJdk: false,
    }
  }

  // 2. Official HiKAT JDK distributed in instanceRoot/jdk-21
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

    // Direct root folders (e.g. jdk21, java)
    try {
      if (fs.existsSync(instanceRoot)) {
        const rootEntries = fs.readdirSync(instanceRoot)
        const jdkFolder = rootEntries.find(
          (f) => f.toLowerCase().startsWith("jdk-") || f.toLowerCase() === "jdk21" || f.toLowerCase() === "java",
        )
        if (jdkFolder) {
          const candidate = path.join(instanceRoot, jdkFolder, "bin", exeName)
          const candidateCli = path.join(instanceRoot, jdkFolder, "bin", cliExeName)
          if (fs.existsSync(candidate)) {
            return {
              javaPath: candidate,
              cliJavaPath: candidateCli,
              isOfficialJdk: true,
            }
          }
        }
      }
    } catch (_) {}
  }

  // 3. Fallback system candidate directories
  const appData = process.env.APPDATA || ""
  const candidateDirs = [
    path.join(appData, "HiKAT", "game files", "jdk-21", "bin"),
    path.join(appData, "HiKAT", "game files", "native_files", "jdk-21", "bin"),
    path.join(process.env.JAVA_HOME || "", "bin"),
  ]

  for (const dir of candidateDirs) {
    if (!dir || !fs.existsSync(dir)) continue
    const candidate = path.join(dir, exeName)
    const candidateCli = path.join(dir, cliExeName)
    if (fs.existsSync(candidate)) {
      return {
        javaPath: candidate,
        cliJavaPath: candidateCli,
        isOfficialJdk: false,
      }
    }
  }

  return {
    javaPath: exeName,
    cliJavaPath: cliExeName,
    isOfficialJdk: false,
  }
}

/**
 * Validates that the Java binary is functional.
 */
function validateJavaBinary(javaCliPath) {
  if (!javaCliPath || !fs.existsSync(javaCliPath)) {
    return { valid: false, error: `Java binary not found: ${javaCliPath}` }
  }

  try {
    const output = execFileSync(javaCliPath, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    })
    return { valid: true, versionOutput: output }
  } catch (err) {
    // java -version writes to stderr on many JVMs
    const stderr = err.stderr || ""
    if (stderr.includes("version") || stderr.includes("Runtime Environment") || stderr.includes("OpenJDK")) {
      return { valid: true, versionOutput: stderr }
    }
    return { valid: false, error: err.message || "Failed to execute java -version" }
  }
}

/**
 * Derives the expected NeoForge profile ID or candidate directory names.
 */
function getNeoForgeProfileCandidates(minecraftVersion, neoForgeVersion) {
  const cleanMc = String(minecraftVersion || "").trim()
  const cleanNf = String(neoForgeVersion || "").trim()
  return [
    `${cleanMc}-neoforge-${cleanNf}`,
    `neoforge-${cleanNf}`,
    `${cleanMc}-NeoForge-${cleanNf}`,
    `${cleanMc}-neoforged-${cleanNf}`,
  ]
}

/**
 * Checks readiness of Minecraft Vanilla + NeoForge + Libraries + Assets on the local filesystem.
 * Filesystem + Diagnostics is the ultimate authority.
 */
async function checkMinecraftCoreReadiness({ instanceRoot, minecraftVersion, neoForgeVersion }) {
  if (!instanceRoot || !fs.existsSync(instanceRoot)) {
    return {
      isCoreInstalled: false,
      hasExistingInstall: false,
      resolvedVersionId: null,
      needsVanilla: true,
      needsNeoForge: true,
      issues: ["Instance root does not exist."],
    }
  }

  const cleanMc = String(minecraftVersion || "").trim()
  const cleanNf = String(neoForgeVersion || "").trim()
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
    // Try candidate names matching the target versions
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
      issues: ["Vanilla Minecraft files missing."],
    }
  }

  if (!candidateProfileId) {
    return {
      isCoreInstalled: false,
      hasExistingInstall,
      resolvedVersionId: null,
      needsVanilla: false,
      needsNeoForge: true,
      issues: ["NeoForge profile directory/json not found."],
    }
  }

  // 3. Try parsing the version profile hierarchy via Version.parse
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
      issues: [`Version.parse failed: ${err.message}`],
    }
  }

  // 4. Run Core Diagnostics (Libraries & Assets)
  let coreIssues = []
  try {
    const report = await diagnose(candidateProfileId, instanceRoot)
    if (report && Array.isArray(report.issues)) {
      coreIssues = report.issues.filter(
        (issue) => issue.type === "missing" || issue.type === "corrupted",
      )
    }
  } catch (err) {
    // If diagnose fails, fall back to checking libraries directly
    try {
      const libIssues = await diagnoseLibraries(resolvedVersion, instanceRoot)
      if (Array.isArray(libIssues)) {
        coreIssues.push(...libIssues)
      }
    } catch (_) {}
  }

  // 5. Verify NeoForge InstallProfile Processors Output via diagnoseInstall if available
  let processorIssues = []
  if (coreState?.installProfile && typeof coreState.installProfile === "object") {
    try {
      const profileReport = await diagnoseInstall(coreState.installProfile, instanceRoot)
      if (profileReport && Array.isArray(profileReport.issues)) {
        processorIssues = profileReport.issues.filter(
          (issue) => issue.type === "missing" || issue.type === "corrupted",
        )
      }
    } catch (_) {}
  }

  const allIssues = [...coreIssues, ...processorIssues]
  const isCoreInstalled = allIssues.length === 0 && Boolean(resolvedVersion)

  return {
    isCoreInstalled,
    hasExistingInstall: true,
    resolvedVersionId: candidateProfileId,
    needsVanilla: false,
    needsNeoForge: !isCoreInstalled,
    issues: allIssues.map((i) => i.hint || i.file || i.role || "Unknown issue"),
    missingLibrariesCount: allIssues.filter((i) => i.role === "library").length,
    missingAssetsCount: allIssues.filter((i) => i.role === "asset" || i.role === "assetIndex").length,
    processorIssuesCount: processorIssues.length,
    installProfile: coreState?.installProfile || null,
  }
}

/**
 * Calculates estimated bytes to download for missing Core components.
 */
async function estimateCoreDownloadBytes({ instanceRoot, minecraftVersion, neoForgeVersion }) {
  const readiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion,
    neoForgeVersion,
  })

  if (readiness.isCoreInstalled) {
    return { totalCoreBytes: 0, readiness }
  }

  let totalBytes = 0

  // 1. Vanilla Jar ~30MB if missing
  if (readiness.needsVanilla) {
    totalBytes += 32 * 1024 * 1024
  }

  // 2. NeoForge Installer Jar ~15MB if NeoForge needs install
  if (readiness.needsNeoForge) {
    totalBytes += 16 * 1024 * 1024
  }

  // 3. Missing libraries & assets estimates (~500KB average per missing item if count known)
  const missingCount = (readiness.missingLibrariesCount || 0) + (readiness.missingAssetsCount || 0)
  if (missingCount > 0) {
    totalBytes += missingCount * 450 * 1024
  } else if (!readiness.hasExistingInstall) {
    // Fresh install full libraries and assets rough baseline (~80MB libraries + ~60MB assets)
    totalBytes += 140 * 1024 * 1024
  }

  return {
    totalCoreBytes: totalBytes,
    readiness,
  }
}

/**
 * Installs or repairs Minecraft Vanilla, NeoForge, Libraries and Assets using XMCL.
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
  if (cancelSignal?.isCancelled) {
    throw new Error("Core installation cancelled by user.")
  }

  const cleanMc = String(minecraftVersion || "").trim()
  const cleanNf = String(neoForgeVersion || "").trim()

  console.log(`[InstallEngine] Starting Minecraft & NeoForge installation (MC: ${cleanMc}, NF: ${cleanNf})`)

  // Step 1: Install Vanilla Version JSON & Client Jar if missing
  const vanillaDir = path.join(instanceRoot, "versions", cleanMc)
  const vanillaJson = path.join(vanillaDir, `${cleanMc}.json`)
  const vanillaJar = path.join(vanillaDir, `${cleanMc}.jar`)

  if (!fs.existsSync(vanillaJson) || !fs.existsSync(vanillaJar)) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    let versionMeta = null
    try {
      const list = await getVersionList()
      versionMeta = list.versions.find((v) => v.id === cleanMc)
    } catch (err) {
      console.warn("[InstallEngine] getVersionList error, using fallback version meta:", err.message)
    }

    if (!versionMeta) {
      versionMeta = {
        id: cleanMc,
        type: "release",
        url: `https://piston-meta.mojang.com/v1/packages/${cleanMc}.json`,
      }
    }

    console.log(`[InstallEngine] Installing vanilla version: ${cleanMc}`)
    await installVersion(versionMeta, instanceRoot)
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 2: Install NeoForge via installNeoForged using detected Java runtime
  let resolvedVersionId = null
  let extractedInstallProfile = null

  if (typeof onPhaseChange === "function") {
    onPhaseChange("DOWNLOADING_CORE")
  }

  console.log(`[InstallEngine] Installing NeoForge ${cleanNf} with Java: ${javaCliPath}`)

  const neoforgeOptions = {
    java: javaCliPath,
  }

  try {
    resolvedVersionId = await installNeoForged("neoforge", cleanNf, instanceRoot, neoforgeOptions)
    console.log(`[InstallEngine] NeoForge installed with resolved profile ID: ${resolvedVersionId}`)
  } catch (nfErr) {
    console.error("[InstallEngine] installNeoForged failed:", nfErr)
    throw new Error(`NeoForge installation failed: ${nfErr.message}`)
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 3: Parse Resolved Version Profile
  const resolvedVersion = await Version.parse(instanceRoot, resolvedVersionId)

  // Step 4: Install Missing Libraries
  if (typeof onPhaseChange === "function") {
    onPhaseChange("DOWNLOADING_CORE")
  }

  console.log(`[InstallEngine] Installing libraries for ${resolvedVersionId}...`)
  await installLibraries(resolvedVersion, {
    librariesDownloadConcurrency: 8,
  })

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 5: Install Missing Assets
  console.log(`[InstallEngine] Installing assets for ${resolvedVersionId}...`)
  await installAssets(resolvedVersion, {
    assetsDownloadConcurrency: 8,
  })

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 6: Post-Installation Diagnostics
  if (typeof onPhaseChange === "function") {
    onPhaseChange("INSTALLING")
  }

  const postReport = await diagnose(resolvedVersionId, instanceRoot)
  const remainingIssues = (postReport?.issues || []).filter(
    (i) => i.type === "missing" || i.type === "corrupted",
  )

  if (remainingIssues.length > 0) {
    console.warn(`[InstallEngine] Post-install diagnose detected ${remainingIssues.length} issues, re-installing missing dependencies...`)
    await installLibraries(resolvedVersion)
    await installAssets(resolvedVersion)
  }

  // Step 7: Persist .hikat/core-state.json
  const coreState = {
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
    resolvedVersionId,
    installedAt: new Date().toISOString(),
    installProfile: extractedInstallProfile,
  }

  await saveCoreState(instanceRoot, coreState)
  console.log(`[InstallEngine] Core state saved successfully for ${resolvedVersionId}`)

  return {
    success: true,
    resolvedVersionId,
  }
}

module.exports = {
  checkMinecraftCoreReadiness,
  estimateCoreDownloadBytes,
  installOrRepairMinecraftCore,
  resolveJavaRuntime,
  validateJavaBinary,
  loadCoreState,
  saveCoreState,
  getNeoForgeProfileCandidates,
}
