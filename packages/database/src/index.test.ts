import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"

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

    // ADMIN allowed
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-admin", "Admin 1", now, now, "ADMIN") // Wait, column order: id, role, display_name, created_at, updated_at
    }).toThrow()

    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-admin", "ADMIN", "Admin 1", now, now)
    }).not.toThrow()

    // Invalid role rejected
    expect(() => {
      d1._sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-invalid", "MODERATOR", "Hacker", now, now)
    }).toThrow(/CHECK constraint failed/i)
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
    const pc = await db.select().from(schema.passwordCredentials).where(eq(schema.passwordCredentials.userId, userId)).all()
    const ea = await db.select().from(schema.externalAccounts).where(eq(schema.externalAccounts.userId, userId)).all()
    const sess = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).all()
    const srt = await db.select().from(schema.sessionRefreshTokens).where(eq(schema.sessionRefreshTokens.sessionId, "sess-1")).all()

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
    const db = createDatabase(d1)
    const now = new Date().toISOString()
    const future = new Date(Date.now() + 86400000).toISOString()

    await db.insert(schema.users).values({ id: "u-atomic", createdAt: now, updatedAt: now })
    await db.insert(schema.sessions).values({ id: "sess-atomic", userId: "u-atomic", createdAt: now, expiresAt: future })
    await db.insert(schema.sessionRefreshTokens).values({
      id: "srt-atomic",
      sessionId: "sess-atomic",
      tokenHash: "unique-hash-123",
      createdAt: now,
      expiresAt: future,
    })

    // First atomic consumption
    const res1 = await d1
      .prepare(
        "UPDATE session_refresh_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(now, "srt-atomic", now)
      .run()

    expect(res1.meta.changes).toBe(1)

    // Second atomic consumption with same token (concurrent or replay) must affect 0 rows
    const res2 = await d1
      .prepare(
        "UPDATE session_refresh_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(now, "srt-atomic", now)
      .run()

    expect(res2.meta.changes).toBe(0)
  })

  it("handles Content Core tables: media, upload tokens, and posts", async () => {
    const d1 = createTestD1()
    const db = createDatabase(d1)
    const now = new Date().toISOString()
    const future = new Date(Date.now() + 900000).toISOString()

    // 1. Seed admin user
    await db.insert(schema.users).values({
      id: "admin-author",
      role: "ADMIN",
      displayName: "ContentAdmin",
      createdAt: now,
      updatedAt: now,
    })

    // 2. Upload token
    await db.insert(schema.contentMediaUploadTokens).values({
      id: "token-1",
      tokenHash: "hash-upload-1",
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

    // 3. Media record
    await db.insert(schema.contentMedia).values({
      id: "media-1",
      objectKey: "content/media/media-1.png",
      mimeType: "image/png",
      sizeBytes: 102400,
      createdBy: "admin-author",
      createdAt: now,
    })

    // 4. Content post
    await db.insert(schema.contentPosts).values({
      id: "post-1",
      kind: "NEWS",
      slug: "bienvenidos-a-hikat",
      title: "Bienvenidos a HiKAT",
      summary: "Gran lanzamiento oficial de la plataforma",
      bodyMarkdown: "# Bienvenidos\n\nEste es el post oficial de bienvenida.",
      coverMediaId: "media-1",
      status: "PUBLISHED",
      publishedAt: now,
      createdBy: "admin-author",
      updatedBy: "admin-author",
      createdAt: now,
      updatedAt: now,
    })

    const post = await db
      .select()
      .from(schema.contentPosts)
      .where(eq(schema.contentPosts.slug, "bienvenidos-a-hikat"))
      .get()

    expect(post).toBeDefined()
    expect(post?.title).toBe("Bienvenidos a HiKAT")
    expect(post?.coverMediaId).toBe("media-1")

    // 5. Unique slug constraint enforcement
    await expect(
      db.insert(schema.contentPosts).values({
        id: "post-duplicate-slug",
        kind: "ANNOUNCEMENT",
        slug: "bienvenidos-a-hikat",
        title: "Otro titulo",
        summary: "Otro resumen",
        bodyMarkdown: "Otro cuerpo",
        createdBy: "admin-author",
        updatedBy: "admin-author",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow()

    // 6. Cover media deletion sets cover_media_id to null
    await db.delete(schema.contentMedia).where(eq(schema.contentMedia.id, "media-1"))
    const postAfterMediaDelete = await db
      .select()
      .from(schema.contentPosts)
      .where(eq(schema.contentPosts.id, "post-1"))
      .get()

    expect(postAfterMediaDelete?.coverMediaId).toBeNull()
  })
})
