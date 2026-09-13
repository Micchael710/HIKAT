# HiKAT Minecraft Subsystem

## Components & Responsibilities

### Integración de Skins y Capas (CustomSkinLoader)
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
