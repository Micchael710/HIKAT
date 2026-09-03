const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const axios = require("axios")
const { pipeline } = require("stream/promises")
const { Transform } = require("stream")
const { resolveSafePath } = require("./path-validator.cjs")

const ENFORCED_DIRECTORIES = ["mods", "resourcepacks", "shaderpacks", "kubejs", "scripts"]
const DOWNLOAD_TIMEOUT_MS = 60000
const DEFAULT_API_BASE_URL = "https://api.apparatia.net/api/v1"

/**
 * Calculates SHA-256 hash of a local file via stream.
 */
async function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()))
    stream.on("error", (err) => reject(err))
  })
}

/**
 * Resolves effective API base URL.
 * In development (NODE_ENV !== "production"): defaults to http://127.0.0.1:8787 unless overridden.
 * In production (NODE_ENV === "production"): defaults to https://api.apparatia.net/api/v1.
 */
function getEffectiveApiBaseUrl() {
  const envUrl =
    process.env.HIKAT_API_URL ||
    process.env.VITE_API_URL ||
    process.env.VITE_BACKEND_API_URL

  if (envUrl && typeof envUrl === "string" && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, "")
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://127.0.0.1:8787"
  }

  return DEFAULT_API_BASE_URL
}


/**
 * Security: Validates and restricts download URLs to authorized origins only.
 * - In production: HTTPS only, localhost strictly blocked, only apparatia.net domains allowed.
 * - In dev/test: localhost (HTTP/HTTPS) allowed, external domains must be HTTPS and apparatia.net.
 */
function validateUrlSecurity(parsedUrl) {
  const isProduction = process.env.NODE_ENV === "production"
  const hostname = parsedUrl.hostname.toLowerCase()
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"

  if (isProduction) {
    if (isLocalhost) {
      throw new Error("Localhost download URLs are forbidden in production mode.")
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error(
        `Non-HTTPS download URL is strictly forbidden in production: "${parsedUrl.protocol}"`,
      )
    }
    const allowedHosts = [
      "api.apparatia.net",
      "apparatia.net",
      "assets.apparatia.net",
      "cdn.apparatia.net",
      "backend.apparatia.net",
    ]
    const isAllowed =
      allowedHosts.includes(hostname) || hostname.endsWith(".apparatia.net")
    if (!isAllowed) {
      throw new Error(`Unauthorized external download host blocked: "${hostname}"`)
    }
    return true
  }

  // Development / Test mode
  if (isLocalhost) {
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Invalid protocol for localhost download: "${parsedUrl.protocol}"`)
    }
    return true
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`Non-HTTPS external download URL is forbidden: "${parsedUrl.protocol}"`)
  }

  const allowedHosts = [
    "api.apparatia.net",
    "apparatia.net",
    "assets.apparatia.net",
    "cdn.apparatia.net",
    "backend.apparatia.net",
  ]
  const isAllowed =
    allowedHosts.includes(hostname) || hostname.endsWith(".apparatia.net")
  if (!isAllowed) {
    throw new Error(`Unauthorized external download host blocked: "${hostname}"`)
  }

  return true
}

/**
 * Resolves relative or absolute download URL against official HiKAT API base and validates security.
 */
function resolveAndValidateDownloadUrl(rawUrl, apiBaseUrl = getEffectiveApiBaseUrl()) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("Invalid download URL: must be a non-empty string.")
  }
  const trimmed = rawUrl.trim()

  if (/^(file|javascript|data|blob|vbscript|about):/i.test(trimmed)) {
    throw new Error(`Forbidden protocol in download URL: "${trimmed}"`)
  }

  let resolvedUrl
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    resolvedUrl = new URL(trimmed)
  } else if (trimmed.startsWith("/")) {
    const base = new URL(apiBaseUrl)
    resolvedUrl = new URL(trimmed, base.origin)
  } else {
    const base = new URL(apiBaseUrl)
    resolvedUrl = new URL(
      `${base.pathname.replace(/\/$/, "")}/${trimmed.replace(/^\//, "")}`,
      base.origin,
    )
  }

  validateUrlSecurity(resolvedUrl)
  return resolvedUrl.toString()
}

/**
 * Returns staging directory paths for instance.
 */
function getStagingPaths(instanceRoot) {
  const stagingDir = path.join(instanceRoot, ".hikat", "staging")
  const filesDir = path.join(stagingDir, "files")
  const sessionPath = path.join(stagingDir, "download-session.json")
  return { stagingDir, filesDir, sessionPath }
}

/**
 * Generates a deterministic, safe staging filename for a download task.
 */
function getDeterministicStagingFileName(task) {
  const pathHash = crypto.createHash("sha256").update(task.path).digest("hex").slice(0, 16)
  const shaSlice = String(task.sha256 || "").slice(0, 12).toLowerCase()
  const cleanBasename = path.basename(task.path).replace(/[^a-zA-Z0-9._-]/g, "_")
  return `stage_${pathHash}_${shaSlice}_${cleanBasename}`
}

/**
 * Loads the local installed manifest if present.
 */
async function loadInstalledManifest(instanceRoot) {
  const manifestPath = path.join(instanceRoot, ".hikat", "installed-manifest.json")
  try {
    const raw = await fsp.readFile(manifestPath, "utf8")
    const data = JSON.parse(raw)
    return data && typeof data === "object" ? data : { files: {}, modpackVersion: null }
  } catch (_) {
    return { files: {}, modpackVersion: null }
  }
}

/**
 * Saves the local installed manifest safely via atomic write (temp file + rename).
 */
async function saveInstalledManifest(instanceRoot, manifestData) {
  const metaDir = path.join(instanceRoot, ".hikat")
  await fsp.mkdir(metaDir, { recursive: true })
  const manifestPath = path.join(metaDir, "installed-manifest.json")
  const tempPath = path.join(
    metaDir,
    `installed-manifest.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  await fsp.writeFile(tempPath, JSON.stringify(manifestData, null, 2), "utf8")
  try {
    await fsp.rename(tempPath, manifestPath)
  } catch (_) {
    if (fs.existsSync(manifestPath)) {
      await fsp.unlink(manifestPath)
    }
    await fsp.rename(tempPath, manifestPath)
  }
}

/**
 * Loads the staging download session metadata if present.
 */
async function loadDownloadSession(instanceRoot) {
  const { sessionPath } = getStagingPaths(instanceRoot)
  try {
    const raw = await fsp.readFile(sessionPath, "utf8")
    const data = JSON.parse(raw)
    return data && typeof data === "object" ? data : null
  } catch (_) {
    return null
  }
}

/**
 * Saves staging download session metadata safely via atomic write.
 */
async function saveDownloadSession(instanceRoot, sessionData) {
  const { stagingDir, sessionPath } = getStagingPaths(instanceRoot)
  await fsp.mkdir(stagingDir, { recursive: true })
  const tempPath = path.join(
    stagingDir,
    `session.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  await fsp.writeFile(tempPath, JSON.stringify(sessionData, null, 2), "utf8")
  try {
    await fsp.rename(tempPath, sessionPath)
  } catch (_) {
    if (fs.existsSync(sessionPath)) {
      await fsp.unlink(sessionPath)
    }
    await fsp.rename(tempPath, sessionPath)
  }
}

/**
 * Cleans the staging directory safely within instanceRoot.
 */
async function cleanStaging(instanceRoot) {
  const { stagingDir } = getStagingPaths(instanceRoot)
  try {
    await fsp.rm(stagingDir, { recursive: true, force: true })
  } catch (_) {}
}

/**
 * Reconciles existing staged files on disk with the current required download tasks.
 * Validates existence, size, and SHA-256 for each staged file before reusing.
 * Removes obsolete or corrupt files.
 */
async function reconcileStagingFiles(instanceRoot, toDownloadTasks) {
  const { filesDir } = getStagingPaths(instanceRoot)
  const validStagedMap = new Map()
  let alreadyStagedBytes = 0

  await fsp.mkdir(filesDir, { recursive: true })

  const expectedFileNames = new Set()

  for (const task of toDownloadTasks) {
    const fileName = getDeterministicStagingFileName(task)
    expectedFileNames.add(fileName)
    const filePath = path.join(filesDir, fileName)

    if (fs.existsSync(filePath)) {
      try {
        const stat = await fsp.stat(filePath)
        if (task.sizeBytes > 0 && stat.size === task.sizeBytes) {
          const localSha = await calculateFileSha256(filePath)
          if (localSha === task.sha256.toLowerCase()) {
            validStagedMap.set(task.path, filePath)
            alreadyStagedBytes += stat.size
          } else {
            await fsp.unlink(filePath)
          }
        } else if (task.sizeBytes > 0 && stat.size > 0 && stat.size < task.sizeBytes) {
          // Valid partial file: preserve for resume and count its bytes
          alreadyStagedBytes += stat.size
        } else {
          // Inconsistent/oversized or zero-length file: delete
          await fsp.unlink(filePath)
        }
      } catch (_) {
        try {
          await fsp.unlink(filePath)
        } catch (_) {}
      }
    }
  }

  // Clean orphaned files in staging/files that do not belong to current tasks
  try {
    const existingEntries = await fsp.readdir(filesDir)
    for (const entry of existingEntries) {
      if (!expectedFileNames.has(entry)) {
        try {
          await fsp.unlink(path.join(filesDir, entry))
        } catch (_) {}
      }
    }
  } catch (_) {}

  return { validStagedMap, alreadyStagedBytes }
}

/**
 * Resolves the effective policy ("MODIFICABLE" | "NO_MODIFICABLE") for a path,
 * checking exact path first, then closest ancestor directory in the files map.
 */
function resolvePathPolicy(relPath, filesMap) {
  if (!relPath || !filesMap) return null
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")

  // 1. Direct match
  if (filesMap instanceof Map) {
    if (filesMap.has(normalized)) {
      const item = filesMap.get(normalized)
      const p = item?.policy || item
      if (p === "MODIFICABLE" || p === "NO_MODIFICABLE") return p
    }
  } else if (Object.prototype.hasOwnProperty.call(filesMap, normalized)) {
    const item = filesMap[normalized]
    const p = item?.policy || item
    if (p === "MODIFICABLE" || p === "NO_MODIFICABLE") return p
  }

  // 2. Ancestor directory match (from deepest to root)
  const segments = normalized.split("/")
  for (let i = segments.length - 1; i > 0; i--) {
    const parentPath = segments.slice(0, i).join("/")
    if (filesMap instanceof Map) {
      if (filesMap.has(parentPath)) {
        const parentItem = filesMap.get(parentPath)
        const p = parentItem?.policy || parentItem
        if (p === "MODIFICABLE" || p === "NO_MODIFICABLE") return p
      }
    } else if (Object.prototype.hasOwnProperty.call(filesMap, parentPath)) {
      const parentItem = filesMap[parentPath]
      const p = parentItem?.policy || parentItem
      if (p === "MODIFICABLE" || p === "NO_MODIFICABLE") return p
    }
  }

  return null
}

function resolveWatcherDecision(
  relPath,
  directoryPolicies = [],
  installedManifestFiles = {},
  instanceRoot = null,
) {
  const norm = String(relPath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!norm) return "IGNORE"

  // 1. Identify directory policies and directory entries
  let isDirectory = false
  let dirExplicitPolicy = null

  if (Array.isArray(directoryPolicies) && directoryPolicies.length > 0) {
    for (const dp of directoryPolicies) {
      if (dp && dp.path) {
        const dNorm = String(dp.path).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
        if (dNorm === norm) {
          isDirectory = true
          dirExplicitPolicy = dp.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE"
          break
        }
      }
    }
  }

  // 2. Exact match in installedManifestFiles
  let exactPolicy = null
  let isManifestDir = false

  if (installedManifestFiles instanceof Map) {
    if (installedManifestFiles.has(norm)) {
      const item = installedManifestFiles.get(norm)
      exactPolicy = item?.policy || item
      if (item && typeof item === "object" && !item.officialSha256) {
        isManifestDir = true
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(installedManifestFiles, norm)) {
    const item = installedManifestFiles[norm]
    exactPolicy = item?.policy || item
    if (item && typeof item === "object" && !item.officialSha256) {
      isManifestDir = true
    }
  }

  // If it's a directory container event:
  if (isDirectory || isManifestDir) {
    const fullPath = instanceRoot ? path.join(instanceRoot, norm) : null
    const dirStillExists = fullPath ? fs.existsSync(fullPath) : false

    if (dirStillExists) {
      // Container directory modified because a child inside changed -> ignore container, child event decides
      return "IGNORE"
    } else {
      // Whole directory was deleted or checked without existing path
      const effectiveDirPolicy = dirExplicitPolicy || exactPolicy || "NO_MODIFICABLE"
      return effectiveDirPolicy === "NO_MODIFICABLE" ? "EMIT" : "IGNORE"
    }
  }

  // 3. Exact file policy match
  if (exactPolicy === "NO_MODIFICABLE") {
    return "EMIT"
  }
  if (exactPolicy === "MODIFICABLE") {
    return "IGNORE"
  }

  // 4. Ancestor directory match in directoryPolicies or installedManifestFiles
  let dirPolicy = null
  if (Array.isArray(directoryPolicies) && directoryPolicies.length > 0) {
    const dirMap = new Map()
    for (const dp of directoryPolicies) {
      if (dp && dp.path) {
        const dNorm = String(dp.path).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
        if (dNorm) {
          dirMap.set(dNorm, dp.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE")
        }
      }
    }
    dirPolicy = resolvePathPolicy(norm, dirMap)
  }

  if (!dirPolicy) {
    dirPolicy = resolvePathPolicy(norm, installedManifestFiles)
  }

  if (dirPolicy === "MODIFICABLE") {
    return "IGNORE"
  }
  if (dirPolicy === "NO_MODIFICABLE") {
    return "EMIT"
  }

  // 5. Fallback to ENFORCED_DIRECTORIES
  const enforcedDirs = Array.isArray(ENFORCED_DIRECTORIES)
    ? ENFORCED_DIRECTORIES
    : ["mods", "resourcepacks", "shaderpacks", "kubejs", "scripts"]
  const isEnforcedDir = enforcedDirs.some(
    (dir) => norm === dir || norm.startsWith(`${dir}/`),
  )

  if (isEnforcedDir) {
    return "EMIT"
  }

  return "IGNORE"
}

/**
 * Generates the SyncPlan before touching any instance files.
 * Authoritative over local filesystem and installed manifest.
 */
async function generateSyncPlan(
  instanceRoot,
  clientFiles,
  modpackVersion,
  directoryPolicies = [],
  isVerify = false,
  onProgress = null,
) {
  const installedManifest = await loadInstalledManifest(instanceRoot)
  const previousFilesMap = installedManifest.files || {}
  const isSameRelease = Boolean(
    installedManifest.modpackVersion && installedManifest.modpackVersion === modpackVersion,
  )

  const plan = {
    modpackVersion,
    toDownload: [],
    toRetain: [],
    toPreserveUser: [],
    toPrune: [],
    totalDownloadBytes: 0,
    hasExistingInstall: Boolean(installedManifest.modpackVersion),
  }

  const dirPoliciesMap = new Map()
  if (Array.isArray(directoryPolicies)) {
    for (const dp of directoryPolicies) {
      if (dp && dp.path) {
        const norm = String(dp.path).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
        if (norm) {
          dirPoliciesMap.set(norm, dp.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE")
        }
      }
    }
  }

  const clientFilesMap = new Map()

  for (const item of clientFiles) {
    if (!item || !item.path) continue

    // Legacy jdk-21 files are excluded from sync and managed independently under launcher runtime
    const rawPath = String(item.path || "").trim().replace(/\\/g, "/")
    if (rawPath === "jdk-21" || rawPath.startsWith("jdk-21/")) {
      console.warn(`[SyncEngine] Skipping legacy clientFile "${rawPath}": Java 21 runtime is now managed independently in launcher runtime directory.`)
      continue
    }

    const safeAbsolute = resolveSafePath(instanceRoot, item.path)
    const normalizedRelative = path.relative(instanceRoot, safeAbsolute).replace(/\\/g, "/")
    const expectedSha256 = String(item.sha256 || "").toLowerCase().trim()
    const sizeBytes = Number(item.sizeBytes) || 0

    let policy =
      item.policy === "MODIFICABLE"
        ? "MODIFICABLE"
        : item.policy === "NO_MODIFICABLE"
          ? "NO_MODIFICABLE"
          : null
    if (!policy) {
      policy =
        resolvePathPolicy(normalizedRelative, dirPoliciesMap) ||
        resolvePathPolicy(normalizedRelative, previousFilesMap) ||
        "NO_MODIFICABLE"
    }

    clientFilesMap.set(normalizedRelative, {
      ...item,
      path: normalizedRelative,
      safeAbsolute,
      policy,
      expectedSha256,
      sizeBytes,
    })
  }

  let checkedCount = 0
  const totalClientFiles = clientFilesMap.size

  for (const [normalizedRelative, item] of clientFilesMap.entries()) {
    checkedCount++
    if (isVerify && typeof onProgress === "function" && totalClientFiles > 0) {
      const p = Math.round((checkedCount / totalClientFiles) * 30)
      onProgress({
        phase: "VERIFYING",
        progress: p,
      })
    }
    const { safeAbsolute, policy, expectedSha256, sizeBytes } = item
    const fileExists = fs.existsSync(safeAbsolute)
    const prevFileMeta = previousFilesMap[normalizedRelative]
    const lastOfficialSha256 = prevFileMeta?.officialSha256
      ? prevFileMeta.officialSha256.toLowerCase().trim()
      : null
    const wasInstalledBefore = Boolean(prevFileMeta)

    if (policy === "NO_MODIFICABLE") {
      if (fileExists) {
        try {
          const localSha256 = await calculateFileSha256(safeAbsolute)
          if (localSha256 === expectedSha256) {
            plan.toRetain.push({ path: normalizedRelative, safeAbsolute })
            plan.hasExistingInstall = true
            continue
          }
        } catch (_) {}
      }
      // Missing or hash mismatch -> must download & enforce
      plan.toDownload.push({
        path: normalizedRelative,
        safeAbsolute,
        downloadUrl: item.downloadUrl,
        sha256: expectedSha256,
        sizeBytes,
        policy,
      })
      plan.totalDownloadBytes += sizeBytes
    } else {
      // policy === "MODIFICABLE"
      if (!fileExists) {
        if (isSameRelease && wasInstalledBefore && !isVerify) {
          // Player deleted it within the same release: permitted, do NOT download or repair
          plan.toPreserveUser.push({ path: normalizedRelative, safeAbsolute })
          plan.hasExistingInstall = true
        } else {
          // Fresh install OR new release that contains it: download fresh template
          plan.toDownload.push({
            path: normalizedRelative,
            safeAbsolute,
            downloadUrl: item.downloadUrl,
            sha256: expectedSha256,
            sizeBytes,
            policy,
          })
          plan.totalDownloadBytes += sizeBytes
        }
      } else {
        // File exists physically on disk. Check its physical hash:
        let localSha256 = null
        try {
          localSha256 = await calculateFileSha256(safeAbsolute)
        } catch (_) {}

        if (localSha256 && localSha256 === expectedSha256) {
          // Physical file already matches expected official hash
          plan.toRetain.push({ path: normalizedRelative, safeAbsolute })
          plan.hasExistingInstall = true
        } else if (!wasInstalledBefore) {
          // First installation with unknown local file: must establish official template and officialSha256
          plan.toDownload.push({
            path: normalizedRelative,
            safeAbsolute,
            downloadUrl: item.downloadUrl,
            sha256: expectedSha256,
            sizeBytes,
            policy,
          })
          plan.totalDownloadBytes += sizeBytes
        } else if (isSameRelease) {
          // Player edited the file during this release: preserve it
          plan.toPreserveUser.push({ path: normalizedRelative, safeAbsolute })
          plan.hasExistingInstall = true
        } else {
          // New release:
          // If local was untouched from the previous official and admin changed it -> update
          if (
            lastOfficialSha256 &&
            localSha256 &&
            localSha256 === lastOfficialSha256 &&
            lastOfficialSha256 !== expectedSha256
          ) {
            plan.toDownload.push({
              path: normalizedRelative,
              safeAbsolute,
              downloadUrl: item.downloadUrl,
              sha256: expectedSha256,
              sizeBytes,
              policy,
            })
            plan.totalDownloadBytes += sizeBytes
          } else {
            // Player customized it (localSha256 !== lastOfficialSha256) -> preserve player's customization
            plan.toPreserveUser.push({ path: normalizedRelative, safeAbsolute })
            plan.hasExistingInstall = true
          }
        }
      }
    }
  }

  // Scan enforced directories and custom directoryPolicies for pruning unauthorized extra files, respecting MODIFICABLE folder policies
  const scanDirsSet = new Set(ENFORCED_DIRECTORIES)
  if (Array.isArray(directoryPolicies)) {
    for (const dp of directoryPolicies) {
      if (dp && dp.path) {
        const norm = String(dp.path).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
        if (norm) {
          scanDirsSet.add(norm)
        }
      }
    }
  }

  const scannedPaths = new Set()

  for (const dirName of scanDirsSet) {
    const safeAbsolute = resolveSafePath(instanceRoot, dirName)
    if (!fs.existsSync(safeAbsolute)) continue

    const scanDirectory = async (currentDir) => {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await scanDirectory(fullPath)
        } else if (entry.isFile()) {
          const relative = path.relative(instanceRoot, fullPath).replace(/\\/g, "/")
          if (scannedPaths.has(relative)) continue
          scannedPaths.add(relative)

          if (!clientFilesMap.has(relative)) {
            const effPolicy =
              resolvePathPolicy(relative, dirPoliciesMap) ||
              resolvePathPolicy(relative, clientFilesMap) ||
              resolvePathPolicy(relative, previousFilesMap)
            if (effPolicy !== "MODIFICABLE") {
              plan.toPrune.push({ path: relative, safeAbsolute: fullPath })
            } else {
              plan.toPreserveUser.push({ path: relative, safeAbsolute: fullPath })
            }
          }
        }
      }
    }

    try {
      const stat = await fsp.stat(safeAbsolute)
      if (stat.isDirectory()) {
        await scanDirectory(safeAbsolute)
      }
    } catch (err) {
      console.warn(`[SyncEngine] Directory scan warning for ${dirName}:`, err.message)
    }
  }

  if (isVerify && typeof onProgress === "function") {
    onProgress({
      phase: "VERIFYING",
      progress: 35,
    })
  }

  return plan
}

/**
 * Downloads a single file to staging path, streaming and validating SHA-256 and size on the fly.
 * Supports resuming from partial staging files via HTTP Range.
 * On pause or generic network error: preserves partial file.
 * On explicit cancel or integrity mismatch: unlinks staging file.
 */
async function downloadToStaging(
  task,
  stagingPath,
  onChunkBytes,
  cancelSignal,
  apiBaseUrl,
  onFallbackFullDownload,
) {
  if (cancelSignal?.isCancelled) {
    throw new Error("Download cancelled")
  }
  if (cancelSignal?.isPaused) {
    throw new Error("Download paused")
  }

  await fsp.mkdir(path.dirname(stagingPath), { recursive: true })
  const safeDownloadUrl = resolveAndValidateDownloadUrl(task.downloadUrl, apiBaseUrl)

  // Inspect existing partial or complete staging file
  let partialSize = 0
  try {
    if (fs.existsSync(stagingPath)) {
      const stat = await fsp.stat(stagingPath)
      if (task.sizeBytes > 0 && stat.size === task.sizeBytes) {
        const existingSha = await calculateFileSha256(stagingPath)
        if (existingSha === task.sha256.toLowerCase()) {
          return { bytes: stat.size, sha256: existingSha }
        } else {
          await fsp.unlink(stagingPath).catch(() => {})
        }
      } else if (task.sizeBytes > 0 && stat.size > 0 && stat.size < task.sizeBytes) {
        partialSize = stat.size
      } else {
        await fsp.unlink(stagingPath).catch(() => {})
      }
    }
  } catch (_) {
    await fsp.unlink(stagingPath).catch(() => {})
    partialSize = 0
  }

  const executeDownloadStream = async (useRange) => {
    const headers = {}
    if (useRange && partialSize > 0) {
      headers["Range"] = `bytes=${partialSize}-`
    }

    let response
    try {
      response = await axios({
        url: safeDownloadUrl,
        method: "GET",
        headers,
        responseType: "stream",
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        maxRedirects: 5,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 416,
        beforeRedirect: (options, responseDetails) => {
          const redirectLocation = responseDetails.headers.location
          if (redirectLocation) {
            const redirectUrl = new URL(redirectLocation, options.href)
            validateUrlSecurity(redirectUrl)
          }
        },
      })
    } catch (reqErr) {
      if (cancelSignal?.isCancelled) {
        await fsp.unlink(stagingPath).catch(() => {})
        throw new Error("Download cancelled")
      }
      if (cancelSignal?.isPaused) {
        throw new Error("Download paused")
      }
      throw reqErr
    }

    let isAppend = false
    if (useRange && partialSize > 0) {
      if (response.status === 206) {
        const contentRange =
          response.headers["content-range"] || response.headers["Content-Range"] || ""
        const rangeMatch = contentRange.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i)
        if (rangeMatch && parseInt(rangeMatch[1], 10) === partialSize) {
          isAppend = true
        }
      }

      if (!isAppend) {
        try {
          if (response.data && typeof response.data.destroy === "function") {
            response.data.destroy()
          }
        } catch (_) {}

        if (typeof onFallbackFullDownload === "function") {
          onFallbackFullDownload(partialSize)
        }
        await fsp.unlink(stagingPath).catch(() => {})
        partialSize = 0

        return executeDownloadStream(false)
      }
    }

    const progressTransform = new Transform({
      transform(chunk, _encoding, callback) {
        if (cancelSignal?.isCancelled) {
          callback(new Error("Download cancelled"))
          return
        }
        if (cancelSignal?.isPaused) {
          callback(new Error("Download paused"))
          return
        }
        if (typeof onChunkBytes === "function") {
          onChunkBytes(chunk.length)
        }
        callback(null, chunk)
      },
    })

    const fileWriteStream = fs.createWriteStream(stagingPath, {
      flags: isAppend ? "a" : "w",
    })

    try {
      await pipeline(response.data, progressTransform, fileWriteStream)
    } catch (err) {
      if (cancelSignal?.isCancelled) {
        await fsp.unlink(stagingPath).catch(() => {})
      }
      throw err
    }
  }

  await executeDownloadStream(partialSize > 0)

  // Validate complete file integrity at the end
  const finalStat = await fsp.stat(stagingPath)
  if (task.sizeBytes > 0 && finalStat.size !== task.sizeBytes) {
    await fsp.unlink(stagingPath).catch(() => {})
    throw new Error(
      `Size mismatch for ${task.path}. Expected: ${task.sizeBytes} bytes, Got: ${finalStat.size} bytes`,
    )
  }

  const computedSha256 = await calculateFileSha256(stagingPath)
  if (task.sha256 && computedSha256 !== task.sha256.toLowerCase()) {
    await fsp.unlink(stagingPath).catch(() => {})
    throw new Error(
      `SHA-256 mismatch for ${task.path}. Expected: ${task.sha256}, Got: ${computedSha256}`,
    )
  }

  return { bytes: finalStat.size, sha256: computedSha256 }
}


/**
 * Downloads all required client files to the staging directory without mutating instanceRoot.
 */
async function downloadClientFilesToStaging({
  instanceRoot,
  clientFiles = [],
  directoryPolicies = [],
  modpackVersion,
  onProgress,
  onPhaseChange,
  cancelSignal,
  apiBaseUrl,
  isVerify = false,
}) {
  const plan = await generateSyncPlan(
    instanceRoot,
    clientFiles,
    modpackVersion,
    directoryPolicies,
    isVerify,
  )
  const { filesDir } = getStagingPaths(instanceRoot)
  const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
    instanceRoot,
    plan.toDownload,
  )

  let totalDownloadedBytes = alreadyStagedBytes
  const startTime = Date.now()
  let lastReportTime = 0
  let lastSpeedSampleTime = startTime
  let lastSpeedSampleBytes = alreadyStagedBytes
  let currentSpeedMBs = 0
  let currentRemainingMinutes = 0
  let currentPhase = "DOWNLOADING"

  const reportProgress = (currentTaskPath = "") => {
    const now = Date.now()
    if (now - lastReportTime < 70 && totalDownloadedBytes < plan.totalDownloadBytes) {
      return
    }
    lastReportTime = now

    // Sample and update speed and remaining time every 1 second (1000ms)
    const speedDeltaMs = now - lastSpeedSampleTime
    if (speedDeltaMs >= 1000 || currentSpeedMBs === 0) {
      const elapsedSec = Math.max(0.1, speedDeltaMs / 1000)
      const instantSpeed = (totalDownloadedBytes - lastSpeedSampleBytes) / 1024 / 1024 / elapsedSec
      currentSpeedMBs = Number(Math.max(0, instantSpeed).toFixed(2))
      lastSpeedSampleTime = now
      lastSpeedSampleBytes = totalDownloadedBytes

      const remainingBytes = Math.max(0, plan.totalDownloadBytes - totalDownloadedBytes)
      currentRemainingMinutes =
        currentSpeedMBs > 0 ? Math.ceil(remainingBytes / 1024 / 1024 / currentSpeedMBs / 60) : 0
    }

    const totalGB = plan.totalDownloadBytes / 1024 / 1024 / 1024
    const downloadedGB = totalDownloadedBytes / 1024 / 1024 / 1024
    const progress =
      plan.totalDownloadBytes > 0
        ? Math.min(100, Math.round((totalDownloadedBytes / plan.totalDownloadBytes) * 100))
        : 100

    if (typeof onProgress === "function") {
      onProgress({
        progress,
        phase: currentPhase,
        downloadedGB: Number(downloadedGB.toFixed(2)),
        totalGB: Number(totalGB.toFixed(2)),
        speedMBs: currentSpeedMBs,
        remainingMinutes: currentRemainingMinutes,
        currentFile: currentTaskPath,
        filesToDownload: plan.toDownload.length,
        filesToPrune: plan.toPrune.length,
        downloadedBytes: totalDownloadedBytes,
        totalBytes: plan.totalDownloadBytes,
      })
    }
  }

  const stagedFiles = []
  const sessionCompletedFiles = {}

  try {
    for (let i = 0; i < plan.toDownload.length; i++) {
      if (cancelSignal?.isCancelled) {
        await cleanStaging(instanceRoot)
        throw new Error("Sync cancelled by user.")
      }
      if (cancelSignal?.isPaused) {
        await saveDownloadSession(instanceRoot, {
          modpackVersion,
          status: "PAUSED",
          operationKind: isVerify ? "VERIFY" : "SYNC",
          updatedAt: new Date().toISOString(),
          files: sessionCompletedFiles,
        })
        return {
          paused: true,
          plan,
          stagedFiles,
          downloadedCount: stagedFiles.length,
          totalCount: plan.toDownload.length,
        }
      }

      const task = plan.toDownload[i]
      const stagingFileName = getDeterministicStagingFileName(task)
      const stagingFilePath = path.join(filesDir, stagingFileName)

      // If already verified and staged, reuse it!
      if (validStagedMap.has(task.path)) {
        stagedFiles.push({ task, stagingFilePath })
        sessionCompletedFiles[task.path] = {
          stagingFileName,
          sha256: task.sha256,
          sizeBytes: task.sizeBytes,
          completedAt: new Date().toISOString(),
        }
        reportProgress(task.path)
        continue
      }

      reportProgress(task.path)

      try {
        await downloadToStaging(
          task,
          stagingFilePath,
          (chunkLength) => {
            totalDownloadedBytes += chunkLength
            reportProgress(task.path)
          },
          cancelSignal,
          apiBaseUrl,
          (deductBytes) => {
            totalDownloadedBytes = Math.max(0, totalDownloadedBytes - deductBytes)
            reportProgress(task.path)
          },
        )

        stagedFiles.push({ task, stagingFilePath })
        sessionCompletedFiles[task.path] = {
          stagingFileName,
          sha256: task.sha256,
          sizeBytes: task.sizeBytes,
          completedAt: new Date().toISOString(),
        }

        await saveDownloadSession(instanceRoot, {
          modpackVersion,
          status: "DOWNLOADING",
          operationKind: isVerify ? "VERIFY" : "SYNC",
          updatedAt: new Date().toISOString(),
          files: sessionCompletedFiles,
        })
      } catch (dlErr) {
        if (cancelSignal?.isCancelled) {
          await cleanStaging(instanceRoot)
          throw new Error("Sync cancelled by user.")
        }
        if (cancelSignal?.isPaused) {
          await saveDownloadSession(instanceRoot, {
            modpackVersion,
            status: "PAUSED",
            operationKind: isVerify ? "VERIFY" : "SYNC",
            updatedAt: new Date().toISOString(),
            files: sessionCompletedFiles,
          })
          return {
            paused: true,
            plan,
            stagedFiles,
            downloadedCount: stagedFiles.length,
            totalCount: plan.toDownload.length,
          }
        }
        await saveDownloadSession(instanceRoot, {
          modpackVersion,
          status: "ERROR",
          operationKind: isVerify ? "VERIFY" : "SYNC",
          updatedAt: new Date().toISOString(),
          files: sessionCompletedFiles,
        })
        throw dlErr
      }
    }
  } catch (err) {
    if (cancelSignal?.isCancelled) {
      await cleanStaging(instanceRoot)
    }
    throw err
  }

  return {
    success: true,
    plan,
    stagedFiles,
    totalDownloadedBytes,
    alreadyStagedBytes,
  }
}

/**
 * Builds installed manifest metadata with directory policies and official SHA-256 references.
 */
function buildInstalledManifestData(
  instanceRoot,
  clientFiles = [],
  modpackVersion,
  directoryPolicies = [],
) {
  const newManifestFiles = {}

  if (Array.isArray(directoryPolicies)) {
    for (const dp of directoryPolicies) {
      if (!dp || !dp.path) continue
      const normalizedRelative = String(dp.path).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
      if (normalizedRelative) {
        newManifestFiles[normalizedRelative] = {
          policy: dp.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE",
          lastSyncedAt: new Date().toISOString(),
        }
      }
    }
  }

  for (const item of clientFiles) {
    if (!item?.path) continue
    const rawPath = String(item.path || "").trim().replace(/\\/g, "/")
    if (rawPath === "jdk-21" || rawPath.startsWith("jdk-21/")) continue

    const normalizedRelative = path
      .relative(instanceRoot, resolveSafePath(instanceRoot, item.path))
      .replace(/\\/g, "/")
    newManifestFiles[normalizedRelative] = {
      officialSha256: String(item.sha256 || "").toLowerCase().trim(),
      policy: item.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE",
      lastSyncedAt: new Date().toISOString(),
    }
  }

  return {
    modpackVersion,
    lastSync: new Date().toISOString(),
    files: newManifestFiles,
  }
}

/**
 * Applies all staged files to instanceRoot atomically, prunes obsolete files, validates manifest, and cleans staging.
 * Local operation only: ZERO network calls.
 */
async function applyStagingToInstance({
  instanceRoot,
  clientFiles = [],
  directoryPolicies = [],
  modpackVersion,
  stagedFiles = [],
  plan,
  onProgress,
  onPhaseChange,
  cancelSignal,
  isVerify = false,
  progressRange,
}) {
  if (cancelSignal?.isCancelled) {
    await cleanStaging(instanceRoot)
    throw new Error("Sync cancelled by user.")
  }

  // Persist INSTALLING / VERIFYING state at the start before modifying any files
  await saveDownloadSession(instanceRoot, {
    modpackVersion,
    status: isVerify ? "VERIFYING" : "INSTALLING",
    operationKind: isVerify ? "VERIFY" : "SYNC",
    updatedAt: new Date().toISOString(),
  })

  const effectivePlan =
    plan ||
    (await generateSyncPlan(
      instanceRoot,
      clientFiles,
      modpackVersion,
      directoryPolicies,
      isVerify,
    ))

  const currentPhase = isVerify ? "VERIFYING" : "INSTALLING"

  if (typeof onPhaseChange === "function") {
    onPhaseChange(currentPhase)
  }

  const rStart = typeof progressRange?.start === "number" ? progressRange.start : (isVerify ? 50 : 0)
  const rEnd = typeof progressRange?.end === "number" ? progressRange.end : (isVerify ? 90 : 90)
  const rSpan = Math.max(0, rEnd - rStart)

  const totalStaged = stagedFiles.length

  if (typeof onProgress === "function") {
    onProgress({
      phase: currentPhase,
      downloadedBytes: effectivePlan.totalDownloadBytes,
      totalBytes: effectivePlan.totalDownloadBytes,
      progress: rStart,
    })
  }

  // 1. Pre-application verification: Verify EVERY staged file before touching instance files
  let verifiedCount = 0
  for (const { task, stagingFilePath } of stagedFiles) {
    if (!fs.existsSync(stagingFilePath)) {
      throw new Error(`Staged file missing before installation: ${task.path}`)
    }
    const stat = await fsp.stat(stagingFilePath)
    if (stat.size !== task.sizeBytes) {
      throw new Error(
        `Staged file size mismatch for ${task.path}: expected ${task.sizeBytes} bytes, got ${stat.size} bytes.`,
      )
    }
    const actualSha256 = await calculateFileSha256(stagingFilePath)
    if (actualSha256 !== task.sha256) {
      throw new Error(
        `Staged file SHA-256 mismatch for ${task.path}: expected ${task.sha256}, got ${actualSha256}.`,
      )
    }
    verifiedCount++
    if (typeof onProgress === "function" && totalStaged > 0) {
      const p = Math.round(rStart + (verifiedCount / totalStaged) * (0.25 * rSpan))
      onProgress({
        phase: currentPhase,
        downloadedBytes: effectivePlan.totalDownloadBytes,
        totalBytes: effectivePlan.totalDownloadBytes,
        progress: p,
      })
    }
  }

  // 2. Atomic Replacement into instance root
  let appliedCount = 0
  for (const { task, stagingFilePath } of stagedFiles) {
    const destPath = task.safeAbsolute
    await fsp.mkdir(path.dirname(destPath), { recursive: true })

    const tempSibling = path.join(
      path.dirname(destPath),
      `.${path.basename(destPath)}.${Date.now()}.tmp`,
    )
    try {
      await fsp.copyFile(stagingFilePath, tempSibling)
      await fsp.rename(tempSibling, destPath)
    } catch (err) {
      try {
        if (fs.existsSync(tempSibling)) {
          await fsp.unlink(tempSibling)
        }
      } catch (_) {}
      throw err
    }
    appliedCount++
    if (typeof onProgress === "function" && totalStaged > 0) {
      const p = Math.round(rStart + 0.25 * rSpan + (appliedCount / totalStaged) * (0.5 * rSpan))
      onProgress({
        phase: currentPhase,
        downloadedBytes: effectivePlan.totalDownloadBytes,
        totalBytes: effectivePlan.totalDownloadBytes,
        progress: p,
      })
    }
  }

  // 3. Prune obsolete files in strict directories
  const totalPrune = effectivePlan.toPrune.length
  let prunedCount = 0
  for (const pruneItem of effectivePlan.toPrune) {
    if (fs.existsSync(pruneItem.safeAbsolute)) {
      try {
        await fsp.unlink(pruneItem.safeAbsolute)
      } catch (err) {
        throw new Error(
          `Pruning failed for file ${pruneItem.path}: ${err.message}. Installation cannot complete safely.`,
        )
      }
    }
    prunedCount++
    if (typeof onProgress === "function" && totalPrune > 0) {
      const p = Math.round(rStart + 0.75 * rSpan + (prunedCount / totalPrune) * (0.15 * rSpan))
      onProgress({
        phase: currentPhase,
        downloadedBytes: effectivePlan.totalDownloadBytes,
        totalBytes: effectivePlan.totalDownloadBytes,
        progress: p,
      })
    }
  }

  // 4. Mandatory Final Verification
  const postPlan = await generateSyncPlan(
    instanceRoot,
    clientFiles,
    modpackVersion,
    directoryPolicies,
    isVerify,
  )
  if (postPlan.toDownload.length > 0 || postPlan.toPrune.length > 0) {
    throw new Error(
      `Post-installation verification failed: ${postPlan.toDownload.length} files missing/corrupt, ${postPlan.toPrune.length} files unpruned.`,
    )
  }

  if (typeof onProgress === "function") {
    onProgress({
      phase: currentPhase,
      downloadedBytes: effectivePlan.totalDownloadBytes,
      totalBytes: effectivePlan.totalDownloadBytes,
      progress: rEnd,
    })
  }

  // 5. Build installed manifest metadata with directory policies and official SHA-256 references
  const manifestData = buildInstalledManifestData(
    instanceRoot,
    clientFiles,
    modpackVersion,
    directoryPolicies,
  )

  return {
    success: true,
    downloadedCount: stagedFiles.length,
    prunedCount: effectivePlan.toPrune.length,
    retainedCount: effectivePlan.toRetain.length + effectivePlan.toPreserveUser.length,
    manifestData,
  }
}

/**
 * High-level executeSync composing download and apply phases.
 */
async function executeSync(options) {
  const downloadResult = await downloadClientFilesToStaging(options)
  if (downloadResult.paused) {
    return downloadResult
  }

  const applyResult = await applyStagingToInstance({
    instanceRoot: options.instanceRoot,
    clientFiles: options.clientFiles,
    directoryPolicies: options.directoryPolicies,
    modpackVersion: options.modpackVersion,
    stagedFiles: downloadResult.stagedFiles,
    plan: downloadResult.plan,
    onProgress: options.onProgress,
    onPhaseChange: options.onPhaseChange,
    cancelSignal: options.cancelSignal,
    isVerify: Boolean(options.isVerify),
  })

  if (applyResult && applyResult.manifestData) {
    await saveInstalledManifest(options.instanceRoot, applyResult.manifestData)
    await cleanStaging(options.instanceRoot)
  }

  return applyResult
}

/**
 * Safely uninstalls the game instance directory.
 * Strictly verifies path against appData canonical boundaries.
 */
async function uninstallGame(instanceRoot, appDataRoot) {
  const resolvedInstance = path.resolve(instanceRoot)
  const resolvedAppData = path.resolve(appDataRoot)

  const relative = path.relative(resolvedAppData, resolvedInstance)
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    resolvedInstance === path.parse(resolvedInstance).root
  ) {
    throw new Error("Security violation: Attempted to uninstall directory outside canonical appData.")
  }

  if (fs.existsSync(resolvedInstance)) {
    await fsp.rm(resolvedInstance, { recursive: true, force: true })
  }

  return { success: true }
}

module.exports = {
  generateSyncPlan,
  downloadClientFilesToStaging,
  applyStagingToInstance,
  executeSync,
  loadInstalledManifest,
  saveInstalledManifest,
  loadDownloadSession,
  saveDownloadSession,
  cleanStaging,
  reconcileStagingFiles,
  getDeterministicStagingFileName,
  calculateFileSha256,
  resolveAndValidateDownloadUrl,
  validateUrlSecurity,
  getEffectiveApiBaseUrl,
  uninstallGame,
  resolvePathPolicy,
  resolveWatcherDecision,
  buildInstalledManifestData,
  ENFORCED_DIRECTORIES,
  getStagingPaths,
}
