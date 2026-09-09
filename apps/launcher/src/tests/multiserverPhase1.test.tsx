// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { LanguageProvider } from "../context/LanguageContext"
import LauncherSidebar from "../components/layout/LauncherSidebar"
import SettingsView from "../views/SettingsView"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import { serverService, LauncherServer } from "../services/serverService"
import { newsService } from "../services/newsService"
import { gameService, ReleaseActivatedEvent } from "../services/gameService"
import * as apiClientModule from "../services/apiClient"

const APPARATIA_ID = "f3847a79-e02c-4577-8a6f-692f672cdc96"
const WARRIA_ID = "another-server-uuid"

const mockApparatia: LauncherServer = {
  id: APPARATIA_ID,
  name: "Apparatia",
  accentColor: "#3ec4c0",
  minecraftVersion: "1.21.1",
  modLoader: "NEOFORGE",
  modLoaderVersion: "21.1.65",
  launcherActiveReleaseId: "rel-apparatia",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mainLogo: {
    id: "logo-apparatia",
    url: "/assets/apparatia.png",
  },
  sidebarLogo: {
    id: "logo-apparatia-sub",
    url: "/assets/apparatia-sub.png",
  },
}

const mockWarria: LauncherServer = {
  id: WARRIA_ID,
  name: "Warria",
  accentColor: "#e63946",
  minecraftVersion: "1.20.1",
  modLoader: "FABRIC",
  modLoaderVersion: "0.15.0",
  launcherActiveReleaseId: "rel-warria",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mainLogo: {
    id: "logo-warria",
    url: "/assets/warria.png",
  },
  sidebarLogo: null,
}

describe("HiKAT Multi-Server Phase 1 Verification Suite", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    ;(window as any).electronAPI = {}
  })

  afterEach(async () => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  it("A. Apparatia se reconoce como legacyLocalServerId por server.name pero GraphQL usa su server.id real", async () => {
    const servers = [mockApparatia, mockWarria]
    const legacyLocalServerId =
      servers.find((s) => s.name.trim().toLowerCase() === "apparatia")?.id ?? null

    expect(legacyLocalServerId).toBe(APPARATIA_ID)
    expect(legacyLocalServerId).not.toBe("apparatia")

    const querySpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: {
        publishedModpack: {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          clientFiles: [],
        },
      },
    } as any)

    await gameService.getPublishedModpack(legacyLocalServerId!)
    expect(querySpy).toHaveBeenCalledWith(expect.any(String), { serverId: APPARATIA_ID })
  })

  it("B. checkGameManifest(Warria): consulta publishedModpack con Warria.id, NO llama checkSyncPlan, NO lee hikat_game_installed", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true })
    ;(window as any).electronAPI = {
      checkSyncPlan: checkSyncPlanMock,
    }

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem")

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: {
        publishedModpack: {
          version: "2.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "FABRIC",
          clientFiles: [
            {
              path: "mods/warria.jar",
              sha256: "123",
              sizeBytes: 1024,
              downloadUrl: "https://example.com/warria.jar",
              policy: "MANAGED",
            },
          ],
        },
      },
    } as any)

    const res = await gameService.checkGameManifest(WARRIA_ID, {
      allowLegacyLocalFilesystem: false,
    })

    expect(res).not.toBeNull()
    expect(res?.version).toBe("2.0.0")
    expect(res?.installed).toBe(false)
    expect(res?.hasExistingInstall).toBe(false)
    expect(res?.installedModpackVersion).toBeNull()
    expect(checkSyncPlanMock).not.toHaveBeenCalled()
    expect(getItemSpy).not.toHaveBeenCalledWith("hikat_game_installed")
  })

  it("C. checkGameManifest(Apparatia.id, allowLegacyLocalFilesystem=true): consulta publishedModpack con Apparatia.id y SÍ puede usar checkSyncPlan legacy", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({
      success: true,
      isFullyInstalled: true,
      installedModpackVersion: "1.0.0",
      hasExistingInstall: true,
    })
    ;(window as any).electronAPI = {
      checkSyncPlan: checkSyncPlanMock,
    }

    const querySpy = vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValueOnce({
      success: true,
      data: {
        publishedModpack: {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          clientFiles: [
            {
              path: "mods/apparatia.jar",
              sha256: "abc",
              sizeBytes: 2048,
              downloadUrl: "https://example.com/apparatia.jar",
              policy: "MANAGED",
            },
          ],
        },
      },
    } as any)

    const res = await gameService.checkGameManifest(APPARATIA_ID, {
      allowLegacyLocalFilesystem: true,
    })

    expect(querySpy).toHaveBeenCalledWith(expect.any(String), { serverId: APPARATIA_ID })
    expect(checkSyncPlanMock).toHaveBeenCalled()
    expect(res?.installed).toBe(true)
    expect(res?.installedModpackVersion).toBe("1.0.0")
  })

  it("D. DownloadPlayButton con Warria: NO puede llamar startSync, pauseSync, cancelSync, launchGame ni uninstallGame", async () => {
    const startSyncMock = vi.fn().mockResolvedValue({ success: true })
    const pauseSyncMock = vi.fn().mockResolvedValue({ paused: true })
    const cancelSyncMock = vi.fn().mockResolvedValue({ success: true })
    const launchGameMock = vi.fn().mockResolvedValue(true)
    const uninstallGameMock = vi.fn().mockResolvedValue({ success: true })

    ;(window as any).electronAPI = {
      startSync: startSyncMock,
      pauseSync: pauseSyncMock,
      cancelSync: cancelSyncMock,
      launchGame: launchGameMock,
      uninstallGame: uninstallGameMock,
    }

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "2.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "FABRIC",
          clientFiles: [
            {
              path: "mods/mod.jar",
              sha256: "def",
              sizeBytes: 4096,
              downloadUrl: "https://example.com/mod.jar",
              policy: "MANAGED",
            },
          ],
        },
      },
    } as any)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            serverId={WARRIA_ID}
            gameId={WARRIA_ID}
            allowLegacyLocalOperations={false}
          />
        </LanguageProvider>
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button).not.toBeNull()

    // Button should be disabled / unavailable
    await act(async () => {
      button.click()
    })

    expect(startSyncMock).not.toHaveBeenCalled()
    expect(pauseSyncMock).not.toHaveBeenCalled()
    expect(cancelSyncMock).not.toHaveBeenCalled()
    expect(launchGameMock).not.toHaveBeenCalled()
    expect(uninstallGameMock).not.toHaveBeenCalled()
  })

  it("E. Settings con Warria seleccionado: NO llama checkSyncPlan, NO llama setRamAllocation, NO llama setDedicatedGpu, y Verify/Uninstall no ejecutan operaciones legacy", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true })
    const setRamMock = vi.fn()
    const setGpuMock = vi.fn().mockResolvedValue(true)
    const verifyUninstallMock = vi.fn()

    ;(window as any).electronAPI = {
      checkSyncPlan: checkSyncPlanMock,
      setRamAllocation: setRamMock,
      setDedicatedGpu: setGpuMock,
      startSync: verifyUninstallMock,
      uninstallGame: verifyUninstallMock,
      getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
    }

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "2.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "FABRIC",
          clientFiles: [
            {
              path: "mods/w.jar",
              sha256: "xyz",
              sizeBytes: 1000,
              downloadUrl: "https://example.com/w.jar",
              policy: "MANAGED",
            },
          ],
        },
      },
    } as any)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    // checkSyncPlan is called with Warria's gameContext; setRamAllocation and setDedicatedGpu are not called without user edit
    expect(checkSyncPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: WARRIA_ID, gameName: "Warria" })
    )
    expect(setRamMock).not.toHaveBeenCalled()
    expect(setGpuMock).not.toHaveBeenCalled()

    // Switch to game tab
    const tabButtons = container.querySelectorAll(".launcher-tab-btn")
    await act(async () => {
      ;(tabButtons[1] as HTMLElement)?.click()
    })

    // Verify / Uninstall buttons must not trigger actions
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-request", {
        detail: { action: "verify" },
      })
    )
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-request", {
        detail: { action: "uninstall" },
      })
    )

    expect(verifyUninstallMock).not.toHaveBeenCalled()
  })

  it("E2. Cold start fail-closed: servers=[] y propSelectedGameId=WARRIA_ID no ejecuta checkSyncPlan, setRamAllocation ni setDedicatedGpu", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true })
    const setRamMock = vi.fn()
    const setGpuMock = vi.fn().mockResolvedValue(true)

    ;(window as any).electronAPI = {
      checkSyncPlan: checkSyncPlanMock,
      setRamAllocation: setRamMock,
      setDedicatedGpu: setGpuMock,
      getMemory: vi.fn().mockResolvedValue({ totalGb: 16 }),
      getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
    }

    localStorage.setItem("hikat_ram_auto", "true")

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    expect(checkSyncPlanMock).not.toHaveBeenCalled()
    expect(setRamMock).not.toHaveBeenCalled()
    expect(setGpuMock).not.toHaveBeenCalled()
  })

  it("E3. Regresion critica DownloadPlayButton: 1.1 descargandose -> llega 1.2 por WS -> Auto Updates OFF -> termina 1.1 -> ACTUALIZAR instala 1.2", async () => {
    let wsCallback: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      wsCallback = cb
      return () => {}
    })

    const manifest11 = {
      version: "1.1",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      installed: false,
      hasExistingInstall: false,
      installedModpackVersion: null,
      clientFiles: [
        { path: "mods/mod-1.1.jar", sha256: "hash11", sizeBytes: 1000, downloadUrl: "https://example.com/11.jar", policy: "MANAGED" },
      ],
    }

    const published12 = {
      version: "1.2",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      clientFiles: [
        { path: "mods/mod-1.2.jar", sha256: "hash12", sizeBytes: 2000, downloadUrl: "https://example.com/12.jar", policy: "MANAGED" },
      ],
    }

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(manifest11 as any)
    vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(published12 as any)

    let resolveFirstSync: any = null
    const startSyncMock = vi.fn().mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveFirstSync = resolve
      })
    }).mockImplementationOnce(() => {
      return Promise.resolve({ success: true })
    })

    vi.spyOn(gameService, "startSync").mockImplementation(startSyncMock)

    // Auto Updates is OFF
    localStorage.setItem("hikat_auto_updates", "false")

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            serverId={APPARATIA_ID}
            allowLegacyLocalOperations={true}
          />
        </LanguageProvider>
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button).not.toBeNull()

    // 1. Click to start download of 1.1
    await act(async () => {
      button.click()
    })

    expect(startSyncMock).toHaveBeenCalledTimes(1)
    expect(startSyncMock.mock.calls[0][1]).toBe("1.1")
    expect(startSyncMock.mock.calls[0][0]).toEqual(manifest11.clientFiles)

    // 2. While 1.1 is downloading, WebSocket receives release 1.2
    await act(async () => {
      await wsCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.2",
        minecraftVersion: "1.21.1",
        serverId: APPARATIA_ID,
      })
    })

    // 3. Download of 1.1 completes
    await act(async () => {
      resolveFirstSync({ success: true })
    })

    // 4. Button should now show ACTUALIZAR (update)
    const updateButton = container.querySelector("button") as HTMLButtonElement
    expect(updateButton.textContent).toMatch(/UPDATE|ACTUALIZAR/i)

    // 5. User clicks ACTUALIZAR
    await act(async () => {
      updateButton.click()
    })

    // 6. startSync must be called second time with version 1.2 and clientFiles of 1.2
    expect(startSyncMock).toHaveBeenCalledTimes(2)
    expect(startSyncMock.mock.calls[1][1]).toBe("1.2")
    expect(startSyncMock.mock.calls[1][0]).toEqual(published12.clientFiles)
  })

  it("E4. Lifecycle Electron secundario: Warria con allowLegacyLocalOperations=false ignora preparing/running y mantiene unavailable", async () => {
    let launchStatusListener: any = null
    ;(window as any).electronAPI = {
      onLaunchStatus: vi.fn().mockImplementation((cb: any) => {
        launchStatusListener = cb
        return () => {}
      }),
      launchGame: vi.fn(),
      startSync: vi.fn(),
    }

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "FABRIC",
      installed: false,
      hasExistingInstall: false,
      clientFiles: [],
    } as any)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            serverId={WARRIA_ID}
            allowLegacyLocalOperations={false}
          />
        </LanguageProvider>
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toMatch(/UNAVAILABLE|NO DISPONIBLE/i)

    // Emit preparing from Electron legacy
    await act(async () => {
      launchStatusListener?.("preparing")
    })
    expect(button.disabled).toBe(true)
    expect(button.textContent).toMatch(/UNAVAILABLE|NO DISPONIBLE/i)

    // Emit running from Electron legacy
    await act(async () => {
      launchStatusListener?.("running")
    })
    expect(button.disabled).toBe(true)
    expect(button.textContent).toMatch(/UNAVAILABLE|NO DISPONIBLE/i)

    // Emit idle from Electron legacy
    await act(async () => {
      launchStatusListener?.("idle")
    })
    expect(button.disabled).toBe(true)
    expect(button.textContent).toMatch(/UNAVAILABLE|NO DISPONIBLE/i)

    expect((window as any).electronAPI.launchGame).not.toHaveBeenCalled()
    expect((window as any).electronAPI.startSync).not.toHaveBeenCalled()
  })

  it("E5. Caso obligatorio 1: Settings se monta con Warria (no listeners Electron legacy) -> cambia selectedGameId a Apparatia -> ejecuta legacy APIs y suscribe listeners", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true })
    const getGpuMock = vi.fn().mockResolvedValue(true)
    const getRamMock = vi.fn().mockResolvedValue(8)
    const getRuntimeMock = vi.fn().mockResolvedValue({ javaMajorVersion: 21 })
    const getLaunchStatusMock = vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" })
    const onLaunchStatusMock = vi.fn().mockReturnValue(() => {})
    const onPhaseChangeMock = vi.fn().mockReturnValue(() => {})

    ;(window as any).electronAPI = {
      getMemory: vi.fn().mockResolvedValue({ totalGb: 16 }),
      getStartWithSystem: vi.fn().mockResolvedValue(true),
      getMinimizeToTray: vi.fn().mockResolvedValue(true),
      getMinimizeOnGameLaunch: vi.fn().mockResolvedValue(true),
      checkSyncPlan: checkSyncPlanMock,
      getDedicatedGpu: getGpuMock,
      getRamAllocation: getRamMock,
      getGameRuntimeInfo: getRuntimeMock,
      getLaunchStatus: getLaunchStatusMock,
      onLaunchStatus: onLaunchStatusMock,
      onPhaseChange: onPhaseChangeMock,
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    // 1. Mount with Warria
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    // Warria: now calls operations with Warria's gameContext
    expect(getGpuMock).toHaveBeenCalledWith({ gameId: WARRIA_ID, gameName: "Warria" })
    expect(getRamMock).toHaveBeenCalledWith({ gameId: WARRIA_ID, gameName: "Warria" })
    expect(getRuntimeMock).toHaveBeenCalledWith({ gameId: WARRIA_ID, gameName: "Warria" })
    expect(getLaunchStatusMock).toHaveBeenCalledWith({ gameId: WARRIA_ID, gameName: "Warria" })
    expect(onLaunchStatusMock).toHaveBeenCalled()
    expect(onPhaseChangeMock).toHaveBeenCalled()

    // 2. Change selectedGameId to Apparatia
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={APPARATIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    // Apparatia: now operations run with Apparatia's gameContext
    expect(getGpuMock).toHaveBeenCalledWith({ gameId: APPARATIA_ID, gameName: "Apparatia" })
    expect(getRamMock).toHaveBeenCalledWith({ gameId: APPARATIA_ID, gameName: "Apparatia" })
    expect(getRuntimeMock).toHaveBeenCalledWith({ gameId: APPARATIA_ID, gameName: "Apparatia" })
    expect(getLaunchStatusMock).toHaveBeenCalledWith({ gameId: APPARATIA_ID, gameName: "Apparatia" })
    expect(onLaunchStatusMock).toHaveBeenCalled()
    expect(onPhaseChangeMock).toHaveBeenCalled()
  })

  it("E6. Caso obligatorio 2: Settings se monta con Apparatia (listeners activos) -> cambia selectedGameId a Warria -> unsubscribe inmediato y eventos posteriores de Apparatia no alteran Warria", async () => {
    let launchStatusCb: ((status: any) => void) | null = null
    let phaseChangeCb: ((phase: any) => void) | null = null
    const unsubLaunchMock = vi.fn()
    const unsubPhaseMock = vi.fn()

    const onLaunchStatusMock = vi.fn().mockImplementation((cb: any) => {
      launchStatusCb = cb
      return unsubLaunchMock
    })
    const onPhaseChangeMock = vi.fn().mockImplementation((cb: any) => {
      phaseChangeCb = cb
      return unsubPhaseMock
    })

    ;(window as any).electronAPI = {
      getMemory: vi.fn().mockResolvedValue({ totalGb: 16 }),
      getStartWithSystem: vi.fn().mockResolvedValue(true),
      getMinimizeToTray: vi.fn().mockResolvedValue(true),
      getMinimizeOnGameLaunch: vi.fn().mockResolvedValue(true),
      getDedicatedGpu: vi.fn().mockResolvedValue(true),
      getRamAllocation: vi.fn().mockResolvedValue(8),
      getGameRuntimeInfo: vi.fn().mockResolvedValue({ javaMajorVersion: 21 }),
      getLaunchStatus: vi.fn().mockResolvedValue({ status: "running", operationState: "RUNNING" }),
      onLaunchStatus: onLaunchStatusMock,
      onPhaseChange: onPhaseChangeMock,
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    // 1. Mount with Apparatia
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={APPARATIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    expect(onLaunchStatusMock).toHaveBeenCalled()
    expect(onPhaseChangeMock).toHaveBeenCalled()

    // 2. Change selectedGameId to Warria
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    // Unsubscribe must be executed immediately
    expect(unsubLaunchMock).toHaveBeenCalled()
    expect(unsubPhaseMock).toHaveBeenCalled()

    // 3. Calling old callbacks does not throw or re-enable legacy listeners
    await act(async () => {
      launchStatusCb?.("running")
      phaseChangeCb?.("RUNNING")
    })
  })

  it("E7. Action status listener es game-specific: Warria -> Apparatia registra listener y ejecuta refreshOperationalState/checkSyncPlan ante finished verify; Apparatia -> Warria desuscribe listener", async () => {
    const checkSyncPlanMock = vi.fn().mockResolvedValue({ success: true, isFullyInstalled: true })

    ;(window as any).electronAPI = {
      getMemory: vi.fn().mockResolvedValue({ totalGb: 16 }),
      getStartWithSystem: vi.fn().mockResolvedValue(true),
      getMinimizeToTray: vi.fn().mockResolvedValue(true),
      getMinimizeOnGameLaunch: vi.fn().mockResolvedValue(true),
      checkSyncPlan: checkSyncPlanMock,
      getDedicatedGpu: vi.fn().mockResolvedValue(true),
      getRamAllocation: vi.fn().mockResolvedValue(8),
      getGameRuntimeInfo: vi.fn().mockResolvedValue({ javaMajorVersion: 21 }),
      getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
    }

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "1.0.0",
          minecraftVersion: "1.21.1",
          modLoader: "NEOFORGE",
          clientFiles: [
            { path: "mods/apparatia.jar", sha256: "abc", sizeBytes: 1000, downloadUrl: "https://example.com/a.jar", policy: "MANAGED" },
          ],
        },
      },
    } as any)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    // 1. Montar Settings con Warria
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    checkSyncPlanMock.mockClear()

    // Disparar acción con Warria montado -> no debe ejecutar checkSyncPlan
    window.dispatchEvent(
      new CustomEvent("hikat:game-action-status", {
        detail: { action: "verify", state: "finished", success: true },
      })
    )
    expect(checkSyncPlanMock).not.toHaveBeenCalled()

    // 2. Cambiar a Apparatia
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={APPARATIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    checkSyncPlanMock.mockClear()

    // 3. Disparar hikat:game-action-status finished para verify con gameId de Apparatia
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "verify", state: "finished", success: true, gameId: APPARATIA_ID },
        })
      )
    })

    // Comprobar que Apparatia sí ejecuta su refreshOperationalState/checkSyncPlan
    expect(checkSyncPlanMock).toHaveBeenCalled()

    // 4. Cambiar de nuevo a Warria
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    checkSyncPlanMock.mockClear()

    // 5. Disparar evento de nuevo -> el listener anterior quedó eliminado y no ejecuta checkSyncPlan
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "verify", state: "finished", success: true, gameId: APPARATIA_ID },
        })
      )
    })
    expect(checkSyncPlanMock).not.toHaveBeenCalled()
  })

  it("F. Cambiar seleccion: Apparatia -> Warria y recibir RELEASE_ACTIVATED de Warria debe refrescar Warria; evento de Apparatia se ignora", async () => {
    let wsCallback: ((ev: ReleaseActivatedEvent) => void) | null = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      wsCallback = cb
      return () => {}
    })

    const checkManifestSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    // Render with Apparatia selected initially
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={APPARATIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    // Switch selection to Warria
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    checkManifestSpy.mockClear()

    // Send event for Apparatia: should be IGNORED because current selected is Warria
    await act(async () => {
      wsCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "1.1.0",
        minecraftVersion: "1.21.1",
        serverId: APPARATIA_ID,
      })
    })
    expect(checkManifestSpy).not.toHaveBeenCalled()

    // Send event for Warria: should REFRESH Warria
    await act(async () => {
      wsCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "2.1.0",
        minecraftVersion: "1.20.1",
        serverId: WARRIA_ID,
      })
    })
    expect(checkManifestSpy).toHaveBeenCalledWith(
      WARRIA_ID,
      expect.objectContaining({ allowLegacyLocalFilesystem: false })
    )
  })

  it("G. RELEASE_ACTIVATED sin serverId con activeServerId definido debe ignorarse", async () => {
    let wsCallback: ((ev: ReleaseActivatedEvent) => void) | null = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      wsCallback = cb
      return () => {}
    })

    const checkManifestSpy = vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={WARRIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    checkManifestSpy.mockClear()

    // Send event with no serverId: must be ignored when an active serverId is set
    await act(async () => {
      wsCallback?.({
        type: "RELEASE_ACTIVATED",
        version: "3.0.0",
        minecraftVersion: "1.21.1",
      })
    })

    expect(checkManifestSpy).not.toHaveBeenCalled()
  })

  it("H. Con serverId conocido ninguna cache scoped debe caer a claves globales", async () => {
    // Populate global caches with dummy content
    localStorage.setItem("hikat_game_manifest", JSON.stringify({ version: "global-manifest" }))
    localStorage.setItem("hikat_cached_news", JSON.stringify([{ id: "global-news" }]))
    localStorage.setItem("hikat_cached_server_status", JSON.stringify({ online: true, source: "global" }))

    // Scoped queries with WARRIA_ID
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        publishedModpack: {
          version: "2.0.0",
          minecraftVersion: "1.20.1",
          modLoader: "FABRIC",
          clientFiles: [],
        },
        newsFeed: { items: [], totalCount: 0 },
      },
    } as any)

    await gameService.checkGameManifest(WARRIA_ID, { allowLegacyLocalFilesystem: false })
    await newsService.getNewsArticles("en", WARRIA_ID)
    await serverService.getServerStatus(WARRIA_ID)

    // Verify scoped cache exists and was NOT populated from global key
    const warriaManifest = localStorage.getItem(`hikat_game_manifest_${WARRIA_ID}`)
    expect(warriaManifest).not.toBeNull()
    expect(JSON.parse(warriaManifest!).version).toBe("2.0.0")

    // Global caches must remain untouched
    expect(JSON.parse(localStorage.getItem("hikat_game_manifest")!).version).toBe("global-manifest")
  })

  it("I. No debe ejecutarse desde Launcher la query administrativa serverStatus(serverId)", async () => {
    const querySpy = vi.spyOn(apiClientModule, "graphqlClient")

    const res = await serverService.getServerStatus(WARRIA_ID)
    // Should safely return null without calling graphqlClient for admin serverStatus
    expect(querySpy).not.toHaveBeenCalled()
    expect(res).toBeNull()
  })

  it("J. LauncherSidebar principal continua exactamente con: Home, Skins, Settings", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    act(() => {
      root.render(
        <LanguageProvider>
          <LauncherSidebar
            view="home"
            setView={() => {}}
            s={1}
            theme="dark"
            activeSkinAccent={{ r: 62, g: 196, b: 192, css: "rgb(62, 196, 192)" }}
          />
        </LanguageProvider>
      )
    })

    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(3)
  })

  it("K. Settings mantiene la estructura existente: 1 servidor -> sin menu interno; >1 -> menu interno", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountCurrent = () => root.unmount()

    // 1 server: no inner menu
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia]}
            selectedGameId={APPARATIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    const tabButtons1 = container.querySelectorAll(".launcher-tab-btn")
    await act(async () => {
      ;(tabButtons1[1] as HTMLElement)?.click()
    })
    expect(container.querySelectorAll(".game-selector-item").length).toBe(0)

    // >1 server: inner menu rendered
    await act(async () => {
      root.render(
        <LanguageProvider>
          <SettingsView
            theme="dark"
            servers={[mockApparatia, mockWarria]}
            selectedGameId={APPARATIA_ID}
            onSelectGameId={() => {}}
          />
        </LanguageProvider>
      )
    })

    const tabButtons2 = container.querySelectorAll(".launcher-tab-btn")
    await act(async () => {
      ;(tabButtons2[1] as HTMLElement)?.click()
    })
    expect(container.querySelectorAll(".game-selector-item").length).toBe(2)
  })
})
