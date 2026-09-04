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
    expect(container.textContent).toContain("o")
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
    const submitBtn = buttons.find((b) => b.textContent?.trim() === "Iniciar Sesión" && (b.classList.contains("launcher-btn-primary") || b.style.background.includes("linear-gradient")))
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
    expect(container.textContent).toContain("or")
    expect(container.textContent).toContain("Keep me signed in")
    expect(container.textContent).not.toContain("Secure authentication")
    expect(container.textContent).not.toContain("HiKAT Launcher v")
  })

  it("11. Switches between Login and Register tabs dynamically", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const buttons = Array.from(container.querySelectorAll("button"))
    const registerTabBtn = buttons.find((b) => b.textContent?.trim() === "Registrarse")
    expect(registerTabBtn).toBeDefined()

    await act(async () => {
      registerTabBtn?.click()
    })

    expect(container.textContent).toContain("Nombre de usuario")
    expect(container.textContent).toContain("Crear Cuenta")
  })

  it("12. Clicking '¿Olvidaste tu contraseña?' opens forgot password view and backToLogin returns", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    expect(container.textContent).toContain("¿Olvidaste tu contraseña?")
    const buttons = Array.from(container.querySelectorAll("button"))
    const forgotBtn = buttons.find((b) => b.textContent?.includes("¿Olvidaste tu contraseña?"))
    expect(forgotBtn).toBeDefined()

    // Open Forgot Password
    await act(async () => {
      forgotBtn?.click()
    })

    expect(container.textContent).toContain("Ingresa tu correo para recibir un enlace de recuperación.")
    expect(container.textContent).toContain("Enviar correo de restablecimiento")

    // Click back to login
    const backBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Volver a iniciar sesión"),
    )
    expect(backBtn).toBeDefined()

    await act(async () => {
      backBtn?.click()
    })

    expect(container.textContent).toContain("Iniciar Sesión")
    expect(container.textContent).toContain("o")
  })

  function changeInput(input: HTMLInputElement, value: string) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set
    nativeInputValueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }

  it("13. Forgot password submits requestPasswordReset and displays confirmation notice", async () => {
    const onLogin = vi.fn()
    const resetSpy = vi.spyOn(authService, "requestPasswordReset").mockResolvedValue({
      success: true,
      message: "Reset email sent",
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    // Navigate to forgot password
    const forgotBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("¿Olvidaste tu contraseña?"),
    )
    await act(async () => {
      forgotBtn?.click()
    })

    // Fill email and submit
    const emailInput = container.querySelector("input[type='email']") as HTMLInputElement
    expect(emailInput).toBeDefined()
    await act(async () => {
      changeInput(emailInput, "steve@hikat.org")
    })

    const submitResetBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Enviar correo de restablecimiento"),
    )
    expect(submitResetBtn).toBeDefined()

    await act(async () => {
      submitResetBtn?.click()
    })

    expect(resetSpy).toHaveBeenCalledWith("steve@hikat.org")
    expect(container.textContent).toContain("Revisa tu correo electrónico para continuar con el restablecimiento de tu contraseña.")
  })

  it("14. Registering with emailVerificationRequired=true displays verify email view", async () => {
    const onLogin = vi.fn()
    vi.spyOn(authService, "register").mockResolvedValue({
      success: true,
      user: {
        id: "u-verify",
        username: "VerifyUser",
        email: "verify@hikat.org",
        role: "PLAYER",
      },
      emailVerificationRequired: true,
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    // Switch to Register
    const registerTabBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Registrarse",
    )
    await act(async () => {
      registerTabBtn?.click()
    })

    // Fill registration inputs
    const usernameInput = container.querySelector("input[type='text']") as HTMLInputElement
    const emailInput = container.querySelector("input[type='email']") as HTMLInputElement
    const passwordInput = container.querySelector("input[type='password']") as HTMLInputElement

    await act(async () => {
      changeInput(usernameInput, "VerifyUser")
      changeInput(emailInput, "verify@hikat.org")
      changeInput(passwordInput, "password123")
    })

    const submitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Crear Cuenta",
    )
    expect(submitBtn).toBeDefined()

    await act(async () => {
      submitBtn?.click()
    })

    // Should render verify-email screen
    expect(container.textContent).toContain("Te enviamos un enlace de verificación a tu correo electrónico.")
    expect(container.textContent).toContain("verify@hikat.org")
    expect(container.textContent).toContain("Volver a iniciar sesión")

    // Clicking back to login returns to login tab
    const backToLoginBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Volver a iniciar sesión"),
    )
    await act(async () => {
      backToLoginBtn?.click()
    })

    expect(container.textContent).toContain("Iniciar Sesión")
  })

  it("15. Renders properly in light mode using theme-appropriate card styles", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="light" />
      </LanguageProvider>,
    )

    const img = container.querySelector("img")
    expect(img?.src).toContain("logo-black")
    expect(container.textContent).toContain("Iniciar Sesión")
  })

  it("16. Inputs apply neutral focus styling without yellow or blue highlights", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const emailInput = container.querySelector("input[type='email']") as HTMLInputElement
    expect(emailInput).toBeDefined()

    await act(async () => {
      emailInput.focus()
      emailInput.dispatchEvent(new Event("focus", { bubbles: true }))
    })

    // Focused style should be neutral white/grey, not yellow (239, 196, 54) or bright blue (56, 189, 248)
    expect(emailInput.style.borderColor).not.toContain("239, 196, 54")
    expect(emailInput.style.borderColor).not.toContain("#efc436")
    expect(emailInput.style.borderColor).not.toContain("56, 189, 248")
    expect(emailInput.style.boxShadow).not.toContain("239, 196, 54")
    expect(emailInput.style.boxShadow).not.toContain("56, 189, 248")
  })

  it("17. 'Mantener sesión iniciada' checkbox uses neutral styles without yellow or blue", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const checkboxLabel = Array.from(container.querySelectorAll("label")).find((l) =>
      l.textContent?.includes("Mantener sesión iniciada"),
    )
    expect(checkboxLabel).toBeDefined()

    const checkboxBox = checkboxLabel?.querySelector("div")
    expect(checkboxBox).toBeDefined()

    // Checked state in dark mode
    expect(checkboxBox?.style.background).not.toContain("#38bdf8")
    expect(checkboxBox?.style.background).not.toContain("#efc436")
    expect(checkboxBox?.style.borderColor).not.toContain("#38bdf8")
    expect(checkboxBox?.style.borderColor).not.toContain("#efc436")

    // Uncheck
    await act(async () => {
      checkboxLabel?.click()
    })

    // Unchecked state
    expect(checkboxBox?.style.background).not.toContain("#38bdf8")
    expect(checkboxBox?.style.background).not.toContain("#efc436")
  })

  it("18. Footer version and secure auth text are completely absent", async () => {
    const onLogin = vi.fn()
    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    expect(container.textContent).not.toContain("HiKAT Launcher v")
    expect(container.textContent).not.toContain("Autenticación segura")
    expect(container.textContent).not.toContain("Secure authentication")
  })

  it("19. Deep link hikat://auth/verify-email calls verifyEmail, shows success notice and returns to login without auto-login", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
    }

    const verifySpy = vi.spyOn(authService, "verifyEmail").mockResolvedValue({
      success: true,
      message: "Email verified successfully",
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    expect(callbackTrigger).not.toBeNull()

    await act(async () => {
      callbackTrigger!("hikat://auth/verify-email?token=valid-verify-token-123")
    })

    expect(verifySpy).toHaveBeenCalledWith("valid-verify-token-123")
    expect(container.textContent).toContain("Correo verificado correctamente. Ya puedes iniciar sesión.")
    expect(container.textContent).toContain("Iniciar Sesión")
    expect(onLogin).not.toHaveBeenCalled()
  })

  it("20. Deep link hikat://auth/verify-email with invalid token displays error banner", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
    }

    vi.spyOn(authService, "verifyEmail").mockResolvedValue({
      success: false,
      error: "El token de verificación es inválido o ha expirado",
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    await act(async () => {
      callbackTrigger!("hikat://auth/verify-email?token=invalid-token")
    })

    expect(container.textContent).toContain("El token de verificación es inválido o ha expirado")
    expect(onLogin).not.toHaveBeenCalled()
  })

  it("21. Deep link hikat://auth/reset-password opens reset-password mode with inputs and CTA", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
    }

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    await act(async () => {
      callbackTrigger!("hikat://auth/reset-password?token=reset-token-abc")
    })

    expect(container.textContent).toContain("Restablecer contraseña")
    expect(container.textContent).toContain("Nueva contraseña")
    expect(container.textContent).toContain("Confirmar contraseña")
    expect(container.textContent).toContain("Cambiar contraseña")
  })

  it("22. Reset password form validates password min length and mismatch", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
    }

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    await act(async () => {
      callbackTrigger!("hikat://auth/reset-password?token=reset-token-xyz")
    })

    const passwordInputs = container.querySelectorAll("input[type='password']")
    expect(passwordInputs.length).toBe(2)

    const newPassInput = passwordInputs[0] as HTMLInputElement
    const confirmPassInput = passwordInputs[1] as HTMLInputElement
    const submitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cambiar contraseña"),
    )

    // 1. Min length check (< 8 chars)
    await act(async () => {
      changeInput(newPassInput, "short")
      changeInput(confirmPassInput, "short")
      submitBtn?.click()
    })
    expect(container.textContent).toContain("La contraseña debe tener al menos 8 caracteres.")

    // 2. Mismatch check
    await act(async () => {
      changeInput(newPassInput, "validPassword123")
      changeInput(confirmPassInput, "differentPassword456")
      submitBtn?.click()
    })
    expect(container.textContent).toContain("Las contraseñas no coinciden.")
  })

  it("23. Reset password form submits authService.resetPassword and returns to login with notice without auto-login", async () => {
    const onLogin = vi.fn()
    let callbackTrigger: ((url: string) => void) | null = null

    ;(window as any).electronAPI = {
      openExternal: vi.fn(),
      onOAuthCallback: vi.fn((cb) => {
        callbackTrigger = cb
        return () => {}
      }),
    }

    const resetSpy = vi.spyOn(authService, "resetPassword").mockResolvedValue({
      success: true,
      message: "Password reset successful",
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    await act(async () => {
      callbackTrigger!("hikat://auth/reset-password?token=reset-token-12345")
    })

    const passwordInputs = container.querySelectorAll("input[type='password']")
    const newPassInput = passwordInputs[0] as HTMLInputElement
    const confirmPassInput = passwordInputs[1] as HTMLInputElement
    const submitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cambiar contraseña"),
    )

    await act(async () => {
      changeInput(newPassInput, "brandNewPassword123")
      changeInput(confirmPassInput, "brandNewPassword123")
      submitBtn?.click()
    })

    expect(resetSpy).toHaveBeenCalledWith("reset-token-12345", "brandNewPassword123")
    expect(container.textContent).toContain("Contraseña actualizada correctamente. Inicia sesión con tu nueva contraseña.")
    expect(container.textContent).toContain("Iniciar Sesión")
    expect(onLogin).not.toHaveBeenCalled()
  })

  it("24. Login attempt with unverified account displays emailNotVerifiedError", async () => {
    const onLogin = vi.fn()
    vi.spyOn(authService, "login").mockResolvedValue({
      success: false,
      error: "EMAIL_NOT_VERIFIED",
    })

    const container = await renderComponent(
      <LanguageProvider>
        <LoginView onLogin={onLogin} theme="dark" />
      </LanguageProvider>,
    )

    const emailInput = container.querySelector("input[type='email']") as HTMLInputElement
    const passwordInput = container.querySelector("input[type='password']") as HTMLInputElement
    const submitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.classList.contains("launcher-btn-primary") && b.textContent?.trim() === "Iniciar Sesión",
    )

    await act(async () => {
      changeInput(emailInput, "unverified@hikat.org")
      changeInput(passwordInput, "password123")
      submitBtn?.click()
    })

    expect(container.textContent).toContain("Debes verificar tu correo electrónico antes de iniciar sesión.")
    expect(onLogin).not.toHaveBeenCalled()
  })
})
