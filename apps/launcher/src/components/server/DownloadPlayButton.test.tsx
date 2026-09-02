// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import DownloadPlayButton, {
  resolveIdleGameButtonState,
  formatDownloadSize,
  manifestTotalBytes,
} from "./DownloadPlayButton"
import { LanguageProvider } from "../../context/LanguageContext"
import { gameService, GameManifest } from "../../services/gameService"

describe("Shard 8E & 8F: DownloadPlayButton Real Component Lifecycle & Canonical State Suite", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
    vi.restoreAllMocks()

    window.electronAPI = {
      onDownloadProgress: vi.fn(() => () => {}),
      onPhaseChange: vi.fn(() => () => {}),
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 1,
        filesToPrune: 0,
        totalDownloadBytes: 100,
        needsUpdate: false,
        isFullyInstalled: false,
        hasExistingInstall: false,
      }),
      startSync: vi.fn().mockResolvedValue({ success: true }),
      pauseSync: vi.fn().mockResolvedValue({ success: true, paused: true }),
      cancelSync: vi.fn().mockResolvedValue({ success: true }),
      launchGame: vi.fn().mockResolvedValue({ success: true }),
      uninstallGame: vi.fn().mockResolvedValue({ success: true }),
    } as any

    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(false)
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: false,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/example.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/example",
          policy: "NO_MODIFICABLE",
        },
      ],
    })
    vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
  })

  afterEach(() => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    localStorage.clear()
    vi.restoreAllMocks()
  })

  async function mountButton() {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton left={0} top={0} theme="dark" />
        </LanguageProvider>,
      )
    })

    // Allow initial useEffect checkGameManifest to flush
    await act(async () => {
      await Promise.resolve()
    })

    const unmount = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    unmountCurrent = unmount

    return { container, unmount }
  }

  /* ─────────────────────────────────────────────────────────────
   * Shard 8F Canonical Download vs Update Tests
   * ───────────────────────────────────────────────────────────── */

  it("Test A — Fresh install (installed: false, hasExistingInstall: false, hasUpdate: true, clientFiles > 0) renders DESCARGAR (DOWNLOAD), not ACTUALIZAR", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/new-mod.jar",
          sha256: "b".repeat(64),
          sizeBytes: 500,
          downloadUrl: "/dl/new-mod",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain("DESCARGAR")
    expect(btn.textContent).not.toContain("ACTUALIZAR")
    expect(btn.textContent).not.toContain("JUGAR")
  })

  it("Test B — Existing outdated install (installed: false, hasExistingInstall: true, hasUpdate: true) renders ACTUALIZAR (UPDATE)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/patch.jar",
          sha256: "c".repeat(64),
          sizeBytes: 200,
          downloadUrl: "/dl/patch",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain("ACTUALIZAR")
  })

  it("Test C — Healthy install (installed: true, hasExistingInstall: true, hasUpdate: false) renders JUGAR (PLAY)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain("JUGAR")
  })

  it("Test D — Fresh install + Cancel returns cleanly to DESCARGAR (DOWNLOAD)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/example.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/example",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "cancelSync").mockResolvedValue({ success: true })

    const { container } = await mountButton()

    // Click Download
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    expect(container.querySelector(".dl-progress-card")).not.toBeNull()

    // Click Cancel
    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    await act(async () => {
      cancelBtn.click()
    })

    // Returns to DESCARGAR, not ACTUALIZAR or JUGAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("DESCARGAR")
    expect(idleBtn.textContent).not.toContain("ACTUALIZAR")
    expect(idleBtn.textContent).not.toContain("JUGAR")
  })

  it("Test D2 — Cancel fresh download when stale manifest existed queries checkGameManifest afresh and returns to DESCARGAR, never JUGAR", async () => {
    let checkCount = 0
    vi.spyOn(gameService, "checkGameManifest").mockImplementation(async () => {
      checkCount++
      return {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: true,
        hasExistingInstall: false,
        totalSizeGB: 10,
        clientFiles: [
          {
            path: "mods/example.jar",
            sha256: "a".repeat(64),
            sizeBytes: 100,
            downloadUrl: "/dl/example",
            policy: "NO_MODIFICABLE",
          },
        ],
      }
    })

    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "cancelSync").mockResolvedValue({ success: true })

    const { container } = await mountButton()

    // Click Download
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    expect(container.querySelector(".dl-progress-card")).not.toBeNull()

    // Click Cancel
    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    await act(async () => {
      cancelBtn.click()
    })

    // checkGameManifest called on mount + after cancel
    expect(checkCount).toBeGreaterThanOrEqual(2)

    // Button strictly returns to DESCARGAR, NEVER JUGAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("DESCARGAR")
    expect(idleBtn.textContent).not.toContain("JUGAR")
  })

  it("Test D3 — Cancelling during active download when startSync rejects with cancellation does NOT show syncError toast", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 1,
      clientFiles: [
        {
          path: "mods/example.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/example",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    let rejectSync: (err: any) => void
    vi.spyOn(gameService, "startSync").mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSync = reject
        }),
    )

    vi.spyOn(gameService, "cancelSync").mockImplementation(async () => {
      // Simulate real Electron backend: cancelSync causes active startSync to reject with cancellation error
      rejectSync(new Error("Operation was cancelled."))
      return { success: true }
    })

    const { container } = await mountButton()

    // Click Download
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    expect(container.querySelector(".dl-progress-card")).not.toBeNull()

    // Click Cancel
    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    await act(async () => {
      cancelBtn.click()
    })

    // Confirm that NO error toast is displayed in the DOM
    const toast = container.querySelector(".play-button-toast")
    expect(toast).toBeNull()

    // Button cleanly in DESCARGAR state
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("DESCARGAR")
  })

  it("Test E — Existing install + Cancel returns to ACTUALIZAR (UPDATE)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.2.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/update.jar",
          sha256: "d".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/update",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "cancelSync").mockResolvedValue({ success: true })

    const { container } = await mountButton()

    // Click Update
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    // Click Cancel
    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    await act(async () => {
      cancelBtn.click()
    })

    // Returns to ACTUALIZAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("ACTUALIZAR")
  })

  it("Test F — Fresh install + sync failure resets to DESCARGAR (DOWNLOAD)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/fresh.jar",
          sha256: "f".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/fresh",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockRejectedValue(new Error("Network connection dropped"))

    const { container } = await mountButton()

    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    // Failed fresh install shows DESCARGAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("DESCARGAR")
  })

  it("Test G — Existing install + sync failure resets to ACTUALIZAR (UPDATE)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true,
      installedModpackVersion: "0.9.0",
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/patch.jar",
          sha256: "g".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/patch",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockRejectedValue(new Error("Network timeout"))

    const { container } = await mountButton()

    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    // Failed update shows ACTUALIZAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("ACTUALIZAR")
  })

  it("Test H — Remounting DownloadPlayButton (e.g. Navigating away and returning to Home) re-checks game manifest", async () => {
    const checkSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [],
    })

    // 1st mount (User on Home)
    const { unmount } = await mountButton()
    expect(checkSpy).toHaveBeenCalledTimes(1)

    // User navigates away from Home (unmounting button)
    unmount()

    // User navigates back to Home (remounting button)
    const { unmount: unmount2 } = await mountButton()
    expect(checkSpy).toHaveBeenCalledTimes(2)

    unmount2()
  })

  /* ─────────────────────────────────────────────────────────────
   * Shard 8E Concurrency & State Machine Tests
   * ───────────────────────────────────────────────────────────── */

  it("Test 1 — Descargar permite Pausar mientras startSync sigue pendiente", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    const pauseSpy = vi
      .spyOn(gameService, "pauseSync")
      .mockResolvedValue({ success: true, paused: true })

    const { container } = await mountButton()

    const dlBtn = container.querySelector("button") as HTMLElement
    expect(dlBtn).not.toBeNull()

    // Click Download
    await act(async () => {
      dlBtn.click()
    })

    // Progress card is rendered and startSync is still pending
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("DESCARGANDO")

    // Click Pause on card while download is running
    await act(async () => {
      card.click()
    })

    // Pause is called immediately because isTransitioning did NOT lock during download
    expect(pauseSpy).toHaveBeenCalledTimes(1)
  })

  it("Test 2 — Descargar permite Cancelar mientras startSync sigue pendiente", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    let resolveCancelSync: any
    const cancelSpy = vi
      .spyOn(gameService, "cancelSync")
      .mockImplementation(
        () => new Promise((resolve) => {
          resolveCancelSync = resolve
        }),
      )

    const { container } = await mountButton()

    // Click Download
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    expect(cancelBtn).not.toBeNull()

    // Click Cancel
    await act(async () => {
      cancelBtn.click()
    })

    expect(cancelSpy).toHaveBeenCalledTimes(1)

    // UI does not reset prematurely while cancelSync is pending
    expect(container.querySelector(".dl-progress-card")).not.toBeNull()

    // Resolve cancel
    await act(async () => {
      resolveCancelSync({ success: true })
    })

    // UI resets cleanly back to download button
    expect(container.querySelector(".dl-progress-card")).toBeNull()
    expect(container.querySelector(".dl-idle-btn")).not.toBeNull()
  })

  it("Test 3 — Pause espera confirmación antes de pasar a paused", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    let resolvePauseSync: any
    const pauseSpy = vi
      .spyOn(gameService, "pauseSync")
      .mockImplementation(
        () => new Promise((resolve) => {
          resolvePauseSync = resolve
        }),
      )

    const { container } = await mountButton()

    // Start download
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement

    // Click Pause
    await act(async () => {
      card.click()
    })

    expect(pauseSpy).toHaveBeenCalledTimes(1)

    // Status has NOT prematurely transitioned to paused while pauseSync is in-flight
    expect(card.textContent).toContain("DESCARGANDO")

    // Confirm pause from Main
    await act(async () => {
      resolvePauseSync({ success: true, paused: true })
    })

    // Now status transitions to paused
    expect(card.textContent).toContain("PAUSADO")
  })

  it("Test 4 — Cancel espera confirmación antes de resetear estado", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    let resolveCancelSync: any
    const cancelSpy = vi
      .spyOn(gameService, "cancelSync")
      .mockImplementation(
        () => new Promise((resolve) => {
          resolveCancelSync = resolve
        }),
      )

    const { container } = await mountButton()

    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement

    await act(async () => {
      cancelBtn.click()
    })

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    // Still in progress card
    expect(container.querySelector(".dl-progress-card")).not.toBeNull()

    // Confirm cancel
    await act(async () => {
      resolveCancelSync({ success: true })
    })

    expect(container.querySelector(".dl-progress-card")).toBeNull()
  })

  it("Test 5 — Reanudar permite volver a Pausar", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "pauseSync").mockResolvedValue({ success: true, paused: true })

    const { container } = await mountButton()

    // Download -> Pause
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    await act(async () => {
      card.click()
    })
    expect(card.textContent).toContain("PAUSADO")

    // Resume from paused
    const pauseSpy = vi.spyOn(gameService, "pauseSync").mockResolvedValue({ success: true, paused: true })
    await act(async () => {
      card.click()
    })
    expect(card.textContent).toContain("DESCARGANDO")

    // Pause again during resumed download
    await act(async () => {
      card.click()
    })
    expect(pauseSpy).toHaveBeenCalledTimes(1)
  })

  it("Test 6 — Reanudar permite Cancelar", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "pauseSync").mockResolvedValue({ success: true, paused: true })
    const cancelSpy = vi.spyOn(gameService, "cancelSync").mockResolvedValue({ success: true })

    const { container } = await mountButton()

    // Download -> Pause
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    await act(async () => {
      card.click()
    })
    expect(card.textContent).toContain("PAUSADO")

    // Resume
    await act(async () => {
      card.click()
    })
    expect(card.textContent).toContain("DESCARGANDO")

    // Cancel during resumed download
    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    await act(async () => {
      cancelBtn.click()
    })
    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })

  it("Test 7 — doble Descargar no crea dos startSync", async () => {
    const startSyncSpy = vi
      .spyOn(gameService, "startSync")
      .mockImplementation(() => new Promise(() => {}))

    const { container } = await mountButton()
    const dlBtn = container.querySelector("button") as HTMLElement

    // Rapid double click on Download
    await act(async () => {
      dlBtn.click()
      dlBtn.click()
    })

    expect(startSyncSpy).toHaveBeenCalledTimes(1)
  })

  it("Test 8 — doble Reanudar no crea dos startSync", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "pauseSync").mockResolvedValue({ success: true, paused: true })

    const { container } = await mountButton()

    // Download -> Pause
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    await act(async () => {
      card.click()
    })
    expect(card.textContent).toContain("PAUSADO")

    const startSyncResumeSpy = vi
      .spyOn(gameService, "startSync")
      .mockImplementation(() => new Promise(() => {}))

    // Rapid double click on Resume
    await act(async () => {
      card.click()
      card.click()
    })

    expect(startSyncResumeSpy).toHaveBeenCalledTimes(1)
  })

  /* ─────────────────────────────────────────────────────────────
   * Realtime WebSocket & Initial "checking" State Tests
   * ───────────────────────────────────────────────────────────── */

  it("Test 9 — Initial render is ALWAYS checking state with BUSCANDO ACTUALIZACIONES and disabled", async () => {
    let resolveCheck: any
    vi.spyOn(gameService, "checkGameManifest").mockImplementation(
      () => new Promise((resolve) => {
        resolveCheck = resolve
      }),
    )

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton left={0} top={0} theme="dark" />
        </LanguageProvider>,
      )
    })

    const btn = container.querySelector("button") as HTMLElement
    expect(btn).not.toBeNull()
    expect(btn.hasAttribute("disabled")).toBe(true)
    expect(btn.textContent).toContain("BUSCANDO...")
    expect(btn.textContent).not.toContain("NO DISPONIBLE")
    expect(btn.textContent).not.toContain("JUGAR")

    // Once checkGameManifest resolves, transitions to resolved state
    await act(async () => {
      resolveCheck({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasExistingInstall: true,
        installedModpackVersion: "1.0.0",
        totalSizeGB: 10,
        clientFiles: [],
      })
    })

    expect(btn.textContent).toContain("JUGAR")
    expect(btn.hasAttribute("disabled")).toBe(false)

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("Test 10 — Realtime RELEASE_ACTIVATED event queries getPublishedModpack (NOT checkGameManifest) and switches to ACTUALIZAR (UPDATE) when installed", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    const checkSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [],
    })

    const getModpackSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      mandatory: true,
      clientFiles: [
        {
          path: "mods/new.jar",
          sha256: "e".repeat(64),
          sizeBytes: 300,
          downloadUrl: "/dl/new",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toContain("JUGAR")

    // Backend activates version 1.1.0 and broadcasts event
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.1.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        mandatory: true,
      })
    })

    // checkGameManifest was called only on initial mount, NOT for release event
    expect(checkSpy).toHaveBeenCalledTimes(1)
    expect(getModpackSpy).toHaveBeenCalledTimes(1)
    expect(btn.textContent).toContain("ACTUALIZAR")
    expect(btn.textContent).not.toContain("JUGAR")
  })

  it("Test 11 — Realtime RELEASE_ACTIVATED with matching version does NOT re-query checkGameManifest or getPublishedModpack", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    const checkSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [],
    })
    const getModpackSpy = vi.spyOn(gameService, "getPublishedModpack")

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toContain("JUGAR")
    expect(checkSpy).toHaveBeenCalledTimes(1)

    // Event with identical version
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        mandatory: true,
      })
    })

    expect(checkSpy).toHaveBeenCalledTimes(1)
    expect(getModpackSpy).not.toHaveBeenCalled()
    expect(btn.textContent).toContain("JUGAR")
  })

  it("Test 11B — Sin juego instalado + nueva release → permanece en DESCARGAR", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    const checkSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [],
    })

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      mandatory: true,
      clientFiles: [
        {
          path: "mods/file.jar",
          sha256: "f".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/file",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toContain("DESCARGAR")

    // New release arrives
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.1.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        mandatory: true,
      })
    })

    expect(checkSpy).toHaveBeenCalledTimes(1)
    // Must remain DESCARGAR, NOT switch to ACTUALIZAR
    expect(btn.textContent).toContain("DESCARGAR")
    expect(btn.textContent).not.toContain("ACTUALIZAR")
  })

  it("Test 11C — Sin juego + pulsar descargar muestra DESCARGANDO en vez de ACTUALIZANDO", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false, // Clean install
      totalSizeGB: 1,
      clientFiles: [
        {
          path: "mods/file.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/file",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toContain("DESCARGAR")

    await act(async () => {
      btn.click()
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("DESCARGANDO")
    expect(card.textContent).not.toContain("ACTUALIZANDO")
  })

  it("Test 11D — Juego instalado + pulsar actualizar muestra ACTUALIZANDO", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true, // Existing install update
      installedModpackVersion: "1.0.0",
      totalSizeGB: 1,
      clientFiles: [
        {
          path: "mods/patch.jar",
          sha256: "b".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/patch",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toContain("ACTUALIZAR")

    await act(async () => {
      btn.click()
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("ACTUALIZANDO")
    expect(card.textContent).not.toContain("DESCARGANDO")
  })

  it("Test 11E — Desinstalar actualiza manifest con checkGameManifest: pasa a DESCARGAR, y al pulsar muestra DESCARGANDO (nunca ACTUALIZANDO)", async () => {
    vi.spyOn(gameService, "checkGameManifest")
      .mockResolvedValueOnce({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasExistingInstall: true, // Initially installed
        installedModpackVersion: "1.0.0",
        totalSizeGB: 1,
        clientFiles: [
          {
            path: "mods/file.jar",
            sha256: "a".repeat(64),
            sizeBytes: 100,
            downloadUrl: "/dl/file",
            policy: "NO_MODIFICABLE",
          },
        ],
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: true,
        hasExistingInstall: false, // Freshly uninstalled
        installedModpackVersion: null,
        totalSizeGB: 1,
        clientFiles: [
          {
            path: "mods/file.jar",
            sha256: "a".repeat(64),
            sizeBytes: 100,
            downloadUrl: "/dl/file",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

    vi.spyOn(gameService, "uninstallGame").mockResolvedValue(true)
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))

    const { container } = await mountButton()
    const playBtn = container.querySelector("button") as HTMLElement
    expect(playBtn.textContent).toContain("JUGAR")

    // Open options menu
    const buttons = container.querySelectorAll("button")
    const gearBtn = buttons[1] // Second button is the gear icon
    expect(gearBtn).toBeDefined()
    await act(async () => {
      gearBtn.click()
    })

    // Click "Desinstalar juego"
    const menuItems = Array.from(container.querySelectorAll(".profile-menu-item"))
    const uninstallItem = menuItems.find((item) =>
      item.textContent?.includes("Desinstalar"),
    ) as HTMLElement
    expect(uninstallItem).toBeDefined()

    await act(async () => {
      uninstallItem.click()
    })

    // Button transitions to DESCARGAR
    const dlBtn = container.querySelector("button") as HTMLElement
    expect(dlBtn.textContent).toContain("DESCARGAR")
    expect(dlBtn.textContent).not.toContain("ACTUALIZAR")
    expect(dlBtn.textContent).not.toContain("JUGAR")

    // Click DESCARGAR
    await act(async () => {
      dlBtn.click()
    })

    // Card shows DESCARGANDO, NOT ACTUALIZANDO
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("DESCARGANDO")
    expect(card.textContent).not.toContain("ACTUALIZANDO")
  })

  it("Test 12 — Realtime RELEASE_ACTIVATED does NOT interrupt in-progress download/pause/install", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: false,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/mod.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/mod",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "2.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      mandatory: true,
      clientFiles: [],
    })

    const { container } = await mountButton()

    // Start download
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("DESCARGANDO")

    // Receive WS event while downloading
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "2.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        mandatory: true,
      })
    })

    // Still in downloading card, not reset
    expect(container.querySelector(".dl-progress-card")).not.toBeNull()
    expect(card.textContent).toContain("DESCARGANDO")
  })

  it("Test 13 — Installing 1.0.1 when 1.0.2 arrives ends in ACTUALIZAR (UPDATE), not JUGAR (PLAY)", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.1",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: false,
      hasUpdate: false,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [
        {
          path: "mods/mod-101.jar",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          downloadUrl: "/dl/mod101",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.0.2",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      mandatory: true,
      clientFiles: [
        {
          path: "mods/mod-102.jar",
          sha256: "b".repeat(64),
          sizeBytes: 120,
          downloadUrl: "/dl/mod102",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    let resolveSync: any
    vi.spyOn(gameService, "startSync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve
        }),
    )

    const { container } = await mountButton()

    // 1. Click download to start installing 1.0.1
    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    expect(container.querySelector(".dl-progress-card")).not.toBeNull()

    // 2. While downloading, 1.0.2 update is activated on backend and broadcasted
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.0.2",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        mandatory: true,
      })
    })

    // 3. Complete sync for 1.0.1
    await act(async () => {
      resolveSync({ success: true })
    })

    // 4. Progress card disappears and button transitions to ACTUALIZAR (UPDATE), NOT JUGAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn).not.toBeNull()
    expect(idleBtn.textContent).toContain("ACTUALIZAR")
    expect(idleBtn.textContent).not.toContain("JUGAR")
  })

  it("Test 14 — Launch status preparing transitions button to INICIANDO... and disabled", async () => {
    let launchStatusCallback: any
    window.electronAPI = {
      ...window.electronAPI,
      onLaunchStatus: vi.fn((cb) => {
        launchStatusCallback = cb
        return () => {}
      }),
    } as any

    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(true)
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLButtonElement
    expect(btn.textContent).toContain("JUGAR")

    await act(async () => {
      launchStatusCallback("preparing")
    })

    expect(btn.textContent).toContain("INICIANDO...")
    expect(btn.disabled).toBe(true)
  })

  it("Test 15 — Launch status running transitions button to EN EJECUCIÓN and disabled", async () => {
    let launchStatusCallback: any
    window.electronAPI = {
      ...window.electronAPI,
      onLaunchStatus: vi.fn((cb) => {
        launchStatusCallback = cb
        return () => {}
      }),
    } as any

    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(true)
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLButtonElement

    await act(async () => {
      launchStatusCallback("running")
    })

    expect(btn.textContent).toContain("EN EJECUCIÓN")
    expect(btn.disabled).toBe(true)

    // Launch status idle restores JUGAR
    await act(async () => {
      launchStatusCallback("idle")
    })

    expect(btn.textContent).toContain("JUGAR")
    expect(btn.disabled).toBe(false)
  })

  it("Test 16 — Release activated during running preserves EN EJECUCIÓN until idle, then shows ACTUALIZAR", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    let launchStatusCallback: any
    window.electronAPI = {
      ...window.electronAPI,
      onLaunchStatus: vi.fn((cb) => {
        launchStatusCallback = cb
        return () => {}
      }),
    } as any

    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(true)
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.0.0",
      totalSizeGB: 10,
      clientFiles: [],
    })

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.0.1",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      modLoader: "NEOFORGE",
      mandatory: true,
      clientFiles: [],
    })

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLButtonElement
    expect(btn.textContent).toContain("JUGAR")

    // 1. Game transitions to running
    await act(async () => {
      launchStatusCallback("running")
    })
    expect(btn.textContent).toContain("EN EJECUCIÓN")

    // 2. New release arrives while running -> visually still EN EJECUCIÓN
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.0.1",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        mandatory: true,
      })
    })
    expect(btn.textContent).toContain("EN EJECUCIÓN")

    // 3. Game closes (idle) -> resolves to ACTUALIZAR (UPDATE)
    await act(async () => {
      launchStatusCallback("idle")
    })
    expect(btn.textContent).toContain("ACTUALIZAR")
  })

  /* ─────────────────────────────────────────────────────────────
   * Real Progress Formatting & Milestone Messages Tests
   * ───────────────────────────────────────────────────────────── */

  describe("Real Progress Formatting & Milestone Messages", () => {
    it("1. formatDownloadSize formats < 1 GB in MB and >= 1 GB in GB with correct precision", () => {
      const MB = 1024 ** 2
      const GB = 1024 ** 3

      // < 100 MB: 2 decimals
      expect(formatDownloadSize(98.65 * MB)).toBe("98.65 MB")
      // >= 100 MB: 1 decimal
      expect(formatDownloadSize(428.6 * MB)).toBe("428.6 MB")
      expect(formatDownloadSize(912.4 * MB)).toBe("912.4 MB")

      // < 10 GB: 2 decimals
      expect(formatDownloadSize(1.28 * GB)).toBe("1.28 GB")
      expect(formatDownloadSize(2.83 * GB)).toBe("2.83 GB")
      // >= 10 GB: 1 decimal
      expect(formatDownloadSize(15.4 * GB)).toBe("15.4 GB")

      // 0 bytes
      expect(formatDownloadSize(0)).toBe("0.00 MB")
    })

    it("2. Does not use 28.8 fallback, uses real manifest total bytes", async () => {
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: true,
        hasExistingInstall: false,
        totalSizeGB: 0.1,
        clientFiles: [
          {
            path: "mods/mod1.jar",
            sha256: "a".repeat(64),
            sizeBytes: 50 * 1024 * 1024,
            downloadUrl: "/dl/1",
            policy: "NO_MODIFICABLE",
          },
          {
            path: "mods/mod2.jar",
            sha256: "b".repeat(64),
            sizeBytes: 50 * 1024 * 1024,
            downloadUrl: "/dl/2",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      let progressCallback: any
      window.electronAPI = {
        ...window.electronAPI,
        onDownloadProgress: vi.fn((cb) => {
          progressCallback = cb
          return () => {}
        }),
      } as any

      vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))

      const { container } = await mountButton()

      // Start download
      await act(async () => {
        (container.querySelector("button") as HTMLElement).click()
      })

      // Simulate download progress event with real bytes (e.g. 50 MB / 100 MB)
      await act(async () => {
        progressCallback({
          phase: "DOWNLOADING",
          progress: 50,
          downloadedBytes: 50 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          speedMBs: 12.5,
          remainingMinutes: 1,
        })
      })

      const card = container.querySelector(".dl-progress-card") as HTMLElement
      expect(card).not.toBeNull()
      expect(card.textContent).not.toContain("28.8")
      expect(card.textContent).toContain("50.00 MB / 100.0 MB")
      expect(card.textContent).toContain("12.5 MB/s")
      expect(card.textContent).toContain("1 MIN")
    })

    it("3. During INSTALLING phase: hides MB/GB, speed, and MIN; displays milestone phrases based on percentage", async () => {
      let progressCallback: any
      window.electronAPI = {
        ...window.electronAPI,
        onDownloadProgress: vi.fn((cb) => {
          progressCallback = cb
          return () => {}
        }),
      } as any

      vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))

      const { container } = await mountButton()

      // Start download
      await act(async () => {
        (container.querySelector("button") as HTMLElement).click()
      })

      const card = container.querySelector(".dl-progress-card") as HTMLElement
      expect(card).not.toBeNull()

      // Milestone 1: 0-14% (e.g. 10%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 10,
          downloadedBytes: 100 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          speedMBs: 0,
          remainingMinutes: 0,
        })
      })

      expect(card.textContent).toContain("INSTALANDO")
      expect(card.textContent).toContain("10%")
      expect(card.textContent).toContain("Afinando los bigotes...")
      expect(card.textContent).not.toContain("MB")
      expect(card.textContent).not.toContain("GB")
      expect(card.textContent).not.toContain("MB/s")
      expect(card.textContent).not.toContain("MIN")

      // Milestone 2: 15-29% (e.g. 20%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 20,
        })
      })
      expect(card.textContent).toContain("Preparando las patitas...")

      // Milestone 3: 30-44% (e.g. 35%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 35,
        })
      })
      expect(card.textContent).toContain("Ordenando unas cuantas cosas...")

      // Milestone 4: 45-59% (e.g. 50%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 50,
        })
      })
      expect(card.textContent).toContain("El gato está haciendo magia...")

      // Milestone 5: 60-74% (e.g. 70%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 70,
        })
      })
      expect(card.textContent).toContain("Poniendo todo en su sitio...")

      // Milestone 6: 75-89% (e.g. 85%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 85,
        })
      })
      expect(card.textContent).toContain("Dando los últimos retoques...")

      // Milestone 7: 90-100% (e.g. 100%)
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 100,
        })
      })
      expect(card.textContent).toContain("Casi listo...")
    })

    it("4. Late IPC event { phase: 'INSTALLING', progress: 100 } after sync success does NOT revert JUGAR back to INSTALANDO", async () => {
      let progressCallback: any
      window.electronAPI = {
        ...window.electronAPI,
        onDownloadProgress: vi.fn((cb) => {
          progressCallback = cb
          return () => {}
        }),
      } as any

      let resolveSync: (val: any) => void
      vi.spyOn(gameService, "startSync").mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve
          }),
      )

      const { container } = await mountButton()

      // 1. Click download to start sync
      await act(async () => {
        (container.querySelector("button") as HTMLElement).click()
      })

      // Active download progress
      await act(async () => {
        progressCallback({
          phase: "DOWNLOADING",
          progress: 50,
          downloadedBytes: 50 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          speedMBs: 10,
          remainingMinutes: 1,
        })
      })

      expect(container.querySelector(".dl-progress-card")).not.toBeNull()

      // 2. startSync completes with success
      await act(async () => {
        resolveSync({ success: true })
      })

      // Button must now be in PLAY state
      const playBtn = container.querySelector("button") as HTMLElement
      expect(playBtn).not.toBeNull()
      expect(playBtn.textContent).toContain("JUGAR")
      expect(container.querySelector(".dl-progress-card")).toBeNull()

      // 3. Late IPC event arrives after completion
      await act(async () => {
        progressCallback({
          phase: "INSTALLING",
          progress: 100,
        })
      })

      // Button must STAY in PLAY state and not revert to INSTALANDO / progress card
      expect(container.querySelector(".dl-progress-card")).toBeNull()
      expect(container.querySelector("button")?.textContent).toContain("JUGAR")
    })

    it("5. Mount with interrupted download (hasInterruptedDownload: true) initializes in PAUSED state with recovered percentage", async () => {
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: true,
        hasExistingInstall: false,
        totalSizeGB: 1,
        hasInterruptedDownload: true,
        stagedBytes: 350 * 1024 * 1024,
        totalDownloadBytes: 1000 * 1024 * 1024,
        clientFiles: [
          {
            path: "mods/example.jar",
            sha256: "a".repeat(64),
            sizeBytes: 1000 * 1024 * 1024,
            downloadUrl: "/dl/example",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      const { container } = await mountButton()
      const card = container.querySelector(".dl-progress-card")
      expect(card).not.toBeNull()
      expect(card?.textContent).toContain("PAUSADO")
      expect(card?.textContent).toContain("35%")
      expect(container.querySelector(".dl-cancel-btn")).not.toBeNull()
    })

    it("6. Mount after interrupted INSTALLING initializes in natural ACTUALIZAR (UPDATE) state and NOT as PAUSED", async () => {
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.1.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: true,
        hasExistingInstall: true,
        installedModpackVersion: "1.0.0",
        totalSizeGB: 1,
        hasInterruptedDownload: false, // INSTALLING interruption does not restore as PAUSED
        clientFiles: [
          {
            path: "mods/patch.jar",
            sha256: "b".repeat(64),
            sizeBytes: 500,
            downloadUrl: "/dl/patch",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      const { container } = await mountButton()
      expect(container.querySelector(".dl-progress-card")).toBeNull()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn).not.toBeNull()
      expect(btn.textContent).toContain("ACTUALIZAR")
      expect(btn.textContent).not.toContain("PAUSADO")
    })
  })

  /* ─────────────────────────────────────────────────────────────
   * Shard 8G: Integrity Lock, Pre-Launch Verification & Watcher Suite
   * ───────────────────────────────────────────────────────────── */
  describe("Shard 8G: Integrity Lock, Pre-Launch Verification & Watcher Suite", () => {
    it("1. resolveIdleGameButtonState visual rules based on installedModpackVersion", () => {
      // Missing / null installedModpackVersion -> download (or unavailable if empty)
      expect(
        resolveIdleGameButtonState({
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          totalSizeGB: 1,
          hasUpdate: false,
          clientFiles: [{ path: "mods/a.jar", sha256: "a", sizeBytes: 10, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
          installed: false,
        }),
      ).toBe("download")

      expect(
        resolveIdleGameButtonState({
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          totalSizeGB: 1,
          hasUpdate: false,
          clientFiles: [],
          installed: false,
        }),
      ).toBe("download")

      expect(
        resolveIdleGameButtonState({
          version: "",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          totalSizeGB: 0,
          hasUpdate: false,
          clientFiles: [],
          installed: false,
        }),
      ).toBe("unavailable")

      // Different version -> update
      expect(
        resolveIdleGameButtonState({
          version: "1.1.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          totalSizeGB: 1,
          hasUpdate: true,
          installedModpackVersion: "1.0.0",
          clientFiles: [],
          installed: false,
        }),
      ).toBe("update")

      // Same version -> play (even with hasIntegrityIssue: true)
      expect(
        resolveIdleGameButtonState({
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          totalSizeGB: 1,
          hasUpdate: false,
          hasIntegrityIssue: true,
          installedModpackVersion: "1.0.0",
          clientFiles: [],
          installed: false,
        }),
      ).toBe("play")

      // Same version healthy -> play
      expect(
        resolveIdleGameButtonState({
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          totalSizeGB: 1,
          hasUpdate: false,
          hasIntegrityIssue: false,
          installedModpackVersion: "1.0.0",
          clientFiles: [],
          installed: true,
        }),
      ).toBe("play")
    })

    it("2. Same modpackVersion with hasIntegrityIssue: true renders JUGAR (never REPARAR), clicking JUGAR blocks launch and shows launchVerifyHint toast", async () => {
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: false,
        hasIntegrityIssue: true,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [
          {
            path: "mods/corrupted.jar",
            sha256: "a".repeat(64),
            sizeBytes: 100,
            downloadUrl: "/dl/corrupted",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn).not.toBeNull()
      expect(btn.textContent).toContain("JUGAR")
      expect(btn.textContent).not.toContain("REPARAR")
      expect(btn.textContent).not.toContain("ACTUALIZAR")

      // Click JUGAR -> launch is blocked, toast is shown
      await act(async () => {
        btn.click()
      })

      expect(launchSpy).not.toHaveBeenCalled()
      const toast = container.querySelector(".play-button-toast, .settings-live-toast")
      expect(toast).not.toBeNull()
      expect(toast?.textContent).toContain("No se pudo iniciar el juego, verifica los archivos e inténtalo de nuevo")
    })

    it("3. Clicking JUGAR in healthy PLAY state launches game directly without calling checkSyncPlan", async () => {
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [
          {
            path: "mods/required.jar",
            sha256: "a".repeat(64),
            sizeBytes: 100,
            downloadUrl: "/dl/required",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)
      const checkSyncPlanSpy = vi.fn().mockResolvedValue({ success: true })
      window.electronAPI!.checkSyncPlan = checkSyncPlanSpy

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("JUGAR")

      // Clear the call from initial mount
      checkSyncPlanSpy.mockClear()

      // Click JUGAR
      await act(async () => {
        btn.click()
      })

      // Must launch Minecraft directly and NOT call checkSyncPlan on play click
      expect(launchSpy).toHaveBeenCalled()
      expect(checkSyncPlanSpy).not.toHaveBeenCalled()
    })

    it("4. When launchGame fails (throws error), shows launchVerifyHint toast", async () => {
      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [],
      })

      vi.spyOn(gameService, "launchGame").mockRejectedValue(new Error("Java corrupted"))

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("JUGAR")

      await act(async () => {
        btn.click()
      })

      const toast = container.querySelector(".play-button-toast, .settings-live-toast")
      expect(toast).not.toBeNull()
      expect(toast?.textContent).toContain("No se pudo iniciar el juego, verifica los archivos e inténtalo de nuevo")
    })

    it("5. Filesystem integrity watcher event sets integrity lock silently without toast or changing button text", async () => {
      let watcherCallback: any = null
      window.electronAPI!.onGameFileIntegrityChanged = vi.fn((cb) => {
        watcherCallback = cb
        return () => {}
      })

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [{ path: "mods/core.jar", sha256: "a", sizeBytes: 10, policy: "NO_MODIFICABLE", downloadUrl: "/dl" }],
      })

      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("JUGAR")

      // Trigger watcher event
      await act(async () => {
        watcherCallback?.({ path: "mods/core-mod.jar" })
      })

      // Button stays JUGAR, no toast immediately
      expect(btn.textContent).toContain("JUGAR")
      expect(btn.textContent).not.toContain("REPARAR")
      expect(container.querySelector(".play-button-toast, .settings-live-toast")).toBeNull()

      // But when user clicks JUGAR, launch is blocked and toast is shown
      await act(async () => {
        btn.click()
      })

      expect(launchSpy).not.toHaveBeenCalled()
      const toast = container.querySelector(".play-button-toast, .settings-live-toast")
      expect(toast).not.toBeNull()
      expect(toast?.textContent).toContain("No se pudo iniciar el juego, verifica los archivos e inténtalo de nuevo")
    })

    it("6. Verification via handleVerifyInstallation resets integrity lock on success and enables launch", async () => {
      let checkCount = 0
      vi.spyOn(gameService, "checkGameManifest").mockImplementation(async () => {
        checkCount++
        if (checkCount === 1) {
          // Initial mount: has integrity issue
          return {
            version: "1.0.0",
            minecraftVersion: "1.21.1",
            neoForgeVersion: "21.1.65",
            modLoader: "NEOFORGE",
            installed: false,
            hasUpdate: false,
            hasIntegrityIssue: true,
            installedModpackVersion: "1.0.0",
            hasExistingInstall: true,
            totalSizeGB: 1,
            clientFiles: [
              {
                path: "mods/fix.jar",
                sha256: "a".repeat(64),
                sizeBytes: 100,
                downloadUrl: "/dl/fix",
                policy: "NO_MODIFICABLE",
              },
            ],
          }
        }
        // After verify: clean install
        return {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.65",
          modLoader: "NEOFORGE",
          installed: true,
          hasUpdate: false,
          hasIntegrityIssue: false,
          installedModpackVersion: "1.0.0",
          hasExistingInstall: true,
          totalSizeGB: 1,
          clientFiles: [
            {
              path: "mods/fix.jar",
              sha256: "a".repeat(64),
              sizeBytes: 100,
              downloadUrl: "/dl/fix",
              policy: "NO_MODIFICABLE",
            },
          ],
        }
      })

      const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)
      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("JUGAR")

      // 1. Initial click blocked
      await act(async () => {
        btn.click()
      })
      expect(launchSpy).not.toHaveBeenCalled()

      // 2. Open quick options menu
      const optionsBtn = container.querySelector("button[title='Opciones del juego']") as HTMLElement
      expect(optionsBtn).not.toBeNull()
      await act(async () => {
        optionsBtn.click()
      })

      // 3. Click "Verificar instalación"
      const verifyOption = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Verificar instalación"),
      )
      expect(verifyOption).toBeDefined()

      await act(async () => {
        verifyOption!.click()
      })

      // startSync called with isVerify = true
      expect(startSyncSpy).toHaveBeenCalledWith(
        expect.any(Array),
        "1.0.0",
        "1.21.1",
        "NEOFORGE",
        undefined,
        "21.1.65",
        true,
      )

      await act(async () => {
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 20))
      })

      // Toast confirms verification success
      expect(container.querySelector(".play-button-toast, .settings-live-toast")?.textContent).toContain(
        "Juego verificado correctamente",
      )

      // 4. Now clicking JUGAR launches the game without blocking
      const playBtn = container.querySelector("button") as HTMLElement
      expect(playBtn).not.toBeNull()
      expect(playBtn.textContent).toContain("JUGAR")

      await act(async () => {
        playBtn.click()
      })
      expect(launchSpy).toHaveBeenCalled()
    })

    it("7. Successful release update resets integrity lock", async () => {
      let watcherCallback: any = null
      window.electronAPI!.onGameFileIntegrityChanged = vi.fn((cb) => {
        watcherCallback = cb
        return () => {}
      })

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.1.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: false,
        hasUpdate: true,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [
          {
            path: "mods/update.jar",
            sha256: "b".repeat(64),
            sizeBytes: 100,
            downloadUrl: "/dl/update",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      let resolveSync: any
      vi.spyOn(gameService, "startSync").mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve
          }),
      )
      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("ACTUALIZAR")

      // Simulate watcher event prior to update
      await act(async () => {
        watcherCallback?.({ path: "mods/old.jar" })
      })

      // Click ACTUALIZAR
      await act(async () => {
        btn.click()
      })

      // Resolve sync successfully
      await act(async () => {
        resolveSync({ success: true })
      })

      await act(async () => {
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 20))
      })

      // Transitions to JUGAR
      const playBtn = container.querySelector("button") as HTMLElement
      expect(playBtn).not.toBeNull()
      expect(playBtn.textContent).toContain("JUGAR")

      // Clicking JUGAR launches directly because update cleared the lock
      await act(async () => {
        playBtn.click()
      })
      expect(launchSpy).toHaveBeenCalled()
    })

    it("8. Watcher event while game is running marks lock silently; after game exits, clicking JUGAR blocks with hint", async () => {
      let launchStatusCallback: any = null
      let watcherCallback: any = null
      window.electronAPI!.onLaunchStatus = vi.fn((cb) => {
        launchStatusCallback = cb
        return () => {}
      })
      window.electronAPI!.onGameFileIntegrityChanged = vi.fn((cb) => {
        watcherCallback = cb
        return () => {}
      })

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [],
      })
      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      const { container } = await mountButton()
      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("JUGAR")

      // Game starts running
      await act(async () => {
        launchStatusCallback?.("running")
      })
      expect(btn.textContent).toContain("EN EJECUCIÓN")

      // Watcher detects modification while running (silent)
      await act(async () => {
        watcherCallback?.({ path: "mods/corrupt.jar" })
      })
      expect(btn.textContent).toContain("EN EJECUCIÓN")
      expect(container.querySelector(".play-button-toast, .settings-live-toast")).toBeNull()

      // Game exits
      await act(async () => {
        launchStatusCallback?.("idle")
      })
      expect(btn.textContent).toContain("JUGAR")
      expect(btn.textContent).not.toContain("REPARAR")

      // Clicking JUGAR is blocked
      await act(async () => {
        btn.click()
      })
      expect(launchSpy).not.toHaveBeenCalled()
      expect(container.querySelector(".play-button-toast, .settings-live-toast")?.textContent).toContain(
        "No se pudo iniciar el juego, verifica los archivos e inténtalo de nuevo",
      )
    })

    it("9. React.StrictMode: watcher event while running preserves silent lock through remounts", async () => {
      let launchStatusCallback: any = null
      let watcherCallback: any = null
      window.electronAPI!.onLaunchStatus = vi.fn((cb) => {
        launchStatusCallback = cb
        return () => {}
      })
      window.electronAPI!.onGameFileIntegrityChanged = vi.fn((cb) => {
        watcherCallback = cb
        return () => {}
      })

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [],
      })

      const launchSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue({ success: true } as any)

      const container = document.createElement("div")
      document.body.appendChild(container)
      const root = createRoot(container)

      await act(async () => {
        root.render(
          <React.StrictMode>
            <LanguageProvider>
              <DownloadPlayButton left={0} top={0} theme="dark" />
            </LanguageProvider>
          </React.StrictMode>,
        )
      })
      await act(async () => {
        await Promise.resolve()
      })

      const btn = container.querySelector("button") as HTMLElement
      expect(btn.textContent).toContain("JUGAR")

      // 1. Running
      await act(async () => {
        launchStatusCallback?.("running")
      })
      expect(btn.textContent).toContain("EN EJECUCIÓN")

      // 2. Watcher detects corrupted file
      await act(async () => {
        watcherCallback?.({ path: "mods/corrupted.jar" })
      })

      // 3. Exit running
      await act(async () => {
        launchStatusCallback?.("idle")
      })
      expect(btn.textContent).toContain("JUGAR")

      // 4. Click blocked
      await act(async () => {
        btn.click()
      })
      expect(launchSpy).not.toHaveBeenCalled()
      expect(container.querySelector(".play-button-toast, .settings-live-toast")?.textContent).toContain(
        "No se pudo iniciar el juego, verifica los archivos e inténtalo de nuevo",
      )

      act(() => {
        root.unmount()
      })
      container.remove()
    })

    it("15. VERIFICANDO shows VERIFICANDO and verifyMessage, hides MB, MB/s and MIN", async () => {
      let downloadProgressCb: any = null
      window.electronAPI!.onDownloadProgress = vi.fn((cb) => {
        downloadProgressCb = cb
        return () => {}
      })

      vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        modLoader: "NEOFORGE",
        installed: true,
        hasUpdate: false,
        hasIntegrityIssue: false,
        installedModpackVersion: "1.0.0",
        hasExistingInstall: true,
        totalSizeGB: 1,
        clientFiles: [
          {
            path: "mods/example.jar",
            sha256: "abc",
            sizeBytes: 1024,
            downloadUrl: "/game/1",
            policy: "NO_MODIFICABLE",
          },
        ],
      })

      let resolveSyncPromise: any = null
      vi.spyOn(gameService, "startSync").mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSyncPromise = resolve
          })
      )

      const { container } = await mountButton()

      // Open options dropdown menu
      const optionsBtn = container.querySelector("button[title='Opciones del juego']") as HTMLElement
      expect(optionsBtn).not.toBeNull()
      await act(async () => {
        optionsBtn.click()
      })

      // Click "Verificar instalación"
      const verifyMenuItem = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Verificar instalación")
      )
      expect(verifyMenuItem).toBeDefined()

      await act(async () => {
        verifyMenuItem!.click()
      })

      // In verifying state
      const card = container.querySelector(".dl-progress-card") as HTMLElement
      expect(card).not.toBeNull()
      expect(card.textContent).toContain("VERIFICANDO")
      expect(card.textContent).toContain("Revisando las patitas...")

      // Verify that download metrics (MB, MB/s, min) are completely hidden
      expect(card.textContent).not.toContain("MB /")
      expect(card.textContent).not.toContain("MB/s")
      expect(card.textContent).not.toContain("min")

      // Emit progress 60%
      await act(async () => {
        downloadProgressCb?.({
          phase: "VERIFYING",
          progress: 60,
        })
      })

      expect(card.textContent).toContain("60%")
      expect(card.textContent).toContain("Revisando las patitas...")
      expect(card.textContent).not.toContain("MB /")
      expect(card.textContent).not.toContain("MB/s")
      expect(card.textContent).not.toContain("min")

      // Complete sync
      await act(async () => {
        resolveSyncPromise?.({ success: true })
      })
    })
  })
})


