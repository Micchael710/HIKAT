// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react"
import SkinsView from "./SkinsView"
import { skinsApi } from "../../services/graphqlClient"

describe("Back Office Skins Components (Shard 06.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders empty state when no skins are returned", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [],
      totalCount: 0,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    expect(screen.getByText("No hay skins registradas")).toBeDefined()
    expect(screen.getByText("Subir primera skin")).toBeDefined()
  })

  it("renders list of skins with badges, model type, and actions", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [
        {
          id: "skin-1",
          name: "Steve Clásico",
          model: "CLASSIC",
          imageUrl: "/media/content/steve.png",
          status: "AVAILABLE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "skin-2",
          name: "Alex Aventurera",
          model: "SLIM",
          imageUrl: "/media/content/alex.png",
          status: "UNAVAILABLE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      totalCount: 2,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    expect(screen.getByText("Steve Clásico")).toBeDefined()
    expect(screen.getByText("Alex Aventurera")).toBeDefined()
    expect(screen.getByText("Clásico")).toBeDefined()
    expect(screen.getByText("Delgado")).toBeDefined()
    expect(screen.getByText("Disponible")).toBeDefined()
    expect(screen.getByText("Oculto")).toBeDefined()
  })

  it("opens create skin modal on Nueva Skin button click", async () => {
    vi.spyOn(skinsApi, "getAdminSkins").mockResolvedValue({
      items: [],
      totalCount: 0,
    })

    await act(async () => {
      render(<SkinsView theme="dark" />)
    })

    const newBtn = screen.getByText("Nueva Skin")
    fireEvent.click(newBtn)

    expect(screen.getByText("Nombre de la Skin")).toBeDefined()
    expect(screen.getByText("Modelo de brazos")).toBeDefined()
  })
})
