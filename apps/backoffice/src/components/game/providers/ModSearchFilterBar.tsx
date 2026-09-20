import React from "react"
import type { ModProvider, ContentType, GameModLoader, ModCategoryItem, ModEnvironment, ThemeMode } from "../../../types"
import { getThemeTokens } from "../../../theme/tokens"
import { IconSearch } from "../../../theme/icons"

export interface ModSearchFilterBarProps {
  mode: "RELEASE" | "SERVER"
  query: string
  onQueryChange: (q: string) => void
  selectedProvider: ModProvider | "ALL"
  onProviderChange: (p: ModProvider | "ALL") => void
  selectedContentType: ContentType
  onContentTypeChange: (ct: ContentType) => void
  selectedLoader: GameModLoader
  onLoaderChange: (loader: GameModLoader) => void
  selectedCategoryKey: string
  onCategoryChange: (key: string) => void
  categories: ModCategoryItem[]
  loadingCategories?: boolean
  environmentFilter?: ModEnvironment | null
  onEnvironmentFilterChange?: (env: ModEnvironment | null) => void
  theme?: ThemeMode
}

const LOADER_OPTIONS: { value: GameModLoader; label: string }[] = [
  { value: "NEOFORGE", label: "NeoForge" },
  { value: "FORGE", label: "Forge" },
  { value: "FABRIC", label: "Fabric" },
  { value: "QUILT", label: "Quilt" },
]

export const ModSearchFilterBar: React.FC<ModSearchFilterBarProps> = ({
  mode,
  query,
  onQueryChange,
  selectedProvider,
  onProviderChange,
  selectedContentType,
  onContentTypeChange,
  selectedLoader,
  onLoaderChange,
  selectedCategoryKey,
  onCategoryChange,
  categories,
  loadingCategories,
  environmentFilter,
  onEnvironmentFilterChange,
  theme = "dark",
}) => {
  const tokens = getThemeTokens(theme)

  const isServer = mode === "SERVER"

  const providerTabs: { key: ModProvider | "ALL"; label: string; testId: string }[] = [
    { key: "ALL", label: "Todos", testId: isServer ? "server-tab-provider-all" : "tab-provider-all" },
    { key: "MODRINTH", label: "Modrinth", testId: isServer ? "server-tab-provider-modrinth" : "tab-provider-modrinth" },
    { key: "CURSEFORGE", label: "CurseForge", testId: isServer ? "server-tab-provider-curseforge" : "tab-provider-curseforge" },
  ]

  const contentTypeTabs: { key: ContentType; label: string; testId: string }[] =
    mode === "RELEASE"
      ? [
          { key: "MOD", label: "Mods", testId: "tab-content-mod" },
          { key: "RESOURCE_PACK", label: "Resource Packs", testId: "tab-content-resource_pack" },
          { key: "SHADER", label: "Shaders", testId: "tab-content-shader" },
        ]
      : [
          { key: "MOD", label: "Mods", testId: "server-tab-content-mod" },
          { key: "DATA_PACK", label: "Data Packs", testId: "server-tab-content-datapack" },
        ]

  const modrinthOnlyCategories = React.useMemo(
    () => categories.filter((c) => c.providers?.includes("MODRINTH") && !c.providers?.includes("CURSEFORGE")),
    [categories],
  )
  const sharedCategories = React.useMemo(
    () => categories.filter((c) => c.providers?.includes("MODRINTH") && c.providers?.includes("CURSEFORGE")),
    [categories],
  )
  const curseforgeOnlyCategories = React.useMemo(
    () => categories.filter((c) => !c.providers?.includes("MODRINTH") && c.providers?.includes("CURSEFORGE")),
    [categories],
  )
  const otherCategories = React.useMemo(
    () => categories.filter((c) => !c.providers?.includes("MODRINTH") && !c.providers?.includes("CURSEFORGE")),
    [categories],
  )

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "16px 20px",
        background: tokens.bgCardInner,
        borderBottom: `1px solid ${tokens.borderSubtle}`,
      }}
    >
      {/* Row 1: Search Input + Category Selector + Loader Selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        {/* Search Bar */}
        <div
          style={{
            flex: "1 1 300px",
            display: "flex",
            alignItems: "center",
            background: tokens.bgInput,
            border: `1px solid ${tokens.borderSubtle}`,
            borderRadius: "10px",
            padding: "0 12px",
            minHeight: "42px",
          }}
        >
          <IconSearch size={18} style={{ color: tokens.textMuted, marginRight: "8px", flexShrink: 0 }} />
          <input
            type="text"
            data-testid={isServer ? "input-server-mod-search" : "input-mod-search"}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={
              selectedContentType === "MOD"
                ? "Buscar mods en Modrinth y CurseForge..."
                : selectedContentType === "RESOURCE_PACK"
                ? "Buscar resource packs..."
                : selectedContentType === "DATA_PACK"
                ? "Buscar data packs..."
                : "Buscar shaders..."
            }
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: tokens.textPrimary,
              fontSize: "14px",
              outline: "none",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              style={{
                background: "transparent",
                border: "none",
                color: tokens.textMuted,
                cursor: "pointer",
                padding: "4px",
                fontSize: "14px",
              }}
              title="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>

        {/* Loader Selector (only visible for MOD content) */}
        {selectedContentType === "MOD" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: tokens.textSecondary, whiteSpace: "nowrap" }}>
              Loader:
            </span>
            <select
              data-testid="mod-loader-selector"
              value={selectedLoader}
              onChange={(e) => onLoaderChange(e.target.value as GameModLoader)}
              style={{
                background: tokens.bgInput,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "8px",
                color: tokens.textPrimary,
                padding: "8px 12px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {LOADER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Environment Filter (only visible for MOD content) */}
        {selectedContentType === "MOD" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: tokens.textSecondary, whiteSpace: "nowrap" }}>
              Entorno:
            </span>
            <select
              data-testid={isServer ? "server-mod-environment-selector" : "mod-environment-selector"}
              data-selector="environment-filter"
              value={environmentFilter || ""}
              onChange={(e) => {
                const val = e.target.value as ModEnvironment | ""
                onEnvironmentFilterChange?.(val ? val : null)
              }}
              style={{
                background: tokens.bgInput,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "8px",
                color: tokens.textPrimary,
                padding: "8px 12px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="">Todos compatibles</option>
              {isServer ? (
                <>
                  <option value="SERVER">Solo servidor</option>
                  <option value="BOTH">Cliente y servidor</option>
                </>
              ) : (
                <>
                  <option value="CLIENT">Solo cliente</option>
                  <option value="BOTH">Cliente y servidor</option>
                  <option value="SERVER">Solo servidor</option>
                </>
              )}
            </select>
          </div>
        )}

        {/* Category Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: tokens.textSecondary, whiteSpace: "nowrap" }}>
            Categoría:
          </span>
          <select
            data-testid="mod-category-selector"
            value={selectedCategoryKey}
            onChange={(e) => onCategoryChange(e.target.value)}
            style={{
              background: tokens.bgInput,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: "8px",
              color: tokens.textPrimary,
              padding: "8px 12px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              outline: "none",
              maxWidth: "200px",
            }}
          >
            <option value="">Todas las categorías</option>
            {loadingCategories ? (
              <option disabled>Cargando categorías...</option>
            ) : (
              <>
                {modrinthOnlyCategories.length > 0 && (
                  <optgroup label="Modrinth" style={{ color: "#10b981", fontWeight: "700" }}>
                    {modrinthOnlyCategories.map((cat) => (
                      <option
                        key={cat.key}
                        value={cat.key}
                        style={{ color: tokens.textPrimary, background: tokens.bgInput, fontWeight: "400" }}
                      >
                        {cat.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sharedCategories.length > 0 && (
                  <optgroup label="Modrinth + CurseForge" style={{ color: tokens.textPrimary, fontWeight: "700" }}>
                    {sharedCategories.map((cat) => (
                      <option
                        key={cat.key}
                        value={cat.key}
                        style={{ color: tokens.textPrimary, background: tokens.bgInput, fontWeight: "400" }}
                      >
                        {cat.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {curseforgeOnlyCategories.length > 0 && (
                  <optgroup label="CurseForge" style={{ color: "#f97316", fontWeight: "700" }}>
                    {curseforgeOnlyCategories.map((cat) => (
                      <option
                        key={cat.key}
                        value={cat.key}
                        style={{ color: tokens.textPrimary, background: tokens.bgInput, fontWeight: "400" }}
                      >
                        {cat.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherCategories.length > 0 &&
                  otherCategories.map((cat) => (
                    <option
                      key={cat.key}
                      value={cat.key}
                      style={{ color: tokens.textPrimary, background: tokens.bgInput }}
                    >
                      {cat.name}
                    </option>
                  ))}
              </>
            )}
          </select>
        </div>
      </div>

      {/* Row 2: Content Type Tabs & Provider Tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        {/* Content Type Selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: tokens.bgCardInner,
            border: `1px solid ${tokens.borderSubtle}`,
            borderRadius: "10px",
            padding: "3px",
            gap: "2px",
          }}
        >
          {contentTypeTabs.map((tab) => {
            const isSelected = selectedContentType === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={tab.testId}
                onClick={() => onContentTypeChange(tab.key)}
                style={{
                  background: isSelected ? tokens.bgPillActive : "transparent",
                  color: isSelected ? tokens.textPrimary : tokens.textSecondary,
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: isSelected ? "700" : "500",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Provider Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: tokens.bgCardInner,
            border: `1px solid ${tokens.borderSubtle}`,
            borderRadius: "10px",
            padding: "3px",
            gap: "2px",
          }}
        >
          {providerTabs.map((tab) => {
            const isSelected = selectedProvider === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={tab.testId}
                onClick={() => onProviderChange(tab.key)}
                style={{
                  background: isSelected ? tokens.bgCard : "transparent",
                  color: isSelected ? tokens.textPrimary : tokens.textMuted,
                  border: isSelected ? `1px solid ${tokens.borderSubtle}` : "1px solid transparent",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: isSelected ? "700" : "500",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {tab.key === "MODRINTH" && (
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#10b981",
                      display: "inline-block",
                    }}
                  />
                )}
                {tab.key === "CURSEFORGE" && (
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#f97316",
                      display: "inline-block",
                    }}
                  />
                )}
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
