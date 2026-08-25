# HiKAT Authentication

## Flow & Roles

HiKAT implements an identity provider layer based on OAuth 2.0 / OpenID Connect (OIDC) with PKCE for desktop clients:

```text
Google / Discord
       │
       ▼
HiKAT Authentication Provider (services/auth)
       │
       ▼
  Roles: PLAYER / ADMIN
```

## Security Model

1. **Client Isolation**:
   - Clients (Launcher, Backoffice) never store raw third-party OAuth secrets or infrastructure keys.
   - Authentication tokens (JWT) are verified on the Backend and Gateway before executing protected operations.

2. **Roles**:
   - `PLAYER`: Standard game access, profile/skin management, public news access.
   - `ADMIN`: Management access to Backoffice operations, server actions, and publishing.

3. **Minecraft Verification**:
   - Game sessions are authenticated via the client-side mod talking to the Auth Service / Gateway, eliminating unauthorized player impersonation.
