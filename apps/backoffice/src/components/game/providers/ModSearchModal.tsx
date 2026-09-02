import React, { useState, useEffect, useRef } from "react"
import type {
  ModProvider,
  ModSearchResultItem,
  ModProviderStatus,
  ContentType,
  ThemeMode,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { getThemeTokens } from "../../../theme/tokens"
import { IconSearch, IconSpinner, IconWarning } from "../../../theme/icons"
import { ModCard } from "./ModCard"
import { ModDetailModal } from "./ModDetailModal"

interface ModSearchModalProps {
  onClose: () => void
  onSuccess: () => void
  theme?: ThemeMode
}

const PAGE_SIZE = 20

export const ModSearchModal: React.FC<ModSearchModalProps> = ({ onClose, onSuccess, theme = "dark" }) => {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  const [query, setQuery] = useState("")
  const [selectedContentType, setSelectedContentType] = useState<ContentType>("MOD")
  const [selectedProviderTab, setSelectedProviderTab] = useState<ModProvider | "ALL">("ALL")
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [results, setResults] = useState<ModSearchResultItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [providerStatuses, setProviderStatuses] = useState<ModProviderStatus[]>([])
  const [selectedMod, setSelectedMod] = useState<ModSearchResultItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [envInfo, setEnvInfo] = useState<{ minecraftVersion: string; modLoader: import("../../../types").GameModLoader; modLoaderVersion: string | null | undefined }>({
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    modLoaderVersion: null,
  })

  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  const requestIdRef = useRef(0)

  const executeSearch = (
    searchQuery: string,
    contentType: ContentType,
    providerTab: ModProvider | "ALL",
    currentOffset: number = 0,
    isLoadMore: boolean = false,
  ) => {
    const currentReqId = ++requestIdRef.current

    if (isLoadMore) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }

    const providerArg = providerTab === "ALL" ? null : providerTab

    graphqlClient
      .searchMods(searchQuery, contentType, providerArg, PAGE_SIZE, currentOffset)
      .then((payload) => {
        if (currentReqId !== requestIdRef.current) return

        if (isLoadMore) {
          setResults((prev) => [...prev, ...(payload.items || [])])
        } else {
          setResults(payload.items || [])
        }

        setTotalCount(payload.totalCount || 0)
        setProviderStatuses(payload.providersStatus || [])
        if (payload.minecraftVersion) {
          setEnvInfo({
            minecraftVersion: payload.minecraftVersion,
            modLoader: payload.modLoader || "NEOFORGE",
            modLoaderVersion: payload.modLoaderVersion ?? null,
          })
        }
        setLoading(false)
        setLoadingMore(false)
      })
      .catch((err) => {
        if (currentReqId !== requestIdRef.current) return
        setError(err.message || "Error al realizar la búsqueda.")
        setLoading(false)
        setLoadingMore(false)
      })
  }

  // Clear debounce and trigger search on tab changes
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    setOffset(0)
    executeSearch(query, selectedContentType, selectedProviderTab, 0, false)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [selectedContentType, selectedProviderTab])

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      requestIdRef.current++
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    setOffset(0)

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      executeSearch(val, selectedContentType, selectedProviderTab, 0, false)
    }, 350)
  }

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE
    setOffset(nextOffset)
    executeSearch(query, selectedContentType, selectedProviderTab, nextOffset, true)
  }

  // Partial provider failure warning check
  const failedProviders = providerStatuses.filter((s) => !s.available && s.error)
  const hasMore = results.length < totalCount

  return (
    <div
      data-testid="mod-search-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "24px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "20px",
          width: "100%",
          maxWidth: "1000px",
          height: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            background: tokens.bgCardInner,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: tokens.textPrimary }}>
                Añadir Contenido
              </h2>
              <div
                data-testid="compatible-env-indicator"
                style={{ fontSize: "13px", color: tokens.textSecondary, marginTop: "2px" }}
              >
                Compatible con{" "}
                <span style={{ color: "#34d399", fontWeight: "700" }}>
                  Minecraft {envInfo.minecraftVersion}
                </span>
                {selectedContentType === "MOD" && envInfo.modLoader !== "VANILLA" && (
                  <>
                    {" "}·{" "}
                    <span style={{ color: "#60a5fa", fontWeight: "700" }}>
                      {envInfo.modLoader === "NEOFORGE"
                        ? "NeoForge"
                        : envInfo.modLoader === "FORGE"
                        ? "Forge"
                        : envInfo.modLoader === "FABRIC"
                        ? "Fabric"
                        : envInfo.modLoader === "QUILT"
                        ? "Quilt"
                        : envInfo.modLoader}
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              data-testid="button-close-search"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: tokens.textMuted,
                fontSize: "20px",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "6px",
              }}
            >
              ✕
            </button>
          </div>

          {/* Content Type Selector Tabs */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              borderBottom: `1px solid ${tokens.borderSubtle}`,
              paddingBottom: "8px",
              flexWrap: "wrap",
            }}
          >
            {[
              { type: "MOD" as ContentType, label: "Mods", testId: "tab-content-mod" },
              { type: "RESOURCE_PACK" as ContentType, label: "Resource Packs", testId: "tab-content-resource_pack" },
              { type: "SHADER" as ContentType, label: "Shaders", testId: "tab-content-shader" },
            ].map((tab) => {
              const isSelected = selectedContentType === tab.type
              return (
                <button
                  key={tab.type}
                  type="button"
                  data-testid={tab.testId}
                  onClick={() => setSelectedContentType(tab.type)}
                  style={{
                    padding: "6px 14px",
                    background: isSelected ? tokens.bgPillActive : "transparent",
                    color: isSelected ? tokens.textPrimary : tokens.textSecondary,
                    border: `1px solid ${isSelected ? tokens.borderMedium : "transparent"}`,
                    borderRadius: "8px",
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

          {/* Search Input and Provider Tabs */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Search Input */}
            <div style={{ flex: 1, minWidth: "240px", position: "relative" }}>
              <input
                data-testid="input-mod-search"
                type="text"
                value={query}
                onChange={handleQueryChange}
                placeholder={`Buscar ${
                  selectedContentType === "MOD"
                    ? "mods"
                    : selectedContentType === "RESOURCE_PACK"
                    ? "resource packs"
                    : selectedContentType === "DATA_PACK"
                    ? "data packs"
                    : "shaders"
                } en Modrinth y CurseForge...`}
                style={{
                  width: "100%",
                  padding: "10px 16px 10px 38px",
                  background: isDark ? "rgba(0, 0, 0, 0.4)" : "#ffffff",
                  border: `1px solid ${tokens.borderSubtle}`,
                  borderRadius: "10px",
                  color: tokens.textPrimary,
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <IconSearch
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: tokens.textMuted,
                  width: 16,
                  height: 16,
                }}
              />
            </div>

            {/* Provider Filter Tabs */}
            <div
              style={{
                display: "flex",
                background: tokens.bgPill,
                padding: "3px",
                borderRadius: "10px",
                border: `1px solid ${tokens.borderSubtle}`,
              }}
            >
              <button
                type="button"
                data-testid="tab-provider-all"
                onClick={() => setSelectedProviderTab("ALL")}
                style={{
                  padding: "7px 14px",
                  background: selectedProviderTab === "ALL" ? tokens.bgPillActive : "transparent",
                  color: selectedProviderTab === "ALL" ? tokens.textPrimary : tokens.textSecondary,
                  border: "none",
                  borderRadius: "7px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "ALL" ? "700" : "500",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Todos
              </button>

              <button
                type="button"
                data-testid="tab-provider-modrinth"
                onClick={() => setSelectedProviderTab("MODRINTH")}
                style={{
                  padding: "7px 14px",
                  background: selectedProviderTab === "MODRINTH" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                  color: selectedProviderTab === "MODRINTH" ? "#10b981" : tokens.textSecondary,
                  border: "none",
                  borderRadius: "7px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "MODRINTH" ? "700" : "500",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Modrinth
              </button>

              <button
                type="button"
                data-testid="tab-provider-curseforge"
                onClick={() => setSelectedProviderTab("CURSEFORGE")}
                style={{
                  padding: "7px 14px",
                  background: selectedProviderTab === "CURSEFORGE" ? "rgba(249, 115, 22, 0.2)" : "transparent",
                  color: selectedProviderTab === "CURSEFORGE" ? "#f97316" : tokens.textSecondary,
                  border: "none",
                  borderRadius: "7px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "CURSEFORGE" ? "700" : "500",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                CurseForge
              </button>
            </div>
          </div>

          {/* Partial degradation notification */}
          {failedProviders.length > 0 && selectedProviderTab === "ALL" && (
            <div
              data-testid="provider-partial-failure-notice"
              style={{
                padding: "8px 12px",
                background: "rgba(234, 179, 8, 0.12)",
                border: "1px solid rgba(234, 179, 8, 0.25)",
                borderRadius: "8px",
                color: isDark ? "#fde047" : "#b45309",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <IconWarning size={16} />
              <div>
                {failedProviders.map((p) => (
                  <span key={p.provider}>
                    <strong>{p.provider}:</strong> {p.error}{" "}
                  </span>
                ))}
                (Mostrando resultados disponibles de los demás proveedores).
              </div>
            </div>
          )}
        </div>

        {/* Results Grid Container */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }} className="custom-scroll">
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <IconSpinner size={32} />
              <span>Buscando contenido compatible en los repositorios...</span>
            </div>
          ) : error ? (
            <div
              style={{
                padding: "16px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: "10px",
                color: "#ef4444",
                fontSize: "14px",
                textAlign: "center",
              }}
            >
              {error}
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <IconSearch size={36} style={{ color: tokens.textMuted, opacity: 0.5, marginBottom: "4px" }} />
              <div style={{ fontSize: "16px", color: tokens.textPrimary, fontWeight: "700", marginBottom: "4px" }}>
                No se encontraron resultados
              </div>
              <div style={{ fontSize: "13px", color: tokens.textSecondary }}>
                Intenta buscar por otro nombre o revisa los filtros de proveedor y tipo.
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "16px",
                  marginBottom: "20px",
                }}
              >
                {results.map((mod) => (
                  <ModCard
                    key={`${mod.provider}:${mod.projectId}`}
                    mod={mod}
                    theme={theme}
                    onSelect={(selected) => setSelectedMod(selected)}
                  />
                ))}
              </div>

              {hasMore && (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <button
                    type="button"
                    data-testid="button-load-more"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="launcher-btn-secondary"
                    style={{
                      padding: "10px 24px",
                      fontSize: "14px",
                    }}
                  >
                    {loadingMore ? "Cargando más..." : `Cargar más (${results.length} de ${totalCount})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Selected Mod Detail Modal */}
      {selectedMod && (
        <ModDetailModal
          provider={selectedMod.provider}
          projectId={selectedMod.projectId}
          contentType={selectedMod.contentType || selectedContentType}
          theme={theme}
          onClose={() => setSelectedMod(null)}
          onSuccess={() => {
            setSelectedMod(null)
            onClose()
            onSuccess()
          }}
        />
      )}
    </div>
  )
}
