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
import {
  fetchGlobalCapes,
  fetchMyPlayerCapes,
  fetchMyActiveCape,
  setMyActiveCape,
  createPlayerCapeUploadTicket,
  addMyPlayerCape,
  deleteMyPlayerCape,
  uploadPlayerCape,
} from "./capeService"
import * as apiClientModule from "./apiClient"
import { authService } from "./authService"

describe("Launcher Skin & Cape Services (Phase 07 Hardening & Shard 8F)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    authService.clearSession()
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
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        myPlayerSkin: {
          id: "pskin-123",
          userId: "user-456",
          imageUrl: "/media/content/custom.png",
          createdAt: "2026-08-26T12:00:00Z",
          updatedAt: "2026-08-26T12:00:00Z",
        },
      },
    })

    const mySkin = await fetchMyPlayerSkin()
    expect(mySkin).not.toBeNull()
    expect(mySkin?.id).toBe("pskin-123")
    expect(mySkin?.imageUrl).toContain("/media/content/custom.png")
  })

  it("fetches player active skin selection", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        myActiveSkin: {
          type: "CUSTOM",
          skinId: null,
          skin: {
            id: "pskin-123",
            name: "Mi Skin",
            imageUrl: "/media/content/custom.png",
          },
        },
      },
    })

    const active = await fetchMyActiveSkin()
    expect(active).not.toBeNull()
    expect(active?.type).toBe("CUSTOM")
  })

  it("sets player active skin selection", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyActiveSkin: {
          type: "GLOBAL",
          skinId: "skin-1",
          skin: {
            id: "skin-1",
            name: "Steve",
            imageUrl: "/media/content/steve.png",
          },
        },
      },
    })

    const res = await setMyActiveSkin("GLOBAL", "skin-1")
    expect(res.success).toBe(true)
    expect(res.data?.type).toBe("GLOBAL")
    expect(res.data?.skinId).toBe("skin-1")
  })

  it("returns null for fetchMyPlayerSkin when unauthenticated", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue(null)
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

  it("sets player skin after upload", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyPlayerSkin: {
          id: "pskin-123",
          userId: "user-456",
          imageUrl: "/media/content/custom.png",
          createdAt: "2026-08-26T12:00:00Z",
          updatedAt: "2026-08-26T12:00:00Z",
        },
      },
    })

    const res = await setMyPlayerSkin("media-789")
    expect(res.success).toBe(true)
  })

  it("uploads player skin end-to-end consuming flat backend response ({ id, ... })", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-jwt-token")

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
              imageUrl: "/media/content/media-999.png",
              createdAt: "2026-08-26T12:00:00Z",
              updatedAt: "2026-08-26T12:00:00Z",
            },
          },
        }
      }
      return { success: false }
    })

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

  // --- Capes Service Tests ---

  it("fetches global capes catalog", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        capes: {
          items: [
            {
              id: "cape-1",
              name: "Capa Fundador",
              imageUrl: "/media/content/cape1.png",
              status: "AVAILABLE",
              createdAt: "2026-08-26T12:00:00Z",
              updatedAt: "2026-08-26T12:00:00Z",
            },
          ],
          totalCount: 1,
        },
      },
    })

    const capes = await fetchGlobalCapes()
    expect(capes.length).toBe(1)
    expect(capes[0].name).toBe("Capa Fundador")
  })

  it("fetches player capes and active cape selection", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        myPlayerCapes: [
          {
            id: "pcape-1",
            userId: "user-1",
            name: "Capa Dragón",
            imageUrl: "/media/content/pcape1.png",
            createdAt: "2026-08-26T12:00:00Z",
            updatedAt: "2026-08-26T12:00:00Z",
          },
        ],
      },
    })

    const pCapes = await fetchMyPlayerCapes()
    expect(pCapes.length).toBe(1)
    expect(pCapes[0].name).toBe("Capa Dragón")
  })

  it("sets active cape to NONE canonical", async () => {
    vi.spyOn(authService, "getAccessToken").mockReturnValue("fake-jwt-token")
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyActiveCape: {
          type: "NONE",
          capeId: null,
          playerCapeId: null,
          imageUrl: null,
          name: "Sin capa",
        },
      },
    })

    const res = await setMyActiveCape("NONE")
    expect(res.success).toBe(true)
    expect(res.data?.type).toBe("NONE")
  })

  it("uploadPlayerCape rejects incompatible cape texture dimensions before creating ticket", async () => {
    // 100x100 PNG is not a valid cape layout
    const badData = new Uint8Array(100 * 100 * 4).fill(255)
    const badPng = encodePng({ width: 100, height: 100, data: badData, channels: 4, depth: 8 })
    const badFile = new File([badPng.buffer as ArrayBuffer], "badcape.png", { type: "image/png" })

    await expect(uploadPlayerCape(badFile, "Bad Cape")).rejects.toThrow(
      "Esta imagen no tiene un formato de capa compatible.",
    )
  })
})
