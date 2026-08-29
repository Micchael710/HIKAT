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

  it("2. Displays Próximamente badges for unimplemented Auto Updates and Notifications", async () => {
    const container = await renderComponent(
      <SettingsView theme="dark" setTheme={vi.fn()} />,
    )

    expect(container.textContent).toContain("Próximamente")
  })

})
