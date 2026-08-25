# HiKAT

HiKAT is a unified Minecraft ecosystem platform featuring an Electron client launcher, an administrative backoffice, Cloudflare Workers backend and authentication services, and NeoForge/Velocity Minecraft server components.

## Workspace Architecture

```text
HiKAT/
├── HiKATLauncher/            # Desktop Player Launcher (Electron + React 19 + Vite)
├── HiKATbackoffice/          # Administrative Management Portal (React + Vite)
├── services/
│   ├── backend/              # GraphQL Yoga API Service (Cloudflare Worker)
│   └── auth/                 # Authentication Provider (Cloudflare Worker)
├── minecraft/
│   ├── client-mod/           # Client-side Auth & Integration Mod (NeoForge 1.21.1)
│   ├── server-mod/           # Server-side Auth & Management Mod (NeoForge 1.21.1)
│   └── gateway/              # Velocity Proxy Gateway for Fly.io
├── packages/
│   ├── shared/               # Shared constants, types, and foundation utilities
│   ├── graphql/              # Authoritative GraphQL schema definitions
│   └── config/               # Shared TypeScript and tooling configs
├── infrastructure/
│   ├── cloudflare/           # Cloudflare Worker, D1, and R2 templates
│   └── fly/                  # Fly.io Velocity Gateway deployment configurations
└── docs/                     # Complete Architecture & System Specifications
```

## Prerequisites

- **Node.js**: >= 20.x
- **pnpm**: >= 9.x
- **JDK**: Java 21 (for Minecraft subprojects)

## Installation & Setup

```bash
# Install all workspace dependencies
pnpm install
```

## Development Commands

```bash
# Type check all packages and applications
pnpm typecheck

# Run test suites (Vitest)
pnpm test

# Build all applications and service workers
pnpm build

# Run linting checks
pnpm lint

# Format codebase
pnpm format
```

## Documentation

For in-depth architecture and design guides, see the [`docs/`](./docs/) directory:

- [System Architecture](./docs/architecture.md)
- [Authentication Model](./docs/authentication.md)
- [GraphQL API Specification](./docs/graphql.md)
- [Storage Architecture](./docs/storage.md)
- [Minecraft Subsystems](./docs/minecraft.md)
- [Development Guide](./docs/development.md)
