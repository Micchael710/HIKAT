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

/**
 * Calculates SHA-256 hash of a local file.
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
 * Saves the local installed manifest.
 */
async function saveInstalledManifest(instanceRoot, manifestData) {
  const metaDir = path.join(instanceRoot, ".hikat")
  await fsp.mkdir(metaDir, { recursive: true })
  const manifestPath = path.join(metaDir, "installed-manifest.json")
  await fsp.writeFile(manifestPath, JSON.stringify(manifestData, null, 2), "utf8")
}

/**
 * Generates the SyncPlan before touching any instance files.
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
        // Missing required config -> restore
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
          // Official hash has not changed -> preserve user's local edits
          plan.toPreserveUser.push({ path: normalizedRelative, safeAbsolute })
        } else {
          // Admin published a new official hash -> download updated admin version
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
 * Downloads a single file to a staging path, validating SHA-256 on the fly.
 */
async function downloadToStaging(task, stagingPath, onChunkBytes, cancelSignal) {
  if (cancelSignal?.isCancelled) {
    throw new Error("Download cancelled")
  }

  await fsp.mkdir(path.dirname(stagingPath), { recursive: true })

  const response = await axios({
    url: task.downloadUrl,
    method: "GET",
    responseType: "stream",
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  })

  const hasher = crypto.createHash("sha256")
  let downloadedBytes = 0

  const progressTransform = new Transform({
    transform(chunk, _encoding, callback) {
      if (cancelSignal?.isCancelled) {
        callback(new Error("Download cancelled"))
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
    throw new Error(`SHA-256 mismatch for ${task.path}. Expected: ${task.sha256}, Got: ${computedSha256}`)
  }

  return { bytes: downloadedBytes, sha256: computedSha256 }
}

/**
 * Executes the complete sync process with staging, validation, and safe per-file replacement.
 */
async function executeSync({ instanceRoot, clientFiles, modpackVersion, onProgress, cancelSignal }) {
  const plan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
  const stagingDir = path.join(instanceRoot, ".hikat", "staging")

  // Ensure staging directory is clean
  try {
    await fsp.rm(stagingDir, { recursive: true, force: true })
  } catch (_) {}
  await fsp.mkdir(stagingDir, { recursive: true })

  let totalDownloadedBytes = 0
  const startTime = Date.now()
  let lastProgressReportTime = 0

  const reportProgress = (currentTaskPath = "") => {
    const now = Date.now()
    if (now - lastProgressReportTime < 100 && totalDownloadedBytes < plan.totalDownloadBytes) {
      return
    }
    lastProgressReportTime = now

    const elapsedSeconds = Math.max(0.1, (now - startTime) / 1000)
    const speedMBs = (totalDownloadedBytes / 1024 / 1024) / elapsedSeconds
    const totalGB = plan.totalDownloadBytes / 1024 / 1024 / 1024
    const downloadedGB = totalDownloadedBytes / 1024 / 1024 / 1024
    const progress = plan.totalDownloadBytes > 0
      ? Math.min(100, Math.round((totalDownloadedBytes / plan.totalDownloadBytes) * 100))
      : 100

    const remainingBytes = Math.max(0, plan.totalDownloadBytes - totalDownloadedBytes)
    const remainingMinutes = speedMBs > 0 ? Math.ceil((remainingBytes / 1024 / 1024) / speedMBs / 60) : 0

    if (typeof onProgress === "function") {
      onProgress({
        progress,
        downloadedGB: Number(downloadedGB.toFixed(2)),
        totalGB: Number(totalGB.toFixed(2)),
        speedMBs: Number(speedMBs.toFixed(2)),
        remainingMinutes,
        currentFile: currentTaskPath,
        filesToDownload: plan.toDownload.length,
        filesToPrune: plan.toPrune.length,
      })
    }
  }

  // Phase 1: Download all required files to staging and validate SHA-256
  const stagedFiles = []

  try {
    for (let i = 0; i < plan.toDownload.length; i++) {
      if (cancelSignal?.isCancelled) {
        throw new Error("Sync cancelled by user.")
      }

      const task = plan.toDownload[i]
      const stagingFilePath = path.join(stagingDir, `stage_${i}_${path.basename(task.path)}`)

      reportProgress(task.path)

      await downloadToStaging(
        task,
        stagingFilePath,
        (chunkLength) => {
          totalDownloadedBytes += chunkLength
          reportProgress(task.path)
        },
        cancelSignal,
      )

      stagedFiles.push({ task, stagingFilePath })
    }
  } catch (err) {
    // Cleanup staging on error to leave working installation intact
    try {
      await fsp.rm(stagingDir, { recursive: true, force: true })
    } catch (_) {}
    throw err
  }

  // Phase 2: Safe per-file application & replacement
  for (const { task, stagingFilePath } of stagedFiles) {
    await fsp.mkdir(path.dirname(task.safeAbsolute), { recursive: true })
    await fsp.copyFile(stagingFilePath, task.safeAbsolute)
  }

  // Phase 3: Prune unauthorized / deprecated files in strict directories
  for (const pruneItem of plan.toPrune) {
    try {
      if (fs.existsSync(pruneItem.safeAbsolute)) {
        await fsp.unlink(pruneItem.safeAbsolute)
      }
    } catch (err) {
      console.warn(`[SyncEngine] Could not prune file ${pruneItem.path}:`, err.message)
    }
  }

  // Phase 4: Persist installed manifest with new official SHA-256 references
  const newManifestFiles = {}
  for (const item of clientFiles) {
    if (!item?.path) continue
    const normalizedRelative = path.relative(instanceRoot, resolveSafePath(instanceRoot, item.path)).replace(/\\/g, "/")
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

  // Cleanup staging directory
  try {
    await fsp.rm(stagingDir, { recursive: true, force: true })
  } catch (_) {}

  // Final 100% progress report
  reportProgress("")

  return {
    success: true,
    downloadedCount: stagedFiles.length,
    prunedCount: plan.toPrune.length,
    retainedCount: plan.toRetain.length + plan.toPreserveUser.length,
  }
}

module.exports = {
  generateSyncPlan,
  executeSync,
  loadInstalledManifest,
  calculateFileSha256,
}
