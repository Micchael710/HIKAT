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
const {
  checkMinecraftCoreReadiness,
  estimateCoreDownloadBytes,
  installOrRepairMinecraftCore,
  resolveJavaRuntime,
  validateJavaBinary,
} = require("./minecraft-install-engine.cjs")
const { resolveSafePath } = require("./path-validator.cjs")

/**
 * Validates IPC payloads before executing sync or plan checks.
 * Rejects missing versions without silent fallback defaults.
 */
function validateSyncPayload({
  clientFiles,
  modpackVersion,
  minecraftVersion,
  neoForgeVersion,
  requireNonEmptyFiles = false,
  instanceRoot,
}) {
  if (typeof modpackVersion !== "string" || !modpackVersion.trim() || modpackVersion.trim().length > 256) {
    throw new Error("Invalid payload: modpackVersion must be a non-empty string under 256 characters.")
  }

  if (typeof minecraftVersion !== "string" || !minecraftVersion.trim() || minecraftVersion.trim().length > 64) {
    throw new Error("Invalid payload: minecraftVersion must be a non-empty string provided by the Backend.")
  }

  if (typeof neoForgeVersion !== "string" || !neoForgeVersion.trim() || neoForgeVersion.trim().length > 64) {
    throw new Error("Invalid payload: neoForgeVersion must be a non-empty string provided by the Backend.")
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
  constructor(options = {}) {
    this.state = "IDLE" // "IDLE" | "SYNCING" | "PAUSED" | "CANCELING" | "UNINSTALLING"
    this.internalPhase = "IDLE" // "IDLE" | "DOWNLOADING_CLIENT" | "APPLYING_STAGING" | "DOWNLOADING_CORE" | "RUNNING_PROCESSORS" | "VERIFYING"
    this.activeOperationPromise = null
    this.activeCancelSignal = null
    this.operationCounter = 0
    this.coreEngine = options.coreEngine || {
      checkMinecraftCoreReadiness,
      estimateCoreDownloadBytes,
      installOrRepairMinecraftCore,
    }
    this.javaValidator = options.javaValidator || validateJavaBinary
  }

  getState() {
    return this.state
  }

  getInternalPhase() {
    return this.internalPhase
  }

  /**
   * Checks composite installation readiness across clientFiles + Minecraft Core + NeoForge.
   */
  async checkPlan({
    instanceRoot,
    clientFiles = [],
    modpackVersion,
    minecraftVersion,
    neoForgeVersion,
  }) {
    validateSyncPayload({
      clientFiles,
      modpackVersion,
      minecraftVersion,
      neoForgeVersion,
      requireNonEmptyFiles: false,
      instanceRoot,
    })

    const clientPlan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
    const installedManifest = await loadInstalledManifest(instanceRoot)
    const coreReadiness = await this.coreEngine.checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion,
      neoForgeVersion,
    })
    const { totalCoreBytes } = await this.coreEngine.estimateCoreDownloadBytes({
      instanceRoot,
      minecraftVersion,
      neoForgeVersion,
    })

    // Reconcile staging session if present
    let hasPausedSession = false
    let stagedBytes = 0
    let stagedFilesCount = 0

    try {
      const session = await loadDownloadSession(instanceRoot)
      if (session && typeof session === "object") {
        const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
          instanceRoot,
          clientPlan.toDownload,
        )
        if (validStagedMap.size > 0) {
          hasPausedSession = session.status === "PAUSED"
          stagedBytes = alreadyStagedBytes
          stagedFilesCount = validStagedMap.size
        } else if (session.status !== "DOWNLOADING") {
          await cleanStaging(instanceRoot)
        }
      }
    } catch (_) {}

    const totalDownloadBytes = clientPlan.totalDownloadBytes + totalCoreBytes
    const isClientSynced =
      clientPlan.toDownload.length === 0 &&
      clientPlan.toPrune.length === 0 &&
      Boolean(installedManifest.modpackVersion)
    const isFullyInstalled = isClientSynced && coreReadiness.isCoreInstalled
    const hasExistingInstall = clientPlan.hasExistingInstall || coreReadiness.hasExistingInstall
    const needsUpdate =
      clientPlan.toDownload.length > 0 ||
      clientPlan.toPrune.length > 0 ||
      !coreReadiness.isCoreInstalled

    return {
      success: true,
      filesToDownload: clientPlan.toDownload.length,
      filesToPrune: clientPlan.toPrune.length,
      totalDownloadBytes,
      needsUpdate,
      hasExistingInstall,
      isFullyInstalled,
      coreInstalled: coreReadiness.isCoreInstalled,
      hasPausedSession,
      stagedBytes,
      stagedFilesCount,
    }
  }

  /**
   * Starts or resumes unified synchronization and core installation.
   */
  async startSync({
    instanceRoot,
    clientFiles = [],
    modpackVersion,
    minecraftVersion,
    neoForgeVersion,
    onProgress,
    onPhaseChange,
    apiBaseUrl,
    isVerify = false,
  }) {
    if (this.state !== "IDLE" && this.state !== "PAUSED") {
      throw new Error(`Cannot start sync: Operation already in progress (${this.state})`)
    }

    validateSyncPayload({
      clientFiles,
      modpackVersion,
      minecraftVersion,
      neoForgeVersion,
      requireNonEmptyFiles: !isVerify,
      instanceRoot,
    })

    if (this.activeOperationPromise) {
      try {
        await this.activeOperationPromise
      } catch (_) {}
    }

    const opId = ++this.operationCounter
    const cancelSignal = {
      isCancelled: false,
      isPaused: false,
      id: opId,
      activeXmclTask: null,
    }
    this.activeCancelSignal = cancelSignal
    this.state = isVerify ? "VERIFYING" : "SYNCING"
    this.internalPhase = isVerify ? "VERIFYING" : "PREPARING"

    const runSync = async () => {
      try {
        // Step 1: Preflight calculations for UnifiedInstallPlan using real metadata
        const clientPlan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
        const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
          instanceRoot,
          clientPlan.toDownload,
        )
        const { totalCoreBytes, preflightDownloadedBytes } = await this.coreEngine.estimateCoreDownloadBytes({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
          cancelSignal,
        })

        const totalRequiredBytes = Math.max(1, clientPlan.totalDownloadBytes + (totalCoreBytes || 0))
        let clientTransferredBytes = 0
        let xmclTransferredBytes = preflightDownloadedBytes || 0
        let maxReportedCompletedBytes = alreadyStagedBytes + xmclTransferredBytes

        const startTime = Date.now()
        let lastReportTime = 0

        const reportProgress = (currentTaskPath = "") => {
          const now = Date.now()
          const currentTotalCompleted = alreadyStagedBytes + clientTransferredBytes + xmclTransferredBytes
          maxReportedCompletedBytes = Math.max(maxReportedCompletedBytes, currentTotalCompleted)
          const boundedCompleted = Math.min(totalRequiredBytes, maxReportedCompletedBytes)

          if (now - lastReportTime < 70 && boundedCompleted < totalRequiredBytes) {
            return
          }
          lastReportTime = now

          const elapsedSec = Math.max(0.1, (now - startTime) / 1000)
          const netTransferred = clientTransferredBytes + xmclTransferredBytes
          const speedMBs = netTransferred / 1024 / 1024 / elapsedSec
          const totalGB = totalRequiredBytes / 1024 / 1024 / 1024
          const downloadedGB = boundedCompleted / 1024 / 1024 / 1024
          const progress = Math.min(100, Math.round((boundedCompleted / totalRequiredBytes) * 100))
          const remainingBytes = Math.max(0, totalRequiredBytes - boundedCompleted)
          const remainingMinutes =
            speedMBs > 0 ? Math.ceil(remainingBytes / 1024 / 1024 / speedMBs / 60) : 0

          let visibleUiPhase = "DOWNLOADING"
          if (isVerify) {
            visibleUiPhase = "VERIFYING"
          } else if (
            this.internalPhase === "APPLYING_STAGING" ||
            this.internalPhase === "INSTALLING" ||
            this.internalPhase === "RUNNING_PROCESSORS"
          ) {
            visibleUiPhase = "INSTALLING"
          } else if (this.state === "PAUSED") {
            visibleUiPhase = "PAUSED"
          }

          if (typeof onProgress === "function") {
            onProgress({
              progress,
              phase: visibleUiPhase,
              downloadedGB: Number(downloadedGB.toFixed(2)),
              totalGB: Number(totalGB.toFixed(2)),
              speedMBs: Number(Math.max(0, speedMBs).toFixed(2)),
              remainingMinutes,
              currentFile: currentTaskPath,
              filesToDownload: clientPlan.toDownload.length,
              filesToPrune: clientPlan.toPrune.length,
            })
          }
        }

        const handlePhaseChange = (phase) => {
          this.internalPhase = phase
          if (typeof onPhaseChange === "function") {
            const uiPhase = isVerify
              ? "VERIFYING"
              : phase === "APPLYING_STAGING" || phase === "INSTALLING" || phase === "RUNNING_PROCESSORS"
                ? "INSTALLING"
                : "DOWNLOADING"
            onPhaseChange(uiPhase)
          }
          reportProgress()
        }

        // ─────────────────────────────────────────────────────────────
        // Phase 1: Client Files Sync (including JDK-21)
        // ─────────────────────────────────────────────────────────────
        if (clientFiles.length > 0) {
          handlePhaseChange("DOWNLOADING_CLIENT")
          const clientSyncResult = await executeSync({
            instanceRoot,
            clientFiles,
            modpackVersion,
            onProgress: (data) => {
              if (data.downloadedBytes !== undefined) {
                clientTransferredBytes = Math.max(0, data.downloadedBytes - alreadyStagedBytes)
              }
              reportProgress(data.currentFile || "")
            },
            onPhaseChange: (phase) => {
              if (phase === "INSTALLING") {
                handlePhaseChange("APPLYING_STAGING")
              } else {
                handlePhaseChange("DOWNLOADING_CLIENT")
              }
            },
            cancelSignal,
            apiBaseUrl,
          })

          if (clientSyncResult.paused) {
            this.state = "PAUSED"
            this.internalPhase = "PAUSED"
            return { success: true, paused: true }
          }

          if (cancelSignal?.isCancelled) {
            this.state = "IDLE"
            this.internalPhase = "IDLE"
            throw new Error("Sync cancelled by user.")
          }
        }

        // ─────────────────────────────────────────────────────────────
        // Phase 2: Validate Official JDK-21 Runtime
        // ─────────────────────────────────────────────────────────────
        handlePhaseChange("INSTALLING")
        const javaRuntime = resolveJavaRuntime(instanceRoot, { isGui: false })
        if (!javaRuntime.javaPath && !javaRuntime.cliJavaPath) {
          throw new Error(
            `Java runtime resolution failed: ${javaRuntime.error || "Official Java 21 JDK is not installed in instanceRoot/jdk-21."}`,
          )
        }

        const javaCliPath = javaRuntime.cliJavaPath || javaRuntime.javaPath
        const javaValidation = this.javaValidator(javaCliPath, 21)
        if (!javaValidation.valid) {
          throw new Error(`Java runtime validation failed: ${javaValidation.error}`)
        }

        // ─────────────────────────────────────────────────────────────
        // Phase 3: Install & Verify Minecraft Vanilla + NeoForge Core
        // ─────────────────────────────────────────────────────────────
        handlePhaseChange("DOWNLOADING_CORE")
        const coreResult = await this.coreEngine.installOrRepairMinecraftCore({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
          javaCliPath,
          onTaskBytes: (_taskName, bytesDelta) => {
            if (typeof bytesDelta === "number" && bytesDelta > 0) {
              xmclTransferredBytes += bytesDelta
              reportProgress()
            }
          },
          onPhaseChange: handlePhaseChange,
          cancelSignal,
        })

        if (cancelSignal?.isCancelled) {
          this.state = "IDLE"
          this.internalPhase = "IDLE"
          throw new Error("Sync cancelled by user.")
        }

        // ─────────────────────────────────────────────────────────────
        // Phase 4: Final Composite Readiness Verification
        // ─────────────────────────────────────────────────────────────
        handlePhaseChange("INSTALLING")
        const finalCoreReadiness = await this.coreEngine.checkMinecraftCoreReadiness({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
        })

        if (!finalCoreReadiness.isCoreInstalled) {
          throw new Error(
            `Final composite installation verification failed: Core incomplete (${(finalCoreReadiness.issues || []).join(", ")})`,
          )
        }

        // Final completion report
        maxReportedCompletedBytes = totalRequiredBytes
        reportProgress("")

        this.state = "IDLE"
        this.internalPhase = "IDLE"
        return {
          success: true,
          resolvedVersionId: coreResult.resolvedVersionId,
        }
      } catch (err) {
        if (this.state !== "CANCELING") {
          this.state = "IDLE"
          this.internalPhase = "IDLE"
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

  async pauseSync() {
    if (
      this.state === "INSTALLING" ||
      this.internalPhase === "APPLYING_STAGING" ||
      this.internalPhase === "RUNNING_PROCESSORS" ||
      this.internalPhase === "INSTALLING"
    ) {
      throw new Error("Cannot pause synchronization while installation phase is in progress.")
    }
    if (this.state === "CANCELING" || this.state === "UNINSTALLING") {
      throw new Error(`Cannot pause: Operation is ${this.state}`)
    }

    if ((this.state === "SYNCING" || this.state === "VERIFYING") && this.activeCancelSignal) {
      this.activeCancelSignal.isPaused = true
      if (this.activeCancelSignal.activeXmclTask) {
        try {
          this.activeCancelSignal.activeXmclTask.pause?.()
        } catch (_) {}
      }

      if (this.activeOperationPromise) {
        try {
          await this.activeOperationPromise
        } catch (_) {}
      }

      this.state = "PAUSED"
      this.internalPhase = "PAUSED"
      return { success: true, paused: true }
    }

    if (this.state === "PAUSED") {
      return { success: true, paused: true }
    }

    return { success: false, state: this.state }
  }

  async cancelSync(instanceRoot) {
    if (
      this.state === "INSTALLING" ||
      this.internalPhase === "APPLYING_STAGING" ||
      this.internalPhase === "RUNNING_PROCESSORS" ||
      this.internalPhase === "INSTALLING"
    ) {
      throw new Error("Cannot cancel synchronization while installation phase is in progress.")
    }

    if (this.state === "IDLE" || this.state === "PAUSED") {
      await cleanStaging(instanceRoot)
      this.state = "IDLE"
      this.internalPhase = "IDLE"
      return { success: true }
    }

    if (this.state === "SYNCING" || this.state === "VERIFYING") {
      this.state = "CANCELING"
      if (this.activeCancelSignal) {
        this.activeCancelSignal.isCancelled = true
        if (this.activeCancelSignal.activeXmclTask) {
          try {
            this.activeCancelSignal.activeXmclTask.cancel?.()
          } catch (_) {}
        }
      }

      if (this.activeOperationPromise) {
        try {
          await this.activeOperationPromise
        } catch (_) {}
      }

      await cleanStaging(instanceRoot)
      this.state = "IDLE"
      this.internalPhase = "IDLE"
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
      this.internalPhase = "IDLE"
      return { success: true }
    }

    return { success: false, state: this.state }
  }

  async launchGame(gameLauncher, options) {
    if (
      this.state === "SYNCING" ||
      this.state === "VERIFYING" ||
      this.state === "INSTALLING" ||
      this.internalPhase === "APPLYING_STAGING" ||
      this.internalPhase === "RUNNING_PROCESSORS" ||
      this.internalPhase === "INSTALLING" ||
      this.state === "CANCELING" ||
      this.state === "UNINSTALLING"
    ) {
      throw new Error(
        `Cannot launch Minecraft while game operation is in progress (${this.state}).`,
      )
    }

    return await gameLauncher.launch(options)
  }

  async uninstallGame(instanceRoot, appDataRoot) {
    if (
      this.state === "SYNCING" ||
      this.state === "VERIFYING" ||
      this.state === "INSTALLING" ||
      this.internalPhase === "APPLYING_STAGING" ||
      this.internalPhase === "RUNNING_PROCESSORS" ||
      this.internalPhase === "INSTALLING" ||
      this.state === "CANCELING"
    ) {
      throw new Error("Cannot uninstall game while synchronization is active.")
    }

    this.state = "UNINSTALLING"
    try {
      return await uninstallGame(instanceRoot, appDataRoot)
    } finally {
      this.state = "IDLE"
      this.internalPhase = "IDLE"
    }
  }
}

module.exports = { GameOperationManager, validateSyncPayload }
