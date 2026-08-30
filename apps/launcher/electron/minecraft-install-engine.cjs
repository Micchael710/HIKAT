const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const { execFileSync, spawnSync } = require("child_process")
const { MinecraftFolder, Version, diagnose, diagnoseLibraries, diagnoseAssets } = require("@xmcl/core")
const {
  getVersionList,
  installVersionTask,
  installLibrariesTask,
  installAssetsTask,
  diagnoseInstall,
  walkForgeInstallerEntries,
  isForgeInstallerEntries,
  unpackForgeInstaller,
  installByProfileTask,
  installByProfile,
  BadForgeInstallerJarError,
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
      const cleanSha1 = expectedSha1.trim().toLowerCase()
      const buffer = await fsp.readFile(filePath)
      const actualSha1 = crypto.createHash("sha1").update(buffer).digest("hex").toLowerCase()
      if (actualSha1 !== cleanSha1) {
        return false
      }
    }

    return true
  } catch (_) {
    return false
  }
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
function validateJavaBinary(javaCliPath, requiredMajor = 21, execRunner = spawnSync) {
  if (!javaCliPath || !fs.existsSync(javaCliPath)) {
    return {
      valid: false,
      error: `Java binary not found: ${javaCliPath || "null"}`,
    }
  }

  let result
  try {
    result = execRunner(javaCliPath, ["-version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    })
  } catch (err) {
    return {
      valid: false,
      error: err.message || "Failed to execute java -version",
    }
  }

  if (!result || result.error) {
    return {
      valid: false,
      error: result?.error?.message || "Failed to execute java -version",
    }
  }

  const output =
    typeof result === "string"
      ? result
      : `${result.stdout || ""}\n${result.stderr || ""}`
  const major = parseJavaMajorVersion(output)

  if (major === null) {
    return {
      valid: false,
      major: null,
      error: "Unable to parse Java version from binary output.",
    }
  }

  if (major !== requiredMajor) {
    return {
      valid: false,
      major,
      error: `Incompatible Java version (found Java ${major}, expected Java ${requiredMajor}).`,
    }
  }

  return { valid: true, major, versionOutput: output }
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
 * Returns paths for the persistent Planner Cache outside instanceRoot.
 * Located at: <instanceRoot parent>/.planner-cache/neoforge/<neoForgeVersion>/
 */
function getPlannerCachePaths(instanceRoot, neoForgeVersion) {
  const cleanNf = String(neoForgeVersion || "").trim()
  const baseDir = path.dirname(instanceRoot)
  const cacheDir = path.join(baseDir, ".planner-cache", "neoforge", cleanNf)
  return {
    cacheDir,
    installerJar: path.join(cacheDir, "installer.jar"),
    metadataJson: path.join(cacheDir, "metadata.json"),
    tempInstallerJar: path.join(cacheDir, "installer.tmp"),
  }
}

/**
 * Loads metadata.json for the cached planner installer.
 */
async function loadPlannerInstallerMetadata(instanceRoot, neoForgeVersion) {
  const { metadataJson } = getPlannerCachePaths(instanceRoot, neoForgeVersion)
  try {
    if (!fs.existsSync(metadataJson)) return null
    const content = await fsp.readFile(metadataJson, "utf8")
    const parsed = JSON.parse(content)
    if (
      parsed &&
      parsed.schemaVersion === 2 &&
      String(parsed.neoForgeVersion).trim() === String(neoForgeVersion).trim() &&
      typeof parsed.sha256 === "string" &&
      /^[a-fA-F0-9]{64}$/.test(parsed.sha256.trim()) &&
      typeof parsed.sizeBytes === "number" &&
      parsed.sizeBytes > 0
    ) {
      return {
        ...parsed,
        sha256: parsed.sha256.trim().toLowerCase(),
      }
    }
    return null
  } catch (_) {
    return null
  }
}

/**
 * Validates the cached installer in Planner Cache:
 * - metadata.json exists and is valid
 * - installer.jar exists and size matches metadata.sizeBytes
 * - SHA-256 matches metadata.sha256
 * - install_profile.json exists inside and matches target version
 */
async function validatePlannerInstaller(instanceRoot, neoForgeVersion, minecraftVersion) {
  const { cacheDir, installerJar, metadataJson } = getPlannerCachePaths(instanceRoot, neoForgeVersion)
  const cleanNf = String(neoForgeVersion || "").trim()
  const cleanMc = String(minecraftVersion || "").trim()

  const metadata = await loadPlannerInstallerMetadata(instanceRoot, cleanNf)
  if (!metadata) {
    return { valid: false, reason: "missing-or-invalid-metadata" }
  }

  if (!fs.existsSync(installerJar)) {
    return { valid: false, reason: "missing-jar" }
  }

  try {
    const stat = await fsp.stat(installerJar)
    if (stat.size !== metadata.sizeBytes) {
      return { valid: false, reason: "size-mismatch" }
    }

    const isShaValid = await validateFileSha256(installerJar, metadata.sha256)
    if (!isShaValid) {
      return { valid: false, reason: "sha256-mismatch" }
    }

    const profile = await readInstallProfileFromJar(installerJar)
    if (
      !profile ||
      normalizeNeoForgeProfileVersion(profile.version) !== normalizeNeoForgeProfileVersion(cleanNf) ||
      (cleanMc && profile.minecraft !== cleanMc)
    ) {
      return { valid: false, reason: "invalid-profile" }
    }

    return {
      valid: true,
      installerJar,
      metadata,
      installProfile: profile,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
    }
  } catch (_) {
    try {
      if (fs.existsSync(installerJar)) await fsp.unlink(installerJar)
      if (fs.existsSync(metadataJson)) await fsp.unlink(metadataJson)
    } catch (_) {}
    return { valid: false, reason: "validation-error" }
  }
}

/**
 * Resolves official SHA-256 for NeoForge installer jar from maven (FAIL-CLOSED).
 * Rejects HTTP errors, invalid hashes, or network issues.
 */
async function resolveOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch = globalThis.fetch, signal) {
  const cleanNf = String(neoForgeVersion || "").trim()
  if (!cleanNf) {
    throw new Error("Cannot resolve NeoForge installer SHA-256: neoForgeVersion is empty.")
  }

  const shaUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${cleanNf}/neoforge-${cleanNf}-installer.jar.sha256`
  let res
  try {
    res = await customFetch(shaUrl, { signal })
  } catch (err) {
    throw new Error(`Failed to fetch official SHA-256 checksum for NeoForge ${cleanNf} from "${shaUrl}": ${err.message}`)
  }

  if (!res || !res.ok) {
    throw new Error(
      `Failed to fetch official SHA-256 checksum for NeoForge ${cleanNf} from "${shaUrl}": HTTP ${res?.status || "unknown"}`,
    )
  }

  const text = await res.text()
  const match = text.trim().match(/^([a-fA-F0-9]{64})(?:\s|$)/)
  if (!match) {
    throw new Error(
      `Invalid official SHA-256 checksum format for NeoForge ${cleanNf} received from "${shaUrl}": "${text.trim()}"`,
    )
  }

  return match[1].toLowerCase()
}

/**
 * Backward compatibility alias for resolveOfficialNeoForgeInstallerSha256.
 */
async function fetchOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch = globalThis.fetch, signal) {
  return await resolveOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch, signal)
}

/**
 * Ensures the NeoForge installer JAR is prepared and verified in the persistent Planner Cache:
 * - If already valid in Planner Cache: reuses it with 0 network calls.
 * - If not in Planner Cache: downloads streaming with incremental SHA-256, verifies official SHA-256 (fail-closed), extracts install_profile.json, and saves metadata.json.
 */
async function ensurePlannerInstaller({
  instanceRoot,
  neoForgeVersion,
  minecraftVersion,
  signal,
  cancelSignal,
  onChunkBytes,
  customFetch = globalThis.fetch,
}) {
  const cleanNf = String(neoForgeVersion || "").trim()
  const cleanMc = String(minecraftVersion || "").trim()
  const { cacheDir, installerJar, metadataJson, tempInstallerJar } = getPlannerCachePaths(
    instanceRoot,
    cleanNf,
  )

  // 1. Check if Planner Cache already has valid installer
  const cached = await validatePlannerInstaller(instanceRoot, cleanNf, cleanMc)
  if (cached.valid) {
    return {
      installerJar: cached.installerJar,
      metadata: cached.metadata,
      installProfile: cached.installProfile,
      sizeBytes: cached.sizeBytes,
      sha256: cached.sha256,
      wasAlreadyCached: true,
      downloadedBytes: 0,
    }
  }

  // 2. Check cancellation before resolving official checksum
  if (signal?.aborted || cancelSignal?.isCancelled || cancelSignal?.isPaused) {
    const abortErr = new Error("Preflight cancelled by user.")
    abortErr.name = "AbortError"
    throw abortErr
  }

  // 3. Resolve official SHA-256 FIRST (Fail-closed)
  const officialSha256 = await resolveOfficialNeoForgeInstallerSha256(cleanNf, customFetch, signal)

  // 4. Check if canonical installer jar already exists in instanceRoot/libraries with matching official SHA-256
  const canonicalJar = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)
  if (fs.existsSync(canonicalJar)) {
    try {
      const isCanonicalValid = await validateFileSha256(canonicalJar, officialSha256)
      if (isCanonicalValid) {
        const profile = await readInstallProfileFromJar(canonicalJar)
        if (
          profile &&
          normalizeNeoForgeProfileVersion(profile.version) === normalizeNeoForgeProfileVersion(cleanNf) &&
          (!cleanMc || profile.minecraft === cleanMc)
        ) {
          const stat = await fsp.stat(canonicalJar)
          // Copy to Planner Cache to make Planner Cache consistent
          await fsp.mkdir(cacheDir, { recursive: true })
          await fsp.copyFile(canonicalJar, installerJar)
          const metadata = {
            schemaVersion: 2,
            neoForgeVersion: cleanNf,
            sha256: officialSha256,
            sizeBytes: stat.size,
            cachedAt: new Date().toISOString(),
          }
          await fsp.writeFile(metadataJson, JSON.stringify(metadata, null, 2), "utf8")

          return {
            installerJar,
            metadata,
            installProfile: profile,
            sizeBytes: stat.size,
            sha256: officialSha256,
            wasAlreadyCached: true,
            downloadedBytes: 0,
          }
        }
      }
    } catch (_) {}
  }

  // 5. Download installer stream to temporary file in Planner Cache
  await fsp.mkdir(cacheDir, { recursive: true })
  if (fs.existsSync(tempInstallerJar)) {
    try {
      await fsp.unlink(tempInstallerJar)
    } catch (_) {}
  }

  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${cleanNf}/neoforge-${cleanNf}-installer.jar`
  let res
  try {
    res = await customFetch(installerUrl, { signal })
  } catch (err) {
    throw new Error(`Failed to fetch NeoForge installer from "${installerUrl}": ${err.message}`)
  }

  if (!res || !res.ok) {
    throw new Error(`Failed to fetch NeoForge installer from "${installerUrl}": HTTP ${res?.status || "unknown"}`)
  }

  let downloadedBytes = 0
  const sha256Hasher = crypto.createHash("sha256")
  let writeStream = fs.createWriteStream(tempInstallerJar)

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

    // 5. Validate SHA-256 against official checksum
    const actualSha256 = sha256Hasher.digest("hex").toLowerCase()
    if (actualSha256 !== officialSha256) {
      throw new Error(
        `NeoForge installer SHA-256 verification failed (expected ${officialSha256}, got ${actualSha256}). Download rejected.`,
      )
    }

    // 6. Read install_profile.json
    const profile = await readInstallProfileFromJar(tempInstallerJar)
    if (!profile) {
      throw new Error(`Downloaded NeoForge installer at "${tempInstallerJar}" is corrupted or missing install_profile.json.`)
    }

    if (
      normalizeNeoForgeProfileVersion(profile.version) !== normalizeNeoForgeProfileVersion(cleanNf) ||
      (cleanMc && profile.minecraft !== cleanMc)
    ) {
      throw new Error(
        `Downloaded NeoForge installer contains mismatched profile (expected MC ${cleanMc} NF ${cleanNf}, got MC ${profile.minecraft} NF ${profile.version}).`,
      )
    }

    // 7. Atomic rename temp -> installer.jar
    try {
      await fsp.rename(tempInstallerJar, installerJar)
    } catch (_) {
      if (fs.existsSync(installerJar)) await fsp.unlink(installerJar)
      await fsp.rename(tempInstallerJar, installerJar)
    }

    // 8. Save metadata.json
    const metadata = {
      schemaVersion: 2,
      neoForgeVersion: cleanNf,
      sha256: officialSha256,
      sizeBytes: downloadedBytes,
      cachedAt: new Date().toISOString(),
    }
    await fsp.writeFile(metadataJson, JSON.stringify(metadata, null, 2), "utf8")

    return {
      installerJar,
      metadata,
      installProfile: profile,
      sizeBytes: downloadedBytes,
      sha256: officialSha256,
      wasAlreadyCached: false,
      downloadedBytes,
    }
  } catch (err) {
    if (writeStream) {
      writeStream.destroy()
    }
    try {
      if (fs.existsSync(tempInstallerJar)) await fsp.unlink(tempInstallerJar)
    } catch (_) {}
    throw err
  }
}

/**
 * Promotes the verified Planner Cache installer to canonical instanceRoot/libraries path atomically:
 * - Validates local copy via SHA-256
 * - Atomic rename from temp sibling
 * - Does NOT delete Planner Cache
 */
async function promotePlannerInstallerToCanonical(instanceRoot, neoForgeVersion, plannerInstaller) {
  const cleanNf = String(neoForgeVersion || "").trim()
  const canonicalPath = getNeoForgeInstallerJarPath(instanceRoot, cleanNf)
  const canonicalDir = path.dirname(canonicalPath)

  if (fs.existsSync(canonicalPath)) {
    const isAlreadyValid = await validateFileSha256(canonicalPath, plannerInstaller.sha256)
    if (isAlreadyValid) {
      return canonicalPath
    }
  }

  await fsp.mkdir(canonicalDir, { recursive: true })
  const tempSibling = path.join(
    canonicalDir,
    `installer.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )

  await fsp.copyFile(plannerInstaller.installerJar, tempSibling)
  const isValidCopy = await validateFileSha256(tempSibling, plannerInstaller.sha256)
  if (!isValidCopy) {
    try {
      if (fs.existsSync(tempSibling)) await fsp.unlink(tempSibling)
    } catch (_) {}
    throw new Error("Failed to promote NeoForge installer to canonical path: SHA-256 verification failed on local copy.")
  }

  try {
    await fsp.rename(tempSibling, canonicalPath)
  } catch (_) {
    if (fs.existsSync(canonicalPath)) await fsp.unlink(canonicalPath)
    await fsp.rename(tempSibling, canonicalPath)
  }

  return canonicalPath
}

/**
 * Legacy bootstrap alias directing to ensurePlannerInstaller + promotePlannerInstallerToCanonical.
 */
async function bootstrapNeoForgeInstaller({
  instanceRoot,
  neoForgeVersion,
  onChunkBytes,
  signal,
  cancelSignal,
  isPlanning = false,
  customFetch = globalThis.fetch,
}) {
  const cleanNf = String(neoForgeVersion).trim()
  const plannerResult = await ensurePlannerInstaller({
    instanceRoot,
    neoForgeVersion: cleanNf,
    signal,
    cancelSignal,
    onChunkBytes,
    customFetch,
  })

  let installerJar = null
  if (!isPlanning) {
    installerJar = await promotePlannerInstallerToCanonical(instanceRoot, cleanNf, plannerResult)
  }

  return {
    installerJar,
    installProfile: plannerResult.installProfile,
    installerSize: plannerResult.sizeBytes,
    downloadedInPreflight: !plannerResult.wasAlreadyCached,
    preflightDownloadedBytes: plannerResult.downloadedBytes,
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
 * Builds unified core installation plan derived strictly from authoritative metadata and Planner Cache:
 * - Reuses persistent Planner Cache outside instanceRoot.
 * - Resolves all canonical artifacts with zero double-counting.
 * - Categorizes pre-cached artifacts into reusableCoreBytes vs live network transfer into bootstrapNetworkBytes.
 * - Works identically for planning mode ("planning") and execution mode ("execution").
 */
async function buildCoreInstallPlan({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  mode = "planning",
  signal,
  cancelSignal,
  onChunkBytes,
  customFetch = globalThis.fetch,
}) {
  if (!minecraftVersion || !neoForgeVersion) {
    return {
      totalCoreBytes: 0,
      installProfile: null,
      artifacts: new Map(),
      plannerInstaller: { path: null, sizeBytes: 0, sha256: null, status: "not-required" },
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      readiness: null,
    }
  }

  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()

  const readiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  if (readiness.isCoreInstalled) {
    return {
      totalCoreBytes: 0,
      installProfile: readiness.installProfile,
      artifacts: new Map(),
      plannerInstaller: {
        path: null,
        sizeBytes: 0,
        sha256: null,
        status: "not-required",
      },
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      needsVanilla: false,
      needsNeoForge: false,
      resolvedVersionId: readiness.resolvedVersionId,
      readiness,
    }
  }

  let bootstrapNetworkBytes = 0
  let reusableCoreBytes = 0
  let installProfile = readiness.installProfile || null
  let plannerInstallerInfo = {
    path: null,
    sizeBytes: 0,
    sha256: null,
    status: "not-required",
  }

  // 1. If NeoForge is needed, ensure Planner Cache has the verified installer
  if (readiness.needsNeoForge) {
    const plannerResult = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: cleanNf,
      minecraftVersion: cleanMc,
      signal,
      cancelSignal,
      onChunkBytes,
      customFetch,
    })

    installProfile = plannerResult.installProfile
    bootstrapNetworkBytes = plannerResult.downloadedBytes

    const status = plannerResult.wasAlreadyCached
      ? "cached-before-operation"
      : "downloaded-this-operation"

    plannerInstallerInfo = {
      path: plannerResult.installerJar,
      sizeBytes: plannerResult.sizeBytes,
      sha256: plannerResult.sha256,
      status,
    }

    if (plannerResult.wasAlreadyCached) {
      reusableCoreBytes += plannerResult.sizeBytes
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
        const res = await customFetch(versionItem.url, { signal })
        if (res && res.ok) {
          mojangPackage = await res.json()
        }
      }
    } catch (_) {}
  }

  // 3. Build Canonical Map of Required Artifacts
  const canonicalArtifacts = new Map()

  function registerArtifact({ relativePath, expectedSize, expectedSha1, expectedSha256, role }) {
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
      expectedSha256:
        typeof expectedSha256 === "string" && expectedSha256.trim()
          ? expectedSha256.trim().toLowerCase()
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
        const assetRes = await customFetch(assetIndexMeta.url, { signal })
        if (assetRes && assetRes.ok) {
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

  // 3.d NeoForge Installer JAR (Uses expectedSha256)
  if (readiness.needsNeoForge) {
    const installerRelativePath = path.join(
      "libraries",
      "net",
      "neoforged",
      "neoforge",
      cleanNf,
      `neoforge-${cleanNf}-installer.jar`,
    )

    registerArtifact({
      relativePath: installerRelativePath,
      expectedSize: plannerInstallerInfo.sizeBytes,
      expectedSha256: plannerInstallerInfo.sha256,
      role: "neoforge-installer",
    })
  }

  // 3.e NeoForge Install Profile Libraries
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

  // 3.f Diagnostics Missing Libraries & Assets
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

  // 4. Validate Each Unique Canonical Artifact against Disk (Size + SHA-1 / SHA-256)
  let totalBytes = 0

  for (const artifact of canonicalArtifacts.values()) {
    // If this artifact was downloaded during this startSync invocation, count its exact bytes
    if (artifact.role === "neoforge-installer" && bootstrapNetworkBytes > 0) {
      totalBytes += bootstrapNetworkBytes
      continue
    }

    let isValid = false
    if (artifact.expectedSha256) {
      isValid = await validateFileSha256(artifact.localPath, artifact.expectedSha256)
      if (isValid && typeof artifact.expectedSize === "number" && artifact.expectedSize > 0) {
        try {
          const stat = await fsp.stat(artifact.localPath)
          isValid = stat.size === artifact.expectedSize
        } catch (_) {
          isValid = false
        }
      }
    } else {
      isValid = await validateFileIntegrity(
        artifact.localPath,
        artifact.expectedSize,
        artifact.expectedSha1,
      )
    }

    if (!isValid) {
      if (typeof artifact.expectedSize === "number" && artifact.expectedSize > 0) {
        totalBytes += artifact.expectedSize
      }
    }
  }

  return {
    totalCoreBytes: totalBytes,
    installProfile,
    artifacts: canonicalArtifacts,
    plannerInstaller: plannerInstallerInfo,
    reusableCoreBytes,
    bootstrapNetworkBytes,
    needsVanilla: readiness.needsVanilla,
    needsNeoForge: readiness.needsNeoForge,
    resolvedVersionId: readiness.resolvedVersionId,
    readiness,
  }
}

/**
 * Calculates estimated bytes to download for missing Core components (Backward compatibility wrapper around buildCoreInstallPlan).
 */
async function estimateCoreDownloadBytes({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  onChunkBytes,
  cancelSignal,
  signal,
  isPlanning = false,
  customFetch = globalThis.fetch,
}) {
  const plan = await buildCoreInstallPlan({
    instanceRoot,
    minecraftVersion,
    neoForgeVersion,
    mode: isPlanning ? "planning" : "execution",
    signal,
    cancelSignal,
    onChunkBytes,
    customFetch,
  })

  return {
    totalCoreBytes: plan.totalCoreBytes,
    preflightDownloadedBytes: plan.bootstrapNetworkBytes,
    readiness: plan.readiness,
    installProfile: plan.installProfile,
    plannerInstaller: plan.plannerInstaller,
    reusableCoreBytes: plan.reusableCoreBytes,
    bootstrapNetworkBytes: plan.bootstrapNetworkBytes,
  }
}

/**
 * Installs NeoForge from an already prepared and verified local installer JAR:
 * - Uses lower-level XMCL APIs (walkForgeInstallerEntries, unpackForgeInstaller, installByProfileTask).
 * - NEVER calls high-level installNeoForgedTask which re-downloads the installer.
 * - Accurately distinguishes DOWNLOADING_CORE (libraries) from RUNNING_PROCESSORS (postprocess).
 */
async function installNeoForgeFromPreparedInstaller({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  installProfile,
  javaCliPath,
  canonicalInstallerPath,
  cancelSignal,
  onTaskBytes,
  onPhaseChange,
}) {
  const cleanNf = String(neoForgeVersion || "").trim()
  const cleanMc = String(minecraftVersion || "").trim()

  if (!canonicalInstallerPath || !fs.existsSync(canonicalInstallerPath)) {
    throw new Error(`Prepared NeoForge installer JAR not found at canonical path: ${canonicalInstallerPath}`)
  }

  // 1. Validate Java 21 runtime
  const javaValidation = validateJavaBinary(javaCliPath, 21)
  if (!javaValidation.valid) {
    throw new Error(`Java runtime validation failed for NeoForge installer: ${javaValidation.error}`)
  }

  // 2. Open installer ZIP using @xmcl/unzip open helper
  let unzipModule
  try {
    const unzipPath = require.resolve("@xmcl/unzip", {
      paths: [require.resolve("@xmcl/installer")],
    })
    unzipModule = require(unzipPath)
  } catch (_) {
    unzipModule = require("@xmcl/unzip")
  }

  const zip = await unzipModule.open(canonicalInstallerPath, {
    lazyEntries: true,
    autoClose: false,
  })

  let resolvedVersionId = null

  try {
    const entries = await walkForgeInstallerEntries(zip, cleanNf)
    if (!entries.installProfileJson || !isForgeInstallerEntries(entries)) {
      throw new BadForgeInstallerJarError(canonicalInstallerPath, "install_profile.json")
    }

    const mc = MinecraftFolder.from(instanceRoot)
    const options = {
      java: javaCliPath,
      side: "client",
    }

    resolvedVersionId = await unpackForgeInstaller(
      zip,
      entries,
      installProfile,
      mc,
      canonicalInstallerPath,
      options,
    )
  } finally {
    try {
      zip.close()
    } catch (_) {}
  }

  if (cancelSignal?.isCancelled) {
    throw new Error("Core installation cancelled by user.")
  }

  // 3. Run installByProfileTask with tracking
  const profileOptions = {
    java: javaCliPath,
    side: "client",
    signal: cancelSignal?.activeCoreAbortController?.signal,
  }

  const profileTask = installByProfileTask(installProfile, instanceRoot, profileOptions)
  if (cancelSignal) {
    cancelSignal.activeXmclTask = profileTask
  }

  await profileTask.startAndWait({
    onStart: (task) => {
      const taskName = String(task.name || "").toLowerCase()
      if (
        taskName === "installlibraries" ||
        taskName.includes("download") ||
        taskName.includes("library")
      ) {
        if (typeof onPhaseChange === "function") {
          onPhaseChange("DOWNLOADING_CORE")
        }
      } else if (
        taskName === "postprocessing" ||
        taskName === "postprocess" ||
        taskName.includes("process")
      ) {
        if (typeof onPhaseChange === "function") {
          onPhaseChange("RUNNING_PROCESSORS")
        }
      }
    },
    onUpdate: (task, chunkSize) => {
      const taskName = String(task.name || "").toLowerCase()
      if (
        taskName === "installlibraries" ||
        taskName.includes("download") ||
        taskName.includes("library")
      ) {
        if (typeof onPhaseChange === "function") {
          onPhaseChange("DOWNLOADING_CORE")
        }
        if (typeof onTaskBytes === "function" && chunkSize > 0) {
          onTaskBytes("libraries", chunkSize)
        }
      }
    },
  })

  return {
    resolvedVersionId: resolvedVersionId || `${cleanMc}-neoforge-${cleanNf}`,
  }
}

/**
 * Installs or repairs only the missing/corrupted components of Minecraft Vanilla, NeoForge, Libraries and Assets using XMCL.
 * Reuses verified installer JAR from Planner Cache via atomic promotion to instanceRoot/libraries.
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
  customFetch = globalThis.fetch,
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

    // Ensure Planner Cache has installer and promote it to canonical libraries/ path
    const plannerResult = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: cleanNf,
      minecraftVersion: cleanMc,
      cancelSignal,
      signal: cancelSignal?.activeCoreAbortController?.signal,
      customFetch,
    })

    installProfile = plannerResult.installProfile
    const canonicalInstallerPath = await promotePlannerInstallerToCanonical(
      instanceRoot,
      cleanNf,
      plannerResult,
    )

    // Install NeoForge from prepared JAR without re-downloading!
    const neoForgeResult = await installNeoForgeFromPreparedInstaller({
      instanceRoot,
      minecraftVersion: cleanMc,
      neoForgeVersion: cleanNf,
      installProfile,
      javaCliPath,
      canonicalInstallerPath,
      cancelSignal,
      onTaskBytes,
      onPhaseChange,
    })

    resolvedVersionId = neoForgeResult.resolvedVersionId
    installedNeoForge = true
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 3: Parse Resolved Profile and Re-Diagnose
  const postInstallReadiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  // Step 4: Install Libraries ONLY if diagnosis still detects missing libraries (do not duplicate after installByProfile!)
  if (postInstallReadiness.needsLibraries) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    const resolvedVersion = await Version.parse(instanceRoot, resolvedVersionId)
    if (resolvedVersion) {
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
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 5: Install Assets if missing
  if (postInstallReadiness.needsAssets || installedVanilla) {
    if (typeof onPhaseChange === "function") {
      onPhaseChange("DOWNLOADING_CORE")
    }

    const resolvedVersion = await Version.parse(instanceRoot, resolvedVersionId)
    if (resolvedVersion) {
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
  }

  if (cancelSignal?.isCancelled) throw new Error("Core installation cancelled by user.")

  // Step 6: Final Post-Verification Diagnostics
  if (typeof onPhaseChange === "function") {
    onPhaseChange("INSTALLING")
  }

  const finalReadiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  if (!finalReadiness.isCoreInstalled) {
    throw new Error(`Post-installation verification failed: ${finalReadiness.issues.join(", ")}`)
  }

  // Step 7: Persist .hikat/core-state.json
  const coreState = {
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
    resolvedVersionId,
    installedAt: new Date().toISOString(),
    installProfile: finalReadiness.installProfile || installProfile,
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
  buildCoreInstallPlan,
  installOrRepairMinecraftCore,
  installNeoForgeFromPreparedInstaller,
  resolveJavaRuntime,
  validateJavaBinary,
  parseJavaMajorVersion,
  normalizeNeoForgeProfileVersion,
  validateFileIntegrity,
  bootstrapNeoForgeInstaller,
  getPlannerCachePaths,
  loadPlannerInstallerMetadata,
  validatePlannerInstaller,
  ensurePlannerInstaller,
  promotePlannerInstallerToCanonical,
  resolveOfficialNeoForgeInstallerSha256,
  readInstallProfileFromJar,
  getNeoForgeInstallerJarPath,
  getNeoForgeProfileCandidates,
  loadCoreState,
  saveCoreState,
  fetchOfficialNeoForgeInstallerSha256,
  validateFileSha256,
  getCurrentPlatformOsKey,
}
