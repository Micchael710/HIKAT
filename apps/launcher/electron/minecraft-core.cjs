const fs = require("fs")
const fsp = require("fs/promises")
const path = require("path")
const axios = require("axios")
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
  createNodeInstallRuntime,
  executeInstallManifest,
  executeInstallWorkflow,
  diagnoseInstallation,
} = require("@xmcl/installer")

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

async function downloadInstallFiles(files, signal) {
  for (const file of files) {
    if (file.trustExistingSize && fs.existsSync(file.path)) {
      const st = await fsp.stat(file.path).catch(() => null)
      if (st && file.size && st.size === file.size) continue
    }
    await fsp.mkdir(path.dirname(file.path), { recursive: true })
    let lastError = null
    for (const url of file.urls) {
      try {
        const res = await axios.get(url, { responseType: "arraybuffer", signal, timeout: 60000 })
        await fsp.writeFile(file.path, Buffer.from(res.data))
        lastError = null
        break
      } catch (err) {
        lastError = err
        if (signal?.aborted) throw err
      }
    }
    if (lastError) throw lastError
  }
}

function createInstallRuntime(options = {}) {
  return createNodeInstallRuntime({
    ...options,
    download: options.download ?? ((files) => downloadInstallFiles(files, options.signal)),
  })
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
    const issues = await diagnoseInstallation(resolvedVersion)
    if (issues) {
      const hasFatalIssue =
        Boolean(issues.jar) ||
        Boolean(issues.versionJsonMissing) ||
        (Array.isArray(issues.libraries) && issues.libraries.length > 0) ||
        (Array.isArray(issues.assets) && issues.assets.length > 0)
      if (hasFatalIssue) {
        return { installed: false, resolvedVersionId: state.resolvedVersionId }
      }
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
  const runtime = createInstallRuntime({ signal })

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
    abortSignal: signal,
  })
  await executeInstallManifest(assetMetaManifest, runtime, { signal })
  const assetFiles = await resolveAssetObjectInstallFiles(vanillaVersion, folder, {
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

  // 6. Diagnose installed version to confirm integrity
  const resolvedVersion = await Version.parse(folder, finalVersionId)
  const issues = await diagnoseInstallation(resolvedVersion)
  if (issues) {
    const hasFatalIssue =
      Boolean(issues.jar) ||
      Boolean(issues.versionJsonMissing) ||
      (Array.isArray(issues.libraries) && issues.libraries.length > 0) ||
      (Array.isArray(issues.assets) && issues.assets.length > 0)
    if (hasFatalIssue) {
      throw new Error(`Core installation integrity check failed: ${JSON.stringify(issues)}`)
    }
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
  createInstallRuntime,
}
