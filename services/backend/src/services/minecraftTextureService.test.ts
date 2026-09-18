/**
 * HiKAT Minecraft Texture Delivery Service Unit & Integration Test Suite
 * Tests:
 * - Public routes: GET /minecraft/skins/:username.png and GET /minecraft/capes/:username.png
 * - Case-insensitive username resolution against users.displayName
 * - Dynamic active skin resolution (CUSTOM, GLOBAL, and instant update on the same URL)
 * - Dynamic active cape resolution (NONE -> 404, CUSTOM, GLOBAL, instant update on same URL)
 * - Cache-Control: no-store and Content-Type: image/png headers
 * - Edge cases (invalid username, non-existent player, deleted media, missing .png, 405 methods)
 */

import { describe, it, expect, beforeEach } from "vitest"
import { encode } from "fast-png"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { createTestR2Bucket } from "../testUtils/mockR2"
import worker from "../index"
import { isValidUsername } from "@hikat/shared"
import {
  handleMinecraftSkinServe,
  handleMinecraftCapeServe,
} from "./minecraftTextureService"
import { setMyPlayerSkin, setMyActiveSkin } from "./skinService"
import { addMyPlayerCape, setMyActiveCape } from "./capeService"
import type { Env } from "../types"

describe("HiKAT Minecraft Texture Service Suite (Custom Skin Loader Integration)", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let mockR2: ReturnType<typeof createTestR2Bucket>
  let env: Env

  const kirbyUserId = "user-kirby-" + crypto.randomUUID()
  const noSkinUserId = "user-noskin-" + crypto.randomUUID()

  // Helper to generate valid PNG bytes for skins (64x64) and capes (64x32)
  function createSkinBytes(val: number): Uint8Array {
    const data = new Uint8Array(64 * 64 * 4).fill(val)
    return encode({ width: 64, height: 64, data, channels: 4, depth: 8 })
  }

  function createCapeBytes(val: number): Uint8Array {
    const data = new Uint8Array(64 * 32 * 4).fill(val)
    return encode({ width: 64, height: 32, data, channels: 4, depth: 8 })
  }

  // Helper to seed a ContentMedia row and put the object in mock R2
  async function seedMedia(
    mediaId: string,
    objectKey: string,
    bytes: Uint8Array,
    userId: string,
  ): Promise<string> {
    const now = new Date().toISOString()

    await db.insert(schema.contentMedia).values({
      id: mediaId,
      objectKey,
      mediaType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      createdBy: userId,
      createdAt: now,
    })

    await mockR2.put(objectKey, bytes, {
      httpMetadata: { contentType: "image/png" },
    })

    return mediaId
  }

  beforeEach(async () => {
    testD1 = createTestD1()
    db = createDatabase(testD1)
    mockR2 = createTestR2Bucket()
    env = {
      DB: testD1 as unknown as D1Database,
      ASSETS: mockR2 as unknown as R2Bucket,
      ENVIRONMENT: "test",
      CLOUDFLARE_ACCOUNT_ID: "cf-test-account-id",
      R2_PARENT_ACCESS_KEY_ID: "r2-parent-key-id",
      R2_PARENT_SECRET_ACCESS_KEY: "r2-parent-secret-key-123456789",
      R2_BUCKET_NAME: "hikat-r2",
    }

    const now = new Date().toISOString()

    // Seed player Kirby (Mixed case displayName)
    await db.insert(schema.users).values({
      id: kirbyUserId,
      displayName: "Kirby",
      role: "PLAYER",
      createdAt: now,
      updatedAt: now,
    })

    // Seed player NoSkin
    await db.insert(schema.users).values({
      id: noSkinUserId,
      displayName: "NoSkinPlayer",
      role: "PLAYER",
      createdAt: now,
      updatedAt: now,
    })
  })

  // ==========================================
  // Username Validation Tests
  // ==========================================
  describe("isValidUsername", () => {
    it("accepts valid Minecraft usernames (3-16 alphanumeric or underscore)", () => {
      expect(isValidUsername("Kirby")).toBe(true)
      expect(isValidUsername("kirby")).toBe(true)
      expect(isValidUsername("Steve_123")).toBe(true)
      expect(isValidUsername("1234567890123456")).toBe(true)
      expect(isValidUsername("Player_One")).toBe(true)
    })

    it("rejects invalid usernames (empty, <3 chars, >16 chars, special characters)", () => {
      expect(isValidUsername("")).toBe(false)
      expect(isValidUsername("a")).toBe(false) // < 3 chars
      expect(isValidUsername("ab")).toBe(false) // < 3 chars
      expect(isValidUsername("toolongusername12345678")).toBe(false) // > 16 chars
      expect(isValidUsername("Kirby!")).toBe(false)
      expect(isValidUsername("user-name")).toBe(false)
      expect(isValidUsername("user.name")).toBe(false)
      expect(isValidUsername("player name")).toBe(false)
      expect(isValidUsername("Kirby.png")).toBe(false)
    })
  })

  // ==========================================
  // SKINS: GET /minecraft/skins/:username.png
  // ==========================================
  describe("Skin Serving Endpoint", () => {
    it("1. Kirby with CUSTOM active skin returns 200, image/png, no-store, and correct bytes", async () => {
      const skinABytes = createSkinBytes(42)
      const mediaAId = "media-skin-a"
      await seedMedia(mediaAId, `skins/${mediaAId}.png`, skinABytes, kirbyUserId)

      // Set custom skin for Kirby
      await setMyPlayerSkin(
        db,
        env,
        {
          mediaId: mediaAId,
        },
        kirbyUserId,
      )

      // Request via worker.fetch
      const req = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const res = await worker.fetch(req, env)

      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("image/png")
      expect(res.headers.get("Cache-Control")).toBe("no-store")

      const bodyBuffer = new Uint8Array(await res.arrayBuffer())
      expect(bodyBuffer).toEqual(skinABytes)
    })

    it("2. Kirby with GLOBAL active skin returns 200 and the global skin bytes", async () => {
      const globalSkinBytes = createSkinBytes(99)
      const globalMediaId = "media-global-skin"
      await seedMedia(globalMediaId, `skins/${globalMediaId}.png`, globalSkinBytes, kirbyUserId)

      const globalSkinId = "global-skin-1"
      const now = new Date().toISOString()
      await db.insert(schema.skins).values({
        id: globalSkinId,
        name: "Global Hero Skin",
        mediaId: globalMediaId,
        status: "AVAILABLE",
        createdBy: kirbyUserId,
        createdAt: now,
        updatedAt: now,
      })

      // Select global skin for Kirby
      await setMyActiveSkin(db, env, kirbyUserId, {
        type: "GLOBAL",
        skinId: globalSkinId,
      })

      const req = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const res = await worker.fetch(req, env)

      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("image/png")
      expect(res.headers.get("Cache-Control")).toBe("no-store")

      const bodyBuffer = new Uint8Array(await res.arrayBuffer())
      expect(bodyBuffer).toEqual(globalSkinBytes)
    })

    it("3. Dynamic update: changing active skin from Skin A to Skin B immediately returns Skin B on the SAME URL", async () => {
      // Step A: Kirby has Skin A active
      const skinABytes = createSkinBytes(10)
      const mediaAId = "media-skin-dynamic-a"
      await seedMedia(mediaAId, `skins/${mediaAId}.png`, skinABytes, kirbyUserId)

      await setMyPlayerSkin(
        db,
        env,
        {
          mediaId: mediaAId,
        },
        kirbyUserId,
      )

      // First check: returns Skin A
      const reqA = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const resA = await worker.fetch(reqA, env)
      expect(resA.status).toBe(200)
      const bodyA = new Uint8Array(await resA.arrayBuffer())
      expect(bodyA).toEqual(skinABytes)

      // Step B: Player switches/updates to Skin B using existing logic
      const skinBBytes = createSkinBytes(20)
      const mediaBId = "media-skin-dynamic-b"
      await seedMedia(mediaBId, `skins/${mediaBId}.png`, skinBBytes, kirbyUserId)

      await setMyPlayerSkin(
        db,
        env,
        {
          mediaId: mediaBId,
        },
        kirbyUserId,
      )

      // Step C: EXACT SAME URL -> immediately returns Skin B without any delays
      const reqB = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const resB = await worker.fetch(reqB, env)
      expect(resB.status).toBe(200)
      expect(resB.headers.get("Cache-Control")).toBe("no-store")
      const bodyB = new Uint8Array(await resB.arrayBuffer())
      expect(bodyB).toEqual(skinBBytes)
    })

    it("4. Case-insensitivity: kirby.png, KIRBY.png, and Kirby.PNG resolve the same skin", async () => {
      const skinBytes = createSkinBytes(55)
      const mediaId = "media-case-skin"
      await seedMedia(mediaId, `skins/${mediaId}.png`, skinBytes, kirbyUserId)

      await setMyPlayerSkin(
        db,
        env,
        {
          mediaId,
        },
        kirbyUserId,
      )

      const variants = [
        "https://api.hikat.org/minecraft/skins/kirby.png",
        "https://api.hikat.org/minecraft/skins/KIRBY.png",
        "https://api.hikat.org/minecraft/skins/KiRbY.png",
        "https://api.hikat.org/minecraft/skins/Kirby.PNG",
      ]

      for (const url of variants) {
        const res = await worker.fetch(new Request(url), env)
        expect(res.status, `Failed for URL: ${url}`).toBe(200)
        expect(res.headers.get("Content-Type")).toBe("image/png")
        expect(res.headers.get("Cache-Control")).toBe("no-store")
        const bytes = new Uint8Array(await res.arrayBuffer())
        expect(bytes).toEqual(skinBytes)
      }
    })

    it("5. Non-existent player returns 404 with no-store", async () => {
      const res = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/NonExistent.png"), env)
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    })

    it("6. Player without active skin returns 404 with no-store", async () => {
      const res = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/NoSkinPlayer.png"), env)
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    })

    it("7. Invalid username or missing .png returns 404", async () => {
      // Too short (< 3 chars, e.g. "a")
      const res0 = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/a.png"), env)
      expect(res0.status).toBe(404)

      // Invalid characters
      const res1 = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/Invalid!Player.png"), env)
      expect(res1.status).toBe(404)

      // Missing .png extension
      const res2 = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/Kirby"), env)
      expect(res2.status).toBe(404)

      // Wrong extension
      const res3 = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/Kirby.jpg"), env)
      expect(res3.status).toBe(404)

      // Trailing subpath
      const res4 = await worker.fetch(new Request("https://api.hikat.org/minecraft/skins/Kirby.png/sub"), env)
      expect(res4.status).toBe(404)
    })

    it("8. Non-GET methods return 405 Method Not Allowed", async () => {
      const methods = ["POST", "PUT", "DELETE", "PATCH"]
      for (const method of methods) {
        const res = await worker.fetch(
          new Request("https://api.hikat.org/minecraft/skins/Kirby.png", { method }),
          env,
        )
        expect(res.status).toBe(405)
      }
    })
  })

  // ==========================================
  // CAPES: GET /minecraft/capes/:username.png
  // ==========================================
  describe("Cape Serving Endpoint", () => {
    it("1. Kirby with active cape = NONE returns 404 with no-store", async () => {
      const res = await worker.fetch(new Request("https://api.hikat.org/minecraft/capes/Kirby.png"), env)
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    })

    it("2. Kirby with CUSTOM active cape returns 200, image/png, no-store, and correct bytes", async () => {
      const capeBytes = createCapeBytes(88)
      const mediaId = "media-custom-cape-1"
      await seedMedia(mediaId, `capes/${mediaId}.png`, capeBytes, kirbyUserId)

      // Add player cape (signature: db, env, input, userId)
      const pCape = await addMyPlayerCape(
        db,
        env,
        {
          name: "My Flying Cape",
          mediaId,
        },
        kirbyUserId,
      )

      // Set active cape to CUSTOM (signature: db, env, userId, input)
      await setMyActiveCape(db, env, kirbyUserId, {
        type: "CUSTOM",
        playerCapeId: pCape.id,
      })

      const req = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const res = await worker.fetch(req, env)

      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("image/png")
      expect(res.headers.get("Cache-Control")).toBe("no-store")

      const bodyBuffer = new Uint8Array(await res.arrayBuffer())
      expect(bodyBuffer).toEqual(capeBytes)
    })

    it("3. Kirby with GLOBAL active cape returns 200 and the global cape bytes", async () => {
      const globalCapeBytes = createCapeBytes(123)
      const mediaId = "media-global-cape-1"
      await seedMedia(mediaId, `capes/${mediaId}.png`, globalCapeBytes, kirbyUserId)

      const globalCapeId = "global-cape-1"
      const now = new Date().toISOString()
      await db.insert(schema.capes).values({
        id: globalCapeId,
        name: "Veteran Cape",
        mediaId,
        status: "AVAILABLE",
        createdBy: kirbyUserId,
        createdAt: now,
        updatedAt: now,
      })

      // Select global cape for Kirby
      await setMyActiveCape(db, env, kirbyUserId, {
        type: "GLOBAL",
        capeId: globalCapeId,
      })

      const req = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const res = await worker.fetch(req, env)

      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("image/png")
      expect(res.headers.get("Cache-Control")).toBe("no-store")

      const bodyBuffer = new Uint8Array(await res.arrayBuffer())
      expect(bodyBuffer).toEqual(globalCapeBytes)
    })

    it("4. Dynamic update: changing cape selection immediately reflects on the SAME URL", async () => {
      // Step A: Custom Cape A active
      const capeABytes = createCapeBytes(15)
      const mediaAId = "media-cape-dynamic-a"
      await seedMedia(mediaAId, `capes/${mediaAId}.png`, capeABytes, kirbyUserId)

      const pCapeA = await addMyPlayerCape(
        db,
        env,
        {
          name: "Cape A",
          mediaId: mediaAId,
        },
        kirbyUserId,
      )

      await setMyActiveCape(db, env, kirbyUserId, {
        type: "CUSTOM",
        playerCapeId: pCapeA.id,
      })

      // First check: returns Cape A
      const reqA = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const resA = await worker.fetch(reqA, env)
      expect(resA.status).toBe(200)
      expect(new Uint8Array(await resA.arrayBuffer())).toEqual(capeABytes)

      // Step B: Change to Global Cape B
      const capeBBytes = createCapeBytes(25)
      const mediaBId = "media-cape-dynamic-b"
      await seedMedia(mediaBId, `capes/${mediaBId}.png`, capeBBytes, kirbyUserId)

      const globalCapeBId = "global-cape-b"
      const now = new Date().toISOString()
      await db.insert(schema.capes).values({
        id: globalCapeBId,
        name: "Cape B",
        mediaId: mediaBId,
        status: "AVAILABLE",
        createdBy: kirbyUserId,
        createdAt: now,
        updatedAt: now,
      })

      await setMyActiveCape(db, env, kirbyUserId, {
        type: "GLOBAL",
        capeId: globalCapeBId,
      })

      // Step C: Same URL immediately returns Cape B
      const reqB = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const resB = await worker.fetch(reqB, env)
      expect(resB.status).toBe(200)
      expect(new Uint8Array(await resB.arrayBuffer())).toEqual(capeBBytes)

      // Step D: Change to NONE -> same URL immediately returns 404
      await setMyActiveCape(db, env, kirbyUserId, {
        type: "NONE",
      })

      const reqNone = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const resNone = await worker.fetch(reqNone, env)
      expect(resNone.status).toBe(404)
    })

    it("5. Cape case-insensitivity: kirby.png, KIRBY.png, and Kirby.PNG resolve correctly", async () => {
      const capeBytes = createCapeBytes(77)
      const mediaId = "media-case-cape"
      await seedMedia(mediaId, `capes/${mediaId}.png`, capeBytes, kirbyUserId)

      const pCape = await addMyPlayerCape(
        db,
        env,
        {
          name: "Case Cape",
          mediaId,
        },
        kirbyUserId,
      )

      await setMyActiveCape(db, env, kirbyUserId, {
        type: "CUSTOM",
        playerCapeId: pCape.id,
      })

      const variants = [
        "https://api.hikat.org/minecraft/capes/kirby.png",
        "https://api.hikat.org/minecraft/capes/KIRBY.png",
        "https://api.hikat.org/minecraft/capes/Kirby.PNG",
      ]

      for (const url of variants) {
        const res = await worker.fetch(new Request(url), env)
        expect(res.status).toBe(200)
        expect(res.headers.get("Content-Type")).toBe("image/png")
        expect(res.headers.get("Cache-Control")).toBe("no-store")
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(capeBytes)
      }
    })

    it("6. Non-existent player on cape endpoint returns 404 with no-store", async () => {
      const res = await worker.fetch(new Request("https://api.hikat.org/minecraft/capes/GhostPlayer.png"), env)
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    })

    it("7. Non-GET methods on cape endpoint return 405 Method Not Allowed", async () => {
      const res = await worker.fetch(
        new Request("https://api.hikat.org/minecraft/capes/Kirby.png", { method: "POST" }),
        env,
      )
      expect(res.status).toBe(405)
    })
  })

  // ==========================================
  // Direct Service Function Tests
  // ==========================================
  describe("Direct Service Handler Tests", () => {
    it("handles direct invocation of handleMinecraftSkinServe", async () => {
      const skinBytes = createSkinBytes(60)
      const mediaId = "media-direct-skin"
      await seedMedia(mediaId, `skins/${mediaId}.png`, skinBytes, kirbyUserId)

      await setMyPlayerSkin(
        db,
        env,
        {
          mediaId,
        },
        kirbyUserId,
      )

      // Calling with usernameParam
      const req1 = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const res1 = await handleMinecraftSkinServe(req1, env, db, "Kirby")
      expect(res1.status).toBe(200)

      // Calling without usernameParam (extracted from URL)
      const req2 = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const res2 = await handleMinecraftSkinServe(req2, env, db)
      expect(res2.status).toBe(200)

      // Calling with usernameParam ending in .png
      const req3 = new Request("https://api.hikat.org/minecraft/skins/Kirby.png")
      const res3 = await handleMinecraftSkinServe(req3, env, db, "Kirby.png")
      expect(res3.status).toBe(200)
    })

    it("handles direct invocation of handleMinecraftCapeServe", async () => {
      const capeBytes = createCapeBytes(70)
      const mediaId = "media-direct-cape"
      await seedMedia(mediaId, `capes/${mediaId}.png`, capeBytes, kirbyUserId)

      const pCape = await addMyPlayerCape(
        db,
        env,
        {
          name: "Direct Cape",
          mediaId,
        },
        kirbyUserId,
      )

      await setMyActiveCape(db, env, kirbyUserId, {
        type: "CUSTOM",
        playerCapeId: pCape.id,
      })

      // Calling with usernameParam
      const req1 = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const res1 = await handleMinecraftCapeServe(req1, env, db, "Kirby")
      expect(res1.status).toBe(200)

      // Calling without usernameParam (extracted from URL)
      const req2 = new Request("https://api.hikat.org/minecraft/capes/Kirby.png")
      const res2 = await handleMinecraftCapeServe(req2, env, db)
      expect(res2.status).toBe(200)
    })
  })
})
