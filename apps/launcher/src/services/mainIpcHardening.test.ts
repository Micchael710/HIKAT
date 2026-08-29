import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fsp from "fs/promises"
import os from "os"

describe("Shard 8E: Electron Main IPC & Concurrency State Suite", () => {
  let currentOperationState: string
  let activeSyncCancelSignal: { isCancelled: boolean; isPaused: boolean } | null
  let instanceRoot: string
  let appDataRoot: string
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-ipc-test-"))
    appDataRoot = path.join(tempDir, "HiKAT")
    instanceRoot = path.join(appDataRoot, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })

    currentOperationState = "IDLE"
    activeSyncCancelSignal = null
  })

  afterEach(async () => {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  // Simulated IPC Handlers mirroring main.cjs logic
  async function handleGameStartSync(payload: any) {
    if (currentOperationState !== "IDLE" && currentOperationState !== "PAUSED") {
      throw new Error(`Cannot start sync: Operation already in progress (${currentOperationState})`)
    }

    const clientFiles = Array.isArray(payload.clientFiles) ? payload.clientFiles : []
    for (const file of clientFiles) {
      if (!file || typeof file.path !== "string" || !file.path.trim()) {
        throw new Error("Invalid payload: clientFiles contains file without valid path.")
      }
      if (typeof file.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(file.sha256.trim())) {
        throw new Error(`Invalid payload: file "${file.path}" has invalid SHA-256 hash.`)
      }
    }

    currentOperationState = "SYNCING"
    activeSyncCancelSignal = { isCancelled: false, isPaused: false }
    return { success: true }
  }

  async function handleGamePauseSync() {
    if (activeSyncCancelSignal) {
      activeSyncCancelSignal.isPaused = true
    }
    currentOperationState = "PAUSED"
    return true
  }

  async function handleGameCancelSync() {
    if (activeSyncCancelSignal) {
      activeSyncCancelSignal.isCancelled = true
    }
    currentOperationState = "IDLE"
    return true
  }

  async function handleGameLaunch() {
    if (
      currentOperationState === "SYNCING" ||
      currentOperationState === "INSTALLING" ||
      currentOperationState === "UNINSTALLING"
    ) {
      throw new Error("Cannot launch Minecraft while game synchronization or installation is in progress.")
    }
    return { success: true, pid: 9999 }
  }

  async function handleGameUninstall() {
    if (currentOperationState === "SYNCING" || currentOperationState === "INSTALLING") {
      throw new Error("Cannot uninstall game while synchronization is active.")
    }
    currentOperationState = "UNINSTALLING"
    try {
      await fsp.rm(instanceRoot, { recursive: true, force: true })
      return { success: true }
    } finally {
      currentOperationState = "IDLE"
    }
  }

  it("1. Blocks second sync while another sync is in progress", async () => {
    await handleGameStartSync({
      clientFiles: [{ path: "mods/m.jar", sha256: "a".repeat(64) }],
    })
    expect(currentOperationState).toBe("SYNCING")

    await expect(
      handleGameStartSync({
        clientFiles: [{ path: "mods/m2.jar", sha256: "b".repeat(64) }],
      }),
    ).rejects.toThrow(/Operation already in progress/i)
  })

  it("2. Blocks game launch while synchronization or installation is active", async () => {
    currentOperationState = "INSTALLING"
    await expect(handleGameLaunch()).rejects.toThrow(
      /Cannot launch Minecraft while game synchronization/i,
    )

    currentOperationState = "SYNCING"
    await expect(handleGameLaunch()).rejects.toThrow(
      /Cannot launch Minecraft while game synchronization/i,
    )
  })

  it("3. Allows game launch when operation state is IDLE", async () => {
    currentOperationState = "IDLE"
    const res = await handleGameLaunch()
    expect(res.success).toBe(true)
    expect(res.pid).toBe(9999)
  })

  it("4. Blocks uninstall while synchronization is active", async () => {
    currentOperationState = "SYNCING"
    await expect(handleGameUninstall()).rejects.toThrow(
      /Cannot uninstall game while synchronization is active/i,
    )
  })

  it("5. Cancel properly resets operation state to IDLE", async () => {
    currentOperationState = "SYNCING"
    activeSyncCancelSignal = { isCancelled: false, isPaused: false }

    await handleGameCancelSync()
    expect(activeSyncCancelSignal.isCancelled).toBe(true)
    expect(currentOperationState).toBe("IDLE")
  })

  it("6. Pause transitions state to PAUSED and allows resuming later", async () => {
    await handleGameStartSync({
      clientFiles: [{ path: "mods/m.jar", sha256: "c".repeat(64) }],
    })
    expect(currentOperationState).toBe("SYNCING")

    await handleGamePauseSync()
    expect(currentOperationState).toBe("PAUSED")
    expect(activeSyncCancelSignal?.isPaused).toBe(true)

    // Resuming from PAUSED is allowed
    const resumeRes = await handleGameStartSync({
      clientFiles: [{ path: "mods/m.jar", sha256: "c".repeat(64) }],
    })
    expect(resumeRes.success).toBe(true)
    expect(currentOperationState).toBe("SYNCING")
  })

  it("7. Strict input payload validation rejects invalid paths or invalid sha256 hashes", async () => {
    await expect(
      handleGameStartSync({
        clientFiles: [{ path: "", sha256: "d".repeat(64) }],
      }),
    ).rejects.toThrow(/without valid path/i)

    await expect(
      handleGameStartSync({
        clientFiles: [{ path: "mods/test.jar", sha256: "invalid-short-hash" }],
      }),
    ).rejects.toThrow(/invalid SHA-256 hash/i)
  })
})
