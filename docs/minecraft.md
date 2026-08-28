# HiKAT Minecraft Subsystem

## Components & Responsibilities

### 1. `client-mod` (NeoForge 1.21.1)
- **Responsabilidad principal**: Mínima autenticación HiKAT en el cliente del juego.
- **Flujo**: Recibe y presenta la credencial corta de juego (Game JWT) proporcionada de forma segura por el Launcher durante la conexión al servidor.
- **Límites de diseño**:
  - **NO** GraphQL.
  - **NO** telemetría HiKAT.
  - **NO** Wake-on-LAN (WoL).
  - **NO** server ping.
  - **NO** Fly.io.
  - **NO** Pterodactyl.
  - **NO** server routing.

### 2. `server-mod` (NeoForge 1.21.1)
- **Responsabilidad principal**: Validación de la credencial de juego durante el handshake de conexión del jugador.
- **Verificación**: Valida criptográficamente la firma asimétrica del token (Game JWT), expiración, audience (`hikat-game-server`) e identidad del jugador.
- **Límites de diseño**:
  - **NO** debe convertirse en un sistema general de status/telemetría salvo que un requisito futuro explícito lo documente.

### 3. `gateway` (Velocity en Fly.io)
- **Dominio de entrada**: `mc.hikat...` actúa como el punto de entrada público para los jugadores.
- **Gestión de estado y disponibilidad**: Comprueba la disponibilidad del servidor de juego en `play.hikat...`.
- **Sala de espera / Cola**: Mantiene al jugador conectado y esperando en un lobby liviano cuando el servidor no está listo.
- **Encendido bajo demanda**:
  - Puede realizar Wake-on-LAN (WoL) cuando el host dedicado está apagado.
  - Puede solicitar al Backend Worker que inicie el servidor de Minecraft cuando el host está encendido pero el proceso de Minecraft está detenido.
- **Transferencia**:
  - Cuando `play.hikat...` está listo, transfiere al jugador utilizando el Minecraft Transfer Packet nativo.
  - Después de la transferencia, el tráfico de juego fluye directamente al servidor dedicado; Fly.io **NO** transporta la sesión de juego continua.
  - **NO** es el componente principal responsable de validar el Game JWT (la validación final y definitiva ocurre en el `server-mod`).

### 4. Integración de Skins y Capas (CustomSkinLoader)
- **Decisión Arquitectónica**: HiKAT no interpreta visualmente las texturas ni impone modelos de brazos.
- **Skins**:
  - HiKAT almacena el binario PNG en Cloudflare R2 y metadata en D1.
  - **NO** detecta, clasifica ni persiste `model` (CLASSIC/SLIM).
  - En el Launcher y Back Office, `skinview3d` se inicializa con `model: "auto-detect"`.
  - En Minecraft, CustomSkinLoader carga la skin usando `model: "auto"` delegando la detección del modelo al motor de renderizado del cliente.
- **Capas**:
  - HiKAT almacena la textura intacta sin reescalar, deformar ni comprimir.
  - Admite plantillas estándar de Minecraft (64x32) y capas HD (128x64, 256x128, 512x256, 46x22, 92x44, etc.).
  - En el Launcher y Back Office, `skinview3d.loadCape(url)` actúa como canal de compatibilidad y renderizado 3D interactivo.
  - En Minecraft, CustomSkinLoader renderiza nativamente tanto capas clásicas como de alta resolución.
- **Seguridad en Backend**:
  - Validación básica obligatoria: formato PNG real (magic bytes `89 50 4E 47 0D 0A 1A 0A`), no vacío, decodificable con IHDR válido, y límites de tamaño (≤ 1 MB para skins, ≤ 5 MB para capas, hasta 10 capas personalizadas por jugador).

## Tooling
Todos los subproyectos de Minecraft se compilan bajo el multi-proyecto Gradle en `minecraft/` con Gradle Wrapper 8.10.2 y toolchain Java 21.
