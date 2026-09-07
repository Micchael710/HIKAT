// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import DashboardView from "./DashboardView"
import { serverApi, newsApi, gameApi } from "../../services/graphqlClient"

describe("Back Office Scoped Dashboard Component (Phase 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders loading state then loads scoped dashboard data cleanly", async () => {
    vi.spyOn(serverApi, "getServerStatus").mockResolvedValue({
      status: "ONLINE",
      cpuPercent: 25.5,
      memoryUsedBytes: 2 * 1024 * 1024 * 1024,
      diskUsedBytes: 5 * 1024 * 1024 * 1024,
      isSuspended: false,
    })

    vi.spyOn(newsApi, "getAdminNews").mockResolvedValue({
      items: [],
      edges: [
        { node: { id: "n1", title: "N1", content: "", type: "ANNOUNCEMENT", status: "PUBLISHED", createdAt: "", updatedAt: "" }, cursor: "c1" },
        { node: { id: "n2", title: "N2", content: "", type: "UPDATE", status: "DRAFT", createdAt: "", updatedAt: "" }, cursor: "c2" },
      ],
      totalCount: 2,
    })

    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
      publishedRelease: {
        id: "rel-1",
        version: "1.4.2",
        minecraftVersion: "1.20.1",
        modLoader: "FABRIC",
        status: "PUBLISHED",
        files: [],
        createdAt: "",
        updatedAt: "",
      },
      draftRelease: null,
      pendingChangesCount: 2,
      changes: {
        added: 2,
        updated: 0,
        removed: 0,
        unchanged: 10,
        total: 2,
      },
    })

    const onNavigate = vi.fn()

    await act(async () => {
      render(
        <DashboardView
          theme="dark"
          serverId="srv-1"
          server={{
            id: "srv-1",
            name: "Survival Principal",
            minecraftVersion: "1.20.1",
            modLoader: "FABRIC",
            cpu: 200,
            memoryMb: 4096,
            diskMb: 10240,
            provisioningStatus: "READY",
            createdAt: "",
            updatedAt: "",
          }}
          onNavigate={onNavigate}
        />,
      )
    })

    expect(screen.getByText("Dashboard: Survival Principal")).toBeDefined()
    expect(screen.getByText("En línea")).toBeDefined()
    expect(screen.getByText("1")).toBeDefined()
    expect(screen.getByText("v1.4.2")).toBeDefined()
    expect(screen.getByText("2 cambios en borrador")).toBeDefined()

    // Test quick navigation
    const newsBtn = screen.getByText("Ver noticias →")
    fireEvent.click(newsBtn)
    expect(onNavigate).toHaveBeenCalledWith("news")
  })

  it("handles server offline / unconfigured fallback gracefully", async () => {
    vi.spyOn(serverApi, "getServerStatus").mockResolvedValue({
      status: "UNKNOWN",
      cpuPercent: 0,
      memoryUsedBytes: 0,
      diskUsedBytes: 0,
      isSuspended: false,
    })

    vi.spyOn(newsApi, "getAdminNews").mockResolvedValue({
      items: [],
      edges: [],
      totalCount: 0,
    })

    vi.spyOn(gameApi, "getAdminGameOverview").mockResolvedValue({
      publishedRelease: null,
      draftRelease: null,
      pendingChangesCount: 0,
    })

    await act(async () => {
      render(
        <DashboardView
          theme="light"
          serverId="srv-2"
          onNavigate={vi.fn()}
        />,
      )
    })

    expect(screen.getByText("No disponible")).toBeDefined()
    expect(screen.getByText("Sin publicar")).toBeDefined()
  })
})
