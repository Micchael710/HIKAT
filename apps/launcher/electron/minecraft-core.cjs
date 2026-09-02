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
  resolveForgeArtifactVersion,
  resolveForgeInstallerFile,
  createModernForgeInstallWorkflow,
  createLegacyForgeInstallWorkflow,
  createFabricInstallWorkflow,
  createQuiltInstallWorkflow,
  executeInstallManifest,
  executeInstallWorkflow,
  diagnoseInstallation,
} = require("@xmcl/installer")
const { createHiKatInstallRuntime } = require("./xmcl-install-runtime.cjs")
const {
  resolveJavaRuntime,
  ensureJavaRuntime,
  validateJavaBinary,
} = require("./java-runtime.cjs")

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
 * Check if the core Minecraft + loader installation is healthy locally.
 * Strictly local and offline.
 * Accepts: { instanceRoot, minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion }
 * neoForgeVersion is legacy: if modLoader is not provided, NEOFORGE is assumed.
 */
async function checkCore({ instanceRoot, minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion }) {
  if (!instanceRoot) return { installed: false }
  const cleanMc = String(minecraftVersion || "").trim()

  // Resolve loader / version from new or legacy fields
  const resolvedLoader = (modLoader || (neoForgeVersion ? "NEOFORGE" : "VANILLA")).toUpperCase()
  const resolvedLoaderVersion = (modLoaderVersion || neoForgeVersion || "").trim()

  const state = await loadCoreState(instanceRoot)
  if (!state) return { installed: false }

  const stateLoader = (state.modLoader || (state.neoForgeVersion ? "NEOFORGE" : "VANILLA")).toUpperCase()
  const stateLoaderVersion = String(state.modLoaderVersion || state.neoForgeVersion || "").trim()

  if (state.minecraftVersion !== cleanMc) return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
  if (stateLoader !== resolvedLoader) return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
  if (resolvedLoader !== "VANILLA" && stateLoaderVersion !== resolvedLoaderVersion) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
  }

  const folder = MinecraftFolder.from(instanceRoot)
  let resolvedVersion = null
  try {
    resolvedVersion = await Version.parse(folder, state.resolvedVersionId)
  } catch (_) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
  }

  if (!resolvedVersion) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
  }

  try {
    const issue = await diagnoseInstallation(resolvedVersion)
    if (issue) {
      return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
    }
  } catch (_) {
    return { installed: false, resolvedVersionId: state.resolvedVersionId, javaMajorVersion: state.javaMajorVersion || 21, javaComponent: state.javaComponent || null }
  }

  return {
    installed: true,
    resolvedVersionId: state.resolvedVersionId,
    javaMajorVersion: state.javaMajorVersion || 21,
    javaComponent: state.javaComponent || null,
  }
}

/**
 * Install or repair Minecraft Vanilla and the configured mod loader using XMCL.
 * Accepts: { instanceRoot, minecraftVersion, modLoader, modLoaderVersion, neoForgeVersion, javaPath, signal, onProgress }
 * modLoader: VANILLA | NEOFORGE | FORGE | FABRIC | QUILT
 * neoForgeVersion is legacy: used as modLoaderVersion when modLoader is NEOFORGE and modLoaderVersion is absent.
 */
async function installCore({
  instanceRoot,
  minecraftVersion,
  modLoader,
  modLoaderVersion,
  neoForgeVersion,
  javaPath,
  signal,
  onProgress,
}) {
  if (!instanceRoot) throw new Error("instanceRoot is required for installCore")
  const cleanMc = String(minecraftVersion || "").trim()
  if (!cleanMc) throw new Error("minecraftVersion is required for installCore")

  // Normalize loader
  const resolvedLoader = (modLoader || (neoForgeVersion ? "NEOFORGE" : "VANILLA")).toUpperCase()
  const resolvedLoaderVersion = String(modLoaderVersion || neoForgeVersion || "").trim()

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

  // 3.1 Dynamically resolve and ensure required Java runtime for this Minecraft version
  const requiredJavaMajor = vanillaVersion.javaVersion?.majorVersion ?? 8
  const requiredJavaComponent = vanillaVersion.javaVersion?.component ?? "jre-legacy"

  let effectiveJavaPath = javaPath
  if (!effectiveJavaPath) {
    let javaInfo = resolveJavaRuntime(instanceRoot, {
      isGui: false,
      majorVersion: requiredJavaMajor,
    })

    if (
      !javaInfo.cliJavaPath ||
      !validateJavaBinary(javaInfo.cliJavaPath, requiredJavaMajor).valid
    ) {
      javaInfo = await ensureJavaRuntime({
        appDataRoot: instanceRoot,
        majorVersion: requiredJavaMajor,
        component: requiredJavaComponent,
        signal,
        onProgress,
      })
    }
    effectiveJavaPath = javaInfo.cliJavaPath || "java"
  }

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

  // 5. Install mod loader if required
  if (resolvedLoader !== "VANILLA") {
    if (!resolvedLoaderVersion) {
      throw new Error(`modLoaderVersion is required when modLoader is ${resolvedLoader}`)
    }

    if (resolvedLoader === "NEOFORGE") {
      const { file: installerFile } = await resolveNeoForgedInstallerFile(
        "neoforge",
        resolvedLoaderVersion,
        folder,
        { signal }
      )

      const targetProfileId = `${cleanMc}-neoforge-${resolvedLoaderVersion}`
      const workflow = createModernForgeInstallWorkflow({
        id: targetProfileId,
        minecraft: folder,
        minecraftVersion: cleanMc,
        installer: installerFile,
        artifactVersion: resolvedLoaderVersion,
        java: effectiveJavaPath,
        installOptions: { signal },
        side: "client",
      })

      const result = await executeInstallWorkflow(workflow, runtime, { signal })
      finalVersionId =
        (result && typeof result === "object" ? result.version : result) || targetProfileId

    } else if (resolvedLoader === "FORGE") {
      const artifactVersion = resolveForgeArtifactVersion(cleanMc, resolvedLoaderVersion)
      const legacy = cleanMc.startsWith("1.4.") || cleanMc.startsWith("1.5.")

      const { file: installerFile } = resolveForgeInstallerFile(
        artifactVersion,
        undefined,
        folder,
        { signal },
        legacy,
      )

      const targetProfileId = `${cleanMc}-forge-${resolvedLoaderVersion}`
      const workflow = legacy
        ? createLegacyForgeInstallWorkflow({
            id: targetProfileId,
            minecraft: folder,
            minecraftVersion: cleanMc,
            universal: installerFile,
            artifactVersion,
            installOptions: { signal },
          })
        : createModernForgeInstallWorkflow({
            id: targetProfileId,
            minecraft: folder,
            minecraftVersion: cleanMc,
            installer: installerFile,
            artifactVersion,
            java: effectiveJavaPath,
            installOptions: { signal },
            side: "client",
          })

      const result = await executeInstallWorkflow(workflow, runtime, { signal })
      finalVersionId =
        (result && typeof result === "object" ? result.version : result) || targetProfileId

    } else if (resolvedLoader === "FABRIC") {
      const workflow = createFabricInstallWorkflow({
        minecraft: folder,
        minecraftVersion: cleanMc,
        version: resolvedLoaderVersion,
        side: "client",
      })
      const result = await executeInstallWorkflow(workflow, runtime, { signal })
      finalVersionId =
        (result && typeof result === "object" ? result.version : result) ||
        `${cleanMc}-fabric-${resolvedLoaderVersion}`

    } else if (resolvedLoader === "QUILT") {
      const workflow = createQuiltInstallWorkflow({
        minecraft: folder,
        minecraftVersion: cleanMc,
        version: resolvedLoaderVersion,
        side: "client",
      })
      const result = await executeInstallWorkflow(workflow, runtime, { signal })
      finalVersionId =
        (result && typeof result === "object" ? result.version : result) ||
        `${cleanMc}-quilt-${resolvedLoaderVersion}`

    } else {
      throw new Error(`Unsupported modLoader: ${resolvedLoader}`)
    }
  }

  // 6. Diagnose installed version to confirm integrity (XMCL is sole authority)
  const resolvedVersion = await Version.parse(folder, finalVersionId)
  const issue = await diagnoseInstallation(resolvedVersion)
  if (issue) {
    throw new Error(`Core installation integrity check failed: ${JSON.stringify(issue)}`)
  }

  // 7. Persist authoritative core state v2
  const state = {
    schemaVersion: 2,
    minecraftVersion: cleanMc,
    modLoader: resolvedLoader,
    modLoaderVersion: resolvedLoader !== "VANILLA" ? resolvedLoaderVersion : null,
    javaMajorVersion: requiredJavaMajor,
    javaComponent: requiredJavaComponent,
    // Keep legacy field for compatibility with older state readers
    neoForgeVersion: resolvedLoader === "NEOFORGE" ? resolvedLoaderVersion : null,
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
