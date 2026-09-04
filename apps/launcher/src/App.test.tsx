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
    localStorage.setItem("hikat_language", "es")
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
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-1",
      displayName: "Tester",
      username: "Tester",
      email: "tester@example.com",
      role: "PLAYER",
    } as any)

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
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
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

  it("Deep link /reset-password received while authenticated in Home/Profile switches to LoginView and opens reset password form", async () => {
    let callbackTrigger: ((url: string) => void) | null = null
    ;(window as any).electronAPI = {
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
      getPendingOAuthCallback: vi.fn().mockResolvedValue(null),
    }

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

    // Initially in authenticated Home
    expect(container.textContent).toContain("DESCARGAR")
    expect(container.querySelector(".sidebar-nav-btn")).not.toBeNull()
    expect(callbackTrigger).not.toBeNull()

    // Trigger deep link while user is authenticated inside launcher
    await act(async () => {
      callbackTrigger!("hikat://auth/reset-password?token=deep-token-999")
    })

    // App switches to LoginView and renders the reset-password view
    expect(container.textContent).toContain("Restablecer contraseña")
    expect(container.textContent).toContain("Nueva contraseña")
    expect(container.textContent).toContain("Confirmar contraseña")
    expect(container.textContent).toContain("Cambiar contraseña")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("Deep link /verify-email received while authenticated in Home/Profile switches to LoginView and verifies email", async () => {
    let callbackTrigger: ((url: string) => void) | null = null
    ;(window as any).electronAPI = {
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
      getPendingOAuthCallback: vi.fn().mockResolvedValue(null),
    }

    const verifySpy = vi.spyOn(authService, "verifyEmail").mockResolvedValue({
      success: true,
      message: "Email verified successfully",
    })

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

    // Trigger deep link while user is authenticated inside launcher
    await act(async () => {
      callbackTrigger!("hikat://auth/verify-email?token=deep-verify-token-777")
    })

    expect(verifySpy).toHaveBeenCalledWith("deep-verify-token-777")
    expect(container.textContent).toContain("Correo verificado correctamente. Ya puedes iniciar sesión.")
    expect(container.textContent).toContain("Iniciar Sesión")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("Deep link /callback (OAuth) received while authenticated does not switch to LoginView", async () => {
    let callbackTrigger: ((url: string) => void) | null = null
    ;(window as any).electronAPI = {
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
      getPendingOAuthCallback: vi.fn().mockResolvedValue(null),
    }

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

    // Trigger standard OAuth callback
    await act(async () => {
      callbackTrigger!("hikat://auth/callback?code=oauth-code-123&state=oauth-state-456")
    })

    // Stays in Home view, not switching to LoginView
    expect(container.textContent).toContain("DESCARGAR")
    expect(container.querySelector(".sidebar-nav-btn")).not.toBeNull()
    expect(container.textContent).not.toContain("Iniciar Sesión")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("Cold-start with pending /reset-password deep link and existing stored session stays on reset password form instead of switching to Home", async () => {
    let pendingUrl: string | null = "hikat://auth/reset-password?token=cold-reset-token-555"
    const getPendingOAuthCallbackMock = vi.fn().mockImplementation(async () => {
      const url = pendingUrl
      pendingUrl = null
      return url
    })

    ;(window as any).electronAPI = {
      onOAuthCallback: vi.fn(() => () => {}),
      getPendingOAuthCallback: getPendingOAuthCallbackMock,
    }

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

    // Assert getPendingOAuthCallback is called exactly once (single consumer in useLauncherState)
    expect(getPendingOAuthCallbackMock).toHaveBeenCalledTimes(1)

    // Assert it does NOT finish in Home
    expect(container.querySelector(".sidebar-nav-btn")).toBeNull()
    expect(container.textContent).not.toContain("DESCARGAR")

    // Assert it remains on the reset password form
    expect(container.textContent).toContain("Restablecer contraseña")
    expect(container.textContent).toContain("Nueva contraseña")
    expect(container.textContent).toContain("Confirmar contraseña")
    expect(container.textContent).toContain("Cambiar contraseña")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("Cold-start with pending /verify-email deep link and existing stored session verifies email and stays on Login instead of switching to Home", async () => {
    const verifySpy = vi.spyOn(authService, "verifyEmail").mockResolvedValue({
      success: true,
      message: "Email verified successfully",
    })

    let pendingUrl: string | null = "hikat://auth/verify-email?token=cold-verify-token-888"
    const getPendingOAuthCallbackMock = vi.fn().mockImplementation(async () => {
      const url = pendingUrl
      pendingUrl = null
      return url
    })

    ;(window as any).electronAPI = {
      onOAuthCallback: vi.fn(() => () => {}),
      getPendingOAuthCallback: getPendingOAuthCallbackMock,
    }

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

    // Assert getPendingOAuthCallback is called exactly once (single consumer in useLauncherState)
    expect(getPendingOAuthCallbackMock).toHaveBeenCalledTimes(1)
    expect(verifySpy).toHaveBeenCalledWith("cold-verify-token-888")

    // Assert it does NOT finish in Home
    expect(container.querySelector(".sidebar-nav-btn")).toBeNull()
    expect(container.textContent).not.toContain("DESCARGAR")

    // Assert it stays in Login with the verified banner
    expect(container.textContent).toContain("Correo verificado correctamente. Ya puedes iniciar sesión.")
    expect(container.textContent).toContain("Iniciar Sesión")

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
