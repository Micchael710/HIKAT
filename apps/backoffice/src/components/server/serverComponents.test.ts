import { describe, it, expect } from "vitest"
import {
  formatBytesToHuman,
  formatUptime,
  getServerStatusLabel,
  mapPterodactylStateToHiKAT,
  SERVER_LIMITS,
} from "@hikat/shared"

describe("Back Office Server Administration Helpers & Validations (Shard 06)", () => {
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

  it("enforces command character length limits", () => {
    expect(SERVER_LIMITS.MAX_COMMAND_LENGTH).toBe(500)
    const validCmd = "say Hello World"
    expect(validCmd.length <= SERVER_LIMITS.MAX_COMMAND_LENGTH).toBe(true)

    const invalidCmd = "a".repeat(501)
    expect(invalidCmd.length > SERVER_LIMITS.MAX_COMMAND_LENGTH).toBe(true)
  })
})
