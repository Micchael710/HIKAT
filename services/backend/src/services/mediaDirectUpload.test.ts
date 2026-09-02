import { describe, it, expect, beforeEach, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { createTestR2Bucket } from "../testUtils/mockR2"
import {
  createContentMediaUpload,
  completeContentMediaUpload,
} from "./mediaService"
import { MAX_SKIN_SIZE_BYTES, MAX_CAPE_SIZE_BYTES } from "@hikat/shared"
import type { Env } from "../types"

describe("HiKAT Content Media Direct R2 Multipart Upload Suite", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let mockR2: ReturnType<typeof createTestR2Bucket>
  let env: Env
  const adminId = "admin-media-" + crypto.randomUUID()

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
      R2_PARENT_API_TOKEN: "r2-parent-api-token",
      R2_BUCKET_NAME: "hikat-r2",
    }

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url)
      if (urlStr.includes("/r2/temp-access-credentials")) {
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: {
              accessKeyId: "temp-access-key-id",
              secretAccessKey: "temp-secret-access-key",
              sessionToken: "temp-session-token",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response("Not Found", { status: 404 })
    })

    await db.insert(schema.users).values({
      id: adminId,
      displayName: "Admin Media Test",
      role: "ADMIN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  it("1. Image > 5 MB (e.g. 15 MB) is NOT rejected by artificial limit", async () => {
    const payload = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/png",
      sizeBytes: 15 * 1024 * 1024, // 15 MB
    })

    expect(payload).toBeDefined()
    expect(payload.uploadToken).toBeDefined()
    expect(payload.mediaId).toBeDefined()
    expect(payload.objectKey).toBe(`content/media/${payload.mediaId}.png`)
    expect(payload.maxSizeBytes).toBe(15 * 1024 * 1024)
    expect(payload.credentials?.accessKeyId).toBe("temp-access-key-id")
  })

  it("2. Video > 25 MB (e.g. 100 MB) is NOT rejected by artificial limit", async () => {
    const payload = await createContentMediaUpload(db, env, adminId, {
      mimeType: "video/mp4",
      sizeBytes: 100 * 1024 * 1024, // 100 MB
    })

    expect(payload).toBeDefined()
    expect(payload.uploadToken).toBeDefined()
    expect(payload.mediaId).toBeDefined()
    expect(payload.objectKey).toBe(`content/media/${payload.mediaId}.mp4`)
    expect(payload.maxSizeBytes).toBe(100 * 1024 * 1024)
  })

  it("3. Non-allowed MIME type is rejected", async () => {
    await expect(
      createContentMediaUpload(db, env, adminId, {
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).rejects.toThrow("Unsupported MIME type 'application/pdf'")
  })

  it("4. Empty (0-byte) request is rejected", async () => {
    await expect(
      createContentMediaUpload(db, env, adminId, {
        mimeType: "image/png",
        sizeBytes: 0,
      }),
    ).rejects.toThrow("Media size must be greater than 0")
  })

  it("5. completeContentMediaUpload verifies object existence in R2 before creating D1 record", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/webp",
      sizeBytes: 2048,
    })

    // R2 object does NOT exist yet
    await expect(
      completeContentMediaUpload(db, env, adminId, {
        uploadToken: ticket.uploadToken,
      }),
    ).rejects.toThrow("Media object not found in R2 storage")

    // No record created in D1
    const d1Record = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, ticket.mediaId!))
      .get()

    expect(d1Record).toBeUndefined()
  })

  it("6. completeContentMediaUpload saves verified actual R2 object size in D1", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "video/mp4",
      sizeBytes: 50 * 1024 * 1024,
    })

    const actualContent = new Uint8Array(45 * 1024 * 1024) // Actual uploaded size 45 MB
    await env.ASSETS!.put(ticket.objectKey!, actualContent, {
      httpMetadata: { contentType: "video/mp4" },
    })

    const completed = await completeContentMediaUpload(db, env, adminId, {
      uploadToken: ticket.uploadToken,
    })

    expect(completed.id).toBe(ticket.mediaId)
    expect(completed.sizeBytes).toBe(45 * 1024 * 1024)
    expect(completed.mimeType).toBe("video/mp4")
    expect(completed.mediaType).toBe("VIDEO")

    // Verify persisted record in D1
    const d1Record = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, ticket.mediaId!))
      .get()

    expect(d1Record).toBeDefined()
    expect(d1Record?.sizeBytes).toBe(45 * 1024 * 1024)
    expect(d1Record?.objectKey).toBe(ticket.objectKey)
  })

  it("7. completeContentMediaUpload rejects empty 0-byte objects in R2", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/png",
      sizeBytes: 1024,
    })

    // Put empty object
    await env.ASSETS!.put(ticket.objectKey!, new Uint8Array(0))

    await expect(
      completeContentMediaUpload(db, env, adminId, {
        uploadToken: ticket.uploadToken,
      }),
    ).rejects.toThrow("Uploaded media object is empty (0 bytes)")
  })

  it("8. Skins and capes retain their limits (1 MB skin, 5 MB cape)", () => {
    expect(MAX_SKIN_SIZE_BYTES).toBe(1 * 1024 * 1024)
    expect(MAX_CAPE_SIZE_BYTES).toBe(5 * 1024 * 1024)
  })

  it("9. Failure during completion / D1 error does NOT leave orphan ContentMedia record", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/jpeg",
      sizeBytes: 4096,
    })

    await env.ASSETS!.put(ticket.objectKey!, new Uint8Array([1, 2, 3, 4]))

    // Mock D1 insert error
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("D1 constraint violation simulated error")
    })

    await expect(
      completeContentMediaUpload(db, env, adminId, {
        uploadToken: ticket.uploadToken,
      }),
    ).rejects.toThrow("D1 constraint violation simulated error")

    // R2 object deleted by compensation rollback
    const head = await env.ASSETS!.head(ticket.objectKey!)
    expect(head).toBeNull()

    // No valid ContentMedia in D1
    const d1Record = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, ticket.mediaId!))
      .get()
    expect(d1Record).toBeUndefined()
  })
})
