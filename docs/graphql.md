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
