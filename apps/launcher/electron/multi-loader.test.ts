import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import os from "os"
import child_process from "child_process"

// @ts-expect-error CJS module
import { checkCore, saveCoreState, loadCoreState } from "./minecraft-core.cjs"
// @ts-expect-error CJS module
import { validateSyncPayload } from "./game-operation-manager.cjs"
// @ts-expect-error CJS module
import { GameLauncher } from "./game-launcher.cjs"
// @ts-expect-error CJS module
import { validateJavaBinary, getJavaRuntimeDir, resolveJavaRuntime } from "./java-runtime.cjs"

describe("Launcher Multi-Loader Core & Lifecycle Suite", () => {
  let tempDir: string
  let instanceRoot: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-loader-test-"))
    instanceRoot = path.join(tempDir, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  describe("1. checkCore for each supported mod loader", () => {
    const loaders = [
      { loader: "VANILLA", version: null, profileId: "1.21.1" },
      { loader: "NEOFORGE", version: "21.1.65", profileId: "1.21.1-neoforge-21.1.65" },
      { loader: "FORGE", version: "47.3.0", profileId: "1.20.1-forge-47.3.0" },
      { loader: "FABRIC", version: "0.16.10", profileId: "1.21.1-fabric-0.16.10" },
      { loader: "QUILT", version: "0.27.0", profileId: "1.21.1-quilt-0.27.0" },
    ]

    for (const { loader, version, profileId } of loaders) {
      it(`recognizes healthy ${loader} installation`, async () => {
        const mcVersion = loader === "FORGE" ? "1.20.1" : "1.21.1"
        const versionDir = path.join(instanceRoot, "versions", profileId)
        await fsp.mkdir(versionDir, { recursive: true })
        await fsp.writeFile(
          path.join(versionDir, `${profileId}.json`),
          JSON.stringify({
            id: profileId,
            mainClass: "net.minecraft.client.main.Main",
            libraries: [],
            downloads: {},
          }),
          "utf8",
        )

        await saveCoreState(instanceRoot, {
          schemaVersion: 2,
          minecraftVersion: mcVersion,
          modLoader: loader,
          modLoaderVersion: version,
          javaMajorVersion: loader === "FORGE" ? 17 : 21,
          javaComponent: "java-runtime-delta",
          resolvedVersionId: profileId,
        })

        const state = await loadCoreState(instanceRoot)
        expect(state?.schemaVersion).toBe(2)
        expect(state?.modLoader).toBe(loader)
        expect(state?.resolvedVersionId).toBe(profileId)
        expect(state?.javaMajorVersion).toBe(loader === "FORGE" ? 17 : 21)

        const check = await checkCore({
          instanceRoot,
          minecraftVersion: mcVersion,
          modLoader: loader,
          modLoaderVersion: version || undefined,
        })

        expect(check.installed).toBe(true)
        expect(check.resolvedVersionId).toBe(profileId)
        expect(check.javaMajorVersion).toBe(loader === "FORGE" ? 17 : 21)
      })
    }

    it("returns installed: false if loader type changes on disk", async () => {
      const profileId = "1.21.1-fabric-0.16.10"
      await saveCoreState(instanceRoot, {
        schemaVersion: 2,
        minecraftVersion: "1.21.1",
        modLoader: "FABRIC",
        modLoaderVersion: "0.16.10",
        javaMajorVersion: 21,
        resolvedVersionId: profileId,
      })

      // Check expecting NEOFORGE instead of FABRIC
      const check = await checkCore({
        instanceRoot,
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
      })

      expect(check.installed).toBe(false)
    })
  })

  describe("2. validateSyncPayload generic loader rules", () => {
    const base = {
      instanceRoot: "C:\\mock\\instance",
      modpackVersion: "1.0.0",
      minecraftVersion: "1.21.1",
      clientFiles: [
        {
          path: "mods/example.jar",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          sizeBytes: 1024,
          policy: "NO_MODIFICABLE",
          downloadUrl: "https://example.com/mod.jar",
        },
      ],
    }

    it("accepts VANILLA without modLoaderVersion or neoForgeVersion", () => {
      expect(() =>
        validateSyncPayload({ ...base, modLoader: "VANILLA" }, true),
      ).not.toThrow()
    })

    it("accepts FABRIC with modLoaderVersion", () => {
      expect(() =>
        validateSyncPayload(
          { ...base, modLoader: "FABRIC", modLoaderVersion: "0.16.10" },
          true,
        ),
      ).not.toThrow()
    })

    it("rejects FABRIC with empty modLoaderVersion", () => {
      expect(() =>
        validateSyncPayload(
          { ...base, modLoader: "FABRIC", modLoaderVersion: "" },
          true,
        ),
      ).toThrow(/modLoaderVersion must be a non-empty string/i)
    })

    it("accepts legacy payload with neoForgeVersion", () => {
      expect(() =>
        validateSyncPayload(
          { ...base, neoForgeVersion: "21.1.65" },
          true,
        ),
      ).not.toThrow()
    })
  })

  describe("3. GameLauncher dynamic Java handling", () => {
    it("allows launching VANILLA without requiring loader version, resolving required Java", async () => {
      const mockChecker = vi.fn().mockResolvedValue({
        installed: true,
        resolvedVersionId: "1.21.1",
        javaMajorVersion: 21,
      })
      const mockResolver = vi.fn().mockReturnValue({
        javaPath: "C:\\Java\\javaw.exe",
        cliJavaPath: "C:\\Java\\java.exe",
      })
      const mockValidator = vi.fn().mockReturnValue({ valid: true, majorVersion: 21 })
      const mockLaunch = vi.fn().mockResolvedValue({ pid: 5678, on: vi.fn() })

      const launcher = new GameLauncher(null, {
        instanceRoot,
        readinessChecker: mockChecker,
        javaResolver: mockResolver,
        javaValidator: mockValidator,
        xmclLauncher: mockLaunch,
        versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
      })

      await launcher.launch({
        playerName: "VanillaPlayer",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
      })

      expect(mockChecker).toHaveBeenCalledWith(
        expect.objectContaining({
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
        }),
      )
      expect(mockResolver).toHaveBeenCalledWith(
        instanceRoot,
        expect.objectContaining({
          majorVersion: 21,
        }),
      )
    })
  })

  describe("4. Dynamic Java validation unit tests", () => {
    it("validates Java 8, 17, and 21 binaries according to expected version", async () => {
      const dummyJava = path.join(tempDir, "fake-java.exe")
      await fsp.writeFile(dummyJava, "fake-binary")

      vi.spyOn(child_process, "spawnSync").mockImplementation((_cmd, _args) => {
        return {
          status: 0,
          stderr: 'openjdk version "17.0.12" 2024-07-16',
          stdout: "",
        } as any
      })

      const check17 = validateJavaBinary(dummyJava, 17)
      expect(check17.valid).toBe(true)
      expect(check17.majorVersion).toBe(17)

      const check21 = validateJavaBinary(dummyJava, 21)
      expect(check21.valid).toBe(false)
      expect(check21.error).toContain("Expected Java 21")

      vi.spyOn(child_process, "spawnSync").mockImplementation((_cmd, _args) => {
        return {
          status: 0,
          stderr: 'java version "1.8.0_391"',
          stdout: "",
        } as any
      })

      const check8 = validateJavaBinary(dummyJava, 8)
      expect(check8.valid).toBe(true)
      expect(check8.majorVersion).toBe(8)
    })

    it("resolves dynamic java runtime paths per major version", () => {
      const dir8 = getJavaRuntimeDir("C:\\HiKAT\\game files", 8)
      expect(dir8).toBe(path.join("C:\\HiKAT", "runtime", "java", "8"))

      const dir17 = getJavaRuntimeDir("C:\\HiKAT\\game files", 17)
      expect(dir17).toBe(path.join("C:\\HiKAT", "runtime", "java", "17"))

      const dir21 = getJavaRuntimeDir("C:\\HiKAT\\game files", 21)
      expect(dir21).toBe(path.join("C:\\HiKAT", "runtime", "java", "21"))
    })
  })
})
