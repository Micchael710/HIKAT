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
 */
function getEffectiveApiBaseUrl() {
  const envUrl =
    process.env.HIKAT_API_URL ||
    process.env.VITE_API_URL ||
    process.env.VITE_BACKEND_API_URL ||
    DEFAULT_API_BASE_URL
  return envUrl.replace(/\/$/, "")
}

/**
 * Security: Validates and restricts download URLs to authorized origins only.
 * Prevents arbitrary host downloads, bad protocols (file://, javascript:, etc.), and unverified redirects.
 */
function validateUrlSecurity(parsedUrl) {
  const isDev = process.env.NODE_ENV !== "production"
  const hostname = parsedUrl.hostname.toLowerCase()
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"

  if (isLocalhost) {
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Invalid protocol for localhost download: "${parsedUrl.protocol}"`)
    }
    return true
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`Non-HTTPS download URL is strictly forbidden in production: "${parsedUrl.protocol}"`)
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
  const tempPath = path.join(metaDir, `installed-manifest.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`)
  await fsp.writeFile(tempPath, JSON.stringify(manifestData, null, 2), "utf8")
  await fsp.rename(tempPath, manifestPath)
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
  await fsp.rename(tempPath, sessionPath)
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

  // Expected filename set
  const expectedFileNames = new Set()

  for (const task of toDownloadTasks) {
    const fileName = getDeterministicStagingFileName(task)
    expectedFileNames.add(fileName)
    const filePath = path.join(filesDir, fileName)

    if (fs.existsSync(filePath)) {
      try {
        const stat = await fsp.stat(filePath)
        if (task.sizeBytes > 0 && stat.size !== task.sizeBytes) {
          await fsp.unlink(filePath)
          continue
        }

        const localSha = await calculateFileSha256(filePath)
        if (localSha === task.sha256.toLowerCase()) {
          validStagedMap.set(task.path, filePath)
          alreadyStagedBytes += stat.size
        } else {
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
 * Generates the SyncPlan before touching any instance files.
 * Authoritative over local filesystem and installed manifest.
 */
async function generateSyncPlan(instanceRoot, clientFiles, modpackVersion) {
  const installedManifest = await loadInstalledManifest(instanceRoot)
  const previousFilesMap = installedManifest.files || {}

  const plan = {
    modpackVersion,
    toDownload: [],
    toRetain: [],
    toPreserveUser: [],
    toPrune: [],
    totalDownloadBytes: 0,
    hasExistingInstall: Boolean(installedManifest.modpackVersion),
  }

  const clientFilesMap = new Map()

  for (const item of clientFiles) {
    if (!item || !item.path) continue

    const safeAbsolute = resolveSafePath(instanceRoot, item.path)
    const normalizedRelative = path.relative(instanceRoot, safeAbsolute).replace(/\\/g, "/")
    const policy = item.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE"
    const expectedSha256 = String(item.sha256 || "").toLowerCase().trim()
    const sizeBytes = Number(item.sizeBytes) || 0

    clientFilesMap.set(normalizedRelative, {
      ...item,
      path: normalizedRelative,
      safeAbsolute,
      policy,
      expectedSha256,
      sizeBytes,
    })

    const fileExists = fs.existsSync(safeAbsolute)

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
      // MODIFICABLE policy
      if (!fileExists) {
        // Missing required config/script -> download official
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
        // File exists locally: check if admin published a new official hash
        const lastOfficialSha256 = previousFilesMap[normalizedRelative]?.officialSha256
        if (lastOfficialSha256 && lastOfficialSha256.toLowerCase() === expectedSha256) {
          // Official hash unchanged -> preserve user's local modification
          plan.toPreserveUser.push({ path: normalizedRelative, safeAbsolute })
          plan.hasExistingInstall = true
        } else {
          // Admin published new official hash -> download updated admin version
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
      }
    }
  }

  // Scan strictly enforced directories for pruning unauthorized extra files
  for (const dirName of ENFORCED_DIRECTORIES) {
    const dirAbsolute = path.join(instanceRoot, dirName)
    if (!fs.existsSync(dirAbsolute)) continue

    const scanDirectory = async (currentDir) => {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await scanDirectory(fullPath)
        } else if (entry.isFile()) {
          const relative = path.relative(instanceRoot, fullPath).replace(/\\/g, "/")
          if (!clientFilesMap.has(relative)) {
            plan.toPrune.push({ path: relative, safeAbsolute: fullPath })
          }
        }
      }
    }

    try {
      await scanDirectory(dirAbsolute)
    } catch (err) {
      console.warn(`[SyncEngine] Directory scan warning for ${dirName}:`, err.message)
    }
  }

  return plan
}

/**
 * Downloads a single file to staging path, streaming and validating SHA-256 and size on the fly.
 * On pause or error: deletes ONLY this partial staging file.
 */
async function downloadToStaging(task, stagingPath, onChunkBytes, cancelSignal, apiBaseUrl) {
  if (cancelSignal?.isCancelled) {
    throw new Error("Download cancelled")
  }
  if (cancelSignal?.isPaused) {
    throw new Error("Download paused")
  }

  await fsp.mkdir(path.dirname(stagingPath), { recursive: true })

  const safeDownloadUrl = resolveAndValidateDownloadUrl(task.downloadUrl, apiBaseUrl)

  const response = await axios({
    url: safeDownloadUrl,
    method: "GET",
    responseType: "stream",
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    maxRedirects: 5,
    beforeRedirect: (options, responseDetails) => {
      const redirectLocation = responseDetails.headers.location
      if (redirectLocation) {
        const redirectUrl = new URL(redirectLocation, options.href)
        validateUrlSecurity(redirectUrl)
      }
    },
  })

  const hasher = crypto.createHash("sha256")
  let downloadedBytes = 0

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
      downloadedBytes += chunk.length
      hasher.update(chunk)
      if (typeof onChunkBytes === "function") {
        onChunkBytes(chunk.length)
      }
      callback(null, chunk)
    },
  })

  const fileWriteStream = fs.createWriteStream(stagingPath)

  try {
    await pipeline(response.data, progressTransform, fileWriteStream)
  } catch (err) {
    try {
      await fsp.unlink(stagingPath)
    } catch (_) {}
    throw err
  }

  const computedSha256 = hasher.digest("hex").toLowerCase()
  if (task.sha256 && computedSha256 !== task.sha256.toLowerCase()) {
    try {
      await fsp.unlink(stagingPath)
    } catch (_) {}
    throw new Error(
      `SHA-256 mismatch for ${task.path}. Expected: ${task.sha256}, Got: ${computedSha256}`,
    )
  }

  if (task.sizeBytes > 0 && downloadedBytes !== task.sizeBytes) {
    try {
      await fsp.unlink(stagingPath)
    } catch (_) {}
    throw new Error(
      `Size mismatch for ${task.path}. Expected: ${task.sizeBytes} bytes, Got: ${downloadedBytes} bytes`,
    )
  }

  return { bytes: downloadedBytes, sha256: computedSha256 }
}

/**
 * Executes the complete sync process:
 *  - Phase A: Download (staging, pause/resume/cancel support, SHA-256 validation)
 *  - Phase B: Installation (atomic file replacement, strict prune verification, final post-validation)
 */
async function executeSync({
  instanceRoot,
  clientFiles,
  modpackVersion,
  onProgress,
  onPhaseChange,
  cancelSignal,
  apiBaseUrl = getEffectiveApiBaseUrl(),
}) {
  // Generate initial sync plan against local filesystem
  const plan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
  const { stagingDir, filesDir } = getStagingPaths(instanceRoot)

  await fsp.mkdir(filesDir, { recursive: true })

  // Reconcile and recover any already staged, validated files
  const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
    instanceRoot,
    plan.toDownload,
  )

  let totalDownloadedBytes = alreadyStagedBytes
  const startTime = Date.now()
  let lastProgressReportTime = 0
  let currentPhase = "DOWNLOADING"

  const reportProgress = (currentTaskPath = "") => {
    const now = Date.now()
    if (now - lastProgressReportTime < 80 && totalDownloadedBytes < plan.totalDownloadBytes) {
      return
    }
    lastProgressReportTime = now

    const elapsedSeconds = Math.max(0.1, (now - startTime) / 1000)
    const speedMBs = (totalDownloadedBytes - alreadyStagedBytes) / 1024 / 1024 / elapsedSeconds
    const totalGB = plan.totalDownloadBytes / 1024 / 1024 / 1024
    const downloadedGB = totalDownloadedBytes / 1024 / 1024 / 1024
    const progress =
      plan.totalDownloadBytes > 0
        ? Math.min(100, Math.round((totalDownloadedBytes / plan.totalDownloadBytes) * 100))
        : 100

    const remainingBytes = Math.max(0, plan.totalDownloadBytes - totalDownloadedBytes)
    const remainingMinutes =
      speedMBs > 0 ? Math.ceil(remainingBytes / 1024 / 1024 / speedMBs / 60) : 0

    if (typeof onProgress === "function") {
      onProgress({
        progress,
        phase: currentPhase,
        downloadedGB: Number(downloadedGB.toFixed(2)),
        totalGB: Number(totalGB.toFixed(2)),
        speedMBs: Number(Math.max(0, speedMBs).toFixed(2)),
        remainingMinutes,
        currentFile: currentTaskPath,
        filesToDownload: plan.toDownload.length,
        filesToPrune: plan.toPrune.length,
      })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Phase A: Download all required files to staging
  // ─────────────────────────────────────────────────────────────
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
          updatedAt: new Date().toISOString(),
          files: sessionCompletedFiles,
        })
        return {
          paused: true,
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
        )

        stagedFiles.push({ task, stagingFilePath })
        sessionCompletedFiles[task.path] = {
          stagingFileName,
          sha256: task.sha256,
          sizeBytes: task.sizeBytes,
          completedAt: new Date().toISOString(),
        }

        // Persist session progress
        await saveDownloadSession(instanceRoot, {
          modpackVersion,
          status: "DOWNLOADING",
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
            updatedAt: new Date().toISOString(),
            files: sessionCompletedFiles,
          })
          return {
            paused: true,
            downloadedCount: stagedFiles.length,
            totalCount: plan.toDownload.length,
          }
        }
        // Network or download error: persist session so far to retain valid files
        await saveDownloadSession(instanceRoot, {
          modpackVersion,
          status: "ERROR",
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

  // ─────────────────────────────────────────────────────────────
  // Phase B: Installation (Atomic Apply, Prune, Final Verify)
  // ─────────────────────────────────────────────────────────────
  currentPhase = "INSTALLING"
  if (typeof onPhaseChange === "function") {
    onPhaseChange("INSTALLING")
  }
  reportProgress("Applying game files...")

  // 1. Pre-application verification: Verify EVERY staged file before touching instance files
  for (const { task, stagingFilePath } of stagedFiles) {
    if (!fs.existsSync(stagingFilePath)) {
      throw new Error(`Staged file missing before installation: ${task.path}`)
    }
    const stat = await fsp.stat(stagingFilePath)
    if (task.sizeBytes > 0 && stat.size !== task.sizeBytes) {
      throw new Error(`Staged file size mismatch before installation: ${task.path}`)
    }
    const fileSha = await calculateFileSha256(stagingFilePath)
    if (fileSha !== task.sha256.toLowerCase()) {
      throw new Error(`Staged file hash mismatch before installation: ${task.path}`)
    }
  }

  // 2. Safe per-file copy to instanceRoot
  for (const { task, stagingFilePath } of stagedFiles) {
    await fsp.mkdir(path.dirname(task.safeAbsolute), { recursive: true })
    await fsp.copyFile(stagingFilePath, task.safeAbsolute)
  }

  // 3. Prune obsolete files in strict directories (Fail-hard on error)
  for (const pruneItem of plan.toPrune) {
    if (fs.existsSync(pruneItem.safeAbsolute)) {
      try {
        await fsp.unlink(pruneItem.safeAbsolute)
      } catch (err) {
        throw new Error(
          `Pruning failed for file ${pruneItem.path}: ${err.message}. Installation cannot complete safely.`,
        )
      }
    }
  }

  // 4. Mandatory Final Verification
  const postPlan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
  if (postPlan.toDownload.length > 0 || postPlan.toPrune.length > 0) {
    throw new Error(
      `Post-installation verification failed: ${postPlan.toDownload.length} files missing/corrupt, ${postPlan.toPrune.length} files unpruned.`,
    )
  }

  // 5. Persist installed manifest with official SHA-256 references
  const newManifestFiles = {}
  for (const item of clientFiles) {
    if (!item?.path) continue
    const normalizedRelative = path
      .relative(instanceRoot, resolveSafePath(instanceRoot, item.path))
      .replace(/\\/g, "/")
    newManifestFiles[normalizedRelative] = {
      officialSha256: String(item.sha256 || "").toLowerCase().trim(),
      policy: item.policy === "MODIFICABLE" ? "MODIFICABLE" : "NO_MODIFICABLE",
      lastSyncedAt: new Date().toISOString(),
    }
  }

  await saveInstalledManifest(instanceRoot, {
    modpackVersion,
    lastSync: new Date().toISOString(),
    files: newManifestFiles,
  })

  // 6. Cleanup staging directory after fully validated installation
  await cleanStaging(instanceRoot)

  // Final 100% progress report
  reportProgress("")

  return {
    success: true,
    downloadedCount: stagedFiles.length,
    prunedCount: plan.toPrune.length,
    retainedCount: plan.toRetain.length + plan.toPreserveUser.length,
  }
}

/**
 * Safely uninstalls the game instance directory.
 * Strictly verifies path against appData canonical boundaries.
 */
async function uninstallGame(instanceRoot, appDataRoot) {
  const resolvedInstance = path.resolve(instanceRoot)
  const resolvedAppData = path.resolve(appDataRoot)

  // Disallow root of drive, empty paths, or paths outside appDataRoot
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
}
