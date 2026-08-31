const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const { MinecraftFolder, Version } = require("@xmcl/core")
const {
  installVersionTask,
  installLibrariesTask,
  installAssetsTask,
} = require("@xmcl/installer")

const {
  calculateFileSha1,
  calculateFileSha256,
  validateFileIntegrity,
  validateFileSha256,
  downloadBuffer,
  downloadFileAtomic,
} = require("./artifact-integrity.cjs")

const {
  getJavaRuntimeDir,
  parseJavaMajorVersion,
  resolveJavaRuntime,
  validateJavaBinary,
  ensureJava21Runtime,
} = require("./java-runtime.cjs")

const {
  getPlannerCachePaths,
  canonicalNeoForgeInstallerPath,
  loadPlannerInstallerMetadata,
  savePlannerInstallerMetadata,
  validatePlannerInstaller,
  fetchOfficialNeoForgeInstallerSha256,
  resolveOfficialNeoForgeInstallerSha256,
  readInstallProfileFromJar,
  bootstrapNeoForgeInstaller,
  ensurePlannerInstaller,
  promotePlannerInstallerToCanonical,
} = require("./planner-cache.cjs")

const {
  getCoreStatePath,
  loadCoreState,
  saveCoreState,
  normalizeNeoForgeProfileVersion,
  getCurrentPlatformOsKey,
  getNeoForgeProfileCandidates,
  checkMinecraftCoreReadiness,
} = require("./minecraft-readiness.cjs")

const {
  buildCoreInstallPlan,
  estimateCoreDownloadBytes,
  downloadAllCoreArtifacts,
} = require("./minecraft-plan.cjs")

const {
  installNeoForgeFromPreparedInstaller,
} = require("./neoforge-installer.cjs")

/**
 * Orchestrates installation or repair of Minecraft Vanilla + NeoForge Core.
 * Follows strict separation of network (DOWNLOADING) vs local processing (INSTALLING).
 */
async function installOrRepairMinecraftCore({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  javaCliPath,
  preparedPlan,
  onTaskBytes,
  onPhaseChange,
  cancelSignal,
  customFetch = globalThis.fetch,
}) {
  if (!minecraftVersion || !neoForgeVersion) {
    throw new Error("Missing required version parameters for Core installation.")
  }

  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()

  let plan = preparedPlan

  // If preparedPlan was not passed (e.g. standalone call), check readiness, build and download plan
  if (!plan) {
    // 1. Initial local readiness check
    const initialReadiness = await checkMinecraftCoreReadiness({
      instanceRoot,
      minecraftVersion: cleanMc,
      neoForgeVersion: cleanNf,
    })

    if (initialReadiness.isCoreInstalled) {
      return {
        success: true,
        resolvedVersionId: initialReadiness.resolvedVersionId,
        installedVanilla: false,
        installedNeoForge: false,
      }
    }

    plan = await buildCoreInstallPlan({
      instanceRoot,
      minecraftVersion: cleanMc,
      neoForgeVersion: cleanNf,
      mode: "execution",
      cancelSignal,
      customFetch,
    })

    if (cancelSignal?.isCancelled) {
      throw new Error("Installation cancelled by user.")
    }
    if (cancelSignal?.isPaused) {
      return { paused: true }
    }

    // Network phase: Download all required Core artifacts
    if (plan.artifacts && plan.artifacts.size > 0) {
      const downloadResult = await downloadAllCoreArtifacts({
        instanceRoot,
        minecraftVersion: cleanMc,
        neoForgeVersion: cleanNf,
        artifacts: plan.artifacts,
        cancelSignal,
        onTaskBytes,
        onPhaseChange,
        customFetch,
      })

      if (downloadResult?.paused) {
        return { paused: true }
      }
    }
  }

  // 4. Install Phase: Local installation & processors (ZERO network)
  if (typeof onPhaseChange === "function") {
    onPhaseChange("INSTALLING")
  }

  // Ensure Vanilla version JSON exists in versions/<cleanMc>/<cleanMc>.json
  const mc = MinecraftFolder.from(instanceRoot)
  const vanillaJsonPath = mc.getVersionJson(cleanMc)
  if (!fs.existsSync(vanillaJsonPath) && plan.mojangPackage) {
    await fsp.mkdir(path.dirname(vanillaJsonPath), { recursive: true })
    await fsp.writeFile(vanillaJsonPath, JSON.stringify(plan.mojangPackage, null, 2), "utf8")
  }

  let resolvedVersionId = cleanMc
  let installedNeoForge = false

  if (plan.needsNeoForge) {
    const nfResult = await installNeoForgeFromPreparedInstaller({
      instanceRoot,
      minecraftVersion: cleanMc,
      neoForgeVersion: cleanNf,
      installProfile: plan.installProfile,
      javaCliPath,
      onPhaseChange,
      cancelSignal,
    })
    resolvedVersionId = nfResult.versionId
    installedNeoForge = true
  }

  // 5. Verifying Phase
  if (typeof onPhaseChange === "function") {
    onPhaseChange("VERIFYING")
  }

  const finalReadiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  if (!finalReadiness.isCoreInstalled) {
    throw new Error(`Post-installation verification failed: ${finalReadiness.issues.join(", ")}`)
  }

  // 6. Save core-state.json
  await saveCoreState(instanceRoot, {
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
    resolvedVersionId,
    installedAt: new Date().toISOString(),
    installProfile: finalReadiness.installProfile || plan.installProfile,
  })

  return {
    success: true,
    resolvedVersionId,
    installedVanilla: true,
    installedNeoForge,
  }
}

module.exports = {
  // Integrity & Downloader
  calculateFileSha1,
  calculateFileSha256,
  validateFileIntegrity,
  validateFileSha256,
  downloadBuffer,
  downloadFileAtomic,

  // Java Runtime
  getJavaRuntimeDir,
  parseJavaMajorVersion,
  resolveJavaRuntime,
  validateJavaBinary,
  ensureJava21Runtime,

  // Planner Cache
  getPlannerCachePaths,
  canonicalNeoForgeInstallerPath,
  getNeoForgeInstallerJarPath: canonicalNeoForgeInstallerPath,
  loadPlannerInstallerMetadata,
  savePlannerInstallerMetadata,
  validatePlannerInstaller,
  fetchOfficialNeoForgeInstallerSha256,
  resolveOfficialNeoForgeInstallerSha256,
  readInstallProfileFromJar,
  bootstrapNeoForgeInstaller,
  ensurePlannerInstaller,
  promotePlannerInstallerToCanonical,

  // Readiness & Platform
  getCoreStatePath,
  loadCoreState,
  saveCoreState,
  normalizeNeoForgeProfileVersion,
  getCurrentPlatformOsKey,
  getNeoForgeProfileCandidates,
  checkMinecraftCoreReadiness,

  // Core Plan & Downloader
  buildCoreInstallPlan,
  estimateCoreDownloadBytes,
  downloadAllCoreArtifacts,

  // NeoForge Local Installer
  installNeoForgeFromPreparedInstaller,

  // Main Orchestrator
  installOrRepairMinecraftCore,
}
