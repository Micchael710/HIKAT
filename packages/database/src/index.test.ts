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

    expect(schema.skins).toBeDefined()

    expect(schema.playerSkins).toBeDefined()

    expect(schema.playerSkinSelections).toBeDefined()

    expect(schema.capes).toBeDefined()

    expect(schema.playerCapes).toBeDefined()

    expect(schema.playerCapeSelections).toBeDefined()
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

      "0005_server_administration_hardening.sql",

      "0006_backoffice_core.sql",

      "0007_backoffice_core_hardening.sql",

      "0008_player_skins.sql",
      "0009_server_operation_locks.sql",
      "0010_skins_active_and_server_tasks.sql",
      "0011_server_tasks_action.sql",
      "0012_remove_skin_model_and_add_capes.sql",
      "0013_game_files_enhancements.sql",
      "0014_mod_providers_metadata.sql",
      "0015_content_providers_expansion.sql",
      "0016_game_release_cover_media.sql",
      "0017_server_managed_content.sql",
      "0018_operation_lock_lease.sql",
      "0019_release_activation_and_deployment_order.sql",
      "0020_game_file_upload_tokens_categories.sql",
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

    expect(tables).toContain("skins")

    expect(tables).toContain("player_skins")

    expect(tables).toContain("game_releases")

    expect(tables).toContain("game_release_files")

    expect(tables).toContain("game_file_upload_tokens")

    expect(tables).toContain("project_settings")

    expect(tables).toContain("server_managed_content")

    expect(tables).toContain("server_release_syncs")

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

  it("handles Server Administration tables: console tickets, power locks, and command rate limits", async () => {
    const d1 = createTestD1()

    const db = createDatabase(d1)

    // 1. Create admin user and session

    await db.insert(schema.users).values({
      id: "admin-srv-1",

      role: "ADMIN",

      displayName: "AdminServer",
    })

    await db.insert(schema.sessions).values({
      id: "session-srv-1",

      userId: "admin-srv-1",

      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    })

    // 2. Insert console ticket

    await db.insert(schema.serverConsoleTickets).values({
      id: "cstk_test_123",

      userId: "admin-srv-1",

      sessionId: "session-srv-1",

      expiresAt: new Date(Date.now() + 45000).toISOString(),
    })

    const ticket = await db

      .select()

      .from(schema.serverConsoleTickets)

      .where(eq(schema.serverConsoleTickets.id, "cstk_test_123"))

      .get()

    expect(ticket).toBeDefined()

    expect(ticket?.userId).toBe("admin-srv-1")

    expect(ticket?.sessionId).toBe("session-srv-1")

    expect(ticket?.usedAt).toBeNull()

    // 3. Acquire and release power lock

    await db.insert(schema.serverPowerLocks).values({
      lockKey: "main_server_power",

      action: "START",

      acquiredByUserId: "admin-srv-1",

      expiresAt: new Date(Date.now() + 30000).toISOString(),
    })

    const lock = await db

      .select()

      .from(schema.serverPowerLocks)

      .where(eq(schema.serverPowerLocks.lockKey, "main_server_power"))

      .get()

    expect(lock).toBeDefined()

    expect(lock?.action).toBe("START")

    expect(lock?.acquiredByUserId).toBe("admin-srv-1")

    // 4. Test command rate limit tracking

    await db.insert(schema.serverCommandRateLimits).values({
      key: "cmd_rl:admin-srv-1",

      count: 3,

      windowStart: new Date().toISOString(),

      resetAt: new Date(Date.now() + 10000).toISOString(),
    })

    const rl = await db

      .select()

      .from(schema.serverCommandRateLimits)

      .where(eq(schema.serverCommandRateLimits.key, "cmd_rl:admin-srv-1"))

      .get()

    expect(rl?.count).toBe(3)

    // 5. Test server operation locks (RESTORE_BACKUP, REPLACE_WORLD)
    await db.insert(schema.serverOperationLocks).values({
      lockKey: "server_restore_backup",
      operation: "RESTORE_BACKUP",
      acquiredByUserId: "admin-srv-1",
      expiresAt: new Date(Date.now() + 180000).toISOString(),
    })

    const opLock = await db
      .select()
      .from(schema.serverOperationLocks)
      .where(eq(schema.serverOperationLocks.lockKey, "server_restore_backup"))
      .get()

    expect(opLock).toBeDefined()
    expect(opLock?.operation).toBe("RESTORE_BACKUP")
    expect(opLock?.acquiredByUserId).toBe("admin-srv-1")
  })


  it("supports skins, game releases, single published unique index, and project settings", async () => {
    const d1 = createTestD1()

    const db = createDatabase(d1)

    const now = new Date().toISOString()

    // 1. Create User and Media

    await db.insert(schema.users).values({
      id: "admin-core",

      role: "ADMIN",

      displayName: "CoreAdmin",

      createdAt: now,

      updatedAt: now,
    })

    await db.insert(schema.contentMedia).values({
      id: "media-skin-1",

      objectKey: "content/skin-1.png",

      mediaType: "IMAGE",

      mimeType: "image/png",

      sizeBytes: 2048,

      createdBy: "admin-core",

      createdAt: now,
    })

    // 2. Insert Skin (No model column)
    await db.insert(schema.skins).values({
      id: "skin-1",
      name: "Alex Aventurero",
      mediaId: "media-skin-1",
      status: "AVAILABLE",
      createdBy: "admin-core",
      createdAt: now,
      updatedAt: now,
    })

    const skin = await db
      .select()
      .from(schema.skins)
      .where(eq(schema.skins.id, "skin-1"))
      .get()

    expect(skin).toBeDefined()
    expect(skin?.name).toBe("Alex Aventurero")

    // 3. Insert Game Releases
    await db.insert(schema.gameReleases).values({
      id: "rel-1",
      version: "1.4.2",
      minecraftVersion: "1.21.1",
      neoForgeVersion: "21.1.65",
      status: "PUBLISHED",
      publishedAt: now,
      createdBy: "admin-core",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.gameReleaseFiles).values({
      id: "file-1",
      releaseId: "rel-1",
      name: "JourneyMap",
      logicalPath: "mods/journeymap-1.21.1.jar",
      category: "MOD",
      sha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      sizeBytes: 1048576,
      policy: "NO_MODIFICABLE",
      objectKey: "game-files/mod-1",
      createdAt: now,
    })

    const rel = await db
      .select()
      .from(schema.gameReleases)
      .where(eq(schema.gameReleases.id, "rel-1"))
      .get()

    expect(rel?.status).toBe("PUBLISHED")

    // 4. Enforce exactly ONE PUBLISHED release at SQL level
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO game_releases (id, version, minecraft_version, neoforge_version, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "rel-2",
          "1.4.3",
          "1.21.1",
          "21.1.65",
          "PUBLISHED",
          "admin-core",
          now,
          now,
        )
    }).toThrow()

    // 5. Test Project Settings singleton
    const settings = await db
      .select()
      .from(schema.projectSettings)
      .where(eq(schema.projectSettings.id, "main"))
      .get()

    expect(settings).toBeDefined()
    expect(settings?.projectName).toBe("HiKAT")
    expect(settings?.serverIp).toBe("mc.hikat.org")

    // 6. Test Player Skins 1:1 and unique user_id constraint (No model column)
    const mediaSkin1 = "media-pskin-1"
    const mediaSkin2 = "media-pskin-2"

    await db.insert(schema.contentMedia).values({
      id: mediaSkin1,
      objectKey: "content/media/pskin-1.png",
      mediaType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: 4096,
      createdBy: "admin-core",
      createdAt: now,
    })

    await db.insert(schema.contentMedia).values({
      id: mediaSkin2,
      objectKey: "content/media/pskin-2.png",
      mediaType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: 4096,
      createdBy: "admin-core",
      createdAt: now,
    })

    // Insert first skin for user
    await db.insert(schema.playerSkins).values({
      id: "pskin-1",
      userId: "admin-core",
      mediaId: mediaSkin1,
      createdAt: now,
      updatedAt: now,
    })

    const pskin = await db
      .select()
      .from(schema.playerSkins)
      .where(eq(schema.playerSkins.userId, "admin-core"))
      .get()

    expect(pskin).toBeDefined()
    expect(pskin?.mediaId).toBe(mediaSkin1)

    // Attempt to insert a second skin for the same user -> MUST THROW UNIQUE CONSTRAINT ERROR
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO player_skins (id, user_id, media_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("pskin-2", "admin-core", mediaSkin2, now, now)
    }).toThrow()

    // Test upsert / update replacement
    await db
      .update(schema.playerSkins)
      .set({
        mediaId: mediaSkin2,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.playerSkins.userId, "admin-core"))

    const updatedPskin = await db
      .select()
      .from(schema.playerSkins)
      .where(eq(schema.playerSkins.userId, "admin-core"))
      .get()

    expect(updatedPskin?.mediaId).toBe(mediaSkin2)

    // Test FK CASCADE: deleting user removes their player skin
    const testUserCascadeId = "user-cascade-" + crypto.randomUUID()
    await db.insert(schema.users).values({
      id: testUserCascadeId,
      displayName: "Cascade User",
      role: "PLAYER",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.playerSkins).values({
      id: "pskin-cascade",
      userId: testUserCascadeId,
      mediaId: mediaSkin1,
      createdAt: now,
      updatedAt: now,
    })

    expect(
      await db
        .select()
        .from(schema.playerSkins)
        .where(eq(schema.playerSkins.userId, testUserCascadeId))
        .get(),
    ).toBeDefined()

    await db.delete(schema.users).where(eq(schema.users.id, testUserCascadeId))

    expect(
      await db
        .select()
        .from(schema.playerSkins)
        .where(eq(schema.playerSkins.userId, testUserCascadeId))
        .get(),
    ).toBeUndefined()
  })

  it("supports playerSkinSelections and serverTasks with referential integrity", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    const userId = "user-skins-test"
    await db.insert(schema.users).values({
      id: userId,
      displayName: "Skin Test Player",
      role: "PLAYER",
      createdAt: now,
      updatedAt: now,
    })

    const mediaId = "media-skin-global-1"
    await db.insert(schema.contentMedia).values({
      id: mediaId,
      mediaType: "IMAGE",
      objectKey: "skins/global1.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      createdBy: userId,
      createdAt: now,
    })

    const globalSkinId = "skin-global-1"
    await db.insert(schema.skins).values({
      id: globalSkinId,
      name: "Global Astronaut",
      mediaId,
      status: "AVAILABLE",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    // Insert active skin selection (GLOBAL)
    await db.insert(schema.playerSkinSelections).values({
      userId,
      type: "GLOBAL",
      skinId: globalSkinId,
      updatedAt: now,
    })

    const sel = await db
      .select()
      .from(schema.playerSkinSelections)
      .where(eq(schema.playerSkinSelections.userId, userId))
      .get()
    expect(sel).toBeDefined()
    expect(sel?.type).toBe("GLOBAL")
    expect(sel?.skinId).toBe(globalSkinId)

    // Deleting the skin sets skin_id to null via ON DELETE SET NULL
    await db.delete(schema.skins).where(eq(schema.skins.id, globalSkinId))
    const selAfterDelete = await db
      .select()
      .from(schema.playerSkinSelections)
      .where(eq(schema.playerSkinSelections.userId, userId))
      .get()
    expect(selAfterDelete?.skinId).toBeNull()

    // Test serverTasks table
    const taskId = crypto.randomUUID()
    await db.insert(schema.serverTasks).values({
      id: taskId,
      scheduleId: "101",
      template: "BACKUP_AND_RESTART",
      name: "Nightly Safe Restart",
      frequency: "DAILY",
      cronMinute: "0",
      cronHour: "4",
      cronDayOfWeek: "*",
      time: "04:00",
      delaySeconds: 60,
      enabled: true,
      templateVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    const taskRec = await db
      .select()
      .from(schema.serverTasks)
      .where(eq(schema.serverTasks.scheduleId, "101"))
      .get()
    expect(taskRec).toBeDefined()
    expect(taskRec?.template).toBe("BACKUP_AND_RESTART")
    expect(taskRec?.delaySeconds).toBe(60)

    // Verify UNIQUE constraint on serverTasks.scheduleId
    await expect(
      db.insert(schema.serverTasks).values({
        id: crypto.randomUUID(),
        scheduleId: "101", // duplicate scheduleId
        template: "DAILY_BACKUP",
        name: "Duplicate Schedule",
        frequency: "DAILY",
        cronMinute: "0",
        cronHour: "4",
        cronDayOfWeek: "*",
        time: "04:00",
        enabled: true,
        templateVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow()
  })

  it("supports Capes domain: global capes, multiple player capes, active cape selections with canonical NONE", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    const adminId = "admin-capes-user"
    const playerId = "player-capes-user"
    await db.insert(schema.users).values([
      { id: adminId, displayName: "Cape Admin", role: "ADMIN", createdAt: now, updatedAt: now },
      { id: playerId, displayName: "Cape Player", role: "PLAYER", createdAt: now, updatedAt: now },
    ])

    const capeMedia1 = "media-cape-global-1"
    const capeMedia2 = "media-cape-player-1"
    const capeMedia3 = "media-cape-player-2"

    await db.insert(schema.contentMedia).values([
      { id: capeMedia1, mediaType: "IMAGE", objectKey: "capes/global1.png", mimeType: "image/png", sizeBytes: 2048, createdBy: adminId, createdAt: now },
      { id: capeMedia2, mediaType: "IMAGE", objectKey: "capes/player1.png", mimeType: "image/png", sizeBytes: 4096, createdBy: playerId, createdAt: now },
      { id: capeMedia3, mediaType: "IMAGE", objectKey: "capes/player2.png", mimeType: "image/png", sizeBytes: 8192, createdBy: playerId, createdAt: now },
    ])

    // 1. Global Cape
    const globalCapeId = "cape-global-1"
    await db.insert(schema.capes).values({
      id: globalCapeId,
      name: "Founder Cape",
      mediaId: capeMedia1,
      status: "AVAILABLE",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    })

    const globalCape = await db.select().from(schema.capes).where(eq(schema.capes.id, globalCapeId)).get()
    expect(globalCape).toBeDefined()
    expect(globalCape?.name).toBe("Founder Cape")

    // 2. Multiple Player Custom Capes for same player
    const playerCape1Id = "pcape-1"
    const playerCape2Id = "pcape-2"
    await db.insert(schema.playerCapes).values([
      { id: playerCape1Id, userId: playerId, name: "Fire Cape", mediaId: capeMedia2, createdAt: now, updatedAt: now },
      { id: playerCape2Id, userId: playerId, name: "Ice Cape", mediaId: capeMedia3, createdAt: now, updatedAt: now },
    ])

    const pCapes = await db.select().from(schema.playerCapes).where(eq(schema.playerCapes.userId, playerId)).all()
    expect(pCapes.length).toBe(2)

    // 3. Active Cape Selection: NONE (canonical "Sin capa")
    await db.insert(schema.playerCapeSelections).values({
      userId: playerId,
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      updatedAt: now,
    })

    let activeCapeSel = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(activeCapeSel?.type).toBe("NONE")
    expect(activeCapeSel?.capeId).toBeNull()
    expect(activeCapeSel?.playerCapeId).toBeNull()

    // 4. Update Active Cape Selection to CUSTOM
    await db.update(schema.playerCapeSelections).set({
      type: "CUSTOM",
      capeId: null,
      playerCapeId: playerCape1Id,
      updatedAt: now,
    }).where(eq(schema.playerCapeSelections.userId, playerId))

    activeCapeSel = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(activeCapeSel?.type).toBe("CUSTOM")
    expect(activeCapeSel?.playerCapeId).toBe(playerCape1Id)

    // 5. Update Active Cape Selection to GLOBAL
    await db.update(schema.playerCapeSelections).set({
      type: "GLOBAL",
      capeId: globalCapeId,
      playerCapeId: null,
      updatedAt: now,
    }).where(eq(schema.playerCapeSelections.userId, playerId))

    activeCapeSel = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(activeCapeSel?.type).toBe("GLOBAL")
    expect(activeCapeSel?.capeId).toBe(globalCapeId)
  })

  it("enforces CHECK constraint on player_cape_selections rejecting invalid combinations directly in SQLite", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    const adminId = "admin-check-user"
    const playerId = "player-check-user"
    await db.insert(schema.users).values([
      { id: adminId, displayName: "Cape Admin", role: "ADMIN", createdAt: now, updatedAt: now },
      { id: playerId, displayName: "Cape Player", role: "PLAYER", createdAt: now, updatedAt: now },
    ])

    const capeMedia1 = "media-check-1"
    const capeMedia2 = "media-check-2"
    await db.insert(schema.contentMedia).values([
      { id: capeMedia1, mediaType: "IMAGE", objectKey: "capes/chk1.png", mimeType: "image/png", sizeBytes: 2048, createdBy: adminId, createdAt: now },
      { id: capeMedia2, mediaType: "IMAGE", objectKey: "capes/chk2.png", mimeType: "image/png", sizeBytes: 4096, createdBy: playerId, createdAt: now },
    ])

    const globalCapeId = "cape-check-global"
    await db.insert(schema.capes).values({
      id: globalCapeId,
      name: "Global Cape",
      mediaId: capeMedia1,
      status: "AVAILABLE",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    })

    const playerCapeId = "pcape-check-custom"
    await db.insert(schema.playerCapes).values({
      id: playerCapeId,
      userId: playerId,
      name: "Custom Cape",
      mediaId: capeMedia2,
      createdAt: now,
      updatedAt: now,
    })

    // 1. Invalid: NONE with cape_id != null
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "NONE",
        capeId: globalCapeId,
        playerCapeId: null,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 2. Invalid: NONE with player_cape_id != null
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "NONE",
        capeId: null,
        playerCapeId: playerCapeId,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 3. Invalid: GLOBAL with cape_id == null
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "GLOBAL",
        capeId: null,
        playerCapeId: null,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 4. Invalid: GLOBAL with player_cape_id != null
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "GLOBAL",
        capeId: globalCapeId,
        playerCapeId: playerCapeId,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 5. Invalid: CUSTOM with player_cape_id == null
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "CUSTOM",
        capeId: null,
        playerCapeId: null,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 6. Invalid: CUSTOM with cape_id != null
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "CUSTOM",
        capeId: globalCapeId,
        playerCapeId: playerCapeId,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 7. Invalid: Unknown type
    await expect(
      db.insert(schema.playerCapeSelections).values({
        userId: playerId,
        type: "INVALID",
        capeId: null,
        playerCapeId: null,
        updatedAt: now,
      }),
    ).rejects.toThrow()
  })

  it("cascades player_cape_selections when a selected global cape is deleted directly in DB without leaving invalid rows or violating CHECK constraints", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    const adminId = "admin-del-cape-user"
    const playerId = "player-del-cape-user"
    await db.insert(schema.users).values([
      { id: adminId, displayName: "Admin", role: "ADMIN", createdAt: now, updatedAt: now },
      { id: playerId, displayName: "Player", role: "PLAYER", createdAt: now, updatedAt: now },
    ])

    const capeMedia1 = "media-del-cape-1"
    await db.insert(schema.contentMedia).values({
      id: capeMedia1,
      mediaType: "IMAGE",
      objectKey: "capes/del1.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      createdBy: adminId,
      createdAt: now,
    })

    const globalCapeId = "cape-to-delete"
    await db.insert(schema.capes).values({
      id: globalCapeId,
      name: "Cape To Delete",
      mediaId: capeMedia1,
      status: "AVAILABLE",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    })

    // Player selects the global cape
    await db.insert(schema.playerCapeSelections).values({
      userId: playerId,
      type: "GLOBAL",
      capeId: globalCapeId,
      playerCapeId: null,
      updatedAt: now,
    })

    const selBefore = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(selBefore?.type).toBe("GLOBAL")
    expect(selBefore?.capeId).toBe(globalCapeId)

    // Delete global cape directly from DB
    await db.delete(schema.capes).where(eq(schema.capes.id, globalCapeId))

    // Row in player_cape_selections was cleanly cascaded rather than set to an invalid GLOBAL with null cape_id state
    const selAfter = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(selAfter).toBeUndefined()
  })

  it("cascades player_cape_selections when a selected player custom cape is deleted directly in DB without leaving invalid rows or violating CHECK constraints", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    const adminId = "admin-del-pcape-user"
    const playerId = "player-del-pcape-user"
    await db.insert(schema.users).values([
      { id: adminId, displayName: "Admin", role: "ADMIN", createdAt: now, updatedAt: now },
      { id: playerId, displayName: "Player", role: "PLAYER", createdAt: now, updatedAt: now },
    ])

    const capeMedia1 = "media-del-pcape-1"
    await db.insert(schema.contentMedia).values({
      id: capeMedia1,
      mediaType: "IMAGE",
      objectKey: "capes/del2.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      createdBy: playerId,
      createdAt: now,
    })

    const playerCapeId = "pcape-to-delete"
    await db.insert(schema.playerCapes).values({
      id: playerCapeId,
      userId: playerId,
      name: "Custom Cape To Delete",
      mediaId: capeMedia1,
      createdAt: now,
      updatedAt: now,
    })

    // Player selects the custom cape
    await db.insert(schema.playerCapeSelections).values({
      userId: playerId,
      type: "CUSTOM",
      capeId: null,
      playerCapeId: playerCapeId,
      updatedAt: now,
    })

    const selBefore = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(selBefore?.type).toBe("CUSTOM")
    expect(selBefore?.playerCapeId).toBe(playerCapeId)

    // Delete custom cape directly from DB
    await db.delete(schema.playerCapes).where(eq(schema.playerCapes.id, playerCapeId))

    // Row in player_cape_selections was cleanly cascaded rather than set to an invalid CUSTOM with null player_cape_id state
    const selAfter = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(selAfter).toBeUndefined()
  })

  it("cascades player_cape_selections when a user is deleted", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()

    const playerId = "player-to-delete-user"
    await db.insert(schema.users).values({
      id: playerId,
      displayName: "Player To Delete",
      role: "PLAYER",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.playerCapeSelections).values({
      userId: playerId,
      type: "NONE",
      capeId: null,
      playerCapeId: null,
      updatedAt: now,
    })

    // Delete user
    await db.delete(schema.users).where(eq(schema.users.id, playerId))

    const selAfter = await db.select().from(schema.playerCapeSelections).where(eq(schema.playerCapeSelections.userId, playerId)).get()
    expect(selAfter).toBeUndefined()
  })

  it("performs real D1-safe upgrade from migration 0011 to 0012 without PRAGMA foreign_keys = OFF, preserving existing global skin selection in player_skin_selections", async () => {
    const sqlite = new DatabaseSync(":memory:")
    // Enforce foreign keys strictly throughout the entire simulation, matching Cloudflare D1 environment
    sqlite.exec("PRAGMA foreign_keys = ON;")

    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()

    // 1. Apply migrations up to 0011
    const upTo0011 = sqlFiles.filter((f) => !f.startsWith("0012_"))
    for (const file of upTo0011) {
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      const statements = sqlContent.split("--> statement-breakpoint")
      for (const statement of statements) {
        const trimmed = statement.trim()
        if (trimmed) {
          sqlite.exec(trimmed)
        }
      }
    }

    const now = new Date().toISOString()
    const adminId = "admin-upgrade-user"
    const playerId = "player-upgrade-user"
    const mediaId = "media-skin-upgrade"
    const skinId = "skin-global-upgrade-123"

    // 2. Create users
    sqlite.exec(`
      INSERT INTO users (id, display_name, role, created_at, updated_at)
      VALUES ('${adminId}', 'Upgrade Admin', 'ADMIN', '${now}', '${now}'),
             ('${playerId}', 'Upgrade Player', 'PLAYER', '${now}', '${now}');
    `)

    // 3. Create content media
    sqlite.exec(`
      INSERT INTO content_media (id, media_type, object_key, mime_type, size_bytes, created_by, created_at)
      VALUES ('${mediaId}', 'IMAGE', 'skins/upgrade.png', 'image/png', 2048, '${adminId}', '${now}');
    `)

    // 4. Create global skin with model (0011 schema had model)
    sqlite.exec(`
      INSERT INTO skins (id, name, model, media_id, status, created_by, created_at, updated_at)
      VALUES ('${skinId}', 'Steve Upgrade Skin', 'CLASSIC', '${mediaId}', 'AVAILABLE', '${adminId}', '${now}', '${now}');
    `)

    // 5. Player selects that global skin in player_skin_selections
    sqlite.exec(`
      INSERT INTO player_skin_selections (user_id, type, skin_id, updated_at)
      VALUES ('${playerId}', 'GLOBAL', '${skinId}', '${now}');
    `)

    // Verify state BEFORE 0012 migration
    const beforeSel = sqlite.prepare("SELECT * FROM player_skin_selections WHERE user_id = ?").get(playerId) as any
    expect(beforeSel.type).toBe("GLOBAL")
    expect(beforeSel.skin_id).toBe(skinId)

    // 6. Apply migration 0012 with PRAGMA foreign_keys = ON strictly enforced
    const file0012 = sqlFiles.find((f) => f.startsWith("0012_"))
    expect(file0012).toBeDefined()
    const sql0012 = readFileSync(join(migrationsDir, file0012!), "utf-8")
    
    // Verify migration 0012 does NOT contain PRAGMA foreign_keys = OFF
    expect(sql0012.includes("PRAGMA foreign_keys = OFF")).toBe(false)
    expect(sql0012.includes("PRAGMA foreign_keys = ON")).toBe(false)

    const statements0012 = sql0012.split("--> statement-breakpoint")
    for (const statement of statements0012) {
      const trimmed = statement.trim()
      if (trimmed) {
        sqlite.exec(trimmed)
      }
    }

    // 7. Verify state AFTER 0012 migration:
    // a) Skin still exists
    const afterSkin = sqlite.prepare("SELECT * FROM skins WHERE id = ?").get(skinId) as any
    expect(afterSkin).toBeDefined()
    expect(afterSkin.id).toBe(skinId)
    expect(afterSkin.name).toBe("Steve Upgrade Skin")
    expect(afterSkin.model).toBeUndefined() // model column was dropped!

    // b) player_skin_selections is PRESERVED and skin_id is NOT null
    const afterSel = sqlite.prepare("SELECT * FROM player_skin_selections WHERE user_id = ?").get(playerId) as any
    expect(afterSel).toBeDefined()
    expect(afterSel.type).toBe("GLOBAL")
    expect(afterSel.skin_id).toBe(skinId)

    // c) Staging backup table was cleaned up
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_skin_selections_backup'").all()
    expect(tables.length).toBe(0)

    // d) foreign keys are active
    const fkStatus = sqlite.prepare("PRAGMA foreign_keys;").get() as any
    expect(fkStatus.foreign_keys).toBe(1)
  })

  it("performs real D1-safe upgrade from migration 0012 to 0013, verifying game_release_files preservation, nullable policy, is_directory flag, cascade delete and unique constraints", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()

    // 1. Apply migrations up to 0012
    const upTo0012 = sqlFiles.filter((f) => !f.startsWith("0013_"))
    for (const file of upTo0012) {
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      const statements = sqlContent.split("--> statement-breakpoint")
      for (const statement of statements) {
        const trimmed = statement.trim()
        if (trimmed) {
          sqlite.exec(trimmed)
        }
      }
    }

    const now = new Date().toISOString()
    const adminId = "admin-game-upgrade"
    const releaseId = "release-100"
    const fileId1 = "file-mod-1"
    const fileId2 = "file-config-1"

    // 2. Create user and game release
    sqlite.exec(`
      INSERT INTO users (id, display_name, role, created_at, updated_at)
      VALUES ('${adminId}', 'Game Admin', 'ADMIN', '${now}', '${now}');
      INSERT INTO game_releases (id, version, minecraft_version, neoforge_version, status, created_by, created_at, updated_at)
      VALUES ('${releaseId}', '1.0.0', '1.21.1', '21.1.65', 'PUBLISHED', '${adminId}', '${now}', '${now}');
    `)

    // 3. Create game release files with 0012 schema (NOT NULL policies)
    sqlite.exec(`
      INSERT INTO game_release_files (id, release_id, name, logical_path, category, sha256, size_bytes, policy, object_key, created_at)
      VALUES ('${fileId1}', '${releaseId}', 'create.jar', 'mods/create.jar', 'MOD', 'sha256-create', 1048576, 'NO_MODIFICABLE', 'game-files/create', '${now}'),
             ('${fileId2}', '${releaseId}', 'config.toml', 'config/config.toml', 'MOD', 'sha256-config', 2048, 'MODIFICABLE', 'game-files/config', '${now}');
    `)

    // Verify state BEFORE 0013 migration
    const beforeFiles = sqlite.prepare("SELECT * FROM game_release_files WHERE release_id = ?").all(releaseId) as any[]
    expect(beforeFiles.length).toBe(2)

    // 4. Apply migration 0013
    const file0013 = sqlFiles.find((f) => f.startsWith("0013_"))
    expect(file0013).toBeDefined()
    const sql0013 = readFileSync(join(migrationsDir, file0013!), "utf-8")
    
    // Verify migration 0013 does NOT contain PRAGMA foreign_keys = OFF
    expect(sql0013.includes("PRAGMA foreign_keys = OFF")).toBe(false)
    expect(sql0013.includes("PRAGMA foreign_keys = ON")).toBe(false)

    const statements0013 = sql0013.split("--> statement-breakpoint")
    for (const statement of statements0013) {
      const trimmed = statement.trim()
      if (trimmed) {
        sqlite.exec(trimmed)
      }
    }

    // 5. Verify state AFTER 0013 migration:
    // a) Existing files and releases preserved
    const afterFiles = sqlite.prepare("SELECT * FROM game_release_files WHERE release_id = ? ORDER BY id ASC").all(releaseId) as any[]
    expect(afterFiles.length).toBe(2)
    
    const file1 = afterFiles.find((f) => f.id === fileId1)
    expect(file1).toBeDefined()
    expect(file1.name).toBe("create.jar")
    expect(file1.logical_path).toBe("mods/create.jar")
    expect(file1.policy).toBe("NO_MODIFICABLE")
    expect(file1.is_directory).toBe(0)

    const file2 = afterFiles.find((f) => f.id === fileId2)
    expect(file2).toBeDefined()
    expect(file2.name).toBe("config.toml")
    expect(file2.logical_path).toBe("config/config.toml")
    expect(file2.policy).toBe("MODIFICABLE")
    expect(file2.is_directory).toBe(0)

    // b) Null policy is accepted (NULL = inherit)
    const fileId3 = "file-inherit-3"
    sqlite.exec(`
      INSERT INTO game_release_files (id, release_id, name, logical_path, category, sha256, size_bytes, policy, is_directory, object_key, created_at)
      VALUES ('${fileId3}', '${releaseId}', 'child.toml', 'config/sub/child.toml', 'GENERAL', 'sha256-child', 512, NULL, 0, 'game-files/child', '${now}');
    `)
    const file3 = sqlite.prepare("SELECT * FROM game_release_files WHERE id = ?").get(fileId3) as any
    expect(file3.policy).toBeNull()
    expect(file3.is_directory).toBe(0)

    // c) Directory record with is_directory = 1, size_bytes = 0, object_key = ''
    const dirId = "dir-config-sub"
    sqlite.exec(`
      INSERT INTO game_release_files (id, release_id, name, logical_path, category, sha256, size_bytes, policy, is_directory, object_key, created_at)
      VALUES ('${dirId}', '${releaseId}', 'sub', 'config/sub', 'GENERAL', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, 'MODIFICABLE', 1, '', '${now}');
    `)
    const dirRecord = sqlite.prepare("SELECT * FROM game_release_files WHERE id = ?").get(dirId) as any
    expect(dirRecord.is_directory).toBe(1)
    expect(dirRecord.size_bytes).toBe(0)
    expect(dirRecord.object_key).toBe("")

    // d) Unique constraint on (release_id, logical_path) is enforced
    expect(() => {
      sqlite.exec(`
        INSERT INTO game_release_files (id, release_id, name, logical_path, category, sha256, size_bytes, policy, is_directory, object_key, created_at)
        VALUES ('file-dup', '${releaseId}', 'dup.jar', 'mods/create.jar', 'MOD', 'sha256-dup', 100, NULL, 0, 'game-files/dup', '${now}');
      `)
    }).toThrow()

    // e) Foreign key cascade delete is enforced
    sqlite.exec(`DELETE FROM game_releases WHERE id = '${releaseId}';`)
    const orphanedFiles = sqlite.prepare("SELECT * FROM game_release_files WHERE release_id = ?").all(releaseId)
    expect(orphanedFiles.length).toBe(0)
  })

  it("performs real D1-safe upgrade from migration 0013 to 0014, adding mod provider metadata columns and index", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()

    // 1. Run migrations up to 0013
    for (const file of sqlFiles) {
      if (file.startsWith("0014_")) break
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      for (const statement of sqlContent.split("--> statement-breakpoint")) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }

    // 2. Insert test user, release, and file before 0014
    const userId = "admin-test-0014"
    const releaseId = "rel-test-0014"
    const fileId = "file-test-0014"
    const now = new Date().toISOString()

    sqlite.exec(`
      INSERT INTO users (id, display_name, role, created_at, updated_at) VALUES ('${userId}', 'Admin', 'ADMIN', '${now}', '${now}');
      INSERT INTO game_releases (id, version, status, created_by, created_at, updated_at) VALUES ('${releaseId}', '1.0.0', 'DRAFT', '${userId}', '${now}', '${now}');
      INSERT INTO game_release_files (id, release_id, name, logical_path, category, sha256, size_bytes, is_directory, object_key, created_at)
      VALUES ('${fileId}', '${releaseId}', 'create.jar', 'mods/create.jar', 'MOD', 'sha256-create', 1024, 0, 'game-files/create', '${now}');
    `)

    // 3. Apply migration 0014
    const file0014 = sqlFiles.find((f) => f.startsWith("0014_"))
    expect(file0014).toBeDefined()
    const sql0014 = readFileSync(join(migrationsDir, file0014!), "utf-8")
    for (const statement of sql0014.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    // 4. Verify existing record has NULL metadata
    const fileBefore = sqlite.prepare("SELECT * FROM game_release_files WHERE id = ?").get(fileId) as any
    expect(fileBefore.source_provider).toBeNull()
    expect(fileBefore.source_project_id).toBeNull()
    expect(fileBefore.source_version_id).toBeNull()
    expect(fileBefore.source_file_id).toBeNull()

    // 5. Update with provider metadata and insert new provider-tracked file
    sqlite.exec(`
      UPDATE game_release_files
      SET source_provider = 'MODRINTH', source_project_id = 'LNytGWDc', source_version_id = 'ver-123'
      WHERE id = '${fileId}';
    `)
    const updated = sqlite.prepare("SELECT * FROM game_release_files WHERE id = ?").get(fileId) as any
    expect(updated.source_provider).toBe("MODRINTH")
    expect(updated.source_project_id).toBe("LNytGWDc")
    expect(updated.source_version_id).toBe("ver-123")

    const fileId2 = "file-curseforge-2"
    sqlite.exec(`
      INSERT INTO game_release_files (id, release_id, name, logical_path, category, sha256, size_bytes, is_directory, object_key, source_provider, source_project_id, source_file_id, created_at)
      VALUES ('${fileId2}', '${releaseId}', 'jei.jar', 'mods/jei.jar', 'MOD', 'sha256-jei', 2048, 0, 'game-files/jei', 'CURSEFORGE', '238222', '554433', '${now}');
    `)
    const file2 = sqlite.prepare("SELECT * FROM game_release_files WHERE id = ?").get(fileId2) as any
    expect(file2.source_provider).toBe("CURSEFORGE")
    expect(file2.source_project_id).toBe("238222")
    expect(file2.source_file_id).toBe("554433")

    // 6. Apply migration 0015 (adds source_environment)
    const file0015 = sqlFiles.find((f) => f.startsWith("0015_"))
    expect(file0015).toBeDefined()
    const sql0015 = readFileSync(join(migrationsDir, file0015!), "utf-8")
    for (const statement of sql0015.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    const fileAfter0015 = sqlite.prepare("SELECT * FROM game_release_files WHERE id = ?").get(fileId) as any
    expect(fileAfter0015.source_environment).toBeNull()

    // 7. Apply migration 0016 (adds cover_media_id referencing content_media)
    const file0016 = sqlFiles.find((f) => f.startsWith("0016_"))
    expect(file0016).toBeDefined()
    const sql0016 = readFileSync(join(migrationsDir, file0016!), "utf-8")
    for (const statement of sql0016.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    const relBefore = sqlite.prepare("SELECT * FROM game_releases WHERE id = ?").get(releaseId) as any
    expect(relBefore.cover_media_id).toBeNull()

    // Insert media into content_media and reference it in game_releases
    const mediaId = "cover-media-test-1"
    sqlite.exec(`
      INSERT INTO content_media (id, object_key, media_type, mime_type, size_bytes, created_by, created_at)
      VALUES ('${mediaId}', 'content/media/cover.png', 'IMAGE', 'image/png', 1024, '${userId}', '${now}');
    `)

    sqlite.exec(`
      UPDATE game_releases
      SET cover_media_id = '${mediaId}'
      WHERE id = '${releaseId}';
    `)

    const relAfter = sqlite.prepare("SELECT * FROM game_releases WHERE id = ?").get(releaseId) as any
    expect(relAfter.cover_media_id).toBe(mediaId)

    // Test ON DELETE SET NULL on content_media
    sqlite.exec(`DELETE FROM content_media WHERE id = '${mediaId}';`)
    const relAfterDelete = sqlite.prepare("SELECT * FROM game_releases WHERE id = ?").get(releaseId) as any
    expect(relAfterDelete.cover_media_id).toBeNull()

    // 8. Apply migration 0017 (adds server_managed_content and server_release_syncs tables)
    const file0017 = sqlFiles.find((f) => f.startsWith("0017_"))
    expect(file0017).toBeDefined()
    const sql0017 = readFileSync(join(migrationsDir, file0017!), "utf-8")
    for (const statement of sql0017.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    const d1 = createTestD1()
    const db = createDatabase(d1)

    // Insert user and release
    await db.insert(schema.users).values({
      id: userId,
      displayName: "Admin",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(schema.gameReleases).values({
      id: releaseId,
      version: "1.0.0",
      status: "DRAFT",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    // Insert server managed content (SERVER_DIRECT)
    const managedId1 = crypto.randomUUID()
    await db.insert(schema.serverManagedContent).values({
      id: managedId1,
      managementSource: "SERVER_DIRECT",
      provider: "MODRINTH",
      projectId: "spark",
      versionId: "v1.0.0",
      fileId: "f1",
      contentType: "MOD",
      environment: "SERVER",
      targetPath: "mods/spark-1.21.1.jar",
      sha256: "abc123sha256",
      sizeBytes: 10240,
      createdAt: now,
      updatedAt: now,
    })

    const foundDirect = await db
      .select()
      .from(schema.serverManagedContent)
      .where(eq(schema.serverManagedContent.id, managedId1))
      .get()

    expect(foundDirect).toBeDefined()
    expect(foundDirect?.managementSource).toBe("SERVER_DIRECT")
    expect(foundDirect?.targetPath).toBe("mods/spark-1.21.1.jar")

    // Insert server release sync record
    const syncId = crypto.randomUUID()
    await db.insert(schema.serverReleaseSyncs).values({
      id: syncId,
      releaseId: releaseId,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    })

    const foundSync = await db
      .select()
      .from(schema.serverReleaseSyncs)
      .where(eq(schema.serverReleaseSyncs.id, syncId))
      .get()

    expect(foundSync).toBeDefined()
    expect(foundSync?.status).toBe("PENDING")
    expect(foundSync?.releaseId).toBe(releaseId)
  })

  it("supports updateDeploymentOrder and launcherActiveReleaseId on projectSettings (Shard 08F)", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const userId = crypto.randomUUID()
    const releaseId = crypto.randomUUID()
    const now = new Date().toISOString()

    await db.insert(schema.users).values({
      id: userId,
      displayName: "Admin",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.gameReleases).values({
      id: releaseId,
      version: "1.0.0",
      status: "PUBLISHED",
      publishedAt: now,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    // The row 'main' is created by migration sequence
    const initialSettings = await db
      .select()
      .from(schema.projectSettings)
      .where(eq(schema.projectSettings.id, "main"))
      .get()

    expect(initialSettings).toBeDefined()
    expect(initialSettings?.updateDeploymentOrder).toBe("SERVER_FIRST")

    // Update settings with releaseId and PLAYERS_FIRST
    await db
      .update(schema.projectSettings)
      .set({
        launcherActiveReleaseId: releaseId,
        updateDeploymentOrder: "PLAYERS_FIRST",
        updatedAt: now,
      })
      .where(eq(schema.projectSettings.id, "main"))

    const updated = await db
      .select()
      .from(schema.projectSettings)
      .where(eq(schema.projectSettings.id, "main"))
      .get()

    expect(updated?.updateDeploymentOrder).toBe("PLAYERS_FIRST")
    expect(updated?.launcherActiveReleaseId).toBe(releaseId)
  })

  it("Migration 0019 deterministic backfill: backfills latest PUBLISHED release for legacy databases", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    // Apply migrations 0001 through 0018 (pre-08F state)
    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("0019"))
      .sort()

    for (const file of sqlFiles) {
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      for (const statement of sqlContent.split("--> statement-breakpoint")) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }

    // Seed legacy releases in pre-0019 DB:
    // rel-archived: archived
    // rel-published: published at 2026-02-01
    // rel-draft: draft
    const now = new Date().toISOString()
    sqlite.exec(`INSERT INTO users (id, display_name, role, created_at, updated_at) VALUES ('u1', 'Admin', 'ADMIN', '${now}', '${now}');`)
    sqlite.exec(`INSERT INTO game_releases (id, version, status, published_at, created_by, created_at, updated_at) VALUES ('rel-archived', '0.9.0', 'ARCHIVED', '2026-01-01T00:00:00.000Z', 'u1', '${now}', '${now}');`)
    sqlite.exec(`INSERT INTO game_releases (id, version, status, published_at, created_by, created_at, updated_at) VALUES ('rel-published', '1.0.0', 'PUBLISHED', '2026-02-01T00:00:00.000Z', 'u1', '${now}', '${now}');`)
    sqlite.exec(`INSERT INTO game_releases (id, version, status, published_at, created_by, created_at, updated_at) VALUES ('rel-draft', '1.1.0', 'DRAFT', NULL, 'u1', '${now}', '${now}');`)

    // Now apply migration 0019
    const mig0019Content = readFileSync(join(migrationsDir, "0019_release_activation_and_deployment_order.sql"), "utf-8")
    for (const statement of mig0019Content.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    // Query project_settings
    const stmt = sqlite.prepare("SELECT launcher_active_release_id, update_deployment_order FROM project_settings WHERE id = 'main'")
    const result: any = stmt.get()

    expect(result.update_deployment_order).toBe("SERVER_FIRST")
    expect(result.launcher_active_release_id).toBe("rel-published")

  })

  it("Migration 0019 backfill: leaves launcher_active_release_id NULL when no legacy published releases exist", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("0019"))
      .sort()

    for (const file of sqlFiles) {
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      for (const statement of sqlContent.split("--> statement-breakpoint")) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }

    // Only DRAFT release in legacy DB
    const now = new Date().toISOString()
    sqlite.exec(`INSERT INTO users (id, display_name, role, created_at, updated_at) VALUES ('u1', 'Admin', 'ADMIN', '${now}', '${now}');`)
    sqlite.exec(`INSERT INTO game_releases (id, version, status, published_at, created_by, created_at, updated_at) VALUES ('rel-draft-only', '1.0.0', 'DRAFT', NULL, 'u1', '${now}', '${now}');`)

    // Apply migration 0019
    const mig0019Content = readFileSync(join(migrationsDir, "0019_release_activation_and_deployment_order.sql"), "utf-8")
    for (const statement of mig0019Content.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    const stmt = sqlite.prepare("SELECT launcher_active_release_id, update_deployment_order FROM project_settings WHERE id = 'main'")
    const result: any = stmt.get()

    expect(result.update_deployment_order).toBe("SERVER_FIRST")
    expect(result.launcher_active_release_id).toBeNull()
  })

  it("Migration 0020: expands game_file_upload_tokens CHECK constraint to all 8 categories while preserving existing data and constraints", async () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON;")

    const migrationsDir = join(__dirname, "../migrations")
    const pre0020Files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("0020"))
      .sort()

    for (const file of pre0020Files) {
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      for (const statement of sqlContent.split("--> statement-breakpoint")) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }

    // 1. Seed user and existing MOD token in pre-0020 DB
    const now = new Date().toISOString()
    sqlite.exec(`INSERT INTO users (id, display_name, role, created_at, updated_at) VALUES ('u-admin', 'Admin User', 'ADMIN', '${now}', '${now}');`)
    sqlite.exec(
      `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
        `VALUES ('tok-mod-1', 'hash-mod-1', 'MOD', 'mods/test.jar', 1024, 'u-admin', '${now}', '${now}');`,
    )

    // Verify pre-0020 rejects GENERAL, CONFIG, DATA_PACK
    expect(() => {
      sqlite.exec(
        `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
          `VALUES ('tok-gen-1', 'hash-gen-1', 'GENERAL', 'server.properties', 100, 'u-admin', '${now}', '${now}');`,
      )
    }).toThrow(/CHECK constraint failed/i)

    expect(() => {
      sqlite.exec(
        `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
          `VALUES ('tok-cfg-1', 'hash-cfg-1', 'CONFIG', 'config/test.json', 100, 'u-admin', '${now}', '${now}');`,
      )
    }).toThrow(/CHECK constraint failed/i)

    expect(() => {
      sqlite.exec(
        `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
          `VALUES ('tok-dp-1', 'hash-dp-1', 'DATA_PACK', 'datapacks/dp.zip', 100, 'u-admin', '${now}', '${now}');`,
      )
    }).toThrow(/CHECK constraint failed/i)

    // 2. Apply migration 0020
    const mig0020Content = readFileSync(join(migrationsDir, "0020_game_file_upload_tokens_categories.sql"), "utf-8")
    for (const statement of mig0020Content.split("--> statement-breakpoint")) {
      const trimmed = statement.trim()
      if (trimmed) sqlite.exec(trimmed)
    }

    // 3. Verify pre-existing token was migrated with all fields intact
    const existingToken: any = sqlite.prepare("SELECT * FROM game_file_upload_tokens WHERE id = 'tok-mod-1'").get()
    expect(existingToken).toBeDefined()
    expect(existingToken.id).toBe("tok-mod-1")
    expect(existingToken.token_hash).toBe("hash-mod-1")
    expect(existingToken.category).toBe("MOD")
    expect(existingToken.original_filename).toBe("mods/test.jar")
    expect(existingToken.expected_size_bytes).toBe(1024)
    expect(existingToken.created_by).toBe("u-admin")

    // 4. Verify all 8 categories can now be inserted successfully
    const allowedCategories = [
      "MOD",
      "RESOURCE_PACK",
      "DATA_PACK",
      "SHADER_PACK",
      "KUBEJS",
      "SCRIPT",
      "CONFIG",
      "GENERAL",
    ]

    for (const cat of allowedCategories) {
      sqlite.exec(
        `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
          `VALUES ('tok-${cat}', 'hash-${cat}', '${cat}', 'file-${cat}.dat', 500, 'u-admin', '${now}', '${now}');`,
      )
      const inserted: any = sqlite.prepare("SELECT * FROM game_file_upload_tokens WHERE id = ?").get(`tok-${cat}`)
      expect(inserted).toBeDefined()
      expect(inserted.category).toBe(cat)
    }

    // 5. Verify invalid category is still rejected
    expect(() => {
      sqlite.exec(
        `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
          `VALUES ('tok-invalid', 'hash-invalid', 'UNKNOWN_CATEGORY', 'file.bin', 500, 'u-admin', '${now}', '${now}');`,
      )
    }).toThrow(/CHECK constraint failed/i)

    // 6. Verify duplicate token_hash is rejected by UNIQUE constraint
    expect(() => {
      sqlite.exec(
        `INSERT INTO game_file_upload_tokens (id, token_hash, category, original_filename, expected_size_bytes, created_by, expires_at, created_at) ` +
          `VALUES ('tok-dup', 'hash-MOD', 'MOD', 'dup.jar', 500, 'u-admin', '${now}', '${now}');`,
      )
    }).toThrow(/UNIQUE constraint failed/i)

    // 7. Verify foreign key check passes
    const fkErrors = sqlite.prepare("PRAGMA foreign_key_check;").all()
    expect(fkErrors).toEqual([])

    // 8. Verify CASCADE deletion on creator user
    sqlite.exec("DELETE FROM users WHERE id = 'u-admin';")
    const remainingTokens = sqlite.prepare("SELECT COUNT(*) as count FROM game_file_upload_tokens").get() as any
    expect(remainingTokens.count).toBe(0)
  })
})






