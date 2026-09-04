import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import childProcess from "child_process"

describe("HiKAT Windows DirectX GPU Manager Suite", () => {
  let originalPlatform: string
  let execSyncSpy: any

  beforeEach(() => {
    originalPlatform = process.platform
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    })
    execSyncSpy = vi.spyOn(childProcess, "execSync").mockReturnValue(Buffer.from(""))
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it("1. enable=true writes exactly GpuPreference=2; and uses exact normalized javaw.exe path without double backslashes", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    const testJavawPath = "C:\\Users\\User\\AppData\\Local\\hikat\\runtime\\java\\bin\\javaw.exe"

    const result = setJavaGpuPreference(testJavawPath, true)

    expect(result).toBe(true)
    expect(execSyncSpy).toHaveBeenCalledTimes(1)

    const executedCommand = execSyncSpy.mock.calls[0][0] as string

    // Must set GpuPreference=2; for high-performance dedicated GPU
    expect(executedCommand).toContain("GpuPreference=2;")
    // Must use exact path with single backslashes in PowerShell script
    expect(executedCommand).toContain(testJavawPath)
    // Must NOT contain double backslashes
    expect(executedCommand).not.toContain("C:\\\\Users\\\\User")
  })

  it("2. enable=false writes exactly GpuPreference=1; and uses exact normalized javaw.exe path", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    const testJavawPath = "C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe"

    const result = setJavaGpuPreference(testJavawPath, false)

    expect(result).toBe(true)
    expect(execSyncSpy).toHaveBeenCalledTimes(1)

    const executedCommand = execSyncSpy.mock.calls[0][0] as string

    // Must set GpuPreference=1; for power saving / integrated GPU
    expect(executedCommand).toContain("GpuPreference=1;")
    // Must use exact path
    expect(executedCommand).toContain(testJavawPath)
    expect(executedCommand).not.toContain("C:\\\\Program Files")
  })

  it("3. Returns false if platform is not win32 or javawPath is empty", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")

    // Empty path
    expect(setJavaGpuPreference("", true)).toBe(false)
    expect(setJavaGpuPreference(null, true)).toBe(false)

    // Non-windows platform
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    })
    expect(setJavaGpuPreference("C:\\path\\javaw.exe", true)).toBe(false)
    expect(execSyncSpy).not.toHaveBeenCalled()
  })

  it("4. Gracefully catches exceptions and returns false on PowerShell error", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    execSyncSpy.mockImplementation(() => {
      throw new Error("PowerShell access denied")
    })

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = setJavaGpuPreference("C:\\path\\javaw.exe", true)

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
  })
})
