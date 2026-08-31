const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const { MinecraftFolder, Version, LibraryInfo } = require("@xmcl/core")
const { getVersionList } = require("@xmcl/installer")

const {
  validateFileIntegrity,
  validateFileSha256,
  downloadBuffer,
  downloadFileAtomic,
} = require("./artifact-integrity.cjs")
const {
  getPlannerCachePaths,
  ensurePlannerInstaller,
  canonicalNeoForgeInstallerPath,
  promotePlannerInstallerToCanonical,
  readVersionJsonFromJar,
} = require("./planner-cache.cjs")
const {
  checkMinecraftCoreReadiness,
  getCurrentPlatformOsKey,
} = require("./minecraft-readiness.cjs")

/**
 * Builds the unified core installation plan derived strictly from authoritative metadata and Planner Cache:
 * - Reuses persistent Planner Cache outside instanceRoot.
 * - Resolves all canonical artifacts with zero double-counting.
 * - Categorizes pre-cached artifacts into reusableCoreBytes vs live network transfer into bootstrapNetworkBytes.
 * - Identical behavior for planning mode ("planning") and execution mode ("execution").
 */
async function buildCoreInstallPlan({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  mojangPackage: inputMojangPackage = null,
  mode = "planning",
  signal,
  cancelSignal,
  onChunkBytes,
  customFetch = globalThis.fetch,
}) {
  if (!minecraftVersion || !neoForgeVersion) {
    return {
      totalCoreBytes: 0,
      installProfile: null,
      artifacts: new Map(),
      plannerInstaller: { path: null, sizeBytes: 0, sha256: null, status: "not-required" },
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      readiness: null,
    }
  }

  const cleanMc = String(minecraftVersion).trim()
  const cleanNf = String(neoForgeVersion).trim()

  const readiness = await checkMinecraftCoreReadiness({
    instanceRoot,
    minecraftVersion: cleanMc,
    neoForgeVersion: cleanNf,
  })

  if (readiness.isCoreInstalled) {
    return {
      totalCoreBytes: 0,
      installProfile: readiness.installProfile,
      artifacts: new Map(),
      plannerInstaller: {
        path: null,
        sizeBytes: 0,
        sha256: null,
        status: "not-required",
      },
      reusableCoreBytes: 0,
      bootstrapNetworkBytes: 0,
      needsVanilla: false,
      needsNeoForge: false,
      resolvedVersionId: readiness.resolvedVersionId,
      readiness,
    }
  }

  let bootstrapNetworkBytes = 0
  let reusableCoreBytes = 0
  let installProfile = readiness.installProfile || null
  let embeddedVersionJson = null
  let plannerInstallerInfo = {
    path: null,
    sizeBytes: 0,
    sha256: null,
    status: "not-required",
  }

  // 1. If NeoForge is needed, ensure Planner Cache has the verified installer
  if (readiness.needsNeoForge) {
    const plannerResult = await ensurePlannerInstaller({
      instanceRoot,
      neoForgeVersion: cleanNf,
      signal,
      cancelSignal,
      onChunkBytes,
      customFetch,
    })

    installProfile = plannerResult.installProfile
    bootstrapNetworkBytes = plannerResult.wasCached ? 0 : plannerResult.installerSizeBytes

    const status = plannerResult.wasCached
      ? "cached-before-operation"
      : "downloaded-this-operation"

    plannerInstallerInfo = {
      path: plannerResult.installerJarPath,
      sizeBytes: plannerResult.installerSizeBytes,
      sha256: plannerResult.installerSha256,
      status,
    }

    if (plannerResult.installerJarPath && fs.existsSync(plannerResult.installerJarPath)) {
      try {
        embeddedVersionJson = await readVersionJsonFromJar(plannerResult.installerJarPath)
      } catch (_) {}
    }

    if (plannerResult.wasCached) {
      reusableCoreBytes += plannerResult.installerSizeBytes
    }
  }

  // 2. Fetch / load Mojang version package metadata
  let mojangPackage = inputMojangPackage || null
  const vanillaJsonPath = path.join(instanceRoot, "versions", cleanMc, `${cleanMc}.json`)
  if (!mojangPackage && fs.existsSync(vanillaJsonPath)) {
    try {
      mojangPackage = JSON.parse(await fsp.readFile(vanillaJsonPath, "utf8"))
    } catch (_) {}
  }

  if (!mojangPackage) {
    try {
      const list = await getVersionList()
      const versionItem = list?.versions?.find((v) => v.id === cleanMc)
      if (versionItem?.url) {
        const res = await customFetch(versionItem.url, { signal })
        if (res && res.ok) {
          mojangPackage = await res.json()
        }
      }
    } catch (_) {}
  }

  // 3. Build Canonical Map of Required Artifacts
  const canonicalArtifacts = new Map()

  function registerArtifact({ relativePath, expectedSize, expectedSha1, expectedSha256, role, downloadUrl }) {
    if (!relativePath || typeof relativePath !== "string") return
    const normalizedKey = path.normalize(relativePath).replace(/\\/g, "/")
    if (canonicalArtifacts.has(normalizedKey)) return // Deduplicate!

    canonicalArtifacts.set(normalizedKey, {
      relativePath: normalizedKey,
      localPath: path.join(instanceRoot, relativePath),
      expectedSize: typeof expectedSize === "number" && expectedSize > 0 ? expectedSize : null,
      expectedSha1:
        typeof expectedSha1 === "string" && expectedSha1.trim()
          ? expectedSha1.trim().toLowerCase()
          : null,
      expectedSha256:
        typeof expectedSha256 === "string" && expectedSha256.trim()
          ? expectedSha256.trim().toLowerCase()
          : null,
      downloadUrl: downloadUrl || null,
      role,
    })
  }

  // 3.a Minecraft Client JAR
  const clientDownload = mojangPackage?.downloads?.client
  if (clientDownload) {
    registerArtifact({
      relativePath: path.join("versions", cleanMc, `${cleanMc}.jar`),
      expectedSize: clientDownload.size,
      expectedSha1: clientDownload.sha1,
      downloadUrl: clientDownload.url,
      role: "client-jar",
    })
  }

  // 3.a.ii Official Mojang Client Mappings (required for NeoForge/Forge processors e.g. DOWNLOAD_MOJMAPS)
  const clientMappingsDownload = mojangPackage?.downloads?.client_mappings
  if (clientMappingsDownload) {
    let clientMappingsRelPath = path.join("libraries", "net", "minecraft", "client", cleanMc, `client-${cleanMc}-mappings.txt`)
    if (installProfile?.data) {
      const mojmapsCoord = installProfile.data.MOJMAPS?.client || installProfile.data.MAPPINGS?.client
      if (typeof mojmapsCoord === "string" && mojmapsCoord.startsWith("[") && mojmapsCoord.endsWith("]")) {
        try {
          const info = LibraryInfo.resolve(mojmapsCoord.slice(1, -1))
          if (info?.path) {
            clientMappingsRelPath = path.join("libraries", info.path)
          }
        } catch (_) {}
      }
    }
    registerArtifact({
      relativePath: clientMappingsRelPath,
      expectedSize: clientMappingsDownload.size,
      expectedSha1: clientMappingsDownload.sha1,
      downloadUrl: clientMappingsDownload.url,
      role: "mojang-mappings",
    })
  }

  const serverMappingsDownload = mojangPackage?.downloads?.server_mappings
  if (serverMappingsDownload) {
    let serverMappingsRelPath = path.join("libraries", "net", "minecraft", "server", cleanMc, `server-${cleanMc}-mappings.txt`)
    if (installProfile?.data) {
      const serverMapsCoord = installProfile.data.SERVER_MAPPINGS?.server || installProfile.data.MOJMAPS?.server || installProfile.data.MAPPINGS?.server
      if (typeof serverMapsCoord === "string" && serverMapsCoord.startsWith("[") && serverMapsCoord.endsWith("]")) {
        try {
          const info = LibraryInfo.resolve(serverMapsCoord.slice(1, -1))
          if (info?.path) {
            serverMappingsRelPath = path.join("libraries", info.path)
          }
        } catch (_) {}
      }
    }
    registerArtifact({
      relativePath: serverMappingsRelPath,
      expectedSize: serverMappingsDownload.size,
      expectedSha1: serverMappingsDownload.sha1,
      downloadUrl: serverMappingsDownload.url,
      role: "mojang-mappings",
    })
  }

  // 3.b Vanilla Libraries & Native Classifiers for current platform
  const currentOsKey = getCurrentPlatformOsKey()

  if (mojangPackage?.libraries && Array.isArray(mojangPackage.libraries)) {
    try {
      const resolved = Version.resolveLibraries(mojangPackage.libraries)
      if (Array.isArray(resolved)) {
        for (const resLib of resolved) {
          const download = resLib.download
          const libPath = download?.path || resLib.path
          if (libPath) {
            registerArtifact({
              relativePath: path.join("libraries", libPath),
              expectedSize: download?.size,
              expectedSha1: download?.sha1,
              downloadUrl: download?.url,
              role: resLib.isNative ? "vanilla-native" : "vanilla-library",
            })
          }
        }
      }
    } catch (_) {}

    for (const lib of mojangPackage.libraries) {
      const artifact = lib.downloads?.artifact
      if (artifact?.path) {
        let isAllowed = true
        if (Array.isArray(lib.rules) && lib.rules.length > 0) {
          isAllowed = false
          for (const rule of lib.rules) {
            const osMatch = !rule.os || rule.os.name === currentOsKey
            if (osMatch) {
              isAllowed = rule.action === "allow"
            }
          }
        }
        if (isAllowed) {
          registerArtifact({
            relativePath: path.join("libraries", artifact.path),
            expectedSize: artifact.size,
            expectedSha1: artifact.sha1,
            downloadUrl: artifact.url,
            role: "vanilla-library",
          })
        }
      }

      if (lib.natives && typeof lib.natives === "object" && lib.downloads?.classifiers) {
        const nativeClassifierKey = lib.natives[currentOsKey]
        if (nativeClassifierKey && lib.downloads.classifiers[nativeClassifierKey]) {
          const classifierArtifact = lib.downloads.classifiers[nativeClassifierKey]
          if (classifierArtifact?.path) {
            registerArtifact({
              relativePath: path.join("libraries", classifierArtifact.path),
              expectedSize: classifierArtifact.size,
              expectedSha1: classifierArtifact.sha1,
              downloadUrl: classifierArtifact.url,
              role: "vanilla-native",
            })
          }
        }
      }
    }
  }

  // 3.c Assets (Index File + Objects)
  if (mojangPackage?.assetIndex) {
    const assetIndexMeta = mojangPackage.assetIndex
    registerArtifact({
      relativePath: path.join("assets", "indexes", `${assetIndexMeta.id}.json`),
      expectedSize: assetIndexMeta.size,
      expectedSha1: assetIndexMeta.sha1,
      downloadUrl: assetIndexMeta.url,
      role: "asset-index",
    })

    let assetIndexData = null
    const localIndexFile = path.join(instanceRoot, "assets", "indexes", `${assetIndexMeta.id}.json`)

    if (fs.existsSync(localIndexFile)) {
      try {
        assetIndexData = JSON.parse(await fsp.readFile(localIndexFile, "utf8"))
      } catch (_) {}
    }

    if (!assetIndexData && assetIndexMeta.url) {
      try {
        const assetRes = await customFetch(assetIndexMeta.url, { signal })
        if (assetRes && assetRes.ok) {
          assetIndexData = await assetRes.json()
        }
      } catch (_) {}
    }

    if (assetIndexData?.objects && typeof assetIndexData.objects === "object") {
      for (const obj of Object.values(assetIndexData.objects)) {
        if (obj && obj.hash) {
          const prefix = obj.hash.slice(0, 2)
          registerArtifact({
            relativePath: path.join("assets", "objects", prefix, obj.hash),
            expectedSize: obj.size,
            expectedSha1: obj.hash,
            downloadUrl: `https://resources.download.minecraft.net/${prefix}/${obj.hash}`,
            role: "asset",
          })
        }
      }
    }
  }

  // 3.d NeoForge Installer JAR (Uses expectedSha256 and promoted from Planner Cache)
  if (readiness.needsNeoForge) {
    const installerRelativePath = path.join(
      "libraries",
      "net",
      "neoforged",
      "neoforge",
      cleanNf,
      `neoforge-${cleanNf}-installer.jar`,
    )

    registerArtifact({
      relativePath: installerRelativePath,
      expectedSize: plannerInstallerInfo.sizeBytes,
      expectedSha256: plannerInstallerInfo.sha256,
      downloadUrl: null, // Planner Cache is the sole download authority; promoted locally
      role: "neoforge-installer",
    })
  }

  // 3.e NeoForge Install Profile Libraries
  if (installProfile?.libraries && Array.isArray(installProfile.libraries)) {
    for (const lib of installProfile.libraries) {
      const artifact = lib.downloads?.artifact
      if (artifact?.path) {
        registerArtifact({
          relativePath: path.join("libraries", artifact.path),
          expectedSize: artifact.size,
          expectedSha1: artifact.sha1,
          downloadUrl: artifact.url || (artifact.path.startsWith("net/neoforged") ? `https://maven.neoforged.net/releases/${artifact.path}` : `https://libraries.minecraft.net/${artifact.path}`),
          role: "neoforge-library",
        })
      } else if (lib.name) {
        try {
          const info = LibraryInfo.resolve(lib.name)
          if (info?.path) {
            registerArtifact({
              relativePath: path.join("libraries", info.path),
              expectedSize: null,
              expectedSha1: null,
              downloadUrl: lib.url
                ? (lib.url.endsWith("/") ? `${lib.url}${info.path}` : `${lib.url}/${info.path}`)
                : (info.path.startsWith("net/neoforged") ? `https://maven.neoforged.net/releases/${info.path}` : `https://libraries.minecraft.net/${info.path}`),
              role: "neoforge-library",
            })
          }
        } catch (_) {}
      }
    }
  }

  // 3.f NeoForge Embedded version.json Libraries
  if (embeddedVersionJson?.libraries && Array.isArray(embeddedVersionJson.libraries)) {
    for (const lib of embeddedVersionJson.libraries) {
      let isAllowed = true
      if (Array.isArray(lib.rules) && lib.rules.length > 0) {
        isAllowed = false
        for (const rule of lib.rules) {
          const osMatch = !rule.os || rule.os.name === currentOsKey
          if (osMatch) {
            isAllowed = rule.action === "allow"
          }
        }
      }
      if (!isAllowed) continue

      const artifact = lib.downloads?.artifact
      if (artifact?.path) {
        registerArtifact({
          relativePath: path.join("libraries", artifact.path),
          expectedSize: artifact.size,
          expectedSha1: artifact.sha1,
          downloadUrl: artifact.url || (artifact.path.startsWith("net/neoforged") ? `https://maven.neoforged.net/releases/${artifact.path}` : `https://libraries.minecraft.net/${artifact.path}`),
          role: "neoforge-library",
        })
      } else if (lib.name) {
        try {
          const info = LibraryInfo.resolve(lib.name)
          if (info?.path) {
            registerArtifact({
              relativePath: path.join("libraries", info.path),
              expectedSize: null,
              expectedSha1: null,
              downloadUrl: lib.url
                ? (lib.url.endsWith("/") ? `${lib.url}${info.path}` : `${lib.url}/${info.path}`)
                : (info.path.startsWith("net/neoforged") ? `https://maven.neoforged.net/releases/${info.path}` : `https://libraries.minecraft.net/${info.path}`),
              role: "neoforge-library",
            })
          }
        } catch (_) {}
      }

      if (lib.natives && typeof lib.natives === "object" && lib.downloads?.classifiers) {
        const nativeClassifierKey = lib.natives[currentOsKey]
        if (nativeClassifierKey && lib.downloads.classifiers[nativeClassifierKey]) {
          const classifierArtifact = lib.downloads.classifiers[nativeClassifierKey]
          if (classifierArtifact?.path) {
            registerArtifact({
              relativePath: path.join("libraries", classifierArtifact.path),
              expectedSize: classifierArtifact.size,
              expectedSha1: classifierArtifact.sha1,
              downloadUrl: classifierArtifact.url,
              role: "neoforge-native",
            })
          }
        }
      }
    }
  }

  // 3.g NeoForge Processor Jars & Classpath
  if (installProfile?.processors && Array.isArray(installProfile.processors)) {
    for (const proc of installProfile.processors) {
      if (proc.jar) {
        try {
          const info = LibraryInfo.resolve(proc.jar)
          if (info?.path) {
            registerArtifact({
              relativePath: path.join("libraries", info.path),
              expectedSize: null,
              expectedSha1: null,
              downloadUrl: `https://maven.neoforged.net/releases/${info.path}`,
              role: "processor-library",
            })
          }
        } catch (_) {}
      }
      if (Array.isArray(proc.classpath)) {
        for (const cp of proc.classpath) {
          try {
            const info = LibraryInfo.resolve(cp)
            if (info?.path) {
              registerArtifact({
                relativePath: path.join("libraries", info.path),
                expectedSize: null,
                expectedSha1: null,
                downloadUrl: `https://maven.neoforged.net/releases/${info.path}`,
                role: "processor-library",
              })
            }
          } catch (_) {}
        }
      }
    }
  }

  // 3.h NeoForge Processor Data & Remote Resources
  if (installProfile?.data && typeof installProfile.data === "object") {
    for (const [key, dataEntry] of Object.entries(installProfile.data)) {
      if (!dataEntry || typeof dataEntry !== "object") continue
      const targetVal = dataEntry.client || dataEntry.server
      if (typeof targetVal === "string" && targetVal.startsWith("[") && targetVal.endsWith("]")) {
        try {
          const coord = targetVal.slice(1, -1)
          const info = LibraryInfo.resolve(coord)
          if (info?.path) {
            const relPath = path.join("libraries", info.path)
            if (
              (key === "MOJMAPS" || key === "MAPPINGS" || (info.groupId === "net.minecraft" && info.classifier === "mappings")) &&
              mojangPackage?.downloads?.client_mappings
            ) {
              registerArtifact({
                relativePath: relPath,
                expectedSize: mojangPackage.downloads.client_mappings.size,
                expectedSha1: mojangPackage.downloads.client_mappings.sha1,
                downloadUrl: mojangPackage.downloads.client_mappings.url,
                role: "mojang-mappings",
              })
            } else if (
              key === "SERVER_MAPPINGS" &&
              mojangPackage?.downloads?.server_mappings
            ) {
              registerArtifact({
                relativePath: relPath,
                expectedSize: mojangPackage.downloads.server_mappings.size,
                expectedSha1: mojangPackage.downloads.server_mappings.sha1,
                downloadUrl: mojangPackage.downloads.server_mappings.url,
                role: "mojang-mappings",
              })
            } else {
              let matchedUrl = null
              let matchedSha1 = null
              let matchedSize = null
              if (Array.isArray(installProfile.libraries)) {
                const found = installProfile.libraries.find((l) => l.name === coord)
                if (found?.downloads?.artifact) {
                  matchedUrl = found.downloads.artifact.url
                  matchedSha1 = found.downloads.artifact.sha1
                  matchedSize = found.downloads.artifact.size
                }
              }
              registerArtifact({
                relativePath: relPath,
                expectedSize: matchedSize,
                expectedSha1: matchedSha1,
                downloadUrl:
                  matchedUrl ||
                  (info.path.startsWith("net/neoforged")
                    ? `https://maven.neoforged.net/releases/${info.path}`
                    : `https://libraries.minecraft.net/${info.path}`),
                role: "processor-data",
              })
            }
          }
        } catch (_) {}
      }
    }
  }

  // 3.f Diagnostics Missing Libraries & Assets
  if (readiness.needsLibraries && Array.isArray(readiness.missingLibraries)) {
    for (const issue of readiness.missingLibraries) {
      const artifact = issue.library?.downloads?.artifact
      if (artifact?.path) {
        registerArtifact({
          relativePath: path.join("libraries", artifact.path),
          expectedSize: artifact.size,
          expectedSha1: artifact.sha1,
          downloadUrl: artifact.url,
          role: "diagnostics-library",
        })
      }
    }
  }

  if (readiness.needsAssets && Array.isArray(readiness.missingAssets)) {
    for (const issue of readiness.missingAssets) {
      const assetObj = issue.asset
      if (assetObj?.hash) {
        const prefix = assetObj.hash.slice(0, 2)
        registerArtifact({
          relativePath: path.join("assets", "objects", prefix, assetObj.hash),
          expectedSize: assetObj.size,
          expectedSha1: assetObj.hash,
          downloadUrl: `https://resources.download.minecraft.net/${prefix}/${assetObj.hash}`,
          role: "diagnostics-asset",
        })
      }
    }
  }

  // 4. Validate Each Unique Canonical Artifact against Disk (Size + SHA-1 / SHA-256)
  let totalBytes = 0

  for (const artifact of canonicalArtifacts.values()) {
    // If this artifact was downloaded during this startSync invocation, count its exact bytes
    if (artifact.role === "neoforge-installer" && bootstrapNetworkBytes > 0) {
      totalBytes += bootstrapNetworkBytes
      continue
    }

    let isValid = false
    if (artifact.expectedSha256) {
      isValid = await validateFileSha256(artifact.localPath, -1, artifact.expectedSha256)
      if (isValid && typeof artifact.expectedSize === "number" && artifact.expectedSize > 0) {
        try {
          const stat = await fsp.stat(artifact.localPath)
          isValid = stat.size === artifact.expectedSize
        } catch (_) {
          isValid = false
        }
      }
    } else {
      isValid = await validateFileIntegrity(
        artifact.localPath,
        artifact.expectedSize,
        artifact.expectedSha1,
      )
    }

    if (!isValid) {
      if (typeof artifact.expectedSize === "number" && artifact.expectedSize > 0) {
        totalBytes += artifact.expectedSize
      }
    }
  }

  return {
    totalCoreBytes: totalBytes,
    installProfile,
    artifacts: canonicalArtifacts,
    plannerInstaller: plannerInstallerInfo,
    reusableCoreBytes,
    bootstrapNetworkBytes,
    needsVanilla: readiness.needsVanilla,
    needsNeoForge: readiness.needsNeoForge,
    resolvedVersionId: readiness.resolvedVersionId,
    mojangPackage,
    readiness,
  }
}

/**
 * Backward-compatible wrapper for estimateCoreDownloadBytes.
 */
async function estimateCoreDownloadBytes(options) {
  const plan = await buildCoreInstallPlan({
    ...options,
    mode: "planning",
  })
  return {
    totalCoreBytes: plan.totalCoreBytes,
    reusableCoreBytes: plan.reusableCoreBytes,
    bootstrapNetworkBytes: plan.bootstrapNetworkBytes,
    downloadedInPreflight: plan.bootstrapNetworkBytes > 0,
    preflightDownloadedBytes: plan.bootstrapNetworkBytes,
    needsNeoForge: plan.needsNeoForge,
    needsVanilla: plan.needsVanilla,
    resolvedVersionId: plan.resolvedVersionId,
    installProfile: plan.installProfile,
    readiness: plan.readiness,
  }
}

/**
 * Downloads all required Core artifacts (Vanilla jars, libraries, assets, NeoForge installer & libraries)
 * during the DOWNLOADING phase before moving to INSTALLING.
 */
async function downloadAllCoreArtifacts({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  artifacts,
  cancelSignal,
  onTaskBytes,
  onPhaseChange,
  customFetch = globalThis.fetch,
}) {
  if (cancelSignal?.isCancelled) {
    throw new Error("Download cancelled by user.")
  }

  if (typeof onPhaseChange === "function") {
    onPhaseChange("DOWNLOADING")
  }

  for (const artifact of artifacts.values()) {
    if (cancelSignal?.isCancelled) {
      throw new Error("Download cancelled by user.")
    }
    if (cancelSignal?.isPaused) {
      return { paused: true }
    }

    // Check if already valid
    let isValid = false
    if (artifact.expectedSha256) {
      isValid = await validateFileSha256(artifact.localPath, artifact.expectedSize, artifact.expectedSha256)
    } else {
      isValid = await validateFileIntegrity(artifact.localPath, artifact.expectedSize, artifact.expectedSha1)
    }

    if (isValid) {
      continue
    }

    if (artifact.role === "neoforge-installer") {
      await promotePlannerInstallerToCanonical(instanceRoot, neoForgeVersion)
      continue
    }

    if (!artifact.downloadUrl) {
      continue
    }

    await downloadFileAtomic(artifact.downloadUrl, artifact.localPath, {
      expectedSize: artifact.expectedSize || -1,
      expectedSha1: artifact.expectedSha1,
      expectedSha256: artifact.expectedSha256,
      cancelSignal,
      onChunkBytes: (chunkLen) => {
        if (typeof onTaskBytes === "function") {
          onTaskBytes(artifact.relativePath, chunkLen)
        }
      },
      customFetch,
    })
  }

  return { success: true }
}

module.exports = {
  buildCoreInstallPlan,
  estimateCoreDownloadBytes,
  downloadAllCoreArtifacts,
}
