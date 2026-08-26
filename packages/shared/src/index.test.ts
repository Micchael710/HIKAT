import { describe, it, expect } from "vitest"
import {
  ALLOWED_NEWS_TYPES,
  ALLOWED_NEWS_STATUSES,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  getMediaTypeFromMime,
  parseAndNormalizeYouTubeUrl,
  isValidYouTubeUrl,
  encodeCursor,
  decodeCursor,
  ALLOWED_SERVER_STATUSES,
  ALLOWED_SERVER_POWER_ACTIONS,
  mapPterodactylStateToHiKAT,
  getServerStatusLabel,
  formatBytesToHuman,
  formatUptime,
} from "./index"


describe("Shared News & Media Content Utilities (Shard 04B)", () => {
  it("exports valid News and Media constants", () => {
    expect(ALLOWED_NEWS_TYPES).toEqual([
      "NEWS",
      "UPDATE",
      "ANNOUNCEMENT",
      "MAINTENANCE",
    ])
    expect(ALLOWED_NEWS_STATUSES).toEqual(["DRAFT", "PUBLISHED"])
    expect(ALLOWED_IMAGE_MIME_TYPES).toContain("image/png")
    expect(ALLOWED_IMAGE_MIME_TYPES).toContain("image/jpeg")
    expect(ALLOWED_IMAGE_MIME_TYPES).toContain("image/webp")
    expect(ALLOWED_VIDEO_MIME_TYPES).toContain("video/mp4")
    expect(ALLOWED_VIDEO_MIME_TYPES).toContain("video/webm")
    expect(ALLOWED_MEDIA_MIME_TYPES.length).toBe(5)
    expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_VIDEO_SIZE_BYTES).toBe(25 * 1024 * 1024)
  })

  it("identifies media type correctly from MIME string", () => {
    expect(getMediaTypeFromMime("image/png")).toBe("IMAGE")
    expect(getMediaTypeFromMime("image/jpeg")).toBe("IMAGE")
    expect(getMediaTypeFromMime("image/webp")).toBe("IMAGE")
    expect(getMediaTypeFromMime("video/mp4")).toBe("VIDEO")
    expect(getMediaTypeFromMime("video/webm")).toBe("VIDEO")
    expect(getMediaTypeFromMime("application/pdf")).toBeNull()
    expect(getMediaTypeFromMime("text/html")).toBeNull()
  })

  it("parses and normalizes valid YouTube URLs and rejects invalid ones", () => {
    const watchUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    const parsedWatch = parseAndNormalizeYouTubeUrl(watchUrl)
    expect(parsedWatch).not.toBeNull()
    expect(parsedWatch?.videoId).toBe("dQw4w9WgXcQ")
    expect(parsedWatch?.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    expect(isValidYouTubeUrl(watchUrl)).toBe(true)

    const shortUrl = "https://youtu.be/dQw4w9WgXcQ"
    const parsedShort = parseAndNormalizeYouTubeUrl(shortUrl)
    expect(parsedShort?.videoId).toBe("dQw4w9WgXcQ")
    expect(parsedShort?.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    expect(isValidYouTubeUrl(shortUrl)).toBe(true)

    const shortsUrl = "https://youtube.com/shorts/dQw4w9WgXcQ"
    const parsedShorts = parseAndNormalizeYouTubeUrl(shortsUrl)
    expect(parsedShorts?.videoId).toBe("dQw4w9WgXcQ")
    expect(parsedShorts?.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    expect(isValidYouTubeUrl(shortsUrl)).toBe(true)

    const embedUrl = "https://www.youtube.com/embed/dQw4w9WgXcQ"
    const parsedEmbed = parseAndNormalizeYouTubeUrl(embedUrl)
    expect(parsedEmbed?.videoId).toBe("dQw4w9WgXcQ")

    // Rejections
    expect(parseAndNormalizeYouTubeUrl("https://vimeo.com/123456")).toBeNull()
    expect(
      parseAndNormalizeYouTubeUrl(
        "https://evil.com/youtube.com/watch?v=12345678901",
      ),
    ).toBeNull()
    expect(parseAndNormalizeYouTubeUrl("not-a-url")).toBeNull()
    expect(
      parseAndNormalizeYouTubeUrl("https://youtube.com/watch?v=short"),
    ).toBeNull() // invalid ID length
    expect(parseAndNormalizeYouTubeUrl(null)).toBeNull()
    expect(isValidYouTubeUrl("invalid-youtube")).toBe(false)
  })

  it("encodes and decodes pagination compound cursors deterministically", () => {
    const payload = { publishedAt: "2026-08-26T00:00:00.000Z", id: "news-123" }
    const cursor = encodeCursor(payload)
    expect(typeof cursor).toBe("string")

    const decoded = decodeCursor<typeof payload>(cursor)
    expect(decoded).toEqual(payload)

    expect(decodeCursor("invalid-base64-!#@")).toBeNull()
  })

  it("maps Pterodactyl server states to human HiKAT states", () => {
    expect(ALLOWED_SERVER_STATUSES).toEqual([
      "ONLINE",
      "STARTING",
      "STOPPING",
      "OFFLINE",
      "DISCONNECTED",
      "UNKNOWN",
    ])
    expect(ALLOWED_SERVER_POWER_ACTIONS).toEqual(["START", "RESTART", "STOP"])


    expect(mapPterodactylStateToHiKAT("running")).toBe("ONLINE")
    expect(mapPterodactylStateToHiKAT("starting")).toBe("STARTING")
    expect(mapPterodactylStateToHiKAT("stopping")).toBe("STOPPING")
    expect(mapPterodactylStateToHiKAT("offline")).toBe("OFFLINE")
    expect(mapPterodactylStateToHiKAT("unknown-state")).toBe("UNKNOWN")
    expect(mapPterodactylStateToHiKAT(null)).toBe("UNKNOWN")
    expect(mapPterodactylStateToHiKAT("running", true)).toBe("DISCONNECTED")

    expect(getServerStatusLabel("ONLINE")).toBe("En línea")
    expect(getServerStatusLabel("STARTING")).toBe("Iniciando")
    expect(getServerStatusLabel("STOPPING")).toBe("Apagándose")
    expect(getServerStatusLabel("OFFLINE")).toBe("Apagado")
    expect(getServerStatusLabel("DISCONNECTED")).toBe("Sin conexión")
    expect(getServerStatusLabel("UNKNOWN")).toBe("Estado desconocido")

    expect(formatBytesToHuman(0)).toBe("0 B")
    expect(formatBytesToHuman(1024)).toBe("1.0 KB")
    expect(formatBytesToHuman(1024 * 1024 * 512)).toBe("512.0 MB")
    expect(formatBytesToHuman(1024 * 1024 * 1024 * 8)).toBe("8.0 GB")

    expect(formatUptime(null)).toBe("-")
    expect(formatUptime(0)).toBe("-")
    expect(formatUptime(45000)).toBe("45s")
    expect(formatUptime(125000)).toBe("2m 5s")
    expect(formatUptime(3600000 * 3 + 15 * 60000)).toBe("3h 15m")
    expect(formatUptime(86400000 * 2 + 3600000 * 4)).toBe("2d 4h")
  })

  it("validates server command inputs and respects character bounds", async () => {
    const { validateServerCommand, SERVER_ERROR_CODES, SERVER_CONSOLE_TICKET_TTL_SECONDS, SERVER_POWER_LOCK_TTL_SECONDS } = await import("./index")

    expect(SERVER_ERROR_CODES.SERVER_UNAVAILABLE).toBe("SERVER_UNAVAILABLE")
    expect(SERVER_ERROR_CODES.SERVER_NOT_CONFIGURED).toBe("SERVER_NOT_CONFIGURED")
    expect(SERVER_ERROR_CODES.SERVER_BUSY).toBe("SERVER_BUSY")
    expect(SERVER_ERROR_CODES.SERVER_RATE_LIMITED).toBe("SERVER_RATE_LIMITED")
    expect(SERVER_CONSOLE_TICKET_TTL_SECONDS).toBe(45)
    expect(SERVER_POWER_LOCK_TTL_SECONDS).toBe(30)

    // Valid command
    const res1 = validateServerCommand("say Hola mundo")
    expect(res1.valid).toBe(true)
    expect(res1.command).toBe("say Hola mundo")

    // Empty / whitespace
    expect(validateServerCommand("").valid).toBe(false)
    expect(validateServerCommand("   ").valid).toBe(false)
    expect(validateServerCommand(null).valid).toBe(false)
    expect(validateServerCommand(123).valid).toBe(false)

    // Oversized (>500 chars)
    const bigCmd = "say " + "x".repeat(500)
    expect(validateServerCommand(bigCmd).valid).toBe(false)
    expect(validateServerCommand(bigCmd).error).toContain("500")

    const { SERVER_PUBLIC_MESSAGES } = await import("./index")
    expect(SERVER_PUBLIC_MESSAGES.SERVER_NOT_CONFIGURED).toBe("El servidor todavía no está configurado.")
    expect(SERVER_PUBLIC_MESSAGES.SERVER_UNAVAILABLE).toBe("No se pudo conectar con el servidor en este momento.")
    expect(SERVER_PUBLIC_MESSAGES.SERVER_BUSY).toBe("Hay otra acción en curso. Espera un momento.")
    expect(SERVER_PUBLIC_MESSAGES.COMMAND_RATE_LIMITED).toBe("Has enviado demasiados comandos. Espera un momento.")
  })
})



