import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { resolveWatcherDecision } from "./client-files-sync.cjs"
import fsp from "fs/promises"
import path from "path"
import os from "os"

describe("Launcher Watcher Policy Resolution", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-watcher-test-"))
  })

  afterEach(async () => {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it("1. installed-manifest antiguo sin entrada 'mods' + directoryPolicies (mods = MODIFICABLE) -> ignora evento (no emit)", () => {
    const legacyInstalledFiles = {
      "config/options.txt": {
        officialSha256: "abc",
        policy: "MODIFICABLE",
      },
    }

    const directoryPolicies = [
      { path: "mods", policy: "MODIFICABLE" },
    ]

    expect(resolveWatcherDecision("mods", directoryPolicies, legacyInstalledFiles)).toBe("IGNORE")
    expect(resolveWatcherDecision("mods/custom.jar", directoryPolicies, legacyInstalledFiles)).toBe("IGNORE")
    expect(resolveWatcherDecision("mods/sub/deep.jar", directoryPolicies, legacyInstalledFiles)).toBe("IGNORE")
  })

  it("2. mods = NO_MODIFICABLE emite para archivos protegidos o directorios eliminados", async () => {
    const legacyInstalledFiles = {
      "config/options.txt": {
        officialSha256: "abc",
        policy: "MODIFICABLE",
      },
    }

    const directoryPolicies = [
      { path: "mods", policy: "NO_MODIFICABLE" },
    ]

    // Sin existir en disco (o borrado), emite EMIT
    expect(resolveWatcherDecision("mods", directoryPolicies, legacyInstalledFiles)).toBe("EMIT")
    // Archivo protegido dentro de mods emite EMIT
    expect(resolveWatcherDecision("mods/corrupt.jar", directoryPolicies, legacyInstalledFiles)).toBe("EMIT")

    // Si la carpeta mods existe en disco (evento de contenedor), lo ignora para que decida el archivo hijo
    const modsDir = path.join(tempDir, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    expect(resolveWatcherDecision("mods", directoryPolicies, legacyInstalledFiles, tempDir)).toBe("IGNORE")
  })

  it("3. Exact file policy override takes precedence over directory policy across ANY folder", () => {
    // Escenario A: Directorio MODIFICABLE (config), pero archivo NO_MODIFICABLE (config/secret.json)
    const dirPoliciesA = [
      { path: "config", policy: "MODIFICABLE" },
    ]
    const installedFilesA = {
      "config": { policy: "MODIFICABLE" },
      "config/secret.json": {
        officialSha256: "abc",
        policy: "NO_MODIFICABLE",
      },
      "config/options.txt": {
        officialSha256: "def",
        policy: "MODIFICABLE",
      },
    }

    expect(resolveWatcherDecision("config/secret.json", dirPoliciesA, installedFilesA)).toBe("EMIT")
    expect(resolveWatcherDecision("config/options.txt", dirPoliciesA, installedFilesA)).toBe("IGNORE")
    expect(resolveWatcherDecision("config/new_user_file.txt", dirPoliciesA, installedFilesA)).toBe("IGNORE")

    // Escenario B: Directorio NO_MODIFICABLE (mods), pero archivo MODIFICABLE (mods/create.jar)
    const dirPoliciesB = [
      { path: "mods", policy: "NO_MODIFICABLE" },
    ]
    const installedFilesB = {
      "mods": { policy: "NO_MODIFICABLE" },
      "mods/core.jar": {
        officialSha256: "111",
        policy: "NO_MODIFICABLE",
      },
      "mods/create.jar": {
        officialSha256: "222",
        policy: "MODIFICABLE",
      },
    }

    expect(resolveWatcherDecision("mods/create.jar", dirPoliciesB, installedFilesB)).toBe("IGNORE")
    expect(resolveWatcherDecision("mods/core.jar", dirPoliciesB, installedFilesB)).toBe("EMIT")
    expect(resolveWatcherDecision("mods/unauthorized_extra.jar", dirPoliciesB, installedFilesB)).toBe("EMIT")
  })

  it("4. Inherited directory policies without explicit file overrides (kubejs / resourcepacks)", () => {
    const directoryPolicies = [
      { path: "kubejs", policy: "NO_MODIFICABLE" },
      { path: "resourcepacks", policy: "MODIFICABLE" },
    ]
    const installedFiles = {
      "kubejs": { policy: "NO_MODIFICABLE" },
      "resourcepacks": { policy: "MODIFICABLE" },
    }

    // Hereda NO_MODIFICABLE
    expect(resolveWatcherDecision("kubejs/server_scripts/main.js", directoryPolicies, installedFiles)).toBe("EMIT")
    // Hereda MODIFICABLE
    expect(resolveWatcherDecision("resourcepacks/custom_pack.zip", directoryPolicies, installedFiles)).toBe("IGNORE")
  })

  it("5. fallback ENFORCED_DIRECTORIES cuando no hay directoryPolicies ni entrada en manifest", () => {
    const legacyInstalledFiles = {
      "config/options.txt": {
        officialSha256: "abc",
        policy: "MODIFICABLE",
      },
    }

    // Sin directoryPolicies
    expect(resolveWatcherDecision("mods", [], legacyInstalledFiles)).toBe("EMIT")
    expect(resolveWatcherDecision("mods/extra.jar", [], legacyInstalledFiles)).toBe("EMIT")
    expect(resolveWatcherDecision("shaderpacks", [], legacyInstalledFiles)).toBe("EMIT")
    expect(resolveWatcherDecision("untracked_dir/some.txt", [], legacyInstalledFiles)).toBe("IGNORE")
  })
})
