const {
  generateSyncPlan,
  executeSync,
  loadInstalledManifest,
  loadDownloadSession,
  reconcileStagingFiles,
  cleanStaging,
  uninstallGame,
} = require("./client-files-sync.cjs")

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

module.exports = { GameOperationManager }
