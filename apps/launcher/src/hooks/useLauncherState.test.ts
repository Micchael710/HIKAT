// @vitest-environment jsdom
// @ts-ignore
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
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe("useLauncherState Hook (Phase 07 Hardening)", () => {
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
})
