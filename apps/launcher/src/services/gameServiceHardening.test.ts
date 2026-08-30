// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { gameService } from "./gameService"
import * as apiClientModule from "./apiClient"

describe("Shard 8E: Launcher GameService & Filesystem Authority Integration Suite", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("1. Filesystem authority: checkGameManifest invalidates localStorage=true when files are missing", async () => {
    localStorage.setItem("hikat_game_installed", "true")

    // Mock GraphQL response
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          clientFiles: [
            {
              path: "mods/example.jar",
              sha256: "a".repeat(64),
              sizeBytes: 100,
              downloadUrl: "/game/download/1",
              policy: "NO_MODIFICABLE",
            },
          ],
        },
      },
    })

    // Mock Electron checkSyncPlan detecting missing files
    window.electronAPI = {
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 1,
        filesToPrune: 0,
        totalDownloadBytes: 100,
        needsUpdate: true,
        isFullyInstalled: false,
        hasExistingInstall: false,
      }),
    } as any

    const manifest = await gameService.checkGameManifest()
    expect(manifest).not.toBeNull()
    expect(manifest?.installed).toBe(false)
    expect(manifest?.hasUpdate).toBe(true)
    expect(gameService.isGameInstalled()).toBe(false)
    expect(localStorage.getItem("hikat_game_installed")).toBe("false")
  })

  it("2. Filesystem authority: checkGameManifest confirms healthy installation", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          clientFiles: [
            {
              path: "mods/healthy.jar",
              sha256: "b".repeat(64),
              sizeBytes: 200,
              downloadUrl: "/game/download/2",
              policy: "NO_MODIFICABLE",
            },
          ],
        },
      },
    })

    window.electronAPI = {
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 0,
        filesToPrune: 0,
        totalDownloadBytes: 0,
        needsUpdate: false,
        isFullyInstalled: true,
        hasExistingInstall: true,
      }),
    } as any

    const manifest = await gameService.checkGameManifest()
    expect(manifest?.installed).toBe(true)
    expect(manifest?.hasUpdate).toBe(false)
    expect(gameService.isGameInstalled()).toBe(true)
    expect(localStorage.getItem("hikat_game_installed")).toBe("true")
  })

  it("3. Offline mode: healthy cached manifest allows offline playing", async () => {
    const cachedModpack = {
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      clientFiles: [
        {
          path: "mods/cached.jar",
          sha256: "c".repeat(64),
          sizeBytes: 300,
          downloadUrl: "/game/download/3",
          policy: "NO_MODIFICABLE",
        },
      ],
    }
    localStorage.setItem("hikat_game_manifest", JSON.stringify(cachedModpack))

    // GraphQL and REST network fail
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Network offline",
    })
    vi.spyOn(apiClientModule, "apiClient").mockResolvedValue({
      success: false,
      error: "Network offline",
    })

    window.electronAPI = {
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 0,
        filesToPrune: 0,
        totalDownloadBytes: 0,
        needsUpdate: false,
        isFullyInstalled: true,
      }),
    } as any

    const manifest = await gameService.checkGameManifest()
    expect(manifest).not.toBeNull()
    expect(manifest?.version).toBe("1.0.0")
    expect(manifest?.installed).toBe(true)
  })

  it("4. Offline mode: damaged files offline prevents playing without destroying existing files", async () => {
    const cachedModpack = {
      version: "1.0.0",
      clientFiles: [
        {
          path: "mods/damaged.jar",
          sha256: "d".repeat(64),
          sizeBytes: 400,
          policy: "NO_MODIFICABLE",
        },
      ],
    }
    localStorage.setItem("hikat_game_manifest", JSON.stringify(cachedModpack))

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: false,
      error: "Network offline",
    })
    vi.spyOn(apiClientModule, "apiClient").mockResolvedValue({
      success: false,
      error: "Network offline",
    })

    window.electronAPI = {
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 1,
        filesToPrune: 0,
        totalDownloadBytes: 400,
        needsUpdate: true,
        isFullyInstalled: false,
      }),
    } as any

    const manifest = await gameService.checkGameManifest()
    expect(manifest?.installed).toBe(false)
    expect(gameService.isGameInstalled()).toBe(false)
  })

  it("5. uninstallGame invokes Electron backend and clears localStorage caches on success", async () => {
    localStorage.setItem("hikat_game_installed", "true")
    localStorage.setItem("hikat_game_manifest", JSON.stringify({ version: "1.0.0" }))

    const uninstallMock = vi.fn().mockResolvedValue({ success: true })
    window.electronAPI = {
      uninstallGame: uninstallMock,
    } as any

    const success = await gameService.uninstallGame()
    expect(success).toBe(true)
    expect(uninstallMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("hikat_game_installed")).toBeNull()
    expect(localStorage.getItem("hikat_game_manifest")).toBeNull()
  })

  it("6. uninstallGame preserves localStorage and returns false when Electron uninstall fails", async () => {
    localStorage.setItem("hikat_game_installed", "true")
    localStorage.setItem("hikat_game_manifest", JSON.stringify({ version: "1.0.0" }))

    const uninstallMock = vi.fn().mockResolvedValue({ success: false })
    window.electronAPI = {
      uninstallGame: uninstallMock,
    } as any

    const success = await gameService.uninstallGame()
    expect(success).toBe(false)
    expect(uninstallMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("hikat_game_installed")).toBe("true")
    expect(localStorage.getItem("hikat_game_manifest")).not.toBeNull()
  })

  it("7. startSync, pauseSync, cancelSync and launchGame call electronAPI correctly", async () => {
    const startSyncMock = vi.fn().mockResolvedValue({ success: true })
    const pauseSyncMock = vi.fn().mockResolvedValue({ success: true, paused: true })
    const cancelSyncMock = vi.fn().mockResolvedValue({ success: true })
    const launchGameMock = vi.fn().mockResolvedValue({ success: true, pid: 1234 })

    window.electronAPI = {
      startSync: startSyncMock,
      pauseSync: pauseSyncMock,
      cancelSync: cancelSyncMock,
      launchGame: launchGameMock,
    } as any

    await gameService.startSync([], "1.0.0", "1.21.1", "21.1.65")
    expect(startSyncMock).toHaveBeenCalledWith({
      clientFiles: [],
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      apiBaseUrl: "http://127.0.0.1:8787",
      isVerify: undefined,
    })


    const pauseRes = await gameService.pauseSync()
    expect(pauseSyncMock).toHaveBeenCalledTimes(1)
    expect(pauseRes).toEqual({ success: true, paused: true })

    const cancelRes = await gameService.cancelSync()
    expect(cancelSyncMock).toHaveBeenCalledTimes(1)
    expect(cancelRes).toEqual({ success: true })

    await gameService.launchGame({ playerName: "Tester", ramGB: 8 })
    expect(launchGameMock).toHaveBeenCalledWith({ playerName: "Tester", ramGB: 8 })
  })

  it("8. startSync propagates error thrown by Electron backend without setting installed=true", async () => {
    window.electronAPI = {
      startSync: vi.fn().mockRejectedValue(new Error("Invalid payload: clientFiles cannot be empty")),
    } as any

    await expect(gameService.startSync([], "1.0.0")).rejects.toThrow(/clientFiles cannot be empty/i)
    expect(gameService.isGameInstalled()).toBe(false)
  })

  it("9. pauseSync propagates rejection from Electron when in INSTALLING phase", async () => {
    window.electronAPI = {
      pauseSync: vi.fn().mockRejectedValue(new Error("Cannot pause synchronization while installation phase is in progress.")),
    } as any

    await expect(gameService.pauseSync()).rejects.toThrow(/installation phase is in progress/i)
  })

  it("10. cancelSync propagates rejection from Electron when in INSTALLING phase", async () => {

    window.electronAPI = {
      cancelSync: vi.fn().mockRejectedValue(new Error("Cannot cancel synchronization while installation phase is in progress.")),
    } as any

    await expect(gameService.cancelSync()).rejects.toThrow(/installation phase is in progress/i)
  })

  it("11. Shard 8F Compatibility: checkGameManifest respects active release returned by publishedModpack", async () => {

    // When publishedModpack returns active release 1.0.0 (while 1.1.0 is published pending on server)
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          clientFiles: [
            {
              path: "mods/active-v10.jar",
              sha256: "e".repeat(64),
              sizeBytes: 1000,
              downloadUrl: "/game/download/10",
              policy: "NO_MODIFICABLE",
            },
          ],
        },
      },
    })

    window.electronAPI = {
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 0,
        filesToPrune: 0,
        totalDownloadBytes: 0,
        needsUpdate: false,
        isFullyInstalled: true,
        hasExistingInstall: true,
      }),
    } as any

    const manifest = await gameService.checkGameManifest()
    expect(manifest?.version).toBe("1.0.0")
    expect(manifest?.clientFiles[0]?.path).toBe("mods/active-v10.jar")

    // After activation of 1.1.0, publishedModpack delivers 1.1.0
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "1.1.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          clientFiles: [
            {
              path: "mods/active-v11.jar",
              sha256: "f".repeat(64),
              sizeBytes: 1100,
              downloadUrl: "/game/download/11",
              policy: "NO_MODIFICABLE",
            },
          ],
        },
      },
    })

    const activatedManifest = await gameService.checkGameManifest()
    expect(activatedManifest?.version).toBe("1.1.0")
    expect(activatedManifest?.clientFiles[0]?.path).toBe("mods/active-v11.jar")
  })
})

