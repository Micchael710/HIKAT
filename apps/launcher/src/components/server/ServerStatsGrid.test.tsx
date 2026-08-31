// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import ServerStatsGrid from "./ServerStatsGrid"
import { LanguageProvider } from "../../context/LanguageContext"
import { serverService } from "../../services/serverService"

describe("ServerStatsGrid Component Lifecycle & isActive Verification", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("1. Mount with isActive: true queries serverService.getServerStatus()", async () => {
    const statsSpy = vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
      online: true,
      playersOnline: 5,
      maxPlayers: 20,
      latencyMs: 32,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid theme="dark" isActive={true} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(statsSpy).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("5")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("2. When Home stays mounted and isActive toggles false -> true, queries server status again", async () => {
    const statsSpy = vi.spyOn(serverService, "getServerStatus").mockResolvedValue({
      online: true,
      playersOnline: 8,
      maxPlayers: 20,
      latencyMs: 25,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    // 1. Initial mount on Home (isActive: true)
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid theme="dark" isActive={true} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(statsSpy).toHaveBeenCalledTimes(1)

    // 2. User goes to Skins (isActive: false) -> no new query
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid theme="dark" isActive={false} />
        </LanguageProvider>,
      )
    })
    expect(statsSpy).toHaveBeenCalledTimes(1)

    // 3. User returns to Home (isActive: true) -> fresh query
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid theme="dark" isActive={true} />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(statsSpy).toHaveBeenCalledTimes(2)

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
