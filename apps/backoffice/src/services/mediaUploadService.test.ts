import { describe, it, expect, beforeEach, vi } from "vitest"
import { uploadMediaFile, MediaUploadError } from "./mediaUploadService"
import { newsApi } from "./graphqlClient"
import * as gameFileUploadModule from "./gameFileUploadService"

describe("Back Office MediaUploadService (Direct R2 Multipart Upload)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("1. Rejects invalid image MIME types", async () => {
    const invalidFile = new File(["dummy content"], "test.gif", {
      type: "image/gif",
    })

    await expect(uploadMediaFile(invalidFile, "IMAGE")).rejects.toThrow(
      "Formato de imagen no compatible. Use PNG, JPEG o WebP.",
    )
  })

  it("2. Rejects invalid video MIME types", async () => {
    const invalidVideo = new File(["dummy video"], "test.avi", {
      type: "video/x-msvideo",
    })

    await expect(uploadMediaFile(invalidVideo, "VIDEO")).rejects.toThrow(
      "Formato de video no compatible. Use MP4 o WebM.",
    )
  })

  it("3. Rejects empty (0-byte) files immediately without requesting ticket", async () => {
    const emptyFile = new File([], "empty.png", { type: "image/png" })
    const createSpy = vi.spyOn(newsApi, "createContentMediaUpload")

    await expect(uploadMediaFile(emptyFile, "IMAGE")).rejects.toThrow(
      "El archivo seleccionado está vacío.",
    )
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("4. Allows image > 5 MB (e.g. 12 MB) without artificial size rejection", async () => {
    const largeImage = new File([new Uint8Array(12 * 1024 * 1024)], "large-banner.png", {
      type: "image/png",
    })

    const createSpy = vi.spyOn(newsApi, "createContentMediaUpload").mockResolvedValue({
      uploadToken: "tok-123",
      expiresAt: "2026-09-02T15:00:00Z",
      maxSizeBytes: largeImage.size,
      expectedMimeType: "image/png",
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      mediaId: "media-img-123",
      objectKey: "content/media/media-img-123.png",
      bucket: "hikat-r2",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "key-1",
        secretAccessKey: "secret-1",
        sessionToken: "token-1",
      },
    })

    const multipartSpy = vi.spyOn(gameFileUploadModule, "uploadFileToR2Multipart").mockResolvedValue()

    const completeSpy = vi.spyOn(newsApi, "completeContentMediaUpload").mockResolvedValue({
      id: "media-img-123",
      mediaType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: largeImage.size,
      url: "http://localhost:8787/media/content/media-img-123",
      createdAt: "2026-09-02T12:00:00Z",
    })

    const result = await uploadMediaFile(largeImage, "IMAGE")

    expect(createSpy).toHaveBeenCalledWith({
      mimeType: "image/png",
      sizeBytes: largeImage.size,
    })
    expect(multipartSpy).toHaveBeenCalledWith(largeImage, expect.objectContaining({
      bucket: "hikat-r2",
      objectKey: "content/media/media-img-123.png",
      contentType: "image/png",
    }))
    expect(completeSpy).toHaveBeenCalledWith({
      uploadToken: "tok-123",
    })
    expect(result.id).toBe("media-img-123")
    expect(result.sizeBytes).toBe(12 * 1024 * 1024)
  })

  it("5. Allows video > 25 MB (e.g. 50 MB) without artificial size rejection", async () => {
    const largeVideo = new File([new Uint8Array(50 * 1024 * 1024)], "cinematic.mp4", {
      type: "video/mp4",
    })

    vi.spyOn(newsApi, "createContentMediaUpload").mockResolvedValue({
      uploadToken: "tok-vid-456",
      expiresAt: "2026-09-02T15:00:00Z",
      maxSizeBytes: largeVideo.size,
      expectedMimeType: "video/mp4",
      allowedMimeTypes: ["video/mp4", "video/webm"],
      mediaId: "media-vid-456",
      objectKey: "content/media/media-vid-456.mp4",
      bucket: "hikat-r2",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "key-1",
        secretAccessKey: "secret-1",
        sessionToken: "token-1",
      },
    })

    const multipartSpy = vi.spyOn(gameFileUploadModule, "uploadFileToR2Multipart").mockResolvedValue()

    const completeSpy = vi.spyOn(newsApi, "completeContentMediaUpload").mockResolvedValue({
      id: "media-vid-456",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      sizeBytes: largeVideo.size,
      url: "http://localhost:8787/media/content/media-vid-456",
      createdAt: "2026-09-02T12:00:00Z",
    })

    const result = await uploadMediaFile(largeVideo, "VIDEO")

    expect(multipartSpy).toHaveBeenCalledWith(largeVideo, expect.objectContaining({
      bucket: "hikat-r2",
      objectKey: "content/media/media-vid-456.mp4",
      contentType: "video/mp4",
    }))
    expect(completeSpy).toHaveBeenCalledWith({
      uploadToken: "tok-vid-456",
    })
    expect(result.id).toBe("media-vid-456")
    expect(result.sizeBytes).toBe(50 * 1024 * 1024)
  })

  it("6. Does NOT call file.arrayBuffer() to load the full file into memory", async () => {
    const imageFile = new File(["some image bytes"], "banner.webp", {
      type: "image/webp",
    })

    const arrayBufferSpy = vi.spyOn(imageFile, "arrayBuffer")

    vi.spyOn(newsApi, "createContentMediaUpload").mockResolvedValue({
      uploadToken: "tok-webp",
      expiresAt: "2026-09-02T15:00:00Z",
      maxSizeBytes: imageFile.size,
      expectedMimeType: "image/webp",
      allowedMimeTypes: ["image/webp"],
      mediaId: "media-webp",
      objectKey: "content/media/media-webp.webp",
      bucket: "hikat-r2",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "k",
        secretAccessKey: "s",
        sessionToken: "t",
      },
    })

    vi.spyOn(gameFileUploadModule, "uploadFileToR2Multipart").mockResolvedValue()
    vi.spyOn(newsApi, "completeContentMediaUpload").mockResolvedValue({
      id: "media-webp",
      mediaType: "IMAGE",
      mimeType: "image/webp",
      sizeBytes: imageFile.size,
      url: "http://localhost:8787/media/content/media-webp",
      createdAt: "2026-09-02T12:00:00Z",
    })

    await uploadMediaFile(imageFile, "IMAGE")

    // The whole file is streamed by AWS SDK Upload without calling file.arrayBuffer() in mediaUploadService
    expect(arrayBufferSpy).not.toHaveBeenCalled()
  })

  it("7. Propagates errors when R2 multipart upload or Backend verification fails", async () => {
    const validFile = new File(["bytes"], "cover.jpg", { type: "image/jpeg" })

    vi.spyOn(newsApi, "createContentMediaUpload").mockResolvedValue({
      uploadToken: "tok-err",
      expiresAt: "2026-09-02T15:00:00Z",
      maxSizeBytes: validFile.size,
      expectedMimeType: "image/jpeg",
      allowedMimeTypes: ["image/jpeg"],
      mediaId: "media-err",
      objectKey: "content/media/media-err.jpg",
      bucket: "hikat-r2",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "k",
        secretAccessKey: "s",
        sessionToken: "t",
      },
    })

    // R2 network failure
    vi.spyOn(gameFileUploadModule, "uploadFileToR2Multipart").mockRejectedValue(
      new Error("Network connection lost during R2 multipart upload"),
    )

    await expect(uploadMediaFile(validFile, "IMAGE")).rejects.toThrow(
      "Network connection lost during R2 multipart upload",
    )
  })
})
