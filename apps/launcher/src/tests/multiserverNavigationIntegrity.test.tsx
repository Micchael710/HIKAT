// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../context/LanguageContext"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import { gameService } from "../services/gameService"
import type { LauncherServer } from "../services/serverService"

const melioraServer: LauncherServer = {
  id: "meliora-server",
  name: "Meliora",
  accentColor: "#3366ff",
  minecraftVersion: "1.21.1",
  modLoader: "NEOFORGE",
  launcherActiveReleaseId: "rel-meliora-1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
}

const apparatiaServer: LauncherServer = {
  id: "apparatia-server",
  name: "Apparatia",
  accentColor: "#efc436",
  minecraftVersion: "1.21.1",
  modLoader: "NEOFORGE",
  launcherActiveReleaseId: "rel-apparatia-1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
}

describe("HiKAT Multi-Server Navigation & Integrity Suite", () => {
  let container: HTMLDivElement
  let root: any
  let checkSyncPlanMock: any
  let launchGameMock: any
  let integrityListeners: ((event: any) => void)[] = []

  let originalElectronAPI: any = null

  beforeEach(() => {
    localStorage.clear()
    gameService.clearAllServerState()
    localStorage.setItem("hikat_language", "es")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    integrityListeners = []
    originalElectronAPI = (window as any).electronAPI

    checkSyncPlanMock = vi.fn().mockResolvedValue({
      success: true,
      filesToDownload: 0,
      filesToPrune: 0,
      totalDownloadBytes: 0,
      needsUpdate: false,
      isFullyInstalled: true,
      hasExistingInstall: true,
      hasIntegrityIssue: false,
    })

    launchGameMock = vi.fn().mockResolvedValue({ success: true })

    ;(window as any).electronAPI = {
      checkSyncPlan: checkSyncPlanMock,
      launchGame: launchGameMock,
      getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", runningGameId: null }),
      getDownloadQueue: vi.fn().mockResolvedValue({ active: null, queued: [] }),
      onGameFileIntegrityChanged: vi.fn((cb: any) => {
        integrityListeners.push(cb)
        return () => {
          integrityListeners = integrityListeners.filter((l) => l !== cb)
        }
      }),
      onLaunchStatus: vi.fn(() => () => {}),
      onPhaseChange: vi.fn(() => () => {}),
      onDownloadQueueChanged: vi.fn(() => () => {}),
      onDownloadProgress: vi.fn(() => () => {}),
    }

    vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
  })

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
    localStorage.clear()
    gameService.clearAllServerState()
    if (originalElectronAPI !== null) {
      ;(window as any).electronAPI = originalElectronAPI
    } else {
      delete (window as any).electronAPI
    }
    vi.restoreAllMocks()
  })

  it("1. Carga ligera inicial: consulta releases en paralelo sin ejecutar checkSyncPlan completo", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockImplementation(async (serverId) => {
      if (serverId === "meliora-server") {
        return {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          clientFiles: [],
        }
      }
      if (serverId === "apparatia-server") {
        return {
          version: "2.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          clientFiles: [],
        }
      }
      return null
    })

    // Meliora has an installed version
    gameService.setInstalledModpackVersion("meliora-server", "1.0.0")

    await act(async () => {
      await gameService.initializeServersLightweight([melioraServer, apparatiaServer])
    })

    // Verified getPublishedModpack was queried for both servers in parallel
    expect(getPublishedSpy).toHaveBeenCalledWith("meliora-server")
    expect(getPublishedSpy).toHaveBeenCalledWith("apparatia-server")

    // Heavy checkSyncPlan was NOT executed during lightweight initialization
    expect(checkSyncPlanMock).not.toHaveBeenCalled()

    // Server states correctly populated
    const melioraState = gameService.getServerState("meliora-server")
    const apparatiaState = gameService.getServerState("apparatia-server")

    expect(melioraState?.status).toBe("play")
    expect(apparatiaState?.status).toBe("download")
  })

  it("2. Cambiar Meliora -> Apparatia -> Meliora no vuelve a mostrar 'checking' ni repite verificacion pesada", async () => {
    // Populate cached states
    gameService.setServerState("meliora-server", {
      status: "play",
      manifest: {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        installed: true,
        hasExistingInstall: true,
        hasUpdate: false,
        clientFiles: [],
      },
    })
    gameService.setServerState("apparatia-server", {
      status: "download",
      manifest: {
        version: "2.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        installed: false,
        hasExistingInstall: false,
        hasUpdate: false,
        clientFiles: [],
      },
    })

    // 1. Mount Meliora
    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora-server"
            gameContext={{ gameId: "meliora-server", gameName: "Meliora" }}
          />
        </LanguageProvider>,
      )
    })

    const melioraBtn = container.querySelector("button")
    expect(melioraBtn).not.toBeNull()
    expect(melioraBtn?.textContent).toContain("JUGAR")
    expect(melioraBtn?.textContent).not.toContain("BUSCANDO")
    expect(checkSyncPlanMock).not.toHaveBeenCalled()

    // 2. Unmount Meliora and mount Apparatia
    await act(async () => {
      root.unmount()
      container.innerHTML = ""
      root = createRoot(container)
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="apparatia-server"
            gameContext={{ gameId: "apparatia-server", gameName: "Apparatia" }}
          />
        </LanguageProvider>,
      )
    })

    const apparatiaBtn = container.querySelector("button")
    expect(apparatiaBtn).not.toBeNull()
    expect(apparatiaBtn?.textContent).toContain("DESCARGAR")
    expect(apparatiaBtn?.textContent).not.toContain("BUSCANDO")
    expect(checkSyncPlanMock).not.toHaveBeenCalled()

    // 3. Switch back to Meliora
    await act(async () => {
      root.unmount()
      container.innerHTML = ""
      root = createRoot(container)
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora-server"
            gameContext={{ gameId: "meliora-server", gameName: "Meliora" }}
          />
        </LanguageProvider>,
      )
    })

    const melioraReturnBtn = container.querySelector("button")
    expect(melioraReturnBtn).not.toBeNull()
    expect(melioraReturnBtn?.textContent).toContain("JUGAR")
    expect(melioraReturnBtn?.textContent).not.toContain("BUSCANDO")
    // Still no heavy checkSyncPlan called during navigation
    expect(checkSyncPlanMock).not.toHaveBeenCalled()
  })

  it("3. WebSocket RELEASE_ACTIVATED actualiza solo el servidor correspondiente", async () => {
    gameService.setServerState("meliora-server", {
      status: "play",
      manifest: {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        installed: true,
        hasExistingInstall: true,
        hasUpdate: false,
        clientFiles: [],
      },
    })
    gameService.setInstalledModpackVersion("meliora-server", "1.0.0")

    gameService.setServerState("apparatia-server", {
      status: "download",
      manifest: {
        version: "2.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        installed: false,
        hasExistingInstall: false,
        hasUpdate: false,
        clientFiles: [],
      },
    })

    // New release for Meliora arrives via WebSocket
    await act(async () => {
      await gameService.handleReleaseActivatedEvent({
        type: "RELEASE_ACTIVATED",
        serverId: "meliora-server",
        version: "1.0.1",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
      })
    })

    // Meliora now has update available
    const melioraState = gameService.getServerState("meliora-server")
    expect(melioraState?.status).toBe("update")
    expect(melioraState?.manifest?.hasUpdate).toBe(true)
    expect(melioraState?.manifest?.version).toBe("1.0.1")

    // Apparatia remains untouched in "download"
    const apparatiaState = gameService.getServerState("apparatia-server")
    expect(apparatiaState?.status).toBe("download")
    expect(apparatiaState?.manifest?.version).toBe("2.0.0")
  })

  it("4 & 5. Modificar archivo NO_MODIFICABLE de Meliora mientras se ve Apparatia marca Meliora como bloqueado y permanece bloqueado al volver", async () => {
    gameService.setServerState("meliora-server", {
      status: "play",
      manifest: {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        installed: true,
        hasExistingInstall: true,
        hasUpdate: false,
        clientFiles: [
          { path: "mods/core.jar", sha256: "abc", sizeBytes: 100, downloadUrl: "/dl/core", policy: "NO_MODIFICABLE" },
        ],
      },
    })

    // User is currently viewing Apparatia
    gameService.setServerState("apparatia-server", {
      status: "download",
      manifest: null,
    })

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="apparatia-server"
            gameContext={{ gameId: "apparatia-server", gameName: "Apparatia" }}
          />
        </LanguageProvider>,
      )
    })

    // Meliora is NOT currently dirty
    expect(gameService.isServerIntegrityDirty("meliora-server")).toBe(false)

    // Electron detects NO_MODIFICABLE alteration in Meliora directory and emits event
    act(() => {
      gameService.setServerIntegrityDirty("meliora-server", true)
    })

    // Meliora is now marked dirty globally even though Apparatia is currently rendered
    expect(gameService.isServerIntegrityDirty("meliora-server")).toBe(true)

    // Switch back to Meliora
    await act(async () => {
      root.unmount()
      container.innerHTML = ""
      root = createRoot(container)
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora-server"
            gameContext={{ gameId: "meliora-server", gameName: "Meliora" }}
          />
        </LanguageProvider>,
      )
    })

    // Meliora displays JUGAR
    const melioraBtn = container.querySelector("button")
    expect(melioraBtn).not.toBeNull()
    expect(melioraBtn?.textContent).toContain("JUGAR")

    // Mock checkSyncPlan to return integrity violation
    checkSyncPlanMock.mockResolvedValueOnce({
      success: true,
      hasIntegrityIssue: true,
      isFullyInstalled: false,
    })

    // User clicks JUGAR
    await act(async () => {
      melioraBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Pre-launch check was triggered for the dirty server
    expect(checkSyncPlanMock).toHaveBeenCalled()
    // Launch was BLOCKED - launchGame was NOT called
    expect(launchGameMock).not.toHaveBeenCalled()
    // Server remains integrity dirty
    expect(gameService.isServerIntegrityDirty("meliora-server")).toBe(true)
  })

  it("6. Archivos MODIFICABLE no marcan servidor como dirty y permiten jugar", async () => {
    gameService.setServerState("meliora-server", {
      status: "play",
      manifest: {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        installed: true,
        hasExistingInstall: true,
        hasUpdate: false,
        clientFiles: [],
      },
    })
    // Server is NOT dirty (only MODIFICABLE files were changed, watcher ignored them)
    expect(gameService.isServerIntegrityDirty("meliora-server")).toBe(false)

    const onPlayMock = vi.fn()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora-server"
            gameContext={{ gameId: "meliora-server", gameName: "Meliora" }}
            onPlay={onPlayMock}
          />
        </LanguageProvider>,
      )
    })

    const btn = container.querySelector("button")
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    // Launches without being blocked by integrity check
    expect(onPlayMock).toHaveBeenCalled()
  })

  it("7. Operaciones de descarga, instalacion, cola y juego mantienen correctamente su estado por servidor", async () => {
    // Server A: actively downloading
    gameService.setServerState("meliora-server", {
      status: "downloading",
      progress: 65,
      speed: 12.5,
      totalBytes: 500000000,
      downloadedBytes: 325000000,
      timeRemainingMin: 1,
      currentPhase: "DOWNLOADING",
      pausedPhase: "downloading",
      manifest: {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        totalSizeGB: 1,
        clientFiles: [],
        installed: false,
        hasExistingInstall: false,
        hasUpdate: false,
      },
    })

    // Server B: queued
    gameService.setServerState("apparatia-server", {
      status: "queued",
      manifest: null,
    })

    // Mount Server B: shows QUEUED
    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="apparatia-server"
            gameContext={{ gameId: "apparatia-server", gameName: "Apparatia" }}
          />
        </LanguageProvider>,
      )
    })

    const btnB = container.querySelector("button")
    expect(btnB?.textContent).toContain("EN COLA")

    // Mount Server A: shows DOWNLOADING with 65% progress immediately
    await act(async () => {
      root.unmount()
      container.innerHTML = ""
      root = createRoot(container)
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            serverId="meliora-server"
            gameContext={{ gameId: "meliora-server", gameName: "Meliora" }}
          />
        </LanguageProvider>,
      )
    })

    expect(container.textContent).toContain("DESCARGANDO")
    expect(container.textContent).toContain("65%")
    expect(container.textContent).not.toContain("BUSCANDO")
    expect(checkSyncPlanMock).not.toHaveBeenCalled()
  })
})
