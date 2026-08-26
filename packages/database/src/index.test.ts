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

  it("enforces foreign key cascading delete on all auth tables", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)

    const now = new Date().toISOString()
    const userId = "user-cascade-test"

    await db.insert(schema.users).values({
      id: userId,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.passwordCredentials).values({
      id: "pc-1",
      userId,
      email: "steve@hikat.org",
      passwordHash: "hash-value",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.externalAccounts).values({
      id: "ea-1",
      userId,
      provider: "DISCORD",
      providerSubject: "discord-123",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.sessions).values({
      id: "sess-1",
      userId,
      createdAt: now,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })

    await db.insert(schema.sessionRefreshTokens).values({
      id: "srt-1",
      sessionId: "sess-1",
      tokenHash: "token-hash-1",
      createdAt: now,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })

    // Delete user
    await db.delete(schema.users).where(eq(schema.users.id, userId))

    // Verify cascade deleted everything
    const pc = await db
      .select()
      .from(schema.passwordCredentials)
      .where(eq(schema.passwordCredentials.userId, userId))
      .all()
    const ea = await db
      .select()
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.userId, userId))
      .all()
    const sess = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .all()
    const srt = await db
      .select()
      .from(schema.sessionRefreshTokens)
      .where(eq(schema.sessionRefreshTokens.sessionId, "sess-1"))
      .all()

    expect(pc.length).toBe(0)
    expect(ea.length).toBe(0)
    expect(sess.length).toBe(0)
    expect(srt.length).toBe(0)
  })

  it("enforces unique email on password_credentials", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    await db.insert(schema.users).values([
      { id: "u-1", createdAt: now, updatedAt: now },
      { id: "u-2", createdAt: now, updatedAt: now },
    ])

    await db.insert(schema.passwordCredentials).values({
      id: "pc-1",
      userId: "u-1",
      email: "duplicate@hikat.org",
      passwordHash: "hash-1",
      createdAt: now,
      updatedAt: now,
    })

    await expect(
      db.insert(schema.passwordCredentials).values({
        id: "pc-2",
        userId: "u-2",
        email: "duplicate@hikat.org",
        passwordHash: "hash-2",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow()
  })

  it("supports atomic conditional update on session_refresh_tokens for replay detection", async () => {
    const d1 = createTestD1()
    const now = new Date().toISOString()
    const future = new Date(Date.now() + 86400000).toISOString()

    d1._sqlite
      .prepare(
        "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("u-atomic", "PLAYER", "Atomic User", now, now)

    d1._sqlite
      .prepare(
        "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run("sess-atomic", "u-atomic", now, future)

    d1._sqlite
      .prepare(
        "INSERT INTO session_refresh_tokens (id, session_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("srt-atomic", "sess-atomic", "unique-hash-123", now, future)

    // First atomic consumption -> changes = 1
    const res1 = await d1
      .prepare(
        "UPDATE session_refresh_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(now, "srt-atomic", now)
      .run()

    expect(res1.meta.changes).toBe(1)

    // Second atomic consumption with same token (replay) -> changes = 0
    const res2 = await d1
      .prepare(
        "UPDATE session_refresh_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(now, "srt-atomic", now)
      .run()

    expect(res2.meta.changes).toBe(0)
  })

  it("handles News & Media tables: media, upload tokens, and news", async () => {
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

    // 2. Upload token with mediaType
    await db.insert(schema.contentMediaUploadTokens).values({
      id: "token-1",
      tokenHash: "hash-upload-1",
      mediaType: "IMAGE",
      createdBy: "admin-author",
      expectedMimeType: "image/png",
      maxSizeBytes: 5242880,
      expiresAt: future,
      createdAt: now,
    })

    // Atomic upload token consumption
    const tokenConsume = await d1
      .prepare(
        "UPDATE content_media_upload_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .bind(now, "hash-upload-1", now)
      .run()
    expect(tokenConsume.meta.changes).toBe(1)

    // Replay attempt must affect 0 rows
    const tokenConsumeReplay = await d1
      .prepare(
        "UPDATE content_media_upload_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .bind(now, "hash-upload-1", now)
      .run()
    expect(tokenConsumeReplay.meta.changes).toBe(0)

    // 3. Media record (image & video)
    await db.insert(schema.contentMedia).values([
      {
        id: "media-img-1",
        objectKey: "content/media/media-1.png",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 102400,
        createdBy: "admin-author",
        createdAt: now,
      },
      {
        id: "media-vid-1",
        objectKey: "content/media/media-1.mp4",
        mediaType: "VIDEO",
        mimeType: "video/mp4",
        sizeBytes: 10485760,
        createdBy: "admin-author",
        createdAt: now,
      },
    ])

    // 4. News article
    await db.insert(schema.news).values({
      id: "news-1",
      title: "Bienvenidos a HiKAT",
      content: "Este es el texto completo de bienvenida a la plataforma.",
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
      .where(eq(schema.news.id, "news-1"))
      .get()

    expect(article).toBeDefined()
    expect(article?.title).toBe("Bienvenidos a HiKAT")
    expect(article?.content).toBe(
      "Este es el texto completo de bienvenida a la plataforma.",
    )
    expect(article?.type).toBe("UPDATE")
    expect(article?.imageMediaId).toBe("media-img-1")
    expect(article?.videoMediaId).toBe("media-vid-1")
    expect(article?.youtubeVideoId).toBe("dQw4w9WgXcQ")

    // 5. Image media deletion sets news.imageMediaId to null (ON DELETE SET NULL)
    await db
      .delete(schema.contentMedia)
      .where(eq(schema.contentMedia.id, "media-img-1"))
    const articleAfterImageDelete = await db
      .select()
      .from(schema.news)
      .where(eq(schema.news.id, "news-1"))
      .get()

    expect(articleAfterImageDelete?.imageMediaId).toBeNull()
    expect(articleAfterImageDelete?.videoMediaId).toBe("media-vid-1")
  })

  it("enforces check constraints on news.type, news.status, and content_media.media_type", async () => {
    const d1 = createTestD1()
    const now = new Date().toISOString()

    d1._sqlite
      .prepare(
        "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("admin-check", "ADMIN", "Admin Check", now, now)

    // Allowed news types: NEWS, UPDATE, ANNOUNCEMENT, MAINTENANCE
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO news (id, title, content, type, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "n-valid-1",
          "Titulo",
          "Contenido",
          "MAINTENANCE",
          "DRAFT",
          "admin-check",
          "admin-check",
          now,
          now,
        )
    }).not.toThrow()

    // Invalid news type rejected
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO news (id, title, content, type, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "n-invalid-type",
          "Titulo",
          "Contenido",
          "INVALID_TYPE",
          "DRAFT",
          "admin-check",
          "admin-check",
          now,
          now,
        )
    }).toThrow()

    // Invalid news status rejected
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO news (id, title, content, type, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "n-invalid-status",
          "Titulo",
          "Contenido",
          "NEWS",
          "ARCHIVED",
          "admin-check",
          "admin-check",
          now,
          now,
        )
    }).toThrow()

    // Allowed media types: IMAGE, VIDEO
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO content_media (id, object_key, media_type, mime_type, size_bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "m-valid-vid",
          "content/media/vid.mp4",
          "VIDEO",
          "video/mp4",
          5000,
          "admin-check",
          now,
        )
    }).not.toThrow()

    // Invalid media type rejected
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO content_media (id, object_key, media_type, mime_type, size_bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "m-invalid-type",
          "content/media/audio.mp3",
          "AUDIO",
          "audio/mp3",
          5000,
          "admin-check",
          now,
        )
    }).toThrow()
  })

  it("applies migration sequence 0000 -> 0004 on a clean database inside transaction with foreign_keys ON", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()

    expect(sqlFiles).toEqual([
      "0000_true_tag.sql",
      "0001_auth_tables.sql",
      "0002_auth_oauth_hardening.sql",
      "0003_content_core.sql",
      "0004_news_model_alignment.sql",
    ])

    // Apply all migrations wrapped in transaction per D1 standard
    for (const file of sqlFiles) {
      sqlite.exec("BEGIN TRANSACTION;")
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      for (const statement of sqlContent.split("--> statement-breakpoint")) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
      sqlite.exec("COMMIT;")
    }

    // Verify foreign key integrity
    const fkErrors = sqlite.prepare("PRAGMA foreign_key_check;").all()
    expect(fkErrors).toEqual([])

    // Verify expected tables exist
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      )
      .all()
      .map((r: any) => r.name)

    expect(tables).toContain("users")
    expect(tables).toContain("password_credentials")
    expect(tables).toContain("external_accounts")
    expect(tables).toContain("sessions")
    expect(tables).toContain("session_refresh_tokens")
    expect(tables).toContain("news")
    expect(tables).toContain("content_media")
    expect(tables).toContain("content_media_upload_tokens")
    expect(tables).not.toContain("content_posts")
    expect(tables).not.toContain("_news_legacy_stage")
  })

  it("migrates existing 0003 database data to 0004 with 100% data preservation and foreign key integrity", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    // 1. Apply migrations 0000, 0001, 0002, 0003
    const migrationsDir = join(__dirname, "../migrations")
    for (const f of [
      "0000_true_tag.sql",
      "0001_auth_tables.sql",
      "0002_auth_oauth_hardening.sql",
      "0003_content_core.sql",
    ]) {
      sqlite.exec("BEGIN TRANSACTION;")
      const sql = readFileSync(join(migrationsDir, f), "utf-8")
      for (const statement of sql.split("--> statement-breakpoint")) {
        const t = statement.trim()
        if (t) sqlite.exec(t)
      }
      sqlite.exec("COMMIT;")
    }

    const now = new Date().toISOString()
    const future = new Date(Date.now() + 86400000).toISOString()

    // 2. Seed realistic pre-existing data under 0003
    sqlite
      .prepare(
        "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("admin-mig", "ADMIN", "Mig Admin", now, now)

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

    sqlite
      .prepare(
        "INSERT INTO content_media_upload_tokens (id, token_hash, created_by, expected_mime_type, max_size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "tok-1",
        "hash-tok-1",
        "admin-mig",
        "image/png",
        5000,
        future,
        now,
      )

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

    // 3. Apply migration 0004 in a transaction (matches Cloudflare D1 migrations apply)
    sqlite.exec("BEGIN TRANSACTION;")
    const sql0004 = readFileSync(
      join(migrationsDir, "0004_news_model_alignment.sql"),
      "utf-8",
    )
    for (const statement of sql0004.split("--> statement-breakpoint")) {
      const t = statement.trim()
      if (t) sqlite.exec(t)
    }
    sqlite.exec("COMMIT;")

    // 4. Verify media_type column added and populated as IMAGE
    const mediaRow = sqlite
      .prepare("SELECT * FROM content_media WHERE id = ?")
      .get("mig-media-1") as Record<string, unknown>
    expect(mediaRow).toBeDefined()
    expect(mediaRow.media_type).toBe("IMAGE")
    expect(mediaRow.object_key).toBe("content/media/mig-1.png")

    // 5. Verify upload token media_type added and populated as IMAGE
    const tokenRow = sqlite
      .prepare("SELECT * FROM content_media_upload_tokens WHERE id = ?")
      .get("tok-1") as Record<string, unknown>
    expect(tokenRow).toBeDefined()
    expect(tokenRow.media_type).toBe("IMAGE")

    // 6. Verify news row migrated properly from legacy content_posts WITH cover_media_id preserved
    const newsRow = sqlite
      .prepare("SELECT * FROM news WHERE id = ?")
      .get("legacy-post-1") as Record<string, unknown>
    expect(newsRow).toBeDefined()
    expect(newsRow.title).toBe("Legacy Announcement")
    expect(newsRow.content).toBe("Legacy Markdown Content")
    expect(newsRow.type).toBe("ANNOUNCEMENT")
    expect(newsRow.image_media_id).toBe("mig-media-1") // Crucial: NOT nullified!
    expect(newsRow.status).toBe("PUBLISHED")
    expect(newsRow.published_at).toBe(now)
    expect(newsRow.created_by).toBe("admin-mig")
    expect(newsRow.updated_by).toBe("admin-mig")

    // 7. Verify legacy content_posts table no longer exists
    expect(() => {
      sqlite.prepare("SELECT * FROM content_posts").all()
    }).toThrow()

    // 8. Verify foreign key integrity with 0 errors
    const fkErrors = sqlite.prepare("PRAGMA foreign_key_check;").all()
    expect(fkErrors).toEqual([])
  })
})
