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
import ServerFilesView from "./ServerFilesView"
import ServerTasksView from "./ServerTasksView"
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

  it("Shard 07: provides 7 sub-tabs and allows seamless navigation across all server management domains", async () => {
    vi.spyOn(serverApi, "getServerStatus").mockResolvedValue({
      status: "ONLINE",
      cpuPercent: 12.5,
      cpuLimitPercent: 200,
      memoryUsedBytes: 2147483648,
      memoryLimitBytes: 4294967296,
      diskUsedBytes: 10737418240,
      diskLimitBytes: 53687091200,
      networkRxBytes: 1048576,
      networkTxBytes: 2097152,
      uptimeMs: 3600000,
      isSuspended: false,
    })
    vi.spyOn(serverApi, "getServerActivity").mockResolvedValue([
      { id: "act-1", description: "Servidor iniciado", eventType: "server:power.start", timestamp: new Date().toISOString() },
    ])
    vi.spyOn(serverApi, "getServerWorld").mockResolvedValue({
      name: "world",
      sizeBytes: 104857600,
      lastModified: new Date().toISOString(),
    })
    vi.spyOn(serverApi, "getServerBackups").mockResolvedValue([
      { id: "bk-1", name: "Backup Test", bytes: 52428800, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), isSuccessful: true, isLocked: false },
    ])
    vi.spyOn(serverApi, "getServerAutomations").mockResolvedValue([
      { id: "auto-1", name: "Reinicio diario", action: "RESTART", frequency: "DAILY", time: "04:00", enabled: true, isProcessing: false, isAdvanced: false },
    ])
    vi.spyOn(serverApi, "getMinecraftServerSettings").mockResolvedValue({
      difficulty: "normal",
      maxPlayers: 20,
      pvp: true,
      whitelist: false,
      viewDistance: 10,
      simulationDistance: 10,
      motd: "HiKAT Server",
      allowFlight: false,
    })
    vi.spyOn(serverApi, "getServerFiles").mockResolvedValue([
      { name: "server.properties", isFile: true, isSymlink: false, sizeBytes: 1024, mimeType: "text/plain", modifiedAt: new Date().toISOString() },
    ])

    await act(async () => {
      render(<ServerOverviewView theme="dark" />)
    })

    // 1. Initial General tab is rendered with live console and clean metrics (CPU, RAM, Disco)
    expect(screen.getByText("CPU")).toBeDefined()
    expect(screen.getByText("Memoria RAM")).toBeDefined()
    expect(screen.getByText("Disco")).toBeDefined()
    expect(screen.getByText("Consola en vivo")).toBeDefined()

    // 2. Click "Archivos"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Archivos/i }))
    })
    expect(screen.getByText("Nueva carpeta")).toBeDefined()
    expect(screen.getByText("Subir archivo")).toBeDefined()

    // 3. Click "Backups"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Backups/i }))
    })
    expect(screen.getByText(/Copias de seguridad/i)).toBeDefined()
    expect(screen.getByText("Crear copia ahora")).toBeDefined()

    // 4. Click "Tasks"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Tasks/i }))
    })
    expect(screen.getByText(/Tasks Programadas/i)).toBeDefined()
    expect(screen.getByText("Nueva Task")).toBeDefined()
  })

  it("Phase 07: Disconnected UI renders top-right badge and exactly 5 subtabs without crash", async () => {
    vi.spyOn(serverApi, "getServerStatus").mockRejectedValue(new Error("Connection refused to Pterodactyl"))

    await act(async () => {
      render(<ServerOverviewView theme="dark" />)
    })

    // Disconnected infrastructure badge top-right is displayed
    expect(screen.getByText("Servidor no disponible")).toBeDefined()

    // Servidor overview heading is displayed
    expect(screen.getByText("Servidor Principal")).toBeDefined()

    // Exactly 5 sub-tabs switcher buttons remain active and reachable!
    expect(screen.getByRole("button", { name: "General" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Consola" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Archivos" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Backups" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Tasks" })).toBeDefined()
  })

  it("Shard 07D Test 1: Infra transitions to DISCONNECTED if polling fails after prior success and disables power actions", async () => {
    vi.useFakeTimers()
    const localMockResources = {
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

    vi.spyOn(serverApi, "getServerStatus")
      .mockResolvedValueOnce(localMockResources)
      .mockRejectedValueOnce(new Error("Pterodactyl Network Timeout"))

    await act(async () => {
      render(<ServerOverviewView theme="dark" />)
    })

    // Initially CONNECTED
    expect(screen.getByText("Servidor disponible")).toBeDefined()

    // Trigger 2nd poll via timer interval -> fails
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    // Badge updates to DISCONNECTED
    expect(screen.getByText("Servidor no disponible")).toBeDefined()

    // Power buttons are disabled
    const startBtns = screen.getAllByRole("button", { name: /Iniciar/i })
    expect((startBtns[0] as HTMLButtonElement).disabled).toBe(true)
    vi.useRealTimers()
  })

  it("Shard 07D Test 2: Reconnect transitions from DISCONNECTED back to CONNECTED on successful poll", async () => {
    const localMockResources = {
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

    vi.spyOn(serverApi, "getServerStatus")
      .mockRejectedValueOnce(new Error("Offline Pterodactyl"))
      .mockResolvedValueOnce(localMockResources)

    await act(async () => {
      render(<ServerOverviewView theme="dark" />)
    })

    // Initially DISCONNECTED
    expect(screen.getByText("Servidor no disponible")).toBeDefined()

    // Click Reintentar -> succeeds
    await act(async () => {
      fireEvent.click(screen.getByText("Reintentar"))
    })

    // Transitions back to CONNECTED
    expect(screen.getByText("Servidor disponible")).toBeDefined()
    expect(screen.getByText("En línea")).toBeDefined()
  })
})

describe("Phase 07E Real React Test: ServerFilesView Root File Browser", () => {
  const onToastMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("Phase 07E Test 1: Old category chips (Mundo, Configuración, Mods del servidor, Logs) do NOT exist as internal filters in ServerFilesView", async () => {
    vi.spyOn(serverApi, "getServerFiles").mockResolvedValue([
      { name: "world", isFile: false, isSymlink: false, sizeBytes: 0, modifiedAt: new Date().toISOString() },
      { name: "server.properties", isFile: true, isSymlink: false, sizeBytes: 1024, modifiedAt: new Date().toISOString() },
    ])

    await act(async () => {
      render(<ServerFilesView theme="dark" serverStatus="ONLINE" onToast={onToastMock} />)
    })

    // Header title "Archivos del servidor" is present
    expect(screen.getAllByText("Archivos del servidor")).toBeDefined()

    // Old virtual subcategory chips MUST NOT exist inside ServerFilesView
    expect(screen.queryByRole("button", { name: "Mods del servidor" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Logs" })).toBeNull()
  })

  it("Phase 07E Test 2: Folder navigation updates current path, breadcrumbs, and fetches subfolder files", async () => {
    const getServerFilesSpy = vi.spyOn(serverApi, "getServerFiles").mockImplementation(async (_root, path) => {
      if (path === "mods") {
        return [
          { name: "voicechat.jar", isFile: true, isSymlink: false, sizeBytes: 5242880, modifiedAt: new Date().toISOString() },
        ]
      }
      return [
        { name: "mods", isFile: false, isSymlink: false, sizeBytes: 0, modifiedAt: new Date().toISOString() },
        { name: "server.properties", isFile: true, isSymlink: false, sizeBytes: 1024, modifiedAt: new Date().toISOString() },
      ]
    })

    await act(async () => {
      render(<ServerFilesView theme="dark" serverStatus="ONLINE" onToast={onToastMock} />)
    })

    // Initial root call
    expect(getServerFilesSpy).toHaveBeenCalledWith("SERVER", undefined)
    expect(screen.getByText("mods")).toBeDefined()
    expect(screen.getByText("server.properties")).toBeDefined()

    // Click folder "mods"
    await act(async () => {
      fireEvent.click(screen.getByText("mods"))
    })

    // Subfolder fetch call
    expect(getServerFilesSpy).toHaveBeenCalledWith("SERVER", "mods")
    expect(screen.getByText("voicechat.jar")).toBeDefined()

    // Breadcrumb updated: "Archivos del servidor > mods"
    expect(screen.getByRole("button", { name: "Archivos del servidor" })).toBeDefined()
    expect(screen.getByRole("button", { name: "mods" })).toBeDefined()

    // Click root breadcrumb "Archivos del servidor" to return
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archivos del servidor" }))
    })

    expect(getServerFilesSpy).toHaveBeenLastCalledWith("SERVER", undefined)
  })

  it("Phase 07E Test 3: Disconnected state shows human-friendly message and disables directory action buttons", async () => {
    vi.spyOn(serverApi, "getServerFiles").mockResolvedValue([])

    await act(async () => {
      render(<ServerFilesView theme="dark" serverStatus="DISCONNECTED" onToast={onToastMock} />)
    })

    expect(screen.getByText("Servidor sin conexión")).toBeDefined()
    expect(screen.getByText("Los archivos aparecerán aquí cuando el servidor esté conectado.")).toBeDefined()

    const newFolderBtn = screen.getByRole("button", { name: /Nueva carpeta/i }) as HTMLButtonElement
    expect(newFolderBtn.disabled).toBe(true)
  })

  it("Phase 07F Test 4: Symlinks display 'Enlace' badge and hide 'Editar texto' and 'Descargar' action buttons", async () => {
    vi.spyOn(serverApi, "getServerFiles").mockResolvedValue([
      { name: "normal.json", isFile: true, isSymlink: false, sizeBytes: 100, modifiedAt: new Date().toISOString() },
      { name: "symlink.json", isFile: true, isSymlink: true, sizeBytes: 0, modifiedAt: new Date().toISOString() },
    ])

    await act(async () => {
      render(<ServerFilesView theme="dark" serverStatus="ONLINE" onToast={onToastMock} />)
    })

    // Symlink renders "Enlace" badge
    expect(screen.getByText("Enlace")).toBeDefined()

    // Normal file has Download button
    const downloadBtns = screen.getAllByTitle("Descargar")
    expect(downloadBtns).toHaveLength(1)

    // Normal file has Edit button
    const editBtns = screen.getAllByTitle("Editar texto")
    expect(editBtns).toHaveLength(1)
  })
})

describe("Phase 07: ServerTasksView Custom Action Toggle Preservation", () => {
  const onToastMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("CUSTOM + STOP task toggle sends action: STOP and inverted enabled value", async () => {
    const customStopTask = {
      id: "task-custom-stop",
      name: "Parada nocturna",
      template: "CUSTOM" as const,
      action: "STOP" as const,
      frequency: "DAILY" as const,
      time: "04:00",
      intervalHours: null,
      weekday: null,
      weekdays: null,
      command: null,
      delaySeconds: null,
      humanSchedule: "Todos los días a las 04:00",
      enabled: true,
      isProcessing: false,
      isAdvanced: false,
      isManaged: true,
      lastRunAt: null,
      nextRunAt: null,
    }

    vi.spyOn(serverApi, "getServerAutomations").mockResolvedValue([customStopTask])
    const updateSpy = vi.spyOn(serverApi, "updateServerAutomation").mockResolvedValue({
      ...customStopTask,
      enabled: false,
    })

    await act(async () => {
      render(<ServerTasksView theme="dark" serverStatus="ONLINE" onToast={onToastMock} />)
    })

    expect(screen.getByText("Parada nocturna")).toBeDefined()

    // Find the toggle button (currently enabled -> says "Activa" and title "Desactivar tarea")
    const toggleBtn = screen.getByTitle("Desactivar tarea")
    await act(async () => {
      fireEvent.click(toggleBtn)
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith("task-custom-stop", {
      name: "Parada nocturna",
      template: "CUSTOM",
      action: "STOP",
      frequency: "DAILY",
      time: "04:00",
      intervalHours: null,
      weekday: null,
      weekdays: null,
      command: null,
      delaySeconds: null,
      enabled: false,
    })
  })

  it("CUSTOM + COMMAND task toggle sends action: COMMAND and preserved command string", async () => {
    const customCmdTask = {
      id: "task-custom-cmd",
      name: "Anuncio automático",
      template: "CUSTOM" as const,
      action: "COMMAND" as const,
      frequency: "DAILY" as const,
      time: "12:00",
      intervalHours: null,
      weekday: null,
      weekdays: null,
      command: "say Bienvenidos al servidor",
      delaySeconds: null,
      humanSchedule: "Todos los días a las 12:00",
      enabled: false,
      isProcessing: false,
      isAdvanced: false,
      isManaged: true,
      lastRunAt: null,
      nextRunAt: null,
    }

    vi.spyOn(serverApi, "getServerAutomations").mockResolvedValue([customCmdTask])
    const updateSpy = vi.spyOn(serverApi, "updateServerAutomation").mockResolvedValue({
      ...customCmdTask,
      enabled: true,
    })

    await act(async () => {
      render(<ServerTasksView theme="dark" serverStatus="ONLINE" onToast={onToastMock} />)
    })

    expect(screen.getByText("Anuncio automático")).toBeDefined()

    // Find the toggle button (currently disabled -> says "Inactiva" and title "Activar tarea")
    const toggleBtn = screen.getByTitle("Activar tarea")
    await act(async () => {
      fireEvent.click(toggleBtn)
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith("task-custom-cmd", {
      name: "Anuncio automático",
      template: "CUSTOM",
      action: "COMMAND",
      frequency: "DAILY",
      time: "12:00",
      intervalHours: null,
      weekday: null,
      weekdays: null,
      command: "say Bienvenidos al servidor",
      delaySeconds: null,
      enabled: true,
    })
  })
})

