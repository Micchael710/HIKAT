// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import SettingsView, { calculateAutomaticRam } from "./SettingsView"
import LauncherToggle from "../components/common/LauncherToggle"
import { LanguageProvider } from "../context/LanguageContext"
import { gameService } from "../services/gameService"

describe("Launcher SettingsView Suite (Restructured Games Tab & Multi-Language)", () => {
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
      getMinimizeOnGameLaunch: vi.fn().mockResolvedValue(true),
      setMinimizeOnGameLaunch: vi.fn().mockResolvedValue(false),
      getDedicatedGpu: vi.fn().mockResolvedValue(true),
      setDedicatedGpu: vi.fn().mockResolvedValue(true),
      getRamAllocation: vi.fn().mockResolvedValue(8),
      setRamAllocation: vi.fn().mockResolvedValue(8),
      getGameRuntimeInfo: vi.fn().mockResolvedValue({ javaMajorVersion: 21 }),
      getLaunchStatus: vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" }),
      onLaunchStatus: vi.fn().mockReturnValue(() => {}),
      onPhaseChange: vi.fn().mockReturnValue(() => {}),
    }

    ;(window as any).electronAPI = mockElectronAPI

    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.4.2",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      totalSizeGB: 1.5,
      hasUpdate: false,
      installed: true,
      hasExistingInstall: true,
      installedModpackVersion: "1.4.2",
      clientFiles: [
        {
          path: "mods/test.jar",
          sha256: "abc",
          sizeBytes: 1000,
          downloadUrl: "http://example.com/test.jar",
          policy: "NO_MODIFICABLE",
        },
      ],
    })

    vi.spyOn(gameService, "startSync").mockResolvedValue({
      success: true,
      downloadedCount: 0,
      prunedCount: 0,
    } as any)

    vi.spyOn(gameService, "uninstallGame").mockResolvedValue(true)
    vi.spyOn(gameService, "subscribeReleaseEvents").mockReturnValue(() => {})
  })

  afterEach(() => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
  })

  async function renderComponent(ui: React.ReactElement, initialLang = "es") {
    localStorage.setItem("hikat_language", initialLang)
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

  it("1. On mount, queries authority from Electron Main and services", async () => {
    await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    expect(mockElectronAPI.getMemory).toHaveBeenCalled()
    expect(mockElectronAPI.getStartWithSystem).toHaveBeenCalled()
    expect(mockElectronAPI.getMinimizeToTray).toHaveBeenCalled()
    expect(mockElectronAPI.getMinimizeOnGameLaunch).toHaveBeenCalled()
    expect(mockElectronAPI.getDedicatedGpu).toHaveBeenCalled()
    expect(mockElectronAPI.getRamAllocation).toHaveBeenCalled()
    expect(mockElectronAPI.getGameRuntimeInfo).toHaveBeenCalled()
    expect(gameService.checkGameManifest).toHaveBeenCalled()
  })

  it("2. Tab switcher shows 'Juegos' (renamed from 'Juego y Rendimiento')", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    expect(container.textContent).toContain("General")
    expect(container.textContent).toContain("Juegos")
    expect(container.textContent).not.toContain("Juego y Rendimiento")
  })

  it("3. Multi-language support for Tab and Settings titles (EN, FR, PT)", async () => {
    // English
    const containerEn = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />, "en")
    expect(containerEn.textContent).toContain("Games")
    expect(containerEn.textContent).toContain("Settings")

    if (unmountCurrent) unmountCurrent()

    // French
    const containerFr = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />, "fr")
    expect(containerFr.textContent).toContain("Jeux")
    expect(containerFr.textContent).toContain("Paramètres")

    if (unmountCurrent) unmountCurrent()

    // Portuguese
    const containerPt = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />, "pt")
    expect(containerPt.textContent).toContain("Jogos")
    expect(containerPt.textContent).toContain("Configurações")
  })

  it("4. Apparatia appears solely as sidebar selector and does NOT repeat duplicate header in right panel", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    expect(gamesTabBtn).toBeDefined()

    await act(async () => {
      gamesTabBtn?.click()
    })

    // Exactly one Apparatia text in sidebar, with game-selector-item class
    const apparatiaButtons = Array.from(container.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Apparatia"),
    )
    expect(apparatiaButtons.length).toBe(1)
    expect(apparatiaButtons[0].classList.contains("game-selector-item")).toBe(true)

    // Right panel should not have h2 with Apparatia
    const h2Elements = Array.from(container.querySelectorAll("h2"))
    const rightHeader = h2Elements.find((h) => h.textContent?.includes("Apparatia"))
    expect(rightHeader).toBeUndefined()
  })

  it("5. Single unified horizontal technical card renders Minecraft, loader, Java and modpack without separate Info card", async () => {
    // A. Real data present
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    expect(container.textContent).toContain("Minecraft 1.21.1")
    expect(container.textContent).toContain("NeoForge 21.1.65")
    expect(container.textContent).toContain("Java 21")
    expect(container.textContent).toContain("Modpack 1.4.2")

    // Separate "Información" or "Versión de Java" card does not exist
    expect(container.textContent).not.toContain("Versión de Java")

    if (unmountCurrent) unmountCurrent()

    // B. Empty manifest data & no runtime info -> shows '—' and NOT hardcoded fallbacks
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)
    mockElectronAPI.getGameRuntimeInfo.mockResolvedValue({ javaMajorVersion: null })
    const containerNoData = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const gamesTabBtnNoData = Array.from(containerNoData.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Juegos"),
    )
    await act(async () => {
      gamesTabBtnNoData?.click()
    })

    expect(containerNoData.textContent).toContain("—")
    expect(containerNoData.textContent).not.toContain("Minecraft 1.21.1")
    expect(containerNoData.textContent).not.toContain("Modpack 1.0.0")
  })

  it("6. RAM section integrates slider and automatic selection cleanly with safe RAM calculation", async () => {
    // 16 GB system RAM -> calculateAutomaticRam(16) = 8 GB
    mockElectronAPI.getMemory.mockResolvedValue({ totalGb: 16 })
    mockElectronAPI.getRamAllocation.mockResolvedValue(4)

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const autoBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Automático") && b.classList.contains("launcher-btn-secondary"),
    )
    expect(autoBtn).toBeDefined()

    await act(async () => {
      autoBtn?.click()
    })

    expect(mockElectronAPI.setRamAllocation).toHaveBeenCalledWith(8)
    expect(localStorage.getItem("hikat_ram_gb")).toBe("8")
  })

  it("7. GPU toggle uses dedicatedGpu setting and toggles cleanly with accent", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    expect(container.textContent).toContain("GPU de alto rendimiento")
    expect(container.textContent).toContain("Prioriza la GPU de alto rendimiento para este juego.")

    const toggles = container.querySelectorAll('button[role="switch"]')
    const gpuToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("GPU de alto rendimiento") ||
      btn.closest(".settings-row")?.textContent?.includes("GPU de alto rendimiento"),
    ) as HTMLElement

    expect(gpuToggle).toBeDefined()
    await act(async () => {
      gpuToggle.click()
    })

    expect(mockElectronAPI.setDedicatedGpu).toHaveBeenCalledWith(false)
    expect(localStorage.getItem("hikat_dedicated_gpu")).toBe("false")
  })

  it("8. Administration card: Verify and Uninstall have equal width (160px) and appropriate classes", async () => {
    // A. Healthy idle install -> Verify enabled and has launcher-btn-secondary class
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const verifyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Verificar"),
    )
    const uninstallBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Desinstalar"),
    )

    expect(verifyBtn).toBeDefined()
    expect(uninstallBtn).toBeDefined()

    expect(verifyBtn?.classList.contains("launcher-btn-secondary")).toBe(true)
    expect(uninstallBtn?.classList.contains("launcher-btn-danger")).toBe(true)

    expect(verifyBtn?.style.width).toBe("160px")
    expect(uninstallBtn?.style.width).toBe("160px")
  })

  it("9. Administration card: Verify is disabled when update exists, Uninstall remains enabled", async () => {
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.5.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.65",
      totalSizeGB: 1.5,
      hasUpdate: true,
      installed: false,
      hasExistingInstall: true,
      installedModpackVersion: "1.4.2",
      clientFiles: [],
    })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const verifyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Verificar"),
    )
    const uninstallBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Desinstalar"),
    )

    expect(verifyBtn?.hasAttribute("disabled")).toBe(true)
    expect(uninstallBtn?.hasAttribute("disabled")).toBe(false)
  })

  it("10. Administration card: Verify and Uninstall are disabled when game is running or busy", async () => {
    mockElectronAPI.getLaunchStatus.mockResolvedValue({ status: "running", operationState: "IDLE" })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const verifyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Verificar"),
    )
    const uninstallBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Desinstalar"),
    )

    expect(verifyBtn?.hasAttribute("disabled")).toBe(true)
    expect(uninstallBtn?.hasAttribute("disabled")).toBe(true)
  })

  it("11. LauncherToggle component functions cleanly with and without optional accentColor", async () => {
    const onChangeMock = vi.fn()

    // Without custom accent (default #3ec4c0)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<LauncherToggle checked={true} onChange={onChangeMock} />)
    })

    const switchBtn = container.querySelector('button[role="switch"]') as HTMLButtonElement
    expect(switchBtn).toBeDefined()
    expect(switchBtn.style.background).toContain("rgb(62, 196, 192)")

    // With custom accent
    await act(async () => {
      root.render(<LauncherToggle checked={true} onChange={onChangeMock} accentColor="#ff5500" />)
    })
    expect(switchBtn.style.background).toContain("rgb(255, 85, 0)")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("12. Renders in Light mode cleanly without crashing", async () => {
    const container = await renderComponent(<SettingsView theme="light" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    expect(container.textContent).toContain("Rendimiento")
    expect(container.textContent).toContain("Administración")
  })
})
