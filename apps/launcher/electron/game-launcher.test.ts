import { describe, it, expect, vi } from "vitest"
import { EventEmitter } from "events"
import { GameLauncher, computeHiKatPlayerUuid } from "./game-launcher.cjs"

describe("GameLauncher & computeHiKatPlayerUuid Identity Suite", () => {
  const instanceRoot = "/mock/instance"

  // Expected Java UUID for "hikat:user-123":
  // UUID.nameUUIDFromBytes("hikat:user-123".getBytes(StandardCharsets.UTF_8))
  const EXPECTED_USER_123_UUID = "40da01ce-127c-3125-90e4-a3d18476b080"

  it("1. For fixed userId 'user-123', computeHiKatPlayerUuid matches exact Java UUID.nameUUIDFromBytes", () => {
    const computed = computeHiKatPlayerUuid("user-123")
    expect(computed).toBe(EXPECTED_USER_123_UUID)
  })

  it("1b. Trims surrounding whitespace for userId", () => {
    const computed = computeHiKatPlayerUuid("   user-123   ")
    expect(computed).toBe(EXPECTED_USER_123_UUID)
  })

  it("1c. computeHiKatPlayerUuid throws on null, undefined, or blank userId", () => {
    expect(() => computeHiKatPlayerUuid(null as any)).toThrow(/cannot be null or blank/i)
    expect(() => computeHiKatPlayerUuid(undefined as any)).toThrow(/cannot be null or blank/i)
    expect(() => computeHiKatPlayerUuid("")).toThrow(/cannot be null or blank/i)
    expect(() => computeHiKatPlayerUuid("   ")).toThrow(/cannot be null or blank/i)
  })

  it("2. launch({ playerName: 'vBrayan06', playerId: 'user-123' }) passes exact permanent UUID and playerName to XMCL", async () => {
    const mockChildProcess = new EventEmitter() as any
    mockChildProcess.pid = 11223
    mockChildProcess.unref = vi.fn()

    const mockXmcl = vi.fn().mockResolvedValue(mockChildProcess)

    const launcher = new GameLauncher(null, {
      instanceRoot,
      xmclLauncher: mockXmcl,
      versionParser: vi.fn().mockResolvedValue({ id: "1.21.1-neoforge-21.1.65" }),
      readinessChecker: vi.fn().mockResolvedValue({
        installed: true,
        resolvedVersionId: "1.21.1-neoforge-21.1.65",
        javaMajorVersion: 21,
      }),
      javaResolver: vi.fn().mockReturnValue({ javaPath: "/mock/javaw.exe" }),
      javaValidator: vi.fn().mockReturnValue({ valid: true }),
      processChecker: () => true,
    })

    const result = await launcher.launch({
      playerName: "vBrayan06",
      playerId: "user-123",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
    })

    expect(result.success).toBe(true)
    expect(mockXmcl).toHaveBeenCalledTimes(1)
    expect(mockXmcl).toHaveBeenCalledWith(
      expect.objectContaining({
        gameProfile: {
          name: "vBrayan06",
          id: EXPECTED_USER_123_UUID,
        },
      }),
    )

    // Verify it is NOT the zero UUID fallback
    const passedProfile = mockXmcl.mock.calls[0][0].gameProfile
    expect(passedProfile.id).not.toBe("00000000-0000-0000-0000-000000000000")
  })

  it("3. If playerId is empty, null, or undefined: does NOT launch Minecraft", async () => {
    const mockXmcl = vi.fn()

    const launcher = new GameLauncher(null, {
      instanceRoot,
      xmclLauncher: mockXmcl,
      versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
      readinessChecker: vi.fn().mockResolvedValue({
        installed: true,
        resolvedVersionId: "1.21.1",
        javaMajorVersion: 21,
      }),
      javaResolver: vi.fn().mockReturnValue({ javaPath: "/mock/javaw.exe" }),
      javaValidator: vi.fn().mockReturnValue({ valid: true }),
    })

    const invalidPlayerIds = [null, undefined, "", "   "]

    for (const invalidId of invalidPlayerIds) {
      await expect(
        launcher.launch({
          playerName: "vBrayan06",
          playerId: invalidId as any,
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
        }),
      ).rejects.toThrow(/Missing or empty playerId/i)
      expect(mockXmcl).not.toHaveBeenCalled()
    }
  })

  it("4. If playerName is empty, null, or undefined: does NOT launch Minecraft", async () => {
    const mockXmcl = vi.fn()

    const launcher = new GameLauncher(null, {
      instanceRoot,
      xmclLauncher: mockXmcl,
      versionParser: vi.fn().mockResolvedValue({ id: "1.21.1" }),
      readinessChecker: vi.fn().mockResolvedValue({
        installed: true,
        resolvedVersionId: "1.21.1",
        javaMajorVersion: 21,
      }),
      javaResolver: vi.fn().mockReturnValue({ javaPath: "/mock/javaw.exe" }),
      javaValidator: vi.fn().mockReturnValue({ valid: true }),
    })

    const invalidPlayerNames = [null, undefined, "", "   "]

    for (const invalidName of invalidPlayerNames) {
      await expect(
        launcher.launch({
          playerName: invalidName as any,
          playerId: "user-123",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
        }),
      ).rejects.toThrow(/Missing or empty playerName/i)
      expect(mockXmcl).not.toHaveBeenCalled()
    }
  })
})
