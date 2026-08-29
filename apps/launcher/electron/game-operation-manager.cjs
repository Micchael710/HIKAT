const path = require("path")
const {
  generateSyncPlan,
  executeSync,
  loadInstalledManifest,
  loadDownloadSession,
  reconcileStagingFiles,
  cleanStaging,
  uninstallGame,
} = require("./client-files-sync.cjs")
const { resolveSafePath } = require("./path-validator.cjs")

/**
 * Validates IPC payloads before executing sync or plan checks.
 * Prevents malicious or corrupted payloads from reaching the sync engine or pruning files.
 */
function validateSyncPayload({ clientFiles, modpackVersion, requireNonEmptyFiles = false, instanceRoot }) {
  if (typeof modpackVersion !== "string" || !modpackVersion.trim() || modpackVersion.trim().length > 256) {
    throw new Error("Invalid payload: modpackVersion must be a non-empty string under 256 characters.")
  }

  if (!Array.isArray(clientFiles)) {
    throw new Error("Invalid payload: clientFiles must be an array.")
  }

  if (requireNonEmptyFiles && clientFiles.length === 0) {
    throw new Error("Invalid payload: clientFiles cannot be empty for startSync.")
  }

  if (clientFiles.length > 50000) {
    throw new Error("Invalid payload: clientFiles exceeds maximum allowed file count (50000).")
  }

  const seenPaths = new Set()

  for (let i = 0; i < clientFiles.length; i++) {
    const file = clientFiles[i]
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new Error(`Invalid payload: clientFiles[${i}] must be an object.`)
    }

    if (typeof file.path !== "string" || !file.path.trim() || file.path.trim().length > 1024) {
      throw new Error(`Invalid payload: clientFiles[${i}] has invalid path string.`)
    }

    const trimmedPath = file.path.trim()

    if (
      path.isAbsolute(trimmedPath) ||
      trimmedPath.startsWith("/") ||
      trimmedPath.startsWith("\\") ||
      /^[a-zA-Z]:/.test(trimmedPath)
    ) {
      throw new Error(`Invalid payload: clientFiles[${i}] path cannot be absolute: "${trimmedPath}"`)
    }

    const segments = trimmedPath.split(/[\\/]/)
    if (segments.includes("..") || segments.includes(".")) {
      throw new Error(`Invalid payload: clientFiles[${i}] path cannot contain traversal segments: "${trimmedPath}"`)
    }

    if (instanceRoot) {
      resolveSafePath(instanceRoot, trimmedPath)
    }

    const normalizedPath = trimmedPath.replace(/\\/g, "/").toLowerCase()
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Invalid payload: duplicate logical path found: "${trimmedPath}"`)
    }
    seenPaths.add(normalizedPath)

    if (typeof file.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(file.sha256.trim())) {
      throw new Error(`Invalid payload: clientFiles[${i}] ("${trimmedPath}") has invalid SHA-256 hash.`)
    }

    const size = Number(file.sizeBytes)
    if (!Number.isFinite(size) || !Number.isInteger(size) || size < 0 || size > 100 * 1024 * 1024 * 1024) {
      throw new Error(`Invalid payload: clientFiles[${i}] ("${trimmedPath}") has invalid sizeBytes: ${file.sizeBytes}`)
    }

    if (typeof file.downloadUrl !== "string" || !file.downloadUrl.trim() || file.downloadUrl.trim().length > 2048) {
      throw new Error(`Invalid payload: clientFiles[${i}] ("${trimmedPath}") has invalid downloadUrl.`)
    }

    if (file.policy !== "MODIFICABLE" && file.policy !== "NO_MODIFICABLE") {
      throw new Error(`Invalid payload: clientFiles[${i}] ("${trimmedPath}") has invalid policy: "${file.policy}". Must be MODIFICABLE or NO_MODIFICABLE.`)
    }
  }
}

class GameOperationManager {
  constructor() {
    this.state = "IDLE"
    this.activeOperationPromise = null
    this.activeCancelSignal = null
    this.operationCounter = 0
  }

  getState() {
    return this.state
  }

  /**
   * Checks local filesystem and installed manifest, and reconciles any recoverable staging session.
   */
  async checkPlan({ instanceRoot, clientFiles = [], modpackVersion = "1.0.0" }) {
    validateSyncPayload({
      clientFiles,
      modpackVersion,
      requireNonEmptyFiles: false,
      instanceRoot,
    })

    const plan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
    const installedManifest = await loadInstalledManifest(instanceRoot)

    // Reconcile staging session if present
    let hasPausedSession = false
    let stagedBytes = 0
    let stagedFilesCount = 0

    try {
      const session = await loadDownloadSession(instanceRoot)
      if (session && typeof session === "object") {
        const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
          instanceRoot,
          plan.toDownload,
        )
        if (validStagedMap.size > 0) {
          hasPausedSession = session.status === "PAUSED"
          stagedBytes = alreadyStagedBytes
          stagedFilesCount = validStagedMap.size
        } else if (session.status !== "DOWNLOADING") {
          // Clean empty / obsolete staging session
          await cleanStaging(instanceRoot)
        }
      }
    } catch (_) {}

    return {
      success: true,
      filesToDownload: plan.toDownload.length,
      filesToPrune: plan.toPrune.length,
      totalDownloadBytes: plan.totalDownloadBytes,
      needsUpdate: plan.toDownload.length > 0 || plan.toPrune.length > 0,
      hasExistingInstall: plan.hasExistingInstall,
      isFullyInstalled:
        plan.toDownload.length === 0 &&
        plan.toPrune.length === 0 &&
        Boolean(installedManifest.modpackVersion),
      hasPausedSession,
      stagedBytes,
      stagedFilesCount,
    }
  }

  /**
   * Starts or resumes synchronization.
   */
  async startSync({
    instanceRoot,
    clientFiles = [],
    modpackVersion = "1.0.0",
    onProgress,
    onPhaseChange,
    apiBaseUrl,
  }) {
    if (this.state !== "IDLE" && this.state !== "PAUSED") {
      throw new Error(`Cannot start sync: Operation already in progress (${this.state})`)
    }

    // Strict validation: empty array or invalid payload will reject before touching sync engine
    validateSyncPayload({
      clientFiles,
      modpackVersion,
      requireNonEmptyFiles: true,
      instanceRoot,
    })

    // If an earlier sync promise is still settling (unwinding), wait for it to fully complete
    if (this.activeOperationPromise) {
      try {
        await this.activeOperationPromise
      } catch (_) {}
    }

    const opId = ++this.operationCounter
    const cancelSignal = { isCancelled: false, isPaused: false, id: opId }
    this.activeCancelSignal = cancelSignal
    this.state = "SYNCING"

    const runSync = async () => {
      try {
        const result = await executeSync({
          instanceRoot,
          clientFiles,
          modpackVersion,
          onProgress,
          onPhaseChange: (phase) => {
            this.state = phase
            if (typeof onPhaseChange === "function") {
              onPhaseChange(phase)
            }
          },
          cancelSignal,
          apiBaseUrl,
        })

        if (result.paused) {
          this.state = "PAUSED"
        } else {
          this.state = "IDLE"
        }

        return { success: true, ...result }
      } catch (err) {
        if (this.state !== "CANCELING") {
          this.state = "IDLE"
        }
        throw err
      } finally {
        if (this.activeCancelSignal?.id === opId) {
          this.activeCancelSignal = null
          this.activeOperationPromise = null
        }
      }
    }

    this.activeOperationPromise = runSync()
    return await this.activeOperationPromise
  }

  /**
   * Pauses active synchronization.
   * Rejects if currently in INSTALLING phase.
   * Awaits stream unwinding and staging metadata save.
   */
  async pauseSync() {
    if (this.state === "INSTALLING") {
      throw new Error("Cannot pause synchronization while installation phase is in progress.")
    }
    if (this.state === "CANCELING" || this.state === "UNINSTALLING") {
      throw new Error(`Cannot pause: Operation is ${this.state}`)
    }

    if (this.state === "SYNCING" && this.activeCancelSignal) {
      this.activeCancelSignal.isPaused = true

      if (this.activeOperationPromise) {
        try {
          await this.activeOperationPromise
        } catch (_) {}
      }

      this.state = "PAUSED"
      return { success: true, paused: true }
    }

    if (this.state === "PAUSED") {
      return { success: true, paused: true }
    }

    return { success: false, state: this.state }
  }

  /**
   * Cancels active synchronization.
   * Rejects if currently in INSTALLING phase.
   * Awaits stream unwinding, ensures staging wipe, and transitions to IDLE.
   */
  async cancelSync(instanceRoot) {
    if (this.state === "INSTALLING") {
      throw new Error("Cannot cancel synchronization while installation phase is in progress.")
    }

    if (this.state === "IDLE" || this.state === "PAUSED") {
      await cleanStaging(instanceRoot)
      this.state = "IDLE"
      return { success: true }
    }

    if (this.state === "SYNCING") {
      this.state = "CANCELING"
      if (this.activeCancelSignal) {
        this.activeCancelSignal.isCancelled = true
      }

      if (this.activeOperationPromise) {
        try {
          await this.activeOperationPromise
        } catch (_) {}
      }

      await cleanStaging(instanceRoot)
      this.state = "IDLE"
      return { success: true }
    }

    if (this.state === "CANCELING") {
      if (this.activeOperationPromise) {
        try {
          await this.activeOperationPromise
        } catch (_) {}
      }
      await cleanStaging(instanceRoot)
      this.state = "IDLE"
      return { success: true }
    }

    return { success: false, state: this.state }
  }

  /**
   * Launches Minecraft.
   * Rejects if synchronization, installation, or cancellation is active.
   */
  async launchGame(gameLauncher, options) {
    if (
      this.state === "SYNCING" ||
      this.state === "INSTALLING" ||
      this.state === "CANCELING" ||
      this.state === "UNINSTALLING"
    ) {
      throw new Error(
        `Cannot launch Minecraft while game operation is in progress (${this.state}).`,
      )
    }

    return await gameLauncher.launch(options)
  }

  /**
   * Uninstalls game instance safely.
   */
  async uninstallGame(instanceRoot, appDataRoot) {
    if (
      this.state === "SYNCING" ||
      this.state === "INSTALLING" ||
      this.state === "CANCELING"
    ) {
      throw new Error("Cannot uninstall game while synchronization is active.")
    }

    this.state = "UNINSTALLING"
    try {
      return await uninstallGame(instanceRoot, appDataRoot)
    } finally {
      this.state = "IDLE"
    }
  }
}

module.exports = { GameOperationManager, validateSyncPayload }
