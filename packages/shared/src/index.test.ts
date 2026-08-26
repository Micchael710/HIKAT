import { describe, it, expect } from "vitest"

import {
  HIKAT_APP_NAME,
  HIKAT_VERSION,
  ALLOWED_ROLES,
  ALLOWED_AUTH_PROVIDERS,
  ALLOWED_CONTENT_KINDS,
  ALLOWED_CONTENT_STATUSES,
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_MEDIA_SIZE_BYTES,
  normalizeSlug,
  isValidSlug,
  encodeCursor,
  decodeCursor,
} from "./index"

describe("@hikat/shared foundation", () => {
  it("exports valid core constants", () => {
    expect(HIKAT_APP_NAME).toBe("HiKAT")
    expect(HIKAT_VERSION).toBe("0.1.0")
  })

  it("exports valid roles and external providers", () => {
    expect(ALLOWED_ROLES).toEqual(["PLAYER", "ADMIN"])
    expect(ALLOWED_AUTH_PROVIDERS).toEqual(["GOOGLE", "DISCORD"])
  })

  it("exports content core constants and validates slug normalization", () => {
    expect(ALLOWED_CONTENT_KINDS).toEqual(["NEWS", "ANNOUNCEMENT"])
    expect(ALLOWED_CONTENT_STATUSES).toEqual(["DRAFT", "PUBLISHED"])
    expect(ALLOWED_MEDIA_MIME_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"])
    expect(MAX_MEDIA_SIZE_BYTES).toBe(5 * 1024 * 1024)

    expect(normalizeSlug("  Hello World! New Release v1.0.0 -- ")).toBe("hello-world-new-release-v1-0-0")
    expect(normalizeSlug("Noticias de Verano: ¡Gran Apertura!")).toBe("noticias-de-verano-gran-apertura")

    expect(isValidSlug("hello-world")).toBe(true)
    expect(isValidSlug("valid-slug-123")).toBe(true)
    expect(isValidSlug("ab")).toBe(false) // too short (<3)
    expect(isValidSlug("-invalid-leading")).toBe(false)
    expect(isValidSlug("invalid--double")).toBe(false)
    expect(isValidSlug("invalid trailing-")).toBe(false)
    expect(isValidSlug("invalid_underscore")).toBe(false)
  })

  it("encodes and decodes compound pagination cursor reliably", () => {
    const original = { publishedAt: "2026-08-26T12:00:00.000Z", id: "post-123" }
    const cursor = encodeCursor(original)
    expect(typeof cursor).toBe("string")
    expect(cursor.length).toBeGreaterThan(0)

    const decoded = decodeCursor<typeof original>(cursor)
    expect(decoded).toEqual(original)

    expect(decodeCursor("invalid-base64-%%$$")).toBeNull()
    expect(decodeCursor("")).toBeNull()
  })
})
