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
  buildCoreInstallPlan,
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
      buildCoreInstallPlan,
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
    const corePlan = await (this.coreEngine.buildCoreInstallPlan
      ? this.coreEngine.buildCoreInstallPlan({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
          mode: "planning",
        })
      : this.coreEngine.estimateCoreDownloadBytes({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
          isPlanning: true,
        }))
    const totalCoreBytes = corePlan.totalCoreBytes || 0

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
    const activeCoreAbortController = new AbortController()
    const cancelSignal = {
      isCancelled: false,
      isPaused: false,
      id: opId,
      activeXmclTask: null,
      activeCoreAbortController,
    }
    this.activeCancelSignal = cancelSignal
    this.state = isVerify ? "VERIFYING" : "SYNCING"
    this.internalPhase = isVerify ? "VERIFYING" : "PREPARING"

    const runSync = async () => {
      try {
        const startTime = Date.now()
        let lastReportTime = 0
        let clientTransferredBytes = 0
        let bootstrapNetworkBytes = 0
        let xmclTransferredBytes = 0
        let maxReportedCompletedBytes = 0
        let planFrozen = false
        let totalRequiredBytes = 1
        let initialReusableBytes = 0
        let clientPlan = null

        const reportProgress = (currentTaskPath = "") => {
          if (!planFrozen) return // Do NOT emit progress until denominator is frozen!

          const now = Date.now()
          const networkTransferredThisOp = clientTransferredBytes + bootstrapNetworkBytes + xmclTransferredBytes
          const currentTotalCompleted = initialReusableBytes + networkTransferredThisOp
          maxReportedCompletedBytes = Math.max(maxReportedCompletedBytes, currentTotalCompleted)
          const boundedCompleted = Math.min(totalRequiredBytes, maxReportedCompletedBytes)

          if (now - lastReportTime < 70 && boundedCompleted < totalRequiredBytes) {
            return
          }
          lastReportTime = now

          const elapsedSec = Math.max(0.1, (now - startTime) / 1000)
          // Speed strictly measures network transferred during this operation / real network time
          const speedMBs = networkTransferredThisOp / 1024 / 1024 / elapsedSec
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
              filesToDownload: clientPlan?.toDownload?.length || 0,
              filesToPrune: clientPlan?.toPrune?.length || 0,
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

        // Step 1: Preflight calculations for UnifiedInstallPlan using real metadata
        clientPlan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
        const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
          instanceRoot,
          clientPlan.toDownload,
        )

        // Execution preflight: discover dependencies, prepare Planner Cache outside instanceRoot, accumulate bootstrap bytes silently
        const corePlan = await (this.coreEngine.buildCoreInstallPlan
          ? this.coreEngine.buildCoreInstallPlan({
              instanceRoot,
              minecraftVersion,
              neoForgeVersion,
              mode: "execution",
              cancelSignal,
              signal: activeCoreAbortController.signal,
              onChunkBytes: (chunkBytes) => {
                bootstrapNetworkBytes += chunkBytes
              },
            })
          : this.coreEngine.estimateCoreDownloadBytes({
              instanceRoot,
              minecraftVersion,
              neoForgeVersion,
              cancelSignal,
              signal: activeCoreAbortController.signal,
              isPlanning: false,
              onChunkBytes: (chunkBytes) => {
                bootstrapNetworkBytes += chunkBytes
              },
            }))

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          this.internalPhase = "PAUSED"
          return { success: true, paused: true }
        }

        if (cancelSignal.isCancelled) {
          this.state = "IDLE"
          this.internalPhase = "IDLE"
          throw new Error("Sync cancelled by user.")
        }

        // Freeze denominator and reusable bytes BEFORE emitting the first progress event!
        totalRequiredBytes = Math.max(1, clientPlan.totalDownloadBytes + (corePlan.totalCoreBytes || 0))
        initialReusableBytes = alreadyStagedBytes + (corePlan.reusableCoreBytes || 0)
        maxReportedCompletedBytes = initialReusableBytes + bootstrapNetworkBytes
        planFrozen = true

        // Emit the very first progress event with frozen plan
        reportProgress()

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
        const initialCoreReadiness = await this.coreEngine.checkMinecraftCoreReadiness({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
        })

        let coreResult = null
        if (!initialCoreReadiness.isCoreInstalled) {
          handlePhaseChange("DOWNLOADING_CORE")
          coreResult = await this.coreEngine.installOrRepairMinecraftCore({
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
          if (cancelSignal?.isPaused) {
            this.state = "PAUSED"
            this.internalPhase = "PAUSED"
            return { success: true, paused: true }
          }
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
          resolvedVersionId:
            coreResult?.resolvedVersionId ||
            finalCoreReadiness?.resolvedVersionId ||
            initialCoreReadiness?.resolvedVersionId ||
            `${minecraftVersion}-neoforge-${neoForgeVersion}`,
        }
      } catch (err) {
        const isAbort =
          err?.name === "AbortError" ||
          /abort|cancelled|preflight cancelled/i.test(err?.message || "")

        if (cancelSignal.isPaused || (isAbort && this.state === "PAUSED")) {
          this.state = "PAUSED"
          this.internalPhase = "PAUSED"
          return { success: true, paused: true }
        }

        if (cancelSignal.isCancelled || this.state === "CANCELING") {
          this.state = "IDLE"
          this.internalPhase = "IDLE"
          throw new Error("Sync cancelled by user.")
        }

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
      try {
        this.activeCancelSignal.activeCoreAbortController?.abort()
      } catch (_) {}
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
        try {
          this.activeCancelSignal.activeCoreAbortController?.abort()
        } catch (_) {}
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
