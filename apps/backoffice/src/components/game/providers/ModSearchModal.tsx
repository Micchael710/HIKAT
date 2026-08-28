import React, { useState, useEffect, useRef } from "react"
import type {
  ModProvider,
  ModSearchResultItem,
  ModProviderStatus,
  ContentType,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { ModCard } from "./ModCard"
import { ModDetailModal } from "./ModDetailModal"

interface ModSearchModalProps {
  onClose: () => void
  onSuccess: () => void
}

const PAGE_SIZE = 20

export const ModSearchModal: React.FC<ModSearchModalProps> = ({ onClose, onSuccess }) => {
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
  const [envInfo, setEnvInfo] = useState<{ minecraftVersion: string; neoForgeVersion: string }>({
    minecraftVersion: "1.21.1",
    neoForgeVersion: "21.1.65",
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
            neoForgeVersion: payload.neoForgeVersion,
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
        backgroundColor: "rgba(0, 0, 0, 0.8)",
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
          backgroundColor: "#111827",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "1000px",
          height: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#f9fafb" }}>
                Añadir Contenido
              </h2>
              <div
                data-testid="compatible-env-indicator"
                style={{ fontSize: "13px", color: "#9ca3af", marginTop: "2px" }}
              >
                Compatible con{" "}
                <span style={{ color: "#34d399", fontWeight: "600" }}>
                  Minecraft {envInfo.minecraftVersion}
                </span>
                {selectedContentType === "MOD" && (
                  <>
                    {" "}·{" "}
                    <span style={{ color: "#60a5fa", fontWeight: "600" }}>
                      NeoForge
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
                color: "#9ca3af",
                fontSize: "24px",
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
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
              paddingBottom: "8px",
              flexWrap: "wrap",
            }}
          >
            {[
              { type: "MOD" as ContentType, label: "Mods", testId: "tab-content-mod" },
              { type: "RESOURCE_PACK" as ContentType, label: "Resource Packs", testId: "tab-content-resource_pack" },
              { type: "DATA_PACK" as ContentType, label: "Data Packs", testId: "tab-content-data_pack" },
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
                    background: isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 255, 255, 0.04)",
                    color: isSelected ? "#60a5fa" : "#9ca3af",
                    border: `1px solid ${isSelected ? "rgba(59, 130, 246, 0.4)" : "rgba(255, 255, 255, 0.08)"}`,
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: isSelected ? "600" : "500",
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
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  color: "#f3f4f6",
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#6b7280",
                  fontSize: "14px",
                }}
              >
                🔍
              </span>
            </div>

            {/* Provider Filter Tabs */}
            <div
              style={{
                display: "flex",
                background: "rgba(0, 0, 0, 0.4)",
                padding: "3px",
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <button
                type="button"
                data-testid="tab-provider-all"
                onClick={() => setSelectedProviderTab("ALL")}
                style={{
                  padding: "8px 14px",
                  background: selectedProviderTab === "ALL" ? "rgba(255, 255, 255, 0.12)" : "transparent",
                  color: selectedProviderTab === "ALL" ? "#ffffff" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "ALL" ? "600" : "500",
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
                  padding: "8px 14px",
                  background: selectedProviderTab === "MODRINTH" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                  color: selectedProviderTab === "MODRINTH" ? "#10b981" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "MODRINTH" ? "600" : "500",
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
                  padding: "8px 14px",
                  background: selectedProviderTab === "CURSEFORGE" ? "rgba(249, 115, 22, 0.2)" : "transparent",
                  color: selectedProviderTab === "CURSEFORGE" ? "#f97316" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "CURSEFORGE" ? "600" : "500",
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
                background: "rgba(234, 179, 8, 0.1)",
                border: "1px solid rgba(234, 179, 8, 0.2)",
                borderRadius: "8px",
                color: "#fde047",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>⚠️</span>
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
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>⏳</div>
              Buscando contenido compatible en los repositorios...
            </div>
          ) : error ? (
            <div
              style={{
                padding: "16px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: "8px",
                color: "#fca5a5",
                fontSize: "14px",
                textAlign: "center",
              }}
            >
              {error}
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
              <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔍</div>
              <div style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>
                No se encontraron resultados
              </div>
              <div style={{ fontSize: "13px" }}>
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
                    style={{
                      padding: "10px 24px",
                      background: "rgba(255, 255, 255, 0.08)",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      color: "#f3f4f6",
                      borderRadius: "8px",
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: loadingMore ? "not-allowed" : "pointer",
                      transition: "all 0.15s ease",
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
