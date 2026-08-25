# HiKAT Minecraft Subsystem

## Component Matrix

| Subproject   | Target Framework | Runtime Version       | Deployment Target      | Purpose                                  |
| ------------ | ---------------- | --------------------- | ---------------------- | ---------------------------------------- |
| `client-mod` | NeoForge         | Minecraft Java 1.21.1 | Launcher Game Client   | Session validation & in-game telemetry   |
| `server-mod` | NeoForge         | Minecraft Java 1.21.1 | Pterodactyl Game Nodes | In-game authorization & status reporting |
| `gateway`    | Velocity Proxy   | Java 21               | Fly.io Edge            | Low-latency routing & packet inspection  |

## Network Flow

```text
Player Launcher
      │ (Launches Minecraft + client-mod)
      ▼
Velocity Gateway (Fly.io) ──[ Authenticates Player ]
      │
      ▼
Dedicated Server (Ubuntu / Pterodactyl + server-mod)
```

## Tooling

All Minecraft subprojects are built with Gradle 8.10+ and Java 21 toolchains under the `minecraft/` root directory.
