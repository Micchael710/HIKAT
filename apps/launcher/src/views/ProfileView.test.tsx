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

  it("4. Account with PASSWORD method shows 'Restablecer contraseña' and action button", async () => {
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

  it("5. Account with Google-only does NOT show reset password button and shows Google linked badge", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-5",
      username: "GoogleUser",
      displayName: "GoogleUser",
      email: "google@gmail.com",
      role: "PLAYER",
      createdAt: "2024-03-01T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "GOOGLE", email: "google@gmail.com", displayName: "Google Player" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="GoogleUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Flush async getLinkedMethods
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")
    expect(container.textContent).toContain("Métodos de Acceso Vinculados")
    expect(container.textContent).toContain("Google")
  })

  it("6. Account with Discord-only does NOT show reset password button and shows Discord linked badge", async () => {
    vi.spyOn(authService, "getCachedUser").mockReturnValue({
      id: "u-6",
      username: "DiscordUser",
      displayName: "DiscordUser",
      email: "discord@discord.com",
      role: "PLAYER",
      createdAt: "2024-04-01T00:00:00.000Z",
    })
    vi.spyOn(authService, "getLinkedMethods").mockResolvedValue({
      success: true,
      methods: [{ type: "DISCORD", email: "discord@discord.com", displayName: "Discord Pro" }],
    })

    const container = await renderComponent(
      <LanguageProvider>
        <ProfileView
          username="DiscordUser"
          onBack={vi.fn()}
          theme="dark"
        />
      </LanguageProvider>,
    )

    // Flush async getLinkedMethods
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(container.textContent).not.toContain("Enviar correo de restablecimiento")
    expect(container.textContent).toContain("Métodos de Acceso Vinculados")
    expect(container.textContent).toContain("Discord")
  })

  it("7. Account with PASSWORD + OAuth (Google/Discord) continues to show reset password button", async () => {
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
})
