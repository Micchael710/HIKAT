import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import * as schema from "./schema"
import { createDatabase } from "./client"
import { createTestD1 } from "./testUtils"

describe("@hikat/database schema and D1 operations", () => {
  it("exports valid schema tables", () => {
    expect(schema.users).toBeDefined()
    expect(schema.externalAccounts).toBeDefined()
    expect(schema.sessions).toBeDefined()
    expect(schema.sessionRefreshTokens).toBeDefined()
    expect(schema.passwordCredentials).toBeDefined()
    expect(schema.emailVerificationTokens).toBeDefined()
    expect(schema.passwordResetTokens).toBeDefined()
    expect(schema.oauthStates).toBeDefined()
    expect(schema.authorizationCodes).toBeDefined()
    expect(schema.rateLimits).toBeDefined()
    expect(schema.news).toBeDefined()
    expect(schema.contentMedia).toBeDefined()
    expect(schema.contentMediaUploadTokens).toBeDefined()
  })

  it("creates user with default role PLAYER", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)

    const userId = "user-123"
    const now = new Date().toISOString()

    await db.insert(schema.users).values({
      id: userId,
      displayName: "Steve",
      createdAt: now,
      updatedAt: now,
    })

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get()

    expect(user).toBeDefined()
    expect(user?.id).toBe(userId)
    expect(user?.role).toBe("PLAYER")
    expect(user?.displayName).toBe("Steve")
  })

  it("supports ADMIN role", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)

    const userId = "admin-1"
    const now = new Date().toISOString()

    await db.insert(schema.users).values({
      id: userId,
      role: "ADMIN",
      displayName: "AdminUser",
      createdAt: now,
      updatedAt: now,
    })

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get()

    expect(user?.role).toBe("ADMIN")
  })

  it("enforces database-level CHECK constraint on users.role", async () => {
    const d1 = createTestD1()
    const now = new Date().toISOString()

    // PLAYER allowed
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-player", "PLAYER", "Player 1", now, now)
    }).not.toThrow()

    // Invalid role rejected
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-admin-invalid", "SUPERUSER", "Super", now, now)
    }).toThrow()

    // ADMIN allowed
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-admin", "ADMIN", "Admin 1", now, now)
    }).not.toThrow()
  })

  it("handles News and Media tables: images, videos, YouTube, and news articles", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()
    const future = new Date(Date.now() + 900000).toISOString()

    // 1. Seed admin user
    await db.insert(schema.users).values({
      id: "admin-author",
      role: "ADMIN",
      displayName: "NewsAdmin",
      createdAt: now,
      updatedAt: now,
    })

    // 2. Upload token for video
    await db.insert(schema.contentMediaUploadTokens).values({
      id: "token-video-1",
      tokenHash: "hash-upload-video-1",
      mediaType: "VIDEO",
      createdBy: "admin-author",
      expectedMimeType: "video/mp4",
      maxSizeBytes: 26214400,
      expiresAt: future,
      createdAt: now,
    })

    // Atomic upload token consumption
    const tokenConsume = await d1
      .prepare(
        "UPDATE content_media_upload_tokens SET used_at = ? WHERE token_hash = ? AND created_by = ? AND used_at IS NULL AND expires_at > ?",
      )
      .bind(now, "hash-upload-video-1", "admin-author", now)
      .run()
    expect(tokenConsume.meta.changes).toBe(1)

    // Replay attempt must affect 0 rows
    const tokenConsumeReplay = await d1
      .prepare(
        "UPDATE content_media_upload_tokens SET used_at = ? WHERE token_hash = ? AND created_by = ? AND used_at IS NULL AND expires_at > ?",
      )
      .bind(now, "hash-upload-video-1", "admin-author", now)
      .run()
    expect(tokenConsumeReplay.meta.changes).toBe(0)

    // 3. Media records: image and video
    await db.insert(schema.contentMedia).values({
      id: "media-img-1",
      objectKey: "content/media/media-img-1.png",
      mediaType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: 102400,
      createdBy: "admin-author",
      createdAt: now,
    })

    await db.insert(schema.contentMedia).values({
      id: "media-vid-1",
      objectKey: "content/media/media-vid-1.mp4",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      sizeBytes: 5242880,
      createdBy: "admin-author",
      createdAt: now,
    })

    // 4. News record
    await db.insert(schema.news).values({
      id: "news-article-1",
      title: "Gran Actualización v1.0",
      content:
        "La gran actualización v1.0 ya está disponible para toda la comunidad.",
      type: "UPDATE",
      imageMediaId: "media-img-1",
      videoMediaId: "media-vid-1",
      youtubeVideoId: "dQw4w9WgXcQ",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      status: "PUBLISHED",
      publishedAt: now,
      createdBy: "admin-author",
      updatedBy: "admin-author",
      createdAt: now,
      updatedAt: now,
    })

    const article = await db
      .select()
      .from(schema.news)
      .where(eq(schema.news.id, "news-article-1"))
      .get()

    expect(article).toBeDefined()
    expect(article?.title).toBe("Gran Actualización v1.0")
    expect(article?.type).toBe("UPDATE")
    expect(article?.imageMediaId).toBe("media-img-1")
    expect(article?.videoMediaId).toBe("media-vid-1")
    expect(article?.youtubeVideoId).toBe("dQw4w9WgXcQ")

    // 5. Image media deletion sets image_media_id to null
    await db
      .delete(schema.contentMedia)
      .where(eq(schema.contentMedia.id, "media-img-1"))
    const articleAfterImageDelete = await db
      .select()
      .from(schema.news)
      .where(eq(schema.news.id, "news-article-1"))
      .get()

    expect(articleAfterImageDelete?.imageMediaId).toBeNull()
    expect(articleAfterImageDelete?.videoMediaId).toBe("media-vid-1")
  })

  it("migrates legacy content_posts to news table and adds media_type via 0004 migration", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    // Apply migrations 0000, 0001, 0002, 0003 manually
    const migrationsDir = join(__dirname, "../migrations")
    const sql0000 = readFileSync(
      join(migrationsDir, "0000_true_tag.sql"),
      "utf-8",
    )
    const sql0001 = readFileSync(
      join(migrationsDir, "0001_auth_tables.sql"),
      "utf-8",
    )
    const sql0002 = readFileSync(
      join(migrationsDir, "0002_auth_oauth_hardening.sql"),
      "utf-8",
    )
    const sql0003 = readFileSync(
      join(migrationsDir, "0003_content_core.sql"),
      "utf-8",
    )

    for (const sql of [sql0000, sql0001, sql0002, sql0003]) {
      for (const statement of sql.split("--> statement-breakpoint")) {
        const t = statement.trim()
        if (t) sqlite.exec(t)
      }
    }

    const now = new Date().toISOString()

    // Seed admin
    sqlite
      .prepare(
        "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("admin-mig", "ADMIN", "Mig Admin", now, now)

    // Seed media under 0003
    sqlite
      .prepare(
        "INSERT INTO content_media (id, object_key, mime_type, size_bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "mig-media-1",
        "content/media/mig-1.png",
        "image/png",
        5000,
        "admin-mig",
        now,
      )

    // Seed legacy content_post under 0003
    sqlite
      .prepare(
        "INSERT INTO content_posts (id, kind, slug, title, summary, body_markdown, cover_media_id, status, published_at, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-post-1",
        "ANNOUNCEMENT",
        "legacy-slug",
        "Legacy Announcement",
        "Legacy Summary",
        "Legacy Markdown Content",
        "mig-media-1",
        "PUBLISHED",
        now,
        "admin-mig",
        "admin-mig",
        now,
        now,
      )

    // Now apply migration 0004
    const sql0004 = readFileSync(
      join(migrationsDir, "0004_news_model_alignment.sql"),
      "utf-8",
    )
    for (const statement of sql0004.split("--> statement-breakpoint")) {
      const t = statement.trim()
      if (t) sqlite.exec(t)
    }

    // Verify media_type column added and populated
    const mediaRow = sqlite
      .prepare("SELECT * FROM content_media WHERE id = ?")
      .get("mig-media-1") as Record<string, unknown>
    expect(mediaRow.media_type).toBe("IMAGE")

    // Verify news row migrated properly from legacy content_posts
    const newsRow = sqlite
      .prepare("SELECT * FROM news WHERE id = ?")
      .get("legacy-post-1") as Record<string, unknown>
    expect(newsRow).toBeDefined()
    expect(newsRow.title).toBe("Legacy Announcement")
    expect(newsRow.content).toBe("Legacy Markdown Content")
    expect(newsRow.type).toBe("ANNOUNCEMENT")
    expect(newsRow.image_media_id).toBe("mig-media-1")
    expect(newsRow.status).toBe("PUBLISHED")

    // Verify legacy content_posts table no longer exists
    expect(() => {
      sqlite.prepare("SELECT * FROM content_posts").all()
    }).toThrow()
  })
})
