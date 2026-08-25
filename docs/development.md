# HiKAT Development Guide

## Prerequisites

- **Node.js**: >= 20.x (Recommended 22+)
- **pnpm**: >= 9.x (Recommended 10+ / 11+)
- **JDK**: Java 21 (for `minecraft/` subprojects)

## Getting Started

1. **Install workspace dependencies**:

   ```bash
   pnpm install
   ```

2. **Run Monorepo Quality Commands**:
   ```bash
   # Type check all projects
   pnpm typecheck

   # Run test suites
   pnpm test

   # Build all applications and services
   pnpm build

   # Lint codebase
   pnpm lint

   # Code formatting
   pnpm format
   ```

3. **Database Operations (Drizzle & D1 Local)**:
   ```bash
   # Generate Drizzle migrations from schema changes
   pnpm db:generate

   # Apply D1 migrations to local Wrangler SQLite environment
   pnpm db:migrate:local
   ```

## Workspace Structure

- `HiKATLauncher/`: Electron/React desktop launcher.
- `HiKATbackoffice/`: Management web dashboard.
- `services/backend/`: GraphQL Cloudflare Worker.
- `services/auth/`: Authentication Cloudflare Worker.
- `packages/database/`: Drizzle ORM schema, migrations, and typed D1 database client.
- `packages/graphql/`: Authoritative modular GraphQL schema, scalars, error codes, and contracts.
- `packages/shared/`: Shared utilities, constants, and types.
- `packages/config/`: Shared TypeScript and build configs.
- `minecraft/`: Gradle multi-project for NeoForge 1.21.1 mods and Velocity gateway.
- `infrastructure/`: Architecture and infrastructure deployment specs.
- `docs/`: Technical and design specifications.
