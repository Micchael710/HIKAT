import { describe, it, expect } from "vitest"
import { parseAndNormalizeYouTubeUrl, ALLOWED_IMAGE_MIME_TYPES, ALLOWED_VIDEO_MIME_TYPES } from "@hikat/shared"

describe("Back Office News Form Helpers & Validations", () => {
  it("correctly parses various YouTube URL formats", () => {
    // Standard watch
    expect(parseAndNormalizeYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    })

    // Shortened youtu.be
    expect(parseAndNormalizeYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    })

    // Shorts
    expect(parseAndNormalizeYouTubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    })

    // Invalid URLs
    expect(parseAndNormalizeYouTubeUrl("https://vimeo.com/123456")).toBeNull()
    expect(parseAndNormalizeYouTubeUrl("not-a-url")).toBeNull()
    expect(parseAndNormalizeYouTubeUrl("")).toBeNull()
  })

  it("has correct allowed MIME types for image and video", () => {
    expect(ALLOWED_IMAGE_MIME_TYPES).toContain("image/png")
    expect(ALLOWED_IMAGE_MIME_TYPES).toContain("image/jpeg")
    expect(ALLOWED_IMAGE_MIME_TYPES).toContain("image/webp")

    expect(ALLOWED_VIDEO_MIME_TYPES).toContain("video/mp4")
    expect(ALLOWED_VIDEO_MIME_TYPES).toContain("video/webm")
  })
})
