import { describe, it, expect } from "vitest"
import { resolveWatcherDecision } from "./client-files-sync.cjs"

describe("Launcher Watcher Policy Resolution", () => {
  it("1. installed-manifest antiguo sin entrada 'mods' + directoryPolicies (mods = MODIFICABLE) -> ignora evento (no emit)", () => {
    // 1. installed-manifest antiguo sin entrada 'mods'
    const legacyInstalledFiles = {
      "config/options.txt": {
        officialSha256: "abc",
        policy: "MODIFICABLE",
      },
    }

    // 2. directoryPolicies actuales dicen mods = MODIFICABLE
    const directoryPolicies = [
      { path: "mods", policy: "MODIFICABLE" },
    ]

    // 3. un evento del watcher sobre 'mods' o un archivo dentro de 'mods' NO debe emitir game-file-integrity-changed
    expect(resolveWatcherDecision("mods", directoryPolicies, legacyInstalledFiles)).toBe("IGNORE")
    expect(resolveWatcherDecision("mods/custom.jar", directoryPolicies, legacyInstalledFiles)).toBe("IGNORE")
    expect(resolveWatcherDecision("mods/sub/deep.jar", directoryPolicies, legacyInstalledFiles)).toBe("IGNORE")
  })

  it("2. mods = NO_MODIFICABLE sí debe seguir emitiéndolo", () => {
    const legacyInstalledFiles = {
      "config/options.txt": {
        officialSha256: "abc",
        policy: "MODIFICABLE",
      },
    }

    const directoryPolicies = [
      { path: "mods", policy: "NO_MODIFICABLE" },
    ]

    expect(resolveWatcherDecision("mods", directoryPolicies, legacyInstalledFiles)).toBe("EMIT")
    expect(resolveWatcherDecision("mods/corrupt.jar", directoryPolicies, legacyInstalledFiles)).toBe("EMIT")
  })

  it("3. Exact file policy override takes precedence over directory policy", () => {
    // Directory is MODIFICABLE, but a specific file is NO_MODIFICABLE
    const directoryPolicies = [
      { path: "mods", policy: "MODIFICABLE" },
    ]
    const installedFiles = {
      "mods/locked.jar": {
        officialSha256: "abc",
        policy: "NO_MODIFICABLE",
      },
    }

    expect(resolveWatcherDecision("mods/locked.jar", directoryPolicies, installedFiles)).toBe("EMIT")
    expect(resolveWatcherDecision("mods/custom.jar", directoryPolicies, installedFiles)).toBe("IGNORE")
  })

  it("4. fallback ENFORCED_DIRECTORIES cuando no hay directoryPolicies ni entrada en manifest", () => {
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
