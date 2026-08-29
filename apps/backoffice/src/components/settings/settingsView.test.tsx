// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import SettingsView from "./SettingsView"
import { settingsApi } from "../../services/graphqlClient"

describe("Back Office Configuration Component (Shard 08F Integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("loads and displays exclusively the deployment order configuration, with old forms completely removed", async () => {
    const mockSettings: import("../../types").AdminSettings = {
      projectName: "HiKAT Official",
      serverIp: "play.hikat.org",
      serverPort: 25565,
      discordUrl: "https://discord.gg/hikat",
      websiteUrl: "https://hikat.org",
      maintenanceEnabled: true,
      maintenanceMessage: "Actualizando mods...",
      minRamGb: 6,
      recommendedRamGb: 10,
      updateDeploymentOrder: "SERVER_FIRST",
      launcherActiveReleaseId: "rel-123",
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)

    await act(async () => {
      render(<SettingsView theme="dark" />)
    })

    // Header & Section title
    expect(screen.getByText("Configuración")).toBeDefined()
    expect(screen.getByText("Orden de las actualizaciones")).toBeDefined()
    expect(
      screen.getByText("Decide cuándo una versión publicada estará disponible para los jugadores."),
    ).toBeDefined()

    // Options and indicators
    expect(screen.getByText("Servidor primero")).toBeDefined()
    expect(screen.getByText("Recomendado")).toBeDefined()
    expect(screen.getByText("Jugadores primero")).toBeDefined()
    expect(
      screen.getByText(
        "La actualización estará disponible para los jugadores después de aplicarse correctamente al servidor.",
      ),
    ).toBeDefined()
    expect(
      screen.getByText(
        "La actualización estará disponible para los jugadores al publicarla. El servidor podrá actualizarse después.",
      ),
    ).toBeDefined()

    // Button
    expect(screen.getByText("Guardar cambios")).toBeDefined()

    // OLD SETTINGS MUST NOT APPEAR ANYWHERE IN VISIBLE CONTENT
    expect(screen.queryByText("Nombre del Proyecto")).toBeNull()
    expect(screen.queryByText("Dirección para jugar")).toBeNull()
    expect(screen.queryByText("Enlace de Discord")).toBeNull()
    expect(screen.queryByText("Sitio Web Oficial")).toBeNull()
    expect(screen.queryByText("Modo Mantenimiento")).toBeNull()
    expect(screen.queryByText("Parámetros de Memoria RAM (Launcher)")).toBeNull()
    expect(screen.queryByDisplayValue("HiKAT Official")).toBeNull()
    expect(screen.queryByDisplayValue("play.hikat.org")).toBeNull()
    expect(screen.queryByDisplayValue("Actualizando mods...")).toBeNull()
  })

  it("does not render internal technical enum names in the UI text", async () => {
    const mockSettings: import("../../types").AdminSettings = {
      projectName: "HiKAT",
      serverIp: "mc.hikat.org",
      serverPort: 25565,
      discordUrl: null,
      websiteUrl: null,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minRamGb: 4,
      recommendedRamGb: 8,
      updateDeploymentOrder: "SERVER_FIRST",
      launcherActiveReleaseId: null,
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)

    const { container } = render(<SettingsView theme="dark" />)
    await act(async () => {})

    const fullText = container.textContent || ""
    expect(fullText).not.toContain("SERVER_FIRST")
    expect(fullText).not.toContain("PLAYERS_FIRST")
    expect(fullText).not.toContain("launcherActiveReleaseId")
    expect(fullText).not.toContain("project_settings")
  })

  it("displays warning banner when Jugadores primero is selected", async () => {
    const mockSettings: import("../../types").AdminSettings = {
      projectName: "HiKAT",
      serverIp: "mc.hikat.org",
      serverPort: 25565,
      discordUrl: null,
      websiteUrl: null,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minRamGb: 4,
      recommendedRamGb: 8,
      updateDeploymentOrder: "PLAYERS_FIRST",
      launcherActiveReleaseId: null,
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)

    await act(async () => {
      render(<SettingsView theme="dark" />)
    })

    expect(
      screen.getByText(
        "Puede existir un periodo en el que los jugadores y el servidor tengan versiones diferentes.",
      ),
    ).toBeDefined()
  })

  it("allows switching to Jugadores primero, shows warning, and submits update mutation", async () => {
    const mockSettings: import("../../types").AdminSettings = {
      projectName: "HiKAT",
      serverIp: "mc.hikat.org",
      serverPort: 25565,
      discordUrl: null,
      websiteUrl: null,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minRamGb: 4,
      recommendedRamGb: 8,
      updateDeploymentOrder: "SERVER_FIRST",
      launcherActiveReleaseId: null,
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)
    const updateSpy = vi.spyOn(settingsApi, "updateAdminSettings").mockResolvedValue({
      ...mockSettings,
      updateDeploymentOrder: "PLAYERS_FIRST",
    })

    await act(async () => {
      render(<SettingsView theme="dark" />)
    })

    // Initially warning is not present
    expect(
      screen.queryByText(
        "Puede existir un periodo en el que los jugadores y el servidor tengan versiones diferentes.",
      ),
    ).toBeNull()

    // Click on Jugadores primero
    const playersFirstOption = screen.getByText("Jugadores primero")
    await act(async () => {
      fireEvent.click(playersFirstOption)
    })

    // Warning should now be visible
    expect(
      screen.getByText(
        "Puede existir un periodo en el que los jugadores y el servidor tengan versiones diferentes.",
      ),
    ).toBeDefined()

    // Click Guardar cambios
    const saveBtn = screen.getByText("Guardar cambios")
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(updateSpy).toHaveBeenCalledWith({
      updateDeploymentOrder: "PLAYERS_FIRST",
    })

    // Verify success toast message
    expect(screen.getByText("Ajustes guardados correctamente.")).toBeDefined()
  })

  it("handles update failure without showing false success toast and displays error banner", async () => {
    const mockSettings: import("../../types").AdminSettings = {
      projectName: "HiKAT",
      serverIp: "mc.hikat.org",
      serverPort: 25565,
      discordUrl: null,
      websiteUrl: null,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minRamGb: 4,
      recommendedRamGb: 8,
      updateDeploymentOrder: "SERVER_FIRST",
      launcherActiveReleaseId: null,
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)
    vi.spyOn(settingsApi, "updateAdminSettings").mockRejectedValue(
      new Error("No tienes permisos para modificar esta configuración."),
    )

    await act(async () => {
      render(<SettingsView theme="dark" />)
    })

    const saveBtn = screen.getByText("Guardar cambios")
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(screen.getByText("No tienes permisos para modificar esta configuración.")).toBeDefined()
    expect(screen.queryByText("Ajustes guardados correctamente.")).toBeNull()
  })
})
