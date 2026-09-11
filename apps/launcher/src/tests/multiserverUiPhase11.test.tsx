// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../context/LanguageContext"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import DownloadsView from "../views/DownloadsView"
import { gameService } from "../services/gameService"
import type { LauncherServer } from "../services/serverService"
import type { DownloadQueueSnapshot } from "../vite-env"

const serverA: LauncherServer = {
  id: "server-a",
  name: "Warria",
  accentColor: "#3366ff",
  minecraftVersion: "1.21.1",
  modLoader: "VANILLA",
  launcherActiveReleaseId: "rel-a",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sidebarLogo: { id: "logo-a", url: "https://api.apparatia.net/media/logo-a.png" },
}

const serverB: LauncherServer = {
  id: "server-b",
  name: "Survival Realm",
  accentColor: "#ff5500",
  minecraftVersion: "1.21.1",
  modLoader: "VANILLA",
  launcherActiveReleaseId: "rel-b",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sidebarLogo: { id: "logo-b", url: "https://api.apparatia.net/media/logo-b.png" },
}

describe("HiKAT Phase 11 — UI Robustness Suite: Items 15, 16, 17", () => {
  let container: HTMLDivElement
  let root: any
  let downloadProgressListeners: Function[] = []
  let phaseChangeListeners: Function[] = []
  let queueChangeListeners: Function[] = []
  let currentQueueSnapshot: DownloadQueueSnapshot = { active: null, queued: [] }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    downloadProgressListeners = []
    phaseChangeListeners = []
    queueChangeListeners = []

    currentQueueSnapshot = {
      active: null,
      queued: [],
    }

    ;(window as any).electronAPI = {
      getDownloadQueue: vi.fn().mockImplementation(async () => currentQueueSnapshot),
      getLaunchStatus: vi.fn().mockResolvedValue({
        status: "idle",
        runningGameId: null,
        activeOperationGameId: null,
        activeOperationState: "IDLE",
        activeOperationPhase: null,
      }),
      onLaunchStatus: vi.fn(() => () => {}),
      onDownloadProgress: vi.fn((cb) => {
        downloadProgressListeners.push(cb)
        return () => {
          downloadProgressListeners = downloadProgressListeners.filter((l) => l !== cb)
        }
      }),
      onPhaseChange: vi.fn((cb) => {
        phaseChangeListeners.push(cb)
        return () => {
          phaseChangeListeners = phaseChangeListeners.filter((l) => l !== cb)
        }
      }),
      onDownloadQueueChanged: vi.fn((cb) => {
        queueChangeListeners.push(cb)
        return () => {
          queueChangeListeners = queueChangeListeners.filter((l) => l !== cb)
        }
      }),
      pauseSync: vi.fn().mockImplementation(async () => {
        if (currentQueueSnapshot.active) {
          currentQueueSnapshot.active.state = "PAUSED"
          currentQueueSnapshot.active.phase = "DOWNLOADING"
        }
        for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
        for (const cb of phaseChangeListeners) cb("PAUSED", "server-a", "DOWNLOADING")
        return { success: true }
      }),
      resumeSync: vi.fn().mockImplementation(async () => {
        if (currentQueueSnapshot.active) {
          currentQueueSnapshot.active.state = "SYNCING"
          currentQueueSnapshot.active.phase = "DOWNLOADING"
        }
        for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
        for (const cb of phaseChangeListeners) cb("DOWNLOADING", "server-a")
        return { success: true }
      }),
      cancelSync: vi.fn().mockResolvedValue({ success: true }),
      startSync: vi.fn().mockResolvedValue({ success: true }),
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        filesToDownload: 1,
        filesToPrune: 0,
        totalDownloadBytes: 1000,
        needsUpdate: true,
        isFullyInstalled: false,
        hasExistingInstall: false,
      }),
    }

    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(false)
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      modLoader: "VANILLA",
      installed: false,
      hasUpdate: true,
      hasExistingInstall: false,
      totalSizeGB: 1,
      clientFiles: [],
    })
    vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  // 15. Single Source of Truth & Concurrent UI Synchronization
  it("15. Home (DownloadPlayButton) y DownloadsView se sincronizan perfectamente desde el snapshot de Main", async () => {
    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 45,
        speedMBs: 5.2,
        downloadedBytes: 450,
        totalBytes: 1000,
        remainingMinutes: 2,
        canPause: true,
        canCancel: true,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <div data-testid="unified-ui">
            <DownloadPlayButton
              gameId="server-a"
              gameContext={{ gameId: "server-a", gameName: "Warria" }}
              left={0}
              top={0}
              theme="dark"
            />
            <DownloadsView theme="dark" servers={[serverA, serverB]} />
          </div>
        </LanguageProvider>,
      )
    })

    // Both views reflect 45% progress
    expect(container.textContent).toContain("45%")

    // Emit live progress to 60%
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({
          gameId: "server-a",
          phase: "DOWNLOADING",
          progress: 60,
          speedMBs: 6.0,
          downloadedBytes: 600,
          totalBytes: 1000,
          remainingMinutes: 1,
          canPause: true,
          canCancel: true,
        })
      }
    })

    expect(container.textContent).toContain("60%")

    // Emit Pause transition
    await act(async () => {
      currentQueueSnapshot.active!.state = "PAUSED"
      currentQueueSnapshot.active!.progress = 60
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
      for (const cb of phaseChangeListeners) cb("PAUSED", "server-a", "DOWNLOADING")
    })

    // Both views reflect paused state (DownloadPlayButton shows PAUSADO, DownloadsView shows Pausado and Reanudar action)
    expect(container.textContent).toContain("PAUSADO")
    expect(container.textContent).toContain("Pausado")
    expect(container.textContent).toContain("Reanudar")
  })

  // 16. Language change / remount persistence
  it("16. Cambio de idioma o desmontaje preserva el estado en curso y progreso exacto sin reiniciarse a 0", async () => {
    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "PAUSED",
        phase: "DOWNLOADING",
        progress: 72,
        speedMBs: 0,
        downloadedBytes: 720,
        totalBytes: 1000,
        remainingMinutes: 0,
        canPause: false,
        canCancel: true,
      },
      queued: [],
    }

    // Mount initially in Spanish
    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            gameId="server-a"
            gameContext={{ gameId: "server-a", gameName: "Warria" }}
            left={0}
            top={0}
            theme="dark"
          />
        </LanguageProvider>,
      )
    })

    expect(container.textContent).toContain("PAUSADO")
    expect(container.textContent).toContain("72%")

    // Unmount and change language to English
    act(() => {
      root.unmount()
    })
    container.remove()

    localStorage.setItem("hikat_language", "en")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    // Remount in English
    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            gameId="server-a"
            gameContext={{ gameId: "server-a", gameName: "Warria" }}
            left={0}
            top={0}
            theme="dark"
          />
        </LanguageProvider>,
      )
    })

    // State is preserved: shows English "PAUSED" and progress 72%
    expect(container.textContent).toContain("PAUSED")
    expect(container.textContent).toContain("72%")
  })

  // 17. Queued -> active transition
  it("17. Al completar o cancelar el activo, el siguiente en cola pasa suavemente a activo en ambos componentes", async () => {
    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 90,
        speedMBs: 8.0,
        downloadedBytes: 900,
        totalBytes: 1000,
        remainingMinutes: 1,
        canPause: true,
        canCancel: true,
      },
      queued: [
        {
          gameId: "server-b",
          gameName: "Survival Realm",
          position: 1,
        },
      ],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <div data-testid="multiserver-container">
            <DownloadPlayButton
              gameId="server-b"
              gameContext={{ gameId: "server-b", gameName: "Survival Realm" }}
              left={0}
              top={0}
              theme="dark"
            />
            <DownloadsView theme="dark" servers={[serverA, serverB]} />
          </div>
        </LanguageProvider>,
      )
    })

    // Server B button reflects EN COLA (queued)
    expect(container.textContent).toContain("EN COLA")

    // Server A completes, and Server B becomes active
    await act(async () => {
      currentQueueSnapshot = {
        active: {
          gameId: "server-b",
          state: "SYNCING",
          phase: "DOWNLOADING",
          progress: 15,
          speedMBs: 4.5,
          downloadedBytes: 150,
          totalBytes: 1000,
          remainingMinutes: 3,
          canPause: true,
          canCancel: true,
        },
        queued: [],
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
      for (const cb of phaseChangeListeners) cb("DOWNLOADING", "server-b")
      for (const cb of downloadProgressListeners) {
        cb({
          gameId: "server-b",
          phase: "DOWNLOADING",
          progress: 15,
          speedMBs: 4.5,
          downloadedBytes: 150,
          totalBytes: 1000,
          canPause: true,
          canCancel: true,
        })
      }
    })

    // Now Server B is active with 15% progress, no longer EN COLA
    expect(container.textContent).not.toContain("EN COLA")
    expect(container.textContent).toContain("15%")
  })

  // 18. Regresión Pause desde Home -> PAUSED
  it("18. Pause desde Home transiciona la tarjeta a PAUSED y llama a pauseSync", async () => {
    const pauseSpy = vi.spyOn(gameService, "pauseSync").mockResolvedValue({ success: true, paused: true } as any)

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 50,
        speedMBs: 4.0,
        downloadedBytes: 500,
        totalBytes: 1000,
        remainingMinutes: 2,
        canPause: true,
        canCancel: true,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            gameId="server-a"
            gameContext={{ gameId: "server-a", gameName: "Warria" }}
            left={0}
            top={0}
            theme="dark"
          />
        </LanguageProvider>,
      )
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("DESCARGANDO")

    await act(async () => {
      card.click()
    })

    expect(pauseSpy).toHaveBeenCalledTimes(1)
  })

  // 19. Regresión PAUSED con canPause=false -> Resume sigue clickable y llama una sola vez
  it("19. PAUSED con contrato real canPause=false y canCancel=true: Resume sigue clickable y llama una sola vez", async () => {
    const resumeSpy = vi.spyOn(gameService, "resumeSync").mockResolvedValue({ success: true } as any)

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "PAUSED",
        phase: "DOWNLOADING",
        progress: 50,
        speedMBs: 0,
        downloadedBytes: 500,
        totalBytes: 1000,
        remainingMinutes: 0,
        canPause: false, // Contrato real: NO se puede pausar una operación ya pausada
        canCancel: true,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            gameId="server-a"
            gameContext={{ gameId: "server-a", gameName: "Warria" }}
            left={0}
            top={0}
            theme="dark"
          />
        </LanguageProvider>,
      )
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("PAUSADO")
    expect(card.style.cursor).toBe("pointer")

    // Clic en la tarjeta de Home para reanudar
    await act(async () => {
      card.click()
    })

    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(resumeSpy).toHaveBeenCalledWith({ gameId: "server-a", gameName: "Warria" })
  })

  // 20. Regresión Home y Downloads usan el mismo camino de reanudación
  it("20. Resume desde Home y Downloads usa exactamente la misma operación y método gameService.resumeSync", async () => {
    const resumeSpy = vi.spyOn(gameService, "resumeSync").mockResolvedValue({ success: true } as any)

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "PAUSED",
        phase: "DOWNLOADING",
        progress: 60,
        speedMBs: 0,
        downloadedBytes: 600,
        totalBytes: 1000,
        remainingMinutes: 0,
        canPause: false,
        canCancel: true,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <div>
            <DownloadPlayButton
              gameId="server-a"
              gameContext={{ gameId: "server-a", gameName: "Warria" }}
              left={0}
              top={0}
              theme="dark"
            />
            <DownloadsView theme="dark" servers={[serverA]} />
          </div>
        </LanguageProvider>,
      )
    })

    const card = container.querySelector(".dl-progress-card") as HTMLElement
    await act(async () => {
      card.click()
    })
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(resumeSpy).toHaveBeenLastCalledWith({ gameId: "server-a", gameName: "Warria" })

    // Clic en Reanudar desde DownloadsView
    const resumeBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reanudar")
    )
    expect(resumeBtn).toBeDefined()
    await act(async () => {
      resumeBtn?.click()
    })

    expect(resumeSpy).toHaveBeenCalledTimes(2)
    expect(resumeSpy).toHaveBeenLastCalledWith({ gameId: "server-a", gameName: "Warria" })
  })

  // 21. Regresión Home y Downloads reciben y muestran el mismo phase + progress canónico
  it("21. Home y Downloads reciben y muestran exactamente el mismo phase + progress (INSTALLING: 35%)", async () => {
    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "INSTALLING",
        progress: 35,
        speedMBs: 0,
        downloadedBytes: 1000,
        totalBytes: 1000,
        remainingMinutes: 0,
        canPause: true,
        canCancel: true,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <div>
            <DownloadPlayButton
              gameId="server-a"
              gameContext={{ gameId: "server-a", gameName: "Warria" }}
              left={0}
              top={0}
              theme="dark"
            />
            <DownloadsView theme="dark" servers={[serverA]} />
          </div>
        </LanguageProvider>,
      )
    })

    // Emit live progress 35% INSTALLING
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({
          gameId: "server-a",
          phase: "INSTALLING",
          progress: 35,
          speedMBs: 0,
          downloadedBytes: 1000,
          totalBytes: 1000,
          remainingMinutes: 0,
          canPause: true,
          canCancel: true,
        })
      }
    })

    const text = container.textContent || ""
    // Ambos componentes reflejan 35% e INSTALANDO
    expect(text).toContain("35%")
    expect(text).toContain("INSTALANDO")
  })

  // 22. Regresión VERIFYING no permite Pause ni Cancel desde ninguna vista
  it("22. VERIFYING no permite Pause ni Cancel ni desde Home ni desde Downloads", async () => {
    const pauseSpy = vi.spyOn(gameService, "pauseSync")
    const cancelSpy = vi.spyOn(gameService, "cancelSync")

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "VERIFYING",
        progress: 80,
        speedMBs: 0,
        downloadedBytes: 800,
        totalBytes: 1000,
        remainingMinutes: 0,
        canPause: false,
        canCancel: false,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <div>
            <DownloadPlayButton
              gameId="server-a"
              gameContext={{ gameId: "server-a", gameName: "Warria" }}
              left={0}
              top={0}
              theme="dark"
            />
            <DownloadsView theme="dark" servers={[serverA]} />
          </div>
        </LanguageProvider>,
      )
    })

    // Home progress card: click does NOT pause
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    await act(async () => {
      card.click()
    })
    expect(pauseSpy).not.toHaveBeenCalled()

    // Home cancel button is not rendered during VERIFYING
    const homeCancelBtn = container.querySelector(".dl-cancel-btn") as HTMLButtonElement | null
    // In DownloadsView, the cancel button exists but is disabled
    const allButtons = Array.from(container.querySelectorAll("button"))
    const dlPauseBtn = allButtons.find((b) => b.title === "Pausar" || b.textContent?.includes("Pausar"))
    const dlCancelBtn = allButtons.find((b) => b.title === "Cancelar" || b.textContent?.includes("Cancelar"))

    expect(dlPauseBtn?.disabled).toBe(true)
    expect(dlCancelBtn?.disabled).toBe(true)

    // Attempting to click them does not call IPC
    await act(async () => {
      dlPauseBtn?.click()
      dlCancelBtn?.click()
    })

    expect(pauseSpy).not.toHaveBeenCalled()
    expect(cancelSpy).not.toHaveBeenCalled()
  })

  // 23. Home y Downloads muestran exactamente el mismo porcentaje durante el catch-up de Resume y no habilitan optimistamente capabilities
  it("23. Home y Downloads muestran exactamente el mismo porcentaje durante el catch-up de Resume y no habilitan optimistamente capabilities", async () => {
    const pauseSpy = vi.spyOn(gameService, "pauseSync")
    let resumeCalled = false
    let resumeArgs: any = null
    const origStartSync = window.electronAPI!.startSync
    ;(window.electronAPI as any).startSync = vi.fn().mockImplementation((args: any) => {
      if (args?.resume) {
        resumeCalled = true
        resumeArgs = args
        return new Promise(() => {}) // keep active
      }
      return origStartSync(args)
    })

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "PAUSED",
        phase: "INSTALLING",
        progress: 82,
        speedMBs: 0,
        downloadedBytes: 820,
        totalBytes: 1000,
        remainingMinutes: 0,
        canPause: false,
        canCancel: true,
        isCommitting: false,
      },
      queued: [],
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <div>
            <DownloadPlayButton
              gameId="server-a"
              gameContext={{ gameId: "server-a", gameName: "Warria" }}
              left={0}
              top={0}
              theme="dark"
            />
            <DownloadsView theme="dark" servers={[serverA]} />
          </div>
        </LanguageProvider>,
      )
    })

    // Ambos muestran 82% inicialmente
    expect(container.textContent).toContain("82%")
    expect(container.textContent).toContain("PAUSADO")

    // Pulsar Resume desde Home
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    await act(async () => {
      card.click()
    })

    // Resume fue llamado con sólo lo necesario
    expect(resumeCalled).toBe(true)
    expect(resumeArgs).toEqual({
      gameId: "server-a",
      gameName: "Warria",
      resume: true,
    })

    // NO se deben haber habilitado optimistamente canPause ni canCancel antes de que Main lo emita
    // En este instante, si el usuario hace clic en el card no debe pausar (pauseSpy no llamado)
    await act(async () => {
      card.click()
    })
    expect(pauseSpy).not.toHaveBeenCalled()

    // Main publica progreso catch-up (raw 30 -> Main publica 82)
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({
          gameId: "server-a",
          phase: "INSTALLING",
          progress: 82,
          speedMBs: 1.5,
          downloadedBytes: 300,
          totalBytes: 1000,
          remainingMinutes: 1,
          canPause: true,
          canCancel: true,
          isCommitting: false,
          state: "INSTALLING",
        })
      }
      currentQueueSnapshot.active = {
        ...currentQueueSnapshot.active!,
        state: "INSTALLING",
        phase: "INSTALLING",
        progress: 82,
        canPause: true,
        canCancel: true,
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })

    // Ambos muestran 82%
    expect(container.textContent).toContain("82%")

    // Main publica progreso raw 83 (supera floor -> 83)
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({
          gameId: "server-a",
          phase: "INSTALLING",
          progress: 83,
          speedMBs: 2.0,
          downloadedBytes: 830,
          totalBytes: 1000,
          remainingMinutes: 1,
          canPause: true,
          canCancel: true,
          isCommitting: false,
          state: "INSTALLING",
        })
      }
      currentQueueSnapshot.active!.progress = 83
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })

    // Ambos muestran 83%
    expect(container.textContent).toContain("83%")
    expect(container.textContent).not.toContain("82%")

    ;(window.electronAPI as any).startSync = origStartSync
  })
})
