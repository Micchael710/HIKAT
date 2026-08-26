// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"

import {
  formatBytesToHuman,
  formatUptime,
  getServerStatusLabel,
  mapPterodactylStateToHiKAT,
  validateServerCommand,
  SERVER_LIMITS,
  SERVER_PUBLIC_MESSAGES,
} from "@hikat/shared"
import ServerOverviewView from "./ServerOverviewView"
import ServerConsoleView from "./ServerConsoleView"
import { consoleService } from "../../services/consoleService"
import { authService } from "../../services/authService"
import { serverApi } from "../../services/graphqlClient"

describe("Back Office Server Administration Helpers & Validations (Shard 06, 06A, 06B & 06C)", () => {
  it("formats byte values into human units correctly", () => {
    expect(formatBytesToHuman(0)).toBe("0 B")
    expect(formatBytesToHuman(1024)).toBe("1.0 KB")
    expect(formatBytesToHuman(1024 * 1024 * 512)).toBe("512.0 MB")
    expect(formatBytesToHuman(1024 * 1024 * 1024 * 8)).toBe("8.0 GB")
    expect(formatBytesToHuman(1024 * 1024 * 1024 * 50)).toBe("50.0 GB")
    expect(formatBytesToHuman(-100)).toBe("0 B")
  })

  it("formats uptime in milliseconds to human Spanish text", () => {
    expect(formatUptime(0)).toBe("-")
    expect(formatUptime(null)).toBe("-")
    expect(formatUptime(undefined)).toBe("-")
    expect(formatUptime(30000)).toBe("30s")
    expect(formatUptime(90000)).toBe("1m 30s")
    expect(formatUptime(3600000 * 4 + 60000 * 25)).toBe("4h 25m")
    expect(formatUptime(86400000 * 3 + 3600000 * 5)).toBe("3d 5h")
  })

  it("provides clean human Spanish labels for server states", () => {
    expect(getServerStatusLabel("ONLINE")).toBe("En línea")
    expect(getServerStatusLabel("STARTING")).toBe("Iniciando")
    expect(getServerStatusLabel("STOPPING")).toBe("Apagándose")
    expect(getServerStatusLabel("OFFLINE")).toBe("Apagado")
    expect(getServerStatusLabel("DISCONNECTED")).toBe("Sin conexión")
    expect(getServerStatusLabel("UNKNOWN")).toBe("Estado desconocido")
  })

  it("maps Pterodactyl state strings accurately", () => {
    expect(mapPterodactylStateToHiKAT("running")).toBe("ONLINE")
    expect(mapPterodactylStateToHiKAT("starting")).toBe("STARTING")
    expect(mapPterodactylStateToHiKAT("stopping")).toBe("STOPPING")
    expect(mapPterodactylStateToHiKAT("offline")).toBe("OFFLINE")
    expect(mapPterodactylStateToHiKAT("running", true)).toBe("DISCONNECTED")
    expect(mapPterodactylStateToHiKAT("")).toBe("UNKNOWN")
    expect(mapPterodactylStateToHiKAT(undefined)).toBe("UNKNOWN")
  })

  it("enforces command validation with validateServerCommand", () => {
    expect(SERVER_LIMITS.MAX_COMMAND_LENGTH).toBe(500)

    const valid = validateServerCommand("say Hello World")
    expect(valid.valid).toBe(true)
    expect(valid.command).toBe("say Hello World")

    const empty = validateServerCommand("   ")
    expect(empty.valid).toBe(false)
    expect(empty.error).toContain("vacío")

    const oversized = validateServerCommand("a".repeat(501))
    expect(oversized.valid).toBe(false)
    expect(oversized.error).toContain("500")
  })
})

describe("ConsoleService GraphQL Submission & WebSocket Ticket (Shard 06B & 06C)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consoleService.disconnect()
  })

  afterEach(() => {
    consoleService.disconnect()
    vi.restoreAllMocks()
  })

  it("obtains a single-use console ticket via GraphQL and establishes WebSocket without JWT in URL", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("mock-access-token-jwt")
    const createTicketSpy = vi.spyOn(serverApi, "createServerConsoleTicket").mockResolvedValue({
      ticket: "cstk_1234567890abcdef",
      expiresAt: new Date(Date.now() + 45000).toISOString(),
    })

    let openedUrl = ""
    class MockWebSocket {
      public readyState = 1
      constructor(public url: string) {
        openedUrl = url
        setTimeout(() => {
          if (this.onopen) this.onopen({} as any)
        }, 0)
      }
      public onopen: any = null
      public onmessage: any = null
      public onclose: any = null
      public onerror: any = null
      public send = vi.fn()
      public close = vi.fn()
    }

    vi.stubGlobal("WebSocket", MockWebSocket)

    await consoleService.connect()

    expect(createTicketSpy).toHaveBeenCalledTimes(1)
    expect(openedUrl).toContain("/api/server/console/ws?ticket=cstk_1234567890abcdef")
    expect(openedUrl).not.toContain("token=")
    expect(openedUrl).not.toContain("mock-access-token-jwt")
    expect(openedUrl).not.toContain("accessToken=")
  })

  it("always sends commands via serverApi.sendServerCommand GraphQL mutation", async () => {
    const sendCommandSpy = vi.spyOn(serverApi, "sendServerCommand").mockResolvedValue({
      success: true,
      message: "Comando enviado correctamente.",
    })

    await consoleService.sendCommand("say Hola HiKAT")
    expect(sendCommandSpy).toHaveBeenCalledWith("say Hola HiKAT")

    sendCommandSpy.mockResolvedValueOnce({
      success: false,
      message: SERVER_PUBLIC_MESSAGES.COMMAND_RATE_LIMITED,
    })

    await expect(consoleService.sendCommand("say spam")).rejects.toThrow(
      "Has enviado demasiados comandos. Espera un momento.",
    )
  })
})

describe("Real React Test: ServerOverviewView (Shard 06C)", () => {
  const mockServerResources = {
    status: "ONLINE" as const,
    cpuPercent: 12.5,
    cpuLimitPercent: 100,
    memoryUsedBytes: 2147483648,
    memoryLimitBytes: 4294967296,
    diskUsedBytes: 10737418240,
    diskLimitBytes: 53687091200,
    uptimeMs: 3600000,
    isSuspended: false,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })


  it("mounts real ServerOverviewView component and verifies complete polling lifecycle", async () => {
    let getStatusCallCount = 0
    vi.spyOn(serverApi, "getServerStatus").mockImplementation(async () => {
      getStatusCallCount++
      return mockServerResources
    })

    // 1. Mount component real
    let unmountFn: () => void = () => {}
    await act(async () => {
      const { unmount } = render(<ServerOverviewView theme="dark" />)
      unmountFn = unmount
    })

    // Mount fetch
    expect(getStatusCallCount).toBe(1)
    expect(screen.getByText("Servidor Principal")).toBeDefined()
    expect(screen.getByText("En línea")).toBeDefined()

    // 2. Polling: advance fake timers 5000ms -> exactly 2 calls total
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(getStatusCallCount).toBe(2)

    // Advance another 5000ms -> exactly 3 calls total
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(getStatusCallCount).toBe(3)

    // 3. Hidden tab: change document.visibilityState to 'hidden'
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    // No new fetches while tab is hidden
    expect(getStatusCallCount).toBe(3)

    // 4. Visible again: change to 'visible' and dispatch real DOM event
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    // Exactly 1 immediate refresh
    expect(getStatusCallCount).toBe(4)

    // 5. No overlap: make request remain in-flight and verify no duplicate trigger
    let resolveInFlight: ((val: any) => void) | null = null
    vi.spyOn(serverApi, "getServerStatus").mockImplementation(
      () =>
        new Promise((resolve) => {
          getStatusCallCount++
          resolveInFlight = resolve
        }),
    )

    // Advance 5000ms to trigger in-flight fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(getStatusCallCount).toBe(5) // In-flight request started

    // Advance another 5000ms while still in-flight
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    // Must NOT start another request while previous is in-flight!
    expect(getStatusCallCount).toBe(5)

    // Resolve in-flight request
    await act(async () => {
      if (resolveInFlight) resolveInFlight(mockServerResources)
    })

    // 6. Unmount component and verify timers are destroyed
    await act(async () => {
      unmountFn()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    // No additional calls after unmount
    expect(getStatusCallCount).toBe(5)
  })
})

describe("Real React Test: ServerConsoleView (Shard 06C)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })


  it("handles successful command submission in real DOM: clears input and appends echo log", async () => {
    vi.spyOn(consoleService, "connect").mockImplementation(() => Promise.resolve())
    vi.spyOn(consoleService, "disconnect").mockImplementation(() => {})
    vi.spyOn(consoleService, "onLog").mockImplementation(() => () => {})
    const sendCommandSpy = vi
      .spyOn(consoleService, "sendCommand")
      .mockResolvedValue(undefined)

    render(<ServerConsoleView serverStatus="ONLINE" theme="dark" />)

    const input = screen.getByPlaceholderText(/Escribe un comando/i) as HTMLInputElement
    const sendButton = screen.getByRole("button", { name: /Enviar/i })

    // User types "say Hola Mundo"
    fireEvent.change(input, { target: { value: "say Hola Mundo" } })
    expect(input.value).toBe("say Hola Mundo")

    // User clicks "Enviar"
    await act(async () => {
      fireEvent.click(sendButton)
    })

    expect(sendCommandSpy).toHaveBeenCalledWith("say Hola Mundo")
    // Verifies local echo appears in DOM
    expect(screen.getByText("> say Hola Mundo")).toBeDefined()
    // Verifies input is cleaned on success
    expect(input.value).toBe("")
  })

  it("handles rate-limited command in real DOM: preserves input, shows toast, and skips fake echo log", async () => {
    vi.spyOn(consoleService, "connect").mockImplementation(() => Promise.resolve())
    vi.spyOn(consoleService, "disconnect").mockImplementation(() => {})
    vi.spyOn(consoleService, "onLog").mockImplementation(() => () => {})
    vi.spyOn(consoleService, "sendCommand").mockRejectedValue(
      new Error("Has enviado demasiados comandos. Espera un momento."),
    )

    render(<ServerConsoleView serverStatus="ONLINE" theme="dark" />)

    const input = screen.getByPlaceholderText(/Escribe un comando/i) as HTMLInputElement
    const sendButton = screen.getByRole("button", { name: /Enviar/i })

    // User types "say Spam Command"
    fireEvent.change(input, { target: { value: "say Spam Command" } })
    expect(input.value).toBe("say Spam Command")

    // User clicks "Enviar"
    await act(async () => {
      fireEvent.click(sendButton)
    })

    // Verifies fake echo was NOT added
    expect(screen.queryByText("> say Spam Command")).toBeNull()
    // Verifies input was NOT wiped out so user does not lose typed text
    expect(input.value).toBe("say Spam Command")
    // Verifies human error toast appears in DOM
    expect(
      screen.getByText("Has enviado demasiados comandos. Espera un momento."),
    ).toBeDefined()
  })
})
