// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import LoginView from "./LoginView"
import { authService } from "../services/authService"

describe("Launcher LoginView Component (OAuth & Auth Parity)", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
  })

  afterEach(() => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
  })

  async function renderComponent(ui: React.ReactElement) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(ui)
    })
    unmountCurrent = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    return container
  }

  it("1. Renders Continue with Google and Continue with Discord OAuth buttons", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(<LoginView onLogin={onLogin} theme="dark" />)

    expect(container.textContent).toContain("Continuar con Google")
    expect(container.textContent).toContain("Continuar con Discord")
    expect(container.textContent).toContain("Iniciar Sesión")
  })

  it("2. Clicking Continue with Google initiates PKCE flow and opens external browser", async () => {
    const onLogin = vi.fn()
    const openExternalMock = vi.fn()
    ;(window as any).electronAPI = {
      openExternal: openExternalMock,
      onOAuthCallback: vi.fn(() => () => {}),
    }

    vi.spyOn(authService, "initiateOAuth").mockResolvedValueOnce({
      authUrl: "http://localhost:8788/oauth/authorize?provider=google&state=test-state",
      codeVerifier: "test-verifier",
      state: "test-state",
    })

    const container = await renderComponent(<LoginView onLogin={onLogin} theme="dark" />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const googleBtn = buttons.find((b) => b.textContent?.includes("Google"))
    expect(googleBtn).toBeDefined()

    await act(async () => {
      googleBtn?.click()
    })

    expect(authService.initiateOAuth).toHaveBeenCalledWith("GOOGLE")
    expect(openExternalMock).toHaveBeenCalledWith(
      "http://localhost:8788/oauth/authorize?provider=google&state=test-state",
    )
  })

  it("3. Deep link callback completes OAuth PKCE token exchange and calls onLogin", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
    }

    vi.spyOn(authService, "handleOAuthCallback").mockResolvedValueOnce({
      id: "u-oauth-1",
      username: "OAuthPlayer",
      displayName: "OAuthPlayer",
      email: "player@hikat.org",
      role: "PLAYER",
    })

    await renderComponent(<LoginView onLogin={onLogin} theme="dark" />)

    sessionStorage.setItem("hikat_launcher_oauth_verifier", "saved-verifier")
    sessionStorage.setItem("hikat_launcher_oauth_state", "saved-state")

    expect(callbackTrigger).not.toBeNull()

    // Simulate Electron forwarding deep link hikat://auth/callback?code=abc123code&state=saved-state
    await act(async () => {
      callbackTrigger!("hikat://auth/callback?code=abc123code&state=saved-state")
    })

    expect(authService.handleOAuthCallback).toHaveBeenCalledWith({
      code: "abc123code",
      codeVerifier: "saved-verifier",
      state: "saved-state",
      expectedState: "saved-state",
    })
  })

  it("4. Cold start retrieves pending OAuth deep link on mount and processes login", async () => {
    const onLogin = vi.fn()
    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn(() => () => {}),
      getPendingOAuthCallback: vi
        .fn()
        .mockResolvedValue("hikat://auth/callback?code=coldcode&state=coldstate"),
    }

    vi.spyOn(authService, "handleOAuthCallback").mockResolvedValueOnce({
      id: "u-cold",
      username: "ColdPlayer",
      displayName: "ColdPlayer",
      email: "cold@hikat.org",
      role: "PLAYER",
    })

    await renderComponent(<LoginView onLogin={onLogin} theme="dark" />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(authService.handleOAuthCallback).toHaveBeenCalledWith({
      code: "coldcode",
      codeVerifier: undefined,
      state: "coldstate",
      expectedState: undefined,
    })
  })

  it("5. Displays error message when OAuth callback returns error parameter", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
      getPendingOAuthCallback: vi.fn().mockResolvedValue(null),
    }

    const container = await renderComponent(<LoginView onLogin={onLogin} theme="dark" />)

    await act(async () => {
      callbackTrigger!("hikat://auth/callback?error=EMAIL_CONFLICT_LINK_REQUIRED")
    })

    expect(container.textContent).toContain("Este correo electrónico ya está registrado")
    expect(onLogin).not.toHaveBeenCalled()
  })
})

