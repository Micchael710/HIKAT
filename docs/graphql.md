# HiKAT GraphQL API

## Primary Interface

GraphQL is the single authoritative application API for HiKAT.

```text
HiKATLauncher ──────┐
                    ├──▶ Backend GraphQL Service (services/backend)
HiKATbackoffice ────┘
```

## Architectural Principles

1. **No REST Duplication**:
   - Application functionality is exposed through GraphQL mutations and queries.
   - REST endpoints are restricted to specific infrastructure webhooks or minimal health probes.

2. **Schema as Contract**:
   - The GraphQL schema defined in `@hikat/graphql` is the single source of truth for clients and services.
   - All inputs and outputs are strongly typed.

3. **Infrastructure Encapsulation**:
   - Clients must never bypass GraphQL to interact directly with D1, R2, Pterodactyl, or external mod APIs.
   - Internal credentials and connection strings are strictly encapsulated inside the backend worker.

## Modular Schema Architecture

Located in `packages/graphql/src/schema/`:

- **`common.ts`**: Common scalars and core enums:
  - `scalar DateTime`: Validated ISO-8601 UTC date-time string.
  - `enum Role`: Strictly `PLAYER` and `ADMIN`.
- **`user.ts`**: Identity contract:
  - `type User`: Public user identity contract (`id`, `role`, `displayName`, `createdAt`, `updatedAt`). Never exposes sensitive internal data (tokens, hashes, OAuth secrets).
- **`health.ts`**: Infrastructure health and version queries:
  - `Query.health`: Service status, service identifier, version, and timestamp.
  - `Query.version`: HiKAT workspace semantic version.

## Standard Error Codes

HiKAT standardizes GraphQL error extensions using `GraphQLError.extensions.code`:

| Code | Usage |
| :--- | :--- |
| `UNAUTHENTICATED` | Missing or invalid authentication credentials |
| `FORBIDDEN` | Authenticated user lacks required permissions / role |
| `NOT_FOUND` | Requested entity does not exist |
| `VALIDATION_ERROR` | Malformed or invalid input payload |
| `CONFLICT` | Entity conflict (e.g. duplicate unique key) |
| `INTERNAL_ERROR` | Unhandled server error (sanitized; no SQL internals or secrets exposed) |
