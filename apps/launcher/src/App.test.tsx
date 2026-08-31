// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import App from "./App"
import { LanguageProvider } from "./context/LanguageContext"
import { gameService } from "./services/gameService"
import { authService } from "./services/authService"
import * as skinServiceModule from "./services/skinService"
import * as capeServiceModule from "./services/capeService"
import { newsService } from "./services/newsService"
import { serverService } from "./services/serverService"

describe("App View Persistence (HomeView Stays Mounted Across Sections)", () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("hikat_auth_token", "fake-token")
    vi.restoreAllMocks()

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
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-token")

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

    vi.spyOn(newsService, "getNewsArticles").mockResolvedValue({ items: [], isCached: false })
    vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
      online: true,
      playersOnline: 2,
      maxPlayers: 20,
      latencyMs: 15,
    })

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.0.0",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      installed: false,
      hasUpdate: false,
      hasExistingInstall: false,
      totalSizeGB: 10,
      clientFiles: [],
    })
    vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("HomeView remains mounted when navigating Home -> Skins -> Home, and checkGameManifest is called only on initial mount", async () => {
    const checkGameManifestSpy = vi.spyOn(gameService, "checkGameManifest")

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <App />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(checkGameManifestSpy).toHaveBeenCalledTimes(1)

    // Find sidebar navigation buttons
    const navButtons = Array.from(container.querySelectorAll(".sidebar-nav-btn")) as HTMLElement[]
    expect(navButtons.length).toBeGreaterThan(0)

    // Click skins navigation button (index 1)
    const skinsBtn = navButtons[1]
    if (skinsBtn) {
      await act(async () => {
        skinsBtn.click()
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    // Returning to Home (index 0)
    const homeBtn = navButtons[0]
    if (homeBtn) {
      await act(async () => {
        homeBtn.click()
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    // checkGameManifest was NOT called again because HomeView remained mounted!
    expect(checkGameManifestSpy).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
