// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"

const {
  getHiKatRoot,
  getLauncherRoot,
  getGamesRoot,
  getRuntimeRoot,
  getUserDataRoot,
  validateGameName,
  resolveGameContext,
} = require("../../electron/install-paths.cjs")
const { getJavaRuntimeDir } = require("../../electron/java-runtime.cjs")
const { uninstallGame } = require("../../electron/client-files-sync.cjs")

describe("Phase 1: Installation Paths, Multiserver Isolation & Safe Operations Suite", () => {
  let tempSandbox: string
  let customHiKatRoot: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    tempSandbox = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-phase1-"))
    customHiKatRoot = path.join(tempSandbox, "HiKAT")
    process.env.HIKAT_ROOT = customHiKatRoot
    await fsp.mkdir(customHiKatRoot, { recursive: true })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    try {
      await fsp.rm(tempSandbox, { recursive: true, force: true })
    } catch (_) {}
  })

  it("1. Root and directory hierarchy resolves correctly under custom installation root", () => {
    expect(getHiKatRoot()).toBe(path.resolve(customHiKatRoot))
    expect(getLauncherRoot()).toBe(path.join(customHiKatRoot, "Launcher"))
    expect(getGamesRoot()).toBe(path.join(customHiKatRoot, "games"))
    expect(getRuntimeRoot()).toBe(path.join(customHiKatRoot, "runtime"))

    // Private state remains strictly in AppData/HiKAT/launcher
    const userData = getUserDataRoot()
    expect(userData).toContain(path.join("HiKAT", "launcher"))
    expect(userData).not.toContain(tempSandbox)
  })

  it("2. Java runtime resolves to <HiKAT root>/runtime/java/<version> without path duplication", () => {
    const java21Dir = getJavaRuntimeDir(getHiKatRoot(), 21)
    expect(java21Dir).toBe(path.join(customHiKatRoot, "runtime", "java", "21"))

    const java17Dir = getJavaRuntimeDir(getHiKatRoot(), 17)
    expect(java17Dir).toBe(path.join(customHiKatRoot, "runtime", "java", "17"))
  })

  it("3. Multiserver isolation: 3 distinct servers resolve to independent folders under gamesRoot", async () => {
    const ctxA = resolveGameContext({ gameId: "server-a", gameName: "Server Alpha" })
    const ctxB = resolveGameContext({ gameId: "server-b", gameName: "Server Bravo" })
    const ctxC = resolveGameContext({ gameId: "server-c", gameName: "Server Charlie" })

    expect(ctxA.instanceRoot).toBe(path.join(getGamesRoot(), "Server Alpha"))
    expect(ctxB.instanceRoot).toBe(path.join(getGamesRoot(), "Server Bravo"))
    expect(ctxC.instanceRoot).toBe(path.join(getGamesRoot(), "Server Charlie"))

    // Create instances and internal .hikat data
    await fsp.mkdir(path.join(ctxA.instanceRoot, ".hikat", "staging"), { recursive: true })
    await fsp.mkdir(path.join(ctxB.instanceRoot, ".hikat", "staging"), { recursive: true })
    await fsp.mkdir(path.join(ctxC.instanceRoot, ".hikat", "staging"), { recursive: true })

    await fsp.writeFile(path.join(ctxA.instanceRoot, ".hikat", "installed-manifest.json"), '{"server":"A"}', "utf8")
    await fsp.writeFile(path.join(ctxB.instanceRoot, ".hikat", "installed-manifest.json"), '{"server":"B"}', "utf8")
    await fsp.writeFile(path.join(ctxC.instanceRoot, ".hikat", "installed-manifest.json"), '{"server":"C"}', "utf8")

    expect(fs.existsSync(path.join(ctxA.instanceRoot, ".hikat", "installed-manifest.json"))).toBe(true)
    expect(fs.existsSync(path.join(ctxB.instanceRoot, ".hikat", "installed-manifest.json"))).toBe(true)
    expect(fs.existsSync(path.join(ctxC.instanceRoot, ".hikat", "installed-manifest.json"))).toBe(true)

    // Verify content isolation
    const contentA = await fsp.readFile(path.join(ctxA.instanceRoot, ".hikat", "installed-manifest.json"), "utf8")
    const contentB = await fsp.readFile(path.join(ctxB.instanceRoot, ".hikat", "installed-manifest.json"), "utf8")
    expect(JSON.parse(contentA).server).toBe("A")
    expect(JSON.parse(contentB).server).toBe("B")
  })

  it("4. Selective uninstall: removing Server B removes only its directory, leaving A and C intact", async () => {
    const ctxA = resolveGameContext({ gameId: "server-a", gameName: "Server Alpha" })
    const ctxB = resolveGameContext({ gameId: "server-b", gameName: "Server Bravo" })
    const ctxC = resolveGameContext({ gameId: "server-c", gameName: "Server Charlie" })

    await fsp.mkdir(ctxA.instanceRoot, { recursive: true })
    await fsp.mkdir(ctxB.instanceRoot, { recursive: true })
    await fsp.mkdir(ctxC.instanceRoot, { recursive: true })

    await fsp.writeFile(path.join(ctxA.instanceRoot, "mods-a.txt"), "modA", "utf8")
    await fsp.writeFile(path.join(ctxB.instanceRoot, "mods-b.txt"), "modB", "utf8")
    await fsp.writeFile(path.join(ctxC.instanceRoot, "mods-c.txt"), "modC", "utf8")

    // Uninstall Server B
    const result = await uninstallGame(ctxB.instanceRoot, getGamesRoot())
    expect(result).toEqual({ success: true })

    // Server B is gone
    expect(fs.existsSync(ctxB.instanceRoot)).toBe(false)

    // Server A and Server C are preserved intact
    expect(fs.existsSync(ctxA.instanceRoot)).toBe(true)
    expect(fs.existsSync(path.join(ctxA.instanceRoot, "mods-a.txt"))).toBe(true)

    expect(fs.existsSync(ctxC.instanceRoot)).toBe(true)
    expect(fs.existsSync(path.join(ctxC.instanceRoot, "mods-c.txt"))).toBe(true)
  })

  it("5. Security boundary enforcement: uninstallGame rejects targets outside gamesRoot", async () => {
    // Attempt to uninstall the whole HiKAT root
    await expect(uninstallGame(getHiKatRoot(), getGamesRoot())).rejects.toThrow(
      /Security violation: Attempted to uninstall directory outside canonical gamesRoot/
    )

    // Attempt path traversal
    const traversal = path.join(getGamesRoot(), "..", "runtime")
    await expect(uninstallGame(traversal, getGamesRoot())).rejects.toThrow(
      /Security violation: Attempted to uninstall directory outside canonical gamesRoot/
    )
  })
})
