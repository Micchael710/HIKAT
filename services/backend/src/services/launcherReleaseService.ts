/**
 * HiKAT Launcher Desktop Releases Service
 * Management of launcher releases, upload tickets, R2 verification, and auto-publishing.
 */

import { eq, and, isNull, desc } from "drizzle-orm"
import {
  Database,
  launcherReleases,
  launcherUploadTickets,
  LauncherReleaseStatus,
} from "@hikat/database"
import { createGraphQLError } from "@hikat/graphql"
import type {
  LauncherReleaseGql,
  LauncherUploadTicketPayloadGql,
} from "@hikat/graphql"
import type { Env } from "../types"
import { generateR2TemporaryCredentials } from "./r2CredentialsService"

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/
const TICKET_EXPIRATION_SECONDS = 3600 // 1 hour
const MAX_LAUNCHER_SIZE_BYTES = 500 * 1024 * 1024 // 500 MB

async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/^.*[\\\/]/, "").trim()
  if (!cleaned || cleaned.includes("..") || !cleaned.toLowerCase().endsWith(".exe")) {
    throw createGraphQLError(
      "El nombre de archivo debe ser un instalador ejecutable válido (.exe).",
      "VALIDATION_ERROR",
    )
  }
  return cleaned
}

export interface RequestLauncherUploadTicketInput {
  version: string
  filename: string
  declaredSizeBytes: number
  sha512: string
  adminUserId: string
}

export async function requestLauncherReleaseUploadTicket(
  db: Database,
  env: Env,
  input: RequestLauncherUploadTicketInput,
): Promise<LauncherUploadTicketPayloadGql> {
  const version = input.version.trim()
  if (!SEMVER_REGEX.test(version)) {
    throw createGraphQLError(
      `Formato de versión SemVer inválido: '${version}'. Ejemplo esperado: '1.0.1'.`,
      "VALIDATION_ERROR",
    )
  }

  const existing = await db
    .select({ id: launcherReleases.id })
    .from(launcherReleases)
    .where(eq(launcherReleases.version, version))
    .limit(1)

  if (existing.length > 0) {
    throw createGraphQLError(
      `Ya existe una versión del Launcher con el número '${version}'.`,
      "CONFLICT",
    )
  }

  const filename = sanitizeFilename(input.filename)

  if (!input.declaredSizeBytes || input.declaredSizeBytes <= 0) {
    throw createGraphQLError(
      "El tamaño del instalador debe ser mayor a 0 bytes.",
      "VALIDATION_ERROR",
    )
  }

  if (input.declaredSizeBytes > MAX_LAUNCHER_SIZE_BYTES) {
    throw createGraphQLError(
      `El tamaño declarado (${input.declaredSizeBytes} bytes) excede el máximo permitido (500 MB).`,
      "VALIDATION_ERROR",
    )
  }

  const sha512 = input.sha512.trim()
  if (!sha512 || sha512.length < 32) {
    throw createGraphQLError(
      "El hash SHA-512 (Base64) del instalador es obligatorio y debe ser válido.",
      "VALIDATION_ERROR",
    )
  }

  const objectKey = `launcher/releases/${version}/${filename}`
  const bucketName = env.R2_BUCKET_NAME || "hikat-r2"
  const accountId = env.CLOUDFLARE_ACCOUNT_ID

  const r2Creds = await generateR2TemporaryCredentials({
    env,
    objectKey,
    ttlSeconds: TICKET_EXPIRATION_SECONDS,
  })

  const rawTokenBytes = new Uint8Array(32)
  crypto.getRandomValues(rawTokenBytes)
  const uploadToken = Array.from(rawTokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const tokenHash = await sha256Hex(uploadToken)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TICKET_EXPIRATION_SECONDS * 1000).toISOString()
  const ticketId = crypto.randomUUID()

  await db.insert(launcherUploadTickets).values({
    id: ticketId,
    tokenHash,
    version,
    filename,
    declaredSizeBytes: input.declaredSizeBytes,
    sha512,
    createdBy: input.adminUserId,
    expiresAt,
    createdAt: now.toISOString(),
  })

  return {
    ticketId,
    uploadToken,
    version,
    filename,
    objectKey,
    declaredSizeBytes: input.declaredSizeBytes,
    sha512,
    bucketName,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Creds.accessKeyId,
      secretAccessKey: r2Creds.secretAccessKey,
      sessionToken: r2Creds.sessionToken,
    },
    expiresAt,
  }
}

export interface CompleteLauncherReleaseUploadInput {
  uploadToken: string
  notes?: string | null
  adminUserId: string
}

export async function completeLauncherReleaseUpload(
  db: Database,
  env: Env,
  input: CompleteLauncherReleaseUploadInput,
): Promise<LauncherReleaseGql> {
  const tokenHash = await sha256Hex(input.uploadToken.trim())

  const tickets = await db
    .select()
    .from(launcherUploadTickets)
    .where(
      and(
        eq(launcherUploadTickets.tokenHash, tokenHash),
        isNull(launcherUploadTickets.usedAt),
      ),
    )
    .limit(1)

  if (tickets.length === 0) {
    throw createGraphQLError(
      "Ticket de subida no válido o ya utilizado.",
      "NOT_FOUND",
    )
  }

  const ticket = tickets[0]
  if (!ticket) {
    throw createGraphQLError(
      "Ticket de subida no válido o ya utilizado.",
      "NOT_FOUND",
    )
  }

  if (new Date(ticket.expiresAt) < new Date()) {
    throw createGraphQLError(
      "El ticket de subida ha expirado. Por favor, solicita uno nuevo.",
      "VALIDATION_ERROR",
    )
  }

  if (!env.ASSETS) {
    throw createGraphQLError(
      "Almacenamiento R2 no disponible.",
      "INTERNAL_ERROR",
    )
  }

  const objectKey = `launcher/releases/${ticket.version}/${ticket.filename}`

  // Verify file in Cloudflare R2
  const head = await env.ASSETS.head(objectKey)
  if (!head || head.size <= 0) {
    throw createGraphQLError(
      "No se encontró el archivo del instalador en el almacenamiento R2.",
      "NOT_FOUND",
    )
  }

  if (head.size !== ticket.declaredSizeBytes) {
    throw createGraphQLError(
      `El tamaño del archivo en R2 (${head.size} bytes) no coincide con el tamaño declarado (${ticket.declaredSizeBytes} bytes).`,
      "VALIDATION_ERROR",
    )
  }

  const existingVersion = await db
    .select({ id: launcherReleases.id })
    .from(launcherReleases)
    .where(eq(launcherReleases.version, ticket.version))
    .limit(1)

  if (existingVersion.length > 0) {
    throw createGraphQLError(
      `La versión '${ticket.version}' ya ha sido registrada previamente.`,
      "CONFLICT",
    )
  }

  const now = new Date().toISOString()
  const releaseId = crypto.randomUUID()

  // Mark ticket used
  await db
    .update(launcherUploadTickets)
    .set({ usedAt: now })
    .where(eq(launcherUploadTickets.id, ticket.id))

  // Insert release
  await db.insert(launcherReleases).values({
    id: releaseId,
    version: ticket.version,
    status: "DRAFT",
    filename: ticket.filename,
    objectKey,
    sizeBytes: head.size,
    sha512: ticket.sha512,
    notes: input.notes?.trim() || null,
    createdBy: input.adminUserId,
    createdAt: now,
  })

  return {
    id: releaseId,
    version: ticket.version,
    status: "DRAFT",
    filename: ticket.filename,
    sizeBytes: head.size,
    sha512: ticket.sha512,
    notes: input.notes?.trim() || null,
    createdAt: now,
    publishedAt: null,
  }
}

export async function publishLauncherRelease(
  db: Database,
  id: string,
): Promise<LauncherReleaseGql> {
  const target = await db
    .select()
    .from(launcherReleases)
    .where(eq(launcherReleases.id, id))
    .limit(1)

  if (target.length === 0) {
    throw createGraphQLError(
      "La release del Launcher no existe.",
      "NOT_FOUND",
    )
  }

  const release = target[0]
  if (!release) {
    throw createGraphQLError(
      "La release del Launcher no existe.",
      "NOT_FOUND",
    )
  }

  const now = new Date().toISOString()

  // Archive any currently published release
  await db
    .update(launcherReleases)
    .set({ status: "ARCHIVED" })
    .where(eq(launcherReleases.status, "PUBLISHED"))

  // Mark this release as PUBLISHED
  await db
    .update(launcherReleases)
    .set({
      status: "PUBLISHED",
      publishedAt: now,
    })
    .where(eq(launcherReleases.id, id))

  return {
    id: release.id,
    version: release.version,
    status: "PUBLISHED",
    filename: release.filename,
    sizeBytes: release.sizeBytes,
    sha512: release.sha512,
    notes: release.notes,
    createdAt: release.createdAt,
    publishedAt: now,
  }
}

export async function getLauncherReleases(
  db: Database,
): Promise<LauncherReleaseGql[]> {
  const rows = await db
    .select()
    .from(launcherReleases)
    .orderBy(desc(launcherReleases.createdAt))

  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status as LauncherReleaseStatus,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    sha512: r.sha512,
    notes: r.notes,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
  }))
}

export async function getPublishedLauncherRelease(
  db: Database,
): Promise<LauncherReleaseGql | null> {
  const rows = await db
    .select()
    .from(launcherReleases)
    .where(eq(launcherReleases.status, "PUBLISHED"))
    .limit(1)

  const r = rows[0]
  if (!r) return null

  return {
    id: r.id,
    version: r.version,
    status: r.status as LauncherReleaseStatus,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    sha512: r.sha512,
    notes: r.notes,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
  }
}
