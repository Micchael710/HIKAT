const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const {
  generateSyncPlan,
  downloadClientFilesToStaging,
  applyStagingToInstance,
  loadInstalledManifest,
  saveInstalledManifest,
  buildInstalledManifestData,
  loadDownloadSession,
  saveDownloadSession,
  reconcileStagingFiles,
  cleanStaging,
  uninstallGame,
} = require("./client-files-sync.cjs")
const { checkCore, installCore } = require("./minecraft-core.cjs")
const { resolveJavaRuntime, ensureJavaRuntime, validateJavaBinary } = require("./java-runtime.cjs")

/**
 * Safely cleans an incomplete fresh install by removing all instance contents,
 * leaving the instance directory pristine and virginal.
 */
async function cleanFreshInstall(instanceRoot) {
  try {
    await cleanStaging(instanceRoot)
    if (fs.existsSync(instanceRoot)) {
      const entries = await fsp.readdir(instanceRoot)
      for (const entry of entries) {
        const fullPath = path.join(instanceRoot, entry)
        await fsp.rm(fullPath, { recursive: true, force: true }).catch(() => {})
      }
    }
  } catch (_) {}
}

function validateSyncPayload(payload = {}, isStartSync = true) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload: payload must be an object.")
  }
  if (!payload.instanceRoot || typeof payload.instanceRoot !== "string" || !payload.instanceRoot.trim()) {
    throw new Error("Invalid payload: instanceRoot is required.")
  }

  if (isStartSync) {
    if (!payload.modpackVersion || typeof payload.modpackVersion !== "string" || !payload.modpackVersion.trim()) {
      throw new Error("Invalid payload: modpackVersion must be a non-empty string.")
    }
    if (!payload.minecraftVersion || typeof payload.minecraftVersion !== "string" || !payload.minecraftVersion.trim()) {
      throw new Error("Invalid payload: minecraftVersion must be a non-empty string.")
    }
    if (payload.modLoader) {
      if (typeof payload.modLoader !== "string" || !payload.modLoader.trim()) {
        throw new Error("Invalid payload: modLoader must be a non-empty string.")
      }
      const loaderUpper = payload.modLoader.trim().toUpperCase()
      if (loaderUpper !== "VANILLA") {
        const loaderVer = payload.modLoaderVersion || payload.neoForgeVersion
        if (!loaderVer || typeof loaderVer !== "string" || !loaderVer.trim()) {
          throw new Error("Invalid payload: modLoaderVersion must be a non-empty string.")
        }
      }
    } else {
      if (!payload.neoForgeVersion || typeof payload.neoForgeVersion !== "string" || !payload.neoForgeVersion.trim()) {
        throw new Error("Invalid payload: neoForgeVersion must be a non-empty string.")
      }
    }
  }

  const clientFiles = payload.clientFiles
  if (clientFiles !== undefined) {
    if (!Array.isArray(clientFiles)) {
      throw new Error("Invalid payload: clientFiles must be an array.")
    }
    const seenPaths = new Set()
    for (const file of clientFiles) {
      if (!file || typeof file !== "object") {
        throw new Error("Invalid file entry: file must be an object.")
      }
      if (!file.path || typeof file.path !== "string" || !file.path.trim()) {
        throw new Error("Invalid file entry: invalid path string.")
      }
      if (path.isAbsolute(file.path) || file.path.startsWith("/") || file.path.startsWith("\\") || /^[a-zA-Z]:/.test(file.path)) {
        throw new Error(`Invalid file entry: path cannot be absolute: "${file.path}".`)
      }
      if (file.path.includes("..") || file.path.split(/[/\\]/).includes("..")) {
        throw new Error(`Security violation: Path contains traversal segments: "${file.path}".`)
      }
      const norm = file.path.replace(/\\/g, "/").toLowerCase()
      if (seenPaths.has(norm)) {
        throw new Error(`Invalid payload: duplicate logical path found: "${file.path}".`)
      }
      seenPaths.add(norm)

      if (file.sha256 === undefined || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
        throw new Error(`Invalid file entry: invalid SHA-256 hash for "${file.path}".`)
      }
      if (file.sizeBytes === undefined || typeof file.sizeBytes !== "number" || file.sizeBytes < 0 || !Number.isFinite(file.sizeBytes)) {
        throw new Error(`Invalid file entry: invalid sizeBytes for "${file.path}".`)
      }
      if (!file.policy || (file.policy !== "MODIFICABLE" && file.policy !== "NO_MODIFICABLE")) {
        throw new Error(`Invalid file entry: invalid policy "${file.policy}".`)
      }
      if (!file.downloadUrl || typeof file.downloadUrl !== "string" || !file.downloadUrl.trim()) {
        throw new Error("Invalid download URL: invalid downloadUrl.")
      }
    }
  }
}

class GameOperationManager {
  constructor(options = {}) {
    this.state = "IDLE" // "IDLE" | "SYNCING" | "INSTALLING" | "VERIFYING" | "PAUSED"
    this.activeAbortController = null
    this.activeCancelSignal = null
    this.activeSyncPromise = null
    this.activeOperationPromise = null
    this.lastPayload = null
    this.lastPausedPhase = null
    this.operationCounter = 0
    this.isCommitting = false

    this.javaResolver = options.javaResolver || resolveJavaRuntime
    this.javaValidator = options.javaValidator || validateJavaBinary
    this.javaEnsurer = options.javaEnsurer || ensureJavaRuntime

    if (options.coreEngine) {
      this.coreChecker = async (opts) => {
        const r = await options.coreEngine.checkMinecraftCoreReadiness(opts)
        return { installed: Boolean(r?.isCoreInstalled), resolvedVersionId: r?.resolvedVersionId }
      }
      this.coreInstaller = options.coreEngine.installOrRepairMinecraftCore
    } else {
      this.coreChecker = options.coreChecker || checkCore
      this.coreInstaller = options.coreInstaller || installCore
    }
  }

  getState() {
    return this.state
  }

  async checkPlan(payload = {}) {
    validateSyncPayload(payload, false)
    const {
      instanceRoot,
      clientFiles = [],
      directoryPolicies = [],
      modpackVersion,
      minecraftVersion,
      modLoader,
      modLoaderVersion,
      neoForgeVersion,
    } = payload

    const clientPlan = await generateSyncPlan(
      instanceRoot,
      clientFiles,
      modpackVersion,
      directoryPolicies,
    )
    const installedManifest = await loadInstalledManifest(instanceRoot)
    const core = await this.coreChecker({
      instanceRoot,
      minecraftVersion,
      modLoader,
      modLoaderVersion,
      neoForgeVersion,
    })

    const javaMajor = core.javaMajorVersion || 21
    const effectiveJavaRoot = payload.javaStorageRoot || instanceRoot
    const java = this.javaResolver(effectiveJavaRoot, { isGui: false, majorVersion: javaMajor })
    const javaValid = java.cliJavaPath ? Boolean(this.javaValidator(java.cliJavaPath, javaMajor).valid) : false

    const releaseMatches = Boolean(
      installedManifest.modpackVersion && installedManifest.modpackVersion === modpackVersion,
    )
    const clientSynced =
      clientPlan.toDownload.length === 0 &&
      clientPlan.toPrune.length === 0 &&
      releaseMatches

    const isFullyInstalled = clientSynced && Boolean(core.installed) && javaValid
    const hasUpdate = Boolean(
      installedManifest.modpackVersion && installedManifest.modpackVersion !== modpackVersion,
    )
    const hasExistingInstall = Boolean(core.resolvedVersionId)
    const hasIntegrityIssue = Boolean(releaseMatches && !isFullyInstalled)

    if (clientSynced && this.state === "IDLE" && isFullyInstalled) {
      await cleanStaging(instanceRoot)
    }

    const session = await loadDownloadSession(instanceRoot)
    const isSessionInstalling =
      session && (session.status === "INSTALLING" || session.status === "VERIFYING")
    const isVerifySession = Boolean(session && session.operationKind === "VERIFY")
    const isObsoleteSession = Boolean(
      session && session.modpackVersion && session.modpackVersion !== modpackVersion,
    )

    let hasInterruptedDownload = false
    let hasPausedSession = false
    let stagedBytes = 0
    let stagedFilesCount = 0

    if (!isSessionInstalling && !isFullyInstalled && clientPlan.toDownload.length > 0) {
      const reconciled = await reconcileStagingFiles(instanceRoot, clientPlan.toDownload)
      stagedBytes = reconciled.alreadyStagedBytes
      stagedFilesCount =
        (session?.files && !isObsoleteSession ? Object.keys(session.files).length : 0) ||
        reconciled.validStagedMap.size

      if (!isVerifySession && !isObsoleteSession) {
        if (stagedBytes > 0) {
          hasInterruptedDownload = true
          hasPausedSession = true
        } else if (session && session.status === "PAUSED") {
          hasPausedSession = true
        }
      }
    } else if (
      session &&
      session.status === "PAUSED" &&
      !isFullyInstalled &&
      !isVerifySession &&
      !isObsoleteSession
    ) {
      hasPausedSession = true
      hasInterruptedDownload = true
    }

    return {
      success: true,
      filesToDownload: clientPlan.toDownload.length,
      filesToPrune: clientPlan.toPrune.length,
      totalDownloadBytes: clientPlan.totalDownloadBytes,
      hasUpdate,
      hasIntegrityIssue,
      needsUpdate: !isFullyInstalled,
      installedModpackVersion: installedManifest.modpackVersion || null,
      hasExistingInstall,
      isFullyInstalled,
      hasPausedSession,
      hasInterruptedDownload,
      pausedProgress: typeof session?.progress === "number" ? session.progress : 0,
      pausedPhase: session?.phase || (isSessionInstalling ? "INSTALLING" : "DOWNLOADING"),
      stagedBytes,
      stagedFilesCount,
      plan: {
        toDownload: clientPlan.toDownload,
        toPrune: clientPlan.toPrune,
        totalDownloadBytes: clientPlan.totalDownloadBytes,
        isCoreInstalled: core.installed,
        coreResolvedVersionId: core.resolvedVersionId || null,
      },
    }
  }

  async startSync(payload = {}) {
    if (this.state === "SYNCING" || this.state === "INSTALLING" || this.activeSyncPromise) {
      throw new Error("Operation already in progress.")
    }

    validateSyncPayload(payload, true)
    const {
      instanceRoot,
      clientFiles = [],
      directoryPolicies = [],
      modpackVersion,
      minecraftVersion,
      modLoader,
      modLoaderVersion,
      neoForgeVersion,
      apiBaseUrl,
      isVerify = false,
      onProgress,
      onPhaseChange,
    } = payload

    this.lastPayload = payload
    this.operationCounter += 1
    const opId = this.operationCounter

    const abortController = new AbortController()
    this.activeAbortController = abortController

    const cancelSignal = {
      id: opId,
      isCancelled: false,
      isPaused: false,
    }
    this.activeCancelSignal = cancelSignal

    const isPausedInstalling = this.lastPausedPhase === "INSTALLING"
    const effectiveState = isVerify ? "VERIFYING" : (isPausedInstalling ? "INSTALLING" : "SYNCING")
    const initialPhase = isVerify ? "VERIFYING" : (isPausedInstalling ? "INSTALLING" : "DOWNLOADING")
    this.lastPausedPhase = null
    this.state = effectiveState
    if (typeof onPhaseChange === "function") {
      onPhaseChange(initialPhase)
    }

    const runOperation = async () => {
      let currentPhaseName = initialPhase
      let maxReportedProgress = 0
      let isUpdate = false
      const safeProgress = (data) => {
        if (!data) return
        const phase = data.phase || (isVerify ? "VERIFYING" : "DOWNLOADING")
        if (phase !== currentPhaseName) {
          currentPhaseName = phase
          maxReportedProgress = 0
        }
        if (typeof onProgress !== "function") return
        const rawProgress = typeof data.progress === "number" ? data.progress : 0
        const progress = Math.max(maxReportedProgress, Math.min(100, Math.round(rawProgress)))
        maxReportedProgress = progress
        onProgress({
          ...data,
          phase,
          progress,
        })
      }

      try {
        // 1. Sync HiKAT client files (mods, configs, etc.)
        const syncPlan = await generateSyncPlan(
          instanceRoot,
          clientFiles,
          modpackVersion,
          directoryPolicies,
          isVerify,
          safeProgress,
        )
        const installedManifest = await loadInstalledManifest(instanceRoot)
        isUpdate = Boolean(installedManifest && installedManifest.modpackVersion)

        // Check Minecraft Core/Loader status early so progress mapping is completely deterministic
        const coreStatus = await this.coreChecker({
          instanceRoot,
          minecraftVersion,
          modLoader,
          modLoaderVersion,
          neoForgeVersion,
        })
        const needsCoreInstall = (!coreStatus.installed || isVerify) && !payload.skipCoreInstall

        let downloadResult = null
        if (syncPlan.toDownload.length > 0 || isVerify) {
          const downloadProgressHandler = (data) => {
            if (!data) return
            const rawProgress = typeof data.progress === "number" ? data.progress : 0
            safeProgress({
              ...data,
              phase: isVerify ? "VERIFYING" : "DOWNLOADING",
              progress: isVerify ? Math.min(50, Math.max(35, Math.round(35 + (rawProgress / 100) * 15))) : rawProgress,
            })
          }

          downloadResult = await downloadClientFilesToStaging({
            instanceRoot,
            clientFiles,
            directoryPolicies,
            isVerify,
            cancelSignal,
            signal: abortController.signal,
            apiBaseUrl: payload.apiBaseUrl,
            onProgress: downloadProgressHandler,
          })
        }

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          this.lastPausedPhase = "DOWNLOADING"
          await saveDownloadSession(instanceRoot, {
            modpackVersion,
            status: "PAUSED",
            phase: "DOWNLOADING",
            operationKind: isVerify ? "VERIFY" : "SYNC",
            progress: maxReportedProgress,
            updatedAt: new Date().toISOString(),
          }).catch(() => {})
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED", "DOWNLOADING")
          return { success: false, paused: true, state: "PAUSED", phase: "DOWNLOADING" }
        }
        if (cancelSignal.isCancelled) {
          if (isUpdate) {
            await cleanStaging(instanceRoot).catch(() => {})
          } else {
            await cleanFreshInstall(instanceRoot).catch(() => {})
          }
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        // 2. Ensure Minecraft & Loader Core (minecraft-core discovers required Java)
        // Staged modpack files remain isolated in .hikat/staging/ during this entire phase!
        if (needsCoreInstall) {
          if (isUpdate) {
            this.isCommitting = true
          }

          if (!isVerify) {
            if (this.state !== "INSTALLING") {
              this.state = "INSTALLING"
              if (typeof onPhaseChange === "function") onPhaseChange("INSTALLING")
            }
            safeProgress({
              phase: "INSTALLING",
              progress: 30,
              isCommitting: this.isCommitting,
              canPause: !this.isCommitting,
              canCancel: !this.isCommitting,
            })
          }

          if (isVerify && coreStatus.installed) {
            // Core is already healthy
            safeProgress({
              phase: "VERIFYING",
              progress: 95,
              isCommitting: this.isCommitting,
              canPause: false,
              canCancel: false,
            })
          } else {
            const coreProgressAdapter = (data) => {
              if (typeof data?.progress === "number") {
                const raw = data.progress
                const mapped =
                  raw >= 30
                    ? Math.min(98, raw)
                    : Math.round(30 + (raw / 100) * 68)
                safeProgress({
                  ...data,
                  phase: isVerify ? "VERIFYING" : "INSTALLING",
                  progress: mapped,
                  isCommitting: this.isCommitting,
                  canPause: !this.isCommitting,
                  canCancel: !this.isCommitting,
                })
              } else {
                safeProgress({
                  ...data,
                  isCommitting: this.isCommitting,
                  canPause: !this.isCommitting,
                  canCancel: !this.isCommitting,
                })
              }
            }

            await this.coreInstaller({
              instanceRoot,
              javaStorageRoot: payload.javaStorageRoot,
              minecraftVersion,
              modLoader,
              modLoaderVersion,
              neoForgeVersion,
              signal: abortController.signal,
              onProgress: coreProgressAdapter,
            })
          }
        } else {
          // Core is already installed and healthy during update/install
          if (!isVerify && this.state !== "INSTALLING") {
            this.state = "INSTALLING"
            if (typeof onPhaseChange === "function") onPhaseChange("INSTALLING")
          }
          safeProgress({
            phase: isVerify ? "VERIFYING" : "INSTALLING",
            progress: 95,
          })
        }

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          this.lastPausedPhase = "INSTALLING"
          await saveDownloadSession(instanceRoot, {
            modpackVersion,
            status: "PAUSED",
            phase: "INSTALLING",
            operationKind: isVerify ? "VERIFY" : "SYNC",
            progress: maxReportedProgress,
            updatedAt: new Date().toISOString(),
          }).catch(() => {})
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED", "INSTALLING")
          return { success: false, paused: true, state: "PAUSED", phase: "INSTALLING" }
        }
        if (cancelSignal.isCancelled) {
          if (isUpdate) {
            await cleanStaging(instanceRoot).catch(() => {})
          } else {
            await cleanFreshInstall(instanceRoot).catch(() => {})
          }
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        // 3. Final Atomic Commit (~1 second):
        // Core is ready, client files are in staging.
        // Copy/apply staging files to instanceRoot, prune obsolete files, save manifest, clean staging.
        this.isCommitting = true
        let pendingManifestData = null

        const needsClientApply =
          syncPlan.toDownload.length > 0 ||
          syncPlan.toPrune.length > 0 ||
          installedManifest.modpackVersion !== modpackVersion

        const progressRange = isVerify
          ? { start: 90, end: 99 }
          : { start: 95, end: 99 }

        if (needsClientApply) {
          const applyResult = await applyStagingToInstance({
            instanceRoot,
            clientFiles,
            directoryPolicies,
            modpackVersion,
            plan: syncPlan,
            stagedFiles: downloadResult?.stagedFiles || [],
            onProgress: safeProgress,
            isVerify,
            progressRange,
          })
          pendingManifestData = applyResult?.manifestData || null
        }

        if (!pendingManifestData) {
          pendingManifestData = buildInstalledManifestData(
            instanceRoot,
            clientFiles,
            modpackVersion,
            directoryPolicies,
          )
        }

        await saveInstalledManifest(instanceRoot, pendingManifestData)
        await cleanStaging(instanceRoot)

        safeProgress({
          phase: isVerify ? "VERIFYING" : "INSTALLING",
          progress: 100,
        })

        this.isCommitting = false
        this.state = "IDLE"
        if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
        return { success: true }
      } catch (err) {
        this.isCommitting = false
        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          const pausedPhase =
            this.state === "INSTALLING" || currentPhaseName === "INSTALLING"
              ? "INSTALLING"
              : (currentPhaseName || "DOWNLOADING")
          this.lastPausedPhase = pausedPhase
          await saveDownloadSession(instanceRoot, {
            modpackVersion,
            status: "PAUSED",
            phase: pausedPhase,
            operationKind: isVerify ? "VERIFY" : "SYNC",
            progress: maxReportedProgress,
            updatedAt: new Date().toISOString(),
          }).catch(() => {})
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED", pausedPhase)
          return { success: false, paused: true, state: "PAUSED", phase: pausedPhase }
        }

        const isCancelled =
          cancelSignal.isCancelled ||
          err?.name === "AbortError" ||
          err?.message?.includes("aborted") ||
          err?.message?.includes("cancelled")
        if (isCancelled) {
          if (isUpdate) {
            await cleanStaging(instanceRoot).catch(() => {})
          } else {
            await cleanFreshInstall(instanceRoot).catch(() => {})
          }
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        this.state = "IDLE"
        if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
        throw err
      } finally {
        this.isCommitting = false
        if (this.activeCancelSignal?.id === opId) {
          this.activeCancelSignal = null
          this.activeAbortController = null
          this.activeSyncPromise = null
          this.activeOperationPromise = null
        }
      }
    }

    this.activeSyncPromise = runOperation()
    this.activeOperationPromise = this.activeSyncPromise
    return this.activeSyncPromise
  }

  async pauseSync() {
    if (this.isCommitting) {
      throw new Error("Cannot pause synchronization while finalizing installation.")
    }
    if (this.activeCancelSignal) {
      this.activeCancelSignal.isPaused = true
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }
    const pending = this.activeSyncPromise
    if (pending) {
      await pending.catch(() => {})
    }
    this.state = "PAUSED"
    return { success: true, paused: true, state: "PAUSED" }
  }

  async resumeSync() {
    if (!this.lastPayload) {
      throw new Error("No previous operation to resume.")
    }
    return this.startSync(this.lastPayload)
  }

  async cancelSync(instanceRoot) {
    if (this.isCommitting) {
      throw new Error("Cannot cancel while finalizing installation.")
    }
    const signalToCancel = this.activeCancelSignal
    if (this.activeCancelSignal) {
      this.activeCancelSignal.isCancelled = true
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }
    if (this.activeSyncPromise) {
      await this.activeSyncPromise.catch(() => {})
    }
    if (instanceRoot) {
      try {
        const manifest = await loadInstalledManifest(instanceRoot).catch(() => null)
        if (manifest && manifest.modpackVersion) {
          await cleanStaging(instanceRoot)
        } else {
          await cleanFreshInstall(instanceRoot)
        }
      } catch (_) {}
    }
    if (!this.activeCancelSignal || (signalToCancel && this.activeCancelSignal.id === signalToCancel.id)) {
      this.lastPausedPhase = null
      this.state = "IDLE"
    }
    return { success: true, state: "IDLE" }
  }

  async uninstallGame(instanceRoot, appDataRoot) {
    if (this.state === "SYNCING" || this.state === "INSTALLING") {
      throw new Error("Cannot uninstall game while synchronization is active.")
    }
    this.state = "IDLE"
    return uninstallGame(instanceRoot, appDataRoot)
  }

  async launchGame(gameLauncher, options = {}) {
    if (this.state !== "IDLE" && !options.allowDuringOperation) {
      throw new Error("Cannot launch Minecraft while game operation is in progress.")
    }
    if (!gameLauncher) throw new Error("GameLauncher instance required.")
    return gameLauncher.launch(options)
  }
}

module.exports = {
  GameOperationManager,
  validateSyncPayload,
  cleanFreshInstall,
}
