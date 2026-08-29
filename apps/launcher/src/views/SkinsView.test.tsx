// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import SkinsView from "./SkinsView"
import { LanguageProvider } from "../context/LanguageContext"
import { PlayerSkin, PlayerCape } from "../types"

// Mock SkinViewer3D to avoid WebGL context requirements in jsdom
vi.mock("../components/minecraft/SkinViewer3D", () => ({
  default: () => <div data-testid="mock-skin-viewer-3d" />,
}))

// Mock SkinCardPreview and CapeCardPreview
vi.mock("../components/minecraft/SkinCardPreview", () => ({
  default: () => <div data-testid="mock-skin-card-preview" />,
}))

vi.mock("../components/minecraft/CapeCardPreview", () => ({
  default: () => <div data-testid="mock-cape-card-preview" />,
}))

describe("SkinsView Component — Custom Skin & Cape Delete Button Placement", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    localStorage.setItem("hikat_language", "es")
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
      root.render(ui)
    })
    unmountCurrent = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    return container
  }

  const mockCustomSkin: PlayerSkin = {
    id: "skin-uuid-1",
    userId: "user-1",
    imageUrl: "https://assets.hikat.org/skin-1.png",
    createdAt: "2026-08-29T12:00:00Z",
    updatedAt: "2026-08-29T12:00:00Z",
  }

  const mockCustomCape: PlayerCape = {
    id: "cape-custom-1",
    userId: "user-1",
    name: "Capa Dragón",
    imageUrl: "https://assets.hikat.org/cape-1.png",
    createdAt: "2026-08-29T12:00:00Z",
    updatedAt: "2026-08-29T12:00:00Z",
  }

  it("1. Renders upload button, but NO delete button when using default skin", async () => {
    const container = await renderComponent(
      <LanguageProvider>
        <SkinsView
          username="TestUser"
          appliedSkin="alex"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          playerSkin={null}
        />
      </LanguageProvider>,
    )

    expect(container.textContent).toContain("Subir personalizado")
    expect(container.querySelector(".launcher-btn-danger")).toBeNull()
  })

  it("2. Renders delete skin button next to upload button when custom skin is active", async () => {
    const onDeleteSkin = vi.fn().mockResolvedValue(true)

    const container = await renderComponent(
      <LanguageProvider>
        <SkinsView
          username="TestUser"
          appliedSkin="player-custom"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          playerSkin={mockCustomSkin}
          onDeleteSkin={onDeleteSkin}
        />
      </LanguageProvider>,
    )

    const deleteBtn = container.querySelector(".launcher-btn-danger") as HTMLButtonElement
    const uploadBtn = container.querySelector(".launcher-btn-secondary") as HTMLButtonElement

    expect(deleteBtn).not.toBeNull()
    expect(uploadBtn).not.toBeNull()
    expect(deleteBtn.textContent).toContain("Eliminar Skin")
    expect(uploadBtn.textContent).toContain("Subir personalizado")

    // Verify parent container holds both buttons side-by-side
    expect(deleteBtn.parentElement).toBe(uploadBtn.parentElement)

    // Click delete
    await act(async () => {
      deleteBtn.click()
    })

    expect(onDeleteSkin).toHaveBeenCalledTimes(1)
  })

  it("3. Bottom info card does NOT contain redundant delete row", async () => {
    const container = await renderComponent(
      <LanguageProvider>
        <SkinsView
          username="TestUser"
          appliedSkin="player-custom"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          playerSkin={mockCustomSkin}
        />
      </LanguageProvider>,
    )

    // The text 'Tu skin personalizada activa' was removed from the info card
    expect(container.textContent).not.toContain("Tu skin personalizada activa")
  })

  it("4. Renders delete cape button next to upload button when custom cape is active in capes tab", async () => {
    const onDeleteCape = vi.fn().mockResolvedValue(true)

    const container = await renderComponent(
      <LanguageProvider>
        <SkinsView
          username="TestUser"
          appliedSkin="alex"
          setAppliedSkin={vi.fn()}
          appliedCape="cape-custom-1"
          setAppliedCape={vi.fn()}
          playerCapes={[mockCustomCape]}
          onDeleteCape={onDeleteCape}
        />
      </LanguageProvider>,
    )

    // Switch to capes tab
    const tabs = Array.from(container.querySelectorAll("button"))
    const capesTab = tabs.find((b) => b.textContent?.includes("Capas"))
    expect(capesTab).toBeDefined()

    await act(async () => {
      capesTab?.click()
    })

    const deleteBtn = container.querySelector(".launcher-btn-danger") as HTMLButtonElement
    const uploadBtn = container.querySelector(".launcher-btn-secondary") as HTMLButtonElement

    expect(deleteBtn).not.toBeNull()
    expect(uploadBtn).not.toBeNull()
    expect(deleteBtn.textContent).toContain("Eliminar Capa")
    expect(uploadBtn.textContent).toContain("Subir Capa")

    // Click delete cape
    await act(async () => {
      deleteBtn.click()
    })

    expect(onDeleteCape).toHaveBeenCalledWith("cape-custom-1")
  })

  it("5. Renders localized 'No Skin' and 'No Cape' when language is 'en'", async () => {
    localStorage.setItem("hikat_language", "en")

    const container = await renderComponent(
      <LanguageProvider>
        <SkinsView
          username="TestUser"
          appliedSkin="none"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          playerSkin={null}
        />
      </LanguageProvider>,
    )

    // Skin tab: "No Skin" should be rendered in the placeholder
    expect(container.textContent).toContain("No Skin")
    expect(container.textContent).not.toContain("Sin Skin")

    // Switch to Capes tab
    const tabs = Array.from(container.querySelectorAll("button"))
    const capesTab = tabs.find((b) => b.textContent?.includes("Capes"))
    expect(capesTab).toBeDefined()

    await act(async () => {
      capesTab?.click()
    })

    // Cape tab: "No Cape" should be rendered in the placeholder
    expect(container.textContent).toContain("No Cape")
    expect(container.textContent).not.toContain("Sin Capa")
  })
})
