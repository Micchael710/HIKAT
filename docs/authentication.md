# HiKAT Authentication

## Identity & Roles

El sistema de identidad de HiKAT gestiona la autenticación inicial de los usuarios y emite credenciales seguras para los servicios y el juego.

```text
Google / Discord
       │
       ▼
HiKAT Authentication Worker (services/auth)
       │
       ▼
  Roles: PLAYER / ADMIN
```

## Flujo de Autenticación de Juego (Minecraft)

El flujo de conexión y validación de sesiones para el juego opera de la siguiente manera:

1. **Autenticación en Launcher**:
   - El usuario inicia sesión en el `HiKATLauncher` vía el Authentication Worker.
   - El Launcher mantiene la sesión de usuario activa.

2. **Obtención del Game JWT**:
   - Al momento de pulsar "Jugar", el Launcher solicita y obtiene un **Game JWT corto** firmado asimétricamente por el Authentication Worker utilizando la sesión existente.

3. **Inyección segura**:
   - El Launcher entrega la credencial al proceso de Minecraft de forma segura en memoria o mediante archivo temporal restringido (protegido por permisos locales de OS).
   - **NUNCA** se pasa el JWT como argumento de línea de comandos (`command-line arguments`), para evitar su exposición en procesos del sistema.

4. **Presentación de credencial**:
   - Al conectar al servidor (a través del Gateway o directamente), el `client-mod` presenta esta credencial corta de juego durante el handshake de red.
   - El `client-mod` **NO** se comunica directamente con el Auth Worker ni con el Gateway para autenticar al jugador; únicamente transporta y presenta la credencial provista por el Launcher.

5. **Validación en Servidor**:
   - El `server-mod` en el servidor de juego verifica la firma asimétrica del token (mediante la clave pública / JWKS), comprueba la expiración, la audiencia (`audience`) y vincula la identidad validada al jugador.

## Roles del Sistema

- `PLAYER`: Acceso estándar al cliente de juego, personalización de cosméticos (skins/capas) y consulta de noticias.
- `ADMIN`: Acceso a operaciones administrativas en el Backoffice, gestión de noticias, modpacks y control de servidores.
