// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import LoginView from "./LoginView"
import { authService } from "../services/authService"
import { LanguageProvider } from "../context/LanguageContext"

describe("Launcher LoginView Component (OAuth, Layout Order & i18n)", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
    delete (window as any).electronAPI
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
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    expect(container.textContent).toContain("Continuar con Google")
    expect(container.textContent).toContain("Continuar con Discord")
    expect(container.textContent).toContain("Iniciar Sesión")
    expect(container.textContent).toContain("o continúa con")
  })

  it("2. Uses the standard extended HiKAT logo, not reduced logo", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img?.src).toContain("logo-white")
    expect(img?.src).not.toContain("logo-reduced")
  })

  it("3. Strict layout hierarchy: Credentials form appears BEFORE OAuth buttons", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const buttons = Array.from(container.querySelectorAll("button"))
    const submitBtn = buttons.find((b) => b.textContent?.trim() === "Iniciar Sesión" && b.style.background.includes("linear-gradient"))
    const googleBtn = buttons.find((b) => b.textContent?.includes("Google"))
    const discordBtn = buttons.find((b) => b.textContent?.includes("Discord"))

    expect(submitBtn).toBeDefined()
    expect(googleBtn).toBeDefined()
    expect(discordBtn).toBeDefined()

    // Verify DOM document position (submit CTA must be BEFORE Google and Discord)
    const posGoogle = submitBtn!.compareDocumentPosition(googleBtn!)
    const posDiscord = submitBtn!.compareDocumentPosition(discordBtn!)

    // Node.DOCUMENT_POSITION_FOLLOWING is 4
    expect(posGoogle & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(posDiscord & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("4. Clicking Continue with Google initiates PKCE flow and opens external browser", async () => {
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

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const buttons = Array.from(container.querySelectorAll("button"))
    const googleBtn = buttons.find((b) => b.textContent?.includes("Google"))
    expect(googleBtn).toBeDefined()

    await act(async () => {
      googleBtn?.click()
    })

    expect(authService.initiateOAuth).toHaveBeenCalledWith("GOOGLE", true)
    expect(openExternalMock).toHaveBeenCalledWith(
      "http://localhost:8788/oauth/authorize?provider=google&state=test-state",
    )
  })

  it("5. Deep link callback completes OAuth PKCE token exchange and calls onLogin", async () => {
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

    await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

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
      keepSession: undefined,
    })
  })

  it("6. Cold start retrieves pending OAuth deep link on mount and processes login", async () => {
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

    await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(authService.handleOAuthCallback).toHaveBeenCalledWith({
      code: "coldcode",
      codeVerifier: undefined,
      state: "coldstate",
      expectedState: undefined,
      keepSession: undefined,
    })
  })

  it("7. Displays error message when OAuth callback returns error parameter", async () => {
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

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    await act(async () => {
      callbackTrigger!("hikat://auth/callback?error=EMAIL_CONFLICT_LINK_REQUIRED")
    })

    expect(container.textContent).toContain("Este correo electrónico ya está registrado")
    expect(onLogin).not.toHaveBeenCalled()
  })

  it("8. Propagates keepSession toggle setting to authService.initiateOAuth", async () => {
    const onLogin = vi.fn()
    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn(() => () => {}),
    }

    const initiateSpy = vi.spyOn(authService, "initiateOAuth").mockResolvedValue({
      authUrl: "http://localhost:8788/oauth/authorize?provider=google&state=test",
      codeVerifier: "v-1",
      state: "s-1",
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const buttons = Array.from(container.querySelectorAll("button"))
    const discordBtn = buttons.find((b) => b.textContent?.includes("Discord"))

    await act(async () => {
      discordBtn?.click()
    })

    expect(initiateSpy).toHaveBeenCalledWith("DISCORD", true)
  })

  it("9. Callback processor rejects malicious spoofing urls like callback-evil", async () => {
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

    const handleCallbackSpy = vi.spyOn(authService, "handleOAuthCallback")
    await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    // Trigger spoofed malicious URLs
    await act(async () => {
      callbackTrigger!("hikat://auth/callback-evil?code=evil&state=fake")
      callbackTrigger!("https://auth/callback?code=evil&state=fake")
      callbackTrigger!("hikat://evil/callback?code=evil&state=fake")
    })

    // None should reach authService!
    expect(handleCallbackSpy).not.toHaveBeenCalled()
    expect(onLogin).not.toHaveBeenCalled()
  })

  it("10. Renders in English when language context is set to 'en'", async () => {
    localStorage.setItem("hikat_language", "en")
    const onLogin = vi.fn()

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    expect(container.textContent).toContain("Sign In")
    expect(container.textContent).toContain("Sign Up")
    expect(container.textContent).toContain("Continue with Google")
    expect(container.textContent).toContain("Continue with Discord")
    expect(container.textContent).toContain("or continue with")
    expect(container.textContent).toContain("Keep me signed in")
    expect(container.textContent).toContain("Secure authentication")
  })
})
