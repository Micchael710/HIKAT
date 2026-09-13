// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useLauncherState } from "./useLauncherState"
import * as skinServiceModule from "../services/skinService"
import * as capeServiceModule from "../services/capeService"
import { authService } from "../services/authService"
import { gameService } from "../services/gameService"
import { serverService } from "../services/serverService"
import { deriveBaseGameButtonState } from "../components/server/DownloadPlayButton"

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

describe("useLauncherState Hook (Phase 07 Hardening & Shard 8F Section Refresh)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()

    vi.spyOn(skinServiceModule, "fetchPlayerActiveSkinPreview").mockResolvedValue(null)
    vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot").mockResolvedValue({
      globalSkins: [],
      globalCapes: [],
      playerSkin: null,
      activeSkin: null,
      playerCapes: [],
      activeCape: null,
    })
    vi.spyOn(skinServiceModule, "fetchGlobalSkins").mockResolvedValue([])
    vi.spyOn(skinServiceModule, "fetchMyPlayerSkin").mockResolvedValue(null)
    vi.spyOn(skinServiceModule, "fetchMyActiveSkin").mockResolvedValue(null)
    vi.spyOn(capeServiceModule, "fetchGlobalCapes").mockResolvedValue([])
    vi.spyOn(capeServiceModule, "fetchMyPlayerCapes").mockResolvedValue([])
    vi.spyOn(capeServiceModule, "fetchMyActiveCape").mockResolvedValue({
      type: "NONE",
      capeId: null,
      playerCapeId: null,
    })
  })

  it("handleApplySkin updates optimistically and reverts appliedSkin if Backend returns success: false", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-token")
    vi.spyOn(authService, "getStoredToken").mockReturnValue("fake-token")
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-token")


    const setMyActiveSkinSpy = vi
      .spyOn(skinServiceModule, "setMyActiveSkin")
      .mockResolvedValue({
        success: false,
        error: "Skin no disponible o no encontrada",
      })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.appliedSkin).toBe("player-custom")

    await act(async () => {
      await result.current.setAppliedSkin("skin-999")
    })

    expect(setMyActiveSkinSpy).toHaveBeenCalledWith("GLOBAL", "skin-999")
    expect(result.current.appliedSkin).toBe("player-custom")
    expect(result.current.skinsError).toBe("Skin no disponible o no encontrada")

    unmount()
  })

  it("handleApplySkin reverts appliedSkin if Backend throws an exception", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-token")
    vi.spyOn(authService, "getStoredToken").mockReturnValue("fake-token")
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-token")


    vi.spyOn(skinServiceModule, "setMyActiveSkin").mockRejectedValue(
      new Error("Network connection lost"),
    )

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.setAppliedSkin("skin-888")
    })

    expect(result.current.appliedSkin).toBe("player-custom")
    expect(result.current.skinsError).toBe("Network connection lost")

    unmount()
  })

  it("handleApplySkin keeps appliedSkin when Backend succeeds", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-token")
    vi.spyOn(authService, "getStoredToken").mockReturnValue("fake-token")
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-token")


    vi.spyOn(skinServiceModule, "setMyActiveSkin").mockResolvedValue({
      success: true,
      data: {
        type: "GLOBAL",
        skinId: "skin-123",
      },
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.setAppliedSkin("skin-123")
    })

    expect(result.current.appliedSkin).toBe("skin-123")
    expect(result.current.skinsError).toBeNull()

    unmount()
  })

  /* ─────────────────────────────────────────────────────────────
   * Shard 8F: Section Refresh-on-entry tests for Skins & Capes
   * ───────────────────────────────────────────────────────────── */

  it("Test 1 — Initial mount does NOT load global public catalog nor snapshot", async () => {
    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")
    const fetchGlobalCapesSpy = vi.spyOn(capeServiceModule, "fetchGlobalCapes")
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchGlobalSkinsSpy).not.toHaveBeenCalled()
    expect(fetchGlobalCapesSpy).not.toHaveBeenCalled()
    expect(fetchSnapshotSpy).not.toHaveBeenCalled()

    unmount()
  })

  it("Test 2 — Transition Home -> setView('skins') triggers fetchCosmeticsSnapshot exactly once", async () => {
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchSnapshotSpy).not.toHaveBeenCalled()

    // Navigate to skins section
    await act(async () => {
      result.current.setView("skins")
    })

    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  it("Test 3 — Authenticated user entering Skins obtains cosmetics snapshot with skins and capes in one operation", async () => {
    window.localStorage.setItem("hikat_auth_token", "auth-token-123")
    vi.spyOn(authService, "getStoredToken").mockReturnValue("auth-token-123")
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-123")
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      cb(
        {
          user: {
            id: "u-1",
            displayName: "Tester",
            email: "tester@example.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)

    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot").mockResolvedValue({
      globalSkins: [
        {
          id: "skin-1",
          name: "Knight",
          imageUrl: "/media/knight.png",
          status: "AVAILABLE",
          createdAt: "2026-08-01",
          updatedAt: "2026-08-01",
        },
      ],
      globalCapes: [],
      playerSkin: null,
      activeSkin: {
        type: "GLOBAL",
        skinId: "skin-1",
        imageUrl: "/media/knight.png",
        name: "Knight",
        skin: null,
        playerSkin: null,
      },
      playerCapes: [],
      activeCape: null,
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Enter skins section
    await act(async () => {
      result.current.setView("skins")
    })

    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)
    expect(result.current.allSkins.some((s) => s.id === "skin-1")).toBe(true)

    unmount()
  })

  it("Test 4 — Re-entry (Home -> Skins -> Home -> Skins) does NOT repeat GraphQL query", async () => {
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSnapshotSpy).not.toHaveBeenCalled()

    // 1st entry to Skins
    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    // Back to Home
    await act(async () => {
      result.current.setView("home")
    })
    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    // 2nd entry to Skins: data is cached in memory, NO second query
    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  it("Test 5 — While remaining on Skins view, re-renders do NOT spam queries", async () => {
    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot")

    const { result, rerender, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSnapshotSpy).not.toHaveBeenCalled()

    // Enter skins
    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    // Re-render without changing view
    rerender()
    rerender()

    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  it("Test 6 — COSMETICS_UPDATED on WebSocket refreshes cosmetics snapshot dynamically", async () => {
    let releaseEventListener: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    const fetchSnapshotSpy = vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot").mockResolvedValue({
      globalSkins: [
        {
          id: "skin-new",
          name: "New Admin Skin",
          imageUrl: "/media/new.png",
          status: "AVAILABLE",
          createdAt: "2026-08-01",
          updatedAt: "2026-08-01",
        },
      ],
      globalCapes: [],
      playerSkin: null,
      activeSkin: null,
      playerCapes: [],
      activeCape: null,
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Simulate WebSocket event arriving
    await act(async () => {
      releaseEventListener?.({
        type: "COSMETICS_UPDATED",
        target: "SKINS",
      })
    })

    expect(fetchSnapshotSpy).toHaveBeenCalledTimes(1)
    expect(result.current.allSkins.some((s) => s.id === "skin-new")).toBe(true)

    unmount()
  })

  it("Test 7 — Snapshot failure preserves existing catalog items", async () => {
    let shouldFail = false
    vi.spyOn(skinServiceModule, "fetchCosmeticsSnapshot").mockImplementation(async () => {
      if (shouldFail) {
        throw new Error("Network timeout")
      }
      return {
        globalSkins: [
          {
            id: "skin-A",
            name: "Skin Alpha",
            imageUrl: "/media/skin-a.png",
            status: "AVAILABLE" as const,
            createdAt: "2026-08-29T10:00:00Z",
            updatedAt: "2026-08-29T10:00:00Z",
          },
        ],
        globalCapes: [],
        playerSkin: null,
        activeSkin: null,
        playerCapes: [],
        activeCape: null,
      }
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      result.current.setView("skins")
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.allSkins.some((s) => s.id === "skin-A")).toBe(true)

    shouldFail = true
    await act(async () => {
      await result.current.refreshCosmeticsSnapshot?.()
    })

    // Existing skin-A is preserved!
    expect(result.current.allSkins.some((s) => s.id === "skin-A")).toBe(true)

    unmount()
  })

  it("Test 8 — CUSTOM to GLOBAL and GLOBAL to CUSTOM switching persists applied state", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("valid-token")
    vi.spyOn(skinServiceModule, "setMyActiveSkin").mockResolvedValue({
      success: true,
      data: { type: "GLOBAL", skinId: "skin-glob" },
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Switch to GLOBAL
    await act(async () => {
      await result.current.setAppliedSkin("skin-glob")
    })
    expect(result.current.appliedSkin).toBe("skin-glob")

    // Switch back to CUSTOM
    vi.spyOn(skinServiceModule, "setMyActiveSkin").mockResolvedValue({
      success: true,
      data: { type: "CUSTOM", skinId: null },
    })
    await act(async () => {
      await result.current.setAppliedSkin("player-custom")
    })
    expect(result.current.appliedSkin).toBe("player-custom")

    unmount()
  })

  it("Test 9 — Custom skin persists and remains active/visible when access token refreshes", async () => {
    window.localStorage.setItem("hikat_auth_token", "refreshed-token")
    vi.spyOn(authService, "getStoredToken").mockReturnValue("refreshed-token")
    vi.spyOn(authService, "getAccessToken").mockReturnValue("refreshed-token")
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      cb(
        {
          user: {
            id: "u-1",
            displayName: "Tester",
            email: "tester@example.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)

    vi.spyOn(skinServiceModule, "fetchPlayerActiveSkinPreview").mockResolvedValue({
      type: "CUSTOM",
      skinId: "pskin-persisted",
      imageUrl: "/media/my_custom_skin.png",
      name: "Custom Preview",
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.appliedSkin).toBe("player-custom")
    expect(result.current.activeSkinData?.customImgUrl).toBe("/media/my_custom_skin.png")

    unmount()
  })

  it("Test 10 — activeSkinAccent provides dynamic accent structure for launcher sidebar", async () => {
    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.activeSkinAccent).toBeDefined()
    expect(typeof result.current.activeSkinAccent.r).toBe("number")
    expect(typeof result.current.activeSkinAccent.g).toBe("number")
    expect(typeof result.current.activeSkinAccent.b).toBe("number")
    expect(typeof result.current.activeSkinAccent.hex).toBe("string")
    expect(typeof result.current.activeSkinAccent.css).toBe("string")

    unmount()
  })

  it("Test 11 — Screen transitioning to 'home' with active auth automatically triggers fetchPlayerActiveSkinPreview without loading full catalog", async () => {
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
      skinId: "pskin-auto",
      imageUrl: "/media/auto_skin.png",
      name: "Auto Skin",
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    // Initial state is screen: "login" -> fetchPlayerActiveSkinPreview not called yet
    expect(fetchPreviewSpy).toHaveBeenCalledTimes(0)

    // User logs in / bootstrap finishes -> authCallback emits AUTHENTICATED
    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-1",
            displayName: "Tester",
            email: "tester@example.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Automatically fetched player skin preview upon screen -> "home"!
    expect(fetchPreviewSpy).toHaveBeenCalledTimes(1)
    expect(fetchSnapshotSpy).not.toHaveBeenCalled()
    expect(fetchGlobalSkinsSpy).not.toHaveBeenCalled()
    expect(result.current.activeSkinData?.customImgUrl).toBe("/media/auto_skin.png")

    unmount()
  })

  it("Test 12 — OAuth session with displayName = null keeps screen = 'login'", async () => {
    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-oauth-new",
            displayName: null,
            email: "oauthnew@gmail.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.screen).toBe("login")
    expect(result.current.username).toBe("")

    unmount()
  })

  it("Test 13 — When displayName is set via setUsername onboarding notification, transitions screen from 'login' to 'home'", async () => {
    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    // 1. Initial OAuth login with null displayName
    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-oauth-new",
            displayName: null,
            email: "oauthnew@gmail.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })
    expect(result.current.screen).toBe("login")

    // 2. User completes choose-username onboarding -> AuthClientCore notifies updated session
    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-oauth-new",
            displayName: "ChosenPlayer",
            email: "oauthnew@gmail.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.screen).toBe("home")
    expect(result.current.username).toBe("ChosenPlayer")

    unmount()
  })

  it("Test 14 — Existing account with valid displayName transitions to screen = 'home' immediately", async () => {
    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-existing",
            displayName: "ExistingPlayer",
            email: "existing@gmail.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.screen).toBe("home")
    expect(result.current.username).toBe("ExistingPlayer")

    unmount()
  })

  it("Test 15 — SERVER_STATUS_CHANGED event updates serverStatus in gameStates for correct serverId", async () => {
    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    let releaseEventListener: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      authCallback(
        {
          user: {
            id: "u-test",
            displayName: "TestUser",
            email: "test@example.com",
            role: "PLAYER",
          },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.screen).toBe("home")
    expect(releaseEventListener).toBeDefined()

    // Simulate SERVER_STATUS_CHANGED event arriving from WebSocket
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_STATUS_CHANGED",
        serverId: "srv-mc-101",
        status: "ONLINE",
      })
    })

    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")

    // Another event for srv-mc-102
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_STATUS_CHANGED",
        serverId: "srv-mc-102",
        status: "OFFLINE",
      })
    })

    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")
    expect(result.current.gameStates["srv-mc-102"]?.serverStatus).toBe("OFFLINE")

    unmount()
  })

  it("Test 16 — RELEASE_ACTIVATED event preserves existing serverStatus on affected server", async () => {
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue([
      {
        id: "srv-mc-101",
        name: "Test Server",
        activeRelease: { version: "1.0.0", minecraftVersion: "1.21.1", modLoader: "NEOFORGE" } as any,
      } as any,
    ])

    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    let releaseEventListener: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      authCallback(
        {
          user: { id: "u-test", displayName: "TestUser", email: "test@example.com", role: "PLAYER" },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    // First, set serverStatus to ONLINE via SERVER_STATUS_CHANGED
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_STATUS_CHANGED",
        serverId: "srv-mc-101",
        status: "ONLINE",
      })
    })

    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")

    // Now emit RELEASE_ACTIVATED for srv-mc-101
    await act(async () => {
      releaseEventListener?.({
        type: "RELEASE_ACTIVATED",
        serverId: "srv-mc-101",
        version: "2.0.0",
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
      })
    })

    // serverStatus must STILL be ONLINE!
    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")
    expect(result.current.gameStates["srv-mc-101"]?.releaseSummary?.version).toBe("2.0.0")

    unmount()
  })

  it("Test 17 — loadServers preserves serverStatus for existing servers", async () => {
    vi.spyOn(serverService, "getLauncherServers").mockResolvedValue([
      {
        id: "srv-mc-101",
        name: "Test Server",
        activeRelease: { version: "1.0.0", minecraftVersion: "1.21.1", modLoader: "NEOFORGE" } as any,
      } as any,
    ])

    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    let releaseEventListener: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      authCallback(
        {
          user: { id: "u-test", displayName: "TestUser", email: "test@example.com", role: "PLAYER" },
        },
        "AUTHENTICATED",
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Set serverStatus to ONLINE
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_STATUS_CHANGED",
        serverId: "srv-mc-101",
        status: "ONLINE",
      })
    })

    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")

    // Trigger SERVER_UPDATED which calls loadServers()
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_UPDATED",
        serverId: "srv-mc-101",
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    // serverStatus must STILL be ONLINE!
    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")

    unmount()
  })

  it("Test 18 — onPhaseChange to IDLE preserves serverStatus", async () => {
    let phaseChangeCb: any = null
    ;(window as any).electronAPI = {
      ...(window as any).electronAPI,
      onPhaseChange: vi.fn((cb: any) => {
        phaseChangeCb = cb
        return () => {}
      }),
      getInstalledState: vi.fn().mockResolvedValue({
        installedModpackVersion: "1.0.0",
        integrityDirty: false,
      }),
    }

    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    let releaseEventListener: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      authCallback(
        {
          user: { id: "u-test", displayName: "TestUser", email: "test@example.com", role: "PLAYER" },
        },
        "AUTHENTICATED",
      )
    })

    // Set serverStatus to ONLINE
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_STATUS_CHANGED",
        serverId: "srv-mc-101",
        status: "ONLINE",
      })
    })

    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")

    // Trigger IDLE phase change
    await act(async () => {
      phaseChangeCb?.("IDLE", "srv-mc-101")
    })

    await act(async () => {
      await Promise.resolve()
    })

    // serverStatus must STILL be ONLINE!
    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("ONLINE")

    unmount()
  })

  it("Test 19 — loadServers hydrates installedVersion even when SERVER_STATUS_CHANGED set partial state first", async () => {
    let getLauncherServersResolve: (val: any) => void
    const serversPromise = new Promise((resolve) => {
      getLauncherServersResolve = resolve
    })

    vi.spyOn(serverService, "getLauncherServers").mockImplementation(() => serversPromise as any)

    const getInstalledStateSpy = vi.fn().mockResolvedValue({
      installedModpackVersion: "1.0.0",
      integrityDirty: false,
    })

    ;(window as any).electronAPI = {
      ...(window as any).electronAPI,
      getInstalledState: getInstalledStateSpy,
    }

    let authCallback: any
    vi.spyOn(authService, "subscribe").mockImplementation((cb: any) => {
      authCallback = cb
      return () => {}
    })
    vi.spyOn(authService, "bootstrap").mockResolvedValue(null)
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-valid")

    let releaseEventListener: any = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseEventListener = cb
      return () => {}
    })

    // 1. gameStates initially empty
    const { result, unmount } = renderCustomHook(() => useLauncherState())

    expect(result.current.gameStates["srv-mc-101"]).toBeUndefined()

    // Authenticate so releaseEventListener is active while loadServers() is still pending
    await act(async () => {
      authCallback(
        {
          user: { id: "u-test", displayName: "TestUser", email: "test@example.com", role: "PLAYER" },
        },
        "AUTHENTICATED",
      )
    })

    // 2. Before completing local hydration, SERVER_STATUS_CHANGED arrives
    await act(async () => {
      releaseEventListener?.({
        type: "SERVER_STATUS_CHANGED",
        serverId: "srv-mc-101",
        status: "OFFLINE",
      })
    })

    // Partial state with serverStatus
    expect(result.current.gameStates["srv-mc-101"]?.serverStatus).toBe("OFFLINE")
    expect(result.current.gameStates["srv-mc-101"]?.installedVersion).toBeUndefined()

    // 3. getLauncherServers resolves
    await act(async () => {
      getLauncherServersResolve([
        {
          id: "srv-mc-101",
          name: "Test Server",
          activeRelease: {
            version: "1.0.0",
            minecraftVersion: "1.21.1",
            modLoader: "NEOFORGE",
          },
        },
      ])
      await Promise.resolve()
    })

    // 4. Verify getInstalledState was called despite gameStates["srv-mc-101"] already existing
    expect(getInstalledStateSpy).toHaveBeenCalledWith({
      gameId: "srv-mc-101",
      gameName: "Test Server",
    })

    // 5. Final state must contain installedVersion, integrityDirty, and preserved serverStatus
    const serverState = result.current.gameStates["srv-mc-101"]
    expect(serverState).toBeDefined()
    expect(serverState?.installedVersion).toBe("1.0.0")
    expect(serverState?.integrityDirty).toBe(false)
    expect(serverState?.serverStatus).toBe("OFFLINE")

    // 6. If activeRelease.version === "1.0.0", base button state resolves to "play"
    expect(
      deriveBaseGameButtonState(serverState?.releaseSummary, serverState?.installedVersion),
    ).toBe("play")

    unmount()
  })
})





