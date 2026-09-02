import { createGraphQLError } from "@hikat/graphql"
import type { GameModLoaderGql, GameLoaderVersionGql, GameEnvironmentCatalogGql } from "@hikat/graphql"

// ─── Official API URLs ────────────────────────────────────────────────────────

const MINECRAFT_VERSION_MANIFEST_URL =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

const NEOFORGE_MAVEN_METADATA_URL =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"

const FORGE_MAVEN_METADATA_URL =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"

const FABRIC_LOADER_BASE_URL =
    "https://meta.fabricmc.net/v2/versions/loader"

const QUILT_LOADER_BASE_URL =
    "https://meta.quiltmc.org/v3/versions/loader"

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000

interface CacheEntry<T> {
    expiresAt: number
    data: T
}

let cachedMinecraftVersions: CacheEntry<MinecraftManifestVersion[]> | null = null
let cachedNeoForgeVersions: CacheEntry<string[]> | null = null
let cachedForgeVersions: CacheEntry<string[]> | null = null
// Fabric/Quilt are per-minecraft-version, keyed by mc version
const cachedFabricLoaders = new Map<string, CacheEntry<GameLoaderVersionGql[]>>()
const cachedQuiltLoaders = new Map<string, CacheEntry<GameLoaderVersionGql[]>>()

export function clearGameEnvironmentCache(): void {
    cachedMinecraftVersions = null
    cachedNeoForgeVersions = null
    cachedForgeVersions = null
    cachedFabricLoaders.clear()
    cachedQuiltLoaders.clear()
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface MinecraftManifestVersion {
    id: string
    type: string
    releaseTime?: string
}

interface MinecraftVersionManifest {
    versions?: MinecraftManifestVersion[]
}

// Re-export loader version for consumers that import directly from this file
export type { GameLoaderVersionGql as GameEnvironmentVersion }

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "HiKAT/1.0" },
        })
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching ${url}`)
        }
        return response
    } finally {
        clearTimeout(timeout)
    }
}

// ─── Minecraft ────────────────────────────────────────────────────────────────

async function getOfficialMinecraftVersions(): Promise<MinecraftManifestVersion[]> {
    const now = Date.now()
    if (cachedMinecraftVersions && cachedMinecraftVersions.expiresAt > now) {
        return cachedMinecraftVersions.data
    }
    const response = await fetchWithTimeout(MINECRAFT_VERSION_MANIFEST_URL)
    const manifest = (await response.json()) as MinecraftVersionManifest
    const versions = Array.isArray(manifest.versions)
        ? manifest.versions.filter(
            (v) => v && v.type === "release" && typeof v.id === "string" && v.id.trim(),
        )
        : []
    if (versions.length === 0) {
        throw new Error("Mojang no devolvió versiones release de Minecraft.")
    }
    cachedMinecraftVersions = { data: versions, expiresAt: now + CACHE_TTL_MS }
    return versions
}

// ─── NeoForge ─────────────────────────────────────────────────────────────────

/**
 * Converts a Minecraft release into the prefix used by NeoForge.
 *
 * 1.21       -> 21.0.
 * 1.21.1     -> 21.1.
 * 1.21.10    -> 21.10.
 * 26.1       -> 26.1.0.
 */
export function getNeoForgePrefixForMinecraft(minecraftVersion: string): string | null {
    const clean = String(minecraftVersion || "").trim()
    const parts = clean.split(".")

    // Legacy Minecraft scheme: 1.xx.x
    if (parts[0] === "1" && parts.length >= 2 && /^\d+$/.test(parts[1] || "")) {
        const minor = parts[1]
        const patch = parts.length >= 3 && /^\d+$/.test(parts[2] || "") ? parts[2] : "0"
        return `${minor}.${patch}.`
    }

    // New Minecraft scheme: 26.1, 26.1.1, etc.
    if (
        parts.length >= 2 &&
        /^\d+$/.test(parts[0] || "") &&
        /^\d+$/.test(parts[1] || "") &&
        Number(parts[0]) >= 26
    ) {
        const year = parts[0]
        const release = parts[1]
        const patch = parts.length >= 3 && /^\d+$/.test(parts[2] || "") ? parts[2] : "0"
        return `${year}.${release}.${patch}.`
    }

    return null
}

async function getOfficialNeoForgeVersions(): Promise<string[]> {
    const now = Date.now()
    if (cachedNeoForgeVersions && cachedNeoForgeVersions.expiresAt > now) {
        return cachedNeoForgeVersions.data
    }
    const response = await fetchWithTimeout(NEOFORGE_MAVEN_METADATA_URL)
    const xml = await response.text()
    const versions = Array.from(xml.matchAll(/<version>\s*([^<]+?)\s*<\/version>/g))
        .map((m) => m[1]?.trim())
        .filter((v): v is string => Boolean(v))
    if (versions.length === 0) {
        throw new Error("NeoForged Maven no devolvió versiones de NeoForge.")
    }
    cachedNeoForgeVersions = { data: versions, expiresAt: now + CACHE_TTL_MS }
    return versions
}

function sortLoaderVersions(versions: GameLoaderVersionGql[]): GameLoaderVersionGql[] {
    return [...versions].sort((a, b) => {
        if (a.stable !== b.stable) return a.stable ? -1 : 1
        return b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: "base" })
    })
}

function findCompatibleNeoForgeVersions(
    minecraftVersion: string,
    allVersions: string[],
): GameLoaderVersionGql[] {
    const prefix = getNeoForgePrefixForMinecraft(minecraftVersion)
    if (!prefix) return []
    return sortLoaderVersions(
        allVersions
            .filter((v) => v.startsWith(prefix))
            .map((v) => ({ version: v, stable: !v.includes("-") })),
    )
}

// ─── Forge ────────────────────────────────────────────────────────────────────

async function getOfficialForgeVersions(): Promise<string[]> {
    const now = Date.now()
    if (cachedForgeVersions && cachedForgeVersions.expiresAt > now) {
        return cachedForgeVersions.data
    }
    const response = await fetchWithTimeout(FORGE_MAVEN_METADATA_URL)
    const xml = await response.text()
    // Forge artifact IDs look like: 1.20.1-47.1.0
    const versions = Array.from(xml.matchAll(/<version>\s*([^<]+?)\s*<\/version>/g))
        .map((m) => m[1]?.trim())
        .filter((v): v is string => Boolean(v) && v!.includes("-"))
    if (versions.length === 0) {
        throw new Error("Forge Maven no devolvió versiones.")
    }
    cachedForgeVersions = { data: versions, expiresAt: now + CACHE_TTL_MS }
    return versions
}

function findCompatibleForgeVersions(
    minecraftVersion: string,
    allVersions: string[],
): GameLoaderVersionGql[] {
    const prefix = `${minecraftVersion}-`
    return sortLoaderVersions(
        allVersions
            .filter((v) => v.startsWith(prefix))
            .map((v) => {
                // Return only the forge part (after "1.20.1-")
                const forgeOnly = v.slice(prefix.length)
                // Stable = no beta/alpha/rc suffix in the forge part
                const stable = !/[a-zA-Z]/.test(forgeOnly.split(".").slice(-1)[0] || "")
                return { version: forgeOnly, stable }
            }),
    )
}

// ─── Fabric ───────────────────────────────────────────────────────────────────

interface FabricLoaderEntry {
    loader?: { version?: string; stable?: boolean }
}

async function getOfficialFabricLoaderVersions(
    minecraftVersion: string,
): Promise<GameLoaderVersionGql[]> {
    const now = Date.now()
    const cached = cachedFabricLoaders.get(minecraftVersion)
    if (cached && cached.expiresAt > now) return cached.data

    const response = await fetchWithTimeout(
        `${FABRIC_LOADER_BASE_URL}/${encodeURIComponent(minecraftVersion)}`,
    )
    if (response.status === 404 || response.status === 400) {
        cachedFabricLoaders.set(minecraftVersion, { data: [], expiresAt: now + CACHE_TTL_MS })
        return []
    }
    if (!response.ok) {
        throw new Error(`Fabric meta API error: HTTP ${response.status}`)
    }
    const json = (await response.json()) as FabricLoaderEntry[]
    if (!Array.isArray(json) || json.length === 0) {
        cachedFabricLoaders.set(minecraftVersion, { data: [], expiresAt: now + CACHE_TTL_MS })
        return []
    }
    const versions = sortLoaderVersions(
        json
            .filter((e) => e?.loader?.version)
            .map((e) => ({
                version: e.loader!.version!,
                stable: Boolean(e.loader?.stable),
            })),
    )
    cachedFabricLoaders.set(minecraftVersion, { data: versions, expiresAt: now + CACHE_TTL_MS })
    return versions
}

// ─── Quilt ────────────────────────────────────────────────────────────────────

interface QuiltLoaderEntry {
    loader?: { version?: string }
}

async function getOfficialQuiltLoaderVersions(
    minecraftVersion: string,
): Promise<GameLoaderVersionGql[]> {
    const now = Date.now()
    const cached = cachedQuiltLoaders.get(minecraftVersion)
    if (cached && cached.expiresAt > now) return cached.data

    const response = await fetchWithTimeout(
        `${QUILT_LOADER_BASE_URL}/${encodeURIComponent(minecraftVersion)}`,
    )
    if (response.status === 404 || response.status === 400) {
        cachedQuiltLoaders.set(minecraftVersion, { data: [], expiresAt: now + CACHE_TTL_MS })
        return []
    }
    if (!response.ok) {
        throw new Error(`Quilt meta API error: HTTP ${response.status}`)
    }
    const json = (await response.json()) as QuiltLoaderEntry[]
    if (!Array.isArray(json) || json.length === 0) {
        cachedQuiltLoaders.set(minecraftVersion, { data: [], expiresAt: now + CACHE_TTL_MS })
        return []
    }
    // Quilt marks stable: versions without pre-release suffix
    const versions = sortLoaderVersions(
        json
            .filter((e) => e?.loader?.version)
            .map((e) => ({
                version: e.loader!.version!,
                stable: !e.loader!.version!.includes("-"),
            })),
    )
    cachedQuiltLoaders.set(minecraftVersion, { data: versions, expiresAt: now + CACHE_TTL_MS })
    return versions
}

// ─── Public API ───────────────────────────────────────────────────────────────

const ALL_LOADERS: GameModLoaderGql[] = ["VANILLA", "NEOFORGE", "FORGE", "FABRIC", "QUILT"]

/**
 * Returns the catalog of official Minecraft releases and supported mod loaders.
 * minecraftVersions = all official "release" type entries from Mojang.
 * loaders = all supported loader enum values.
 */
export async function getGameEnvironmentCatalog(): Promise<GameEnvironmentCatalogGql> {
    try {
        const minecraftManifestVersions = await getOfficialMinecraftVersions()
        const minecraftVersions = minecraftManifestVersions.map((v) => v.id)
        return {
            minecraftVersions,
            loaders: ALL_LOADERS,
        }
    } catch (error) {
        console.error("[GameEnvironment] Failed to load catalog:", error)
        throw createGraphQLError(
            "No se pudo consultar el catálogo oficial de Minecraft. Inténtalo nuevamente.",
            "INTERNAL_ERROR",
        )
    }
}

/**
 * Returns loader versions compatible with the given Minecraft version and loader.
 * Returns [] for VANILLA (no loader version).
 */
export async function getLoaderVersions(
    minecraftVersion: string,
    modLoader: GameModLoaderGql,
): Promise<GameLoaderVersionGql[]> {
    const cleanMc = minecraftVersion.trim()

    try {
        switch (modLoader) {
            case "VANILLA":
                return []

            case "NEOFORGE": {
                const all = await getOfficialNeoForgeVersions()
                return findCompatibleNeoForgeVersions(cleanMc, all)
            }

            case "FORGE": {
                const all = await getOfficialForgeVersions()
                return findCompatibleForgeVersions(cleanMc, all)
            }

            case "FABRIC":
                return getOfficialFabricLoaderVersions(cleanMc)

            case "QUILT":
                return getOfficialQuiltLoaderVersions(cleanMc)

            default:
                return []
        }
    } catch (error) {
        console.error(`[GameEnvironment] Failed to load ${modLoader} versions for ${cleanMc}:`, error)
        throw createGraphQLError(
            `No se pudo consultar las versiones de ${modLoader} para Minecraft ${cleanMc}. Inténtalo nuevamente.`,
            "INTERNAL_ERROR",
        )
    }
}

/**
 * Validates that the given Minecraft + modLoader + modLoaderVersion combination is real and official.
 * Throws VALIDATION_ERROR if invalid.
 */
export async function validateGameEnvironment(
    minecraftVersion: string,
    modLoader: GameModLoaderGql,
    modLoaderVersion: string | null | undefined,
): Promise<void> {
    const cleanMc = (minecraftVersion || "").trim()

    if (!cleanMc) {
        throw createGraphQLError(
            "La versión de Minecraft no puede estar vacía.",
            "VALIDATION_ERROR",
        )
    }

    // Validate Minecraft version exists
    let mcVersions: MinecraftManifestVersion[]
    try {
        mcVersions = await getOfficialMinecraftVersions()
    } catch (_) {
        throw createGraphQLError(
            "No se pudo verificar la versión de Minecraft con la fuente oficial. Inténtalo nuevamente.",
            "INTERNAL_ERROR",
        )
    }

    if (!mcVersions.some((v) => v.id === cleanMc)) {
        throw createGraphQLError(
            `Minecraft ${cleanMc} no es una versión oficial publicada.`,
            "VALIDATION_ERROR",
        )
    }

    if (modLoader === "VANILLA") {
        if (modLoaderVersion != null && modLoaderVersion !== "") {
            throw createGraphQLError(
                "VANILLA no tiene versión de mod loader. Envía modLoaderVersion = null.",
                "VALIDATION_ERROR",
            )
        }
        return
    }

    // For all non-Vanilla loaders, modLoaderVersion is required
    const cleanVersion = (modLoaderVersion || "").trim()
    if (!cleanVersion) {
        throw createGraphQLError(
            `La versión del loader ${modLoader} no puede estar vacía.`,
            "VALIDATION_ERROR",
        )
    }

    // Validate against official loader versions
    let loaderVersions: GameLoaderVersionGql[]
    try {
        loaderVersions = await getLoaderVersions(cleanMc, modLoader)
    } catch (_) {
        throw createGraphQLError(
            `No se pudo verificar la versión de ${modLoader} con la fuente oficial. Inténtalo nuevamente.`,
            "INTERNAL_ERROR",
        )
    }

    const isValid = loaderVersions.some((v) => v.version === cleanVersion)
    if (!isValid) {
        throw createGraphQLError(
            `${modLoader} ${cleanVersion} no es una versión oficial compatible con Minecraft ${cleanMc}.`,
            "VALIDATION_ERROR",
        )
    }
}

// ─── Legacy exports for backwards-compat ─────────────────────────────────────

/** @deprecated Use getLoaderVersions with modLoader=NEOFORGE */
export type NeoForgeEnvironmentVersion = GameLoaderVersionGql

/** @deprecated Use getGameEnvironmentCatalog + getLoaderVersions */
export interface GameEnvironmentCatalog {
    minecraftVersions: string[]
    neoForgeVersions: GameLoaderVersionGql[]
    recommendedNeoForgeVersion: string | null
}

/** @deprecated Use validateGameEnvironment */
export async function validateOfficialGameEnvironment(
    minecraftVersion: string,
    neoForgeVersion: string,
): Promise<void> {
    return validateGameEnvironment(minecraftVersion, "NEOFORGE", neoForgeVersion)
}