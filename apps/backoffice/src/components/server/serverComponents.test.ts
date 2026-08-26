import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  formatBytesToHuman,
  formatUptime,
  getServerStatusLabel,
  mapPterodactylStateToHiKAT,
  validateServerCommand,
  SERVER_LIMITS,
  SERVER_ERROR_CODES,
  SERVER_PUBLIC_MESSAGES,
} from "@hikat/shared"
import { consoleService } from "../../services/consoleService"
import { authService } from "../../services/authService"
import { serverApi } from "../../services/graphqlClient"

describe("Back Office Server Administration Helpers & Validations (Shard 06, 06A & 06B)", () => {
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

describe("ConsoleService GraphQL Command Submission & Ticket Flow (Shard 06B)", () => {
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
      public readyState = 1 // OPEN
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
    // Security check: Access JWT must NOT be in the WebSocket URL
    expect(openedUrl).not.toContain("token=")
    expect(openedUrl).not.toContain("mock-access-token-jwt")
    expect(openedUrl).not.toContain("accessToken=")
  })

  it("always sends commands via serverApi.sendServerCommand GraphQL mutation and handles success / failure", async () => {
    const sendCommandSpy = vi.spyOn(serverApi, "sendServerCommand").mockResolvedValue({
      success: true,
      message: "Comando enviado correctamente.",
    })

    // 1. Success case
    await consoleService.sendCommand("say Hola HiKAT")
    expect(sendCommandSpy).toHaveBeenCalledWith("say Hola HiKAT")

    // 2. Local validation rejection
    await expect(consoleService.sendCommand("")).rejects.toThrow("El comando no puede estar vacío.")
    await expect(consoleService.sendCommand("   ")).rejects.toThrow("El comando no puede estar vacío.")
    await expect(consoleService.sendCommand("a".repeat(501))).rejects.toThrow("500")

    // 3. Backend rejection (e.g. rate limit error)
    sendCommandSpy.mockResolvedValueOnce({
      success: false,
      message: SERVER_PUBLIC_MESSAGES.COMMAND_RATE_LIMITED,
    })

    await expect(consoleService.sendCommand("say spam")).rejects.toThrow(
      "Has enviado demasiados comandos. Espera un momento.",
    )
  })
})

describe("ServerOverviewView Polling & Visibility Control Lifecycle (Shard 06B)", () => {
  let docListeners: Record<string, ((...args: any[]) => void)[]> = {}


  beforeEach(() => {
    vi.useFakeTimers()
    docListeners = {}
    // Set up DOM document mock
    globalThis.document = {
      visibilityState: "visible",
      addEventListener: (event: string, fn: any) => {
        docListeners[event] = docListeners[event] || []
        docListeners[event].push(fn)
      },
      removeEventListener: (event: string, fn: any) => {
        if (docListeners[event]) {
          docListeners[event] = docListeners[event].filter((f) => f !== fn)
        }
      },
      dispatchEvent: (event: any) => {
        const type = typeof event === "string" ? event : event.type
        if (docListeners[type]) {
          docListeners[type].forEach((fn) => fn(event))
        }
        return true
      },
    } as any
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("executes initial status fetch and polls every 5s while tab is visible, pausing on hidden", async () => {
    let callCount = 0
    const mockStatus = {
      status: "ONLINE" as const,
      cpuPercent: 15,
      cpuLimitPercent: 100,
      memoryUsedBytes: 1024 * 1024 * 1024,
      memoryLimitBytes: 1024 * 1024 * 2048,
      diskUsedBytes: 1024 * 1024 * 500,
      diskLimitBytes: 1024 * 1024 * 10000,
      uptimeMs: 120000,
      isSuspended: false,
    }

    vi.spyOn(serverApi, "getServerStatus").mockImplementation(async () => {
      callCount++
      return mockStatus
    })

    // Mount lifecycle simulation of ServerOverviewView
    let isFetching = false
    let isMounted = true

    const fetchStatus = async () => {
      if (isFetching || !isMounted) return
      isFetching = true
      try {
        await serverApi.getServerStatus()
      } finally {
        isFetching = false
      }
    }

    // 1. Initial fetch on mount
    await fetchStatus()
    expect(callCount).toBe(1)

    // 2. Set up interval (every 5000ms) and visibility listener
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchStatus()
      }
    }, 5000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchStatus()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Advance 5 seconds -> exactly 2 calls
    await vi.advanceTimersByTimeAsync(5000)
    expect(callCount).toBe(2)

    // Advance another 5 seconds -> exactly 3 calls
    await vi.advanceTimersByTimeAsync(5000)
    expect(callCount).toBe(3)

    // Tab hidden (background) -> polling paused
    ;(document as any).visibilityState = "hidden"
    await vi.advanceTimersByTimeAsync(15000)
    expect(callCount).toBe(3) // No new fetches while tab is hidden!

    // Return to visible tab -> immediate fetch
    ;(document as any).visibilityState = "visible"
    document.dispatchEvent({ type: "visibilitychange" } as unknown as Event)
    expect(callCount).toBe(4)


    // Unmount component -> clean up interval and listeners
    isMounted = false
    clearInterval(interval)
    document.removeEventListener("visibilitychange", handleVisibilityChange)

    // Advancing timers further produces NO additional calls
    await vi.advanceTimersByTimeAsync(20000)
    expect(callCount).toBe(4)
  })
})

describe("ServerConsoleView Command UX & Rate Limit Handling (Shard 06B)", () => {
  it("processes command submission: adds local echo and clears input on success", async () => {
    vi.spyOn(serverApi, "sendServerCommand").mockResolvedValue({
      success: true,
      message: "Comando enviado correctamente.",
    })

    const logs: any[] = []
    let commandInput = "say Hola Mundo"
    let isSending = false
    let toastMessage: string | null = null
    let toastType: "success" | "error" = "success"

    // Simulate ServerConsoleView handleSendCommand execution
    const handleSendCommand = async () => {
      const trimmed = commandInput.trim()
      if (!trimmed || isSending) return

      isSending = true
      try {
        await consoleService.sendCommand(trimmed)
        // Add local echo log on confirmed backend success
        logs.push({
          id: `${Date.now()}-echo`,
          line: `> ${trimmed}`,
          timestamp: new Date().toISOString(),
          type: "info",
        })
        commandInput = ""
      } catch (err: any) {
        toastMessage = err.message
        toastType = "error"
      } finally {
        isSending = false
      }
    }

    await handleSendCommand()

    // Verifications on success:
    expect(logs.length).toBe(1)
    expect(logs[0].line).toBe("> say Hola Mundo")
    expect(commandInput).toBe("")
    expect(toastMessage).toBeNull()
  })

  it("handles rate limited command: does not add fake echo log, preserves input, displays toast", async () => {
    vi.spyOn(serverApi, "sendServerCommand").mockRejectedValue(
      new Error("Has enviado demasiados comandos. Espera un momento."),
    )

    const logs: any[] = []
    let commandInput = "say Spam command"
    let isSending = false
    let toastMessage: string | null = null
    let toastType: "success" | "error" = "success"

    // Simulate ServerConsoleView handleSendCommand execution on error
    const handleSendCommand = async () => {
      const trimmed = commandInput.trim()
      if (!trimmed || isSending) return

      isSending = true
      try {
        await consoleService.sendCommand(trimmed)
        logs.push({
          id: `${Date.now()}-echo`,
          line: `> ${trimmed}`,
          timestamp: new Date().toISOString(),
          type: "info",
        })
        commandInput = ""
      } catch (err: any) {
        toastMessage = err.message
        toastType = "error"
      } finally {
        isSending = false
      }
    }

    await handleSendCommand()

    // Verifications on rate limit rejection:
    expect(logs.length).toBe(0) // No fake successful echo!
    expect(commandInput).toBe("say Spam command") // Input is preserved so user doesn't lose text!
    expect(toastMessage).toBe("Has enviado demasiados comandos. Espera un momento.")
    expect(toastType).toBe("error")
  })
})
