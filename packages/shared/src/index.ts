/**
 * HiKAT Shared Foundation
 * Minimal shared types and constants for HiKAT workspace
 */

export const HIKAT_APP_NAME = "HiKAT"

export const HIKAT_VERSION = "0.1.0"

export const ALLOWED_ROLES = ["PLAYER", "ADMIN"] as const
export type AppRole = typeof ALLOWED_ROLES[number]
export type AppRoleType = AppRole

export const ALLOWED_AUTH_PROVIDERS = ["GOOGLE", "DISCORD"] as const
export type ExternalAuthProvider = typeof ALLOWED_AUTH_PROVIDERS[number]

export const ALLOWED_AUTH_METHODS = ["PASSWORD", "GOOGLE", "DISCORD"] as const
export type AuthMethodType = typeof ALLOWED_AUTH_METHODS[number]

export const AUTH_AUDIENCE_API = "hikat-api"
export const AUTH_AUDIENCE_GAME = "hikat-minecraft"
export const DEFAULT_AUTH_ISSUER = "https://auth.hikat.org"

export const ALLOWED_REDIRECT_URIS = [
  "hikat://auth/callback",
  "http://127.0.0.1:47821/auth/callback",
  "http://localhost:5173/auth/callback",
  "http://127.0.0.1:5173/auth/callback",
  "http://localhost:5174/auth/callback",
  "http://127.0.0.1:5174/auth/callback",
  "https://admin.hikat.org/auth/callback",
  "https://app.hikat.org/auth/callback",
] as const

export const ALLOWED_LINK_REDIRECT_URIS = [
  "https://app.hikat.org/settings",
  "https://app.hikat.org/account",
  "https://admin.hikat.org/settings",
  "http://localhost:5173/settings",
  "http://127.0.0.1:5173/settings",
  "http://localhost:5174/settings",
  "http://127.0.0.1:5174/settings",
  "hikat://settings/accounts",
] as const

export * from "./auth/pkce"
export * from "./auth/authClientCore"


export interface AccessTokenPayload {
  iss: string
  aud: string
  sub: string
  sid: string
  role: AppRole
  displayName?: string | null
  iat: number
  exp: number
  jti: string
}

export interface GameTokenPayload {
  iss: string
  aud: "hikat-minecraft"
  sub: string
  sid: string
  role: AppRole
  displayName?: string | null
  iat: number
  exp: number
  jti: string
}

export interface AuthMethodSummary {
  type: AuthMethodType
  email?: string | null
  displayName?: string | null
  providerSubject?: string | null
  verified?: boolean
  linkedAt: string
}

export const AuthErrorCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  USER_ALREADY_EXISTS: "USER_ALREADY_EXISTS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  RATE_LIMITED: "RATE_LIMITED",
  EMAIL_CONFLICT_LINK_REQUIRED: "EMAIL_CONFLICT_LINK_REQUIRED",
  LAST_AUTH_METHOD: "LAST_AUTH_METHOD",
  PROVIDER_ALREADY_LINKED: "PROVIDER_ALREADY_LINKED",
  INVALID_PKCE: "INVALID_PKCE",
  INVALID_STATE: "INVALID_STATE",
  INVALID_REDIRECT_URI: "INVALID_REDIRECT_URI",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
} as const

export type AuthErrorCodeType = typeof AuthErrorCode[keyof typeof AuthErrorCode]

export interface ServiceHealth {
  status: "ok" | "degraded" | "error"
  service: string
  version: string
  timestamp: string
}

// --- HiKAT News & Media Content Constants & Types (Shard 04B) ---

export const ALLOWED_NEWS_TYPES = [
  "NEWS",
  "UPDATE",
  "ANNOUNCEMENT",
  "MAINTENANCE",
] as const
export type NewsType = typeof ALLOWED_NEWS_TYPES[number]

export const ALLOWED_NEWS_STATUSES = ["DRAFT", "PUBLISHED"] as const
export type NewsStatus = typeof ALLOWED_NEWS_STATUSES[number]

export const MEDIA_TYPES = ["IMAGE", "VIDEO"] as const
export type MediaType = typeof MEDIA_TYPES[number]

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const
export type ImageMimeType = typeof ALLOWED_IMAGE_MIME_TYPES[number]

export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const
export type VideoMimeType = typeof ALLOWED_VIDEO_MIME_TYPES[number]

export const ALLOWED_MEDIA_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_VIDEO_MIME_TYPES,
] as const
export type MediaMimeType = typeof ALLOWED_MEDIA_MIME_TYPES[number]

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_VIDEO_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB
export const MAX_MEDIA_SIZE_BYTES = MAX_VIDEO_SIZE_BYTES // 25 MB max global buffer capacity
export const MEDIA_UPLOAD_TOKEN_EXPIRATION_SECONDS = 15 * 60 // 15 minutes

export const NEWS_LIMITS = {
  TITLE_MIN_LENGTH: 3,
  TITLE_MAX_LENGTH: 200,
  CONTENT_MIN_LENGTH: 1,
  CONTENT_MAX_LENGTH: 100000,
  DEFAULT_FEED_LIMIT: 20,
  MAX_FEED_LIMIT: 50,
} as const

/**
 * Returns the media type ("IMAGE" | "VIDEO") from a valid MIME type.
 */
export function getMediaTypeFromMime(mimeType: string): MediaType | null {
  const normalized = mimeType.toLowerCase().trim()
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)) {
    return "IMAGE"
  }
  if ((ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(normalized)) {
    return "VIDEO"
  }
  return null
}

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

/**
 * Parses, validates, and normalizes a YouTube URL into a canonical representation.
 * Supports:
 *  - youtube.com/watch?v={id}
 *  - youtu.be/{id}
 *  - youtube.com/shorts/{id}
 *  - youtube.com/embed/{id}
 * Returns normalized video ID and canonical URL or null if invalid/unrecognized.
 */
export function parseAndNormalizeYouTubeUrl(
  url: string | null | undefined,
): { videoId: string; canonicalUrl: string } | null {
  if (!url || typeof url !== "string") return null
  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    let parsedUrl: URL
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      parsedUrl = new URL(trimmed)
    } else {
      parsedUrl = new URL(`https://${trimmed}`)
    }

    const host = parsedUrl.hostname.toLowerCase()
    let videoId: string | null = null

    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      if (parsedUrl.pathname === "/watch") {
        videoId = parsedUrl.searchParams.get("v")
      } else if (parsedUrl.pathname.startsWith("/shorts/")) {
        videoId = parsedUrl.pathname.split("/")[2] || null
      } else if (parsedUrl.pathname.startsWith("/embed/")) {
        videoId = parsedUrl.pathname.split("/")[2] || null
      } else if (parsedUrl.pathname.startsWith("/v/")) {
        videoId = parsedUrl.pathname.split("/")[2] || null
      }
    } else if (host === "youtu.be" || host === "www.youtu.be") {
      videoId = parsedUrl.pathname.slice(1).split("/")[0] || null
    }

    if (videoId && YOUTUBE_ID_REGEX.test(videoId)) {
      return {
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Validates whether a string is a recognized and well-formed YouTube URL.
 */
export function isValidYouTubeUrl(url: string): boolean {
  return parseAndNormalizeYouTubeUrl(url) !== null
}

/**
 * Encodes compound pagination cursor data to a stable Base64 string.
 */
export function encodeCursor<T extends object>(data: T): string {
  const json = JSON.stringify(data)
  return Buffer.from(json, "utf-8").toString("base64url")
}

/**
 * Decodes a Base64 cursor string into typed structured data.
 */
export function decodeCursor<T = Record<string, unknown>>(
  cursor: string,
): T | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8")
    const parsed = JSON.parse(json)
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as T
    }
    return null
  } catch {
    return null
  }
}

// --- HiKAT Server Administration & Pterodactyl Integration Constants & Types (Shard 06) ---

export const ALLOWED_SERVER_STATUSES = [
  "ONLINE",
  "STARTING",
  "STOPPING",
  "OFFLINE",
  "DISCONNECTED",
  "UNKNOWN",
] as const
export type ServerStatus = typeof ALLOWED_SERVER_STATUSES[number]

export const ALLOWED_SERVER_POWER_ACTIONS = [
  "START",
  "RESTART",
  "STOP",
] as const
export type ServerPowerAction = typeof ALLOWED_SERVER_POWER_ACTIONS[number]

export const SERVER_LIMITS = {
  MAX_COMMAND_LENGTH: 500,
} as const

export interface ServerResourcesData {
  status: ServerStatus
  cpuPercent: number
  cpuLimitPercent?: number | null
  memoryUsedBytes: number
  memoryLimitBytes?: number | null
  diskUsedBytes: number
  diskLimitBytes?: number | null
  networkRxBytes?: number | null
  networkTxBytes?: number | null
  uptimeMs?: number | null
  isSuspended: boolean
}


/**
 * Maps raw Pterodactyl server states to human-friendly HiKAT ServerStatus.
 */
export function mapPterodactylStateToHiKAT(
  state: string | null | undefined,
  isSuspended?: boolean,
): ServerStatus {
  if (isSuspended) {
    return "DISCONNECTED"
  }
  if (!state || typeof state !== "string") {
    return "UNKNOWN"
  }

  const normalized = state.toLowerCase().trim()
  switch (normalized) {
    case "running":
      return "ONLINE"
    case "starting":
      return "STARTING"
    case "stopping":
      return "STOPPING"
    case "offline":
      return "OFFLINE"
    default:
      return "UNKNOWN"
  }
}

/**
 * Returns human-friendly Spanish label for a given ServerStatus.
 */
export function getServerStatusLabel(status: ServerStatus): string {
  switch (status) {
    case "ONLINE":
      return "En línea"
    case "STARTING":
      return "Iniciando"
    case "STOPPING":
      return "Apagándose"
    case "OFFLINE":
      return "Apagado"
    case "DISCONNECTED":
      return "Sin conexión"
    case "UNKNOWN":
    default:
      return "Estado desconocido"
  }
}

/**
 * Formats a byte amount into human-readable representation (e.g. "5.4 GB", "512 MB").
 */
export function formatBytesToHuman(bytes: number, decimals: number = 1): string {
  if (bytes < 0 || !Number.isFinite(bytes)) return "0 B"
  if (bytes === 0) return "0 B"

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["B", "KB", "MB", "GB", "TB"]

  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const clampedIndex = Math.min(i, sizes.length - 1)
  const val = bytes / Math.pow(k, clampedIndex)

  return `${val.toFixed(dm)} ${sizes[clampedIndex]}`
}

/**
 * Formats an uptime duration in milliseconds to human-friendly Spanish string (e.g. "2d 4h", "3h 15m", "45s").
 */
export function formatUptime(uptimeMs: number | null | undefined): string {
  if (!uptimeMs || uptimeMs <= 0 || !Number.isFinite(uptimeMs)) {
    return "-"
  }

  const totalSeconds = Math.floor(uptimeMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

// --- HiKAT Server Hardening Constants & Helpers (Shard 06A & 06B) ---

export const SERVER_ERROR_CODES = {
  SERVER_UNAVAILABLE: "SERVER_UNAVAILABLE",
  SERVER_NOT_CONFIGURED: "SERVER_NOT_CONFIGURED",
  SERVER_BUSY: "SERVER_BUSY",
  SERVER_RATE_LIMITED: "SERVER_RATE_LIMITED",
} as const
export type ServerErrorCode = typeof SERVER_ERROR_CODES[keyof typeof SERVER_ERROR_CODES]

export const SERVER_PUBLIC_MESSAGES = {
  SERVER_NOT_CONFIGURED: "El servidor todavía no está configurado.",
  SERVER_UNAVAILABLE: "No se pudo conectar con el servidor en este momento.",
  SERVER_STATUS_UNAVAILABLE: "No se pudo comprobar el estado del servidor. Inténtalo nuevamente.",
  SERVER_BUSY: "Hay otra acción en curso. Espera un momento.",
  SERVER_RATE_LIMITED: "Has realizado demasiadas acciones. Espera un momento.",
  COMMAND_RATE_LIMITED: "Has enviado demasiados comandos. Espera un momento.",
  SERVER_ALREADY_RUNNING: "El servidor ya está encendido.",
  SERVER_ALREADY_STOPPED: "El servidor ya está apagado.",
  SERVER_IS_STARTING: "El servidor se está iniciando. Espera un momento.",
  SERVER_IS_STOPPING: "El servidor se está apagando. Espera un momento.",
} as const


export const SERVER_CONSOLE_TICKET_TTL_SECONDS = 45
export const SERVER_POWER_LOCK_TTL_SECONDS = 30
export const SERVER_POWER_LOCK_COOLDOWN_MS = 2000
export const SERVER_COMMAND_RATE_LIMIT = {
  MAX_COMMANDS: 10,
  WINDOW_SECONDS: 10,
} as const


/**
 * Validates a server command string ensuring type, non-empty, and character limit.
 */
export function validateServerCommand(command: unknown): {
  valid: boolean
  command?: string
  error?: string
} {
  if (typeof command !== "string") {
    return { valid: false, error: "El comando debe ser una cadena de texto." }
  }
  const trimmed = command.trim()
  if (!trimmed) {
    return { valid: false, error: "El comando no puede estar vacío." }
  }
  if (trimmed.length > SERVER_LIMITS.MAX_COMMAND_LENGTH) {
    return {
      valid: false,
      error: `El comando excede la longitud máxima permitida (${SERVER_LIMITS.MAX_COMMAND_LENGTH} caracteres).`,
    }
  }
  return { valid: true, command: trimmed }
}

// --- HiKAT Back Office & Cosmetics Constants & Validation Helpers (Shard 06.5 / 07 Hardening) ---

export const ALLOWED_SKIN_STATUSES = ["AVAILABLE", "UNAVAILABLE"] as const
export type SkinStatus = typeof ALLOWED_SKIN_STATUSES[number]

export const MAX_SKIN_SIZE_BYTES = 1 * 1024 * 1024 // 1 MB

export const ALLOWED_CAPE_STATUSES = ["AVAILABLE", "UNAVAILABLE"] as const
export type CapeStatus = typeof ALLOWED_CAPE_STATUSES[number]

export const ALLOWED_ACTIVE_CAPE_TYPES = ["NONE", "CUSTOM", "GLOBAL"] as const
export type ActiveCapeType = typeof ALLOWED_ACTIVE_CAPE_TYPES[number]

export const MAX_PLAYER_CAPES = 10
export const MAX_CAPE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

export const ALLOWED_GAME_CATEGORIES = [
  "MOD",
  "RESOURCE_PACK",
  "DATA_PACK",
  "SHADER_PACK",
  "KUBEJS",
  "SCRIPT",
  "CONFIG",
  "GENERAL",
] as const
export type GameFileCategory = typeof ALLOWED_GAME_CATEGORIES[number]

export const ALLOWED_RELEASE_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const
export type GameReleaseStatus = typeof ALLOWED_RELEASE_STATUSES[number]

export const ALLOWED_SYNC_POLICIES = [
  "NO_MODIFICABLE",
  "MODIFICABLE",
] as const
export type SyncPolicy = typeof ALLOWED_SYNC_POLICIES[number]

export const MAX_GAME_FILE_SIZE_BYTES = 5 * 1024 ** 4 - 5 * 1024 ** 3 // Practical Cloudflare R2 multipart limit (~4.99 TiB)
export const MAX_GAME_TEXT_FILE_SIZE_BYTES = 1024 * 1024 // 1 MB

export const GAME_CATEGORY_DIRECTORIES: Record<GameFileCategory, string> = {
  MOD: "mods",
  RESOURCE_PACK: "resourcepacks",
  DATA_PACK: "datapacks",
  SHADER_PACK: "shaderpacks",
  KUBEJS: "kubejs",
  SCRIPT: "scripts",
  CONFIG: "config",
  GENERAL: "",
}

export const GAME_CATEGORY_DEFAULT_POLICIES: Record<
  GameFileCategory,
  SyncPolicy
> = {
  MOD: "NO_MODIFICABLE",
  RESOURCE_PACK: "MODIFICABLE",
  DATA_PACK: "NO_MODIFICABLE",
  SHADER_PACK: "MODIFICABLE",
  KUBEJS: "NO_MODIFICABLE",
  SCRIPT: "NO_MODIFICABLE",
  CONFIG: "MODIFICABLE",
  GENERAL: "NO_MODIFICABLE",
}

export const GAME_TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".json",
  ".json5",
  ".toml",
  ".yaml",
  ".yml",
  ".properties",
  ".cfg",
  ".conf",
  ".ini",
  ".js",
  ".ts",
  ".mcmeta",
  ".md",
  ".xml",
  ".csv",
  ".snbt",
  ".mcdoc",
  ".lang",
  ".log",
] as const

export const KNOWN_BINARY_EXTENSIONS = [
  ".jar",
  ".zip",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ogg",
  ".mp3",
  ".wav",
  ".class",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".dat",
  ".bin",
  ".gz",
  ".tar",
  ".7z",
] as const

import { decode as decodePng } from "fast-png"

/**
 * Result of inspecting / validating a Minecraft skin texture PNG.
 * HiKAT does not infer or store CLASSIC vs SLIM model type.
 */
export interface MinecraftSkinInspectionResult {
  valid: boolean
  width?: number
  height?: number
  error?: string
  reason?: string
}

/**
 * Validates PNG buffer header magic bytes, dimensions and decodability for Minecraft skins.
 * Supported standard Minecraft skins: strict 64x64 or 64x32 dimensions.
 */
export function validateMinecraftSkinTexture(
  buffer: ArrayBuffer | Uint8Array,
): MinecraftSkinInspectionResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 24) {
    const msg = "El archivo de skin es demasiado pequeño o está incompleto."
    return { valid: false, error: msg, reason: msg }
  }

  // PNG Magic Bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    const msg = "El archivo no es una imagen PNG válida."
    return { valid: false, error: msg, reason: msg }
  }

  // Read IHDR dimensions in big-endian
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)

  const validDimensions = width === 64 && (height === 64 || height === 32)
  if (!validDimensions) {
    const msg = `Dimensiones de skin inválidas (${width}x${height}). Se requiere PNG de 64x64 o 64x32.`
    return { valid: false, width, height, error: msg, reason: msg }
  }

  // Verify PNG decodability
  try {
    const decoded = decodePng(bytes)
    if (!decoded || !decoded.data || decoded.data.length === 0) {
      const msg = "Error al decodificar la textura de la skin."
      return { valid: false, error: msg, reason: msg }
    }
    return {
      valid: true,
      width,
      height,
    }
  } catch (err: any) {
    const msg = err?.message || "No se pudo leer la textura de la skin."
    return { valid: false, error: msg, reason: msg }
  }
}

/**
 * Result of validating a Minecraft cape texture PNG buffer.
 * HiKAT accepts standard, HD, and OptiFine ratio capes without enforcing 64x32.
 */
export interface MinecraftCapeInspectionResult {
  valid: boolean
  width?: number
  height?: number
  error?: string
  reason?: string
}

/**
 * Validates PNG buffer header magic bytes and decodability for Minecraft capes.
 * Allows standard and HD textures (e.g. 64x32, 128x64, 256x128, 512x256, 46x22, 92x44, etc.).
 */
export function validateCapeTextureBuffer(
  buffer: ArrayBuffer | Uint8Array,
): MinecraftCapeInspectionResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 24) {
    const msg = "El archivo de capa es demasiado pequeño o está incompleto."
    return { valid: false, error: msg, reason: msg }
  }

  // PNG Magic Bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    const msg = "El archivo no es una imagen PNG válida."
    return { valid: false, error: msg, reason: msg }
  }

  // Read IHDR dimensions in big-endian
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)

  if (width === 0 || height === 0) {
    const msg = "Dimensiones de capa inválidas."
    return { valid: false, width, height, error: msg, reason: msg }
  }

  // Verify PNG decodability
  try {
    const decoded = decodePng(bytes)
    if (!decoded || !decoded.data || decoded.data.length === 0) {
      const msg = "Error al decodificar la textura de la capa."
      return { valid: false, error: msg, reason: msg }
    }
    return {
      valid: true,
      width,
      height,
    }
  } catch (err: any) {
    const msg = err?.message || "No se pudo leer la textura de la capa."
    return { valid: false, error: msg, reason: msg }
  }
}

/**
 * Computes the scale factor for a Minecraft cape texture layout.
 * Supports standard Minecraft 2:1 ratio (64x32 and HD multiples: 128x64, 256x128, etc.),
 * 22x17, and 46x22 (and multiples like 92x44) as supported by skinview3d/skinview-utils.
 * Returns null if the layout/aspect ratio is incompatible.
 */
export function computeCapeScale(width: number, height: number): number | null {
  if (width <= 0 || height <= 0) return null
  if (width === 2 * height) {
    return width / 64
  } else if (width * 17 === height * 22) {
    return width / 22
  } else if (width * 11 === height * 23) {
    return width / 46
  }
  return null
}

/**
 * Validates whether dimensions represent a cape layout compatible with skinview3d.
 */
export function isCompatibleCapeDimensions(width: number, height: number): boolean {
  return computeCapeScale(width, height) !== null
}


/**
 * Sanitizes a filename to prevent path traversal, control characters, and dangerous symbols.
 */
export function sanitizeGameFileName(filename: string): string {
  if (typeof filename !== "string") return "file.jar"
  // Strip paths, backslashes, null bytes, and traversal tokens
  const base = filename
    .replace(/^.*[\\/]/, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\]/g, "")
    .trim()

  // Remove any leading periods to prevent hidden file traversal
  const cleaned = base.replace(/^\.+/, "")
  return cleaned || "file.jar"
}

const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
])

/**
 * Validates and sanitizes an arbitrary game logical path inside the instance sandbox.
 * Strictly prevents path traversal (../), null bytes, Windows reserved device names, and invalid characters.
 */
export function sanitizeGamePath(rawPath: string): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("La ruta del archivo no puede estar vacía.")
  }

  // Normalize slashes
  const normalized = rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/")

  if (!normalized) {
    throw new Error("Ruta de archivo inválida.")
  }

  // Reject forbidden characters: colons, asterisks, question marks, quotes, angle brackets, pipes, null bytes, control chars
  if (/[:*?"<>|\x00-\x1F\x7F]/.test(normalized)) {
    throw new Error("Caracteres no permitidos en la ruta.")
  }

  const segments = normalized.split("/")
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed || trimmed === "." || trimmed === "..") {
      throw new Error("Ruta no permitida (path traversal detectado).")
    }
    const baseName = trimmed.split(".")[0]?.toLowerCase() || ""
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      throw new Error(`Nombre de archivo o carpeta reservado no permitido: ${trimmed}`)
    }
  }

  return segments.join("/")
}

/**
 * Tests whether a byte buffer represents valid UTF-8 text without binary null bytes or control codes.
 */
export function isUtf8TextBuffer(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length === 0) return true

  for (const byte of bytes) {
    if (byte === 0x00) return false // Null byte is binary indicator
    // Reject control characters except tab (9), newline (10), carriage return (13), form feed (12)
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
      return false
    }
  }

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
    decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Checks whether a filename represents an editable text file.
 * Fast-path check by extension, or buffer analysis for unknown extensions.
 * Strictly rejects known binary formats (.jar, .zip, .png, etc.).
 */
export function isEditableTextFile(
  filename: string,
  buffer?: ArrayBuffer | Uint8Array,
): boolean {
  if (!filename || typeof filename !== "string") return false
  const lower = filename.toLowerCase().trim()

  // Strict binary guard
  if (KNOWN_BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return false
  }

  // Fast path by known text extension
  if (GAME_TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    if (buffer) {
      return isUtf8TextBuffer(buffer)
    }
    return true
  }

  // Fallback for unknown extension / extensionless files
  if (buffer) {
    return isUtf8TextBuffer(buffer)
  }

  return false
}

/**
 * Validates JSON text content and extracts syntax error line if invalid.
 */
export function validateJsonContent(content: string): {
  valid: boolean
  error?: string
  line?: number
} {
  if (typeof content !== "string") {
    return { valid: false, error: "Contenido JSON inválido.", line: 1 }
  }
  if (!content.trim()) {
    return { valid: true }
  }
  try {
    JSON.parse(content)
    return { valid: true }
  } catch (err: any) {
    let line = 1
    const msg = err?.message || "Error de sintaxis JSON."
    const match = msg.match(/position\s+(\d+)/i) || msg.match(/line\s+(\d+)/i)
    if (match && match[1]) {
      const pos = parseInt(match[1], 10)
      if (msg.includes("position") && !isNaN(pos)) {
        line = content.slice(0, pos).split("\n").length
      } else if (!isNaN(pos)) {
        line = pos
      }
    }
    return {
      valid: false,
      error: `Error de sintaxis JSON en línea ${line}: ${msg}`,
      line,
    }
  }
}

/**
 * Infers a secondary game file category based on logical path and extension.
 */
export function inferGameCategory(logicalPath: string): GameFileCategory {
  if (!logicalPath || typeof logicalPath !== "string") return "GENERAL"
  const normalized = logicalPath.trim().replace(/\\/g, "/").toLowerCase()
  if (normalized.startsWith("mods/") || normalized.endsWith(".jar")) return "MOD"
  if (normalized.startsWith("resourcepacks/")) return "RESOURCE_PACK"
  if (normalized.startsWith("datapacks/")) return "DATA_PACK"
  if (normalized.startsWith("shaderpacks/")) return "SHADER_PACK"
  if (normalized.startsWith("kubejs/")) return "KUBEJS"
  if (normalized.startsWith("scripts/")) return "SCRIPT"
  if (normalized.startsWith("config/") || normalized.startsWith("defaultconfigs/")) return "CONFIG"
  return "GENERAL"
}

/**
 * Resolves the 3-tier effective policy (own override, inherited from closest ancestor directory, or root fallback).
 */
export function resolveEffectiveGamePolicy(
  logicalPath: string,
  explicitPolicy?: string | null,
  ancestorPolicies?: Map<string, string | null | undefined> | Record<string, string | null | undefined>,
): SyncPolicy {
  if (explicitPolicy === "NO_MODIFICABLE" || explicitPolicy === "MODIFICABLE") {
    return explicitPolicy
  }

  const normalized = (logicalPath || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  const segments = normalized.split("/").filter(Boolean)

  if (ancestorPolicies && segments.length > 1) {
    // Traverse parent directories from closest to root
    for (let i = segments.length - 1; i >= 1; i--) {
      const ancestorPath = segments.slice(0, i).join("/")
      const policyVal =
        ancestorPolicies instanceof Map
          ? ancestorPolicies.get(ancestorPath)
          : ancestorPolicies[ancestorPath]
      if (policyVal === "NO_MODIFICABLE" || policyVal === "MODIFICABLE") {
        return policyVal
      }
    }
  }

  // Fallback to directory conventions
  const root = segments[0]?.toLowerCase() || ""
  if (root === "mods" || root === "datapacks") return "NO_MODIFICABLE"
  if (
    root === "config" ||
    root === "defaultconfigs" ||
    root === "resourcepacks" ||
    root === "shaderpacks" ||
    normalized.toLowerCase() === "options.txt"
  ) {
    return "MODIFICABLE"
  }

  return "NO_MODIFICABLE"
}

export interface GameTreeItemCheck {
  logicalPath: string
  isDirectory: boolean
}

/**
 * Validates filesystem tree invariants across a set of active release files.
 * Invariants:
 * 1. A file cannot have descendants (e.g. if 'foo' is a file, cannot have 'foo/bar').
 * 2. A file and directory cannot coexist at the exact same logicalPath.
 */
export function validateGameTreeInvariants(
  existingItems: GameTreeItemCheck[],
  pendingItems: GameTreeItemCheck[] = [],
  options?: {
    ignoredExistingPaths?: Set<string>
  },
): { valid: boolean; error?: string } {
  const filePaths = new Set<string>()
  const dirPaths = new Set<string>()
  const ignored = options?.ignoredExistingPaths ?? new Set<string>()

  // Combine items
  for (const item of existingItems) {
    if (ignored.has(item.logicalPath)) continue
    if (item.isDirectory) {
      dirPaths.add(item.logicalPath)
    } else {
      filePaths.add(item.logicalPath)
    }
  }

  for (const item of pendingItems) {
    if (item.isDirectory) {
      dirPaths.add(item.logicalPath)
    } else {
      filePaths.add(item.logicalPath)
    }
  }

  // 1. Check exact collision between file and directory
  for (const f of filePaths) {
    if (dirPaths.has(f)) {
      return {
        valid: false,
        error: `Conflicto de tipo en el árbol: "${f}" no puede ser simultáneamente un archivo y una carpeta.`,
      }
    }
  }

  // 2. Check that no file is an ancestor of any file or directory
  for (const f of filePaths) {
    const prefix = `${f}/`
    for (const otherFile of filePaths) {
      if (otherFile.startsWith(prefix)) {
        return {
          valid: false,
          error: `Estructura de árbol inválida: el archivo "${f}" no puede contener elementos descendientes como "${otherFile}".`,
        }
      }
    }
    for (const otherDir of dirPaths) {
      if (otherDir.startsWith(prefix)) {
        return {
          valid: false,
          error: `Estructura de árbol inválida: el archivo "${f}" no puede contener la carpeta descendiente "${otherDir}".`,
        }
      }
    }
  }

  return { valid: true }
}


/**
 * Validates a game binary file header bytes against category requirements.
 * For JAR, RESOURCE_PACK, SHADER_PACK, and DATA_PACK, enforces standard ZIP/JAR header magic bytes (50 4B 03 04).
 * For CONFIG, GENERAL, SCRIPT, KUBEJS, allows any format.
 */
export function validateGameFileHeader(
  bytes: ArrayBuffer | Uint8Array,
  filename: string,
  category: GameFileCategory,
): { valid: boolean; error?: string } {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const cleanName = sanitizeGameFileName(filename).toLowerCase()

  if (category === "MOD") {
    if (!cleanName.endsWith(".jar")) {
      return {
        valid: false,
        error: "Un mod debe tener extensión .jar.",
      }
    }
    // Verify ZIP / JAR Magic Bytes (50 4B 03 04)
    if (
      u8.length < 4 ||
      u8[0] !== 0x50 ||
      u8[1] !== 0x4b ||
      u8[2] !== 0x03 ||
      u8[3] !== 0x04
    ) {
      return {
        valid: false,
        error: "El archivo no es un archivo .jar o .zip válido.",
      }
    }
  } else if (category === "DATA_PACK") {
    if (!cleanName.endsWith(".zip")) {
      return {
        valid: false,
        error: "Un data pack debe tener extensión .zip.",
      }
    }
    if (
      u8.length < 4 ||
      u8[0] !== 0x50 ||
      u8[1] !== 0x4b ||
      u8[2] !== 0x03 ||
      u8[3] !== 0x04
    ) {
      return {
        valid: false,
        error: "El archivo no es un data pack .zip válido.",
      }
    }
  } else if (category === "RESOURCE_PACK" || category === "SHADER_PACK") {
    if (!cleanName.endsWith(".zip")) {
      return {
        valid: false,
        error: "El paquete debe tener extensión .zip.",
      }
    }
    if (
      u8.length < 4 ||
      u8[0] !== 0x50 ||
      u8[1] !== 0x4b ||
      u8[2] !== 0x03 ||
      u8[3] !== 0x04
    ) {
      return {
        valid: false,
        error: "El archivo no es un archivo .zip válido.",
      }
    }
  }

  return { valid: true }
}

/**
 * Validates a game binary file buffer against category requirements.
 * For JAR, RESOURCE_PACK, and SHADER_PACK, enforces standard ZIP/JAR header magic bytes (50 4B 03 04).
 * For CONFIG, GENERAL, SCRIPT, KUBEJS, allows any safe buffer up to MAX_GAME_FILE_SIZE_BYTES.
 */
export function validateGameFileBuffer(
  buffer: ArrayBuffer | Uint8Array,
  filename: string,
  category: GameFileCategory,
): { valid: boolean; error?: string } {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length === 0) {
    return { valid: false, error: "El archivo está vacío." }
  }
  if (bytes.length > MAX_GAME_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "El archivo supera el tamaño máximo permitido.",
    }
  }

  return validateGameFileHeader(bytes, filename, category)
}

/**
 * Resolves the logical path inside the Minecraft instance for a given category and filename.
 */
export function resolveGameLogicalPath(
  category: GameFileCategory,
  filename: string,
): string {
  const safeFilename = sanitizeGameFileName(filename)
  const dir = GAME_CATEGORY_DIRECTORIES[category]
  return dir ? `${dir}/${safeFilename}` : safeFilename
}

/**
 * Validates a semantic version string (e.g. 1.4.2).
 */
export function validateSemVer(version: string): boolean {
  if (typeof version !== "string") return false
  const trimmed = version.trim()
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/.test(trimmed)
}

/**
 * Suggests the next patch version given a current SemVer string.
 */
export function suggestNextPatchVersion(currentVersion?: string | null): string {
  if (!currentVersion || !validateSemVer(currentVersion)) {
    return "1.0.0"
  }
  const cleanVersion = currentVersion.split("-")[0] || ""
  const parts = cleanVersion.split(".").map(Number)
  const major = parts[0]
  const minor = parts[1]
  const patch = parts[2]
  if (
    parts.length === 3 &&
    major !== undefined &&
    minor !== undefined &&
    patch !== undefined &&
    !isNaN(major) &&
    !isNaN(minor) &&
    !isNaN(patch)
  ) {
    return `${major}.${minor}.${patch + 1}`
  }
  return "1.0.0"
}

/**
 * Defensively normalizes any date string (ISO-8601, SQLite space timestamp, or epoch) into a valid ISO-8601 UTC string.
 */

export function normalizeIsoDateTime(value?: string | null): string {
  if (!value || typeof value !== "string" || !value.trim()) {
    return new Date().toISOString()
  }
  const trimmed = value.trim()
  const parsed = new Date(trimmed)
  if (!isNaN(parsed.getTime()) && trimmed.includes("T")) {
    return parsed.toISOString()
  }
  const formatted = trimmed.replace(" ", "T") + (trimmed.endsWith("Z") ? "" : "Z")
  const fallback = new Date(formatted)
  return !isNaN(fallback.getTime()) ? fallback.toISOString() : new Date().toISOString()
}

// --- HiKAT Server Administration II & Pterodactyl Integration Constants & Types (Shard 07) ---

export const SERVER_OPERATION_LOCK_TTL_SECONDS = 180 // 3 minutes

export const SERVER_OPERATION_TYPES = [
  "RESTORE_BACKUP",
  "REPLACE_WORLD",
] as const
export type ServerOperationType = typeof SERVER_OPERATION_TYPES[number]

export const SERVER_FILE_ROOTS = ["SERVER", "WORLD", "CONFIG", "MODS", "LOGS"] as const
export type ServerFileRoot = typeof SERVER_FILE_ROOTS[number]

export const ALLOWED_TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".properties",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".cfg",
  ".conf",
  ".log",
] as const

export const MAX_TEXT_FILE_SIZE_BYTES = 256 * 1024 // 256 KB

export function isAllowlistedTextFile(filename: string): boolean {
  if (!filename || typeof filename !== "string") return false
  const lower = filename.toLowerCase()
  return ALLOWED_TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function sanitizeWorldName(name: string | null | undefined): string {
  if (!name || typeof name !== "string") return "world"
  const cleaned = name.trim().replace(/[/\\:*?"<>|\x00-\x1F]/g, "").replace(/\.\.+/g, "")
  return cleaned || "world"
}

export function sanitizeVirtualPath(
  root: ServerFileRoot,
  relativePath?: string | null,
  worldName: string = "world",
): {
  valid: boolean
  sanitizedRelativePath: string
  fullPath: string
  error?: string
} {
  const rawPath = (relativePath || "").trim()
  if (rawPath.startsWith("/") || rawPath.includes("\0") || rawPath.includes("\\") || rawPath.includes("..")) {
    return { valid: false, sanitizedRelativePath: "", fullPath: "", error: "Ruta de archivo no permitida." }
  }

  const safeWorld = sanitizeWorldName(worldName)
  let rootDir: string | null = null
  switch (root) {
    case "SERVER":
      rootDir = "/"
      break
    case "WORLD":
      rootDir = safeWorld
      break
    case "CONFIG":
      rootDir = "config"
      break
    case "MODS":
      rootDir = "mods"
      break
    case "LOGS":
      rootDir = "logs"
      break
    default:
      return { valid: false, sanitizedRelativePath: "", fullPath: "", error: "Categoría de archivo no válida." }
  }

  // Normalize path segments
  const segments = rawPath
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== ".")

  for (const seg of segments) {
    if (seg === ".." || seg.includes("..") || /[/\\:*?"<>|\x00-\x1F]/.test(seg)) {
      return { valid: false, sanitizedRelativePath: "", fullPath: "", error: "Ruta de archivo contiene caracteres inválidos." }
    }
  }

  const sanitizedRelative = segments.join("/")
  const fullPath = root === "SERVER" ? (sanitizedRelative ? `/${sanitizedRelative}` : "/") : (sanitizedRelative ? `${rootDir}/${sanitizedRelative}` : rootDir)

  return {
    valid: true,
    sanitizedRelativePath: sanitizedRelative,
    fullPath,
  }
}

export const MINECRAFT_ALLOWED_SETTINGS = [
  "difficulty",
  "max-players",
  "pvp",
  "white-list",
  "view-distance",
  "simulation-distance",
  "motd",
  "allow-flight",
] as const

export interface MinecraftServerSettingsData {
  difficulty: "peaceful" | "easy" | "normal" | "hard"
  maxPlayers: number
  pvp: boolean
  whitelist: boolean
  viewDistance: number
  simulationDistance: number
  motd: string
  allowFlight: boolean
}

export function parseServerProperties(content: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!content || typeof content !== "string") return map

  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue
    }
    const eqIdx = line.indexOf("=")
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim()
      const value = line.slice(eqIdx + 1).trim()
      if (key) {
        map.set(key, value)
      }
    }
  }
  return map
}

export function extractMinecraftSettings(content: string): MinecraftServerSettingsData {
  const props = parseServerProperties(content)
  const diffRaw = props.get("difficulty")?.toLowerCase()
  const difficulty = (["peaceful", "easy", "normal", "hard"] as const).includes(diffRaw as any)
    ? (diffRaw as "peaceful" | "easy" | "normal" | "hard")
    : "normal"

  const maxPlayersParsed = parseInt(props.get("max-players") || "20", 10)
  const maxPlayers = isNaN(maxPlayersParsed) || maxPlayersParsed < 1 ? 20 : Math.min(maxPlayersParsed, 1000)

  const pvp = props.get("pvp") !== "false"
  const whitelist = props.get("white-list") === "true"

  const vdParsed = parseInt(props.get("view-distance") || "10", 10)
  const viewDistance = isNaN(vdParsed) || vdParsed < 2 ? 10 : Math.min(vdParsed, 32)

  const sdParsed = parseInt(props.get("simulation-distance") || "10", 10)
  const simulationDistance = isNaN(sdParsed) || sdParsed < 2 ? 10 : Math.min(sdParsed, 32)

  const motd = (props.get("motd") || "A HiKAT Minecraft Server").slice(0, 256)
  const allowFlight = props.get("allow-flight") === "true"

  return {
    difficulty,
    maxPlayers,
    pvp,
    whitelist,
    viewDistance,
    simulationDistance,
    motd,
    allowFlight,
  }
}

export function serializeServerProperties(
  originalContent: string,
  updates: Partial<MinecraftServerSettingsData>,
): string {
  const lines = (originalContent || "").split(/\r?\n/)
  const mappedUpdates: Record<string, string> = {}

  if (updates.difficulty !== undefined) mappedUpdates["difficulty"] = String(updates.difficulty)
  if (updates.maxPlayers !== undefined) mappedUpdates["max-players"] = String(Math.max(1, Math.min(1000, updates.maxPlayers)))
  if (updates.pvp !== undefined) mappedUpdates["pvp"] = updates.pvp ? "true" : "false"
  if (updates.whitelist !== undefined) mappedUpdates["white-list"] = updates.whitelist ? "true" : "false"
  if (updates.viewDistance !== undefined) mappedUpdates["view-distance"] = String(Math.max(2, Math.min(32, updates.viewDistance)))
  if (updates.simulationDistance !== undefined) mappedUpdates["simulation-distance"] = String(Math.max(2, Math.min(32, updates.simulationDistance)))
  if (updates.motd !== undefined) mappedUpdates["motd"] = updates.motd.trim().slice(0, 256)
  if (updates.allowFlight !== undefined) mappedUpdates["allow-flight"] = updates.allowFlight ? "true" : "false"

  const updatedKeys = new Set<string>()
  const newLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      return line
    }
    const eqIdx = line.indexOf("=")
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim()
      if (key in mappedUpdates) {
        updatedKeys.add(key)
        return `${key}=${mappedUpdates[key]}`
      }
    }
    return line
  })

  // Append any keys that were not already in original file
  for (const [k, v] of Object.entries(mappedUpdates)) {
    if (!updatedKeys.has(k)) {
      newLines.push(`${k}=${v}`)
    }
  }

  return newLines.join("\n")
}

export const ALLOWED_SERVER_TASK_TEMPLATES = [
  "AUTO_STOP",
  "AUTO_START",
  "AUTO_RESTART",
  "AUTO_BACKUP",
  "RUN_COMMAND",
  "BACKUP_AND_RESTART",
  "BACKUP_AND_STOP",
  "WARN_AND_RESTART",
  "WARN_AND_STOP",
  "SAVE_AND_BACKUP",
  "CUSTOM",
] as const
export type ServerTaskTemplate = typeof ALLOWED_SERVER_TASK_TEMPLATES[number]

export const SERVER_AUTOMATION_ACTIONS = [
  "BACKUP",
  "RESTART",
  "START",
  "STOP",
  "COMMAND",
] as const
export type ServerAutomationAction = typeof SERVER_AUTOMATION_ACTIONS[number]

export const SERVER_AUTOMATION_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "SELECTED_DAYS",
  "INTERVAL",
] as const
export type ServerAutomationFrequency =
  typeof SERVER_AUTOMATION_FREQUENCIES[number]

/**
 * Default administration timezone for HiKAT server tasks.
 * HiKAT operations and schedule displays are standardized on America/Santo_Domingo (UTC-4, no Daylight Saving Time changes).
 * Pterodactyl daemon instances evaluate cron expressions in their local host time, which matches the admin timezone.
 */
export const DEFAULT_SERVER_TIMEZONE = "America/Santo_Domingo" as const

export interface ServerTaskTemplateConfig {
  template: ServerTaskTemplate
  label: string
  description: string
  defaultName: string
  onlyWhenOnline: boolean
  requiresCommand?: boolean
  requiresDelay?: boolean
  defaultDelaySeconds?: number
}

export const SERVER_TASK_TEMPLATE_DEFS: Record<
  ServerTaskTemplate,
  ServerTaskTemplateConfig
> = {
  AUTO_STOP: {
    template: "AUTO_STOP",
    label: "Apagado automático",
    description: "Detiene el servidor de forma segura a la hora programada.",
    defaultName: "Apagado nocturno",
    onlyWhenOnline: true,
  },
  AUTO_START: {
    template: "AUTO_START",
    label: "Encendido automático",
    description: "Inicia el servidor automáticamente si se encuentra apagado.",
    defaultName: "Encendido matutino",
    onlyWhenOnline: false,
  },
  AUTO_RESTART: {
    template: "AUTO_RESTART",
    label: "Reinicio programado",
    description: "Reinicia el servidor en el horario especificado.",
    defaultName: "Reinicio programado",
    onlyWhenOnline: true,
  },
  AUTO_BACKUP: {
    template: "AUTO_BACKUP",
    label: "Backup automático",
    description: "Genera una copia de seguridad periódica.",
    defaultName: "Backup automático",
    onlyWhenOnline: true,
  },
  RUN_COMMAND: {
    template: "RUN_COMMAND",
    label: "Ejecutar comando",
    description: "Envía un comando de Minecraft a la consola del servidor.",
    defaultName: "Comando programado",
    onlyWhenOnline: true,
    requiresCommand: true,
  },
  BACKUP_AND_RESTART: {
    template: "BACKUP_AND_RESTART",
    label: "Backup antes de reiniciar",
    description: "Crea una copia de seguridad y tras una breve espera reinicia el servidor.",
    defaultName: "Backup y reinicio seguro",
    onlyWhenOnline: true,
    requiresDelay: true,
    defaultDelaySeconds: 60,
  },
  BACKUP_AND_STOP: {
    template: "BACKUP_AND_STOP",
    label: "Backup antes de apagar",
    description: "Crea una copia de seguridad y tras una breve espera detiene el servidor.",
    defaultName: "Backup y apagado seguro",
    onlyWhenOnline: true,
    requiresDelay: true,
    defaultDelaySeconds: 60,
  },
  WARN_AND_RESTART: {
    template: "WARN_AND_RESTART",
    label: "Avisar y reiniciar",
    description: "Envía un aviso en el chat a los jugadores y reinicia tras el tiempo de espera.",
    defaultName: "Avisar y reiniciar",
    onlyWhenOnline: true,
    requiresCommand: true,
    requiresDelay: true,
    defaultDelaySeconds: 300,
  },
  WARN_AND_STOP: {
    template: "WARN_AND_STOP",
    label: "Avisar y apagar",
    description: "Envía un aviso en el chat a los jugadores y apaga tras el tiempo de espera.",
    defaultName: "Avisar y apagar",
    onlyWhenOnline: true,
    requiresCommand: true,
    requiresDelay: true,
    defaultDelaySeconds: 300,
  },
  SAVE_AND_BACKUP: {
    template: "SAVE_AND_BACKUP",
    label: "Guardar mundo + crear backup",
    description: "Fuerza el guardado del mundo en disco (save-all flush) y crea la copia de seguridad.",
    defaultName: "Guardar mundo y backup",
    onlyWhenOnline: true,
    requiresDelay: true,
    defaultDelaySeconds: 10,
  },
  CUSTOM: {
    template: "CUSTOM",
    label: "Task personalizada",
    description: "Configuración personalizada para administradores avanzados.",
    defaultName: "Task personalizada",
    onlyWhenOnline: true,
    requiresCommand: false,
  },
}

export interface ServerAutomationModel {
  name: string
  action?: ServerAutomationAction
  template?: ServerTaskTemplate
  frequency: ServerAutomationFrequency
  time?: string | null // "HH:mm" e.g. "04:00"
  intervalHours?: number | null // e.g. 1, 2, 4, 6, 8, 12
  weekday?: number | null // 0-6 (0=Sunday, 1=Monday... 6=Saturday)
  weekdays?: number[] | null
  command?: string | null
  delaySeconds?: number | null
  enabled: boolean
}

export function convertAutomationToPterodactylCron(
  frequency: ServerAutomationFrequency,
  time?: string | null,
  weekday?: number | null,
  weekdays?: number[] | null,
  intervalHours?: number | null,
): {
  minute: string
  hour: string
  day_of_month: string
  month: string
  day_of_week: string
} {
  if (frequency === "INTERVAL") {
    const rawInterval = Number(intervalHours) || 6
    const safeInterval = Math.max(1, Math.min(24, rawInterval))
    const hour = safeInterval === 1 ? "*" : `*/${safeInterval}`
    return {
      minute: "0",
      hour,
      day_of_month: "*",
      month: "*",
      day_of_week: "*",
    }
  }

  const [hStr, mStr] = (time || "04:00").split(":")
  const hour = hStr || "04"
  const minute = mStr || "00"

  let dayOfWeek = "*"
  if (frequency === "WEEKLY") {
    const w = weekday !== undefined && weekday !== null ? weekday : 1
    dayOfWeek = String(Math.max(0, Math.min(6, w)))
  } else if (frequency === "SELECTED_DAYS" && weekdays && weekdays.length > 0) {
    const safeDays = [
      ...new Set(weekdays.map((d) => Math.max(0, Math.min(6, d)))),
    ].sort((a, b) => a - b)
    dayOfWeek = safeDays.join(",")
  }

  return {
    minute,
    hour,
    day_of_month: "*",
    month: "*",
    day_of_week: dayOfWeek,
  }
}

const WEEKDAY_NAMES: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
}

function format12Hour(timeStr?: string | null): string {
  if (!timeStr) return "4:00 AM"
  const [hStr, mStr] = timeStr.split(":")
  const h = parseInt(hStr || "4", 10) || 0
  const m = parseInt(mStr || "0", 10) || 0
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  const mFmt = String(m).padStart(2, "0")
  return `${h12}:${mFmt} ${period}`
}

/**
 * Formats a schedule model into human-friendly Spanish text.
 */
export function formatScheduleHumanDescription(params: {
  frequency: ServerAutomationFrequency
  time?: string | null
  weekday?: number | null
  weekdays?: number[] | null
  intervalHours?: number | null
}): string {
  const { frequency, time, weekday, weekdays, intervalHours } = params

  if (frequency === "INTERVAL") {
    const iv = Number(intervalHours) || 6
    if (iv === 1) return "Cada hora"
    return `Cada ${iv} horas`
  }

  const timeFmt = format12Hour(time)

  if (frequency === "DAILY") {
    return `Todos los días · ${timeFmt}`
  }

  if (frequency === "WEEKLY") {
    const dayName = WEEKDAY_NAMES[weekday ?? 1] || "Lunes"
    return `Cada ${dayName.toLowerCase()} · ${timeFmt}`
  }

  if (frequency === "SELECTED_DAYS" && weekdays && weekdays.length > 0) {
    const dayNames = weekdays
      .map((d) => WEEKDAY_NAMES[d])
      .filter((d): d is string => Boolean(d))
    if (dayNames.length === 1 && dayNames[0]) {
      return `Cada ${dayNames[0].toLowerCase()} · ${timeFmt}`
    }
    const last = dayNames.pop()
    return `${dayNames.join(", ")} y ${last} · ${timeFmt}`
  }

  return `Todos los días · ${timeFmt}`
}

export function mapPterodactylActivityEvent(event: string | null | undefined): {
  eventType: string
  description: string
} {
  if (!event || typeof event !== "string") {
    return { eventType: "SERVER_ACTIVITY", description: "Actividad del servidor" }
  }

  const lower = event.toLowerCase()
  if (lower.includes("power.start") || lower === "server:power.start") {
    return { eventType: "START", description: "Servidor iniciado" }
  }
  if (lower.includes("power.stop") || lower === "server:power.stop") {
    return { eventType: "STOP", description: "Servidor detenido" }
  }
  if (lower.includes("power.restart") || lower === "server:power.restart") {
    return { eventType: "RESTART", description: "Servidor reiniciado" }
  }
  if (lower.includes("backup.create") || lower === "server:backup.create") {
    return { eventType: "BACKUP_CREATE", description: "Copia creada" }
  }
  if (lower.includes("backup.restore") || lower === "server:backup.restore") {
    return { eventType: "BACKUP_RESTORE", description: "Copia restaurada" }
  }
  if (lower.includes("backup.delete") || lower === "server:backup.delete") {
    return { eventType: "BACKUP_DELETE", description: "Copia eliminada" }
  }
  if (lower.includes("file.write") || lower.includes("file.create") || lower.includes("file.upload")) {
    return { eventType: "FILE_UPDATE", description: "Archivo actualizado" }
  }
  if (lower.includes("file.delete")) {
    return { eventType: "FILE_DELETE", description: "Archivo eliminado" }
  }
  return { eventType: "SERVER_ACTIVITY", description: "Actividad del servidor" }
}

// --- Release Deployment Order Configuration (Shard 08F) ---

export const ALLOWED_UPDATE_DEPLOYMENT_ORDERS = ["SERVER_FIRST", "PLAYERS_FIRST"] as const
export type UpdateDeploymentOrder = (typeof ALLOWED_UPDATE_DEPLOYMENT_ORDERS)[number]
export const UpdateDeploymentOrder = {
  SERVER_FIRST: "SERVER_FIRST",
  PLAYERS_FIRST: "PLAYERS_FIRST",
} as const







