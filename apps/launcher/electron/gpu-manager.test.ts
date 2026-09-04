import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import childProcess from "child_process"
import fs from "fs"

describe("HiKAT Windows DirectX GPU Manager Suite", () => {
  let originalPlatform: string
  let execFileSyncSpy: any
  let execSyncSpy: any

  beforeEach(() => {
    originalPlatform = process.platform
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    })
    execFileSyncSpy = vi.spyOn(childProcess, "execFileSync").mockReturnValue("GpuPreference=2;\r\n" as any)
    execSyncSpy = vi.spyOn(childProcess, "execSync").mockReturnValue("NVIDIA GeForce RTX 4070" as any)
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    })
    vi.restoreAllMocks()
    // Clean environment variables
    delete process.env.SHIM_MCCOMPAT_DISABLE
    delete process.env.MESA_GLSL_CACHE_DISABLE
    delete process.env.__GL_SHADER_DISK_CACHE
    delete process.env.__GL_THREADED_OPTIMIZATION
    delete process.env.CUDA_VISIBLE_DEVICES
    delete process.env.AMD_VULKAN_ICD
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

    expect(setJavaGpuPreference("", true)).toBe(false)
    expect(setJavaGpuPreference(null, true)).toBe(false)

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

  it("7. detectDedicatedGpu correctly identifies NVIDIA and AMD GPUs", () => {
    const { detectDedicatedGpu } = require("./gpu-manager.cjs")

    execSyncSpy.mockReturnValue("Name\nNVIDIA GeForce RTX 3080")
    expect(detectDedicatedGpu()).toBe("nvidia")

    execSyncSpy.mockReturnValue("Name\nAMD Radeon RX 7900 XTX")
    expect(detectDedicatedGpu()).toBe("amd")

    execSyncSpy.mockReturnValue("Name\nIntel UHD Graphics 630")
    expect(detectDedicatedGpu()).toBeNull()
  })

  it("8. detectDedicatedGpu falls back to PowerShell Get-CimInstance if wmic fails", () => {
    const { detectDedicatedGpu } = require("./gpu-manager.cjs")

    execSyncSpy.mockImplementation(() => {
      throw new Error("wmic not found")
    })
    execFileSyncSpy.mockReturnValue("NVIDIA GeForce GTX 1660 Ti\r\n")

    expect(detectDedicatedGpu()).toBe("nvidia")
    expect(execFileSyncSpy).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-Command", expect.stringContaining("Get-CimInstance Win32_VideoController")]),
      expect.any(Object),
    )
  })

  it("9. applyGpuEnvironment sets correct environment variables for NVIDIA and cleans on disable", () => {
    const { applyGpuEnvironment } = require("./gpu-manager.cjs")

    execSyncSpy.mockReturnValue("NVIDIA GeForce RTX 4080")

    applyGpuEnvironment(true)

    expect(process.env.SHIM_MCCOMPAT_DISABLE).toBe("1")
    expect(process.env.MESA_GLSL_CACHE_DISABLE).toBe("false")
    expect(process.env.__GL_SHADER_DISK_CACHE).toBe("1")
    expect(process.env.__GL_THREADED_OPTIMIZATION).toBe("1")
    expect(process.env.CUDA_VISIBLE_DEVICES).toBe("0")

    applyGpuEnvironment(false)

    expect(process.env.SHIM_MCCOMPAT_DISABLE).toBeUndefined()
    expect(process.env.MESA_GLSL_CACHE_DISABLE).toBeUndefined()
    expect(process.env.__GL_SHADER_DISK_CACHE).toBeUndefined()
    expect(process.env.__GL_THREADED_OPTIMIZATION).toBeUndefined()
    expect(process.env.CUDA_VISIBLE_DEVICES).toBeUndefined()
  })

  it("10. applyGpuEnvironment sets correct environment variables for AMD", () => {
    const { applyGpuEnvironment } = require("./gpu-manager.cjs")

    execSyncSpy.mockReturnValue("AMD Radeon RX 6700 XT")

    applyGpuEnvironment(true)

    expect(process.env.SHIM_MCCOMPAT_DISABLE).toBe("1")
    expect(process.env.MESA_GLSL_CACHE_DISABLE).toBe("false")
    expect(process.env.AMD_VULKAN_ICD).toBe("RADV")
  })

  it("11. getGpuOptimizedJvmArgs returns OS args only when enabled on win32", () => {
    const { getGpuOptimizedJvmArgs } = require("./gpu-manager.cjs")

    expect(getGpuOptimizedJvmArgs(true)).toEqual(["-Dos.name=Windows 10", "-Dos.version=10.0"])
    expect(getGpuOptimizedJvmArgs(false)).toEqual([])

    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    })
    expect(getGpuOptimizedJvmArgs(true)).toEqual([])
  })
})

