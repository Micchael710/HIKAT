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

  it("validates Minecraft skin texture dimensions and PNG format (without model detection)", async () => {
    const { validateMinecraftSkinTexture, ALLOWED_SKIN_STATUSES } = await import("./index")
    const { encode } = await import("fast-png")

    expect(ALLOWED_SKIN_STATUSES).toEqual(["AVAILABLE", "UNAVAILABLE"])

    // Valid 64x64 PNG
    const validPng = encode({
      width: 64,
      height: 64,
      data: new Uint8Array(64 * 64 * 4).fill(255),
      channels: 4,
      depth: 8,
    })

    const res1 = validateMinecraftSkinTexture(validPng)
    expect(res1.valid).toBe(true)
    expect(res1.width).toBe(64)
    expect(res1.height).toBe(64)

    // Valid 64x32 legacy skin
    const valid64x32 = encode({
      width: 64,
      height: 32,
      data: new Uint8Array(64 * 32 * 4).fill(255),
      channels: 4,
      depth: 8,
    })
    const res2 = validateMinecraftSkinTexture(valid64x32)
    expect(res2.valid).toBe(true)
    expect(res2.width).toBe(64)
    expect(res2.height).toBe(32)

    // Invalid dimensions (e.g. 50x50)
    const invalidDimPng = encode({
      width: 50,
      height: 50,
      data: new Uint8Array(50 * 50 * 4).fill(255),
      channels: 4,
      depth: 8,
    })
    const res3 = validateMinecraftSkinTexture(invalidDimPng)
    expect(res3.valid).toBe(false)
    expect(res3.error).toContain("Dimensiones")

    // Invalid magic bytes
    const nonPng = new Uint8Array(32)
    const res4 = validateMinecraftSkinTexture(nonPng)
    expect(res4.valid).toBe(false)
    expect(res4.error).toContain("PNG")
  })

  it("validates Minecraft cape textures with standard, HD, and OptiFine support", async () => {
    const {
      validateCapeTextureBuffer,
      ALLOWED_CAPE_STATUSES,
      ALLOWED_ACTIVE_CAPE_TYPES,
      MAX_PLAYER_CAPES,
      MAX_CAPE_SIZE_BYTES,
    } = await import("./index")
    const { encode } = await import("fast-png")

    expect(ALLOWED_CAPE_STATUSES).toEqual(["AVAILABLE", "UNAVAILABLE"])
    expect(ALLOWED_ACTIVE_CAPE_TYPES).toEqual(["NONE", "CUSTOM", "GLOBAL"])
    expect(MAX_PLAYER_CAPES).toBe(10)
    expect(MAX_CAPE_SIZE_BYTES).toBe(5 * 1024 * 1024)

    // Helper to make cape PNG
    function makeCape(w: number, h: number): Uint8Array {
      return encode({
        width: w,
        height: h,
        data: new Uint8Array(w * h * 4).fill(200),
        channels: 4,
        depth: 8,
      })
    }

    // 1. Standard 64x32
    expect(validateCapeTextureBuffer(makeCape(64, 32)).valid).toBe(true)

    // 2. HD Multiples (128x64, 256x128, 512x256)
    expect(validateCapeTextureBuffer(makeCape(128, 64)).valid).toBe(true)
    expect(validateCapeTextureBuffer(makeCape(256, 128)).valid).toBe(true)
    expect(validateCapeTextureBuffer(makeCape(512, 256)).valid).toBe(true)

    // 3. OptiFine ratio (46x22, 92x44)
    expect(validateCapeTextureBuffer(makeCape(46, 22)).valid).toBe(true)
    expect(validateCapeTextureBuffer(makeCape(92, 44)).valid).toBe(true)

    // 4. Corrupted / non-PNG buffer
    expect(validateCapeTextureBuffer(new Uint8Array(10)).valid).toBe(false)
    expect(validateCapeTextureBuffer(new Uint8Array(40)).valid).toBe(false)

    // 5. Visual compatibility helper (computeCapeScale / isCompatibleCapeDimensions)
    const { computeCapeScale, isCompatibleCapeDimensions } = await import("./index")
    expect(computeCapeScale(64, 32)).toBe(1)
    expect(computeCapeScale(128, 64)).toBe(2)
    expect(computeCapeScale(256, 128)).toBe(4)
    expect(computeCapeScale(512, 256)).toBe(8)
    expect(computeCapeScale(46, 22)).toBe(1)
    expect(computeCapeScale(92, 44)).toBe(2)
    expect(computeCapeScale(22, 17)).toBe(1)
    expect(computeCapeScale(500, 500)).toBeNull()
    expect(computeCapeScale(100, 200)).toBeNull()

    expect(isCompatibleCapeDimensions(64, 32)).toBe(true)
    expect(isCompatibleCapeDimensions(128, 64)).toBe(true)
    expect(isCompatibleCapeDimensions(512, 256)).toBe(true)
    expect(isCompatibleCapeDimensions(46, 22)).toBe(true)
    expect(isCompatibleCapeDimensions(500, 500)).toBe(false)
  })

  it("validates server task templates, only_when_online policy, and schedule cron formatting", async () => {
    const {
      ALLOWED_SERVER_TASK_TEMPLATES,
      SERVER_TASK_TEMPLATE_DEFS,
      convertAutomationToPterodactylCron,
      formatScheduleHumanDescription,
    } = await import("./index")

    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("AUTO_START")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("AUTO_STOP")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("AUTO_RESTART")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("AUTO_BACKUP")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("RUN_COMMAND")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("BACKUP_AND_RESTART")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("BACKUP_AND_STOP")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("WARN_AND_RESTART")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("WARN_AND_STOP")
    expect(ALLOWED_SERVER_TASK_TEMPLATES).toContain("SAVE_AND_BACKUP")

    // only_when_online per template
    expect(SERVER_TASK_TEMPLATE_DEFS.AUTO_START.onlyWhenOnline).toBe(false)
    expect(SERVER_TASK_TEMPLATE_DEFS.AUTO_STOP.onlyWhenOnline).toBe(true)
    expect(SERVER_TASK_TEMPLATE_DEFS.AUTO_RESTART.onlyWhenOnline).toBe(true)
    expect(SERVER_TASK_TEMPLATE_DEFS.AUTO_BACKUP.onlyWhenOnline).toBe(true)
    expect(SERVER_TASK_TEMPLATE_DEFS.BACKUP_AND_RESTART.onlyWhenOnline).toBe(true)

    // Cron conversion
    // Daily at 04:00 AM
    const dailyCron = convertAutomationToPterodactylCron("DAILY", "04:00")
    expect(dailyCron.minute).toBe("00")
    expect(dailyCron.hour).toBe("04")
    expect(dailyCron.day_of_week).toBe("*")

    // Selected days (Mon, Wed, Fri) at 03:30 AM
    const selectedCron = convertAutomationToPterodactylCron(
      "SELECTED_DAYS",
      "03:30",
      null,
      [1, 3, 5],
    )
    expect(selectedCron.minute).toBe("30")
    expect(selectedCron.hour).toBe("03")
    expect(selectedCron.day_of_week).toBe("1,3,5")

    // Weekly (Sunday) at 05:00 AM
    const weeklyCron = convertAutomationToPterodactylCron("WEEKLY", "05:00", 0)
    expect(weeklyCron.minute).toBe("00")
    expect(weeklyCron.hour).toBe("05")
    expect(weeklyCron.day_of_week).toBe("0")

    // Interval every 6 hours
    const intervalCron6 = convertAutomationToPterodactylCron(
      "INTERVAL",
      null,
      null,
      null,
      6,
    )
    expect(intervalCron6.minute).toBe("0")
    expect(intervalCron6.hour).toBe("*/6")
    expect(intervalCron6.day_of_week).toBe("*")

    // Interval every 1 hour
    const intervalCron1 = convertAutomationToPterodactylCron(
      "INTERVAL",
      null,
      null,
      null,
      1,
    )
    expect(intervalCron1.minute).toBe("0")
    expect(intervalCron1.hour).toBe("*")

    // Human description formatting
    expect(
      formatScheduleHumanDescription({ frequency: "DAILY", time: "04:00" }),
    ).toBe("Todos los días · 4:00 AM")
    expect(
      formatScheduleHumanDescription({
        frequency: "SELECTED_DAYS",
        time: "03:30",
        weekdays: [1, 3, 5],
      }),
    ).toBe("Lunes, Miércoles y Viernes · 3:30 AM")
    expect(
      formatScheduleHumanDescription({
        frequency: "WEEKLY",
        time: "05:00",
        weekday: 0,
      }),
    ).toBe("Cada domingo · 5:00 AM")
    expect(
      formatScheduleHumanDescription({
        frequency: "INTERVAL",
        intervalHours: 6,
      }),
    ).toBe("Cada 6 horas")
    expect(
      formatScheduleHumanDescription({
        frequency: "INTERVAL",
        intervalHours: 1,
      }),
    ).toBe("Cada hora")
  })
})

describe("Shard 08A: Game Files Explorer Domain & Path Utilities", () => {
  it("sanitizes safe game logical paths and normalizes slashes", async () => {
    const { sanitizeGamePath } = await import("./index")
    expect(sanitizeGamePath("mods/create.jar")).toBe("mods/create.jar")
    expect(sanitizeGamePath("config\\jei\\jei-client.ini")).toBe("config/jei/jei-client.ini")
    expect(sanitizeGamePath("/kubejs/server_scripts/recipes.js/")).toBe("kubejs/server_scripts/recipes.js")
    expect(sanitizeGamePath("options.txt")).toBe("options.txt")
  })

  it("strictly rejects path traversal, forbidden characters, and reserved Windows device names", async () => {
    const { sanitizeGamePath } = await import("./index")
    expect(() => sanitizeGamePath("../mods/evil.jar")).toThrow(/traversal/i)
    expect(() => sanitizeGamePath("config/../../etc/passwd")).toThrow(/traversal/i)
    expect(() => sanitizeGamePath("mods/create:jar")).toThrow(/no permitidos/i)
    expect(() => sanitizeGamePath("mods/create*jar")).toThrow(/no permitidos/i)
    expect(() => sanitizeGamePath("con.txt")).toThrow(/reservado/i)
    expect(() => sanitizeGamePath("config/nul.json")).toThrow(/reservado/i)
    expect(() => sanitizeGamePath("")).toThrow(/vacía/i)
  })

  it("accurately detects valid UTF-8 text buffers and rejects binary buffers", async () => {
    const { isUtf8TextBuffer } = await import("./index")
    const textEncoder = new TextEncoder()
    expect(isUtf8TextBuffer(textEncoder.encode("Hello world\nThis is UTF-8 text\twith tabs"))).toBe(true)
    expect(isUtf8TextBuffer(new Uint8Array([]))).toBe(true)

    // Binary with null byte
    expect(isUtf8TextBuffer(new Uint8Array([0x48, 0x65, 0x00, 0x6c]))).toBe(false)
    // Binary with non-printable control code
    expect(isUtf8TextBuffer(new Uint8Array([0x48, 0x07, 0x65]))).toBe(false)
  })

  it("checks editable text files with extension fast-path and strict binary guards", async () => {
    const { isEditableTextFile } = await import("./index")
    expect(isEditableTextFile("config.toml")).toBe(true)
    expect(isEditableTextFile("recipes.json")).toBe(true)
    expect(isEditableTextFile("script.js")).toBe(true)
    expect(isEditableTextFile("patch.snbt")).toBe(true)

    // Strict binary rejections
    expect(isEditableTextFile("create.jar")).toBe(false)
    expect(isEditableTextFile("pack.zip")).toBe(false)
    expect(isEditableTextFile("icon.png")).toBe(false)

    // Unknown extension with text buffer
    const textEncoder = new TextEncoder()
    expect(isEditableTextFile("custom_conf", textEncoder.encode("some=value\n"))).toBe(true)
    expect(isEditableTextFile("custom_bin", new Uint8Array([0x50, 0x4b, 0x00]))).toBe(false)
  })

  it("validates JSON content and extracts syntax error lines", async () => {
    const { validateJsonContent } = await import("./index")
    expect(validateJsonContent('{"name": "hikat", "count": 42}').valid).toBe(true)
    expect(validateJsonContent("").valid).toBe(true)

    const invalid = validateJsonContent('{\n  "name": "hikat",\n  "count": \n}')
    expect(invalid.valid).toBe(false)
    expect(invalid.error).toContain("sintaxis")
    expect(invalid.line).toBeDefined()
  })

  it("resolves 3-tier effective policy correctly with explicit, ancestor inherited, and convention fallback", async () => {
    const { resolveEffectiveGamePolicy } = await import("./index")

    // 1. Explicit override on file
    expect(resolveEffectiveGamePolicy("config/critical.toml", "NO_MODIFICABLE")).toBe("NO_MODIFICABLE")
    expect(resolveEffectiveGamePolicy("mods/client-only.jar", "MODIFICABLE")).toBe("MODIFICABLE")

    // 2. Inherited from ancestor folder policy
    const folderPolicies = new Map<string, string | null>([
      ["config", "MODIFICABLE"],
      ["config/protected", "NO_MODIFICABLE"],
      ["mods", "NO_MODIFICABLE"],
    ])

    expect(resolveEffectiveGamePolicy("config/foo.toml", null, folderPolicies)).toBe("MODIFICABLE")
    expect(resolveEffectiveGamePolicy("config/protected/deep/secret.toml", null, folderPolicies)).toBe("NO_MODIFICABLE")

    // 3. Fallback convention when no explicit ancestor policy is configured
    expect(resolveEffectiveGamePolicy("mods/jei.jar", null)).toBe("NO_MODIFICABLE")
    expect(resolveEffectiveGamePolicy("config/jei.toml", null)).toBe("MODIFICABLE")
    expect(resolveEffectiveGamePolicy("defaultconfigs/server.toml", null)).toBe("MODIFICABLE")
    expect(resolveEffectiveGamePolicy("resourcepacks/custom/pack.mcmeta", null)).toBe("MODIFICABLE")
    expect(resolveEffectiveGamePolicy("shaderpacks/bsl/settings.txt", null)).toBe("MODIFICABLE")
    expect(resolveEffectiveGamePolicy("options.txt", null)).toBe("MODIFICABLE")
    expect(resolveEffectiveGamePolicy("custom/other.dat", null)).toBe("NO_MODIFICABLE")
  })

  it("validates filesystem tree invariants (file vs directory collision and file ancestors)", async () => {
    const { validateGameTreeInvariants } = await import("./index")

    // Valid tree
    const validCheck = validateGameTreeInvariants(
      [
        { logicalPath: "config", isDirectory: true },
        { logicalPath: "config/jei.toml", isDirectory: false },
        { logicalPath: "mods", isDirectory: true },
        { logicalPath: "mods/create.jar", isDirectory: false },
      ],
      [{ logicalPath: "config/sub/other.json", isDirectory: false }],
    )
    expect(validCheck.valid).toBe(true)

    // Coexistence conflict (file and folder with same path)
    const conflictCheck = validateGameTreeInvariants(
      [{ logicalPath: "foo", isDirectory: false }],
      [{ logicalPath: "foo", isDirectory: true }],
    )
    expect(conflictCheck.valid).toBe(false)
    expect(conflictCheck.error).toContain("simultáneamente")

    // File as ancestor of another file
    const fileAncestorCheck = validateGameTreeInvariants(
      [{ logicalPath: "mods/create.jar", isDirectory: false }],
      [{ logicalPath: "mods/create.jar/invalid.txt", isDirectory: false }],
    )
    expect(fileAncestorCheck.valid).toBe(false)
    expect(fileAncestorCheck.error).toContain("no puede contener")
  })
  it("exposes UpdateDeploymentOrder constants and validation", async () => {
    const { ALLOWED_UPDATE_DEPLOYMENT_ORDERS, UpdateDeploymentOrder } = await import("./index")
    expect(ALLOWED_UPDATE_DEPLOYMENT_ORDERS).toEqual(["SERVER_FIRST", "PLAYERS_FIRST"])
    expect(UpdateDeploymentOrder.SERVER_FIRST).toBe("SERVER_FIRST")
    expect(UpdateDeploymentOrder.PLAYERS_FIRST).toBe("PLAYERS_FIRST")
  })

  it("validates game file headers and MAX_GAME_FILE_SIZE_BYTES", async () => {
    const { validateGameFileHeader, MAX_GAME_FILE_SIZE_BYTES } = await import("./index")
    expect(MAX_GAME_FILE_SIZE_BYTES).toBe(5 * 1024 ** 4 - 5 * 1024 ** 3)

    // Valid ZIP header (50 4B 03 04)
    const validZipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(validateGameFileHeader(validZipHeader, "mod.jar", "MOD").valid).toBe(true)
    expect(validateGameFileHeader(validZipHeader, "pack.zip", "RESOURCE_PACK").valid).toBe(true)

    // Invalid header for ZIP category
    const invalidHeader = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    const invalidRes = validateGameFileHeader(invalidHeader, "mod.jar", "MOD")
    expect(invalidRes.valid).toBe(false)
    expect(invalidRes.error).toContain("no es un archivo .jar o .zip válido")

    // Too short header
    expect(validateGameFileHeader(new Uint8Array([0x50]), "mod.jar", "MOD").valid).toBe(false)

    // Non-ZIP category (e.g. CONFIG) allows arbitrary header
    expect(validateGameFileHeader(invalidHeader, "config.json", "CONFIG").valid).toBe(true)
  })
})






