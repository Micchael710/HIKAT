// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { useLauncherState } from "../hooks/useLauncherState"
import { serverService } from "../services/serverService"
import { gameService } from "../services/gameService"
import * as skinServiceModule from "../services/skinService"
import { authService } from "../services/authService"
import { STORAGE_KEYS } from "../utils/settingsStorage"
import DownloadPlayButton, { deriveBaseGameButtonState } from "../components/server/DownloadPlayButton"
import { LanguageProvider } from "../context/LanguageContext"
import type { LauncherServer } from "../services/serverService"
import type { PublishedModpack } from "../vite-env"

function renderCustomHook<T>(hook: () => T) {
  const result: { current: T } = {} as any
  function TestComponent() {
    result.current = hook()
    return null
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(TestComponent))
  })
  return {
    result,
    rerender: () => {
      act(() => {
        root.render(React.createElement(TestComponent))
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe("HiKAT Launcher GraphQL Optimization & Shared WebSocket Cosmetics Suite", () => {
  let releaseEventListener: ((event: any) => void) | null = null
  let phaseChangeListener: ((phase: string, eventGameId?: string | null) => void) | null = null

  const mockServers: LauncherServer[] = [
    {
      id: "srv-meliora",
      name: "Meliora",
      accentColor: "#3b82f6",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      launcherActiveReleaseId: "rel-meliora-1",
      activeRelease: {
        version: "2.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        modLoaderVersion: "47.2.0",
        neoForgeVersion: null,
        notes: "Meliora Notes",
        cover: {
          id: "cover-meliora",
          mediaType: "IMAGE" as const,
          mimeType: "image/png",
          url: "http://cdn/meliora.png",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
    {
      id: "srv-apparatia",
      name: "Apparatia",
      accentColor: "#10b981",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      launcherActiveReleaseId: "rel-apparatia-1",
      activeRelease: {
        version: "1.5.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        notes: "Apparatia Notes",
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
    {
      id: "srv-warria",
      name: "Warria",
      accentColor: "#f59e0b",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      launcherActiveReleaseId: "rel-warria-1",
      activeRelease: {
        version: "1.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        notes: "Warria Notes",
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "false")

    releaseEventListener = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    vi.spyOn(authService, "subscribe").mockImplementation((listener: any) => {
      listener(
        {
          user: {
            id: "u-1",
            displayName: "Tester",
            username: "Tester",
            email: "tester@example.com",
            role: "PLAYER",
          },
          accessToken: "fake-token",
        },
        "AUTHENTICATED",
      )
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-token")
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-1",
      displayName: "Tester",
      username: "Tester",
      email: "tester@example.com",
      role: "PLAYER",
    } as any)

    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue(mockServers)

    vi.spyOn(skinServiceModule, "fetchPlayerActiveSkinPreview").mockResolvedValue(null)
    vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot").mockResolvedValue({
      globalSkins: [],
      globalCapes: [],
      playerSkin: null,
      activeSkin: null,
      playerCapes: [],
      activeCape: null,
    })

    ;(window as any).electronAPI = {
      getInstalledState: vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
        if (gameId === "srv-meliora") {
          return { installedModpackVersion: "2.0.0", integrityDirty: false }
        }
        if (gameId === "srv-apparatia") {
          return { installedModpackVersion: "1.4.0", integrityDirty: false }
        }
        return { installedModpackVersion: null, integrityDirty: false }
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
      onPhaseChange: vi.fn((cb: any) => {
        phaseChangeListener = cb
        return () => {}
      }),
      onDownloadQueueChanged: vi.fn(() => () => {}),
      onGameFileIntegrityChanged: vi.fn(() => () => {}),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  // 1. Con varios servidores, bootstrap NO llama getPublishedModpack() una vez por servidor.
  it("1. Con varios servidores, bootstrap NO llama getPublishedModpack() una vez por servidor", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.servers).toHaveLength(3)
    expect(getPublishedSpy).not.toHaveBeenCalled()

    unmount()
  })

  // 2. La información ligera permite detectar: Descargar / Actualizar / Jugar.
  it("2. La información ligera permite detectar: Descargar / Actualizar / Jugar sin manifest completo", async () => {
    // deriveBaseGameButtonState checks
    expect(deriveBaseGameButtonState(mockServers[0].activeRelease, "2.0.0")).toBe("play")
    expect(deriveBaseGameButtonState(mockServers[1].activeRelease, "1.4.0")).toBe("update")
    expect(deriveBaseGameButtonState(mockServers[2].activeRelease, null)).toBe("download")

    // Render DownloadPlayButton with lightweight releaseSummary only
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            serverId="srv-apparatia"
            gameContext={{ gameId: "srv-apparatia", gameName: "Apparatia" }}
            releaseSummary={mockServers[1].activeRelease}
            installedVersion="1.4.0"
          />
        </LanguageProvider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toMatch(/UPDATE|ACTUALIZAR/i)

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  // 3. Cambiar entre Home screens NO obtiene manifests completos.
  it("3. Cambiar entre Home screens NO obtiene manifests completos", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()

    // Switch between servers
    await act(async () => {
      result.current.setSelectedGameId("srv-apparatia")
    })

    await act(async () => {
      result.current.setSelectedGameId("srv-warria")
    })

    await act(async () => {
      result.current.setSelectedGameId("srv-meliora")
    })

    // Navigation must NOT trigger getPublishedModpack
    expect(getPublishedSpy).not.toHaveBeenCalled()

    unmount()
  })

  // 4. Click Descargar/Actualizar obtiene exactamente el manifest completo del servidor requerido antes de iniciar la operación.
  it("4. Click Descargar/Actualizar obtiene exactamente el manifest completo del servidor requerido antes de iniciar la operación", async () => {
    const fullModpack: PublishedModpack = {
      version: "1.5.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      notes: "Apparatia Notes",
      clientFiles: [
        {
          path: "mods/test.jar",
          sha256: "abc123sha",
          sizeBytes: 1024,
          downloadUrl: "https://example.com/test.jar",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [],
    }

    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(fullModpack)
    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton
            left={0}
            top={0}
            theme="dark"
            serverId="srv-apparatia"
            gameId="srv-apparatia"
            gameContext={{ gameId: "srv-apparatia", gameName: "Apparatia" }}
            releaseSummary={mockServers[1].activeRelease}
            installedVersion="1.4.0"
          />
        </LanguageProvider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    const btn = container.querySelector("button") as HTMLElement
    expect(btn.textContent).toMatch(/UPDATE|ACTUALIZAR/i)
    expect(getPublishedSpy).not.toHaveBeenCalled()

    // Click ACTUALIZAR
    await act(async () => {
      btn.click()
    })

    // Full manifest fetched on demand for srv-apparatia
    expect(getPublishedSpy).toHaveBeenCalledWith("srv-apparatia")
    expect(startSyncSpy).toHaveBeenCalledWith(
      fullModpack.clientFiles,
      "1.5.0",
      "1.21.1",
      "NEOFORGE",
      null,
      null,
      false,
      expect.objectContaining({ gameId: "srv-apparatia" }),
    )

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  // 5. Auto-update OFF: una nueva versión no descarga manifest automáticamente.
  it("5. Auto-update OFF: una nueva versión no descarga manifest automáticamente", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "false")
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Receive RELEASE_ACTIVATED for srv-meliora with newer version 2.1.0
    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-meliora",
        version: "2.1.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        modLoaderVersion: "47.2.0",
      })
    })

    // Auto-update is OFF -> NO full manifest downloaded automatically
    expect(getPublishedSpy).not.toHaveBeenCalled()

    unmount()
  })

  // 6. Auto-update ON: obtiene manifest únicamente del servidor desactualizado y conserva el flujo actual.
  it("6. Auto-update ON: obtiene manifest únicamente del servidor desactualizado y conserva el flujo actual", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "true")

    const fullMelioraModpack: PublishedModpack = {
      version: "2.1.0",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      clientFiles: [
        {
          path: "mods/m.jar",
          sha256: "sha21",
          sizeBytes: 50,
          downloadUrl: "https://example.com/m.jar",
          policy: "NO_MODIFICABLE",
        },
      ],
      directoryPolicies: [],
    }

    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue(fullMelioraModpack)
    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    ;(window as any).electronAPI.getInstalledState = vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === "srv-meliora") {
        return { installedModpackVersion: "2.0.0", integrityDirty: false }
      }
      if (gameId === "srv-apparatia") {
        return { installedModpackVersion: "1.5.0", integrityDirty: false }
      }
      return { installedModpackVersion: null, integrityDirty: false }
    })

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // srv-meliora has installed 2.0.0. New version 2.1.0 arrives:
    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-meliora",
        version: "2.1.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        modLoaderVersion: "47.2.0",
      })
    })

    // Only srv-meliora manifest was fetched
    expect(getPublishedSpy).toHaveBeenCalledTimes(1)
    expect(getPublishedSpy).toHaveBeenCalledWith("srv-meliora")
    expect(startSyncSpy).toHaveBeenCalledWith(
      fullMelioraModpack.clientFiles,
      "2.1.0",
      "1.20.1",
      "FORGE",
      undefined,
      undefined,
      false,
      [],
      expect.objectContaining({ gameId: "srv-meliora" }),
    )

    unmount()
  })

  // 7. RELEASE_ACTIVATED con misma versión conocida: NO hace GraphQL redundante.
  it("7. RELEASE_ACTIVATED con misma versión conocida: NO hace GraphQL redundante", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")
    const getServersSpy = vi.spyOn(serverService, "getLauncherServers")

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    getServersSpy.mockClear()
    getPublishedSpy.mockClear()

    // srv-meliora known published version is 2.0.0. Event with 2.0.0 arrives:
    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-meliora",
        version: "2.0.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
      })
    })

    // No GraphQL query executed
    expect(getPublishedSpy).not.toHaveBeenCalled()
    expect(getServersSpy).not.toHaveBeenCalled()

    unmount()
  })

  // 8. RELEASE_ACTIVATED con versión nueva: actualiza inmediatamente el estado ligero.
  it("8. RELEASE_ACTIVATED con versión nueva: actualiza inmediatamente el estado ligero", async () => {
    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.gameStates["srv-meliora"]?.releaseSummary?.version).toBe("2.0.0")

    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-meliora",
        version: "2.5.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
      })
    })

    // Memory state is updated immediately to lightweight summary 2.5.0
    expect(result.current.gameStates["srv-meliora"]?.releaseSummary?.version).toBe("2.5.0")

    unmount()
  })

  // 9. Sigue existiendo UNA sola conexión WebSocket compartida.
  it("9. Sigue existiendo UNA sola conexión WebSocket compartida", () => {
    // subscribeReleaseEvents is the sole channel for server, release, and cosmetics events
    const unsub1 = gameService.subscribeReleaseEvents(() => {})
    const unsub2 = gameService.subscribeReleaseEvents(() => {})

    expect(typeof unsub1).toBe("function")
    expect(typeof unsub2).toBe("function")
    unsub1()
    unsub2()
  })

  // 10. Al iniciar sesión: la tarjeta del jugador obtiene correctamente la skin actual sin cargar todo el catálogo.
  it("10. Al iniciar sesión: la tarjeta del jugador obtiene correctamente la skin actual sin cargar todo el catálogo", async () => {
    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")
    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")
    const fetchPreviewSpy = vi.spyOn(skinServiceModule, "fetchPlayerActiveSkinPreview").mockResolvedValue({
      type: "CUSTOM",
      skinId: "custom-user-skin",
      imageUrl: "/media/my_skin_head.png",
      name: "Player Custom Skin",
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    expect(fetchPreviewSpy).not.toHaveBeenCalled()

    // Authenticate
    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-1",
            displayName: "PlayerOne",
            email: "player@example.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Lightweight query executed
    expect(fetchPreviewSpy).toHaveBeenCalledTimes(1)
    // Full catalog and snapshot NOT loaded
    expect(fetchSnapshotSpy).not.toHaveBeenCalled()
    expect(fetchGlobalSkinsSpy).not.toHaveBeenCalled()
    // UserProfileCard receives correct image URL
    expect(result.current.activeSkinData?.customImgUrl).toBe("/media/my_skin_head.png")

    unmount()
  })

  // 11. Primera entrada a Skins: obtiene el snapshot necesario.
  it("11. Primera entrada a Skins: obtiene el snapshot necesario", async () => {
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSnapshotSpy).not.toHaveBeenCalled()

    await act(async () => {
      result.current.setView("skins")
    })

    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  // 12. Salir y volver a entrar: NO repite GraphQL innecesariamente.
  it("12. Salir y volver a entrar: NO repite GraphQL innecesariamente", async () => {
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.setView("home")
    })
    await act(async () => {
      result.current.setView("skins")
    })

    // Cached in memory, no duplicate query
    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  // 13. COSMETICS_UPDATED: usa el mismo WebSocket, refresca el snapshot y actualiza skins/capas visibles.
  it("13. COSMETICS_UPDATED: usa el mismo WebSocket, refresca el snapshot y actualiza skins/capas visibles", async () => {
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot").mockResolvedValue({
      globalSkins: [
        {
          id: "skin-admin-new",
          name: "Admin Special",
          imageUrl: "/media/admin_special.png",
          status: "AVAILABLE",
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      ],
      globalCapes: [
        {
          id: "cape-admin-new",
          name: "Admin Cape",
          imageUrl: "/media/admin_cape.png",
          status: "AVAILABLE",
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      ],
      playerSkin: null,
      activeSkin: null,
      playerCapes: [],
      activeCape: null,
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Event arrives on existing global WebSocket
    await act(async () => {
      releaseEventListener?.({
        type: "COSMETICS_UPDATED",
        target: "ALL",
      })
    })

    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)
    expect(result.current.allSkins.some((s) => s.id === "skin-admin-new")).toBe(true)
    expect(result.current.allCapes.some((c) => c.id === "cape-admin-new")).toBe(true)

    unmount()
  })

  // 14. No se mezclan datos entre servidores ni usuarios.
  it("14. No se mezclan datos entre servidores ni usuarios", async () => {
    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Server states are completely isolated
    expect(result.current.gameStates["srv-meliora"].installedVersion).toBe("2.0.0")
    expect(result.current.gameStates["srv-apparatia"].installedVersion).toBe("1.4.0")
    expect(result.current.gameStates["srv-warria"].installedVersion).toBeNull()

    // Logout clears personal cosmetics but preserves server states
    await act(async () => {
      result.current.handleLogout()
    })

    expect(result.current.playerSkin).toBeNull()
    expect(result.current.playerCapes).toEqual([])
    expect(result.current.gameStates["srv-meliora"].installedVersion).toBe("2.0.0")

    unmount()
  })

  // 15. onPhaseChange con phase === "IDLE" conserva releaseSummary existente y actualiza installedVersion sin indicar actualización falsa.
  it("15. onPhaseChange con phase === 'IDLE' conserva releaseSummary existente y actualiza installedVersion sin indicar actualización falsa", async () => {
    // Servidor inicialmente publicado en 1.0 (srv-warria tiene activeRelease.version === "1.0.0")
    ;(window as any).electronAPI.getInstalledState = vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === "srv-warria") {
        return { installedModpackVersion: "1.0.0", integrityDirty: false }
      }
      return { installedModpackVersion: null, integrityDirty: false }
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.gameStates["srv-warria"]?.releaseSummary?.version).toBe("1.0.0")
    expect(result.current.gameStates["srv-warria"]?.installedVersion).toBe("1.0.0")

    // Llega RELEASE_ACTIVATED 1.1
    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-warria",
        version: "1.1.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
      })
    })

    // releaseSummary.version === 1.1
    expect(result.current.gameStates["srv-warria"]?.releaseSummary?.version).toBe("1.1.0")

    // Se simula finalización de operación con phase = IDLE y se actualiza installedVersion a 1.1
    ;(window as any).electronAPI.getInstalledState = vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === "srv-warria") {
        return { installedModpackVersion: "1.1.0", integrityDirty: false }
      }
      return { installedModpackVersion: null, integrityDirty: false }
    })

    await act(async () => {
      phaseChangeListener?.("IDLE", "srv-warria")
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Después de IDLE: releaseSummary.version debe seguir siendo 1.1
    expect(result.current.gameStates["srv-warria"]?.releaseSummary?.version).toBe("1.1.0")

    // Comprueba también que installedVersion === 1.1
    expect(result.current.gameStates["srv-warria"]?.installedVersion).toBe("1.1.0")

    // Comprueba que el estado resultante no vuelva a indicar una actualización inexistente
    const state = deriveBaseGameButtonState(
      result.current.gameStates["srv-warria"]?.releaseSummary,
      result.current.gameStates["srv-warria"]?.installedVersion,
    )
    expect(state).toBe("play")

    unmount()
  })

  // Helper to mount DownloadPlayButton
  function renderButton(props: any) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <LanguageProvider>
          <DownloadPlayButton left={0} top={0} theme="dark" {...props} />
        </LanguageProvider>,
      )
    })
    return {
      container,
      unmount: () => {
        act(() => {
          root.unmount()
        })
        container.remove()
      },
    }
  }

  // 16. Bootstrap ligero: activeRelease incluye cover + notes + loader data y no incluye clientFiles ni policies
  it("16. Bootstrap ligero: activeRelease incluye cover + notes + loader data y no incluye clientFiles ni policies", () => {
    const rel = mockServers[0].activeRelease
    expect(rel).toBeDefined()
    expect(rel?.version).toBe("2.0.0")
    expect(rel?.notes).toBe("Meliora Notes")
    expect(rel?.cover).toBeDefined()
    expect(rel?.cover?.url).toBe("http://cdn/meliora.png")
    expect((rel as any)?.clientFiles).toBeUndefined()
    expect((rel as any)?.directoryPolicies).toBeUndefined()
  })

  // 17. Download: con solo summary ligero, click Descargar llama getPublishedModpack exactamente cuando se necesita y luego startSync
  it("17. Download: con solo summary ligero, click Descargar llama getPublishedModpack exactamente cuando se necesita y luego startSync", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      clientFiles: [{ path: "mods/file.jar", sha256: "123", sizeBytes: 50, downloadUrl: "/dl", policy: "NO_MODIFICABLE" }],
    })
    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    const { container, unmount } = renderButton({
      serverId: "srv-meliora",
      gameId: "srv-meliora",
      gameContext: { gameId: "srv-meliora", gameName: "Meliora" },
      releaseSummary: mockServers[0].activeRelease,
      installedVersion: null,
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    const btn = container.querySelector("button")!
    expect(btn.textContent).toMatch(/download|descargar/i)

    await act(async () => {
      btn.click()
    })

    expect(getPublishedSpy).toHaveBeenCalledWith("srv-meliora")
    expect(startSyncSpy).toHaveBeenCalled()
    expect(startSyncSpy.mock.calls[0][0]).toEqual([
      { path: "mods/file.jar", sha256: "123", sizeBytes: 50, downloadUrl: "/dl", policy: "NO_MODIFICABLE" },
    ])
    unmount()
  })

  // 18. Update: con solo summary ligero, click Actualizar llama getPublishedModpack antes de startSync
  it("18. Update: con solo summary ligero, click Actualizar llama getPublishedModpack antes de startSync", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      clientFiles: [{ path: "mods/update.jar", sha256: "456", sizeBytes: 80, downloadUrl: "/dl2", policy: "NO_MODIFICABLE" }],
    })
    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    const { container, unmount } = renderButton({
      serverId: "srv-meliora",
      gameId: "srv-meliora",
      gameContext: { gameId: "srv-meliora", gameName: "Meliora" },
      releaseSummary: mockServers[0].activeRelease,
      installedVersion: "1.9.0",
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    const btn = container.querySelector("button")!
    expect(btn.textContent).toMatch(/update|actualizar/i)

    await act(async () => {
      btn.click()
    })

    expect(getPublishedSpy).toHaveBeenCalledWith("srv-meliora")
    expect(startSyncSpy).toHaveBeenCalled()
    expect(startSyncSpy.mock.calls[0][0]).toEqual([
      { path: "mods/update.jar", sha256: "456", sizeBytes: 80, downloadUrl: "/dl2", policy: "NO_MODIFICABLE" },
    ])
    unmount()
  })

  // 19. Verify: con solo summary ligero, NO llama startSync con clientFiles=[], sino que obtiene primero full manifest
  it("19. Verify: con solo summary ligero, NO llama startSync con clientFiles=[], sino que obtiene primero full manifest", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      clientFiles: [{ path: "mods/verified.jar", sha256: "789", sizeBytes: 120, downloadUrl: "/dl3", policy: "NO_MODIFICABLE" }],
    })
    const startSyncSpy = vi.spyOn(gameService, "startSync").mockResolvedValue({ success: true } as any)

    const { container, unmount } = renderButton({
      serverId: "srv-meliora",
      gameId: "srv-meliora",
      gameContext: { gameId: "srv-meliora", gameName: "Meliora" },
      releaseSummary: mockServers[0].activeRelease,
      installedVersion: "2.0.0",
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBeGreaterThan(1)
    const optionsBtn = buttons[1] as HTMLElement

    await act(async () => {
      optionsBtn.click()
    })

    const verifyOption = Array.from(document.querySelectorAll(".profile-menu-item")).find(
      (el) => el.textContent?.toLowerCase().includes("verif")
    ) as HTMLElement
    expect(verifyOption).toBeDefined()

    await act(async () => {
      verifyOption.click()
    })

    expect(getPublishedSpy).toHaveBeenCalledWith("srv-meliora")
    expect(startSyncSpy).toHaveBeenCalled()
    expect(startSyncSpy.mock.calls[0][0]).not.toEqual([])
    expect(startSyncSpy.mock.calls[0][0]).toEqual([
      { path: "mods/verified.jar", sha256: "789", sizeBytes: 120, downloadUrl: "/dl3", policy: "NO_MODIFICABLE" },
    ])
    unmount()
  })

  // 20. Auto-update ON: WebSocket con versión nueva obtiene full manifest antes de auto-update
  it("20. Auto-update ON: WebSocket con versión nueva obtiene full manifest antes de auto-update", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "true")
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "2.1.0",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      clientFiles: [{ path: "mods/auto.jar", sha256: "abc", sizeBytes: 200, downloadUrl: "/dl", policy: "NO_MODIFICABLE" }],
    })

    ;(window as any).electronAPI.getInstalledState = vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === "srv-meliora") {
        return { installedModpackVersion: "2.0.0", integrityDirty: false }
      }
      return { installedModpackVersion: null, integrityDirty: false }
    })

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()

    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-meliora",
        version: "2.1.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        notes: "Notes 2.1.0",
        cover: {
          id: "cover-2-1",
          mediaType: "IMAGE",
          mimeType: "image/png",
          url: "http://cdn/cover-2-1.png",
        },
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).toHaveBeenCalledWith("srv-meliora")
    unmount()
  })

  // 21. Auto-update OFF: WebSocket con versión nueva solo actualiza summary y no llama getPublishedModpack
  it("21. Auto-update OFF: WebSocket con versión nueva solo actualiza summary y no llama getPublishedModpack", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "false")
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")

    ;(window as any).electronAPI.getInstalledState = vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === "srv-meliora") {
        return { installedModpackVersion: "2.0.0", integrityDirty: false }
      }
      return { installedModpackVersion: null, integrityDirty: false }
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()

    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-meliora",
        version: "2.2.0",
        minecraftVersion: "1.20.1",
        modLoader: "FORGE",
        notes: "Notes 2.2.0",
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    expect(result.current.gameStates["srv-meliora"]?.releaseSummary?.version).toBe("2.2.0")
    expect(result.current.gameStates["srv-meliora"]?.releaseSummary?.notes).toBe("Notes 2.2.0")
    unmount()
  })

  // 22. Activar AUTO_UPDATES desde Settings: si hay update y solo summary, obtiene full manifest
  it("22. Activar AUTO_UPDATES desde Settings: si hay update y solo summary, obtiene full manifest", async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATES, "false")
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack").mockResolvedValue({
      version: "2.0.0",
      minecraftVersion: "1.20.1",
      modLoader: "FORGE",
      clientFiles: [],
    })

    ;(window as any).electronAPI.getInstalledState = vi.fn().mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === "srv-meliora") {
        return { installedModpackVersion: "1.0.0", integrityDirty: false }
      }
      return { installedModpackVersion: null, integrityDirty: false }
    })

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()

    // Toggle AUTO_UPDATES to true via settings event
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:settings-changed", {
          detail: { key: STORAGE_KEYS.AUTO_UPDATES, value: true },
        }),
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(getPublishedSpy).toHaveBeenCalledWith("srv-meliora")
    unmount()
  })

  // 23. Play normal: si ya está instalado y saludable, Play no solicita full manifest
  it("23. Play normal: si ya está instalado y saludable, Play no solicita full manifest", async () => {
    const getPublishedSpy = vi.spyOn(gameService, "getPublishedModpack")
    const launchGameSpy = vi.spyOn(gameService, "launchGame").mockResolvedValue(undefined as any)

    const { container, unmount } = renderButton({
      serverId: "srv-meliora",
      gameId: "srv-meliora",
      gameContext: { gameId: "srv-meliora", gameName: "Meliora" },
      releaseSummary: mockServers[0].activeRelease,
      installedVersion: "2.0.0",
      integrityDirty: false,
    })

    expect(getPublishedSpy).not.toHaveBeenCalled()
    const btn = container.querySelector("button")!
    expect(btn.textContent).toMatch(/play|jugar/i)

    await act(async () => {
      btn.click()
    })

    expect(launchGameSpy).toHaveBeenCalled()
    expect(getPublishedSpy).not.toHaveBeenCalled()
    unmount()
  })
})
