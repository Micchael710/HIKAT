# HiKAT Fly.io Infrastructure Foundation

Configuration and deployment documentation for the HiKAT Velocity Minecraft Gateway.

## Role

The Velocity Gateway runs on Fly.io to provide low-latency edge proxying, player authentication verification, and dynamic routing to game servers (hosted on dedicated Ubuntu / Pterodactyl nodes).

> **Note**: In Shard 0 (Foundation), no remote deployment or resource provisioning is performed (`fly deploy` is prohibited).
