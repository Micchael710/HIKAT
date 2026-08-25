# HiKAT Storage Architecture

## Storage Layers

HiKAT strictly distinguishes between structured relational data and binary blob storage.

```text
┌───────────────────────────────┐
│     Cloudflare D1 (SQL)       │  Structured application data:
│     Database: hikat-d1        │  - Users & Roles (PLAYER, ADMIN)
│     Binding: DB               │  - External OAuth Accounts
│                               │  - Session records & refresh hashes
└───────────────────────────────┘

┌───────────────────────────────┐
│     Cloudflare R2 (Objects)   │  Binary / Blob assets:
│     Bucket: hikat-r2          │  - Custom skin textures (.png)
│                               │  - Cape textures (.png)
│                               │  - Modpack archives (.zip)
│                               │  - Launcher distribution artifacts
└───────────────────────────────┘
```

## Cloudflare D1 Configuration

- **Database Name:** `hikat-d1`
- **Database ID:** `a2410123-4e73-4c0f-9263-412fa06d7bdc`
- **Worker Binding:** `DB`
- **ORM:** Drizzle ORM (`drizzle-orm/d1`)

## Single Source of Truth

The database package `@hikat/database` (`packages/database`) is the single source of truth for:
- Drizzle schema definitions (`packages/database/src/schema/`)
- Declarative SQL migrations (`packages/database/migrations/`)
- Typed D1 client factory (`createDatabase(env.DB)`)

### Core Tables (Shard 1 Foundation)

1. **`users`**
   - Identity foundation for HiKAT players and administrators.
   - Columns: `id` (PK), `role` (enum: `PLAYER` | `ADMIN`, default: `PLAYER`), `display_name` (nullable text), `created_at` (text, ISO-8601), `updated_at` (text, ISO-8601).
   - Roles: strictly `PLAYER` and `ADMIN`.

2. **`external_accounts`**
   - Links external OAuth identity providers (Google, Discord) to HiKAT users.
   - Columns: `id` (PK), `user_id` (FK -> `users.id` ON DELETE CASCADE), `provider` (enum: `GOOGLE` | `DISCORD`), `provider_subject` (text), `email` (nullable text), `display_name` (nullable text), `avatar_url` (nullable text), `created_at` (text, ISO-8601), `updated_at` (text, ISO-8601).
   - Unique Constraint: `(provider, provider_subject)` prevents account collisions.
   - Index: `user_id`.

3. **`sessions`**
   - Foundation for session persistence and refresh token tracking.
   - Columns: `id` (PK), `user_id` (FK -> `users.id` ON DELETE CASCADE), `refresh_token_hash` (text, SHA-256 hash), `created_at` (text, ISO-8601), `expires_at` (text, ISO-8601), `last_used_at` (nullable text), `revoked_at` (nullable text).
   - Indexes: `user_id`, `refresh_token_hash`.
   - Security: Raw refresh tokens are never stored; only one-way cryptographic hashes are persisted.

## ID and Timestamp Strategy

- **ID Strategy:** Primary keys are generated server-side using native UUIDs (`crypto.randomUUID()`). External provider IDs (Google sub, Discord ID) are never used as user primary keys.
- **Timestamp Strategy:** Timestamps are stored as standard ISO-8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`) in SQLite `TEXT` columns, matching TypeScript `toISOString()` and GraphQL `DateTime` scalar.

## Migration & Data Safety

- Database migrations are generated via `pnpm db:generate` (`drizzle-kit generate`) and tracked in `packages/database/migrations/`.
- Local verification is executed against local SQLite/D1 state via `pnpm db:migrate:local`.
- Direct mutations against remote production persistence are strictly prohibited.
- Launcher and Backoffice clients NEVER access D1 or R2 directly; all operations are mediated through Cloudflare Workers.
