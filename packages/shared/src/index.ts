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
  "http://localhost:5173/auth/callback",
  "http://127.0.0.1:5173/auth/callback",
] as const

export const ALLOWED_LINK_REDIRECT_URIS = [
  "https://app.hikat.org/settings",
  "https://app.hikat.org/account",
  "http://localhost:5173/settings",
  "http://127.0.0.1:5173/settings",
  "hikat://settings/accounts",
] as const

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

// --- HiKAT Back Office Core Constants & Validation Helpers (Shard 06.5) ---


export const ALLOWED_SKIN_MODELS = ["CLASSIC", "SLIM"] as const
export type SkinModel = typeof ALLOWED_SKIN_MODELS[number]

export const ALLOWED_SKIN_STATUSES = ["AVAILABLE", "UNAVAILABLE"] as const
export type SkinStatus = typeof ALLOWED_SKIN_STATUSES[number]

export const MAX_SKIN_SIZE_BYTES = 1 * 1024 * 1024 // 1 MB

export const ALLOWED_GAME_CATEGORIES = [
  "MOD",
  "RESOURCE_PACK",
  "SHADER_PACK",
  "KUBEJS",
  "SCRIPT",
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

export const MAX_GAME_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

export const GAME_CATEGORY_DIRECTORIES: Record<GameFileCategory, string> = {
  MOD: "mods",
  RESOURCE_PACK: "resourcepacks",
  SHADER_PACK: "shaderpacks",
  KUBEJS: "kubejs",
  SCRIPT: "scripts",
}

export const GAME_CATEGORY_DEFAULT_POLICIES: Record<
  GameFileCategory,
  SyncPolicy
> = {
  MOD: "NO_MODIFICABLE",
  RESOURCE_PACK: "MODIFICABLE",
  SHADER_PACK: "MODIFICABLE",
  KUBEJS: "NO_MODIFICABLE",
  SCRIPT: "NO_MODIFICABLE",
}

/**
 * Validates PNG buffer header magic bytes and IHDR dimensions for Minecraft skins.
 * Supported standard Minecraft skins: 64x64 or 64x32 (or valid HD multiples 128x128, etc.).
 */
export function validateMinecraftSkinTexture(
  buffer: ArrayBuffer | Uint8Array,
): { valid: boolean; width?: number; height?: number; error?: string } {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 24) {
    return { valid: false, error: "El archivo de skin es demasiado pequeño." }
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
    return {
      valid: false,
      error: "El archivo no es una imagen PNG válida.",
    }
  }

  // Read IHDR Width (bytes 16-19) and Height (bytes 20-23) in big-endian
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)

  // Minecraft standard dimensions: 64x64, 64x32, or power-of-two HD textures up to 1024x1024
  const validDimensions =
    (width === 64 && (height === 64 || height === 32)) ||
    (width === 128 && (height === 128 || height === 64)) ||
    (width === 256 && (height === 256 || height === 128)) ||
    (width === 512 && (height === 512 || height === 256)) ||
    (width === 1024 && (height === 1024 || height === 512))

  if (!validDimensions) {
    return {
      valid: false,
      width,
      height,
      error: `Dimensiones de skin no válidas (${width}x${height}). Debe ser 64x64 o 64x32 píxeles (o múltiplos HD).`,
    }
  }

  return { valid: true, width, height }
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

/**
 * Validates a game binary file buffer against category requirements.
 * For JAR, RESOURCE_PACK, and SHADER_PACK, enforces standard ZIP/JAR header magic bytes (50 4B 03 04).
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
      error: "El archivo supera el tamaño máximo permitido (100 MB).",
    }
  }

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
      bytes.length < 4 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 ||
      bytes[3] !== 0x04
    ) {
      return {
        valid: false,
        error: "El archivo no es un archivo .jar o .zip válido.",
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
      bytes.length < 4 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 ||
      bytes[3] !== 0x04
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
 * Resolves the logical path inside the Minecraft instance for a given category and filename.
 */
export function resolveGameLogicalPath(
  category: GameFileCategory,
  filename: string,
): string {
  const safeFilename = sanitizeGameFileName(filename)
  const dir = GAME_CATEGORY_DIRECTORIES[category] || "mods"
  return `${dir}/${safeFilename}`
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





