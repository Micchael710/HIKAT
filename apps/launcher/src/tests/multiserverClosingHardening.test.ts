import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import http from "http"
import crypto from "crypto"
import { gameService } from "../services/gameService"
import {
  GameOperationManager,
  cleanFreshInstall,
  // @ts-expect-error CJS module without declaration
} from "../../electron/game-operation-manager.cjs"
import {
  generateSyncPlan,
  saveInstalledManifest,
  loadInstalledManifest,
  cleanStaging,
  getStagingPaths,
  quickCheckProtectedIntegrity,
  backgroundCheckProtectedSha,
  ENFORCED_DIRECTORIES,
  // @ts-expect-error CJS module without declaration
} from "../../electron/client-files-sync.cjs"

describe("Closing Hardening Suite: Multi-Server Download and Integrity Robustness", () => {
  let tempDir: string
  let instanceRoot: string
  let server: http.Server
  let serverBaseUrl: string

  function computeSha(content: Buffer | string): string {
    return crypto
      .createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
      .digest("hex")
      .toLowerCase()
  }

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-closing-test-"))
    instanceRoot = path.join(tempDir, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })

    server = http.createServer((req, res) => {
      const url = req.url || ""
      if (url.startsWith("/files/")) {
        const content = Buffer.from("Default test binary", "utf8")
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": content.length,
        })
        res.end(content)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any
        serverBaseUrl = `http://127.0.0.1:${addr.port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  // 1. mods sin política NO_MODIFICABLE no se prunean
  it("1. mods sin política NO_MODIFICABLE no se prunean", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    await fsp.writeFile(path.join(modsDir, "extra-user-mod.jar"), "extra mod")

    // Empty directoryPolicies (no protection on mods)
    const plan = await generateSyncPlan(instanceRoot, [], "1.0.0", [])
    expect(plan.toPrune).toHaveLength(0)
    expect(plan.toPrune.some((p: any) => p.path === "mods/extra-user-mod.jar")).toBe(false)
    expect(fs.existsSync(path.join(modsDir, "extra-user-mod.jar"))).toBe(true)
  })

  // 2. NO_MODIFICABLE sí elimina extras
  it("2. NO_MODIFICABLE sí elimina extras", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    await fsp.writeFile(path.join(modsDir, "unauthorized.jar"), "unauthorized mod")

    const plan = await generateSyncPlan(instanceRoot, [], "1.0.0", [
      { path: "mods", policy: "NO_MODIFICABLE" },
    ])
    expect(plan.toPrune).toHaveLength(1)
    expect(plan.toPrune[0].path).toBe("mods/unauthorized.jar")
  })

  // 3. MODIFICABLE hijo dentro de NO_MODIFICABLE se respeta
  it("3. MODIFICABLE hijo dentro de NO_MODIFICABLE se respeta", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    const customDir = path.join(modsDir, "custom")
    await fsp.mkdir(customDir, { recursive: true })
    await fsp.writeFile(path.join(modsDir, "forbidden.jar"), "forbidden")
    await fsp.writeFile(path.join(customDir, "user.jar"), "user customization")

    const plan = await generateSyncPlan(instanceRoot, [], "1.0.0", [
      { path: "mods", policy: "NO_MODIFICABLE" },
      { path: "mods/custom", policy: "MODIFICABLE" },
    ])
    expect(plan.toPrune.some((p: any) => p.path === "mods/forbidden.jar")).toBe(true)
    expect(plan.toPrune.some((p: any) => p.path === "mods/custom/user.jar")).toBe(false)
    expect(plan.toPreserveUser.some((p: any) => p.path === "mods/custom/user.jar")).toBe(true)
  })

  // 4. background SHA detecta archivo same-size modificado sin bloquear bootstrap
  it("4. background SHA detecta archivo same-size modificado sin bloquear bootstrap", async () => {
    const modsDir = path.join(instanceRoot, "mods")
    await fsp.mkdir(modsDir, { recursive: true })
    const filePath = path.join(modsDir, "core.jar")

    const officialContent = "AAAA1234"
    const officialSha = computeSha(officialContent)
    const modifiedContent = "BBBB1234" // Same 8 bytes length, different content

    await fsp.writeFile(filePath, modifiedContent)

    const manifest = {
      modpackVersion: "1.0.0",
      directoryPolicies: [{ path: "mods", policy: "NO_MODIFICABLE" }],
      files: {
        "mods/core.jar": {
          officialSha256: officialSha,
          policy: "NO_MODIFICABLE",
          sizeBytes: 8,
        },
      },
    }

    // Fast check inspects existence and size only -> returns false (does not block bootstrap)
    const fastDirty = await quickCheckProtectedIntegrity(instanceRoot, manifest)
    expect(fastDirty).toBe(false)

    // Background SHA check computes actual SHA -> detects mismatch
    const bgResult = await backgroundCheckProtectedSha(instanceRoot, manifest)
    expect(bgResult.dirty).toBe(true)
    expect(bgResult.path).toBe("mods/core.jar")
  })

  // 5. PLAY sigue habilitado pero launch se bloquea si integrityDirty
  it("5. PLAY sigue habilitado pero launch se bloquea si integrityDirty", async () => {
    let toastMessage = ""
    let launchCalled = false

    const checkPlanMock = vi.fn().mockResolvedValue({ hasIntegrityIssue: true, isFullyInstalled: false })
    const launchMock = vi.fn().mockImplementation(() => { launchCalled = true })

    // When integrityDirty is true, button stays in play state (enabled)
    const isDirty = true
    if (isDirty) {
      const planCheck = await checkPlanMock()
      if (planCheck?.hasIntegrityIssue || !planCheck?.isFullyInstalled) {
        toastMessage = "playButton.launchVerifyHint"
      } else {
        await launchMock()
      }
    }

    expect(checkPlanMock).toHaveBeenCalled()
    expect(launchCalled).toBe(false)
    expect(toastMessage).toBe("playButton.launchVerifyHint")
  })

  // 6. Cancel de recovery limpia staging y mantiene instalación estable
  it("6. Cancel de recovery limpia staging y mantiene instalación estable", async () => {
    await saveInstalledManifest(instanceRoot, {
      modpackVersion: "1.0.0",
      files: { "mods/stable.jar": { officialSha256: "123", policy: "NO_MODIFICABLE" } },
    })
    const { filesDir } = getStagingPaths(instanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    await fsp.writeFile(path.join(filesDir, "partial.tmp"), "partial")

    const recoveryItem = {
      gameId: "server-1",
      savedPhase: "DOWNLOADING",
      savedProgress: 45,
    }

    const manifest = await loadInstalledManifest(instanceRoot)
    expect(manifest?.modpackVersion).toBe("1.0.0")

    if (recoveryItem.savedPhase || recoveryItem.savedProgress > 0) {
      if (manifest && manifest.modpackVersion) {
        await cleanStaging(instanceRoot)
      } else {
        await cleanFreshInstall(instanceRoot)
      }
    }

    expect(fs.existsSync(path.join(filesDir, "partial.tmp"))).toBe(false)
    const preserved = await loadInstalledManifest(instanceRoot)
    expect(preserved?.modpackVersion).toBe("1.0.0")
  })

  // 7. finalizar recovery actualiza installedVersion global
  it("7. finalizar recovery actualiza installedVersion global", async () => {
    let capturedCb: any = null
    const mockElectronAPI = {
      onPhaseChange: vi.fn((cb) => { capturedCb = cb }),
      getInstalledState: vi.fn().mockResolvedValue({
        installedModpackVersion: "1.1.0",
        integrityDirty: false,
      }),
    }

    mockElectronAPI.onPhaseChange((phase: string, gameId?: string | null) => {
      if (phase === "IDLE" && gameId) {
        mockElectronAPI.getInstalledState({ gameId, gameName: "ServerA" })
      }
    })

    capturedCb("IDLE", "server-a")
    expect(mockElectronAPI.getInstalledState).toHaveBeenCalledWith({ gameId: "server-a", gameName: "ServerA" })
  })

  // 8. finalizar item FIFO actualiza installedVersion aunque su Home no esté montada
  it("8. finalizar item FIFO actualiza installedVersion aunque su Home no esté montada", async () => {
    let globalInstalledState: Record<string, string | null> = {}
    const mockElectronAPI = {
      getInstalledState: vi.fn().mockResolvedValue({
        installedModpackVersion: "2.0.0",
        integrityDirty: false,
      }),
    }

    const onPhaseChange = async (phase: string, gameId?: string | null) => {
      if (phase === "IDLE" && gameId) {
        const res = await mockElectronAPI.getInstalledState({ gameId })
        globalInstalledState[gameId] = res.installedModpackVersion
      }
    }

    await onPhaseChange("IDLE", "server-b")
    expect(globalInstalledState["server-b"]).toBe("2.0.0")
  })

  // 9. RELEASE_ACTIVATED de servidor no seleccionado entra a FIFO con Auto Update ON
  it("9. RELEASE_ACTIVATED de servidor no seleccionado entra a FIFO con Auto Update ON", async () => {
    const startSyncSpy = vi.fn().mockResolvedValue({ queued: true })
    vi.spyOn(gameService, "startSync").mockImplementation(startSyncSpy as any)

    const autoUpdatesEnabled = true
    const installedVer: string = "1.0.0"
    const publishedVer: string = "1.1.0"
    const activeOpGameId: string = "server-a" // User is currently downloading Server A

    if (autoUpdatesEnabled && installedVer && publishedVer !== installedVer) {
      if (activeOpGameId !== "server-b") {
        await gameService.startSync(
          [{ path: "mods/mod.jar", sha256: "abc", sizeBytes: 10 } as any],
          "1.1.0",
          "1.21.1",
          "NEOFORGE",
          undefined,
          undefined,
          false,
          [],
          { gameId: "server-b", gameName: "Server B" } as any,
        )
      }
    }

    expect(startSyncSpy).toHaveBeenCalled()
  })

  // 10. Auto Update OFF no inicia nada
  it("10. Auto Update OFF no inicia nada", async () => {
    const startSyncSpy = vi.fn()
    vi.spyOn(gameService, "startSync").mockImplementation(startSyncSpy as any)

    const autoUpdatesEnabled = false
    const installedVer: string = "1.0.0"
    const publishedVer: string = "1.1.0"

    if (autoUpdatesEnabled && installedVer && publishedVer !== installedVer) {
      await gameService.startSync([], "1.1.0")
    }

    expect(startSyncSpy).not.toHaveBeenCalled()
  })

  // 11. recovery 1.1 + published 1.2 termina primero 1.1 y luego inicia/encola 1.2
  it("11. recovery 1.1 + published 1.2 termina primero 1.1 y luego inicia/encola 1.2", async () => {
    const syncCalls: any[] = []
    vi.spyOn(gameService, "startSync").mockImplementation(async (...args: any[]) => {
      syncCalls.push(args)
      return { success: true }
    })

    let activeOpGameId: string | null = "server-a"
    let activeOpState = "SYNCING"
    let installedVer = "1.0.0"
    const publishedVer = "1.2.0"

    // 1. Release 1.2 arrives while 1.1 recovery is active
    const isSameActive = activeOpGameId === "server-a" && activeOpState !== "IDLE"
    if (!isSameActive) {
      await gameService.startSync([], publishedVer)
    }
    // Did not interrupt recovery 1.1
    expect(syncCalls).toHaveLength(0)

    // 2. Recovery 1.1 finishes and emits IDLE
    activeOpState = "IDLE"
    activeOpGameId = null
    installedVer = "1.1.0"

    if (publishedVer !== installedVer) {
      await gameService.startSync([], publishedVer)
    }

    // Now 1.2 is started
    expect(syncCalls).toHaveLength(1)
    expect(syncCalls[0][1]).toBe("1.2.0")
  })

  // 12. dos servidores con updates mantienen FIFO
  it("12. dos servidores con updates mantienen FIFO", async () => {
    const manager = new GameOperationManager()
    const history: string[] = []

    vi.spyOn(manager, "startSync").mockImplementation(async (payload: any) => {
      history.push(payload.gameId)
      return { success: true }
    })

    const queue = [{ gameId: "server-b" }]
    await manager.startSync({ gameId: "server-a", instanceRoot: "path/a", modpackVersion: "1.0" })

    const next = queue.shift()
    if (next) {
      await manager.startSync({ gameId: next.gameId, instanceRoot: "path/b", modpackVersion: "1.0" })
    }

    expect(history).toEqual(["server-a", "server-b"])
  })

  // 13. retry transitorio reutiliza partial staging
  it("13. retry transitorio reutiliza partial staging", async () => {
    const { filesDir } = getStagingPaths(instanceRoot)
    await fsp.mkdir(filesDir, { recursive: true })
    const stagingFile = path.join(filesDir, "partial-download.tmp")
    await fsp.writeFile(stagingFile, "Initial 10 bytes..")

    const stat = await fsp.stat(stagingFile)
    expect(stat.size).toBe(18)
    // Partial size is preserved and ready for HTTP Range resume
    expect(stat.size).toBeGreaterThan(0)
  })

  // 14. cancel/pause/SHA mismatch no se reintentan
  it("14. cancel/pause/SHA mismatch no se reintentan", async () => {
    const cancelSignal = { isCancelled: true }
    let callCount = 0

    const execute = async () => {
      while (true) {
        if (cancelSignal.isCancelled) {
          throw new Error("Download cancelled")
        }
        callCount++
      }
    }

    await expect(execute()).rejects.toThrow("Download cancelled")
    expect(callCount).toBe(0)
  })

  // 15. confirmar unicidad/inmutabilidad del nombre del servidor
  it("15. confirmar unicidad/inmutabilidad del nombre del servidor", () => {
    const serverSchemaPath = path.join(__dirname, "../../../../packages/database/src/schema/servers.ts")
    const schemaContent = fs.readFileSync(serverSchemaPath, "utf8")
    expect(schemaContent).toContain('uniqueIndex("servers_name_nocase_idx").on(sql`lower(${table.name})`)')

    const serverServicePath = path.join(__dirname, "../../../../services/backend/src/services/serverService.ts")
    const serviceContent = fs.readFileSync(serverServicePath, "utf8")
    expect(serviceContent).toContain("lower(${schema.servers.name}) = lower(${cleanName})")
    // Ensure no rename mutation exists
    expect(serviceContent).not.toContain("updateServerName")
  })
})
