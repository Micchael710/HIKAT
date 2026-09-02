import React, { useState, useEffect, useCallback } from "react"
import type { ThemeMode, GameModLoader, GameLoaderVersion } from "../../types"
import { getThemeTokens } from "../../theme/tokens"
import {
    IconSettings,
    IconCross,
    IconSpinner,
    IconAlertCircle,
} from "../../theme/icons"
import { gameApi } from "../../services/graphqlClient"

const LOADER_LABELS: Record<GameModLoader, string> = {
    VANILLA: "Vanilla (sin mods)",
    NEOFORGE: "NeoForge",
    FORGE: "Forge",
    FABRIC: "Fabric",
    QUILT: "Quilt",
}

interface GameEnvironmentModalProps {
    theme: ThemeMode
    minecraftVersion: string
    modLoader: GameModLoader
    modLoaderVersion: string | null | undefined
    providerManagedFileCount: number
    onClose: () => void
    onSubmit: (input: {
        minecraftVersion: string
        modLoader: GameModLoader
        modLoaderVersion: string | null
    }) => Promise<void>
}

export default function GameEnvironmentModal({
    theme,
    minecraftVersion: initialMinecraftVersion,
    modLoader: initialModLoader,
    modLoaderVersion: initialModLoaderVersion,
    providerManagedFileCount,
    onClose,
    onSubmit,
}: GameEnvironmentModalProps) {
    const isDark = theme === "dark"
    const tokens = getThemeTokens(theme)

    // --- Catalog state ---
    const [minecraftVersions, setMinecraftVersions] = useState<string[]>([])
    const [availableLoaders, setAvailableLoaders] = useState<GameModLoader[]>([])
    const [loaderVersions, setLoaderVersions] = useState<GameLoaderVersion[]>([])
    const [catalogLoading, setCatalogLoading] = useState(true)
    const [catalogError, setCatalogError] = useState<string | null>(null)

    // --- Form state ---
    const [minecraftVersion, setMinecraftVersion] = useState(initialMinecraftVersion)
    const [modLoader, setModLoader] = useState<GameModLoader>(initialModLoader || "NEOFORGE")
    const [modLoaderVersion, setModLoaderVersion] = useState<string>(initialModLoaderVersion || "")

    const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // --- Load catalog on mount ---
    useEffect(() => {
        let cancelled = false
        setCatalogLoading(true)
        setCatalogError(null)

        gameApi.getGameEnvironmentCatalog()
            .then((catalog) => {
                if (cancelled) return
                setMinecraftVersions(catalog.minecraftVersions)
                setAvailableLoaders(catalog.loaders)
                // Ensure initial value is in list, else default to first
                if (!catalog.minecraftVersions.includes(initialMinecraftVersion)) {
                    if (catalog.minecraftVersions.length > 0) {
                        setMinecraftVersion(catalog.minecraftVersions[0]!)
                    }
                }
            })
            .catch((err: unknown) => {
                if (cancelled) return
                setCatalogError(
                    err instanceof Error
                        ? err.message
                        : "No se pudo cargar el catálogo de versiones."
                )
            })
            .finally(() => {
                if (!cancelled) setCatalogLoading(false)
            })

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // --- Load loader versions when minecraft or loader changes ---
    const fetchLoaderVersions = useCallback(
        async (mc: string, loader: GameModLoader) => {
            if (loader === "VANILLA") {
                setLoaderVersions([])
                setModLoaderVersion("")
                return
            }
            setLoaderVersionsLoading(true)
            try {
                const versions = await gameApi.getGameLoaderVersions(mc, loader)
                setLoaderVersions(versions)
                // If previous selection is valid keep it, else default to first stable
                const current = modLoaderVersion
                const isValid = versions.some((v) => v.version === current)
                if (!isValid) {
                    const firstStable = versions.find((v) => v.stable)
                    setModLoaderVersion(firstStable?.version || versions[0]?.version || "")
                }
            } catch {
                setLoaderVersions([])
                setModLoaderVersion("")
            } finally {
                setLoaderVersionsLoading(false)
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    )

    useEffect(() => {
        if (!minecraftVersion) return
        void fetchLoaderVersions(minecraftVersion, modLoader)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [minecraftVersion, modLoader])

    // --- Computed ---
    const normalizedMinecraftVersion = minecraftVersion.trim()
    const normalizedModLoaderVersion = modLoader === "VANILLA" ? null : (modLoaderVersion.trim() || null)

    const hasChanged =
        normalizedMinecraftVersion !== initialMinecraftVersion ||
        modLoader !== (initialModLoader || "NEOFORGE") ||
        normalizedModLoaderVersion !== (initialModLoaderVersion?.trim() || null)

    const isValid =
        Boolean(normalizedMinecraftVersion) &&
        minecraftVersions.includes(normalizedMinecraftVersion) &&
        (modLoader === "VANILLA" ||
            (Boolean(normalizedModLoaderVersion) &&
                loaderVersions.some((v) => v.version === normalizedModLoaderVersion)))

    // --- Submit ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (!normalizedMinecraftVersion) {
            setError("Debes indicar una versión de Minecraft.")
            return
        }

        if (modLoader !== "VANILLA" && !normalizedModLoaderVersion) {
            setError("Debes indicar una versión del loader.")
            return
        }

        if (!hasChanged) {
            onClose()
            return
        }

        setIsSubmitting(true)
        try {
            await onSubmit({
                minecraftVersion: normalizedMinecraftVersion,
                modLoader,
                modLoaderVersion: normalizedModLoaderVersion,
            })
            onClose()
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "No se pudo actualizar el entorno de Minecraft.",
            )
        } finally {
            setIsSubmitting(false)
        }
    }

    // --- Loader version label ---
    const loaderVersionLabel = modLoader === "VANILLA"
        ? null
        : `Versión de ${LOADER_LABELS[modLoader] || modLoader}`

    return (
        <div
            data-testid="game-environment-modal"
            style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0, 0, 0, 0.78)",
                backdropFilter: "blur(6px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 900,
                padding: "20px",
                boxSizing: "border-box",
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose()
                }
            }}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: "520px",
                    backgroundColor: tokens.bgCard,
                    borderRadius: "18px",
                    border: `1px solid ${tokens.borderSubtle}`,
                    boxShadow: tokens.cardShadowLg,
                    overflow: "hidden",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "18px 20px",
                        borderBottom: `1px solid ${tokens.borderSubtle}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: tokens.bgCardInner,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                        }}
                    >
                        <IconSettings
                            style={{
                                width: 20,
                                height: 20,
                                color: "#3ec4c0",
                            }}
                        />

                        <div>
                            <h3
                                style={{
                                    margin: 0,
                                    fontSize: "16px",
                                    fontWeight: "700",
                                    color: tokens.textPrimary,
                                }}
                            >
                                Configurar entorno
                            </h3>

                            <div
                                style={{
                                    fontSize: "12px",
                                    color: tokens.textSecondary,
                                    marginTop: "2px",
                                }}
                            >
                                Entorno utilizado por esta actualización
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        title="Cerrar"
                        style={{
                            background: "transparent",
                            border: "none",
                            color: tokens.textMuted,
                            cursor: "pointer",
                            padding: "4px",
                            display: "flex",
                        }}
                    >
                        <IconCross
                            style={{
                                width: 18,
                                height: 18,
                            }}
                        />
                    </button>
                </div>

                <form
                    onSubmit={handleSubmit}
                    style={{
                        padding: "20px",
                    }}
                >
                    {/* Catalog error */}
                    {catalogError && (
                        <div
                            style={{
                                padding: "10px 14px",
                                marginBottom: "16px",
                                backgroundColor: "rgba(245, 158, 11, 0.12)",
                                border: "1px solid rgba(245, 158, 11, 0.3)",
                                borderRadius: "10px",
                                color: isDark ? "#fbbf24" : "#b45309",
                                fontSize: "12px",
                            }}
                        >
                            ⚠ {catalogError} Puedes seguir escribiendo manualmente.
                        </div>
                    )}

                    {/* Form error */}
                    {error && (
                        <div
                            style={{
                                padding: "10px 14px",
                                marginBottom: "16px",
                                backgroundColor: "rgba(239, 68, 68, 0.12)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                borderRadius: "10px",
                                color: "#ef4444",
                                fontSize: "13px",
                            }}
                        >
                            {error}
                        </div>
                    )}

                    {/* Minecraft version */}
                    <div style={{ marginBottom: "16px" }}>
                        <label
                            htmlFor="environment-minecraft-version"
                            style={{
                                display: "block",
                                marginBottom: "6px",
                                fontSize: "13px",
                                fontWeight: "600",
                                color: tokens.textSecondary,
                            }}
                        >
                            Versión de Minecraft
                        </label>

                        {catalogLoading ? (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    color: tokens.textMuted,
                                    fontSize: "13px",
                                    padding: "10px 0",
                                }}
                            >
                                <IconSpinner style={{ width: 14, height: 14 }} />
                                Cargando versiones…
                            </div>
                        ) : minecraftVersions.length > 0 ? (
                            <select
                                id="environment-minecraft-version"
                                data-testid="environment-minecraft-version"
                                value={minecraftVersion}
                                onChange={(e) => setMinecraftVersion(e.target.value)}
                                className="launcher-input"
                                style={{ width: "100%", boxSizing: "border-box" }}
                            >
                                {minecraftVersions.map((v) => (
                                    <option key={v} value={v}>
                                        {v}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <div
                                style={{
                                    color: tokens.textMuted,
                                    fontSize: "13px",
                                    padding: "10px 0",
                                }}
                            >
                                No se pudieron obtener versiones oficiales de Minecraft.
                            </div>
                        )}
                    </div>

                    {/* Mod loader */}
                    <div style={{ marginBottom: "16px" }}>
                        <label
                            htmlFor="environment-mod-loader"
                            style={{
                                display: "block",
                                marginBottom: "6px",
                                fontSize: "13px",
                                fontWeight: "600",
                                color: tokens.textSecondary,
                            }}
                        >
                            Motor de mods
                        </label>

                        <select
                            id="environment-mod-loader"
                            data-testid="environment-mod-loader"
                            value={modLoader}
                            onChange={(e) => {
                                setModLoader(e.target.value as GameModLoader)
                                setModLoaderVersion("")
                            }}
                            className="launcher-input"
                            style={{ width: "100%", boxSizing: "border-box" }}
                        >
                            {availableLoaders.length > 0
                                ? availableLoaders.map((l) => (
                                    <option key={l} value={l}>
                                        {LOADER_LABELS[l] || l}
                                    </option>
                                ))
                                : (["VANILLA", "NEOFORGE", "FORGE", "FABRIC", "QUILT"] as GameModLoader[]).map((l) => (
                                    <option key={l} value={l}>
                                        {LOADER_LABELS[l]}
                                    </option>
                                ))}
                        </select>
                    </div>

                    {/* Loader version */}
                    {modLoader !== "VANILLA" && loaderVersionLabel && (
                        <div style={{ marginBottom: "18px" }}>
                            <label
                                htmlFor="environment-loader-version"
                                style={{
                                    display: "block",
                                    marginBottom: "6px",
                                    fontSize: "13px",
                                    fontWeight: "600",
                                    color: tokens.textSecondary,
                                }}
                            >
                                {loaderVersionLabel}
                            </label>

                            {loaderVersionsLoading ? (
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        color: tokens.textMuted,
                                        fontSize: "13px",
                                        padding: "10px 0",
                                    }}
                                >
                                    <IconSpinner style={{ width: 14, height: 14 }} />
                                    Cargando versiones del loader…
                                </div>
                            ) : loaderVersions.length > 0 ? (
                                <select
                                    id="environment-loader-version"
                                    data-testid={modLoader === "NEOFORGE" ? "environment-neoforge-version" : "environment-loader-version"}
                                    value={modLoaderVersion}
                                    onChange={(e) => setModLoaderVersion(e.target.value)}
                                    className="launcher-input"
                                    style={{ width: "100%", boxSizing: "border-box" }}
                                >
                                    {loaderVersions.map((v) => (
                                        <option key={v.version} value={v.version}>
                                            {v.version}
                                            {!v.stable ? " (beta)" : ""}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <div
                                    style={{
                                        color: tokens.textMuted,
                                        fontSize: "13px",
                                        padding: "10px 0",
                                    }}
                                >
                                    {`No hay versiones de ${LOADER_LABELS[modLoader] || modLoader} disponibles para Minecraft ${minecraftVersion}.`}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Summary */}
                    <div
                        style={{
                            padding: "12px 14px",
                            backgroundColor: tokens.bgCardInner,
                            border: `1px solid ${tokens.borderSubtle}`,
                            borderRadius: "10px",
                            marginBottom: "16px",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "12px",
                                color: tokens.textSecondary,
                                marginBottom: "5px",
                            }}
                        >
                            Entorno de la actualización
                        </div>

                        <div
                            style={{
                                fontSize: "13px",
                                fontWeight: "700",
                                color: tokens.textPrimary,
                            }}
                        >
                            Minecraft {normalizedMinecraftVersion || "—"}
                            {modLoader !== "VANILLA" && (
                                <>
                                    {" "}
                                    <span
                                        style={{
                                            color: tokens.textMuted,
                                            fontWeight: "400",
                                        }}
                                    >
                                        •
                                    </span>{" "}
                                    {LOADER_LABELS[modLoader]}{" "}
                                    {normalizedModLoaderVersion || "—"}
                                </>
                            )}
                            {modLoader === "VANILLA" && (
                                <>
                                    {" "}
                                    <span
                                        style={{
                                            color: tokens.textMuted,
                                            fontWeight: "400",
                                        }}
                                    >
                                        • Vanilla
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Compatibility warning */}
                    {hasChanged && providerManagedFileCount > 0 && (
                        <div
                            style={{
                                padding: "12px 14px",
                                borderRadius: "10px",
                                marginBottom: "20px",
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "10px",
                                backgroundColor: isDark
                                    ? "rgba(245, 158, 11, 0.12)"
                                    : "rgba(245, 158, 11, 0.08)",
                                border: `1px solid ${isDark
                                    ? "rgba(245, 158, 11, 0.3)"
                                    : "rgba(245, 158, 11, 0.25)"
                                    }`,
                                color: isDark ? "#fbbf24" : "#b45309",
                                fontSize: "12px",
                                lineHeight: "1.45",
                            }}
                        >
                            <IconAlertCircle
                                size={17}
                                style={{
                                    flexShrink: 0,
                                    marginTop: "1px",
                                }}
                            />

                            <span>
                                Este borrador contiene{" "}
                                <strong>
                                    {providerManagedFileCount}
                                </strong>{" "}
                                archivo(s) procedentes de Modrinth o
                                CurseForge. Cambiar el entorno no
                                reemplazará esos archivos
                                automáticamente. Revísalos antes de
                                publicar.
                            </span>
                        </div>
                    )}

                    {/* Actions */}
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            gap: "10px",
                        }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="launcher-btn-secondary"
                            style={{
                                padding: "10px 18px",
                                borderRadius: "12px",
                                fontSize: "14px",
                            }}
                        >
                            Cancelar
                        </button>

                        <button
                            data-testid="button-save-game-environment"
                            type="submit"
                            disabled={!isValid || catalogLoading || loaderVersionsLoading || isSubmitting || Boolean(catalogError)}
                            className="launcher-btn-primary"
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "10px 22px",
                                borderRadius: "12px",
                                fontSize: "14px",
                                fontWeight: "700",
                            }}
                        >
                            {isSubmitting && (
                                <IconSpinner
                                    style={{
                                        width: 14,
                                        height: 14,
                                    }}
                                />
                            )}

                            <span>Guardar entorno</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}