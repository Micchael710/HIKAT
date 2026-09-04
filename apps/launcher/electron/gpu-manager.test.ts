import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import childProcess from "child_process"
import fs from "fs"

describe("HiKAT Windows DirectX GPU Manager Suite", () => {
  let originalPlatform: string
  let execFileSyncSpy: any

  beforeEach(() => {
    originalPlatform = process.platform
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    })
    execFileSyncSpy = vi.spyOn(childProcess, "execFileSync").mockReturnValue("GpuPreference=2;\r\n")
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it("1. enable=true writes .ps1 script with GpuPreference=2; and validates registry read-back", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    const testJavawPath = "C:\\Users\\User\\AppData\\Local\\hikat\\runtime\\java\\21\\bin\\javaw.exe"
    execFileSyncSpy.mockReturnValue("GpuPreference=2;\r\n")

    let writtenScriptContent = ""
    const writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file, content) => {
      writtenScriptContent = content as string
    })

    const result = setJavaGpuPreference(testJavawPath, true)

    expect(result).toBe(true)
    expect(writeFileSyncSpy).toHaveBeenCalled()
    expect(writtenScriptContent).toContain("$registryPath = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences'")
    expect(writtenScriptContent).toContain(testJavawPath)
    expect(writtenScriptContent).toContain("GpuPreference=2;")
    expect(writtenScriptContent).not.toContain("C:\\\\Users")

    expect(execFileSyncSpy).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", expect.stringMatching(/\.ps1$/)],
      expect.objectContaining({ encoding: "utf8", timeout: 5000, windowsHide: true }),
    )
  })

  it("2. enable=false writes .ps1 script with GpuPreference=1; and validates registry read-back", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    const testJavawPath = "C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe"
    execFileSyncSpy.mockReturnValue("GpuPreference=1;\r\n")

    let writtenScriptContent = ""
    const writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file, content) => {
      writtenScriptContent = content as string
    })

    const result = setJavaGpuPreference(testJavawPath, false)

    expect(result).toBe(true)
    expect(writeFileSyncSpy).toHaveBeenCalled()
    expect(writtenScriptContent).toContain(testJavawPath)
    expect(writtenScriptContent).toContain("GpuPreference=1;")

    expect(execFileSyncSpy).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", expect.stringMatching(/\.ps1$/)],
      expect.objectContaining({ encoding: "utf8", timeout: 5000, windowsHide: true }),
    )
  })

  it("3. Returns false and logs warning if read-back value does not match expected preference", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    const testJavawPath = "C:\\path\\javaw.exe"
    // Output differs from expected "GpuPreference=2;"
    execFileSyncSpy.mockReturnValue("GpuPreference=1;\r\n")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = setJavaGpuPreference(testJavawPath, true)

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[GPU Manager] Preference verification failed"),
    )
  })

  it("4. Always removes temporary script file in finally block", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    const testJavawPath = "C:\\path\\javaw.exe"
    execFileSyncSpy.mockReturnValue("GpuPreference=2;\r\n")

    const unlinkSyncSpy = vi.spyOn(fs, "unlinkSync")
    const existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true)

    setJavaGpuPreference(testJavawPath, true)

    expect(existsSyncSpy).toHaveBeenCalled()
    expect(unlinkSyncSpy).toHaveBeenCalledWith(expect.stringMatching(/\.ps1$/))
  })

  it("5. Returns false if platform is not win32 or javawPath is empty", () => {
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
    expect(execFileSyncSpy).not.toHaveBeenCalled()
  })

  it("6. Gracefully catches PowerShell execution errors, cleans up temp file, and returns false", () => {
    const { setJavaGpuPreference } = require("./gpu-manager.cjs")
    execFileSyncSpy.mockImplementation(() => {
      throw new Error("PowerShell script execution failed")
    })

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unlinkSyncSpy = vi.spyOn(fs, "unlinkSync")
    vi.spyOn(fs, "existsSync").mockReturnValue(true)

    const result = setJavaGpuPreference("C:\\path\\javaw.exe", true)

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    expect(unlinkSyncSpy).toHaveBeenCalled()
  })
})
