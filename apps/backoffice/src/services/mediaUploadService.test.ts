import { describe, it, expect, beforeEach, vi } from "vitest"
import { uploadMediaFile } from "./mediaUploadService"
import { authService } from "./authService"

describe("Back Office MediaUploadService", () => {
  beforeEach(() => {
    authService.clearSession()
    vi.restoreAllMocks()
  })

  it("validates image format and size limits before upload", async () => {
    authService.setSession("test-token", "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    // Invalid format
    const invalidFile = new File(["dummy content"], "test.gif", {
      type: "image/gif",
    })

    await expect(uploadMediaFile(invalidFile, "IMAGE")).rejects.toThrow(
      "Formato de imagen no compatible. Use PNG, JPEG o WebP.",
    )

    // Exceeding 5 MB
    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], "large.png", {
      type: "image/png",
    })

    await expect(uploadMediaFile(largeFile, "IMAGE")).rejects.toThrow(
      "La imagen no puede superar los 5 MB.",
    )
  })

  it("validates video format and size limits before upload", async () => {
    authService.setSession("test-token", "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    // Invalid format
    const invalidVideo = new File(["dummy video"], "test.avi", {
      type: "video/x-msvideo",
    })

    await expect(uploadMediaFile(invalidVideo, "VIDEO")).rejects.toThrow(
      "Formato de video no compatible. Use MP4 o WebM.",
    )

    // Exceeding 25 MB
    const largeVideo = new File([new ArrayBuffer(26 * 1024 * 1024)], "large.mp4", {
      type: "video/mp4",
    })

    await expect(uploadMediaFile(largeVideo, "VIDEO")).rejects.toThrow(
      "El video no puede superar los 25 MB.",
    )
  })

  it("completes full ticket request + binary PUT upload flow", async () => {
    authService.setSession("admin-jwt", "refresh-tok", {
      id: "admin-1",
      role: "ADMIN",
    })

    const validImageFile = new File(["image-bytes"], "banner.png", {
      type: "image/png",
    })

    // 1. GraphQL ticket request
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            createContentMediaUpload: {
              uploadUrl: "/media/content/upload",
              uploadToken: "single-use-ticket-token",
              expiresAt: "2026-08-26T12:00:00Z",
              maxSizeBytes: 5242880,
              expectedMimeType: "image/png",
              allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
            },
          },
        }),
      } as Response)
      // 2. Binary PUT request
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: "media-uuid-123",
          mediaType: "IMAGE",
          mimeType: "image/png",
          sizeBytes: validImageFile.size,
          url: "http://localhost:8787/media/content/media-uuid-123",
          createdAt: "2026-08-26T11:00:00Z",
        }),
      } as Response)

    const result = await uploadMediaFile(validImageFile, "IMAGE")

    expect(result.id).toBe("media-uuid-123")
    expect(result.mediaType).toBe("IMAGE")
    expect(result.url).toContain("media-uuid-123")
  })
})
