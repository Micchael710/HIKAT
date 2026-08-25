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

## Workspace Structure

- `HiKATLauncher/`: Electron/React desktop launcher.
- `HiKATbackoffice/`: Management web dashboard.
- `services/backend/`: GraphQL Cloudflare Worker.
- `services/auth/`: Authentication Cloudflare Worker.
- `packages/shared/`: Shared utilities, constants, and types.
- `packages/graphql/`: Authoritative GraphQL schema and utilities.
- `packages/config/`: Shared TypeScript and build configs.
- `minecraft/`: Gradle multi-project for NeoForge 1.21.1 mods and Velocity gateway.
- `infrastructure/`: Architecture and infrastructure deployment specs.
- `docs/`: Technical and design specifications.
