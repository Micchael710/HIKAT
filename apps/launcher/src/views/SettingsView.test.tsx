// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import SettingsView from "./SettingsView"
import { LanguageProvider } from "../context/LanguageContext"

describe("Launcher SettingsView Suite (Main-Authoritative Settings & Safe Persistence)", () => {
  let unmountCurrent: (() => void) | null = null
  let mockElectronAPI: any

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")

    mockElectronAPI = {
      getMemory: vi.fn().mockResolvedValue({ totalGb: 16 }),
      getStartWithSystem: vi.fn().mockResolvedValue(true),
      setStartWithSystem: vi.fn().mockResolvedValue(false),
      getMinimizeToTray: vi.fn().mockResolvedValue(false),
      setMinimizeToTray: vi.fn().mockResolvedValue(true),
      getDedicatedGpu: vi.fn().mockResolvedValue(false),
      setDedicatedGpu: vi.fn().mockResolvedValue(true),
      getRamAllocation: vi.fn().mockResolvedValue(10),
      setRamAllocation: vi.fn().mockResolvedValue(12),
    }

    ;(window as any).electronAPI = mockElectronAPI
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
      root.render(<LanguageProvider>{ui}</LanguageProvider>)
    })
    unmountCurrent = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    return container
  }

  it("1. On mount, queries settings authority from Electron Main without overwriting", async () => {
    await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    expect(mockElectronAPI.getMemory).toHaveBeenCalled()
    expect(mockElectronAPI.getStartWithSystem).toHaveBeenCalled()
    expect(mockElectronAPI.getMinimizeToTray).toHaveBeenCalled()
    expect(mockElectronAPI.getDedicatedGpu).toHaveBeenCalled()
    expect(mockElectronAPI.getRamAllocation).toHaveBeenCalled()
  })

  it("2. Auto updates toggle renders functional LauncherToggle and persists to localStorage only (without IPC)", async () => {
    const container = await renderComponent(
      <SettingsView theme="dark" setTheme={vi.fn()} />,
    )

    // Auto updates row is present and has a toggle button
    expect(container.textContent).toContain("Actualizaciones automáticas")
    expect(container.textContent).not.toContain("Notificaciones de eventos y servidor")

    // Find the toggle for auto updates
    const toggles = container.querySelectorAll('button[role="switch"]')
    expect(toggles.length).toBeGreaterThan(0)

    // Toggle auto updates off
    const autoUpdatesToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("Actualizaciones automáticas") ||
      btn.closest(".settings-row")?.textContent?.includes("Actualizaciones automáticas")
    ) as HTMLElement

    expect(autoUpdatesToggle).toBeDefined()
    await act(async () => {
      autoUpdatesToggle.click()
    })

    expect(localStorage.getItem("hikat_auto_updates")).toBe("false")
  })

  it("3. Completely removes notifications row from General tab", async () => {
    const container = await renderComponent(
      <SettingsView theme="dark" setTheme={vi.fn()} />,
    )

    expect(container.textContent).not.toContain("Notificaciones de eventos y servidor")
    expect(container.textContent).not.toContain("Recibe avisos sobre eventos especiales")
  })
})
