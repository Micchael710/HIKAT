const path = require("path")
const {
  generateSyncPlan,
  downloadClientFilesToStaging,
  applyStagingToInstance,
  loadInstalledManifest,
  loadDownloadSession,
  reconcileStagingFiles,
  cleanStaging,
  uninstallGame,
} = require("./client-files-sync.cjs")
const { checkCore, installCore } = require("./minecraft-core.cjs")
const { resolveJavaRuntime, ensureJavaRuntime, validateJavaBinary } = require("./java-runtime.cjs")

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
    if (!payload.neoForgeVersion || typeof payload.neoForgeVersion !== "string" || !payload.neoForgeVersion.trim()) {
      throw new Error("Invalid payload: neoForgeVersion must be a non-empty string.")
    }
  }

  const clientFiles = payload.clientFiles
  if (clientFiles !== undefined) {
    if (!Array.isArray(clientFiles)) {
      throw new Error("Invalid payload: clientFiles must be an array.")
    }
    if (isStartSync && !payload.isVerify && clientFiles.length === 0) {
      throw new Error("Invalid payload: clientFiles cannot be empty for startSync.")
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
    this.operationCounter = 0

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
      modpackVersion,
      minecraftVersion,
      neoForgeVersion,
    } = payload

    const clientPlan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
    const installedManifest = await loadInstalledManifest(instanceRoot)
    const core = await this.coreChecker({
      instanceRoot,
      minecraftVersion,
      neoForgeVersion,
    })

    const java = this.javaResolver(instanceRoot, { isGui: false })
    const javaValid = java.cliJavaPath ? Boolean(this.javaValidator(java.cliJavaPath).valid) : false

    const releaseMatches = installedManifest.modpackVersion === modpackVersion
    const clientSynced =
      clientPlan.toDownload.length === 0 &&
      clientPlan.toPrune.length === 0 &&
      releaseMatches

    const isFullyInstalled = clientSynced && Boolean(core.installed) && javaValid
    const needsUpdate = !isFullyInstalled
    const hasExistingInstall =
      Boolean(installedManifest.modpackVersion) ||
      Boolean(clientPlan.hasExistingInstall) ||
      Boolean(core.resolvedVersionId)

    let hasPausedSession = false
    let stagedBytes = 0
    let stagedFilesCount = 0

    const session = await loadDownloadSession(instanceRoot)
    if (session && session.status === "PAUSED") {
      hasPausedSession = true
      const reconciled = await reconcileStagingFiles(instanceRoot, clientPlan.toDownload)
      stagedBytes = reconciled.alreadyStagedBytes
      stagedFilesCount =
        (session.files ? Object.keys(session.files).length : 0) ||
        Object.keys(reconciled.validStagedMap).length
    }

    return {
      success: true,
      filesToDownload: clientPlan.toDownload.length,
      filesToPrune: clientPlan.toPrune.length,
      totalDownloadBytes: clientPlan.totalDownloadBytes,
      needsUpdate,
      hasExistingInstall,
      isFullyInstalled,
      hasPausedSession,
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
      modpackVersion,
      minecraftVersion,
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

    const effectiveState = isVerify ? "VERIFYING" : "SYNCING"
    this.state = effectiveState
    if (typeof onPhaseChange === "function") {
      onPhaseChange(isVerify ? "VERIFYING" : "DOWNLOADING")
    }

    const runOperation = async () => {
      try {
        // 1. Sync HiKAT client files (mods, configs, etc.)
        const syncPlan = await generateSyncPlan(instanceRoot, clientFiles, modpackVersion)
        const installedManifest = await loadInstalledManifest(instanceRoot)

        let downloadResult = null
        if (syncPlan.toDownload.length > 0 || isVerify) {
          downloadResult = await downloadClientFilesToStaging({
            instanceRoot,
            clientFiles,
            modpackVersion,
            onProgress,
            onPhaseChange: isVerify ? undefined : onPhaseChange,
            cancelSignal,
            apiBaseUrl,
          })
        }

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED")
          return { success: false, paused: true, state: "PAUSED" }
        }
        if (cancelSignal.isCancelled) {
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        // Apply staged/pruned files to instanceRoot when needed
        const needsClientApply =
          syncPlan.toDownload.length > 0 ||
          syncPlan.toPrune.length > 0 ||
          installedManifest.modpackVersion !== modpackVersion

        if (needsClientApply) {
          if (!isVerify) {
            this.state = "INSTALLING"
            if (typeof onPhaseChange === "function") onPhaseChange("INSTALLING")
          }
          await applyStagingToInstance({
            instanceRoot,
            clientFiles,
            modpackVersion,
            plan: syncPlan,
            stagedFiles: downloadResult?.stagedFiles || [],
            onProgress,
            cancelSignal,
          })
        }

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED")
          return { success: false, paused: true, state: "PAUSED" }
        }
        if (cancelSignal.isCancelled) {
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        // 2. Ensure Java 21 runtime
        if (!isVerify && this.state !== "INSTALLING") {
          this.state = "INSTALLING"
          if (typeof onPhaseChange === "function") onPhaseChange("INSTALLING")
        }

        let javaInfo = this.javaResolver(instanceRoot, { isGui: false })
        if (!javaInfo.cliJavaPath || !this.javaValidator(javaInfo.cliJavaPath).valid) {
          javaInfo = await this.javaEnsurer({
            appDataRoot: instanceRoot,
            signal: abortController.signal,
            onProgress,
          })
        }

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED")
          return { success: false, paused: true, state: "PAUSED" }
        }
        if (cancelSignal.isCancelled) {
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        // 3. Ensure Minecraft & NeoForge Core
        const coreStatus = await this.coreChecker({
          instanceRoot,
          minecraftVersion,
          neoForgeVersion,
        })

        if (!coreStatus.installed || isVerify) {
          if (!isVerify && this.state !== "INSTALLING") {
            this.state = "INSTALLING"
            if (typeof onPhaseChange === "function") onPhaseChange("INSTALLING")
          }

          if (isVerify && coreStatus.installed) {
            // Core is already healthy
          } else {
            await this.coreInstaller({
              instanceRoot,
              minecraftVersion,
              neoForgeVersion,
              javaPath: javaInfo.cliJavaPath,
              signal: abortController.signal,
              onProgress,
            })
          }
        }

        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED")
          return { success: false, paused: true, state: "PAUSED" }
        }
        if (cancelSignal.isCancelled) {
          this.state = "IDLE"
          if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
          throw new Error("Operation was cancelled.")
        }

        this.state = "IDLE"
        if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
        return { success: true }
      } catch (err) {
        if (cancelSignal.isPaused) {
          this.state = "PAUSED"
          if (typeof onPhaseChange === "function") onPhaseChange("PAUSED")
          return { success: false, paused: true, state: "PAUSED" }
        }
        this.state = "IDLE"
        if (typeof onPhaseChange === "function") onPhaseChange("IDLE")
        throw err
      } finally {
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
    if (this.state === "INSTALLING") {
      throw new Error("Cannot pause synchronization while installation phase is in progress.")
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
    if (this.state === "INSTALLING") {
      throw new Error("Cannot cancel synchronization while installation phase is in progress.")
    }
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
        await cleanStaging(instanceRoot)
      } catch (_) {}
    }
    this.state = "IDLE"
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
    if (this.state !== "IDLE") {
      throw new Error("Cannot launch Minecraft while game operation is in progress.")
    }
    if (!gameLauncher) throw new Error("GameLauncher instance required.")
    return gameLauncher.launch(options)
  }
}

module.exports = {
  GameOperationManager,
  validateSyncPayload,
}
