const fs = require("fs")
const fsp = require("fs/promises")
const path = require("path")
const { MinecraftFolder, Version } = require("@xmcl/core")
const {
  getVersionList,
  resolveMinecraftVersionJsonInstallFile,
  resolveMinecraftJarInstallFile,
  resolveLibraryInstallFiles,
  resolveAssetMetadataInstallManifest,
  resolveAssetObjectInstallFiles,
  resolveNeoForgedInstallerFile,
  createModernForgeInstallWorkflow,
  executeInstallManifest,
  executeInstallWorkflow,
  diagnoseInstallation,
} = require("@xmcl/installer")
const { createHiKatInstallRuntime } = require("./xmcl-install-runtime.cjs")

const CORE_STATE_REL_PATH = path.join(".hikat", "core-state.json")

function getCoreStatePath(instanceRoot) {
  return path.join(instanceRoot, CORE_STATE_REL_PATH)
}

async function loadCoreState(instanceRoot) {
  try {
    const filePath = getCoreStatePath(instanceRoot)
    if (!fs.existsSync(filePath)) return null
    const content = await fsp.readFile(filePath, "utf8")
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === "object" && parsed.minecraftVersion && parsed.resolvedVersionId) {
      return parsed
    }
  } catch (_) {}
  return null
}

async function saveCoreState(instanceRoot, state) {
  const filePath = getCoreStatePath(instanceRoot)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, JSON.stringify(state, null, 2), "utf8")
}

/**
 * Check if the core Minecraft + NeoForge installation is healthy locally.
 * Strictly local and offline.
 */
async function checkCore({ instanceRoot, minecraftVersion, neoForgeVersion }) {
  if (!instanceRoot) return { installed: false }
  const cleanMc = String(minecraftVersion || "").trim()
  const cleanNf = String(neoForgeVersion || "").trim()

  const state = await loadCoreState(instanceRoot)
  if (!state) return { installed: false }

  if (state.minecraftVersion !== cleanMc) return { installed: false }
  if (cleanNf && state.neoForgeVersion !== cleanNf) return { installed: false }

  const folder = MinecraftFolder.from(instanceRoot)
  let resolvedVersion = null
  try {
    resolvedVersion = await Version.parse(folder, state.resolvedVersionId)
  } catch (_) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId }
  }

  if (!resolvedVersion) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId }
  }

  try {
    const issue = await diagnoseInstallation(resolvedVersion)
    if (issue) {
      return { installed: false, resolvedVersionId: state.resolvedVersionId }
    }
  } catch (_) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId }
  }

  return { installed: true, resolvedVersionId: state.resolvedVersionId }
}

/**
 * Install or repair Minecraft Vanilla and NeoForge using XMCL 6.3.2 manifests and workflows.
 */
async function installCore({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  javaPath,
  signal,
  onProgress,
}) {
  if (!instanceRoot) throw new Error("instanceRoot is required for installCore")
  const cleanMc = String(minecraftVersion || "").trim()
  const cleanNf = String(neoForgeVersion || "").trim()
  if (!cleanMc) throw new Error("minecraftVersion is required for installCore")

  const folder = MinecraftFolder.from(instanceRoot)
  const runtime = createHiKatInstallRuntime({ signal })

  // 1. Fetch official version metadata
  const versionList = await getVersionList({ signal })
  const versionItem = versionList?.versions?.find((v) => v.id === cleanMc)
  if (!versionItem) {
    throw new Error(`Minecraft version ${cleanMc} not found in official version manifest.`)
  }

  // 2. Download / validate Vanilla version.json
  const versionJsonFile = resolveMinecraftVersionJsonInstallFile(versionItem, folder, { signal })
  await executeInstallManifest(
    {
      schemaVersion: 1,
      tasks: [{ id: `minecraft:${cleanMc}:version-json`, type: "files", files: [versionJsonFile] }],
    },
    runtime,
    { signal }
  )

  // 3. Parse Vanilla version
  const vanillaVersion = await Version.parse(folder, cleanMc)

  // 4. Resolve and install Vanilla client jar, libraries, and assets
  const clientJarFile = resolveMinecraftJarInstallFile(vanillaVersion, { side: "client", signal })
  const libraryFiles = resolveLibraryInstallFiles(vanillaVersion.libraries, folder, { signal })
  const assetMetaManifest = resolveAssetMetadataInstallManifest(vanillaVersion, folder, {
    useHashForAssetsIndex: true,
    abortSignal: signal,
  })
  await executeInstallManifest(assetMetaManifest, runtime, { signal })
  const assetFiles = await resolveAssetObjectInstallFiles(vanillaVersion, folder, {
    useHashForAssetsIndex: true,
    abortSignal: signal,
  })

  const vanillaFiles = [
    ...(clientJarFile ? [clientJarFile] : []),
    ...libraryFiles,
    ...assetFiles,
  ]

  if (vanillaFiles.length > 0) {
    await executeInstallManifest(
      {
        schemaVersion: 1,
        tasks: [{ id: `minecraft:${cleanMc}:files`, type: "files", files: vanillaFiles }],
      },
      runtime,
      { signal }
    )
  }

  let finalVersionId = cleanMc

  // 5. Install NeoForge if required
  if (cleanNf) {
    const { file: installerFile } = await resolveNeoForgedInstallerFile(
      "neoforge",
      cleanNf,
      folder,
      { signal }
    )

    const targetProfileId = `${cleanMc}-neoforge-${cleanNf}`
    const workflow = createModernForgeInstallWorkflow({
      id: targetProfileId,
      minecraft: folder,
      minecraftVersion: cleanMc,
      installer: installerFile,
      artifactVersion: cleanNf,
      java: javaPath || "java",
      installOptions: { signal },
      side: "client",
    })

    const result = await executeInstallWorkflow(workflow, runtime, { signal })
    finalVersionId =
      (result && typeof result === "object" ? result.version : result) || targetProfileId
  }

  // 6. Diagnose installed version to confirm integrity (XMCL is sole authority)
  const resolvedVersion = await Version.parse(folder, finalVersionId)
  const issue = await diagnoseInstallation(resolvedVersion)
  if (issue) {
    throw new Error(`Core installation integrity check failed: ${JSON.stringify(issue)}`)
  }

  // 7. Persist authoritative core state
  const state = {
    schemaVersion: 1,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
    resolvedVersionId: finalVersionId,
  }
  await saveCoreState(instanceRoot, state)

  return {
    success: true,
    resolvedVersionId: finalVersionId,
  }
}

/**
 * Repair core by running installCore.
 */
async function repairCore(options) {
  return installCore(options)
}

module.exports = {
  checkCore,
  installCore,
  repairCore,
  loadCoreState,
  saveCoreState,
}
