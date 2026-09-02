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
  const otherAdminId = "admin-other-" + crypto.randomUUID()

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

    await db.insert(schema.users).values({
      id: otherAdminId,
      displayName: "Other Admin",
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

  it("3. Content Media upload token expires in 6 hours (21600 seconds) matching R2 STS credentials TTL", async () => {
    const beforeTime = Date.now()
    const payload = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/png",
      sizeBytes: 1024,
    })
    const afterTime = Date.now()

    const expiresAtTime = new Date(payload.expiresAt).getTime()
    const expectedExpiryMin = beforeTime + 6 * 3600 * 1000 - 2000
    const expectedExpiryMax = afterTime + 6 * 3600 * 1000 + 2000

    expect(expiresAtTime).toBeGreaterThanOrEqual(expectedExpiryMin)
    expect(expiresAtTime).toBeLessThanOrEqual(expectedExpiryMax)
  })

  it("4. Fail-closed: throws INTERNAL_ERROR when R2 credentials or env are missing", async () => {
    const brokenEnv: Env = {
      DB: testD1 as unknown as D1Database,
      ASSETS: mockR2 as unknown as R2Bucket,
    }

    await expect(
      createContentMediaUpload(db, brokenEnv, adminId, {
        mimeType: "image/png",
        sizeBytes: 1024,
      }),
    ).rejects.toThrow("Configuración o credenciales temporales R2 no disponibles.")
  })

  it("4. Fail-closed: throws INTERNAL_ERROR when Cloudflare responds with error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, errors: [{ message: "Unauthorized token" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(
      createContentMediaUpload(db, env, adminId, {
        mimeType: "image/png",
        sizeBytes: 1024,
      }),
    ).rejects.toThrow("Cloudflare API responded with status 401")
  })

  it("5. Non-allowed MIME type is rejected", async () => {
    await expect(
      createContentMediaUpload(db, env, adminId, {
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).rejects.toThrow("Unsupported MIME type 'application/pdf'")
  })

  it("6. Empty (0-byte) request is rejected", async () => {
    await expect(
      createContentMediaUpload(db, env, adminId, {
        mimeType: "image/png",
        sizeBytes: 0,
      }),
    ).rejects.toThrow("Media size must be greater than 0")
  })

  it("7. completeContentMediaUpload verifies object existence in R2 before creating D1 record", async () => {
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

  it("8. completeContentMediaUpload rejects when creator !== authenticated administrator (403 FORBIDDEN)", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/png",
      sizeBytes: 1024,
    })

    await env.ASSETS!.put(ticket.objectKey!, new Uint8Array(1024))

    // otherAdminId attempts to complete adminId's upload token
    await expect(
      completeContentMediaUpload(db, env, otherAdminId, {
        uploadToken: ticket.uploadToken,
      }),
    ).rejects.toThrow("Upload token does not belong to the authenticated administrator")

    // No record created in D1
    const d1Record = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, ticket.mediaId!))
      .get()
    expect(d1Record).toBeUndefined()
  })

  it("9. completeContentMediaUpload enforces EXACT size match: succeeds on exact match, rejects size mismatch", async () => {
    // A. Mismatch case: declared 50 MB, uploaded 45 MB -> rejected
    const ticketMismatch = await createContentMediaUpload(db, env, adminId, {
      mimeType: "video/mp4",
      sizeBytes: 50 * 1024 * 1024,
    })

    const partialContent = new Uint8Array(45 * 1024 * 1024)
    await env.ASSETS!.put(ticketMismatch.objectKey!, partialContent, {
      httpMetadata: { contentType: "video/mp4" },
    })

    await expect(
      completeContentMediaUpload(db, env, adminId, {
        uploadToken: ticketMismatch.uploadToken,
      }),
    ).rejects.toThrow("Uploaded media object size (47185920 bytes) does not match declared ticket size (52428800 bytes)")

    const mismatchD1Record = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, ticketMismatch.mediaId!))
      .get()
    expect(mismatchD1Record).toBeUndefined()

    // B. Exact match case: declared 50 MB, uploaded exactly 50 MB -> succeeds
    const ticketExact = await createContentMediaUpload(db, env, adminId, {
      mimeType: "video/mp4",
      sizeBytes: 50 * 1024 * 1024,
    })

    const exactContent = new Uint8Array(50 * 1024 * 1024)
    await env.ASSETS!.put(ticketExact.objectKey!, exactContent, {
      httpMetadata: { contentType: "video/mp4" },
    })

    const completed = await completeContentMediaUpload(db, env, adminId, {
      uploadToken: ticketExact.uploadToken,
    })

    expect(completed.id).toBe(ticketExact.mediaId)
    expect(completed.sizeBytes).toBe(50 * 1024 * 1024)
    expect(completed.mimeType).toBe("video/mp4")
    expect(completed.mediaType).toBe("VIDEO")

    const d1Record = await db
      .select()
      .from(schema.contentMedia)
      .where(eq(schema.contentMedia.id, ticketExact.mediaId!))
      .get()

    expect(d1Record).toBeDefined()
    expect(d1Record?.sizeBytes).toBe(50 * 1024 * 1024)
    expect(d1Record?.objectKey).toBe(ticketExact.objectKey)
  })

  it("10. completeContentMediaUpload rejects empty 0-byte objects in R2", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/png",
      sizeBytes: 1024,
    })

    await env.ASSETS!.put(ticket.objectKey!, new Uint8Array(0))

    await expect(
      completeContentMediaUpload(db, env, adminId, {
        uploadToken: ticket.uploadToken,
      }),
    ).rejects.toThrow("Uploaded media object is empty (0 bytes)")
  })

  it("11. Skins and capes retain their limits (1 MB skin, 5 MB cape)", () => {
    expect(MAX_SKIN_SIZE_BYTES).toBe(1 * 1024 * 1024)
    expect(MAX_CAPE_SIZE_BYTES).toBe(5 * 1024 * 1024)
  })

  it("12. Failure during completion / D1 error does NOT leave orphan ContentMedia record", async () => {
    const ticket = await createContentMediaUpload(db, env, adminId, {
      mimeType: "image/jpeg",
      sizeBytes: 4,
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
