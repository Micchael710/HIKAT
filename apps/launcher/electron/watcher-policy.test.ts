import { describe, it, expect, vi } from "vitest"

const mockApp = {
  requestSingleInstanceLock: () => true,
  getPath: () => "/tmp/appData",
  setPath: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  on: vi.fn(),
  whenReady: () => new Promise(() => {}),
  quit: vi.fn(),
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings: vi.fn(),
}

const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn(),
}

try {
  const electronPath = require.resolve("electron")
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: mockApp,
      ipcMain: mockIpcMain,
      BrowserWindow: vi.fn(),
      screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
      nativeImage: { createFromPath: () => ({}) },
      shell: { openExternal: vi.fn() },
      Tray: vi.fn(),
      Menu: { buildFromTemplate: vi.fn() },
    },
  } as any
} catch (_) {}

// @ts-expect-error CJS module without declaration
const { resolveWatcherDecision } = require("./main.cjs")

describe("Launcher Watcher Policy Resolution (main.cjs)", () => {
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

    // 4. mods = NO_MODIFICABLE sí debe seguir emitiéndolo
    expect(resolveWatcherDecision("mods", directoryPolicies, legacyInstalledFiles)).toBe("EMIT")
    expect(resolveWatcherDecision("mods/corrupt.jar", directoryPolicies, legacyInstalledFiles)).toBe("EMIT")
  })

  it("3. fallback ENFORCED_DIRECTORIES cuando no hay directoryPolicies ni entrada en manifest", () => {
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
