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
        canPause: true,
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
})
