# HiKAT Launcher — Contexto de implementación
## Reestructuración de rutas de instalación + sistema de autoactualización

> Documento de contexto para continuar el desarrollo de HiKAT en otro chat.
> Repositorio: `https://github.com/Micchael710/HIKAT.git`
> Fecha de contexto: 18 de septiembre de 2026.

---

## 1. Objetivo general

El siguiente trabajo sobre HiKAT se divide en **dos fases principales**:

1. **Reestructurar la instalación y las rutas locales del launcher**, para que el usuario pueda elegir dónde instalar HiKAT y que todo el contenido pesado quede bajo una única raíz elegida por él.
2. **Implementar el sistema de autoactualización del launcher**, administrado desde el Back Office, almacenado en D1 + R2 y ejecutado automáticamente desde la splash screen antes de abrir el launcher.

La prioridad es mantener la arquitectura **simple, explícita y reutilizando lo que HiKAT ya tiene**. No crear servicios paralelos ni introducir capas innecesarias.

La filosofía durante el desarrollo debe ser:

- analizar el código existente antes de modificarlo;
- reutilizar GraphQL, D1, R2 y los servicios existentes;
- mantener el updater en Electron Main, no en React;
- centralizar las rutas en una única fuente de verdad;
- evitar prompts gigantes a Gemini;
- hacer cambios pequeños, comprobables y con tests;
- no introducir abstracciones innecesarias ni arquitectura “AI slop”.

---

# 2. Antes de implementar: analizar el repositorio actual

No asumir que este documento sustituye la revisión del código.

Al comenzar, primero hay que revisar el estado **más reciente** del repositorio y confirmar rama/commit actual. No trabajar basándose únicamente en nombres de archivos o fragmentos incluidos aquí si el proyecto ha cambiado.

## 2.1. Launcher: archivos que deben revisarse

Como mínimo:

```text
apps/launcher/package.json

apps/launcher/electron/main.cjs
apps/launcher/electron/preload.cjs
apps/launcher/electron/splash.html
apps/launcher/electron/settings-store.cjs
apps/launcher/electron/path-validator.cjs

apps/launcher/electron/game-launcher.cjs
apps/launcher/electron/game-operation-manager.cjs
apps/launcher/electron/client-files-sync.cjs
apps/launcher/electron/minecraft-core.cjs
apps/launcher/electron/java-runtime.cjs
apps/launcher/electron/xmcl-install-runtime.cjs

apps/launcher/src/services/gameService.ts
apps/launcher/src/services/apiClient.ts
apps/launcher/src/components/server/DownloadPlayButton.tsx
apps/launcher/src/views/SettingsView.tsx
```

Buscar específicamente:

```text
appDataRoot
app.getPath("appData")
userData
gamesRoot
instanceRoot
javaStorageRoot
runtime
gameId
gameName
process.execPath
```

## 2.2. Back Office

Revisar:

```text
apps/backoffice/src/App.tsx
apps/backoffice/src/components/layout/BackofficeSidebar.tsx
apps/backoffice/src/types/index.ts
apps/backoffice/src/services/graphqlClient.ts
apps/backoffice/src/services/gameFileUploadService.ts
```

También revisar la implementación actual de:

- subida directa a R2;
- cálculo incremental de hashes;
- publicación de releases;
- historial de releases;
- navegación global vs workspace de servidor.

## 2.3. Backend, GraphQL y D1

Revisar:

```text
packages/database/src/schema/*
packages/database/migrations/*

packages/graphql/src/schema/game.ts
packages/graphql/src/schema/settings.ts
packages/graphql/src/schema/index.ts

services/backend/src/index.ts
services/backend/src/resolvers/*
services/backend/src/services/r2CredentialsService.ts

services/backend/src/services/game/releaseService.ts
services/backend/src/services/game/gameFileService.ts
services/backend/src/services/game/gameStorageService.ts
```

Confirmar cómo funcionan actualmente:

```text
Back Office
    ↓
GraphQL
    ↓
credenciales temporales R2
    ↓
upload directo del navegador → R2
    ↓
GraphQL complete
    ↓
D1
```

Ese patrón debe reutilizarse para las releases del launcher.

---

# 3. Estado actual verificado del sistema de rutas

Actualmente el launcher tiene una raíz fija similar a:

```js
const appDataRoot = path.join(app.getPath("appData"), "HiKAT")
```

y de ella salen:

```text
%APPDATA%\HiKAT\games
%APPDATA%\HiKAT\game files    (legacy)
%APPDATA%\HiKAT\runtime
```

En `main.cjs` los usos importantes de `appDataRoot` están bastante concentrados.

Actualmente se utiliza directamente para:

- `app.setPath("userData", ...)`;
- `gamesRoot`;
- legacy `game files`;
- `GameLauncher.javaStorageRoot`;
- `game-check-plan`;
- `game-start-sync`;
- validación segura de `game-uninstall`.

Esto significa que **no es necesario reescribir todo el launcher**.

---

# 4. Verificación: mover la raíz NO rompe el sistema multiserver

Este punto ya fue revisado en el código actual.

## 4.1. Resolución de servidores

El launcher utiliza:

```text
gameId + gameName
```

y `resolveGameContext()` termina generando:

```text
gamesRoot / gameName
```

Por ejemplo:

```text
HiKAT/
└── games/
    ├── Meliora/
    ├── IndustrialCraft/
    └── SurvivalPlus/
```

Por tanto, cambiar:

```text
%APPDATA%\HiKAT\games
```

por:

```text
<RUTA_ELEGIDA>\HiKAT\games
```

no cambia la lógica multiserver.

Solo cambia el valor de `gamesRoot`.

---

## 4.2. Sistema de descargas

`game-operation-manager.cjs` recibe explícitamente:

```text
instanceRoot
javaStorageRoot
clientFiles
directoryPolicies
modpackVersion
...
```

El sistema de descarga no depende internamente de `%APPDATA%`.

Los archivos de cada servidor se descargan utilizando su `instanceRoot`.

Por tanto:

```text
D:\HiKAT\games\Meliora
```

funciona igual que:

```text
%APPDATA%\HiKAT\games\Meliora
```

si el root se resuelve correctamente.

---

## 4.3. Staging, pausa y reanudación

`client-files-sync.cjs` utiliza:

```text
instanceRoot/.hikat/staging
instanceRoot/.hikat/staging/files
instanceRoot/.hikat/staging/download-session.json
```

Cada servidor mantiene su staging dentro de su propia instancia.

Mover `gamesRoot` no rompe:

- descarga;
- pausa;
- reanudación;
- cancelación;
- actualización;
- instalación atómica.

---

## 4.4. Manifest de archivos

Cada instalación guarda:

```text
instanceRoot/.hikat/installed-manifest.json
```

La verificación compara ese manifest contra los archivos reales de esa misma instancia.

Por tanto, la integridad sigue siendo por servidor y no depende de AppData.

---

## 4.5. Verificación de integridad

Las funciones de integridad reciben `instanceRoot`.

Entre otras cosas validan:

- archivos protegidos;
- SHA;
- directorios;
- políticas `MODIFICABLE` / `NO_MODIFICABLE`;
- symlinks/junctions;
- contenido no autorizado.

La ubicación física de la raíz no afecta esas reglas.

---

## 4.6. Lanzamiento de Minecraft

`GameLauncher.launch()` recibe:

```text
gameId
gameName
instanceRoot
...
```

y calcula:

```text
effectiveInstanceRoot = instanceRoot || this.instanceRoot
```

El juego se ejecuta utilizando la instancia recibida.

Por tanto, el lanzamiento también puede funcionar desde cualquier unidad/ruta.

---

## 4.7. Runtime Java

El runtime ya trabaja a partir de `javaStorageRoot`.

Actualmente termina resolviendo algo equivalente a:

```text
<ROOT>/runtime/java/<majorVersion>
```

Por tanto, puede utilizar:

```text
D:\HiKAT\runtime\java\21
```

sin depender de AppData.

Hay que sustituir de forma consistente los lugares de `main.cjs` que todavía pasan el antiguo `appDataRoot`.

---

## 4.8. Único punto crítico detectado: uninstall

Actualmente la desinstalación de una instancia hace una comprobación de seguridad similar a:

```text
instanceRoot debe estar dentro de appDataRoot
```

Esto es correcto como protección, pero al mover los juegos dejaría de cumplirse.

Debe cambiarse a:

```text
instanceRoot debe estar dentro del HiKAT root actual
```

o, preferiblemente:

```text
instanceRoot debe estar dentro de gamesRoot
```

Nunca eliminar esta validación.

No reemplazarla por un `rm -rf` sin límites.

---

# 5. Separar dos conceptos: instalación y estado privado

La nueva ruta elegida por el usuario será para la aplicación y los datos pesados:

```text
<BASE>\HiKAT\
├── Launcher\
├── games\
└── runtime\
```

Pero **no se debe mover todo el estado privado de Electron**.

Mantener en AppData:

```text
%APPDATA%\HiKAT\launcher\
```

para elementos pequeños como:

- configuración local;
- credenciales;
- tokens;
- sesión;
- estado de autenticación;
- cola persistente;
- PID/estado pequeño del proceso;
- preferencias del launcher.

Esto separa correctamente:

```text
INSTALACIÓN / DATOS PESADOS
<RUTA>\HiKAT\...

ESTADO PRIVADO DEL USUARIO
%APPDATA%\HiKAT\launcher\...
```

No almacenar credenciales dentro de `games` o `runtime`.

---

# 6. Estructura final deseada

Si el usuario selecciona, por ejemplo:

```text
D:\
```

se debe crear:

```text
D:\HiKAT\
├── Launcher\
│   ├── HiKAT Launcher.exe
│   ├── resources\
│   └── ...
│
├── games\
│   ├── Servidor A\
│   ├── Servidor B\
│   └── Servidor C\
│
└── runtime\
    └── java\
        ├── 17\
        └── 21\
```

Si selecciona:

```text
C:\Program Files
```

el resultado deseado es:

```text
C:\Program Files\HiKAT\
├── Launcher\
├── games\
└── runtime\
```

El usuario selecciona **el directorio padre**.

El instalador añade automáticamente:

```text
HiKAT
```

y construye las subcarpetas.

---

# 7. IMPORTANTE: caso Program Files

`C:\Program Files` está protegido por Windows.

Minecraft, mods, configuraciones y runtimes necesitan escritura continua.

Por tanto, NO se puede simplemente colocar:

```text
C:\Program Files\HiKAT\games
C:\Program Files\HiKAT\runtime
```

y esperar que un proceso sin privilegios pueda escribir.

## Decisión arquitectónica para conservar la estructura solicitada

Si el usuario escoge un directorio protegido:

```text
C:\Program Files
```

el instalador debe:

1. instalar `Launcher` normalmente con permisos protegidos;
2. crear `games`;
3. crear `runtime`;
4. conceder permiso de modificación/escritura al usuario normal únicamente sobre:
   - `HiKAT\games`;
   - `HiKAT\runtime`;
5. NO dar permisos amplios de escritura sobre:
   - `HiKAT\Launcher`;
   - el directorio completo `HiKAT`.

La aplicación **no debe ejecutarse siempre como administrador**.

El updater/instalador podrá solicitar elevación cuando Windows lo necesite para reemplazar archivos en `Launcher`.

Si aparece UAC por estar instalado en Program Files, ese diálogo pertenece a Windows. No se debe agregar un botón propio de “Continuar actualización”.

Antes de implementar los ACL/permisos, verificar la opción más simple y segura disponible con la versión elegida de electron-builder/NSIS.

---

# FASE 1 — Instalador + raíz configurable

## 8. Objetivo

Eliminar la dependencia de `%APPDATA%\HiKAT` como ubicación de:

- juegos;
- runtimes;
- archivos del launcher.

Crear una única fuente de verdad para las rutas.

---

## 9. Añadir packaging real

Actualmente el proyecto debe revisarse para confirmar que todavía no tenga configuración final de `electron-builder`.

La fase debe producir un instalador real:

```text
HiKAT Launcher Setup <version>.exe
```

Usar:

```text
electron-builder
NSIS
```

El instalador debe ser asistido, no one-click, para permitir elegir ubicación.

Conceptualmente:

```text
oneClick: false
allowToChangeInstallationDirectory: true
```

Pero el requerimiento de HiKAT es más específico que el selector estándar:

```text
usuario elige PADRE
        ↓
instalador crea PADRE\HiKAT\Launcher
                         \games
                         \runtime
```

Por tanto, analizar la forma mínima de lograrlo con la personalización NSIS de electron-builder.

No reemplazar el script NSIS completo si basta un `include`/macro pequeño.

---

# 10. Crear un único resolver de rutas

Crear una pieza pequeña, por ejemplo:

```text
apps/launcher/electron/install-paths.cjs
```

Nombre final a criterio del proyecto.

Debe ser la única fuente de verdad para:

```text
HiKAT root
Launcher root
games root
runtime root
legacy root (solo si aún hace falta)
```

Conceptualmente:

```text
getHiKatRoot()
getLauncherRoot()
getGamesRoot()
getRuntimeRoot()
```

## Producción

El launcher puede derivar la instalación a partir de su propia ubicación.

Ejemplo:

```text
process.execPath
=
D:\HiKAT\Launcher\HiKAT Launcher.exe
```

Entonces:

```text
launcherRoot = D:\HiKAT\Launcher
hikatRoot    = D:\HiKAT
gamesRoot    = D:\HiKAT\games
runtimeRoot  = D:\HiKAT\runtime
```

Evitar que la única fuente de verdad sea un JSON con una ruta absoluta si se puede deducir de la instalación real.

## Desarrollo

Debe existir un fallback claro para desarrollo.

Puede utilizarse:

```text
HIKAT_ROOT
```

o el root antiguo de AppData.

No crear condiciones dispersas por diferentes archivos.

---

# 11. Sustituciones obligatorias en main.cjs

Después de crear el resolver, revisar todos los usos actuales de:

```text
appDataRoot
gamesRoot
legacyInstanceRoot
javaStorageRoot
```

En particular:

### Mantener AppData para userData

Esto puede seguir existiendo:

```text
app.setPath("userData", "%APPDATA%/HiKAT/launcher")
```

No confundir `userData` con `HiKAT root`.

### Cambiar games

```text
getGamesRoot()
```

debe devolver:

```text
<HiKAT root>/games
```

### Java

Todos los lugares que actualmente pasan:

```text
javaStorageRoot: appDataRoot
```

deben pasar el nuevo root correcto.

### Uninstall

Cambiar:

```text
uninstallGame(instanceRoot, appDataRoot)
```

por una validación contra:

```text
gamesRoot
```

o el root canónico correspondiente.

---

# 12. No romper el aislamiento multiserver

La forma actual:

```text
resolveGameContext({
  gameId,
  gameName
})
```

debe mantenerse.

Resultado:

```text
gamesRoot/gameName
```

No hacer que varios servidores compartan un único directorio de instancia.

Ejemplo:

```text
HiKAT/games/Meliora
HiKAT/games/Industrial
HiKAT/games/Survival
```

Cada uno conserva:

```text
.hikat/
installed-manifest.json
staging/
download-session.json
session.json
```

---

# 13. Compatibilidad con instalaciones antiguas

Antes de crear una migración automática, determinar si HiKAT ya tiene usuarios reales con juegos descargados en:

```text
%APPDATA%\HiKAT\games
```

Si todavía no hay una distribución estable, evitar introducir una migración compleja innecesaria.

Si sí existen instalaciones reales, tratar la migración como tarea explícita:

```text
oldRoot → newRoot
```

No mezclar simultáneamente dos roots para una misma instancia.

No mover decenas de GB silenciosamente sin una estrategia definida.

---

# 14. Tests obligatorios de Fase 1

No considerar terminada la fase solo porque el launcher abre.

Probar como mínimo:

## Instalación

- instalar en una ruta normal;
- instalar en otra unidad;
- instalar en ruta con espacios;
- instalar bajo Program Files;
- reiniciar launcher;
- verificar que conserva la ruta correcta.

## Estructura

Comprobar:

```text
HiKAT/Launcher
HiKAT/games
HiKAT/runtime
```

## Multiserver

Crear/usar tres servidores:

```text
Server A
Server B
Server C
```

Comprobar que:

```text
games/Server A
games/Server B
games/Server C
```

son independientes.

## Descargas

En cada servidor probar:

- descarga inicial;
- pausa;
- reanudación;
- cancelación;
- actualización;
- staging;
- commit final.

## Integridad

Probar:

- manifest;
- SHA;
- archivo faltante;
- archivo modificado;
- directorios protegidos;
- policies;
- symlinks/junctions;
- reparación.

## Java

Confirmar:

```text
HiKAT/runtime/java/...
```

y que todos los servidores puedan reutilizar los runtimes correctos.

## Lanzamiento

Confirmar que XMCL usa el `instanceRoot` correcto para cada servidor.

## Uninstall

Desinstalar Server B.

Debe eliminar solamente:

```text
games/Server B
```

y conservar A y C.

También verificar que la protección de path traversal continúa funcionando.

## Estado privado

Confirmar que auth/settings continúan en:

```text
%APPDATA%\HiKAT\launcher
```

y que no aparecen dentro de `games`.

---

# 15. Criterio de cierre de Fase 1

La fase está terminada cuando:

- existe instalador NSIS real;
- el usuario puede elegir ubicación;
- el instalador crea el árbol HiKAT;
- `Launcher`, `games` y `runtime` quedan en la nueva raíz;
- AppData solo conserva estado privado;
- tres servidores pueden descargar/verificar/lanzar sin interferirse;
- Java funciona desde el nuevo runtime;
- uninstall es seguro;
- Program Files funciona sin ejecutar permanentemente el launcher como administrador;
- tests existentes siguen pasando;
- tests nuevos de paths pasan.

---

# FASE 2 — Autoactualización del launcher

# 16. Objetivo UX

El flujo debe ser **completamente automático**.

NO debe existir:

```text
Actualizar ahora
Instalar
Continuar
Reiniciar
Más tarde
```

cuando ya se detectó una versión nueva.

Flujo:

```text
Usuario abre HiKAT
        ↓
Splash
        ↓
comprobar actualización
        ↓
  ┌─────┴─────┐
  │           │
no update   update
  │           │
  │         ocultar beam
  │           │
  │         barra progreso
  │           │
  │         descargar
  │           │
  │         verificar
  │           │
  │         instalar
  │           │
  │         reiniciar
  │           │
  └──────→ Launcher actualizado
```

Si existe una actualización:

1. no abrir la ventana principal;
2. no pedir confirmación;
3. descargar automáticamente;
4. instalar automáticamente;
5. cerrar el proceso viejo;
6. abrir el launcher actualizado.

La única interacción externa que podría aparecer es UAC de Windows cuando la ubicación/per-machine installation requiera elevación.

---

# 17. La splash pasa a ser bootstrap real

Actualmente revisar el comportamiento de:

```text
createSplashWindow()
createWindow()
```

porque la ventana principal se crea mientras la splash está visible.

Eso debe cambiar.

Nuevo orden conceptual:

```text
app.whenReady()
    ↓
createSplashWindow()
    ↓
runLauncherUpdateBootstrap()
    ↓
si update:
    descargar
    instalar
    salir/reiniciar

si no update:
    iniciar OAuth
    iniciar watchers
    createWindow()
```

No inicializar subsistemas innecesarios si el proceso va a cerrarse para actualizar.

---

# 18. Updater en Electron Main

La lógica de actualización NO debe vivir en:

```text
React
LauncherView
App.tsx
```

Debe vivir en Electron Main, por ejemplo:

```text
electron/launcher-updater.cjs
```

o nombre equivalente.

Responsabilidades:

```text
check
download
progress
install
restart
error handling
```

La splash solo representa el estado.

---

# 19. Usar electron-updater, no un updater manual

No copiar la estrategia antigua de launchers que hacen:

```text
axios download .exe
spawn(installer.exe)
app.quit()
```

HiKAT debe utilizar:

```text
electron-builder
electron-updater
NSIS
```

La finalidad es evitar implementar manualmente:

- reemplazo de binarios;
- archivos bloqueados;
- checksums;
- recuperación;
- ubicación del instalador;
- reinicio;
- firma;
- lógica de instalación.

Antes de fijar versiones, revisar compatibilidad entre:

```text
Electron actual del repo
electron-builder
electron-updater
```

No instalar versiones al azar.

---

# 20. Actualización totalmente automática

Configurar el updater de manera que:

```text
autoDownload = true
```

o equivalente según la versión utilizada.

Eventos importantes:

```text
checking-for-update
update-available
update-not-available
download-progress
update-downloaded
error
```

Cuando llegue:

```text
update-downloaded
```

llamar automáticamente al flujo de instalación.

Con las versiones actuales de electron-updater, revisar la firma exacta disponible de:

```text
quitAndInstall(...)
```

El comportamiento deseado es equivalente a:

```text
silent install
force run after install
```

para que:

```text
descarga → instalación → reapertura
```

ocurra sin botones propios.

Si la instalación es per-machine bajo Program Files puede aparecer UAC.

---

# 21. Progreso en splash

La splash actual tiene un beam animado alrededor.

Estados mínimos:

```text
LOADING
UPDATING
ERROR/RECOVERY si hiciera falta
```

## LOADING

Mantener:

```text
logo
beam animado
```

## UPDATING

Ocultar el beam y mostrar debajo del logo:

```text
Actualizando HiKAT

██████████████░░░░░░░

184 MB / 312 MB
59 %
23.8 MB/s
```

electron-updater ya ofrece datos equivalentes a:

```text
bytesPerSecond
percent
total
transferred
```

No recalcularlos desde React.

---

# 22. Bridge mínimo para splash

La splash usa context isolation.

No usar `executeJavaScript()` para manipularla.

Crear un preload pequeño, por ejemplo:

```text
electron/splash-preload.cjs
```

Exponer solo eventos necesarios:

```text
onUpdateState
onUpdateProgress
```

Flujo:

```text
electron-updater
      ↓
Electron Main
      ↓
IPC
      ↓
splash-preload
      ↓
splash.html
```

No exponer APIs generales de Node a la splash.

---

# 23. Back Office: nuevo apartado global Launcher

Actualmente el Back Office distingue:

```text
GLOBAL
- Servidores
- Skins
- Configuración
```

y:

```text
SERVER WORKSPACE
- Dashboard
- Noticias
- Servidor
- Juego
- Ajustes del servidor
```

Agregar:

```text
GLOBAL
- Servidores
- Skins
- Launcher
- Configuración
```

Modificar el tipo global correspondiente, por ejemplo:

```text
BackofficeGlobalSection
```

para incluir:

```text
"launcher"
```

Este apartado NO pertenece a ningún servidor.

---

# 24. Pantalla Launcher del Back Office

Mantenerla simple.

Ejemplo:

```text
Launcher

VERSIÓN PUBLICADA

HiKAT Launcher 1.3.0
Publicado: ...
Tamaño: ...

--------------------------------

NUEVA RELEASE

Versión
[ 1.4.0 ]

Notas
[ ... ]

Instalador
[ HiKAT Launcher Setup 1.4.0.exe ]

[ Publicar / Subir ]

--------------------------------

HISTORIAL

1.3.0  PUBLICADA
1.2.1  ARCHIVADA
1.2.0  ARCHIVADA
```

No copiar todo el explorador de archivos del sistema de releases de Minecraft.

Una release del launcher es mucho más simple.

---

# 25. Nuevo modelo D1

No reutilizar:

```text
game_releases
```

y no reutilizar semánticamente el actual:

```text
launcherActiveReleaseId
```

porque en el código existente ese campo está relacionado con releases del juego/modpack.

Crear una entidad independiente:

```text
launcher_releases
```

Campos recomendados:

```text
id
version
status
filename
objectKey
sizeBytes
sha512
sha256        opcional pero útil
notes
createdBy
createdAt
publishedAt
```

Estados:

```text
DRAFT
PUBLISHED
ARCHIVED
```

Solo una release debe considerarse publicada/activa.

Al publicar una nueva:

```text
anterior PUBLISHED → ARCHIVED
nueva             → PUBLISHED
```

Validar SemVer y evitar versiones duplicadas.

---

# 26. R2

Usar el bucket existente.

Estructura sugerida:

```text
launcher/
└── releases/
    ├── 1.0.0/
    │   └── HiKAT Launcher Setup 1.0.0.exe
    ├── 1.1.0/
    │   └── HiKAT Launcher Setup 1.1.0.exe
    └── 1.2.0/
        └── HiKAT Launcher Setup 1.2.0.exe
```

El Back Office debe reutilizar:

```text
credenciales R2 temporales
multipart upload
hash incremental
complete/finalize
```

No subir binarios grandes a través de GraphQL.

---

# 27. Hashes del updater

electron-updater utiliza metadata con SHA-512.

Como el administrador quiere subir principalmente:

```text
.exe
```

el Back Office puede calcular de forma incremental:

```text
SHA-512
```

antes/durante la subida y almacenar el resultado en D1.

Puede conservarse también SHA-256 para consistencia y verificaciones internas.

No obligar al administrador a crear manualmente un YAML.

---

# 28. Endpoint de actualización

Aunque HiKAT utiliza GraphQL como API principal, **no hay que forzar electron-updater a utilizar GraphQL**.

El backend actual ya tiene rutas HTTP para binarios, por ejemplo el patrón:

```text
/game/download/:fileId
```

El updater puede utilizar un proveedor HTTP genérico:

```text
/launcher/update/latest.yml
/launcher/update/<artifact>
```

Esto sigue siendo el mismo backend, D1 y R2.

No es una arquitectura nueva.

## latest.yml

El backend puede generarlo dinámicamente utilizando la release PUBLISHED almacenada en D1.

Conceptualmente:

```text
GET /launcher/update/latest.yml
        ↓
D1 launcher_releases
        ↓
release PUBLISHED
        ↓
metadata compatible con electron-updater
```

El administrador no tiene que subir `latest.yml` manualmente.

---

# 29. Primera consulta al arrancar

La primera operación externa importante del launcher debe ser el chequeo de actualización.

No es necesario hacer:

```text
GraphQL latestLauncherRelease
+
electron-updater latest.yml
```

si eso duplica la misma comprobación.

La arquitectura más simple es que:

```text
electron-updater
```

consulte directamente:

```text
/launcher/update/latest.yml
```

y ese endpoint obtenga su información de D1.

GraphQL se utiliza para administración desde Back Office.

Si posteriormente la UI necesita mostrar metadata adicional, puede existir una query pública, pero no debe duplicarse sin necesidad.

---

# 30. Servir binario desde R2

El bucket no tiene que exponerse de forma general.

Flujo:

```text
electron-updater
      ↓
Backend Worker
      ↓
R2
```

Crear una ruta de descarga controlada.

Reutilizar conceptos del actual `gameStorageService`:

- `Content-Length`;
- `Accept-Ranges`;
- ETag;
- cache;
- Range;
- objeto permitido;
- release publicada.

Solo permitir descargar artefactos válidos de releases permitidas.

---

# 31. Comportamiento si no hay Internet

El launcher siempre debe **intentar** comprobar actualización antes de abrir.

Pero un error temporal de:

```text
Internet
backend
R2
```

no debe dejar al usuario permanentemente sin launcher.

Comportamiento recomendado para MVP:

```text
update comprobada y disponible
→ actualización obligatoria automática

no se pudo comprobar por fallo temporal
→ registrar error y continuar con versión actual
```

Más adelante se puede introducir:

```text
minimumSupportedVersion
```

si se necesita bloquear versiones incompatibles.

---

# 32. Versión real del launcher

El `version` de:

```text
apps/launcher/package.json
```

deja de ser decorativo.

Debe coincidir con el artefacto publicado.

Ejemplo:

```text
package.json = 1.4.0
```

produce:

```text
HiKAT Launcher Setup 1.4.0.exe
```

y:

```text
app.getVersion() = 1.4.0
```

La release del Back Office debe utilizar la misma versión.

Evitar publicar:

```text
artifact 1.4.0
D1 1.4.1
```

---

# 33. Firma de código

No es obligatorio resolver la firma comercial durante el primer desarrollo del updater.

Pero la arquitectura debe quedar preparada para:

```text
HTTPS
SHA-512
firma Authenticode
```

en producción.

No desactivar permanentemente validaciones de seguridad solo para facilitar desarrollo.

---

# 34. Actualizaciones diferenciales

NO implementar blockmaps/differential download como primera versión.

Primero conseguir:

```text
detectar
descargar
mostrar progreso
verificar
instalar
reiniciar
```

Después, si el tamaño del launcher lo justifica, se puede añadir descarga diferencial.

No convertir el MVP en una arquitectura innecesariamente compleja.

---

# 35. Tests obligatorios de Fase 2

## Back Office

- crear release;
- validar SemVer;
- rechazar duplicados;
- subir instalador;
- comprobar hash;
- publicar;
- archivar anterior;
- historial correcto.

## Backend

- `latest.yml` corresponde a release publicada;
- binario inexistente → 404;
- release no publicada → no se sirve como latest;
- Range funciona;
- tamaño/hash correctos;
- R2 sin objeto → fallo seguro.

## Launcher

Probar:

```text
local 1.0.0
remote 1.0.0
→ abre normalmente
```

```text
local 1.0.0
remote 1.1.0
→ splash updating
→ descarga
→ 100 %
→ instala
→ reabre 1.1.0
```

También:

- backend temporalmente caído;
- descarga interrumpida;
- archivo corrupto;
- cierre durante descarga;
- instalación bajo ruta personalizada;
- instalación en otra unidad;
- instalación bajo Program Files;
- reinicio posterior;
- single-instance lock;
- updater no abre dos launchers;
- actualización conserva `games`;
- actualización conserva `runtime`;
- actualización conserva AppData/auth/settings.

MUY IMPORTANTE:

Actualizar:

```text
HiKAT/Launcher
```

NO debe borrar ni modificar:

```text
HiKAT/games
HiKAT/runtime
```

---

# 36. Criterio de cierre de Fase 2

La fase termina cuando:

- existe sección global Launcher en Back Office;
- las releases se guardan en D1;
- binarios van a R2;
- el launcher comprueba update antes de abrir main window;
- la splash cambia de beam a progress bar;
- muestra:
  - porcentaje;
  - transferido;
  - total;
  - velocidad;
- la descarga es automática;
- instalación automática;
- no existen botones de confirmación de HiKAT;
- se reinicia automáticamente en la nueva versión;
- `games` y `runtime` sobreviven intactos;
- rutas personalizadas siguen funcionando;
- tests existentes y nuevos pasan.

---

# 37. Arquitectura final resumida

```text
                        BACK OFFICE
                            │
                         GraphQL
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
            D1                            R2
     launcher_releases          launcher/releases/*
             ▲                             ▲
             │                             │
             └──────── Backend Worker ─────┘


PLAYER

HiKAT Launcher.exe
        │
        ▼
Splash
        │
        ▼
Electron Main / electron-updater
        │
        ▼
/launcher/update/latest.yml
        │
        ▼
Backend → D1
        │
        ├── misma versión
        │      ↓
        │   abrir launcher
        │
        └── nueva versión
               ↓
          Splash UPDATING
               ↓
        Backend → R2
               ↓
            descarga
               ↓
            SHA/check
               ↓
        quitAndInstall
               ↓
             NSIS
               ↓
       launcher actualizado
               ↓
       abrir nueva versión
```

---

# 38. Arquitectura final de filesystem

```text
<RUTA ELEGIDA>\
└── HiKAT\
    ├── Launcher\
    │   └── aplicación Electron
    │
    ├── games\
    │   ├── Server A\
    │   │   └── .hikat\
    │   ├── Server B\
    │   │   └── .hikat\
    │   └── Server C\
    │       └── .hikat\
    │
    └── runtime\
        └── java\
            ├── 17\
            └── 21\


%APPDATA%\
└── HiKAT\
    └── launcher\
        ├── settings
        ├── auth
        ├── session
        ├── queue state
        └── process state
```

---

# 39. Cómo trabajar con Gemini

NO entregar un prompt enorme que diga:

> "Implementa todo el instalador, las rutas, el updater, D1, R2, GraphQL y Back Office."

Eso aumenta el riesgo de cambios excesivos y arquitectura innecesaria.

Trabajar en cambios pequeños.

Cada prompt debe incluir:

```text
1. analiza archivos concretos;
2. implementa solo ese objetivo;
3. no refactorices áreas no relacionadas;
4. conserva compatibilidad existente;
5. añade/actualiza tests;
6. ejecuta build/typecheck/tests relevantes;
7. reporta archivos cambiados y resultado.
```

---

# 40. Prompts pequeños sugeridos

## FASE 1 — Prompt 1A: auditoría y resolver de rutas

```text
Analiza el estado actual del launcher HiKAT, especialmente main.cjs, game-launcher.cjs,
game-operation-manager.cjs, client-files-sync.cjs, minecraft-core.cjs y java-runtime.cjs.

Objetivo: centralizar las rutas del launcher en una única fuente de verdad sin cambiar
todavía el instalador.

La nueva estructura será:
<HiKAT root>/Launcher
<HiKAT root>/games
<HiKAT root>/runtime

Mantén %APPDATA%/HiKAT/launcher únicamente para userData/estado privado.

Verifica todos los usos actuales de appDataRoot, gamesRoot, instanceRoot y
javaStorageRoot. Implementa el resolver mínimo necesario y adapta únicamente los
consumidores requeridos. La validación segura de uninstall debe comprobar gamesRoot,
no eliminarse.

No hagas refactors no relacionados. Mantén multiserver, staging, manifests,
integridad y Java funcionando. Añade tests y ejecuta los checks relevantes.
Al final reporta exactamente qué cambió y cualquier riesgo pendiente.
```

## FASE 1 — Prompt 1B: packaging e instalador

```text
Sobre el código ya refactorizado de rutas, configura el packaging Windows de HiKAT con
electron-builder + NSIS.

El instalador debe ser asistido y permitir al usuario elegir el directorio PADRE.
Si selecciona D:\, debe quedar:
D:\HiKAT\Launcher
D:\HiKAT\games
D:\HiKAT\runtime

No sustituyas todo el script NSIS si basta una personalización pequeña.

Ten en cuenta Program Files: Launcher debe permanecer protegido y games/runtime deben
poder ser escritos por el usuario sin ejecutar HiKAT permanentemente como administrador.
Investiga y usa el mecanismo mínimo y seguro para esos permisos.

Verifica que una instalación en ruta personalizada conserva correctamente la ubicación
y que el launcher resuelve su HiKAT root desde la instalación real. Añade los tests o
scripts de verificación posibles y reporta resultados.
```

## FASE 1 — Prompt 1C: cierre/regresión

```text
Haz una revisión de regresión de la Fase 1.

Comprueba específicamente tres contextos de juego distintos y verifica que cada uno
resuelva <HiKAT root>/games/<gameName>. Revisa descarga, staging, manifest, integridad,
Java compartido, launch y uninstall.

Busca cualquier uso restante del antiguo %APPDATA%/HiKAT como raíz de games/runtime.
AppData solo debe conservar userData/estado privado.

No añadas nuevas funcionalidades. Corrige únicamente regresiones reales, ejecuta tests,
typecheck/build y entrega un reporte final corto con archivos cambiados y estado.
```

---

## FASE 2 — Prompt 2A: backend + Back Office

```text
Analiza el sistema actual de releases de juego, upload directo a R2, GraphQL, D1 y
navegación global del Back Office.

Implementa únicamente la administración de releases del BINARIO del launcher.

Debe existir una entidad separada launcher_releases. No reutilices game_releases ni
launcherActiveReleaseId del modpack.

Añade una sección global "Launcher" en el Back Office para subir un instalador .exe,
definir versión SemVer/notas, publicar una versión y ver historial.

Reutiliza las credenciales temporales R2 y multipart upload existentes. El binario debe
ir a launcher/releases/<version>/... y D1 guardar metadata, size y SHA-512.

Implementa el endpoint HTTP mínimo que electron-updater necesitará para obtener metadata
latest.yml y descargar el artefacto desde R2.

No implementes todavía la lógica Electron del updater. Añade tests y reporta cambios.
```

## FASE 2 — Prompt 2B: bootstrap updater + splash

```text
Implementa el auto-updater del launcher usando electron-updater sobre el backend ya
preparado.

La comprobación debe ocurrir desde Electron Main durante la splash y ANTES de crear la
ventana principal.

Si no hay update, continuar startup normal.
Si hay update:
- ocultar el beam de la splash;
- mostrar barra de progreso;
- mostrar transferred/total, porcentaje y velocidad;
- descargar automáticamente;
- al terminar, instalar automáticamente;
- reiniciar automáticamente la nueva versión.

No debe existir botón Actualizar, Continuar, Instalar o Más tarde.

Crea un preload mínimo separado para la splash y transmite solo estado/progreso por IPC.
No pongas la lógica del updater en React.

Un fallo temporal al comprobar updates no debe corromper ni borrar la instalación.
La actualización de Launcher no puede modificar HiKAT/games ni HiKAT/runtime.

Añade tests posibles, prueba build empaquetado y reporta archivos/resultados.
```

## FASE 2 — Prompt 2C: cierre/regresión

```text
Haz una revisión final del sistema de autoactualización HiKAT.

Verifica:
1. misma versión → launcher abre normal;
2. nueva versión → descarga, progreso, instalación y reapertura automáticos;
3. ruta personalizada se conserva;
4. games/runtime sobreviven intactos;
5. auth/settings en AppData sobreviven;
6. error de red no corrompe instalación;
7. latest.yml y artefacto corresponden a la release PUBLISHED;
8. no hay updater manual duplicado ni lógica de update en React.

No hagas refactors cosméticos. Corrige solo fallos reales, ejecuta tests/build y entrega
reporte final.
```

---

# 41. Restricciones para el siguiente chat

El siguiente chat NO debe:

- inventar otra API;
- crear otro almacenamiento;
- usar GitHub Releases si R2 ya resuelve el problema;
- reemplazar GraphQL;
- mezclar releases del launcher con releases del modpack;
- meter `games` dentro de `Launcher`;
- guardar auth dentro de la ruta elegida;
- ejecutar HiKAT permanentemente como admin;
- eliminar validaciones de paths;
- crear un updater manual con Axios + spawn;
- abrir la ventana principal antes de terminar el check de update;
- pedir confirmación para instalar una actualización detectada;
- implementar differential updates en el MVP;
- introducir una mega-clase que administre updater + Minecraft + R2 + rutas;
- hacer refactors no relacionados con estas dos fases.

---

# 42. Decisiones ya tomadas

Estas decisiones no necesitan volver a discutirse salvo que el código actual demuestre
un bloqueo técnico real:

1. La raíz de instalación será seleccionable.
2. La estructura será:

```text
HiKAT/Launcher
HiKAT/games
HiKAT/runtime
```

3. AppData se conserva solo para estado privado.
4. Multiserver sigue usando una instancia por `gameName`.
5. El sistema actual de sync/integridad se conserva.
6. La actualización del launcher es global, no por servidor.
7. Habrá una sección global Launcher en Back Office.
8. Los binarios del launcher irán a R2.
9. La metadata de releases irá a D1.
10. La administración irá por GraphQL.
11. El transporte de metadata/binario para electron-updater puede usar endpoints HTTP
    del mismo backend.
12. Se usará electron-builder + NSIS.
13. Se usará electron-updater.
14. La comprobación ocurre durante la splash.
15. Si existe update, es automática.
16. No hay botones de confirmación.
17. Tras instalar, el launcher se abre actualizado.
18. La actualización no debe tocar `games` ni `runtime`.
19. Program Files debe manejarse sin obligar al launcher a ejecutarse siempre elevado.
20. El desarrollo debe hacerse con prompts pequeños y cambios acotados.

---

# 43. Resultado esperado al finalizar ambas fases

Desde la perspectiva del jugador:

```text
1. Descarga HiKAT Setup.
2. Elige dónde instalarlo.
3. El instalador crea HiKAT/Launcher + games + runtime.
4. Abre HiKAT.
5. La splash comprueba actualizaciones.
6. Si está actualizado, abre normalmente.
7. Si existe una nueva versión:
   - aparece progreso;
   - se descarga;
   - se instala;
   - HiKAT se reinicia;
   - aparece ya actualizado.
8. Sus juegos, runtimes, configuración y sesión permanecen intactos.
```

Desde la perspectiva del administrador:

```text
Back Office
    ↓
Launcher
    ↓
Nueva versión
    ↓
subir .exe
    ↓
R2
    ↓
publicar
    ↓
D1 marca nueva release
    ↓
todos los launchers la detectan al siguiente arranque
```

Ese es el alcance de estas dos fases.
