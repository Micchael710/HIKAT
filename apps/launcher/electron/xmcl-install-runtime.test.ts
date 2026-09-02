import { describe, it, expect, vi, afterEach } from "vitest"
import { ProgressTrackerMultiple } from "@xmcl/file-transfer"
// @ts-expect-error CJS module
import { createHiKatInstallRuntime } from "./xmcl-install-runtime.cjs"

describe("HiKAT XMCL Install Runtime & ProgressTrackerMultiple Suite", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("1. createHiKatInstallRuntime passes ProgressTrackerMultiple to downloader", async () => {
    let capturedOptions: any = null
    const mockDownloader = vi.fn().mockImplementation(async (options: any) => {
      capturedOptions = options
      return [{ status: "fulfilled", value: undefined }]
    })

    const runtime = createHiKatInstallRuntime({ downloader: mockDownloader })
    await runtime.download([
      { urls: ["https://example.com/file1.jar"], path: "/path/to/file1.jar", size: 1000 },
      { urls: ["https://example.com/file2.jar"], path: "/path/to/file2.jar", size: 2000 },
    ])

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions.tracker).toBeInstanceOf(ProgressTrackerMultiple)
    expect(capturedOptions.tracker.expectedTotal).toBe(3000)
    expect(capturedOptions.options).toHaveLength(2)
  })

  it("2. Maps dynamic tracker progress accurately between progressStart and progressEnd", async () => {
    const progressHistory: number[] = []

    const mockDownloader = vi.fn().mockImplementation(async (options: any) => {
      const tracker = options.tracker

      // 50% transferred
      tracker.trackers.push({ progress: 500, total: 1000 }, { progress: 1000, total: 2000 })

      // Wait a bit for polling
      await new Promise((r) => setTimeout(r, 200))

      // 100% transferred
      tracker.trackers[0] = { progress: 1000, total: 1000 }
      tracker.trackers[1] = { progress: 2000, total: 2000 }

      await new Promise((r) => setTimeout(r, 200))

      return [
        { status: "fulfilled", value: undefined },
        { status: "fulfilled", value: undefined },
      ]
    })

    const runtime = createHiKatInstallRuntime({
      onTransferProgress: (p: number) => progressHistory.push(p),
      progressStart: 40,
      progressEnd: 90,
      downloader: mockDownloader,
    })

    await runtime.download([
      { urls: ["https://example.com/f1.jar"], path: "/dest/f1.jar", size: 1000 },
      { urls: ["https://example.com/f2.jar"], path: "/dest/f2.jar", size: 2000 },
    ])

    expect(progressHistory.length).toBeGreaterThan(0)
    // 50% ratio of (90 - 40) + 40 = 65
    expect(progressHistory).toContain(65)
    // Final completion should reach 90
    expect(progressHistory[progressHistory.length - 1]).toBe(90)
  })

  it("3. Monotonic progress: never decreases even if tracker reports lower value", async () => {
    const progressHistory: number[] = []

    const mockDownloader = vi.fn().mockImplementation(async (options: any) => {
      const tracker = options.tracker
      // First high progress (80%)
      tracker.trackers.push({ progress: 800, total: 1000 })
      await new Promise((r) => setTimeout(r, 180))

      // Fluctuates down to 20%
      tracker.trackers[0] = { progress: 200, total: 1000 }
      await new Promise((r) => setTimeout(r, 180))

      return [{ status: "fulfilled", value: undefined }]
    })

    const runtime = createHiKatInstallRuntime({
      onTransferProgress: (p: number) => progressHistory.push(p),
      progressStart: 40,
      progressEnd: 90,
      downloader: mockDownloader,
    })

    await runtime.download([
      { urls: ["https://example.com/f1.jar"], path: "/dest/f1.jar", size: 1000 },
    ])

    // Verify all emitted numbers are monotonically non-decreasing
    for (let i = 1; i < progressHistory.length; i++) {
      expect(progressHistory[i]).toBeGreaterThanOrEqual(progressHistory[i - 1])
    }
  })

  it("4. Cleans up polling timer on failure and propagates error", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")

    const mockDownloader = vi.fn().mockImplementation(async () => {
      return [{ status: "rejected", reason: new Error("Network timeout") }]
    })

    const runtime = createHiKatInstallRuntime({
      onTransferProgress: () => {},
      progressStart: 40,
      progressEnd: 90,
      downloader: mockDownloader,
    })

    await expect(
      runtime.download([{ urls: ["https://example.com/fail.jar"], path: "/dest/fail.jar", size: 100 }]),
    ).rejects.toThrow(/XMCL download failed/)

    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
