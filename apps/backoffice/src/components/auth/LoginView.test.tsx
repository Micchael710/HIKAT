// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import LoginView from "./LoginView"
import { AuthProvider } from "../../context/AuthContext"
import { authService } from "../../services/authService"

describe("Back Office LoginView Suite (Shard 8F Auth & OAuth)", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
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
      root.render(<AuthProvider>{ui}</AuthProvider>)
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
    const container = await renderComponent(<LoginView theme="dark" setTheme={vi.fn()} />)

    expect(container.textContent).toContain("Continuar con Google")
    expect(container.textContent).toContain("Continuar con Discord")
    expect(container.textContent).toContain("Ingresar")
  })

  it("2. Clicking Continue with Google initiates OAuth and sets PKCE sessionStorage", async () => {
    vi.spyOn(authService, "initiateOAuth").mockResolvedValueOnce({
      authUrl: "http://localhost:8788/oauth/authorize?provider=google&state=state-123",
      codeVerifier: "verifier-xyz",
      state: "state-123",
    })

    delete (window as any).location
    ;(window as any).location = { href: "", origin: "http://localhost:5174", search: "", pathname: "/" }

    const container = await renderComponent(<LoginView theme="dark" setTheme={vi.fn()} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const googleBtn = buttons.find((b) => b.textContent?.includes("Google"))
    expect(googleBtn).toBeDefined()

    await act(async () => {
      googleBtn?.click()
    })

    expect(authService.initiateOAuth).toHaveBeenCalledWith("GOOGLE")
    expect(sessionStorage.getItem("hikat_oauth_verifier")).toBe("verifier-xyz")
    expect(sessionStorage.getItem("hikat_oauth_state")).toBe("state-123")
    expect(window.location.href).toBe(
      "http://localhost:8788/oauth/authorize?provider=google&state=state-123",
    )
  })
})
