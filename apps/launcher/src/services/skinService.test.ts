import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  fetchGlobalSkins,
  fetchMyPlayerSkin,
  createPlayerSkinUploadTicket,
  setMyPlayerSkin,
  deleteMyPlayerSkin,
  uploadPlayerSkin,
} from "./skinService"
import * as apiClientModule from "./apiClient"

describe("Launcher Skin Service (Shard 06.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches global skins catalog successfully", async () => {
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
  })

  it("fetches player personal custom skin", async () => {
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
    expect(result?.imageUrl).toBe("/media/content/player-skin.png")
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

  it("sets player skin after upload", async () => {
    vi.spyOn(apiClientModule, "graphqlClient").mockResolvedValue({
      success: true,
      data: {
        setMyPlayerSkin: {
          id: "pskin-1",
          userId: "user-1",
          model: "CLASSIC" as const,
          imageUrl: "/media/content/media-123.png",
          createdAt: "2026-08-26T12:00:00Z",
          updatedAt: "2026-08-26T12:00:00Z",
        },
      },
    })

    const res = await setMyPlayerSkin("media-123", "CLASSIC")
    expect(res.success).toBe(true)
    expect(res.data?.imageUrl).toBe("/media/content/media-123.png")
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
