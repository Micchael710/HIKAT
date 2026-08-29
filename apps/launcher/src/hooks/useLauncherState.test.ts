// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useLauncherState } from "./useLauncherState"
import * as skinServiceModule from "../services/skinService"
import * as capeServiceModule from "../services/capeService"
import { authService } from "../services/authService"

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

  it("Test 1 — Initial mount loads global public catalog", async () => {
    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")
    const fetchGlobalCapesSpy = vi.spyOn(capeServiceModule, "fetchGlobalCapes")

    const { unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(1)
    expect(fetchGlobalCapesSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  it("Test 2 — Transition Home -> setView('skins') triggers a fresh fetch of global catalogs", async () => {
    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")
    const fetchGlobalCapesSpy = vi.spyOn(capeServiceModule, "fetchGlobalCapes")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(1)
    expect(fetchGlobalCapesSpy).toHaveBeenCalledTimes(1)

    // Navigate to skins section
    await act(async () => {
      result.current.setView("skins")
    })

    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(2)
    expect(fetchGlobalCapesSpy).toHaveBeenCalledTimes(2)

    unmount()
  })

  it("Test 3 — Authenticated user entering Skins refreshes both public and personal cosmetics", async () => {
    window.localStorage.setItem("hikat_auth_token", "auth-token-123")
    vi.spyOn(authService, "getStoredToken").mockReturnValue("auth-token-123")
    vi.spyOn(authService, "getAccessToken").mockReturnValue("auth-token-123")


    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")
    const fetchMyPlayerSkinSpy = vi.spyOn(skinServiceModule, "fetchMyPlayerSkin")
    const fetchMyActiveSkinSpy = vi.spyOn(skinServiceModule, "fetchMyActiveSkin")
    const fetchGlobalCapesSpy = vi.spyOn(capeServiceModule, "fetchGlobalCapes")
    const fetchMyPlayerCapesSpy = vi.spyOn(capeServiceModule, "fetchMyPlayerCapes")
    const fetchMyActiveCapeSpy = vi.spyOn(capeServiceModule, "fetchMyActiveCape")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Mount ran 1 round
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(1)
    expect(fetchMyPlayerSkinSpy).toHaveBeenCalledTimes(1)
    expect(fetchMyActiveSkinSpy).toHaveBeenCalledTimes(1)
    expect(fetchGlobalCapesSpy).toHaveBeenCalledTimes(1)
    expect(fetchMyPlayerCapesSpy).toHaveBeenCalledTimes(1)
    expect(fetchMyActiveCapeSpy).toHaveBeenCalledTimes(1)

    // Enter skins section
    await act(async () => {
      result.current.setView("skins")
    })

    // Second round triggered
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(2)
    expect(fetchMyPlayerSkinSpy).toHaveBeenCalledTimes(2)
    expect(fetchMyActiveSkinSpy).toHaveBeenCalledTimes(2)
    expect(fetchGlobalCapesSpy).toHaveBeenCalledTimes(2)
    expect(fetchMyPlayerCapesSpy).toHaveBeenCalledTimes(2)
    expect(fetchMyActiveCapeSpy).toHaveBeenCalledTimes(2)

    unmount()
  })

  it("Test 4 — Re-entry (Home -> Skins -> Home -> Skins) produces a fresh query on each entry", async () => {
    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(1) // Mount

    // 1st entry to Skins
    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(2)

    // Back to Home
    await act(async () => {
      result.current.setView("home")
    })
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(2) // No new skins fetch on leaving

    // 2nd entry to Skins
    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(3)

    unmount()
  })

  it("Test 5 — While remaining on Skins view, re-renders do NOT spam queries", async () => {
    const fetchGlobalSkinsSpy = vi.spyOn(skinServiceModule, "fetchGlobalSkins")

    const { result, rerender, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(1)

    // Enter skins
    await act(async () => {
      result.current.setView("skins")
    })
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(2)

    // Re-render without changing view
    rerender()
    rerender()

    // Query count remains unchanged (0 additional calls)
    expect(fetchGlobalSkinsSpy).toHaveBeenCalledTimes(2)

    unmount()
  })

  it("Test 6 — Newly published admin skin appears in allSkins upon re-entering Skins section without restarting", async () => {
    let currentSkins = [
      {
        id: "skin-A",
        name: "Skin Alpha",
        imageUrl: "/media/skin-a.png",
        status: "AVAILABLE" as const,
        createdAt: "2026-08-29T10:00:00Z",
        updatedAt: "2026-08-29T10:00:00Z",
      },
    ]

    vi.spyOn(skinServiceModule, "fetchGlobalSkins").mockImplementation(async () => currentSkins)

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    // Initially contains skin-A
    expect(result.current.allSkins.some((s) => s.id === "skin-A")).toBe(true)
    expect(result.current.allSkins.some((s) => s.id === "skin-B")).toBe(false)

    // Admin publishes skin-B on backend
    currentSkins = [
      ...currentSkins,
      {
        id: "skin-B",
        name: "Skin Beta (New)",
        imageUrl: "/media/skin-b.png",
        status: "AVAILABLE" as const,
        createdAt: "2026-08-29T14:00:00Z",
        updatedAt: "2026-08-29T14:00:00Z",
      },
    ]

    // User navigates to Skins
    await act(async () => {
      result.current.setView("skins")
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Now allSkins includes skin-B seamlessly
    expect(result.current.allSkins.some((s) => s.id === "skin-B")).toBe(true)

    unmount()
  })

  it("Test 7 — Catalog failure preserves existing catalog items (does not replace with [])", async () => {
    let shouldFail = false
    vi.spyOn(skinServiceModule, "fetchGlobalSkins").mockImplementation(async () => {
      if (shouldFail) {
        throw new Error("Network timeout")
      }
      return [
        {
          id: "skin-A",
          name: "Skin Alpha",
          imageUrl: "/media/skin-a.png",
          status: "AVAILABLE" as const,
          createdAt: "2026-08-29T10:00:00Z",
          updatedAt: "2026-08-29T10:00:00Z",
        },
      ]
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.allSkins.some((s) => s.id === "skin-A")).toBe(true)

    // Now simulate network failure on re-entering skins
    shouldFail = true
    await act(async () => {
      result.current.setView("skins")
    })

    await act(async () => {
      await Promise.resolve()
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
    vi.spyOn(authService, "getAccessToken").mockReturnValue("refreshed-token")
    vi.spyOn(skinServiceModule, "fetchMyPlayerSkin").mockResolvedValue({
      id: "pskin-persisted",
      userId: "u-1",
      imageUrl: "/media/my_custom_skin.png",
      createdAt: "2026-08-29T10:00:00Z",
      updatedAt: "2026-08-29T10:00:00Z",
    })
    vi.spyOn(skinServiceModule, "fetchMyActiveSkin").mockResolvedValue({
      type: "CUSTOM",
      skinId: null,
      skin: null,
    })

    const { result, unmount } = renderCustomHook(() => useLauncherState())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.playerSkin?.id).toBe("pskin-persisted")
    expect(result.current.appliedSkin).toBe("player-custom")
    expect(result.current.activeSkinData?.customImgUrl).toBe("/media/my_custom_skin.png")

    unmount()
  })
})

