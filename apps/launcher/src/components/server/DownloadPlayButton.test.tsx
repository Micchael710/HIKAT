// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import DownloadPlayButton from "./DownloadPlayButton"
import { LanguageProvider } from "../../context/LanguageContext"
import { gameService } from "../../services/gameService"

describe("Shard 8E: DownloadPlayButton Real Component Lifecycle & Transition Suite", () => {
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

  it("Test 1 — Descargar permite Pausar mientras startSync sigue pendiente", async () => {
    let resolveStartSync: any
    const startSyncSpy = vi
      .spyOn(gameService, "startSync")
      .mockImplementation(
        () => new Promise((resolve) => {
          resolveStartSync = resolve
        }),
      )
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

    expect(startSyncSpy).toHaveBeenCalledTimes(1)

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
    let resolveStartSync: any
    vi.spyOn(gameService, "startSync").mockImplementation(
      () => new Promise((resolve) => {
        resolveStartSync = resolve
      }),
    )
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

  it("Test 9 — mientras Pause está esperando confirmación no se lanza Resume", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    let resolvePause: any
    vi.spyOn(gameService, "pauseSync").mockImplementation(
      () => new Promise((resolve) => {
        resolvePause = resolve
      }),
    )

    const { container } = await mountButton()

    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement

    // Click pause (in-flight)
    await act(async () => {
      card.click()
    })

    const startSyncSpy = vi.spyOn(gameService, "startSync")

    // Click card again while pause is in-flight
    await act(async () => {
      card.click()
    })

    // No second startSync was launched
    expect(startSyncSpy).not.toHaveBeenCalled()

    // Finish pause
    await act(async () => {
      resolvePause({ success: true, paused: true })
    })
    expect(card.textContent).toContain("PAUSADO")
  })

  it("Test 10 — mientras Cancel está esperando confirmación no se lanza nuevo startSync", async () => {
    vi.spyOn(gameService, "startSync").mockImplementation(() => new Promise(() => {}))
    let resolveCancel: any
    vi.spyOn(gameService, "cancelSync").mockImplementation(
      () => new Promise((resolve) => {
        resolveCancel = resolve
      }),
    )

    const { container } = await mountButton()

    await act(async () => {
      (container.querySelector("button") as HTMLElement).click()
    })

    const cancelBtn = container.querySelector(".dl-cancel-btn") as HTMLElement
    const card = container.querySelector(".dl-progress-card") as HTMLElement

    // Click cancel (in-flight)
    await act(async () => {
      cancelBtn.click()
    })

    const startSyncSpy = vi.spyOn(gameService, "startSync")

    // Click card or cancel during cancellation in-flight
    await act(async () => {
      card.click()
      cancelBtn.click()
    })

    expect(startSyncSpy).not.toHaveBeenCalled()

    // Finish cancel
    await act(async () => {
      resolveCancel({ success: true })
    })
    expect(container.querySelector(".dl-progress-card")).toBeNull()
  })
})
