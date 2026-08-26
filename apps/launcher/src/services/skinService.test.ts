// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  fetchGlobalSkins,

  fetchMyPlayerSkin,
  createPlayerSkinUploadTicket,
  setMyPlayerSkin,
  deleteMyPlayerSkin,
  uploadPlayerSkin,
  resolveApiAssetUrl,
} from "./skinService"
import * as apiClientModule from "./apiClient"

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
  })
}

describe("Launcher Skin Service & URL Resolution (Shard 06.6A)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })


  it("resolves asset URLs correctly (relative vs absolute)", () => {
    expect(resolveApiAssetUrl("")).toBe("")
    expect(resolveApiAssetUrl(null)).toBe("")
    expect(resolveApiAssetUrl(undefined)).toBe("")

    // Absolute URLs remain intact
    expect(resolveApiAssetUrl("https://assets.hikat.com/skins/alex.png")).toBe(
      "https://assets.hikat.com/skins/alex.png",
    )
    expect(resolveApiAssetUrl("http://localhost:8787/media/content/abc")).toBe(
      "http://localhost:8787/media/content/abc",
    )
    expect(resolveApiAssetUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    )

    // Relative URLs prepend backend base URL
    const resolved = resolveApiAssetUrl("/media/content/skin-123.png")
    expect(resolved).toMatch(/^https?:\/\/.*\/media\/content\/skin-123\.png$/)
  })

  it("fetches global skins catalog and normalizes imageUrls", async () => {
    const mockSkins = [
      {
        id: "skin-1",
        name: "Caballero",
        model: "CLASSIC" as const,
        imageUrl: "/media/content/skin-1.png",
        status: "AVAILABLE" as const,
        createdAt: "2026-08-26T12:00:00Z",
        updatedAt: "2026-08-26T12:00:00Z",
      },
    ]

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        skins: {
          items: mockSkins,
          totalCount: 1,
        },
      },
    })

    const result = await fetchGlobalSkins()
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("Caballero")
    expect(result[0]?.imageUrl).toContain("/media/content/skin-1.png")
  })

  it("fetches player personal custom skin when token exists", async () => {
    localStorage.setItem("hikat_auth_token", "fake-token")
    const mockPlayerSkin = {
      id: "pskin-1",
      userId: "user-1",
      model: "SLIM" as const,
      imageUrl: "/media/content/player-skin.png",
      createdAt: "2026-08-26T12:00:00Z",
      updatedAt: "2026-08-26T12:00:00Z",
    }

    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        myPlayerSkin: mockPlayerSkin,
      },
    })

    const result = await fetchMyPlayerSkin()
    expect(result).not.toBeNull()
    expect(result?.model).toBe("SLIM")
    expect(result?.imageUrl).toContain("/media/content/player-skin.png")
  })

  it("returns null for fetchMyPlayerSkin when unauthenticated", async () => {
    const result = await fetchMyPlayerSkin()
    expect(result).toBeNull()
  })

  it("creates upload ticket for player skin", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        createPlayerSkinUpload: {
          uploadUrl: "/media/player-skin/upload",
          uploadToken: "token-123",
          expiresAt: "2026-08-26T13:00:00Z",
          maxSizeBytes: 1048576,
        },
      },
    })

    const res = await createPlayerSkinUploadTicket()
    expect(res.success).toBe(true)
    expect(res.data?.uploadToken).toBe("token-123")
  })

  it("sets player skin after upload with model selection", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyPlayerSkin: {
          id: "pskin-1",
          userId: "user-1",
          model: "SLIM" as const,
          imageUrl: "/media/content/media-123.png",
          createdAt: "2026-08-26T12:00:00Z",
          updatedAt: "2026-08-26T12:00:00Z",
        },
      },
    })

    const res = await setMyPlayerSkin("media-123", "SLIM")
    expect(res.success).toBe(true)
    expect(res.data?.model).toBe("SLIM")
    expect(res.data?.imageUrl).toContain("/media/content/media-123.png")
  })

  it("uploads player skin end-to-end consuming flat backend response ({ id, ... })", async () => {
    // 1. Mock ticket creation
    vi.spyOn(apiClientModule, "graphqlClient").mockImplementation(async (query: string) => {
      if (query.includes("CreatePlayerSkinUpload")) {
        return {
          success: true,
          data: {
            createPlayerSkinUpload: {
              uploadUrl: "/media/player-skin/upload",
              uploadToken: "mock-token-xyz",
              expiresAt: "2026-08-26T14:00:00Z",
              maxSizeBytes: 1048576,
            },
          },
        }
      }
      if (query.includes("SetMyPlayerSkin")) {
        return {
          success: true,
          data: {
            setMyPlayerSkin: {
              id: "pskin-789",
              userId: "user-456",
              model: "SLIM" as const,
              imageUrl: "/media/content/media-999.png",
              createdAt: "2026-08-26T12:00:00Z",
              updatedAt: "2026-08-26T12:00:00Z",
            },
          },
        }
      }
      return { success: false }
    })

    // 2. Construct valid 64x64 PNG buffer
    const validPngBytes = new Uint8Array(48)
    validPngBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    const view = new DataView(validPngBytes.buffer)
    view.setUint32(16, 64, false)
    view.setUint32(20, 64, false)

    const mockFile = new File([validPngBytes], "my_skin.png", {
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
        sizeBytes: 48,
        url: "/media/content/media-999",
        createdAt: "2026-08-26T12:00:00Z",
      }),
    })
    global.fetch = fetchMock as any

    const result = await uploadPlayerSkin(mockFile, "SLIM")
    expect(result.id).toBe("pskin-789")
    expect(result.model).toBe("SLIM")
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
