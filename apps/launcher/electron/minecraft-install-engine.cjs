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
 * Normalizes NeoForge version string (e.g. "neoforge-21.1.65" -> "21.1.65", "21.1.65" -> "21.1.65").
 */
function normalizeNeoForgeProfileVersion(rawVersion) {
  if (typeof rawVersion !== "string" || !rawVersion.trim()) {
    return ""
  }
  let v = rawVersion.trim()
  v = v.replace(/^.*neoforge[d]?-/i, "")
  return v.trim()
}

/**
 * Deep integrity verification for local files:
 * - Checks existence and isFile
 * - Checks exact byte size (stat.size === expectedSize) if expectedSize > 0
 * - Checks SHA-1 hash against file content if expectedSha1 is provided
 */
async function validateFileIntegrity(filePath, expectedSize, expectedSha1) {
  if (!filePath || typeof filePath !== "string") return false
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) return false

    if (typeof expectedSize === "number" && expectedSize >= 0) {
      if (stat.size !== expectedSize) {
        return false
      }
    }

    if (expectedSha1 && typeof expectedSha1 === "string" && expectedSha1.trim()) {
      const cleanExpectedSha1 = expectedSha1.trim().toLowerCase()
      const buffer = await fsp.readFile(filePath)
      const actualSha1 = crypto.createHash("sha1").update(buffer).digest("hex").toLowerCase()
      if (actualSha1 !== cleanExpectedSha1) {
        return false
      }
    }

    return true
  } catch (_) {
    return false
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
 * Resolves current OS key for Minecraft native classifiers matching Mojang rules.
 */
function getCurrentPlatformOsKey() {
  switch (process.platform) {
    case "win32":
      return "windows"
    case "darwin":
      return "osx"
    case "linux":
      return "linux"
    default:
      return process.platform
  }
}

/**
 * Resolves official SHA-256 for NeoForge installer jar from maven if available.
 */
async function fetchOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch = globalThis.fetch) {
  const cleanNf = String(neoForgeVersion).trim()
  const shaUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${cleanNf}/neoforge-${cleanNf}-installer.jar.sha256`
  try {
    const res = await customFetch(shaUrl)
    if (res.ok) {
      const text = await res.text()
      const match = text.trim().match(/^[a-fA-F0-9]{64}/)
      return match ? match[0].toLowerCase() : text.trim().toLowerCase()
    }
  } catch (_) {}
  return null
}

/**
 * Validates local file against expected SHA-256 hex string.
 */
async function validateFileSha256(filePath, expectedSha256) {
  if (!filePath || !fs.existsSync(filePath)) return false
  if (!expectedSha256 || typeof expectedSha256 !== "string") return true
  try {
    const buffer = await fsp.readFile(filePath)
    const actual = crypto.createHash("sha256").update(buffer).digest("hex").toLowerCase()
    return actual === expectedSha256.trim().toLowerCase()
  } catch (_) {
    return false
  }
}

/**
 * Obtains and validates the NeoForge installer JAR:
 * - In execution mode (isPlanning = false), streams download to temp file, reporting chunk progress, verifies official SHA-256, and renames atomically to canonical path.
 * - In planning mode (isPlanning = true), operates read-only (downloads only to ephemeral planner temp dir if needed to extract install_profile.json, and cleans it up).
 * - Fully abortable via AbortSignal or cancelSignal (cleans partial .tmp files without touching existing valid installers).
 */
async function bootstrapNeoForgeInstaller({
  instanceRoot,
  neoForgeVersion,
  onChunkBytes,
  signal,
  cancelSignal,
  isPlanning = false,
  plannerCacheDir,
  customFetch = globalThis.fetch,
}) {
  const cleanNf = String(neoForgeVersion).trim()
  const installerJar = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)

  // 1. Fetch official SHA-256 checksum from Maven if available
  const officialSha256 = await fetchOfficialNeoForgeInstallerSha256(cleanNf, customFetch)

  // 2. Check if valid installer JAR already exists locally at canonical location
  if (fs.existsSync(installerJar)) {
    const isValidChecksum = officialSha256 ? await validateFileSha256(installerJar, officialSha256) : true
    if (isValidChecksum) {
      const profile = await readInstallProfileFromJar(installerJar)
      if (profile && normalizeNeoForgeProfileVersion(profile.version) === normalizeNeoForgeProfileVersion(cleanNf)) {
        const stat = await fsp.stat(installerJar).catch(() => null)
        return {
          installerJar,
          installProfile: profile,
          installerSize: stat?.size || 0,
          downloadedInPreflight: false,
          preflightDownloadedBytes: 0,
        }
      }
    }
  }

  // 3. Check cancellation before network
  if (signal?.aborted || cancelSignal?.isCancelled || cancelSignal?.isPaused) {
    throw new Error("Preflight cancelled by user.")
  }

  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${cleanNf}/neoforge-${cleanNf}-installer.jar`
  const fetchSignal = signal || (cancelSignal ? undefined : undefined)
  const res = await customFetch(installerUrl, { signal: fetchSignal })
  if (!res.ok) {
    throw new Error(`Failed to fetch NeoForge installer from "${installerUrl}": HTTP ${res.status} ${res.statusText}`)
  }

  // Target directory for temporary file
  const os = require("os")
  const targetDir = isPlanning
    ? (plannerCacheDir || path.join(os.tmpdir(), "hikat-planner"))
    : path.dirname(installerJar)
  await fsp.mkdir(targetDir, { recursive: true })
  const tempPath = path.join(
    targetDir,
    `installer.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )

  let downloadedBytes = 0
  const sha256Hasher = crypto.createHash("sha256")
  let writeStream = fs.createWriteStream(tempPath)

  try {
    if (res.body && typeof res.body[Symbol.asyncIterator] === "function") {
      for await (const chunk of res.body) {
        if (signal?.aborted || cancelSignal?.isCancelled || cancelSignal?.isPaused) {
          throw new Error("Preflight cancelled by user.")
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        downloadedBytes += buf.length
        sha256Hasher.update(buf)
        await new Promise((resolve, reject) => {
          if (!writeStream.write(buf)) {
            writeStream.once("drain", resolve)
          } else {
            process.nextTick(resolve)
          }
        })
        if (typeof onChunkBytes === "function") {
          onChunkBytes(buf.length, downloadedBytes)
        }
      }
    } else {
      let buffer
      if (typeof res.arrayBuffer === "function") {
        buffer = Buffer.from(await res.arrayBuffer())
      } else if (typeof res.buffer === "function") {
        buffer = await res.buffer()
      } else if (typeof res.text === "function") {
        buffer = Buffer.from(await res.text())
      } else {
        buffer = Buffer.alloc(0)
      }
      downloadedBytes = buffer.length
      sha256Hasher.update(buffer)
      await new Promise((resolve, reject) => {
        writeStream.write(buffer, (err) => (err ? reject(err) : resolve()))
      })
      if (typeof onChunkBytes === "function") {
        onChunkBytes(downloadedBytes, downloadedBytes)
      }
    }
    await new Promise((resolve) => writeStream.end(resolve))
    writeStream = null

    // 4. Validate SHA-256 if official checksum is known
    const actualSha256 = sha256Hasher.digest("hex").toLowerCase()
    if (officialSha256 && actualSha256 !== officialSha256.toLowerCase()) {
      throw new Error(
        `NeoForge installer SHA-256 verification failed (expected ${officialSha256}, got ${actualSha256}). Download rejected.`,
      )
    }

    // 5. Read install_profile.json
    const profile = await readInstallProfileFromJar(tempPath)
    if (!profile) {
      throw new Error(`Downloaded NeoForge installer at "${tempPath}" is corrupted or missing install_profile.json.`)
    }

    if (isPlanning) {
      // In planning mode: Clean up the temp file and do NOT write to instanceRoot
      try {
        await fsp.unlink(tempPath)
      } catch (_) {}
      return {
        installerJar: null,
        installProfile: profile,
        installerSize: downloadedBytes,
        downloadedInPreflight: false,
        preflightDownloadedBytes: 0,
      }
    }

    // In execution mode: Promote temp file atomically to canonical installer location
    try {
      await fsp.rename(tempPath, installerJar)
    } catch (_) {
      if (fs.existsSync(installerJar)) {
        await fsp.unlink(installerJar)
      }
      await fsp.rename(tempPath, installerJar)
    }

    return {
      installerJar,
      installProfile: profile,
      installerSize: downloadedBytes,
      downloadedInPreflight: true,
      preflightDownloadedBytes: downloadedBytes,
    }
  } catch (err) {
    if (writeStream) {
      writeStream.destroy()
    }
    try {
      if (fs.existsSync(tempPath)) {
        await fsp.unlink(tempPath)
      }
    } catch (_) {}
    throw err
  }
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
    normalizeNeoForgeProfileVersion(coreState?.neoForgeVersion) !== normalizeNeoForgeProfileVersion(cleanNf)
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
  if (
    !installProfile ||
    installProfile.minecraft !== cleanMc ||
    normalizeNeoForgeProfileVersion(installProfile.version) !== normalizeNeoForgeProfileVersion(cleanNf)
  ) {
    // Attempt reconstruction from cached installer jar
    const installerJar = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)
    if (fs.existsSync(installerJar)) {
      try {
        const candidateProfile = await readInstallProfileFromJar(installerJar)
        if (
          candidateProfile &&
          candidateProfile.minecraft === cleanMc &&
          normalizeNeoForgeProfileVersion(candidateProfile.version) === normalizeNeoForgeProfileVersion(cleanNf)
        ) {
          installProfile = candidateProfile
          // Update cached core state with reconstructed install profile
          await saveCoreState(instanceRoot, {
            ...(coreState || {}),
            minecraftVersion: cleanMc,
            neoForgeVersion: cleanNf,
            resolvedVersionId: candidateProfileId,
            installProfile,
          })
        } else {
          installProfile = null
        }
      } catch (_) {
        installProfile = null
      }
    } else {
      installProfile = null
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
 * Bootstraps the NeoForge installer during preflight if needed to extract install_profile.json and discover all NeoForge dependencies.
 * Includes native classifiers matching current platform (and excludes mismatching OS natives).
 * Includes and deeply validates the asset index file itself (assets/indexes/<id>.json).
 * Deduplicates all required artifacts via canonical relative paths.
 * Validates files deeply (size + SHA-1 hash), not merely existence.
 */
async function estimateCoreDownloadBytes({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  onChunkBytes,
  cancelSignal,
  isPlanning = false,
  plannerCacheDir,
}) {
  if (!minecraftVersion || !neoForgeVersion) {
    return { totalCoreBytes: 0, preflightDownloadedBytes: 0, readiness: null }
  }

  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()

  const readiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  if (readiness.isCoreInstalled) {
    return { totalCoreBytes: 0, preflightDownloadedBytes: 0, readiness }
  }

  let preflightDownloadedBytes = 0
  let installProfile = readiness.installProfile || null

  // 1. If NeoForge is needed and installProfile is not yet known, bootstrap the installer in preflight!
  if (readiness.needsNeoForge && !installProfile) {
    const bootstrap = await bootstrapNeoForgeInstaller({
      instanceRoot,
      neoForgeVersion: cleanNf,
      onChunkBytes,
      cancelSignal,
      isPlanning,
      plannerCacheDir,
    })
    installProfile = bootstrap.installProfile
    if (bootstrap.downloadedInPreflight) {
      preflightDownloadedBytes += bootstrap.preflightDownloadedBytes
    }
  }

  // 2. Fetch / load Mojang version package metadata
  let mojangPackage = null
  const vanillaJsonPath = path.join(instanceRoot, "versions", cleanMc, `${cleanMc}.json`)
  if (fs.existsSync(vanillaJsonPath)) {
    try {
      mojangPackage = JSON.parse(await fsp.readFile(vanillaJsonPath, "utf8"))
    } catch (_) {}
  }

  if (!mojangPackage) {
    try {
      const list = await getVersionList()
      const versionItem = list?.versions?.find((v) => v.id === cleanMc)
      if (versionItem?.url) {
        const res = await fetch(versionItem.url)
        if (res.ok) {
          mojangPackage = await res.json()
        }
      }
    } catch (_) {}
  }

  // 3. Build Canonical Map of Required Artifacts to prevent double-counting across Mojang, NeoForge, and Diagnostics
  const canonicalArtifacts = new Map()

  function registerArtifact({ relativePath, expectedSize, expectedSha1, role }) {
    if (!relativePath || typeof relativePath !== "string") return
    const normalizedKey = path.normalize(relativePath).replace(/\\/g, "/")
    if (canonicalArtifacts.has(normalizedKey)) return // Deduplicate!

    canonicalArtifacts.set(normalizedKey, {
      localPath: path.join(instanceRoot, relativePath),
      expectedSize: typeof expectedSize === "number" && expectedSize > 0 ? expectedSize : null,
      expectedSha1:
        typeof expectedSha1 === "string" && expectedSha1.trim()
          ? expectedSha1.trim().toLowerCase()
          : null,
      role,
    })
  }

  // 3.a Minecraft Client JAR
  const clientDownload = mojangPackage?.downloads?.client
  if (clientDownload) {
    registerArtifact({
      relativePath: path.join("versions", cleanMc, `${cleanMc}.jar`),
      expectedSize: clientDownload.size,
      expectedSha1: clientDownload.sha1,
      role: "client-jar",
    })
  }

  // 3.b Vanilla Libraries & Native Classifiers for current platform
  const currentOsKey = getCurrentPlatformOsKey()

  if (mojangPackage?.libraries && Array.isArray(mojangPackage.libraries)) {
    try {
      const resolved = Version.resolveLibraries(mojangPackage.libraries)
      if (Array.isArray(resolved)) {
        for (const resLib of resolved) {
          const download = resLib.download
          const libPath = download?.path || resLib.path
          if (libPath) {
            registerArtifact({
              relativePath: path.join("libraries", libPath),
              expectedSize: download?.size,
              expectedSha1: download?.sha1,
              role: resLib.isNative ? "vanilla-native" : "vanilla-library",
            })
          }
        }
      }
    } catch (_) {}

    for (const lib of mojangPackage.libraries) {
      const artifact = lib.downloads?.artifact
      if (artifact?.path) {
        let isAllowed = true
        if (Array.isArray(lib.rules) && lib.rules.length > 0) {
          isAllowed = false
          for (const rule of lib.rules) {
            const osMatch = !rule.os || rule.os.name === currentOsKey
            if (osMatch) {
              isAllowed = rule.action === "allow"
            }
          }
        }
        if (isAllowed) {
          registerArtifact({
            relativePath: path.join("libraries", artifact.path),
            expectedSize: artifact.size,
            expectedSha1: artifact.sha1,
            role: "vanilla-library",
          })
        }
      }

      if (lib.natives && typeof lib.natives === "object" && lib.downloads?.classifiers) {
        const nativeClassifierKey = lib.natives[currentOsKey]
        if (nativeClassifierKey && lib.downloads.classifiers[nativeClassifierKey]) {
          const classifierArtifact = lib.downloads.classifiers[nativeClassifierKey]
          if (classifierArtifact?.path) {
            registerArtifact({
              relativePath: path.join("libraries", classifierArtifact.path),
              expectedSize: classifierArtifact.size,
              expectedSha1: classifierArtifact.sha1,
              role: "vanilla-native",
            })
          }
        }
      }
    }
  }

  // 3.c Assets (Index File + Objects)
  if (mojangPackage?.assetIndex) {
    const assetIndexMeta = mojangPackage.assetIndex
    // 3.c.1 Register the Asset Index file itself as a canonical artifact!
    registerArtifact({
      relativePath: path.join("assets", "indexes", `${assetIndexMeta.id}.json`),
      expectedSize: assetIndexMeta.size,
      expectedSha1: assetIndexMeta.sha1,
      role: "asset-index",
    })

    let assetIndexData = null
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", `${assetIndexMeta.id}.json`)

    if (fs.existsSync(localIndexFile)) {
      try {
        assetIndexData = JSON.parse(await fsp.readFile(localIndexFile, "utf8"))
      } catch (_) {}
    }

    if (!assetIndexData && assetIndexMeta.url) {
      try {
        const assetRes = await fetch(assetIndexMeta.url)
        if (assetRes.ok) {
          assetIndexData = await assetRes.json()
        }
      } catch (_) {}
    }

    if (assetIndexData?.objects && typeof assetIndexData.objects === "object") {
      for (const obj of Object.values(assetIndexData.objects)) {
        if (obj && obj.hash) {
          const prefix = obj.hash.slice(0, 2)
          registerArtifact({
            relativePath: path.join("assets", "objects", prefix, obj.hash),
            expectedSize: obj.size,
            expectedSha1: obj.hash,
            role: "asset",
          })
        }
      }
    }
  }

  // 3.d NeoForge Installer JAR
  if (readiness.needsNeoForge) {
    const installerRelativePath = path.join(
      "libraries",
      "net",
      "neoforged",
      "neoforge",
      cleanNf,
      `neoforge-${cleanNf}-installer.jar`,
    )
    let installerSize = preflightDownloadedBytes
    if (!installerSize) {
      try {
        const installerJar = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)
        if (fs.existsSync(installerJar)) {
          const stat = await fsp.stat(installerJar).catch(() => null)
          installerSize = stat?.size || 0
        }
        if (!installerSize) {
          const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${cleanNf}/neoforge-${cleanNf}-installer.jar`
          const headRes = await fetch(installerUrl, { method: "HEAD" })
          const cl = headRes.headers.get("content-length")
          if (cl) installerSize = parseInt(cl, 10)
        }
      } catch (_) {}
    }

    registerArtifact({
      relativePath: installerRelativePath,
      expectedSize: installerSize,
      expectedSha1: null,
      role: "neoforge-installer",
    })
  }

  // 3.e NeoForge Install Profile Libraries (all dependencies of NeoForge)
  if (installProfile?.libraries && Array.isArray(installProfile.libraries)) {
    for (const lib of installProfile.libraries) {
      const artifact = lib.downloads?.artifact
      if (artifact?.path) {
        registerArtifact({
          relativePath: path.join("libraries", artifact.path),
          expectedSize: artifact.size,
          expectedSha1: artifact.sha1,
          role: "neoforge-library",
        })
      }
    }
  }

  // 3.f Diagnostics Missing Libraries & Assets (for repair flows)
  if (readiness.needsLibraries && Array.isArray(readiness.missingLibraries)) {
    for (const issue of readiness.missingLibraries) {
      const artifact = issue.library?.downloads?.artifact
      if (artifact?.path) {
        registerArtifact({
          relativePath: path.join("libraries", artifact.path),
          expectedSize: artifact.size,
          expectedSha1: artifact.sha1,
          role: "diagnostics-library",
        })
      }
    }
  }

  if (readiness.needsAssets && Array.isArray(readiness.missingAssets)) {
    for (const issue of readiness.missingAssets) {
      const assetObj = issue.asset
      if (assetObj?.hash) {
        const prefix = assetObj.hash.slice(0, 2)
        registerArtifact({
          relativePath: path.join("assets", "objects", prefix, assetObj.hash),
          expectedSize: assetObj.size,
          expectedSha1: assetObj.hash,
          role: "diagnostics-asset",
        })
      }
    }
  }

  // 4. Validate Each Unique Canonical Artifact against Disk (Size + SHA-1)
  let totalBytes = 0

  for (const artifact of canonicalArtifacts.values()) {
    // If the installer was already downloaded during this preflight invocation, count its bytes in total
    if (artifact.role === "neoforge-installer" && preflightDownloadedBytes > 0) {
      totalBytes += preflightDownloadedBytes
      continue
    }

    const isValid = await validateFileIntegrity(
      artifact.localPath,
      artifact.expectedSize,
      artifact.expectedSha1,
    )
    if (!isValid) {
      if (typeof artifact.expectedSize === "number" && artifact.expectedSize > 0) {
        totalBytes += artifact.expectedSize
      }
    }
  }

  return {
    totalCoreBytes: totalBytes,
    preflightDownloadedBytes,
    readiness,
    installProfile,
  }
}

/**
 * Installs or repairs only the missing/corrupted components of Minecraft Vanilla, NeoForge, Libraries and Assets using XMCL.
 * Reuses installer JAR already downloaded during preflight.
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

    resolvedVersionId = await nfTask.startAndWait({
      onStart: (task) => {
        const name = String(task.name || "").toLowerCase()
        const isNetwork =
          name.includes("download") ||
          name.includes("fetch") ||
          Boolean(task.from)
        const isProcessor =
          name.includes("processor") ||
          name.includes("postprocess") ||
          name.includes("unpack") ||
          (name.includes("install") && !isNetwork)

        if (isNetwork && typeof onPhaseChange === "function") {
          onPhaseChange("DOWNLOADING_CORE")
        } else if (isProcessor && typeof onPhaseChange === "function") {
          onPhaseChange("RUNNING_PROCESSORS")
        }
      },
      onUpdate: (task, chunkSize) => {
        const name = String(task.name || "").toLowerCase()
        const isNetwork =
          name.includes("download") ||
          name.includes("fetch") ||
          Boolean(task.from)

        if (isNetwork && typeof onPhaseChange === "function") {
          onPhaseChange("DOWNLOADING_CORE")
        }

        if (typeof onTaskBytes === "function" && chunkSize > 0) {
          onTaskBytes(task.name || "neoforge", chunkSize)
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
  normalizeNeoForgeProfileVersion,
  validateFileIntegrity,
  bootstrapNeoForgeInstaller,
  readInstallProfileFromJar,
  getNeoForgeInstallerJarPath,
  getNeoForgeProfileCandidates,
  loadCoreState,
  saveCoreState,
  fetchOfficialNeoForgeInstallerSha256,
  validateFileSha256,
  getCurrentPlatformOsKey,
}
