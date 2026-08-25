# HiKAT System Architecture

## Overview

HiKAT is an integrated Minecraft ecosystem comprising an Electron/React client launcher, a management backoffice, backend micro-services on Cloudflare Workers, and Minecraft game infrastructure.

```text
HiKATLauncher
       │
       ├──────────────┐
       │              │
       ↓              ↓
   Auth Provider   Backend GraphQL
                      ↑
                      │
HiKATbackoffice ──────┘
```

## Core Components

1. **HiKATLauncher (`HiKATLauncher/`)**:
   - Desktop application built with Electron, React 19, Vite, and Tailwind CSS.
   - Handles player login, skin/cape customization, server discovery, news display, and game client launching.

2. **HiKATbackoffice (`HiKATbackoffice/`)**:
   - Web application for administrators and community managers.
   - Built with React, Vite, and Cloudflare Pages.
   - Interacts exclusively with the HiKAT Backend GraphQL API.

3. **Backend Service (`services/backend/`)**:
   - Cloudflare Worker hosting the primary GraphQL API using GraphQL Yoga.
   - Central application layer enforcing authorization, business rules, and integrating with Cloudflare D1, R2, Pterodactyl, Modrinth, and CurseForge.

4. **Authentication Service (`services/auth/`)**:
   - Dedicated Cloudflare Worker handling OAuth / OIDC flows (Google, Discord) and issuing signed player tokens.

5. **Minecraft Services (`minecraft/`)**:
   - `client-mod`: Client authentication and integration mod (NeoForge 1.21.1).
   - `server-mod`: Server verification mod (NeoForge 1.21.1).
   - `gateway`: Velocity Proxy on Fly.io managing player routing and connection security.

## Storage & External Integrations

- **Cloudflare D1**: Persistent structured data storage (users, server records, news, modpacks).
- **Cloudflare R2**: Object storage for binary assets (skins, capes, modpack archives).
- **Pterodactyl / Ubuntu Nodes**: Dedicated game server execution.
- **Modrinth & CurseForge**: Modpack metadata and distribution.
