// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { encode as encodePng } from "fast-png"
import {
  fetchGlobalSkins,
  fetchMyPlayerSkin,
  fetchMyActiveSkin,
  setMyActiveSkin,
  createPlayerSkinUploadTicket,
  setMyPlayerSkin,
  deleteMyPlayerSkin,
  uploadPlayerSkin,
  resolveApiAssetUrl,
} from "./skinService"
import * as apiClientModule from "./apiClient"

describe("Launcher Skin Service & URL Resolution (Shard 06.6A)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })


  it("resolves asset URLs correctly (relative vs absolute)", () => {
    expect(resolveApiAssetUrl("https://example.com/skin.png")).toBe(
      "https://example.com/skin.png",
    )
    expect(resolveApiAssetUrl("/media/content/xyz.png")).toContain(
      "/media/content/xyz.png",
    )
    expect(resolveApiAssetUrl("")).toBe("")
    expect(resolveApiAssetUrl(null)).toBe("")
  })

  it("fetches global skins catalog and normalizes imageUrls", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        skins: {
          items: [
            {
              id: "skin-1",
              name: "Steve",
              model: "CLASSIC",
              imageUrl: "/media/content/steve.png",
              status: "AVAILABLE",
              createdAt: "2026-08-26T12:00:00Z",
              updatedAt: "2026-08-26T12:00:00Z",
            },
          ],
          totalCount: 1,
        },
      },
    })

    const skins = await fetchGlobalSkins()
    expect(skins.length).toBe(1)
    expect(skins[0].id).toBe("skin-1")
    expect(skins[0].imageUrl).toContain("/media/content/steve.png")
  })

  it("fetches player personal custom skin when token exists", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        myPlayerSkin: {
          id: "pskin-123",
          userId: "user-456",
          model: "SLIM",
          imageUrl: "/media/content/custom.png",
          createdAt: "2026-08-26T12:00:00Z",
          updatedAt: "2026-08-26T12:00:00Z",
        },
      },
    })

    const mySkin = await fetchMyPlayerSkin()
    expect(mySkin).not.toBeNull()
    expect(mySkin?.id).toBe("pskin-123")
    expect(mySkin?.model).toBe("SLIM")
    expect(mySkin?.imageUrl).toContain("/media/content/custom.png")
  })

  it("fetches player active skin selection", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        myActiveSkin: {
          type: "CUSTOM",
          globalSkinId: null,
          skin: {
            id: "pskin-123",
            name: "Mi Skin",
            model: "SLIM",
            imageUrl: "/media/content/custom.png",
          },
        },
      },
    })

    const active = await fetchMyActiveSkin()
    expect(active).not.toBeNull()
    expect(active?.type).toBe("CUSTOM")
    expect(active?.skin?.model).toBe("SLIM")
  })

  it("sets player active skin selection", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyActiveSkin: {
          type: "GLOBAL",
          globalSkinId: "skin-1",
          skin: {
            id: "skin-1",
            name: "Steve",
            model: "CLASSIC",
            imageUrl: "/media/content/steve.png",
          },
        },
      },
    })

    const res = await setMyActiveSkin("GLOBAL", "skin-1")
    expect(res.success).toBe(true)
    expect(res.data?.type).toBe("GLOBAL")
    expect(res.data?.globalSkinId).toBe("skin-1")
  })

  it("returns null for fetchMyPlayerSkin when unauthenticated", async () => {
    const mySkin = await fetchMyPlayerSkin()
    expect(mySkin).toBeNull()
  })

  it("creates upload ticket for player skin", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        createPlayerSkinUpload: {
          uploadUrl: "/media/content/upload",
          uploadToken: "tok-abc-123",
          expiresAt: "2026-08-26T12:30:00Z",
          maxSizeBytes: 1048576,
        },
      },
    })

    const res = await createPlayerSkinUploadTicket()
    expect(res.success).toBe(true)
    expect(res.data?.uploadToken).toBe("tok-abc-123")
  })

  it("sets player skin after upload with model selection", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyPlayerSkin: {
          id: "pskin-123",
          userId: "user-456",
          model: "SLIM",
          imageUrl: "/media/content/custom.png",
          createdAt: "2026-08-26T12:00:00Z",
          updatedAt: "2026-08-26T12:00:00Z",
        },
      },
    })

    const res = await setMyPlayerSkin("media-789", "SLIM")
    expect(res.success).toBe(true)
    expect(res.data?.model).toBe("SLIM")
  })

  it("uploads player skin end-to-end consuming flat backend response ({ id, ... })", async () => {
    window.localStorage.setItem("hikat_auth_token", "fake-jwt-token")

    // 1. Mock ticket and setMyPlayerSkin
    vi.spyOn(apiClientModule, "graphqlClient").mockImplementation(async (query) => {
      if (typeof query === "string" && query.includes("createPlayerSkinUpload")) {
        return {
          success: true,
          data: {
            createPlayerSkinUpload: {
              uploadUrl: "/media/content/upload",
              uploadToken: "tok-xyz-789",
              expiresAt: "2026-08-26T12:30:00Z",
              maxSizeBytes: 1048576,
            },
          },
        }
      }
      if (typeof query === "string" && query.includes("setMyPlayerSkin")) {
        return {
          success: true,
          data: {
            setMyPlayerSkin: {
              id: "pskin-789",
              userId: "user-456",
              model: "CLASSIC" as const,
              imageUrl: "/media/content/media-999.png",
              createdAt: "2026-08-26T12:00:00Z",
              updatedAt: "2026-08-26T12:00:00Z",
            },
          },
        }
      }
      return { success: false }
    })

    // 2. Construct valid 64x64 PNG buffer using fast-png
    const rawData = new Uint8ClampedArray(64 * 64 * 4)
    rawData.fill(255)
    const validPngBytes = encodePng({
      width: 64,
      height: 64,
      data: rawData,
      channels: 4,
      depth: 8,
    })

    const mockFile = new File([validPngBytes.buffer as ArrayBuffer], "my_skin.png", {
      type: "image/png",
    })

    // 3. Mock fetch binary PUT endpoint returning flat { id: 'media-999', ... }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "media-999",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: validPngBytes.byteLength,
        url: "/media/content/media-999",
        createdAt: "2026-08-26T12:00:00Z",
      }),
    })
    global.fetch = fetchMock as any

    const result = await uploadPlayerSkin(mockFile)
    expect(result.id).toBe("pskin-789")
    expect(result.model).toBe("CLASSIC")
    expect(result.imageUrl).toContain("/media/content/media-999.png")
    expect(fetchMock).toHaveBeenCalled()
  })

  it("deletes player custom skin", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        deleteMyPlayerSkin: true,
      },
    })

    const res = await deleteMyPlayerSkin()
    expect(res.success).toBe(true)
  })
})
