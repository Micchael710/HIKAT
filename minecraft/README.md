# HiKAT Minecraft Subprojects

Minecraft components for the HiKAT ecosystem:

- `client-mod/`: Client-side Minecraft mod (NeoForge 1.21.1) for secure session validation and game integration.
- `server-mod/`: Server-side Minecraft mod/plugin (NeoForge 1.21.1) for player verification.
- `gateway/`: Velocity Proxy Gateway intended for Fly.io deployment and dynamic routing.

## Requirements

- JDK 21
- Gradle 8.10+ (configured via Gradle Wrapper)

## Build Commands

```bash
# Build all minecraft projects (requires JDK 21)
./gradlew build

# Build individual subprojects
./gradlew :client-mod:build
./gradlew :server-mod:build
./gradlew :gateway:build
```
