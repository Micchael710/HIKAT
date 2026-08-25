import { describe, it, expect } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { eq } from "drizzle-orm"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import * as schema from "./schema"
import { createDatabase } from "./client"

describe("@hikat/database schema and operations", () => {
  function setupTestDb() {
    const sqlite = new Database(":memory:")
    sqlite.pragma("foreign_keys = ON")

    // Apply migrations from migrations folder
    const migrationsDir = join(__dirname, "../migrations")
    const sqlFiles = readdirSync(migrationsDir).filter((f) =>
      f.endsWith(".sql"),
    )

    for (const file of sqlFiles) {
      const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
      const statements = sqlContent.split("--> statement-breakpoint")
      for (const statement of statements) {
        const trimmed = statement.trim()
        if (trimmed) {
          sqlite.exec(trimmed)
        }
      }
    }

    const db = drizzle(sqlite, { schema })
    return { sqlite, db }
  }

  it("exports valid schema tables", () => {
    expect(schema.users).toBeDefined()
    expect(schema.externalAccounts).toBeDefined()
    expect(schema.sessions).toBeDefined()
  })

  it("creates user with default role PLAYER", () => {
    const { db } = setupTestDb()

    const userId = "user-123"
    const now = new Date().toISOString()

    db.insert(schema.users)
      .values({
        id: userId,
        displayName: "Steve",
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get()

    expect(user).toBeDefined()
    expect(user?.id).toBe(userId)
    expect(user?.role).toBe("PLAYER")
    expect(user?.displayName).toBe("Steve")
  })

  it("supports ADMIN role", () => {
    const { db } = setupTestDb()

    const userId = "admin-1"
    const now = new Date().toISOString()

    db.insert(schema.users)
      .values({
        id: userId,
        role: "ADMIN",
        displayName: "AdminUser",
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get()

    expect(user?.role).toBe("ADMIN")
  })

  it("enforces database-level CHECK constraint on users.role (rejects invalid roles via raw SQL)", () => {
    const { sqlite } = setupTestDb()
    const now = new Date().toISOString()

    // PLAYER -> allowed
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-player", "PLAYER", "Player 1", now, now)
    }).not.toThrow()

    // ADMIN -> allowed
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-admin", "ADMIN", "Admin 1", now, now)
    }).not.toThrow()

    // Invalid role (e.g. MODERATOR, OWNER, SUPERADMIN, random string) -> rejected by SQLite CHECK constraint
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("u-sql-invalid", "MODERATOR", "Hacker", now, now)
    }).toThrow(/CHECK constraint failed/i)
  })

  it("enforces database-level CHECK constraint on external_accounts.provider (rejects invalid providers via raw SQL)", () => {
    const { sqlite } = setupTestDb()
    const now = new Date().toISOString()

    sqlite
      .prepare(
        "INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("u-parent", "PLAYER", "User", now, now)

    // GOOGLE -> allowed
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO external_accounts (id, user_id, provider, provider_subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("ea-g", "u-parent", "GOOGLE", "sub-g-1", now, now)
    }).not.toThrow()

    // DISCORD -> allowed
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO external_accounts (id, user_id, provider, provider_subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("ea-d", "u-parent", "DISCORD", "sub-d-1", now, now)
    }).not.toThrow()

    // Invalid provider (e.g. GITHUB, TWITTER, FACEBOOK, random) -> rejected by SQLite CHECK constraint
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO external_accounts (id, user_id, provider, provider_subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("ea-inv", "u-parent", "GITHUB", "sub-gh-1", now, now)
    }).toThrow(/CHECK constraint failed/i)
  })

  it("enforces unique (provider, provider_subject) constraint on external_accounts", () => {
    const { db } = setupTestDb()

    const now = new Date().toISOString()
    db.insert(schema.users)
      .values({
        id: "u1",
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(schema.externalAccounts)
      .values({
        id: "ea-1",
        userId: "u1",
        provider: "GOOGLE",
        providerSubject: "google-sub-123",
        email: "steve@example.com",
        createdAt: now,
        updatedAt: now,
      })
      .run()

    // Second insert with same provider and providerSubject must throw unique constraint error
    expect(() => {
      db.insert(schema.externalAccounts)
        .values({
          id: "ea-2",
          userId: "u1",
          provider: "GOOGLE",
          providerSubject: "google-sub-123",
          email: "another@example.com",
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }).toThrow()
  })

  it("enforces foreign key cascading delete on external_accounts and sessions", () => {
    const { db } = setupTestDb()

    const now = new Date().toISOString()
    const userId = "user-cascade-test"

    db.insert(schema.users)
      .values({
        id: userId,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(schema.externalAccounts)
      .values({
        id: "ea-cas",
        userId,
        provider: "DISCORD",
        providerSubject: "discord-123",
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(schema.sessions)
      .values({
        id: "sess-1",
        userId,
        refreshTokenHash: "sha256-hash-placeholder",
        createdAt: now,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
      .run()

    // Verify records exist
    const accountsBefore = db
      .select()
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.userId, userId))
      .all()
    const sessionsBefore = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .all()

    expect(accountsBefore.length).toBe(1)
    expect(sessionsBefore.length).toBe(1)

    // Delete user
    db.delete(schema.users).where(eq(schema.users.id, userId)).run()

    // Verify cascade deleted related externalAccounts and sessions
    const accountsAfter = db
      .select()
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.userId, userId))
      .all()
    const sessionsAfter = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .all()

    expect(accountsAfter.length).toBe(0)
    expect(sessionsAfter.length).toBe(0)
  })

  it("allows querying external account by provider + providerSubject and by userId", () => {
    const { db } = setupTestDb()
    const now = new Date().toISOString()
    const userId = "u-lookup"

    db.insert(schema.users)
      .values({ id: userId, createdAt: now, updatedAt: now })
      .run()

    db.insert(schema.externalAccounts)
      .values({
        id: "ea-lookup-1",
        userId,
        provider: "GOOGLE",
        providerSubject: "sub-google-456",
        email: "alex@example.com",
        createdAt: now,
        updatedAt: now,
      })
      .run()

    // Query by provider + providerSubject
    const found = db
      .select()
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.providerSubject, "sub-google-456"))
      .get()

    expect(found).toBeDefined()
    expect(found?.id).toBe("ea-lookup-1")
    expect(found?.userId).toBe(userId)
    expect(found?.provider).toBe("GOOGLE")

    // Query by userId
    const userAccounts = db
      .select()
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.userId, userId))
      .all()

    expect(userAccounts.length).toBe(1)
  })

  it("supports querying session by ID, by refreshTokenHash, and by userId", () => {
    const { db } = setupTestDb()
    const now = new Date().toISOString()
    const userId = "u-sess-lookup"
    const hash = "hashed-refresh-token-value"

    db.insert(schema.users)
      .values({ id: userId, createdAt: now, updatedAt: now })
      .run()

    db.insert(schema.sessions)
      .values({
        id: "sess-lookup-1",
        userId,
        refreshTokenHash: hash,
        createdAt: now,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })
      .run()

    // Query by session ID
    const byId = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "sess-lookup-1"))
      .get()
    expect(byId).toBeDefined()
    expect(byId?.userId).toBe(userId)

    // Query by refreshTokenHash
    const byHash = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.refreshTokenHash, hash))
      .get()
    expect(byHash).toBeDefined()
    expect(byHash?.id).toBe("sess-lookup-1")

    // Query sessions for a user
    const userSessions = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .all()
    expect(userSessions.length).toBe(1)
  })

  it("exports createDatabase client factory", () => {
    const mockD1 = {} as D1Database
    const dbClient = createDatabase(mockD1)
    expect(dbClient).toBeDefined()
  })
})
