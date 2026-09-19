import { describe, it, expect, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { createTestR2Bucket } from "../testUtils/mockR2"
import {
  requestLauncherReleaseUploadTicket,
  completeLauncherReleaseUpload,
  publishLauncherRelease,
  deleteLauncherRelease,
  getPublishedLauncherRelease,
  getLauncherReleases,
} from "./launcherReleaseService"
import {
  handleLatestYaml,
  handleLauncherBinaryDownload,
} from "./launcherUpdateTransport"
import type { Env } from "../types"

describe("HiKAT Launcher Auto-Update & Release Management Suite", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let mockR2: ReturnType<typeof createTestR2Bucket>
  let env: Env
  const adminId = "admin-launcher-" + crypto.randomUUID()
  const playerId = "player-regular-" + crypto.randomUUID()

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

    await db.insert(schema.users).values({
      id: adminId,
      displayName: "Admin User",
      role: "ADMIN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await db.insert(schema.users).values({
      id: playerId,
      displayName: "Player User",
      role: "PLAYER",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  describe("1. Upload Ticket & Validation", () => {
    it("rejects invalid SemVer versions", async () => {
      await expect(
        requestLauncherReleaseUploadTicket(db, env, {
          version: "not-a-semver",
          filename: "HiKAT Launcher Setup 1.0.0.exe",
          declaredSizeBytes: 1024,
          sha512: "dummy-sha512-at-least-32-chars-long-hash",
          adminUserId: adminId,
        }),
      ).rejects.toThrow("Formato de versión SemVer inválido")
    })

    it("rejects non-exe filenames", async () => {
      await expect(
        requestLauncherReleaseUploadTicket(db, env, {
          version: "1.0.0",
          filename: "malicious.bat",
          declaredSizeBytes: 1024,
          sha512: "dummy-sha512-at-least-32-chars-long-hash",
          adminUserId: adminId,
        }),
      ).rejects.toThrow("El nombre de archivo debe ser un instalador ejecutable válido (.exe)")
    })

    it("creates ticket with scoped credentials and valid objectKey", async () => {
      const result = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.1",
        filename: "HiKAT Launcher Setup 1.0.1.exe",
        declaredSizeBytes: 50 * 1024 * 1024,
        sha512: "OGJkNDk5NDdhMDY5ZGU4MzJmNzEwNDk4ZTVlYmQzYzU1ZDY0...",
        adminUserId: adminId,
      })

      expect(result.ticketId).toBeDefined()
      expect(result.objectKey).toBe("launcher/releases/1.0.1/HiKAT Launcher Setup 1.0.1.exe")
      expect(result.bucketName).toBe("hikat-r2")
      expect(result.credentials.accessKeyId).toBe("r2-parent-key-id")
      expect(result.credentials.sessionToken).toBeDefined()
    })
  })

  describe("2. Completion & Head Verification", () => {
    it("completes release upload after binary is written to R2", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.0",
        filename: "HiKAT Launcher Setup 1.0.0.exe",
        declaredSizeBytes: 100,
        sha512: "valid-sha512-with-more-than-32-chars-length",
        adminUserId: adminId,
      })

      // Simulate client uploading binary directly to R2 using scoped credentials
      const dummyBinary = new Uint8Array(100).fill(42)
      await mockR2.put(ticket.objectKey, dummyBinary)

      const release = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        notes: "Initial release notes",
        adminUserId: adminId,
      })
      expect(release.id).toBeDefined()
      expect(release.version).toBe("1.0.0")
      expect(release.status).toBe("DRAFT")
      expect(release.sizeBytes).toBe(100)
      expect(release.notes).toBe("Initial release notes")
    })

    it("rejects completion if binary is missing from R2", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.2",
        filename: "HiKAT Launcher Setup 1.0.2.exe",
        declaredSizeBytes: 500,
        sha512: "valid-sha512-with-more-than-32-chars-length",
        adminUserId: adminId,
      })

      await expect(
        completeLauncherReleaseUpload(db, env, {
          uploadToken: ticket.uploadToken,
          adminUserId: adminId,
        }),
      ).rejects.toThrow("No se encontró el archivo del instalador en el almacenamiento R2")
    })
  })

  describe("3. Publishing & Single Active Release Invariant", () => {
    it("publishing a release archives any existing published release", async () => {
      // 1. Upload release 1.0.0
      const ticket1 = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.0",
        filename: "HiKAT Launcher Setup 1.0.0.exe",
        declaredSizeBytes: 100,
        sha512: "sha512-release-1.0.0-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket1.objectKey, new Uint8Array(100))
      const r1 = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket1.uploadToken,
        adminUserId: adminId,
      })

      // Publish 1.0.0
      const pub1 = await publishLauncherRelease(db, r1.id)
      expect(pub1.status).toBe("PUBLISHED")
      expect(pub1.publishedAt).toBeDefined()

      // 2. Upload release 1.1.0
      const ticket2 = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.1.0",
        filename: "HiKAT Launcher Setup 1.1.0.exe",
        declaredSizeBytes: 200,
        sha512: "sha512-release-1.1.0-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket2.objectKey, new Uint8Array(200))
      const r2 = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket2.uploadToken,
        adminUserId: adminId,
      })

      // Publish 1.1.0
      const pub2 = await publishLauncherRelease(db, r2.id)
      expect(pub2.status).toBe("PUBLISHED")

      // Verify that 1.0.0 was automatically ARCHIVED
      const releases = await getLauncherReleases(db)
      const oldRelease = releases.find((r) => r.id === r1.id)
      const newRelease = releases.find((r) => r.id === r2.id)

      expect(oldRelease?.status).toBe("ARCHIVED")
      expect(newRelease?.status).toBe("PUBLISHED")

      // Check getPublishedLauncherRelease
      const currentPublished = await getPublishedLauncherRelease(db)
      expect(currentPublished?.id).toBe(r2.id)
      expect(currentPublished?.version).toBe("1.1.0")
    })

    it("rejects publishing an older or equal version when a newer version is already published", async () => {
      // 1. Publish 1.0.3
      const ticket1 = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.3",
        filename: "HiKAT Launcher Setup 1.0.3.exe",
        declaredSizeBytes: 100,
        sha512: "sha512-release-1.0.3-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket1.objectKey, new Uint8Array(100))
      const r1 = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket1.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, r1.id)

      // 2. Upload draft 1.0.2
      const ticket2 = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.2",
        filename: "HiKAT Launcher Setup 1.0.2.exe",
        declaredSizeBytes: 100,
        sha512: "sha512-release-1.0.2-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket2.objectKey, new Uint8Array(100))
      const r2 = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket2.uploadToken,
        adminUserId: adminId,
      })

      // 3. Attempting to publish 1.0.2 must fail
      await expect(publishLauncherRelease(db, r2.id)).rejects.toThrow(
        "No se puede publicar la versión 1.0.2 porque no es superior a la versión actualmente activa (1.0.3)",
      )
    })
  })

  describe("4. HTTP Update Transport (electron-updater compatibility)", () => {
    it("serves 404 for latest.yml when no release is published", async () => {
      const res = await handleLatestYaml(
        new Request("https://api.hikat.org/launcher/update/latest.yml"),
        env,
        db,
      )
      expect(res.status).toBe(404)
    })

    it("serves valid latest.yml format conforming to electron-updater", async () => {
      // Setup published release
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.5",
        filename: "HiKAT Launcher Setup 1.0.5.exe",
        declaredSizeBytes: 135116992,
        sha512: "OGJkNDk5NDdhMDY5ZGU4MzJmNzEwNDk4ZTVlYmQzYzU1ZDY0...",
        adminUserId: adminId,
      })
      await mockR2.put(ticket.objectKey, new Uint8Array(135116992))
      const r = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, r.id)

      const res = await handleLatestYaml(
        new Request("https://api.hikat.org/launcher/update/latest.yml"),
        env,
        db,
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toContain("text/yaml")
      expect(res.headers.get("Cache-Control")).toContain("no-cache")

      const text = await res.text()
      expect(text).toContain("version: 1.0.5")
      expect(text).toContain("url: download/HiKAT%20Launcher%20Setup%201.0.5.exe")
      expect(text).toContain("sha512: OGJkNDk5NDdhMDY5ZGU4MzJmNzEwNDk4ZTVlYmQzYzU1ZDY0...")
      expect(text).toContain("size: 135116992")
      expect(text).toContain("path: HiKAT Launcher Setup 1.0.5.exe")
    })

    it("rejects invalid path traversal attempts with 403 Forbidden", async () => {
      const res = await handleLauncherBinaryDownload(
        new Request("https://api.hikat.org/launcher/update/download/..%2F..%2Fsecret.exe"),
        env,
        db,
        "..%2F..%2Fsecret.exe",
      )
      expect(res.status).toBe(403)
    })

    it("rejects downloading DRAFT release (must be PUBLISHED or ARCHIVED)", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "2.0.0",
        filename: "HiKAT Launcher Setup 2.0.0.exe",
        declaredSizeBytes: 100,
        sha512: "sha512-draft-release-at-least-32-chars-long",
        adminUserId: adminId,
      })
      await mockR2.put(ticket.objectKey, new Uint8Array(100))
      await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        adminUserId: adminId,
      })

      // In DRAFT status
      const res = await handleLauncherBinaryDownload(
        new Request("https://api.hikat.org/launcher/update/download/HiKAT%20Launcher%20Setup%202.0.0.exe"),
        env,
        db,
        "HiKAT%20Launcher%20Setup%202.0.0.exe",
      )
      expect(res.status).toBe(404)
    })

    it("serves published binary with 200 OK and correct headers", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.0",
        filename: "HiKAT Launcher Setup 1.0.0.exe",
        declaredSizeBytes: 5,
        sha512: "sha512-100-at-least-32-chars-long-binary",
        adminUserId: adminId,
      })
      const binaryData = new Uint8Array([1, 2, 3, 4, 5])
      await mockR2.put(ticket.objectKey, binaryData)
      const r = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, r.id)

      const res = await handleLauncherBinaryDownload(
        new Request("https://api.hikat.org/launcher/update/download/HiKAT%20Launcher%20Setup%201.0.0.exe"),
        env,
        db,
        "HiKAT Launcher Setup 1.0.0.exe",
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream")
      expect(res.headers.get("Content-Length")).toBe("5")
      expect(res.headers.get("Accept-Ranges")).toBe("bytes")
      const buffer = await res.arrayBuffer()
      expect(new Uint8Array(buffer)).toEqual(binaryData)
    })

    it("serves partial content with 206 on HTTP Range header", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.0.0",
        filename: "HiKAT Launcher Setup 1.0.0.exe",
        declaredSizeBytes: 10,
        sha512: "sha512-100-at-least-32-chars-long-range",
        adminUserId: adminId,
      })
      const binaryData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      await mockR2.put(ticket.objectKey, binaryData)
      const r = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, r.id)

      const req = new Request(
        "https://api.hikat.org/launcher/update/download/HiKAT%20Launcher%20Setup%201.0.0.exe",
        { headers: { Range: "bytes=2-5" } },
      )
      const res = await handleLauncherBinaryDownload(req, env, db, "HiKAT Launcher Setup 1.0.0.exe")
      expect(res.status).toBe(206)
      expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10")
      expect(res.headers.get("Content-Length")).toBe("4")
    })
  })

  describe("5. Launcher Release Deletion", () => {
    it("deletes a DRAFT release from both R2 storage and D1 database", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.2.0-beta.1",
        filename: "HiKAT Launcher Setup 1.2.0-beta.1.exe",
        declaredSizeBytes: 150,
        sha512: "sha512-release-beta-with-more-than-32-chars-long",
        adminUserId: adminId,
      })
      await mockR2.put(ticket.objectKey, new Uint8Array(150))
      const release = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        adminUserId: adminId,
      })

      expect(await mockR2.get(ticket.objectKey)).not.toBeNull()
      const listBefore = await getLauncherReleases(db)
      expect(listBefore.some((r) => r.id === release.id)).toBe(true)

      const deleted = await deleteLauncherRelease(db, env, release.id)
      expect(deleted).toBe(true)

      // Verify removed from R2
      expect(await mockR2.get(ticket.objectKey)).toBeNull()

      // Verify removed from D1
      const listAfter = await getLauncherReleases(db)
      expect(listAfter.some((r) => r.id === release.id)).toBe(false)
    })

    it("rejects deleting a PUBLISHED release", async () => {
      const ticket = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.3.0",
        filename: "HiKAT Launcher Setup 1.3.0.exe",
        declaredSizeBytes: 200,
        sha512: "sha512-release-1.3.0-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket.objectKey, new Uint8Array(200))
      const release = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, release.id)

      await expect(deleteLauncherRelease(db, env, release.id)).rejects.toThrow(
        "No se puede eliminar la versión actualmente publicada",
      )
    })

    it("deletes an ARCHIVED release from both R2 storage and D1 database", async () => {
      // 1. Publish 1.4.0
      const ticket1 = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.4.0",
        filename: "HiKAT Launcher Setup 1.4.0.exe",
        declaredSizeBytes: 100,
        sha512: "sha512-release-1.4.0-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket1.objectKey, new Uint8Array(100))
      const r1 = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket1.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, r1.id)

      // 2. Publish 1.5.0, which archives 1.4.0
      const ticket2 = await requestLauncherReleaseUploadTicket(db, env, {
        version: "1.5.0",
        filename: "HiKAT Launcher Setup 1.5.0.exe",
        declaredSizeBytes: 100,
        sha512: "sha512-release-1.5.0-with-more-than-32-chars",
        adminUserId: adminId,
      })
      await mockR2.put(ticket2.objectKey, new Uint8Array(100))
      const r2 = await completeLauncherReleaseUpload(db, env, {
        uploadToken: ticket2.uploadToken,
        adminUserId: adminId,
      })
      await publishLauncherRelease(db, r2.id)

      // Now r1 is ARCHIVED
      const listBefore = await getLauncherReleases(db)
      const archived = listBefore.find((r) => r.id === r1.id)
      expect(archived?.status).toBe("ARCHIVED")
      expect(await mockR2.get(ticket1.objectKey)).not.toBeNull()

      // Deleting r1 must succeed
      const deleted = await deleteLauncherRelease(db, env, r1.id)
      expect(deleted).toBe(true)

      // Verify removed from R2 and D1
      expect(await mockR2.get(ticket1.objectKey)).toBeNull()
      const listAfter = await getLauncherReleases(db)
      expect(listAfter.some((r) => r.id === r1.id)).toBe(false)
    })
  })
})
