# HiKAT Storage Architecture

## Storage Layers

HiKAT strictly distinguishes between structured relational data and binary blob storage.

```text
┌───────────────────────────────┐
│     Cloudflare D1 (SQL)       │  Structured application data:
│                               │  - Users & Profiles
│                               │  - News articles & categories
│                               │  - Modpack definitions & versions
│                               │  - Server status logs & telemetry
└───────────────────────────────┘

┌───────────────────────────────┐
│     Cloudflare R2 (Objects)   │  Binary / Blob assets:
│                               │  - Custom skin textures (.png)
│                               │  - Cape textures (.png)
│                               │  - Modpack archives (.zip)
│                               │  - Launcher distribution artifacts
└───────────────────────────────┘
```

## Migration & Data Safety

- Database schemas are managed using declarative migrations.
- Direct mutations against production persistence are prohibited.
- Storage operations are performed exclusively behind the backend service with signed URLs or authenticated proxying.
