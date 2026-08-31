// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import DownloadPlayButton, { resolveIdleGameButtonState } from "./DownloadPlayButton"
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
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true,
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
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
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

    // Returns to DESCARGAR, not ACTUALIZAR
    const idleBtn = container.querySelector("button") as HTMLElement
    expect(idleBtn.textContent).toContain("DESCARGAR")
    expect(idleBtn.textContent).not.toContain("ACTUALIZAR")
  })

  it("Test E — Existing install + Cancel returns to ACTUALIZAR (UPDATE)", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.2.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true,
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
      installed: false,
      hasUpdate: true,
      hasExistingInstall: true,
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
    expect(btn.textContent).toContain("BUSCANDO ACTUALIZACIONES...")
    expect(btn.textContent).not.toContain("NO DISPONIBLE")
    expect(btn.textContent).not.toContain("JUGAR")

    // Once checkGameManifest resolves, transitions to resolved state
    await act(async () => {
      resolveCheck({
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        installed: true,
        hasUpdate: false,
        hasExistingInstall: true,
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

  it("Test 10 — Realtime RELEASE_ACTIVATED event triggers getPublishedModpack and switches to ACTUALIZAR (UPDATE) when installed", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      totalSizeGB: 10,
      clientFiles: [],
    })

    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.1.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
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
        mandatory: true,
      })
    })

    expect(getPublishedSpy).toHaveBeenCalledTimes(1)
    // Does NOT call window.electronAPI.checkSyncPlan on WS event
    expect(btn.textContent).toContain("ACTUALIZAR")
    expect(btn.textContent).not.toContain("JUGAR")
  })

  it("Test 11 — Realtime RELEASE_ACTIVATED with matching version does NOT trigger getPublishedModpack", async () => {
    let releaseCallback: any
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseCallback = cb
      return () => {}
    })

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      totalSizeGB: 10,
      clientFiles: [],
    })

    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")

    const { container } = await mountButton()
    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toContain("JUGAR")

    // Event with identical version
    await act(async () => {
      await releaseCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.65",
        mandatory: true,
      })
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    expect(btn.textContent).toContain("JUGAR")
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

    let resolveSync: any
    vi.spyOn(gameService, "startSync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve
        }),
    )

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.0.2",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
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
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
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
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
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
      installed: true,
      hasUpdate: false,
      hasExistingInstall: true,
      totalSizeGB: 10,
      clientFiles: [],
    })

    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "1.0.1",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
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
})


