// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import DashboardView from "./DashboardView"
import { dashboardApi } from "../../services/graphqlClient"

describe("Back Office Dashboard Component (Shard 06.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders loading state then loads dashboard summary data cleanly", async () => {
    const mockSummary: import("../../types").AdminDashboardSummary = {
      server: { status: "ONLINE" },
      news: { publishedCount: 12, draftCount: 3 },
      skins: { totalCount: 25, availableCount: 20 },
      game: { publishedVersion: "1.4.2", publishedAt: new Date().toISOString(), pendingChangesCount: 2 },
    }

    vi.spyOn(dashboardApi, "getAdminDashboard").mockResolvedValue(mockSummary)

    const onNavigate = vi.fn()

    await act(async () => {
      render(<DashboardView theme="dark" onNavigate={onNavigate} />)
    })

    expect(screen.getByText("Panel de control")).toBeDefined()
    expect(screen.getByText("En línea")).toBeDefined()
    expect(screen.getByText("12")).toBeDefined()
    expect(screen.getByText("20")).toBeDefined()
    expect(screen.getByText("v1.4.2")).toBeDefined()
    expect(screen.getByText("2 cambios en borrador")).toBeDefined()

    // Test quick navigation
    const newsBtn = screen.getByText("Ver noticias →")
    fireEvent.click(newsBtn)
    expect(onNavigate).toHaveBeenCalledWith("news")
  })

  it("handles server offline / unconfigured fallback gracefully", async () => {
    const mockSummary: import("../../types").AdminDashboardSummary = {
      server: { status: "UNKNOWN" },
      news: { publishedCount: 0, draftCount: 0 },
      skins: { totalCount: 0, availableCount: 0 },
      game: { publishedVersion: null, publishedAt: null, pendingChangesCount: 0 },
    }

    vi.spyOn(dashboardApi, "getAdminDashboard").mockResolvedValue(mockSummary)

    await act(async () => {
      render(<DashboardView theme="light" onNavigate={vi.fn()} />)
    })

    expect(screen.getByText("No disponible")).toBeDefined()
    expect(screen.getByText("Sin publicar")).toBeDefined()
  })
})
