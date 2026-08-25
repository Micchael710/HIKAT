# HiKAT System Architecture

## Overview

HiKAT es un proyecto pequeño enfocado en simplicidad, robustez y seguridad para una comunidad de Minecraft.

La arquitectura se compone de aplicaciones cliente y componentes de servidor claramente delimitados:

```text
HiKATLauncher
       │
       ├──────────────┐
       │              │
       ↓              ↓
Authentication   Backend Worker (GraphQL)
    Worker            ↑
                      │
HiKATbackoffice ──────┘
```

## Componentes del Sistema

1. **HiKATLauncher (`HiKATLauncher/`)**:
   - Aplicación de escritorio construida con Electron, React 19, Vite y Tailwind CSS.
   - Gestiona el inicio de sesión del jugador, selección de cosméticos (skins/capas), visualización de noticias y lanzamiento del cliente Minecraft con inyección de credencial corta.

2. **HiKATbackoffice (`HiKATbackoffice/`)**:
   - Panel de administración web para gestión de noticias, modpacks y estado del servidor.
   - Interactúa exclusivamente con el Backend Worker vía GraphQL.

3. **Backend Worker (`services/backend/`)**:
   - Cloudflare Worker que aloja la API principal de HiKAT utilizando GraphQL Yoga.
   - Capa central de aplicación que aplica autorización, reglas de negocio y conecta con Cloudflare D1, R2 y servicios de soporte.

4. **Authentication Worker (`services/auth/`)**:
   - Cloudflare Worker dedicado para autenticación OAuth (Google, Discord) y emisión de tokens asimétricos para sesiones y juego.

5. **Minecraft / Velocity Gateway (`minecraft/`)**:
   - `client-mod`: Mod ligero (NeoForge 1.21.1) para presentar la credencial de juego entregada por el Launcher.
   - `server-mod`: Mod/componente de servidor (NeoForge 1.21.1) para validar la firma y vigencia del Game JWT.
   - `gateway`: Velocity Proxy en Fly.io para recepción en `mc.hikat...`, gestión de sala de espera, encendido bajo demanda (WoL / backend start) y transferencia transparente a `play.hikat...`.

## Almacenamiento y Persistencia

- **Cloudflare D1**: Base de datos relacional para datos estructurados (usuarios, noticias, registros de modpacks).
- **Cloudflare R2**: Almacenamiento de objetos para archivos binarios (texturas de skins/capas y paquetes de juego).
