# 🚀 HiKAT Launcher — Apparatia (Documentación Maestra & Contrato de Backend)

> **HiKAT Launcher** es una aplicación de escritorio nativa moderna, de alto rendimiento y diseño cinematográfico para el ecosistema de **Apparatia**. Construida con **React 19**, **TypeScript**, **Tailwind CSS v4**, **Vite** y **Electron**.

---

## 📑 Tabla de Contenidos

1. [Arquitectura del Sistema](#-arquitectura-del-sistema)
2. [Contrato de Endpoints REST (Backend)](#-contrato-de-endpoints-rest-backend)
3. [Contrato del Puente IPC de Electron (`window.electronAPI`)](#-contrato-del-puente-ipc-de-electron-windowelectronapi)
4. [Módulo de Ciberseguridad y Sanitización](#-módulo-de-ciberseguridad-y-sanitización)
5. [Configuraciones y Persistencia (`localStorage`)](#-configuraciones-y-persistencia-localstorage)
6. [Estructura del Proyecto](#-estructura-del-proyecto)
7. [Guía de Desarrollo y Despliegue](#-guía-de-desarrollo-y-despliegue)

---

## 🏛️ Arquitectura del Sistema

El launcher implementa una **Arquitectura en Capas Limpia (Clean Architecture)** totalmente desacoplada:

```plaintext
┌─────────────────────────────────────────────────────────────────┐
│                    INTERFAZ DE USUARIO (UI/UX)                  │
│       Vistas (Home, Skins, Settings, Profile, Login)           │
│       Componentes (DownloadPlayButton, ServerStats, Carousels)  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────┐
│               CAPA DE SERVICIOS Y SEGURIDAD                     │
│   src/services/apiClient.ts    src/services/authService.ts      │
│   src/services/newsService.ts  src/services/serverService.ts    │
│   src/services/gameService.ts  src/utils/security.ts            │
└────────────────┬───────────────────────────────┬────────────────┘
                 │                               │
┌────────────────▼──────────────┐ ┌──────────────▼────────────────┐
│   BACKEND REST API (HTTPS)    │ │   PROCESO PRINCIPAL ELECTRON │
│  Auth, Noticias, Manifiesto,  │ │  Ventana Frameless, JVM Args, │
│  Skins, Estado del Servidor   │ │  Descargas, Verificación      │
└───────────────────────────────┘ └───────────────────────────────┘
```

---

## 🌐 Contrato de Endpoints REST (Backend)

El cliente HTTP (`src/services/apiClient.ts`) apunta a la variable de entorno `VITE_API_URL` (por defecto `https://api.apparatia.net/api/v1`). Inyecta automáticamente el token JWT en el encabezado `Authorization: Bearer <token>` cuando existe una sesión activa.

### 1. Autenticación (`/auth`)

#### `POST /auth/login`

Inicia sesión con usuario o correo y contraseña.

- **Request Body**:
  ```json
  {
    "usernameOrEmail": "string (max 254)",
    "password": "string (max 128)",
    "keepSession": true
  }
  ```
- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "usr_99812",
        "username": "AlexCraft",
        "email": "alex@apparatia.net",
        "skinUrl": "https://cdn.apparatia.net/skins/alex.png",
        "capeUrl": "https://cdn.apparatia.net/capes/founder.png",
        "rank": "Aventurero",
        "level": 14,
        "memberSince": "15/08/2026"
      }
    }
  }
  ```
- **Errores**: `401 Unauthorized` (credenciales inválidas), `429 Too Many Requests` (rate limiting).

#### `POST /auth/register`

Crea una nueva cuenta de jugador.

- **Request Body**:
  ```json
  {
    "username": "string (3-16 caracteres, alfanumérico + '_')",
    "email": "string (RFC 5322)",
    "password": "string (min 8, max 128)"
  }
  ```
- **Response Success (`201 Created`)**:
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "usr_99813",
        "username": "NuevoJugador",
        "email": "nuevo@correo.com",
        "memberSince": "21/08/2026"
      }
    }
  }
  ```
- **Errores**: `409 Conflict` (usuario o correo ya registrado), `422 Unprocessable Entity`.

#### `POST /auth/reset-password`

Solicita un correo electrónico con token de recuperación de contraseña.

- **Request Body**:
  ```json
  {
    "email": "jugador@correo.com"
  }
  ```
- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "sent": true },
    "message": "Correo de restablecimiento enviado"
  }
  ```

---

### 2. Noticias y Novedades (`/news`)

#### `GET /news`

Obtiene las publicaciones oficiales del Backoffice para el carrusel y modal.

- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "news_1",
        "title": "Aeronaves y Dirigibles",
        "category": "Actualización",
        "date": "20 Ago 2026",
        "excerpt": "Nuevas mecánicas de vuelo a vapor...",
        "content": "Detalles completos de la actualización...",
        "imageUrl": "https://cdn.apparatia.net/news/aeronaves.png",
        "author": "Equipo Apparatia"
      }
    ]
  }
  ```

---

### 3. Estado del Servidor y Jugadores (`/server` y `/players`)

#### `GET /server/status`

Estado en vivo del servidor de Minecraft (Ping y jugadores concurrentes).

- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "online": true,
      "playersOnline": 142,
      "maxPlayers": 500,
      "latencyMs": 48,
      "motd": "Apparatia — Servidor Industrial y Magitech"
    }
  }
  ```

#### `GET /players/:username/stats`

Estadísticas del perfil de usuario y logros.

- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "playtimeHours": 128,
      "achievementsUnlocked": 34,
      "rank": "Ingeniero Maestro",
      "level": 18
    }
  }
  ```

---

### 4. Manifiesto del Juego y Descargas (`/game`)

#### `GET /game/manifest`

Consulta el estado de la versión del modpack y URLs de descarga.

- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "version": "1.20.1",
      "latestVersion": "1.20.1-v1.4.2",
      "downloadUrl": "https://cdn.apparatia.net/modpacks/apparatia-latest.zip",
      "totalSizeGB": 28.8,
      "md5Checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "hasUpdate": false
    }
  }
  ```

---

### 5. Skins y Capas (`/skins`)

#### `POST /skins/upload`

Sube una nueva textura de skin o capa para el usuario autenticado (compatible con texturas estándar y HD).

- **Request (Multipart/Form-Data)**:
  - `skin`: Archivo PNG de textura (estándar / HD).
  - `model`: `"classic"` (brazo 4px) o `"slim"` (brazo 3px).
- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "skinUrl": "https://cdn.apparatia.net/skins/usr_99812_custom.png",
      "model": "classic"
    },
    "message": "Textura actualizada correctamente"
  }
  ```

#### `GET /skins/user/:id`

Obtiene las URLs de las texturas activas de skin y capa de un jugador.

- **Response Success (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "skinUrl": "https://cdn.apparatia.net/skins/usr_99812_custom.png",
      "capeUrl": "https://cdn.apparatia.net/capes/founder.png",
      "model": "classic"
    }
  }
  ```

---

### 🎭 Transición del Visor de Skins (Fase 2 — Visor 3D Interactivo)

- **Estado Actual (Fase 1 - Frontend Prototipo)**:
  - [`MinecraftChar.tsx`](src/components/minecraft/MinecraftChar.tsx) actúa como un visor 2D provisional para representar la figura del personaje mientras se trabaja en la interfaz previa a la conexión del backend.
  - [`MinecraftHead.tsx`](src/components/minecraft/MinecraftHead.tsx) renderiza el avatar del jugador en la pastilla de perfil y vistas.
- **Fase de Integración con Backend (Fase 2 - Visor 3D)**:
  - Al conectar la API de texturas, se eliminará el componente 2D provisional [`MinecraftChar.tsx`](src/components/minecraft/MinecraftChar.tsx) y se reemplazará en [`SkinsView.tsx`](src/views/SkinsView.tsx) por el **Canvas 3D interactivo**.
  - El Canvas 3D renderizará en tiempo real el modelo tridimensional con rotación orbital con el ratón, animaciones y renderizado de capas, consumiendo directamente las texturas vinculadas al ecosistema in-game del servidor.

---

## 🔌 Contrato del Puente IPC de Electron (`window.electronAPI`)

El frontend consume la API nativa de Electron a través de [`electron/preload.cjs`](electron/preload.cjs) tipada en [`src/vite-env.d.ts`](src/vite-env.d.ts):

| Canal IPC                   | Tipo     | Payload                                   | Descripción                                                                 |
| --------------------------- | -------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `window-minimize`           | `send`   | —                                         | Minimiza la ventana a la barra de tareas.                                   |
| `window-maximize`           | `send`   | —                                         | Alterna entre tamaño estándar y pantalla completa / grande.                 |
| `window-close`              | `send`   | —                                         | Cierra la ventana o minimiza a la bandeja del sistema (Tray).               |
| `window-is-maximized`       | `invoke` | —                                         | Devuelve `Promise<boolean>` indicando si la ventana está maximizada.        |
| `window-maximize-changed`   | `event`  | `(isMax: boolean) => void`                | Notifica cambios de estado de maximización.                                 |
| `open-external`             | `send`   | `url: string`                             | Abre enlaces en el navegador predeterminado (solo `http:` y `https:`).      |
| `setting-start-with-system` | `send`   | `enabled: boolean`                        | Configura el inicio automático con Windows (`app.setLoginItemSettings`).    |
| `setting-minimize-to-tray`  | `send`   | `enabled: boolean`                        | Habilita minimizar a la bandeja al presionar cerrar.                        |
| `setting-auto-updates`      | `send`   | `enabled: boolean`                        | Activa la descarga automática de parches en segundo plano.                  |
| `setting-notifications`     | `send`   | `enabled: boolean`                        | Activa las notificaciones nativas de Windows.                               |
| `setting-ram-allocation`    | `send`   | `ramGB: number`                           | Asigna memoria RAM (1-64 GB) al proceso Java de Minecraft (`-Xmx{ramGB}G`). |
| `setting-dedicated-gpu`     | `send`   | `enabled: boolean`                        | Fuerza el renderizado con GPU dedicada (NVIDIA / AMD).                      |
| `game-start-download`       | `send`   | `manifest?: GameManifest`                 | Inicia el trabajador de descarga en segundo plano de mods y assets.         |
| `game-pause-download`       | `send`   | —                                         | Pausa la descarga activa.                                                   |
| `game-resume-download`      | `send`   | —                                         | Reanuda la descarga pausada.                                                |
| `game-cancel-download`      | `send`   | —                                         | Cancela y limpia archivos temporales.                                       |
| `game-repair-installation`  | `send`   | —                                         | Verifica la integridad SHA/MD5 de los mods locales contra el manifiesto.    |
| `game-uninstall`            | `send`   | —                                         | Desinstala el juego y elimina archivos locales del modpack.                 |
| `game-launch`               | `send`   | `options?: { version?: string }`          | Ejecuta el proceso de Minecraft con los argumentos Java y token de sesión.  |
| `game-download-progress`    | `event`  | `(data: DownloadProgressPayload) => void` | Emite `{ progress, downloadedGB, totalGB, speedMBs, remainingMinutes }`.    |

---

## 🛡️ Módulo de Ciberseguridad y Sanitización

Todas las entradas de usuario, enlaces externos y parámetros de la JVM están protegidos por el módulo [`src/utils/security.ts`](src/utils/security.ts):

- **SQL Injection (SQLi)**: Neutralización de palabras clave maliciosas (`UNION SELECT`, `INSERT INTO`, `DROP TABLE`, `DELETE FROM`, `xp_cmdshell`, `;`, `--`, `/*`).
- **Cross-Site Scripting (XSS)**: Desinfección de etiquetas `<script>`, `<img onerror>`, protocolos `javascript:` y `vbscript:`.
- **Minecraft Username Standards**: Whitelist estricta `^[a-zA-Z0-9_]{3,16}$` con truncado automático en 16 caracteres.
- **Email RFC 5322**: Validación estricta y límite de 254 caracteres.
- **URL Sanitization**: Solo se permite abrir enlaces externos con protocolos `http://` y `https://`.
- **RAM Boundaries**: Límites estrictos entre 1 GB y 64 GB.
- **Content Security Policy (CSP)**: Implementado en [`index.html`](index.html) para prevenir ejecución de scripts de orígenes desconocidos.
- **Protecciones de Escritorio**: Bloqueo de selección de texto (`user-select: none`), menú contextual (clic derecho) anulado, arrastre fantasma de imágenes deshabilitado y atajos de recarga web bloqueados (manteniendo `F12` activo para desarrollo).

---

## ⚙️ Configuraciones y Persistencia (`localStorage`)

Persistidas de forma inmediata mediante [`src/utils/settingsStorage.ts`](src/utils/settingsStorage.ts):

| Clave `localStorage`      | Tipo                                 | Valor Inicial | Descripción                                   |
| :------------------------ | :----------------------------------- | :------------ | :-------------------------------------------- |
| `hikat_theme`             | `"dark"` \| `"light"`                | `"dark"`      | Tema de color de la interfaz.                 |
| `hikat_language`          | `"es"` \| `"en"` \| `"pt"` \| `"fr"` | `"es"`        | Idioma de la interfaz y textos.               |
| `hikat_start_with_system` | `boolean`                            | `true`        | Inicio automático con Windows.                |
| `hikat_minimize_to_tray`  | `boolean`                            | `true`        | Minimizar a la bandeja del sistema al cerrar. |
| `hikat_auto_updates`      | `boolean`                            | `true`        | Actualizaciones en segundo plano.             |
| `hikat_notifications`     | `boolean`                            | `true`        | Notificaciones de eventos y descargas.        |
| `hikat_ram_gb`            | `number`                             | `8`           | RAM asignada al juego (GB).                   |
| `hikat_dedicated_gpu`     | `boolean`                            | `true`        | Forzar GPU dedicada para Minecraft.           |
| `hikat_auth_token`        | `string`                             | `null`        | Token JWT de sesión activa.                   |
| `hikat_last_user`         | `JSON (UserProfile)`                 | `null`        | Perfil del usuario en caché local.            |
| `hikat_game_installed`    | `"true"` \| `"false"`                | `"false"`     | Indicador de juego instalado localmente.      |

---

## 📁 Estructura del Proyecto

```plaintext
BYEKATLAUNCHER/
├── electron/                      # Proceso principal de Electron
│   ├── main.cjs                   # Ventana frameless, splash, IPC handlers y gestión de resolución
│   ├── preload.cjs                # Context bridge seguro (window.electronAPI)
│   ├── splash.html                # Splash screen cinemático con haz de luz perimetral
│   └── logo-windows.png           # Icono oficial de Windows
├── src/
│   ├── assets/                    # Assets categorizados (backgrounds, branding, launcher, news)
│   ├── components/                # Componentes modulares por dominio
│   │   ├── common/                # LauncherToggle, LauncherSelect, LiveToast
│   │   ├── layout/                # LauncherSidebar, LauncherTitlebar, UserProfileCard
│   │   ├── minecraft/             # Renderizado de skins y avatares (MinecraftHead, MinecraftChar)
│   │   ├── news/                  # Carrusel, tarjetas y modales de noticias
│   │   └── server/                # Botón de descarga/juego, estadísticas de servidor y hub comunitario
│   ├── context/                   # LanguageContext (i18n en ES, EN, PT, FR)
│   ├── hooks/                     # Custom hooks (useLauncherState)
│   ├── locales/                   # Diccionarios de traducción (es.json, en.json, pt.json, fr.json)
│   ├── services/                  # Capa de Servicios Centralizada (apiClient, auth, news, server, game)
│   ├── theme/                     # Iconografía vectorial limpia y tokens de diseño
│   ├── types/                     # Definiciones de TypeScript unificadas
│   ├── utils/                     # Utilidades (security.ts, settingsStorage.ts)
│   ├── views/                     # Vistas principales (Login, Home, Skins, Settings, Profile)
│   ├── App.tsx                    # Orquestador raíz de la interfaz
│   ├── index.css                  # Sistema de diseño, temas globales y protecciones desktop
│   └── main.tsx                   # Punto de entrada de React
├── .env.example                   # Variables de entorno para Backend
├── package.json                   # Dependencias y scripts
├── tsconfig.json                  # Configuración de TypeScript
└── vite.config.ts                 # Configuración de Vite
```

---

## 🚀 Guía de Desarrollo y Despliegue

### 1. Variables de Entorno (`.env`)

Copia `.env.example` a `.env` y configura la URL de tu API:

```env
VITE_API_URL=https://api.apparatia.net/api/v1
VITE_SERVER_IP=play.apparatia.net
VITE_SERVER_PORT=25565
VITE_DISCORD_URL=https://discord.gg/apparatia
VITE_WEBSITE_URL=https://apparatia.net
```

### 2. Comandos de Ejecución

```bash
# Instalar dependencias
npm install

# Iniciar el Launcher en modo Desktop (Electron + Vite)
npm run desktop

# Compilar bundle de producción
npm run build

# Formatear el código con oxfmt
npm run format
```
