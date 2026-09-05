# HiKAT Authentication Architecture (Shard 02)

## 1. Identity Model & Accounts

HiKAT cuenta con un sistema propio y unificado de cuentas internas bajo el principio arquitectónico: **1 usuario = 1 identidad = 1 método de autenticación**. Cada persona posee exactamente un registro en la tabla `users` (con `id`, `displayName`, `role`, `createdAt`, `updatedAt`).

Los métodos de autenticación soportados son mutuamente excluyentes por cuenta:
1. **Email + Contraseña**: Registrado en `password_credentials` (`userId`, `email`, `passwordHash`, `isEmailVerified`, `verifiedAt`).
2. **Google OAuth / OIDC**: Registrado en `external_accounts` (`userId`, `provider = 'GOOGLE'`, `providerSubject`, `email`, `emailVerified`, `displayName`, `avatarUrl`).
3. **Discord OAuth2**: Registrado en `external_accounts` (`userId`, `provider = 'DISCORD'`, `providerSubject`, `email`, `emailVerified`, `displayName`, `avatarUrl`).

### Roles
- `PLAYER` (Rol por defecto asignado a todo nuevo registro o autenticación externa inicial).
- `ADMIN` (Rol con permisos administrativos en Backoffice y backend).

No se utiliza RBAC complejo ni permisos adicionales.

### Prevención de Conflictos de Identidad y Exclusividad de Método
- Una cuenta HiKAT solo puede tener un único método de autenticación a lo largo de su ciclo de vida. No se permite la vinculación ni combinación de métodos en una misma cuenta.
- Si un usuario intenta registrarse con contraseña utilizando un correo electrónico que ya pertenece a una cuenta creada mediante Google o Discord, el registro es rechazado (`USER_ALREADY_EXISTS`).
- Si un usuario intenta autenticarse mediante Google o Discord con un correo electrónico que ya pertenece a una cuenta existente creada con otro método (contraseña u otro proveedor OAuth), el sistema rechaza el intento (`EMAIL_CONFLICT_LINK_REQUIRED`) indicando que debe iniciar sesión utilizando el método con el que originalmente creó su cuenta.

---

## 2. Cryptography & Security Specifications

### Hashing de Contraseñas (PBKDF2-HMAC-SHA512)
- **Algoritmo**: PBKDF2 utilizando HMAC-SHA512 implementado con `node:crypto` (`nodejs_compat`).
- **Iteraciones mínimas**: 100,000 iteraciones (configurable y versionado por hash).
- **Salt**: 32 bytes criptográficamente seguros por cada contraseña (`crypto.getRandomValues`).
- **Longitud de clave derivada**: 64 bytes (512 bits).
- **Formato persistido**: `$pbkdf2-sha512$i=<iterations>$<salt_b64url>$<hash_b64url>`
- **Verificación**: Comparación en tiempo constante (`constantTimeEqual`) para mitigar ataques de timing.

### Asymmetric JWT & JWKS (ES256)
- **Algoritmo**: ECDSA utilizando la curva P-256 y SHA-256 (`ES256`), implementado mediante la librería estándar `jose`.
- **Rotación y JWKS**: Publicación de claves públicas en `/.well-known/jwks.json` con identificador de clave (`kid`).
- **En producción**: La clave privada ES256 se carga desde variables de entorno seguras (`JWT_PRIVATE_KEY_PEM` / `JWT_KID`). En desarrollo/test, se generan claves efímeras seguras en memoria si no se proporcionan secrets.
- **Access JWT**:
  - Duración: 15 minutos (`exp`).
  - Claims: `sub` (userId), `sid` (sessionId), `role`, `displayName`, `iss` (`https://auth.hikat.org`), `aud` (`hikat-api`).
- **Game JWT (Minecraft)**:
  - Duración: 3 minutos (`exp`).
  - Claims: `sub` (userId), `sid` (sessionId), `role`, `displayName`, `iss` (`https://auth.hikat.org`), `aud` (`hikat-minecraft`).
  - Requisito estricto: La sesión `sid` debe estar activa en D1 y la cuenta debe tener el correo verificado si utiliza email/contraseña.

---

## 3. Sessions, Refresh Token Rotation & Replay Attack Detection

### Almacenamiento seguro de Refresh Tokens
- Los refresh tokens **nunca** se almacenan en texto plano en la base de datos D1.
- Se genera un token opaco aleatorio de 32 bytes (`base64url`), y en `session_refresh_tokens` se almacena exclusivamente su hash criptográfico SHA-256 (`tokenHash`).

### Rotación de Refresh Tokens segura ante Race Conditions
- Cada llamada a `/auth/refresh` invalida el token actual y emite uno nuevo para la misma sesión.
- El consumo del token anterior se ejecuta mediante una operación condicional atómica en SQL:
  ```sql
  UPDATE session_refresh_tokens
  SET consumed_at = ?
  WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  ```
- Si dos peticiones simultáneas presentan el mismo refresh token, solo una actualizará filas (`changes === 1`). La otra (`changes === 0`) detectará colisión y revocará la sesión.

### Detección de Replay Attacks
- Si se presenta un refresh token cuyo registro en `session_refresh_tokens` ya tiene `consumed_at` asignado (es decir, ya fue consumido con anterioridad):
  1. Se detecta inmediatamente el intento de reutilización (`TOKEN_REUSE_DETECTED`).
  2. Se revoca automáticamente toda la sesión y todos los tokens de la familia (`sessions.revokedAt` y `session_refresh_tokens.revokedAt`).
  3. Se rechaza la solicitud forzando al usuario a volver a autenticarse.

---

## 4. Launcher PKCE & Authorization Code Flow

El Launcher es un cliente público (Electron) y **no debe contener secretos de cliente**.

```text
Launcher (Electron)             HiKAT Auth Service            External Provider (Google/Discord)
      │                                 │                                     │
      │ 1. Genera code_verifier & PKCE  │                                     │
      │    code_challenge (S256)        │                                     │
      │ 2. GET /oauth/authorize ───────>│                                     │
      │    (client_id, challenge, ...)  │ 3. Redirige a OAuth externo ───────>│
      │                                 │    (state seguro firmado en D1)     │
      │                                 │<─── 4. Callback con auth code ──────┤
      │                                 │     5. Valida state & resuelve User │
      │                                 │     6. Emite Authorization Code     │
      │                                 │        HiKAT (corto, ligado a PKCE) │
      │<─── 7. Redirige a redirect_uri ─┤                                     │
      │     (hikat://auth/callback?code=...)                                  │
      │                                 │                                     │
      │ 8. POST /oauth/token ──────────>│                                     │
      │    (code + code_verifier)       │ 9. Valida PKCE S256 & consume code  │
      │<─── 10. Retorna Access + Refresh┤    (emite sesión y JWTs HiKAT)      │
```

- **Redirect URIs permitidas**:
  - `hikat://auth/callback` (Launcher Deep Link oficial)
  - `http://localhost:*` (Solo para desarrollo local)
  - `https://app.hikat.org/*` (Portal web oficial)

---

## 5. Endpoints de la API (`services/auth`)

| Método | Ruta | Descripción | Auth Requerida |
|---|---|---|---|
| `GET` | `/health` | Chequeo de estado del servicio | Pública |
| `GET` | `/.well-known/jwks.json` | Claves públicas ES256 para validación de JWTs | Pública |
| `POST` | `/auth/register` | Registro con email, contraseña y displayName | Pública |
| `POST` | `/auth/login` | Login con email y contraseña | Pública |
| `POST` | `/auth/verify-email` | Verificación de correo mediante token | Pública |
| `POST` | `/auth/forgot-password` | Solicitud de token de recuperación de contraseña | Pública |
| `POST` | `/auth/reset-password` | Restablecimiento de contraseña con token | Pública |
| `POST` | `/auth/change-password` | Cambio de contraseña con sesión activa | Bearer JWT + D1 sid check |
| `POST` | `/auth/refresh` | Rotación de refresh token | Refresh Token |
| `POST` | `/auth/logout` | Revocación de sesión en D1 | Bearer JWT |
| `POST` | `/auth/game-token` | Emisión de Game JWT de corta duración (3 min) | Bearer JWT + D1 sid check |
| `GET` | `/auth/me/methods` | Consulta de método de autenticación activo (read-only) | Bearer JWT + D1 sid check |
| `GET` | `/oauth/authorize` | Inicio de flujo PKCE OAuth para clientes | Pública |
| `GET` | `/oauth/google/callback` | Callback de Google OAuth2/OIDC | Pública |
| `GET` | `/oauth/discord/callback` | Callback de Discord OAuth2 | Pública |
| `POST` | `/oauth/token` | Intercambio de código de autorización PKCE | Pública |

---

## 6. Producción: Configuración Externa y Checklist de Secrets

Para el despliegue final en producción de `services/auth`, se deben aprovisionar externamente las siguientes configuraciones y secrets en Cloudflare (sin incluir credenciales en el repositorio):

### Cloudflare Secrets & Environment (`wrangler secret put <KEY>`)
1. `AUTH_JWT_PRIVATE_KEY_PEM`: Clave privada ECDSA P-256 en formato PEM para la firma de tokens ES256.
2. `AUTH_JWT_PUBLIC_KEY_PEM`: Clave pública ECDSA P-256 en formato PEM (opcional, calculada a partir de la privada).
3. `AUTH_JWT_KID`: Identificador de clave activa en JWKS (ej. `hikat-key-2026-v1`).
4. `AUTH_SERVICE_ENDPOINT`: URL pública del servicio de autenticación (ej. `https://auth.hikat.org`).
5. `GOOGLE_CLIENT_ID`: ID de cliente OAuth 2.0 creado en Google Cloud Console.
6. `GOOGLE_CLIENT_SECRET`: Secreto de cliente OAuth 2.0 de Google.
7. `DISCORD_CLIENT_ID`: Application ID creada en Discord Developer Portal.
8. `DISCORD_CLIENT_SECRET`: Client Secret de OAuth2 de Discord.
9. `RESEND_API_KEY`: API Key del proveedor de correo transaccional para envío de verificaciones y recuperación.

### Configuración en Proveedores Externos
- **Google Cloud Console**:
  - Authorized Redirect URI: `https://auth.hikat.org/oauth/google/callback`
  - Scopes: `openid`, `email`, `profile`
- **Discord Developer Portal**:
  - Redirects: `https://auth.hikat.org/oauth/discord/callback`
  - Scopes: `identify`, `email`

### Allowlists de Redirección Registradas
- **Launcher OAuth (`ALLOWED_REDIRECT_URIS`)**:
  - `hikat://auth/callback`
  - `http://localhost:5173/auth/callback`
  - `http://127.0.0.1:5173/auth/callback`
