# HiKAT Minecraft Subprojects

Minecraft components for the HiKAT ecosystem:

- `hikat-mod/`: Universal Minecraft mod (NeoForge 1.21.1) for client and dedicated server. Provides secure session validation, dynamic client integrity checking, and server verification.
- `gateway/`: Velocity Proxy Gateway intended for Fly.io deployment and dynamic routing.

## Requirements

- JDK 21
- Gradle 8.10+ (configured via Gradle Wrapper)

## Build Commands

```bash
# Build all minecraft projects (requires JDK 21)
./gradlew build

# Build individual subprojects
./gradlew :hikat-mod:build
./gradlew :gateway:build
```
