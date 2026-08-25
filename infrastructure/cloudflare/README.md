# HiKAT Cloudflare Infrastructure Foundation

This directory houses Cloudflare architecture guides, resource schemas, and configuration templates.

## Components

- **Backend Worker (`services/backend`)**: GraphQL API server (GraphQL Yoga).
- **Auth Worker (`services/auth`)**: Authentication and OAuth/OIDC broker.
- **Cloudflare D1**: Structured SQL data storage (migrations & Drizzle schemas in subsequent shards).
- **Cloudflare R2**: Object/asset storage for skins, capes, and modpacks.
- **Cloudflare Pages**: Static frontend hosting for HiKAT Backoffice.

> **Note**: In Shard 0 (Foundation), no remote deployment or resource provisioning is performed (`wrangler deploy` is prohibited).
