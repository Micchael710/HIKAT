// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import ProfileView from "./ProfileView"
import { authService } from "../services/authService"
import { LanguageProvider } from "../context/LanguageContext"

describe("Launcher ProfileView Component", () => {
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

  it("1. Avatar in ProfileView is non-circular (uses shape square for container clipping)", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-1",
      username: "Steve",
      displayName: "Steve",
      email: "steve@hikat.org",
      role: "PLAYER",
      createdAt: "2024-05-10T12:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "steve@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="Steve"
          activeSkinData={{
            id: "skin-1",
            name: "Steve Skin",
            customImgUrl: "data:image/png;base64,mock",
            accent: "#38bdf8",
          }}
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Verify canvas rendered by MinecraftHead inside ProfileView has shape="square" (borderRadius: 0 / not 50%)
    const canvas = container.querySelector("canvas")
    expect(canvas).not.toBeNull()
    expect(canvas?.style.borderRadius).toBe("0px")
  })

  it("2. Mock date 24/11/2025 is completely eliminated and real createdAt is formatted and rendered", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-2",
      username: "Alex",
      displayName: "Alex",
      email: "alex@hikat.org",
      role: "PLAYER",
      createdAt: "2024-02-18T10:30:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "alex@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="Alex"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    expect(container.textContent).not.toContain("24/11/2025")
    const expectedLocalizedDate = new Date("2024-02-18T10:30:00.000Z").toLocaleDateString("es", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    expect(container.textContent).toContain(expectedLocalizedDate)
  })

  it("3. If user has no createdAt, it renders fallback '-' instead of mock date", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-3",
      username: "NoDateUser",
      displayName: "NoDateUser",
      email: "nodate@hikat.org",
      role: "PLAYER",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "nodate@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="NoDateUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    expect(container.textContent).not.toContain("24/11/2025")
    expect(container.textContent).toContain("—")
  })

  it("4. Account with PASSWORD method shows 'Restablecer contraseña' and action button after resolving", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-4",
      username: "PassUser",
      displayName: "PassUser",
      email: "pass@hikat.org",
      role: "PLAYER",
      createdAt: "2024-01-01T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "pass@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="PassUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Flush async getLinkedMethods
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).toContain("Restablecer contraseña")
    expect(container.textContent).toContain("Enviar correo de restablecimiento")
  })

  it("5. Account with Google-only does NOT show reset password button during loading or after resolving", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-5",
      username: "GoogleUser",
      displayName: "GoogleUser",
      email: "google@gmail.com",
      role: "PLAYER",
      createdAt: "2024-03-01T00:00:00.000Z",
    })

    let resolveMethods: (val: any) => void = () => {}
    const methodsPromise = new Promise((resolve) => {
      resolveMethods = resolve
    })
    vi.spyOn(authService, "getLinkedMethods").mockReturnValue(methodsPromise as any)

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="GoogleUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // During loading: no reset password text or button
    expect(container.textContent).not.toContain("Restablecer contraseña")
    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")
    expect(container.textContent).toContain("Cargando...")

    // Resolve as GOOGLE
    await act(async () => {
      resolveMethods({
        success: true,
        methods: [{ type: "GOOGLE", email: "google@gmail.com", displayName: "Google Player" }],
      })
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")
    expect(container.textContent).toContain("Métodos de Acceso Vinculados")
    expect(container.textContent).toContain("Google")
  })

  it("6. Account with Discord-only does NOT show reset password button during loading or after resolving", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-6",
      username: "DiscordUser",
      displayName: "DiscordUser",
      email: "discord@discord.com",
      role: "PLAYER",
      createdAt: "2024-04-01T00:00:00.000Z",
    })

    let resolveMethods: (val: any) => void = () => {}
    const methodsPromise = new Promise((resolve) => {
      resolveMethods = resolve
    })
    vi.spyOn(authService, "getLinkedMethods").mockReturnValue(methodsPromise as any)

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="DiscordUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // During loading: no reset password text or button
    expect(container.textContent).not.toContain("Restablecer contraseña")
    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")

    // Resolve as DISCORD
    await act(async () => {
      resolveMethods({
        success: true,
        methods: [{ type: "DISCORD", email: "discord@discord.com", displayName: "Discord Pro" }],
      })
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")
    expect(container.textContent).toContain("Métodos de Acceso Vinculados")
    expect(container.textContent).toContain("Discord")
  })

  it("7. Account with PASSWORD + OAuth (Google/Discord) shows reset password button after resolving", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-7",
      username: "HybridUser",
      displayName: "HybridUser",
      email: "hybrid@hikat.org",
      role: "PLAYER",
      createdAt: "2024-01-15T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [
        { type: "PASSWORD", email: "hybrid@hikat.org" },
        { type: "GOOGLE", email: "hybrid@gmail.com" },
      ],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="HybridUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Flush async getLinkedMethods
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).toContain("Restablecer contraseña")
    expect(container.textContent).toContain("Enviar correo de restablecimiento")
  })

  it("8. Failure of getLinkedMethods does not show reset password button by default", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-8",
      username: "ErrorUser",
      displayName: "ErrorUser",
      email: "error@hikat.org",
      role: "PLAYER",
      createdAt: "2024-01-15T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockRejectedValue(new Error("Network failed"))

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="ErrorUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Flush async rejection
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).not.toContain("Restablecer contraseña")
    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")
    expect(container.textContent).toContain("No se pudieron cargar los métodos de acceso.")
  })

  it("9. Logout card appears in Profile with localized title, description and button", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-9",
      username: "LogoutUser",
      displayName: "LogoutUser",
      email: "logout@hikat.org",
      role: "PLAYER",
      createdAt: "2024-01-01T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "logout@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="LogoutUser"
          onBack={vi.fn()}
          onLogout={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    expect(container.textContent).toContain("Sesión")
    expect(container.textContent).toContain("Cerrar sesión")
    expect(container.textContent).toContain("Cierra tu sesión de HiKAT en este dispositivo.")
  })

  it("10. Clicking logout button executes onLogout exactly once without calling alternative logout logic", async () => {
    const onLogoutMock = vi.fn()
    const logoutSpy = vi.spyOn(authService, "logout")

    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-10",
      username: "LogoutClickUser",
      displayName: "LogoutClickUser",
      email: "click@hikat.org",
      role: "PLAYER",
      createdAt: "2024-01-01T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "click@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="LogoutClickUser"
          onBack={vi.fn()}
          onLogout={onLogoutMock}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Find the logout button by its text
    const buttons = Array.from(container.querySelectorAll("button"))
    const logoutBtn = buttons.find((btn) => btn.textContent?.includes("Cerrar sesión"))
    expect(logoutBtn).toBeDefined()
    expect(logoutBtn?.classList.contains("launcher-btn-danger")).toBe(true)

    await act(async () => {
      logoutBtn?.click()
    })

    expect(onLogoutMock).toHaveBeenCalledTimes(1)
    expect(logoutSpy).not.toHaveBeenCalled()
  })

  it("11. Clicking send reset email calls requestPasswordReset with email and current language", async () => {
    localStorage.setItem("hikat_language", "pt")
    const resetSpy = vi.spyOn(authService, "requestPasswordReset").mockResolvedValue({
      success: true,
      message: "Reset email sent",
    })

    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-11",
      username: "ResetUser",
      displayName: "ResetUser",
      email: "resetuser@hikat.org",
      role: "PLAYER",
      createdAt: "2024-01-01T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "PASSWORD", email: "resetuser@hikat.org" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="ResetUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    const resetBtn = buttons.find((btn) => btn.textContent?.includes("Enviar e-mail de redefinição") || btn.textContent?.includes("Enviar"))
    expect(resetBtn).toBeDefined()

    await act(async () => {
      resetBtn?.click()
    })

    expect(resetSpy).toHaveBeenCalledWith("resetuser@hikat.org", "pt")
    localStorage.removeItem("hikat_language")
  })
})
