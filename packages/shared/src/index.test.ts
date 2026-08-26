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
})
