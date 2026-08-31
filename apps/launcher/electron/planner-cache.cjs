const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const { open, readAllEntries, getEntriesRecord, readEntry } = require("@xmcl/unzip")
const {
  calculateFileSha256,
  validateFileSha256,
  downloadBuffer,
  downloadFileAtomic,
} = require("./artifact-integrity.cjs")

/**
 * Returns external planner cache paths for a NeoForge version.
 */
function getPlannerCachePaths(instanceRoot, neoForgeVersion) {
  const cleanNf = String(neoForgeVersion || "").trim()
  const baseDir = path.dirname(instanceRoot)
  const cacheDir = path.join(baseDir, ".hikat-planner-cache", "neoforge", cleanNf)
  const installerJarPath = path.join(cacheDir, `neoforge-${cleanNf}-installer.jar`)
  const installProfilePath = path.join(cacheDir, "install_profile.json")
  const metadataPath = path.join(cacheDir, "metadata.json")
  const tempInstallerJar = path.join(cacheDir, `installer.tmp.${cleanNf}.jar`)
  return {
    cacheDir,
    installerJar: installerJarPath,
    installerJarPath,
    installProfile: installProfilePath,
    installProfilePath,
    metadataJson: metadataPath,
    metadataPath,
    tempInstallerJar,
  }
}

function normalizeNeoForgeProfileVersion(rawVersion) {
  if (typeof rawVersion !== "string" || !rawVersion.trim()) {
    return ""
  }
  let v = rawVersion.trim()
  v = v.replace(/^.*neoforge[d]?-/i, "")
  return v.trim()
}

/**
 * Returns canonical path in instanceRoot where XMCL expects the NeoForge installer JAR.
 */
function canonicalNeoForgeInstallerPath(instanceRoot, neoForgeVersion) {
  return path.join(
    instanceRoot,
    "libraries",
    "net",
    "neoforged",
    "neoforge",
    neoForgeVersion,
    `neoforge-${neoForgeVersion}-installer.jar`,
  )
}

/**
 * Loads planner cache metadata.json strictly requiring schemaVersion === 2.
 */
async function loadPlannerInstallerMetadata(cacheDir) {
  const metaPath = path.join(cacheDir, "metadata.json")
  try {
    const raw = await fsp.readFile(metaPath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && parsed.schemaVersion === 2) {
      return parsed
    }
    return null
  } catch (_) {
    return null
  }
}

/**
 * Saves planner cache metadata.json safely with schemaVersion === 2.
 */
async function savePlannerInstallerMetadata(cacheDir, metadata) {
  await fsp.mkdir(cacheDir, { recursive: true })
  const metaPath = path.join(cacheDir, "metadata.json")
  const payload = {
    schemaVersion: 2,
    ...metadata,
    sha256: metadata.sha256 || metadata.installerSha256,
    sizeBytes: metadata.sizeBytes !== undefined ? metadata.sizeBytes : metadata.installerSizeBytes,
    updatedAt: new Date().toISOString(),
  }
  const tempPath = path.join(
    cacheDir,
    `metadata.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  await fsp.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8")
  try {
    await fsp.rename(tempPath, metaPath)
  } catch (_) {
    if (fs.existsSync(metaPath)) {
      await fsp.unlink(metaPath)
    }
    await fsp.rename(tempPath, metaPath)
  }
}

/**
 * Validates the cached installer JAR against metadata and official schema.
 */
async function validatePlannerInstaller(instanceRootOrCacheDir, neoForgeVersion, minecraftVersion) {
  let cacheDir
  let cleanNf = ""
  let cleanMc = ""
  if (typeof neoForgeVersion === "string") {
    cleanNf = neoForgeVersion.trim()
    cleanMc = minecraftVersion ? String(minecraftVersion).trim() : ""
    cacheDir = getPlannerCachePaths(instanceRootOrCacheDir, cleanNf).cacheDir
  } else {
    cacheDir = instanceRootOrCacheDir
  }

  const { installerJarPath } = getPlannerCachePaths(
    path.join(cacheDir, "..", "..", "game files"),
    cleanNf || path.basename(cacheDir),
  )

  const metadata = await loadPlannerInstallerMetadata(cacheDir)
  if (!metadata || metadata.schemaVersion !== 2 || !metadata.sha256) {
    return { valid: false, reason: "invalid-or-untrusted-metadata" }
  }

  const jarPath = fs.existsSync(installerJarPath)
    ? installerJarPath
    : path.join(cacheDir, `neoforge-${cleanNf || path.basename(cacheDir)}-installer.jar`)

  if (!fs.existsSync(jarPath)) {
    return { valid: false, reason: "missing-installer-jar" }
  }

  const isShaValid = await validateFileSha256(jarPath, metadata.sizeBytes, metadata.sha256)
  if (!isShaValid) {
    return { valid: false, reason: "corrupted-installer-jar" }
  }

  try {
    const profile = await readInstallProfileFromJar(jarPath)
    if (
      cleanNf &&
      profile.version &&
      normalizeNeoForgeProfileVersion(profile.version) !== normalizeNeoForgeProfileVersion(cleanNf)
    ) {
      return { valid: false, reason: "mismatched-profile" }
    }
    if (cleanMc && profile.minecraft && profile.minecraft !== cleanMc) {
      return { valid: false, reason: "mismatched-minecraft-version" }
    }
    return {
      valid: true,
      installerJar: jarPath,
      installerJarPath: jarPath,
      metadata,
      installProfile: profile,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
    }
  } catch (_) {
    return { valid: false, reason: "unreadable-installer-jar" }
  }
}

/**
 * Resolves the official SHA-256 hash for a NeoForge installer version.
 */
async function fetchOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch = globalThis.fetch, options = {}) {
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-installer.jar.sha256`
  const fetchFn = typeof customFetch === "function" ? customFetch : globalThis.fetch
  const res = await fetchFn(url, { signal: options?.signal })
  if (!res || !res.ok) {
    throw new Error(`Failed to fetch official SHA-256 checksum for NeoForge ${neoForgeVersion}: HTTP ${res?.status || "error"}`)
  }
  const text = await res.text()
  const hash = text.trim().toLowerCase().split(/\s+/)[0]
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`Invalid official SHA-256 checksum format for NeoForge ${neoForgeVersion}: "${text}"`)
  }
  return hash
}

/**
 * Resolves official SHA-256 for NeoForge installer.
 */
async function resolveOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch = globalThis.fetch, options = {}) {
  return await fetchOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch, options)
}

/**
 * Reads install_profile.json from inside an installer JAR.
 */
async function readInstallProfileFromJar(jarPath) {
  const zip = await open(jarPath, { lazyEntries: true, autoClose: false })
  try {
    const entries = await readAllEntries(zip)
    const record = getEntriesRecord(entries)
    const entry = record["install_profile.json"]
    if (!entry) {
      throw new Error(`Missing install_profile.json in installer jar: ${jarPath}`)
    }
    const buf = await readEntry(zip, entry)
    return JSON.parse(buf.toString("utf8"))
  } finally {
    try {
      zip.close()
    } catch (_) {}
  }
}

/**
 * Reads version.json from inside an installer JAR.
 */
async function readVersionJsonFromJar(jarPath) {
  const zip = await open(jarPath, { lazyEntries: true, autoClose: false })
  try {
    const entries = await readAllEntries(zip)
    const record = getEntriesRecord(entries)
    const entry = record["version.json"]
    if (!entry) {
      return null
    }
    const buf = await readEntry(zip, entry)
    return JSON.parse(buf.toString("utf8"))
  } catch (_) {
    return null
  } finally {
    try {
      zip.close()
    } catch (_) {}
  }
}

/**
 * Downloads and prepares NeoForge installer and cached install_profile.json inside the Planner Cache.
 */
async function bootstrapNeoForgeInstaller({
  instanceRoot,
  cacheDir,
  neoForgeVersion,
  expectedSha256,
  cancelSignal,
  signal,
  customFetch,
  onChunkBytes,
}) {
  const effectiveCacheDir = cacheDir || (instanceRoot ? getPlannerCachePaths(instanceRoot, neoForgeVersion).cacheDir : "")
  await fsp.mkdir(effectiveCacheDir, { recursive: true })
  const installerJarPath = path.join(effectiveCacheDir, `neoforge-${neoForgeVersion}-installer.jar`)
  const installProfilePath = path.join(effectiveCacheDir, "install_profile.json")

  const officialSha256 =
    expectedSha256 || (await resolveOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch, { signal }))

  // Check if already valid in Planner Cache
  const metadata = await loadPlannerInstallerMetadata(effectiveCacheDir)
  if (
    metadata &&
    fs.existsSync(installerJarPath) &&
    fs.existsSync(installProfilePath) &&
    (!officialSha256 || metadata.installerSha256 === officialSha256 || metadata.sha256 === officialSha256)
  ) {
    const isHealthy = await validateFileSha256(
      installerJarPath,
      metadata.sizeBytes,
      metadata.sha256 || metadata.installerSha256,
    )
    if (isHealthy) {
      const profileRaw = await fsp.readFile(installProfilePath, "utf8")
      const profile = JSON.parse(profileRaw)
      return {
        installerJar: installerJarPath,
        installerJarPath,
        installProfilePath,
        installProfile: profile,
        sizeBytes: metadata.sizeBytes,
        installerSize: metadata.sizeBytes,
        installerSizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256 || metadata.installerSha256,
        installerSha256: metadata.installerSha256 || metadata.sha256,
        wasCached: true,
        wasAlreadyCached: true,
        downloadedBytes: 0,
        downloadedInPreflight: false,
        preflightDownloadedBytes: 0,
      }
    }
  }

  const downloadUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}-installer.jar`

  await downloadFileAtomic(downloadUrl, installerJarPath, {
    expectedSha256: officialSha256,
    cancelSignal,
    signal,
    onChunkBytes,
    customFetch,
  })

  // Extract install_profile.json
  const profile = await readInstallProfileFromJar(installerJarPath)
  await fsp.writeFile(installProfilePath, JSON.stringify(profile, null, 2), "utf8")

  const stat = await fsp.stat(installerJarPath)
  const actualSha256 = await calculateFileSha256(installerJarPath)

  await savePlannerInstallerMetadata(effectiveCacheDir, {
    neoForgeVersion,
    sha256: actualSha256,
    installerSha256: actualSha256,
    sizeBytes: stat.size,
    installerSize: stat.size,
    installerSizeBytes: stat.size,
    installProfileVersion: profile.version || null,
  })

  return {
    installerJar: installerJarPath,
    installerJarPath,
    installProfilePath,
    installProfile: profile,
    sizeBytes: stat.size,
    installerSize: stat.size,
    installerSizeBytes: stat.size,
    sha256: actualSha256,
    installerSha256: actualSha256,
    wasCached: false,
    wasAlreadyCached: false,
    downloadedBytes: stat.size,
    downloadedInPreflight: true,
    preflightDownloadedBytes: stat.size,
  }
}

/**
 * Ensures that the Planner Cache has a validated NeoForge installer JAR and extracted install_profile.json.
 */
async function ensurePlannerInstaller({
  instanceRoot,
  neoForgeVersion,
  cancelSignal,
  signal,
  customFetch,
  onChunkBytes,
}) {
  const { cacheDir, installerJarPath, installProfilePath } = getPlannerCachePaths(
    instanceRoot,
    neoForgeVersion,
  )

  // 1. Resolve official SHA-256
  const officialSha256 = await resolveOfficialNeoForgeInstallerSha256(neoForgeVersion, customFetch, { signal })

  // 2. Check if already valid in Planner Cache
  const metadata = await loadPlannerInstallerMetadata(cacheDir)
  if (
    metadata &&
    fs.existsSync(installerJarPath) &&
    fs.existsSync(installProfilePath) &&
    (!officialSha256 || metadata.installerSha256 === officialSha256)
  ) {
    try {
      const isHealthy = await validateFileSha256(
        installerJarPath,
        metadata.installerSizeBytes,
        metadata.installerSha256,
      )
      if (isHealthy) {
        const profileRaw = await fsp.readFile(installProfilePath, "utf8")
        const profile = JSON.parse(profileRaw)
        return {
          installerJar: installerJarPath,
          installerJarPath,
          installProfilePath,
          installProfile: profile,
          sizeBytes: metadata.installerSizeBytes,
          installerSizeBytes: metadata.installerSizeBytes,
          sha256: metadata.installerSha256,
          installerSha256: metadata.installerSha256,
          wasCached: true,
          wasAlreadyCached: true,
          downloadedBytes: 0,
        }
      }
    } catch (_) {}
  }

  // 3. Check if canonical location already has the installer JAR and matches official hash
  const canonicalPath = canonicalNeoForgeInstallerPath(instanceRoot, neoForgeVersion)
  if (fs.existsSync(canonicalPath) && officialSha256) {
    try {
      const isCanonicalValid = await validateFileSha256(canonicalPath, -1, officialSha256)
      if (isCanonicalValid) {
        await fsp.mkdir(cacheDir, { recursive: true })
        await fsp.copyFile(canonicalPath, installerJarPath)
        const profile = await readInstallProfileFromJar(installerJarPath)
        await fsp.writeFile(installProfilePath, JSON.stringify(profile, null, 2), "utf8")
        const stat = await fsp.stat(installerJarPath)

        await savePlannerInstallerMetadata(cacheDir, {
          neoForgeVersion,
          installerSha256: officialSha256,
          installerSizeBytes: stat.size,
          installProfileVersion: profile.version || null,
        })

        return {
          installerJar: installerJarPath,
          installerJarPath,
          installProfilePath,
          installProfile: profile,
          sizeBytes: stat.size,
          installerSizeBytes: stat.size,
          sha256: officialSha256,
          installerSha256: officialSha256,
          wasCached: true,
          wasAlreadyCached: true,
          downloadedBytes: 0,
        }
      }
    } catch (_) {}
  }

  // 4. Download and bootstrap to Planner Cache
  return await bootstrapNeoForgeInstaller({
    cacheDir,
    neoForgeVersion,
    expectedSha256: officialSha256,
    cancelSignal,
    signal,
    customFetch,
    onChunkBytes,
  })
}

/**
 * Promotes the installer JAR from Planner Cache to the canonical location in instanceRoot/libraries.
 */
async function promotePlannerInstallerToCanonical(instanceRoot, neoForgeVersion) {
  const { installerJarPath } = getPlannerCachePaths(instanceRoot, neoForgeVersion)
  const canonicalPath = canonicalNeoForgeInstallerPath(instanceRoot, neoForgeVersion)

  if (!fs.existsSync(installerJarPath)) {
    throw new Error(`Planner installer missing at ${installerJarPath}`)
  }

  const destDir = path.dirname(canonicalPath)
  await fsp.mkdir(destDir, { recursive: true })

  if (!fs.existsSync(canonicalPath)) {
    await fsp.copyFile(installerJarPath, canonicalPath)
  }

  return canonicalPath
}

module.exports = {
  getPlannerCachePaths,
  canonicalNeoForgeInstallerPath,
  loadPlannerInstallerMetadata,
  savePlannerInstallerMetadata,
  validatePlannerInstaller,
  fetchOfficialNeoForgeInstallerSha256,
  resolveOfficialNeoForgeInstallerSha256,
  readInstallProfileFromJar,
  readVersionJsonFromJar,
  bootstrapNeoForgeInstaller,
  ensurePlannerInstaller,
  promotePlannerInstallerToCanonical,
}
