const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const { MinecraftFolder, Version } = require("@xmcl/core")
const {
  open,
  readAllEntries,
  getEntriesRecord,
  filterEntries,
} = require("@xmcl/unzip")
const {
  walkForgeInstallerEntries,
  isForgeInstallerEntries,
  unpackForgeInstaller,
  installByProfileTask,
  installByProfile,
  BadForgeInstallerJarError,
} = require("@xmcl/installer")

const {
  canonicalNeoForgeInstallerPath,
  promotePlannerInstallerToCanonical,
} = require("./planner-cache.cjs")

/**
 * Installs NeoForge into instanceRoot using a pre-downloaded, verified installer JAR and local Java 21.
 * This runs completely locally during INSTALLING phase with ZERO network calls.
 */
async function installNeoForgeFromPreparedInstaller({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  installProfile,
  javaCliPath,
  onPhaseChange,
  cancelSignal,
}) {
  if (cancelSignal?.isCancelled) {
    throw new Error("Installation cancelled by user.")
  }

  if (typeof onPhaseChange === "function") {
    onPhaseChange("RUNNING_PROCESSORS")
  }

  // 1. Promote installer from Planner Cache to canonical libraries path
  const canonicalJarPath = await promotePlannerInstallerToCanonical(instanceRoot, neoForgeVersion)

  if (!fs.existsSync(canonicalJarPath)) {
    throw new Error(`Canonical NeoForge installer JAR missing at ${canonicalJarPath}`)
  }

  const mc = MinecraftFolder.from(instanceRoot)
  const zip = await open(canonicalJarPath, { lazyEntries: true, autoClose: false })

  try {
    const entries = await walkForgeInstallerEntries(zip, neoForgeVersion)

    if (!entries.installProfileJson) {
      throw new BadForgeInstallerJarError(canonicalJarPath, "install_profile.json")
    }

    const profile =
      installProfile ||
      (await open(canonicalJarPath, { lazyEntries: true, autoClose: true })
        .then((z) => readAllEntries(z))
        .then((all) => getEntriesRecord(all)["install_profile.json"])
        .then((e) => zip.readEntry(e))
        .then((b) => JSON.parse(b.toString("utf8"))))

    let versionId
    if (isForgeInstallerEntries(entries)) {
      versionId = await unpackForgeInstaller(zip, entries, profile, mc, canonicalJarPath, {
        java: javaCliPath,
      })

      const task = installByProfileTask(profile, instanceRoot, {
        java: javaCliPath,
        side: "client",
      })

      await task.startAndWait()
    } else {
      throw new BadForgeInstallerJarError(canonicalJarPath)
    }

    return {
      success: true,
      versionId: versionId || `${minecraftVersion}-neoforge-${neoForgeVersion}`,
    }
  } finally {
    try {
      zip.close()
    } catch (_) {}
  }
}

module.exports = {
  installNeoForgeFromPreparedInstaller,
}
