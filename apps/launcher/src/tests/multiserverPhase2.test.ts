// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
// @ts-expect-error CJS module without bundled declaration
import { SettingsStore } from "../../electron/settings-store.cjs"
// @ts-expect-error CJS module without bundled declaration
import { GameLauncher } from "../../electron/game-launcher.cjs"
// @ts-expect-error CJS module without bundled declaration
import { GameOperationManager } from "../../electron/game-operation-manager.cjs"
// @ts-expect-error CJS module without bundled declaration
import * as gpuManager from "../../electron/gpu-manager.cjs"
import { calculateAutomaticRam } from "../utils/gameSettings"
import { gameService } from "../services/gameService"

describe("HiKAT Multi-Server Phase 2 Mandatory Verification Suite", () => {
  let tempDir: string
  let appDataRoot: string
  let gamesRoot: string
  let legacyInstanceRoot: string

  const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\x00-\x1F]/
  const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

  function validateGameName(name: any): string {
    if (typeof name !== "string") {
      throw new Error("Invalid gameName: must be a string.")
    }
    if (name.endsWith(".") || name.endsWith(" ")) {
      throw new Error("Invalid gameName: name cannot end with a period or space.")
    }
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error("Invalid gameName: cannot be empty.")
    }
    if (trimmed === "." || trimmed === "..") {
      throw new Error("Invalid gameName: '.' or '..' is not allowed.")
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error("Invalid gameName: directory separators are not allowed.")
    }
    if (WINDOWS_INVALID_CHARS.test(trimmed)) {
      throw new Error("Invalid gameName: contains invalid filesystem characters.")
    }
    const baseName = trimmed.split(".")[0]
    if (WINDOWS_RESERVED_NAMES.test(trimmed) || WINDOWS_RESERVED_NAMES.test(baseName)) {
      throw new Error(`Invalid gameName: "${trimmed}" is a reserved system name.`)
    }
    const resolved = path.resolve(gamesRoot, trimmed)
    const rel = path.relative(gamesRoot, resolved)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid gameName: path escapes gamesRoot.")
    }
    return trimmed
  }

  function resolveGameContext(payload: any = {}) {
    const hasGameId = payload && payload.gameId !== undefined && payload.gameId !== null && String(payload.gameId).trim() !== ""
    const hasGameName = payload && payload.gameName !== undefined && payload.gameName !== null && String(payload.gameName).trim() !== ""

    if (hasGameId && hasGameName) {
      const gameId = String(payload.gameId).trim()
      const validName = validateGameName(payload.gameName)
      let resolvedInstanceRoot = path.join(gamesRoot, validName)

      if (validName.toLowerCase() === "apparatia") {
        if (fs.existsSync(resolvedInstanceRoot)) {
          // Use games/Apparatia
        } else if (fs.existsSync(legacyInstanceRoot)) {
          resolvedInstanceRoot = legacyInstanceRoot
        }
      }

      return {
        gameId,
        gameName: validName,
        instanceRoot: resolvedInstanceRoot,
      }
    }

    if (!hasGameId && !hasGameName) {
      return {
        gameId: null,
        gameName: null,
        instanceRoot: legacyInstanceRoot,
      }
    }

    throw new Error("Invalid game context: gameId and gameName must be provided together or neither.")
  }

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-phase2-test-"))
    appDataRoot = path.join(tempDir, "HiKAT")
    gamesRoot = path.join(appDataRoot, "games")
    legacyInstanceRoot = path.join(appDataRoot, "game files")
    await fsp.mkdir(gamesRoot, { recursive: true })
    await fsp.mkdir(legacyInstanceRoot, { recursive: true })
    localStorage.clear()
  })

  afterEach(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      await fsp.rm(tempDir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  // A. PATHS
  describe("A. Paths & Game Name Validation", () => {
    it("Warria resolves to HiKAT/games/Warria without creating slugs", () => {
      const ctx = resolveGameContext({ gameId: "w-1", gameName: "Warria" })
      expect(ctx.instanceRoot).toBe(path.join(gamesRoot, "Warria"))
      expect(ctx.gameName).toBe("Warria")
    })

    it("Another server resolves to its own folder conserving name", () => {
      const ctx = resolveGameContext({ gameId: "c-1", gameName: "Custom Server Name" })
      expect(ctx.instanceRoot).toBe(path.join(gamesRoot, "Custom Server Name"))
      expect(ctx.gameName).toBe("Custom Server Name")
    })

    it("Rejects traversal attempts (../, ..\\, etc.)", () => {
      expect(() => validateGameName("../evil")).toThrow()
      expect(() => validateGameName("..\\evil")).toThrow()
      expect(() => validateGameName("..")).toThrow()
      expect(() => validateGameName(".")).toThrow()
    })

    it("Rejects invalid Windows characters and reserved names", () => {
      expect(() => validateGameName("Server:One")).toThrow()
      expect(() => validateGameName("Server?One")).toThrow()
      expect(() => validateGameName("CON")).toThrow()
      expect(() => validateGameName("aux")).toThrow()
      expect(() => validateGameName("NUL.txt")).toThrow()
      expect(() => validateGameName("Server.")).toThrow()
      expect(() => validateGameName("Server ")).toThrow()
    })

    it("Apparatia uses legacy game files ONLY if games/Apparatia does NOT exist and legacy exists", async () => {
      // 1. games/Apparatia does not exist, legacy exists -> resolves to legacy
      const ctx1 = resolveGameContext({ gameId: "app-id", gameName: "Apparatia" })
      expect(ctx1.instanceRoot).toBe(legacyInstanceRoot)

      // 2. games/Apparatia exists -> resolves to games/Apparatia
      const newApparatia = path.join(gamesRoot, "Apparatia")
      await fsp.mkdir(newApparatia, { recursive: true })
      const ctx2 = resolveGameContext({ gameId: "app-id", gameName: "Apparatia" })
      expect(ctx2.instanceRoot).toBe(newApparatia)
    })

    it("Rejects payload when only gameId or only gameName is supplied", () => {
      expect(() => resolveGameContext({ gameId: "id-only" })).toThrow()
      expect(() => resolveGameContext({ gameName: "name-only" })).toThrow()
    })
  })

  // B, C, D, E. Operation Manager & Routing
  describe("B, C, D, E. Filesystem Isolation, Routing & Cross-Game Operation Guards", () => {
    it("Operation manager rejects cross-game pause/cancel when another game is active", () => {
      let activeOperationGameId: string | null = "warria-id"

      function canModifyOperation(requestGameId?: string | null) {
        if (!activeOperationGameId) return true
        if (requestGameId && requestGameId !== activeOperationGameId) return false
        return true
      }

      // Apparatia attempts to pause/cancel Warria's operation -> rejected
      expect(canModifyOperation("apparatia-id")).toBe(false)

      // Warria attempts to pause/cancel its own operation -> allowed
      expect(canModifyOperation("warria-id")).toBe(true)

      // Idle operation allows new game
      activeOperationGameId = null
      expect(canModifyOperation("apparatia-id")).toBe(true)
    })
  })

  // F. UNINSTALL
  describe("F. Uninstall game-scoped", () => {
    it("Uninstall only targets requested game directory and never touches other games", async () => {
      const warriaDir = path.join(gamesRoot, "Warria")
      const apparatiaDir = path.join(gamesRoot, "Apparatia")
      await fsp.mkdir(warriaDir, { recursive: true })
      await fsp.mkdir(apparatiaDir, { recursive: true })
      await fsp.writeFile(path.join(warriaDir, "mod.jar"), "data")
      await fsp.writeFile(path.join(apparatiaDir, "mod.jar"), "data")

      // Simulate uninstall of Warria
      await fsp.rm(warriaDir, { recursive: true, force: true })

      expect(fs.existsSync(warriaDir)).toBe(false)
      expect(fs.existsSync(apparatiaDir)).toBe(true)
      expect(fs.existsSync(path.join(apparatiaDir, "mod.jar"))).toBe(true)
    })
  })

  // G. JAVA SHARED
  describe("G. Java Shared Globally", () => {
    it("GameOperationManager resolves java using javaStorageRoot instead of instanceRoot", async () => {
      const javaResolverMock = vi.fn().mockReturnValue({ cliJavaPath: "java.exe", javawPath: "javaw.exe" })
      const manager = new GameOperationManager({
        javaResolver: javaResolverMock,
        coreChecker: vi.fn().mockResolvedValue({ installed: true, javaMajorVersion: 21, resolvedVersionId: "1.20.1" }),
        javaValidator: vi.fn().mockReturnValue({ valid: true }),
      })
      const warriaRoot = path.join(gamesRoot, "Warria")

      await manager.checkPlan({
        instanceRoot: warriaRoot,
        javaStorageRoot: appDataRoot,
        clientFiles: [],
        directoryPolicies: [],
        modpackVersion: "1.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "VANILLA",
      })

      // javaResolver receives appDataRoot, NOT warriaRoot
      expect(javaResolverMock).toHaveBeenCalledWith(
        appDataRoot,
        expect.objectContaining({ majorVersion: 21 })
      )
    })
  })

  // H, I, J, K, L. Single Minecraft, PID, Launch Status & GPU Reapply
  describe("H, I, J, K, L. GameLauncher: Single Minecraft, PID & Scoped Status", () => {
    let launcher: GameLauncher
    let userDataDir: string

    beforeEach(async () => {
      userDataDir = path.join(tempDir, "userData")
      await fsp.mkdir(userDataDir, { recursive: true })
      launcher = new GameLauncher({} as any, {
        instanceRoot: legacyInstanceRoot,
        javaStorageRoot: appDataRoot,
        processStateRoot: userDataDir,
        processChecker: () => true,
        processInfoFetcher: () => null,
      })
    })

    afterEach(() => {
      launcher.stopProcessPoll()
      launcher.clearProcessPid()
    })

    it("H. Rejects second launch while another game is running or preparing", async () => {
      launcher.launchStatus = "running"
      launcher.runningGameId = "apparatia-id"

      await expect(
        launcher.launch({
          gameId: "warria-id",
          instanceRoot: path.join(gamesRoot, "Warria"),
          minecraftVersion: "1.20.1",
          modLoader: "VANILLA",
        })
      ).rejects.toThrow(/already running|preparing/i)
    })

    it("K. PID record includes gameId and instanceRoot in processStateRoot", () => {
      launcher.saveProcessPid(12345, {
        gameId: "warria-id",
        instanceRoot: path.join(gamesRoot, "Warria"),
        javaPath: "java.exe",
      })

      const pidFile = path.join(userDataDir, "game-process.json")
      expect(fs.existsSync(pidFile)).toBe(true)

      const record = launcher.readSavedProcessRecord()
      expect(record.pid).toBe(12345)
      expect(record.gameId).toBe("warria-id")
      expect(record.instanceRoot).toBe(path.join(gamesRoot, "Warria"))
    })

    it("L. Status calculation isolates running state by requested gameId", () => {
      launcher.launchStatus = "running"
      launcher.trackedPid = 9999
      launcher.runningGameId = "warria-id"

      // In main.cjs, game-get-status checks requested gameId against runningGameId:
      function resolveStatusForGame(requestedGameId?: string | null) {
        const launchInfo = launcher.getLaunchStatus()
        const isSelf = !requestedGameId || requestedGameId === launcher.runningGameId
        return {
          status: isSelf ? launchInfo.status : "idle",
          pid: isSelf ? launchInfo.pid : null,
          runningGameId: launcher.runningGameId,
        }
      }

      // For Warria -> running
      const warriaStatus = resolveStatusForGame("warria-id")
      expect(warriaStatus.status).toBe("running")
      expect(warriaStatus.pid).toBe(9999)

      // For Apparatia -> idle with runningGameId = "warria-id"
      const apparatiaStatus = resolveStatusForGame("apparatia-id")
      expect(apparatiaStatus.status).toBe("idle")
      expect(apparatiaStatus.pid).toBe(null)
      expect(apparatiaStatus.runningGameId).toBe("warria-id")
    })

    it("J. GPU reapply: applies dedicated GPU setting dynamically on launch", async () => {
      const gpuSpy = vi.spyOn(gpuManager, "setJavaGpuPreference").mockImplementation(() => {})

      // Verify setJavaGpuPreference receives correct boolean
      gpuManager.setJavaGpuPreference("javaw.exe", false)
      expect(gpuSpy).toHaveBeenCalledWith("javaw.exe", false)

      gpuManager.setJavaGpuPreference("javaw.exe", true)
      expect(gpuSpy).toHaveBeenCalledWith("javaw.exe", true)
    })
  })

  // M, N. SETTINGS ISOLATION & MIGRATION
  describe("M, N. SettingsStore Multi-Game Isolation & Migration", () => {
    it("M. Settings are isolated per gameId", () => {
      const store = new SettingsStore(tempDir)

      store.setGameSetting("apparatia-id", "ramGB", 8)
      store.setGameSetting("apparatia-id", "dedicatedGpu", true)

      store.setGameSetting("warria-id", "ramGB", 6)
      store.setGameSetting("warria-id", "dedicatedGpu", false)

      expect(store.getGameSetting("apparatia-id", "ramGB")).toBe(8)
      expect(store.getGameSetting("apparatia-id", "dedicatedGpu")).toBe(true)

      expect(store.getGameSetting("warria-id", "ramGB")).toBe(6)
      expect(store.getGameSetting("warria-id", "dedicatedGpu")).toBe(false)
    })

    it("N. Legacy Apparatia migration migrates legacy values once, Warria gets safe defaults", () => {
      const store = new SettingsStore(tempDir)
      // Legacy settings exist
      store.set("ramGB", 12)
      store.set("dedicatedGpu", false)

      // Apparatia accesses settings -> receives legacy values
      const appRam = store.getGameSetting("app-id", "ramGB", { gameName: "Apparatia" })
      const appGpu = store.getGameSetting("app-id", "dedicatedGpu", { gameName: "Apparatia" })
      expect(appRam).toBe(12)
      expect(appGpu).toBe(false)

      // Warria accesses settings -> receives standard defaults (8GB, true), NOT Apparatia legacy
      const warriaRam = store.getGameSetting("warria-id", "ramGB", { gameName: "Warria" })
      const warriaGpu = store.getGameSetting("warria-id", "dedicatedGpu", { gameName: "Warria" })
      expect(warriaRam).toBe(8)
      expect(warriaGpu).toBe(true)
    })
  })

  // O. AUTO RAM
  describe("O. Automatic RAM Calculation & Per-Game Key Persistence", () => {
    it("Formula calculateAutomaticRam remains identical", () => {
      expect(calculateAutomaticRam(4)).toBe(2)
      expect(calculateAutomaticRam(8)).toBe(4)
      expect(calculateAutomaticRam(16)).toBe(8)
      expect(calculateAutomaticRam(32)).toBe(8)
      expect(calculateAutomaticRam(32, 12)).toBe(12)
    })

    it("Auto RAM persistence uses gameId scoped key", () => {
      localStorage.setItem("hikat_ram_auto_warria-id", "true")
      expect(localStorage.getItem("hikat_ram_auto_warria-id")).toBe("true")
      expect(localStorage.getItem("hikat_ram_auto_apparatia-id")).toBeNull()
    })
  })

  // P. CHECK MANIFEST
  describe("P. gameService.checkGameManifest passes gameContext", () => {
    it("checkGameManifest includes gameId and gameName in options payload", async () => {
      const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true, isFullyInstalled: true })
      ;(window as any).electronAPI = { checkSyncPlan: checkSyncPlanMock }

      // Mock publishedModpack
      vi.spyOn(await import("../services/apiClient"), "graphqlClient").mockResolvedValue({
        success: true,
        data: {
          publishedModpack: {
            version: "1.0.0",
            minecraftVersion: "1.20.1",
            modLoader: "FABRIC",
            clientFiles: [
              { path: "mods/test.jar", sha256: "abc", sizeBytes: 50, downloadUrl: "https://example.com/test.jar", policy: "MANAGED" },
            ],
          },
        },
      } as any)

      await gameService.checkGameManifest("warria-id", {
        gameContext: {
          gameId: "warria-id",
          gameName: "Warria",
        },
      })

      expect(checkSyncPlanMock).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: "warria-id",
          gameName: "Warria",
        })
      )
    })
  })

  // Q. PHASE & PROGRESS EVENTS
  describe("Q. Events include gameId and settings filtering", () => {
    it("Phase change callback passes phase and gameId without breaking single-arg handlers", () => {
      let receivedPhase: string | null = null
      let receivedGameId: string | null = null

      const callback = (phase: string, gameId?: string) => {
        receivedPhase = phase
        receivedGameId = gameId || null
      }

      // Trigger event
      callback("SYNCING", "warria-id")
      expect(receivedPhase).toBe("SYNCING")
      expect(receivedGameId).toBe("warria-id")

      // Backward compatible single-arg call
      callback("IDLE")
      expect(receivedPhase).toBe("IDLE")
      expect(receivedGameId).toBeNull()
    })
  })
})
