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

  it("3. When serverStatus is ONLINE, queries getServerPing immediately and starts 15s interval", async () => {
    vi.useFakeTimers()
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockResolvedValue({
      latencyMs: 45,
      playersOnline: 10,
      maxPlayers: 50,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-mc-1"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Immediate query on mount
    expect(pingSpy).toHaveBeenCalledTimes(1)
    expect(pingSpy).toHaveBeenCalledWith("srv-mc-1")
    expect(container.textContent).toContain("10")
    expect(container.textContent).toContain("50")
    expect(container.textContent).toContain("45 ms")

    // Advance timer by 15s -> second ping
    await act(async () => {
      vi.advanceTimersByTime(15000)
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledTimes(2)

    // Advance timer by another 15s -> third ping
    await act(async () => {
      vi.advanceTimersByTime(15000)
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledTimes(3)

    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  it("4. When serverStatus is not ONLINE (e.g. OFFLINE, STARTING, STOPPING), does not ping and shows '-- ms'", async () => {
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockResolvedValue({
      latencyMs: 50,
      playersOnline: 5,
      maxPlayers: 20,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-mc-1"
            serverStatus="OFFLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(pingSpy).not.toHaveBeenCalled()
    expect(container.textContent).toContain("-- ms")
    expect(container.textContent).toContain("--")

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("5. When server transitions from ONLINE to OFFLINE, stops polling immediately and shows '-- ms'", async () => {
    vi.useFakeTimers()
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockResolvedValue({
      latencyMs: 30,
      playersOnline: 4,
      maxPlayers: 20,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    // Mount ONLINE
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-mc-1"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("30 ms")

    // Update prop to OFFLINE
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-mc-1"
            serverStatus="OFFLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain("-- ms")

    // Advancing timers should not cause any further pings
    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  it("6. When server returns to ONLINE, queries immediately and resumes 15s interval", async () => {
    vi.useFakeTimers()
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockResolvedValue({
      latencyMs: 22,
      playersOnline: 8,
      maxPlayers: 20,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    // Start OFFLINE
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-mc-1"
            serverStatus="OFFLINE"
          />
        </LanguageProvider>,
      )
    })
    expect(pingSpy).not.toHaveBeenCalled()

    // Transition to ONLINE
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-mc-1"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    // Immediate query
    expect(pingSpy).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("22 ms")

    // Advance 15s -> continues polling
    await act(async () => {
      vi.advanceTimersByTime(15000)
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledTimes(2)

    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  it("7. Changing serverId cleanly unmounts/cancels previous polling and queries new server", async () => {
    vi.useFakeTimers()
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockImplementation(async (id: string) => {
      return {
        latencyMs: id === "srv-1" ? 15 : 60,
        playersOnline: id === "srv-1" ? 3 : 15,
        maxPlayers: id === "srv-1" ? 10 : 100,
      }
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    // Mount on srv-1
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-1"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledWith("srv-1")
    expect(container.textContent).toContain("15 ms")

    // Switch to srv-2
    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-2"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledWith("srv-2")
    expect(container.textContent).toContain("60 ms")

    // Subsequent 15s tick polls srv-2, not srv-1
    pingSpy.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(15000)
      await Promise.resolve()
    })
    expect(pingSpy).toHaveBeenCalledTimes(1)
    expect(pingSpy).toHaveBeenCalledWith("srv-2")

    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  it("8. Does not poll while isActive is false", async () => {
    vi.useFakeTimers()
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockResolvedValue({
      latencyMs: 25,
      playersOnline: 2,
      maxPlayers: 10,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={false}
            serverId="srv-1"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })

    expect(pingSpy).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
    })
    expect(pingSpy).not.toHaveBeenCalled()

    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  it("9. Handles errors from Pterodactyl or Minecraft ping without crashing Home", async () => {
    const pingSpy = vi.spyOn(serverService, "getServerPing").mockRejectedValue(new Error("Network timeout"))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LanguageProvider>
          <ServerStatsGrid
            theme="dark"
            isActive={true}
            serverId="srv-error"
            serverStatus="ONLINE"
          />
        </LanguageProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(pingSpy).toHaveBeenCalledTimes(1)
    // Component renders without throw
    expect(container.textContent).toContain("-- ms")

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})

