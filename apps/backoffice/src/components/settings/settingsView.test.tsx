// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import SettingsView from "./SettingsView"
import { settingsApi } from "../../services/graphqlClient"

describe("Back Office Settings Component (Shard 06.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("loads and displays typed project and launcher settings", async () => {
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
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)

    await act(async () => {
      render(<SettingsView theme="dark" />)
    })

    expect(screen.getByText("Ajustes del Proyecto")).toBeDefined()
    expect(screen.getByDisplayValue("HiKAT Official")).toBeDefined()
    expect(screen.getByDisplayValue("play.hikat.org")).toBeDefined()
    expect(screen.getByDisplayValue("Actualizando mods...")).toBeDefined()
    expect(screen.getByText("Activado")).toBeDefined()
  })

  it("allows updating settings and submits typed values", async () => {
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
      updatedAt: new Date().toISOString(),
    }

    vi.spyOn(settingsApi, "getAdminSettings").mockResolvedValue(mockSettings)
    const updateSpy = vi.spyOn(settingsApi, "updateAdminSettings").mockResolvedValue({
      ...mockSettings,
      projectName: "HiKAT New",
    })

    await act(async () => {
      render(<SettingsView theme="dark" />)
    })

    const nameInput = screen.getByDisplayValue("HiKAT")
    fireEvent.change(nameInput, { target: { value: "HiKAT New" } })

    const saveBtn = screen.getByText("Guardar ajustes")
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "HiKAT New",
        serverIp: "mc.hikat.org",
      }),
    )
  })
})
