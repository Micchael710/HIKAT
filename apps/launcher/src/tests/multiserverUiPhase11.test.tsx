// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../context/LanguageContext"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import DownloadsView from "../views/DownloadsView"
import { gameService, type ReleaseActivatedEvent } from "../services/gameService"
import { serverService, type LauncherServer } from "../services/serverService"
import { useLauncherState } from "../hooks/useLauncherState"
import HomeView from "../views/HomeView"
import type { DownloadQueueSnapshot, PublishedModpack } from "../vite-env"

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
  let launchStatusListeners: Function[] = []
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
    launchStatusListeners = []

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
      onLaunchStatus: vi.fn((cb) => {
        launchStatusListeners.push(cb)
        return () => {
          launchStatusListeners = launchStatusListeners.filter((l) => l !== cb)
        }
      }),
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

  // 24. Reanudar en INSTALLING 47 conserva visualmente 47% en Home y Downloads durante reconciliación DOWNLOADING y catch-up hasta 48%
  it("24. Reanudar en INSTALLING 47 conserva visualmente 47% en Home y Downloads durante reconciliación DOWNLOADING y catch-up hasta 48%", async () => {
    const origStartSync = window.electronAPI!.startSync
    ;(window.electronAPI as any).startSync = vi.fn().mockImplementation((args: any) => {
      if (args?.resume) {
        return new Promise(() => {}) // keep active
      }
      return origStartSync(args)
    })

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "PAUSED",
        phase: "INSTALLING",
        progress: 47,
        speedMBs: 0,
        downloadedBytes: 470,
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

    // 1. Inicialmente ambos muestran 47% PAUSADO
    expect(container.textContent).toContain("47%")
    expect(container.textContent).toContain("PAUSADO")

    // 2. Pulsar Resume desde Home
    const card = container.querySelector(".dl-progress-card") as HTMLElement
    expect(card).not.toBeNull()
    await act(async () => {
      card.click()
    })

    // 3. Evento interno DOWNLOADING emitido por Main como INSTALLING 47
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({
          gameId: "server-a",
          phase: "INSTALLING",
          progress: 47,
          speedMBs: 1.0,
          downloadedBytes: 200,
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
        progress: 47,
        canPause: true,
        canCancel: true,
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })
    expect(container.textContent).toContain("47%")
    expect(container.textContent).not.toContain("DESCARGANDO")

    // 4. Evento INSTALLING 30
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({ gameId: "server-a", phase: "INSTALLING", progress: 47, canPause: true, canCancel: true, state: "INSTALLING" })
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })
    expect(container.textContent).toContain("47%")

    // 5. Evento INSTALLING 40
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({ gameId: "server-a", phase: "INSTALLING", progress: 47, canPause: true, canCancel: true, state: "INSTALLING" })
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })
    expect(container.textContent).toContain("47%")

    // 6. Evento INSTALLING 46
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({ gameId: "server-a", phase: "INSTALLING", progress: 47, canPause: true, canCancel: true, state: "INSTALLING" })
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })
    expect(container.textContent).toContain("47%")

    // 7. Evento INSTALLING 47
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({ gameId: "server-a", phase: "INSTALLING", progress: 47, canPause: true, canCancel: true, state: "INSTALLING" })
      }
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })
    expect(container.textContent).toContain("47%")

    // 8. Evento INSTALLING 48
    await act(async () => {
      for (const cb of downloadProgressListeners) {
        cb({ gameId: "server-a", phase: "INSTALLING", progress: 48, canPause: true, canCancel: true, state: "INSTALLING" })
      }
      currentQueueSnapshot.active!.progress = 48
      for (const cb of queueChangeListeners) cb(currentQueueSnapshot)
    })
    expect(container.textContent).toContain("48%")
    expect(container.textContent).not.toContain("47%")

    ;(window.electronAPI as any).startSync = origStartSync
  })

  // 25. Server B instalado permanece habilitado para JUGAR mientras Server A está DOWNLOADING o INSTALLING
  it("25. Server B instalado permanece habilitado para JUGAR mientras Server A está DOWNLOADING o INSTALLING", async () => {
    vi.spyOn(gameService, "isGameInstalled").mockImplementation((id: any) => id === "server-b")
    vi.spyOn(gameService, "checkGameManifest").mockImplementation(async (targetId: any, opts: any) => {
      const gId = opts?.gameContext?.gameId || targetId
      if (gId === "server-b") {
        return {
          version: "1.0.0",
          installedModpackVersion: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "VANILLA",
          installed: true,
          hasUpdate: false,
          hasExistingInstall: true,
          totalSizeGB: 1,
          clientFiles: [],
        } as any
      }
      return {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "VANILLA",
        installed: false,
        hasUpdate: true,
        hasExistingInstall: false,
        totalSizeGB: 1,
        clientFiles: [],
      } as any
    })

    currentQueueSnapshot = {
      active: {
        gameId: "server-a",
        state: "SYNCING",
        phase: "DOWNLOADING",
        progress: 30,
        speedMBs: 1,
        downloadedBytes: 300,
        totalBytes: 1000,
        remainingMinutes: 1,
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
              gameId="server-b"
              gameContext={{ gameId: "server-b", gameName: "Aparatia" }}
              left={0}
              top={0}
              theme="dark"
            />
          </div>
        </LanguageProvider>,
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // 1. Con Server A en DOWNLOADING, el botón de Server B está habilitado
    let playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn).not.toBeNull()
    expect(playBtn.textContent).toContain("JUGAR")
    expect(playBtn.disabled).toBe(false)

    // 2. Server A pasa a INSTALLING -> Server B sigue habilitado
    await act(async () => {
      for (const cb of phaseChangeListeners) cb("INSTALLING", "server-a")
    })
    playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn.disabled).toBe(false)

    // 3. Server A pasa a VERIFYING -> Server B se bloquea
    await act(async () => {
      for (const cb of phaseChangeListeners) cb("VERIFYING", "server-a")
    })
    playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn.disabled).toBe(true)

    // 4. Server A termina VERIFYING y vuelve a IDLE -> Server B se desbloquea
    await act(async () => {
      for (const cb of phaseChangeListeners) cb("IDLE", "server-a")
    })
    playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn.disabled).toBe(false)

    // 5. Server A se está ejecutando (running) -> Server B se bloquea
    await act(async () => {
      for (const cb of launchStatusListeners) {
        cb("running", { gameId: "server-a", runningGameId: "server-a" })
      }
    })
    playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn.disabled).toBe(true)

    // 6. Server A se cierra (idle) -> Server B se desbloquea
    await act(async () => {
      for (const cb of launchStatusListeners) {
        cb("idle", { gameId: "server-a", runningGameId: null })
      }
    })
    playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn.disabled).toBe(false)
  })
})

describe("HiKAT Phase 11 — Lightweight Multiserver Navigation & Global Integrity State", () => {
  let container: HTMLDivElement
  let root: any
  let integrityChangeListeners: Function[] = []

  const melioraServer: LauncherServer = {
    id: "meliora",
    name: "Meliora",
    accentColor: "#3b82f6",
    minecraftVersion: "1.20.1",
    modLoader: "FORGE",
    launcherActiveReleaseId: "rel-meliora",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  }

  const apparatiaServer: LauncherServer = {
    id: "apparatia",
    name: "Apparatia",
    accentColor: "#10b981",
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    launcherActiveReleaseId: "rel-apparatia",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  }

  const melioraModpack: PublishedModpack = {
    version: "2.0.0",
    minecraftVersion: "1.20.1",
    modLoader: "FORGE",
    notes: "Meliora Notes",
    clientFiles: [],
  }

  const apparatiaModpack: PublishedModpack = {
    version: "1.5.0",
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    notes: "Apparatia Notes",
    clientFiles: [],
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    integrityChangeListeners = []

    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockImplementation(async (ctx: any) => {
        if (ctx?.gameId === "meliora") {
          return { installedModpackVersion: "2.0.0" }
        }
        if (ctx?.gameId === "apparatia") {
          return { installedModpackVersion: null }
        }
        return { installedModpackVersion: null }
      }),
      getLaunchStatus: vi.fn().mockResolvedValue({
        status: "idle",
        runningGameId: null,
        activeOperationGameId: null,
        activeOperationState: "IDLE",
        activeOperationPhase: null,
      }),
      getDownloadQueue: vi.fn().mockResolvedValue({ active: null, queued: [] }),
      onLaunchStatus: vi.fn(() => () => {}),
      onDownloadProgress: vi.fn(() => () => {}),
      onPhaseChange: vi.fn(() => () => {}),
      onDownloadQueueChanged: vi.fn(() => () => {}),
      onGameFileIntegrityChanged: vi.fn((cb) => {
        integrityChangeListeners.push(cb)
        return () => {
          integrityChangeListeners = integrityChangeListeners.filter((l) => l !== cb)
        }
      }),
      checkSyncPlan: vi.fn().mockResolvedValue({
        success: true,
        isFullyInstalled: true,
        hasExistingInstall: true,
        needsUpdate: false,
        filesToDownload: [],
        hasIntegrityErrors: false,
      }),
      launchGame: vi.fn().mockResolvedValue({ success: true }),
    }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("1. Bootstrap Meliora + Apparatia: consulta published release y version instalada en paralelo SIN checkSyncPlan", async () => {
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue([melioraServer, apparatiaServer])
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockImplementation(async (id?: string) => {
      if (id === "meliora") return melioraModpack
      if (id === "apparatia") return apparatiaModpack
      return null
    })

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      root.render(<Consumer />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(hookState.servers).toHaveLength(2)
    expect(getPublishedSpy).toHaveBeenCalledWith("meliora")
    expect(getPublishedSpy).toHaveBeenCalledWith("apparatia")
    expect((window as any).electronAPI.getInstalledState).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "meliora" })
    )
    expect((window as any).electronAPI.getInstalledState).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "apparatia" })
    )

    // NO checkSyncPlan called during lightweight bootstrap
    expect((window as any).electronAPI.checkSyncPlan).not.toHaveBeenCalled()

    // Meliora: 2.0.0 installed === 2.0.0 published -> play state
    expect(hookState.gameStates.meliora).toEqual({
      publishedModpack: melioraModpack,
      installedVersion: "2.0.0",
      integrityDirty: false,
    })

    // Apparatia: null installed, 1.5.0 published -> download state
    expect(hookState.gameStates.apparatia).toEqual({
      publishedModpack: apparatiaModpack,
      installedVersion: null,
      integrityDirty: false,
    })
  })

  it("2. Meliora -> Apparatia -> Meliora: nunca aparece checking ni llama checkGameManifest ni checkSyncPlan", async () => {
    const checkGameManifestSpy = vi.spyOn(gameService, "checkGameManifest")
    const melioraState = {
      publishedModpack: melioraModpack,
      installedVersion: "2.0.0",
      integrityDirty: false,
    }
    const apparatiaState = {
      publishedModpack: apparatiaModpack,
      installedVersion: null,
      integrityDirty: false,
    }

    // Mount 1: Meliora
    await act(async () => {
      root.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={melioraServer}
            serverGameState={melioraState}
          />
        </LanguageProvider>
      )
    })

    let button = container.querySelector("button") as HTMLButtonElement
    expect(button.textContent).toContain("JUGAR")
    expect(button.textContent).not.toContain("Buscando")
    expect(checkGameManifestSpy).not.toHaveBeenCalled()
    expect((window as any).electronAPI.checkSyncPlan).not.toHaveBeenCalled()

    // Navigate to Apparatia
    await act(async () => {
      root.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={apparatiaServer}
            serverGameState={apparatiaState}
          />
        </LanguageProvider>
      )
    })

    button = container.querySelector("button") as HTMLButtonElement
    expect(button.textContent).toContain("DESCARGAR")
    expect(button.textContent).not.toContain("Buscando")
    expect(checkGameManifestSpy).not.toHaveBeenCalled()
    expect((window as any).electronAPI.checkSyncPlan).not.toHaveBeenCalled()

    // Navigate back to Meliora
    await act(async () => {
      root.render(
        <LanguageProvider>
          <HomeView
            theme="dark"
            selectedServer={melioraServer}
            serverGameState={melioraState}
          />
        </LanguageProvider>
      )
    })

    button = container.querySelector("button") as HTMLButtonElement
    expect(button.textContent).toContain("JUGAR")
    expect(button.textContent).not.toContain("Buscando")
    expect(checkGameManifestSpy).not.toHaveBeenCalled()
    expect((window as any).electronAPI.checkSyncPlan).not.toHaveBeenCalled()
  })

  it("3. Running / downloading / queued recuperados inmediatamente mediante getLaunchStatus/getDownloadQueue", async () => {
    ;(window as any).electronAPI.getLaunchStatus = vi.fn().mockResolvedValue({
      status: "running",
      runningGameId: "meliora",
      activeOperationGameId: null,
      activeOperationState: "IDLE",
      activeOperationPhase: null,
    })

    const melioraState = {
      publishedModpack: melioraModpack,
      installedVersion: "2.0.0",
      integrityDirty: false,
    }

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora"
            gameContext={{ gameId: "meliora", gameName: "Meliora" }}
            publishedModpack={melioraState.publishedModpack}
            installedVersion={melioraState.installedVersion}
            integrityDirty={melioraState.integrityDirty}
          />
        </LanguageProvider>
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.textContent).toContain("EN EJECUCIÓN")
    expect(button.disabled).toBe(true)
  })

  it("4. RELEASE_ACTIVATED de Meliora: solo consulta Meliora, Apparatia no se consulta", async () => {
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue([melioraServer, apparatiaServer])
    let releaseListener: ((e: ReleaseActivatedEvent) => void) | null = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb) => {
      releaseListener = cb
      return () => {
        releaseListener = null
      }
    })

    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockImplementation(async (id?: string) => {
      if (id === "meliora") return melioraModpack
      if (id === "apparatia") return apparatiaModpack
      return null
    })

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      root.render(<Consumer />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(hookState.servers).toHaveLength(2)
    getPublishedSpy.mockClear()

    // Switch to home screen to activate release listener
    await act(async () => {
      hookState.setScreen("home")
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Emit RELEASE_ACTIVATED for Meliora
    const updatedMelioraModpack: PublishedModpack = {
      ...melioraModpack,
      version: "2.1.0",
    }
    getPublishedSpy.mockResolvedValueOnce(updatedMelioraModpack)

    await act(async () => {
      releaseListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "meliora",
        version: "2.1.0",
        minecraftVersion: "1.20.1",
      })
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Only Meliora was queried! Apparatia was NOT queried!
    expect(getPublishedSpy).toHaveBeenCalledWith("meliora")
    expect(getPublishedSpy).not.toHaveBeenCalledWith("apparatia")
    expect(hookState.gameStates.meliora.publishedModpack.version).toBe("2.1.0")
  })

  it("5 & 6. integrityDirty: watcher marca Meliora dirty mientras Apparatia está visible, y al pulsar JUGAR ejecuta checkSyncPlan", async () => {
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue([melioraServer, apparatiaServer])
    vi.spyOn(gameService, "getPublishedModpack").mockImplementation(async (id?: string) => {
      if (id === "meliora") return melioraModpack
      if (id === "apparatia") return apparatiaModpack
      return null
    })

    let hookState: any = null
    function Consumer() {
      hookState = useLauncherState()
      return null
    }

    await act(async () => {
      root.render(<Consumer />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Both servers loaded; Meliora is not dirty
    expect(hookState.gameStates.meliora.integrityDirty).toBe(false)

    // Watcher event arrives for Meliora
    await act(async () => {
      for (const cb of integrityChangeListeners) {
        cb({ gameId: "meliora", changeType: "MODIFIED", filePath: "mods/test.jar" })
      }
    })

    // Meliora is now integrityDirty
    expect(hookState.gameStates.meliora.integrityDirty).toBe(true)

    // Render DownloadPlayButton for Meliora with integrityDirty=true
    let clearDirtyCalled = false
    const clearDirty = () => {
      clearDirtyCalled = true
      hookState.clearIntegrityDirty("meliora")
    }

    // 6a: If checkSyncPlan fails integrity, launch is blocked
    ;(window as any).electronAPI.checkSyncPlan = vi.fn().mockResolvedValue({
      success: true,
      hasIntegrityErrors: true,
      filesToDownload: [{ path: "mods/test.jar", reason: "TAMPERED" }],
    })

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora"
            publishedModpack={hookState.gameStates.meliora.publishedModpack}
            installedVersion={hookState.gameStates.meliora.installedVersion}
            integrityDirty={hookState.gameStates.meliora.integrityDirty}
            onClearIntegrityDirty={clearDirty}
          />
        </LanguageProvider>
      )
    })

    let playBtn = container.querySelector("button") as HTMLButtonElement
    expect(playBtn.textContent).toContain("JUGAR")

    // Click JUGAR
    await act(async () => {
      playBtn.click()
    })
    await act(async () => {
      await Promise.resolve()
    })

    // checkSyncPlan was called to verify integrity
    expect((window as any).electronAPI.checkSyncPlan).toHaveBeenCalled()
    // launchGame was NOT called because integrity failed!
    expect((window as any).electronAPI.launchGame).not.toHaveBeenCalled()
    expect(clearDirtyCalled).toBe(false)

    // 6b: If checkSyncPlan passes integrity, clears dirty and launches
    ;(window as any).electronAPI.checkSyncPlan = vi.fn().mockResolvedValue({
      success: true,
      hasIntegrityErrors: false,
      filesToDownload: [],
      isFullyInstalled: true,
      needsUpdate: false,
    })

    await act(async () => {
      playBtn.click()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(clearDirtyCalled).toBe(true)
    expect((window as any).electronAPI.launchGame).toHaveBeenCalled()
  })
})

