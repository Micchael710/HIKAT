const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")
const { MinecraftFolder, Version } = require("@xmcl/core")
const { validateFileIntegrity, validateFileSha256 } = require("./artifact-integrity.cjs")

/**
 * Returns path to .hikat/core-state.json.
 */
function getCoreStatePath(instanceRoot) {
  return path.join(instanceRoot, ".hikat", "core-state.json")
}

/**
 * Loads cached core state metadata from .hikat/core-state.json if available.
 */
async function loadCoreState(instanceRoot) {
  try {
    const raw = await fsp.readFile(getCoreStatePath(instanceRoot), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch (_) {
    return null
  }
}

/**
 * Saves core state metadata safely via atomic write.
 */
async function saveCoreState(instanceRoot, state) {
  const metaDir = path.join(instanceRoot, ".hikat")
  await fsp.mkdir(metaDir, { recursive: true })
  const statePath = getCoreStatePath(instanceRoot)
  const tempPath = path.join(
    metaDir,
    `core-state.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8")
  try {
    await fsp.rename(tempPath, statePath)
  } catch (_) {
    if (fs.existsSync(statePath)) {
      await fsp.unlink(statePath)
    }
    await fsp.rename(tempPath, statePath)
  }
}

/**
 * Normalizes NeoForge version string (e.g. "neoforge-21.1.65" -> "21.1.65", "21.1.65" -> "21.1.65").
 */
function normalizeNeoForgeProfileVersion(rawVersion) {
  if (typeof rawVersion !== "string" || !rawVersion.trim()) {
    return ""
  }
  let v = rawVersion.trim()
  v = v.replace(/^.*neoforge[d]?-/i, "")
  return v.trim()
}

/**
 * Maps Node process.platform to Minecraft OS classifier key.
 */
function getCurrentPlatformOsKey() {
  switch (process.platform) {
    case "win32":
      return "windows"
    case "darwin":
      return "osx"
    case "linux":
      return "linux"
    default:
      return "windows"
  }
}

/**
 * Returns candidate NeoForge version IDs that could represent the installed profile.
 */
function getNeoForgeProfileCandidates(minecraftVersion, neoForgeVersion) {
  const cleanNf = normalizeNeoForgeProfileVersion(neoForgeVersion)
  return [
    `${minecraftVersion}-neoforge-${cleanNf}`,
    `${minecraftVersion}-NeoForge-${cleanNf}`,
    `neoforge-${cleanNf}`,
    cleanNf,
    `${minecraftVersion}-${cleanNf}`,
  ]
}

/**
 * Checks local readiness of Minecraft Core and NeoForge installation.
 * Local-only, fast, zero network.
 */
async function checkMinecraftCoreReadiness({
  instanceRoot,
  minecraftVersion,
  neoForgeVersion,
  installProfile: explicitInstallProfile,
}) {
  const cleanMc = (minecraftVersion || "").trim()
  const cleanNf = normalizeNeoForgeProfileVersion(neoForgeVersion || "")
  const needsNeoForgeRequested = Boolean(cleanNf)
  const mc = MinecraftFolder.from(instanceRoot)

  const issues = []
  let installProfile = explicitInstallProfile || null

  // 1. Check Vanilla Version JSON
  const vanillaJsonPath = mc.getVersionJson(cleanMc)
  let vanillaVersion = null
  if (!fs.existsSync(vanillaJsonPath)) {
    issues.push(`Vanilla version json missing: ${vanillaJsonPath}`)
  } else {
    try {
      vanillaVersion = await Version.parse(instanceRoot, cleanMc)
    } catch (e) {
      issues.push(`Vanilla version json invalid: ${e.message}`)
    }
  }

  // 2. Check Vanilla Client JAR
  const clientJarPath = mc.getVersionJar(cleanMc)
  if (!fs.existsSync(clientJarPath)) {
    issues.push(`Vanilla client jar missing: ${clientJarPath}`)
  } else if (vanillaVersion?.downloads?.client) {
    const isJarValid = await validateFileIntegrity(
      clientJarPath,
      vanillaVersion.downloads.client.size,
      vanillaVersion.downloads.client.sha1,
    )
    if (!isJarValid) {
      issues.push(`Vanilla client jar integrity mismatch: ${clientJarPath}`)
    }
  }

  // 3. Check Vanilla Libraries
  const missingLibraries = []
  const checkedLibraryPaths = new Set()

  if (vanillaVersion?.libraries && Array.isArray(vanillaVersion.libraries)) {
    const currentOs = getCurrentPlatformOsKey()
    for (const lib of vanillaVersion.libraries) {
      // Check artifact
      if (lib.downloads?.artifact) {
        const libPath = mc.getLibraryByPath(lib.downloads.artifact.path)
        checkedLibraryPaths.add(libPath)
        const ok = await validateFileIntegrity(
          libPath,
          lib.downloads.artifact.size,
          lib.downloads.artifact.sha1,
        )
        if (!ok) {
          missingLibraries.push(libPath)
        }
      }
      // Check classifiers / natives for current OS
      if (lib.natives && lib.downloads?.classifiers) {
        const classifierKey = lib.natives[currentOs]
        if (classifierKey && lib.downloads.classifiers[classifierKey]) {
          const classArtifact = lib.downloads.classifiers[classifierKey]
          const nativePath = mc.getLibraryByPath(classArtifact.path)
          checkedLibraryPaths.add(nativePath)
          const ok = await validateFileIntegrity(
            nativePath,
            classArtifact.size,
            classArtifact.sha1,
          )
          if (!ok) {
            missingLibraries.push(nativePath)
          }
        }
      }
    }
  }
  if (missingLibraries.length > 0) {
    issues.push(`${missingLibraries.length} Vanilla libraries missing or invalid.`)
  }

  // 4. Check Asset Index & Asset Objects
  const missingAssets = []
  if (vanillaVersion?.assetIndex) {
    const assetId = vanillaVersion.assetIndex.id || vanillaVersion.assets || cleanMc
    const indexFile = path.join(instanceRoot, "assets", "indexes", `${assetId}.json`)
    if (!fs.existsSync(indexFile)) {
      issues.push(`Asset index missing: ${indexFile}`)
    } else {
      try {
        const indexRaw = await fsp.readFile(indexFile, "utf8")
        const indexData = JSON.parse(indexRaw)
        if (indexData?.objects) {
          for (const [, obj] of Object.entries(indexData.objects)) {
            if (!obj?.hash) continue
            const sub = obj.hash.substring(0, 2)
            const objPath = path.join(mc.assets, "objects", sub, obj.hash)
            const ok = await validateFileIntegrity(objPath, obj.size, obj.hash)
            if (!ok) {
              missingAssets.push(objPath)
            }
          }
        }
      } catch (_) {
        issues.push(`Asset index corrupt: ${indexFile}`)
      }
    }
  }
  if (missingAssets.length > 0) {
    issues.push(`${missingAssets.length} assets missing or invalid.`)
  }

  // 5. Check NeoForge Installation if requested
  let installedNeoForgeVersionId = null
  if (needsNeoForgeRequested) {
    const candidates = getNeoForgeProfileCandidates(cleanMc, cleanNf)
    let foundProfileJson = null
    let parsedNeoForgeVersion = null

    for (const candidate of candidates) {
      const pJson = mc.getVersionJson(candidate)
      if (fs.existsSync(pJson)) {
        try {
          const parsed = await Version.parse(instanceRoot, candidate)
          if (parsed) {
            foundProfileJson = pJson
            installedNeoForgeVersionId = candidate
            parsedNeoForgeVersion = parsed
            break
          }
        } catch (_) {}
      }
    }

    if (!foundProfileJson || !parsedNeoForgeVersion) {
      issues.push(`NeoForge version profile missing for ${cleanMc}-neoforge-${cleanNf}`)
    } else {
      // Validate libraries declared by the installed NeoForge profile
      if (parsedNeoForgeVersion.libraries && Array.isArray(parsedNeoForgeVersion.libraries)) {
        const resolvedNfLibs = Version.resolveLibraries(parsedNeoForgeVersion.libraries)
        if (Array.isArray(resolvedNfLibs)) {
          for (const lib of resolvedNfLibs) {
            const libRelPath = lib.download?.path || lib.path
            if (!libRelPath) continue
            const libPath = mc.getLibraryByPath(libRelPath)
            if (checkedLibraryPaths.has(libPath)) continue
            checkedLibraryPaths.add(libPath)

            const exists = fs.existsSync(libPath)
            if (!exists) {
              missingLibraries.push(libPath)
              issues.push(`NeoForge library missing: ${libPath}`)
            } else {
              const expectedSha1 =
                lib.download?.sha1 ||
                (Array.isArray(lib.checksums) && lib.checksums.length > 0 ? lib.checksums[0] : "") ||
                ""
              const expectedSize =
                typeof lib.download?.size === "number" && lib.download.size > 0 ? lib.download.size : -1
              if (expectedSha1 && typeof expectedSha1 === "string" && expectedSha1.trim()) {
                const ok = await validateFileIntegrity(libPath, expectedSize, expectedSha1)
                if (!ok) {
                  missingLibraries.push(libPath)
                  issues.push(`NeoForge library integrity mismatch: ${libPath}`)
                }
              }
            }
          }
        }
      }
    }

    // Check cached core state or install_profile.json
    if (!installProfile) {
      const state = await loadCoreState(instanceRoot)
      if (state?.installProfile && typeof state.installProfile === "object") {
        installProfile = state.installProfile
      }
    }

    if (installProfile) {
      const profileNf = normalizeNeoForgeProfileVersion(installProfile.version || "")
      if (profileNf && cleanNf && profileNf !== cleanNf) {
        issues.push(`InstallProfile version mismatch: found ${installProfile.version}, expected ${cleanNf}`)
      }
    }

    // Verify NeoForge installer profile processor outputs if available
    if (installProfile?.processors && Array.isArray(installProfile.processors)) {
      for (const proc of installProfile.processors) {
        if (proc.outputs && typeof proc.outputs === "object") {
          for (const [outputPathKey, expectedSha1] of Object.entries(proc.outputs)) {
            const resolvedPath = outputPathKey
              .replace(/\{ROOT\}/g, instanceRoot)
              .replace(/\{MINECRAFT_JAR\}/g, mc.getVersionJar(cleanMc))
            const exists = fs.existsSync(resolvedPath)
            if (!exists) {
              issues.push(`Processor output missing: ${resolvedPath}`)
            } else if (expectedSha1 && typeof expectedSha1 === "string" && expectedSha1.trim()) {
              const valid = await validateFileIntegrity(resolvedPath, -1, expectedSha1)
              if (!valid) {
                issues.push(`Processor output hash mismatch: ${resolvedPath}`)
              }
            }
          }
        }
      }
    }
  }

  const isCoreInstalled = issues.length === 0
  const needsNeoForge = needsNeoForgeRequested ? !isCoreInstalled : false
  const hasExistingInstall =
    Boolean(vanillaVersion) || fs.existsSync(vanillaJsonPath) || Boolean(installedNeoForgeVersionId)

  return {
    isCoreInstalled,
    hasExistingInstall,
    needsNeoForge,
    resolvedVersionId: installedNeoForgeVersionId || cleanMc,
    missingLibraries,
    missingAssets,
    issues,
    installProfile,
  }
}

module.exports = {
  getCoreStatePath,
  loadCoreState,
  saveCoreState,
  normalizeNeoForgeProfileVersion,
  getCurrentPlatformOsKey,
  getNeoForgeProfileCandidates,
  checkMinecraftCoreReadiness,
}
