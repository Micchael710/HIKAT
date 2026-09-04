// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import SettingsView, { calculateAutomaticRam } from "./SettingsView"
import LauncherToggle from "../components/common/LauncherToggle"
import { LanguageProvider } from "../context/LanguageContext"
import { gameService } from "../services/gameService"
import esLocale from "../locales/es.json"
import enLocale from "../locales/en.json"
import frLocale from "../locales/fr.json"
import ptLocale from "../locales/pt.json"

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
      setDedicatedGpu: vi.fn().mockImplementation((val: any) => Promise.resolve(val)),
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

  it("1. Without manifest cache, queries authority from Electron Main and calls checkGameManifest once", async () => {
    await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    expect(mockElectronAPI.getMemory).toHaveBeenCalled()
    expect(mockElectronAPI.getStartWithSystem).toHaveBeenCalled()
    expect(mockElectronAPI.getMinimizeToTray).toHaveBeenCalled()
    expect(mockElectronAPI.getMinimizeOnGameLaunch).toHaveBeenCalled()
    expect(mockElectronAPI.getDedicatedGpu).toHaveBeenCalled()
    expect(mockElectronAPI.getRamAllocation).toHaveBeenCalled()
    expect(mockElectronAPI.getGameRuntimeInfo).toHaveBeenCalled()
    expect(gameService.checkGameManifest).toHaveBeenCalledTimes(1)
  })

  it("2. With valid manifest cache present, mounting Settings does NOT call checkGameManifest", async () => {
    localStorage.setItem(
      "hikat_game_manifest",
      JSON.stringify({
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        version: "1.4.2",
      }),
    )

    await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    // Electron and runtime info are queried, but checkGameManifest is NOT called
    expect(mockElectronAPI.getMemory).toHaveBeenCalled()
    expect(mockElectronAPI.getGameRuntimeInfo).toHaveBeenCalled()
    expect(gameService.checkGameManifest).not.toHaveBeenCalled()
  })

  it("3. WebSocket release event triggers checkGameManifest and updates manifest", async () => {
    let releaseCallback: (() => Promise<void>) | null = null
    vi.spyOn(gameService, "subscribeReleaseEvents").mockImplementation((cb: any) => {
      releaseCallback = cb
      return () => {}
    })

    // Cache present so mount does not query
    localStorage.setItem(
      "hikat_game_manifest",
      JSON.stringify({
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        version: "1.4.2",
      }),
    )

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    expect(gameService.checkGameManifest).not.toHaveBeenCalled()

    // Simulate WebSocket RELEASE_ACTIVATED event
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue({
      version: "1.5.0",
      minecraftVersion: "1.21.1",
      modLoader: "NEOFORGE",
      modLoaderVersion: "21.1.80",
      totalSizeGB: 1.6,
      hasUpdate: true,
      installed: true,
      hasExistingInstall: true,
      installedModpackVersion: "1.4.2",
      clientFiles: [],
    })

    await act(async () => {
      await releaseCallback?.()
    })

    expect(gameService.checkGameManifest).toHaveBeenCalledTimes(1)
  })

  it("4. Tab switcher shows 'Juegos' (renamed from 'Juego y Rendimiento')", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    expect(container.textContent).toContain("General")
    expect(container.textContent).toContain("Juegos")
    expect(container.textContent).not.toContain("Juego y Rendimiento")
  })

  it("5. Multi-language support for Tab and Settings titles (EN, FR, PT)", async () => {
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

  it("6. Selected game identity (logo 48x48 + name) is rendered at top, and previous top horizontal card is removed", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    // Game identity header: image with 48x48 contain and selected game name
    const gameLogoImg = container.querySelector("img[alt='Apparatia']") as HTMLImageElement
    expect(gameLogoImg).toBeDefined()
    expect(gameLogoImg.style.width).toBe("48px")
    expect(gameLogoImg.style.height).toBe("48px")
    expect(gameLogoImg.style.objectFit).toBe("contain")

    // Previous top card with grid repeat(4, 1fr) should not exist
    const oldGridCard = container.querySelector("div[style*='grid-template-columns: repeat(4, 1fr)']")
    expect(oldGridCard).toBeNull()
  })

  it("7. Discrete technical details footer is placed at the end with real values and fallback '—'", async () => {
    // Initial cached values
    localStorage.setItem(
      "hikat_game_manifest",
      JSON.stringify({
        minecraftVersion: "1.21.1",
        modLoader: "NEOFORGE",
        modLoaderVersion: "21.1.65",
        version: "1.4.2",
      }),
    )
    localStorage.setItem("hikat_java_major_version", "21")

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    // Technical metadata footer at the bottom with dots separator
    expect(container.textContent).toContain("Minecraft 1.21.1")
    expect(container.textContent).toContain("NeoForge 21.1.65")
    expect(container.textContent).toContain("Java 21")
    expect(container.textContent).toContain("Modpack 1.4.2")
    expect(container.textContent).toContain("·")
  })

  it("8. When single game exists (GAMES.length === 1), sidebar is hidden and panel takes full width", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    // Sidebar game selector button is NOT rendered when GAMES.length === 1
    const selectorItem = container.querySelector(".game-selector-item")
    expect(selectorItem).toBeNull()
  })

  it("9. RAM section provides automatic mode toggle that persists, calculates RAM, and disables slider when active", async () => {
    mockElectronAPI.getMemory.mockResolvedValue({ totalGb: 16 })
    mockElectronAPI.getRamAllocation.mockResolvedValue(4)
    localStorage.setItem("hikat_ram_auto", "false")

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const slider = container.querySelector(".settings-ram-slider") as HTMLInputElement
    expect(slider).toBeDefined()
    expect(slider.disabled).toBe(false)

    // Locate "Asignar automáticamente" toggle
    const toggles = container.querySelectorAll('button[role="switch"]')
    const autoRamToggle = Array.from(toggles).find(
      (btn) =>
        btn.getAttribute("aria-label")?.includes("Asignar automáticamente") ||
        btn.closest("div")?.textContent?.includes("Asignar automáticamente"),
    ) as HTMLElement
    expect(autoRamToggle).toBeDefined()

    // 1. Toggle OFF -> ON: calculates automatic RAM and disables slider
    await act(async () => {
      autoRamToggle.click()
    })

    expect(localStorage.getItem("hikat_ram_auto")).toBe("true")
    expect(mockElectronAPI.setRamAllocation).toHaveBeenCalledWith(8)
    expect(slider.disabled).toBe(true)

    // 2. Toggle ON -> OFF: enables slider and preserves last RAM value
    await act(async () => {
      autoRamToggle.click()
    })

    expect(localStorage.getItem("hikat_ram_auto")).toBe("false")
    expect(slider.disabled).toBe(false)
    expect(slider.value).toBe("8")

    if (unmountCurrent) unmountCurrent()

    // 3. Mount with hikat_ram_auto = true calculates RAM on startup without triggering user save toast
    localStorage.setItem("hikat_ram_auto", "true")
    localStorage.setItem("hikat_ram_gb", "8")
    mockElectronAPI.getMemory.mockResolvedValue({ totalGb: 8 }) // calculateAutomaticRam(8) = 4

    const containerRestored = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    expect(localStorage.getItem("hikat_ram_gb")).toBe("4")
    // Should NOT show save toast message
    const toast = containerRestored.querySelector(".settings-live-toast")
    expect(toast).toBeNull()
  })

  it("10. GPU toggle uses dedicatedGpu setting and toggles cleanly with accent", async () => {
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

  it("11. Administration card: Verify and Uninstall render descriptions and buttons have equal width (160px)", async () => {
    localStorage.setItem("hikat_game_installed", "true")
    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(true)

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    // Descriptions are rendered
    expect(container.textContent).toContain("Comprueba la instalación y restaura archivos necesarios")
    expect(container.textContent).toContain("Elimina este juego de este equipo.")

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

  it("12. Verify & Uninstall in Settings dispatch CustomEvents without duplicate gameService logic", async () => {
    localStorage.setItem("hikat_game_installed", "true")
    vi.spyOn(gameService, "isGameInstalled").mockReturnValue(true)

    const dispatchSpy = vi.spyOn(window, "dispatchEvent")
    const startSyncSpy = vi.spyOn(gameService, "startSync")
    const uninstallSpy = vi.spyOn(gameService, "uninstallGame")

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

    // Click Verify
    await act(async () => {
      verifyBtn?.click()
    })

    expect(startSyncSpy).not.toHaveBeenCalled()
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hikat:game-action-request",
        detail: { action: "verify" },
      }),
    )

    // Click Uninstall
    await act(async () => {
      uninstallBtn?.click()
    })

    expect(uninstallSpy).not.toHaveBeenCalled()
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hikat:game-action-request",
        detail: { action: "uninstall" },
      }),
    )

    // Receiving hikat:game-action-status event updates button state
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "verify", state: "started" },
        }),
      )
    })

    expect(container.textContent).toContain("Verificando...")

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "verify", state: "finished" },
        }),
      )
    })
  })

  it("13. Sidebar dynamic accent notifies parent when tab switches between General and Juegos", async () => {
    const onSidebarAccentChangeMock = vi.fn()
    const container = await renderComponent(
      <SettingsView theme="dark" setTheme={vi.fn()} onSidebarAccentChange={onSidebarAccentChangeMock} />,
    )

    // Initially in General tab -> reports turquoise
    expect(onSidebarAccentChangeMock).toHaveBeenCalledWith({
      r: 62,
      g: 196,
      b: 192,
      css: "62, 196, 192",
    })

    // Switch to Juegos tab -> reports gameAccent
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    expect(onSidebarAccentChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        r: expect.any(Number),
        g: expect.any(Number),
        b: expect.any(Number),
      }),
    )
  })

  it("14. SettingsView layout maintains top: 145, right: 80, viewFadeIn animation, header structure matching SkinsView, and slider receives --settings-accent", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    // Check main panel container position & animation matching SkinsView
    const mainContainer = container.querySelector("div[style*='top: 145px']") as HTMLElement
    expect(mainContainer).toBeDefined()
    expect(mainContainer?.style.right).toBe("80px")
    expect(mainContainer?.style.animation).toBe("viewFadeIn 0.24s ease")

    // Check header title typography matching SkinsView
    const titleElement = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.fontSize === "32px" && d.style.fontWeight === "800",
    )
    expect(titleElement).toBeDefined()
    expect(titleElement?.textContent).toBe("Configuración")

    // Navigate to Games tab
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const slider = container.querySelector(".settings-ram-slider") as HTMLInputElement
    expect(slider).toBeDefined()
    expect(slider?.style.getPropertyValue("--settings-accent")).toBeTruthy()
  })

  it("15. LiveToast uses game accent in Juegos tab and standard styling in General tab, preserving red for errors", async () => {
    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)

    // In General tab, toggle a setting -> toast appears without custom game accent
    const toggles = container.querySelectorAll('button[role="switch"]')
    const firstToggle = toggles[0] as HTMLElement
    await act(async () => {
      firstToggle.click()
    })

    let toast = container.querySelector(".settings-live-toast") as HTMLElement
    expect(toast).toBeDefined()

    // Switch to Juegos tab -> toggle setting -> toast appears with game accent
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const gameToggles = container.querySelectorAll('button[role="switch"]')
    const gpuToggle = Array.from(gameToggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("GPU de alto rendimiento") ||
      btn.closest(".settings-row")?.textContent?.includes("GPU de alto rendimiento"),
    ) as HTMLElement
    await act(async () => {
      gpuToggle.click()
    })

    toast = container.querySelector(".settings-live-toast") as HTMLElement
    expect(toast).toBeDefined()
    // LiveToast in game tab has border or shadow reflecting accent
    expect(toast.style.borderColor || toast.style.boxShadow).toBeTruthy()
  })

  it("16. Missing technical information displays fallback '—'", async () => {
    localStorage.removeItem("hikat_game_manifest")
    localStorage.removeItem("hikat_java_major_version")
    vi.spyOn(gameService, "checkGameManifest").mockResolvedValue(null)
    mockElectronAPI.getGameRuntimeInfo.mockResolvedValue({ javaMajorVersion: null })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    // Footer contains fallback "—"
    expect(container.textContent).toContain("—")
  })

  it("17. Update available: uninstall button is enabled, verify button is disabled", async () => {
    mockElectronAPI.checkSyncPlan = vi.fn().mockResolvedValue({
      success: true,
      hasExistingInstall: true,
      isFullyInstalled: false,
      installedModpackVersion: "1.4.0",
      needsUpdate: true,
    })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const verifyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Verificar"),
    ) as HTMLButtonElement
    const uninstallBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Desinstalar"),
    ) as HTMLButtonElement

    expect(verifyBtn).toBeDefined()
    expect(uninstallBtn).toBeDefined()
    expect(verifyBtn.disabled).toBe(true)
    expect(uninstallBtn.disabled).toBe(false)
  })

  it("18. Damaged files without update: verify button is enabled (hasExistingInstall = true, isFullyInstalled = false, hasIntegrityIssue = true)", async () => {
    mockElectronAPI.checkSyncPlan = vi.fn().mockResolvedValue({
      success: true,
      hasExistingInstall: true,
      isFullyInstalled: false,
      hasIntegrityIssue: true,
      installedModpackVersion: "1.4.2", // same as manifest.version "1.4.2"
    })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const verifyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Verificar"),
    ) as HTMLButtonElement
    const uninstallBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Desinstalar"),
    ) as HTMLButtonElement

    expect(verifyBtn).toBeDefined()
    expect(uninstallBtn).toBeDefined()
    expect(verifyBtn.disabled).toBe(false)
    expect(uninstallBtn.disabled).toBe(false)
  })

  it("19. Action status: failed uninstall (success: false) does NOT clear Java cache", async () => {
    localStorage.setItem("hikat_java_major_version", "21")

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "uninstall", state: "finished", success: false },
        }),
      )
    })

    expect(localStorage.getItem("hikat_java_major_version")).toBe("21")
    expect(container.textContent).toContain("Java 21")
  })

  it("20. Action status: successful uninstall (success: true) clears Java cache", async () => {
    localStorage.setItem("hikat_java_major_version", "21")

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hikat:game-action-status", {
          detail: { action: "uninstall", state: "finished", success: true },
        }),
      )
    })

    expect(localStorage.getItem("hikat_java_major_version")).toBeNull()
  })

  it("21. GPU toggle reconciles state and localStorage with authoritative boolean response from IPC", async () => {
    mockElectronAPI.setDedicatedGpu = vi.fn().mockResolvedValue(false)

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

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

  it("22. GPU toggle reverts state and localStorage and shows error toast when IPC rejects", async () => {
    localStorage.setItem("hikat_dedicated_gpu", "true")
    mockElectronAPI.getDedicatedGpu = vi.fn().mockResolvedValue(true)
    mockElectronAPI.setDedicatedGpu = vi.fn().mockRejectedValue(new Error("Registry access denied"))

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const toggles = container.querySelectorAll('button[role="switch"]')
    const gpuToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("GPU de alto rendimiento") ||
      btn.closest(".settings-row")?.textContent?.includes("GPU de alto rendimiento"),
    ) as HTMLElement

    await act(async () => {
      gpuToggle.click()
    })

    // Reverted back to true
    expect(localStorage.getItem("hikat_dedicated_gpu")).toBe("true")
    expect(container.textContent).toContain("Error al guardar cambios")
  })

  it("23. Changing GPU with game running shows inline pending restart notice", async () => {
    mockElectronAPI.getLaunchStatus = vi.fn().mockResolvedValue({ status: "running", operationState: "IDLE" })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    expect(container.querySelector('[data-testid="settings-pending-restart-notice"]')).toBeNull()

    const toggles = container.querySelectorAll('button[role="switch"]')
    const gpuToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("GPU de alto rendimiento") ||
      btn.closest(".settings-row")?.textContent?.includes("GPU de alto rendimiento"),
    ) as HTMLElement

    await act(async () => {
      gpuToggle.click()
    })

    const notice = container.querySelector('[data-testid="settings-pending-restart-notice"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain("Algunos cambios se aplicarán al reiniciar el juego.")
  })

  it("24. Changing RAM with game running shows inline pending restart notice", async () => {
    mockElectronAPI.getLaunchStatus = vi.fn().mockResolvedValue({ status: "running", operationState: "IDLE" })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    expect(container.querySelector('[data-testid="settings-pending-restart-notice"]')).toBeNull()

    const toggles = container.querySelectorAll('button[role="switch"]')
    const autoRamToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("Asignar automáticamente") ||
      btn.closest("div")?.textContent?.includes("Asignar automáticamente"),
    ) as HTMLElement
    expect(autoRamToggle).toBeDefined()

    await act(async () => {
      autoRamToggle.click()
    })

    const notice = container.querySelector('[data-testid="settings-pending-restart-notice"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain("Algunos cambios se aplicarán al reiniciar el juego.")
  })

  it("25. Changing GPU or RAM with game idle does NOT show pending restart notice", async () => {
    mockElectronAPI.getLaunchStatus = vi.fn().mockResolvedValue({ status: "idle", operationState: "IDLE" })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const toggles = container.querySelectorAll('button[role="switch"]')
    const gpuToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("GPU de alto rendimiento") ||
      btn.closest(".settings-row")?.textContent?.includes("GPU de alto rendimiento"),
    ) as HTMLElement

    await act(async () => {
      gpuToggle.click()
    })

    expect(container.querySelector('[data-testid="settings-pending-restart-notice"]')).toBeNull()
  })

  it("26. When game transitions from running to idle, pending restart notice disappears automatically", async () => {
    let launchStatusCallback: any = null
    mockElectronAPI.getLaunchStatus = vi.fn().mockResolvedValue({ status: "running", operationState: "IDLE" })
    mockElectronAPI.onLaunchStatus = vi.fn().mockImplementation((cb) => {
      launchStatusCallback = cb
      return () => {}
    })

    const container = await renderComponent(<SettingsView theme="dark" setTheme={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll("button"))
    const gamesTabBtn = buttons.find((b) => b.textContent?.includes("Juegos"))
    await act(async () => {
      gamesTabBtn?.click()
    })

    const toggles = container.querySelectorAll('button[role="switch"]')
    const gpuToggle = Array.from(toggles).find((btn) =>
      btn.getAttribute("aria-label")?.includes("GPU de alto rendimiento") ||
      btn.closest(".settings-row")?.textContent?.includes("GPU de alto rendimiento"),
    ) as HTMLElement

    await act(async () => {
      gpuToggle.click()
    })

    expect(container.querySelector('[data-testid="settings-pending-restart-notice"]')).not.toBeNull()

    // Game process terminates and launchStatus goes to 'idle'
    await act(async () => {
      launchStatusCallback?.("idle")
    })

    expect(container.querySelector('[data-testid="settings-pending-restart-notice"]')).toBeNull()
  })

  it("27. i18n locales ES, EN, FR, PT contain the exact pendingRestartNotice text", () => {
    expect(esLocale.settings.pendingRestartNotice).toBe("Algunos cambios se aplicarán al reiniciar el juego.")
    expect(enLocale.settings.pendingRestartNotice).toBe("Some changes will apply after restarting the game.")
    expect(frLocale.settings.pendingRestartNotice).toBe("Certains changements s’appliqueront après le redémarrage du jeu.")
    expect(ptLocale.settings.pendingRestartNotice).toBe("Algumas alterações serão aplicadas após reiniciar o jogo.")
  })
})

